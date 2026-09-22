/**
 * Redbloods Partner — Case Engine (Phase E.1, SHADOW MODE ONLY). Public
 * entrypoint. Not wired into any UI, notification, push, or Agent Alerts —
 * see lib/partner/cases/types.ts's module doc.
 */
export * from "./types";
export { buildPartnerCases, type BuildPartnerCasesInput } from "./engine";
export { explainPartnerCase } from "./explain";
export { detectVictorInternalDeadlineCases, detectVictorUnfollowedDeliveryCases } from "./detectors/victor";
export { detectProjectFinanceCases } from "./detectors/finance";
export { detectReleaseTimingCases } from "./detectors/release";
export { detectProjectDeadlineCases } from "./detectors/project";
export { detectChangeDerivedCases } from "./detectors/changeDerived";
export {
  detectProposalFollowupCases, detectPaymentDueDateCases, detectShowClientPaymentCases,
  detectTaskDueDateCases, detectStevenInternalDeadlineCases,
} from "./detectors/risks";
