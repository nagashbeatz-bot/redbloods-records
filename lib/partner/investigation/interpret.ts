/**
 * Redbloods Partner — Owner Context + Interpretation + context learning
 * (Phase F.1C). Pure, deterministic, no I/O, no LLM.
 *
 * - Owner Context is EVIDENCE about why. It never rewrites a Case fact: the
 *   interpretation copies facts/derivedFacts from the Case unchanged.
 * - Feedback (accuracy / importance / timing) NEVER closes an investigation.
 *   Only an Owner Context answer for that exact question does.
 * - Interpretation is table-driven from the chosen answer option
 *   (questions.ts:ANSWER_OPTIONS) — no free-form reasoning, and `note` is
 *   carried verbatim, never parsed.
 * - Learning from context is counts-only. One answer is INSTANCE_ONLY; a
 *   PROPOSED review item appears only when the same answer recurs across
 *   DISTINCT Cases (>=2 — the same definitional "more than once" minimum as
 *   lib/partner/feedback/learning.ts). Nothing is ever applied.
 */
import type { PartnerCase } from "../cases/types";
import type { PartnerFeedback } from "../feedback/types";
import { answerOptionsFor } from "./questions";
import {
  INVESTIGATION_SCHEMA_VERSION,
  type InterpretationHypothesis, type InterpretationStatement, type InvestigationQuestionType,
  type PartnerCaseInterpretation, type PartnerContextLearningProposal, type PartnerContextLearningSignal,
  type PartnerInvestigationQuestion, type PartnerOwnerContext,
} from "./types";

// ── Owner Context ──

export interface OwnerContextInput {
  answerCode: string;
  note?: string | null;
  /** Passed in, never read from a clock here (deterministic, testable). */
  answeredAt: string;
}

export interface OwnerContextValidation { valid: boolean; errors: string[] }

/** Builds the context record for a question. Throws on an answer code the question does not offer — never coerces to OTHER. */
export function buildOwnerContext(question: PartnerInvestigationQuestion, input: OwnerContextInput): PartnerOwnerContext {
  const ctx: PartnerOwnerContext = {
    id: `${question.id}@${input.answeredAt}`,
    schemaVersion: INVESTIGATION_SCHEMA_VERSION,
    questionId: question.id,
    questionType: question.questionType,
    caseId: question.caseId,
    caseType: question.caseType,
    subjectType: question.subjectType,
    subjectId: question.subjectId,
    answerCode: input.answerCode,
    note: input.note ?? null,
    answeredAt: input.answeredAt,
    scope: "CASE_INSTANCE",
    provenance: { source: "owner_manual" },
  };
  const v = validateOwnerContext(ctx, question);
  if (!v.valid) throw new Error(`invalid owner context: ${v.errors.join("; ")}`);
  return ctx;
}

export function validateOwnerContext(ctx: PartnerOwnerContext, question: PartnerInvestigationQuestion): OwnerContextValidation {
  const errors: string[] = [];
  if (ctx.questionId !== question.id) errors.push("questionId does not match the question");
  if (ctx.caseId !== question.caseId || ctx.caseType !== question.caseType) errors.push("case identity does not match the question");
  if (ctx.subjectType !== question.subjectType || ctx.subjectId !== question.subjectId) errors.push("subject identity does not match the question");
  if (ctx.questionType !== question.questionType) errors.push("questionType does not match the question");
  if (!question.answerOptions.some((o) => o.code === ctx.answerCode)) errors.push(`answerCode "${ctx.answerCode}" is not offered by this question (use OTHER + note)`);
  if (Number.isNaN(Date.parse(ctx.answeredAt))) errors.push("answeredAt must be a valid ISO timestamp");
  if (ctx.note !== null && typeof ctx.note !== "string") errors.push("note must be a string or null");
  if (ctx.scope !== "CASE_INSTANCE") errors.push("v1 owner context is CASE_INSTANCE-scoped only");
  if (ctx.provenance?.source !== "owner_manual") errors.push("provenance.source must be owner_manual");
  return { valid: errors.length === 0, errors };
}

/** Latest answer per question (answeredAt, then id). An Owner changing their mind is a newer context, never an edit. */
export function resolveCurrentContexts(contexts: readonly PartnerOwnerContext[]): PartnerOwnerContext[] {
  const latest = new Map<string, PartnerOwnerContext>();
  for (const c of contexts) {
    const prev = latest.get(c.questionId);
    if (!prev || Date.parse(c.answeredAt) > Date.parse(prev.answeredAt) || (c.answeredAt === prev.answeredAt && c.id > prev.id)) latest.set(c.questionId, c);
  }
  return [...latest.values()].sort((a, b) => a.questionId.localeCompare(b.questionId));
}

/** ANSWERED only through an Owner Context for THIS question — feedback of any kind never counts. */
export function questionStatus(question: PartnerInvestigationQuestion, contexts: readonly PartnerOwnerContext[]): "OPEN" | "ANSWERED" {
  return contexts.some((c) => c.questionId === question.id) ? "ANSWERED" : "OPEN";
}

// ── Interpretation ──

/**
 * `feedback` is accepted to make the separation explicit and testable: it is
 * NEVER used to resolve the investigation (CORRECT / NOT_IMPORTANT answer
 * "is the Case right / does it matter", not "why").
 */
export function interpretCase(
  c: PartnerCase,
  question: PartnerInvestigationQuestion | null,
  contexts: readonly PartnerOwnerContext[],
  feedback: readonly PartnerFeedback[] = [],
): PartnerCaseInterpretation {
  void feedback;
  const caseHypotheses: InterpretationHypothesis[] = c.hypotheses.map((h) => ({ id: h.id, statementHe: h.statement, epistemicStatus: "HYPOTHESIS", basis: "Case hypothesis (detector)" }));
  const base = {
    caseId: c.id,
    caseType: c.caseType,
    facts: c.facts.map((f) => ({ ...f })),
    derivedFacts: c.derivedFacts.map((d) => ({ ...d })),
    learningEffect: "INSTANCE_ONLY" as const,
  };

  if (!question) {
    return { ...base, questionId: null, ownerContext: null, derivedFromContext: [], hypotheses: caseHypotheses, unknownsRemaining: [...c.unknowns], investigationStatus: "NOT_REQUIRED" };
  }

  const ctx = resolveCurrentContexts(contexts.filter((x) => x.questionId === question.id))[0] ?? null;
  if (!ctx) {
    return {
      ...base, questionId: question.id, ownerContext: null, derivedFromContext: [], hypotheses: caseHypotheses,
      unknownsRemaining: [...c.unknowns, question.reasonHe],
      investigationStatus: "OPEN",
    };
  }

  const option = question.answerOptions.find((o) => o.code === ctx.answerCode);
  if (!option) throw new Error(`owner context answer "${ctx.answerCode}" is not an option of ${question.id}`);
  const basis = `owner_context:${ctx.id}`;
  const derivedFromContext: InterpretationStatement[] = option.derivedHe ? [{ id: `${question.questionType}:${option.code}`, statementHe: option.derivedHe, basis }] : [];
  const hypotheses = option.hypothesisHe
    ? [...caseHypotheses, { id: `${question.questionType}:${option.code}:hypothesis`, statementHe: option.hypothesisHe, epistemicStatus: "HYPOTHESIS" as const, basis }]
    : caseHypotheses;
  // The question's own unknown is answered; the Case's other unknowns stay, plus whatever this answer leaves open.
  const unknownsRemaining = [...c.unknowns.filter((u) => !isAnsweredBy(u, question.questionType)), ...(option.remainingUnknownHe ? [option.remainingUnknownHe] : [])];

  return {
    ...base, questionId: question.id,
    ownerContext: { answerCode: option.code, labelHe: option.labelHe, note: ctx.note },
    derivedFromContext, hypotheses, unknownsRemaining,
    investigationStatus: "ANSWERED",
  };
}

/** Which detector-level unknowns a question type answers (matched on the detectors' own fixed wording). */
const ANSWERS_UNKNOWN: Partial<Record<InvestigationQuestionType, RegExp>> = {
  WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM: /מחוץ למערכת/,
  IS_MISSING_FINANCE_CONFIG_INTENTIONAL: /סיבה מכוונת/,
  WHY_INTERNAL_DEADLINE_PASSED: /מי אחראי לפעולה הבאה/,
};
function isAnsweredBy(unknown: string, type: InvestigationQuestionType): boolean {
  return ANSWERS_UNKNOWN[type]?.test(unknown) ?? false;
}

// ── Learning from context (counts only, PROPOSED only) ──

export function deriveContextLearningSignals(contexts: readonly PartnerOwnerContext[]): PartnerContextLearningSignal[] {
  const current = resolveCurrentContexts(contexts);
  const groups = new Map<string, { caseType: string; questionType: InvestigationQuestionType; answerCode: string; caseIds: Set<string>; ids: string[] }>();
  const totalByQuestionType = new Map<string, Set<string>>();
  for (const c of current) {
    const key = `${c.caseType}:${c.questionType}:${c.answerCode}`;
    let g = groups.get(key);
    if (!g) { g = { caseType: c.caseType, questionType: c.questionType, answerCode: c.answerCode, caseIds: new Set(), ids: [] }; groups.set(key, g); }
    g.caseIds.add(c.caseId);
    g.ids.push(c.id);
    const tk = `${c.caseType}:${c.questionType}`;
    (totalByQuestionType.get(tk) ?? totalByQuestionType.set(tk, new Set()).get(tk)!).add(c.caseId);
  }
  return [...groups.entries()]
    .map(([id, g]): PartnerContextLearningSignal => ({
      id, caseType: g.caseType, questionType: g.questionType, answerCode: g.answerCode,
      distinctCases: g.caseIds.size,
      totalAnsweredForQuestionType: totalByQuestionType.get(`${g.caseType}:${g.questionType}`)?.size ?? 0,
      sourceContextIds: [...g.ids].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** What a recurring answer suggests REVIEWING. Never an action; answers without an entry get a neutral review line. */
const REVIEW_SUGGESTION_HE: Record<string, string> = {
  "WHY_DEADLINE_STILL_ACTIVE:DEADLINE_NOT_UPDATED": "כדאי לבחון את תהליך תחזוקת הדדליינים של פרויקטים.",
  "IS_TASK_STILL_RELEVANT:ALREADY_DONE_NOT_MARKED": "כדאי לבחון את תהליך סגירת משימות במערכת.",
  "IS_TASK_STILL_RELEVANT:DUE_DATE_NOT_UPDATED": "כדאי לבחון את תהליך תחזוקת תאריכי יעד של משימות.",
  "WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM:REVIEWED_OUTSIDE_SYSTEM": "כדאי לבחון איך בדיקות מסירה מחוץ למערכת מתועדות בה.",
  "IS_MISSING_FINANCE_CONFIG_INTENTIONAL:FORGOT_TO_CONFIGURE": "כדאי לבחון את תהליך הגדרת התמחור בפתיחת פרויקט.",
  "WHY_INTERNAL_DEADLINE_PASSED:DEADLINE_NOT_UPDATED": "כדאי לבחון את תהליך תחזוקת הדדליינים הפנימיים.",
  "WHY_INTERNAL_DEADLINE_PASSED:WORK_DONE_NOT_CLOSED": "כדאי לבחון את תהליך סגירת עבודות במערכת.",
  "WHY_RELEASE_TARGET_PASSED:TARGET_NOT_UPDATED": "כדאי לבחון את תהליך תחזוקת תאריכי יעד של ריליסים.",
};

export function buildContextLearningProposals(signals: readonly PartnerContextLearningSignal[]): PartnerContextLearningProposal[] {
  return signals
    .filter((s) => s.distinctCases >= 2)
    .map((s): PartnerContextLearningProposal => ({
      id: s.id,
      sourceContextIds: s.sourceContextIds,
      affectedCaseType: s.caseType,
      questionType: s.questionType,
      answerCode: s.answerCode,
      evidenceSummaryHe: `${s.distinctCases} מתוך ${s.totalAnsweredForQuestionType} מקרים מסוג ${s.caseType} הוסברו על ידי הבעלים כ-${s.answerCode}.`,
      reviewSuggestionHe: `${REVIEW_SUGGESTION_HE[`${s.questionType}:${s.answerCode}`] ?? "כדאי לבחון את הדפוס."} ההצעה אינה מבצעת שינוי.`,
      status: "PROPOSED",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Label lookup for display — the same table the question carries. */
export function answerLabelHe(type: InvestigationQuestionType, code: string): string | null {
  return answerOptionsFor(type).find((o) => o.code === code)?.labelHe ?? null;
}
