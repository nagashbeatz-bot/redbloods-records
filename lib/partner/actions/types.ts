/**
 * Redbloods Partner — Suggested Actions (Phase F.1F). Pure types.
 *
 * A Suggested Action is a PROPOSAL derived from structured Partner state
 * (Case facts + applicable Owner Contexts + resolved answer values). It is
 * not an approval and not an execution: v1 has no approval record, no
 * handler and no persistence. Every proposal carries the structured
 * evidence that explains it, so any future caller (UI, backend, a
 * conversational layer) can answer "why?" from data — never from free text
 * and never from chat memory. Owner Context notes never drive an action.
 *
 * A future executed action must go through an explicit application
 * handler (a controlled primitive that re-checks the preconditions at
 * execution time) — never through UI automation.
 */
import type { CaseEvidence } from "../cases/types";
import type { OwnerContextAnswerValue } from "../investigation/types";

export const SUGGESTED_ACTION_SCHEMA_VERSION = "partner-suggested-action-v1";

/** v1: one action type only. */
export type SuggestedActionType = "UPDATE_PROJECT_DEADLINE";

/**
 * PROPOSED     — every precondition holds; awaits explicit Owner approval (never auto-executed).
 * NOT_ELIGIBLE — derived now, but a precondition fails (e.g. value earlier than its anchor).
 * STALE        — was valid when proposed, but the underlying truth changed since (facts / persisted value / context).
 * No APPROVED / EXECUTED states exist in v1: approval and execution are not implemented.
 */
export type SuggestedActionStatus = "PROPOSED" | "NOT_ELIGIBLE" | "STALE";

export type ActionPreconditionCode =
  | "CASE_EXISTS"
  | "SUBJECT_MATCHES"
  | "TRIGGER_CONTEXT_APPLICABLE"
  | "VALUE_CONTEXT_APPLICABLE"
  | "VALUE_IS_VALID_DATE"
  | "CASE_FACTS_MATCH_DECISION"
  | "PERSISTED_VALUE_MATCHES_EXPECTED"
  | "PROPOSED_NOT_BEFORE_ANSWER_DATE";

export interface ActionPrecondition { code: ActionPreconditionCode; satisfied: boolean; detail: string }

export type ActionEvidence =
  | { kind: "CASE_FACT"; caseId: string; field: string; value: CaseEvidence["value"] }
  | { kind: "OWNER_CONTEXT"; contextId: string; questionId: string; questionType: string; answerCode: string }
  | { kind: "RESOLVED_VALUE"; contextId: string; value: OwnerContextAnswerValue };

export interface ProposedFieldChange {
  entity: "project";
  entityId: string;
  field: "deadline";
  /** The persisted value the change expects to replace — execution must refuse if it differs (no blind overwrite). */
  from: string;
  to: string;
}

export interface PartnerSuggestedAction {
  /** Deterministic: same decision → same id (`${actionType}:${subjectId}:${valueContextId}:${to}`). */
  id: string;
  schemaVersion: string;
  actionType: SuggestedActionType;
  subjectType: "project";
  subjectId: string;
  status: SuggestedActionStatus;
  /** Always true in v1 — no Owner Rule grants automatic business-data mutation. */
  requiresOwnerApproval: true;
  /** Policy placeholder for display/ordering; never used to auto-execute. */
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  /** Why the action is proposed (structured codes). */
  reasonCodes: string[];
  /** Why it cannot be acted on (empty when PROPOSED). */
  blockingReasons: ActionPreconditionCode[];
  explanationHe: string;
  proposedChange: ProposedFieldChange;
  evidence: ActionEvidence[];
  sourceCaseId: string;
  sourceQuestionIds: string[];
  sourceContextIds: string[];
  /** The Case facts fingerprint the decision was made on. */
  caseFactsFingerprint: string;
  preconditions: ActionPrecondition[];
  staleness: { stale: boolean; reasons: ActionPreconditionCode[] };
  createdFrom: "CASE_DECISION_STATE";
}

/** A decision that could have produced an action but did not, with the deterministic reason. */
export interface SkippedAction { actionType: SuggestedActionType; subjectId: string; reason: "NO_OP_VALUE_ALREADY_PERSISTED" | "DECISION_INCOMPLETE"; detail: string }
