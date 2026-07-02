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
 *
 * Weekly: Shalev's real schedule for the next 7 days — sessions from the
 *   `sessions` table that belong to HIS projects (project.artist token match;
 *   project-linked only — independent title-only sessions are NOT attributed)
 *   merged with his upcoming shows in the same window. NO money.
 *
 * Updates: derived ONLY from those real events (approved/booked shows +
 *   scheduled sessions / clip shoots). No project_actions, no agent_alerts, no
 *   file/status changes — those have no clean artist-facing source yet.
 */

const SHALEV = "שליו טסמה";

// A row belongs to Shalev if he is one of its artist tokens (solo OR collab).
function isShalevArtist(artist: string): boolean {
  return (artist ?? "").split(/[,،;]/).map((s) => s.trim()).includes(SHALEV);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

// Statuses the artist is allowed to see (confirmed bookings + performed).
const VISIBLE_SHOW_STATUSES = new Set(["אושרה", "נסגר", "בוצע"]);

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const today   = ymd(now);
    const weekEnd = ymd(addDays(now, 6)); // next 7 days inclusive

    // ── Shows (money stripped) ──────────────────────────────────────────────
    const allShows = await listShows();

    const mine = allShows.filter((s) => isShalevArtist(s.artist) && VISIBLE_SHOW_STATUSES.has(s.status));

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

    // ── Weekly schedule + updates ────────────────────────────────────────────
    // Shalev's sessions come from HIS projects only (server-side scoped): resolve
    // his project ids first, then query sessions by those ids — the client never
    // sees other artists' sessions, and independent (project_id=null) sessions are
    // never attributed. No money on either list.
    const { data: projRows } = await supabase.from("projects").select("id, name, artist, is_hidden");
    const shalevProjects = (projRows ?? []).filter((p) => !p.is_hidden && isShalevArtist(p.artist as string));
    const projName = new Map(shalevProjects.map((p) => [p.id as string, p.name as string]));
    const shalevIds = shalevProjects.map((p) => p.id as string);

    type SessionRow = {
      id: string; project_id: string | null; title: string | null; date: string | null;
      start_time: string | null; end_time: string | null; session_type: string | null;
      location: string | null; status: string | null;
    };
    let sessions: SessionRow[] = [];
    if (shalevIds.length > 0) {
      const { data: sessRows } = await supabase
        .from("sessions")
        .select("id, project_id, title, date, start_time, end_time, session_type, location, status")
        .in("project_id", shalevIds)
        .gte("date", today)
        .order("date", { ascending: true });
      sessions = ((sessRows ?? []) as SessionRow[]).filter((s) => s.status !== "בוטל");
    }

    const sessTitle = (s: SessionRow) => s.title || (s.project_id ? projName.get(s.project_id) : null) || (s.session_type || "סשן");
    const byDateTime = (a: { date: string | null; startTime?: string | null }, b: { date: string | null; startTime?: string | null }) => {
      const d = (a.date ?? "").localeCompare(b.date ?? "");
      return d !== 0 ? d : (a.startTime ?? "").localeCompare(b.startTime ?? "");
    };

    // weekly = Shalev's sessions in the next 7 days + his upcoming shows in that window.
    const weekly = [
      ...sessions
        .filter((s) => !!s.date && s.date <= weekEnd)
        .map((s) => ({
          type: s.session_type || "סשן",
          title: sessTitle(s),
          date: s.date,
          startTime: s.start_time ?? null,
          endTime: s.end_time ?? null,
          location: s.location || null,
        })),
      ...upcoming
        .filter((sh) => !!sh.date && sh.date! <= weekEnd)
        .map((sh) => ({
          type: "הופעה",
          title: sh.name,
          date: sh.date,
          startTime: sh.startTime ?? null,
          endTime: null as string | null,
          location: sh.location || null,
        })),
    ].sort(byDateTime);

    // updates = derived only from real approved/booked shows + scheduled sessions.
    const updates = [
      ...upcoming.map((sh) => ({
        type: "הופעה",
        title: "הופעה אושרה",
        description: [sh.name, sh.location].filter(Boolean).join(" · "),
        date: sh.date,
      })),
      ...sessions.map((s) => {
        const t = s.session_type || "סשן";
        const title = t === "צילום קליפ" ? "נקבע צילום קליפ" : t === "פגישה" ? "נקבעה פגישה" : "נקבע לך סשן";
        return { type: t, title, description: [sessTitle(s), s.location].filter(Boolean).join(" · "), date: s.date };
      }),
    ]
      .filter((u) => !!u.date)
      .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0))
      .slice(0, 12);

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
      weekly,
      updates,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
