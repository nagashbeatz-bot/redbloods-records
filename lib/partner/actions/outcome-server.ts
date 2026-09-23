import "server-only";

/**
 * Redbloods Partner — derived Action Outcome, server binding (Phase F.1L). READ-ONLY.
 * Binds the Outcome core to the existing Action Event store READS and a single canonical
 * read of projects (deadline, updated_at). No route, UI, cron or agent imports it yet;
 * nothing here writes, calls the execution RPC, or advances the baseline.
 */
import { supabase } from "@/lib/supabase";
import { actionEventStore } from "./event-store";
import { listExecutedActionOutcomesCore, readExecutedActionOutcomeCore, type LiveDeadlineRead, type OutcomeReaderDeps } from "./outcome";

async function readProjectDeadline(projectId: string): Promise<LiveDeadlineRead> {
  const { data, error } = await supabase.from("projects").select("deadline,updated_at").eq("id", projectId).maybeSingle();
  if (error) return { status: "READ_FAILED", detail: error.message };
  if (!data) return { status: "NOT_FOUND" };
  const row = data as { deadline: unknown; updated_at: unknown };
  return { status: "FOUND", deadline: typeof row.deadline === "string" ? row.deadline : null, updatedAt: typeof row.updated_at === "string" ? row.updated_at : null };
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
