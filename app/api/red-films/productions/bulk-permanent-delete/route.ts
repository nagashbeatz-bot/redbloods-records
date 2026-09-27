/**
 * POST /api/red-films/productions/bulk-permanent-delete
 * Permanently deletes Red Films productions that are in "בוטל" status.
 * Shared writer lib/writes/redfilms deleteCancelledProductions (A5 2026-09-27): read-only preflight first — a
 * production with Red Films payments refuses the whole delete (409 HAS_PAYMENTS, zero writes); then reference images,
 * documents, reference links, scenes, crew, budget lines, tasks, clip markers (CAS) and the productions, every step's
 * error checked; stored files + Google Tasks last, failures reported. Owner-only IN the route (was proxy-only).
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteCancelledProductions } from "@/lib/writes/redfilms";
import { requireOwner } from "@/lib/require-auth";

export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json().catch(() => ({}));
    const ids: unknown = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids נדרש" }, { status: 400 });
    }
    // Shared writer (lib/writes/redfilms) — the same one Sunny's DELETE_CANCELLED_PRODUCTIONS uses.
    const r = await deleteCancelledProductions(ids);
    if (r.kind === "bad") return NextResponse.json({ error: r.error, ...(r.code ? { code: r.code } : {}) }, { status: r.status });
    const { deleted, skipped, storageFailures, googleTaskFailures, clearedMarkers, warningHe } = r;
    return NextResponse.json({ ok: true, deleted, skipped, storageFailures, googleTaskFailures, clearedMarkers, warningHe });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאת שרת";
    console.error("[POST /api/red-films/productions/bulk-permanent-delete]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
