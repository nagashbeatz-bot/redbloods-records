import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { updateMixComment, deleteMixComment } from "@/lib/mix-comments-store";

/** PATCH /api/sound-engineer/comments/[commentId] — edit text and/or timestamp. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { commentId } = await params;
    const body = (await req.json()) as { commentText?: string; timestampSeconds?: number };
    const comment = await updateMixComment(commentId, body);
    return NextResponse.json({ ok: true, comment });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** DELETE /api/sound-engineer/comments/[commentId] — remove a comment. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { commentId } = await params;
    await deleteMixComment(commentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
