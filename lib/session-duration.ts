/**
 * Canonical duration helper for a session's "HH:MM" start/end pair.
 *
 * Wraps past midnight: an end time at or before the start is treated as the
 * following day (e.g. 23:00 → 01:00 = 120 minutes) — matching how the sessions
 * API already writes a next-day calendar end (app/api/sessions/route.ts).
 *
 * Returns null when either time is missing or unparseable, or when the computed
 * span is 0 — callers that sum hours should treat null as 0 minutes.
 *
 * NOTE: This mirrors the (correct, midnight-aware) logic of `durationFromTimes`
 * in RehearsalModal. ScheduleModal's local `hmDiffMinutes` is intentionally NOT
 * midnight-aware and is left untouched — unifying it would change the duration
 * prefill for an existing cross-midnight session, i.e. alter existing behavior.
 */
export function sessionDurationMinutes(
  start?: string | null,
  end?: string | null,
): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  let d = (eh * 60 + em) - (sh * 60 + sm);
  if (d < 0) d += 24 * 60;
  return d > 0 ? d : null;
}

// ── Session end + "time passed ≠ happened" (Owner canon, A3 2026-09-27) ────────

/**
 * The day the clock-based auto-mark was retired (A3, Owner canon "time passed ≠ session happened").
 * A session status התקיים on a session that ENDED before this date may have been written by the old page-load
 * auto-mark (device clock) — it is "possibly auto-marked (legacy)". From this date on, התקיים is only ever written
 * by an explicit Owner action (a status button / the edit form / an approved Sunny primitive).
 */
export const AUTO_MARK_RETIRED_AT = "2026-09-27";

function hm(t?: string | null): [number, number] | null {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return [h, m];
}
const p2 = (n: number) => String(n).padStart(2, "0");
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${nd.getUTCFullYear()}-${p2(nd.getUTCMonth() + 1)}-${p2(nd.getUTCDate())}`;
}

/**
 * Local end of a session as "YYYY-MM-DDTHH:MM:SS" (no timezone — the same local wall clock the session is stored in).
 * Overnight-aware: an end at or before the start is the NEXT day (22:00–02:00 ends at 02:00 the day after).
 * No end → start + 1 hour (next day when that crosses midnight). No date → null. No start and no end → null.
 * Tolerates "HH:MM:SS" input. Pure (no clock).
 */
export function sessionEndLocal(date?: string | null, start?: string | null, end?: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const s = hm(start);
  const e = hm(end);
  if (!s && !e) return null;
  if (e) {
    const next = s ? e[0] * 60 + e[1] <= s[0] * 60 + s[1] : false;
    return `${next ? addDays(date, 1) : date}T${p2(e[0])}:${p2(e[1])}:00`;
  }
  const total = s![0] * 60 + s![1] + 60;
  const day = total >= 24 * 60 ? addDays(date, 1) : date;
  const t = total % (24 * 60);
  return `${day}T${p2(Math.floor(t / 60))}:${p2(t % 60)}:00`;
}

/** The device's local wall clock as "YYYY-MM-DDTHH:MM:SS" — DISPLAY ONLY (never a reason to write). */
export function localNowString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** Asia/Jerusalem wall clock as "YYYY-MM-DDTHH:MM:SS" (server-side readers; timezone-independent of the host). */
export function israelNowString(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}`;
}

/**
 * The session's end has passed — THE one rule for every screen, report, agent rule and Sunny (UI parity 2026-09-27):
 * overnight-aware; a dated session with no times ends at the end of its day (23:59:59); no date → never "passed".
 */
export function sessionEndPassed(s: { date?: string | null; start_time?: string | null; end_time?: string | null }, nowLocal: string): boolean {
  const end = sessionEndLocal(s.date, s.start_time, s.end_time) ?? (s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? `${s.date}T23:59:59` : null);
  return end != null && end < nowLocal;
}

/**
 * "עבר — לא אושר": a PLANNED session (מתוכנן) whose end has passed and that nobody has confirmed. Display only —
 * it is never counted as held and never written as held; the Owner confirms with an explicit התקיים / בוטל.
 */
export function isPastUnconfirmed(s: { status?: string | null; date?: string | null; start_time?: string | null; end_time?: string | null }, nowLocal: string): boolean {
  return s.status === "מתוכנן" && sessionEndPassed(s, nowLocal);
}

export const PAST_UNCONFIRMED_LABEL = "עבר — לא אושר";

/** A held status (התקיים) is "possibly auto-marked (legacy)" when the session ended on / before the day the auto-mark was retired. */
export function heldIsLegacyPossiblyAutoMarked(s: { status?: string | null; date?: string | null; start_time?: string | null; end_time?: string | null }): boolean {
  if (s.status !== "התקיים") return false;
  const end = sessionEndLocal(s.date, s.start_time, s.end_time) ?? (s.date ? `${s.date}T23:59:59` : null);
  return end == null || end.slice(0, 10) <= AUTO_MARK_RETIRED_AT; // ended on / before the retirement day (deploy happened during it)
}
