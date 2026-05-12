/**
 * Calendar types and pure formatting helpers.
 * Safe to import in both server and client components.
 * No Node.js / googleapis dependencies here.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarEventType =
  | "סשן"
  | "הופעה"
  | "חזרה"
  | "סאונדצ'ק"
  | "פגישה"
  | "אחר";

export interface ParsedCalendarEvent {
  id: string;
  calendarId: string;          // which Google calendar this event belongs to
  title: string;
  type: CalendarEventType;
  artist: string;
  context: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  durationMinutes: number;
  matchedProjectId?: string;
  matchedProjectName?: string;
  location?: string;
  htmlLink?: string;           // "Open in Google Calendar" URL
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** "19:30" */
export function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

/** "יום ג׳ 13.5" */
export function formatDateShort(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });
}

/** "2 שעות" / "90 דקות" */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes} דקות`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hs = h === 1 ? "שעה" : h === 2 ? "שעתיים" : `${h} שעות`;
  return m > 0 ? `${hs} ${m} דקות` : hs;
}
