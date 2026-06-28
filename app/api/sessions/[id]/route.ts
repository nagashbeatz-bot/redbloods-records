import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { touchProject } from "@/lib/projects-store";

// ── PATCH /api/sessions/[id] — update a session ──────────────────────────────
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const { date, startTime, endTime, status, sessionType, notes, photographer, location, startIso, endIso, summary } = body;

    const patch: Record<string, unknown> = {};
    if (date         !== undefined) patch.date         = date        || null;
    if (startTime    !== undefined) patch.start_time   = startTime   || null;
    if (endTime      !== undefined) patch.end_time     = endTime     || null;
    if (status       !== undefined) patch.status       = status;
    if (sessionType  !== undefined) patch.session_type = sessionType;
    if (notes        !== undefined) patch.notes        = notes;
    if (photographer !== undefined) patch.photographer = photographer;
    if (location     !== undefined) patch.location     = location;

    const { data, error } = await supabase
      .from("sessions")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);

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
