/**
 * Redbloods Partner — Finance Action Events, READ model (Phase F2.29). Pure, no I/O, READ-ONLY.
 *
 * Mirrors the F2.24 candidate migration for public.partner_action_events (NOT applied in production yet —
 * sha256 d6e83ae3bfd650ece356ac4e5eb7340a44be0f15e9cf0bf4caea16e13cb3fa97): one finance action type,
 * RECORD_PAID_EXPENSE, for ONE source, the Victor monthly salary.
 *
 * This module only PARSES stored rows so that, once the migration exists, the app can read finance events
 * without breaking the deadline flows. There is deliberately no insert row type, no approval builder and no
 * execution call here: approving / executing a finance action is not enabled by this phase.
 *
 * Every row is parsed field by field and fails closed: the action type ↔ schema ↔ subject binding, the
 * business subject (snapshot.subjectKey) and its derived UUID, the canonical facts (the exact Victor salary
 * row shape), the canonical action id and the snapshot SHA-256 must all agree — nothing is guessed.
 */
import { createHash } from "node:crypto";
import { SHA256_HEX_RE } from "./canonical";
import { ACTION_EVENT_SCHEMA_VERSION, ACTION_EVENT_TYPES, DEFER_CHOICES, LOWER_UUID_RE, type ActionEventType, type DeferChoice } from "./events";
import { hashActionSnapshot } from "./snapshot";
import { salaryLinkedId, salaryTransactionDescription } from "../../victor-salary-format";

export const FINANCE_ACTION_TYPE = "RECORD_PAID_EXPENSE";
export const FINANCE_ACTION_SCHEMA_VERSION = "partner-finance-action-v1";
export const FINANCE_SUBJECT_TYPE = "recurring";
/** Fixed forever (the DB CHECK uses the same namespace): subject_id = UUIDv5(ns, "recurring:" + subjectKey). */
export const FINANCE_SUBJECT_NAMESPACE = "5d0f3c1e-7a2b-5c4d-9e8f-1a2b3c4d5e6f";
export const FINANCE_SOURCE_VICTOR_SALARY = "VICTOR_SALARY";
export const FINANCE_CURRENCIES = ["$", "₪", "€", "£"] as const;
export const VICTOR_SALARY_SUBJECT_KEY_RE = /^VICTOR_SALARY:(\d{4}-(?:0[1-9]|1[0-2]))$/;

export interface FinanceActionFactsV1 {
  amount: number;
  currency: string;
  date: string;
  paymentStatus: "שולם";
  type: "expense";
  description: string;
  category: "צוות";
  scope: "general";
  expenseScope: "כללי";
  artist: "Victor";
  projectId: null;
  linkedSessionId: string;
  notes: "";
}

export interface FinanceActionSnapshotV1 {
  id: string;
  schemaVersion: typeof FINANCE_ACTION_SCHEMA_VERSION;
  actionType: typeof FINANCE_ACTION_TYPE;
  subjectType: typeof FINANCE_SUBJECT_TYPE;
  subjectKey: string;
  subjectId: string;
  status: "PROPOSED";
  requiresOwnerApproval: true;
  source: typeof FINANCE_SOURCE_VICTOR_SALARY;
  period: string;
  facts: FinanceActionFactsV1;
  /** [payment-status context, payment-date context] — same field name as the deadline action (Memory links it). */
  sourceContextIds: [string, string];
  ownerContext: {
    status: { id: string; questionType: "FINANCE_RECURRING_PAYMENT_STATUS"; answerCode: "PAID_NEEDS_RECORDING"; fingerprint: string };
    date: { id: string; questionType: "FINANCE_PAYMENT_DATE"; answerCode: "EXACT_DATE"; ymd: string; fingerprint: string };
  };
  salaryConfig: { amount: number; currency: string };
  [extra: string]: unknown;
}

export interface PartnerFinanceActionEvent {
  id: string;
  createdAt: string;
  requestId: string;
  actionId: string;
  actionType: typeof FINANCE_ACTION_TYPE;
  subjectType: typeof FINANCE_SUBJECT_TYPE;
  /** Audit key only (derived UUID). Business identity = subjectKey. */
  subjectId: string;
  subjectKey: string;
  period: string;
  eventType: ActionEventType;
  supersedesEventId: string | null;
  actorKind: "OWNER";
  actorUserId: string;
  snapshot: FinanceActionSnapshotV1;
  snapshotHash: string;
  revalidation: Record<string, unknown>;
  execution: Record<string, unknown> | null;
  deferChoice: DeferChoice | null;
  deferUntil: string | null;
  note: string | null;
}

export type FinanceEventRowMapping =
  | { ok: true; value: PartnerFinanceActionEvent }
  | { ok: false; code: "UNSUPPORTED_EVENT_SCHEMA" | "INVALID_STORED_EVENT"; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTs = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
export const isValidYmd = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** RFC 4122 UUIDv5 (SHA-1) — identical to extensions.uuid_generate_v5 in PostgreSQL. */
export function uuidV5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
export const financeSubjectUuid = (subjectKey: string) => uuidV5(FINANCE_SUBJECT_NAMESPACE, `${FINANCE_SUBJECT_TYPE}:${subjectKey}`);

/** The canonical action id (lib/partner/finance/actions.ts encoding) — every mutation-relevant fact is in it. */
export function financeActionId(subjectKey: string, period: string, statusCtxId: string, dateCtxId: string, amount: number, currency: string, date: string): string {
  return `${FINANCE_ACTION_TYPE}:${subjectKey}:${period}:${statusCtxId}+${dateCtxId}:${amount}:${currency}:${date}`;
}

/** Validates a RECORD_PAID_EXPENSE V1 snapshot exactly as the candidate RPC does. Returns the errors (empty = valid). */
export function validateFinanceSnapshot(snap: unknown): string[] {
  const e: string[] = [];
  if (!isObj(snap)) return ["action_snapshot: must be an object"];
  if (snap.schemaVersion !== FINANCE_ACTION_SCHEMA_VERSION || snap.actionType !== FINANCE_ACTION_TYPE || snap.subjectType !== FINANCE_SUBJECT_TYPE) e.push("snapshot schema / action type / subject type binding");
  if (snap.source !== FINANCE_SOURCE_VICTOR_SALARY) e.push(`unsupported source ${JSON.stringify(snap.source)}`);
  if (snap.status !== "PROPOSED" || snap.requiresOwnerApproval !== true) e.push("snapshot must be a PROPOSED, owner-approval proposal");
  const m = typeof snap.subjectKey === "string" ? VICTOR_SALARY_SUBJECT_KEY_RE.exec(snap.subjectKey) : null;
  if (!m) { e.push("subjectKey must be VICTOR_SALARY:<YYYY-MM>"); return e; }
  const period = m[1];
  if (snap.period !== period) e.push("period must equal the subjectKey period");
  if (snap.subjectId !== financeSubjectUuid(snap.subjectKey as string)) e.push("subjectId is not the UUIDv5 of the subjectKey");
  const f = snap.facts;
  if (!isObj(f)) { e.push("facts: must be an object"); return e; }
  // same textual rule as the RPC (jsonb number rendered as text): ^[0-9]{1,9}(\.[0-9]{1,2})?$ and > 0
  const amountOk = typeof f.amount === "number" && Number.isFinite(f.amount) && f.amount > 0 && /^\d{1,9}(\.\d{1,2})?$/.test(String(f.amount));
  if (!amountOk) e.push("facts.amount must be a positive number with at most 2 decimals");
  if (!(FINANCE_CURRENCIES as readonly unknown[]).includes(f.currency)) e.push("facts.currency is not an allowed currency");
  if (!isValidYmd(f.date)) e.push("facts.date must be a real YYYY-MM-DD");
  const exact: Array<[string, unknown]> = [
    ["paymentStatus", "שולם"], ["type", "expense"], ["category", "צוות"], ["scope", "general"], ["expenseScope", "כללי"],
    ["artist", "Victor"], ["projectId", null], ["notes", ""], ["linkedSessionId", salaryLinkedId(period)], ["description", salaryTransactionDescription(period)],
  ];
  for (const [k, v] of exact) if (f[k] !== v) e.push(`facts.${k} must be ${JSON.stringify(v)}`);
  const ids = snap.sourceContextIds;
  const oc = isObj(snap.ownerContext) ? snap.ownerContext : null;
  const st = oc && isObj(oc.status) ? oc.status : null;
  const dt = oc && isObj(oc.date) ? oc.date : null;
  if (!Array.isArray(ids) || ids.length !== 2 || !ids.every((x) => typeof x === "string" && LOWER_UUID_RE.test(x)) || ids[0] === ids[1]) e.push("sourceContextIds must be two distinct lowercase uuids");
  else if (!st || !dt || st.id !== ids[0] || dt.id !== ids[1]) e.push("ownerContext ids must equal sourceContextIds [status, date]");
  if (st && (st.questionType !== "FINANCE_RECURRING_PAYMENT_STATUS" || st.answerCode !== "PAID_NEEDS_RECORDING" || typeof st.fingerprint !== "string" || !st.fingerprint)) e.push("ownerContext.status must be PAID_NEEDS_RECORDING with a fingerprint");
  if (dt && (dt.questionType !== "FINANCE_PAYMENT_DATE" || dt.answerCode !== "EXACT_DATE" || dt.ymd !== f.date || typeof dt.fingerprint !== "string" || !dt.fingerprint)) e.push("ownerContext.date must be EXACT_DATE of facts.date with a fingerprint");
  const sc = isObj(snap.salaryConfig) ? snap.salaryConfig : null;
  if (!sc || sc.amount !== f.amount || sc.currency !== f.currency) e.push("salaryConfig must equal the facts amount / currency");
  if (!e.length && Array.isArray(ids)) {
    const expected = financeActionId(snap.subjectKey as string, period, ids[0] as string, ids[1] as string, f.amount as number, f.currency as string, f.date as string);
    if (snap.id !== expected) e.push("snapshot id is not the canonical action identity");
  }
  return e;
}

/** Field-by-field, fail-closed mapping of one stored RECORD_PAID_EXPENSE row. */
export function mapFinanceActionEventRow(raw: unknown): FinanceEventRowMapping {
  if (!isObj(raw)) return { ok: false, code: "INVALID_STORED_EVENT", errors: ["row is not an object"] };
  if (raw.event_schema_version !== ACTION_EVENT_SCHEMA_VERSION) {
    return { ok: false, code: "UNSUPPORTED_EVENT_SCHEMA", errors: [`event_schema_version ${JSON.stringify(raw.event_schema_version)} is not supported`] };
  }
  const errors: string[] = [];
  for (const k of ["id", "request_id", "subject_id", "actor_user_id"]) if (typeof raw[k] !== "string" || !LOWER_UUID_RE.test(raw[k] as string)) errors.push(`${k}: must be a lowercase uuid`);
  if (raw.supersedes_event_id !== null && (typeof raw.supersedes_event_id !== "string" || !LOWER_UUID_RE.test(raw.supersedes_event_id))) errors.push("supersedes_event_id: must be a lowercase uuid or null");
  if (!isTs(raw.created_at)) errors.push("created_at: must be a timestamp");
  if (typeof raw.action_id !== "string" || raw.action_id.length === 0 || raw.action_id.length > 300) errors.push("action_id: invalid");
  if (raw.action_type !== FINANCE_ACTION_TYPE) errors.push(`action_type ${JSON.stringify(raw.action_type)} is not a finance action`);
  if (raw.action_schema_version !== FINANCE_ACTION_SCHEMA_VERSION) errors.push(`action_schema_version ${JSON.stringify(raw.action_schema_version)} is not bound to ${FINANCE_ACTION_TYPE}`);
  if (raw.subject_type !== FINANCE_SUBJECT_TYPE) errors.push(`subject_type ${JSON.stringify(raw.subject_type)} is not bound to ${FINANCE_ACTION_TYPE}`);
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
  if (eventType === "EXECUTED" && isObj(raw.execution)) {
    const x = raw.execution;
    if (typeof x.transactionId !== "string" || !LOWER_UUID_RE.test(x.transactionId) || x.mutated !== true || x.rowsAffected !== 1) errors.push("EXECUTED audit must carry transactionId, rowsAffected 1, mutated true");
  }
  if (eventType === "STALE_AT_EXECUTION" && isObj(raw.execution) && (raw.execution.mutated !== false || !Array.isArray(raw.execution.staleReasons))) errors.push("STALE_AT_EXECUTION audit must carry staleReasons and mutated false");

  const snap = raw.action_snapshot;
  const snapErrors = validateFinanceSnapshot(snap);
  errors.push(...snapErrors);
  if (isObj(snap)) {
    if (snap.id !== raw.action_id) errors.push("action_snapshot.id must equal action_id");
    if (snap.subjectId !== raw.subject_id) errors.push("action_snapshot.subjectId must equal subject_id");
    if (typeof raw.snapshot_hash === "string") {
      let h: string | null = null;
      try { h = hashActionSnapshot(snap); } catch (err) { errors.push(`action_snapshot is not canonical data: ${(err as Error).message}`); }
      if (h !== null && h !== raw.snapshot_hash) errors.push("action_snapshot SHA-256 does not match snapshot_hash (integrity)");
    }
    if (eventType === "EXECUTED" && isObj(raw.execution) && isObj(snap.facts) && raw.execution.businessKey !== snap.facts.linkedSessionId) errors.push("EXECUTED audit business key must be the snapshot's linkedSessionId");
  }
  if (errors.length) return { ok: false, code: "INVALID_STORED_EVENT", errors };
  const s = snap as FinanceActionSnapshotV1;
  return {
    ok: true,
    value: {
      id: raw.id as string,
      createdAt: raw.created_at as string,
      requestId: raw.request_id as string,
      actionId: raw.action_id as string,
      actionType: FINANCE_ACTION_TYPE,
      subjectType: FINANCE_SUBJECT_TYPE,
      subjectId: raw.subject_id as string,
      subjectKey: s.subjectKey,
      period: s.period,
      eventType,
      supersedesEventId: raw.supersedes_event_id as string | null,
      actorKind: "OWNER",
      actorUserId: raw.actor_user_id as string,
      snapshot: s,
      snapshotHash: raw.snapshot_hash as string,
      revalidation: raw.revalidation as Record<string, unknown>,
      execution: raw.execution as Record<string, unknown> | null,
      deferChoice: raw.defer_choice as DeferChoice | null,
      deferUntil: raw.defer_until as string | null,
      note: raw.note as string | null,
    },
  };
}

// ── F2.31: the narrow write contract (Owner decisions + the ONE approved finance RPC) ──

/** The Owner-approved (F2.30, sha256 d6e83ae3…fa97) Victor-salary execution function — the only finance write primitive. */
export const FINANCE_EXECUTE_RPC = "partner_execute_record_paid_expense";

/** What the store inserts for a finance Owner decision (id / created_at are assigned by the DB). */
export interface FinanceActionEventInsertRow {
  event_schema_version: typeof ACTION_EVENT_SCHEMA_VERSION;
  request_id: string;
  action_id: string;
  action_type: typeof FINANCE_ACTION_TYPE;
  action_schema_version: typeof FINANCE_ACTION_SCHEMA_VERSION;
  subject_type: typeof FINANCE_SUBJECT_TYPE;
  subject_id: string;
  event_type: "APPROVED" | "NOT_NOW";
  supersedes_event_id: string | null;
  actor_kind: "OWNER";
  actor_user_id: string;
  action_snapshot: FinanceActionSnapshotV1;
  snapshot_hash: string;
  revalidation: Record<string, unknown>;
  execution: null;
  defer_choice: DeferChoice | null;
  defer_until: string | null;
  note: string | null;
}

/** Identifiers only — every business value comes from the stored APPROVED snapshot inside the RPC. */
export interface FinanceExecuteRpcArgs {
  p_request_id: string;
  p_approval_event_id: string;
  p_action_id: string;
  p_actor_user_id: string;
  p_app_stale_reasons: string[];
  p_revalidation: Record<string, unknown>;
}

/** The raw action_type decides the parser: finance rows are never handed to the deadline parser and vice versa. */
export const isFinanceActionRow = (raw: unknown): boolean => isObj(raw) && raw.action_type === FINANCE_ACTION_TYPE;
