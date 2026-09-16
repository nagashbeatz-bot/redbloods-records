/**
 * Mix Comment Attachments store — server-only. Pure DB CRUD for
 * mix_comment_attachments (0..N images per mix comment).
 *
 * Two return shapes on purpose:
 *   - the PUBLIC shape (MixCommentAttachment, lib/types.ts) never carries
 *     dropbox_path — only an opaque stream `url`. This is what's safe to
 *     embed in any API JSON response (owner or Steven).
 *   - the INTERNAL shape carries dropboxPath and is used ONLY by route
 *     handlers that call Dropbox directly (upload/delete/stream) — it must
 *     never be passed to NextResponse.json().
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import type { MixCommentAttachment } from "@/lib/types";

export interface InternalAttachment {
  id:          string;
  commentId:   string;
  dropboxPath: string;
  fileName:    string;
  fileSize:    number;
  mimeType:    string;
  uploadedBy:  string | null;
  createdAt:   string;
}

function mapInternal(r: Record<string, unknown>): InternalAttachment {
  return {
    id:          r.id as string,
    commentId:   r.comment_id as string,
    dropboxPath: (r.dropbox_path as string) ?? "",
    fileName:    (r.file_name as string) ?? "",
    fileSize:    Number(r.file_size ?? 0),
    mimeType:    (r.mime_type as string) ?? "",
    uploadedBy:  (r.uploaded_by as string | null) ?? null,
    createdAt:   (r.created_at as string) ?? "",
  };
}

/** Owner-form stream URL — the default baked into every public attachment.
 *  Steven-facing routes rewrite this to the scoped supplier URL (see
 *  lib/steven-scope.ts `sanitizeCommentForSteven`), mirroring how
 *  sanitizeVersionForSteven rewrites MixVersion.url. */
function toPublic(r: InternalAttachment): MixCommentAttachment {
  return {
    id:         r.id,
    commentId:  r.commentId,
    fileName:   r.fileName,
    fileSize:   r.fileSize,
    mimeType:   r.mimeType,
    uploadedBy: r.uploadedBy,
    createdAt:  r.createdAt,
    url:        `/api/sound-engineer/comments/${r.commentId}/attachments/${r.id}/stream`,
  };
}

/** Public list for one comment — safe to embed directly in a JSON response. */
export async function listAttachmentsForComment(commentId: string): Promise<MixCommentAttachment[]> {
  const { data, error } = await supabase
    .from("mix_comment_attachments")
    .select("*")
    .eq("comment_id", commentId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toPublic(mapInternal(r as Record<string, unknown>)));
}

/** Batch public list for many comments at once (one query) — used by
 *  listMixComments so a version's whole comment list stays one round trip. */
export async function listAttachmentsForComments(commentIds: string[]): Promise<Map<string, MixCommentAttachment[]>> {
  const map = new Map<string, MixCommentAttachment[]>();
  if (commentIds.length === 0) return map;
  const { data, error } = await supabase
    .from("mix_comment_attachments")
    .select("*")
    .in("comment_id", commentIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const pub = toPublic(mapInternal(row as Record<string, unknown>));
    const arr = map.get(pub.commentId) ?? [];
    arr.push(pub);
    map.set(pub.commentId, arr);
  }
  return map;
}

/** Internal — carries dropboxPath. Used only by upload/delete/stream routes,
 *  never returned as-is in a response body. */
export async function getAttachmentInternal(id: string): Promise<InternalAttachment | null> {
  const { data, error } = await supabase.from("mix_comment_attachments").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapInternal(data as Record<string, unknown>) : null;
}

/** Internal — every attachment for a comment, WITH dropboxPath. Used only by
 *  the comment-delete route to clean up Dropbox before the DB cascade runs. */
export async function listAttachmentsForCommentInternal(commentId: string): Promise<InternalAttachment[]> {
  const { data, error } = await supabase.from("mix_comment_attachments").select("*").eq("comment_id", commentId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapInternal(r as Record<string, unknown>));
}

/** Insert a row (the file is already on Dropbox at dropboxPath). Returns the
 *  PUBLIC shape — safe to send straight back to the client. */
export async function createAttachment(fields: {
  commentId:   string;
  dropboxPath: string;
  fileName:    string;
  fileSize:    number;
  mimeType:    string;
  uploadedBy?: string | null;
}): Promise<MixCommentAttachment> {
  const { data, error } = await supabase
    .from("mix_comment_attachments")
    .insert({
      comment_id:   fields.commentId,
      dropbox_path: fields.dropboxPath,
      file_name:    fields.fileName,
      file_size:    fields.fileSize,
      mime_type:    fields.mimeType,
      uploaded_by:  fields.uploadedBy ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return toPublic(mapInternal(data as Record<string, unknown>));
}

export async function deleteAttachment(id: string): Promise<void> {
  const { error } = await supabase.from("mix_comment_attachments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
