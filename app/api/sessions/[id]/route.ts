import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { deleteSession, SessionInputError, updateSession } from "@/lib/writes/sessions";

// ── PATCH /api/sessions/[id] — update a session ──────────────────────────────
// Shared writer (lib/writes/sessions): rehearsal finance + show split re-sync; the EXISTING Google event follows a
// time / title change (never a new event) — since 2026-09-27 also a date / time change sent without absolute times.
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const body = await req.json();
    const { date, startTime, endTime, status, sessionType, notes, photographer, location, startIso, endIso, summary, cost, paymentStatus } = body;
    const r = await updateSession(id, { date, startTime, endTime, status, sessionType, notes, photographer, location, startIso, endIso, summary, cost, paymentStatus });
    return NextResponse.json({ session: r.session });
  } catch (err) {
    if (err instanceof SessionInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions PATCH id]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── DELETE /api/sessions/[id] ─────────────────────────────────────────────────
// Shared writer: the row, then its Google event (best-effort; the outcome is reported so a caller can warn about a
// possibly-orphaned event instead of claiming full success).
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const r = await deleteSession(id);
    return NextResponse.json({ ok: true, calendarDeleted: r.calendarDeleted, calendarError: r.calendarError, cancelledExpenses: r.cancelledExpenses });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions DELETE id]", msg);
    // A6: a paid session expense refuses the delete (409 — nothing was changed)
    return NextResponse.json({ error: msg }, { status: err instanceof Error && err.name === "SessionHasPaidExpenseError" ? 409 : 500 });
  }
}
