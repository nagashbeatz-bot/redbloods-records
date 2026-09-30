// Owner Inbox MEMORY (Phase 1, Owner decision + approved SQL 2026-10-01) — pure rules. No I/O.
//
//   RAW INBOX ITEM (sunny_owner_inbox, OWNER_REPORTED, immutable)
//     → ENTITY LINKS 0..N (sunny_inbox_links: EXACT_UNIQUE by the server resolver, or OWNER_CONFIRMED from the Owner's answer)
//     → INTERPRETATION per linked PROJECT (sunny_inbox_interpretations: Sunny's understanding, epistemic HYPOTHESIS)
//     → PROJECT MEMORY (read time: canonical state + the Owner's linked updates + the current interpretation + its freshness)
//
// Three layers never mix: what the Owner wrote (OWNER_REPORTED) ≠ what Sunny understood (HYPOTHESIS) ≠ what the records
// say (CANONICAL). Nothing here writes a business record; canonical data always wins (freshness below).
// DB: RLS on, service_role = SELECT only; writes ONLY through the four SECURITY DEFINER RPCs (lib/inbox-memory-store.ts),
// called ONLY by the one writer lib/writes/inbox-memory.ts. The DB enforces structure / existence / idempotency / the head
// chain; the resolver rules (which name → which entity, lib/partner/knowledge/inbox-resolver.ts) are enforced in that
// writer (Option A, documented).

export const INBOX_LINKS_TABLE = "sunny_inbox_links";
export const INBOX_INTERPRETATIONS_TABLE = "sunny_inbox_interpretations";
export const INBOX_LINK_COLUMNS = "id,item_id,entity_key,quality,method,surface,candidates,created_at,retracted_at,retracted_reason";
export const INBOX_INTERPRETATION_COLUMNS = "id,seq,item_id,link_id,entity_key,what_happened,completed,open_gaps,blockers,ball_with,inferred_next_step,confidence,epistemic,source,basis_status,basis_ball,basis_event_at,supersedes_id,supersede_kind,supersede_reason,created_at,retracted_at,retracted_reason";

export const LINK_METHODS = ["RESOLVER_UNIQUE", "OWNER_ANSWER"] as const;
export const LINK_QUALITIES = ["EXACT_UNIQUE", "OWNER_CONFIRMED"] as const;
export const BALL_WITH = ["OWNER", "TEAM", "ENGINEER", "VICTOR", "ARTIST", "CLIENT", "UNKNOWN"] as const;
export const CONFIDENCE = ["LOW", "MEDIUM", "HIGH"] as const;
export const SUPERSEDE_KINDS = ["NEW_UPDATE", "CORRECTION"] as const;
export type LinkMethod = (typeof LINK_METHODS)[number];
export type LinkQuality = (typeof LINK_QUALITIES)[number];
export type BallWith = (typeof BALL_WITH)[number];
export type Confidence = (typeof CONFIDENCE)[number];
export type SupersedeKind = (typeof SUPERSEDE_KINDS)[number];

export const BALL_WITH_HE: Record<BallWith, string> = { OWNER: "אצלך", TEAM: "אצל הצוות", ENGINEER: "אצל המהנדס", VICTOR: "אצל ויקטור", ARTIST: "אצל האמן", CLIENT: "אצל הלקוח", UNKNOWN: "לא ידוע" };
export const CONFIDENCE_HE: Record<Confidence, string> = { LOW: "נמוכה", MEDIUM: "בינונית", HIGH: "גבוהה" };

/** The same limits the DB enforces (CHECKs + the RPCs). */
export const LIMITS = { surface: [2, 80], whatHappened: 300, listItems: 5, listItemChars: 160, nextStep: 200, reason: 200, candidates: [2, 8] } as const;
/** The Partner entity-key contract (the Gateway key module) for the kinds a link may name — the DB CHECK mirrors it. */
export const LINK_KEY_RE = /^(project|client|label-artist|dj|show|session|release):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^vendor:(VICTOR|STEVEN)$/;
export const PROJECT_KEY_RE = /^project:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface InboxLink {
  id: string; itemId: string; entityKey: string; quality: LinkQuality; method: LinkMethod; surface: string; candidates: string[] | null;
  createdAt: string; retractedAt: string | null; retractedReason: string | null;
}
export interface InboxInterpretation {
  id: string; seq: number; itemId: string; linkId: string; entityKey: string;
  whatHappened: string; completed: string[]; openGaps: string[]; blockers: string[]; ballWith: BallWith; inferredNextStep: string | null; confidence: Confidence;
  epistemic: "HYPOTHESIS"; source: "OWNER_REPORTED_DERIVED";
  basisStatus: string | null; basisBall: string | null; basisEventAt: string | null;
  supersedesId: string | null; supersedeKind: SupersedeKind | null; supersedeReason: string | null;
  createdAt: string; retractedAt: string | null; retractedReason: string | null;
}
export interface InboxMemory { links: InboxLink[]; interpretations: InboxInterpretation[] }

const s = (v: unknown) => (typeof v === "string" ? v : null);
const strs = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);
const oneOf = <T extends string>(vals: readonly T[], v: unknown): T | null => (typeof v === "string" && (vals as readonly string[]).includes(v) ? (v as T) : null);

/** A DB row → a link; null = a row breaking the table's own contract (never served half-read). */
export function mapLinkRow(r: unknown): InboxLink | null {
  if (!r || typeof r !== "object") return null;
  const x = r as Record<string, unknown>;
  const id = s(x.id), itemId = s(x.item_id), entityKey = s(x.entity_key), surface = s(x.surface), createdAt = s(x.created_at);
  const quality = oneOf(LINK_QUALITIES, x.quality), method = oneOf(LINK_METHODS, x.method);
  if (!id || !itemId || !entityKey || !LINK_KEY_RE.test(entityKey) || !surface || !createdAt || !quality || !method) return null;
  const candidates = x.candidates === null || x.candidates === undefined ? null : strs(x.candidates);
  if (x.candidates !== null && x.candidates !== undefined && !candidates) return null;
  return { id, itemId, entityKey, quality, method, surface, candidates, createdAt, retractedAt: s(x.retracted_at), retractedReason: s(x.retracted_reason) };
}
/** A DB row → an interpretation; null = a row breaking the contract. */
export function mapInterpretationRow(r: unknown): InboxInterpretation | null {
  if (!r || typeof r !== "object") return null;
  const x = r as Record<string, unknown>;
  const id = s(x.id), itemId = s(x.item_id), linkId = s(x.link_id), entityKey = s(x.entity_key), what = s(x.what_happened), createdAt = s(x.created_at);
  const seq = typeof x.seq === "number" ? x.seq : typeof x.seq === "string" && /^\d+$/.test(x.seq) ? Number(x.seq) : null;
  const completed = strs(x.completed), openGaps = strs(x.open_gaps), blockers = strs(x.blockers);
  const ballWith = oneOf(BALL_WITH, x.ball_with), confidence = oneOf(CONFIDENCE, x.confidence);
  if (!id || seq === null || !itemId || !linkId || !entityKey || !PROJECT_KEY_RE.test(entityKey) || !what || !createdAt || !completed || !openGaps || !blockers || !ballWith || !confidence) return null;
  if (x.epistemic !== "HYPOTHESIS" || x.source !== "OWNER_REPORTED_DERIVED") return null;
  return {
    id, seq, itemId, linkId, entityKey, whatHappened: what, completed, openGaps, blockers, ballWith, inferredNextStep: s(x.inferred_next_step), confidence,
    epistemic: "HYPOTHESIS", source: "OWNER_REPORTED_DERIVED",
    basisStatus: s(x.basis_status), basisBall: s(x.basis_ball), basisEventAt: s(x.basis_event_at),
    supersedesId: s(x.supersedes_id), supersedeKind: oneOf(SUPERSEDE_KINDS, x.supersede_kind), supersedeReason: s(x.supersede_reason),
    createdAt, retractedAt: s(x.retracted_at), retractedReason: s(x.retracted_reason),
  };
}

// ── list arguments (the Action Layer carries scalars only: one item per line) ──
export type ListCheck = { ok: true; items: string[] } | { ok: false; messageHe: string };
/** "one item per line" → the trimmed items (empty lines dropped); ≤ 5 items × ≤ 160 chars (the DB limits). */
export function parseListText(v: unknown, labelHe: string): ListCheck {
  if (v === undefined || v === null || v === "") return { ok: true, items: [] };
  if (typeof v !== "string") return { ok: false, messageHe: `${labelHe}: טקסט, פריט בכל שורה` };
  const items = v.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  if (items.length > LIMITS.listItems) return { ok: false, messageHe: `${labelHe}: עד ${LIMITS.listItems} פריטים (פריט בכל שורה)` };
  if (items.some((t) => t.length > LIMITS.listItemChars)) return { ok: false, messageHe: `${labelHe}: כל פריט עד ${LIMITS.listItemChars} תווים` };
  return { ok: true, items };
}
export const listText = (items: readonly string[]) => items.join("\n");

// ── the current interpretation of a project ──
/** Active (not retracted) interpretations of one entity, newest first (by seq — the DB's own order). */
export function activeInterpretations(all: readonly InboxInterpretation[], entityKey: string): InboxInterpretation[] {
  return all.filter((i) => i.entityKey === entityKey && !i.retractedAt).sort((a, b) => b.seq - a.seq);
}
/** The head = the newest active interpretation (exactly the RPC's HEAD rule). */
export const headOf = (all: readonly InboxInterpretation[], entityKey: string): InboxInterpretation | null => activeInterpretations(all, entityKey)[0] ?? null;
export const activeLinksOf = (all: readonly InboxLink[], pred: (l: InboxLink) => boolean) => all.filter((l) => !l.retractedAt && pred(l));

// ── the canonical basis + freshness (canonical ALWAYS wins over a hypothesis) ──
/**
 * The live canonical ball of a project, projected ONLY from the signals project_view already derives with the app's own
 * rules (computeVictorBall, the engineer statuses, the shared send-log rule) — no second ball rule:
 *   OWNER    VICTOR_WAITING_OWNER / ENGINEER_RETURNED_WORK / OWNER_FEEDBACK_DUE
 *   VICTOR   AT_VICTOR          ENGINEER  AT_ENGINEER          EXTERNAL  WAITING_FEEDBACK / WAITING_VERSION
 * one party → that party; several → MIXED; none → NONE.
 */
const BALL_SIGNAL: Readonly<Record<string, "OWNER" | "VICTOR" | "ENGINEER" | "EXTERNAL">> = {
  VICTOR_WAITING_OWNER: "OWNER", ENGINEER_RETURNED_WORK: "OWNER", OWNER_FEEDBACK_DUE: "OWNER",
  AT_VICTOR: "VICTOR", AT_ENGINEER: "ENGINEER", WAITING_FEEDBACK: "EXTERNAL", WAITING_VERSION: "EXTERNAL",
};
export type CanonicalBall = "OWNER" | "VICTOR" | "ENGINEER" | "EXTERNAL" | "MIXED" | "NONE";
export function canonicalBallOf(signalCodes: readonly string[]): CanonicalBall {
  const parties = [...new Set(signalCodes.map((c) => BALL_SIGNAL[c]).filter(Boolean))];
  return parties.length === 0 ? "NONE" : parties.length > 1 ? "MIXED" : parties[0];
}
/** What the records say about a project NOW (the basis stored with an interpretation is this, at write time). */
export interface ProjectBasis { status: string | null; ball: CanonicalBall; lastEventAt: string | null }

/** Is Sunny's ball compatible with the canonical one? UNKNOWN / NONE / MIXED never conflict. */
function ballCompatible(h: BallWith, live: CanonicalBall): boolean {
  if (h === "UNKNOWN" || live === "NONE" || live === "MIXED") return true;
  if (h === "OWNER") return live === "OWNER";
  if (h === "VICTOR") return live === "VICTOR";
  if (h === "ENGINEER") return live === "ENGINEER";
  if (h === "TEAM") return live === "VICTOR" || live === "ENGINEER";
  return live === "EXTERNAL"; // ARTIST / CLIENT
}
export type Freshness = "CURRENT" | "OUTDATED_BY_CANONICAL" | "BALL_CONFLICT" | "UNVERIFIED";
export const FRESHNESS_HE: Record<Freshness, string> = {
  CURRENT: "עדכני — שום דבר ברשומות לא השתנה מאז",
  OUTDATED_BY_CANONICAL: "לא עדכני — ברשומות קרה משהו אחרי ההבנה הזו (הקשר בלבד)",
  BALL_CONFLICT: "הכדור לפי הרשומות שונה ממה שהבנתי — הרשומות גוברות",
  UNVERIFIED: "לא נבדק מול הרשומות (מצב הפרויקט לא נקרא)",
};
const t = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
/**
 * Canonical wins: a status change or ANY recorded event after the basis → OUTDATED_BY_CANONICAL (the blockers / ball /
 * next step are context from that date, never "current"); a ball that contradicts the live ball → BALL_CONFLICT; else
 * CURRENT. Live state not read → UNVERIFIED (never CURRENT by default).
 */
export function freshnessOf(i: Pick<InboxInterpretation, "basisStatus" | "basisEventAt" | "ballWith">, live: ProjectBasis | null): Freshness {
  if (!live) return "UNVERIFIED";
  if ((live.status ?? null) !== (i.basisStatus ?? null)) return "OUTDATED_BY_CANONICAL";
  const liveT = t(live.lastEventAt), baseT = t(i.basisEventAt);
  if (Number.isFinite(liveT) && (!Number.isFinite(baseT) || liveT > baseT + 1000)) return "OUTDATED_BY_CANONICAL";
  return ballCompatible(i.ballWith, live.ball) ? "CURRENT" : "BALL_CONFLICT";
}
