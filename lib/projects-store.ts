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
  deadline:       string | null;
  notes:          string;
  project_type:   string;
  parent_project: string;
  files:          { name: string; assetId?: number; url?: string }[];
  created_at:     string;
  updated_at:     string;
}

function dbToProject(db: DbProject): Project {
  const files: FileLink[] = (db.files || []).map((f) => ({
    name:    f.name,
    url:     f.url || "#",
    assetId: f.assetId,
  }));

  return {
    id:            db.id,
    name:          db.name,
    artist:        db.artist,
    status:        db.status as ProjectStatus,
    deadline:      db.deadline,
    notes:         db.notes,
    files,
    isOverdue:     isOverdue(db.deadline),
    isDueSoon:     isDueSoon(db.deadline),
    projectType:   db.project_type as ProjectType,
    parentProject: db.parent_project,
  };
}

// ─── Exports ───────────────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

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
    deadline:       string | null;
    notes:          string;
    project_type:   string;
    parent_project: string;
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
  file: { name: string; assetId?: number; url?: string; dropboxPath?: string }
): Promise<void> {
  // Read current files, append, write back
  const { data, error: readErr } = await supabase
    .from("projects")
    .select("files")
    .eq("id", id)
    .single();

  if (readErr) throw new Error(readErr.message);

  const current: { name: string; assetId?: number; url?: string }[] =
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

/** Remove a file from a project's files JSONB by its Dropbox path */
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

  const { error } = await supabase
    .from("projects")
    .update({
      files:      current.filter((f) => f.dropboxPath !== dropboxPath),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}
