import "server-only";
/**
 * Sunny LIVE CALENDAR — the production Google adapter. MAIN service only: it uses the existing trusted Redbloods
 * integration (lib/google-calendar.ts — the stored credential, the Google client, and its automatic token refresh +
 * persistence, exactly as the Calendar page does). LIST calls only: calendarList.list + events.list. No insert /
 * update / delete / patch exists here. Credentials never leave this module.
 */
import { google } from "googleapis";
import { getAuthenticatedClient, isConnected } from "@/lib/google-calendar";
import type { CalendarApi } from "./read-core";
import { CALENDAR_PAGE_SIZE } from "./types";

export function googleCalendarApi(): CalendarApi {
  let client: ReturnType<typeof google.calendar> | null = null;
  const cal = async () => (client ??= google.calendar({ version: "v3", auth: await getAuthenticatedClient() }));
  return {
    connected: () => isConnected(),
    async listCalendars() {
      const r = await (await cal()).calendarList.list({ maxResults: 250 });
      return (r.data.items ?? []).map((c) => ({ id: c.id, summary: c.summary, summaryOverride: c.summaryOverride, primary: c.primary, accessRole: c.accessRole, timeZone: c.timeZone }));
    },
    async listEvents(calendarId, timeMin, timeMax, pageToken) {
      const r = await (await cal()).events.list({ calendarId, timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: CALENDAR_PAGE_SIZE, ...(pageToken ? { pageToken } : {}) });
      return { items: (r.data.items ?? []) as unknown[], nextPageToken: r.data.nextPageToken ?? null };
    },
  };
}
