import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/meetings?clientId=xxx
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .eq("client_id", clientId)
    .order("date", { ascending: true })
    .order("time", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ meetings: data ?? [] });
}

// POST /api/meetings
// Body: { clientId, clientName, projectId?, date, time, duration, location, notes, addToCalendar }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { clientId, clientName, projectId, date, time, duration, location, notes, addToCalendar } = body;

    if (!clientId || !clientName) {
      return NextResponse.json({ error: "clientId and clientName required" }, { status: 400 });
    }

    const { data, error } = await supabase.from("meetings").insert({
      client_id:   clientId,
      client_name: clientName,
      project_id:  projectId || null,
      date:        date || null,
      time:        time || null,
      duration:    duration ?? 60,
      location:    location || "",
      notes:       notes || "",
      status:      "נקבעה",
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Optionally create Google Calendar event
    let calendarEventId: string | null = null;
    let calendarError: string | null = null;
    if (addToCalendar && date && time) {
      try {
        const { isConnected, createCalendarEvent } = await import("@/lib/google-calendar");
        if (await isConnected()) {
          const start = `${date}T${time}:00`;
          const durationMin = duration ?? 60;
          // Compute end time as Israel local time — avoid UTC conversion entirely.
          // Both start and end are sent with timeZone:"Asia/Jerusalem" so they
          // must be expressed in Israel local time, not UTC.
          const [hh, mm] = time.split(":").map(Number);
          const endTotalMin = hh * 60 + mm + durationMin;
          const endHh = String(Math.floor(endTotalMin / 60) % 24).padStart(2, "0");
          const endMm = String(endTotalMin % 60).padStart(2, "0");
          const endDateStr = endTotalMin >= 1440
            ? new Date(new Date(date + "T00:00:00Z").getTime() + 86_400_000).toISOString().split("T")[0]
            : date;
          const end = `${endDateStr}T${endHh}:${endMm}:00`;
          const summary = `פגישה עם ${clientName}${location ? ` — ${location}` : ""}`;
          const event = await createCalendarEvent(summary, start, end, notes ? { description: notes } : undefined);
          calendarEventId = (event as { id?: string }).id ?? null;
          if (calendarEventId) {
            await supabase.from("meetings").update({ calendar_event_id: calendarEventId }).eq("id", data.id);
          }
        } else {
          calendarError = "Google Calendar לא מחובר";
        }
      } catch (err) {
        calendarError = err instanceof Error ? err.message : "שגיאה ביצירת אירוע ביומן";
      }
    }

    return NextResponse.json({
      ok: true,
      meeting: { ...data, calendar_event_id: calendarEventId },
      calendarError,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
