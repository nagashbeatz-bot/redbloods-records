import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { listShows } from "@/lib/shows-store";
import { parseArtistNames } from "@/lib/clients-store";
import { computeShowSplit } from "@/lib/shows-types";
import { getRehearsalCountedMap, getShowFeeRowsMap } from "@/lib/shows-finance-sync";
import type { LabelShowLine, ArtistShowsSummary, ArtistShowsTotals } from "@/lib/types";

// GET /api/label/artists/[id]/shows — shows-only label finance for one artist.
// Read-only. Artist name is resolved server-side from label_artists by id.
// Money is derived ONLY via computeShowSplit (with Fin-2 rehearsal costs from the
// same getRehearsalCountedMap helper the Shows page uses); the rehearsal cost is
// never subtracted again (it's inside the split).
// A1 (Owner canon 2026-09-27): client paid ≠ DJ paid ≠ artist paid. The label's
// received / expected follows the CLIENT payment (shows.payment_status); artist paid
// and DJ paid follow their OWN fee rows in Finance (show_money_role ARTIST_FEE /
// DJ_FEE, status שולם) — the amount actually paid is that row's amount, an unpaid
// share is the split. Totals are PER CURRENCY: `totals` = ₪ shows only (the existing
// ₪ consumers); every currency is in `totalsByCurrency` — never added together.
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const allShows = await listShows();
    // This artist's shows, excluding cancelled ones.
    const relevant = allShows.filter((s) => {
      const tokens = parseArtistNames(s.artist || "");
      return tokens.includes(artist.name) && s.status !== "בוטל" && s.payment_status !== "בוטל";
    });
    // Fin-2: counted rehearsal costs per show — the SAME helper the Shows page uses
    // (one batched query). Passed into computeShowSplit so the split matches Shows.
    const rehMap = await getRehearsalCountedMap(relevant.map((s) => s.id));
    const feeMap = await getShowFeeRowsMap(relevant);

    const lines: LabelShowLine[] = [];
    const emptyTotals = (): ArtistShowsTotals => ({
      labelReceived: 0, labelExpected: 0,
      artistPaid: 0, artistExpected: 0,
      djPaid: 0, djExpected: 0,
      count: 0, needsAttribution: 0,
    });
    const byCurrency: Record<string, ArtistShowsTotals> = {};

    for (const s of relevant) {
      const tokens = parseArtistNames(s.artist || "");
      const isCollab = tokens.length > 1;
      const split = computeShowSplit(s, rehMap[s.id] ?? 0);         // Fin-2 rehearsal costs baked into the split
      const included = !isCollab;
      const currency = s.currency || "₪";
      const fees = feeMap[s.id] ?? { DJ_FEE: null, ARTIST_FEE: null };

      lines.push({
        id: s.id, name: s.name, date: s.date, status: s.status,
        paymentStatus: s.payment_status,                            // the CLIENT payment, never rewritten
        showPrice: s.show_price ?? 0, djFee: split.djFee,
        labelProfit: split.labelProfit, artistFee: split.artistFee,
        isCollab, included,
        currency,
        artistFeeStatus: fees.ARTIST_FEE?.status ?? null,
        djFeeStatus: fees.DJ_FEE?.status ?? null,
      });

      const t = (byCurrency[currency] ??= emptyTotals());
      if (!included) { t.needsAttribution += 1; continue; }
      t.count += 1;
      if (s.payment_status === "שולם") t.labelReceived += split.labelProfit;
      else t.labelExpected += split.labelProfit;
      // A1: each fee by its own row. A paid row counts in ITS currency (the amount actually paid).
      const art = fees.ARTIST_FEE;
      if (art?.status === "שולם") (byCurrency[art.currency] ??= emptyTotals()).artistPaid += art.amount;
      else t.artistExpected += split.artistFee;
      const dj = fees.DJ_FEE;
      if (dj?.status === "שולם") (byCurrency[dj.currency] ??= emptyTotals()).djPaid += dj.amount;
      else t.djExpected += split.djFee;
    }

    lines.sort((a, b) => (a.date && b.date ? (a.date > b.date ? -1 : 1) : a.date ? -1 : 1));
    const payload: ArtistShowsSummary = {
      totals: byCurrency["₪"] ?? emptyTotals(),
      totalsByCurrency: byCurrency,
      excludedCurrencies: Object.keys(byCurrency).filter((c) => c !== "₪"),
      shows: lines,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/shows GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
