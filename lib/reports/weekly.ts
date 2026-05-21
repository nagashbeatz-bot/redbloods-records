/**
 * Weekly report: data fetching + HTML/text template + AI recommendations.
 * Sent every Sunday morning. SERVER ONLY.
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import { listProjects } from "@/lib/projects-store";
import type { GeneratedReport } from "./types";

// ── Hebrew date utils ─────────────────────────────────────────────────────────

const HE_DAYS   = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function heDate(d: Date): string {
  return `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function fmt(n: number, suffix = "₪"): string {
  return `${n.toLocaleString("he-IL", { maximumFractionDigits: 0 })}${suffix}`;
}

// ── Weekly data ───────────────────────────────────────────────────────────────

interface WeeklyData {
  weekRange:     string;
  generatedAt:   Date;
  // Projects
  activeCount:   number;
  overdueCount:  number;
  completedCount: number;
  // Sessions
  sessionsThisWeek:     number;
  sessionsNextWeek:     number;
  sessionsNeedingUpdate: number;
  // Finance
  revenueThisWeek:  number;
  expensesThisWeek: number;
  pendingTotal:     number;
  // Victor
  victorStuck:      number;
  victorActive:     number;
  victorBelowPace:  boolean;
  victorGoal:       number;
  victorPace:       number;
  victorExpected:   number;
  // Goals
  goals: Array<{ label: string; actual: number | string; target: number | string; pct: number; unit: string }>;
  // Open issues
  openIssues: string[];
}

const PAID_STATUSES = new Set(["שולם", "התקבל", "שולם חלקית"]);

export async function fetchWeeklyData(): Promise<WeeklyData> {
  const now      = new Date();
  const today    = now.toISOString().split("T")[0];
  const month    = today.slice(0, 7);

  // Week boundaries
  const dow      = now.getDay(); // 0=Sunday
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dow);
  const weekEnd   = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const nextWeekStart = new Date(weekEnd);
  nextWeekStart.setDate(weekEnd.getDate() + 1);
  const nextWeekEnd   = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

  const wsStr  = weekStart.toISOString().split("T")[0];
  const weStr  = weekEnd.toISOString().split("T")[0];
  const nwsStr = nextWeekStart.toISOString().split("T")[0];
  const nweStr = nextWeekEnd.toISOString().split("T")[0];

  const weekRange = `${wsStr.split("-").reverse().join(".")} – ${weStr.split("-").reverse().join(".")}`;

  // Projects
  const rawProjects = await listProjects();
  const DONE = new Set(["הושלם", "בהשהייה"]);
  const activeProjects  = rawProjects.filter((p) => !DONE.has(p.status));
  const overdueProjects = rawProjects.filter((p) => p.isOverdue && p.status !== "הושלם");

  // Completed this week
  const { data: completedRows } = await supabase
    .from("projects")
    .select("id")
    .gte("end_date", wsStr)
    .lte("end_date", weStr)
    .eq("is_hidden", false);
  const completedCount = (completedRows ?? []).length;

  // Sessions this week
  const { data: thisWeekSessions } = await supabase
    .from("sessions")
    .select("id, status, date, start_time")
    .gte("date", wsStr)
    .lte("date", weStr);
  const sessThisWeek = thisWeekSessions ?? [];
  const sessionsThisWeek = sessThisWeek.filter((s) =>
    s.status === "הושלם" || s.status === "בוצע"
  ).length;
  const sessionsNeedingUpdate = sessThisWeek.filter((s) => {
    if (s.status !== "נקבע") return false;
    if (s.date > today) return false;
    return true;
  }).length;

  // Sessions next week
  const { data: nextWeekSessions } = await supabase
    .from("sessions")
    .select("id")
    .gte("date", nwsStr)
    .lte("date", nweStr);
  const sessionsNextWeek = (nextWeekSessions ?? []).length;

  // Finance this week
  const weekMonthStart = `${month}-01`;
  const { data: txns } = await supabase
    .from("transactions")
    .select("amount, currency, type, payment_status")
    .gte("created_at", `${wsStr}T00:00:00`)
    .lte("created_at", `${weStr}T23:59:59`);

  const revenueThisWeek  = (txns ?? []).filter((t) => t.type !== "הוצאה" && PAID_STATUSES.has(t.payment_status)).reduce((s, t) => s + (t.amount ?? 0), 0);
  const expensesThisWeek = (txns ?? []).filter((t) => t.type === "הוצאה").reduce((s, t) => s + (t.amount ?? 0), 0);

  // Pending total (all time)
  const { data: pendingTxns } = await supabase
    .from("transactions")
    .select("amount")
    .neq("type", "הוצאה")
    .not("payment_status", "in", '("שולם","התקבל","שולם חלקית")');
  const pendingTotal = (pendingTxns ?? []).reduce((s, t) => s + (t.amount ?? 0), 0);

  // Victor
  let victorStuck      = 0;
  let victorActive     = 0;
  let victorBelowPace  = false;
  let victorGoal       = 12;
  let victorPace       = 0;
  let victorExpected   = 0;
  try {
    const { getVictorMonthStats, getVictorSettings } = await import("@/lib/vendor-store");
    const vs      = await getVictorSettings();
    const vstats  = await getVictorMonthStats(month);
    victorStuck     = vstats.stuck;
    victorActive    = vstats.active;
    victorBelowPace = vstats.paceValue < vstats.expectedByNow;
    victorGoal      = vstats.goal;
    victorPace      = vstats.paceValue;
    victorExpected  = vstats.expectedByNow;
    victorGoal      = vs.monthlyGoal;
  } catch { /* ignore */ }

  // Goals progress
  let goals: WeeklyData["goals"] = [];
  try {
    const { getGoalsProgress, getGoals } = await import("@/lib/agent/goals");
    const [gp, g] = await Promise.all([getGoalsProgress(month), getGoals()]);
    goals = [
      {
        label: "הכנסות חודשיות",
        actual: fmt(gp.monthlyRevenue.actual),
        target: fmt(gp.monthlyRevenue.target),
        pct: Math.min(gp.monthlyRevenue.pct, 1),
        unit: g.monthlyRevenue.currency,
      },
      {
        label: "סשנים השבוע",
        actual: sessionsThisWeek,
        target: g.weeklySessions.target,
        pct: Math.min(sessionsThisWeek / Math.max(g.weeklySessions.target, 1), 1),
        unit: "",
      },
      {
        label: "יעד ויקטור",
        actual: victorPace,
        target: victorGoal,
        pct: Math.min(victorExpected > 0 ? victorPace / victorExpected : 1, 1),
        unit: "",
      },
    ];
  } catch { /* ignore */ }

  // Open issues summary
  const openIssues: string[] = [];
  if (overdueProjects.length > 0) openIssues.push(`${overdueProjects.length} פרויקטים עברו דדליין`);
  if (pendingTotal > 0)           openIssues.push(`${fmt(pendingTotal)} ממתין לגבייה`);
  if (victorStuck > 0)            openIssues.push(`${victorStuck} פרויקטים תקועים אצל ויקטור`);
  if (sessionsNeedingUpdate > 0)  openIssues.push(`${sessionsNeedingUpdate} סשנים דורשים עדכון סטטוס`);

  return {
    weekRange, generatedAt: now,
    activeCount: activeProjects.length, overdueCount: overdueProjects.length, completedCount,
    sessionsThisWeek, sessionsNextWeek, sessionsNeedingUpdate,
    revenueThisWeek, expensesThisWeek, pendingTotal,
    victorStuck, victorActive, victorBelowPace, victorGoal, victorPace, victorExpected,
    goals, openIssues,
  };
}

// ── AI recommendations ────────────────────────────────────────────────────────

async function getWeeklyRecommendations(data: WeeklyData): Promise<string[]> {
  const ctx = [
    `שבוע: ${data.weekRange}`,
    `פרויקטים פעילים: ${data.activeCount}, עברו דדליין: ${data.overdueCount}, הושלמו השבוע: ${data.completedCount}`,
    `סשנים השבוע: ${data.sessionsThisWeek}, לשבוע הבא: ${data.sessionsNextWeek}`,
    `הכנסות השבוע: ${fmt(data.revenueThisWeek)}, הוצאות: ${fmt(data.expensesThisWeek)}, ממתין: ${fmt(data.pendingTotal)}`,
    `ויקטור: ${data.victorStuck} תקועים, ${data.victorBelowPace ? "מתחת לקצב" : "בקצב"}`,
  ].join("\n");

  const prompt = `אתה מנהל תפעול של סטודיו מוזיקה "Redbloods Records". סיכום שבועי:\n${ctx}\n\nתן בדיוק 3 המלצות עדיפות לשבוע הבא. כל המלצה: משפט אחד, עברית, קצר ומעשי. החזר JSON בלבד: {"recommendations": ["...", "...", "..."]}`;

  // OpenAI primary
  if (process.env.OPENAI_API_KEY) {
    try {
      const { openAIJSON, resolveModel } = await import("@/lib/providers/openai");
      const model = resolveModel("default");
      const { data, inputTokens, outputTokens } = await openAIJSON<{ recommendations: string[] }>(
        prompt, { model, maxTokens: 250, temperature: 0.65 }
      );
      void (async () => {
        try {
          const { trackAIUsage } = await import("@/lib/agent/budget");
          await trackAIUsage({ provider: "openai", model, action: "weekly_report_recommendations", source: "report", inputTokens, outputTokens });
        } catch { /* ignore */ }
      })();
      if (Array.isArray(data.recommendations) && data.recommendations.length >= 3) {
        return data.recommendations.slice(0, 3);
      }
    } catch { /* fallthrough to Groq */ }
  }

  // Groq fallback (optional)
  if (process.env.GROQ_API_KEY) {
    try {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" });
      const res = await client.chat.completions.create({
        model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 220, temperature: 0.65,
      });
      const parsed = JSON.parse(res.choices[0].message.content ?? "{}");
      if (Array.isArray(parsed.recommendations) && parsed.recommendations.length >= 3) {
        return parsed.recommendations.slice(0, 3);
      }
    } catch { /* fallthrough to static */ }
  }

  // Static fallback
  const recs = [];
  if (data.overdueCount > 0)     recs.push(`עדכן דדליינים ל-${data.overdueCount} פרויקטים שעברו תאריך`);
  if (data.sessionsNextWeek < 3) recs.push("קבע סשנים לשבוע הבא — לא מספיק מתוכננים");
  if (data.pendingTotal > 0)     recs.push(`גבה ${fmt(data.pendingTotal)} שממתינים לתשלום`);
  if (data.victorStuck > 0)      recs.push("שלח תזכורת לויקטור על פרויקטים תקועים");
  const defaults = ["בדוק פרויקטים פעילים ועדכן סטטוסים", "תכנן סשנים לשבוע הבא", "עדכן הכנסות ותשלומים"];
  for (const d of defaults) { if (recs.length < 3) recs.push(d); }
  return recs.slice(0, 3);
}

// ── Template ──────────────────────────────────────────────────────────────────

const CSS = `
  body   { margin:0; padding:0; background:#0D0D0D; font-family:Arial,Helvetica,sans-serif; direction:rtl; color:#E0E0E0; }
  .wrap  { max-width:600px; margin:0 auto; padding:20px 12px 40px; }
  .card  { background:#141414; border:1px solid #252525; border-radius:14px; padding:20px 24px; margin-bottom:16px; }
  .head  { background:linear-gradient(135deg,#0a2e1a,#0a1a2e); border:1px solid #2A2A2A; border-radius:14px; padding:24px 28px; margin-bottom:20px; }
  h1     { margin:0 0 4px; font-size:22px; font-weight:800; color:#F0F0F0; }
  .sub   { font-size:13px; color:#555; margin:0; }
  h2     { font-size:13px; font-weight:700; color:#888; letter-spacing:.06em; text-transform:uppercase; margin:0 0 12px; }
  .row   { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #1E1E1E; font-size:13px; }
  .row:last-child { border-bottom:none; }
  .lbl   { color:#666; }
  .val   { color:#D0D0D0; font-weight:500; }
  .val.r { color:#EF4444; }
  .val.a { color:#F59E0B; }
  .val.g { color:#10B981; }
  .bar-wrap { background:#1A1A1A; border-radius:4px; height:8px; overflow:hidden; margin-top:4px; }
  .bar-fill { height:100%; border-radius:4px; }
  .rec   { background:#1A1A1A; border-radius:10px; padding:10px 14px; margin-bottom:8px; font-size:13px; color:#D0D0D0; }
  .rec .n{ color:#A855F7; font-weight:700; margin-left:8px; }
  .issue { font-size:13px; color:#D0D0D0; padding:5px 0; border-bottom:1px solid #1E1E1E; }
  .issue:last-child { border-bottom:none; }
  .footer{ text-align:center; font-size:11px; color:#333; margin-top:24px; }
`;

function pctColor(pct: number): string {
  if (pct >= 0.8) return "#10B981";
  if (pct >= 0.5) return "#F59E0B";
  return "#EF4444";
}

export async function generateWeeklyReport(): Promise<GeneratedReport> {
  const data  = await fetchWeeklyData();
  const recs  = await getWeeklyRecommendations(data);
  const date  = heDate(data.generatedAt);
  const subject = `Redbloods OS — דוח שבועי | ${data.weekRange}`;

  const goalRows = data.goals.map(({ label, actual, target, pct }) => {
    const color = pctColor(pct);
    const pctPx = Math.round(pct * 100);
    return `
      <div class="row" style="flex-direction:column;gap:6px;align-items:flex-start;">
        <div style="display:flex;justify-content:space-between;width:100%;font-size:13px;">
          <span class="lbl">${label}</span>
          <span class="val">${actual} / ${target}</span>
        </div>
        <div class="bar-wrap" style="width:100%;">
          <div class="bar-fill" style="width:${pctPx}%;background:${color};"></div>
        </div>
      </div>`;
  }).join("");

  const issueRows = data.openIssues.length > 0
    ? data.openIssues.map((i) => `<div class="issue">⚠ ${i}</div>`).join("")
    : `<div class="issue" style="color:#444;font-style:italic;">אין בעיות פתוחות מיוחדות השבוע</div>`;

  const recRows = recs.map((r, i) => `<div class="rec"><span class="rec n">${i + 1}.</span>${r}</div>`).join("");

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head>
<body><div class="wrap">
  <div class="head">
    <h1>📊 דוח שבועי</h1>
    <p class="sub">${data.weekRange} · ${date}</p>
  </div>

  <div class="card">
    <h2>📈 סיכום השבוע</h2>
    <div class="row"><span class="lbl">פרויקטים פעילים</span><span class="val">${data.activeCount}</span></div>
    <div class="row"><span class="lbl">הושלמו השבוע</span><span class="val ${data.completedCount > 0 ? "g" : ""}">${data.completedCount}</span></div>
    <div class="row"><span class="lbl">עברו דדליין</span><span class="val ${data.overdueCount > 0 ? "r" : "g"}">${data.overdueCount}</span></div>
    <div class="row"><span class="lbl">סשנים התקיימו</span><span class="val">${data.sessionsThisWeek}</span></div>
    <div class="row"><span class="lbl">מתוכננים לשבוע הבא</span><span class="val ${data.sessionsNextWeek < 2 ? "a" : ""}">${data.sessionsNextWeek}</span></div>
    <div class="row"><span class="lbl">הכנסות השבוע</span><span class="val g">${fmt(data.revenueThisWeek)}</span></div>
    <div class="row"><span class="lbl">הוצאות השבוע</span><span class="val">${fmt(data.expensesThisWeek)}</span></div>
    <div class="row"><span class="lbl">ממתין לגבייה</span><span class="val ${data.pendingTotal > 0 ? "a" : ""}">${fmt(data.pendingTotal)}</span></div>
    <div class="row"><span class="lbl">ויקטור — פרויקטים תקועים</span><span class="val ${data.victorStuck > 0 ? "r" : "g"}">${data.victorStuck}</span></div>
  </div>

  ${data.goals.length > 0 ? `
  <div class="card">
    <h2>🎯 יעדים חודשיים</h2>
    ${goalRows}
  </div>` : ""}

  <div class="card">
    <h2>⚠ בעיות פתוחות</h2>
    ${issueRows}
  </div>

  <div class="card">
    <h2>🤖 המלצות לשבוע הבא</h2>
    ${recRows}
  </div>

  <div class="footer">Redbloods OS · דוח שבועי אוטומטי · ${data.generatedAt.toLocaleTimeString("he-IL")}</div>
</div></body></html>`;

  const text = [
    `📊 דוח שבועי — ${data.weekRange}`,
    "",
    `פרויקטים: ${data.activeCount} פעילים, ${data.completedCount} הושלמו, ${data.overdueCount} עברו דדליין`,
    `סשנים: ${data.sessionsThisWeek} התקיימו, ${data.sessionsNextWeek} לשבוע הבא`,
    `כסף: ${fmt(data.revenueThisWeek)} נכנסו, ${fmt(data.pendingTotal)} ממתין`,
    `ויקטור: ${data.victorStuck} תקועים`,
    "",
    "בעיות פתוחות:",
    ...data.openIssues.map((i) => `  • ${i}`),
    "",
    "המלצות לשבוע הבא:",
    ...recs.map((r, i) => `  ${i + 1}. ${r}`),
  ].join("\n");

  return { subject, html, text };
}
