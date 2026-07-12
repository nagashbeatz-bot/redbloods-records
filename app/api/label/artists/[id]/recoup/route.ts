import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { listShows } from "@/lib/shows-store";
import { parseArtistNames } from "@/lib/clients-store";
import { computeShowSplit } from "@/lib/shows-types";
import { getRehearsalCountedMap } from "@/lib/shows-finance-sync";
import { getArtistMedia } from "@/lib/media-income-store";
import { getRecoupTargetForArtist } from "@/lib/label-clips";
import { computeArtistRecoup } from "@/lib/label-recoup";

export const dynamic = "force-dynamic";

// GET /api/label/artists/[id]/recoup — unified per-artist recoup across all income
// channels. Read-only, owner-only. Artist resolved server-side by id. Every cap runs
// PER ARTIST inside computeArtistRecoup; /label sums the already-capped results.
// Sources (single each, no double-count): clips = target; media = signed recoupedTotal
// (frozen snapshots) + artistShareExpected; shows = artistPaid / artistExpected via
// computeShowSplit only (never transactions, never a media record).
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    // Clips: the recoup target (Σ artist half of active clip budgets).
    const clipRecoupTarget = await getRecoupTargetForArtist(artist.name);

    // Media: actual recouped (signed, frozen snapshots) + expected artist share (צפוי).
    const media = await getArtistMedia(id, artist.name);
    const mediaActualRecouped = media.totals.recoupedTotal;
    const mediaExpectedArtistShare = media.totals.artistShareExpected;

    // Shows: artist share of paid / not-yet-paid shows — mirrors the shows route
    // exactly (exclude cancelled + collab; Fin-2 rehearsal costs baked into the split).
    const allShows = await listShows();
    const relevant = allShows.filter((s) => {
      const tokens = parseArtistNames(s.artist || "");
      return tokens.includes(artist.name) && s.status !== "בוטל" && s.payment_status !== "בוטל";
    });
    const rehMap = await getRehearsalCountedMap(relevant.map((s) => s.id));
    let showsArtistPaid = 0, showsArtistExpected = 0;
    for (const s of relevant) {
      if (parseArtistNames(s.artist || "").length > 1) continue;   // collab → needs attribution, excluded
      const split = computeShowSplit(s, rehMap[s.id] ?? 0);
      if (s.payment_status === "שולם") showsArtistPaid += split.artistFee;
      else showsArtistExpected += split.artistFee;
    }

    const recoup = computeArtistRecoup({
      clipRecoupTarget,
      mediaActualRecouped,
      mediaExpectedArtistShare,
      showsArtistPaid,
      showsArtistExpected,
    });
    return NextResponse.json(recoup);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/recoup GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
