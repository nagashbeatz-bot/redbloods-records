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
