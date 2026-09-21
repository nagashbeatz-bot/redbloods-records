import { NextRequest, NextResponse } from "next/server";
import { resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { artistHasProjectRelease, coverImageResponse } from "@/lib/project-cover-store";

/**
 * GET /api/label/artists/[id]/project-cover?projectId=… — READ-ONLY cover image for a
 * portal artist's page (owner preview, or Avi scoped to his own id by
 * resolvePortalReadAccess). Serves the cover only when that project is one of THIS
 * artist's releases; any other projectId is a 404. No write method exists here.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;
  const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
  if (!(await artistHasProjectRelease(access.config.artistId, projectId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return coverImageResponse(projectId);
}
