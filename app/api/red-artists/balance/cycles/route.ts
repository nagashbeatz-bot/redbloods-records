import { NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { getLabelArtistByName } from "@/lib/label-artists-store";
import { listArtistBalanceEntries } from "@/lib/artist-balance-store";
import { getBalanceCycleState } from "@/lib/artist-balance-cycles-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/red-artists/balance/cycles — READ-ONLY cycle state for the Shalev portal
 * (owner or shalev). Mirrors /api/red-artists/balance: artist resolved server-side
 * by name, no write path here (anchor/close stay on the owner-only label routes).
 */

const PORTAL_ARTIST_NAME = "שליו טסמה";

export async function GET() {
  const denied = await requireShalevAccess();
  if (denied) return denied;
  try {
    const artist = await getLabelArtistByName(PORTAL_ARTIST_NAME);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const entries = await listArtistBalanceEntries(artist.id);
    const state = await getBalanceCycleState(artist.id, entries);
    return NextResponse.json({ ok: true, ...state });
  } catch (err) {
    console.error("[red-artists/balance/cycles GET]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
