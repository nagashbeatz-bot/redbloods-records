import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { supabase } from "@/lib/supabase";
import { listShows } from "@/lib/shows-store";

/**
 * GET /api/red-artists/shalev-summary  (owner-only, READ-ONLY)
 *
 * Scoped summary for the Red Artists portal (שליו טסמה). Everything is filtered
 * SERVER-SIDE — the client never receives other artists' shows or the label's
 * finances. Nothing here writes: no transactions, no shows, no Finance sync.
 *
 * Shows: only Shalev's shows with status אושרה / נסגר / בוצע, split into
 *   upcoming (אושרה|נסגר, date ≥ today) and done (בוצע). Money fields
 *   (show_price / dj_fee) are intentionally NOT returned — the portal's shows
 *   tab shows no money.
 *
 * Balance: derived ONLY from the artist-fee expense transactions the shows
 *   Finance-sync already creates — category="שכר אמן", artist="שליו טסמה",
 *   expense_scope="הופעה" (Shalev's cut of a show, = (price−dj)/2). From the
 *   ARTIST's point of view this is income:
 *     • payment_status "שולם" → paid to Shalev (current balance + history)
 *     • payment_status "צפוי" → owed to Shalev (expected)
 *     • payment_status "בוטל" → ignored
 *   Exact artist match (not collaborations) — a multi-artist "שכר אמן" row is
 *   ambiguous to attribute, so it is not counted.
 */

const SHALEV = "שליו טסמה";

// Statuses the artist is allowed to see (confirmed bookings + performed).
const VISIBLE_SHOW_STATUSES = new Set(["אושרה", "נסגר", "בוצע"]);

// A show belongs to Shalev if he is one of its artist tokens (catches solo AND
// collaborations) — same token rule the music tab uses. Requires the FULL name.
function isShalevShow(artist: string): boolean {
  return (artist ?? "")
    .split(/[,،;]/)
    .map((s) => s.trim())
    .includes(SHALEV);
}

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    // ── Shows (money stripped) ──────────────────────────────────────────────
    const allShows = await listShows();
    const today = todayYMD();

    const mine = allShows.filter((s) => isShalevShow(s.artist) && VISIBLE_SHOW_STATUSES.has(s.status));

    // Only non-money display fields leave the server.
    const slim = (s: (typeof mine)[number]) => ({
      id: s.id,
      name: s.name,
      date: s.date,
      startTime: s.start_time,
      location: s.location,
      status: s.status,
    });

    const upcoming = mine
      .filter((s) => (s.status === "אושרה" || s.status === "נסגר") && !!s.date && s.date >= today)
      .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0)) // soonest first
      .map(slim);

    const done = mine
      .filter((s) => s.status === "בוצע")
      .sort((a, b) => ((a.date ?? "") > (b.date ?? "") ? -1 : (a.date ?? "") < (b.date ?? "") ? 1 : 0)) // most recent first
      .map(slim);

    // ── Balance (artist-fee transactions only) ──────────────────────────────
    const { data: txRows } = await supabase
      .from("transactions")
      .select("id, date, description, amount, currency, payment_status")
      .eq("category", "שכר אמן")
      .eq("artist", SHALEV)
      .eq("expense_scope", "הופעה");

    const rows = txRows ?? [];
    const sum = (status: string) =>
      rows
        .filter((t) => t.payment_status === status)
        .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    const paidTotal = sum("שולם");
    const expectedTotal = sum("צפוי");

    const payments = rows
      .filter((t) => t.payment_status === "שולם")
      .sort((a, b) => ((a.date ?? "") > (b.date ?? "") ? -1 : (a.date ?? "") < (b.date ?? "") ? 1 : 0))
      .map((t) => ({
        id: t.id as string,
        date: (t.date as string | null) ?? null,
        description: (t.description as string) ?? "",
        amount: Number(t.amount) || 0,
        currency: (t.currency as string) || "₪",
      }));

    return NextResponse.json({
      ok: true,
      shows: { upcoming, done },
      balance: {
        paidTotal,
        expectedTotal,
        currency: (rows[0]?.currency as string) || "₪",
        payments,
        hasData: rows.length > 0,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
