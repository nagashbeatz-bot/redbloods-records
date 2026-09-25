/**
 * Sunny LIVE CALENDAR — the sanitized shape (pure, no runtime imports).
 *
 * Source of truth: the Owner's Google Calendar. Trusted integration owner: the Redbloods MAIN service (it alone holds
 * the Google client + the stored OAuth credential and refreshes it). Sunny receives THIS shape only — calendar DATA,
 * never credentials, never raw meeting / attachment URLs (booleans instead).
 */

export type CalendarReadStatus =
  | "CALENDAR_DATA_AVAILABLE"   // every calendar read completely
  | "CALENDAR_PARTIAL"          // some calendar failed or the result was truncated — never "complete"
  | "CALENDAR_NOT_CONNECTED"    // Redbloods has no Google connection
  | "CALENDAR_NEEDS_REAUTH"     // Google rejected the stored credential (Owner must reconnect in Redbloods)
  | "CALENDAR_PROVIDER_ERROR"   // Google / network / main-service failure — NOT an empty calendar
  | "CALENDAR_RANGE_TOO_LARGE"; // request window over the limit — nothing was read

export const CALENDAR_MAX_DAYS = 45;
export const CALENDAR_MAX_EVENTS = 1500;
export const CALENDAR_PAGE_SIZE = 250;
export const CALENDAR_MAX_PAGES_PER_CALENDAR = 6;
export const CALENDAR_CACHE_MS = 90_000;

export interface SunnyCalendarPerson { name: string | null; email: string | null; self: boolean }
export interface SunnyCalendarAttendee extends SunnyCalendarPerson { response: string | null; organizer: boolean; optional: boolean; resource: boolean }

export interface SunnyCalendarEvent {
  id: string;
  calendarId: string;
  calendarName: string | null;
  /** The calendar is a subscribed holiday calendar. */
  holidayCalendar: boolean;
  title: string | null;
  untitled: boolean;
  description: string | null;
  /** Timed events: ISO date-time. All-day events: YYYY-MM-DD (end is exclusive, as Google stores it). */
  start: string;
  end: string;
  allDay: boolean;
  timeZone: string | null;
  durationMinutes: number | null;
  location: string | null;
  attendees: SunnyCalendarAttendee[];
  attendeesOmitted: boolean;
  /** The Owner's own response when the Owner is an attendee (accepted / declined / tentative / needsAction). */
  selfResponse: string | null;
  organizer: SunnyCalendarPerson | null;
  creator: SunnyCalendarPerson | null;
  /** Organizer is not the Owner's calendar → an invited / external event. */
  invited: boolean;
  recurringEventId: string | null;
  originalStartTime: string | null;
  recurrence: string[] | null;
  status: string | null;
  eventType: string | null;
  /** "opaque" = busy, "transparent" = free (Google default when absent: opaque). */
  transparency: "opaque" | "transparent";
  visibility: string | null;
  created: string | null;
  updated: string | null;
  hasMeetingLink: boolean;
  hasAttachments: boolean;
  attachmentCount: number;
}

export interface SunnyCalendarInfo {
  id: string;
  name: string | null;
  primary: boolean;
  accessRole: string | null;
  timeZone: string | null;
  holiday: boolean;
  read: "OK" | "FAILED" | "TRUNCATED";
  events: number;
}

export interface CalendarWindowResult {
  status: CalendarReadStatus;
  window: { start: string; end: string; days: number };
  fetchedAt: string;
  cache: "HIT" | "MISS" | "NONE";
  calendars: SunnyCalendarInfo[];
  events: SunnyCalendarEvent[];
  truncated: boolean;
  /** Human-readable reasons for PARTIAL / errors (never contains credentials). */
  reasons: string[];
}
