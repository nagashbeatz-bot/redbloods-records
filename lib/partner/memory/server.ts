import "server-only";

/**
 * Redbloods Partner — Organizational Memory V1, server binding. READ-ONLY.
 *
 * Gathers the existing canonical sources (no memory table, no new store) and hands them to the pure
 * builder: the finance live read (raw facts + view), the FULL Owner Context history, every Partner
 * Action Event, and the derived Outcomes of executed Actions. Each source fails closed on its own
 * (UNAVAILABLE is reported — never read as "nothing happened"). Nothing here writes, executes or
 * sends anything; it is developer / reasoning infrastructure (shadow tooling), with no route yet.
 */
import { listOwnerContexts } from "../investigation/context-store";
import { actionEventStore } from "../actions/event-store";
import { listExecutedActionOutcomes, listFinanceOutcomes } from "../actions/outcome-server";
import { loadFinanceLive, type FinanceLiveResult } from "../finance/server";
import type { PartnerActionEvent } from "../actions/events";
import type { PartnerActionOutcome } from "../actions/outcome";
import type { PartnerFinanceActionEvent } from "../actions/finance-events";
import { buildPartnerMemory, type MemorySources } from "./core";
import type { PartnerMemory } from "./types";

const EVENT_TYPES = ["APPROVED", "NOT_NOW", "REJECTED", "EXECUTED", "STALE_AT_EXECUTION"] as const;

/** opts.finance: an already-read finance derivation of the SAME request (Gateway request-scoped read) — reused, never re-read. */
export async function loadPartnerMemory(now: Date = new Date(), opts: { finance?: FinanceLiveResult } = {}): Promise<PartnerMemory> {
  const [finance, contexts, events, financeEvents, outcomes, financeOutcomes] = await Promise.all([
    (opts.finance ? Promise.resolve(opts.finance) : loadFinanceLive(now)).catch((e) => ({ status: "UNAVAILABLE" as const, detail: (e as Error).message })),
    listOwnerContexts().catch((e) => ({ status: "READ_FAILED" as const, error: e as Error })),
    Promise.all(EVENT_TYPES.map((t) => actionEventStore.getEventsByType(t))).catch((e) => [{ status: "READ_FAILED" as const, detail: (e as Error).message }]),
    Promise.all(EVENT_TYPES.map((t) => actionEventStore.getFinanceEventsByType(t))).catch((e) => [{ status: "READ_FAILED" as const, detail: (e as Error).message }]),
    listExecutedActionOutcomes().catch((e) => ({ status: "STORE_READ_FAILED" as const, detail: (e as Error).message })),
    listFinanceOutcomes().catch((e) => ({ status: "STORE_READ_FAILED" as const, detail: (e as Error).message })),
  ]);

  const src: MemorySources = {
    now,
    finance: finance.status === "OK" ? { status: "OK", raw: finance.raw, view: finance.view } : { status: "UNAVAILABLE", detail: "detail" in finance ? finance.detail : "finance unavailable" },
    ownerContexts: contexts.status === "OK" ? { status: "OK", history: contexts.contexts } : contexts.status === "NO_CONTEXT" ? { status: "OK", history: [] } : { status: "UNAVAILABLE", detail: contexts.status },
    actionEvents: events.every((r) => r.status === "OK") && financeEvents.every((r) => r.status === "OK")
      ? { status: "OK", events: [...(events.flatMap((r) => (r.status === "OK" ? r.events : [])) as PartnerActionEvent[]), ...(financeEvents.flatMap((r) => (r.status === "OK" ? r.events : [])) as PartnerFinanceActionEvent[])] }
      : { status: "UNAVAILABLE", detail: "action events unreadable" },
    outcomes: outcomes.status === "OK" && financeOutcomes.status === "OK"
      ? { status: "OK", outcomes: [...(outcomes.results.flatMap((r) => (r.kind === "OUTCOME" ? [r.outcome] : [])) as PartnerActionOutcome[]), ...financeOutcomes.outcomes] }
      : { status: "UNAVAILABLE", detail: outcomes.status !== "OK" ? outcomes.status : financeOutcomes.status },
  };
  return buildPartnerMemory(src);
}
