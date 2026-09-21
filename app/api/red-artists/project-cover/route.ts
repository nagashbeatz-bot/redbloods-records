import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { resolvePortalConfigByName } from "@/lib/red-artists/portal-config";
import { SHALEV_NAME } from "@/lib/red-artists/portal-registry";
import { artistHasProjectRelease, coverImageResponse } from "@/lib/project-cover-store";

/**
 * GET /api/red-artists/project-cover?projectId=… — READ-ONLY cover image for Shalev's
 * own portal. Serves the cover only when that project is one of HIS releases
 * (project_release_details.label_artist_id = his id); anything else is a 404, so a
 * project id from another artist reveals nothing. There is no write method here.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireShalevAccess(); if (denied) return denied;
  const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
  const config = await resolvePortalConfigByName(SHALEV_NAME);
  if (!config || !(await artistHasProjectRelease(config.artistId, projectId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return coverImageResponse(projectId);
}
