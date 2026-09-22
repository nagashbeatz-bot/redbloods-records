/**
 * Redbloods Partner — Structured Owner Feedback (Phase F.1, SHADOW MODE).
 * Public entrypoint. Pure model only — no persistence yet (see the Phase
 * F.1 DB Gate report), no UI, no Case Engine side effects.
 */
export * from "./types";
export { validatePartnerFeedback, type FeedbackValidationResult } from "./validate";
export { buildCaseFeedbackSnapshot, fingerprintCaseEvidence } from "./snapshot";
export { deriveFeedbackEffectLevel } from "./effect";
export { summarizePartnerFeedback, resolveCaseTypeForGrouping, type CaseTypeFeedbackSummary, type FeedbackDimensionCounts } from "./summarize";
export { deriveLearningSignals, buildLearningProposals } from "./learning";
