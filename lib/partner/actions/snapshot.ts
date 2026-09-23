/**
 * Redbloods Partner — Action snapshot (Phase F.1H). Pure, deterministic.
 *
 * The snapshot is EXACTLY what the Owner was shown when deciding: the derived
 * PartnerSuggestedAction verbatim (id, schemaVersion, actionType, subject,
 * proposedChange, riskLevel, reasonCodes, blockingReasons, evidence, source
 * Case / questions / contexts, caseFactsFingerprint, preconditions, staleness,
 * requiresOwnerApproval, status, explanationHe) plus the Case facts the
 * decision rested on (caseFacts / caseType / caseSchemaVersion). Nothing else:
 * no app-state dump, no secrets, no notes.
 *
 * Field names follow the DB contract: partner_action_events CHECKs read
 * snapshot.id / subjectId / status / requiresOwnerApproval, and the execution
 * RPC reads proposedChange.{entity,entityId,field,from,to}, caseFacts.status,
 * caseFactsFingerprint, sourceCaseId and sourceContextIds (first = trigger,
 * last = value context). "actionId" / "actionSchemaVersion" in the design are
 * snapshot.id / snapshot.schemaVersion.
 */
import type { PartnerCase } from "../cases/types";
import { canonicalSha256 } from "./canonical";
import type { PartnerSuggestedAction } from "./types";

export const ACTION_SNAPSHOT_SCHEMA_VERSION = "partner-action-snapshot-v1";

export type CaseFactValue = string | number | boolean | null;

export interface PartnerActionSnapshot extends PartnerSuggestedAction {
  snapshotSchemaVersion: typeof ACTION_SNAPSHOT_SCHEMA_VERSION;
  caseType: string;
  caseSchemaVersion: string;
  /** field → value of the Case facts (e.g. deadline, status) the proposal was derived from. */
  caseFacts: Record<string, CaseFactValue>;
}

export class ActionSnapshotError extends Error {
  constructor(message: string) { super(message); this.name = "ActionSnapshotError"; }
}

/** Builds the snapshot of a PROPOSED action from the Case it was derived from. Throws on any mismatch. */
export function buildActionSnapshot(action: PartnerSuggestedAction, c: PartnerCase): PartnerActionSnapshot {
  if (action.status !== "PROPOSED") throw new ActionSnapshotError(`only a PROPOSED action can be snapshotted (got ${action.status})`);
  if (action.sourceCaseId !== c.id || action.subjectId !== c.subjectId || action.subjectType !== c.subjectType) {
    throw new ActionSnapshotError("action and Case do not match");
  }
  const caseFacts: Record<string, CaseFactValue> = {};
  for (const f of c.facts) {
    const field = f.field;
    if (typeof field !== "string" || field.length === 0) throw new ActionSnapshotError("Case fact without a field name");
    if (field in caseFacts) throw new ActionSnapshotError(`duplicate Case fact field ${field}`);
    caseFacts[field] = f.value;
  }
  // Structured clone through JSON keeps the snapshot a plain, detached data object.
  const copy = JSON.parse(JSON.stringify(action)) as PartnerSuggestedAction;
  return { ...copy, snapshotSchemaVersion: ACTION_SNAPSHOT_SCHEMA_VERSION, caseType: c.caseType, caseSchemaVersion: c.schemaVersion, caseFacts };
}

/** SHA-256 over the canonical serialization (64 lowercase hex). */
export function hashActionSnapshot(snapshot: unknown): string {
  return canonicalSha256(snapshot);
}

/** The value context (last) and original trigger (first) of the snapshot's causal chain. */
export function snapshotContextIds(s: Pick<PartnerSuggestedAction, "sourceContextIds">): { triggerContextId: string | null; valueContextId: string | null } {
  const ids = s.sourceContextIds;
  return { triggerContextId: ids.length > 1 ? ids[0] : null, valueContextId: ids.length ? ids[ids.length - 1] : null };
}
