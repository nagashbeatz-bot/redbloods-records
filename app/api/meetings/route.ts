import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createMeeting } from "@/lib/writes/meetings";

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
    // Shared writer (lib/writes/meetings) — the same one Sunny's CREATE_MEETING primitive uses.
    const r = await createMeeting({ clientId, clientName, projectId, date, time, duration, location, notes, addToCalendar });
    return NextResponse.json({ ok: true, meeting: r.meeting, calendarError: r.calendarError });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
