import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { updateMixComment, deleteMixComment } from "@/lib/mix-comments-store";
import { listAttachmentsForCommentInternal } from "@/lib/mix-comment-attachments-store";

/** PATCH /api/sound-engineer/comments/[commentId] — edit text, timestamp and/or status. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { commentId } = await params;
    const body = (await req.json()) as { commentText?: string; timestampSeconds?: number; status?: "open" | "resolved" };
    const comment = await updateMixComment(commentId, body);
    return NextResponse.json({ ok: true, comment });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/sound-engineer/comments/[commentId] — remove a comment. Its
 * attachment ROWS are cleaned up by the DB (ON DELETE CASCADE), but Dropbox
 * never auto-deletes anything — so the actual image files are removed here,
 * BEFORE the comment row goes, best-effort (a Dropbox hiccup never blocks the
 * comment delete the user asked for; it's just logged).
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { commentId } = await params;

    const attachments = await listAttachmentsForCommentInternal(commentId);
    if (attachments.length > 0) {
      try {
        const { getDropboxToken } = await import("@/lib/dropbox-token");
        const token = await getDropboxToken();
        await Promise.all(attachments.map((a) =>
          fetch("https://api.dropboxapi.com/2/files/delete_v2", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ path: a.dropboxPath }),
          }).catch((e) => console.error("[comments DELETE] dropbox cleanup failed:", a.dropboxPath, e))
        ));
      } catch (e) {
        console.error("[comments DELETE] dropbox token error during cleanup:", e);
      }
    }

    await deleteMixComment(commentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
