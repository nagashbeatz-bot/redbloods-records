/**
 * Redbloods Partner — Structured Owner Feedback (Phase F.1). Validation.
 * Pure, no I/O, never throws — always returns a result the caller decides
 * how to handle (an unknown CaseType or malformed target is data, not a
 * crash — Owner instruction §38 test #2/#3).
 */
import { CASE_SCHEMA_VERSION } from "../cases/types";
import { FEEDBACK_SCHEMA_VERSION } from "./types";
import type { PartnerFeedback } from "./types";

export interface FeedbackValidationResult {
  valid: boolean;
  errors: string[];
  /** Non-fatal — e.g. a schema-version mismatch on the snapshot. Feedback is still recorded/valid. */
  warnings: string[];
}

const ok = (errors: string[] = [], warnings: string[] = []): FeedbackValidationResult => ({ valid: errors.length === 0, errors, warnings });

/**
 * `knownCaseTypes` — the CURRENT Case Engine catalog (e.g. from
 * scripts/partner-case-report.ts's own CATALOG, or buildPartnerCases()
 * output this run). A caseType outside this set is not a crash — it is
 * flagged so a caller can decide (e.g. the detector was renamed/removed
 * since the feedback was given), never silently trusted as real.
 */
export function validatePartnerFeedback(feedback: PartnerFeedback, knownCaseTypes: readonly string[]): FeedbackValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!feedback.id || typeof feedback.id !== "string") errors.push("id is required");
  if (!feedback.createdAt || Number.isNaN(Date.parse(feedback.createdAt))) errors.push("createdAt must be a valid ISO timestamp");
  if (!feedback.schemaVersion || typeof feedback.schemaVersion !== "string") errors.push("schemaVersion is required (FEEDBACK_SCHEMA_VERSION at construction time)");
  else if (feedback.schemaVersion !== FEEDBACK_SCHEMA_VERSION) warnings.push(`schemaVersion (${feedback.schemaVersion}) does not match the current FEEDBACK_SCHEMA_VERSION (${FEEDBACK_SCHEMA_VERSION}) — the feedback record shape may have changed since this was recorded (distinct from a caseSnapshot.caseSchemaVersion mismatch)`);

  const t = feedback.target;
  switch (t.scope) {
    case "CASE_INSTANCE":
      if (!t.caseId) errors.push("CASE_INSTANCE target requires caseId");
      if (!feedback.caseSnapshot) errors.push("CASE_INSTANCE target requires caseSnapshot");
      else if (t.caseId && feedback.caseSnapshot.caseId !== t.caseId) errors.push("caseSnapshot.caseId does not match target.caseId");
      break;
    case "CASE_TYPE":
      if (!t.caseType) errors.push("CASE_TYPE target requires caseType");
      break;
    case "SUBJECT":
      if (!t.subjectType || !t.subjectId) errors.push("SUBJECT target requires subjectType and subjectId");
      break;
    case "RULE_APPLICATION":
      if (!t.ownerRuleId) errors.push("RULE_APPLICATION target requires ownerRuleId");
      if (!t.caseType) errors.push("RULE_APPLICATION target requires caseType (which CaseType the rule was applied within)");
      break;
    case "HYPOTHESIS":
      if (!t.caseId) errors.push("HYPOTHESIS target requires caseId");
      if (!t.hypothesisId) errors.push("HYPOTHESIS target requires hypothesisId");
      if (!feedback.caseSnapshot) errors.push("HYPOTHESIS target requires caseSnapshot");
      break;
    case "THRESHOLD_PROPOSAL":
      if (!t.proposalId) errors.push("THRESHOLD_PROPOSAL target requires proposalId");
      break;
    default:
      errors.push(`unknown target scope: ${String(t.scope)}`);
  }

  const caseTypeToCheck = t.caseType ?? feedback.caseSnapshot?.caseType ?? null;
  if (caseTypeToCheck && !knownCaseTypes.includes(caseTypeToCheck)) {
    warnings.push(`caseType "${caseTypeToCheck}" is not in the current Case Engine catalog — the detector may have been renamed or removed since this feedback was given`);
  }

  if (feedback.caseSnapshot && feedback.caseSnapshot.caseSchemaVersion !== CASE_SCHEMA_VERSION) {
    warnings.push(`caseSnapshot.caseSchemaVersion (${feedback.caseSnapshot.caseSchemaVersion}) does not match the current CASE_SCHEMA_VERSION (${CASE_SCHEMA_VERSION}) — the Case shape may have changed since this feedback was given`);
  }

  const d = feedback.dimensions;
  if (d.inference.value === "DO_NOT_INFER" && !d.inference.hypothesisId) {
    errors.push("inference.value=DO_NOT_INFER requires inference.hypothesisId (a specific hypothesis, never a blanket block — Owner instruction §30)");
  }
  if (d.inference.value === "DO_NOT_INFER" && t.scope !== "HYPOTHESIS" && t.scope !== "CASE_INSTANCE") {
    warnings.push("DO_NOT_INFER outside CASE_INSTANCE/HYPOTHESIS scope — confirm this is intentionally a broader rejection, not an overgeneralized one");
  }

  const allUnspecified =
    d.accuracy === "UNSPECIFIED" && d.importance === "UNSPECIFIED" && d.timing.reaction === "UNSPECIFIED" &&
    d.timing.remindAdjustment === null && d.context.value === "UNSPECIFIED" && d.inference.value === "UNSPECIFIED" &&
    d.override.value === "NONE" && !feedback.note;
  if (allUnspecified) errors.push("feedback carries no signal at all (every dimension UNSPECIFIED/NONE and no note) — nothing to record");

  return ok(errors, warnings);
}
