/**
 * Redbloods Partner — Action Event persistence core (Phase F.1H).
 * Append-only store over public.partner_action_events (F.1G).
 *
 * Same proven shape as the Owner Context / feedback cores:
 *   - the client is INJECTED (tests drive this exact code against an in-memory
 *     fake; production is never written by tests); event-store.ts is the only
 *     file that binds it to the real service-role client and imports "server-only";
 *   - the client surface is select + insert + ONE rpc (the approved execution
 *     RPC). There is no update / delete / upsert path — the DB would reject it
 *     anyway (PARTNER_ACTION_EVENTS_APPEND_ONLY);
 *   - the store only ever inserts Owner DECISION events (APPROVED / NOT_NOW /
 *     REJECTED). EXECUTED / STALE_AT_EXECUTION are written exclusively by the
 *     RPC, atomically with the business mutation;
 *   - reads return discriminated results and fail closed on any unreadable row.
 *
 * request_id is scope-safe: an existing event with the same request_id is a
 * REPLAY only if it matches the whole claimed scope (action, decision type,
 * expected head, actor, NOT_NOW semantics); anything else is
 * REQUEST_ID_CONFLICT — never a success.
 */
import { redactSecrets } from "../feedback/persistence";
import { SHA256_HEX_RE } from "./canonical";
import {
  ACTION_EVENT_COLUMNS, ACTION_EVENT_SCHEMA_VERSION, ACTION_EVENT_TYPES, EXECUTE_RPC, LOWER_UUID_RE, PARTNER_ACTION_EVENTS_TABLE, SUPPORTED_ACTION_SCHEMA_VERSION,
  compareEventOrder, decisionReplayMatches, isAllowedTransition, mapActionEventRow, orderActionChain,
  type ActionEventInsertRow, type ActionEventType, type DecisionRequestScope, type DeferChoice, type OwnerDecisionEventType, type PartnerActionEvent,
} from "./events";
import { hashActionSnapshot, type PartnerActionSnapshot } from "./snapshot";
import { isFinanceActionRow, mapFinanceActionEventRow, type PartnerFinanceActionEvent } from "./finance-events";

// ── injected client ──

export interface ActionEventDbError { code?: string; message?: string; details?: string | null; hint?: string | null }
export interface ActionEventDbResponse<T> { data: T | null; error: ActionEventDbError | null }
export interface ActionEventSelectQuery extends PromiseLike<ActionEventDbResponse<unknown[]>> {
  eq(column: string, value: string): ActionEventSelectQuery;
  order(column: string, options: { ascending: boolean }): ActionEventSelectQuery;
  range(from: number, to: number): ActionEventSelectQuery;
}
export interface ExecuteRpcArgs {
  p_request_id: string;
  p_approval_event_id: string;
  p_action_id: string;
  p_actor_user_id: string;
  p_expected_trigger_head_id: string | null;
  p_app_stale_reasons: string[];
  p_revalidation: Record<string, unknown>;
}
export interface ActionEventTableClient {
  from(table: typeof PARTNER_ACTION_EVENTS_TABLE): {
    select(columns: string): ActionEventSelectQuery;
    insert(row: ActionEventInsertRow): { select(columns: string): { single(): PromiseLike<ActionEventDbResponse<unknown>> } };
  };
  rpc(fn: typeof EXECUTE_RPC, args: ExecuteRpcArgs): PromiseLike<ActionEventDbResponse<unknown>>;
}

// ── DB error classification ──

export type DbErrorClass =
  | "INVARIANT_VIOLATION"   // append-only guard, lock protocol missing, permission — fail closed, never retried
  | "RETRYABLE"             // deadlock / lock timeout / CAS serialization / concurrent unique — tx rolled back; safe to retry with the SAME request_id
  | "UNIQUE_VIOLATION"
  | "CHECK_VIOLATION"
  | "FK_VIOLATION"
  | "INVALID_REQUEST"
  | "FAILED";

export function classifyDbError(e: ActionEventDbError | null | undefined): DbErrorClass {
  const code = e?.code ?? "";
  const msg = `${e?.message ?? ""}`;
  if (code === "42501" || /PARTNER_(OWNER_CONTEXT|ACTION_EVENTS)_APPEND_ONLY/.test(msg)) return "INVARIANT_VIOLATION";
  if (code === "55000" || /PARTNER_LOCK_PROTOCOL_MISSING/.test(msg)) return "INVARIANT_VIOLATION";
  if (code === "40P01" || code === "55P03" || code === "40001") return "RETRYABLE";
  if (code === "23505") return "UNIQUE_VIOLATION";
  if (code === "23514") return "CHECK_VIOLATION";
  if (code === "23503") return "FK_VIOLATION";
  if (code === "22023" || code === "22004" || code === "22P02") return "INVALID_REQUEST";
  return "FAILED";
}
export function describeDbError(e: ActionEventDbError | unknown): string {
  if (e && typeof e === "object") {
    const { code, message } = e as ActionEventDbError;
    return redactSecrets(`${code ?? "no-code"}: ${message ?? "no message"}`);
  }
  return redactSecrets(String(e));
}

// ── results ──

export type EventReadResult =
  | { status: "FOUND"; event: PartnerActionEvent }
  | { status: "NOT_FOUND" }
  | { status: "READ_FAILED"; detail: string }
  | { status: "INVALID_STORED_EVENT"; errors: string[] };

export type EventListReadResult =
  | { status: "OK"; events: PartnerActionEvent[] }
  | { status: "READ_FAILED"; detail: string }
  | { status: "INVALID_STORED_EVENT"; errors: string[] };

export type ActionChainReadResult =
  | { status: "OK"; chain: PartnerActionEvent[]; head: PartnerActionEvent | null }
  | { status: "READ_FAILED"; detail: string }
  | { status: "INVALID_STORED_EVENT"; errors: string[] }
  | { status: "INVALID_CHAIN"; reasons: string[] };

/** F2.29 (read-only): RECORD_PAID_EXPENSE events have their own strict reader; they are never deadline events. */
export type FinanceEventListReadResult =
  | { status: "OK"; events: PartnerFinanceActionEvent[] }
  | { status: "READ_FAILED"; detail: string }
  | { status: "INVALID_STORED_EVENT"; errors: string[] };

export interface DecisionAppendInput {
  requestId: string;
  actionId: string;
  eventType: OwnerDecisionEventType;
  expectedHeadEventId: string | null;
  actorUserId: string;
  snapshot: PartnerActionSnapshot;
  snapshotHash: string;
  deferChoice: DeferChoice | null;
  deferUntil: string | null;
  note: string | null;
  revalidation: Record<string, unknown>;
}

export type DecisionAppendResult =
  | { status: "RECORDED"; event: PartnerActionEvent }
  | { status: "REPLAY"; event: PartnerActionEvent }
  | { status: "REQUEST_ID_CONFLICT" }
  | { status: "ALREADY_IN_STATE"; head: PartnerActionEvent }
  | { status: "ALREADY_EXECUTED"; head: PartnerActionEvent }
  | { status: "HEAD_CONFLICT"; head: PartnerActionEvent | null }
  | { status: "INVALID_TRANSITION"; from: string; to: string }
  | { status: "INVALID_INPUT"; errors: string[] }
  | { status: "RETRYABLE"; detail: string }
  | { status: "INVARIANT_VIOLATION"; detail: string }
  | { status: "FAILED"; detail: string };

export type RpcCallResult = { status: "RPC_OK"; data: unknown } | { status: "RPC_ERROR"; error: ActionEventDbError; errorClass: DbErrorClass };

export interface ActionEventStore {
  getEventById(id: string): Promise<EventReadResult>;
  getEventByRequestId(requestId: string): Promise<EventReadResult>;
  /** The action's whole chain, ordered along supersedes and validated as one line (fail closed). */
  getActionChain(actionId: string): Promise<ActionChainReadResult>;
  /** F.1L (read-only): every stored event of one type, created_at order (e.g. EXECUTED for derived Outcomes). */
  getEventsByType(eventType: ActionEventType): Promise<EventListReadResult>;
  appendDecision(input: DecisionAppendInput): Promise<DecisionAppendResult>;
  /** The approved execution RPC — the ONLY path to a business mutation. */
  callExecuteRpc(args: ExecuteRpcArgs): Promise<RpcCallResult>;
}

/** F2.29: READ-ONLY finance event capability (no finance append, no finance RPC exists in the app). */
export interface FinanceActionEventReader {
  /** Every stored RECORD_PAID_EXPENSE event of one type, created_at order; any malformed finance row fails the read closed. */
  getFinanceEventsByType(eventType: ActionEventType): Promise<FinanceEventListReadResult>;
}

export const EVENT_PAGE_SIZE = 500;

export function createActionEventStore(client: ActionEventTableClient): ActionEventStore & FinanceActionEventReader {
  const table = () => client.from(PARTNER_ACTION_EVENTS_TABLE);

  async function readRawRows(column: string, value: string): Promise<{ ok: true; rows: unknown[] } | { ok: false; detail: string }> {
    const rows: unknown[] = [];
    for (let from = 0; ; from += EVENT_PAGE_SIZE) {
      let res: ActionEventDbResponse<unknown[]>;
      try {
        res = await table().select(ACTION_EVENT_COLUMNS).eq(column, value)
          .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + EVENT_PAGE_SIZE - 1);
      } catch (e) { return { ok: false, detail: `partner_action_events read threw: ${describeDbError(e)}` }; }
      if (res.error) return { ok: false, detail: `partner_action_events read failed: ${describeDbError(res.error)}` };
      if (!Array.isArray(res.data)) return { ok: false, detail: "partner_action_events read returned no data array" };
      rows.push(...res.data);
      if (res.data.length < EVENT_PAGE_SIZE) break;
    }
    return { ok: true, rows };
  }

  async function readRows(column: string, value: string): Promise<{ ok: true; events: PartnerActionEvent[] } | { ok: false; result: Exclude<ActionChainReadResult, { status: "OK" }> }> {
    const raw = await readRawRows(column, value);
    if (!raw.ok) return { ok: false, result: { status: "READ_FAILED", detail: raw.detail } };
    const events: PartnerActionEvent[] = [];
    const errors: string[] = [];
    for (const r of raw.rows) {
      // F2.29: RECORD_PAID_EXPENSE rows belong to the finance reader (getFinanceEventsByType) — never parsed or
      // returned as deadline events. Any OTHER unknown action type still fails the read closed, as before.
      if (isFinanceActionRow(r)) continue;
      const m = mapActionEventRow(r);
      if (m.ok) events.push(m.value);
      else errors.push(`${(r as { id?: unknown })?.id ?? "?"}: ${m.code}: ${m.errors.join("; ")}`);
    }
    if (errors.length) return { ok: false, result: { status: "INVALID_STORED_EVENT", errors } };
    return { ok: true, events: events.sort(compareEventOrder) };
  }

  async function readOne(column: string, value: string): Promise<EventReadResult> {
    const r = await readRows(column, value);
    if (!r.ok) return r.result.status === "INVALID_CHAIN" ? { status: "INVALID_STORED_EVENT", errors: r.result.reasons } : r.result;
    if (!r.events.length) return { status: "NOT_FOUND" };
    if (r.events.length > 1) return { status: "INVALID_STORED_EVENT", errors: [`${column} is not unique`] };
    return { status: "FOUND", event: r.events[0] };
  }

  async function getActionChain(actionId: string): Promise<ActionChainReadResult> {
    const r = await readRows("action_id", actionId);
    if (!r.ok) return r.result;
    const o = orderActionChain(actionId, r.events);
    return o.status === "OK" ? o : { status: "INVALID_CHAIN", reasons: o.reasons };
  }

  function validateAppend(i: DecisionAppendInput): string[] {
    const errors: string[] = [];
    if (!LOWER_UUID_RE.test(i.requestId)) errors.push("requestId must be a lowercase uuid");
    if (!LOWER_UUID_RE.test(i.actorUserId)) errors.push("actorUserId must be a lowercase uuid");
    if (i.expectedHeadEventId !== null && !LOWER_UUID_RE.test(i.expectedHeadEventId)) errors.push("expectedHeadEventId must be a lowercase uuid or null");
    if (!["APPROVED", "NOT_NOW", "REJECTED"].includes(i.eventType)) errors.push("only Owner decision events can be appended");
    if (i.snapshot?.id !== i.actionId) errors.push("snapshot.id must equal actionId");
    if (i.snapshot?.status !== "PROPOSED" || i.snapshot?.requiresOwnerApproval !== true) errors.push("snapshot must be a PROPOSED owner-approval proposal");
    if (i.snapshot?.schemaVersion !== SUPPORTED_ACTION_SCHEMA_VERSION || i.snapshot?.actionType !== "UPDATE_PROJECT_DEADLINE" || i.snapshot?.subjectType !== "project") errors.push("unsupported action schema / type / subject");
    if (!SHA256_HEX_RE.test(i.snapshotHash)) errors.push("snapshotHash must be 64 lowercase hex");
    else { try { if (hashActionSnapshot(i.snapshot) !== i.snapshotHash) errors.push("snapshotHash does not match the snapshot"); } catch (e) { errors.push(`snapshot is not canonical: ${(e as Error).message}`); } }
    if ((i.eventType === "NOT_NOW") !== (i.deferUntil !== null) || (i.deferUntil === null) !== (i.deferChoice === null)) errors.push("defer fields are required exactly for NOT_NOW");
    if (i.note !== null && (typeof i.note !== "string" || i.note.length > 2000)) errors.push("note must be a string of at most 2000 characters or null");
    return errors;
  }

  async function replayOrConflict(i: DecisionAppendInput, scope: DecisionRequestScope): Promise<DecisionAppendResult | null> {
    const prior = await readOne("request_id", i.requestId);
    if (prior.status === "NOT_FOUND") return null;
    if (prior.status === "READ_FAILED") return { status: "RETRYABLE", detail: prior.detail };
    if (prior.status === "INVALID_STORED_EVENT") return { status: "INVARIANT_VIOLATION", detail: prior.errors.join("; ") };
    return decisionReplayMatches(prior.event, scope) ? { status: "REPLAY", event: prior.event } : { status: "REQUEST_ID_CONFLICT" };
  }

  return {
    getEventById: (id) => LOWER_UUID_RE.test(id) ? readOne("id", id) : Promise.resolve({ status: "NOT_FOUND" }),
    getEventByRequestId: (rid) => LOWER_UUID_RE.test(rid) ? readOne("request_id", rid) : Promise.resolve({ status: "NOT_FOUND" }),
    getActionChain,
    async getEventsByType(eventType) {
      if (!(ACTION_EVENT_TYPES as readonly string[]).includes(eventType)) return { status: "INVALID_STORED_EVENT", errors: [`unknown event type ${JSON.stringify(eventType)}`] };
      const r = await readRows("event_type", eventType);
      if (!r.ok) return r.result.status === "INVALID_CHAIN" ? { status: "INVALID_STORED_EVENT", errors: r.result.reasons } : r.result;
      return { status: "OK", events: r.events };
    },

    async getFinanceEventsByType(eventType) {
      if (!(ACTION_EVENT_TYPES as readonly string[]).includes(eventType)) return { status: "INVALID_STORED_EVENT", errors: [`unknown event type ${JSON.stringify(eventType)}`] };
      const raw = await readRawRows("event_type", eventType);
      if (!raw.ok) return { status: "READ_FAILED", detail: raw.detail };
      const events: PartnerFinanceActionEvent[] = [];
      const errors: string[] = [];
      for (const r of raw.rows) {
        if (!isFinanceActionRow(r)) continue;
        const m = mapFinanceActionEventRow(r);
        if (m.ok) events.push(m.value);
        else errors.push(`${(r as { id?: unknown })?.id ?? "?"}: ${m.code}: ${m.errors.join("; ")}`);
      }
      if (errors.length) return { status: "INVALID_STORED_EVENT", errors };
      return { status: "OK", events: events.sort((a, b) => (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
    },

    async appendDecision(i) {
      const errors = validateAppend(i);
      if (errors.length) return { status: "INVALID_INPUT", errors };
      const scope: DecisionRequestScope = { actionId: i.actionId, eventType: i.eventType, expectedHeadEventId: i.expectedHeadEventId, actorUserId: i.actorUserId, deferChoice: i.deferChoice, deferUntil: i.deferUntil };

      // 1. request_id already used? exact scope → REPLAY, anything else → REQUEST_ID_CONFLICT.
      const early = await replayOrConflict(i, scope);
      if (early) return early;

      // 2. current head of this action's chain.
      const c = await getActionChain(i.actionId);
      if (c.status === "READ_FAILED") return { status: "RETRYABLE", detail: c.detail };
      if (c.status !== "OK") return { status: "INVARIANT_VIOLATION", detail: c.status === "INVALID_CHAIN" ? c.reasons.join("; ") : c.errors.join("; ") };
      // The same request may already be in this chain (e.g. the first attempt's response was lost): scope-safe replay.
      const sameRequest = c.chain.find((e) => e.requestId === i.requestId);
      if (sameRequest) return decisionReplayMatches(sameRequest, scope) ? { status: "REPLAY", event: sameRequest } : { status: "REQUEST_ID_CONFLICT" };
      const head = c.head;
      if (head?.eventType === "EXECUTED") return { status: "ALREADY_EXECUTED", head };
      if (head && head.eventType === i.eventType && i.eventType !== "NOT_NOW") return { status: "ALREADY_IN_STATE", head };
      if ((head?.id ?? null) !== i.expectedHeadEventId) return { status: "HEAD_CONFLICT", head };
      if (!isAllowedTransition(head?.eventType ?? null, i.eventType)) return { status: "INVALID_TRANSITION", from: head?.eventType ?? "ROOT", to: i.eventType };

      // 3. insert (the DB re-enforces transitions, linearity, parent pre-lock, append-only).
      const row: ActionEventInsertRow = {
        event_schema_version: ACTION_EVENT_SCHEMA_VERSION,
        request_id: i.requestId,
        action_id: i.actionId,
        action_type: "UPDATE_PROJECT_DEADLINE",
        action_schema_version: SUPPORTED_ACTION_SCHEMA_VERSION,
        subject_type: "project",
        subject_id: i.snapshot.subjectId,
        event_type: i.eventType,
        supersedes_event_id: i.expectedHeadEventId,
        actor_kind: "OWNER",
        actor_user_id: i.actorUserId,
        action_snapshot: i.snapshot,
        snapshot_hash: i.snapshotHash,
        revalidation: i.revalidation,
        execution: null,
        defer_choice: i.deferChoice,
        defer_until: i.deferUntil,
        note: i.note,
      };
      let res: ActionEventDbResponse<unknown>;
      try { res = await table().insert(row).select(ACTION_EVENT_COLUMNS).single(); } catch (e) {
        return { status: "RETRYABLE", detail: `insert threw (outcome unknown — retry with the same requestId): ${describeDbError(e)}` };
      }
      if (res.error) {
        const cls = classifyDbError(res.error);
        const text = `${res.error.message ?? ""} ${res.error.details ?? ""}`;
        if (cls === "UNIQUE_VIOLATION" && /request_uk/.test(text)) return (await replayOrConflict(i, scope)) ?? { status: "RETRYABLE", detail: describeDbError(res.error) };
        if (cls === "UNIQUE_VIOLATION" || cls === "FK_VIOLATION") {
          const again = await getActionChain(i.actionId);
          return { status: "HEAD_CONFLICT", head: again.status === "OK" ? again.head : null };
        }
        if (cls === "CHECK_VIOLATION") return { status: "INVALID_TRANSITION", from: head?.eventType ?? "ROOT", to: i.eventType };
        if (cls === "INVARIANT_VIOLATION") return { status: "INVARIANT_VIOLATION", detail: describeDbError(res.error) };
        if (cls === "RETRYABLE") return { status: "RETRYABLE", detail: describeDbError(res.error) };
        return { status: "FAILED", detail: describeDbError(res.error) };
      }
      const m = mapActionEventRow(res.data);
      if (!m.ok) return { status: "INVARIANT_VIOLATION", detail: `inserted event failed read-back validation: ${m.errors.join("; ")}` };
      return { status: "RECORDED", event: m.value };
    },

    async callExecuteRpc(args) {
      let res: ActionEventDbResponse<unknown>;
      try { res = await client.rpc(EXECUTE_RPC, args); } catch (e) {
        return { status: "RPC_ERROR", error: { code: "CLIENT", message: `rpc threw (outcome unknown — retry with the same requestId): ${describeDbError(e)}` }, errorClass: "RETRYABLE" };
      }
      if (res.error) return { status: "RPC_ERROR", error: { code: res.error.code, message: describeDbError(res.error) }, errorClass: classifyDbError(res.error) };
      return { status: "RPC_OK", data: res.data };
    },
  };
}
