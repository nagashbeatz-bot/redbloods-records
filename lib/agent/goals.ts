/**
 * Business goals — stored in the existing settings KV table.
 * Keys: goal_monthly_revenue, goal_weekly_sessions, goal_monthly_victor, goal_monthly_completions
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import type { BusinessGoals, GoalsProgress } from "@/lib/types";

const DEFAULT_GOALS: BusinessGoals = {
  monthlyRevenue:      { target: 20000, currency: "₪" },
  weeklySessions:      { target: 8 },
  monthlyVictor:       { target: 12 },
  monthlyCompletions:  { target: 4 },
};

const GOAL_KEYS: Array<keyof BusinessGoals> = [
  "monthlyRevenue",
  "weeklySessions",
  "monthlyVictor",
  "monthlyCompletions",
];

function dbKey(goalKey: keyof BusinessGoals): string {
  return `goal_${goalKey.replace(/([A-Z])/g, "_$1").toLowerCase()}`;
}

export async function getGoals(): Promise<BusinessGoals> {
  const keys = GOAL_KEYS.map(dbKey);
  const { data } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", keys);

  const rows = new Map((data ?? []).map((r) => [r.key, r.value]));
  const result = { ...DEFAULT_GOALS } as BusinessGoals;

  for (const k of GOAL_KEYS) {
    const val = rows.get(dbKey(k));
    if (val) {
      (result as unknown as Record<string, unknown>)[k] = { ...(DEFAULT_GOALS as unknown as Record<string, unknown>)[k] as object, ...(val as object) };
    }
  }
  return result;
}

export async function updateGoal(
  goalKey: keyof BusinessGoals,
  value: BusinessGoals[typeof goalKey]
): Promise<void> {
  const key = dbKey(goalKey);
  await supabase
    .from("settings")
    .upsert(
      { key, value: value as unknown as Record<string, unknown> },
      { onConflict: "key" }
    );
}

// ── Progress computation ───────────────────────────────────────────────────────

/** Expected value = target * (dayOfMonth / daysInMonth) */
function expectedByNow(target: number): number {
  const now = new Date();
  const dom = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round(target * dom / daysInMonth);
}

const PAID_STATUSES = new Set(["שולם", "התקבל", "שולם חלקית"]);

export async function getGoalsProgress(month: string): Promise<GoalsProgress> {
  const goals = await getGoals();

  // ── Monthly revenue ───────────────────────────────────────────────────────
  const monthStart = `${month}-01`;
  const nextMonth  = (() => {
    const [y, m] = month.split("-").map(Number);
    return m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  })();

  const { data: incTxns } = await supabase
    .from("transactions")
    .select("amount")
    .neq("type", "הוצאה")
    .in("payment_status", Array.from(PAID_STATUSES))
    .gte("date", monthStart)
    .lt("date", nextMonth);

  const revenueActual = (incTxns ?? []).reduce((s, t) => s + (t.amount ?? 0), 0);
  const revExpected   = expectedByNow(goals.monthlyRevenue.target);

  // ── Weekly sessions ───────────────────────────────────────────────────────
  const now  = new Date();
  const dow  = now.getDay(); // 0=Sunday
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dow);
  const weekStartStr = weekStart.toISOString().split("T")[0];
  const todayStr     = now.toISOString().split("T")[0];

  const { data: doneSessions } = await supabase
    .from("sessions")
    .select("id")
    .gte("date", weekStartStr)
    .lte("date", todayStr)
    .in("status", ["הושלם", "בוצע"]);

  const sessionsActual = (doneSessions ?? []).length;

  // ── Monthly completions ────────────────────────────────────────────────────
  const { data: completedProjects } = await supabase
    .from("projects")
    .select("id")
    .gte("end_date", monthStart)
    .lt("end_date", nextMonth)
    .eq("is_hidden", false);

  const completionsActual  = (completedProjects ?? []).length;
  const completionsExpected = expectedByNow(goals.monthlyCompletions.target);

  // ── Victor (from vendor-store) ────────────────────────────────────────────
  let victorActual   = 0;
  let victorExpected = 0;
  try {
    const { getVictorMonthStats } = await import("@/lib/vendor-store");
    const vs = await getVictorMonthStats(month);
    victorActual   = vs.paceValue;
    victorExpected = vs.expectedByNow;
  } catch { /* ignore */ }

  return {
    monthlyRevenue: {
      target:        goals.monthlyRevenue.target,
      currency:      goals.monthlyRevenue.currency,
      actual:        revenueActual,
      expectedByNow: revExpected,
      pct:           revExpected > 0 ? revenueActual / revExpected : 1,
    },
    weeklySessions: {
      target: goals.weeklySessions.target,
      actual: sessionsActual,
      pct:    goals.weeklySessions.target > 0 ? sessionsActual / goals.weeklySessions.target : 1,
    },
    monthlyVictor: {
      target:        goals.monthlyVictor.target,
      actual:        victorActual,
      expectedByNow: victorExpected,
      pct:           victorExpected > 0 ? victorActual / victorExpected : 1,
    },
    monthlyCompletions: {
      target:        goals.monthlyCompletions.target,
      actual:        completionsActual,
      expectedByNow: completionsExpected,
      pct:           completionsExpected > 0 ? completionsActual / completionsExpected : 1,
    },
  };
}
