import { NextResponse } from "next/server";
import { requireShalevAccess, getAuthRole } from "@/lib/require-auth";
import { notifyShalevEntry } from "@/lib/shalev-presence-notify";

/**
 * POST /api/red-artists/ping — Shalev's portal presence ping (page open + the visible-page heartbeat). The SERVER
 * decides (lib/push-presence-pure.ts): last-seen is recorded; only a NEW visit (no last-seen for 30 minutes), claimed
 * atomically, sends the Owner ONE push — a refresh, in-portal navigation, a second tab or a heartbeat never does.
 * Only a shalev session is recorded — the owner previewing his portal is a no-op. Always returns ok.
 */
export async function POST() {
  const denied = await requireShalevAccess(); if (denied) return denied;
  if ((await getAuthRole()) !== "shalev") return NextResponse.json({ ok: true }); // owner → no push
  try {
    await notifyShalevEntry();
  } catch { /* best-effort — never block the page */ }
  return NextResponse.json({ ok: true });
}
