import { NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { getLabelArtistByName } from "@/lib/label-artists-store";
import { listArtistBalanceEntries, computeArtistBalanceTotals } from "@/lib/artist-balance-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/red-artists/balance — READ-ONLY balance ledger for the Shalev portal
 * (owner or shalev). The artist is resolved SERVER-SIDE by name; the client never
 * supplies an artist id. Same {entries, totals} shape as the owner endpoint.
 *
 * Writes (create/edit/delete) stay ONLY on the owner-only
 * /api/label/artists/[id]/balance routes — the proxy also keeps shalev off
 * /api/label/*, so this is his single read path to the ledger.
 */

const PORTAL_ARTIST_NAME = "שליו טסמה";

export async function GET() {
  const denied = await requireShalevAccess();
  if (denied) return denied;
  try {
    const artist = await getLabelArtistByName(PORTAL_ARTIST_NAME);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const entries = await listArtistBalanceEntries(artist.id);
    const totals = computeArtistBalanceTotals(entries);
    return NextResponse.json({ ok: true, entries, totals });
  } catch (err) {
    console.error("[red-artists/balance GET]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
