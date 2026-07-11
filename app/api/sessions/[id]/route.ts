import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { touchProject } from "@/lib/projects-store";
import { requireOwner } from "@/lib/require-auth";

const REHEARSAL_SESSION_TYPE = "חזרה להופעה";

// ── PATCH /api/sessions/[id] — update a session ──────────────────────────────
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const body = await req.json();
    const { date, startTime, endTime, status, sessionType, notes, photographer, location, startIso, endIso, summary, cost, paymentStatus } = body;

    const patch: Record<string, unknown> = {};
    if (date         !== undefined) patch.date         = date        || null;
    if (startTime    !== undefined) patch.start_time   = startTime   || null;
    if (endTime      !== undefined) patch.end_time     = endTime     || null;
    if (status       !== undefined) patch.status       = status;
    if (sessionType  !== undefined) patch.session_type = sessionType;
    if (notes        !== undefined) patch.notes        = notes;
    if (photographer !== undefined) patch.photographer = photographer;
    if (location     !== undefined) patch.location     = location;
    if (cost         !== undefined) {
      const costNum = (cost === "" || cost == null) ? null : Number(cost);
      if (costNum != null && (!Number.isFinite(costNum) || costNum < 0)) {
        return NextResponse.json({ error: "עלות לא תקינה" }, { status: 400 });
      }
      patch.cost = costNum;
    }

    const { data, error } = await supabase
      .from("sessions")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Rehearsal → keep its canonical expense + the show's split (Fin-2) in sync.
    // payment_status is passed only when the client explicitly sent it, so an
    // edit that doesn't touch payment preserves the transaction's status.
    const rehShowId = (data as { show_id?: string | null }).show_id;
    if ((data as { session_type?: string }).session_type === REHEARSAL_SESSION_TYPE && rehShowId) {
      try {
        const { getShow } = await import("@/lib/shows-store");
        const show = await getShow(rehShowId);
        if (show) {
          const { syncRehearsalFinance, syncShowFinance } = await import("@/lib/shows-finance-sync");
          const pay = paymentStatus === undefined ? undefined : (paymentStatus === "שולם" ? "שולם" : "לא שולם");
          await syncRehearsalFinance(
            { id, date: (data as { date: string | null }).date, cost: (data as { cost: number | null }).cost },
            show, pay,
          );
          await syncShowFinance(show);
        }
      } catch (e) {
        console.error("[sessions PATCH id] rehearsal finance sync error:", e);
      }
    }

    // ── Google Calendar: update the EXISTING event (never create a new one) ──
    // Only when the session already has a calendar_event_id and the client sent
    // absolute start/end ISO times (computed in the browser's Israel tz).
    const calEventId = (data as { calendar_event_id?: string | null }).calendar_event_id;
    // Update the existing event when we have a time change (startIso/endIso)
    // and/or a recomputed title (summary). System → Calendar only; never pulls.
    if (calEventId && (startIso || endIso || (typeof summary === "string" && summary.trim()))) {
      try {
        const { isConnected, updateCalendarEvent, calendarEventExists } = await import("@/lib/google-calendar");
        if (await isConnected() && await calendarEventExists(calEventId)) {
          const upd: { startIso?: string; endIso?: string; summary?: string; keepSummaryIfAttendees?: boolean } = {};
          if (startIso) upd.startIso = startIso;
          if (endIso)   upd.endIso   = endIso;
          if (typeof summary === "string" && summary.trim()) {
            upd.summary = summary.trim();
            // Don't overwrite a public/invited event's title — keep it if the
            // event has attendees (it was created with an artist invite).
            upd.keepSummaryIfAttendees = true;
          }
          await updateCalendarEvent(calEventId, upd);
        }
      } catch (calErr) {
        console.error("[sessions PATCH id] calendar update error:", calErr);
      }
    }

    // Bump project's updated_at
    const projectId = (data as { project_id?: string }).project_id;
    if (projectId) touchProject(projectId).catch(() => {});

    return NextResponse.json({ session: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions PATCH id]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── DELETE /api/sessions/[id] ─────────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;

    // Fetch session first to get calendar_event_id + project_id
    const { data: session } = await supabase
      .from("sessions")
      .select("calendar_event_id, project_id")
      .eq("id", id)
      .single();

    // Delete from Supabase
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) throw new Error(error.message);

    // Also delete from Google Calendar (best-effort)
    const calEventId = session?.calendar_event_id as string | null;
    if (calEventId) {
      try {
        const { deleteCalendarEvent, isConnected } = await import("@/lib/google-calendar");
        if (await isConnected()) {
          await deleteCalendarEvent(calEventId);
        }
      } catch {
        // Calendar deletion is non-fatal
      }
    }

    // Bump project's updated_at
    const delProjectId = (session as { project_id?: string } | null)?.project_id;
    if (delProjectId) touchProject(delProjectId).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions DELETE id]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
