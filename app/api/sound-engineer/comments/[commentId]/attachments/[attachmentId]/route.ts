import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getAttachmentInternal, deleteAttachment } from "@/lib/mix-comment-attachments-store";

/**
 * DELETE /api/sound-engineer/comments/[commentId]/attachments/[attachmentId]
 * Owner-only. Removes the file from Dropbox (best-effort — a Dropbox failure
 * is logged, not fatal) THEN the DB row, so the UI never keeps a reference to
 * a file that failed to delete.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ commentId: string; attachmentId: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { commentId, attachmentId } = await params;
    const attachment = await getAttachmentInternal(attachmentId);
    if (!attachment || attachment.commentId !== commentId) {
      return NextResponse.json({ ok: false, error: "attachment לא נמצא" }, { status: 404 });
    }

    try {
      const { getDropboxToken } = await import("@/lib/dropbox-token");
      const token = await getDropboxToken();
      await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: attachment.dropboxPath }),
      });
    } catch (e) {
      console.error("[comments/attachments DELETE] dropbox cleanup failed:", attachment.dropboxPath, e);
    }

    await deleteAttachment(attachmentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
