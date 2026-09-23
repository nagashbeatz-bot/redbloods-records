/**
 * Redbloods Partner — Finance Owner answers: identity, fingerprint, active answers (F2.8–F2.10).
 * Pure, deterministic, no I/O, no clock.
 *
 * A finance question is persisted as an ordinary Owner Context row (append-only, existing primitive):
 *   case_id                = finance:<issueType>:<subjectType>:<subjectId>   (deterministic per subject + issue)
 *   question_id            = <case_id>::<FINANCE_* question type>          (the store re-derives it)
 *   case_type              = the integrity issue type that raised the question
 *   case_schema_version    = the finance integrity schema version
 *   case_facts_fingerprint = SHA-256 of the exact question the Owner saw (type, subject, wording, options,
 *                            amount / currency / date, evidence ids + reason codes)
 *   provenance             = { source: "owner_manual" }  (unchanged — no new provenance keys)
 * The evidence id list itself is not stored: it is committed only through the fingerprint.
 *
 * "Active" answer = the terminal CURRENT_APPLICABLE revision of a finance question (resolved by the store).
 * An answer applies only while its fingerprint equals the live question's fingerprint; when the facts
 * change, the question is asked again and the new answer supersedes the old one (supersedes_id).
 */
import { canonicalStableStringify, sha256Hex } from "../actions/canonical";
import { deriveQuestionId, type PersistedOwnerContext } from "../investigation/context-row";
import { FINANCE_ANSWER_OPTIONS, FINANCE_CASE_PREFIX, isFinanceQuestionType, type FinanceQuestionType } from "../investigation/finance-questions";
import type { Evidence } from "./types";

export interface FinanceOwnerAnswer {
  contextId: string;
  questionId: string;
  questionType: FinanceQuestionType;
  caseId: string;
  caseType: string;
  subjectType: string;
  subjectId: string;
  answerCode: string;
  /** Only for EXACT_DATE (YYYY-MM-DD); null for every window / code-only answer. */
  answerValueYmd: string | null;
  factsFingerprint: string;
  answeredAt: string;
}

export const financeCaseId = (issueType: string, subjectType: string, subjectId: string) => `${FINANCE_CASE_PREFIX}${issueType}:${subjectType}:${subjectId}`;
export const financeQuestionId = (caseId: string, questionType: FinanceQuestionType) => deriveQuestionId(caseId, questionType);
export const isFinanceCaseId = (caseId: string) => caseId.startsWith(FINANCE_CASE_PREFIX);

export interface FingerprintInput {
  questionType: FinanceQuestionType;
  issueType: string;
  subject: { type: string; id: string; labelHe: string | null };
  textHe: string;
  optionCodes: readonly string[];
  amount: number | null;
  currency: string | null;
  date: string | null;
  evidence: readonly Evidence[];
}

/** SHA-256 (64 hex) of the exact question the Owner saw. Evidence is reduced to stable ids + reason codes. */
export function financeQuestionFingerprint(q: FingerprintInput): string {
  const evidence = q.evidence
    .map((e) => ({ sourceType: e.sourceType, sourceId: e.sourceId, reasonCode: e.reasonCode }))
    .sort((a, b) => (a.sourceType + "|" + a.sourceId + "|" + a.reasonCode).localeCompare(b.sourceType + "|" + b.sourceId + "|" + b.reasonCode));
  return sha256Hex(canonicalStableStringify({
    v: 1,
    questionType: q.questionType,
    issueType: q.issueType,
    subject: { type: q.subject.type, id: q.subject.id, labelHe: q.subject.labelHe },
    textHe: q.textHe,
    optionCodes: [...q.optionCodes],
    amount: q.amount,
    currency: q.currency,
    date: q.date,
    evidence,
  }));
}

/** Active finance answers from the store's CURRENT_APPLICABLE contexts (anything non-finance is ignored). */
export function financeAnswersFromContexts(contexts: readonly PersistedOwnerContext[]): FinanceOwnerAnswer[] {
  const out: FinanceOwnerAnswer[] = [];
  for (const c of contexts) {
    if (!isFinanceCaseId(c.caseId) || !isFinanceQuestionType(c.questionType)) continue;
    out.push({
      contextId: c.id, questionId: c.questionId, questionType: c.questionType, caseId: c.caseId, caseType: c.caseType,
      subjectType: c.subjectType, subjectId: c.subjectId, answerCode: c.answerCode,
      answerValueYmd: c.answerValue?.kind === "DATE" ? c.answerValue.ymd : null,
      factsFingerprint: c.caseFactsFingerprint, answeredAt: c.answeredAt,
    });
  }
  return out;
}

export const financeAnswerLabelHe = (questionType: FinanceQuestionType, code: string): string | null =>
  FINANCE_ANSWER_OPTIONS[questionType].find((o) => o.code === code)?.labelHe ?? null;
