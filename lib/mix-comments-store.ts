/**
 * Mix Comments store — server-only. Pure DB CRUD for mix_comments (time-stamped
 * comments on a mix version). Phase 2 stage 4 of the Steven job workboard.
 * No Dropbox, no projects.files. See mix_comments table (already migrated).
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import type { MixComment, MixCommentAttachment } from "@/lib/types";
import { listAttachmentsForComment, listAttachmentsForComments } from "@/lib/mix-comment-attachments-store";

function mapRow(r: Record<string, unknown>, attachments: MixCommentAttachment[] = []): MixComment {
  const rawTs = r.timestamp_seconds;
  return {
    id:               r.id                as string,
    mixVersionId:     r.mix_version_id    as string,
    // null (general note) stays null — never coerced to 0. 0 is a real 00:00 comment.
    timestampSeconds: rawTs === null || rawTs === undefined ? null : Number(rawTs),
    commentText:      (r.comment_text     as string) ?? "",
    author:           (r.author           as string | null) ?? null,
    role:             (r.role             as string | null) ?? null,
    status:           r.status === "resolved" ? "resolved" : "open",
    createdAt:        (r.created_at        as string) ?? "",
    updatedAt:        (r.updated_at        as string) ?? "",
    attachments,
  };
}

/** List comments for a version, earliest timestamp first; general notes (null) last.
 *  Attachments for every returned comment are batch-fetched in one extra query. */
export async function listMixComments(versionId: string): Promise<MixComment[]> {
  const { data, error } = await supabase
    .from("mix_comments")
    .select("*")
    .eq("mix_version_id", versionId)
    .order("timestamp_seconds", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const attachmentsByComment = await listAttachmentsForComments(rows.map((r) => r.id as string));
  return rows.map((r) => mapRow(r as Record<string, unknown>, attachmentsByComment.get(r.id as string) ?? []));
}

/** Fetch a single comment by id (null = not found). Used for ownership checks
 *  and as the base row for PATCH responses — always carries its attachments. */
export async function getMixComment(id: string): Promise<MixComment | null> {
  const { data, error } = await supabase.from("mix_comments").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const attachments = await listAttachmentsForComment(id);
  return mapRow(data as Record<string, unknown>, attachments);
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

/** Update a comment's text, timestamp and/or status. Owner-only callers. */
export async function updateMixComment(
  id: string,
  fields: { commentText?: string; timestampSeconds?: number | null; status?: "open" | "resolved" }
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
  if (fields.status !== undefined) {
    if (fields.status !== "open" && fields.status !== "resolved") throw new Error("סטטוס לא תקין");
    dbUpdate.status = fields.status;
  }

  const { data, error } = await supabase
    .from("mix_comments")
    .update(dbUpdate)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  // Fetched (not defaulted to []): a text/timestamp/status edit must never
  // wipe the attachments the client already has for this comment.
  return mapRow(data as Record<string, unknown>, await listAttachmentsForComment(id));
}

/**
 * Update ONLY a comment's status — the sole write Steven is allowed. Kept as
 * its own narrow function (rather than routing through updateMixComment) so
 * the Steven-safe write path can never accidentally touch text/timestamp/
 * role/author even if a caller passed extra fields; the API route validates
 * the request body shape before calling this, but this function is itself
 * incapable of writing anything except status.
 */
export async function updateMixCommentStatus(id: string, status: "open" | "resolved"): Promise<MixComment> {
  if (status !== "open" && status !== "resolved") throw new Error("סטטוס לא תקין");
  const { data, error } = await supabase
    .from("mix_comments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  // Fetched, same reason as updateMixComment — Steven's status toggle must
  // never blank out the attachments already shown on that comment.
  return mapRow(data as Record<string, unknown>, await listAttachmentsForComment(id));
}

/** Delete a comment. */
export async function deleteMixComment(id: string): Promise<void> {
  const { error } = await supabase.from("mix_comments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
