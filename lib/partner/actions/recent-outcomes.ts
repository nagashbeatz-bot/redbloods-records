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
import { RECENT_OUTCOMES_DTO_VERSION, RECENT_OUTCOMES_LIMIT, toOutcomeCardDto, type PartnerOutcomeCardDto, type RecentOutcomesResponse } from "./outcome-dto";

export interface RecentOutcomesDeps {
  listExecutedEvents(): Promise<{ status: "OK"; events: PartnerActionEvent[] } | { status: "READ_FAILED"; detail: string } | { status: "INVALID_STORED_EVENT"; errors: string[] }>;
  readOutcome(executedEventId: string): Promise<OutcomeReadResult>;
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
  const items: PartnerOutcomeCardDto[] = [];
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
  return { status: "OK", response: { v: RECENT_OUTCOMES_DTO_VERSION, items } };
}
