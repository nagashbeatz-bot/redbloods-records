import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getAttachmentInternal } from "@/lib/mix-comment-attachments-store";

/**
 * GET /api/sound-engineer/comments/[commentId]/attachments/[attachmentId]/stream
 * Owner-only. Resolves the stored Dropbox path SERVER-SIDE and redirects to a
 * short-lived temp link — the raw path never reaches the client (mirrors
 * /api/supplier/steven/stream).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ commentId: string; attachmentId: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { commentId, attachmentId } = await params;
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
      console.error("[sound-engineer/comments/attachments/stream]", await res.text());
      return NextResponse.json({ error: "שגיאה בטעינת התמונה" }, { status: 502 });
    }
    const data = (await res.json()) as { link: string };
    return NextResponse.redirect(data.link, 302);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
