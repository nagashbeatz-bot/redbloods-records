/**
 * Mix Versions store — server-only. Pure DB CRUD for mix_versions.
 * Dropbox upload/delete is orchestrated by the routes (this file never touches
 * Dropbox). Metadata lives ONLY here — never in projects.files. Phase 2 of the
 * Steven job workboard. See project-paths.mixVersionsFolder for path rules.
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import type { MixVersion } from "@/lib/types";

const ALLOWED_STATUS = new Set(["בבדיקה", "מוכן", "מאושר", "נדחה"]);

function mapRow(r: Record<string, unknown>): MixVersion {
  const dropboxPath = (r.dropbox_path as string) ?? "";
  return {
    id:                  r.id as string,
    soundEngineerWorkId: r.sound_engineer_work_id as string,
    projectId:           (r.project_id as string | null) ?? null,
    label:               (r.label as string) ?? "",
    fileName:            (r.file_name as string) ?? "",
    dropboxPath,
    url:                 dropboxPath ? `/api/dropbox/stream?path=${encodeURIComponent(dropboxPath)}` : "",
    fileSize:            r.file_size != null ? Number(r.file_size) : null,
    fileType:            (r.file_type as string | null) ?? null,
    status:              (r.status as string) ?? "בבדיקה",
    uploadedBy:          (r.uploaded_by as string | null) ?? null,
    durationSeconds:     r.duration_seconds != null ? Number(r.duration_seconds) : null,
    uploadedAt:          (r.uploaded_at as string) ?? "",
    createdAt:           (r.created_at as string) ?? "",
    updatedAt:           (r.updated_at as string) ?? "",
  };
}

/** List all mix versions for a sound_engineer_work, newest first. */
export async function listMixVersions(workId: string): Promise<MixVersion[]> {
  const { data, error } = await supabase
    .from("mix_versions")
    .select("*")
    .eq("sound_engineer_work_id", workId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/** Fetch a single mix version (null if not found). */
export async function getMixVersion(id: string): Promise<MixVersion | null> {
  const { data, error } = await supabase.from("mix_versions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as Record<string, unknown>) : null;
}

/** Insert a mix version row (the file is already on Dropbox at dropboxPath). */
export async function createMixVersion(row: {
  id:                  string;
  soundEngineerWorkId: string;
  projectId:           string | null;
  label:               string;
  fileName:            string;
  dropboxPath:         string;
  fileSize?:           number | null;
  fileType?:           string | null;
  uploadedBy?:         string | null;
  durationSeconds?:    number | null;
}): Promise<MixVersion> {
  const { data, error } = await supabase
    .from("mix_versions")
    .insert({
      id:                     row.id,
      sound_engineer_work_id: row.soundEngineerWorkId,
      project_id:             row.projectId,
      label:                  row.label,
      file_name:              row.fileName,
      dropbox_path:           row.dropboxPath,
      file_size:              row.fileSize ?? null,
      file_type:              row.fileType ?? null,
      uploaded_by:            row.uploadedBy ?? null,
      duration_seconds:       row.durationSeconds ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

/** Update a mix version's status and/or label. */
export async function updateMixVersion(
  id: string,
  fields: { status?: string; label?: string }
): Promise<MixVersion> {
  const dbUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.status !== undefined) {
    if (!ALLOWED_STATUS.has(fields.status)) throw new Error("סטטוס לא תקין");
    dbUpdate.status = fields.status;
  }
  if (fields.label !== undefined) dbUpdate.label = fields.label.trim();

  const { data, error } = await supabase
    .from("mix_versions")
    .update(dbUpdate)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

/** Delete a mix version row. Comments are removed by the FK cascade. The Dropbox
 *  file is deleted by the route BEFORE calling this. */
export async function deleteMixVersion(id: string): Promise<void> {
  const { error } = await supabase.from("mix_versions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
