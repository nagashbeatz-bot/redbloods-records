import "server-only";
import { supabase } from "@/lib/supabase";
import { createAlertIfNotCoolingDown, updateAlertStatus } from "@/lib/agent/alerts-store";
import { isConfirmedShowStatus } from "@/lib/shows-finance-sync";
import { availabilityWeekStart, weekEndFor } from "@/lib/red-artists/week";
import {
  isWeekClosed, weekUnderstaffedEntityKey, weekStartFromEntityKey, type Activity,
} from "@/lib/week-strength-pure";

/**
 * "Week strength" agent alert — flags a week that isn't well-planned yet.
 *
 * Data sources for "significant activity" (deliberately three separate,
 * already-existing tables — no new one):
 *   • sessions.date              (excl. status "בוטל")
 *   • shows.date                 (only isConfirmedShowStatus — pipeline leads
 *                                 like "ליד חדש"/"ממתין לתשובה" don't count,
 *                                 same rule the Finance sync already uses)
 *   • red_films_productions.shoot_date (excl. status "בוטל")
 *
 * Two separate entry points, on purpose:
 *   • checkWeekStrengthAndAlert  — CREATES the alert, gated to the Friday
 *     10:00 window only (called from instrumentation.ts).
 *   • resolveWeekStrengthAlertsIfClosed — clears an already-open alert the
 *     moment its week becomes closed. Runs on every cron tick (cheap no-op
 *     when nothing is open) so it isn't tied to next Friday's check — this
 *     deliberately does NOT go through createAlertIfNotCoolingDown (whose
 *     cooldown-based dedup would eventually insert a duplicate "new" row for
 *     a week that stays open longer than the severity's cooldown window);
 *     it only ever flips an existing row to "handled" via updateAlertStatus.
 *
 * Deliberately NOT gated on MAI_AI_ENABLED — unlike the AI chat/report
 * recommendations, this is a plain deterministic scheduling check (no LLM
 * call), so it must keep running even while that kill-switch is off. Only
 * this check is exempt; nothing else in the AI/alerts system is touched —
 * the alert still lands in the same `agent_alerts` table other MAI-gated UI
 * (the dashboard card, /insights, /api/agent/alerts) reads from, so it only
 * becomes visible there once MAI_AI_ENABLED is turned back on.
 */

async function fetchWeekActivities(weekStart: string, weekEnd: string): Promise<Activity[]> {
  const [sessionsRes, showsRes, shootsRes] = await Promise.all([
    supabase.from("sessions").select("date, status").gte("date", weekStart).lte("date", weekEnd),
    supabase.from("shows").select("date, status").gte("date", weekStart).lte("date", weekEnd),
    supabase.from("red_films_productions").select("shoot_date, status").gte("shoot_date", weekStart).lte("shoot_date", weekEnd),
  ]);

  const activities: Activity[] = [];
  for (const s of sessionsRes.data ?? []) {
    if (!s.date || s.status === "בוטל") continue;
    activities.push({ date: s.date, kind: "session" });
  }
  for (const s of showsRes.data ?? []) {
    if (!s.date || !isConfirmedShowStatus(s.status)) continue;
    activities.push({ date: s.date, kind: "show" });
  }
  for (const s of shootsRes.data ?? []) {
    if (!s.shoot_date || s.status === "בוטל") continue;
    activities.push({ date: s.shoot_date, kind: "shoot" });
  }
  return activities;
}

/** Friday 10:00 job — creates the alert ONLY if next week isn't closed yet.
 *  Best-effort; never throws. */
export async function checkWeekStrengthAndAlert(): Promise<void> {
  try {
    const weekStart = availabilityWeekStart(); // next week's Sunday, relative to today (Friday)
    const weekEnd = weekEndFor(weekStart);
    const activities = await fetchWeekActivities(weekStart, weekEnd);
    if (isWeekClosed(activities)) return; // already well-planned — nothing to alert

    await createAlertIfNotCoolingDown({
      type: "week_understaffed",
      severity: "warning",
      title: "השבוע הבא עדיין לא סגור",
      message: "כרגע מתוכננת מעט פעילות לשבוע הבא. מומלץ להתחיל לסגור סשנים, הופעות או ימי צילום.",
      source: "scheduled",
      entityKey: weekUnderstaffedEntityKey(weekStart),
      metadata: { weekStart, weekEnd },
    });
  } catch (e) {
    console.error("[week-strength-notify] check failed:", e);
  }
}

/** Frequent resolve pass — clears any open week_understaffed alert the
 *  moment its week becomes closed. Cheap no-op when none are open.
 *  Best-effort; never throws. */
export async function resolveWeekStrengthAlertsIfClosed(): Promise<void> {
  try {
    const { data: openAlerts } = await supabase
      .from("agent_alerts")
      .select("id, entity_key")
      .eq("status", "new")
      .like("entity_key", "week_understaffed:%");
    if (!openAlerts || openAlerts.length === 0) return;

    for (const row of openAlerts) {
      const weekStart = row.entity_key ? weekStartFromEntityKey(row.entity_key) : null;
      if (!weekStart) continue;
      const weekEnd = weekEndFor(weekStart);
      const activities = await fetchWeekActivities(weekStart, weekEnd);
      if (isWeekClosed(activities)) {
        await updateAlertStatus(row.id, "handled");
      }
    }
  } catch (e) {
    console.error("[week-strength-notify] resolve failed:", e);
  }
}
