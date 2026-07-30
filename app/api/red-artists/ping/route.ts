import { NextResponse } from "next/server";
import { requireShalevAccess, getAuthRole } from "@/lib/require-auth";
import { notifyShalevEntry } from "@/lib/shalev-presence-notify";

/**
 * POST /api/red-artists/ping — entry beacon fired once per real app session.
 * It NEVER decides on the client alone: sessionStorage (ArtistPortalPage) only
 * stops repeat calls within the same tab, and the server applies a short
 * race-guard on top, so a refresh / in-page navigation can't spam. Only a
 * shalev session triggers a push — the owner previewing his own portal is a
 * no-op. Always returns ok.
 */
export async function POST() {
  const denied = await requireShalevAccess(); if (denied) return denied;
  if ((await getAuthRole()) !== "shalev") return NextResponse.json({ ok: true }); // owner → no push
  try {
    await notifyShalevEntry();
  } catch { /* best-effort — never block the page */ }
  return NextResponse.json({ ok: true });
}
