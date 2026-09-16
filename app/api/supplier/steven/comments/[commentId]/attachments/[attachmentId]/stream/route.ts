import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess } from "@/lib/require-auth";
import { assertStevenOwnsComment } from "@/lib/steven-scope";
import { getAttachmentInternal } from "@/lib/mix-comment-attachments-store";

/**
 * GET /api/supplier/steven/comments/[commentId]/attachments/[attachmentId]/stream
 * View-only for Steven (no POST/DELETE exist on this supplier surface — Owner
 * is the only one who can upload or delete an attachment). Ownership is
 * re-verified server-side via assertStevenOwnsComment before anything is
 * resolved, exactly like every other /api/supplier/steven/* route — a comment
 * id from another engineer's work 403s here even with a valid Steven session.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ commentId: string; attachmentId: string }> }
) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { commentId, attachmentId } = await params;
    if (!(await assertStevenOwnsComment(commentId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const attachment = await getAttachmentInternal(attachmentId);
    if (!attachment || attachment.commentId !== commentId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();
    const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: attachment.dropboxPath }),
    });
    if (!res.ok) {
      console.error("[supplier/steven/comments/attachments/stream]", await res.text());
      return NextResponse.json({ error: "שגיאה בטעינת התמונה" }, { status: 502 });
    }
    const data = (await res.json()) as { link: string };
    return NextResponse.redirect(data.link, 302);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
