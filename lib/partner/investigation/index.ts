/**
 * Redbloods Partner — Investigation & Owner Context loop (Phase F.1C,
 * SHADOW MODE). Public entrypoint. Pure model only — no persistence, no UI,
 * no API route, no Case Engine side effects.
 */
export * from "./types";
export { ANSWER_OPTIONS, answerOptionsFor, daysAgoHe, decideInvestigation, decideInvestigations, buildInvestigationQuestions, questionIdFor } from "./questions";
export {
  buildOwnerContext, validateOwnerContext, resolveCurrentContexts, questionStatus, interpretCase,
  deriveContextLearningSignals, buildContextLearningProposals, answerLabelHe,
  type OwnerContextInput, type OwnerContextValidation,
} from "./interpret";
export {
  DEFAULT_ATTENTION_POLICY, buildAttentionQueue,
  type AttentionPolicy, type AttentionInput, type AttentionProjectInfo, type AttentionReleaseInfo,
  type AttentionFactor, type AttentionFactorCode, type AttentionBand, type AttentionItem, type AttentionQueue,
  type AttentionState, type QuestionAnswerState, type DeferralReason,
} from "./queue";
export { FOLLOW_UP_RULES, FOLLOW_UP_QUESTION_TYPES, buildFollowUpQuestions, isFollowUpQuestionType, triggersFollowUp, type FollowUpRule } from "./questions";
export { VALUE_SPEC, valueSpecFor, resolveAnswerValue, validateAnswerValue, applyRelativeRule, endOfMonthYmd, formatYmdHe, isValidYmd, type AnswerValueSpec, type ResolveResult } from "./answer-value";
export { classifyOwnerContexts, applicableContexts, triggerSupportsFollowUp, triggerStillSupports, type ContextApplicability, type ContextApplicabilityStatus, type NotApplicableReason } from "./context-applicability";
export {
  deriveCaseDecisionState, DECISION_STATE_SCHEMA_VERSION,
  type PartnerCaseDecisionState, type DecisionReadiness, type DecisionUnknownCode, type SelectedBusinessValue,
  type ResolvedUnknown, type RemainingUnknown, type DecisionSource, type DecisionOwnerContext,
} from "./decision-state";
