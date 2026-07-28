import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { getProfileImage, saveProfileImage } from "@/lib/red-artists/portal-files";

export const maxDuration = 60;

function streamUrl(artistId: string, path: string): string {
  return `/api/label/artists/${artistId}/stream?path=${encodeURIComponent(path)}`;
}

// GET /api/label/artists/[id]/profile-image — original image + last crop for
// THIS artist (source of truth for re-editing).
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const result = await getProfileImage(access.config.slug, (p) => streamUrl(id, p));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/profile-image GET]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// POST /api/label/artists/[id]/profile-image — save avatar (+ optional original
// + editor.json) for THIS artist only.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const form = await req.formData();
    const result = await saveProfileImage(access.config.slug, form);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, path: result.path, url: streamUrl(id, result.path) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/profile-image POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
