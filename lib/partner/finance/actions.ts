/**
 * Redbloods Partner — Finance Action capability registry + readiness model (F2.11–F2.15). Pure, read-only.
 *
 * DETECT → UNDERSTAND → ASK ONLY IF NEEDED → REMEMBER → DETERMINE THE EXACT ACTION → (propose / approve / execute)
 *
 * This module decides, for every finance gap, WHICH narrow business action would repair it and WHETHER all of
 * its mutation-relevant facts are known (readiness). It never writes anything and never creates an Action Event.
 *
 * EXECUTION IS BLOCKED for every Finance Action type (capability audit, 2026-09-24): production
 * partner_action_events only admits action_type = 'UPDATE_PROJECT_DEADLINE' and subject_type = 'project'
 * (DB CHECK constraints), the only atomic single-execution primitive is the project-deadline DB execution
 * function, and `transactions` has no idempotency key. Recording a finance
 * approval or executing a finance write therefore requires a DB schema change — which this phase may not make.
 * A READY action is shown as "ready, but no safe action exists yet" (fail closed), never executed.
 *
 * Permission model: every finance write would require explicit Owner approval (ALWAYS_ASK). The other modes are
 * typed for future compatibility only and have no behaviour.
 */
import { canonicalStableStringify, sha256Hex } from "../actions/canonical";
import { deriveQuestionId } from "../investigation/context-row";
import { FINANCE_ANSWER_OPTIONS } from "../investigation/finance-questions";
import { financeQuestionFingerprint, type FinanceOwnerAnswer } from "./owner-answers";
import type { OwnerQuestion, PartnerFinanceIntegrityState, RehabIssue } from "./integrity";
import type { FinanceRaw, PartnerFinanceState } from "./types";

export const FINANCE_ACTION_SCHEMA_VERSION = "partner-finance-action-v1";
export type FinanceActionType = "RECORD_PAID_EXPENSE" | "RECORD_RECEIVED_INCOME" | "SET_PROJECT_AGREED_PRICE" | "SET_RECEIVABLE_DUE_DATE";
export type FinancePermissionMode = "ALWAYS_ASK" | "PREAPPROVED_LOW_RISK" | "AUTONOMOUS";
/** The only mode with behaviour. */
export const FINANCE_PERMISSION_MODE: FinancePermissionMode = "ALWAYS_ASK";

export type ExecutorStatus = "EXECUTOR_BLOCKED_REQUIRES_SCHEMA_CHANGE" | "UNSUPPORTED_NO_CANONICAL_MODEL";

export interface FinanceActionCapability {
  actionType: FinanceActionType;
  /** false for every type in this phase — see the module note. */
  executable: false;
  executorStatus: ExecutorStatus;
  blockers: string[];
  /** Where the mutation-relevant facts come from, and which canonical path would write them (system contract). */
  canonical: { sourceFacts: string[]; writePrimitive: string | null; consumers: string[] };
}

const CONSUMERS = ["Finance page (lib/finance/stats.ts)", "ProjectDrawer", "Dashboard", "Insights", "Partner Finance Brain + Integrity", "COO (lib/coo/facts.ts)", "Agent finance rules (lib/agent/*, lib/reports/*)"];
const SCHEMA_BLOCKERS = [
  "partner_action_events CHECK action_type = 'UPDATE_PROJECT_DEADLINE' (no finance action type can be approved)",
  "partner_action_events CHECK subject_type = 'project'",
  "no atomic single-execution DB primitive for finance writes (only the project-deadline execution function exists)",
  "transactions has no idempotency / request key — duplicate protection would be read-then-insert only",
];

/** Narrow capabilities only — there is no generic EDIT_FINANCE / WRITE_TRANSACTION. */
export const FINANCE_ACTION_REGISTRY: Readonly<Record<FinanceActionType, FinanceActionCapability>> = {
  RECORD_PAID_EXPENSE: {
    actionType: "RECORD_PAID_EXPENSE", executable: false, executorStatus: "EXECUTOR_BLOCKED_REQUIRES_SCHEMA_CHANGE", blockers: SCHEMA_BLOCKERS,
    canonical: {
      sourceFacts: ["Victor salary config: settings.vendor_victor_settings + vendor_victor_salary_overrides (lib/vendor-store.ts getVictorSalaryMonths)", "existing record: transactions.linked_session_id = victor_salary_YYYY-MM", "Owner Context: FINANCE_RECURRING_PAYMENT_STATUS = PAID_NEEDS_RECORDING + FINANCE_PAYMENT_DATE = EXACT_DATE"],
      writePrimitive: "POST /api/vendor/victor/salary (historicPaid → expense 'שולם', scope general, category 'צוות', linked_session_id victor_salary_YYYY-MM; existence check by linked_session_id, not race-safe)",
      consumers: CONSUMERS,
    },
  },
  RECORD_RECEIVED_INCOME: {
    actionType: "RECORD_RECEIVED_INCOME", executable: false, executorStatus: "EXECUTOR_BLOCKED_REQUIRES_SCHEMA_CHANGE", blockers: SCHEMA_BLOCKERS,
    canonical: {
      sourceFacts: ["Owner Context: FINANCE_COMPLETED_PROJECT_INCOME_STATUS = INCOME_RECEIVED_NOT_RECORDED", "amount + currency + exact date: not derivable today (would need new Owner questions)"],
      writePrimitive: "POST /api/transactions (type income; received status 'התקבל' as used by project/clip/show income; no duplicate guard)",
      consumers: CONSUMERS,
    },
  },
  SET_PROJECT_AGREED_PRICE: {
    actionType: "SET_PROJECT_AGREED_PRICE", executable: false, executorStatus: "EXECUTOR_BLOCKED_REQUIRES_SCHEMA_CHANGE", blockers: SCHEMA_BLOCKERS,
    canonical: {
      sourceFacts: ["settings finance_<projectId> {agreedPrice, currency} (merge)", "Owner answer: exact amount + currency (no question exists yet)"],
      writePrimitive: "PATCH /api/transactions?projectId=&type=settings (read-merge-upsert; no compare-and-set on the previous price)",
      consumers: CONSUMERS,
    },
  },
  SET_RECEIVABLE_DUE_DATE: {
    actionType: "SET_RECEIVABLE_DUE_DATE", executable: false, executorStatus: "UNSUPPORTED_NO_CANONICAL_MODEL",
    blockers: ["a calculated project balance (price − received) has no canonical due-date field; only an expected-income transaction carries a date", "creating an expected-income transaction is a different action (not in V1)"],
    canonical: { sourceFacts: ["Owner Context: FINANCE_RECEIVABLE_TIMING = EXACT_DATE (windows never become dates)"], writePrimitive: null, consumers: CONSUMERS },
  },
};

export type FinanceActionReadiness =
  | "READY_TO_PROPOSE" | "NEEDS_OWNER_CONTEXT" | "NEEDS_EXACT_DATE" | "NEEDS_AMOUNT" | "NEEDS_CURRENCY"
  | "NEEDS_PROJECT_LINK" | "NEEDS_CLASSIFICATION" | "ALREADY_RECORDED" | "AMBIGUOUS" | "UNSUPPORTED" | "NOT_APPLICABLE";

export interface FinanceActionFacts {
  amount: number;
  currency: string;
  /** Exact payment / receipt date (never approximated). */
  date: string;
  paymentStatus: "שולם" | "התקבל";
  type: "expense" | "income";
  description: string;
  projectId: string | null;
  linkedSessionId: string | null;
}

export interface FinanceActionCandidate {
  /** Deterministic identity of the exact business action (null until every mutation-relevant fact is known). */
  id: string | null;
  actionType: FinanceActionType;
  issueId: string;
  subject: { type: string; id: string; labelHe: string | null };
  readiness: FinanceActionReadiness;
  /** What is still unknown (field names), empty when READY. */
  missing: string[];
  facts: FinanceActionFacts | null;
  /** Hash of every mutation-relevant fact + the Owner Context revisions it relies on. */
  snapshotHash: string | null;
  ownerContextIds: string[];
  /** Always false in this phase (registry). */
  executable: false;
  executorStatus: ExecutorStatus;
  /** Finance-internal priority (lower first): a ready repair outranks a vague historical question. */
  priority: number;
}

const PAYMENT_DATE_TEXT = (label: string, month: string) => `מתי שילמת את ${label} של ${month}?`;
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const monthHe = (key: string) => HE_MONTHS[Number(key.slice(5, 7)) - 1] ?? key;

/**
 * The single-fact Owner question for a confirmed-but-unrecorded payment. Built only when everything else about
 * the payment is canonically known. Its fingerprint commits to the status answer it follows (a revised status
 * answer invalidates any date given for the old one).
 */
export function paymentDateQuestion(issue: RehabIssue, statusAnswerContextId: string, workMonth: string): OwnerQuestion {
  const q: OwnerQuestion = {
    questionType: "FINANCE_PAYMENT_DATE",
    subject: { type: issue.subjectType, id: issue.subjectId, labelHe: "משכורת Victor" },
    textHe: PAYMENT_DATE_TEXT("משכורת Victor", monthHe(workMonth)),
    whyItMattersHe: "זה הפרט היחיד שחסר כדי לרשום את התשלום בכספים — בלי תאריך מדויק לא ארשום.",
    options: FINANCE_ANSWER_OPTIONS.FINANCE_PAYMENT_DATE.map((o) => ({ code: o.code, labelHe: o.labelHe })),
    evidence: [...issue.evidence, { sourceType: "salary_month", sourceId: `owner_context:${statusAnswerContextId}`, reasonCode: "OWNER_CONFIRMED_PAID" }],
    priority: 5,
    identity: null,
  };
  const caseId = `finance:${issue.issueType}:${issue.subjectType}:${issue.subjectId}`;
  q.identity = {
    questionId: deriveQuestionId(caseId, "FINANCE_PAYMENT_DATE"), caseId, issueType: issue.issueType,
    fingerprint: financeQuestionFingerprint({ questionType: "FINANCE_PAYMENT_DATE", issueType: issue.issueType, subject: q.subject, textHe: q.textHe, optionCodes: q.options.map((o) => o.code), amount: issue.amount, currency: issue.currency, date: issue.date, evidence: q.evidence }),
    exactDateCode: "EXACT_DATE", previousAnswer: null,
  };
  return q;
}

export interface FinanceActionDerivation { candidates: FinanceActionCandidate[]; questions: OwnerQuestion[] }

/**
 * Readiness for every finance gap the Owner has answered, plus the minimal questions still needed.
 * Only facts from canonical data + ACTIVE Owner Context are used; nothing is invented or defaulted.
 */
export function deriveFinanceActions(raw: FinanceRaw, state: PartnerFinanceState, integrity: PartnerFinanceIntegrityState, answers: readonly FinanceOwnerAnswer[]): FinanceActionDerivation {
  const candidates: FinanceActionCandidate[] = [];
  const questions: OwnerQuestion[] = [];
  const base = (actionType: FinanceActionType, i: RehabIssue) => ({ actionType, issueId: i.id, subject: { type: i.subjectType, id: i.subjectId, labelHe: i.subjectLabel }, executable: false as const, executorStatus: FINANCE_ACTION_REGISTRY[actionType].executorStatus });

  for (const i of integrity.issues) {
    const a = i.ownerAnswer;
    // ── RECORD_PAID_EXPENSE: a known recurring payment the Owner says was paid, with no Finance record ──
    if ((i.issueType === "EXPENSE_EXPECTED_BUT_NOT_FOUND" || i.issueType === "RECURRING_EXPENSE_MISSING_THIS_PERIOD") && i.subjectId.startsWith("VICTOR_SALARY:")) {
      if (!a) { candidates.push({ ...base("RECORD_PAID_EXPENSE", i), id: null, readiness: "NEEDS_OWNER_CONTEXT", missing: ["paymentStatus"], facts: null, snapshotHash: null, ownerContextIds: [], priority: 50 }); continue; }
      if (a.answerCode !== "PAID_NEEDS_RECORDING") { candidates.push({ ...base("RECORD_PAID_EXPENSE", i), id: null, readiness: "NOT_APPLICABLE", missing: [], facts: null, snapshotHash: null, ownerContextIds: [a.contextId], priority: 90 }); continue; }
      const workMonth = i.subjectId.slice("VICTOR_SALARY:".length);
      const known = state.recurring.known.find((k) => k.code === "VICTOR_SALARY" && k.workMonth === workMonth);
      const linkedSessionId = `victor_salary_${workMonth}`;
      const existing = raw.transactions.filter((t) => t.linkedSessionId === linkedSessionId && t.status !== "בוטל");
      const missing: string[] = [];
      if (existing.length) { candidates.push({ ...base("RECORD_PAID_EXPENSE", i), id: null, readiness: "ALREADY_RECORDED", missing: [], facts: null, snapshotHash: null, ownerContextIds: [a.contextId], priority: 80 }); continue; }
      if (!known) { candidates.push({ ...base("RECORD_PAID_EXPENSE", i), id: null, readiness: "AMBIGUOUS", missing: ["salaryConfiguration"], facts: null, snapshotHash: null, ownerContextIds: [a.contextId], priority: 60 }); continue; }
      if (!(Number.isFinite(known.amount) && known.amount > 0)) missing.push("amount");
      if (!known.currency || !known.currency.trim()) missing.push("currency");
      const dq = paymentDateQuestion(i, a.contextId, workMonth);
      const dateAnswer = answers.find((x) => x.questionId === dq.identity!.questionId && x.factsFingerprint === dq.identity!.fingerprint);
      const date = dateAnswer?.answerCode === "EXACT_DATE" ? dateAnswer.answerValueYmd : null;
      if (!date) {
        missing.push("paymentDate");
        if (!dateAnswer) questions.push(dq); // UNKNOWN is an answer: never re-asked, the action simply stays blocked
      } else if (date < `${workMonth}-01`) {
        candidates.push({ ...base("RECORD_PAID_EXPENSE", i), id: null, readiness: "AMBIGUOUS", missing: ["paymentDate"], facts: null, snapshotHash: null, ownerContextIds: [a.contextId, dateAnswer!.contextId], priority: 60 });
        continue;
      }
      const readiness: FinanceActionReadiness = missing.includes("amount") ? "NEEDS_AMOUNT" : missing.includes("currency") ? "NEEDS_CURRENCY" : missing.includes("paymentDate") ? "NEEDS_EXACT_DATE" : "READY_TO_PROPOSE";
      const ownerContextIds = [a.contextId, ...(dateAnswer ? [dateAnswer.contextId] : [])];
      if (readiness !== "READY_TO_PROPOSE") { candidates.push({ ...base("RECORD_PAID_EXPENSE", i), id: null, readiness, missing, facts: null, snapshotHash: null, ownerContextIds, priority: 10 }); continue; }
      const facts: FinanceActionFacts = { amount: known.amount, currency: known.currency, date: date!, paymentStatus: "שולם", type: "expense", description: `משכורת Victor ${workMonth}`, projectId: null, linkedSessionId };
      const snapshot = { schemaVersion: "partner-finance-action-v1", actionType: "RECORD_PAID_EXPENSE", source: i.subjectId, period: workMonth, facts, existingTransactions: [], ownerContextIds, salaryConfig: { amount: known.amount, currency: known.currency, dueDate: known.dueDate } };
      candidates.push({
        ...base("RECORD_PAID_EXPENSE", i), readiness, missing: [], facts, ownerContextIds, priority: 1,
        id: `RECORD_PAID_EXPENSE:${i.subjectId}:${workMonth}:${ownerContextIds.join("+")}:${known.amount}:${known.currency}:${date}`,
        snapshotHash: sha256Hex(canonicalStableStringify(snapshot)),
      });
      continue;
    }
    // ── RECORD_RECEIVED_INCOME: the Owner says income was received but it is not in Finance ──
    if (i.issueType === "COMPLETED_WORK_NO_INCOME" && a) {
      if (a.answerCode !== "INCOME_RECEIVED_NOT_RECORDED") continue; // INCOME_NOT_RECEIVED never becomes income
      // Amount and exact date of the payment are not canonical anywhere (price unknown / partial payments) → never guessed.
      candidates.push({ ...base("RECORD_RECEIVED_INCOME", i), id: null, readiness: "NEEDS_AMOUNT", missing: ["amount", "currency", "receivedDate"], facts: null, snapshotHash: null, ownerContextIds: [a.contextId], priority: 30 });
      continue;
    }
    // ── SET_RECEIVABLE_DUE_DATE: only an EXACT date could ever become a due date — and no canonical field exists ──
    if (i.issueType === "RECEIVABLE_DUE_DATE_MISSING" && a?.answerCode === "EXACT_DATE") {
      candidates.push({ ...base("SET_RECEIVABLE_DUE_DATE", i), id: null, readiness: "UNSUPPORTED", missing: [], facts: null, snapshotHash: null, ownerContextIds: [a.contextId], priority: 70 });
    }
  }
  return { candidates: candidates.sort((x, y) => x.priority - y.priority || (x.issueId < y.issueId ? -1 : 1)), questions };
}

/** Owner-facing line for the most important candidate (business language only; null = nothing to say). */
export function financeActionNoteHe(c: FinanceActionCandidate | undefined): string | null {
  if (!c) return null;
  if (c.readiness === "READY_TO_PROPOSE" && c.facts) {
    const d = c.facts.date;
    const money = `${c.facts.currency}${c.facts.amount.toLocaleString("en-US")}`;
    return `אני יודע בדיוק מה לרשום (${c.subject.labelHe ?? "התשלום"}: ${money}, שולם, ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}) — אבל עדיין אין לי פעולה בטוחה לבצע את זה.`;
  }
  if (c.readiness === "NEEDS_AMOUNT" && c.actionType === "RECORD_RECEIVED_INCOME") return "אני יודע מה חסר, אבל עדיין אין לי פעולה בטוחה לבצע את זה.";
  if (c.readiness === "UNSUPPORTED") return "אני יודע מה חסר, אבל עדיין אין לי פעולה בטוחה לבצע את זה.";
  return null;
}
