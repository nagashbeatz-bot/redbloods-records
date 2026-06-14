import "server-only";
import { supabase } from "@/lib/supabase";
export type { Show, ShowStatus, PaymentStatus } from "@/lib/shows-types";
export { SHOW_STATUSES, PAYMENT_STATUSES } from "@/lib/shows-types";
import type { Show, ShowStatus, PaymentStatus } from "@/lib/shows-types";

export type CreateShowInput = Omit<Show, "id" | "created_at" | "updated_at">;
export type PatchShowInput  = Partial<CreateShowInput>;

// ─── Calendar helpers ─────────────────────────────────────────────────────────

/** ISO datetime strings for a show's start and end (start + 2h default). */
export function showCalendarTimes(show: Pick<Show, "date" | "start_time">): { startIso: string; endIso: string } | null {
  if (!show.date) return null;
  const time  = show.start_time ?? "20:00";
  const start = new Date(`${show.date}T${time}:00`);
  if (isNaN(start.getTime())) return null;
  const end   = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    startIso: start.toISOString(),
    endIso:   end.toISOString(),
  };
}

/** Google Calendar event summary for a show. */
export function showCalendarSummary(show: Pick<Show, "name" | "artist">): string {
  return show.artist
    ? `הופעה: ${show.name} - ${show.artist}`
    : `הופעה: ${show.name}`;
}

/** Google Calendar event description for a show. */
export function showCalendarDescription(show: Pick<Show,
  "name" | "artist" | "booker_name" | "contact_person" | "phone" |
  "location" | "show_price" | "dj_fee"
>): string {
  const dist  = Math.max(0, (show.show_price || 0) - (show.dj_fee || 0));
  const share = dist / 2;
  const fmt   = (n: number) => `₪${n.toLocaleString("he-IL")}`;
  const lines = [
    `שם ההופעה: ${show.name}`,
    show.artist     ? `אמן מופיע: ${show.artist}`     : null,
    show.booker_name ? `מזמין: ${show.booker_name}`   : null,
    show.contact_person ? `איש קשר: ${show.contact_person}` : null,
    show.phone      ? `טלפון: ${show.phone}`           : null,
    show.location   ? `מקום: ${show.location}`         : null,
    "",
    `מחיר הופעה: ${fmt(show.show_price || 0)}`,
    `דיג׳יי: ${fmt(show.dj_fee || 0)}`,
    `יתרה לחלוקה: ${fmt(dist)}`,
    `חלק אמן (50%): ${fmt(share)}`,
    `חלק לייבל (50%): ${fmt(share)}`,
  ];
  return lines.filter(l => l !== null).join("\n");
}

// ─── DB queries ───────────────────────────────────────────────────────────────

export async function listShows(): Promise<Show[]> {
  const { data, error } = await supabase
    .from("shows")
    .select("*")
    .order("date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Show[];
}

export async function getShow(id: string): Promise<Show | null> {
  const { data } = await supabase.from("shows").select("*").eq("id", id).single();
  return data as Show | null;
}

export async function createShow(input: Partial<CreateShowInput> & { name: string }): Promise<Show> {
  const { data, error } = await supabase
    .from("shows")
    .insert({
      name:              input.name.trim(),
      artist:            input.artist            ?? "",
      artist_client_id:  input.artist_client_id  ?? null,
      booker_client_id:  input.booker_client_id  ?? null,
      booker_name:       input.booker_name       ?? "",
      date:              input.date              ?? null,
      start_time:        input.start_time        ?? null,
      location:          input.location          ?? "",
      contact_person:    input.contact_person    ?? "",
      phone:             input.phone             ?? "",
      status:            input.status            ?? "ליד חדש",
      payment_status:    input.payment_status    ?? "לא שולם",
      show_price:        input.show_price        ?? 0,
      dj_fee:            input.dj_fee            ?? 500,
      advance_payment:   input.advance_payment   ?? 0,
      notes:             input.notes             ?? "",
      calendar_event_id: input.calendar_event_id ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Show;
}

export async function patchShow(id: string, patch: PatchShowInput): Promise<Show> {
  const { data, error } = await supabase
    .from("shows")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Show;
}

export async function deleteShow(id: string): Promise<void> {
  const { error } = await supabase.from("shows").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
