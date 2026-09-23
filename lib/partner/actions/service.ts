/**
 * Redbloods Partner — Action decision + execution primitives, CORE (Phase F.1H).
 *
 * Dependencies are injected (live Partner view, Action Event store, clock,
 * audit log) so tests drive this exact logic without any database. The
 * server binding (action-service.ts) supplies the authenticated Owner actor
 * (requireOwner) and the real stores; there is no route, no UI and no
 * automatic executor in this phase.
 *
 * Trust boundary: the caller supplies only ids, a decision code, the snapshot
 * hash it was shown, the head it saw and a request id (+ a structured defer
 * choice). It can never supply the snapshot, from / to values or the actor —
 * those come from live re-derivation and the server session.
 *
 * decideSuggestedActionCore  — APPROVE / NOT_NOW / REJECT after live re-derivation
 *                              (no write when stale / not derivable / changed).
 * executeApprovedActionCore  — revalidates an APPROVED snapshot, then calls ONLY the
 *                              approved DB RPC, which owns locks, CAS, STALE / EXECUTED
 *                              and the atomic mutation + audit. TypeScript never
 *                              updates projects.
 */
import type { PartnerCase } from "../cases/types";
import type { PersistedOwnerContext } from "../investigation/context-row";
import { deriveCaseDecisionState } from "../investigation/decision-state";
import { resolveDeferUntil } from "./defer";
import { LOWER_UUID_RE, SUPPORTED_ACTION_SCHEMA_VERSION, type DeferChoice, type OwnerDecisionEventType, type PartnerActionEvent } from "./events";
import type { ActionEventStore, DecisionAppendResult, DbErrorClass } from "./event-persistence";
import { buildActionSnapshot, hashActionSnapshot, snapshotContextIds, type PartnerActionSnapshot } from "./snapshot";
import { revalidateSuggestedAction } from "./suggested";
import type { PartnerSuggestedAction } from "./types";

// ── injected dependencies ──

export type LiveActionLookup =
  | { status: "FOUND"; action: PartnerSuggestedAction; caseRef: PartnerCase }
  | { status: "NOT_DERIVABLE" }
  | { status: "READ_FAILED"; detail: string };

export type LiveCaseView =
  | { status: "OK"; caseRef: PartnerCase | null; contexts: PersistedOwnerContext[]; derived: PartnerSuggestedAction[] }
  | { status: "READ_FAILED"; detail: string };

export interface ActionLiveView {
  /** Rebuilds live Cases + Owner Context and re-derives: the action with this exact id, if it is derivable now. */
  findAction(actionId: string): Promise<LiveActionLookup>;
  /** The live Case (null if it no longer exists), its full Owner Context history and its currently derived actions. */
  loadCaseView(caseId: string): Promise<LiveCaseView>;
}

export interface ActionServiceDeps {
  now(): Date;
  store: ActionEventStore;
  live: ActionLiveView;
  /** Structured server-side audit log (no secrets). */
  audit(event: string, data: Record<string, unknown>): void;
}

/** The authenticated Owner — supplied ONLY by the server binding from the session. */
export interface OwnerActor { userId: string }

// ── decision ──

export type OwnerDecisionCode = "APPROVE" | "NOT_NOW" | "REJECT" | "CHANGE_VALUE";
const DECISION_TO_EVENT: Record<Exclude<OwnerDecisionCode, "CHANGE_VALUE">, OwnerDecisionEventType> = { APPROVE: "APPROVED", NOT_NOW: "NOT_NOW", REJECT: "REJECTED" };

const DECIDE_KEYS = ["actionId", "decision", "seenSnapshotHash", "expectedHeadEventId", "requestId", "deferChoice", "deferUntil", "note"];
/** Values only the server may determine — a caller supplying any of them is rejected outright. */
const SERVER_OWNED_KEYS = ["snapshot", "actionSnapshot", "snapshotHash", "from", "to", "proposedChange", "actor", "actorUserId", "actorKind", "eventType", "supersedesEventId", "revalidation", "execution"];

export type DecideResult =
  | DecisionAppendResult
  | { status: "INVALID_INPUT"; errors: string[] }
  | { status: "USE_OWNER_CONTEXT_FLOW"; questionType: "WHAT_IS_NEW_PROJECT_DEADLINE"; actionId: string }
  | { status: "NOT_DERIVABLE" }
  | { status: "STALE"; actionStatus: string; reasons: string[] }
  | { status: "PROPOSAL_CHANGED"; currentSnapshotHash: string }
  | { status: "LIVE_READ_FAILED"; detail: string };

interface ParsedDecide {
  actionId: string; decision: OwnerDecisionCode; seenSnapshotHash: string; expectedHeadEventId: string | null;
  requestId: string; deferChoice: DeferChoice | null; deferUntil: string | null; note: string | null;
}

function parseDecideInput(input: unknown): { ok: true; value: ParsedDecide } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["input must be an object"] };
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(raw)) {
    if (SERVER_OWNED_KEYS.includes(k)) errors.push(`"${k}" is determined by the server and cannot be supplied`);
    else if (!DECIDE_KEYS.includes(k)) errors.push(`unknown key "${k}"`);
  }
  if (typeof raw.actionId !== "string" || !raw.actionId.startsWith("UPDATE_PROJECT_DEADLINE:") || raw.actionId.length > 300) errors.push("actionId: invalid");
  if (!["APPROVE", "NOT_NOW", "REJECT", "CHANGE_VALUE"].includes(raw.decision as string)) errors.push("decision must be APPROVE | NOT_NOW | REJECT | CHANGE_VALUE");
  const isChange = raw.decision === "CHANGE_VALUE";
  if (!isChange) {
    if (typeof raw.seenSnapshotHash !== "string" || !/^[0-9a-f]{64}$/.test(raw.seenSnapshotHash)) errors.push("seenSnapshotHash must be 64 lowercase hex");
    if (!(raw.expectedHeadEventId === null || (typeof raw.expectedHeadEventId === "string" && LOWER_UUID_RE.test(raw.expectedHeadEventId)))) errors.push("expectedHeadEventId must be a lowercase uuid or null");
    if (typeof raw.requestId !== "string" || !LOWER_UUID_RE.test(raw.requestId)) errors.push("requestId must be a lowercase uuid");
  }
  const deferChoice = raw.deferChoice ?? null;
  const deferUntil = raw.deferUntil ?? null;
  if (raw.decision === "NOT_NOW") {
    if (deferChoice !== null && !["LATER_TODAY", "TOMORROW", "IN_3_DAYS", "IN_1_WEEK", "CUSTOM"].includes(deferChoice as string)) errors.push("deferChoice must be LATER_TODAY | TOMORROW | IN_3_DAYS | IN_1_WEEK | CUSTOM (omit for the system default)");
    if (deferUntil !== null && deferChoice !== "CUSTOM") errors.push("deferUntil may only be supplied with CUSTOM");
    if (deferChoice === "CUSTOM" && typeof deferUntil !== "string") errors.push("CUSTOM requires deferUntil");
  } else if (deferChoice !== null || deferUntil !== null) errors.push("defer fields are only valid for NOT_NOW");
  const note = raw.note ?? null;
  if (note !== null && (typeof note !== "string" || note.length > 2000)) errors.push("note must be a string of at most 2000 characters");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      actionId: raw.actionId as string, decision: raw.decision as OwnerDecisionCode,
      seenSnapshotHash: (raw.seenSnapshotHash as string) ?? "", expectedHeadEventId: (raw.expectedHeadEventId as string | null) ?? null,
      requestId: (raw.requestId as string) ?? "", deferChoice: deferChoice as DeferChoice | null, deferUntil: deferUntil as string | null, note: note as string | null,
    },
  };
}

export async function decideSuggestedActionCore(deps: ActionServiceDeps, actor: OwnerActor, input: unknown): Promise<DecideResult> {
  if (!actor || !LOWER_UUID_RE.test(actor.userId)) return { status: "INVALID_INPUT", errors: ["no authenticated Owner actor"] };
  const p = parseDecideInput(input);
  if (!p.ok) return { status: "INVALID_INPUT", errors: p.errors };
  const d = p.value;

  // CHANGE_VALUE is never an Action Event: it is a revision of the value question in the Owner Context flow.
  if (d.decision === "CHANGE_VALUE") return { status: "USE_OWNER_CONTEXT_FLOW", questionType: "WHAT_IS_NEW_PROJECT_DEADLINE", actionId: d.actionId };

  // Live re-derivation — the only source of the snapshot.
  const live = await deps.live.findAction(d.actionId);
  if (live.status === "READ_FAILED") return { status: "LIVE_READ_FAILED", detail: live.detail };
  if (live.status === "NOT_DERIVABLE") return { status: "NOT_DERIVABLE" };
  if (live.action.status !== "PROPOSED") return { status: "STALE", actionStatus: live.action.status, reasons: live.action.blockingReasons };
  let snapshot: PartnerActionSnapshot, hash: string;
  try { snapshot = buildActionSnapshot(live.action, live.caseRef); hash = hashActionSnapshot(snapshot); } catch (e) {
    return { status: "INVARIANT_VIOLATION", detail: `snapshot could not be built: ${(e as Error).message}` };
  }
  if (hash !== d.seenSnapshotHash) return { status: "PROPOSAL_CHANGED", currentSnapshotHash: hash };

  let deferChoice: DeferChoice | null = null, deferUntil: string | null = null;
  if (d.decision === "NOT_NOW") {
    const r = resolveDeferUntil(d.deferChoice ?? "SYSTEM_DEFAULT", deps.now(), d.deferChoice === "CUSTOM" ? d.deferUntil : null);
    if (!r.ok) return { status: "INVALID_INPUT", errors: [r.error] };
    deferChoice = r.deferChoice; deferUntil = r.deferUntil;
  }

  const result = await deps.store.appendDecision({
    requestId: d.requestId, actionId: d.actionId, eventType: DECISION_TO_EVENT[d.decision], expectedHeadEventId: d.expectedHeadEventId,
    actorUserId: actor.userId, snapshot, snapshotHash: hash, deferChoice, deferUntil, note: d.note,
    revalidation: { derivedAt: deps.now().toISOString(), actionStatus: live.action.status, preconditions: live.action.preconditions },
  });
  deps.audit("partner_action_decision", { actionId: d.actionId, decision: d.decision, requestId: d.requestId, result: result.status });
  return result;
}

// ── execution ──

export const RPC_RESULTS = ["EXECUTED", "STALE_AT_EXECUTION", "REPLAY", "ALREADY_EXECUTED", "APPROVAL_NOT_CURRENT", "APPROVAL_NOT_FOUND", "ACTION_MISMATCH", "REQUEST_ID_CONFLICT"] as const;
export type RpcResultCode = (typeof RPC_RESULTS)[number];

export type ExecuteResult =
  | { status: RpcResultCode; eventId: string | null; eventType: string | null; reasons: string[]; from: string | null; to: string | null }
  | { status: "INVALID_INPUT"; errors: string[] }
  | { status: "RETRYABLE"; detail: string; sqlstate: string | null }
  | { status: "INVARIANT_VIOLATION"; detail: string }
  | { status: "FAILED"; detail: string };

const EXECUTE_KEYS = ["approvalEventId", "requestId"];

/** Strict mapping of the RPC's jsonb result; anything unexpected fails closed. */
export function mapRpcResult(data: unknown): ExecuteResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { status: "INVARIANT_VIOLATION", detail: "RPC returned a non-object result" };
  const r = data as Record<string, unknown>;
  if (!(RPC_RESULTS as readonly unknown[]).includes(r.result)) return { status: "INVARIANT_VIOLATION", detail: `unknown RPC result ${JSON.stringify(r.result)}` };
  const eventId = typeof r.eventId === "string" && LOWER_UUID_RE.test(r.eventId) ? r.eventId : null;
  const needsEvent = r.result === "EXECUTED" || r.result === "STALE_AT_EXECUTION" || r.result === "REPLAY" || r.result === "ALREADY_EXECUTED";
  if (needsEvent && !eventId) return { status: "INVARIANT_VIOLATION", detail: `RPC result ${String(r.result)} without a valid eventId` };
  return {
    status: r.result as RpcResultCode,
    eventId,
    eventType: typeof r.eventType === "string" ? r.eventType : r.result === "EXECUTED" || r.result === "STALE_AT_EXECUTION" ? (r.result as string) : null,
    reasons: Array.isArray(r.reasons) ? r.reasons.filter((x): x is string => typeof x === "string") : [],
    from: typeof r.from === "string" ? r.from : null,
    to: typeof r.to === "string" ? r.to : null,
  };
}

function mapRpcError(cls: DbErrorClass, detail: string, sqlstate: string | null): ExecuteResult {
  if (cls === "RETRYABLE" || cls === "UNIQUE_VIOLATION") return { status: "RETRYABLE", detail, sqlstate };
  if (cls === "INVARIANT_VIOLATION" || cls === "INVALID_REQUEST" || cls === "CHECK_VIOLATION" || cls === "FK_VIOLATION") return { status: "INVARIANT_VIOLATION", detail };
  return { status: "FAILED", detail };
}

export async function executeApprovedActionCore(deps: ActionServiceDeps, actor: OwnerActor, input: unknown): Promise<ExecuteResult> {
  if (!actor || !LOWER_UUID_RE.test(actor.userId)) return { status: "INVALID_INPUT", errors: ["no authenticated Owner actor"] };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { status: "INVALID_INPUT", errors: ["input must be an object"] };
  const raw = input as Record<string, unknown>;
  const errors = Object.keys(raw).filter((k) => !EXECUTE_KEYS.includes(k)).map((k) => `"${k}" cannot be supplied`);
  if (typeof raw.approvalEventId !== "string" || !LOWER_UUID_RE.test(raw.approvalEventId)) errors.push("approvalEventId must be a lowercase uuid");
  if (typeof raw.requestId !== "string" || !LOWER_UUID_RE.test(raw.requestId)) errors.push("requestId must be a lowercase uuid");
  if (errors.length) return { status: "INVALID_INPUT", errors };
  const approvalEventId = raw.approvalEventId as string, requestId = raw.requestId as string;

  // 1-2. The APPROVED event and its supported schema.
  const ev = await deps.store.getEventById(approvalEventId);
  if (ev.status === "READ_FAILED") return { status: "RETRYABLE", detail: ev.detail, sqlstate: null };
  if (ev.status === "INVALID_STORED_EVENT") return { status: "INVARIANT_VIOLATION", detail: ev.errors.join("; ") };
  if (ev.status === "NOT_FOUND" || ev.event.eventType !== "APPROVED") return { status: "APPROVAL_NOT_FOUND", eventId: null, eventType: null, reasons: [], from: null, to: null };
  const approval: PartnerActionEvent = ev.event;
  const snap = approval.snapshot;
  if (snap.schemaVersion !== SUPPORTED_ACTION_SCHEMA_VERSION || snap.actionType !== "UPDATE_PROJECT_DEADLINE") return { status: "INVARIANT_VIOLATION", detail: "unsupported approved snapshot schema / action type" };

  // 3-6. Live revalidation of the exact approved snapshot (never trusted blindly; the RPC re-checks under locks).
  const view = await deps.live.loadCaseView(snap.sourceCaseId);
  if (view.status === "READ_FAILED") return { status: "RETRYABLE", detail: `live state unreadable — nothing executed: ${view.detail}`, sqlstate: null };
  const reasons = new Set<string>();
  const re = revalidateSuggestedAction(snap, { case: view.caseRef, caseContextHistory: view.contexts });
  if (re.status !== "PROPOSED") for (const b of re.blockingReasons) reasons.add(b);
  const derivedNow = view.derived.find((a) => a.id === approval.actionId);
  if (!derivedNow || derivedNow.status !== "PROPOSED" || !view.caseRef) reasons.add("ACTION_NOT_DERIVABLE");
  else {
    try { if (hashActionSnapshot(buildActionSnapshot(derivedNow, view.caseRef)) !== approval.snapshotHash) reasons.add("SNAPSHOT_CHANGED"); } catch { reasons.add("SNAPSHOT_CHANGED"); }
  }
  // Expected trigger head = the CURRENT row of the value context's trigger chain (continuity already judged by the decision state).
  let expectedHead: string | null = null;
  const { valueContextId } = snapshotContextIds(snap);
  if (view.caseRef && valueContextId) {
    const ds = deriveCaseDecisionState(view.caseRef, view.contexts);
    const v = ds.ownerContexts.find((x) => x.contextId === valueContextId);
    expectedHead = v?.effectiveTriggerContextId ?? null;
  }

  // 7-8. ONLY the approved RPC performs the locks, CAS, STALE / EXECUTED and the atomic mutation + audit.
  const rpc = await deps.store.callExecuteRpc({
    p_request_id: requestId,
    p_approval_event_id: approvalEventId,
    p_action_id: approval.actionId,
    p_actor_user_id: actor.userId,
    p_expected_trigger_head_id: expectedHead,
    p_app_stale_reasons: [...reasons].sort(),
    p_revalidation: { revalidatedAt: deps.now().toISOString(), appStaleReasons: [...reasons].sort(), expectedTriggerHead: expectedHead },
  });
  if (rpc.status === "RPC_ERROR") {
    const out = mapRpcError(rpc.errorClass, rpc.error.message ?? "", rpc.error.code ?? null);
    deps.audit("partner_action_execute_error", { approvalEventId, requestId, actionId: approval.actionId, sqlstate: rpc.error.code ?? null, errorClass: rpc.errorClass, result: out.status });
    return out;
  }
  const out = mapRpcResult(rpc.data);
  deps.audit("partner_action_execute", { approvalEventId, requestId, actionId: approval.actionId, result: out.status });
  return out;
}
