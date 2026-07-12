import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { listShows } from "@/lib/shows-store";
import { parseArtistNames } from "@/lib/clients-store";
import { computeShowSplit } from "@/lib/shows-types";
import { getRehearsalCountedMap } from "@/lib/shows-finance-sync";
import type { LabelShowLine, ArtistShowsSummary } from "@/lib/types";

// GET /api/label/artists/[id]/shows — shows-only label finance for one artist.
// Read-only. Artist name is resolved server-side from label_artists by id.
// Money is derived ONLY via computeShowSplit (with Fin-2 rehearsal costs from the
// same getRehearsalCountedMap helper the Shows page uses); transactions are never
// summed and the rehearsal cost is never subtracted again (it's inside the split).
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

    const lines: LabelShowLine[] = [];
    const totals = {
      labelReceived: 0, labelExpected: 0,
      artistPaid: 0, artistExpected: 0,
      djPaid: 0, djExpected: 0,
      count: 0, needsAttribution: 0,
    };

    for (const s of relevant) {
      const tokens = parseArtistNames(s.artist || "");
      const isCollab = tokens.length > 1;
      const split = computeShowSplit(s, rehMap[s.id] ?? 0);         // Fin-2 rehearsal costs baked into the split
      const included = !isCollab;

      lines.push({
        id: s.id, name: s.name, date: s.date, status: s.status,
        paymentStatus: s.payment_status,                            // original, never rewritten
        showPrice: s.show_price ?? 0, djFee: split.djFee,
        labelProfit: split.labelProfit, artistFee: split.artistFee,
        isCollab, included,
      });

      if (!included) { totals.needsAttribution += 1; continue; }
      totals.count += 1;
      if (s.payment_status === "שולם") {
        totals.labelReceived += split.labelProfit;
        totals.artistPaid    += split.artistFee;
        totals.djPaid        += split.djFee;
      } else {
        totals.labelExpected += split.labelProfit;
        totals.artistExpected += split.artistFee;
        totals.djExpected    += split.djFee;
      }
    }

    lines.sort((a, b) => (a.date && b.date ? (a.date > b.date ? -1 : 1) : a.date ? -1 : 1));
    const payload: ArtistShowsSummary = { totals, shows: lines };
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/shows GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
