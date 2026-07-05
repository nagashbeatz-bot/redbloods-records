import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess } from "@/lib/require-auth";
import { updateMixComment, deleteMixComment } from "@/lib/mix-comments-store";
import { assertStevenOwnsComment } from "@/lib/steven-scope";

const FORBID = () => NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

/** PATCH — edit text and/or timestamp of a comment on Steven's own work. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { commentId } = await params;
    if (!(await assertStevenOwnsComment(commentId))) return FORBID();
    const body = (await req.json()) as { commentText?: string; timestampSeconds?: number };
    const comment = await updateMixComment(commentId, body);
    return NextResponse.json({ ok: true, comment });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** DELETE — remove a comment on Steven's own work. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { commentId } = await params;
    if (!(await assertStevenOwnsComment(commentId))) return FORBID();
    await deleteMixComment(commentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
