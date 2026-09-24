/**
 * Redbloods Partner — derived Finance Action Outcome, CORE (Phase F2.29). Pure derivation + an injected-client
 * reader; READ-ONLY by construction.
 *
 * RECORD_PAID_EXPENSE (Victor salary): the EXECUTED event is the persisted fact "Partner recorded the canonical
 * expense row"; the Outcome is what the LIVE transactions table says about that row NOW (existing taxonomy):
 *   APPLIED_AS_EXPECTED                 exactly one row carries the business key, it IS the executed row, and every
 *                                       canonical field still equals the approved snapshot;
 *   LIVE_STATE_CHANGED_AFTER_EXECUTION  the executed row is still there but a field changed since (not a failure);
 *   TARGET_NOT_FOUND                    no row carries the business key any more;
 *   INVARIANT_VIOLATION                 >1 row for the key, the key's row is not the executed row, or the stored
 *                                       chain / snapshot / execution audit is not coherent (fail closed);
 *   READ_FAILED                         the live rows could not be read — nothing is concluded;
 *   UNSUPPORTED_ACTION                  not a RECORD_PAID_EXPENSE chain.
 * Derived, never persisted, never triggers anything (no transaction, event, Owner Context, Push).
 */
import { orderActionChain, type ActionEventType, type ChainEvent } from "./events";
import { ACTION_OUTCOME_STATES, type ActionOutcomeState } from "./outcome";
import { FINANCE_ACTION_TYPE, validateFinanceSnapshot, type PartnerFinanceActionEvent } from "./finance-events";
import type { FinanceEventListReadResult } from "./event-persistence";
import { hashActionSnapshot } from "./snapshot";
import { salaryMonthLabel } from "../../victor-salary-format";
import { FINANCE_OUTCOME_STATUS_HE } from "./outcome-dto";

export const FINANCE_OUTCOME_SCHEMA_VERSION = "partner-finance-action-outcome-v1";
export { ACTION_OUTCOME_STATES };

/** The canonical columns of one transactions row, as read live. */
export interface FinanceTxLiveRow {
  id: string; type: string; payment_status: string; amount: number | string; currency: string; date: string | null;
  description: string; category: string; scope: string; expense_scope: string | null; artist: string; project_id: string | null;
  linked_session_id: string;
}
export type LiveBusinessKeyRead = { status: "OK"; rows: FinanceTxLiveRow[] } | { status: "READ_FAILED"; detail: string };

export interface PartnerFinanceActionOutcome {
  schemaVersion: typeof FINANCE_OUTCOME_SCHEMA_VERSION;
  state: ActionOutcomeState;
  actionId: string;
  actionType: string;
  /** The business subject (never the derived audit UUID). */
  subject: { type: "recurring"; key: string } | null;
  period: string | null;
  approvalEventId: string | null;
  executedEventId: string | null;
  snapshotHash: string | null;
  /** HISTORICAL — what Partner recorded (from the snapshot + execution audit). Never replaced by live data. */
  executed: { transactionId: string; amount: number; currency: string; paymentDate: string; linkedSessionId: string; description: string; executedAt: string; approvedAt: string } | null;
  /** CURRENT — the live rows carrying the business key (null when not read). */
  current: { transactionIds: string[]; matches: boolean } | null;
  evaluatedAt: string;
  evidence: string[];
  reasons: string[];
  headlineHe: string;
  summaryHe: string;
}

export type FinanceOutcomeDerivation =
  | { kind: "OUTCOME"; outcome: PartnerFinanceActionOutcome }
  | { kind: "NO_OUTCOME"; actionId: string; reason: "NO_EVENTS" | "NOT_EXECUTED" | "STALE_AT_EXECUTION"; headEventType: ActionEventType | null };

type AnyChainEvent = ChainEvent & { actionType: string; createdAt: string; snapshotHash: string; snapshot: unknown; execution: Record<string, unknown> | null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const heDate = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
const money = (currency: string, amount: number) => `${currency}${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** The business-language headline of a recorded Victor salary (no ids / hashes). */
export function financeOutcomeHeadlineHe(period: string, currency: string, amount: number, paymentDate: string): string {
  return `משכורת Victor עבור ${salaryMonthLabel(period)} נרשמה בכספים — ${money(currency, amount)}, ${heDate(paymentDate)}.`;
}

function base(actionId: string, evaluatedAt: Date): PartnerFinanceActionOutcome {
  return {
    schemaVersion: FINANCE_OUTCOME_SCHEMA_VERSION, state: "INVARIANT_VIOLATION", actionId, actionType: "UNKNOWN", subject: null, period: null,
    approvalEventId: null, executedEventId: null, snapshotHash: null, executed: null, current: null,
    evaluatedAt: evaluatedAt.toISOString(), evidence: [], reasons: [], headlineHe: "", summaryHe: "",
  };
}
const invariant = (o: PartnerFinanceActionOutcome, reasons: string[]): FinanceOutcomeDerivation =>
  ({ kind: "OUTCOME", outcome: { ...o, state: "INVARIANT_VIOLATION", reasons, summaryHe: "הנתונים השמורים של הפעולה אינם עקביים — לא ניתן לקבוע מצב." } });

/** Pure: the current Outcome of ONE finance action from its persisted chain and the live rows of its business key. */
export function deriveFinanceExpenseOutcome(input: { actionId: string; events: readonly AnyChainEvent[]; live: LiveBusinessKeyRead; evaluatedAt: Date }): FinanceOutcomeDerivation {
  const o = base(input.actionId, input.evaluatedAt);
  const ordered = orderActionChain(input.actionId, input.events);
  if (ordered.status !== "OK") return invariant(o, ordered.reasons.map((r) => `INVALID_CHAIN: ${r}`));
  const head = ordered.head;
  if (!head) return { kind: "NO_OUTCOME", actionId: input.actionId, reason: "NO_EVENTS", headEventType: null };
  if (head.eventType === "STALE_AT_EXECUTION") return { kind: "NO_OUTCOME", actionId: input.actionId, reason: "STALE_AT_EXECUTION", headEventType: head.eventType };
  if (head.eventType !== "EXECUTED") return { kind: "NO_OUTCOME", actionId: input.actionId, reason: "NOT_EXECUTED", headEventType: head.eventType };
  const executed = head;
  const withIds = { ...o, actionType: String(executed.actionType), executedEventId: executed.id, snapshotHash: executed.snapshotHash };
  if (ordered.chain.some((e) => e.actionType !== FINANCE_ACTION_TYPE)) {
    return { kind: "OUTCOME", outcome: { ...withIds, state: "UNSUPPORTED_ACTION", reasons: [`action type ${JSON.stringify(executed.actionType)} has no finance Outcome model`], summaryHe: "סוג הפעולה אינו נתמך לבדיקת מצב." } };
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
  const snapErrors = validateFinanceSnapshot(executed.snapshot);
  reasons.push(...snapErrors.map((r) => `snapshot: ${r}`));
  const snap = executed.snapshot as Record<string, unknown>;
  if (isObj(snap) && snap.id !== input.actionId) reasons.push("snapshot does not describe this action");
  const facts = (isObj(snap) && isObj(snap.facts) ? snap.facts : {}) as Record<string, unknown>;
  const ex = executed.execution;
  const txId = isObj(ex) && typeof ex.transactionId === "string" && UUID.test(ex.transactionId) ? ex.transactionId : null;
  if (!isObj(ex) || ex.mutated !== true || ex.rowsAffected !== 1 || !txId || ex.businessKey !== facts.linkedSessionId) reasons.push("execution audit does not record exactly one committed canonical row (mutated, 1 row, transactionId, business key)");
  if (reasons.length || !approved || !txId) return invariant(withIds, reasons);

  const period = String(snap.period);
  const amount = facts.amount as number, currency = String(facts.currency), paymentDate = String(facts.date), linked = String(facts.linkedSessionId);
  const out: PartnerFinanceActionOutcome = {
    ...withIds,
    actionType: FINANCE_ACTION_TYPE,
    subject: { type: "recurring", key: String(snap.subjectKey) },
    period,
    approvalEventId: approved.id,
    executed: { transactionId: txId, amount, currency, paymentDate, linkedSessionId: linked, description: String(facts.description), executedAt: executed.createdAt, approvedAt: approved.createdAt },
    headlineHe: financeOutcomeHeadlineHe(period, currency, amount, paymentDate),
  };
  const history = `executed ${executed.id} at ${executed.createdAt}: ${linked} → transaction ${txId} (${currency}${amount}, ${paymentDate}; approval ${approved.id})`;
  const live = input.live;
  if (live.status === "READ_FAILED") return { kind: "OUTCOME", outcome: { ...out, state: "READ_FAILED", evidence: [history], reasons: [`live transactions read failed: ${live.detail}`], summaryHe: FINANCE_OUTCOME_STATUS_HE.READ_FAILED } };
  const rows = live.rows.filter((r) => r.linked_session_id === linked);
  const current = { transactionIds: rows.map((r) => r.id).sort(), matches: false };
  const liveLine = `live transactions with ${linked}: [${current.transactionIds.join(", ")}] at ${input.evaluatedAt.toISOString()}`;
  if (rows.length === 0) return { kind: "OUTCOME", outcome: { ...out, state: "TARGET_NOT_FOUND", current, evidence: [history, liveLine], reasons: ["TARGET_NOT_FOUND"], summaryHe: FINANCE_OUTCOME_STATUS_HE.TARGET_NOT_FOUND } };
  if (rows.length > 1) return invariant({ ...out, current, evidence: [history, liveLine] }, [`${rows.length} rows carry the business key ${linked}`]);
  const r = rows[0];
  if (r.id !== txId) return invariant({ ...out, current, evidence: [history, liveLine] }, [`the business key row ${r.id} is not the executed row ${txId}`]);
  const diffs: string[] = [];
  const want: Array<[string, unknown, unknown]> = [
    ["type", r.type, "expense"], ["payment_status", r.payment_status, "שולם"], ["amount", Number(r.amount), amount], ["currency", r.currency, currency],
    ["date", r.date, paymentDate], ["description", r.description, facts.description], ["category", r.category, facts.category], ["scope", r.scope, facts.scope],
    ["expense_scope", r.expense_scope, facts.expenseScope], ["artist", r.artist, facts.artist], ["project_id", r.project_id, null],
  ];
  for (const [k, got, exp] of want) if (got !== exp) diffs.push(`${k}: expected ${JSON.stringify(exp)}, current ${JSON.stringify(got)}`);
  if (!diffs.length) return { kind: "OUTCOME", outcome: { ...out, state: "APPLIED_AS_EXPECTED", current: { ...current, matches: true }, evidence: [history, liveLine], reasons: [], summaryHe: FINANCE_OUTCOME_STATUS_HE.APPLIED_AS_EXPECTED } };
  return { kind: "OUTCOME", outcome: { ...out, state: "LIVE_STATE_CHANGED_AFTER_EXECUTION", current, evidence: [history, liveLine], reasons: diffs.map((d) => `LIVE_VALUE_DIFFERS: ${d}`), summaryHe: FINANCE_OUTCOME_STATUS_HE.LIVE_STATE_CHANGED_AFTER_EXECUTION } };
}

// ── reader core (injected, READ-ONLY capabilities only) ──

export interface FinanceOutcomeReaderDeps {
  listFinanceEvents(eventType: ActionEventType): Promise<FinanceEventListReadResult>;
  readBusinessKey(linkedSessionId: string): Promise<LiveBusinessKeyRead>;
  now(): Date;
}
export type FinanceOutcomesListResult =
  | { status: "OK"; outcomes: PartnerFinanceActionOutcome[]; omitted: Array<{ actionId: string; reason: string }> }
  | { status: "STORE_READ_FAILED"; detail: string }
  | { status: "STORED_DATA_INVALID"; errors: string[] };

/**
 * Outcomes of every executed finance action. Lists EXECUTED first (one read; nothing else happens when there
 * are none), then reads the full chains and each business key's live rows.
 */
export async function listFinanceOutcomesCore(deps: FinanceOutcomeReaderDeps): Promise<FinanceOutcomesListResult> {
  const ex = await deps.listFinanceEvents("EXECUTED");
  if (ex.status === "READ_FAILED") return { status: "STORE_READ_FAILED", detail: ex.detail };
  if (ex.status === "INVALID_STORED_EVENT") return { status: "STORED_DATA_INVALID", errors: ex.errors };
  if (!ex.events.length) return { status: "OK", outcomes: [], omitted: [] };
  const all: PartnerFinanceActionEvent[] = [...ex.events];
  for (const t of ["APPROVED", "NOT_NOW", "REJECTED", "STALE_AT_EXECUTION"] as const) {
    const r = await deps.listFinanceEvents(t);
    if (r.status === "READ_FAILED") return { status: "STORE_READ_FAILED", detail: r.detail };
    if (r.status === "INVALID_STORED_EVENT") return { status: "STORED_DATA_INVALID", errors: r.errors };
    all.push(...r.events);
  }
  const now = deps.now();
  const outcomes: PartnerFinanceActionOutcome[] = [];
  const omitted: Array<{ actionId: string; reason: string }> = [];
  for (const e of ex.events) {
    const chain = all.filter((x) => x.actionId === e.actionId);
    const linked = e.snapshot.facts.linkedSessionId;
    let live: LiveBusinessKeyRead;
    try { live = await deps.readBusinessKey(linked); } catch (err) { live = { status: "READ_FAILED", detail: (err as Error).message }; }
    const d = deriveFinanceExpenseOutcome({ actionId: e.actionId, events: chain, live, evaluatedAt: now });
    if (d.kind === "OUTCOME") outcomes.push(d.outcome); else omitted.push({ actionId: e.actionId, reason: d.reason });
  }
  return { status: "OK", outcomes, omitted };
}
