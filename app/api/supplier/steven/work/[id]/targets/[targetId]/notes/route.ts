import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess } from "@/lib/require-auth";
import { assertStevenOwnsWork } from "@/lib/steven-scope";
import { assertTargetOnRiddimWork } from "@/lib/riddim-work";
import { listMixTargetNotes } from "@/lib/mix-target-notes-store";

/**
 * GET — the pre-mix notes on one riddim line, read-only.
 *
 * These are instructions the owner writes TO Steven, so there is deliberately
 * NO POST / PATCH / DELETE in this file. They are not hidden behind a flag that
 * could be flipped by mistake — the handlers do not exist, so Next answers 405
 * and the restriction is a property of the routing table itself.
 *
 * Ownership is re-derived from the DB at every step and never taken from the
 * client: the work must be Steven's, the work must be a riddim, and the target
 * must belong to that work. A target id from another engineer's work is a 404.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; targetId: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { id: workId, targetId } = await params;
    if (!(await assertStevenOwnsWork(workId))) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    const guard = await assertTargetOnRiddimWork(workId, targetId);
    if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });

    return NextResponse.json({ ok: true, notes: await listMixTargetNotes(targetId) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
