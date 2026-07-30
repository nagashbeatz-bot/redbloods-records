/**
 * Pure decision logic behind the "week strength" agent alert — whether NEXT
 * week has enough planned activity yet. No DB/server imports; safe to import
 * from a plain tsx test script (mirrors lib/shalev-weekly-pure.ts's shape).
 */

export const TZ = "Asia/Jerusalem";

/** agent_alerts.type for this check — also the one type exempted from the
 *  MAI_AI_ENABLED kill-switch (see app/api/agent/alerts/route.ts, [id]/route.ts,
 *  and lib/week-strength-notify.ts's own doc comment for why). */
export const WEEK_STRENGTH_ALERT_TYPE = "week_understaffed";

export type ActivityKind = "session" | "show" | "shoot";
export interface Activity { date: string; kind: ActivityKind } // date = YYYY-MM-DD

/** A week is "closed" (well-planned) once it has ≥3 significant activities
 *  spread across ≥2 distinct days. Reminders/cancelled/irrelevant rows must
 *  already be filtered out of `activities` before calling this. */
export function isWeekClosed(activities: Activity[]): boolean {
  if (activities.length < 3) return false;
  const distinctDays = new Set(activities.map((a) => a.date));
  return distinctDays.size >= 2;
}

/** Friday 10:00–10:15 Asia/Jerusalem — a window (not a single minute) so a
 *  missed tick (redeploy/crash) can still fire later in the same window,
 *  same shape as isShalevWeeklyWindowOpen. DST-safe (Intl-based, never a
 *  fixed UTC offset). */
export function isWeekStrengthCheckWindowOpen(now: Date, tz: string = TZ): boolean {
  const dow = now.toLocaleString("en-US", { timeZone: tz, weekday: "short" }); // "Sun".."Sat"
  const hm  = now.toLocaleString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = hm.split(":").map(Number);
  return dow === "Fri" && h === 10 && m >= 0 && m <= 15;
}

const ENTITY_KEY_PREFIX = "week_understaffed:";

export function weekUnderstaffedEntityKey(weekStartYmd: string): string {
  return `${ENTITY_KEY_PREFIX}${weekStartYmd}`;
}

/** Parse the week-start YYYY-MM-DD back out of an entityKey built above, or
 *  null if it isn't one of ours. */
export function weekStartFromEntityKey(entityKey: string): string | null {
  if (!entityKey.startsWith(ENTITY_KEY_PREFIX)) return null;
  const ymd = entityKey.slice(ENTITY_KEY_PREFIX.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}
