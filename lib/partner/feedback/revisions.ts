/**
 * Redbloods Partner — Structured Owner Feedback (Phase F.1, Schema
 * Hardening). Append-only revision model. Pure, no I/O.
 *
 * Feedback history is APPEND-ONLY (Owner instruction §2): changing your
 * mind means INSERTing a new row with `supersedesId` pointing at the prior
 * one — never an UPDATE, never a DELETE. This module never mutates a
 * PartnerFeedback; it only reads an array and derives which records are
 * "current" (the latest, non-superseded record in each revision chain).
 *
 * Two safety properties, both re-checked here even though the DB layer
 * (once approved) will also enforce the first one structurally:
 *   1. NO BRANCHING — at most one direct successor per row (DB: a UNIQUE
 *      index on supersedes_id where not null).
 *   2. TARGET CONSISTENCY — a revision must refer to the SAME logical
 *      target as the record it supersedes (Owner instruction §4): a
 *      feedback row about task X can never supersede a row about project Y.
 *      The DB cannot practically express this as a CHECK constraint across
 *      a self-referencing row without a recursive lookup, so it stays an
 *      APPLICATION-level check — this file is that check's single source
 *      of truth.
 */
import type { FeedbackValidationResult } from "./validate";
import type { FeedbackTarget, PartnerFeedback } from "./types";

/**
 * True when two targets refer to the SAME logical thing a revision is
 * allowed to supersede. Deliberately scope-exact (a CASE_INSTANCE
 * revision can only supersede another CASE_INSTANCE record about the SAME
 * caseId — it can never "upgrade" into a CASE_TYPE revision by itself;
 * broadening scope is always a NEW, separately-scoped feedback record, not
 * a revision of an instance-scoped one).
 */
export function targetsMatch(a: FeedbackTarget, b: FeedbackTarget): boolean {
  if (a.scope !== b.scope) return false;
  switch (a.scope) {
    case "CASE_INSTANCE":
      return a.caseId === (b as typeof a).caseId;
    case "CASE_TYPE":
      return a.caseType === (b as typeof a).caseType;
    case "SUBJECT":
      return a.subjectType === (b as typeof a).subjectType && a.subjectId === (b as typeof a).subjectId;
    case "RULE_APPLICATION":
      return a.ownerRuleId === (b as typeof a).ownerRuleId && a.caseType === (b as typeof a).caseType;
    case "HYPOTHESIS":
      return a.caseId === (b as typeof a).caseId && a.hypothesisId === (b as typeof a).hypothesisId;
    case "THRESHOLD_PROPOSAL":
      return a.proposalId === (b as typeof a).proposalId;
    default:
      return false;
  }
}

const ok = (errors: string[] = [], warnings: string[] = []): FeedbackValidationResult => ({ valid: errors.length === 0, errors, warnings });

/**
 * Validates that `revision` is a legal supersession of `prior` — same
 * logical target, and `revision.supersedesId` actually points at
 * `prior.id`. Called at write time (before an append), never at read time
 * (already-stored history is trusted once it passed this check on the way in).
 */
export function validateSupersession(revision: PartnerFeedback, prior: PartnerFeedback): FeedbackValidationResult {
  const errors: string[] = [];
  if (revision.supersedesId !== prior.id) {
    errors.push(`revision.supersedesId (${String(revision.supersedesId)}) does not match prior.id (${prior.id})`);
  }
  if (!targetsMatch(revision.target, prior.target)) {
    errors.push(`revision target (${revision.target.scope}) does not match the prior record's target (${prior.target.scope}) — a revision must refer to the SAME logical target it supersedes (Owner instruction §4)`);
  }
  return ok(errors);
}

/**
 * Given the FULL append-only history, returns only the "current" record per
 * revision chain: whichever record is never referenced by any other
 * record's `supersedesId`. Records with no revisions at all are trivially
 * current. Assumes well-formed input (no branching) — see
 * findRevisionBranches to verify that assumption before relying on this.
 */
export function resolveCurrentRevisions(feedback: readonly PartnerFeedback[]): PartnerFeedback[] {
  const superseded = new Set(feedback.map((f) => f.supersedesId).filter((id): id is string => id !== null));
  return feedback.filter((f) => !superseded.has(f.id));
}

/**
 * Defensive read-side check: finds any `supersedesId` referenced by MORE
 * THAN ONE record (a branch — should be structurally impossible once the
 * DB's UNIQUE index on supersedes_id is in place, but this file never
 * trusts that from the read side alone).
 */
export function findRevisionBranches(feedback: readonly PartnerFeedback[]): Array<{ supersedesId: string; branchIds: string[] }> {
  const bySupersedes = new Map<string, string[]>();
  for (const f of feedback) {
    if (f.supersedesId === null) continue;
    const list = bySupersedes.get(f.supersedesId) ?? [];
    list.push(f.id);
    bySupersedes.set(f.supersedesId, list);
  }
  return [...bySupersedes.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([supersedesId, branchIds]) => ({ supersedesId, branchIds: [...branchIds].sort() }))
    .sort((a, b) => a.supersedesId.localeCompare(b.supersedesId));
}
