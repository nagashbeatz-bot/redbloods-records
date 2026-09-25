/**
 * Sunny LIVE CALENDAR — pure sanitizer: a raw Google Calendar event (as events.list returns it) → SunnyCalendarEvent.
 * Keeps every non-secret field Google returns; reduces meeting / attachment / conference URLs to booleans; scrubs
 * bearer-looking text (share links, meeting links with passcodes, tokens) out of titles / descriptions / locations.
 * Never reads or returns credentials (the input never contains them).
 */
import { scrubSecrets } from "../projects/detail-reader";
import type { SunnyCalendarEvent, SunnyCalendarAttendee, SunnyCalendarPerson } from "./types";

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const b = (v: unknown) => v === true;
const t = (v: unknown) => scrubSecrets(s(v));

/** Google holiday calendars ("…#holiday@group.v.calendar.google.com"). */
export const isHolidayCalendarId = (id: string) => /#holiday@group\.v\.calendar\.google\.com$/i.test(id) || /holiday/i.test(id) && /group\.v\.calendar\.google\.com$/i.test(id);

const person = (v: unknown): SunnyCalendarPerson | null => {
  const p = o(v);
  if (!p) return null;
  return { name: s(p.displayName), email: s(p.email), self: b(p.self) };
};

export function sanitizeCalendarEvent(raw: unknown, cal: { id: string; name: string | null }): SunnyCalendarEvent | null {
  const e = o(raw);
  if (!e || !s(e.id)) return null;
  const start = o(e.start) ?? {}, end = o(e.end) ?? {};
  const allDay = !s(start.dateTime) && !!s(start.date);
  const startV = s(start.dateTime) ?? s(start.date) ?? "";
  const endV = s(end.dateTime) ?? s(end.date) ?? "";
  const dur = !allDay && startV && endV ? Math.round((Date.parse(endV) - Date.parse(startV)) / 60_000) : null;
  const attendees: SunnyCalendarAttendee[] = (Array.isArray(e.attendees) ? e.attendees : []).map((a) => {
    const x = o(a) ?? {};
    return { name: s(x.displayName), email: s(x.email), self: b(x.self), response: s(x.responseStatus), organizer: b(x.organizer), optional: b(x.optional), resource: b(x.resource) };
  });
  const organizer = person(e.organizer);
  const conference = o(e.conferenceData);
  const attachments = Array.isArray(e.attachments) ? e.attachments : [];
  const title = t(e.summary);
  return {
    id: String(e.id),
    calendarId: cal.id,
    calendarName: cal.name,
    holidayCalendar: isHolidayCalendarId(cal.id),
    title, untitled: !title,
    description: t(e.description),
    start: startV, end: endV, allDay,
    timeZone: s(start.timeZone) ?? s(end.timeZone),
    durationMinutes: dur !== null && Number.isFinite(dur) ? dur : null,
    location: t(e.location),
    attendees,
    attendeesOmitted: b(e.attendeesOmitted),
    selfResponse: attendees.find((a) => a.self)?.response ?? null,
    organizer,
    creator: person(e.creator),
    invited: !!organizer && !organizer.self && organizer.email !== cal.id,
    recurringEventId: s(e.recurringEventId),
    originalStartTime: s(o(e.originalStartTime)?.dateTime) ?? s(o(e.originalStartTime)?.date),
    recurrence: Array.isArray(e.recurrence) ? e.recurrence.filter((r): r is string => typeof r === "string") : null,
    status: s(e.status),
    eventType: s(e.eventType) ?? "default",
    transparency: e.transparency === "transparent" ? "transparent" : "opaque",
    visibility: s(e.visibility),
    created: s(e.created),
    updated: s(e.updated),
    hasMeetingLink: !!s(e.hangoutLink) || (!!conference && (Array.isArray(conference.entryPoints) ? conference.entryPoints.length > 0 : true)),
    hasAttachments: attachments.length > 0,
    attachmentCount: attachments.length,
  };
}
