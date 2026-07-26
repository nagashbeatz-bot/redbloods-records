import { NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";
import { notifyVictorPresence } from "@/lib/victor-presence-notify";

/**
 * POST /api/vendor/victor/ping — presence beacon fired once when Victor's page
 * mounts. It NEVER decides on the client: the server applies a 30-minute
 * rolling visit cooldown, so refresh / a second tab / in-page navigation can't
 * spam. Only a victor session triggers a push (owner viewing his own page is a
 * no-op). Mirrors /api/supplier/steven/ping exactly. This is NOT
 * /api/push/check. Always returns ok.
 */
export async function POST() {
  const denied = await requireVictorAccess(); if (denied) return denied;
  if ((await getAuthRole()) !== "victor") return NextResponse.json({ ok: true }); // owner → no push
  try {
    await notifyVictorPresence();
  } catch { /* best-effort — never block the page */ }
  return NextResponse.json({ ok: true });
}
