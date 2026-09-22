/**
 * Redbloods Partner — Structured Owner Feedback (Phase F.1). Per-record
 * effect classification. Pure function of ONE record's own scope +
 * dimensions — never looks at other feedback (that is the aggregate
 * learning layer's job — see learning.ts). Owner instruction §13.
 */
import type { FeedbackEffectLevel, PartnerFeedback } from "./types";

/**
 * What effect THIS ONE record could have by itself, with no corroborating
 * pattern. LEARNING_SIGNAL/PROPOSED_RULE_CHANGE are never returned here —
 * those are set by deriveLearningSignals/buildLearningProposals once a
 * record is actually part of a computed aggregate (a record doesn't know on
 * its own whether it's part of a pattern). OWNER_CONFIRMED_RULE is never
 * returned — Phase F.1 has no confirmation mechanism at all.
 */
export function deriveFeedbackEffectLevel(feedback: PartnerFeedback): FeedbackEffectLevel {
  const { target, dimensions: d } = feedback;
  const instanceOrSubjectScoped = target.scope === "CASE_INSTANCE" || target.scope === "SUBJECT" || target.scope === "HYPOTHESIS";
  if (instanceOrSubjectScoped && (d.context.value === "HAS_MISSING_CONTEXT" || d.override.value === "OWNER_OVERRIDE")) {
    return "INSTANCE_CONTEXT";
  }
  return "RECORDED_ONLY";
}
