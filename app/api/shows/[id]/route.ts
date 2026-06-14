import { NextRequest, NextResponse } from "next/server";
import {
  getShow, patchShow, deleteShow,
  showCalendarSummary, showCalendarTimes, showCalendarDescription,
} from "@/lib/shows-store";
import type { PatchShowInput, ShowStatus, PaymentStatus, Show } from "@/lib/shows-store";
import { supabase } from "@/lib/supabase";

/** If show.artist is empty but artist_client_id exists, resolve name from DB. */
async function resolveArtistName(show: Show): Promise<Show> {
  if (show.artist || !show.artist_client_id) return show;
  const { data } = await supabase
    .from("clients")
    .select("name")
    .eq("id", show.artist_client_id)
    .single();
  if (data?.name) return { ...show, artist: data.name };
  return show;
}

type Ctx = { params: Promise<{ id: string }> };

// Fields that, when changed, should sync to Google Calendar
const CALENDAR_SYNC_FIELDS = new Set([
  "name", "artist", "date", "start_time", "location",
  "booker_name", "contact_person", "phone", "show_price", "dj_fee",
]);

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    // ── Build DB patch ──────────────────────────────────────────────────────
    const patch: PatchShowInput = {};

    if (body.name             !== undefined) patch.name             = body.name?.trim()            ?? "";
    if (body.artist           !== undefined) patch.artist           = body.artist?.trim()          ?? "";
    if (body.artist_client_id !== undefined) patch.artist_client_id = body.artist_client_id        ?? null;
    if (body.booker_client_id !== undefined) patch.booker_client_id = body.booker_client_id        ?? null;
    if (body.booker_name      !== undefined) patch.booker_name      = body.booker_name?.trim()     ?? "";
    if (body.date             !== undefined) patch.date             = body.date                    || null;
    if (body.start_time       !== undefined) patch.start_time       = body.start_time              || null;
    if (body.location         !== undefined) patch.location         = body.location?.trim()        ?? "";
    if (body.contact_person   !== undefined) patch.contact_person   = body.contact_person?.trim()  ?? "";
    if (body.phone            !== undefined) patch.phone            = body.phone?.trim()           ?? "";
    if (body.status           !== undefined) patch.status           = body.status      as ShowStatus;
    if (body.payment_status   !== undefined) patch.payment_status   = body.payment_status as PaymentStatus;
    if (body.show_price       !== undefined) patch.show_price       = Number(body.show_price)      || 0;
    if (body.dj_fee           !== undefined) patch.dj_fee           = Number(body.dj_fee);
    if (body.advance_payment  !== undefined) patch.advance_payment  = Number(body.advance_payment) || 0;
    if (body.notes            !== undefined) patch.notes            = body.notes                   ?? "";
    if (body.calendar_event_id !== undefined) patch.calendar_event_id = body.calendar_event_id    ?? null;

    // ── Fetch current show (needed for calendar logic) ──────────────────────
    const existing = await getShow(id);
    if (!existing) return NextResponse.json({ error: "הופעה לא נמצאה" }, { status: 404 });

    // ── Save to DB ──────────────────────────────────────────────────────────
    const show = await patchShow(id, patch);

    // ── Google Calendar ─────────────────────────────────────────────────────
    let calendarWarning: string | undefined;

    // Case R: user requests removal from calendar
    if (body.removeFromCalendar === true && existing.calendar_event_id) {
      try {
        const { isConnected, deleteCalendarEvent, calendarEventExists } = await import("@/lib/google-calendar");
        if (await isConnected()) {
          const stillExists = await calendarEventExists(existing.calendar_event_id);
          if (stillExists) await deleteCalendarEvent(existing.calendar_event_id);
        }
      } catch (calErr) {
        console.error("[shows PATCH] calendar delete error:", calErr);
      }
      const updated = await patchShow(id, { calendar_event_id: null });
      return NextResponse.json({ show: updated });
    }

    // Case A: user explicitly requests "add to calendar"
    if (body.addToCalendar === true && show.date) {
      try {
        const times = showCalendarTimes(show);
        if (times) {
          const { isConnected, createCalendarEvent, calendarEventExists } = await import("@/lib/google-calendar");
          if (await isConnected()) {
            // Check if existing event was deleted from Google
            const existingId = show.calendar_event_id;
            if (existingId && await calendarEventExists(existingId)) {
              // Event still alive — nothing to do
              return NextResponse.json({ show });
            }
            // Resolve artist name (may fetch from clients if show.artist is empty)
            const showForCal = await resolveArtistName(show);
            // If artist was resolved and differs from what's in DB — persist it
            const dbPatch: PatchShowInput = { calendar_event_id: undefined };
            if (showForCal.artist && !show.artist) {
              dbPatch.artist = showForCal.artist;
            }
            // Create fresh event
            const event = await createCalendarEvent(
              showCalendarSummary(showForCal),
              times.startIso,
              times.endIso,
              { description: showCalendarDescription(showForCal) }
            );
            dbPatch.calendar_event_id = event.id;
            const updated = await patchShow(id, dbPatch);
            return NextResponse.json({ show: updated });
          } else {
            calendarWarning = "ההופעה עודכנה, אבל Google Calendar לא מחובר";
          }
        }
      } catch (calErr) {
        calendarWarning = "ההופעה עודכנה, אבל לא נוצר אירוע ביומן Google";
        console.error("[shows PATCH] calendar create error:", calErr);
      }
    }

    // Case B: event already exists — sync if any relevant field changed
    else if (show.calendar_event_id) {
      const calendarFieldChanged = Object.keys(body).some(k => CALENDAR_SYNC_FIELDS.has(k));
      if (calendarFieldChanged) {
        try {
          const times = showCalendarTimes(show);
          const { isConnected, updateCalendarEvent, calendarEventExists } = await import("@/lib/google-calendar");
          if (await isConnected()) {
            // If event was manually deleted, clear the stale ID and skip update
            const stillExists = await calendarEventExists(show.calendar_event_id);
            if (!stillExists) {
              const updated = await patchShow(id, { calendar_event_id: null });
              calendarWarning = "האירוע ביומן Google נמחק ידנית — ניתן להוסיף מחדש";
              return NextResponse.json({ show: updated, calendarWarning });
            }
            const showForCal = await resolveArtistName(show);
            await updateCalendarEvent(show.calendar_event_id, {
              summary:     showCalendarSummary(showForCal),
              location:    show.location || undefined,
              description: showCalendarDescription(showForCal),
              ...(times ? { startIso: times.startIso, endIso: times.endIso } : {}),
            });
          } else {
            calendarWarning = "ההופעה עודכנה, אבל האירוע ביומן Google לא עודכן (לא מחובר)";
          }
        } catch (calErr) {
          calendarWarning = "ההופעה עודכנה, אבל האירוע ביומן Google לא עודכן";
          console.error("[shows PATCH] calendar update error:", calErr);
        }
      }
    }

    return NextResponse.json(calendarWarning ? { show, calendarWarning } : { show });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteShow(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
