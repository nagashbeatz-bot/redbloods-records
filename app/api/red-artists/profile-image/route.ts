import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { getProfileImage, saveProfileImage } from "@/lib/red-artists/portal-files";
import { SHALEV_SLUG } from "@/lib/red-artists/portal-config";

// Profile-image storage for Shalev's OWN portal — Dropbox is the SOURCE OF
// TRUTH (localStorage on the client is a cache only), so re-editing works from
// any device/browser. Owner-only writes here; reuses the existing Dropbox
// token — no DB, no share tokens, no project coupling.
export const maxDuration = 60;

function streamUrl(path: string): string {
  // Scoped portal stream (owner|shalev, restricted to Shalev's folder tree) — the
  // raw /api/dropbox/stream is blocked for the shalev role.
  return `/api/red-artists/stream?path=${encodeURIComponent(path)}`;
}

// ── GET: original image + last crop (source of truth for re-editing) ─────────────
export async function GET() {
  const denied = await requireShalevAccess();
  if (denied) return denied;
  try {
    const result = await getProfileImage(SHALEV_SLUG, streamUrl);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/profile-image GET]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ── POST: save avatar (always) + original (only when provided) + editor.json ─────
//   form fields: avatar (File, required), original (File, optional — new image),
//                zoom, posX, posY (numbers), originalFileName (optional string)
export async function POST(req: NextRequest) {
  const denied = await requireShalevAccess();
  if (denied) return denied;
  try {
    const form = await req.formData();
    const result = await saveProfileImage(SHALEV_SLUG, form);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, path: result.path, url: streamUrl(result.path) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/profile-image POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
