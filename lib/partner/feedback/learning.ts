/**
 * Redbloods Partner — Structured Owner Feedback (Phase F.1). Learning
 * signals + proposals. Pure, deterministic, NEVER auto-applied (Owner
 * instruction §9-10, §24-26).
 *
 * Two tiers, deliberately kept separate:
 *   1. deriveLearningSignals — UNCONDITIONAL structured observation. Every
 *      (caseType, dimension-value) combination with >=1 feedback becomes
 *      one signal, counts only, no verdict.
 *   2. buildLearningProposals — a PROPOSAL exists only once the SAME
 *      signal recurs (sampleSize >= 2). "Repeated" literally means
 *      "occurring more than once" — this is the minimal, definitional
 *      threshold for calling something a pattern, NOT a business-policy
 *      cutoff like "3 dismissals = auto-suppress" (explicitly forbidden,
 *      §26). A proposal is inert: it names the pattern and the evidence,
 *      nothing more. Applying anything is a future, Owner-gated step this
 *      module never takes (§10).
 */
import type { LearningSignalKind, PartnerFeedback, PartnerLearningProposal, PartnerLearningSignal } from "./types";
import { resolveCaseTypeForGrouping } from "./summarize";

interface SignalGroup {
  caseType: string;
  kind: LearningSignalKind;
  dimensionValue: string;
  feedbackIds: string[];
}

function collectSignalGroups(feedback: readonly PartnerFeedback[]): Map<string, SignalGroup> {
  const groups = new Map<string, SignalGroup>();
  const add = (caseType: string, kind: LearningSignalKind, dimensionValue: string, feedbackId: string) => {
    const key = `${caseType}:${kind}:${dimensionValue}`;
    let g = groups.get(key);
    if (!g) { g = { caseType, kind, dimensionValue, feedbackIds: [] }; groups.set(key, g); }
    g.feedbackIds.push(feedbackId);
  };

  for (const f of feedback) {
    const caseType = resolveCaseTypeForGrouping(f);
    if (!caseType) continue;
    const d = f.dimensions;
    if (d.accuracy !== "UNSPECIFIED") add(caseType, "ACCURACY_PATTERN", d.accuracy, f.id);
    if (d.importance !== "UNSPECIFIED") add(caseType, "IMPORTANCE_PATTERN", d.importance, f.id);
    if (d.timing.reaction !== "UNSPECIFIED") add(caseType, "TIMING_PATTERN", d.timing.reaction, f.id);
    if (d.timing.remindAdjustment) add(caseType, "TIMING_PATTERN", `REMIND_${d.timing.remindAdjustment.direction}`, f.id);
    if (d.context.value === "HAS_MISSING_CONTEXT") add(caseType, "CONTEXT_PATTERN", d.context.value, f.id);
    if (d.override.value === "OWNER_OVERRIDE") add(caseType, "OVERRIDE_PATTERN", d.override.value, f.id);
    if (d.inference.value === "DO_NOT_INFER") add(caseType, "INFERENCE_PATTERN", d.inference.value, f.id);
  }
  return groups;
}

/** Unconditional — one signal per observed (caseType, kind, value) combination, deterministic id, sorted output. */
export function deriveLearningSignals(feedback: readonly PartnerFeedback[]): PartnerLearningSignal[] {
  const groups = collectSignalGroups(feedback);
  const totalByCaseType = new Map<string, number>();
  for (const f of feedback) {
    const ct = resolveCaseTypeForGrouping(f);
    if (ct) totalByCaseType.set(ct, (totalByCaseType.get(ct) ?? 0) + 1);
  }
  return [...groups.values()]
    .map((g): PartnerLearningSignal => ({
      id: `${g.caseType}:${g.kind}:${g.dimensionValue}`,
      caseType: g.caseType,
      kind: g.kind,
      dimensionValue: g.dimensionValue,
      sampleSize: g.feedbackIds.length,
      totalReviewedForCaseType: totalByCaseType.get(g.caseType) ?? 0,
      sourceFeedbackIds: [...g.feedbackIds].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const KIND_LABEL_HE: Record<LearningSignalKind, string> = {
  ACCURACY_PATTERN: "דיוק",
  IMPORTANCE_PATTERN: "חשיבות",
  TIMING_PATTERN: "תזמון",
  CONTEXT_PATTERN: "היעדר context",
  OVERRIDE_PATTERN: "חריגה מכוונת",
  INFERENCE_PATTERN: "דחיית מסקנה",
};

/**
 * Only signals with sampleSize >= 2 become a proposal — see module doc.
 * evidenceSummary is factual counts only, never a recommendation to act.
 */
export function buildLearningProposals(signals: readonly PartnerLearningSignal[]): PartnerLearningProposal[] {
  return signals
    .filter((s) => s.sampleSize >= 2)
    .map((s): PartnerLearningProposal => ({
      id: s.id,
      proposalType: s.kind,
      sourceFeedbackIds: s.sourceFeedbackIds,
      affectedCaseType: s.caseType,
      affectedScope: "CASE_TYPE",
      evidenceSummary: `${s.sampleSize} מתוך ${s.totalReviewedForCaseType} משובים על ${s.caseType} סומנו ${KIND_LABEL_HE[s.kind]}: ${s.dimensionValue}. כדאי לבדוק את ה-detector — ההצעה אינה מבצעת שינוי.`,
      status: "PROPOSED",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
