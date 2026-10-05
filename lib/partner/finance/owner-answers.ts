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

/**
 * v1 (legacy): SHA-256 (64 hex) of the exact question the Owner saw. Evidence is reduced to stable ids + reason codes.
 * Kept ONLY so answers stored before 2026-10-05 keep matching (financeAnswerMatches) — never written for a new answer.
 */
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

/**
 * Issue types whose `date` is NOT a fact of the question (COMPLETED_WORK_NO_INCOME carries the project's updated_at,
 * which every project edit bumps). Leaving it out of v2 is what stops an unrelated edit from re-asking an answered question.
 */
const DATE_NOT_A_FACT = new Set(["COMPLETED_WORK_NO_INCOME", "PRICE_MISSING"]);

/**
 * v2 (2026-10-05, Owner-approved): the FACTS of the question only — type, issue, subject id, amount, currency, a factual
 * date (a due date; never a record's updated_at) and the evidence ids. NOT the wording, the subject's label or the option
 * codes: a rename, a reworded question or a new answer option never re-opens what the Owner already answered (like the
 * Company Integrity Register's facts-only fingerprint). Every new answer stores v2.
 */
export function financeQuestionFingerprintV2(q: FingerprintInput): string {
  const evidence = q.evidence
    .map((e) => ({ sourceType: e.sourceType, sourceId: e.sourceId, reasonCode: e.reasonCode }))
    .sort((a, b) => (a.sourceType + "|" + a.sourceId + "|" + a.reasonCode).localeCompare(b.sourceType + "|" + b.sourceId + "|" + b.reasonCode));
  return sha256Hex(canonicalStableStringify({
    v: 2,
    questionType: q.questionType,
    issueType: q.issueType,
    subject: { type: q.subject.type, id: q.subject.id },
    amount: q.amount,
    currency: q.currency,
    date: DATE_NOT_A_FACT.has(q.issueType) ? null : q.date,
    evidence,
  }));
}

/** Both fingerprints of a live question: `fingerprint` (v2 — what a new answer stores) and `legacyFingerprint` (v1). */
export function financeQuestionFingerprints(q: FingerprintInput): { fingerprint: string; legacyFingerprint: string } {
  return { fingerprint: financeQuestionFingerprintV2(q), legacyFingerprint: financeQuestionFingerprint(q) };
}

/** THE one rule: a stored answer applies to a live question when its fingerprint is the question's v2 or its legacy v1. */
export function financeAnswerMatches(storedFingerprint: string, identity: { fingerprint: string; legacyFingerprint?: string | null }): boolean {
  return storedFingerprint === identity.fingerprint || (!!identity.legacyFingerprint && storedFingerprint === identity.legacyFingerprint);
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
