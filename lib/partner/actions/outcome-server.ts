import "server-only";

/**
 * Redbloods Partner — derived Action Outcome, server binding (Phase F.1L). READ-ONLY.
 * Binds the Outcome core to the existing Action Event store READS and a single canonical
 * read of projects (deadline, updated_at, name). F.1M: GET /api/partner/outcomes (Owner-only) is its only
 * consumer. Nothing here writes, calls the execution RPC, or advances the baseline.
 */
import { supabase } from "@/lib/supabase";
import { actionEventStore } from "./event-store";
import { buildRecentOutcomes, type RecentOutcomesResult } from "./recent-outcomes";
import { listExecutedActionOutcomesCore, readExecutedActionOutcomeCore, type LiveDeadlineRead, type OutcomeReaderDeps } from "./outcome";
import { listFinanceOutcomesCore, type FinanceTxLiveRow, type LiveBusinessKeyRead } from "./finance-outcome";

async function readProjectDeadline(projectId: string): Promise<LiveDeadlineRead> {
  const { data, error } = await supabase.from("projects").select("deadline,updated_at,name").eq("id", projectId).maybeSingle();
  if (error) return { status: "READ_FAILED", detail: error.message };
  if (!data) return { status: "NOT_FOUND" };
  const row = data as { deadline: unknown; updated_at: unknown; name: unknown };
  return { status: "FOUND", deadline: typeof row.deadline === "string" ? row.deadline : null, updatedAt: typeof row.updated_at === "string" ? row.updated_at : null, name: typeof row.name === "string" ? row.name : null };
}

/** F2.29 (read-only): the live transactions rows carrying one finance business key (one SELECT). */
async function readBusinessKey(linkedSessionId: string): Promise<LiveBusinessKeyRead> {
  const { data, error } = await supabase.from("transactions")
    .select("id,type,payment_status,amount,currency,date,description,category,scope,expense_scope,artist,project_id,linked_session_id")
    .eq("linked_session_id", linkedSessionId);
  if (error) return { status: "READ_FAILED", detail: error.message };
  return { status: "OK", rows: (data ?? []) as FinanceTxLiveRow[] };
}

/** F2.29: derived Outcomes of every executed RECORD_PAID_EXPENSE action (none until a real finance execution). */
export function listFinanceOutcomes() {
  return listFinanceOutcomesCore({ listFinanceEvents: (t) => actionEventStore.getFinanceEventsByType(t), readBusinessKey, now: () => new Date() });
}

const deps: OutcomeReaderDeps = {
  store: { getEventById: (id) => actionEventStore.getEventById(id), getActionChain: (id) => actionEventStore.getActionChain(id) },
  readProjectDeadline,
  now: () => new Date(),
};

/** Outcome of the action behind one persisted EXECUTED event. */
export function readExecutedActionOutcome(executedEventId: string) {
  return readExecutedActionOutcomeCore(deps, executedEventId);
}

/** Outcomes of every persisted EXECUTED action. */
export function listExecutedActionOutcomes() {
  return listExecutedActionOutcomesCore({ ...deps, listExecutedEvents: () => actionEventStore.getEventsByType("EXECUTED") });
}

/** F.1M: the Owner surface of recent executed Actions and their current derived Outcome (newest first, max 5). */
export function getRecentOutcomesSurface(): Promise<RecentOutcomesResult> {
  return buildRecentOutcomes({
    listExecutedEvents: () => actionEventStore.getEventsByType("EXECUTED"),
    readOutcome: (id) => readExecutedActionOutcomeCore(deps, id),
    listFinanceOutcomes,
    log: (event, data) => console.warn(`[partner-outcomes] ${event}`, JSON.stringify(data)),
  });
}
