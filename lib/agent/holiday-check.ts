import "server-only";
import { supabase } from "@/lib/supabase";
import { isConnected, fetchEventsInRange } from "@/lib/google-calendar";
import type { AlertInput } from "@/lib/types";

/**
 * Upcoming-holiday alerts — a proactive nudge (~35 days out) to plan a release /
 * clip / campaign around a significant date.
 *
 * The DATE is ALWAYS read live from the connected Google Calendar (the subscribed
 * "חגים יהודיים" calendar) — never hardcoded. We only map the calendar's English
 * MAIN-DAY event titles to a slug + Hebrew display name. Matching the main-day
 * title (not "Eve"/"Day 2") means each holiday collapses to exactly one event.
 *
 * Scope: Agent Alerts / Dashboard only. severity "info" → sendAlertsAsNotifications
 * never pushes it, and this runs solely from the agent cron (never on refresh).
 */

// English Google-calendar title (exact, main day) → { slug, Hebrew display }.
const SIGNIFICANT_HOLIDAYS: { title: string; slug: string; he: string }[] = [
  { title: "Rosh Hashana",     slug: "rosh_hashana", he: "ראש השנה" },
  { title: "Sukkot (Day 1)",   slug: "sukkot",       he: "סוכות" },
  { title: "Hanukkah (Day 1)", slug: "hanukkah",     he: "חנוכה" },
  { title: "Purim",            slug: "purim",        he: "פורים" },
  { title: "Passover (Day 1)", slug: "pesach",       he: "פסח" },
  { title: "Yom HaAtzmaut",    slug: "independence", he: "יום העצמאות" },
  { title: "Lag BaOmer",       slug: "lag_baomer",   he: "ל״ג בעומר" },
  { title: "Shavuot",          slug: "shavuot",      he: "שבועות" },
];

const WINDOW_DAYS = 35;
// Google holiday calendars all carry this id suffix (e.g. iw.judaism#holiday@...).
const HOLIDAY_CAL_MARKER = "#holiday@";

/** Today's calendar date in Israel time, as YYYY-MM-DD. */
function ilTodayYMD(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

/** Whole calendar days from `todayYmd` to `ymd` (both YYYY-MM-DD), UTC-anchored. */
function daysBetween(todayYmd: string, ymd: string): number {
  const [ay, am, ad] = todayYmd.split("-").map(Number);
  const [by, bm, bd] = ymd.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/**
 * Read the calendar and return one AlertInput per significant holiday that falls
 * within the next WINDOW_DAYS. entityKey = upcoming_holiday:<slug>:<year>. Returns
 * [] when the calendar is not connected or on any error (best-effort).
 */
export async function checkUpcomingHolidays(): Promise<AlertInput[]> {
  try {
    if (!(await isConnected())) return [];
    const today = ilTodayYMD();
    const start = new Date(`${today}T00:00:00Z`);
    const end = new Date(start.getTime() + (WINDOW_DAYS + 1) * 86400000);

    const events = await fetchEventsInRange(start, end);
    const out: AlertInput[] = [];
    const seen = new Set<string>(); // one per slug:year within this run

    for (const ev of events) {
      if (!ev.isAllDay) continue;
      if (!(ev.calendarId ?? "").includes(HOLIDAY_CAL_MARKER)) continue;
      const title = (ev.title ?? "").trim();
      const match = SIGNIFICANT_HOLIDAYS.find((h) => h.title === title);
      if (!match) continue;

      const date = (ev.startTime ?? "").slice(0, 10); // all-day → "YYYY-MM-DD"
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const days = daysBetween(today, date);
      if (days < 0 || days > WINDOW_DAYS) continue; // only upcoming, within window

      const year = date.slice(0, 4);
      const key = `${match.slug}:${year}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        type: "upcoming_holiday",
        severity: "info",
        title: `🔥 ${match.he} מתקרב`,
        message: `בעוד ${days} ימים — כדאי לבדוק אם נרצה לתכנן ריליס / קליפ / קמפיין לתקופה.`,
        entityKey: `upcoming_holiday:${key}`,
        metadata: { holiday: match.slug, hebrew: match.he, date, daysUntil: days },
        suggestedActions: ["תכנן ריליס", "תכנן קליפ", "תכנן קמפיין"],
        source: "scheduled",
      });
    }
    return out;
  } catch (e) {
    console.error("[holiday-check] checkUpcomingHolidays error:", e);
    return [];
  }
}

/**
 * Persist a holiday alert ONLY if no row with this entity_key exists yet (any
 * status) → exactly one row per (holiday, year), ever. No duplicates across cron
 * runs, and a manual dismiss is respected (never re-created). Holiday-specific on
 * purpose: the shared createAlertIfNotCoolingDown (cooldown-based) is left
 * untouched, so no other rule's behavior changes. Returns true iff a row was
 * inserted this call.
 */
export async function createHolidayAlertIfAbsent(input: AlertInput): Promise<boolean> {
  if (!input.entityKey) return false;
  try {
    const { data: existing, error: readErr } = await supabase
      .from("agent_alerts")
      .select("id")
      .eq("entity_key", input.entityKey)
      .limit(1);
    if (readErr) {
      console.error(`[holiday-check] existence read failed for ${input.entityKey}:`, readErr.message);
      return false;
    }
    if (existing && existing.length > 0) return false; // already exists → no new row

    const { error: insErr } = await supabase.from("agent_alerts").insert({
      type: input.type,
      severity: input.severity ?? "info",
      title: input.title,
      message: input.message,
      related_project_id: null,
      related_client_id: null,
      metadata: input.metadata ?? {},
      suggested_actions: input.suggestedActions ?? [],
      source: input.source ?? "scheduled",
      status: "new",
      sent_notification: false,
      entity_key: input.entityKey,
    });
    if (insErr) {
      console.error(`[holiday-check] insert failed for ${input.entityKey}:`, insErr.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[holiday-check] createHolidayAlertIfAbsent crashed:", e);
    return false;
  }
}

/**
 * Auto-resolve stale holiday alerts — mark "handled" any still-open ("new")
 * upcoming_holiday alert whose entity_key is NOT among the currently-in-window
 * holidays (i.e. the holiday has passed / left the 35-day window). Scoped
 * STRICTLY to type "upcoming_holiday": it never reads or touches any other
 * agent_alerts row. Runs independently of the MAI_AI_ENABLED kill-switch, so a
 * holiday alert still closes on time even while Mai AI is off. Returns the count.
 */
export async function resolveStaleHolidayAlerts(activeEntityKeys: Set<string>): Promise<number> {
  try {
    const { data: open, error } = await supabase
      .from("agent_alerts")
      .select("id, entity_key")
      .eq("status", "new")
      .eq("type", "upcoming_holiday");
    if (error) {
      console.error("[holiday-check] resolveStaleHolidayAlerts read failed:", error.message);
      return 0;
    }
    const toResolve = (open ?? [])
      .filter((a) => a.entity_key && !activeEntityKeys.has(a.entity_key as string))
      .map((a) => a.id);
    if (toResolve.length === 0) return 0;
    const { error: updErr } = await supabase
      .from("agent_alerts")
      .update({ status: "handled", updated_at: new Date().toISOString() })
      .in("id", toResolve);
    if (updErr) {
      console.error("[holiday-check] resolveStaleHolidayAlerts update failed:", updErr.message);
      return 0;
    }
    return toResolve.length;
  } catch (e) {
    console.error("[holiday-check] resolveStaleHolidayAlerts crashed:", e);
    return 0;
  }
}

/**
 * Full self-contained holiday cycle: detect in-window holidays (from Google
 * Calendar), persist them (insert-if-absent → one row per entity_key), and
 * auto-resolve holiday alerts that left the window. Touches ONLY holiday alerts;
 * runs no other agent rule. Safe to call regardless of MAI_AI_ENABLED.
 */
export async function runHolidayAlertCycle(): Promise<{
  holidaysInWindow: number; newHolidayAlerts: number; holidaysResolved: number;
}> {
  const inputs = await checkUpcomingHolidays();
  const activeKeys = new Set(inputs.map((i) => i.entityKey).filter((k): k is string => !!k));
  let newHolidayAlerts = 0;
  for (const input of inputs) {
    if (await createHolidayAlertIfAbsent(input)) newHolidayAlerts++;
  }
  const holidaysResolved = await resolveStaleHolidayAlerts(activeKeys);
  return { holidaysInWindow: inputs.length, newHolidayAlerts, holidaysResolved };
}
