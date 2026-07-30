import { NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { getNextRelease } from "@/lib/release-store";
import { resolvePortalConfigByName } from "@/lib/red-artists/portal-config";
import { SHALEV_NAME } from "@/lib/red-artists/portal-registry";

/**
 * GET /api/red-artists/next-release — Shalev's nearest today-or-future release,
 * computed live from the label release pipeline (project_release_details), never
 * a manual pointer. null when there's no upcoming release for him. Read-only —
 * editing a release's date/stage happens in "ניהול הלייבל" (/label), not here.
 */
export async function GET() {
  const denied = await requireShalevAccess();
  if (denied) return denied;
  try {
    const config = await resolvePortalConfigByName(SHALEV_NAME);
    const release = config ? await getNextRelease(config.artistId) : null;
    return NextResponse.json({ ok: true, release });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
