/**
 * Sunny — KNOWN CONTEXT for the operating questions (Owner-approved 2026-10-05, D1–D5). Pure, no I/O.
 *
 * The extension of the finance Decision Gate (lib/partner/finance/decision-gate.ts) to the questions Sunny asks outside
 * Finance (PROJECT_STATE, PAYMENT_EVIDENCE, DEADLINE_REALITY, proposal FOLLOW_UP, OUTSIDE_COMMUNICATION). SAME rule:
 *   - knowledge changes CONVERSATION behaviour, canonical state changes BUSINESS truth (D1);
 *   - when the Owner already told Sunny (active P2 knowledge / an active Owner Context answer) about the SAME entity, the
 *     question is not asked again as if nothing was said: it becomes a known-context line — "כבר אמרת לי X — לפי הרשומות
 *     Y — לסנכרן?" — with the existing canonical action when one exists (a PROPOSAL only, never run from here);
 *   - a record-based signal is NEVER removed by knowledge (needs_me / cases keep showing it);
 *   - matching is by exact canonical key only (the subject / identity keys / a typed reference field) — never a name in
 *     text, never vendor-wide or company-wide, and the most specific reference wins (a work over its project);
 *   - freshness (D3): canonical evidence NEWER than what the Owner said wins (the old statement no longer counts — no
 *     "still true?" needed); otherwise a passed reviewAt asks "זה עדיין נכון?" (never expiry, never deletion, never the
 *     original question without its context); wording / title / updatedAt are never evidence.
 * No store, no table, no generic suppression: the inputs are activeKnowledge + Owner Context answers already loaded.
 */
import type { OwnerKnowledgeRecord } from "../owner-knowledge/store";
import type { ReconcileAction } from "../finance/decision-gate";

export type KnownQuestionKind = "PROJECT_STATE" | "PAYMENT_EVIDENCE" | "DEADLINE_REALITY" | "FOLLOW_UP" | "OUTSIDE_COMMUNICATION";
/** CURRENT = the statement still stands; REVIEW_DUE = its review date passed → "still true?"; SUPERSEDED_BY_EVIDENCE = newer canonical evidence wins. */
export type KnownFreshness = "CURRENT" | "REVIEW_DUE" | "SUPERSEDED_BY_EVIDENCE";
export type KnownContextState = "KNOWN_MATCHES" | "KNOWN_CONTEXT_RECONCILE" | "KNOWN_DECISION_RECONCILE" | "STILL_TRUE_CHECK";

export type KnownBasis =
  | { kind: "OWNER_KNOWLEDGE"; knowledgeId: string; knowledgeKind: string }
  | { kind: "OWNER_ANSWER"; contextId: string; questionType: string; answerCode: string };

export interface KnownContextItem {
  questionKind: KnownQuestionKind;
  /** The canonical entity (project:<id> / proposal:<id> / victor-work:<id> …). */
  entityKey: string;
  state: KnownContextState;
  /** What the Owner said — attributed, never presented as a record. */
  knownHe: string;
  knownAt: string | null;
  basis: KnownBasis;
  /** What the records show now. */
  canonicalHe: string;
  /** Existing typed primitives that would make the records reflect it (proposals only — plan → approval → execute → verify). */
  actions: ReconcileAction[];
  /** The ONE Owner-facing line. */
  textHe: string;
  epistemic: "OWNER_REPORTED" | "OWNER_DECISION";
}

const ymd = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : "");
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** The day the Owner said it (observedAt when given, else the day it was learned). */
export function knownAtOf(k: Pick<OwnerKnowledgeRecord, "createdAt" | "value">): string | null {
  return ymd((k.value as Record<string, unknown>).observedAt) ?? ymd(k.createdAt);
}

/**
 * D3: newer canonical evidence (a real event — upload, version, sent notes, session, send-log entry, payment — never
 * updatedAt / wording) wins; else a passed reviewAt asks "still true?"; else the statement stands.
 */
export function freshnessOf(k: Pick<OwnerKnowledgeRecord, "createdAt" | "value" | "reviewAt">, todayIL: string, lastEvidenceYmd: string | null): KnownFreshness {
  const at = knownAtOf(k);
  if (lastEvidenceYmd && at && lastEvidenceYmd > at) return "SUPERSEDED_BY_EVIDENCE";
  if (k.reviewAt && k.reviewAt < todayIL) return "REVIEW_DUE";
  return "CURRENT";
}

/** Exact-key match: the subject / identity keys, or a typed reference field of the value (never text). */
export function knowledgeAbout(records: readonly OwnerKnowledgeRecord[], kinds: readonly string[], entityKey: string, refField?: string): OwnerKnowledgeRecord[] {
  return records.filter((k) => kinds.includes(k.kind) && (refField
    ? (k.value as Record<string, unknown>)[refField] === entityKey
    : k.subjectKey === entityKey || k.identityKeys.includes(entityKey)));
}

/** The one line. CURRENT → "כבר אמרת לי … — לפי הרשומות … [— לסנכרן?]"; REVIEW_DUE → "אמרת לי ב-… — זה עדיין נכון?". */
export function knownItem(o: {
  questionKind: KnownQuestionKind; entityKey: string; label: string | null; meaningHe: string; knownAt: string | null; basis: KnownBasis;
  freshness: Exclude<KnownFreshness, "SUPERSEDED_BY_EVIDENCE">; canonicalHe: string; actions?: ReconcileAction[]; epistemic?: KnownContextItem["epistemic"];
}): KnownContextItem {
  const actions = o.actions ?? [];
  const pre = o.label ? `"${o.label}": ` : "";
  const knownHe = `${o.freshness === "REVIEW_DUE" ? "אמרת לי" : "כבר אמרת לי"}${o.knownAt ? ` (${ddmm(o.knownAt)})` : ""}: ${clip(o.meaningHe, 200)}`;
  const state: KnownContextState = o.freshness === "REVIEW_DUE" ? "STILL_TRUE_CHECK" : actions.length ? (o.basis.kind === "OWNER_ANSWER" ? "KNOWN_DECISION_RECONCILE" : "KNOWN_CONTEXT_RECONCILE") : "KNOWN_MATCHES";
  const tail = o.freshness === "REVIEW_DUE" ? " — זה עדיין נכון?" : actions.length ? ` — לפי הרשומות: ${o.canonicalHe}. לסנכרן?` : ` — לפי הרשומות: ${o.canonicalHe}.`;
  return {
    questionKind: o.questionKind, entityKey: o.entityKey, state, knownHe, knownAt: o.knownAt, basis: o.basis, canonicalHe: o.canonicalHe, actions,
    textHe: clip(`${pre}${knownHe}${tail}`, 420), epistemic: o.epistemic ?? (o.basis.kind === "OWNER_ANSWER" ? "OWNER_DECISION" : "OWNER_REPORTED"),
  };
}

/**
 * FOLLOW_UP_EXPECTATION → the proposal's canonical follow-up (SET_PROPOSAL_FOLLOWUP, an existing primitive). A date the
 * Owner gave → that date; "לא כרגע" (NOT_NOW) → clear the follow-up; a relative / unspecified time → the date is asked.
 * Never written from here; the action is a proposal the Owner approves.
 */
export function followUpPathOf(proposalKey: string, value: Record<string, unknown>, recordedFollowUp: string | null): { canonicalHe: string; actions: ReconcileAction[] } {
  const when = ymd(value.when);
  const rel = typeof value.whenRelative === "string" ? value.whenRelative : null;
  if (rel === "NOT_NOW") {
    return recordedFollowUp
      ? { canonicalHe: `בהצעה עדיין רשום פולואפ ל-${ddmm(recordedFollowUp)}`, actions: [{ actionId: "SET_PROPOSAL_FOLLOWUP", args: { proposal: proposalKey, clear: true }, missing: [], required: true, noteHe: "מבטל את תאריך הפולואפ של ההצעה (והמשימה שלו) — ההצעה עצמה לא משתנה." }] }
      : { canonicalHe: "אין להצעה תאריך פולואפ רשום", actions: [] };
  }
  if (when) {
    return recordedFollowUp === when
      ? { canonicalHe: `הפולואפ של ההצעה כבר רשום ל-${ddmm(when)}`, actions: [] }
      : { canonicalHe: recordedFollowUp ? `בהצעה רשום פולואפ ל-${ddmm(recordedFollowUp)}` : "אין להצעה תאריך פולואפ רשום", actions: [{ actionId: "SET_PROPOSAL_FOLLOWUP", args: { proposal: proposalKey, followupDate: when }, missing: [], required: true, noteHe: "קובע את תאריך הפולואפ של ההצעה (המשימה וה-Google Task זזים איתו)." }] };
  }
  return { canonicalHe: recordedFollowUp ? `בהצעה רשום פולואפ ל-${ddmm(recordedFollowUp)}` : "אין להצעה תאריך פולואפ רשום", actions: [{ actionId: "SET_PROPOSAL_FOLLOWUP", args: { proposal: proposalKey }, missing: ["followupDate"], required: true, noteHe: "צריך ממך תאריך כדי לרשום פולואפ — לא ממציא תאריך מ'אחרי החגים'." }] };
}

/**
 * The follow-up expectation that speaks about ONE proposal: an expectation naming THAT proposal first; a client-level
 * expectation (no proposal named) only when the client has exactly ONE open proposal — a decision about one proposal
 * never applies to another (cross-entity safety).
 */
export function followUpKnowledgeFor(records: readonly OwnerKnowledgeRecord[], proposalKey: string, clientKey: string | null, clientOpenProposals: number): OwnerKnowledgeRecord | null {
  const exact = knowledgeAbout(records, ["FOLLOW_UP_EXPECTATION"], proposalKey, "proposal");
  if (exact.length) return exact[0];
  if (!clientKey || clientOpenProposals !== 1) return null;
  return knowledgeAbout(records, ["FOLLOW_UP_EXPECTATION"], clientKey).find((k) => !(k.value as Record<string, unknown>).proposal) ?? null;
}

/** A proposal follow-up the Owner already spoke about → its known-context line (null = nothing known → the ordinary question). */
export function followUpKnown(k: OwnerKnowledgeRecord, proposalKey: string, label: string | null, recordedFollowUp: string | null, todayIL: string): KnownContextItem {
  const fr = freshnessOf(k, todayIL, null);
  const path = followUpPathOf(proposalKey, k.value as Record<string, unknown>, recordedFollowUp);
  return knownItem({ questionKind: "FOLLOW_UP", entityKey: proposalKey, label, meaningHe: k.meaningHe, knownAt: knownAtOf(k), basis: { kind: "OWNER_KNOWLEDGE", knowledgeId: k.id, knowledgeKind: k.kind }, freshness: fr === "SUPERSEDED_BY_EVIDENCE" ? "CURRENT" : fr, canonicalHe: path.canonicalHe, actions: fr === "REVIEW_DUE" ? [] : path.actions });
}

/** Who the Owner said holds a project (PROJECT_BLOCKER reason / FOLLOW_UP who) — OWNER or someone else; never a record. */
export function ownerSaidBallOf(k: OwnerKnowledgeRecord): "OWNER" | "OTHER" | null {
  const v = k.value as Record<string, unknown>;
  if (k.kind === "PROJECT_BLOCKER") return v.reason === "WAITING_FOR_OWNER" ? "OWNER" : typeof v.reason === "string" ? "OTHER" : null;
  if (k.kind === "FOLLOW_UP_EXPECTATION") return v.who === "OWNER_WILL_CONTACT" ? "OWNER" : v.who === "COUNTERPART_WILL_CONTACT" ? "OTHER" : null;
  return null;
}

/** The project-level statements (blocker / follow-up, never one tied to a single proposal) — exact project key only. */
export function projectKnowledgeFor(records: readonly OwnerKnowledgeRecord[], projectKey: string): OwnerKnowledgeRecord[] {
  return knowledgeAbout(records, ["PROJECT_BLOCKER", "FOLLOW_UP_EXPECTATION"], projectKey).filter((k) => !(k.value as Record<string, unknown>).proposal);
}

/** The existing Owner Context answer for a Victor delivery (investigation case DELIVERY_WITHOUT_RECORDED_FOLLOWUP, per work). */
export const victorDeliveryQuestionId = (workId: string) => `victor_delivery_no_followup:${workId}::WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM`;
const REVIEW_ANSWER_HE: Record<string, string> = { REVIEWED_OUTSIDE_SYSTEM: "המסירה נבדקה / טופלה מחוץ למערכת", NOT_REVIEWED_YET: "המסירה עוד לא נבדקה", NO_REVIEW_NEEDED: "לא נדרשת בדיקה למסירה הזו", WAITING_ON_SOMETHING_ELSE: "הטיפול ממתין לדבר אחר" };

/**
 * OUTSIDE_COMMUNICATION for ONE vendor work (Victor / a mix engineer). What the Owner already said, most specific first:
 *   1 VENDOR_COMMITMENT naming THIS work (a commitment — "הוא על זה");
 *   2 the Owner Context answer about THIS work's delivery (WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM — read here when it exists;
 *     as of 2026-10-05 NO writer records it yet (no dashboard answer, no Claude bridge) — never claimed as an answer path);
 *   3 a processed update (inbox interpretation) on the work's PROJECT that puts the ball with the vendor — only when the
 *     project has exactly ONE active work of that vendor (never project-wide across works).
 * A version uploaded AFTER the statement is newer canonical evidence: the statement no longer counts (a real new reason).
 * A push to the vendor is NEVER proof of communication (it is not an input here). No canonical primitive records "we talked
 * outside" — the line says so honestly; the ball stays where the records put it.
 */
export function vendorWorkKnown(o: {
  workKey: string; label: string | null; lastUploadAt: string | null; todayIL: string;
  records: readonly OwnerKnowledgeRecord[];
  answers?: ReadonlyArray<{ questionId: string; contextId: string; questionType: string; answerCode: string; answeredAt: string; status: string }> | null;
  projectUpdate?: { id: string; ballWith: string; createdAt: string; whatHappened: string } | null;
  vendorLabel: string;
  /** the inbox ballWith that means "with this vendor" (VICTOR / ENGINEER) — any other value is not about this work */
  vendorBall: string;
}): KnownContextItem | null {
  const upDay = ymd(o.lastUploadAt);
  const canonicalHe = `לפי המערכת ${o.vendorLabel} העלה גרסה${upDay ? ` ב-${ddmm(upDay)}` : ""} ואין הערות שלך רשומות אחריה — אין פעולה קנונית שרושמת "דיברנו מחוץ למערכת", אז הכדור לפי הרשומות נשאר אצלך עד שיישלחו הערות או תעלה גרסה`;
  const commit = knowledgeAbout(o.records, ["VENDOR_COMMITMENT"], o.workKey, "work")[0];
  if (commit) {
    const fr = freshnessOf(commit, o.todayIL, upDay);
    if (fr !== "SUPERSEDED_BY_EVIDENCE") return knownItem({ questionKind: "OUTSIDE_COMMUNICATION", entityKey: o.workKey, label: o.label, meaningHe: commit.meaningHe, knownAt: knownAtOf(commit), basis: { kind: "OWNER_KNOWLEDGE", knowledgeId: commit.id, knowledgeKind: commit.kind }, freshness: fr, canonicalHe });
  }
  const wid = o.workKey.startsWith("victor-work:") ? o.workKey.slice("victor-work:".length) : null;
  const ans = wid ? (o.answers ?? []).filter((a) => a.questionId === victorDeliveryQuestionId(wid) && a.status === "ACTIVE").sort((a, b) => b.answeredAt.localeCompare(a.answeredAt))[0] : undefined;
  if (ans && !(upDay && ymd(ans.answeredAt) && upDay > ymd(ans.answeredAt)!)) {
    return knownItem({ questionKind: "OUTSIDE_COMMUNICATION", entityKey: o.workKey, label: o.label, meaningHe: REVIEW_ANSWER_HE[ans.answerCode] ?? ans.answerCode, knownAt: ymd(ans.answeredAt), basis: { kind: "OWNER_ANSWER", contextId: ans.contextId, questionType: ans.questionType, answerCode: ans.answerCode }, freshness: "CURRENT", canonicalHe });
  }
  const u = o.projectUpdate;
  if (u && u.ballWith === o.vendorBall && !(upDay && ymd(u.createdAt) && upDay > ymd(u.createdAt)!)) {
    return knownItem({ questionKind: "OUTSIDE_COMMUNICATION", entityKey: o.workKey, label: o.label, meaningHe: u.whatHappened, knownAt: ymd(u.createdAt), basis: { kind: "OWNER_KNOWLEDGE", knowledgeId: u.id, knowledgeKind: "INBOX_INTERPRETATION" }, freshness: "CURRENT", canonicalHe });
  }
  return null;
}

/** The inputs vendorWorkKnown needs, read from the Gateway sources a view already has (memory answers, processed updates). */
export function vendorKnownInputs(src: { memory?: { status: string; value?: unknown }; inboxMemory?: { status: string; value?: unknown } }) {
  const mem = src.memory?.status === "OK" ? (src.memory.value as { entities: Array<{ ownerDecisions: Array<{ questionId: string; contextId: string; questionType: string; answerCode: string; answeredAt: string; status: string }> }> }) : null;
  const inbox = src.inboxMemory?.status === "OK" ? (src.inboxMemory.value as { interpretations: Array<{ id: string; entityKey: string; ballWith: string; createdAt: string; whatHappened: string; retractedAt: string | null; supersedesId: string | null }> }) : null;
  const answers = mem ? mem.entities.flatMap((e) => e.ownerDecisions) : null;
  /** the newest live (not retracted, not superseded) interpretation of a project */
  const projectUpdate = (projectKey: string) => {
    if (!inbox) return null;
    const rows = inbox.interpretations.filter((x) => x.entityKey === projectKey && !x.retractedAt);
    const superseded = new Set(rows.map((x) => x.supersedesId).filter(Boolean));
    return rows.filter((x) => !superseded.has(x.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  };
  return { answers, projectUpdate };
}
