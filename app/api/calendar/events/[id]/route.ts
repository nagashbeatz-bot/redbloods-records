import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { deleteCalendarEvent, updateCalendarEvent } from "@/lib/google-calendar";

// DELETE /api/calendar/events/[id]?calendarId=...
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }   = await params;
    const calId    = request.nextUrl.searchParams.get("calendarId") ?? undefined;
    await deleteCalendarEvent(id, calId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/calendar/events/[id]
// Body: { calendarId?, summary?, startIso?, endIso?, location? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }                           = await params;
    const { calendarId, ...updates }       = await request.json();
    const result = await updateCalendarEvent(id, updates, calendarId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
