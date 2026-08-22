/**
 * Riddim-mode resolution — server-only. The single place that answers "is this
 * Steven work a riddim?", so no route or store repeats the join or invents its
 * own test.
 *
 * The answer comes ONLY from the linked project's canonical
 * projects.project_type — never from the work title, the file names, or any
 * string match. A standalone work (project_id null) therefore can never be a
 * riddim, and neither can a project whose type was never set.
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import { isRiddimProjectType } from "@/lib/steven-scope";

/** The linked project's project_type ("" when standalone / unset / missing). */
export async function projectTypeForWork(workId: string): Promise<string | null> {
  const { data: work, error } = await supabase
    .from("sound_engineer_work").select("project_id").eq("id", workId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!work) return null;                       // work does not exist

  const projectId = (work.project_id as string | null) ?? null;
  if (!projectId) return "";                    // standalone — no project, no type

  const { data: proj } = await supabase
    .from("projects").select("project_type").eq("id", projectId).maybeSingle();
  return (proj?.project_type as string | null) ?? "";
}

/** True when this work runs in riddim mode. Non-existent work → false. */
export async function isRiddimWork(workId: string): Promise<boolean> {
  return isRiddimProjectType(await projectTypeForWork(workId));
}

export type RiddimGuard =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Guard for the roster routes: the work must exist AND be a riddim. Rosters are
 * meaningless on a normal mix work, so this keeps mix_targets rows from ever
 * appearing on one.
 */
export async function assertRiddimWork(workId: string): Promise<RiddimGuard> {
  const projectType = await projectTypeForWork(workId);
  if (projectType === null) return { ok: false, status: 404, error: "עבודה לא נמצאה" };
  if (!isRiddimProjectType(projectType)) {
    return { ok: false, status: 400, error: "רשימת אמנים קיימת רק בפרויקט מסוג רידים" };
  }
  return { ok: true };
}
