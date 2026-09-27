import { NextResponse } from "next/server";
import { requireCleantoneAccess, getAuthRole } from "@/lib/require-auth";
import { notifyCleantoneEntry } from "@/lib/cleantone-presence-notify";

/**
 * POST /api/red-artists/cleantone/ping — DJ CLEANTONE's portal presence ping (page open + the visible-page
 * heartbeat), the mirror of /api/red-artists/ping. The SERVER decides (lib/push-presence-pure.ts): last-seen is
 * recorded; only a NEW visit (no last-seen for 30 minutes), claimed atomically, sends the Owner ONE push. Only a
 * genuine DJ CLEANTONE session is recorded — the owner previewing his portal resolves as role "owner" and is a
 * no-op. Always returns ok. The proxy already allows this path via the "/api/red-artists/cleantone" prefix.
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
