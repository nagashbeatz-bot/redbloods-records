/**
 * Redbloods Partner — Case Engine (Phase E.1). Explainability.
 *
 * No LLM. explainPartnerCase() is a pure projection of a PartnerCase's own
 * already-typed fields into the shape the Owner instruction §29 asked for:
 * "what facts triggered this / what derived calculation exists / what Owner
 * Rule applied / what is only hypothesis / what data is missing."
 */
import type { CaseExplanation, PartnerCase } from "./types";

export function explainPartnerCase(c: PartnerCase): CaseExplanation {
  return {
    caseId: c.id,
    caseType: c.caseType,
    whatFactsTriggeredThis: c.facts,
    derivedCalculations: c.derivedFacts,
    ownerRulesApplied: c.ownerRulesApplied,
    workingPrinciplesApplied: c.workingPrinciplesApplied,
    hypotheses: c.hypotheses,
    missingData: c.unknowns,
    summary: c.summaryHe,
  };
}
