import { NextResponse } from "next/server";
import { resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { notifyAviEntry } from "@/lib/avi-presence-notify";

/**
 * POST /api/label/artists/[id]/ping — entry beacon fired once per real app
 * session, the artist-scoped mirror of /api/red-artists/ping (Shalev).
 *
 * It NEVER decides on the client alone: sessionStorage (ArtistPortalPage) only
 * stops repeat calls within the same tab, and the server applies a short
 * race-guard on top, so a refresh / in-page navigation can't spam.
 *
 * Only a genuine ARTIST session triggers a push — resolvePortalReadAccess already
 * pins a non-owner to their own id, and the explicit role check below makes the
 * owner previewing this portal a no-op (he resolves as role "owner", never "avi").
 * Always returns ok, so a push failure can never break the page.
 */
export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;
  if (access.role !== "avi") return NextResponse.json({ ok: true }); // owner preview → no push
  try {
    await notifyAviEntry();
  } catch { /* best-effort — never block the page */ }
  return NextResponse.json({ ok: true });
}
