import "server-only";
import { supabase } from "./supabase";

/**
 * Final delivery files — server-only. Completely SEPARATE from mix_versions:
 * files uploaded via "Upload Final Files" are stored ONLY here (public.final_files),
 * never in mix_versions, never surfaced in the versions list / player / project-files.
 * The original filename is preserved EXACTLY (no rename); dedupe is case-insensitive
 * at the DB level (unique index on lower(file_name) and lower(dropbox_path)).
 */

export interface FinalFile {
  id: string;
  workId: string;
  projectId: string | null;
  fileName: string;      // EXACT original name as uploaded
  dropboxPath: string;
  fileSize: number | null;
  fileType: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

interface DbRow {
  id: string;
  work_id: string;
  project_id: string | null;
  file_name: string;
  dropbox_path: string;
  file_size: number | string | null;
  file_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

function mapRow(db: DbRow): FinalFile {
  return {
    id: db.id,
    workId: db.work_id,
    projectId: db.project_id ?? null,
    fileName: db.file_name,
    dropboxPath: db.dropbox_path,
    fileSize: db.file_size != null ? Number(db.file_size) : null,
    fileType: db.file_type ?? null,
    uploadedBy: db.uploaded_by ?? null,
    createdAt: db.created_at,
  };
}

/** Postgres unique_violation — surfaced by the case-insensitive name/path indexes. */
export const UNIQUE_VIOLATION = "23505";

/** All final files for a work, newest first. */
export async function listFinalFiles(workId: string): Promise<FinalFile[]> {
  const { data, error } = await supabase
    .from("final_files")
    .select("*")
    .eq("work_id", workId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as DbRow[]).map(mapRow);
}

/** Case-insensitive existence check for a name within a work (pre-upload gate). */
export async function finalFileNameExists(workId: string, fileName: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("final_files")
    .select("id")
    .eq("work_id", workId)
    .ilike("file_name", fileName)   // ILIKE with no wildcards = case-insensitive equality
    .limit(1);
  if (error) throw new Error(error.message);
  return !!data && data.length > 0;
}

export type CreateFinalFileResult =
  | { status: "ok"; file: FinalFile }
  | { status: "duplicate" };

/** Insert a final-file record. Returns "duplicate" on the unique (name/path) violation. */
export async function createFinalFile(row: {
  workId: string;
  projectId: string | null;
  fileName: string;
  dropboxPath: string;
  fileSize: number | null;
  fileType: string | null;
  uploadedBy: string | null;
}): Promise<CreateFinalFileResult> {
  const { data, error } = await supabase
    .from("final_files")
    .insert({
      work_id:      row.workId,
      project_id:   row.projectId,
      file_name:    row.fileName,
      dropbox_path: row.dropboxPath,
      file_size:    row.fileSize,
      file_type:    row.fileType,
      uploaded_by:  row.uploadedBy,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
    throw new Error(error.message);
  }
  return { status: "ok", file: mapRow(data as DbRow) };
}

/** Look up one final file (for a future delete/download flow). */
export async function getFinalFile(id: string): Promise<FinalFile | null> {
  const { data, error } = await supabase.from("final_files").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as DbRow) : null;
}

/** Delete a final-file record, scoped by id AND work_id (no cross-work delete). */
export async function deleteFinalFile(id: string, workId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("final_files")
    .delete()
    .eq("id", id)
    .eq("work_id", workId)
    .select("id");
  if (error) throw new Error(error.message);
  return !!data && data.length > 0;
}
