import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { getNextReleaseConfig, setNextReleaseConfig } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

// GET /api/label/artists/[id]/next-release — this artist's chosen next
// release (resolved against their own live sketches). null when unset.
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const release = await getNextReleaseConfig(access.config.slug);
    return NextResponse.json({ ok: true, release });
  } catch (err) {
    return errResponse(err);
  }
}

// POST /api/label/artists/[id]/next-release — set it. body: { sketchId, releaseDate }.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const body = await req.json().catch(() => ({}));
    const release = await setNextReleaseConfig(access.config.slug, String(body.sketchId ?? ""), String(body.releaseDate ?? ""));
    return NextResponse.json({ ok: true, release });
  } catch (err) {
    return errResponse(err);
  }
}
