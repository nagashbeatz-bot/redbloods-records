/**
 * Redbloods Partner — Structured Owner Feedback (Phase F.1). Pure
 * aggregation by CaseType. No I/O, no conclusions — counts only (Owner
 * instruction §25-27: "do not conclude 'disable X' — report counts/rates,
 * Owner decides policy").
 */
import type {
  AccuracyFeedback, ContextValue, ImportanceFeedback, InferenceValue, OverrideValue,
  PartnerFeedback, TimingReaction,
} from "./types";

export interface FeedbackDimensionCounts {
  accuracy: Record<AccuracyFeedback, number>;
  importance: Record<ImportanceFeedback, number>;
  timing: Record<TimingReaction, number>;
  remindAdjustments: { earlier: number; later: number };
  context: Record<ContextValue, number>;
  inference: Record<InferenceValue, number>;
  override: Record<OverrideValue, number>;
}

function zeroCounts(): FeedbackDimensionCounts {
  return {
    accuracy: { CORRECT: 0, INCORRECT: 0, UNSPECIFIED: 0 },
    importance: { IMPORTANT: 0, NOT_IMPORTANT: 0, UNSPECIFIED: 0 },
    timing: { TOO_EARLY: 0, RIGHT_TIME: 0, TOO_LATE: 0, UNSPECIFIED: 0 },
    remindAdjustments: { earlier: 0, later: 0 },
    context: { HAS_MISSING_CONTEXT: 0, NONE: 0, UNSPECIFIED: 0 },
    inference: { DO_NOT_INFER: 0, UNSPECIFIED: 0 },
    override: { OWNER_OVERRIDE: 0, NONE: 0 },
  };
}

export interface CaseTypeFeedbackSummary {
  caseType: string;
  totalFeedback: number;
  counts: FeedbackDimensionCounts;
}

/** The caseType a feedback record counts against for grouping — target.caseType when present, else the CASE_INSTANCE/HYPOTHESIS snapshot's caseType. null for scopes that carry no caseType at all (SUBJECT without a caseType, THRESHOLD_PROPOSAL). */
export function resolveCaseTypeForGrouping(feedback: PartnerFeedback): string | null {
  return feedback.target.caseType ?? feedback.caseSnapshot?.caseType ?? null;
}

/**
 * Deterministic regardless of input order — output is grouped into a plain
 * object keyed by caseType, then rendered as an array SORTED by caseType, so
 * a caller iterating the result never sees an order dependent on feedback
 * array order (Owner instruction §38 test #16).
 */
export function summarizePartnerFeedback(feedback: readonly PartnerFeedback[]): CaseTypeFeedbackSummary[] {
  const byType = new Map<string, CaseTypeFeedbackSummary>();
  for (const f of feedback) {
    const caseType = resolveCaseTypeForGrouping(f);
    if (!caseType) continue;
    let entry = byType.get(caseType);
    if (!entry) { entry = { caseType, totalFeedback: 0, counts: zeroCounts() }; byType.set(caseType, entry); }
    entry.totalFeedback++;
    entry.counts.accuracy[f.dimensions.accuracy]++;
    entry.counts.importance[f.dimensions.importance]++;
    entry.counts.timing[f.dimensions.timing.reaction]++;
    if (f.dimensions.timing.remindAdjustment?.direction === "EARLIER") entry.counts.remindAdjustments.earlier++;
    if (f.dimensions.timing.remindAdjustment?.direction === "LATER") entry.counts.remindAdjustments.later++;
    entry.counts.context[f.dimensions.context.value]++;
    entry.counts.inference[f.dimensions.inference.value]++;
    entry.counts.override[f.dimensions.override.value]++;
  }
  return [...byType.values()].sort((a, b) => a.caseType.localeCompare(b.caseType));
}
