import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { listPerformanceFiles } from "@/lib/red-artists/portal-files";

// GET /api/label/artists/[id]/performance-files — this artist's OWN
// performance folder (recursive audio listing). A not-yet-created folder is
// treated as empty (not an error).
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const files = await listPerformanceFiles(access.config.slug);
    return NextResponse.json({ ok: true, files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/performance-files]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
