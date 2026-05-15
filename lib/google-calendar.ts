/**
 * Google Calendar read-only integration — SERVER ONLY.
 * Tokens are stored in .calendar-token.json (gitignored).
 * OAuth scope: calendar.readonly
 *
 * ⚠️  Never import this file from a Client Component.
 *     Import types/helpers from lib/calendar-utils.ts instead.
 */
import "server-only";

import { google } from "googleapis";
import fs from "fs";
import path from "path";

// ─── Config ──────────────────────────────────────────────────────────────────

const TOKEN_PATH  = path.join(process.cwd(), ".calendar-token.json");
// calendar.readonly → read events/freebusy
// calendar.events   → create/edit events
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? "primary";

// ─── OAuth client ─────────────────────────────────────────────────────────────

export function getOAuthClient(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri ?? process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/calendar/callback"
  );
}

export function getAuthUrl(redirectUri?: string): string {
  const oauth2 = getOAuthClient(redirectUri);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

// ─── Token management (Supabase-backed, survives redeploys) ──────────────────

export async function saveToken(tokens: object): Promise<void> {
  const { supabase } = await import("./supabase");
  const { error } = await supabase.from("settings").upsert({
    key: "google_calendar_token",
    value: tokens,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Supabase saveToken failed: ${error.message}`);
}

export async function loadToken(): Promise<Record<string, unknown> | null> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "google_calendar_token")
    .single();
  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows found (expected when not connected)
    console.error("loadToken Supabase error:", error.message, error.code);
  }
  return (data?.value as Record<string, unknown>) ?? null;
}

export async function revokeToken(): Promise<void> {
  const { supabase } = await import("./supabase");
  const { error } = await supabase.from("settings").delete().eq("key", "google_calendar_token");
  if (error) throw new Error(`Supabase revokeToken failed: ${error.message}`);
}

export async function isConnected(): Promise<boolean> {
  return (await loadToken()) !== null;
}

export async function getAuthenticatedClient() {
  const oauth2 = getOAuthClient();
  const token  = await loadToken();
  if (!token) throw new Error("Google Calendar לא מחובר");

  oauth2.setCredentials(token as Parameters<typeof oauth2.setCredentials>[0]);

  // Auto-save refreshed tokens (fire-and-forget)
  oauth2.on("tokens", (newTokens) => {
    const merged = { ...token, ...newTokens };
    saveToken(merged).catch(console.error);
  });

  return oauth2;
}

// ─── Types (re-exported from calendar-utils for server callers) ───────────────

export type { CalendarEventType, ParsedCalendarEvent } from "./calendar-utils";
export { formatTime, formatDateShort, formatDuration } from "./calendar-utils";
import type { CalendarEventType, ParsedCalendarEvent } from "./calendar-utils";
import { formatTime, formatDateShort, formatDuration } from "./calendar-utils";

// ─── Event parsing ────────────────────────────────────────────────────────────

const TYPE_KEYWORDS: Record<CalendarEventType, string[]> = {
  "סשן":        ["סשן", "session", "studio", "סטודיו", "הקלטה", "recording"],
  "הופעה":      ["הופעה", "live", "show", "concert", "גיג", "מופע", "הופ"],
  "חזרה":       ["חזרה", "rehearsal", "חזרות"],
  "סאונדצ'ק":   ["סאונדצ'ק", "soundcheck", "sound check", "ס'ק", "סאונד"],
  "פגישה":      ["פגישה", "meeting", "שיחה", "zoom", "call", "teams"],
  "אחר":        [],
};

function detectType(text: string): CalendarEventType {
  const lower = text.toLowerCase();
  for (const [type, kws] of Object.entries(TYPE_KEYWORDS)) {
    if (type === "אחר") continue;
    if (kws.some((kw) => lower.includes(kw.toLowerCase()))) {
      return type as CalendarEventType;
    }
  }
  return "אחר";
}

function parseTitle(title: string): {
  type: CalendarEventType;
  artist: string;
  context: string;
} {
  // Expected format: TYPE - ARTIST - CONTEXT
  // Supports hyphen variants: -, –, —
  const parts = title.split(/\s*[-–—]\s*/);

  if (parts.length >= 3) {
    const t = detectType(parts[0]);
    if (t !== "אחר") {
      return { type: t, artist: parts[1].trim(), context: parts.slice(2).join(" - ").trim() };
    }
  }
  if (parts.length === 2) {
    const t = detectType(parts[0]);
    if (t !== "אחר") {
      return { type: t, artist: parts[1].trim(), context: "" };
    }
  }

  // Fallback: detect type from whole title, no artist/context extraction
  return { type: detectType(title), artist: "", context: title };
}

// ─── Project matching ─────────────────────────────────────────────────────────

type ProjectStub = { id: string; name: string; artist: string };

function matchToProject(
  artist: string,
  context: string,
  projects: ProjectStub[]
): { id: string; name: string } | null {
  if (!artist && !context) return null;

  const norm = (s: string) => s.trim().toLowerCase();
  const na = norm(artist);
  const nc = norm(context);

  // Strong match: artist + project name both match
  for (const p of projects) {
    const pa = norm(p.artist);
    const pn = norm(p.name);
    const artistMatch = na && (pa.includes(na) || na.includes(pa));
    const nameMatch   = nc && (pn.includes(nc) || nc.includes(pn));
    if (artistMatch && nameMatch) return { id: p.id, name: p.name };
  }

  // Weaker match: artist only (only when no context or context is a location)
  if (na && !nc) {
    for (const p of projects) {
      const pa = norm(p.artist);
      if (pa.includes(na) || na.includes(pa)) return { id: p.id, name: p.name };
    }
  }

  return null;
}

// ─── Main fetch functions ─────────────────────────────────────────────────────

export async function fetchEvents(
  daysAhead: number = 7,
  projects: ProjectStub[] = []
): Promise<ParsedCalendarEvent[]> {
  const auth     = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  const now     = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + daysAhead * 86400_000).toISOString();

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 100,
  });

  const items = res.data.items ?? [];

  return items
    .filter((item) => item.summary)
    .map((item) => {
      const parsed    = parseTitle(item.summary!);
      const isAllDay  = !item.start?.dateTime;
      const startTime = item.start?.dateTime ?? item.start?.date ?? "";
      const endTime   = item.end?.dateTime ?? item.end?.date ?? "";

      let durationMinutes = 0;
      if (!isAllDay && startTime && endTime) {
        durationMinutes = Math.round(
          (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60_000
        );
      }

      const matched = matchToProject(parsed.artist, parsed.context, projects);

      return {
        id:                   item.id!,
        calendarId:           CALENDAR_ID,
        title:                item.summary!,
        type:                 parsed.type,
        artist:               parsed.artist,
        context:              parsed.context,
        startTime,
        endTime,
        isAllDay,
        durationMinutes,
        matchedProjectId:     matched?.id,
        matchedProjectName:   matched?.name,
        location:             item.location ?? undefined,
        htmlLink:             item.htmlLink ?? undefined,
      } satisfies ParsedCalendarEvent;
    });
}

/** Returns events split into today vs. tomorrow (48h window, all calendars, all-day safe) */
export async function fetchTodayAndWeek(
  projects: ProjectStub[] = []
): Promise<{ today: ParsedCalendarEvent[]; week: ParsedCalendarEvent[] }> {
  const now = new Date();

  // today: 00:00 → 23:59:59 (local time)
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  // tomorrow: 00:00 → 23:59:59 (local time)
  const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const tomorrowEnd   = new Date(todayEnd);   tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  // Fetch all calendars for 48 hours
  const all = await fetchEventsInRange(todayStart, tomorrowEnd, projects);

  // Local date string (avoids UTC offset bugs — e.g. UTC+3 midnight = "yesterday" in UTC)
  function localDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const todayStr    = localDateStr(todayStart);
  const tomorrowStr = localDateStr(tomorrowStart);

  // For event startTime: Google returns "2026-05-12T14:00:00+03:00" or "2026-05-12"
  // Slice(0,10) gives the local date in both cases (Google stores in the event's timezone)
  function eventDate(e: ParsedCalendarEvent): string {
    return e.startTime.slice(0, 10);
  }

  const today    = all.filter((e) => eventDate(e) === todayStr);
  const tomorrow = all.filter((e) => eventDate(e) === tomorrowStr);

  return { today, week: tomorrow };
}

/** Build a plain-text calendar context block for the AI agent */
export function buildCalendarContext(
  today: ParsedCalendarEvent[],
  week: ParsedCalendarEvent[]
): string {
  if (today.length === 0 && week.length === 0) {
    return "\n=== יומן Google Calendar ===\nאין אירועים ב-7 הימים הקרובים.";
  }

  const fmt = (e: ParsedCalendarEvent) => {
    const time = e.isAllDay ? "כל היום" : formatTime(e.startTime);
    const dur  = e.durationMinutes > 0 ? ` (${formatDuration(e.durationMinutes)})` : "";
    const proj = e.matchedProjectName ? ` → פרויקט: "${e.matchedProjectName}"` : "";
    const loc  = e.location ? ` | מקום: ${e.location}` : "";
    return `  - ${e.type}: "${e.title}" | ${time}${dur}${loc}${proj}`;
  };

  const lines: string[] = ["\n=== יומן Google Calendar ==="];

  if (today.length > 0) {
    lines.push("היום:");
    today.forEach((e) => lines.push(fmt(e)));
  } else {
    lines.push("היום: אין אירועים");
  }

  if (week.length > 0) {
    lines.push("השבוע הקרוב:");
    week.forEach((e) => {
      const day = formatDateShort(e.startTime);
      const time = e.isAllDay ? "כל היום" : formatTime(e.startTime);
      const dur  = e.durationMinutes > 0 ? ` (${formatDuration(e.durationMinutes)})` : "";
      const proj = e.matchedProjectName ? ` → פרויקט: "${e.matchedProjectName}"` : "";
      const loc  = e.location ? ` | מקום: ${e.location}` : "";
      lines.push(`  - ${e.type}: "${e.title}" | ${day} ${time}${dur}${loc}${proj}`);
    });
  }

  return lines.join("\n");
}

// ─── Free slot finder (smart scheduling) ─────────────────────────────────────

import {
  WORK_START_H, WORK_END_H, WORK_DAYS, SLOT_STEP_MIN, BUFFER_MIN,
  isWorkingDay, slotLabel,
} from "./schedule-rules";

/**
 * Returns up to `maxSlots` free :00/:30 windows within working hours (Sun–Thu 10–20).
 * If `requiresBuffer` is true, enforces 30-min gap before/after adjacent events.
 */
export async function findFreeSlots(
  durationMinutes: number,
  requiresBuffer: boolean,
  daysAhead = 14,
  maxSlots  = 5
): Promise<Array<{ start: string; end: string; label: string }>> {
  const auth     = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  const now     = new Date();
  const timeMax = new Date(now.getTime() + daysAhead * 86_400_000);

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: CALENDAR_ID }],
    },
  });

  const busy = (res.data.calendars?.[CALENDAR_ID]?.busy ?? []).map((b) => ({
    start: new Date(b.start!),
    end:   new Date(b.end!),
  }));

  const slots: Array<{ start: string; end: string; label: string }> = [];
  const durMs    = durationMinutes * 60_000;
  const bufMs    = requiresBuffer ? BUFFER_MIN * 60_000 : 0;

  for (let d = 0; d < daysAhead && slots.length < maxSlots; d++) {
    const base = new Date(now);
    base.setDate(base.getDate() + d);
    base.setHours(0, 0, 0, 0);

    if (!isWorkingDay(base)) continue;

    // Generate candidate :00/:30 times for this day
    for (
      let startMin = WORK_START_H * 60;
      startMin + durationMinutes <= WORK_END_H * 60;
      startMin += SLOT_STEP_MIN
    ) {
      const candidate = new Date(base);
      candidate.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);

      // Skip past times
      if (candidate <= now) continue;

      const candidateEnd = new Date(candidate.getTime() + durMs);

      // Check busy conflicts including buffer zone
      const checkStart = new Date(candidate.getTime() - bufMs);
      const checkEnd   = new Date(candidateEnd.getTime() + bufMs);

      const hasConflict = busy.some(
        (b) => b.start < checkEnd && b.end > checkStart
      );

      if (!hasConflict) {
        slots.push({
          start: candidate.toISOString(),
          end:   candidateEnd.toISOString(),
          label: slotLabel(candidate, candidateEnd),
        });
        if (slots.length >= maxSlots) break;
      }
    }
  }

  return slots;
}

/**
 * Check a specific manually-chosen slot.
 * Returns detailed validation results.
 */
export async function checkManualSlot(
  startIso: string,
  endIso: string,
  requiresBuffer: boolean
): Promise<{
  outOfDays:     boolean;
  outOfHours:    boolean;
  hardConflict:  boolean;
  bufferWarning: boolean;
  conflictNames: string[];
}> {
  const start = new Date(startIso);
  const end   = new Date(endIso);

  // Fetch busy + events for the relevant day
  const auth     = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  const dayStart = new Date(start); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(start); dayEnd.setHours(23, 59, 59, 999);

  const evRes = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: true,
  });

  const events = evRes.data.items ?? [];
  const busy = events
    .filter((e) => e.start?.dateTime)
    .map((e) => ({
      start: new Date(e.start!.dateTime!),
      end:   new Date(e.end!.dateTime!),
      name:  e.summary ?? "",
    }));

  const { checkSlot } = await import("./schedule-rules");
  const result = checkSlot(start, end, requiresBuffer, busy);

  const conflictNames = busy
    .filter((b) => b.start < end && b.end > start)
    .map((b) => b.name)
    .filter(Boolean);

  return { ...result, conflictNames };
}

// ─── Helper: parse raw event item ─────────────────────────────────────────────

function parseEventItem(
  item: { id?: string | null; summary?: string | null; start?: { dateTime?: string | null; date?: string | null } | null; end?: { dateTime?: string | null; date?: string | null } | null; location?: string | null; htmlLink?: string | null },
  projects: ProjectStub[],
  calendarId: string
): ParsedCalendarEvent {
  const parsed    = parseTitle(item.summary!);
  const isAllDay  = !item.start?.dateTime;
  const startTime = item.start?.dateTime ?? item.start?.date ?? "";
  const endTime   = item.end?.dateTime   ?? item.end?.date   ?? "";

  let durationMinutes = 0;
  if (!isAllDay && startTime && endTime) {
    durationMinutes = Math.round(
      (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60_000
    );
  }

  const matched = matchToProject(parsed.artist, parsed.context, projects);

  return {
    id:                 item.id!,
    calendarId,
    title:              item.summary!,
    type:               parsed.type,
    artist:             parsed.artist,
    context:            parsed.context,
    startTime,
    endTime,
    isAllDay,
    durationMinutes,
    matchedProjectId:   matched?.id,
    matchedProjectName: matched?.name,
    location:           item.location ?? undefined,
    htmlLink:           item.htmlLink ?? undefined,
  } satisfies ParsedCalendarEvent;
}

// ─── Get all calendar IDs the user has ────────────────────────────────────────

async function getAllCalendarIds(auth: ReturnType<typeof getOAuthClient>): Promise<string[]> {
  try {
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.calendarList.list({ maxResults: 50 });
    const items = res.data.items ?? [];
    return items
      .filter((cal) => cal.id && cal.accessRole !== "freeBusyReader")
      .map((cal) => cal.id!);
  } catch {
    return [CALENDAR_ID]; // fallback to primary
  }
}

// ─── Fetch events for an explicit date range ──────────────────────────────────

export async function fetchEventsInRange(
  start: Date,
  end: Date,
  projects: ProjectStub[] = []
): Promise<ParsedCalendarEvent[]> {
  const auth     = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  // Fetch from ALL calendars the user has
  const calendarIds = await getAllCalendarIds(auth);

  const allItems = await Promise.all(
    calendarIds.map(async (calId) => {
      try {
        const res = await calendar.events.list({
          calendarId:   calId,
          timeMin:      start.toISOString(),
          timeMax:      end.toISOString(),
          singleEvents: true,
          orderBy:      "startTime",
          maxResults:   250,
        });
        return { calId, items: res.data.items ?? [] };
      } catch {
        return { calId, items: [] };
      }
    })
  );

  // Flatten, deduplicate by event ID, filter nulls
  const seen = new Set<string>();
  const events: ParsedCalendarEvent[] = [];

  for (const { calId, items } of allItems) {
    for (const item of items) {
      if (!item.summary || !item.id) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      events.push(parseEventItem(item, projects, calId));
    }
  }

  // Sort by start time
  return events.sort((a, b) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

// ─── Event creation ───────────────────────────────────────────────────────────

export async function createCalendarEvent(
  summary: string,
  startIso: string,
  endIso: string,
  opts?: {
    attendees?:    { email: string }[];
    description?:  string;
  }
): Promise<{ id: string; htmlLink: string }> {
  const auth     = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  const res = await calendar.events.insert({
    calendarId:  CALENDAR_ID,
    sendUpdates: opts?.attendees?.length ? "all" : "none",
    requestBody: {
      summary,
      description:              opts?.description,
      start: { dateTime: startIso, timeZone: "Asia/Jerusalem" },
      end:   { dateTime: endIso,   timeZone: "Asia/Jerusalem" },
      attendees:                opts?.attendees,
      guestsCanSeeOtherGuests:  false,
    },
  });

  return {
    id:       res.data.id!,
    htmlLink: res.data.htmlLink!,
  };
}

// ─── Check if event exists ────────────────────────────────────────────────────

/** Returns true if the event exists on the calendar, false if deleted/not found. */
export async function calendarEventExists(
  eventId: string,
  calendarId: string = CALENDAR_ID
): Promise<boolean> {
  try {
    const auth     = await getAuthenticatedClient();
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.events.get({ calendarId, eventId });
    // status "cancelled" means the event was deleted
    return res.data.status !== "cancelled";
  } catch {
    return false; // 404 or any error → treat as not existing
  }
}

// ─── Event deletion ───────────────────────────────────────────────────────────

export async function deleteCalendarEvent(
  eventId: string,
  calendarId: string = CALENDAR_ID
): Promise<void> {
  const auth     = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({ calendarId, eventId });
}

// ─── Event update ─────────────────────────────────────────────────────────────

export interface EventUpdatePayload {
  summary?:   string;
  startIso?:  string;
  endIso?:    string;
  location?:  string;
}

export async function updateCalendarEvent(
  eventId: string,
  updates: EventUpdatePayload,
  calendarId: string = CALENDAR_ID
): Promise<{ id: string; htmlLink: string }> {
  const auth     = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  // Fetch current event first so we only patch changed fields
  const current = await calendar.events.get({ calendarId, eventId });

  const requestBody: Record<string, unknown> = { ...current.data };
  if (updates.summary  !== undefined) requestBody.summary  = updates.summary;
  if (updates.location !== undefined) requestBody.location = updates.location;
  if (updates.startIso !== undefined) {
    requestBody.start = { dateTime: updates.startIso, timeZone: "Asia/Jerusalem" };
  }
  if (updates.endIso !== undefined) {
    requestBody.end = { dateTime: updates.endIso, timeZone: "Asia/Jerusalem" };
  }

  const res = await calendar.events.update({
    calendarId,
    eventId,
    requestBody,
  });

  return {
    id:       res.data.id!,
    htmlLink: res.data.htmlLink!,
  };
}

// ─── Permission check ─────────────────────────────────────────────────────────

/** Returns true if the stored token includes write access (calendar.events scope). */
export async function hasWritePermission(): Promise<boolean> {
  const token = await loadToken();
  if (!token) return false;
  const scope = (token as Record<string, unknown>).scope;
  if (typeof scope !== "string") return false;
  return scope.includes("calendar.events") || scope.includes("calendar") && !scope.includes("readonly");
}
