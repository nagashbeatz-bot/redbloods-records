/**
 * Redbloods Partner — Finance Action decision + execution, CORE (Phase F2.31). Dependencies are injected.
 *
 * RECORD_PAID_EXPENSE (Victor monthly salary) only. Same trust boundary as the deadline Action:
 *   decide  — the caller supplies ids, a decision code, the snapshot hash it was shown, the head it saw and a
 *             request id; the snapshot is ALWAYS re-derived live (never supplied). APPROVE writes ONLY an
 *             APPROVED Action Event — no transaction, no RPC, no config change.
 *   execute — the caller supplies ONLY approvalEventId + requestId. The server re-derives the live candidate,
 *             turns every difference into an audit reason, then calls ONLY the approved DB RPC
 *             (partner_execute_record_paid_expense), which owns the locks, the stale checks, the business-key
 *             uniqueness, the ONE canonical insert and the EXECUTED / STALE_AT_EXECUTION audit (atomic).
 *             TypeScript never inserts a transaction.
 */
import { resolveDeferUntil } from "../actions/defer";
import { LOWER_UUID_RE, type DeferChoice } from "../actions/events";
import type { DbErrorClass, FinanceActionEventWriter, FinanceDecisionAppendResult } from "../actions/event-persistence";
import { FINANCE_ACTION_TYPE, type PartnerFinanceActionEvent } from "../actions/finance-events";
import type { FinanceActionCandidate } from "./actions";

export type FinanceLiveCandidates = { status: "OK"; candidates: FinanceActionCandidate[] } | { status: "READ_FAILED"; detail: string };

export interface FinanceActionServiceDeps {
  now(): Date;
  store: FinanceActionEventWriter;
  /** One live finance derivation (canonical read + ACTIVE Owner answers → readiness). Read-only. */
  live: { loadCandidates(): Promise<FinanceLiveCandidates> };
  audit(event: string, data: Record<string, unknown>): void;
}
export interface FinanceOwnerActor { userId: string }

export const isFinanceActionId = (v: unknown): v is string => typeof v === "string" && v.startsWith(`${FINANCE_ACTION_TYPE}:`) && v.length <= 300;

// ── decision ──

const DECIDE_KEYS = ["actionId", "decision", "seenSnapshotHash", "expectedHeadEventId", "requestId", "deferChoice", "deferUntil", "note"];
const SERVER_OWNED = ["snapshot", "actionSnapshot", "snapshotHash", "facts", "amount", "currency", "date", "description", "status", "actor", "actorUserId", "eventType", "supersedesEventId", "revalidation", "execution", "transaction"];

export type FinanceDecideResult =
  | FinanceDecisionAppendResult
  | { status: "INVALID_INPUT"; errors: string[] }
  | { status: "NOT_DERIVABLE" }
  | { status: "STALE"; actionStatus: string; reasons: string[] }
  | { status: "PROPOSAL_CHANGED"; currentSnapshotHash: string }
  | { status: "LIVE_READ_FAILED"; detail: string };

function findLive(candidates: FinanceActionCandidate[], actionId: string) {
  return candidates.find((c) => c.actionType === FINANCE_ACTION_TYPE && c.id === actionId) ?? null;
}

export async function decideFinanceActionCore(deps: FinanceActionServiceDeps, actor: FinanceOwnerActor, input: unknown): Promise<FinanceDecideResult> {
  if (!actor || !LOWER_UUID_RE.test(actor.userId)) return { status: "INVALID_INPUT", errors: ["no authenticated Owner actor"] };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { status: "INVALID_INPUT", errors: ["input must be an object"] };
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(raw)) {
    if (SERVER_OWNED.includes(k)) errors.push(`"${k}" is determined by the server and cannot be supplied`);
    else if (!DECIDE_KEYS.includes(k)) errors.push(`unknown key "${k}"`);
  }
  if (!isFinanceActionId(raw.actionId)) errors.push("actionId: invalid");
  if (raw.decision !== "APPROVE" && raw.decision !== "NOT_NOW") errors.push("decision must be APPROVE | NOT_NOW");
  if (typeof raw.seenSnapshotHash !== "string" || !/^[0-9a-f]{64}$/.test(raw.seenSnapshotHash)) errors.push("seenSnapshotHash must be 64 lowercase hex");
  if (!(raw.expectedHeadEventId === null || raw.expectedHeadEventId === undefined || (typeof raw.expectedHeadEventId === "string" && LOWER_UUID_RE.test(raw.expectedHeadEventId)))) errors.push("expectedHeadEventId must be a lowercase uuid or null");
  if (typeof raw.requestId !== "string" || !LOWER_UUID_RE.test(raw.requestId)) errors.push("requestId must be a lowercase uuid");
  const deferChoice = (raw.deferChoice ?? null) as DeferChoice | null;
  const deferUntilIn = (raw.deferUntil ?? null) as string | null;
  if (raw.decision === "NOT_NOW") {
    if (deferChoice !== null && !["LATER_TODAY", "TOMORROW", "IN_3_DAYS", "IN_1_WEEK", "CUSTOM"].includes(deferChoice)) errors.push("deferChoice invalid");
    if (deferUntilIn !== null && deferChoice !== "CUSTOM") errors.push("deferUntil may only be supplied with CUSTOM");
    if (deferChoice === "CUSTOM" && typeof deferUntilIn !== "string") errors.push("CUSTOM requires deferUntil");
  } else if (deferChoice !== null || deferUntilIn !== null) errors.push("defer fields are only valid for NOT_NOW");
  const note = raw.note ?? null;
  if (note !== null && (typeof note !== "string" || note.length > 2000)) errors.push("note must be a string of at most 2000 characters");
  if (errors.length) return { status: "INVALID_INPUT", errors };
  const actionId = raw.actionId as string, decision = raw.decision as "APPROVE" | "NOT_NOW";

  // Live re-derivation — the ONLY source of the snapshot.
  const live = await deps.live.loadCandidates();
  if (live.status === "READ_FAILED") return { status: "LIVE_READ_FAILED", detail: live.detail };
  const c = findLive(live.candidates, actionId);
  if (!c) return { status: "NOT_DERIVABLE" };
  if (c.readiness !== "READY_TO_PROPOSE" || !c.executable || !c.eventSnapshot || !c.snapshotHash) return { status: "STALE", actionStatus: c.readiness, reasons: [c.executable ? c.readiness : "EXECUTOR_NOT_VERIFIED"] };
  if (c.snapshotHash !== raw.seenSnapshotHash) return { status: "PROPOSAL_CHANGED", currentSnapshotHash: c.snapshotHash };

  let deferOut: DeferChoice | null = null, deferUntil: string | null = null;
  if (decision === "NOT_NOW") {
    const r = resolveDeferUntil(deferChoice ?? "SYSTEM_DEFAULT", deps.now(), deferChoice === "CUSTOM" ? deferUntilIn : null);
    if (!r.ok) return { status: "INVALID_INPUT", errors: [r.error] };
    deferOut = r.deferChoice; deferUntil = r.deferUntil;
  }
  const result = await deps.store.appendFinanceDecision({
    requestId: raw.requestId as string, actionId, eventType: decision === "APPROVE" ? "APPROVED" : "NOT_NOW",
    expectedHeadEventId: (raw.expectedHeadEventId as string | null | undefined) ?? null, actorUserId: actor.userId,
    snapshot: c.eventSnapshot, snapshotHash: c.snapshotHash, deferChoice: deferOut, deferUntil, note: note as string | null,
    revalidation: { derivedAt: deps.now().toISOString(), readiness: c.readiness, executorStatus: c.executorStatus },
  });
  deps.audit("partner_finance_action_decision", { actionId, decision, requestId: raw.requestId, result: result.status });
  return result;
}

// ── execution ──

export const FINANCE_RPC_RESULTS = ["EXECUTED", "STALE_AT_EXECUTION", "REPLAY", "ALREADY_EXECUTED", "APPROVAL_NOT_CURRENT", "APPROVAL_NOT_FOUND", "ACTION_MISMATCH", "REQUEST_ID_CONFLICT", "UNSUPPORTED_ACTION"] as const;
export type FinanceRpcResultCode = (typeof FINANCE_RPC_RESULTS)[number];

export type FinanceExecuteResult =
  | { kind: "FINANCE"; status: FinanceRpcResultCode; eventId: string | null; eventType: string | null; reasons: string[]; transactionId: string | null }
  | { kind: "FINANCE"; status: "INVALID_INPUT"; errors: string[] }
  | { kind: "FINANCE"; status: "RETRYABLE"; detail: string; sqlstate: string | null }
  | { kind: "FINANCE"; status: "INVARIANT_VIOLATION"; detail: string }
  | { kind: "FINANCE"; status: "FAILED"; detail: string };

const REASON_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Strict mapping of the finance RPC's jsonb result; anything unexpected fails closed. */
export function mapFinanceRpcResult(data: unknown): FinanceExecuteResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { kind: "FINANCE", status: "INVARIANT_VIOLATION", detail: "RPC returned a non-object result" };
  const r = data as Record<string, unknown>;
  if (!(FINANCE_RPC_RESULTS as readonly unknown[]).includes(r.result)) return { kind: "FINANCE", status: "INVARIANT_VIOLATION", detail: `unknown RPC result ${JSON.stringify(r.result)}` };
  const status = r.result as FinanceRpcResultCode;
  const eventId = typeof r.eventId === "string" && LOWER_UUID_RE.test(r.eventId) ? r.eventId : null;
  const transactionId = typeof r.transactionId === "string" && LOWER_UUID_RE.test(r.transactionId) ? r.transactionId : null;
  if ((status === "EXECUTED" || status === "STALE_AT_EXECUTION" || status === "REPLAY" || status === "ALREADY_EXECUTED") && !eventId) return { kind: "FINANCE", status: "INVARIANT_VIOLATION", detail: `RPC result ${status} without a valid eventId` };
  if (status === "EXECUTED" && !transactionId) return { kind: "FINANCE", status: "INVARIANT_VIOLATION", detail: "EXECUTED without a valid transactionId" };
  return {
    kind: "FINANCE", status, eventId,
    eventType: typeof r.eventType === "string" ? r.eventType : status === "EXECUTED" || status === "STALE_AT_EXECUTION" ? status : null,
    reasons: Array.isArray(r.reasons) ? r.reasons.filter((x): x is string => typeof x === "string" && REASON_RE.test(x)) : [],
    transactionId,
  };
}

function mapRpcError(cls: DbErrorClass, detail: string, sqlstate: string | null): FinanceExecuteResult {
  if (cls === "RETRYABLE" || cls === "UNIQUE_VIOLATION") return { kind: "FINANCE", status: "RETRYABLE", detail, sqlstate };
  if (cls === "INVARIANT_VIOLATION" || cls === "INVALID_REQUEST" || cls === "CHECK_VIOLATION" || cls === "FK_VIOLATION") return { kind: "FINANCE", status: "INVARIANT_VIOLATION", detail };
  return { kind: "FINANCE", status: "FAILED", detail };
}

/** App-side revalidation: why the APPROVED snapshot no longer matches what Partner derives from live state now. */
export function financeRevalidationReasons(approval: PartnerFinanceActionEvent, candidates: FinanceActionCandidate[]): string[] {
  const live = candidates.find((c) => c.actionType === FINANCE_ACTION_TYPE && c.subject.id === approval.subjectKey) ?? null;
  if (!live) return ["LIVE_ACTION_NOT_DERIVABLE"];
  if (live.readiness !== "READY_TO_PROPOSE") return [live.readiness];
  if (!live.executable || !live.facts) return ["EXECUTOR_NOT_VERIFIED"];
  if (live.id === approval.actionId) return live.snapshotHash === approval.snapshotHash ? [] : ["SNAPSHOT_CHANGED"];
  const f = approval.snapshot.facts, reasons: string[] = [];
  if (live.facts.amount !== f.amount) reasons.push("SALARY_AMOUNT_CHANGED");
  if (live.facts.currency !== f.currency) reasons.push("SALARY_CURRENCY_CHANGED");
  if (live.facts.date !== f.date) reasons.push("PAYMENT_DATE_CHANGED");
  if (live.ownerContextIds.join("+") !== approval.snapshot.sourceContextIds.join("+")) reasons.push("OWNER_CONTEXT_REVISED");
  return reasons.length ? reasons : ["SNAPSHOT_CHANGED"];
}

export async function executeFinanceActionCore(deps: FinanceActionServiceDeps, actor: FinanceOwnerActor, input: unknown): Promise<FinanceExecuteResult> {
  if (!actor || !LOWER_UUID_RE.test(actor.userId)) return { kind: "FINANCE", status: "INVALID_INPUT", errors: ["no authenticated Owner actor"] };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { kind: "FINANCE", status: "INVALID_INPUT", errors: ["input must be an object"] };
  const raw = input as Record<string, unknown>;
  const errors = Object.keys(raw).filter((k) => k !== "approvalEventId" && k !== "requestId").map((k) => `"${k}" cannot be supplied`);
  if (typeof raw.approvalEventId !== "string" || !LOWER_UUID_RE.test(raw.approvalEventId)) errors.push("approvalEventId must be a lowercase uuid");
  if (typeof raw.requestId !== "string" || !LOWER_UUID_RE.test(raw.requestId)) errors.push("requestId must be a lowercase uuid");
  if (errors.length) return { kind: "FINANCE", status: "INVALID_INPUT", errors };
  const approvalEventId = raw.approvalEventId as string, requestId = raw.requestId as string;

  const ev = await deps.store.getFinanceEventById(approvalEventId);
  if (ev.status === "READ_FAILED") return { kind: "FINANCE", status: "RETRYABLE", detail: ev.detail, sqlstate: null };
  if (ev.status === "INVALID_STORED_EVENT") return { kind: "FINANCE", status: "INVARIANT_VIOLATION", detail: ev.errors.join("; ") };
  if (ev.status === "NOT_FOUND" || ev.event.eventType !== "APPROVED") return { kind: "FINANCE", status: "APPROVAL_NOT_FOUND", eventId: null, eventType: null, reasons: [], transactionId: null };
  const approval = ev.event;

  // Live revalidation: never trusted blindly — the RPC re-checks everything again under locks.
  const live = await deps.live.loadCandidates();
  if (live.status === "READ_FAILED") return { kind: "FINANCE", status: "RETRYABLE", detail: `live finance state unreadable — nothing executed: ${live.detail}`, sqlstate: null };
  const reasons = financeRevalidationReasons(approval, live.candidates).filter((r) => REASON_RE.test(r)).sort();

  const rpc = await deps.store.callFinanceExecuteRpc({
    p_request_id: requestId,
    p_approval_event_id: approvalEventId,
    p_action_id: approval.actionId,
    p_actor_user_id: actor.userId,
    p_app_stale_reasons: reasons,
    p_revalidation: { revalidatedAt: deps.now().toISOString(), appStaleReasons: reasons },
  });
  if (rpc.status === "RPC_ERROR") {
    const out = mapRpcError(rpc.errorClass, rpc.error.message ?? "", rpc.error.code ?? null);
    deps.audit("partner_finance_action_execute_error", { approvalEventId, requestId, actionId: approval.actionId, sqlstate: rpc.error.code ?? null, errorClass: rpc.errorClass, result: out.status });
    return out;
  }
  const out = mapFinanceRpcResult(rpc.data);
  deps.audit("partner_finance_action_execute", { approvalEventId, requestId, actionId: approval.actionId, result: out.status, reasons: out.status === "STALE_AT_EXECUTION" ? (out as { reasons: string[] }).reasons : [] });
  return out;
}
