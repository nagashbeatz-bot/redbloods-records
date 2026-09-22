import "server-only";

/**
 * Redbloods Partner — Change Awareness runtime entrypoint (Phase D.3).
 *
 * Server-only shell: wires the real Supabase-backed baseline store into the
 * pure lifecycle orchestrator, and fetches (read-only, once) the current
 * PartnerCompanyState. Mirrors lib/partner/eyes/build.ts's own shape exactly.
 *
 * No public API route (Owner instruction §58: "No public endpoint unless
 * strictly needed"). No cron, no schedule (Owner instruction §59) — this is
 * invoked manually today, e.g. from scripts/partner-change-report.ts's
 * production-safe QA or a future internal caller.
 */
import { buildPartnerCompanyState } from "../eyes/build";
import { loadPartnerBaseline, savePartnerBaseline } from "./store";
import { runPartnerChangeAwareness as runPure, type ChangeAwarenessRunResult } from "./lifecycle";

export async function runPartnerChangeAwareness(now: Date = new Date()): Promise<ChangeAwarenessRunResult> {
  const state = await buildPartnerCompanyState(now);
  return runPure(state, { load: loadPartnerBaseline, save: savePartnerBaseline });
}
