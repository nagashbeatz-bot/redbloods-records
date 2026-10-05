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
import { topicSlug } from "../owner-knowledge/kinds";

export type KnownQuestionKind = "PROJECT_STATE" | "PAYMENT_EVIDENCE" | "DEADLINE_REALITY" | "FOLLOW_UP" | "OUTSIDE_COMMUNICATION" | (string & {});
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
 *   2 the Owner Context answer about THIS work's delivery (WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM — written through the Claude
 *     case bridge, lib/partner/investigation/case-answer.ts, Owner Q1 2026-10-05; Victor works only, exact work identity);
 *   2b a PROJECT_BLOCKER WAITING_FOR_VENDOR the Owner stated on the work's PROJECT — only when the project has exactly ONE
 *      open work of that vendor (singleWorkProjectKey), never project-wide across works;
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
  /** the work's project key ONLY when the project has exactly one open work of this vendor (else null / absent) */
  singleWorkProjectKey?: string | null;
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
  if (o.singleWorkProjectKey) {
    const b = knowledgeAbout(o.records, ["PROJECT_BLOCKER"], o.singleWorkProjectKey).find((k) => (k.value as Record<string, unknown>).reason === "WAITING_FOR_VENDOR" && !(k.value as Record<string, unknown>).proposal);
    if (b) {
      const fr = freshnessOf(b, o.todayIL, upDay);
      if (fr !== "SUPERSEDED_BY_EVIDENCE") return knownItem({ questionKind: "OUTSIDE_COMMUNICATION", entityKey: o.workKey, label: o.label, meaningHe: b.meaningHe, knownAt: knownAtOf(b), basis: { kind: "OWNER_KNOWLEDGE", knowledgeId: b.id, knowledgeKind: b.kind }, freshness: fr, canonicalHe });
    }
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

// ══ QUESTION MEMORY (Owner-approved 2026-10-05, Q1–Q4): ONE map + ONE resolver for every remaining Owner question ══
/**
 * Every question Sunny shows ends in ONE of four states:
 *   ASK — nothing known, no canonical state decides it;
 *   KNOWN — the Owner already answered (an exact-entity BUSINESS_DECISION, topic q-<kind>) and it still holds → not asked;
 *   RECONCILE — he answered and the records do not reflect it yet → "כבר אמרת לי X — לפי הרשומות Y — לסנכרן?" + a proposal;
 *   REOPENED_BECAUSE_EVIDENCE_CHANGED — he answered, then a REAL canonical event changed the question → asked again WITH the
 *     earlier answer as context. Never reopened by wording / title / updatedAt / refresh / build / another subsystem.
 * A question the canonical state decides is never generated at all (the field is set → it is gone): no store for it.
 */
export type QuestionContractState = "ASK" | "KNOWN" | "RECONCILE" | "REOPENED_BECAUSE_EVIDENCE_CHANGED";
export interface EntityQuestion { kind: string; questionHe: string; why: string; entity: string }
type Home = { home: "CANONICAL" | "CANONICAL_AND_CONTEXT"; identity: string; reconcile?: (entity: string) => ReconcileAction[]; answerHe: string };
/** question kind → its home. `identity` = the canonical question identity (two subsystems asking the same thing share it). */
export const QUESTION_HOMES: Readonly<Record<string, Home>> = {
  // shows (show:<id>)
  DJ: { home: "CANONICAL_AND_CONTEXT", identity: "DJ", answerHe: "ASSIGN_SHOW_DJ / SET_SHOW_DEAL_TYPE; 'אין צורך ב-DJ' = הקשר" },
  SHOW_DJ: { home: "CANONICAL_AND_CONTEXT", identity: "DJ", answerHe: "כמו DJ (אותה שאלה מתמונת האמן)" },
  DJ_CONFIRM: { home: "CANONICAL_AND_CONTEXT", identity: "DJ_CONFIRM", answerHe: "רק CLEANTONE מאשר בפורטל; 'אישר בטלפון' = הקשר (אין פעולת אישור לבעלים)" },
  PRICE: { home: "CANONICAL_AND_CONTEXT", identity: "PRICE", answerHe: "SET_SHOW_MONEY / SET_SHOW_DEAL_TYPE; 'עוד לא סוכם' = הקשר" },
  CLOSE: { home: "CANONICAL_AND_CONTEXT", identity: "CLOSE", answerHe: "CLOSE_SHOW / CANCEL_SHOW / UPDATE_SHOW_DETAILS; 'התקיימה, אסגור אחר כך' = הקשר + סנכרון", reconcile: (e) => [{ actionId: "CLOSE_SHOW", args: { show: e }, missing: ["paymentStatus", "incomeReceived", "djPaid"], required: true, noteHe: "סגירה כבוצע דרך תהליך הסגירה — מה קרה עם תשלום הלקוח וה-DJ נשאל, לא מנוחש." }] },
  PLACE: { home: "CANONICAL_AND_CONTEXT", identity: "PLACE", answerHe: "UPDATE_SHOW_DETAILS (location); 'עוד לא נקבע' = הקשר" },
  TIME: { home: "CANONICAL_AND_CONTEXT", identity: "TIME", answerHe: "UPDATE_SHOW_DETAILS (startTime); 'עוד לא נקבעה' = הקשר" },
  // label
  RELEASE: { home: "CANONICAL_AND_CONTEXT", identity: "RELEASE", answerHe: "UPDATE_RELEASE_DETAILS (nextAction / blocker / target) / CHANGE_RELEASE_STAGE; 'עוד אין תאריך' / 'לא דחוף' = הקשר" },
  ARTIST_PLAN: { home: "CANONICAL_AND_CONTEXT", identity: "ARTIST_PLAN", answerHe: "פרויקט / סשן / ריליס עתידי; 'בהפסקה' / 'התוכנית מחוץ למערכת' = הקשר" },
  // sessions — canonical only (the status is the answer; no parallel store)
  SESSION_STATE: { home: "CANONICAL", identity: "SESSION_STATE", answerHe: "UPDATE_SESSION (סשן) / UPDATE_SHOW_REHEARSAL (חזרה להופעה)" },
  // Red Films
  STATUS: { home: "CANONICAL_AND_CONTEXT", identity: "STATUS", answerHe: "UPDATE_PRODUCTION_DETAILS (status / shootDate) / CANCEL_PRODUCTION; 'צולם, אעדכן' = הקשר + סנכרון", reconcile: (e) => [{ actionId: "UPDATE_PRODUCTION_DETAILS", args: { production: e }, missing: ["status"], required: true, noteHe: "הסטטוס נרשם רק בפעולה — איזה שלב (צולם / חומרי גלם הועלו / …) נשאל, לא מנוחש." }] },
  // Red Films FINANCE / mix FINANCE — the ONE Finance truth (no parallel subsystem)
  FINANCE: { home: "CANONICAL_AND_CONTEXT", identity: "FINANCE", answerHe: "Finance הקנוני (LINK_RF_PAYMENT_TO_FINANCE / DELETE_CLIP_ROW / SET_TRANSACTION_STATUS); אין פעולה לקישור הוצאת מיקס יתומה — 'שארית' = הקשר" },
  // mix / Victor
  HANDOFF: { home: "CANONICAL_AND_CONTEXT", identity: "HANDOFF", answerHe: "SET_ENGINEER_WORK_STATUS / UPDATE_SEND_LOG_ENTRY (לעולם לא DELETE_SEND_LOG_ENTRY — מוחק בשרשור); 'אצלו' = הקשר" },
  PAYMENT: { home: "CANONICAL_AND_CONTEXT", identity: "PAYMENT", answerHe: "RECORD_ENGINEER_PAYMENT (שולח Push לסטיבן — רק באישורך) / Finance; 'שולם מחוץ למערכת' = הקשר" },
  // "טופל / נתת פידבק מחוץ למערכת?" on ONE work: Victor → partner_answer_question with the question's questionRef (the case
  // bridge, Owner Q1); any engineer → VENDOR_COMMITMENT on the work or BUSINESS_DECISION ref <work>. A new version reopens.
  OUTSIDE_COMMUNICATION: { home: "CANONICAL_AND_CONTEXT", identity: "OUTSIDE_COMMUNICATION", answerHe: "שליחת הערות / גרסה במערכת; ויקטור: לענות עם ה-questionRef של השאלה (partner_answer_question); מהנדס מיקס: 'דיברנו / נתתי פידבק בחוץ' = הקשר על העבודה" },
  // label project with no recorded ball evidence: a blocker / follow-up the Owner states is context on THAT project
  PROJECT_STATE: { home: "CANONICAL_AND_CONTEXT", identity: "PROJECT_STATE", answerHe: "עבודת ויקטור / מיקס / משימה / סטטוס פרויקט; 'מחכה לאמן' / 'בהקפאה' = הקשר על הפרויקט (PROJECT_BLOCKER או BUSINESS_DECISION about)" },
  // money ahead (Financial Forward, Owner decision 2026-10-06 — Decision Persistence C): WHEN an obligation is paid / settled is
  // the Owner's decision (BUSINESS_DECISION with timing / conditionHe on the exact work / artist), never a Finance row and never
  // money; the payment itself stays the canonical action. A completed unpaid engineer work = ONE question per work (ref
  // mix-work:<id>) — a new work never inherits an old decision; a settlement = the artist's CURRENT cycle only.
  OBLIGATION_TIMING: { home: "CANONICAL_AND_CONTEXT", identity: "OBLIGATION_TIMING", answerHe: "התשלום עצמו = RECORD_ENGINEER_PAYMENT / ADD_LEDGER_ENTRY / CLOSE_BALANCE_CYCLE (באישורך); מתי ובאיזה תנאי = החלטה (BUSINESS_DECISION: timing + conditionHe במילים שלך) — לא שורה בכספים ולא תאריך מומצא" },
  // clients
  CONVERSION: { home: "CANONICAL_AND_CONTEXT", identity: "CONVERSION", answerHe: "CONVERT_PROPOSAL / LINK_PROPOSAL_TO_PROJECT; 'לא צריך פרויקט' = הקשר" },
};
/** The BUSINESS_DECISION topic that answers a question kind (the same for two subsystems asking the same thing). */
export const answerTopicOf = (kind: string) => `q-${topicSlug((QUESTION_HOMES[kind]?.identity ?? kind).replace(/_/g, "-"))}`;
/** What Sunny records when the Owner answers with context (served with every question — exact entity, never the company). */
export function answerAsOf(q: EntityQuestion) {
  const h = QUESTION_HOMES[q.kind];
  if (!h) return null;
  if (h.home === "CANONICAL") return { canonicalHe: h.answerHe, contextKind: null };
  // only an entity a context answer can be pinned to EXACTLY (BUSINESS_DECISION about / ref) gets a context path
  const field = /^(proposal|victor-work|mix-work|transaction|rf-production):/.test(q.entity) ? "ref" : /^(project|client|show|release|label-artist|dj):/.test(q.entity) ? "about" : null;
  if (!field) return { canonicalHe: h.answerHe, contextKind: null, noteHe: "לשאלה הזאת אין בית להקשר — רק הפעולה הקנונית עונה עליה" };
  return { canonicalHe: h.answerHe, contextKind: "BUSINESS_DECISION", [field]: q.entity, topic: answerTopicOf(q.kind) };
}
/** The exact-entity decision that answers THIS question (company-level decisions never match). */
export function questionAnswerOf(records: readonly OwnerKnowledgeRecord[], q: EntityQuestion): OwnerKnowledgeRecord | null {
  const topic = answerTopicOf(q.kind);
  const v = (k: OwnerKnowledgeRecord) => k.value as Record<string, unknown>;
  return records.filter((k) => k.kind === "BUSINESS_DECISION" && topicSlug(String(v(k).topic ?? "")) === topic && (v(k).about === q.entity || v(k).ref === q.entity))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
export type ResolvedQuestion<Q> = Q & { state: QuestionContractState; answerAs: ReturnType<typeof answerAsOf>; identity: string };
export type ResolvedKnown = KnownContextItem & { contractState: QuestionContractState; identity: string };
/**
 * THE resolver. Input: the questions a view generated (each with its exact entity) + ACTIVE knowledge + the canonical
 * evidence day per question (a real event on that entity; null when the view has none). Output: what to ASK (incl.
 * REOPENED with the earlier answer) and the known lines (KNOWN / RECONCILE / "זה עדיין נכון?"). One identity per
 * (identity kind, entity): the same question from two subsystems is ONE question; the same text on two entities is two.
 */
export function resolveQuestions<Q extends EntityQuestion>(questions: readonly Q[], records: readonly OwnerKnowledgeRecord[], todayIL: string, evidenceOf: (q: Q) => string | null = () => null): { asked: Array<ResolvedQuestion<Q>>; known: ResolvedKnown[] } {
  const asked: Array<ResolvedQuestion<Q>> = [];
  const known: ResolvedKnown[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    const identity = `${QUESTION_HOMES[q.kind]?.identity ?? q.kind}|${q.entity}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const h = QUESTION_HOMES[q.kind];
    const k = h && h.home !== "CANONICAL" ? questionAnswerOf(records, q) : null;
    if (!k || !h) { asked.push({ ...q, state: "ASK", answerAs: answerAsOf(q), identity }); continue; }
    const said = String((k.value as Record<string, unknown>).decisionHe ?? k.meaningHe);
    const fr = freshnessOf(k, todayIL, evidenceOf(q));
    if (fr === "SUPERSEDED_BY_EVIDENCE") {
      asked.push({ ...q, questionHe: `${q.questionHe} (קודם אמרת לי ב-${ddmm(knownAtOf(k))}: ${clip(said, 120)} — מאז נרשם אירוע חדש)`, state: "REOPENED_BECAUSE_EVIDENCE_CHANGED", answerAs: answerAsOf(q), identity });
      continue;
    }
    const actions = fr === "REVIEW_DUE" ? [] : h.reconcile?.(q.entity) ?? [];
    const item = knownItem({ questionKind: q.kind, entityKey: q.entity, label: null, meaningHe: said, knownAt: knownAtOf(k), basis: { kind: "OWNER_KNOWLEDGE", knowledgeId: k.id, knowledgeKind: k.kind }, freshness: fr,
      canonicalHe: actions.length ? "הרשומה עדיין לא משקפת את זה" : "אין שדה ברשומה שמחזיק את זה — נשמר כהקשר, לא כמצב", actions, epistemic: "OWNER_DECISION" });
    known.push({ ...item, contractState: actions.length ? "RECONCILE" : "KNOWN", identity });
  }
  return { asked, known };
}
