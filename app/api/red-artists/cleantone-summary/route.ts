import { NextResponse } from "next/server";
import { requireCleantoneAccess } from "@/lib/require-auth";
import { listShows } from "@/lib/shows-store";
import { CLEANTONE_CLIENT_ID } from "@/lib/red-artists/cleantone";

/**
 * GET /api/red-artists/cleantone-summary  (DJ CLEANTONE or owner, READ-ONLY)
 *
 * Scoped to shows where dj_client_id = CLEANTONE_CLIENT_ID (never dj_name —
 * that field is display-only). Unlike shalev-summary, money IS returned here:
 * dj_fee is literally DJ CLEANTONE's own fee, not another artist's finances.
 * Cancelled shows (בוטל) are excluded — nothing for him to act on there.
 * Nothing here writes: no transactions, no shows, no Finance sync.
 */
export async function GET() {
  const denied = await requireCleantoneAccess();
  if (denied) return denied;

  try {
    const allShows = await listShows();
    const mine = allShows.filter((s) => s.dj_client_id === CLEANTONE_CLIENT_ID && s.status !== "בוטל");

    const toRow = (s: (typeof mine)[number]) => ({
      id: s.id,
      name: s.name,
      artist: s.artist,
      date: s.date,
      startTime: s.start_time,
      location: s.location,
      djFee: s.dj_fee,
      status: s.status,
      confirmationStatus: s.dj_confirmation_status,
      notes: s.notes,
    });

    const upcoming = mine
      .filter((s) => s.status !== "בוצע")
      .sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? -1 : (a.date ?? "") > (b.date ?? "") ? 1 : 0))
      .map(toRow);

    const done = mine
      .filter((s) => s.status === "בוצע")
      .sort((a, b) => ((a.date ?? "") > (b.date ?? "") ? -1 : (a.date ?? "") < (b.date ?? "") ? 1 : 0))
      .map(toRow);

    // Updates — derived only from his own real upcoming shows (no other source yet).
    const updates = upcoming.slice(0, 12).map((s) => ({
      type: "הופעה",
      title: s.confirmationStatus === "ממתין לאישור" ? "הופעה ממתינה לאישורך" : "הופעה אושרה",
      description: [s.name, s.location].filter(Boolean).join(" · "),
      date: s.date,
      startTime: s.startTime ?? null,
      endTime: null as string | null,
    }));

    return NextResponse.json({ ok: true, shows: { upcoming, done }, updates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
