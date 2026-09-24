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
import { salaryLinkedId, salaryTransactionDescription } from "../../victor-salary-format";
import type { OwnerQuestion, PartnerFinanceIntegrityState, RehabIssue } from "./integrity";
import type { FinanceRaw, PartnerFinanceState, VictorSalaryConfigRaw } from "./types";
import { hashActionSnapshot } from "../actions/snapshot";
import { financeActionId, financeSubjectUuid, validateFinanceSnapshot, type FinanceActionSnapshotV1 } from "../actions/finance-events";

export const FINANCE_ACTION_SCHEMA_VERSION = "partner-finance-action-v1";
export type FinanceActionType = "RECORD_PAID_EXPENSE" | "RECORD_RECEIVED_INCOME" | "SET_PROJECT_AGREED_PRICE" | "SET_RECEIVABLE_DUE_DATE";
export type FinancePermissionMode = "ALWAYS_ASK" | "PREAPPROVED_LOW_RISK" | "AUTONOMOUS";
/** The only mode with behaviour. */
export const FINANCE_PERMISSION_MODE: FinancePermissionMode = "ALWAYS_ASK";

export type ExecutorStatus = "EXECUTOR_READY" | "EXECUTOR_BLOCKED_REQUIRES_SCHEMA_CHANGE" | "UNSUPPORTED_NO_CANONICAL_MODEL";

export interface FinanceActionCapability {
  actionType: FinanceActionType;
  /** F2.31: true ONLY for RECORD_PAID_EXPENSE (Victor salary) — its narrow DB executor is live (F2.30). */
  executable: boolean;
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
    actionType: "RECORD_PAID_EXPENSE", executable: true, executorStatus: "EXECUTOR_READY", blockers: [],
    canonical: {
      sourceFacts: ["Victor salary config: settings.vendor_victor_settings + vendor_victor_salary_overrides + vendor_victor_salary_status_overrides (raw, no code defaults)", "existing record: transactions.linked_session_id = victor_salary_YYYY-MM (DB-unique)", "Owner Context: FINANCE_RECURRING_PAYMENT_STATUS = PAID_NEEDS_RECORDING + FINANCE_PAYMENT_DATE = EXACT_DATE"],
      writePrimitive: "DB RPC partner_execute_record_paid_expense (F2.30, Owner-approved; Victor salary ONLY; atomic insert + EXECUTED event, or STALE_AT_EXECUTION)",
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
  | "NEEDS_PROJECT_LINK" | "NEEDS_CLASSIFICATION" | "ALREADY_RECORDED" | "AMBIGUOUS" | "UNSUPPORTED" | "NOT_APPLICABLE"
  // F2.31 — the execution RPC's deterministic refusals, mirrored so nothing it would reject is ever offered
  | "CANCELLED_RECORD_EXISTS" | "EXISTING_RECORD_NOT_PAID" | "AMBIGUOUS_EXISTING_RECORD" | "CONFIG_MISSING" | "CONFIG_INVALID"
  | "STATUS_CONTRADICTS" | "PAYMENT_DATE_OUT_OF_RANGE";

export interface FinanceActionFacts {
  amount: number;
  currency: string;
  /** Exact payment / receipt date (never approximated). */
  date: string;
  paymentStatus: "שולם" | "התקבל";
  type: "expense" | "income";
  /** Exactly the canonical writer's text (lib/victor-salary-format) — a future executor writes this verbatim. */
  description: string;
  category: string;
  scope: "general" | "project";
  artist: string;
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
  /**
   * F2.31: true ONLY when readiness is READY_TO_PROPOSE, the registry executor is live and every fact the RPC
   * re-checks was verified against the RAW stored config (not code defaults). Anything else → false.
   */
  executable: boolean;
  /** F2.31: the exact finance-action-v1 APPROVED snapshot (only on an executable candidate). */
  eventSnapshot?: FinanceActionSnapshotV1 | null;
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

const FINANCE_CURRENCY_SET = new Set(["$", "₪", "€", "£"]);
const isObjRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * F2.31 — the Victor salary config exactly as the execution RPC reads it (settings rows, no code defaults):
 * amount = per-period override ?? monthlySalary (numbers only); currency = salaryCurrency (non-blank, allowed);
 * the salary page's own status for the period may be absent but must never contradict "paid".
 * undefined = the raw config was not read (fixtures / older callers) → UNVERIFIED → never executable.
 */
export function strictVictorSalaryConfig(cfg: VictorSalaryConfigRaw | null | undefined, period: string):
  | { status: "UNVERIFIED" } | { status: "OK"; amount: number; currency: string } | { status: "CONFIG_MISSING" | "CONFIG_INVALID" | "STATUS_CONTRADICTS" } {
  if (cfg === undefined) return { status: "UNVERIFIED" };
  if (cfg === null || !isObjRec(cfg.settings)) return { status: "CONFIG_MISSING" };
  const cur = cfg.settings.salaryCurrency;
  if (typeof cur !== "string" || cur.trim() === "") return { status: "CONFIG_MISSING" };
  let amount: number;
  if (isObjRec(cfg.overrides) && period in cfg.overrides) {
    const o = cfg.overrides[period];
    if (typeof o !== "number") return { status: "CONFIG_INVALID" };
    amount = o;
  } else if (typeof cfg.settings.monthlySalary === "number") amount = cfg.settings.monthlySalary;
  else return { status: "CONFIG_MISSING" };
  if (!FINANCE_CURRENCY_SET.has(cur) || !(amount > 0) || !/^\d{1,9}(\.\d{1,2})?$/.test(String(amount))) return { status: "CONFIG_INVALID" };
  if (isObjRec(cfg.statusOverrides) && period in cfg.statusOverrides && cfg.statusOverrides[period] !== "שולם") return { status: "STATUS_CONTRADICTS" };
  return { status: "OK", amount, currency: cur };
}

/** F2.31 — the exact RECORD_PAID_EXPENSE V1 APPROVED snapshot (the contract the F2.24 RPC was proven against). */
export function buildRecordPaidExpenseSnapshot(p: { subjectKey: string; period: string; facts: FinanceActionFacts; status: { id: string; fingerprint: string }; date: { id: string; fingerprint: string } }): FinanceActionSnapshotV1 {
  const f = p.facts;
  return {
    id: financeActionId(p.subjectKey, p.period, p.status.id, p.date.id, f.amount, f.currency, f.date),
    schemaVersion: "partner-finance-action-v1", actionType: "RECORD_PAID_EXPENSE",
    subjectType: "recurring", subjectKey: p.subjectKey, subjectId: financeSubjectUuid(p.subjectKey),
    status: "PROPOSED", requiresOwnerApproval: true, riskLevel: "MEDIUM",
    source: "VICTOR_SALARY", period: p.period,
    facts: { amount: f.amount, currency: f.currency, date: f.date, paymentStatus: "שולם", type: "expense", description: f.description, category: "צוות", scope: "general", expenseScope: "כללי", artist: "Victor", projectId: null, linkedSessionId: f.linkedSessionId as string, notes: "" },
    sourceContextIds: [p.status.id, p.date.id],
    ownerContext: {
      status: { id: p.status.id, questionType: "FINANCE_RECURRING_PAYMENT_STATUS", answerCode: "PAID_NEEDS_RECORDING", fingerprint: p.status.fingerprint },
      date: { id: p.date.id, questionType: "FINANCE_PAYMENT_DATE", answerCode: "EXACT_DATE", ymd: f.date, fingerprint: p.date.fingerprint },
    },
    salaryConfig: { amount: f.amount, currency: f.currency, basis: "OVERRIDE_OR_MONTHLY" },
    duplicateState: { businessKey: f.linkedSessionId as string, existingTransactionIds: [] },
  } as FinanceActionSnapshotV1;
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
      const linkedSessionId = salaryLinkedId(workMonth);
      // F2.31: every existing record for the business key is decisive — the RPC would refuse to add a second row
      const keyed = raw.transactions.filter((t) => t.linkedSessionId === linkedSessionId);
      const missing: string[] = [];
      const blocked = (readiness: FinanceActionReadiness, ids: string[], priority: number) => candidates.push({ ...base("RECORD_PAID_EXPENSE", i), id: null, readiness, missing: [], facts: null, snapshotHash: null, ownerContextIds: ids, priority });
      if (keyed.length) {
        const st = keyed[0].status;
        blocked(keyed.length > 1 ? "AMBIGUOUS_EXISTING_RECORD" : st === "שולם" ? "ALREADY_RECORDED" : st === "בוטל" ? "CANCELLED_RECORD_EXISTS" : "EXISTING_RECORD_NOT_PAID", [a.contextId], 80);
        continue;
      }
      // an unkeyed expense carrying the canonical description would make a second row ambiguous for every consumer
      if (raw.transactions.some((t) => (t.linkedSessionId ?? "") === "" && t.type === "expense" && t.description === salaryTransactionDescription(workMonth))) { blocked("AMBIGUOUS_EXISTING_RECORD", [a.contextId], 80); continue; }
      if (!known) { candidates.push({ ...base("RECORD_PAID_EXPENSE", i), id: null, readiness: "AMBIGUOUS", missing: ["salaryConfiguration"], facts: null, snapshotHash: null, ownerContextIds: [a.contextId], priority: 60 }); continue; }
      if (!(Number.isFinite(known.amount) && known.amount > 0)) missing.push("amount");
      if (!known.currency || !known.currency.trim()) missing.push("currency");
      const dq = paymentDateQuestion(i, a.contextId, workMonth);
      const dateAnswer = answers.find((x) => x.questionId === dq.identity!.questionId && x.factsFingerprint === dq.identity!.fingerprint);
      const date = dateAnswer?.answerCode === "EXACT_DATE" ? dateAnswer.answerValueYmd : null;
      if (!date) {
        missing.push("paymentDate");
        if (!dateAnswer) questions.push(dq); // UNKNOWN is an answer: never re-asked, the action simply stays blocked
      } else if (date < `${workMonth}-01` || date > state.month.today) {
        // the RPC refuses a payment date before the work month or in the future
        blocked("PAYMENT_DATE_OUT_OF_RANGE", [a.contextId, dateAnswer!.contextId], 60);
        continue;
      }
      const readiness: FinanceActionReadiness = missing.includes("amount") ? "NEEDS_AMOUNT" : missing.includes("currency") ? "NEEDS_CURRENCY" : missing.includes("paymentDate") ? "NEEDS_EXACT_DATE" : "READY_TO_PROPOSE";
      const ownerContextIds = [a.contextId, ...(dateAnswer ? [dateAnswer.contextId] : [])];
      if (readiness !== "READY_TO_PROPOSE") { candidates.push({ ...base("RECORD_PAID_EXPENSE", i), id: null, readiness, missing, facts: null, snapshotHash: null, ownerContextIds, priority: 10 }); continue; }
      // F2.31: the RAW stored config decides (the executor never falls back to code defaults)
      const strict = strictVictorSalaryConfig(raw.victorSalaryConfig, workMonth);
      if (strict.status === "CONFIG_MISSING" || strict.status === "CONFIG_INVALID" || strict.status === "STATUS_CONTRADICTS") { blocked(strict.status, ownerContextIds, 20); continue; }
      const amount = strict.status === "OK" ? strict.amount : known.amount;
      const currency = strict.status === "OK" ? strict.currency : known.currency;
      const facts: FinanceActionFacts = { amount, currency, date: date!, paymentStatus: "שולם", type: "expense", description: salaryTransactionDescription(workMonth), category: "צוות", scope: "general", artist: "Victor", projectId: null, linkedSessionId };
      const id = financeActionId(i.subjectId, workMonth, a.contextId, dateAnswer!.contextId, amount, currency, date!);
      // the RPC compares each Owner Context row's own fingerprint — taken from the ACTIVE answers, never recomputed
      const statusAnswer = answers.find((x) => x.contextId === a.contextId && x.questionType === "FINANCE_RECURRING_PAYMENT_STATUS");
      const eventSnapshot = strict.status === "OK" && FINANCE_ACTION_REGISTRY.RECORD_PAID_EXPENSE.executable && statusAnswer
        ? buildRecordPaidExpenseSnapshot({ subjectKey: i.subjectId, period: workMonth, facts, status: { id: a.contextId, fingerprint: statusAnswer.factsFingerprint }, date: { id: dateAnswer!.contextId, fingerprint: dateAnswer!.factsFingerprint } })
        : null;
      if (eventSnapshot && (eventSnapshot.id !== id || validateFinanceSnapshot(eventSnapshot).length)) { blocked("UNSUPPORTED", ownerContextIds, 70); continue; }
      const legacySnapshot = { schemaVersion: "partner-finance-action-v1", actionType: "RECORD_PAID_EXPENSE", source: i.subjectId, period: workMonth, facts, existingTransactions: [], ownerContextIds, salaryConfig: { amount, currency, dueDate: known.dueDate } };
      candidates.push({
        ...base("RECORD_PAID_EXPENSE", i), readiness, missing: [], facts, ownerContextIds, priority: 1, id,
        executable: eventSnapshot !== null, executorStatus: FINANCE_ACTION_REGISTRY.RECORD_PAID_EXPENSE.executorStatus, eventSnapshot,
        snapshotHash: eventSnapshot ? hashActionSnapshot(eventSnapshot) : sha256Hex(canonicalStableStringify(legacySnapshot)),
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
  // F2.31: an executable action is shown as a Partner Suggested Action card (אשר / לא עכשיו) — no duplicate note.
  if (c.readiness === "READY_TO_PROPOSE" && c.executable) return null;
  if (c.readiness === "READY_TO_PROPOSE" && c.facts) {
    const d = c.facts.date;
    const money = `${c.facts.currency}${c.facts.amount.toLocaleString("en-US")}`;
    return `אני יודע בדיוק מה לרשום (${c.subject.labelHe ?? "התשלום"}: ${money}, שולם, ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}) — אבל עדיין אין לי פעולה בטוחה לבצע את זה.`;
  }
  if (c.readiness === "NEEDS_AMOUNT" && c.actionType === "RECORD_RECEIVED_INCOME") return "אני יודע מה חסר, אבל עדיין אין לי פעולה בטוחה לבצע את זה.";
  if (c.readiness === "UNSUPPORTED") return "אני יודע מה חסר, אבל עדיין אין לי פעולה בטוחה לבצע את זה.";
  return null;
}
