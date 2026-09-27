/**
 * Shared validated project writers — used by BOTH the Redbloods UI routes and Sunny's typed primitives, so the two
 * paths can never diverge. Behaviour is exactly the routes' existing behaviour (extracted, not redesigned).
 */
import { supabase } from "@/lib/supabase";
import { createProject, getProject, updateProject } from "@/lib/projects-store";
import { projectBaseFolder } from "@/lib/project-paths";
import { upsertArtistsFromProject } from "@/lib/clients-store";
import { newProjectBusinessType } from "@/lib/project-classification-server";
import { israelTodayYmd } from "@/lib/project-deadline";
import { PROJECT_PROTECTED_STATUSES, decideProjectSync } from "@/lib/steven-completed-pure";
/** B2: the business type a NEW project gets — the Owner rule (Shalev / Avi credited → לייבל), else לקוח. */
export { newProjectBusinessType };

/**
 * Status change — the app's single end-date rule (B5, 2026-09-27): end_date is stamped only on a REAL transition into
 * "הושלם" (Israel day). Re-saving "הושלם" on a project that is already הושלם with an end date keeps that end date (no
 * end_date key in the patch); any other status clears it. `current` = the project as read just before the write
 * (null when unknown → treated as a transition).
 */
export function statusPatch(status: string, current: { status?: string | null; endDate?: string | null } | null, today: string = israelTodayYmd()): { status: string; end_date?: string | null } {
  if (status !== "הושלם") return { status, end_date: null };
  if (current?.status === "הושלם" && current.endDate) return { status };
  return { status, end_date: today };
}

/** A project is completed by a team hand-off never from בוטל / בהשהייה (Owner protected — the SAME set and decision as
 *  the Steven completion, lib/steven-completed-pure.ts) and never twice. */
export const COMPLETION_PROTECTED_STATUSES: readonly string[] = PROJECT_PROTECTED_STATUSES;
export type CompleteProjectResult =
  | { ok: true; status: "הושלם"; endDate: string | null }
  | { ok: false; refused: "NOT_FOUND" | "PROTECTED_STATUS" | "ALREADY_COMPLETED"; status: string | null };

/** Pure decision for completeProjectIfAllowed (tests drive it directly). */
export function completionDecision(current: { status?: string | null } | null): { allowed: true } | { allowed: false; refused: "NOT_FOUND" | "PROTECTED_STATUS" | "ALREADY_COMPLETED" } {
  if (!current) return { allowed: false, refused: "NOT_FOUND" };
  const d = decideProjectSync(current.status);
  if (d === "already_completed") return { allowed: false, refused: "ALREADY_COMPLETED" };
  if (d === "protected") return { allowed: false, refused: "PROTECTED_STATUS" };
  return { allowed: true };
}

/**
 * Mark a project הושלם because a team hand-off finished (Victor "projectToo") — the server rule, never the client:
 * refused for a protected status (בוטל / בהשהייה — the same set as the Steven completion) or an already completed
 * project; otherwise the shared statusPatch (end date stamped on the real transition). Re-reads after writing.
 */
export async function completeProjectIfAllowed(projectId: string): Promise<CompleteProjectResult> {
  const current = await getProject(projectId);
  const d = completionDecision(current);
  if (!d.allowed) return { ok: false, refused: d.refused, status: current?.status ?? null };
  await updateProject(projectId, statusPatch("הושלם", current ? { status: current.status, endDate: current.endDate } : null));
  const after = await getProject(projectId);
  return { ok: true, status: "הושלם", endDate: after?.endDate ?? null };
}

/**
 * Freeze-before-rename: a name change must NEVER relocate the project's storage folder. If the project isn't frozen
 * yet, freeze it to its CURRENT (pre-rename) canonical folder in the same update. Never overwrites an existing value.
 */
export function freezeFolderPatch(current: { id: string; artist?: string | null; name?: string | null; dropboxFolder?: string | null } | null): { dropbox_folder?: string } {
  if (!current || (current.dropboxFolder ?? "").trim()) return {};
  return { dropbox_folder: projectBaseFolder(current.artist ?? "", current.name ?? "", current.id) };
}

/** Rename a project (freeze-before-rename included). */
export async function renameProject(id: string, name: string): Promise<void> {
  const current = await getProject(id);
  await updateProject(id, { name: name.trim(), ...freezeFolderPatch(current ? { id, artist: current.artist, name: current.name, dropboxFolder: current.dropboxFolder } : null) });
}

/** Change the artist text; missing artists are added as clients (never removed) — exactly as the route does. */
export async function changeProjectArtist(id: string, artist: string): Promise<void> {
  await updateProject(id, { artist: artist.trim() });
  if (artist.trim()) await upsertArtistsFromProject(artist).catch(() => {});
}

/**
 * Create a project the way the Projects UI does (start date today, artists → clients). Business type: B2 Owner rule —
 * לייבל when שליו טסמה / אבי מולה is credited (solo or collab, by roster id), else לקוח. The UI route and Sunny's
 * CREATE_PROJECT both come through here, so the two paths can never classify differently.
 */
export async function createClientProject(f: { name: string; artist?: string; status?: string; deadline?: string | null; notes?: string; projectType?: string; parentProject?: string }): Promise<Awaited<ReturnType<typeof createProject>>> {
  const today = new Date().toISOString().split("T")[0];
  const { businessType } = await newProjectBusinessType(f.artist);
  const project = await createProject({
    name: f.name.trim(), artist: f.artist?.trim() || "", status: f.status || "לא התחיל", start_date: today, deadline: f.deadline || null,
    notes: f.notes?.trim() || "", project_type: f.projectType || "", parent_project: f.parentProject || "", project_business_type: businessType,
  });
  if (f.artist?.trim()) upsertArtistsFromProject(f.artist).catch(() => {});
  return project;
}

/** Session limit per project (settings key session_limit_<projectId>; default 3 when absent). */
export const sessionLimitKey = (projectId: string) => `session_limit_${projectId}`;
export async function setSessionLimit(projectId: string, limit: number): Promise<void> {
  const { error } = await supabase.from("settings").upsert({ key: sessionLimitKey(projectId), value: { limit: Number(limit) }, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
export async function getSessionLimit(projectId: string): Promise<number> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", sessionLimitKey(projectId)).maybeSingle();
  if (error) throw new Error(error.message);
  return ((data?.value as { limit?: number } | null)?.limit) ?? 3;
}

/** How many projects already carry exactly this name (duplicate warning before a create). */
export async function countProjectsNamed(name: string): Promise<number> {
  const { count, error } = await supabase.from("projects").select("id", { count: "exact", head: true }).eq("name", name);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** The project's canonical type ("" when unset), or null when the project does not exist. */
export async function projectTypeOfProject(projectId: string): Promise<string | null> {
  const { data, error } = await supabase.from("projects").select("project_type").eq("id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String((data as { project_type?: string | null }).project_type ?? "") : null;
}
