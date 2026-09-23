/**
 * Redbloods Partner — derived Action Outcome, CORE (Phase F.1L). Pure derivation + an
 * injected-client reader; READ-ONLY by construction.
 *
 * Execution result and business outcome are different concepts:
 *   EXECUTED            = "the approved mutation committed atomically" (a persisted fact, never rewritten);
 *   derived Outcome     = what the LIVE canonical state says about that executed change NOW.
 * F.1L models only POST-EXECUTION STATE CONFORMANCE for UPDATE_PROJECT_DEADLINE:
 *   APPLIED_AS_EXPECTED                 the live field still equals the value Partner executed (nothing more);
 *   LIVE_STATE_CHANGED_AFTER_EXECUTION  the live field now differs — NOT a failure (someone may have changed it
 *                                       legitimately); the EXECUTED history is untouched;
 *   TARGET_NOT_FOUND                    the project row no longer exists (in the canonical table);
 *   READ_FAILED                         the live state could not be read — nothing is concluded;
 *   UNSUPPORTED_ACTION                  an action type this layer does not model;
 *   INVARIANT_VIOLATION                 the stored chain / snapshot / execution audit is not coherent (fail closed).
 *
 * The Outcome is DERIVED, never persisted, and never triggers anything: no project write, no Action Event,
 * no Owner Context, no Feedback, no baseline, no Case closing, no Push. The input is always the persisted
 * Action chain (never a client claim); an APPROVED-only or STALE_AT_EXECUTION head has NO Outcome.
 */
import { LOWER_UUID_RE, orderActionChain, type ActionEventType, type PartnerActionEvent } from "./events";
import type { ActionChainReadResult, EventReadResult } from "./event-persistence";
import { hashActionSnapshot } from "./snapshot";

export const ACTION_OUTCOME_SCHEMA_VERSION = "partner-action-outcome-v1";

export const ACTION_OUTCOME_STATES = [
  "APPLIED_AS_EXPECTED",
  "LIVE_STATE_CHANGED_AFTER_EXECUTION",
  "TARGET_NOT_FOUND",
  "READ_FAILED",
  "UNSUPPORTED_ACTION",
  "INVARIANT_VIOLATION",
] as const;
export type ActionOutcomeState = (typeof ACTION_OUTCOME_STATES)[number];

/** Live canonical read of the executed field (projects.deadline + updated_at). */
export type LiveDeadlineRead =
  | { status: "FOUND"; deadline: string | null; updatedAt: string | null; /** F.1M: the live project name (display only). */ name?: string | null }
  | { status: "NOT_FOUND" }
  | { status: "READ_FAILED"; detail: string };

export interface PartnerActionOutcome {
  schemaVersion: typeof ACTION_OUTCOME_SCHEMA_VERSION;
  state: ActionOutcomeState;
  actionId: string;
  actionType: string;
  subject: { type: "project"; id: string } | null;
  /** F.1M: the CURRENT project name from the live read (display only; null when not read / not found). */
  subjectLabel: string | null;
  approvalEventId: string | null;
  executedEventId: string | null;
  snapshotHash: string | null;
  /** HISTORICAL — what was executed, from the persisted snapshot + execution audit. Never replaced by live data. */
  executed: { field: "deadline"; from: string; to: string; executedAt: string; approvedAt: string } | null;
  /** The value the live field is expected to still hold (= executed.to). */
  expectedValue: string | null;
  /** CURRENT — the live canonical state at evaluation time (null when not read / not found). */
  current: { value: string | null; updatedAt: string | null } | null;
  evaluatedAt: string;
  /** Deterministic, human-checkable evidence lines. */
  evidence: string[];
  /** Why the state is what it is (codes / details; empty for APPLIED_AS_EXPECTED). */
  reasons: string[];
  summaryHe: string;
}

export type OutcomeDerivation =
  | { kind: "OUTCOME"; outcome: PartnerActionOutcome }
  /** The chain has no committed execution → there is no Outcome to derive (not an error). */
  | { kind: "NO_OUTCOME"; actionId: string; reason: "NO_EVENTS" | "NOT_EXECUTED" | "STALE_AT_EXECUTION"; headEventType: ActionEventType | null };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const heDate = (ymd: string | null) => (ymd && YMD.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}` : "—");

function base(actionId: string, evaluatedAt: Date): PartnerActionOutcome {
  return {
    schemaVersion: ACTION_OUTCOME_SCHEMA_VERSION, state: "INVARIANT_VIOLATION", actionId, actionType: "UNKNOWN", subject: null, subjectLabel: null,
    approvalEventId: null, executedEventId: null, snapshotHash: null, executed: null, expectedValue: null, current: null,
    evaluatedAt: evaluatedAt.toISOString(), evidence: [], reasons: [], summaryHe: "",
  };
}
const invariant = (o: PartnerActionOutcome, reasons: string[]): OutcomeDerivation =>
  ({ kind: "OUTCOME", outcome: { ...o, state: "INVARIANT_VIOLATION", reasons, summaryHe: "הנתונים השמורים של הפעולה אינם עקביים — לא ניתן לקבוע מצב." } });

/**
 * Validated view of an executed chain: the EXECUTED head, the APPROVED event it supersedes and the
 * historical change. Returns NO_OUTCOME for chains without a committed execution.
 */
type ExecutedChain =
  | { ok: true; approved: PartnerActionEvent; executed: PartnerActionEvent; from: string; to: string; projectId: string }
  | { ok: false; derivation: OutcomeDerivation };

export function validateExecutedChain(actionId: string, events: readonly PartnerActionEvent[], evaluatedAt: Date): ExecutedChain {
  const o = base(actionId, evaluatedAt);
  const ordered = orderActionChain(actionId, events);
  if (ordered.status !== "OK") return { ok: false, derivation: invariant(o, ordered.reasons.map((r) => `INVALID_CHAIN: ${r}`)) };
  const head = ordered.head;
  if (!head) return { ok: false, derivation: { kind: "NO_OUTCOME", actionId, reason: "NO_EVENTS", headEventType: null } };
  if (head.eventType === "STALE_AT_EXECUTION") return { ok: false, derivation: { kind: "NO_OUTCOME", actionId, reason: "STALE_AT_EXECUTION", headEventType: head.eventType } };
  if (head.eventType !== "EXECUTED") return { ok: false, derivation: { kind: "NO_OUTCOME", actionId, reason: "NOT_EXECUTED", headEventType: head.eventType } };

  const executed = head;
  const withIds = { ...o, actionType: String(executed.actionType), executedEventId: executed.id, snapshotHash: executed.snapshotHash };
  if (executed.actionType !== "UPDATE_PROJECT_DEADLINE") {
    return { ok: false, derivation: { kind: "OUTCOME", outcome: { ...withIds, state: "UNSUPPORTED_ACTION", reasons: [`action type ${JSON.stringify(executed.actionType)} has no Outcome model`], summaryHe: "סוג הפעולה אינו נתמך לבדיקת מצב." } } };
  }
  const reasons: string[] = [];
  const approved = ordered.chain[ordered.chain.length - 2];
  if (!approved || approved.eventType !== "APPROVED" || executed.supersedesEventId !== approved.id) reasons.push("EXECUTED must directly supersede its APPROVED event");
  if (approved && (approved.actionId !== executed.actionId || approved.snapshotHash !== executed.snapshotHash)) reasons.push("APPROVED and EXECUTED disagree on action / snapshot hash");
  for (const e of [approved, executed]) {
    if (!e) continue;
    let h: string | null = null;
    try { h = hashActionSnapshot(e.snapshot); } catch (err) { reasons.push(`${e.eventType} snapshot is not canonical: ${(err as Error).message}`); }
    if (h !== null && h !== e.snapshotHash) reasons.push(`${e.eventType} snapshot SHA-256 does not match its snapshot_hash`);
  }
  const snap = executed.snapshot as unknown as Record<string, unknown>;
  const pc = isObj(snap?.proposedChange) ? (snap.proposedChange as Record<string, unknown>) : null;
  if (snap?.id !== actionId || snap?.actionType !== "UPDATE_PROJECT_DEADLINE") reasons.push("snapshot does not describe this UPDATE_PROJECT_DEADLINE action");
  if (!pc || pc.entity !== "project" || pc.field !== "deadline" || pc.entityId !== executed.subjectId) reasons.push("snapshot proposedChange is not a deadline change of the subject project");
  const from = typeof pc?.from === "string" && YMD.test(pc.from) ? pc.from : null;
  const to = typeof pc?.to === "string" && YMD.test(pc.to) ? pc.to : null;
  if (!from || !to || from === to) reasons.push("snapshot proposedChange from/to are not two different YYYY-MM-DD dates");
  const ex = executed.execution;
  if (!isObj(ex) || ex.mutated !== true || ex.rowsAffected !== 1 || ex.from !== from || ex.to !== to) reasons.push("execution audit does not record exactly this committed change (mutated, 1 row, same from/to)");
  if (!LOWER_UUID_RE.test(executed.subjectId)) reasons.push("subject id is not a uuid");
  if (reasons.length || !approved || !from || !to) return { ok: false, derivation: invariant(withIds, reasons) };
  return { ok: true, approved, executed, from, to, projectId: executed.subjectId };
}

/**
 * Pure: derives the current Outcome of ONE action from its persisted chain and the live canonical read.
 * `live` is only consulted when the chain holds a committed execution.
 */
export function deriveExecutedActionOutcome(input: { actionId: string; events: readonly PartnerActionEvent[]; live: LiveDeadlineRead; evaluatedAt: Date }): OutcomeDerivation {
  const v = validateExecutedChain(input.actionId, input.events, input.evaluatedAt);
  if (!v.ok) return v.derivation;
  return { kind: "OUTCOME", outcome: outcomeFromLive(v, input.live, input.evaluatedAt) };
}

function outcomeFromLive(v: Extract<ExecutedChain, { ok: true }>, live: LiveDeadlineRead, evaluatedAt: Date): PartnerActionOutcome {
  const o: PartnerActionOutcome = {
    ...base(v.executed.actionId, evaluatedAt),
    actionType: v.executed.actionType,
    subject: { type: "project", id: v.projectId },
    approvalEventId: v.approved.id,
    executedEventId: v.executed.id,
    snapshotHash: v.executed.snapshotHash,
    executed: { field: "deadline", from: v.from, to: v.to, executedAt: v.executed.createdAt, approvedAt: v.approved.createdAt },
    expectedValue: v.to,
  };
  const history = `executed ${v.executed.id} at ${v.executed.createdAt}: deadline ${v.from} -> ${v.to} (approval ${v.approved.id})`;
  if (live.status === "READ_FAILED") return { ...o, state: "READ_FAILED", evidence: [history], reasons: [`live project read failed: ${live.detail}`], summaryHe: "לא הצלחתי לקרוא את המצב הנוכחי — לא נקבע דבר." };
  if (live.status === "NOT_FOUND") return { ...o, state: "TARGET_NOT_FOUND", evidence: [history, `project ${v.projectId} not found in projects`], reasons: ["TARGET_NOT_FOUND"], summaryHe: "הפרויקט שעליו בוצעה הפעולה לא נמצא." };
  const current = { value: live.deadline, updatedAt: live.updatedAt };
  const subjectLabel = typeof live.name === "string" && live.name.trim() ? live.name.trim() : null;
  const liveLine = `live projects.deadline = ${live.deadline ?? "null"} (updated_at ${live.updatedAt ?? "unknown"}) at ${evaluatedAt.toISOString()}`;
  if (live.deadline === v.to) {
    return { ...o, state: "APPLIED_AS_EXPECTED", current, subjectLabel, evidence: [history, liveLine], reasons: [], summaryHe: "השינוי שבוצע עדיין תואם למצב הנוכחי." };
  }
  const reasons = [`LIVE_VALUE_DIFFERS: expected ${v.to}, current ${live.deadline ?? "null"}`];
  if (live.updatedAt && Date.parse(live.updatedAt) > Date.parse(v.executed.createdAt)) reasons.push(`project updated after execution (${live.updatedAt} > ${v.executed.createdAt})`);
  return {
    ...o, state: "LIVE_STATE_CHANGED_AFTER_EXECUTION", current, subjectLabel, evidence: [history, liveLine], reasons,
    summaryHe: `הדדליין השתנה מאז הביצוע: בוצע ${heDate(v.to)}, כעת ${live.deadline ? heDate(live.deadline) : "ללא דדליין"}.`,
  };
}

// ── reader core (injected) ──

export interface OutcomeReaderDeps {
  /** READ-ONLY store capabilities only. */
  store: { getEventById(id: string): Promise<EventReadResult>; getActionChain(actionId: string): Promise<ActionChainReadResult> };
  readProjectDeadline(projectId: string): Promise<LiveDeadlineRead>;
  now(): Date;
}

export type OutcomeReadResult =
  | OutcomeDerivation
  | { kind: "INVALID_INPUT"; errors: string[] }
  | { kind: "EVENT_NOT_FOUND" }
  | { kind: "NOT_AN_EXECUTION_EVENT"; eventType: ActionEventType }
  | { kind: "STORE_READ_FAILED"; detail: string }
  | { kind: "STORED_DATA_INVALID"; errors: string[] };

/**
 * Reads the Outcome of the action behind ONE persisted EXECUTED event id. The chain is re-read and fully
 * validated; the executed event must be the chain head. The live project is read only after that.
 */
export async function readExecutedActionOutcomeCore(deps: OutcomeReaderDeps, executedEventId: unknown): Promise<OutcomeReadResult> {
  if (typeof executedEventId !== "string" || !LOWER_UUID_RE.test(executedEventId)) return { kind: "INVALID_INPUT", errors: ["executedEventId must be a lowercase uuid"] };
  const ev = await deps.store.getEventById(executedEventId);
  if (ev.status === "READ_FAILED") return { kind: "STORE_READ_FAILED", detail: ev.detail };
  if (ev.status === "INVALID_STORED_EVENT") return { kind: "STORED_DATA_INVALID", errors: ev.errors };
  if (ev.status === "NOT_FOUND") return { kind: "EVENT_NOT_FOUND" };
  if (ev.event.eventType !== "EXECUTED") return { kind: "NOT_AN_EXECUTION_EVENT", eventType: ev.event.eventType };
  const now = deps.now();
  const chain = await deps.store.getActionChain(ev.event.actionId);
  if (chain.status === "READ_FAILED") return { kind: "STORE_READ_FAILED", detail: chain.detail };
  if (chain.status === "INVALID_STORED_EVENT") return { kind: "STORED_DATA_INVALID", errors: chain.errors };
  if (chain.status === "INVALID_CHAIN") return invariant({ ...base(ev.event.actionId, now), executedEventId }, chain.reasons.map((r) => `INVALID_CHAIN: ${r}`));
  const v = validateExecutedChain(ev.event.actionId, chain.chain, now);
  if (!v.ok) return v.derivation;
  if (v.executed.id !== executedEventId) return invariant({ ...base(ev.event.actionId, now), executedEventId }, ["the requested EXECUTED event is not the head of its chain"]);
  let live: LiveDeadlineRead;
  try { live = await deps.readProjectDeadline(v.projectId); } catch (e) { live = { status: "READ_FAILED", detail: (e as Error).message }; }
  return { kind: "OUTCOME", outcome: outcomeFromLive(v, live, now) };
}

/** Outcomes of every EXECUTED action (ids come from the persisted store, oldest first). */
export async function listExecutedActionOutcomesCore(
  deps: OutcomeReaderDeps & { listExecutedEvents(): Promise<{ status: "OK"; events: PartnerActionEvent[] } | { status: "READ_FAILED"; detail: string } | { status: "INVALID_STORED_EVENT"; errors: string[] }> },
): Promise<{ status: "OK"; results: OutcomeReadResult[] } | { status: "STORE_READ_FAILED"; detail: string } | { status: "STORED_DATA_INVALID"; errors: string[] }> {
  const l = await deps.listExecutedEvents();
  if (l.status === "READ_FAILED") return { status: "STORE_READ_FAILED", detail: l.detail };
  if (l.status === "INVALID_STORED_EVENT") return { status: "STORED_DATA_INVALID", errors: l.errors };
  const results: OutcomeReadResult[] = [];
  for (const e of l.events) {
    if (e.eventType !== "EXECUTED") return { status: "STORED_DATA_INVALID", errors: [`listExecutedEvents returned a ${e.eventType} event`] };
    results.push(await readExecutedActionOutcomeCore(deps, e.id));
  }
  return { status: "OK", results };
}
