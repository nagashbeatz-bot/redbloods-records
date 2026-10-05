/**
 * Sunny organizational memory — PREVIEW → Owner confirmation → COMMIT (P2). Pure core; dependencies injected.
 *
 * PREVIEW (reads only): each item is a KNOWN kind; its subject (and entity fields) are resolved DETERMINISTICALLY
 * against live company state (a name is resolved like partner_resolve; one identity group — e.g. DJ CLEANTONE's DJ /
 * client / label-artist records — resolves to one canonical key; different candidates → NEEDS_CLARIFICATION, never a
 * pick); fields are validated + normalized by the kind; conflicts with live data are checked; the slot's current
 * terminal row becomes supersedes_id (server-chosen). The result is a short Hebrew read-back + a confirmation token
 * bound to: Owner user id, MCP client, access token id, the exact normalized payload, the relevant live state, a
 * 10-minute expiry and a one-time nonce (HMAC-signed with the connector secret).
 *
 * COMMIT: the SAME items + the token + the Owner's approval words. Signature, binding and expiry are verified, the
 * preview is RECOMPUTED from live state (payload / state changed → STALE → re-preview), the Owner's words must be an
 * approval of exactly this read-back (lib/partner/owner-approval.ts — the Action Layer's classifier; T1 2026-10-01),
 * the nonce is consumed once (in-process + a DB unique index),
 * the batch is appended in ONE statement, and a FRESH read must show every new row as its slot's terminal → LEARNED.
 * Nothing here can write canonical business data: the only write is the injected knowledge-store append.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalStableStringify, sha256Hex } from "../actions/canonical";
import { resolvePartnerEntityCore } from "../gateway/resolve";
import { parseEntityKey } from "../gateway/keys";
import type { GatewaySources } from "../gateway/core";
import { COMPANY_KEY, knowledgeKind, type FieldSpec, type KnowledgeConflict, type KnowledgeKind, type KnowledgeLiveFacts, type KnowledgeRefKind, type KnowledgeRefOwner, type KnowledgeSubjectType, type KnowledgeValue } from "./kinds";
import { activeKnowledge, assertedTerminal, terminalOfSlot, type OwnerKnowledgeDraft, type OwnerKnowledgeRecord, type OwnerKnowledgeStore } from "./store";
import { isAuthoritative, withProvenanceDefaults } from "./provenance";
import { ownerApprovalVerdict } from "../owner-approval";
import { financeKnowledgeContextOf, issueEntityKey, reconcileForKnowledge, type ReconcileAction } from "../finance/decision-gate";
import type { RehabIssue } from "../finance/integrity";

export const MAX_ITEMS = 3;
export const TOKEN_TTL_MS = 10 * 60_000;
const TOKEN_RE = /^pk1\.[A-Za-z0-9_-]{20,900}\.[A-Za-z0-9_-]{43}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface KnowledgeItemInput { kind: unknown; subject: unknown; fields?: unknown; operation?: unknown }
export interface KnowledgeActor { userId: string; clientId: string; tokenId: string }

export interface KnowledgeLive {
  src: GatewaySources;
  records: OwnerKnowledgeRecord[];
  facts: KnowledgeLiveFacts;
}

export interface KnowledgeProposeDeps {
  secret: string;
  nowMs(): number;
  isOwner(userId: string): Promise<boolean>;
  loadLive(): Promise<{ ok: true; live: KnowledgeLive } | { ok: false; detail: string }>;
  store: OwnerKnowledgeStore;
  /** A brand-new read of the knowledge rows after the write (fresh verification). */
  freshRecords(): Promise<OwnerKnowledgeRecord[] | null>;
  /** One-time use of a confirmation nonce in this process (the DB unique index backs it across processes). */
  consumeNonce(nonce: string, expMs: number): boolean;
}

export interface NormalizedItem {
  kind: string;
  operation: "ASSERT" | "WITHDRAW";
  subjectKey: string;
  subjectLabel: string;
  identityKeys: string[];
  slotKey: string;
  value: KnowledgeValue;
  epistemic: KnowledgeKind["epistemic"];
  meaningHe: string;
  supersedesId: string | null;
  supersedesMeaningHe: string | null;
  reviewAt: string | null;
  expiresAt: string | null;
  conflicts: KnowledgeConflict[];
  notesHe: string[];
}

/**
 * Claim contract (2026-10-05): a knowledge write changes NOTHING in Redbloods. Every result says so in data (canonicalEffect NONE)
 * and names what will keep appearing about the linked records (stillSurfaced) — so nobody can read "למדתי" as "done / closed /
 * I won't ask again". willAppearAs: RECONCILIATION = shown as "כבר אמרת לי — לסנכרן?" (never a fresh question); QUESTION / ISSUE =
 * unchanged. canonicalPath = the existing typed actions that WOULD make the records reflect it (only with the Owner's approval).
 */
export interface StillSurfacedItem { entityKey: string; issueType: string; textHe: string; willAppearAs: "RECONCILIATION" | "QUESTION" | "ISSUE" }
export interface CanonicalEffectInfo {
  canonicalEffect: "NONE";
  /** Records (canonical keys) this knowledge is linked to; [] = company-level / unlinked (nothing about a record changes how it is asked). */
  linkedEntities: string[];
  stillSurfaced: StillSurfacedItem[];
  canonicalPath: Array<Pick<ReconcileAction, "actionId" | "args" | "missing" | "required">>;
  effectHe: string;
}

export type PreviewResult =
  | ({ status: "PREVIEW"; readBackHe: string; items: NormalizedItem[]; confirmationToken: string; expiresAt: string; instructionsForModel: string } & CanonicalEffectInfo)
  | { status: "NEEDS_CLARIFICATION"; questionHe: string; candidates: Array<{ key: string; label: string; type: string }> }
  | { status: "INVALID"; errors: string[] }
  | { status: "CONFLICT_WITH_LIVE"; messagesHe: string[] }
  /** An INFERRED assertion would replace what the Owner / the system already established — explicit, never a silent overwrite. */
  | { status: "PROVENANCE_CONFLICT"; messageHe: string; existing: { id: string; meaningHe: string; sourceType: string } }
  | { status: "ALREADY_KNOWN"; messageHe: string }
  | { status: "NOTHING_TO_WITHDRAW"; messageHe: string }
  | { status: "NOT_AUTHORIZED" }
  | { status: "UNAVAILABLE"; detail: string };

export type CommitResult =
  | ({ status: "LEARNED"; ownerMessageHe: string; recorded: Array<{ id: string; kind: string; subjectKey: string; meaningHe: string; epistemic: string; provenance: "OWNER_VIA_SUNNY" }> } & CanonicalEffectInfo)
  | { status: "STALE"; messageHe: string }
  /** The Owner's words were missing / not an approval / changed the read-back — nothing written (T1, 2026-10-01). */
  | { status: "APPROVAL_MISSING" | "NOT_AN_APPROVAL" | "APPROVAL_WITH_CHANGES"; messageHe: string }
  | { status: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "ALREADY_COMMITTED" | "NOT_AUTHORIZED" }
  | { status: "NOT_VERIFIED"; messageHe: string; persisted: true }
  | { status: "INVALID" | "CONFLICT_WITH_LIVE" | "NEEDS_CLARIFICATION" | "ALREADY_KNOWN" | "NOTHING_TO_WITHDRAW" | "PROVENANCE_CONFLICT"; detail: unknown }
  | { status: "UNAVAILABLE" | "FAILED"; detail: string };

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const TYPE_PREF: KnowledgeSubjectType[] = ["label-artist", "dj", "client", "vendor", "project", "release", "show", "company"];

/** The one deterministic key of a KNOWN_ENTITY: its canonical Latin name folded to [a-z0-9-] (empty = not representable). */
export function slugOf(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63).replace(/-+$/, "");
}
export const KNOWN_KEY_RE = /^known:[a-z0-9][a-z0-9-]{1,62}$/;

/** Declared KNOWN_ENTITY identities (terminal ASSERT rows) plus the ones declared earlier in the SAME batch. */
export interface KnownIndex { byKey: Map<string, string>; bySlug: Map<string, { key: string; displayName: string }> }
export function buildKnownIndex(records: readonly OwnerKnowledgeRecord[]): KnownIndex {
  const idx: KnownIndex = { byKey: new Map(), bySlug: new Map() };
  for (const slot of new Set(records.filter((r) => r.kind === "KNOWN_ENTITY").map((r) => r.slotKey))) {
    const t = assertedTerminal(records, slot);
    if (t) addKnown(idx, t.subjectKey, String(t.value.displayName ?? ""));
  }
  return idx;
}
const addKnown = (idx: KnownIndex, key: string, displayName: string) => { idx.byKey.set(key, displayName); idx.bySlug.set(key.slice("known:".length), { key, displayName }); };

function entityLabel(src: GatewaySources, key: string, known?: KnownIndex): string | null {
  if (key === COMPANY_KEY) return "Redbloods";
  if (key.startsWith("known:")) return known?.byKey.get(key) ?? null;
  if (key === "vendor:VICTOR") return "Victor";
  if (key === "vendor:STEVEN") return "Steven";
  const st = src.state?.status === "OK" ? src.state.value : null;
  const p = parseEntityKey(key);
  if (!st || !p) return null;
  if (p.type === "project" || p.type === "release") return st.domains.projects.data?.index[p.id]?.name ?? null;
  if (p.type === "label-artist") return st.domains.labelArtists.data?.items.find((a) => a.id === p.id)?.name ?? null;
  if (p.type === "client" || p.type === "dj") return st.domains.clients.data?.items.find((c) => c.id === p.id)?.name ?? null;
  if (p.type === "show") return st.domains.shows.data?.items.find((x) => x.id === p.id)?.name ?? null;
  return null;
}

type Resolved = { ok: true; key: string; label: string; identityKeys: string[] } | { ok: false; clarify: { questionHe: string; candidates: Array<{ key: string; label: string; type: string }> } } | { ok: false; error: string };

/** Deterministic entity resolution for a subject / entity field: an explicit key must exist; a name goes through partner_resolve rules. */
export function resolveEntity(src: GatewaySources, raw: unknown, allowed: readonly KnowledgeSubjectType[], what: string, known?: KnownIndex): Resolved {
  // A string is a KEY when it has the exact shape of one (partner_resolve output), otherwise a name as the Owner said it.
  const looksLikeKey = (t: string) => t === COMPANY_KEY || /^vendor:(VICTOR|STEVEN)$/.test(t) || KNOWN_KEY_RE.test(t) || !!parseEntityKey(t);
  const r = (typeof raw === "string" ? (looksLikeKey(raw.trim()) ? { key: raw } : { name: raw }) : raw) as { key?: unknown; name?: unknown } | null;
  if (!r || typeof r !== "object") return { ok: false, error: `${what}: expected { key } or { name }` };
  if (typeof r.key === "string") {
    const key = r.key.trim();
    const type = key === COMPANY_KEY ? "company" : key.startsWith("vendor:") ? "vendor" : key.startsWith("known:") ? "known" : parseEntityKey(key)?.type;
    if (!type || !allowed.includes(type as KnowledgeSubjectType)) return { ok: false, error: `${what}: ${key} is not an allowed entity (${allowed.join(" / ")})` };
    const label = entityLabel(src, key, known);
    if (!label) return { ok: false, error: `${what}: ${key} does not exist` };
    return { ok: true, key, label, identityKeys: [key] };
  }
  if (typeof r.name !== "string" || !r.name.trim() || r.name.length > 120 || CONTROL.test(r.name)) return { ok: false, error: `${what}: name must be 1–120 printable characters` };
  if (allowed.includes("company") && /^(redbloods|רדבלאדס|הלייבל|החברה)$/i.test(r.name.trim())) return { ok: true, key: COMPANY_KEY, label: "Redbloods", identityKeys: [COMPANY_KEY] };
  const res = resolvePartnerEntityCore(r.name.trim(), src);
  const cands = res.candidates.filter((c) => allowed.includes(c.type as KnowledgeSubjectType));
  const ask = (q: string) => ({ ok: false as const, clarify: { questionHe: q, candidates: res.candidates.map((c) => ({ key: c.key, label: c.label.text, type: c.type })) } });
  // A canonical entity ALWAYS wins; a declared KNOWN_ENTITY is only the fallback when no canonical one matched.
  if (res.status === "NOT_FOUND" || !cands.length) {
    const k = allowed.includes("known") && known ? known.bySlug.get(slugOf(r.name.trim())) : undefined;
    if (k) return { ok: true, key: k.key, label: k.displayName, identityKeys: [k.key] };
    return ask(`לא מצאתי ישות מתאימה בשם "${r.name.trim()}". למי התכוונת?${allowed.includes("known") ? " (אם אין לה רשומה ב-Redbloods — צריך להצהיר עליה קודם כישות מוכרת, KNOWN_ENTITY.)" : ""}`);
  }
  if (res.status === "AMBIGUOUS") return ask(`יש כמה אפשרויות ל"${r.name.trim()}". למי התכוונת?`);
  const groups = new Set(cands.map((c) => c.identityGroup.id));
  if (groups.size > 1) return ask(`"${r.name.trim()}" יכול להיות כמה ישויות שונות. למי התכוונת?`);
  const pick = [...cands].sort((a, b) => TYPE_PREF.indexOf(a.type as KnowledgeSubjectType) - TYPE_PREF.indexOf(b.type as KnowledgeSubjectType) || a.key.localeCompare(b.key))[0];
  const identityKeys = [...new Set(res.candidates.filter((c) => c.identityGroup.id === pick.identityGroup.id).map((c) => c.key))].sort();
  return { ok: true, key: pick.key, label: pick.label.text, identityKeys };
}

function validField(name: string, spec: FieldSpec, raw: unknown, src: GatewaySources, value: KnowledgeValue, errors: string[], clarify: { v: Resolved | null }, known?: KnownIndex) {
  if (raw === undefined || raw === null || raw === "") { if (spec.required) errors.push(`${name}: required`); return; }
  if (spec.type === "enum") { if (typeof raw !== "string" || !spec.values.includes(raw)) errors.push(`${name}: one of ${spec.values.join(", ")}`); else value[name] = raw; return; }
  if (spec.type === "text") { const t = typeof raw === "string" ? raw.normalize("NFKC").trim().replace(/\s+/g, " ") : ""; if (!t || t.length > spec.maxLength || CONTROL.test(t)) errors.push(`${name}: 1–${spec.maxLength} printable characters`); else value[name] = t; return; }
  if (spec.type === "ymd") { const t = String(raw); const d = new Date(`${t}T12:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) errors.push(`${name}: YYYY-MM-DD`); else value[name] = t; return; }
  if (spec.type === "amount") { const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "")); if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) errors.push(`${name}: a positive amount`); else value[name] = Math.round(n * 100) / 100; return; }
  if (spec.type === "ref") { const r = resolveRef(src, raw, spec.refKinds, name); if (!r.ok) errors.push(r.error); else { value[name] = r.key; value[`${name}Label`] = r.label; } return; }
  const r = resolveEntity(src, raw, spec.subjectTypes, name, known);
  if (!r.ok) { if ("clarify" in r) clarify.v = r; else errors.push(r.error); return; }
  value[name] = r.key; value[`${name}Label`] = r.label;
}

const REF_RE = /^(proposal|victor-work|mix-work|transaction|rf-production):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
/** The records a typed reference may point at, from the company state already loaded (exact key only — never a name). */
export function refRecordOf(src: GatewaySources, key: string): { label: string; owner: KnowledgeRefOwner } | null {
  const m = REF_RE.exec(key);
  const st = src.state?.status === "OK" ? src.state.value : null;
  if (!m || !st) return null;
  const [, kind, id] = m;
  if (kind === "proposal") { const p = st.domains.proposalsFull.data?.items.find((x) => x.id === id); return p ? { label: p.title || p.clientName, owner: { clientKey: p.clientId ? `client:${p.clientId}` : null, projectKey: p.linkedProjectId ? `project:${p.linkedProjectId}` : null, vendorKey: null } } : null; }
  if (kind === "transaction") { const fin = src.finance?.status === "OK" ? src.finance.value : null; const t = fin?.raw.transactions.find((x) => x.id === id); return t ? { label: `${t.type === "income" ? "הכנסה" : "הוצאה"} ${t.currency ?? ""}${String(t.amount ?? "")} ${t.date ?? ""}`.trim(), owner: { clientKey: null, projectKey: t.projectId ? `project:${t.projectId}` : null, vendorKey: null } } : null; }
  if (kind === "rf-production") { const ops = src.operations?.status === "OK" ? src.operations.value : null; const p = ops?.redFilms?.rows.find((x) => x.id === id); return p ? { label: p.title ?? "הפקה", owner: { clientKey: null, projectKey: p.projectId ? `project:${p.projectId}` : null, vendorKey: null } } : null; }
  if (kind === "victor-work") { const w = st.domains.victor.data?.active.find((x) => x.id === id); return w ? { label: w.title, owner: { clientKey: null, projectKey: w.projectId ? `project:${w.projectId}` : null, vendorKey: "vendor:VICTOR" } } : null; }
  const w = st.domains.steven.data?.open.find((x) => x.id === id);
  return w ? { label: w.title, owner: { clientKey: null, projectKey: w.projectId ? `project:${w.projectId}` : null, vendorKey: "vendor:STEVEN" } } : null;
}
function resolveRef(src: GatewaySources, raw: unknown, kinds: readonly KnowledgeRefKind[], what: string): { ok: true; key: string; label: string } | { ok: false; error: string } {
  const key = typeof raw === "string" ? raw.trim() : typeof (raw as { key?: unknown } | null)?.key === "string" ? String((raw as { key: string }).key).trim() : "";
  const m = REF_RE.exec(key);
  if (!m || !kinds.includes(m[1] as KnowledgeRefKind)) return { ok: false, error: `${what}: an exact key (${kinds.map((k) => `${k}:<id>`).join(" / ")}) — a name is not enough here` };
  const r = refRecordOf(src, key);
  return r ? { ok: true, key, label: r.label } : { ok: false, error: `${what}: ${key} does not exist (or is no longer active)` };
}

/**
 * KNOWN_ENTITY: declare the controlled identity of an entity with NO canonical record. The key is deterministic
 * (known:<slug of the canonical Latin name>); a canonical entity always wins, a similar declared one is refused (no
 * duplicate identity because of a spelling variant), and nothing here stores an alias.
 */
function declareKnown(src: GatewaySources, known: KnownIndex, rawSubject: unknown, displayNameRaw: unknown, what: string): Resolved {
  const name = typeof rawSubject === "string" ? rawSubject : (rawSubject as { name?: unknown } | null)?.name;
  if (typeof name !== "string" || !name.trim() || name.length > 120 || CONTROL.test(name)) return { ok: false, error: `${what}: the canonical name of the new entity (1–120 printable characters)` };
  const dn = String(displayNameRaw ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const slug = slugOf(dn);
  if (slug.length < 2) return { ok: false, error: `${what}: displayName must contain latin letters / digits — the stable key is built from them` };
  if (slugOf(name) !== slug) return { ok: false, error: `${what}: subject and displayName must be the same canonical name (a variant is never declared separately)` };
  const res = resolvePartnerEntityCore(dn, src);
  if (res.status !== "NOT_FOUND" && res.candidates.length) return { ok: false, error: `ENTITY_ALREADY_EXISTS: "${dn}" already exists (${res.candidates.slice(0, 3).map((c) => c.key).join(", ")}) — use that entity; no known entity is created` };
  const same = known.bySlug.get(slug);
  if (same && same.displayName !== dn) return { ok: false, error: `ENTITY_KEY_COLLISION: the key known:${slug} already belongs to "${same.displayName}"` };
  for (const [other, e] of known.bySlug) if (other !== slug && Math.min(other.length, slug.length) >= 4 && (other.startsWith(slug) || slug.startsWith(other))) return { ok: false, error: `POSSIBLE_DUPLICATE_ENTITY: "${dn}" looks like a variant of the declared entity "${e.displayName}" (${e.key}) — use ${e.key}; no second identity is created` };
  const key = `known:${slug}`;
  addKnown(known, key, dn);
  return { ok: true, key, label: dn, identityKeys: [key] };
}

const epistemicOf = (kind: KnowledgeKind, value: KnowledgeValue): KnowledgeKind["epistemic"] =>
  kind.epistemic === "OWNER_DECISION" && value.sourceType && value.sourceType !== "OWNER_STATEMENT" ? "OWNER_REPORTED" : kind.epistemic;

type NormalizeOut = { ok: true; items: NormalizedItem[] } | { ok: false; result: PreviewResult };

/** PREVIEW computation (also re-run at COMMIT). Pure over the live read. */
export function normalizeItems(inputs: unknown, live: KnowledgeLive): NormalizeOut {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_ITEMS) return { ok: false, result: { status: "INVALID", errors: [`items: 1–${MAX_ITEMS} knowledge items`] } };
  const errors: string[] = [];
  const items: NormalizedItem[] = [];
  const known = buildKnownIndex(live.records);
  for (const [i, raw] of inputs.entries()) {
    const it = raw as KnowledgeItemInput;
    const kind = knowledgeKind(it?.kind);
    if (!kind) { errors.push(`items[${i}].kind: unknown knowledge kind (no generic notes)`); continue; }
    const op = it.operation === undefined ? "ASSERT" : it.operation;
    if (op !== "ASSERT" && op !== "WITHDRAW") { errors.push(`items[${i}].operation: ASSERT or WITHDRAW`); continue; }
    const fields = (it.fields ?? {}) as Record<string, unknown>;
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) { errors.push(`items[${i}].fields: object`); continue; }
    const unknown = Object.keys(fields).filter((k) => !(k in kind.fields));
    if (unknown.length) { errors.push(`items[${i}].fields: unknown ${unknown.join(", ")} (allowed: ${Object.keys(kind.fields).join(", ")})`); continue; }
    const value: KnowledgeValue = {};
    const clarify = { v: null as Resolved | null };
    const isDeclare = kind.subjectMode === "DECLARE_KNOWN";
    let subj: Resolved;
    if (isDeclare) {
      // the identity being declared comes from the validated displayName, so the fields are read first
      for (const [n, spec] of Object.entries(kind.fields)) validField(`${n}`, spec, fields[n], live.src, value, errors, clarify, known);
      if (errors.length) continue;
      subj = declareKnown(live.src, known, it.subject, value.displayName, `items[${i}].subject`);
    } else {
      subj = resolveEntity(live.src, it.subject, kind.subjectTypes, `items[${i}].subject`, known);
    }
    if (!subj.ok) { if ("clarify" in subj) return { ok: false, result: { status: "NEEDS_CLARIFICATION", ...subj.clarify } }; errors.push(subj.error); continue; }
    if (!isDeclare) for (const [n, spec] of Object.entries(kind.fields)) validField(`${n}`, spec, fields[n], live.src, value, errors, clarify, known);
    if (clarify.v && !clarify.v.ok && "clarify" in clarify.v) return { ok: false, result: { status: "NEEDS_CLARIFICATION", ...clarify.v.clarify } };
    if (errors.length) continue;
    if (op === "ASSERT" && (kind.provenance || kind.timeAware)) Object.assign(value, withProvenanceDefaults(value, new Set(Object.keys(kind.fields))));
    if (op === "ASSERT" && kind.check) { const ce = kind.check(value); if (ce.length) { for (const m of ce) errors.push(`items[${i}].fields: ${m}`); continue; } }
    if (!isDeclare && typeof value.object === "string" && value.object === subj.key) { errors.push(`items[${i}].fields.object: an entity cannot be related to itself`); continue; }
    const slotKey = `${kind.kind}|${subj.key}|${kind.slot(value)}`.slice(0, 300);
    const terminal = terminalOfSlot(live.records, slotKey);
    const conflicts = op === "ASSERT" ? kind.conflicts(subj.key, value, live.facts) : [];
    // 2026-10-05: a corrected amount / date opens a new slot — an ACTIVE report on the same subject + direction is named, and
    // the Owner says whether this one replaces it (withdraw the old one) or is another payment. Never decided silently.
    if (op === "ASSERT" && kind.kind === "PAYMENT_REPORTED_BY_OWNER") {
      const others = activeKnowledge(live.records, live.facts.todayIL).filter((k) => k.kind === kind.kind && k.subjectKey === subj.key && k.value.direction === value.direction && k.slotKey !== slotKey);
      if (others.length) conflicts.push({ code: "PAYMENT_REPORT_EXISTS", severity: "NOTE", messageHe: `כבר יש דיווח פעיל על אותה ישות (${others.map((k) => k.meaningHe).join(" · ").slice(0, 160)}) — זה תיקון שלו (אז לבטל את הקודם) או תשלום נוסף? לא מחליטה לבד.` });
    }
    const current = assertedTerminal(live.records, slotKey);
    const inUse = current && (!current.expiresAt || current.expiresAt >= live.facts.todayIL) ? current : null;
    const defaultsOf = (v: KnowledgeValue) => (kind.provenance || kind.timeAware ? withProvenanceDefaults(v, new Set(Object.keys(kind.fields))) : v);
    if (op === "ASSERT" && inUse && canonicalStableStringify(defaultsOf(inUse.value)) === canonicalStableStringify(value)) return { ok: false, result: { status: "ALREADY_KNOWN", messageHe: `סאני כבר יודע: ${inUse.meaningHe}` } };
    if (op === "ASSERT" && value.sourceType === "INFERRED" && terminal && (terminal.operation === "WITHDRAW" || isAuthoritative(terminal.value))) {
      return { ok: false, result: { status: "PROVENANCE_CONFLICT", messageHe: terminal.operation === "WITHDRAW" ? "הבעלים כבר ביטל את הידע הזה — הסקה של סאני לא מחזירה אותו." : `כבר קיים ידע מבוסס ${terminal.value.sourceType ?? "OWNER_STATEMENT"}: ${terminal.meaningHe} — הסקה של סאני לא דורסת אותו.`, existing: { id: terminal.id, meaningHe: terminal.meaningHe, sourceType: String(terminal.value.sourceType ?? "OWNER_STATEMENT") } } };
    }
    if (op === "WITHDRAW" && !inUse) { return { ok: false, result: { status: "NOTHING_TO_WITHDRAW", messageHe: "אין ידע פעיל כזה לבטל." } }; }
    const readBack = kind.readBackHe(subj.label, value);
    items.push({
      kind: kind.kind, operation: op, subjectKey: subj.key, subjectLabel: subj.label, identityKeys: subj.identityKeys, slotKey, value, epistemic: epistemicOf(kind, value),
      meaningHe: op === "WITHDRAW" ? `לא נכון יותר: ${inUse!.meaningHe}` : readBack, supersedesId: terminal?.id ?? null, supersedesMeaningHe: terminal && terminal.operation === "ASSERT" ? terminal.meaningHe : null,
      reviewAt: op === "ASSERT" ? kind.reviewAt(value, live.facts.todayIL) : null, expiresAt: op === "ASSERT" ? kind.expiresAt(value) : null, conflicts, notesHe: [...kind.notesHe],
    });
  }
  if (errors.length) return { ok: false, result: { status: "INVALID", errors } };
  const blocking = items.flatMap((x) => x.conflicts.filter((c) => c.severity === "BLOCKING").map((c) => c.messageHe));
  if (blocking.length) return { ok: false, result: { status: "CONFLICT_WITH_LIVE", messagesHe: blocking } };
  if (new Set(items.map((x) => x.slotKey)).size !== items.length) return { ok: false, result: { status: "INVALID", errors: ["two items describe the same knowledge slot"] } };
  return { ok: true, items };
}

/**
 * Everything the Owner was shown in the read-back (so repeating it in the approval is never mistaken for a change):
 * the labels, the field values and every multi-word phrase of the read-back sentences (e.g. "לא דחוף" — a repeated
 * phrase is the read-back, never a negation). Single words come only from labels / values, never from splitting.
 */
export function readBackValuesOf(items: readonly NormalizedItem[]): Array<string | number> {
  const phrases = (t: string) => t.split(/[:;,.()[\]"״—–]|\s-\s/).map((p) => p.trim()).filter((p) => /\S\s+\S/.test(p));
  return items.flatMap((x) => {
    const sentences = [x.meaningHe, ...(x.supersedesMeaningHe ? [x.supersedesMeaningHe] : [])];
    return [x.subjectLabel, ...sentences, ...sentences.flatMap(phrases), ...Object.values(x.value)];
  });
}

const payloadHash = (items: NormalizedItem[]) => sha256Hex(canonicalStableStringify(items.map((x) => [x.kind, x.operation, x.subjectKey, x.identityKeys, x.slotKey, x.value, x.reviewAt, x.expiresAt])));
const stateHash = (items: NormalizedItem[]) => sha256Hex(canonicalStableStringify(items.map((x) => [x.slotKey, x.supersedesId, x.conflicts.map((c) => c.code)])));

function sign(secret: string, body: string) { return createHmac("sha256", secret).update(`pk1.${body}`).digest("base64url"); }
interface TokenBody { v: 1; h: string; f: string; u: string; c: string; t: string; exp: number; n: string }
function issueToken(secret: string, b: TokenBody) { const body = b64u(JSON.stringify(b)); return `pk1.${body}.${sign(secret, body)}`; }
function readToken(secret: string, token: unknown): TokenBody | null {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const [, body, sig] = token.split(".");
  const want = Buffer.from(sign(secret, body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try { const j = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenBody; return j.v === 1 && typeof j.n === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(j.n) ? j : null; } catch { return null; }
}

const ENTITY_KEY_RE = /^(project|client|show|release|label-artist|dj):[0-9a-f-]{36}$/;
/** The canonical records an item is linked to: non-company subject / identity keys + typed entity fields (e.g. about). */
function linkedEntitiesOf(items: ReadonlyArray<Pick<NormalizedItem, "subjectKey" | "identityKeys" | "value">>): string[] {
  const keys = new Set<string>();
  for (const x of items) {
    for (const k of [x.subjectKey, ...x.identityKeys]) if (ENTITY_KEY_RE.test(k)) keys.add(k);
    for (const v of Object.values(x.value)) if (typeof v === "string" && ENTITY_KEY_RE.test(v)) keys.add(v);
  }
  return [...keys].sort();
}

/**
 * What a knowledge write does NOT change, computed from the live finance read (pure): the finance issues / questions about the
 * linked records and how they will appear once this knowledge exists (the SAME decision-gate rule the readers use).
 */
export function canonicalEffectOf(src: GatewaySources, items: ReadonlyArray<Pick<NormalizedItem, "kind" | "subjectKey" | "identityKeys" | "value" | "meaningHe">>, todayIL: string): CanonicalEffectInfo {
  const linked = linkedEntitiesOf(items);
  const fin = src.finance?.status === "OK" ? src.finance.value : null;
  const issues: RehabIssue[] = (fin?.integrity?.issues ?? []) as RehabIssue[];
  // The knowledge as it will be stored (ASSERTs), in the decision gate's own shape — exactly what the next read will see.
  // A WITHDRAW removes knowledge — it never appears in the preview as if it were asserted (it can only stop a reconcile).
  const asRecords = items.filter((x) => (x as { operation?: string }).operation !== "WITHDRAW").map((x, i) => ({ id: `preview-${i}`, kind: x.kind, subjectKey: x.subjectKey, identityKeys: x.identityKeys, slotKey: `preview-${i}`, value: x.value, epistemic: "OWNER_DECISION", meaningHe: x.meaningHe, operation: "ASSERT" as const, supersedesId: null, reviewAt: null, expiresAt: null, createdAt: `${todayIL}T00:00:00.000Z` }));
  const ctx = financeKnowledgeContextOf(asRecords as never, todayIL);
  const stillSurfaced: StillSurfacedItem[] = [];
  const canonicalPath: CanonicalEffectInfo["canonicalPath"] = [];
  for (const i of issues) {
    const key = issueEntityKey(i);
    if (!key || !linked.includes(key) || i.ownerResolved) continue;
    const r = i.reconcile ?? reconcileForKnowledge(i, ctx, fin?.raw?.transactions ?? null);
    stillSurfaced.push({ entityKey: key, issueType: i.issueType, textHe: (r?.textHe ?? i.recommendedOwnerQuestion?.textHe ?? i.subjectLabel ?? i.issueType).slice(0, 300), willAppearAs: r ? "RECONCILIATION" : i.recommendedOwnerQuestion ? "QUESTION" : "ISSUE" });
    for (const a of r?.actions ?? []) if (!canonicalPath.some((c) => c.actionId === a.actionId && c.args.project === a.args.project && c.args.transaction === a.args.transaction)) canonicalPath.push({ actionId: a.actionId, args: a.args, missing: a.missing, required: a.required });
  }
  const recon = stillSurfaced.filter((x) => x.willAppearAs === "RECONCILIATION").length;
  const effectHe = [
    "נשמר כזיכרון בלבד — שום רשומה ב-Redbloods לא השתנתה (לא כסף, לא סטטוס, לא שאלה שנסגרה).",
    !linked.length ? "זה לא מקושר לרשומה מסוימת, אז שום דבר לגבי פרויקט / לקוח / הופעה לא ישתנה באופן שבו הוא מוצג." : "",
    stillSurfaced.length ? `על הרשומות האלה עדיין יופיעו ${stillSurfaced.length} נושאים${recon ? ` (${recon} מהם כ"כבר אמרת לי — לסנכרן?", לא כשאלה חדשה)` : ""}.` : "",
    canonicalPath.length ? `כדי שהמערכת עצמה תשקף את זה צריך פעולה קנונית (${canonicalPath.map((c) => c.actionId).join(" + ")}) — רק באישורך.` : "",
  ].filter(Boolean).join(" ");
  return { canonicalEffect: "NONE", linkedEntities: linked, stillSurfaced, canonicalPath, effectHe };
}

export async function previewKnowledgeCore(deps: KnowledgeProposeDeps, actor: KnowledgeActor, items: unknown): Promise<PreviewResult> {
  let owner = false;
  try { owner = await deps.isOwner(actor.userId); } catch { owner = false; }
  if (!owner) return { status: "NOT_AUTHORIZED" };
  const l = await deps.loadLive().catch((e) => ({ ok: false as const, detail: (e as Error).message }));
  if (!l.ok) return { status: "UNAVAILABLE", detail: l.detail };
  const n = normalizeItems(items, l.live);
  if (!n.ok) return n.result;
  const exp = deps.nowMs() + TOKEN_TTL_MS;
  const token = issueToken(deps.secret, { v: 1, h: payloadHash(n.items), f: stateHash(n.items), u: actor.userId, c: actor.clientId, t: actor.tokenId, exp, n: randomBytes(18).toString("base64url") });
  const effect = canonicalEffectOf(l.live.src, n.items, l.live.facts.todayIL);
  return {
    status: "PREVIEW",
    readBackHe: `הבנתי: ${n.items.map((x) => x.meaningHe).join(" ")}${n.items.some((x) => x.supersedesMeaningHe) ? ` (זה מחליף: ${n.items.filter((x) => x.supersedesMeaningHe).map((x) => x.supersedesMeaningHe).join("; ")})` : ""} ${effect.effectHe} לשמור את זה כידע של סאני?`,
    items: n.items, confirmationToken: token, expiresAt: new Date(exp).toISOString(),
    instructionsForModel: "Show readBackHe to the Owner in your own words — INCLUDING that it changes no record (canonicalEffect NONE). Call commit with the SAME items, this token and confirmationText = the Owner's exact words of approval, ONLY after the Owner explicitly confirms in this conversation (the server refuses words that are not an approval or that change something). If they correct anything, preview again. Never say it was entered / updated / closed / removed from tracking / that you will not ask again: knowledge changes nothing in Redbloods. When canonicalPath is not empty, offer that typed action separately (partner_plan_action → the Owner's approval).",
    ...effect,
  };
}

export async function commitKnowledgeCore(deps: KnowledgeProposeDeps, actor: KnowledgeActor, items: unknown, token: unknown, attemptAuditId: string, confirmationText?: unknown): Promise<CommitResult> {
  const b = readToken(deps.secret, token);
  if (!b) return { status: "TOKEN_INVALID" };
  if (b.u !== actor.userId || b.c !== actor.clientId || b.t !== actor.tokenId) return { status: "TOKEN_INVALID" };
  if (deps.nowMs() > b.exp) return { status: "TOKEN_EXPIRED" };
  let owner = false;
  try { owner = await deps.isOwner(actor.userId); } catch { owner = false; }
  if (!owner) return { status: "NOT_AUTHORIZED" };
  const l = await deps.loadLive().catch((e) => ({ ok: false as const, detail: (e as Error).message }));
  if (!l.ok) return { status: "UNAVAILABLE", detail: l.detail };
  const n = normalizeItems(items, l.live);
  if (!n.ok) {
    const r = n.result;
    if (r.status === "ALREADY_KNOWN") return { status: "ALREADY_KNOWN", detail: r.messageHe };
    if (r.status === "PROVENANCE_CONFLICT") return { status: "PROVENANCE_CONFLICT", detail: r.messageHe };
    return { status: "STALE", messageHe: "משהו השתנה מאז ההצגה. צריך להציג שוב את מה שאני אמור לשמור." };
  }
  if (payloadHash(n.items) !== b.h || stateHash(n.items) !== b.f) return { status: "STALE", messageHe: "הנתונים או הניסוח השתנו מאז האישור. אציג שוב לפני שמירה." };
  // T1: the Owner's own approval words of exactly this read-back — judged by the Action Layer's classifier. Checked
  // BEFORE the nonce is spent, so a refused attempt writes nothing and consumes nothing.
  const approval = ownerApprovalVerdict(confirmationText, readBackValuesOf(n.items));
  if (!approval.ok) return { status: approval.code, messageHe: approval.messageHe };
  if (!deps.consumeNonce(b.n, b.exp)) return { status: "ALREADY_COMMITTED" };
  const provenance = { source: "owner_via_sunny" as const, channel: "mcp" as const, client_id: actor.clientId, token_id: actor.tokenId, attempt_audit_id: attemptAuditId, operation: "LEARN_KNOWLEDGE" as const };
  const drafts: OwnerKnowledgeDraft[] = n.items.map((x, i) => ({
    kind: x.kind, subjectKey: x.subjectKey, identityKeys: x.identityKeys, slotKey: x.slotKey, value: x.value, epistemic: x.epistemic, meaningHe: x.meaningHe.slice(0, 500),
    operation: x.operation, supersedesId: x.supersedesId, reviewAt: x.reviewAt, expiresAt: x.expiresAt, provenance, confirmationId: b.n, itemIndex: i,
  }));
  const w = await deps.store.appendBatch(drafts);
  if (w.status === "ALREADY_COMMITTED") return { status: "ALREADY_COMMITTED" };
  if (w.status === "SLOT_CHANGED") return { status: "STALE", messageHe: "הידע הזה השתנה ממש עכשיו. אציג שוב לפני שמירה." };
  if (w.status !== "APPENDED") return { status: "FAILED", detail: w.detail };
  const fresh = await deps.freshRecords().catch(() => null);
  const ok = !!fresh && w.records.every((r) => fresh.some((f) => f.id === r.id) && terminalOfSlot(fresh, r.slotKey)?.id === r.id);
  if (!ok) return { status: "NOT_VERIFIED", messageHe: "הידע נשלח, אבל עוד לא הצלחתי לוודא שסאני משתמש בו.", persisted: true };
  const effect = canonicalEffectOf(l.live.src, n.items, l.live.facts.todayIL);
  return { status: "LEARNED", ownerMessageHe: `למדתי: ${w.records.map((r) => r.meaningHe).join(" ")} ${effect.effectHe}`, recorded: w.records.map((r) => ({ id: r.id, kind: r.kind, subjectKey: r.subjectKey, meaningHe: r.meaningHe, epistemic: r.epistemic, provenance: "OWNER_VIA_SUNNY" })), ...effect };
}

/** In-process one-time nonce guard (bounded). The DB unique (confirmation_id, item_index) is the cross-process backstop. */
export function createNonceGuard(max = 2000) {
  const used = new Map<string, number>();
  return (nonce: string, expMs: number) => {
    const now = Date.now();
    for (const [k, e] of used) if (e < now) used.delete(k);
    if (used.has(nonce)) return false;
    used.set(nonce, expMs);
    while (used.size > max) used.delete(used.keys().next().value as string);
    return true;
  };
}
