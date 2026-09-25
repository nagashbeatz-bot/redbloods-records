/**
 * Sunny LIVE CALENDAR — Owner availability / occupancy (V1). Pure. Israel time.
 *
 *   occupied   timed events that block time (opaque, not cancelled, not declined by the Owner)
 *   free       gaps between them inside the day window (default 08:00–22:00) — "free" means only "no calendar
 *              commitment", NOT "suitable for work"
 *   all-day    holidays and all-day commitments are listed per day (they may make the whole day unavailable — Sunny
 *              says so instead of deciding)
 *   overlaps   two occupied events at the same time (possible conflict)
 *
 * If the calendar read is not complete, availability is UNKNOWN (failure) or PARTIAL (truncated / a calendar failed)
 * and free time is NEVER asserted.
 */
import type { CalendarReadStatus, SunnyCalendarEvent } from "./types";

export type AvailabilityStatus = "KNOWN" | "PARTIAL" | "UNKNOWN";
export interface DayAvailability {
  date: string;
  status: AvailabilityStatus;
  occupied: Array<{ start: string; end: string; eventIds: string[] }>;
  occupiedMinutes: number | null;
  free: Array<{ start: string; end: string; minutes: number }> | null;
  allDay: Array<{ eventId: string; title: string | null; holiday: boolean; blocksTime: boolean }>;
  overlaps: Array<{ a: string; b: string; start: string; end: string }>;
  nonBlocking: string[];
}

const IL = "Asia/Jerusalem";
const hm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: IL, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const ymdIL = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IL, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function blocksTime(e: SunnyCalendarEvent): boolean {
  return e.status !== "cancelled" && e.transparency !== "transparent" && e.selfResponse !== "declined" && e.eventType !== "workingLocation";
}

export function availability(events: SunnyCalendarEvent[], days: string[], status: CalendarReadStatus, dayStart = "08:00", dayEnd = "22:00", minFree = 30): DayAvailability[] {
  const st: AvailabilityStatus = status === "CALENDAR_DATA_AVAILABLE" ? "KNOWN" : status === "CALENDAR_PARTIAL" ? "PARTIAL" : "UNKNOWN";
  return days.map((date) => {
    if (st === "UNKNOWN") return { date, status: st, occupied: [], occupiedMinutes: null, free: null, allDay: [], overlaps: [], nonBlocking: [] };
    const allDay = events.filter((e) => e.allDay && e.start <= date && date < e.end).map((e) => ({ eventId: e.id, title: e.title, holiday: e.holidayCalendar, blocksTime: blocksTime(e) && !e.holidayCalendar }));
    const timed = events.filter((e) => !e.allDay && e.start && e.end).filter((e) => ymdIL(new Date(e.start)) <= date && date <= ymdIL(new Date(Date.parse(e.end) - 1)));
    const nonBlocking = timed.filter((e) => !blocksTime(e)).map((e) => e.id);
    const s0 = minutesOf(dayStart), s1 = minutesOf(dayEnd);
    const iv = timed.filter(blocksTime).map((e) => {
      const a = new Date(e.start), b = new Date(e.end);
      const from = ymdIL(a) < date ? 0 : minutesOf(hm(a));
      const to = ymdIL(b) > date ? 24 * 60 : minutesOf(hm(b));
      return { id: e.id, from, to };
    }).filter((x) => x.to > x.from).sort((x, y) => x.from - y.from);
    const overlaps: DayAvailability["overlaps"] = [];
    for (let i = 0; i < iv.length; i++) for (let j = i + 1; j < iv.length && iv[j].from < iv[i].to; j++) overlaps.push({ a: iv[i].id, b: iv[j].id, start: fmt(iv[j].from), end: fmt(Math.min(iv[i].to, iv[j].to)) });
    const merged: Array<{ from: number; to: number; ids: string[] }> = [];
    for (const x of iv) { const last = merged.at(-1); if (last && x.from <= last.to) { last.to = Math.max(last.to, x.to); last.ids.push(x.id); } else merged.push({ from: x.from, to: x.to, ids: [x.id] }); }
    const free: NonNullable<DayAvailability["free"]> = [];
    let cursor = s0;
    for (const m of merged) { if (m.from > cursor && Math.min(m.from, s1) - cursor >= minFree) free.push({ start: fmt(cursor), end: fmt(Math.min(m.from, s1)), minutes: Math.min(m.from, s1) - cursor }); cursor = Math.max(cursor, m.to); if (cursor >= s1) break; }
    if (s1 - cursor >= minFree) free.push({ start: fmt(cursor), end: fmt(s1), minutes: s1 - cursor });
    return {
      date, status: st,
      occupied: merged.map((m) => ({ start: fmt(m.from), end: fmt(Math.min(m.to, 24 * 60 - 1)), eventIds: m.ids })),
      occupiedMinutes: merged.reduce((sum, m) => sum + (m.to - m.from), 0),
      free: st === "KNOWN" ? free : null,
      allDay, overlaps, nonBlocking,
    };
  });
}

/** YYYY-MM-DD list from start to end inclusive. */
export function dayList(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${startYmd}T12:00:00Z`); t <= Date.parse(`${endYmd}T12:00:00Z`) && out.length < 60; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
