import { NextRequest, NextResponse } from "next/server";
import { requireCleantoneAccess } from "@/lib/require-auth";
import { getProfileImage, saveProfileImage } from "@/lib/red-artists/portal-files";
import { CLEANTONE_NAME, slugForPortalArtistName } from "@/lib/red-artists/portal-registry";

// Profile-image storage for DJ CLEANTONE's OWN session — the mirror of
// /api/red-artists/profile-image (Shalev), pinned to HIS slug and reusing the same
// shared Dropbox logic (portal-files.ts) — no DB, no new upload system. Owner or
// DJ CLEANTONE only, and the slug is server-side constant, so the client can never
// address another artist's folder. The proxy already allows this path via the
// "/api/red-artists/cleantone" prefix — no allowlist change.
export const maxDuration = 60;

const CLEANTONE_SLUG = slugForPortalArtistName(CLEANTONE_NAME) as string;

function streamUrl(path: string): string {
  return `/api/red-artists/cleantone/stream?path=${encodeURIComponent(path)}`;
}

// ── GET: original image + last crop (source of truth for re-editing) ─────────────
export async function GET() {
  const denied = await requireCleantoneAccess();
  if (denied) return denied;
  try {
    const result = await getProfileImage(CLEANTONE_SLUG, streamUrl);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/cleantone/profile-image GET]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ── POST: save avatar (always) + original (only when provided) + editor.json ─────
export async function POST(req: NextRequest) {
  const denied = await requireCleantoneAccess();
  if (denied) return denied;
  try {
    const form = await req.formData();
    const result = await saveProfileImage(CLEANTONE_SLUG, form);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, path: result.path, url: streamUrl(result.path) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/cleantone/profile-image POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
