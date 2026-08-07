import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { listSketches } from "@/lib/red-artists/sketches-store";
import { sendPushToRoles } from "@/lib/push";
import { classifyPushResult } from "@/lib/shalev-weekly-pure";
import { AVI_ARTIST_ID } from "@/lib/roles";

// POST /api/label/artists/[id]/sketches/[sketchId]/notify
//
// OWNER-ONLY manual "send a new-sketch push". Fired ONLY by the owner's button in
// the sketch editor — never on upload, page load, refresh or any useEffect. Takes
// ONLY the ids from the URL; the server re-reads the sketch and derives the text
// (project title + latestVersion) itself, so the client can never choose the
// number or the wording. Recipients: Avi (role "avi") AND the owner (role
// "owner") — the SAME payload to both, so the owner sees exactly what Avi got.
// deliver() persists the canonical per-user `notifications` rows automatically
// (idempotent by event_key) — no schema/SQL here. Scoped to Avi's artist only.
export async function POST(_req: NextRequest, context: { params: Promise<{ id: string; sketchId: string }> }) {
  const { id, sketchId } = await context.params;

  // requireOwner — Avi (role "avi") gets 403 here even if he reached the route;
  // and the path is deliberately NOT in isAviAllowedPath, so the proxy blocks him
  // first. He can RECEIVE the push, never trigger the send.
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;

  // This action exists for Avi's portal only (the "avi" recipient role is his).
  if (id !== AVI_ARTIST_ID) {
    return NextResponse.json({ error: "פעולה זו זמינה רק בפורטל של אבי" }, { status: 403 });
  }

  const sketch = (await listSketches(access.config.slug)).find((s) => s.id === sketchId);
  if (!sketch) return NextResponse.json({ error: "הסקיצה לא נמצאה" }, { status: 404 });

  // Number ALWAYS derived from the manifest — never from client text.
  const payload = {
    title: "Redbloods Records",
    body: `הועלתה סקיצה חדשה ל"${sketch.title}" - סקיצה ${sketch.latestVersion} 🎵`,
    url: `/label/artists/${id}?tab=music`,
    tag: `sketch-avi-notify-${sketchId}-${sketch.latestVersion}`,
    eventId: `sketch_avi_notify:${sketchId}:${sketch.latestVersion}`,
    entityType: "sketch",
    entityId: sketchId,
  };

  try {
    // Two role-scoped sends with the IDENTICAL payload so each recipient's
    // delivery can be classified honestly (same eventId → distinct per-user
    // event_key, no notifications-table conflict).
    const aviRes = await sendPushToRoles(["avi"], payload);
    const ownerRes = await sendPushToRoles(["owner"], payload);
    return NextResponse.json({
      ok: true,
      aviSent: classifyPushResult(aviRes) === "sent",
      ownerSent: classifyPushResult(ownerRes) === "sent",
    });
  } catch (e) {
    console.error("[sketches notify] send failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "שליחת ההתראה נכשלה" }, { status: 500 });
  }
}
