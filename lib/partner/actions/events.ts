/**
 * Redbloods Partner — Action Events model (Phase F.1H). Pure, no I/O.
 *
 * Mirrors public.partner_action_events (F.1G, migration SHA-256
 * 79a3ee9ef9eca84cc0123be6e9fa6de9242353bdc19db95d76311c81ad5a910f) exactly:
 * five persisted event types — the Owner decisions APPROVED / NOT_NOW /
 * REJECTED and the execution outcomes EXECUTED / STALE_AT_EXECUTION (written
 * only by the DB RPC). PROPOSED is never persisted (it is derived);
 * CHANGE_VALUE is an Owner Context revision, never an Action Event.
 *
 * Stored rows are parsed field by field and fail closed: an unsupported schema
 * version, an unknown type, a broken invariant or a snapshot whose SHA-256 no
 * longer matches its stored hash makes the row unreadable — never guessed.
 */
import { SHA256_HEX_RE } from "./canonical";
import { hashActionSnapshot, type PartnerActionSnapshot } from "./snapshot";

export const PARTNER_ACTION_EVENTS_TABLE = "partner_action_events";
export const ACTION_EVENT_SCHEMA_VERSION = "partner-action-event-v1";
export const SUPPORTED_ACTION_SCHEMA_VERSION = "partner-suggested-action-v1";
export const EXECUTE_RPC = "partner_execute_update_project_deadline";

export const ACTION_EVENT_TYPES = ["APPROVED", "NOT_NOW", "REJECTED", "EXECUTED", "STALE_AT_EXECUTION"] as const;
export type ActionEventType = (typeof ACTION_EVENT_TYPES)[number];
export type OwnerDecisionEventType = "APPROVED" | "NOT_NOW" | "REJECTED";
export const OWNER_DECISION_EVENT_TYPES: readonly OwnerDecisionEventType[] = ["APPROVED", "NOT_NOW", "REJECTED"];
export const EXECUTION_EVENT_TYPES: readonly ActionEventType[] = ["EXECUTED", "STALE_AT_EXECUTION"];

export const DEFER_CHOICES = ["LATER_TODAY", "TOMORROW", "IN_3_DAYS", "IN_1_WEEK", "CUSTOM", "SYSTEM_DEFAULT"] as const;
export type DeferChoice = (typeof DEFER_CHOICES)[number];

export const ACTION_EVENT_COLUMNS =
  "id,created_at,event_schema_version,request_id,action_id,action_type,action_schema_version,subject_type,subject_id,event_type,supersedes_event_id,actor_kind,actor_user_id,action_snapshot,snapshot_hash,revalidation,execution,defer_choice,defer_until,note";

/** Exact column shape of public.partner_action_events. */
export interface ActionEventRow {
  id: string;
  created_at: string;
  event_schema_version: string;
  request_id: string;
  action_id: string;
  action_type: string;
  action_schema_version: string;
  subject_type: string;
  subject_id: string;
  event_type: string;
  supersedes_event_id: string | null;
  actor_kind: string;
  actor_user_id: string;
  action_snapshot: unknown;
  snapshot_hash: string;
  revalidation: unknown;
  execution: unknown;
  defer_choice: string | null;
  defer_until: string | null;
  note: string | null;
}

/** What the store inserts for an Owner decision (id / created_at are assigned by the DB). */
export interface ActionEventInsertRow {
  event_schema_version: typeof ACTION_EVENT_SCHEMA_VERSION;
  request_id: string;
  action_id: string;
  action_type: "UPDATE_PROJECT_DEADLINE";
  action_schema_version: typeof SUPPORTED_ACTION_SCHEMA_VERSION;
  subject_type: "project";
  subject_id: string;
  event_type: OwnerDecisionEventType;
  supersedes_event_id: string | null;
  actor_kind: "OWNER";
  actor_user_id: string;
  action_snapshot: PartnerActionSnapshot;
  snapshot_hash: string;
  revalidation: Record<string, unknown>;
  execution: null;
  defer_choice: DeferChoice | null;
  defer_until: string | null;
  note: string | null;
}

export interface PartnerActionEvent {
  id: string;
  createdAt: string;
  requestId: string;
  actionId: string;
  actionType: "UPDATE_PROJECT_DEADLINE";
  subjectType: "project";
  subjectId: string;
  eventType: ActionEventType;
  supersedesEventId: string | null;
  actorKind: "OWNER";
  actorUserId: string;
  snapshot: PartnerActionSnapshot;
  snapshotHash: string;
  revalidation: Record<string, unknown>;
  execution: Record<string, unknown> | null;
  deferChoice: DeferChoice | null;
  deferUntil: string | null;
  /** Carried verbatim for display; never parsed, never drives anything. */
  note: string | null;
}

export type ActionEventRowMapping =
  | { ok: true; value: PartnerActionEvent }
  | { ok: false; code: "UNSUPPORTED_EVENT_SCHEMA" | "INVALID_STORED_EVENT"; errors: string[] };

export const LOWER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTs = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** Field-by-field, fail-closed mapping of one stored row. */
export function mapActionEventRow(raw: unknown): ActionEventRowMapping {
  if (!isObj(raw)) return { ok: false, code: "INVALID_STORED_EVENT", errors: ["row is not an object"] };
  if (raw.event_schema_version !== ACTION_EVENT_SCHEMA_VERSION) {
    return { ok: false, code: "UNSUPPORTED_EVENT_SCHEMA", errors: [`event_schema_version ${JSON.stringify(raw.event_schema_version)} is not supported`] };
  }
  const errors: string[] = [];
  for (const k of ["id", "request_id", "subject_id", "actor_user_id"]) if (typeof raw[k] !== "string" || !LOWER_UUID_RE.test(raw[k] as string)) errors.push(`${k}: must be a lowercase uuid`);
  if (raw.supersedes_event_id !== null && (typeof raw.supersedes_event_id !== "string" || !LOWER_UUID_RE.test(raw.supersedes_event_id))) errors.push("supersedes_event_id: must be a lowercase uuid or null");
  if (!isTs(raw.created_at)) errors.push("created_at: must be a timestamp");
  if (typeof raw.action_id !== "string" || raw.action_id.length === 0 || raw.action_id.length > 300) errors.push("action_id: invalid");
  if (raw.action_type !== "UPDATE_PROJECT_DEADLINE") errors.push(`action_type ${JSON.stringify(raw.action_type)} is not supported`);
  if (raw.action_schema_version !== SUPPORTED_ACTION_SCHEMA_VERSION) errors.push(`action_schema_version ${JSON.stringify(raw.action_schema_version)} is not supported`);
  if (raw.subject_type !== "project") errors.push("subject_type must be project");
  if (!(ACTION_EVENT_TYPES as readonly unknown[]).includes(raw.event_type)) errors.push(`event_type ${JSON.stringify(raw.event_type)} is unknown`);
  if (raw.actor_kind !== "OWNER") errors.push("actor_kind must be OWNER");
  if (typeof raw.snapshot_hash !== "string" || !SHA256_HEX_RE.test(raw.snapshot_hash)) errors.push("snapshot_hash: must be 64 lowercase hex");
  if (!isObj(raw.revalidation)) errors.push("revalidation: must be an object");
  if (raw.note !== null && typeof raw.note !== "string") errors.push("note: must be a string or null");

  const eventType = raw.event_type as ActionEventType;
  const isExecution = eventType === "EXECUTED" || eventType === "STALE_AT_EXECUTION";
  if (isExecution !== (raw.execution !== null)) errors.push("execution must be present exactly on EXECUTED / STALE_AT_EXECUTION");
  if (raw.execution !== null && !isObj(raw.execution)) errors.push("execution: must be an object or null");
  if (isExecution && raw.supersedes_event_id === null) errors.push("an execution event must supersede its APPROVED event");
  if ((eventType === "NOT_NOW") !== (raw.defer_until !== null)) errors.push("defer_until must be present exactly on NOT_NOW");
  if ((raw.defer_until === null) !== (raw.defer_choice === null)) errors.push("defer_choice and defer_until go together");
  if (raw.defer_choice !== null && !(DEFER_CHOICES as readonly unknown[]).includes(raw.defer_choice)) errors.push(`defer_choice ${JSON.stringify(raw.defer_choice)} is unknown`);
  if (raw.defer_until !== null && !isTs(raw.defer_until)) errors.push("defer_until: must be a timestamp");

  const snap = raw.action_snapshot;
  if (!isObj(snap)) errors.push("action_snapshot: must be an object");
  else {
    if (snap.id !== raw.action_id) errors.push("action_snapshot.id must equal action_id");
    if (snap.subjectId !== raw.subject_id) errors.push("action_snapshot.subjectId must equal subject_id");
    if (snap.status !== "PROPOSED" || snap.requiresOwnerApproval !== true) errors.push("action_snapshot must be a PROPOSED, owner-approval proposal");
    if (typeof raw.snapshot_hash === "string") {
      let h: string | null = null;
      try { h = hashActionSnapshot(snap); } catch (e) { errors.push(`action_snapshot is not canonical data: ${(e as Error).message}`); }
      if (h !== null && h !== raw.snapshot_hash) errors.push("action_snapshot SHA-256 does not match snapshot_hash (integrity)");
    }
  }
  if (errors.length) return { ok: false, code: "INVALID_STORED_EVENT", errors };
  return {
    ok: true,
    value: {
      id: raw.id as string,
      createdAt: raw.created_at as string,
      requestId: raw.request_id as string,
      actionId: raw.action_id as string,
      actionType: "UPDATE_PROJECT_DEADLINE",
      subjectType: "project",
      subjectId: raw.subject_id as string,
      eventType,
      supersedesEventId: raw.supersedes_event_id as string | null,
      actorKind: "OWNER",
      actorUserId: raw.actor_user_id as string,
      snapshot: snap as unknown as PartnerActionSnapshot,
      snapshotHash: raw.snapshot_hash as string,
      revalidation: raw.revalidation as Record<string, unknown>,
      execution: raw.execution as Record<string, unknown> | null,
      deferChoice: raw.defer_choice as DeferChoice | null,
      deferUntil: raw.defer_until as string | null,
      note: raw.note as string | null,
    },
  };
}

/** Allowed successor types — mirrors partner_action_events_guard_insert() exactly (null = root). */
const ALLOWED: Record<"ROOT" | ActionEventType, readonly ActionEventType[]> = {
  ROOT: ["APPROVED", "NOT_NOW", "REJECTED"],
  NOT_NOW: ["APPROVED", "NOT_NOW", "REJECTED"],
  REJECTED: ["APPROVED", "NOT_NOW"],
  APPROVED: ["NOT_NOW", "REJECTED", "EXECUTED", "STALE_AT_EXECUTION"],
  STALE_AT_EXECUTION: ["APPROVED", "NOT_NOW", "REJECTED"],
  EXECUTED: [],
};
export function isAllowedTransition(prev: ActionEventType | null, next: ActionEventType): boolean {
  return ALLOWED[prev ?? "ROOT"].includes(next);
}

/** created_at ASC, then id ASC. */
export function compareEventOrder(a: PartnerActionEvent, b: PartnerActionEvent): number {
  const d = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type ActionChainResult =
  | { status: "OK"; chain: PartnerActionEvent[]; head: PartnerActionEvent | null }
  | { status: "INVALID_CHAIN"; reasons: string[] };

/** Orders one action's events along the supersedes chain and validates it is a single line (fail closed otherwise). */
export function orderActionChain(actionId: string, events: readonly PartnerActionEvent[]): ActionChainResult {
  if (!events.length) return { status: "OK", chain: [], head: null };
  const reasons: string[] = [];
  if (events.some((e) => e.actionId !== actionId)) reasons.push("event of another action in the chain");
  const roots = events.filter((e) => e.supersedesEventId === null);
  if (roots.length !== 1) reasons.push(`expected exactly one root, found ${roots.length}`);
  const next = new Map<string, PartnerActionEvent[]>();
  for (const e of events) if (e.supersedesEventId) next.set(e.supersedesEventId, [...(next.get(e.supersedesEventId) ?? []), e]);
  for (const [p, s] of next) if (s.length > 1) reasons.push(`event ${p} has ${s.length} successors`);
  if (reasons.length) return { status: "INVALID_CHAIN", reasons };
  const chain: PartnerActionEvent[] = [];
  let cur: PartnerActionEvent | undefined = roots[0];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); chain.push(cur); cur = next.get(cur.id)?.[0]; }
  if (chain.length !== events.length) return { status: "INVALID_CHAIN", reasons: ["events not all reachable from the root (dangling or cyclic)"] };
  for (let i = 0; i < chain.length; i++) {
    if (!isAllowedTransition(i === 0 ? null : chain[i - 1].eventType, chain[i].eventType)) {
      return { status: "INVALID_CHAIN", reasons: [`invalid transition ${i === 0 ? "ROOT" : chain[i - 1].eventType} -> ${chain[i].eventType}`] };
    }
  }
  return { status: "OK", chain, head: chain[chain.length - 1] };
}

/** The exact scope a decision request claims — a stored event with the same request_id replays ONLY if it matches all of it. */
export interface DecisionRequestScope {
  actionId: string;
  eventType: OwnerDecisionEventType;
  expectedHeadEventId: string | null;
  actorUserId: string;
  deferChoice: DeferChoice | null;
  /** Compared only for CUSTOM (a relative choice resolves to a new instant on a retry). */
  deferUntil: string | null;
}
export function decisionReplayMatches(e: PartnerActionEvent, s: DecisionRequestScope): boolean {
  if (e.actionId !== s.actionId || e.eventType !== s.eventType || e.supersedesEventId !== s.expectedHeadEventId || e.actorUserId !== s.actorUserId) return false;
  if (s.eventType !== "NOT_NOW") return true;
  if (e.deferChoice !== s.deferChoice) return false;
  if (s.deferChoice === "CUSTOM") return e.deferUntil !== null && s.deferUntil !== null && Date.parse(e.deferUntil) === Date.parse(s.deferUntil);
  return true;
}
