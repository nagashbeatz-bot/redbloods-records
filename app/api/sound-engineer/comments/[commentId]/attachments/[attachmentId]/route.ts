import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

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
    // shared writer (lib/writes/mix): the attachment must belong to this comment; stored file best-effort, then the row
    const { deleteCommentAttachment } = await import("@/lib/writes/mix");
    if ((await deleteCommentAttachment(commentId, attachmentId)) === "not_found") {
      return NextResponse.json({ ok: false, error: "attachment לא נמצא" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
