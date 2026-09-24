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
 * COMMIT: the SAME items + the token. Signature, binding and expiry are verified, the preview is RECOMPUTED from live
 * state (payload / state changed → STALE → re-preview), the nonce is consumed once (in-process + a DB unique index),
 * the batch is appended in ONE statement, and a FRESH read must show every new row as its slot's terminal → LEARNED.
 * Nothing here can write canonical business data: the only write is the injected knowledge-store append.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalStableStringify, sha256Hex } from "../actions/canonical";
import { resolvePartnerEntityCore } from "../gateway/resolve";
import { parseEntityKey } from "../gateway/keys";
import type { GatewaySources } from "../gateway/core";
import { COMPANY_KEY, knowledgeKind, type FieldSpec, type KnowledgeConflict, type KnowledgeKind, type KnowledgeLiveFacts, type KnowledgeSubjectType, type KnowledgeValue } from "./kinds";
import { activeKnowledge, terminalOfSlot, type OwnerKnowledgeDraft, type OwnerKnowledgeRecord, type OwnerKnowledgeStore } from "./store";

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

export type PreviewResult =
  | { status: "PREVIEW"; readBackHe: string; items: NormalizedItem[]; confirmationToken: string; expiresAt: string; instructionsForModel: string }
  | { status: "NEEDS_CLARIFICATION"; questionHe: string; candidates: Array<{ key: string; label: string; type: string }> }
  | { status: "INVALID"; errors: string[] }
  | { status: "CONFLICT_WITH_LIVE"; messagesHe: string[] }
  | { status: "ALREADY_KNOWN"; messageHe: string }
  | { status: "NOTHING_TO_WITHDRAW"; messageHe: string }
  | { status: "NOT_AUTHORIZED" }
  | { status: "UNAVAILABLE"; detail: string };

export type CommitResult =
  | { status: "LEARNED"; ownerMessageHe: string; recorded: Array<{ id: string; kind: string; subjectKey: string; meaningHe: string; epistemic: string; provenance: "OWNER_VIA_SUNNY" }> }
  | { status: "STALE"; messageHe: string }
  | { status: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "ALREADY_COMMITTED" | "NOT_AUTHORIZED" }
  | { status: "NOT_VERIFIED"; messageHe: string; persisted: true }
  | { status: "INVALID" | "CONFLICT_WITH_LIVE" | "NEEDS_CLARIFICATION" | "ALREADY_KNOWN" | "NOTHING_TO_WITHDRAW"; detail: unknown }
  | { status: "UNAVAILABLE" | "FAILED"; detail: string };

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const TYPE_PREF: KnowledgeSubjectType[] = ["label-artist", "dj", "client", "vendor", "project", "release", "show", "company"];

function entityLabel(src: GatewaySources, key: string): string | null {
  if (key === COMPANY_KEY) return "Redbloods";
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
export function resolveEntity(src: GatewaySources, raw: unknown, allowed: readonly KnowledgeSubjectType[], what: string): Resolved {
  // A string is a KEY when it has the exact shape of one (partner_resolve output), otherwise a name as the Owner said it.
  const looksLikeKey = (t: string) => t === COMPANY_KEY || /^vendor:(VICTOR|STEVEN)$/.test(t) || !!parseEntityKey(t);
  const r = (typeof raw === "string" ? (looksLikeKey(raw.trim()) ? { key: raw } : { name: raw }) : raw) as { key?: unknown; name?: unknown } | null;
  if (!r || typeof r !== "object") return { ok: false, error: `${what}: expected { key } or { name }` };
  if (typeof r.key === "string") {
    const key = r.key.trim();
    const type = key === COMPANY_KEY ? "company" : key.startsWith("vendor:") ? "vendor" : parseEntityKey(key)?.type;
    if (!type || !allowed.includes(type as KnowledgeSubjectType)) return { ok: false, error: `${what}: ${key} is not an allowed entity (${allowed.join(" / ")})` };
    const label = entityLabel(src, key);
    if (!label) return { ok: false, error: `${what}: ${key} does not exist` };
    return { ok: true, key, label, identityKeys: [key] };
  }
  if (typeof r.name !== "string" || !r.name.trim() || r.name.length > 120 || CONTROL.test(r.name)) return { ok: false, error: `${what}: name must be 1–120 printable characters` };
  if (allowed.includes("company") && /^(redbloods|רדבלאדס|הלייבל|החברה)$/i.test(r.name.trim())) return { ok: true, key: COMPANY_KEY, label: "Redbloods", identityKeys: [COMPANY_KEY] };
  const res = resolvePartnerEntityCore(r.name.trim(), src);
  const cands = res.candidates.filter((c) => allowed.includes(c.type as KnowledgeSubjectType));
  const ask = (q: string) => ({ ok: false as const, clarify: { questionHe: q, candidates: res.candidates.map((c) => ({ key: c.key, label: c.label.text, type: c.type })) } });
  if (res.status === "NOT_FOUND" || !cands.length) return ask(`לא מצאתי ישות מתאימה בשם "${r.name.trim()}". למי התכוונת?`);
  if (res.status === "AMBIGUOUS") return ask(`יש כמה אפשרויות ל"${r.name.trim()}". למי התכוונת?`);
  const groups = new Set(cands.map((c) => c.identityGroup.id));
  if (groups.size > 1) return ask(`"${r.name.trim()}" יכול להיות כמה ישויות שונות. למי התכוונת?`);
  const pick = [...cands].sort((a, b) => TYPE_PREF.indexOf(a.type as KnowledgeSubjectType) - TYPE_PREF.indexOf(b.type as KnowledgeSubjectType) || a.key.localeCompare(b.key))[0];
  const identityKeys = [...new Set(res.candidates.filter((c) => c.identityGroup.id === pick.identityGroup.id).map((c) => c.key))].sort();
  return { ok: true, key: pick.key, label: pick.label.text, identityKeys };
}

function validField(name: string, spec: FieldSpec, raw: unknown, src: GatewaySources, value: KnowledgeValue, errors: string[], clarify: { v: Resolved | null }) {
  if (raw === undefined || raw === null || raw === "") { if (spec.required) errors.push(`${name}: required`); return; }
  if (spec.type === "enum") { if (typeof raw !== "string" || !spec.values.includes(raw)) errors.push(`${name}: one of ${spec.values.join(", ")}`); else value[name] = raw; return; }
  if (spec.type === "text") { const t = typeof raw === "string" ? raw.normalize("NFKC").trim().replace(/\s+/g, " ") : ""; if (!t || t.length > spec.maxLength || CONTROL.test(t)) errors.push(`${name}: 1–${spec.maxLength} printable characters`); else value[name] = t; return; }
  if (spec.type === "ymd") { const t = String(raw); const d = new Date(`${t}T12:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) errors.push(`${name}: YYYY-MM-DD`); else value[name] = t; return; }
  if (spec.type === "amount") { const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "")); if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) errors.push(`${name}: a positive amount`); else value[name] = Math.round(n * 100) / 100; return; }
  const r = resolveEntity(src, raw, spec.subjectTypes, name);
  if (!r.ok) { if ("clarify" in r) clarify.v = r; else errors.push(r.error); return; }
  value[name] = r.key; value[`${name}Label`] = r.label;
}

type NormalizeOut = { ok: true; items: NormalizedItem[] } | { ok: false; result: PreviewResult };

/** PREVIEW computation (also re-run at COMMIT). Pure over the live read. */
export function normalizeItems(inputs: unknown, live: KnowledgeLive): NormalizeOut {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_ITEMS) return { ok: false, result: { status: "INVALID", errors: [`items: 1–${MAX_ITEMS} knowledge items`] } };
  const errors: string[] = [];
  const items: NormalizedItem[] = [];
  const active = activeKnowledge(live.records, live.facts.todayIL);
  for (const [i, raw] of inputs.entries()) {
    const it = raw as KnowledgeItemInput;
    const kind = knowledgeKind(it?.kind);
    if (!kind) { errors.push(`items[${i}].kind: unknown knowledge kind (no generic notes)`); continue; }
    const op = it.operation === undefined ? "ASSERT" : it.operation;
    if (op !== "ASSERT" && op !== "WITHDRAW") { errors.push(`items[${i}].operation: ASSERT or WITHDRAW`); continue; }
    const subj = resolveEntity(live.src, it.subject, kind.subjectTypes, `items[${i}].subject`);
    if (!subj.ok) { if ("clarify" in subj) return { ok: false, result: { status: "NEEDS_CLARIFICATION", ...subj.clarify } }; errors.push(subj.error); continue; }
    const fields = (it.fields ?? {}) as Record<string, unknown>;
    if (typeof fields !== "object" || Array.isArray(fields)) { errors.push(`items[${i}].fields: object`); continue; }
    const unknown = Object.keys(fields).filter((k) => !(k in kind.fields));
    if (unknown.length) { errors.push(`items[${i}].fields: unknown ${unknown.join(", ")} (allowed: ${Object.keys(kind.fields).join(", ")})`); continue; }
    const value: KnowledgeValue = {};
    const clarify = { v: null as Resolved | null };
    for (const [n, spec] of Object.entries(kind.fields)) validField(`${n}`, spec, fields[n], live.src, value, errors, clarify);
    if (clarify.v && !clarify.v.ok && "clarify" in clarify.v) return { ok: false, result: { status: "NEEDS_CLARIFICATION", ...clarify.v.clarify } };
    if (errors.length) continue;
    const slotKey = `${kind.kind}|${subj.key}|${kind.slot(value)}`.slice(0, 300);
    const terminal = terminalOfSlot(live.records, slotKey);
    const conflicts = op === "ASSERT" ? kind.conflicts(subj.key, value, live.facts) : [];
    const current = active.find((r) => r.slotKey === slotKey) ?? null;
    if (op === "ASSERT" && current && canonicalStableStringify(current.value) === canonicalStableStringify(value)) return { ok: false, result: { status: "ALREADY_KNOWN", messageHe: `סאני כבר יודע: ${current.meaningHe}` } };
    if (op === "WITHDRAW" && !current) return { ok: false, result: { status: "NOTHING_TO_WITHDRAW", messageHe: "אין ידע פעיל כזה לבטל." } };
    const readBack = kind.readBackHe(subj.label, value);
    items.push({
      kind: kind.kind, operation: op, subjectKey: subj.key, subjectLabel: subj.label, identityKeys: subj.identityKeys, slotKey, value, epistemic: kind.epistemic,
      meaningHe: op === "WITHDRAW" ? `לא נכון יותר: ${current!.meaningHe}` : readBack, supersedesId: terminal?.id ?? null, supersedesMeaningHe: terminal && terminal.operation === "ASSERT" ? terminal.meaningHe : null,
      reviewAt: op === "ASSERT" ? kind.reviewAt(value, live.facts.todayIL) : null, expiresAt: op === "ASSERT" ? kind.expiresAt(value) : null, conflicts, notesHe: [...kind.notesHe],
    });
  }
  if (errors.length) return { ok: false, result: { status: "INVALID", errors } };
  const blocking = items.flatMap((x) => x.conflicts.filter((c) => c.severity === "BLOCKING").map((c) => c.messageHe));
  if (blocking.length) return { ok: false, result: { status: "CONFLICT_WITH_LIVE", messagesHe: blocking } };
  if (new Set(items.map((x) => x.slotKey)).size !== items.length) return { ok: false, result: { status: "INVALID", errors: ["two items describe the same knowledge slot"] } };
  return { ok: true, items };
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
  return {
    status: "PREVIEW",
    readBackHe: `הבנתי: ${n.items.map((x) => x.meaningHe).join(" ")}${n.items.some((x) => x.supersedesMeaningHe) ? ` (זה מחליף: ${n.items.filter((x) => x.supersedesMeaningHe).map((x) => x.supersedesMeaningHe).join("; ")})` : ""} לשמור את זה כידע של סאני?`,
    items: n.items, confirmationToken: token, expiresAt: new Date(exp).toISOString(),
    instructionsForModel: "Show readBackHe to the Owner in your own words. Call commit with the SAME items and this token ONLY after the Owner explicitly confirms in this conversation. If they correct anything, preview again.",
  };
}

export async function commitKnowledgeCore(deps: KnowledgeProposeDeps, actor: KnowledgeActor, items: unknown, token: unknown, attemptAuditId: string): Promise<CommitResult> {
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
    return { status: "STALE", messageHe: "משהו השתנה מאז ההצגה. צריך להציג שוב את מה שאני אמור לשמור." };
  }
  if (payloadHash(n.items) !== b.h || stateHash(n.items) !== b.f) return { status: "STALE", messageHe: "הנתונים או הניסוח השתנו מאז האישור. אציג שוב לפני שמירה." };
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
  return { status: "LEARNED", ownerMessageHe: `למדתי: ${w.records.map((r) => r.meaningHe).join(" ")}`, recorded: w.records.map((r) => ({ id: r.id, kind: r.kind, subjectKey: r.subjectKey, meaningHe: r.meaningHe, epistemic: r.epistemic, provenance: "OWNER_VIA_SUNNY" })) };
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
