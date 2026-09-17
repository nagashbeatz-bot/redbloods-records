import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { listArtistBalanceEntries } from "@/lib/artist-balance-store";
import { closeCurrentBalanceCycle } from "@/lib/artist-balance-cycles-store";

export const dynamic = "force-dynamic";

/**
 * Closes the artist's current financial cycle — OWNER-ONLY. Freezes the current
 * cycle's live totals into a permanent history row (public.artist_balance_cycles)
 * and returns the refreshed cycle state (the next cycle is then "current").
 * Never touches artist_balance_entries — no transaction is deleted or changed.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const force = body?.force === true;

    const entries = await listArtistBalanceEntries(id);
    try {
      const state = await closeCurrentBalanceCycle(id, entries, force);
      return NextResponse.json({ ok: true, ...state });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאת שרת";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/balance/cycles/close POST]", msg);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
