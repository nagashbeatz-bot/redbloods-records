/**
 * Israel-time date helpers for the COO.
 *
 * Own module on purpose: the COO must not import portal modules (the existing
 * `ilTodayYMD` lives in lib/red-artists/week.ts). Everything is DST-safe — the
 * wall-clock date comes from Intl with an explicit timeZone; day arithmetic is
 * pure UTC-anchored calendar math on YYYY-MM-DD strings. Never a fixed UTC offset,
 * never toISOString() for "today".
 */
export const COO_TZ = "Asia/Jerusalem";

/** `d`'s calendar date in Israel, YYYY-MM-DD. */
export function ilYmd(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: COO_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** `d`'s wall-clock time in Israel, HH:MM. */
export function ilTime(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: COO_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** Strict YYYY-MM-DD (a trailing time part like "T00:00:00" is tolerated). Anything else → null. */
export function parseYmd(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Whole calendar days from `fromYmd` to `toYmd` (positive when `toYmd` is later). */
export function diffDays(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** "YYYY-MM" of a YYYY-MM-DD. */
export const monthOf = (ymd: string) => ymd.slice(0, 7);

/** Previous calendar month key for a YYYY-MM key. */
export function prevMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
export function weekdayHe(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Whole days between an ISO timestamp and `now` (floor). null when unparsable. */
export function daysSinceIso(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}

/** "05.10" style short date for display. */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}.${m}`;
}
/** "05.10.2026" */
export function fullDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}
