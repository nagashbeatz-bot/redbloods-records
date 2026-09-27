import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { attachFileToMixComment } from "@/lib/writes/uploads";

export const maxDuration = 60;

/**
 * POST /api/sound-engineer/comments/[commentId]/attachments — upload one image
 * or short audio file and attach it to an existing comment. Owner-only. The
 * comment must already exist (create the comment first, THEN attach files —
 * see the client flow in StevenProfilePage). Server re-validates type/size
 * regardless of what the client already checked; the client check is UX only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { commentId } = await params;
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      const { getMixComment } = await import("@/lib/mix-comments-store");
      if (!(await getMixComment(commentId))) return NextResponse.json({ ok: false, error: "הערה לא נמצאה" }, { status: 404 });
      return NextResponse.json({ ok: false, error: "חסר קובץ" }, { status: 400 });
    }
    // Shared writer (lib/writes/uploads): type / size re-validated server-side, same folder + naming as before.
    const r = await attachFileToMixComment(commentId, file);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, attachment: r.attachment });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[comments/attachments POST]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
