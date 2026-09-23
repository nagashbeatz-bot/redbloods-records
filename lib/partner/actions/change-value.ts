/**
 * Redbloods Partner — "שנה תאריך" (CHANGE_VALUE) core (Phase F.1J).
 *
 * CHANGE_VALUE is NEVER an Action Event. It revises the Owner's answer to the
 * existing follow-up question WHAT_IS_NEW_PROJECT_DEADLINE through the
 * existing append-only Owner Context mechanism:
 *   1. the action the Owner was looking at must still be derived, PROPOSED and
 *      byte-identical (seen snapshot hash) — otherwise nothing is written;
 *   2. the question is rebuilt by the investigation model itself
 *      (buildFollowUpQuestions), in the SAME slot / trigger as the current value
 *      context, and the draft by buildOwnerContextDraft;
 *   3. appendOwnerContext() validates and writes a NEW row with
 *      supersedesId = the current value context (resolved server-side from the
 *      Asia/Jerusalem calendar; the caller never supplies a resolved value).
 * The project is never touched. The next derivation yields a NEW deterministic
 * action id (it contains the new context id); the old one stops being current.
 *
 * Dependencies are injected (tests never touch production).
 */
import type { PersistedOwnerContext } from "../investigation/context-row";
import { OwnerContextStoreError, buildOwnerContextDraft, type OwnerContextDraft } from "../investigation/context-persistence";
import { applicableContexts } from "../investigation/context-applicability";
import { buildFollowUpQuestions } from "../investigation/questions";
import { isValidYmd } from "../investigation/answer-value";
import { buildActionSnapshot, hashActionSnapshot, snapshotContextIds } from "./snapshot";
import type { ActionLiveView } from "./service";
import { CHANGE_VALUE_ANSWER_CODES, type ChangeValueAnswerCode } from "./surface-dto";

export interface ChangeValueDeps {
  live: ActionLiveView;
  appendOwnerContext(draft: OwnerContextDraft): Promise<PersistedOwnerContext>;
  audit(event: string, data: Record<string, unknown>): void;
}

export type ChangeValueResult =
  | { status: "CONTEXT_REVISED"; contextId: string; supersedesId: string; newDeadline: string }
  | { status: "INVALID_INPUT"; errors: string[] }
  | { status: "NOT_DERIVABLE" }
  | { status: "STALE"; reasons: string[] }
  | { status: "PROPOSAL_CHANGED" }
  | { status: "LIVE_READ_FAILED"; detail: string }
  | { status: "INVARIANT_VIOLATION"; detail: string }
  | { status: "FAILED"; detail: string };

const KEYS = ["actionId", "seenSnapshotHash", "answerCode", "explicitDateYmd"];

export async function changeSuggestedActionValueCore(deps: ChangeValueDeps, input: unknown): Promise<ChangeValueResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { status: "INVALID_INPUT", errors: ["input must be an object"] };
  const raw = input as Record<string, unknown>;
  const errors = Object.keys(raw).filter((k) => !KEYS.includes(k)).map((k) => `"${k}" cannot be supplied`);
  if (typeof raw.actionId !== "string" || !raw.actionId.startsWith("UPDATE_PROJECT_DEADLINE:") || raw.actionId.length > 300) errors.push("actionId: invalid");
  if (typeof raw.seenSnapshotHash !== "string" || !/^[0-9a-f]{64}$/.test(raw.seenSnapshotHash)) errors.push("seenSnapshotHash must be 64 lowercase hex");
  if (!(CHANGE_VALUE_ANSWER_CODES as readonly unknown[]).includes(raw.answerCode)) errors.push(`answerCode must be one of ${CHANGE_VALUE_ANSWER_CODES.join(" | ")}`);
  const explicit = raw.explicitDateYmd ?? null;
  if (raw.answerCode === "SPECIFIC_DATE" ? !isValidYmd(explicit) : explicit !== null) errors.push("explicitDateYmd is required (YYYY-MM-DD) exactly for SPECIFIC_DATE");
  if (errors.length) return { status: "INVALID_INPUT", errors };
  const actionId = raw.actionId as string, answerCode = raw.answerCode as ChangeValueAnswerCode;

  // 1. The exact proposal the Owner saw.
  const live = await deps.live.findAction(actionId);
  if (live.status === "READ_FAILED") return { status: "LIVE_READ_FAILED", detail: live.detail };
  if (live.status === "NOT_DERIVABLE") return { status: "NOT_DERIVABLE" };
  if (live.action.status !== "PROPOSED") return { status: "STALE", reasons: live.action.blockingReasons };
  let hash: string;
  try { hash = hashActionSnapshot(buildActionSnapshot(live.action, live.caseRef)); } catch (e) { return { status: "INVARIANT_VIOLATION", detail: (e as Error).message }; }
  if (hash !== raw.seenSnapshotHash) return { status: "PROPOSAL_CHANGED" };

  // 2. The existing question, in the same slot as the current value answer.
  const view = await deps.live.loadCaseView(live.caseRef.id);
  if (view.status === "READ_FAILED") return { status: "LIVE_READ_FAILED", detail: view.detail };
  if (!view.caseRef) return { status: "NOT_DERIVABLE" };
  const { valueContextId } = snapshotContextIds(live.action);
  const current = view.contexts.find((c) => c.id === valueContextId);
  if (!current || current.questionType !== "WHAT_IS_NEW_PROJECT_DEADLINE" || current.triggerContextId === null) return { status: "STALE", reasons: ["VALUE_CONTEXT_APPLICABLE"] };
  const question = buildFollowUpQuestions(view.caseRef, applicableContexts(view.contexts), { [current.questionId]: current.triggerContextId })
    .find((q) => q.questionType === "WHAT_IS_NEW_PROJECT_DEADLINE" && q.id === current.questionId);
  if (!question || question.origin.kind !== "OWNER_CONTEXT" || question.origin.triggerContextId !== current.triggerContextId) return { status: "STALE", reasons: ["TRIGGER_CONTEXT_APPLICABLE"] };

  // 3. Append-only revision through the existing store (it validates + resolves the value server-side).
  const draft = buildOwnerContextDraft(question, view.caseRef.schemaVersion, {
    answerCode, explicitDateYmd: answerCode === "SPECIFIC_DATE" ? (explicit as string) : null, supersedesId: current.id, note: null,
  });
  try {
    const saved = await deps.appendOwnerContext(draft);
    deps.audit("partner_action_change_value", { actionId, supersedesId: current.id, contextId: saved.id, answerCode });
    return { status: "CONTEXT_REVISED", contextId: saved.id, supersedesId: current.id, newDeadline: saved.answerValue?.ymd ?? "" };
  } catch (e) {
    if (e instanceof OwnerContextStoreError) {
      if (e.code === "REVISION_BRANCH_CONFLICT" || e.code === "ANSWER_EXISTS_USE_REVISION") return { status: "PROPOSAL_CHANGED" };
      if (e.code === "INVALID_ANSWER_VALUE" || e.code === "INVALID_ANSWER_CODE" || e.code === "VALIDATION_FAILED") return { status: "INVALID_INPUT", errors: [e.message, ...e.details] };
      if (e.code === "INVALID_TRIGGER" || e.code === "REVISION_TARGET_MISMATCH" || e.code === "SUPERSEDED_NOT_FOUND") return { status: "STALE", reasons: [e.code] };
      if (e.code === "READ_FAILED" || e.code === "WRITE_FAILED") return { status: "FAILED", detail: e.message };
      return { status: "INVARIANT_VIOLATION", detail: e.message };
    }
    return { status: "FAILED", detail: (e as Error).message };
  }
}
