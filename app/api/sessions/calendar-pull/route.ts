/**
 * GET /api/sessions/calendar-pull?secret=CRON_SECRET&all=1
 *      GET /api/sessions/calendar-pull?secret=CRON_SECRET&projectId=xxx
 *
 * Automatic, server-side ONLY. Called by Railway Cron on a schedule.
 *
 * For every session that has a calendar_event_id, reads the linked Google
 * Calendar event and, if it moved, updates the session's date/start_time/
 * end_time IN PLACE (matched by calendar_event_id). It never creates sessions,
 * never changes project_id/status/notes, and never deletes anything — events
 * that can't be found are returned in `missing` only.
 *
 * Protected by ?secret=CRON_SECRET, mirroring /api/push/cron.
 *
 * Returns: { ok, checked, updated, unchanged, missing, errors }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

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
      .select("id, project_id, date, start_time, end_time, calendar_event_id")
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
      return NextResponse.json({ ok: true, checked: 0, updated: 0, unchanged: 0, missing: [], errors: [] });
    }

    // ── Google Calendar availability ─────────────────────────────────────────
    let getEvent: ((id: string) => Promise<import("@/lib/google-calendar").FetchedCalendarEvent | null>) | null = null;
    try {
      const { isConnected, getCalendarEvent } = await import("@/lib/google-calendar");
      if (await isConnected()) getEvent = getCalendarEvent;
    } catch {
      // Google Calendar not configured — skip without erroring
    }

    if (!getEvent) {
      return NextResponse.json({
        ok: true, checked: 0, updated: 0, unchanged: 0, missing: [], errors: [],
        skipped: "calendar_not_connected",
      });
    }

    let updated   = 0;
    let unchanged = 0;
    const missing: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];
    const chunk   = 5; // batch to respect Google API rate limits

    for (let i = 0; i < rows.length; i += chunk) {
      const batch = rows.slice(i, i + chunk);
      await Promise.all(
        batch.map(async (row) => {
          const sessionId = row.id as string;
          const eventId   = row.calendar_event_id as string;
          try {
            const ev = await getEvent!(eventId);

            // Missing / deleted → report only, never delete the session.
            if (!ev || ev.status === "cancelled") {
              missing.push(sessionId);
              return;
            }

            // No usable date (malformed event) → leave untouched.
            if (!ev.date) {
              unchanged++;
              return;
            }

            // Normalize current DB values to HH:MM for comparison.
            const dbDate  = (row.date as string | null) ?? null;
            const dbStart = (row.start_time as string | null)?.slice(0, 5) ?? null;
            const dbEnd   = (row.end_time   as string | null)?.slice(0, 5) ?? null;

            const patch: Record<string, unknown> = {};
            if (ev.date !== dbDate) patch.date = ev.date;

            // Only sync times for timed events — never wipe internal times for
            // an all-day event (ev.startTime === null).
            if (ev.startTime) {
              const newEnd = ev.endTime ?? null;
              if (ev.startTime !== dbStart) patch.start_time = ev.startTime;
              if (newEnd       !== dbEnd)   patch.end_time   = newEnd;
            }

            if (Object.keys(patch).length === 0) {
              unchanged++;
              return;
            }

            // Update in place — matched by id (derived from calendar_event_id).
            // Never touches project_id / status / notes.
            const { error: upErr } = await supabase
              .from("sessions")
              .update(patch)
              .eq("id", sessionId);

            if (upErr) {
              errors.push({ id: sessionId, error: upErr.message });
              return;
            }
            updated++;
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
      errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאת שרת";
    console.error("[sessions/calendar-pull]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
