import { NextRequest, NextResponse } from "next/server";
import { listShows, createShow, showCalendarSummary, showCalendarTimes, showCalendarDescription } from "@/lib/shows-store";
import type { Show } from "@/lib/shows-store";
import { supabase } from "@/lib/supabase";

async function resolveArtistName(show: Show): Promise<Show> {
  if (show.artist || !show.artist_client_id) return show;
  const { data } = await supabase.from("clients").select("name").eq("id", show.artist_client_id).single();
  if (data?.name) return { ...show, artist: data.name };
  return show;
}

export async function GET() {
  try {
    const shows = await listShows();
    return NextResponse.json({ shows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "שם ההופעה חובה" }, { status: 400 });
    }

    // Create show without calendar_event_id first
    const show = await createShow({
      name:             body.name.trim(),
      artist:           body.artist?.trim()            ?? "",
      artist_client_id: body.artist_client_id          ?? null,
      booker_client_id: body.booker_client_id          ?? null,
      booker_name:      body.booker_name?.trim()       ?? "",
      date:             body.date                      ?? null,
      start_time:       body.start_time                ?? null,
      location:         body.location?.trim()          ?? "",
      contact_person:   body.contact_person?.trim()    ?? "",
      phone:            body.phone?.trim()             ?? "",
      status:           body.status                    ?? "ליד חדש",
      payment_status:   body.payment_status            ?? "לא שולם",
      show_price:       Number(body.show_price)        || 0,
      dj_fee:           body.dj_fee !== undefined ? Number(body.dj_fee) : 500,
      advance_payment:  Number(body.advance_payment)   || 0,
      notes:            body.notes?.trim()             ?? "",
    });

    // Google Calendar — only if explicitly requested and date exists
    let calendarWarning: string | undefined;
    if (body.addToCalendar === true && show.date) {
      try {
        const times = showCalendarTimes(show);
        if (times) {
          const { isConnected, createCalendarEvent } = await import("@/lib/google-calendar");
          if (await isConnected()) {
            const { patchShow } = await import("@/lib/shows-store");
            const showForCal = await resolveArtistName(show);
            const event = await createCalendarEvent(
              showCalendarSummary(showForCal),
              times.startIso,
              times.endIso,
              { description: showCalendarDescription(showForCal) }
            );
            // Save event ID back to show
            const updated = await patchShow(show.id, { calendar_event_id: event.id });
            return NextResponse.json({ show: updated }, { status: 201 });
          } else {
            calendarWarning = "ההופעה נשמרה, אבל Google Calendar לא מחובר";
          }
        }
      } catch (calErr) {
        calendarWarning = "ההופעה נשמרה, אבל לא נוצר אירוע ביומן Google";
        console.error("[shows POST] calendar error:", calErr);
      }
    }

    return NextResponse.json(
      calendarWarning ? { show, calendarWarning } : { show },
      { status: 201 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
