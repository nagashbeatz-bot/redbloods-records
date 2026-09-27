import { NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";
import { notifyVictorPresence } from "@/lib/victor-presence-notify";

/**
 * POST /api/vendor/victor/ping — Victor's portal presence ping (page open + the visible-page heartbeat). The SERVER
 * decides (lib/push-presence-pure.ts): last-seen is recorded; only a NEW visit (no last-seen for 30 minutes), claimed
 * atomically, sends the Owner ONE push — a refresh, a second tab or in-page navigation never does. Only a victor
 * session is recorded (owner viewing his own page is a no-op). This is NOT /api/push/check. Always returns ok.
 */
export async function POST() {
  const denied = await requireVictorAccess(); if (denied) return denied;
  if ((await getAuthRole()) !== "victor") return NextResponse.json({ ok: true }); // owner → no push
  try {
    await notifyVictorPresence();
  } catch { /* best-effort — never block the page */ }
  return NextResponse.json({ ok: true });
}
