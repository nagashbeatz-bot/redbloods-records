import "server-only";
import { supabase } from "./supabase";
import type { Project, ProjectStatus, ProjectType, FileLink } from "./types";
import { isOverdue, isDueSoon } from "./utils";

// ─── DB row shape ──────────────────────────────────────────────────────────────

interface DbProject {
  id:             string;
  monday_id:      string | null;
  name:           string;
  artist:         string;
  status:         string;
  start_date:     string | null;
  deadline:       string | null;
  end_date:       string | null;
  notes:          string;
  project_type:   string;
  parent_project: string;
  is_hidden:      boolean;
  files:          { name: string; assetId?: number; url?: string; dropboxPath?: string; dropboxShareUrl?: string; trackId?: string; versionLabel?: string; category?: string; durationSeconds?: number }[];
  created_at:     string;
  updated_at:     string;
}

function dbToProject(db: DbProject): Project {
  const files: FileLink[] = (db.files || []).map((f) => ({
    name:             f.name,
    url:              f.url || "#",
    assetId:          f.assetId,
    dropboxPath:      f.dropboxPath,
    dropboxShareUrl:  f.dropboxShareUrl,
    trackId:          f.trackId,
    versionLabel:     f.versionLabel,
    category:         f.category,
    durationSeconds:  f.durationSeconds,
  }));

  return {
    id:            db.id,
    name:          db.name,
    artist:        db.artist,
    status:        db.status as ProjectStatus,
    startDate:     db.start_date ?? null,
    deadline:      db.deadline,
    endDate:       db.end_date ?? null,
    notes:         db.notes,
    files,
    isOverdue:     isOverdue(db.deadline),
    isDueSoon:     isDueSoon(db.deadline),
    projectType:   db.project_type as ProjectType,
    parentProject: db.parent_project,
    isHidden:      db.is_hidden ?? false,
    updatedAt:     db.updated_at ?? db.created_at ?? "",
  };
}

// ─── Exports ───────────────────────────────────────────────────────────────────

/**
 * List projects.
 * @param hidden  undefined → only visible (default)
 *                true      → only hidden
 *                null      → all (no filter)
 */
export async function listProjects(hidden?: boolean | null): Promise<Project[]> {
  let q = supabase.from("projects").select("*");

  if (hidden === true)       q = q.eq("is_hidden", true);
  else if (hidden !== null)  q = q.eq("is_hidden", false); // default: visible only

  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as DbProject[]).map(dbToProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return dbToProject(data as DbProject);
}

export async function getProjectByMondayId(mondayId: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("monday_id", mondayId)
    .single();

  if (error) return null;
  return dbToProject(data as DbProject);
}

export async function createProject(fields: {
  name:           string;
  artist?:        string;
  status?:        string;
  start_date?:    string | null;
  deadline?:      string | null;
  notes?:         string;
  project_type?:  string;
  parent_project?: string;
  monday_id?:     string;
  files?:         { name: string; assetId?: number; url?: string }[];
}): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name:           fields.name,
      artist:         fields.artist         || "",
      status:         fields.status         || "לא התחיל",
      start_date:     fields.start_date     || null,
      deadline:       fields.deadline       || null,
      notes:          fields.notes          || "",
      project_type:   fields.project_type   || "",
      parent_project: fields.parent_project || "",
      monday_id:      fields.monday_id      || null,
      files:          fields.files          || [],
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return dbToProject(data as DbProject);
}

export async function updateProject(
  id: string,
  fields: Partial<{
    name:           string;
    artist:         string;
    status:         string;
    start_date:     string | null;
    deadline:       string | null;
    end_date:       string | null;
    notes:          string;
    project_type:   string;
    parent_project: string;
    is_hidden:      boolean;
    files:          { name: string; assetId?: number; url?: string }[];
  }>
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}

/** Update files JSONB for a project (used after file upload) */
export async function addFileToProject(
  id: string,
  file: { name: string; assetId?: number; url?: string; dropboxPath?: string; dropboxShareUrl?: string; trackId?: string; versionLabel?: string; category?: string; durationSeconds?: number }
): Promise<void> {
  // Read current files, append, write back
  const { data, error: readErr } = await supabase
    .from("projects")
    .select("files")
    .eq("id", id)
    .single();

  if (readErr) throw new Error(readErr.message);

  const current: { name: string; assetId?: number; url?: string; dropboxPath?: string; dropboxShareUrl?: string; trackId?: string; versionLabel?: string; category?: string; durationSeconds?: number }[] =
    (data as { files: typeof current }).files || [];

  const { error } = await supabase
    .from("projects")
    .update({
      files:      [...current, file],
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function removeFileFromProject(
  id: string,
  assetId: number
): Promise<void> {
  const { data, error: readErr } = await supabase
    .from("projects")
    .select("files")
    .eq("id", id)
    .single();

  if (readErr) throw new Error(readErr.message);

  const current: { name: string; assetId?: number }[] =
    (data as { files: typeof current }).files || [];

  const { error } = await supabase
    .from("projects")
    .update({
      files:      current.filter((f) => f.assetId !== assetId),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

/** Update the dropboxShareUrl for a specific file in a project's files JSONB */
export async function updateFileShareUrl(
  projectId: string,
  dropboxPath: string,
  shareUrl: string
): Promise<void> {
  const { data, error: readErr } = await supabase
    .from("projects")
    .select("files")
    .eq("id", projectId)
    .single();
  if (readErr) throw new Error(readErr.message);

  const current: { name: string; dropboxPath?: string; dropboxShareUrl?: string; [key: string]: unknown }[] =
    (data as { files: typeof current }).files || [];

  const updated = current.map((f) =>
    f.dropboxPath === dropboxPath ? { ...f, dropboxShareUrl: shareUrl } : f
  );

  const { error } = await supabase
    .from("projects")
    .update({ files: updated, updated_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
}

/**
 * Narrow, idempotent backfill of ONE file's audio length. Matches strictly by
 * dropboxPath and sets ONLY durationSeconds, and ONLY when it is currently
 * missing. No-op (returns false) when there is no match or it is already set.
 * Deliberately does NOT bump updated_at or touch any other field/file — so the
 * main project row is otherwise unchanged. Callers must scope authorization
 * (e.g. Shalev-only) before calling this.
 */
export async function setFileDuration(
  projectId: string,
  dropboxPath: string,
  seconds: number
): Promise<boolean> {
  const { data, error: readErr } = await supabase
    .from("projects")
    .select("files")
    .eq("id", projectId)
    .single();
  if (readErr) throw new Error(readErr.message);

  const current: { dropboxPath?: string; durationSeconds?: number; [key: string]: unknown }[] =
    (data as { files: typeof current }).files || [];

  let changed = false;
  const updated = current.map((f) => {
    if (!changed && f.dropboxPath === dropboxPath && f.durationSeconds == null) {
      changed = true;
      return { ...f, durationSeconds: seconds };
    }
    return f;
  });

  if (!changed) return false; // no match, or already set → no write

  const { error } = await supabase
    .from("projects")
    .update({ files: updated }) // ONLY files — no updated_at bump
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  return true;
}

/** Bump updated_at without changing any other field — call after sessions/transactions */
export async function touchProject(id: string): Promise<void> {
  await supabase
    .from("projects")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * If the project has no start_date, find its earliest session date and set it.
 * Never overwrites a manually-set start_date.
 */
export async function ensureProjectStartDate(projectId: string): Promise<void> {
  // Only proceed if start_date is not yet set
  const { data: proj } = await supabase
    .from("projects")
    .select("start_date")
    .eq("id", projectId)
    .single();

  if (proj?.start_date) return; // already set — never overwrite

  // Find the earliest session date for this project
  const { data: rows } = await supabase
    .from("sessions")
    .select("date")
    .eq("project_id", projectId)
    .not("date", "is", null)
    .order("date", { ascending: true })
    .limit(1);

  const earliest = rows?.[0]?.date as string | undefined;
  if (!earliest) return;

  await supabase
    .from("projects")
    .update({ start_date: earliest, updated_at: new Date().toISOString() })
    .eq("id", projectId);
}

/**
 * Remove a file from a project's files JSONB by its Dropbox path. Also removes
 * any files nested UNDER that path (so deleting a folder path, e.g. the
 * "…/Delivery/ערוצים" channels folder, cleans every stem inside it). For a plain
 * file path this is identical to an exact-match removal (a file has no children).
 */
export async function removeFileFromProjectByPath(
  id: string,
  dropboxPath: string
): Promise<void> {
  const { data, error: readErr } = await supabase
    .from("projects")
    .select("files")
    .eq("id", id)
    .single();

  if (readErr) throw new Error(readErr.message);

  const current: { name: string; dropboxPath?: string }[] =
    (data as { files: typeof current }).files || [];

  const prefix = `${dropboxPath}/`;
  const { error } = await supabase
    .from("projects")
    .update({
      files:      current.filter((f) => f.dropboxPath !== dropboxPath && !f.dropboxPath?.startsWith(prefix)),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}
