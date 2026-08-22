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

/**
 * The riddim mix line a specific version belongs to, as display text.
 *
 * Resolved purely from the DB — mix_versions.mix_target_id → mix_targets — so a
 * renamed line is picked up automatically on the next send and a line added
 * later needs no code change. Never parsed from the file name or the label, and
 * never taken from the client: the caller passes an ID and this returns the
 * text, which is what keeps "Send notes" un-spoofable.
 *
 * Returns null when the work is not a riddim, the version does not belong to it,
 * or the version carries no line (a pre-feature "unassigned" row) — in every one
 * of those cases the caller keeps its existing, unchanged wording.
 */
export async function resolveMixLineContext(
  workId: string,
  mixVersionId: string | null | undefined,
): Promise<{ targetName: string; label: string; versionId: string } | null> {
  if (!mixVersionId) return null;
  if (!(await isRiddimWork(workId))) return null;

  const { data: version } = await supabase
    .from("mix_versions")
    .select("id, label, mix_target_id, sound_engineer_work_id")
    .eq("id", mixVersionId)
    .maybeSingle();
  // Ownership check: a version id from another work must never name this one.
  if (!version || version.sound_engineer_work_id !== workId) return null;

  const targetId = (version.mix_target_id as string | null) ?? null;
  if (!targetId) return null;                    // legacy / unassigned — no line

  const { data: target } = await supabase
    .from("mix_targets")
    .select("target_kind, display_name")
    .eq("id", targetId)
    .maybeSingle();
  if (!target) return null;

  // The instrumental has no stored name by design; its label is a constant here,
  // matching the English the push already speaks.
  const targetName = target.target_kind === "instrumental"
    ? "Instrumental"
    : ((target.display_name as string) ?? "").trim();
  if (!targetName) return null;

  return { targetName, label: (version.label as string) ?? "", versionId: version.id as string };
}
