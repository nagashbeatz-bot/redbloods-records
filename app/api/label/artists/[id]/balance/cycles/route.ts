import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { listArtistBalanceEntries, isValidYmd } from "@/lib/artist-balance-store";
import { getBalanceCycleState, setBalanceCycleAnchor, updateBalanceCycleAnchor } from "@/lib/artist-balance-cycles-store";

export const dynamic = "force-dynamic";

/**
 * Financial-cycle state for one artist — OWNER-ONLY.
 *   GET   /api/label/artists/[id]/balance/cycles   → { anchorDate, current, closed }
 *   POST  /api/label/artists/[id]/balance/cycles   → { anchorDate } first-time activation
 *   PATCH /api/label/artists/[id]/balance/cycles   → { anchorDate } corrects an already-set
 *                                                     anchor — refused once a cycle has closed
 *                                                     (see updateBalanceCycleAnchor)
 */

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const entries = await listArtistBalanceEntries(id);
    const state = await getBalanceCycleState(id, entries);
    return NextResponse.json({ ok: true, ...state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/balance/cycles GET]", msg);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isValidYmd(body.anchorDate)) {
      return NextResponse.json({ error: "תאריך לא תקין (YYYY-MM-DD)" }, { status: 400 });
    }

    try {
      await setBalanceCycleAnchor(id, body.anchorDate);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאת שרת";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const entries = await listArtistBalanceEntries(id);
    const state = await getBalanceCycleState(id, entries);
    return NextResponse.json({ ok: true, ...state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/balance/cycles POST]", msg);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isValidYmd(body.anchorDate)) {
      return NextResponse.json({ error: "תאריך לא תקין (YYYY-MM-DD)" }, { status: 400 });
    }

    try {
      await updateBalanceCycleAnchor(id, body.anchorDate);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאת שרת";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const entries = await listArtistBalanceEntries(id);
    const state = await getBalanceCycleState(id, entries);
    return NextResponse.json({ ok: true, ...state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/balance/cycles PATCH]", msg);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
