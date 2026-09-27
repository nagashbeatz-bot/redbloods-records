import { NextResponse } from "next/server";
import { requireStevenAccess, getAuthRole, getAuthUser } from "@/lib/require-auth";
import { notifyStevenPresence } from "@/lib/steven-notify";

/**
 * POST /api/supplier/steven/ping — Steven's portal presence ping (page open + the visible-page heartbeat). The SERVER
 * decides (lib/push-presence-pure.ts): last-seen is recorded; only a NEW visit (no last-seen for 30 minutes), claimed
 * atomically, sends the Owner ONE push ("logged in" when the sign-in is under 3 minutes old). Only a steven session
 * is recorded (owner viewing his page is a no-op). This is NOT /api/push/check. Always returns ok.
 */
export async function POST() {
  const denied = await requireStevenAccess(); if (denied) return denied;
  if ((await getAuthRole()) !== "steven") return NextResponse.json({ ok: true }); // owner → no push
  try {
    const user = await getAuthUser();
    await notifyStevenPresence(user);
  } catch { /* best-effort — never block the page */ }
  return NextResponse.json({ ok: true });
}
