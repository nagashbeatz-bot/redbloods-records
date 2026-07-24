import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess, getAuthRole } from "@/lib/require-auth";
import { updateMixComment, updateMixCommentStatus, deleteMixComment } from "@/lib/mix-comments-store";
import { assertStevenOwnsComment } from "@/lib/steven-scope";

const FORBID = () => NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

/**
 * PATCH — Phase 2: Steven may change ONLY a comment's status (open/resolved) —
 * never text, timestamp, role or author. Enforced here (not just hidden in
 * the UI): the request body must be exactly `{ status }` with a valid value,
 * or it's rejected with 400 before touching the DB. Owner reaching this same
 * route (requireStevenAccess allows owner too) keeps the previous full edit.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { commentId } = await params;
    if (!(await assertStevenOwnsComment(commentId))) return FORBID();
    const isSteven = (await getAuthRole()) === "steven";
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (isSteven) {
      const keys = Object.keys(body);
      if (keys.length !== 1 || keys[0] !== "status") {
        return NextResponse.json({ ok: false, error: "ניתן לעדכן רק את הסטטוס" }, { status: 400 });
      }
      const status = body.status;
      if (status !== "open" && status !== "resolved") {
        return NextResponse.json({ ok: false, error: "ערך סטטוס לא תקין" }, { status: 400 });
      }
      const comment = await updateMixCommentStatus(commentId, status);
      return NextResponse.json({ ok: true, comment });
    }

    // Non-steven caller (owner) on this route — unchanged full edit ability.
    const comment = await updateMixComment(commentId, body as { commentText?: string; timestampSeconds?: number; status?: "open" | "resolved" });
    return NextResponse.json({ ok: true, comment });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** DELETE — remove a comment. Phase 1: Steven is VIEW-ONLY → 403 for a steven session. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  if ((await getAuthRole()) === "steven") return FORBID(); // steven can't delete comments
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
