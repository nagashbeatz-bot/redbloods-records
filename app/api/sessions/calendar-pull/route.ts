/**
 * GET /api/sessions/calendar-pull?secret=CRON_SECRET&all=1
 *      GET /api/sessions/calendar-pull?secret=CRON_SECRET&projectId=xxx
 *
 * Automatic, server-side ONLY. Called by Railway Cron on a schedule.
 *
 * For every session that has a calendar_event_id, reads the linked Google
 * Calendar event and, if it moved, updates the session's date/start_time/
 * end_time IN PLACE (matched by calendar_event_id). It never creates sessions,
 * never changes project_id/notes, and never deletes anything — events that
 * can't be found are returned in `missing` only. A Google API error is NOT a
 * missing event: it is reported in `calendarErrors` (error ≠ missing).
 *
 * Writes go through the shared writer `updateSession(id, patch, { origin: "CALENDAR_PULL" })`
 * (no calendar echo write, no project touch; a show rehearsal's finance still re-syncs when its date moves).
 *
 * Status: NEVER changed here (A3, Owner canon "time passed ≠ session happened").
 * A session recorded התקיים whose event now ends in the future is reported in
 * `statusConflicts` for the Owner — it is never reverted to מתוכנן. Show
 * rehearsals' status is never touched.
 *
 * Protected by ?secret=CRON_SECRET, mirroring /api/push/cron.
 *
 * Returns: { ok, checked, updated, unchanged, missing, calendarErrors, errors, updatedItems, statusConflicts }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateSession, type SessionPatch } from "@/lib/writes/sessions";
import { sessionEndLocal, israelNowString } from "@/lib/session-duration";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const EMPTY = { checked: 0, updated: 0, unchanged: 0, missing: [], calendarErrors: [], errors: [], updatedItems: [], statusConflicts: [] };

export async function GET(req: NextRequest) {
  // ── Auth: same secret mechanism as /api/push/cron ──────────────────────────
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const all       = req.nextUrl.searchParams.get("all");
  const projectId = req.nextUrl.searchParams.get("projectId");

  try {
    // ── Fetch sessions linked to a calendar event ────────────────────────────
    let query = supabase
      .from("sessions")
      .select("id, project_id, date, start_time, end_time, status, session_type, show_id, calendar_event_id")
      .not("calendar_event_id", "is", null);

    if (all !== "1") {
      if (!projectId) {
        return NextResponse.json(
          { error: "projectId חסר (or pass all=1)" },
          { status: 400 }
        );
      }
      query = query.eq("project_id", projectId);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: true, ...EMPTY });
    }

    // ── Google Calendar availability ─────────────────────────────────────────
    let getEvent: ((id: string) => Promise<import("@/lib/google-calendar").CalendarEventReadResult>) | null = null;
    try {
      const { isConnected, getCalendarEventResult } = await import("@/lib/google-calendar");
      if (await isConnected()) getEvent = getCalendarEventResult;
    } catch {
      // Google Calendar not configured — skip without erroring
    }

    if (!getEvent) {
      return NextResponse.json({ ok: true, ...EMPTY, skipped: "calendar_not_connected" });
    }

    // Current time in Israel ("YYYY-MM-DDTHH:MM:SS") — only to REPORT a status conflict, never to write a status.
    const nowIL = israelNowString();

    let updated   = 0;
    let unchanged = 0;
    const missing: string[] = [];
    const calendarErrors: Array<{ id: string; error: string }> = [];
    const errors: Array<{ id: string; error: string }> = [];
    const updatedItems: Array<{
      sessionId: string;
      changedFields: string[];
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }> = [];
    const statusConflicts: Array<{ sessionId: string; status: string; eventEnd: string; note: string }> = [];
    const chunk   = 5; // batch to respect Google API rate limits

    for (let i = 0; i < rows.length; i += chunk) {
      const batch = rows.slice(i, i + chunk);
      await Promise.all(
        batch.map(async (row) => {
          const sessionId = row.id as string;
          const eventId   = row.calendar_event_id as string;
          try {
            const r = await getEvent!(eventId);

            // Google could not be read → an ERROR, never "missing".
            if (r.kind === "ERROR") {
              calendarErrors.push({ id: sessionId, error: r.error });
              return;
            }
            // Missing / deleted → report only, never delete the session.
            if (r.kind === "MISSING") {
              missing.push(sessionId);
              return;
            }
            const ev = r.event;

            // No usable date (malformed event) → leave untouched.
            if (!ev.date) {
              unchanged++;
              return;
            }

            // Normalize current DB values to HH:MM for comparison.
            const dbDate  = (row.date as string | null) ?? null;
            const dbStart = (row.start_time as string | null)?.slice(0, 5) ?? null;
            const dbEnd   = (row.end_time   as string | null)?.slice(0, 5) ?? null;

            const patch: SessionPatch = {};
            if (ev.date !== dbDate) patch.date = ev.date;

            // Only sync times for timed events — never wipe internal times for
            // an all-day event (ev.startTime === null).
            if (ev.startTime) {
              const newEnd = ev.endTime ?? null;
              if (ev.startTime !== dbStart) patch.startTime = ev.startTime;
              if (newEnd       !== dbEnd)   patch.endTime   = newEnd;
            }

            // A session recorded as held whose event now ends in the future: REPORT only (the Owner decides).
            // Show rehearsals are never touched or reported here (their status carries money meaning — D6).
            const dbStatus = (row.status as string | null) ?? null;
            const isRehearsal = row.session_type === "חזרה להופעה" || !!row.show_id;
            const eventEnd = ev.startTime ? sessionEndLocal(ev.date, ev.startTime, ev.endTime) : `${ev.date}T23:59:59`;
            if (!isRehearsal && dbStatus === "התקיים" && eventEnd && eventEnd >= nowIL) {
              statusConflicts.push({ sessionId, status: dbStatus, eventEnd, note: "recorded התקיים but the calendar event ends in the future — status NOT changed; the Owner confirms" });
            }

            if (Object.keys(patch).length === 0) {
              unchanged++;
              return;
            }

            // Snapshot the before / after values of exactly the fields being changed.
            const before: Record<string, unknown> = {};
            const after: Record<string, unknown> = {};
            if ("date"      in patch) { before.date       = dbDate;  after.date       = patch.date; }
            if ("startTime" in patch) { before.start_time = dbStart; after.start_time = patch.startTime; }
            if ("endTime"   in patch) { before.end_time   = dbEnd;   after.end_time   = patch.endTime; }
            const changedFields = Object.keys(after);

            // Update in place through the shared writer — matched by id (derived from calendar_event_id).
            // Never touches project_id / notes / status; no calendar echo write.
            try {
              await updateSession(sessionId, patch, { origin: "CALENDAR_PULL" });
            } catch (upErr) {
              errors.push({ id: sessionId, error: upErr instanceof Error ? upErr.message : "update failed" });
              return;
            }
            updated++;
            updatedItems.push({ sessionId, changedFields, before, after });
            console.log(
              `[calendar-pull] updated ${sessionId} [${changedFields.join(", ")}] ` +
              `${JSON.stringify(before)} -> ${JSON.stringify(after)}`
            );
          } catch (e) {
            errors.push({ id: sessionId, error: e instanceof Error ? e.message : "unknown" });
          }
        })
      );
    }

    return NextResponse.json({
      ok: true,
      checked: rows.length,
      updated,
      unchanged,
      missing,
      calendarErrors,
      errors,
      updatedItems,
      statusConflicts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאת שרת";
    console.error("[sessions/calendar-pull]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
