/**
 * Redbloods Partner — question pre-flight (Organizational Memory V1, HARD RULE). Pure.
 *
 * Before ANY Owner question is surfaced, Partner checks what it already knows, in precedence order:
 *   1 LIVE canonical state → 2 ACTIVE Owner Context → 3 entity history (earlier answers) → 4 conflicts.
 * Only a genuinely missing fact is asked. A still-applicable answer is never asked again (reload, new
 * session, restart or deploy are NOT reasons). A stale answer re-opens the question WITH the previous
 * answer shown ("ענית בעבר …"); conflicting sources re-open it with the conflict made explicit.
 */
import type { FinanceRaw } from "../finance/types";
import type { OwnerQuestion } from "../finance/integrity";
import type { FinanceOwnerAnswer } from "../finance/owner-answers";
import { salaryLinkedId } from "../../victor-salary-format";
import { isCancelledStatus, isExpenseFullyPaidStatus } from "../../finance/classify";
import type { KnownAnswerStatus } from "./types";

export interface KnownAnswer {
  status: KnownAnswerStatus;
  /** Suppress the question (the answer is already known and still applicable). */
  suppress: boolean;
  source: "LIVE_STATE" | "OWNER_CONTEXT" | "HISTORY" | "CONFLICT" | null;
  detail: string | null;
}

export interface PreflightContext { raw: FinanceRaw; answers: readonly FinanceOwnerAnswer[] }

const VICTOR_PERIOD = /^VICTOR_SALARY:(\d{4}-(?:0[1-9]|1[0-2]))$/;

export function resolveKnownAnswerBeforeAsking(q: OwnerQuestion, ctx: PreflightContext): KnownAnswer {
  if (!q.identity) return { status: "NOT_KNOWN", suppress: false, source: null, detail: "display-only question" };

  // 1. LIVE canonical state — a Finance record for the salary period answers "was it paid / when" by itself.
  const period = q.subject.type === "recurring" ? VICTOR_PERIOD.exec(q.subject.id)?.[1] ?? null : null;
  if (period && (q.questionType === "FINANCE_RECURRING_PAYMENT_STATUS" || q.questionType === "FINANCE_PAYMENT_DATE")) {
    const paid = ctx.raw.transactions.find((t) => t.linkedSessionId === salaryLinkedId(period) && t.type === "expense" && isExpenseFullyPaidStatus(t.status) && !isCancelledStatus(t.status));
    if (paid) return { status: "KNOWN_CURRENT", suppress: true, source: "LIVE_STATE", detail: `finance transaction ${paid.id} records the ${period} salary` };
  }

  // 2. ACTIVE Owner Context for this exact question, still matching the facts it was given for.
  const active = ctx.answers.find((a) => a.questionId === q.identity!.questionId);
  if (active && active.factsFingerprint === q.identity.fingerprint) {
    return { status: "KNOWN_OWNER_DECISION", suppress: true, source: "OWNER_CONTEXT", detail: `context ${active.contextId}: ${active.answerCode}${active.answerValueYmd ? ` ${active.answerValueYmd}` : ""}` };
  }

  // 3. History: answered before, but the facts changed since → re-ask, showing the earlier answer.
  if (q.identity.previousAnswer || active) {
    return { status: "KNOWN_HISTORICAL_BUT_STALE", suppress: false, source: "HISTORY", detail: `previous answer ${(q.identity.previousAnswer ?? active)!.answerCode} no longer matches the current facts` };
  }

  // 4. Conflicting evidence about this period — asking is legitimate; the conflict is explicit.
  if (period && q.questionType === "FINANCE_RECURRING_PAYMENT_STATUS") {
    const legacy = (ctx.raw.victorLegacyPayments ?? []).find((l) => l.month === period);
    const salary = (ctx.raw.victorSalary ?? []).find((s) => s.workMonth === period);
    if (legacy?.status && salary && (legacy.status === "שולם") !== (salary.status === "שולם")) {
      return { status: "CONFLICTING_MEMORY", suppress: false, source: "CONFLICT", detail: `salary page says ${salary.status}, legacy payment store says ${legacy.status}` };
    }
  }
  return { status: "NOT_KNOWN", suppress: false, source: null, detail: null };
}
