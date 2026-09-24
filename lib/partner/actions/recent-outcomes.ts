/**
 * Redbloods Partner — recent executed Actions surface, CORE (Phase F.1M). READ-ONLY by construction.
 *
 *   EXECUTED Action Events (persisted) → newest first by created_at → the F.1L Outcome reader
 *   (validated chain + live canonical read) → display DTO.
 *
 * Its only capabilities are "list EXECUTED events" and "read one Outcome" — no decision, append, RPC,
 * Owner Context, Feedback or baseline access. Outcomes that must not be shown (UNSUPPORTED_ACTION,
 * INVARIANT_VIOLATION, no Outcome, unreadable) are omitted and logged — never reinterpreted.
 */
import type { PartnerActionEvent } from "./events";
import type { OutcomeReadResult } from "./outcome";
import { RECENT_OUTCOMES_DTO_VERSION, RECENT_OUTCOMES_LIMIT, toFinanceOutcomeCardDto, toOutcomeCardDto, type PartnerOutcomeItemDto, type RecentOutcomesResponse } from "./outcome-dto";
import type { FinanceOutcomesListResult } from "./finance-outcome";

export interface RecentOutcomesDeps {
  listExecutedEvents(): Promise<{ status: "OK"; events: PartnerActionEvent[] } | { status: "READ_FAILED"; detail: string } | { status: "INVALID_STORED_EVENT"; errors: string[] }>;
  readOutcome(executedEventId: string): Promise<OutcomeReadResult>;
  /** F2.29 (optional, read-only): derived Outcomes of executed RECORD_PAID_EXPENSE actions. Absent / failing → deadline cards only. */
  listFinanceOutcomes?(): Promise<FinanceOutcomesListResult>;
  log(event: string, data: Record<string, unknown>): void;
}

export type RecentOutcomesResult = { status: "OK"; response: RecentOutcomesResponse } | { status: "UNAVAILABLE" };

/** created_at DESC, then id DESC — deterministic newest first. */
function newestFirst(a: PartnerActionEvent, b: PartnerActionEvent): number {
  const d = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return d !== 0 ? d : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export async function buildRecentOutcomes(deps: RecentOutcomesDeps, limit: number = RECENT_OUTCOMES_LIMIT): Promise<RecentOutcomesResult> {
  const max = Math.max(0, Math.min(Math.floor(limit), RECENT_OUTCOMES_LIMIT));
  const listed = await deps.listExecutedEvents();
  if (listed.status !== "OK") {
    deps.log("partner_outcomes_unavailable", { reason: listed.status, detail: listed.status === "READ_FAILED" ? listed.detail : listed.errors.join("; ") });
    return { status: "UNAVAILABLE" };
  }
  const events = listed.events.filter((e) => e.eventType === "EXECUTED").sort(newestFirst);
  if (events.length !== listed.events.length) deps.log("partner_outcomes_non_executed_listed", { count: listed.events.length - events.length });
  const items: PartnerOutcomeItemDto[] = [];
  for (const e of events) {
    if (items.length >= max) break;
    let r: OutcomeReadResult;
    try { r = await deps.readOutcome(e.id); } catch (err) { deps.log("partner_outcome_omitted", { executedEventId: e.id, reason: "READ_THREW", detail: (err as Error).message }); continue; }
    if (r.kind !== "OUTCOME") { deps.log("partner_outcome_omitted", { executedEventId: e.id, reason: r.kind }); continue; }
    const o = r.outcome;
    if (o.state === "UNSUPPORTED_ACTION" || o.state === "INVARIANT_VIOLATION") {
      deps.log("partner_outcome_omitted", { executedEventId: e.id, actionId: o.actionId, reason: o.state, reasons: o.reasons });
      continue;
    }
    try { items.push(toOutcomeCardDto(o)); } catch (err) { deps.log("partner_outcome_omitted", { executedEventId: e.id, actionId: o.actionId, reason: "DTO_REJECTED", detail: (err as Error).message }); }
  }
  // F2.29: finance cards (none exist until a real finance execution) merged newest first; with none, the response
  // is exactly the deadline response above.
  if (deps.listFinanceOutcomes) {
    let fin: FinanceOutcomesListResult | null = null;
    try { fin = await deps.listFinanceOutcomes(); } catch (err) { deps.log("partner_finance_outcomes_unavailable", { reason: "READ_THREW", detail: (err as Error).message }); }
    if (fin && fin.status !== "OK") deps.log("partner_finance_outcomes_unavailable", { reason: fin.status, detail: fin.status === "STORE_READ_FAILED" ? fin.detail : fin.errors.join("; ") });
    if (fin && fin.status === "OK" && fin.outcomes.length) {
      for (const o of fin.outcomes) {
        if (o.state === "UNSUPPORTED_ACTION" || o.state === "INVARIANT_VIOLATION") { deps.log("partner_outcome_omitted", { executedEventId: o.executedEventId, actionId: o.actionId, reason: o.state, reasons: o.reasons }); continue; }
        try { items.push(toFinanceOutcomeCardDto(o)); } catch (err) { deps.log("partner_outcome_omitted", { executedEventId: o.executedEventId, actionId: o.actionId, reason: "DTO_REJECTED", detail: (err as Error).message }); }
      }
      items.sort((a, b) => (Date.parse(b.executedAt) - Date.parse(a.executedAt)) || (a.executedEventId < b.executedEventId ? 1 : a.executedEventId > b.executedEventId ? -1 : 0));
      items.splice(max);
    }
  }
  return { status: "OK", response: { v: RECENT_OUTCOMES_DTO_VERSION, items } };
}
