/**
 * Shared validated project writers — used by BOTH the Redbloods UI routes and Sunny's typed primitives, so the two
 * paths can never diverge. Behaviour is exactly the routes' existing behaviour (extracted, not redesigned).
 */
import { supabase } from "@/lib/supabase";
import { createProject, getProject, updateProject } from "@/lib/projects-store";
import { projectBaseFolder } from "@/lib/project-paths";
import { upsertArtistsFromProject } from "@/lib/clients-store";

/** Status change: "הושלם" stamps today's end date; any other status clears it (the app's single rule). */
export function statusPatch(status: string, today = new Date().toISOString().split("T")[0]): { status: string; end_date: string | null } {
  return { status, end_date: status === "הושלם" ? today : null };
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

/** Create a client project the way the Projects UI does (business type לקוח, start date today, artists → clients). */
export async function createClientProject(f: { name: string; artist?: string; status?: string; deadline?: string | null; notes?: string; projectType?: string; parentProject?: string }): Promise<Awaited<ReturnType<typeof createProject>>> {
  const today = new Date().toISOString().split("T")[0];
  const project = await createProject({
    name: f.name.trim(), artist: f.artist?.trim() || "", status: f.status || "לא התחיל", start_date: today, deadline: f.deadline || null,
    notes: f.notes?.trim() || "", project_type: f.projectType || "", parent_project: f.parentProject || "", project_business_type: "לקוח",
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
