/**
 * Mix Comments store — server-only. Pure DB CRUD for mix_comments (time-stamped
 * comments on a mix version). Phase 2 stage 4 of the Steven job workboard.
 * No Dropbox, no projects.files. See mix_comments table (already migrated).
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import type { MixComment } from "@/lib/types";

function mapRow(r: Record<string, unknown>): MixComment {
  const rawTs = r.timestamp_seconds;
  return {
    id:               r.id                as string,
    mixVersionId:     r.mix_version_id    as string,
    // null (general note) stays null — never coerced to 0. 0 is a real 00:00 comment.
    timestampSeconds: rawTs === null || rawTs === undefined ? null : Number(rawTs),
    commentText:      (r.comment_text     as string) ?? "",
    author:           (r.author           as string | null) ?? null,
    role:             (r.role             as string | null) ?? null,
    createdAt:        (r.created_at        as string) ?? "",
    updatedAt:        (r.updated_at        as string) ?? "",
  };
}

/** List comments for a version, earliest timestamp first; general notes (null) last. */
export async function listMixComments(versionId: string): Promise<MixComment[]> {
  const { data, error } = await supabase
    .from("mix_comments")
    .select("*")
    .eq("mix_version_id", versionId)
    .order("timestamp_seconds", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/** Fetch a single comment by id (null = not found). Used for ownership checks. */
export async function getMixComment(id: string): Promise<MixComment | null> {
  const { data, error } = await supabase.from("mix_comments").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as Record<string, unknown>) : null;
}

/**
 * Add a comment. `timestampSeconds === null` → a general note (stored NULL, no
 * timecode). A number is a timed comment (0 = a real 00:00 comment; negatives
 * are clamped to 0). null is NEVER coerced to 0.
 */
export async function createMixComment(fields: {
  mixVersionId:     string;
  timestampSeconds: number | null;
  commentText:      string;
  author?:          string | null;
  role?:            string | null;
}): Promise<MixComment> {
  const ts   = fields.timestampSeconds === null
    ? null
    : (Number.isFinite(fields.timestampSeconds) && fields.timestampSeconds > 0 ? fields.timestampSeconds : 0);
  const text = (fields.commentText ?? "").trim();
  if (!text) throw new Error("טקסט ההערה חסר");

  const { data, error } = await supabase
    .from("mix_comments")
    .insert({
      mix_version_id:    fields.mixVersionId,
      timestamp_seconds: ts,
      comment_text:      text,
      author:            fields.author ?? null,
      role:              fields.role ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

/** Update a comment's text and/or timestamp. */
export async function updateMixComment(
  id: string,
  fields: { commentText?: string; timestampSeconds?: number | null }
): Promise<MixComment> {
  const dbUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.commentText !== undefined) {
    const text = fields.commentText.trim();
    if (!text) throw new Error("טקסט ההערה חסר");
    dbUpdate.comment_text = text;
  }
  if (fields.timestampSeconds !== undefined) {
    // null → general note (stored NULL); a number stays as-is (0 = real 00:00).
    dbUpdate.timestamp_seconds = fields.timestampSeconds === null
      ? null
      : (Number.isFinite(fields.timestampSeconds) && fields.timestampSeconds > 0 ? fields.timestampSeconds : 0);
  }

  const { data, error } = await supabase
    .from("mix_comments")
    .update(dbUpdate)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

/** Delete a comment. */
export async function deleteMixComment(id: string): Promise<void> {
  const { error } = await supabase.from("mix_comments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
