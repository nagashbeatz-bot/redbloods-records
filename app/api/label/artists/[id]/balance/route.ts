import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import {
  listArtistBalanceEntries,
  computeArtistBalanceTotals,
  createArtistBalanceEntry,
  isBalanceEntryType,
  isValidYmd,
} from "@/lib/artist-balance-store";

export const dynamic = "force-dynamic";

/**
 * Artist balance ledger — OWNER-ONLY, per-artist manual ledger.
 * There is deliberately NO read path for the artist (shalev) — every method here
 * requires the owner. The artist is resolved server-side by the URL id; the client
 * never supplies artist_id.
 *
 *   GET  /api/label/artists/[id]/balance          → { entries, totals }
 *   POST /api/label/artists/[id]/balance          → create one entry
 */

// GET — list all entries for the artist + canonical totals.
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const entries = await listArtistBalanceEntries(id);
    const totals = computeArtistBalanceTotals(entries);
    return NextResponse.json({ ok: true, entries, totals });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/balance GET]", msg);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

// POST — create a single ledger entry (owner-only, artist_id from the URL only).
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });

    // ── validation ──────────────────────────────────────────────────────────
    if (!isBalanceEntryType(body.entryType)) {
      return NextResponse.json({ error: "סוג רשומה לא תקין" }, { status: 400 });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "הסכום חייב להיות מספר חיובי" }, { status: 400 });
    }
    if (!isValidYmd(body.entryDate)) {
      return NextResponse.json({ error: "תאריך לא תקין (YYYY-MM-DD)" }, { status: 400 });
    }
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";

    // artist_id is taken ONLY from the verified URL id — never from the body.
    const entry = await createArtistBalanceEntry({
      artistId: id,
      entryType: body.entryType,
      amount,
      entryDate: body.entryDate,
      description,
      note,
    });
    return NextResponse.json({ ok: true, entry });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/balance POST]", msg);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
