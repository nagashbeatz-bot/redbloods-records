import { NextRequest, NextResponse } from "next/server";
import { resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { supabase } from "@/lib/supabase";
import { listShows } from "@/lib/shows-store";
import { availabilityWeekStart, weekEndFor, ilTodayYMD } from "@/lib/red-artists/week";

/**
 * GET /api/label/artists/[id]/summary  (owner-only, READ-ONLY)
 *
 * Owner-preview equivalent of /api/red-artists/shalev-summary, generalized to
 * ANY registered portal artist (resolved via resolvePortalReadAccess — the
 * artist's own name, never a hardcoded literal). Same shape, same rules:
 *
 * Shows: only this artist's shows with status אושרה / נסגר / בוצע, split into
 *   upcoming (אושרה|נסגר, date ≥ today) and done (בוצע). Money fields are
 *   intentionally NOT returned.
 *
 * Balance: derived ONLY from the artist-fee expense transactions the shows
 *   Finance-sync already creates — category="שכר אמן", artist=<this artist's
 *   exact name>, expense_scope="הופעה". Exact artist match (not collaborations)
 *   — a multi-artist "שכר אמן" row is ambiguous to attribute, so it is not
 *   counted. Always shown here (this route is owner-only).
 *
 * Weekly: this artist's real schedule for the UPCOMING Sunday–Saturday week —
 *   sessions from `sessions` belonging to their projects (project.artist token
 *   match; project-linked only) merged with their upcoming shows in the same
 *   window. NO money.
 *
 * Updates: derived ONLY from those real events. No project_actions, no
 *   agent_alerts, no file/status changes.
 */

// A row belongs to this artist if they are one of its artist tokens (solo OR collab).
function isThisArtist(artist: string, name: string): boolean {
  return (artist ?? "").split(/[,،;]/).map((s) => s.trim()).includes(name);
}

// Statuses the artist is allowed to see (confirmed bookings + performed).
const VISIBLE_SHOW_STATUSES = new Set(["אושרה", "נסגר", "בוצע"]);

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;
  const artistName = access.config.name;

  try {
    // Israel-timezone date math (lib/red-artists/week.ts) — see
    // shalev-summary/route.ts for why a raw `new Date()` local-getter calc
    // would drift on the server (Railway runs UTC). "weekly" shows the SAME
    // upcoming Sunday–Saturday week as the portal's availability grid (never
    // a rolling window, never the current week).
    const today = ilTodayYMD();
    const weekStart = availabilityWeekStart();
    const weekEnd   = weekEndFor(weekStart);

    // ── Shows (money stripped) ──────────────────────────────────────────────
    const allShows = await listShows();
    const mine = allShows.filter((s) => isThisArtist(s.artist, artistName) && VISIBLE_SHOW_STATUSES.has(s.status));

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
      .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0))
      .map(slim);

    const done = mine
      .filter((s) => s.status === "בוצע")
      .sort((a, b) => ((a.date ?? "") > (b.date ?? "") ? -1 : (a.date ?? "") < (b.date ?? "") ? 1 : 0))
      .map(slim);

    // ── Balance (artist-fee transactions only) — always shown (owner-only route) ──
    const { data: txRows } = await supabase
      .from("transactions")
      .select("id, date, description, amount, currency, payment_status")
      .eq("category", "שכר אמן")
      .eq("artist", artistName)
      .eq("expense_scope", "הופעה");

    const rows = txRows ?? [];
    const sum = (status: string) =>
      rows.filter((t) => t.payment_status === status).reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

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

    const balance = {
      paidTotal: sum("שולם"),
      expectedTotal: sum("צפוי"),
      currency: (rows[0]?.currency as string) || "₪",
      payments,
      hasData: rows.length > 0,
    };

    // ── Weekly schedule + updates ────────────────────────────────────────────
    const { data: projRows } = await supabase.from("projects").select("id, name, artist, is_hidden");
    const artistProjects = (projRows ?? []).filter((p) => !p.is_hidden && isThisArtist(p.artist as string, artistName));
    const projName = new Map(artistProjects.map((p) => [p.id as string, p.name as string]));
    const artistProjectIds = artistProjects.map((p) => p.id as string);

    type SessionRow = {
      id: string; project_id: string | null; title: string | null; date: string | null;
      start_time: string | null; end_time: string | null; session_type: string | null;
      location: string | null; status: string | null;
    };
    let sessions: SessionRow[] = [];
    if (artistProjectIds.length > 0) {
      const { data: sessRows } = await supabase
        .from("sessions")
        .select("id, project_id, title, date, start_time, end_time, session_type, location, status")
        .in("project_id", artistProjectIds)
        .gte("date", weekStart)
        .order("date", { ascending: true });
      sessions = ((sessRows ?? []) as SessionRow[]).filter((s) => s.status !== "בוטל");
    }

    const sessTitle = (s: SessionRow) => s.title || (s.project_id ? projName.get(s.project_id) : null) || (s.session_type || "סשן");
    const byDateTime = (a: { date: string | null; startTime?: string | null }, b: { date: string | null; startTime?: string | null }) => {
      const d = (a.date ?? "").localeCompare(b.date ?? "");
      return d !== 0 ? d : (a.startTime ?? "").localeCompare(b.startTime ?? "");
    };

    const weekly = [
      ...sessions
        .filter((s) => !!s.date && s.date <= weekEnd)
        .map((s) => ({
          id: s.id,
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

    const updates = [
      ...upcoming.map((sh) => ({
        type: "הופעה",
        title: "הופעה אושרה",
        description: [sh.name, sh.location].filter(Boolean).join(" · "),
        date: sh.date,
        startTime: sh.startTime ?? null,
        endTime: null as string | null,
      })),
      ...sessions.map((s) => {
        const t = s.session_type || "סשן";
        const title = t === "צילום קליפ" ? "נקבע צילום קליפ" : t === "פגישה" ? "נקבעה פגישה" : "נקבע סשן";
        return { type: t, title, description: "", date: s.date, startTime: s.start_time ?? null, endTime: s.end_time ?? null };
      }),
    ]
      .filter((u) => !!u.date)
      .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0))
      .slice(0, 12);

    // Money is OWNER-ONLY. A restricted artist reading their own summary (role
    // "avi") never receives balance/payment figures — stripped server-side, not
    // just hidden in the UI. (The מאזן tab + home balance card are already
    // owner-gated client-side; this closes the direct-API read.)
    const safeBalance = access.role === "avi"
      ? { paidTotal: 0, expectedTotal: 0, currency: balance.currency, payments: [], hasData: false }
      : balance;

    // nextSession = the soonest still-upcoming session (date >= today), across
    // ALL future dates — NOT limited to the availability week that `weekly`
    // covers. Same project scoping / non-cancelled / non-show filter as `weekly`,
    // separate query. Drives the "הסשן הקרוב" home card.
    let nextSession: {
      id: string; type: string; title: string; date: string | null;
      startTime: string | null; endTime: string | null; location: string | null;
    } | null = null;
    if (artistProjectIds.length > 0) {
      const { data: upcomingSess } = await supabase
        .from("sessions")
        .select("id, project_id, title, date, start_time, end_time, session_type, location, status")
        .in("project_id", artistProjectIds)
        .gte("date", today)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
      const first = ((upcomingSess ?? []) as SessionRow[])
        .find((s) => s.status !== "בוטל" && (s.session_type ?? "") !== "הופעה" && !!s.date);
      if (first) {
        nextSession = {
          id: first.id,
          type: first.session_type || "סשן",
          title: sessTitle(first),
          date: first.date,
          startTime: first.start_time ?? null,
          endTime: first.end_time ?? null,
          location: first.location || null,
        };
      }
    }

    return NextResponse.json({ ok: true, shows: { upcoming, done }, balance: safeBalance, weekly, nextSession, updates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
