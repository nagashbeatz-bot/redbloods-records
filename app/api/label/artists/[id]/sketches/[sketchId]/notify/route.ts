import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { listSketches, type Sketch } from "@/lib/red-artists/sketches-store";
import { sendPushToRoles } from "@/lib/push";
import { classifyPushResult } from "@/lib/shalev-weekly-pure";
import { AVI_NAME, SHALEV_NAME } from "@/lib/red-artists/portal-registry";

// POST /api/label/artists/[id]/sketches/[sketchId]/notify
//
// OWNER-ONLY manual "send a new-sketch push". Fired ONLY by the owner's button in
// the sketch editor — never on upload, page load, refresh or any useEffect. Takes
// ONLY the ids from the URL; the server re-reads the sketch and derives the text
// (project title + latestVersion) itself, so the client can never choose the
// number or the wording. Recipients: the ARTIST's own role AND the owner —
// two SEPARATE role-scoped sends, because the deep-link differs per recipient.
// deliver() persists the canonical per-user `notifications` rows automatically
// (idempotent by event_key) — no schema/SQL here.
//
// Enabled for exactly two portals (Avi Molla, Shalev Tasama); every other
// artist id gets 403.

interface NotifyTarget {
  /** push_subscriptions.role of the ARTIST (never the owner). */
  role: string;
  /** Stable key prefix — carries the ARTIST into eventId/tag alongside sketch+version. */
  keyPrefix: string;
  /** Where the ARTIST'S OWN notification lands. */
  artistUrl: (artistId: string) => string;
  /** The push text the ARTIST sees. */
  body: (sketch: Sketch) => string;
}

// Explicit per-artist map — never derived from a generic role, so no future
// portal artist can silently inherit someone else's push audience.
const NOTIFY_TARGETS: Record<string, NotifyTarget> = {
  // Avi — UNCHANGED from the original single-artist implementation: same role,
  // same wording, same URL for both recipients, and the SAME eventId/tag
  // strings ("sketch_avi_notify:…" / "sketch-avi-notify-…") so his existing
  // notification idempotency keys keep matching.
  [AVI_NAME]: {
    role: "avi",
    keyPrefix: "avi",
    artistUrl: (artistId) => `/label/artists/${artistId}?tab=music`,
    body: (s) => `הועלתה סקיצה חדשה ל"${s.title}" - סקיצה ${s.latestVersion} 🎵`,
  },
  // Shalev — his portal is /red-artists (the proxy blocks him from /label/*),
  // so his deep-link MUST differ from the owner's. Wording matches the phrasing
  // his existing sketch notifications already use (lib/red-artists/sketches-notify-pure.ts).
  [SHALEV_NAME]: {
    role: "shalev",
    keyPrefix: "shalev",
    artistUrl: () => "/red-artists?tab=music",
    body: (s) => `הסקיצה בפרויקט „${s.title}” עודכנה 🎵`,
  },
};

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string; sketchId: string }> }) {
  const { id, sketchId } = await context.params;

  // requireOwner — the artist (role "avi" / "shalev") gets 403 here even if they
  // reached the route; and the path is deliberately NOT in isAviAllowedPath /
  // isShalevAllowedPath, so the proxy blocks them first. They can RECEIVE the
  // push, never trigger the send.
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;

  // Artist identity comes from the DB row for the id in the URL, never the client.
  const target = NOTIFY_TARGETS[access.config.name];
  if (!target) {
    return NextResponse.json({ error: "פעולה זו אינה זמינה בפורטל הזה" }, { status: 403 });
  }

  const sketch = (await listSketches(access.config.slug)).find((s) => s.id === sketchId);
  if (!sketch) return NextResponse.json({ error: "הסקיצה לא נמצאה" }, { status: 404 });

  // Number ALWAYS derived from the manifest — never from client text. The key
  // carries artist + sketch + version, so the two portals can never collide.
  const shared = {
    title: "Redbloods Records",
    body: target.body(sketch),
    tag: `sketch-${target.keyPrefix}-notify-${sketchId}-${sketch.latestVersion}`,
    eventId: `sketch_${target.keyPrefix}_notify:${sketchId}:${sketch.latestVersion}`,
    entityType: "sketch",
    entityId: sketchId,
  };

  try {
    // Two role-scoped sends. They differ ONLY in `url` (each recipient must land
    // on a page they are actually allowed to open), so each recipient's delivery
    // can be classified honestly (same eventId → distinct per-user event_key, no
    // notifications-table conflict).
    const artistRes = await sendPushToRoles([target.role], { ...shared, url: target.artistUrl(id) });
    const ownerRes = await sendPushToRoles(["owner"], { ...shared, url: `/label/artists/${id}?tab=music` });
    const artistSent = classifyPushResult(artistRes) === "sent";
    return NextResponse.json({
      ok: true,
      artistSent,
      aviSent: artistSent,   // back-compat: existing UI reads this field
      ownerSent: classifyPushResult(ownerRes) === "sent",
    });
  } catch (e) {
    console.error("[sketches notify] send failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "שליחת ההתראה נכשלה" }, { status: 500 });
  }
}
