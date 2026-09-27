import "server-only";

import { supabase } from "@/lib/supabase";
import { sendPushToRoles } from "@/lib/push";
import { STEVEN_ENGINEER } from "@/lib/steven-scope";
import {
  processStevenCompletion,
  releaseStevenFinalFilesRequest,
  type StevenCompletionDeps,
  type StevenCompletionOutcome,
} from "@/lib/steven-completed-pure";

/**
 * Real Supabase/push wiring for the "Steven work completed" flow. ALL decisions
 * live in lib/steven-completed-pure.ts (see its header for the full behaviour);
 * this file only supplies the I/O behind `StevenCompletionDeps`.
 *
 * Called ONLY from lib/sound-engineer-store.ts: runStevenWorkCompleted from
 * updateSoundEngineerWork on a REAL transition into completed ("אושר") — never on
 * refresh / page load / re-save / payment edit; releaseStevenFinalFilesRequestFor from
 * updateSoundEngineerWork on a real closed → open transition and from
 * createSoundEngineerWork for a new open work. Best-effort: never throws into the
 * work path. Restricted to engineer_name === "Steven" (the route also serves Bill
 * and custom engineers).
 *
 * No schema change: the final-files request lives in the existing `settings`
 * key/value table as ONE row per project (or per standalone work) that is both the
 * INSERT-first claim and the marker Steven's Blur reads. It is deleted when a
 * Steven work on that project becomes open again (or a new open one is created),
 * which is what makes a genuine re-completion a new cycle.
 *
 * Deliberately NOT done here: NO project status write (engineer completion only SUGGESTS completing the project —
 * the Owner decides, Owner decision 2026-09-27), no Victor sync/push, no delivery-folder dialog
 * (those belong to the manual /projects StatusDropdown), no Projects → Steven
 * direction, no agent_alerts.
 */

/** Never send real push from local/dev — only production (or an explicit opt-in). */
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

const realDeps: StevenCompletionDeps = {
  async listOtherStevenWorks(projectId, excludeWorkId) {
    const { data, error } = await supabase
      .from("sound_engineer_work")
      .select("status")
      .eq("project_id", projectId)
      .eq("engineer_name", STEVEN_ENGINEER)
      .neq("id", excludeWorkId);
    if (error) throw new Error(error.message);
    return (data ?? []) as { status: string | null }[];
  },

  async readProjectStatus(projectId) {
    // READ-ONLY (Owner decision 2026-09-27: engineer completed ≠ project completed). The project is never written by
    // this flow; an open project comes back to the Owner's UI as the suggestion "suggested".
    const { data, error } = await supabase.from("projects").select("status").eq("id", projectId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("linked project not found"); // never guess another project
    return data.status as string;
  },

  async claimFinalFilesRequest(key, value) {
    // INSERT-first: the settings.key uniqueness makes exactly one caller win per
    // key for as long as the row exists. The row IS the final-files-requested marker
    // (project-scoped when the work has a project). supabase-js does not throw on a
    // DB error — it returns { error }.
    const { error } = await supabase.from("settings").insert({ key, value });
    if (!error) return "won";
    if (error.code === "23505") return "lost";
    console.error(`[steven-completion] final-files request insert failed (${key}): ${error.message}`);
    return "error";
  },

  async releaseFinalFilesRequest(key) {
    const { error } = await supabase.from("settings").delete().eq("key", key);
    if (error) throw new Error(error.message);
  },

  pushAllowed,
  now: () => Date.now(),

  async sendToSteven(push) {
    return (await sendPushToRoles(["steven"], push)) as unknown as { status: string }[];
  },
  async sendToOwner(push) {
    await sendPushToRoles(["owner"], push);
  },

  log: (msg) => console.info(msg),
  logError: (msg, err) => console.error(msg, err ?? ""),
};

export async function runStevenWorkCompleted(work: {
  id: string;
  engineerName: string;
  /** sound_engineer_work.project_id — null for a standalone work. */
  projectId: string | null;
  /** stevenDisplayName(work): the name Steven sees, not the raw project name. */
  displayName: string;
  /** The work row's updated_at from BEFORE this transition's write. */
  fromUpdatedAt: string;
}): Promise<StevenCompletionOutcome | null> {
  if (work.engineerName !== STEVEN_ENGINEER || !work.id) return null;
  try {
    return await processStevenCompletion(
      { id: work.id, projectId: work.projectId, displayName: work.displayName, fromUpdatedAt: work.fromUpdatedAt },
      realDeps,
    );
  } catch (e) {
    console.error("[steven-completion] failed:", e);
    return null;
  }
}

/**
 * Ends the current final-files-request cycle for a Steven work's project (or the
 * work itself when it has none). Called when a Steven work goes closed → open, or a
 * new open Steven work is created. Never throws; restricted to engineer "Steven".
 */
export async function releaseStevenFinalFilesRequestFor(work: {
  id: string;
  engineerName: string;
  projectId: string | null;
}): Promise<void> {
  if (work.engineerName !== STEVEN_ENGINEER || !work.id) return;
  try {
    await releaseStevenFinalFilesRequest({ id: work.id, projectId: work.projectId }, realDeps);
  } catch (e) {
    console.error("[steven-completion] release failed:", e);
  }
}
