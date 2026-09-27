/**
 * Shared meeting writers — used by BOTH the meeting routes and Sunny's typed primitives.
 * createMeeting is the route's exact behaviour. HARDENED (2026-09-27, Universal Actions): an edit of date / time /
 * duration / location now moves the linked Google event, and a delete removes it — so a meeting and its calendar event
 * can no longer silently diverge (previously the event was left behind). Calendar failures never block the meeting write
 * and are reported (calendarSynced: false).
 */
import { supabase } from "@/lib/supabase";

export interface MeetingInput { clientId: string; clientName: string; projectId?: string | null; date?: string | null; time?: string | null; duration?: number | null; location?: string | null; notes?: string | null; addToCalendar?: boolean }

const endOf = (date: string, time: string, durationMin: number) => {
  const [hh, mm] = time.split(":").map(Number);
  const endTotalMin = hh * 60 + mm + durationMin;
  const endHh = String(Math.floor(endTotalMin / 60) % 24).padStart(2, "0");
  const endMm = String(endTotalMin % 60).padStart(2, "0");
  const endDateStr = endTotalMin >= 1440 ? new Date(new Date(date + "T00:00:00Z").getTime() + 86_400_000).toISOString().split("T")[0] : date;
  return `${endDateStr}T${endHh}:${endMm}:00`;
};
const summaryOf = (clientName: string, location?: string | null) => `פגישה עם ${clientName}${location ? ` — ${location}` : ""}`;

export async function createMeeting(b: MeetingInput): Promise<{ meeting: Record<string, unknown>; calendarError: string | null }> {
  const { clientId, clientName, projectId, date, time, duration, location, notes, addToCalendar } = b;
  const { data, error } = await supabase.from("meetings").insert({
    client_id: clientId, client_name: clientName, project_id: projectId || null, date: date || null, time: time || null,
    duration: duration ?? 60, location: location || "", notes: notes || "", status: "נקבעה",
  }).select().single();
  if (error) throw new Error(error.message);
  let calendarEventId: string | null = null;
  let calendarError: string | null = null;
  if (addToCalendar && date && time) {
    try {
      const { isConnected, createCalendarEvent } = await import("@/lib/google-calendar");
      if (await isConnected()) {
        const event = await createCalendarEvent(summaryOf(clientName, location), `${date}T${time}:00`, endOf(date, time, duration ?? 60), notes ? { description: notes } : undefined);
        calendarEventId = (event as { id?: string }).id ?? null;
        if (calendarEventId) await supabase.from("meetings").update({ calendar_event_id: calendarEventId }).eq("id", data.id);
      } else calendarError = "Google Calendar לא מחובר";
    } catch (err) { calendarError = err instanceof Error ? err.message : "שגיאה ביצירת אירוע ביומן"; }
  }
  return { meeting: { ...data, calendar_event_id: calendarEventId }, calendarError };
}

export const MEETING_EDITABLE = ["date", "time", "duration", "location", "notes", "status", "project_id"] as const;

/** Edit a meeting; when it has a Google event and the when / where changed, the event follows (hardened). */
export async function updateMeeting(id: string, body: Record<string, unknown>): Promise<{ meeting: Record<string, unknown>; calendarSynced: boolean | null }> {
  const updates: Record<string, unknown> = {};
  for (const k of MEETING_EDITABLE) if (k in body) updates[k] = body[k];
  const { data, error } = await supabase.from("meetings").update(updates).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  let calendarSynced: boolean | null = null;
  const moved = ["date", "time", "duration", "location"].some((k) => k in updates);
  if (moved && data.calendar_event_id && data.date && data.time) {
    try {
      const { isConnected, updateCalendarEvent } = await import("@/lib/google-calendar");
      if (await isConnected()) {
        await updateCalendarEvent(data.calendar_event_id, { startIso: `${data.date}T${String(data.time).slice(0, 5)}:00`, endIso: endOf(data.date, String(data.time).slice(0, 5), Number(data.duration) || 60), summary: summaryOf(data.client_name ?? "", data.location), keepSummaryIfAttendees: true });
        calendarSynced = true;
      } else calendarSynced = false;
    } catch { calendarSynced = false; }
  }
  return { meeting: data as Record<string, unknown>, calendarSynced };
}

/** Delete a meeting; its Google event (if any) is removed first, best-effort (hardened). */
export async function deleteMeeting(id: string): Promise<{ calendarRemoved: boolean | null }> {
  const { data: m } = await supabase.from("meetings").select("calendar_event_id").eq("id", id).maybeSingle();
  let calendarRemoved: boolean | null = null;
  if (m?.calendar_event_id) {
    try {
      const { isConnected, deleteCalendarEvent } = await import("@/lib/google-calendar");
      if (await isConnected()) { await deleteCalendarEvent(m.calendar_event_id); calendarRemoved = true; } else calendarRemoved = false;
    } catch { calendarRemoved = false; }
  }
  const { error } = await supabase.from("meetings").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { calendarRemoved };
}

export async function readMeeting(id: string): Promise<{ clientId: string | null; clientName: string; projectId: string | null; date: string | null; time: string | null; duration: number; location: string; notes: string; status: string; hasCalendarEvent: boolean } | null> {
  const { data, error } = await supabase.from("meetings").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { clientId: data.client_id ?? null, clientName: data.client_name ?? "", projectId: data.project_id ?? null, date: data.date ?? null, time: data.time ? String(data.time).slice(0, 5) : null, duration: Number(data.duration) || 60, location: data.location ?? "", notes: data.notes ?? "", status: data.status ?? "", hasCalendarEvent: !!data.calendar_event_id };
}
