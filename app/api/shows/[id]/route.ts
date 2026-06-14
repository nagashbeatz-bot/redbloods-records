import { NextRequest, NextResponse } from "next/server";
import {
  getShow, patchShow, deleteShow,
  showCalendarSummary, showCalendarTimes, showCalendarDescription,
} from "@/lib/shows-store";
import type { PatchShowInput, ShowStatus, PaymentStatus } from "@/lib/shows-store";

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

    // Case A: user explicitly requests "add to calendar" (no event yet)
    if (body.addToCalendar === true && !show.calendar_event_id && show.date) {
      try {
        const times = showCalendarTimes(show);
        if (times) {
          const { isConnected, createCalendarEvent } = await import("@/lib/google-calendar");
          if (await isConnected()) {
            const event = await createCalendarEvent(
              showCalendarSummary(show),
              times.startIso,
              times.endIso,
              { description: showCalendarDescription(show) }
            );
            const updated = await patchShow(id, { calendar_event_id: event.id });
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
          const { isConnected, updateCalendarEvent } = await import("@/lib/google-calendar");
          if (await isConnected()) {
            await updateCalendarEvent(show.calendar_event_id, {
              summary:     showCalendarSummary(show),
              location:    show.location || undefined,
              description: showCalendarDescription(show),
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
