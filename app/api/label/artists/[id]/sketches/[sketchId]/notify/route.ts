import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { listSketches } from "@/lib/red-artists/sketches-store";
import { notifySketchToArtist, SKETCH_NOTIFY_TARGETS } from "@/lib/writes/label";

// POST /api/label/artists/[id]/sketches/[sketchId]/notify
//
// OWNER-ONLY manual "send a new-sketch push". Fired ONLY by the owner's button in the sketch editor — never on upload,
// page load, refresh or any useEffect. Takes ONLY the ids from the URL; the server re-reads the sketch and derives the
// text itself. Recipients: the ARTIST's own role AND the owner. Enabled for exactly two portals (Avi Molla, Shalev
// Tasama); every other artist id gets 403. The sender lives in lib/writes/label (also Sunny's NOTIFY_SKETCH).
export async function POST(_req: NextRequest, context: { params: Promise<{ id: string; sketchId: string }> }) {
  const { id, sketchId } = await context.params;
  // requireOwner inside — the artist gets 403 here even if they reached the route; the proxy blocks them first.
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  if (!SKETCH_NOTIFY_TARGETS[access.config.name]) {
    return NextResponse.json({ error: "פעולה זו אינה זמינה בפורטל הזה" }, { status: 403 });
  }
  const sketch = (await listSketches(access.config.slug)).find((s) => s.id === sketchId);
  if (!sketch) return NextResponse.json({ error: "הסקיצה לא נמצאה" }, { status: 404 });
  try {
    const r = await notifySketchToArtist(id, access.config.name, sketch);
    if (r.kind !== "ok") return NextResponse.json({ error: "פעולה זו אינה זמינה בפורטל הזה" }, { status: 403 });
    return NextResponse.json({ ok: true, artistSent: r.artistSent, aviSent: r.artistSent /* back-compat: existing UI reads this field */, ownerSent: r.ownerSent });
  } catch (e) {
    console.error("[sketches notify] send failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "שליחת ההתראה נכשלה" }, { status: 500 });
  }
}
