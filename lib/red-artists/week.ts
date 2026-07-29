/**
 * Pure Israel-timezone week/date-range helpers — no DB, no "server-only", safe
 * on client and server. All calendar-day arithmetic goes through UTC-anchored
 * Date handles (Date.UTC + getUTC-prefixed / setUTC-prefixed accessors only)
 * so the host machine's own
 * timezone (client browser OR the server's runtime, which runs UTC on
 * Railway) can never leak into a "which day is this" calculation — only
 * `ilTodayYMD` ever touches wall-clock "now", and it does that through
 * Intl.DateTimeFormat with an explicit Asia/Jerusalem zone.
 *
 * Week definition: Sunday = start, Saturday = end. Dates are always
 * YYYY-MM-DD strings (the format already used everywhere else in the app —
 * never changed here).
 */

const IL_TZ = "Asia/Jerusalem";
const HEB_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export type WeekDay = { day: string; date: string; iso: string };

/** Today's calendar date in Israel time, as YYYY-MM-DD. */
export function ilTodayYMD(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IL_TZ }).format(new Date());
}

/** Parse YYYY-MM-DD into a UTC-midnight Date used purely as a calendar-day
 *  handle (never a real instant) — all arithmetic below uses UTC accessors
 *  only, so it stays correct regardless of the host's own timezone. */
function ymdToUtcDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function utcDateToYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** True iff `ymd` is a syntactically valid YYYY-MM-DD string. */
export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = ymdToUtcDate(ymd);
  return !Number.isNaN(d.getTime()) && utcDateToYmd(d) === ymd;
}

/** Add (or subtract) whole calendar days to a YYYY-MM-DD string. */
export function addDaysYMD(ymd: string, n: number): string {
  const d = ymdToUtcDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDateToYmd(d);
}

/** The Sunday that starts the calendar week containing `ymd`. */
export function weekStartFor(ymd: string): string {
  const dow = ymdToUtcDate(ymd).getUTCDay(); // 0=Sun..6=Sat
  return addDaysYMD(ymd, -dow);
}

/** The Saturday that ends the week starting on `weekStart` (a Sunday). */
export function weekEndFor(weekStart: string): string {
  return addDaysYMD(weekStart, 6);
}

/** Sunday that starts the CURRENT Israel week (Sunday ≤ today ≤ Saturday) —
 *  the calendar's default week. */
export function currentWeekStart(): string {
  return weekStartFor(ilTodayYMD());
}

/** The pre-existing "שבוע הבא" (availability) target week — the nearest
 *  Sunday that is today-or-later: if today IS Sunday, that's today (this
 *  week); otherwise the FOLLOWING Sunday. Flips over at the Saturday→Sunday
 *  boundary, Israel time — unchanged semantic from the original
 *  computeNextWeek(), just made timezone-safe. */
export function availabilityWeekStart(): string {
  const today = ilTodayYMD();
  const dow = ymdToUtcDate(today).getUTCDay();
  return dow === 0 ? today : addDaysYMD(today, 7 - dow);
}

/** The 7 { day, date, iso } entries (Sunday→Saturday) for the week starting
 *  on `weekStart`. Pure function of its input — works for any week, past,
 *  current, or future. */
export function weekDaysFor(weekStart: string): WeekDay[] {
  return HEB_DAYS.map((day, i) => {
    const iso = addDaysYMD(weekStart, i);
    const [, mm, dd] = iso.split("-");
    return { day, date: `${dd}.${mm}`, iso };
  });
}
