/**
 * Sunny connector → Redbloods MAIN internal calendar read (the connector holds NO Google credential).
 * GET only, exact URL (the MCP-only fetch guard allows exactly this URL), dedicated secret header, no redirects,
 * bounded timeout, strict shape validation. Any failure → CALENDAR_PROVIDER_ERROR — never an empty calendar.
 */
import { INTERNAL_AUTH_HEADER, INTERNAL_SECRET_ENV } from "./internal-auth";
import type { CalendarReadStatus, CalendarWindowResult } from "./types";

export const INTERNAL_CALENDAR_PATH = "/api/partner/internal/calendar";
export const MAIN_BASE_URL_ENV = "PARTNER_MAIN_BASE_URL";
const STATUSES: readonly CalendarReadStatus[] = ["CALENDAR_DATA_AVAILABLE", "CALENDAR_PARTIAL", "CALENDAR_NOT_CONNECTED", "CALENDAR_NEEDS_REAUTH", "CALENDAR_PROVIDER_ERROR", "CALENDAR_RANGE_TOO_LARGE"];

export function internalCalendarUrl(env: Record<string, string | undefined> = process.env): string | null {
  const base = env[MAIN_BASE_URL_ENV];
  if (!base) return null;
  try { const u = new URL(base); if (u.protocol !== "https:" && u.hostname !== "localhost") return null; return `${u.origin}${INTERNAL_CALENDAR_PATH}`; } catch { return null; }
}

const failure = (startYmd: string, endYmd: string, reason: string): CalendarWindowResult =>
  ({ status: "CALENDAR_PROVIDER_ERROR", window: { start: startYmd, end: endYmd, days: 0 }, fetchedAt: new Date().toISOString(), cache: "NONE", calendars: [], events: [], truncated: false, reasons: [reason] });

export async function fetchCalendarWindowRemote(startYmd: string, endYmd: string, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<CalendarWindowResult> {
  const url = internalCalendarUrl(env);
  const secret = env[INTERNAL_SECRET_ENV];
  if (!url || !secret) return failure(startYmd, endYmd, "the internal calendar read is not configured on this service");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetchImpl(`${url}?start=${encodeURIComponent(startYmd)}&end=${encodeURIComponent(endYmd)}`, { method: "GET", headers: { [INTERNAL_AUTH_HEADER]: secret }, redirect: "error", cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return failure(startYmd, endYmd, `the Redbloods calendar service answered ${res.status}`);
    const body = (await res.json()) as Partial<CalendarWindowResult>;
    if (!body || !STATUSES.includes(body.status as CalendarReadStatus) || !Array.isArray(body.events) || !Array.isArray(body.calendars)) return failure(startYmd, endYmd, "unexpected response from the Redbloods calendar service");
    return body as CalendarWindowResult;
  } catch {
    return failure(startYmd, endYmd, "the Redbloods calendar service could not be reached");
  } finally { clearTimeout(timer); }
}
