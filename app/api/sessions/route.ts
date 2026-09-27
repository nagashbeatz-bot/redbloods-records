import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/require-auth";
import { setSessionLimit } from "@/lib/writes/projects";
import { createSession, SessionInputError, REHEARSAL_SESSION_TYPE } from "@/lib/writes/sessions";

// ── GET /api/sessions?projectId=xxx  OR  ?all=1 ──────────────────────────────
export async function GET(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const all       = req.nextUrl.searchParams.get("all");
    const projectId = req.nextUrl.searchParams.get("projectId");
    const showId    = req.nextUrl.searchParams.get("showId");

    // Rehearsals for a specific show — each enriched with its linked
    // transaction's payment_status (read-only; used by the show card).
    if (showId) {
      const { data: rows, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("show_id", showId)
        .eq("session_type", REHEARSAL_SESSION_TYPE)
        .order("date", { ascending: true });
      if (error) throw new Error(error.message);
      const list = rows ?? [];
      const ids  = list.map((r) => (r as { id: string }).id);
      const payBy = new Map<string, { payment_status: string; amount: number }>();
      if (ids.length) {
        const { data: txs } = await supabase
          .from("transactions")
          .select("linked_session_id, payment_status, amount")
          .in("linked_session_id", ids);
        (txs ?? []).forEach((t) => {
          const lid = (t as { linked_session_id?: string }).linked_session_id;
          if (lid) payBy.set(lid, {
            payment_status: (t as { payment_status?: string }).payment_status ?? "",
            amount:         (t as { amount?: number }).amount ?? 0,
          });
        });
      }
      const rehearsals = list.map((r) => {
        const rr = r as { id: string };
        const tx = payBy.get(rr.id);
        return { ...r, payment_status: tx?.payment_status ?? null, has_transaction: !!tx };
      });
      return NextResponse.json({ rehearsals });
    }

    // Return all sessions across all projects (for Insights page)
    if (all === "1") {
      const { data: rows, error: sessErr } = await supabase
        .from("sessions")
        .select("*")
        .order("date", { ascending: false });
      if (sessErr) throw new Error(sessErr.message);

      // Fetch all session limits
      const { data: limitRows } = await supabase
        .from("settings")
        .select("key, value")
        .like("key", "session_limit_%");

      const limits: Record<string, number> = {};
      (limitRows ?? []).forEach((r) => {
        const pid = (r.key as string).replace("session_limit_", "");
        limits[pid] = (r.value as { limit?: number })?.limit ?? 3;
      });

      return NextResponse.json({ sessions: rows ?? [], limits });
    }

    if (!projectId) {
      return NextResponse.json({ error: "projectId חסר" }, { status: 400 });
    }

    // Fetch sessions for one project
    const { data: rows, error: sessErr } = await supabase
      .from("sessions")
      .select("*")
      .eq("project_id", projectId)
      .order("date", { ascending: true });

    if (sessErr) throw new Error(sessErr.message);

    // Fetch session limit from settings table
    const { data: limitRow } = await supabase
      .from("settings")
      .select("value")
      .eq("key", `session_limit_${projectId}`)
      .single();

    const limit: number = (limitRow?.value as { limit?: number })?.limit ?? 3;

    return NextResponse.json({ sessions: rows ?? [], limit });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST /api/sessions — create new session ──────────────────────────────────
// Shared writer (lib/writes/sessions) — the same one Sunny's SCHEDULE_SESSION primitives use.
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json();
    const { projectId, title, date, startTime, endTime, status, sessionType, notes, calendarEventId, addToCalendar, photographer, location, showId, cost, paymentStatus } = body;
    const r = await createSession({ projectId, title, date, startTime, endTime, status, sessionType, notes, calendarEventId, addToCalendar, photographer, location, showId, cost, paymentStatus });
    return NextResponse.json({ session: r.session, calendarError: r.calendarError });
  } catch (err) {
    if (err instanceof SessionInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── PATCH /api/sessions?projectId=xxx&type=limit — update session limit ──────
export async function PATCH(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const type      = req.nextUrl.searchParams.get("type");

    if (type === "limit") {
      if (!projectId) {
        return NextResponse.json({ error: "projectId חסר" }, { status: 400 });
      }
      const { limit } = await req.json();
      await setSessionLimit(projectId, Number(limit)); // shared writer (lib/writes/projects)
      return NextResponse.json({ ok: true, limit: Number(limit) });
    }

    return NextResponse.json({ error: "סוג פעולה לא ידוע" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions PATCH]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
