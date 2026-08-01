import { NextRequest, NextResponse } from "next/server";
import { resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { getNextRelease } from "@/lib/release-store";

/**
 * GET /api/label/artists/[id]/next-release — owner-preview equivalent of
 * /api/red-artists/next-release, generalized to any registered portal artist.
 * This artist's nearest today-or-future release, computed live from the label
 * release pipeline (project_release_details). Read-only.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;
  try {
    const release = await getNextRelease(access.config.artistId);
    return NextResponse.json({ ok: true, release });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
