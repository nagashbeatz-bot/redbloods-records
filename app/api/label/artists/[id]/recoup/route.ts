import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { listShows } from "@/lib/shows-store";
import { parseArtistNames } from "@/lib/clients-store";
import { computeShowSplit } from "@/lib/shows-types";
import { getRehearsalCountedMap, getShowFeeRowsMap } from "@/lib/shows-finance-sync";
import { getArtistMedia } from "@/lib/media-income-store";
import { listArtistClips, artistClipMoney, artistClipAllocation } from "@/lib/label-clips";
import { agreementArtistOf } from "@/lib/label-agreements";
import { computeArtistRecoup } from "@/lib/label-recoup";

export const dynamic = "force-dynamic";

// GET /api/label/artists/[id]/recoup — unified per-artist recoup across all income
// channels. Read-only, owner-only. Artist resolved server-side by id. Every cap runs
// PER ARTIST inside computeArtistRecoup; /label sums the already-capped results.
// Owner decision 2026-09-27 (lib/label-agreements): the CLIP part of the debt = the artist's share funded by the label =
// 50 % of the ACTUAL PAID ₪ clip cost — ONLY for שליו טסמה / אבי מולה; any other artist stays NOT_DEFINED (null + reason).
// This is a DERIVED preview of the offset — the artist ledger stays the accounting record (it may already carry the same
// clip share as a manual expense: never netted here). A / B / C per currency are returned as clipMoneyInfo (information).
// Sources (single each, no double-count): clips = the agreement allocation; media = signed recoupedTotal
// (frozen snapshots) + artistShareExpected; shows = artistPaid / artistExpected.
// A1 (Owner canon 2026-09-27): artist paid = the show's OWN ARTIST_FEE row in Finance
// (status שולם, the amount actually paid) — never the client payment; not yet paid =
// the computeShowSplit share. The recoup (like the artist ledger) stores no currency:
// only ₪ shows enter it; other currencies are reported in showsExcludedCurrencies.
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    // Clips: the recoup contribution is NOT_DEFINED (no artist agreement rule) — A / B / C per currency as information.
    const clips = await listArtistClips(artist.name, artist.id);
    const clipMoneyInfo = artistClipMoney(clips);
    const clipRecoupTarget = agreementArtistOf({ id: artist.id }) ? (artistClipAllocation(clips).defined["₪"]?.artistShareFundedByLabel ?? 0) : null;

    // Media: actual recouped (signed, frozen snapshots) + expected artist share (צפוי).
    const media = await getArtistMedia(id, artist.name);
    const mediaArtistShareReceived = media.totals.artistShareGross;   // signed, full artist share (uncapped) — debt basis
    const mediaExpectedArtistShare = media.totals.artistShareExpected;

    // Shows: artist share of paid / not-yet-paid shows — mirrors the shows route
    // exactly (exclude cancelled + collab; Fin-2 rehearsal costs baked into the split).
    const allShows = await listShows();
    const relevant = allShows.filter((s) => {
      const tokens = parseArtistNames(s.artist || "");
      return tokens.includes(artist.name) && s.status !== "בוטל" && s.payment_status !== "בוטל";
    });
    const rehMap = await getRehearsalCountedMap(relevant.map((s) => s.id));
    const feeMap = await getShowFeeRowsMap(relevant);
    let showsArtistPaid = 0, showsArtistExpected = 0;
    const excluded = new Map<string, { currency: string; shows: number; artistPaid: number; artistExpected: number }>();
    for (const s of relevant) {
      if (parseArtistNames(s.artist || "").length > 1) continue;   // collab → needs attribution, excluded
      const split = computeShowSplit(s, rehMap[s.id] ?? 0);
      const art = feeMap[s.id]?.ARTIST_FEE ?? null;
      const paid = art?.status === "שולם";
      const currency = paid ? art!.currency : (s.currency || "₪");
      const amount = paid ? art!.amount : split.artistFee;
      if (currency !== "₪") {
        const x = excluded.get(currency) ?? { currency, shows: 0, artistPaid: 0, artistExpected: 0 };
        x.shows += 1; if (paid) x.artistPaid += amount; else x.artistExpected += amount;
        excluded.set(currency, x);
        continue;
      }
      if (paid) showsArtistPaid += amount;
      else showsArtistExpected += amount;
    }

    const recoup = computeArtistRecoup({
      clipRecoupTarget,
      clipMoneyInfo,
      mediaArtistShareReceived,
      mediaExpectedArtistShare,
      showsArtistPaid,
      showsArtistExpected,
    });
    return NextResponse.json({ ...recoup, showsExcludedCurrencies: [...excluded.values()] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/recoup GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
