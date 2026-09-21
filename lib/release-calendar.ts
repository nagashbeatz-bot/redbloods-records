// Pure, client-safe helpers for showing existing calendar events inside the
// "הוסף ריליס" date step. DISPLAY ONLY: nothing here reads a calendar or writes one.
//
// Events come from the existing /api/calendar/week route (Google Calendar, every
// calendar of the account) as ParsedCalendarEvent[]:
//   • timed event → startTime is an ISO string WITH an offset
//   • all-day event → isAllDay, startTime is "YYYY-MM-DD" and endTime is the
//     EXCLUSIVE end date (Google's convention) — a one-day event ends the next day
// Days are always bucketed by their ISRAEL calendar date, never the browser's or the
// server's zone, so an event at 23:30 lands on the day the user sees on the calendar.

import type { CalendarEventType, ParsedCalendarEvent } from "./calendar-utils";

const IL_TZ = "Asia/Jerusalem";

/** Same per-type accent colors the calendar screen already uses (WeekCalendar TYPE_COLORS.border). */
export const EVENT_DOT_COLOR: Record<CalendarEventType, string> = {
  "סשן":      "#A855F7",
  "חזרה":     "#3B82F6",
  "הופעה":    "#EC4899",
  "סאונדצ'ק": "#F97316",
  "פגישה":    "#10B981",
  "אחר":      "#6B7280",
};
export function eventDotColor(type: string): string {
  return EVENT_DOT_COLOR[type as CalendarEventType] ?? EVENT_DOT_COLOR["אחר"];
}

/** One event as shown inside a day cell. */
export interface DayEvent {
  id: string;
  title: string;
  type: string;
  allDay: boolean;
  /** "HH:MM" (Israel time) for a timed event, null for all-day. */
  time: string | null;
  /** Sort key: all-day first, then by start. */
  sort: number;
}

const ilDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: IL_TZ });                       // YYYY-MM-DD
const ilTimeFmt = new Intl.DateTimeFormat("he-IL", { timeZone: IL_TZ, hour: "2-digit", minute: "2-digit", hour12: false });

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Add whole days to a YYYY-MM-DD (UTC arithmetic — no DST drift). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Group events by their Israel calendar day. Unparseable events are skipped, never thrown on. */
export function eventsByDay(events: ParsedCalendarEvent[]): Map<string, DayEvent[]> {
  const out = new Map<string, DayEvent[]>();
  const push = (day: string, e: DayEvent) => { const l = out.get(day); if (l) l.push(e); else out.set(day, [e]); };

  for (const ev of events) {
    if (!ev || !ev.title) continue;
    const base = { id: ev.id, title: ev.title, type: ev.type };

    if (ev.isAllDay) {
      const start = (ev.startTime ?? "").slice(0, 10);
      if (!YMD.test(start)) continue;
      const endEx = YMD.test((ev.endTime ?? "").slice(0, 10)) ? ev.endTime.slice(0, 10) : addDays(start, 1);
      // Every day of the span (end is exclusive); capped so a runaway event can't flood the grid.
      let day = start, guard = 0;
      do { push(day, { ...base, allDay: true, time: null, sort: -1 }); day = addDays(day, 1); guard++; } while (day < endEx && guard < 31);
      continue;
    }

    const t = new Date(ev.startTime);
    if (Number.isNaN(t.getTime())) continue;
    push(ilDateFmt.format(t), { ...base, allDay: false, time: ilTimeFmt.format(t), sort: t.getTime() });
  }

  for (const list of out.values()) list.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, "he"));
  return out;
}

/** Up to `max` events to draw plus how many more there are ("+N"). */
export function summarizeDay(list: DayEvent[] | undefined, max = 2): { shown: DayEvent[]; more: number } {
  const l = list ?? [];
  return { shown: l.slice(0, max), more: Math.max(0, l.length - max) };
}

/**
 * The 6-week window a month grid covers (Sunday on/before the 1st), widened by one day
 * on each side: the server cuts the range at its own local midnight, so the margin keeps
 * edge days complete. Returns the /api/calendar/week params.
 */
export function monthGridRange(year: number, month0: number): { weekStart: string; days: number } {
  const first = new Date(Date.UTC(year, month0, 1));
  const lead = first.getUTCDay(); // 0 = Sunday
  const gridStart = addDays(`${year}-${String(month0 + 1).padStart(2, "0")}-01`, -lead);
  return { weekStart: addDays(gridStart, -1), days: 44 };
}

/** `days` query param of /api/calendar/week: 7 when absent or invalid, otherwise clamped to 1..45. */
export function clampRangeDays(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 7;
  return Math.min(45, Math.max(1, n));
}
