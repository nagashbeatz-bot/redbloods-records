/**
 * Sunny LIVE CALENDAR — the read core (pure over an injected Google API). Runs ONLY in the Redbloods MAIN service
 * (the trusted integration owner). Same calls the Calendar page makes (calendar list → events.list per calendar,
 * recurring instances expanded) but keeps every non-secret field, keeps untitled events, pages through results and
 * reports truncation honestly. Read-only against Google: list calls only.
 *
 * Failure semantics (never "empty" on failure):
 *   not connected → CALENDAR_NOT_CONNECTED · rejected credential → CALENDAR_NEEDS_REAUTH ·
 *   Google / network error → CALENDAR_PROVIDER_ERROR · window > 45 days → CALENDAR_RANGE_TOO_LARGE (nothing read) ·
 *   a calendar failed or a cap was hit → CALENDAR_PARTIAL.
 */
import { sanitizeCalendarEvent, isHolidayCalendarId } from "./sanitize";
import {
  CALENDAR_CACHE_MS, CALENDAR_MAX_DAYS, CALENDAR_MAX_EVENTS, CALENDAR_MAX_PAGES_PER_CALENDAR, CALENDAR_PAGE_SIZE,
  type CalendarReadStatus, type CalendarWindowResult, type SunnyCalendarEvent, type SunnyCalendarInfo,
} from "./types";

export interface RawCalendarListEntry { id?: string | null; summary?: string | null; summaryOverride?: string | null; primary?: boolean | null; accessRole?: string | null; timeZone?: string | null }
export interface CalendarApi {
  connected(): Promise<boolean>;
  listCalendars(): Promise<RawCalendarListEntry[]>;
  listEvents(calendarId: string, timeMin: string, timeMax: string, pageToken?: string): Promise<{ items: unknown[]; nextPageToken?: string | null }>;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** An auth failure Google will not recover from without the Owner reconnecting. */
export function isReauthError(err: unknown): boolean {
  const e = err as { message?: string; code?: unknown; status?: unknown; response?: { status?: number; data?: { error?: string } } };
  const msg = String(e?.message ?? "").toLowerCase();
  const status = Number(e?.response?.status ?? e?.status ?? e?.code);
  return msg.includes("invalid_grant") || msg.includes("insufficient") || e?.response?.data?.error === "invalid_grant" || status === 401 || status === 403;
}

const cache = new Map<string, { at: number; result: CalendarWindowResult }>();
export function clearCalendarCache() { cache.clear(); }

export function calendarWindow(startYmd: string, endYmd: string): { ok: true; start: string; end: string; days: number } | { ok: false; days: number | null } {
  if (!YMD.test(startYmd) || !YMD.test(endYmd)) return { ok: false, days: null };
  const days = Math.round((Date.parse(`${endYmd}T00:00:00Z`) - Date.parse(`${startYmd}T00:00:00Z`)) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > CALENDAR_MAX_DAYS) return { ok: false, days: Number.isFinite(days) ? days : null };
  // The window is expressed in Israel time (00:00 of the first day → 23:59:59 of the last day, Asia/Jerusalem, DST-aware).
  return { ok: true, start: `${startYmd}T00:00:00${ilOffset(startYmd)}`, end: `${endYmd}T23:59:59${ilOffset(endYmd)}`, days };
}

/** Asia/Jerusalem UTC offset ("+02:00" / "+03:00") for a calendar date. */
export function ilOffset(ymd: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", timeZoneName: "shortOffset" }).formatToParts(new Date(`${ymd}T12:00:00Z`)).find((x) => x.type === "timeZoneName")?.value ?? "GMT+2";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
  if (!m) return "+02:00";
  return `${m[1]}${m[2].padStart(2, "0")}:${m[3] ?? "00"}`;
}

export async function readCalendarWindowCore(api: CalendarApi, startYmd: string, endYmd: string, now: Date = new Date()): Promise<CalendarWindowResult> {
  const base = (status: CalendarReadStatus, reasons: string[], w = { start: startYmd, end: endYmd, days: 0 }): CalendarWindowResult =>
    ({ status, window: w, fetchedAt: now.toISOString(), cache: "NONE", calendars: [], events: [], truncated: false, reasons });
  const win = calendarWindow(startYmd, endYmd);
  if (!win.ok) return base("CALENDAR_RANGE_TOO_LARGE", [`window must be 1–${CALENDAR_MAX_DAYS} days (YYYY-MM-DD)`], { start: startYmd, end: endYmd, days: win.days ?? 0 });
  const key = `${win.start}|${win.end}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CALENDAR_CACHE_MS) return { ...hit.result, cache: "HIT" };
  const w = { start: win.start, end: win.end, days: win.days };

  let connected: boolean;
  try { connected = await api.connected(); } catch { return base("CALENDAR_PROVIDER_ERROR", ["could not check the calendar connection"], w); }
  if (!connected) return base("CALENDAR_NOT_CONNECTED", ["Google Calendar is not connected to Redbloods"], w);

  let list: RawCalendarListEntry[];
  try { list = await api.listCalendars(); }
  catch (err) { return isReauthError(err) ? base("CALENDAR_NEEDS_REAUTH", ["Google rejected the stored credential — reconnect in Redbloods"], w) : base("CALENDAR_PROVIDER_ERROR", ["the calendar list could not be read"], w); }
  const cals = list.filter((c) => c.id && c.accessRole !== "freeBusyReader");

  const reasons: string[] = [];
  let truncated = false;
  const infos: SunnyCalendarInfo[] = [];
  const seen = new Set<string>();
  const events: SunnyCalendarEvent[] = [];
  let reauth = false;
  for (const c of cals) {
    const cal = { id: c.id!, name: c.summaryOverride ?? c.summary ?? null };
    const info: SunnyCalendarInfo = { id: cal.id, name: cal.name, primary: c.primary === true, accessRole: c.accessRole ?? null, timeZone: c.timeZone ?? null, holiday: isHolidayCalendarId(cal.id), read: "OK", events: 0 };
    try {
      let token: string | undefined;
      let pages = 0;
      do {
        const r = await api.listEvents(cal.id, win.start, win.end, token);
        pages++;
        for (const raw of r.items) {
          if (events.length >= CALENDAR_MAX_EVENTS) { truncated = true; info.read = "TRUNCATED"; break; }
          const ev = sanitizeCalendarEvent(raw, cal);
          if (!ev || seen.has(ev.id)) continue;
          seen.add(ev.id);
          events.push(ev);
          info.events++;
        }
        token = r.nextPageToken ?? undefined;
        if (token && (pages >= CALENDAR_MAX_PAGES_PER_CALENDAR || events.length >= CALENDAR_MAX_EVENTS)) { truncated = true; info.read = "TRUNCATED"; break; }
      } while (token);
    } catch (err) {
      info.read = "FAILED";
      if (isReauthError(err)) reauth = true;
      reasons.push(`calendar "${cal.name ?? "?"}" could not be read`);
    }
    infos.push(info);
  }
  if (truncated) reasons.push(`result capped (${CALENDAR_MAX_EVENTS} events / ${CALENDAR_MAX_PAGES_PER_CALENDAR * CALENDAR_PAGE_SIZE} per calendar) — PARTIAL`);
  const failed = infos.filter((i) => i.read === "FAILED").length;
  const status: CalendarReadStatus =
    infos.length > 0 && failed === infos.length ? (reauth ? "CALENDAR_NEEDS_REAUTH" : "CALENDAR_PROVIDER_ERROR")
    : failed > 0 || truncated ? "CALENDAR_PARTIAL" : "CALENDAR_DATA_AVAILABLE";
  events.sort((a, b) => a.start.localeCompare(b.start));
  const result: CalendarWindowResult = { status, window: w, fetchedAt: now.toISOString(), cache: "MISS", calendars: infos, events: status === "CALENDAR_PROVIDER_ERROR" || status === "CALENDAR_NEEDS_REAUTH" ? [] : events, truncated, reasons };
  if (status === "CALENDAR_DATA_AVAILABLE" || status === "CALENDAR_PARTIAL") {
    cache.set(key, { at: now.getTime(), result });
    if (cache.size > 30) cache.delete(cache.keys().next().value!);
  }
  return result;
}
