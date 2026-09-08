import { NextResponse } from "next/server";
import { requireCleantoneAccess, getAuthRole } from "@/lib/require-auth";
import { notifyCleantoneEntry } from "@/lib/cleantone-presence-notify";

/**
 * POST /api/red-artists/cleantone/ping — entry beacon fired once per real app
 * session, the mirror of /api/red-artists/ping (Shalev) and
 * /api/label/artists/[id]/ping (Avi).
 *
 * It NEVER decides on the client alone: sessionStorage (ArtistPortalPage) only
 * stops repeat calls within the same tab, and the server applies a short
 * race-guard on top, so a refresh / in-page navigation can't spam. Only a
 * genuine DJ CLEANTONE session triggers a push — the owner previewing his
 * portal resolves as role "owner" and is a no-op. Always returns ok, so a push
 * failure can never break the page. The proxy already allows this path via the
 * "/api/red-artists/cleantone" prefix — no allowlist change.
 */
export async function POST() {
  const denied = await requireCleantoneAccess();
  if (denied) return denied;
  if ((await getAuthRole()) !== "cleantone") return NextResponse.json({ ok: true }); // owner → no push
  try {
    await notifyCleantoneEntry();
  } catch { /* best-effort — never block the page */ }
  return NextResponse.json({ ok: true });
}
