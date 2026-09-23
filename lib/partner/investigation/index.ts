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
