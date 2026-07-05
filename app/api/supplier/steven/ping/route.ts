import { NextResponse } from "next/server";
import { requireStevenAccess, getAuthRole, getAuthUser } from "@/lib/require-auth";
import { notifyStevenPresence } from "@/lib/steven-notify";

/**
 * POST /api/supplier/steven/ping — presence beacon fired once when Steven's page
 * mounts. It NEVER decides on the client: the server applies login dedupe (by
 * last_sign_in_at) + a 30-minute visit cooldown, so refresh / new tab / hard
 * refresh can't spam. Only a steven session triggers a push (owner viewing his
 * page is a no-op). This is NOT /api/push/check. Always returns ok.
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
