import { NextResponse } from "next/server";
import { resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { notifyAviEntry } from "@/lib/avi-presence-notify";

/**
 * POST /api/label/artists/[id]/ping — Avi's portal presence ping (page open + the visible-page heartbeat), the
 * artist-scoped mirror of /api/red-artists/ping. The SERVER decides (lib/push-presence-pure.ts): last-seen is
 * recorded; only a NEW visit (no last-seen for 30 minutes), claimed atomically, sends the Owner ONE push.
 *
 * Only a genuine ARTIST session is recorded — resolvePortalReadAccess already pins a non-owner to their own id, and
 * the explicit role check below makes the owner previewing this portal a no-op (he resolves as role "owner", never
 * "avi"). Always returns ok, so a push failure can never break the page.
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
