/**
 * Business snapshot — aggregates everything into one JSON.
 * Used for "Export AI Context" feature (copy to clipboard → paste in ChatGPT).
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import { listProjects } from "@/lib/projects-store";
import { getAlerts } from "./alerts-store";
import { getGoalsProgress } from "./goals";

// "חלקי" is intentionally NOT here — partial is treated as not-yet-received.
const PAID_STATUSES = new Set(["שולם", "התקבל"]);

export async function buildSnapshot() {
  const now   = new Date();
  const today = now.toISOString().split("T")[0];
  const month = today.slice(0, 7);

  // Projects
  const rawProjects = await listProjects();
  const DONE = new Set(["הושלם", "בהשהייה"]);
  const activeProjects = rawProjects.filter((p) => !DONE.has(p.status));
  const overdueProjects = rawProjects.filter((p) => p.isOverdue && p.status !== "הושלם");

  // Finance settings (agreed prices)
  const { data: financeRows } = await supabase
    .from("settings")
    .select("key, value")
    .like("key", "finance_%");
  const financeMap = new Map<string, Record<string, unknown>>();
  for (const row of financeRows ?? []) {
    financeMap.set(row.key.replace("finance_", ""), row.value as Record<string, unknown>);
  }

  // Transactions (last 30 days for context)
  const thirtyAgo = new Date(now);
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const { data: txns } = await supabase
    .from("transactions")
    .select("project_id, amount, currency, type, payment_status, date, description")
    .gte("created_at", thirtyAgo.toISOString())
    .order("created_at", { ascending: false });

  const revenueThisMonth  = (txns ?? []).filter((t) => t.type !== "הוצאה" && PAID_STATUSES.has(t.payment_status) && t.date?.startsWith(month)).reduce((s, t) => s + (t.amount ?? 0), 0);
  const pendingRevenue    = (txns ?? []).filter((t) => t.type !== "הוצאה" && !PAID_STATUSES.has(t.payment_status)).reduce((s, t) => s + (t.amount ?? 0), 0);
  const expensesThisMonth = (txns ?? []).filter((t) => t.type === "הוצאה" && t.date?.startsWith(month)).reduce((s, t) => s + (t.amount ?? 0), 0);

  // Sessions (this month)
  const { data: sessions } = await supabase
    .from("sessions")
    .select("project_id, date, status, start_time")
    .gte("date", `${month}-01`)
    .order("date", { ascending: true });

  const sessionsDone     = (sessions ?? []).filter((s) => s.status === "הושלם" || s.status === "בוצע").length;
  const sessionsUpcoming = (sessions ?? []).filter((s) => s.status === "נקבע" && s.date >= today).length;
  const sessionsOverdue  = (sessions ?? []).filter((s) => s.status === "נקבע" && s.date < today).length;

  // Victor
  let victorSummary: Record<string, unknown> = {};
  try {
    const { getVictorMonthStats } = await import("@/lib/vendor-store");
    const vs = await getVictorMonthStats(month);
    victorSummary = {
      active: vs.active, stuck: vs.stuck, belowPace: vs.paceValue < vs.expectedByNow,
      paceValue: vs.paceValue, expectedByNow: vs.expectedByNow, goal: vs.goal,
      needsReview: vs.needsReview, needsFix: vs.needsFix,
    };
  } catch { /* ignore */ }

  // Open alerts
  const openAlerts = await getAlerts({ status: "new", limit: 20, sinceHours: 7 * 24 });

  // Goals progress
  let goalsProgress: Record<string, unknown> = {};
  try {
    const gp = await getGoalsProgress(month);
    goalsProgress = {
      revenue:     { actual: Math.round(revenueThisMonth), expected: gp.monthlyRevenue.expectedByNow, target: gp.monthlyRevenue.target, currency: gp.monthlyRevenue.currency },
      sessions:    { actual: sessionsThisMonth(), target: gp.weeklySessions.target },
      victor:      { actual: victorSummary.paceValue, expected: victorSummary.expectedByNow, target: gp.monthlyVictor.target },
    };
  } catch { /* ignore */ }

  function sessionsThisMonth(): number {
    return (sessions ?? []).filter((s) => (s.status === "הושלם" || s.status === "בוצע") && s.date?.startsWith(month)).length;
  }

  // Open questions
  const openQuestions: string[] = [];
  const noPrice = activeProjects.filter((p) => !financeMap.get(p.id)?.agreedPrice);
  if (noPrice.length > 0) openQuestions.push(`${noPrice.length} פרויקטים פעילים ללא מחיר מוגדר`);
  if (overdueProjects.length > 0) openQuestions.push(`${overdueProjects.length} פרויקטים עברו דדליין`);
  if (pendingRevenue > 0) openQuestions.push(`${pendingRevenue.toLocaleString("he-IL")}₪ ממתינים לגבייה`);
  if (sessionsOverdue > 0) openQuestions.push(`${sessionsOverdue} סשנים דורשים עדכון סטטוס`);
  if ((victorSummary.stuck as number) > 0) openQuestions.push(`${victorSummary.stuck} פרויקטים תקועים אצל ויקטור`);

  // Project details
  const projectDetails = activeProjects.slice(0, 20).map((p) => {
    const finance = financeMap.get(p.id);
    return {
      name:    p.name,
      artist:  p.artist,
      status:  p.status,
      deadline: p.deadline,
      isOverdue: p.isOverdue,
      agreedPrice: (finance?.agreedPrice as number | null) ?? null,
      currency: (finance?.currency as string | null) ?? "₪",
    };
  });

  return {
    generatedAt: now.toISOString(),
    summary: {
      activeProjects:  activeProjects.length,
      overdueProjects: overdueProjects.length,
      revenueThisMonth: Math.round(revenueThisMonth),
      pendingRevenue:   Math.round(pendingRevenue),
      expensesThisMonth: Math.round(expensesThisMonth),
      sessionsDone, sessionsUpcoming, sessionsOverdue,
    },
    projects: projectDetails,
    victor:   victorSummary,
    goals:    goalsProgress,
    openAlerts: openAlerts.map((a) => ({
      type:     a.type,
      severity: a.severity,
      title:    a.title,
      message:  a.message,
    })),
    openQuestions,
  };
}

/** Format snapshot as readable Hebrew text for copy-paste into ChatGPT */
export function formatSnapshotAsText(snapshot: Awaited<ReturnType<typeof buildSnapshot>>): string {
  const lines: string[] = [
    `=== REDBLOODS RECORDS — תמונת מצב עסקית ===`,
    `נוצר: ${new Date(snapshot.generatedAt).toLocaleString("he-IL")}`,
    ``,
    `📊 סיכום:`,
    `• פרויקטים פעילים: ${snapshot.summary.activeProjects}`,
    `• עברו דדליין: ${snapshot.summary.overdueProjects}`,
    `• הכנסות החודש: ${snapshot.summary.revenueThisMonth.toLocaleString("he-IL")}₪`,
    `• ממתין לגבייה: ${snapshot.summary.pendingRevenue.toLocaleString("he-IL")}₪`,
    `• סשנים התקיימו: ${snapshot.summary.sessionsDone}, מתוכננים: ${snapshot.summary.sessionsUpcoming}`,
    ``,
    `👥 ויקטור:`,
    `• פעיל: ${snapshot.victor.active ?? 0}, תקועים: ${snapshot.victor.stuck ?? 0}`,
    `• קצב: ${snapshot.victor.paceValue ?? 0}/${snapshot.victor.expectedByNow ?? 0} (יעד: ${snapshot.victor.goal ?? 0})`,
    ``,
    `⚠ שאלות פתוחות:`,
    ...snapshot.openQuestions.map((q) => `• ${q}`),
    ``,
    `🔴 התראות פעילות:`,
    ...snapshot.openAlerts.map((a) => `• [${a.severity}] ${a.title}: ${a.message}`),
    ``,
    `📋 פרויקטים פעילים (עד 20):`,
    ...snapshot.projects.map((p) =>
      `• ${p.name} (${p.artist}) — ${p.status}${p.deadline ? ` | דדליין: ${p.deadline}` : ""}${p.isOverdue ? " ⚠ בפיגור" : ""}${p.agreedPrice ? ` | מחיר: ${p.agreedPrice}${p.currency}` : " | ללא מחיר"}`
    ),
  ];
  return lines.join("\n");
}
