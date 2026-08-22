import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess } from "@/lib/require-auth";
import { assertStevenOwnsWork } from "@/lib/steven-scope";
import { listMixTargets } from "@/lib/mix-targets-store";

/**
 * GET /api/supplier/steven/work/[id]/targets — the riddim roster, read-only.
 *
 * Steven picks from this list when uploading but never changes it: there is
 * deliberately no POST/PATCH/DELETE here, so roster management stays owner-only
 * at the API boundary and not just in the UI. Like the owner's GET, this never
 * creates the instrumental — reading must not write.
 *
 * Ownership is re-derived from the DB (assertStevenOwnsWork), never trusted from
 * the client, so Steven cannot read another engineer's roster by guessing ids.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    if (!(await assertStevenOwnsWork(workId))) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    const targets = await listMixTargets(workId);
    return NextResponse.json({ ok: true, targets });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
