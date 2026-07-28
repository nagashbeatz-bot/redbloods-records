import { NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { listPerformanceFiles } from "@/lib/red-artists/portal-files";
import { SHALEV_SLUG } from "@/lib/red-artists/portal-config";

/**
 * GET /api/red-artists/performance-files — Shalev's OWN performance files
 * (recursive → covers playbacks / clean-versions / dj-versions / show-intros /
 * sets). Returns a play URL via the existing /api/dropbox/stream. No DB, no
 * metadata. A not-yet-created folder is treated as empty (not an error).
 */
export async function GET() {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const files = await listPerformanceFiles(SHALEV_SLUG);
    return NextResponse.json({ ok: true, files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/performance-files]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
