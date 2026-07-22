import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import {
  updateArtistBalanceEntry,
  deleteArtistBalanceEntry,
  isBalanceEntryType,
  isValidYmd,
} from "@/lib/artist-balance-store";

export const dynamic = "force-dynamic";

/**
 * Single ledger entry — OWNER-ONLY. Both handlers scope the mutation by id AND
 * artist_id (the store enforces `.eq("artist_id", id)`), so an entry can only be
 * edited/deleted through its own artist's endpoint (no cross-artist IDOR).
 *
 *   PATCH  /api/label/artists/[id]/balance/[entryId]  → update
 *   DELETE /api/label/artists/[id]/balance/[entryId]  → delete
 */

// PATCH — update a ledger entry (full field set, matching the edit modal).
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string; entryId: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id, entryId } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });

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

    const updated = await updateArtistBalanceEntry(entryId, id, {
      entryType: body.entryType,
      amount,
      entryDate: body.entryDate,
      description,
      note,
    });
    if (!updated) return NextResponse.json({ error: "הרשומה לא נמצאה" }, { status: 404 });
    return NextResponse.json({ ok: true, entry: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/balance/[entryId] PATCH]", msg);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

// DELETE — remove a ledger entry.
export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string; entryId: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id, entryId } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const ok = await deleteArtistBalanceEntry(entryId, id);
    if (!ok) return NextResponse.json({ error: "הרשומה לא נמצאה" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/balance/[entryId] DELETE]", msg);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
