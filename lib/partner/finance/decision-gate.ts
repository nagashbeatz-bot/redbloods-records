/**
 * Redbloods Partner — the Owner Decision Gate for finance questions (Owner-approved 2026-10-05). Pure, no I/O, no clock.
 *
 * Before a finance issue reaches the Owner as a question, the gate asks: has the Owner ALREADY told Sunny about it?
 *   ASK                        — nothing is known → the ordinary question.
 *   KNOWN_MATCHES              — the Owner answered and the records need nothing more → silent (or the answered line).
 *   KNOWN_DECISION_RECONCILE   — the Owner answered (Owner Context) and the answer implies a canonical change the records do
 *                                not show yet → "לפי מה שאמרת … — המערכת עדיין לא משקפת. לסנכרן?" + the typed canonical action.
 *   KNOWN_CONTEXT_RECONCILE    — no answer, but ACTIVE Owner knowledge (P2) is linked to the SAME entity → the question is not
 *                                asked again as if nothing was said; it is shown as a reconciliation with that knowledge.
 * (A canonically resolved issue never reaches the gate: the detector no longer raises it — e.g. a finance exception.)
 *
 * Rules:
 *  - The gate never changes money, a record or a detector. P2 knowledge is CONTEXT only: it changes how Sunny presents an issue
 *    (reconcile instead of ask), never what the money is, and it is never a reason for silence.
 *  - Matching is by canonical entity key only (subject / identity keys / a typed entity field such as BUSINESS_DECISION.about) —
 *    never by a name inside free text. Company-level knowledge never matches an entity's issue.
 *  - Nothing reconciles itself: an action here is a PROPOSAL (actionId + typed args + what is still missing). It runs only
 *    through plan → the Owner's approval → execute → verify by a fresh read.
 */
import { COMPANY_KEY } from "../owner-knowledge/kinds";
import { activeKnowledge, type OwnerKnowledgeRecord } from "../owner-knowledge/store";
import { matchReportedPayment, REALIZED_STATUS_FOR, type PaymentMatch } from "./payment-match";
import type { FinanceTxRow } from "./types";

export type DecisionGateState = "ASK" | "KNOWN_MATCHES" | "KNOWN_DECISION_RECONCILE" | "KNOWN_CONTEXT_RECONCILE";
export type ReconcileState = "KNOWN_DECISION_RECONCILE" | "KNOWN_CONTEXT_RECONCILE";

/** The canonical actions a known decision can be synchronized with — existing Act primitives only. */
export type ReconcileActionId = "SET_FINANCE_EXCEPTION" | "SET_AGREED_PRICE" | "SET_TRANSACTION_STATUS" | "ADD_TRANSACTION" | "SET_PROPOSAL_FOLLOWUP" | "UPDATE_PROJECT_DEADLINE" | "CLOSE_SHOW" | "UPDATE_PRODUCTION_DETAILS";
export interface ReconcileAction {
  actionId: ReconcileActionId;
  /** Typed arguments already known from the records / the answer (entity keys, booleans, dates, reasons). */
  args: Record<string, string | number | boolean>;
  /** Arguments only the Owner can give (e.g. the agreed price) — the plan is built only after he gives them. */
  missing: string[];
  /** false = an option the Owner may add to the same plan (never alone, never first — see orderHe). */
  required: boolean;
  noteHe: string;
}

export type ReconcileBasis =
  | { kind: "OWNER_ANSWER"; contextId: string; answerCode: string }
  | { kind: "OWNER_KNOWLEDGE"; knowledgeId: string; knowledgeKind: string };

export interface ReconcileItem {
  state: ReconcileState;
  issueType: string;
  subject: { type: string; id: string; labelHe: string | null };
  /** The canonical entity the decision is about (project:<id> …), or null when the issue has none. */
  entityKey: string | null;
  /** What the Owner already said — always attributed, never presented as a record. */
  knownHe: string;
  /** YYYY-MM-DD the Owner said it (answer / knowledge date), or null. */
  knownAt: string | null;
  basis: ReconcileBasis;
  /** What the records still show. */
  canonicalHe: string;
  /** The typed canonical actions that would make the records reflect the decision (proposals — nothing runs by itself). */
  actions: ReconcileAction[];
  /** Execution-order note when there is more than one action. */
  orderHe: string | null;
  /** The one Owner-facing line ("כבר אמרת לי … — המערכת עדיין לא משקפת … לסנכרן?"). */
  textHe: string;
}

/** Owner knowledge the gate may use as CONTEXT: active, linked to a canonical entity, about money. */
export interface FinanceKnowledgeContext {
  id: string;
  kind: string;
  /** Canonical entity keys this knowledge is about (never the company key). */
  entityKeys: string[];
  meaningHe: string;
  /** YYYY-MM-DD (decidedOn / observedAt when given, else the day it was learned). */
  knownAt: string;
  /** PAYMENT_REPORTED_BY_OWNER only: what was reported (typed fields — never parsed from text). */
  payment?: { direction: "RECEIVED" | "PAID"; amount: number; currency: string; date: string | null };
}

/** Kinds that speak about an entity's money (the only ones the finance gate considers). */
const MONEY_CONTEXT_KINDS = new Set(["BUSINESS_DECISION", "PAYMENT_REPORTED_BY_OWNER"]);
/**
 * Which issues each kind actually speaks to (never wider): a FINANCE decision about a record → its missing income / price /
 * collection; a payment the Owner says he RECEIVED → its missing income / collection (never its agreed price).
 */
const KIND_ISSUES: Readonly<Record<string, ReadonlySet<string>>> = {
  BUSINESS_DECISION: new Set(["COMPLETED_WORK_NO_INCOME", "PRICE_MISSING", "OVERDUE_RECEIVABLE_REASON_UNKNOWN", "RECEIVABLE_DUE_DATE_MISSING"]),
  PAYMENT_REPORTED_BY_OWNER: new Set(["COMPLETED_WORK_NO_INCOME", "OVERDUE_RECEIVABLE_REASON_UNKNOWN", "RECEIVABLE_DUE_DATE_MISSING"]),
};
const ENTITY_KEY_RE = /^(project|client|show|release|label-artist|dj):[0-9a-f-]{36}$/;
const ymd = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const ddmmyyyy = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : null);
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * The money-related ACTIVE Owner knowledge, reduced to what the gate needs. Only canonical entity keys are kept: the subject
 * and identity keys (never the company), plus typed entity fields of the value (e.g. BUSINESS_DECISION.about). A decision
 * stored on the company with the project only named in its text links to NOTHING here (TEXT is never identity).
 */
export function financeKnowledgeContextOf(records: readonly OwnerKnowledgeRecord[], todayIL: string): FinanceKnowledgeContext[] {
  return activeKnowledge(records, todayIL)
    .filter((r) => MONEY_CONTEXT_KINDS.has(r.kind) && (r.kind !== "BUSINESS_DECISION" || r.value.area === "FINANCE") && (r.kind !== "PAYMENT_REPORTED_BY_OWNER" || r.value.direction === "RECEIVED"))
    .map((r) => {
      const keys = new Set<string>();
      for (const k of [r.subjectKey, ...r.identityKeys]) if (k !== COMPANY_KEY && ENTITY_KEY_RE.test(k)) keys.add(k);
      for (const v of Object.values(r.value)) if (typeof v === "string" && ENTITY_KEY_RE.test(v)) keys.add(v);
      const knownAt = ymd(r.value.decidedOn) ?? ymd(r.value.observedAt) ?? ymd(r.createdAt) ?? todayIL;
      const payment = r.kind === "PAYMENT_REPORTED_BY_OWNER" && (r.value.direction === "RECEIVED" || r.value.direction === "PAID") && Number.isFinite(Number(r.value.amount)) && typeof r.value.currency === "string"
        ? { direction: r.value.direction as "RECEIVED" | "PAID", amount: Number(r.value.amount), currency: r.value.currency, date: ymd(r.value.date) }
        : undefined;
      return { id: r.id, kind: r.kind, entityKeys: [...keys].sort(), meaningHe: r.meaningHe, knownAt, ...(payment ? { payment } : {}) };
    })
    .filter((k) => k.entityKeys.length > 0);
}

/** The canonical entity of a finance issue (exact ids only). */
export function issueEntityKey(i: { subjectType: string; subjectId: string; evidence: ReadonlyArray<{ projectId?: string | null }> }): string | null {
  if (i.subjectType === "project") return `project:${i.subjectId}`;
  if (i.subjectType === "show") return `show:${i.subjectId}`;
  if (i.subjectType === "receivable") {
    if (i.subjectId.startsWith("PROJECT_BALANCE:")) return `project:${i.subjectId.slice("PROJECT_BALANCE:".length)}`;
    const p = i.evidence.find((e) => e.projectId)?.projectId;
    return p ? `project:${p}` : null;
  }
  return null;
}

interface GateIssue {
  issueType: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string | null;
  amount: number | null;
  currency: string | null;
  evidence: ReadonlyArray<{ projectId?: string | null }>;
}

const exceptionAction = (projectKey: string, reason: string, date: string | null): ReconcileAction => ({
  actionId: "SET_FINANCE_EXCEPTION", args: { project: projectKey, on: true, reason, ...(date ? { date } : {}) }, missing: date ? [] : ["date"], required: true,
  noteHe: "חריגה כספית: מוציאה את הפרויקט מבדיקות החוב / ההכנסה החסרה בכל המערכת (אותו כלל שהאפליקציה משתמשת בו). שום רשומה כספית לא נמחקת ולא נוצרת.",
});
const optionalPriceAction = (projectKey: string): ReconcileAction => ({
  actionId: "SET_AGREED_PRICE", args: { project: projectKey }, missing: ["agreedPrice", "currency"], required: false,
  noteHe: "אופציונלי — לרשום גם את המחיר שהיה. רק באותה תוכנית ואחרי החריגה: מחיר בלי חריגה יוצר חוב פתוח.",
});
const EXCEPTION_FIRST_HE = "קודם החריגה ורק אחריה המחיר (אם נבחר) — כך אין רגע שבו קיים מחיר בלי חריגה.";

/**
 * KNOWN_DECISION_RECONCILE: the canonical action an ANSWER implies, when the records do not show it yet. null = the answer
 * needs nothing canonical (KNOWN_MATCHES). Only codes whose action is fully determined by the records are mapped here.
 */
export function reconcileForAnswer(i: GateIssue, answer: { contextId: string; answerCode: string; labelHe: string; answeredAt: string }): ReconcileItem | null {
  const entityKey = issueEntityKey(i);
  const day = ymd(answer.answeredAt);
  const label = i.subjectLabel ? `'${i.subjectLabel}'` : "";
  const base = (canonicalHe: string, actions: ReconcileAction[], orderHe: string | null): ReconcileItem => {
    const knownHe = `לפי מה שאמרת${day ? ` (${ddmmyyyy(day)})` : ""}: ${answer.labelHe}.`;
    return {
      state: "KNOWN_DECISION_RECONCILE", issueType: i.issueType, subject: { type: i.subjectType, id: i.subjectId, labelHe: i.subjectLabel }, entityKey,
      knownHe, knownAt: day, basis: { kind: "OWNER_ANSWER", contextId: answer.contextId, answerCode: answer.answerCode }, canonicalHe, actions, orderHe,
      textHe: clip(`${label ? `פרויקט ${label}: ` : ""}${knownHe} המערכת עדיין לא משקפת את זה (${canonicalHe}). אפשר לסנכרן — לאשר?`, 400),
    };
  };
  const projectKey = entityKey && entityKey.startsWith("project:") ? entityKey : null;
  if (i.issueType === "COMPLETED_WORK_NO_INCOME" && projectKey) {
    if (answer.answerCode === "WRITTEN_OFF") return base("הפרויקט עדיין נראה כעבודה שהושלמה בלי הכנסה", [exceptionAction(projectKey, "היה מחיר, הכסף לא נגבה — הבוס ויתר עליו", day), optionalPriceAction(projectKey)], EXCEPTION_FIRST_HE);
    if (answer.answerCode === "NON_PAID_PROJECT") return base("הפרויקט עדיין נראה כעבודה שהושלמה בלי הכנסה", [exceptionAction(projectKey, "הפרויקט לא היה בתשלום", day)], null);
  }
  if (i.issueType === "PRICE_MISSING" && projectKey) {
    if (answer.answerCode === "NO_CHARGE") return base("לפרויקט עדיין אין מחיר ואין חריגה", [exceptionAction(projectKey, "הפרויקט לא בתשלום", day)], null);
    if (answer.answerCode === "SET_PRICE") return base("המחיר עדיין לא רשום", [{ actionId: "SET_AGREED_PRICE", args: { project: projectKey }, missing: ["agreedPrice", "currency"], required: true, noteHe: "המחיר נרשם רק בפעולה הקנונית — צריך ממך את הסכום והמטבע." }], null);
  }
  if (i.issueType === "RECEIVABLE_OWNER_CLOSED") {
    if (i.subjectId.startsWith("PROJECT_BALANCE:") && projectKey) return base("היתרה עדיין מחושבת כחוב פתוח", [exceptionAction(projectKey, answer.answerCode === "BALANCE_WAIVED" ? "העבודה בוצעה — הבוס ויתר על היתרה" : "הפרויקט בוטל — אין יתרה נוספת לגבייה", day)], null);
    if (i.subjectId.startsWith("EXPECTED_TX:")) {
      const tx = i.subjectId.slice("EXPECTED_TX:".length);
      return base("שורת ההכנסה הצפויה עדיין פתוחה בכספים", [{ actionId: "SET_TRANSACTION_STATUS", args: { transaction: `transaction:${tx}`, paymentStatus: "בוטל" }, missing: [], required: true, noteHe: "השורה נשארת בכספים (מסומנת בוטל) — לא נמחקת." }], null);
    }
  }
  return null;
}

/**
 * A reported payment → the ONE canonical path (Owner decision D4, 2026-10-05), from the shared matcher (payment-match.ts):
 *   RECORDED        → nothing (the money is already in Finance; the report does not explain a remaining issue).
 *   EXPECTED_UNIQUE → SET_TRANSACTION_STATUS on THAT row (income → התקבל, expense → שולם) — never a second row.
 *   NONE            → ADD_TRANSACTION (prefilled from the report; the plan still runs dupGate → preview → approval → read-back).
 *   AMBIGUOUS       → no action: the Owner says which row / amount (never guessed).
 *   UNKNOWN         → no action (Finance unread / not a project).
 * Direction is never flipped (RECEIVED → income only, PAID → expense only).
 */
export function paymentPathOf(entityKey: string, payment: NonNullable<FinanceKnowledgeContext["payment"]>, transactions: readonly FinanceTxRow[] | null): { match: PaymentMatch; canonicalHe: string; actions: ReconcileAction[] } {
  const match = matchReportedPayment({ subjectKey: entityKey, direction: payment.direction, amount: payment.amount, currency: payment.currency }, transactions);
  const money = `${payment.currency}${payment.amount.toLocaleString("en-US")}`;
  const word = payment.direction === "RECEIVED" ? "התקבל" : "שולם";
  if (match.kind === "RECORDED") return { match, canonicalHe: `התשלום (${money}) כבר רשום בכספים כ${word}`, actions: [] };
  if (match.kind === "EXPECTED_UNIQUE") return { match, canonicalHe: `בכספים יש שורה צפויה אחת של ${money} שעדיין לא מסומנת ${word}`, actions: [{ actionId: "SET_TRANSACTION_STATUS", args: { transaction: `transaction:${match.txId}`, paymentStatus: match.toStatus }, missing: [], required: true, noteHe: `מסמן את השורה הקיימת כ${match.toStatus} — לא נוצרת שורה נוספת.` }] };
  if (match.kind === "NONE") {
    const type = payment.direction === "RECEIVED" ? "income" : "expense";
    return { match, canonicalHe: `התשלום שדיווחת עליו (${money}) עדיין לא רשום בכספים`, actions: [{ actionId: "ADD_TRANSACTION", args: { project: entityKey, type, amount: payment.amount, currency: payment.currency, paymentStatus: REALIZED_STATUS_FOR[payment.direction], ...(payment.date ? { date: payment.date } : {}) }, missing: payment.date ? [] : ["date"], required: true, noteHe: "רישום חדש בכספים — עובר בדיקת כפילות, תצוגה ואישור שלך לפני שנכתב." }] };
  }
  if (match.kind === "AMBIGUOUS") {
    const why = match.reason === "MULTIPLE_CANDIDATES" ? `יש בכספים ${match.txIds.length} שורות צפויות של ${money} — איזו מהן?`
      : match.reason === "AMOUNT_DIFFERS" ? `בכספים יש שורה פתוחה בסכום אחר — זה תשלום חלקי, תיקון סכום או שורה אחרת?`
      : match.reason === "CURRENCY_DIFFERS" ? `בכספים יש שורה פתוחה במטבע אחר — באיזה מטבע זה התקבל?`
      : `השורה התואמת מסומנת חלקי — כמה בדיוק עבר?`;
    return { match, canonicalHe: `לא סימנתי ולא אנחש: ${why}`, actions: [] };
  }
  return { match, canonicalHe: "לא הצלחתי לבדוק מול הכספים — לא אומר שזה רשום ולא שזה חסר", actions: [] };
}

/**
 * KNOWN_CONTEXT_RECONCILE: no answer, but ACTIVE money knowledge is linked to the same entity. The newest one is quoted; the
 * canonical action is suggested only where it is the existing finance rule for this issue (the Owner confirms it in the plan).
 * A reported payment that Finance ALREADY shows does not explain the issue (the issue is about something else, e.g. the
 * remaining balance) → it is skipped, and the issue is asked normally.
 */
export function reconcileForKnowledge(i: GateIssue, knowledge: readonly FinanceKnowledgeContext[], transactions: readonly FinanceTxRow[] | null = null): ReconcileItem | null {
  const entityKey = issueEntityKey(i);
  if (!entityKey) return null;
  const explains = (x: FinanceKnowledgeContext) => !(x.payment && entityKey.startsWith("project:") && matchReportedPayment({ subjectKey: entityKey, direction: x.payment.direction, amount: x.payment.amount, currency: x.payment.currency }, transactions).kind === "RECORDED");
  const k = knowledge.filter((x) => x.entityKeys.includes(entityKey) && !!KIND_ISSUES[x.kind]?.has(i.issueType) && explains(x)).sort((a, b) => b.knownAt.localeCompare(a.knownAt) || a.id.localeCompare(b.id))[0];
  if (!k) return null;
  const projectKey = entityKey.startsWith("project:") ? entityKey : null;
  const knownHe = `כבר אמרת לי (${ddmmyyyy(k.knownAt)}): ${clip(k.meaningHe, 220)}`;
  let canonicalHe = "המערכת עדיין לא משקפת את זה";
  let actions: ReconcileAction[] = [];
  let orderHe: string | null = null;
  if (projectKey && (i.issueType === "COMPLETED_WORK_NO_INCOME" || i.issueType === "PRICE_MISSING") && k.kind === "BUSINESS_DECISION") {
    canonicalHe = i.issueType === "COMPLETED_WORK_NO_INCOME" ? "הפרויקט עדיין נראה כעבודה שהושלמה בלי הכנסה" : "לפרויקט עדיין אין מחיר ואין חריגה";
    actions = [{ ...exceptionAction(projectKey, "", k.knownAt), args: { project: projectKey, on: true, date: k.knownAt }, missing: ["reason"] }, optionalPriceAction(projectKey)];
    orderHe = EXCEPTION_FIRST_HE;
  } else if (k.kind === "PAYMENT_REPORTED_BY_OWNER") {
    if (projectKey && k.payment) { const p = paymentPathOf(projectKey, k.payment, transactions); canonicalHe = p.canonicalHe; actions = p.actions; }
    else canonicalHe = "התשלום שדיווחת עליו עדיין לא רשום בכספים";
  }
  return {
    state: "KNOWN_CONTEXT_RECONCILE", issueType: i.issueType, subject: { type: i.subjectType, id: i.subjectId, labelHe: i.subjectLabel }, entityKey,
    knownHe, knownAt: k.knownAt, basis: { kind: "OWNER_KNOWLEDGE", knowledgeId: k.id, knowledgeKind: k.kind }, canonicalHe, actions, orderHe,
    textHe: clip(`${knownHe} — ${canonicalHe}. לסנכרן?`, 400),
  };
}
