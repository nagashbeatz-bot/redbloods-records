/**
 * Shared Google Calendar / Google Tasks writers for Owner-approved typed actions (the main calendar + the default task
 * list only). Thin, named wrappers over lib/google-calendar so every caller uses ONE path.
 * The stored OAuth token is never read or returned here — only "connected / not".
 */
import { supabase } from "@/lib/supabase";

const g = () => import("@/lib/google-calendar");

export async function calendarConnected(): Promise<boolean> { return (await g()).isConnected(); }
export async function readEvent(eventId: string) { return (await g()).getCalendarEventDetail(eventId); }
export async function addEvent(e: { summary: string; start: string; end: string; description?: string; allDay?: boolean; attendees?: string[] }): Promise<string> {
  return (await (await g()).createCalendarEvent(e.summary, e.start, e.end, { description: e.description, allDay: e.allDay, attendees: e.attendees?.map((email) => ({ email })) })).id;
}
export async function editEvent(eventId: string, patch: { summary?: string; startIso?: string; endIso?: string; location?: string; description?: string }): Promise<void> {
  await (await g()).updateCalendarEvent(eventId, patch);
}
export async function removeEvent(eventId: string): Promise<void> { await (await g()).deleteCalendarEvent(eventId); }
export async function addStandaloneGoogleTask(title: string, due: string, notes?: string): Promise<string> { return (await (await g()).createGoogleTask(title, due, notes)).id; }
export async function readGoogleTask(id: string) { return (await g()).getGoogleTaskDetail(id); }
export async function removeGoogleTask(id: string): Promise<void> { await (await g()).deleteGoogleTask(id); }
/** True when a Redbloods task mirrors this Google Task (then it is deleted only with its task). */
export async function googleTaskLinkedToTask(id: string): Promise<boolean> {
  const { count, error } = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("calendar_event_id", id);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}
/** Disconnect = delete the stored token (the same writer as DELETE /api/calendar/status). */
export async function disconnectGoogle(): Promise<void> { await (await g()).revokeToken(); }
