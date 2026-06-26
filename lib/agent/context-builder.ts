/**
 * Agent Context Builder — builds rich, page-aware context for מאי AI.
 *
 * Rules:
 *  • Always injected: page label + alerts sorted by severity (up to 15)
 *  • Page-specific: finance, team, projects, insights, clients, calendar
 *  • Entity-specific: selectedProjectId, selectedClientId
 *  • Budget-safe: summaries only, max 10 items per category
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import { getAlerts } from "./alerts-store";
import type { AlertSeverity } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

// Money actually received/paid. "חלקי" (partial) is intentionally NOT here — it
// is treated as not-yet-received, consistent with the rest of the system.
const PAID_STATUSES = new Set(["שולם", "התקבל"]);

const SEV_WEIGHT: Record<AlertSeverity, number> = {
  urgent: 4, important: 3, warning: 2, info: 1,
};

const SEV_HE: Record<AlertSeverity, string> = {
  urgent: "דחוף", important: "חשוב", warning: "שים לב", info: "מידע",
};

const PAGE_LABELS: Record<string, string> = {
  "/dashboard":       "דשבורד ראשי",
  "/projects":        "עמוד פרויקטים",
  "/insights":        "עמוד תובנות והתראות",
  "/finance":         "עמוד כספים",
  "/clients":         "עמוד לקוחות ואמנים",
  "/team":            "עמוד צוות (ויקטור)",
  "/setup/calendar":  "הגדרות יומן",
  "/setup/dropbox":   "הגדרות Dropbox",
  "/setup/reports":   "הגדרות דוחות",
};

function resolvePageLabel(page?: string): string {
  if (!page) return "עמוד לא ידוע";
  const exact = PAGE_LABELS[page];
  if (exact) return exact;
  const partial = Object.entries(PAGE_LABELS).find(([k]) => page.startsWith(k));
  return partial?.[1] ?? page;
}

// ── Public params ─────────────────────────────────────────────────────────────

export interface ContextParams {
  currentPage?:      string;
  selectedProjectId?: string;
  selectedClientId?:  string;
}

// ── Main builder ──────────────────────────────────────────────────────────────

export async function buildAgentContext(params: ContextParams): Promise<string> {
  const { currentPage, selectedProjectId, selectedClientId } = params;
  const now   = new Date();
  const today = now.toISOString().split("T")[0];
  const month = today.slice(0, 7);
  const page  = currentPage ?? "";

  const sections: string[] = [];

  // 1 ── Page label ─────────────────────────────────────────────────────────
  sections.push(`== עמוד נוכחי ==\nהמשתמש נמצא כעת ב: ${resolvePageLabel(page)}`);

  // 2 ── Alerts sorted by severity ─────────────────────────────────────────
  try {
    const raw = await getAlerts({ status: "new", limit: 30, sinceHours: 7 * 24 });
    if (raw.length > 0) {
      const sorted = [...raw].sort((a, b) => {
        const w = SEV_WEIGHT[b.severity] - SEV_WEIGHT[a.severity];
        return w !== 0 ? w : b.createdAt.localeCompare(a.createdAt);
      });
      const top = sorted.slice(0, 15);
      sections.push(
        `== התראות פתוחות (${raw.length} סה"כ, מוצגות ${top.length} לפי חומרה) ==\n` +
        top.map((a) => `• [${SEV_HE[a.severity]}] ${a.title}: ${a.message}`).join("\n")
      );
    }
  } catch { /* ignore */ }

  // 3 ── Page-specific context ──────────────────────────────────────────────
  if (page.startsWith("/finance")) {
    const ctx = await buildFinanceContext(month);
    if (ctx) sections.push(ctx);
  }

  if (page.startsWith("/team")) {
    const ctx = await buildTeamContext(month);
    if (ctx) sections.push(ctx);
  }

  if (page.startsWith("/projects")) {
    const ctx = await buildProjectsEnrichment(today);
    if (ctx) sections.push(ctx);
  }

  if (page.startsWith("/insights")) {
    const ctx = await buildInsightsContext();
    if (ctx) sections.push(ctx);
  }

  if (page.startsWith("/clients")) {
    const ctx = await buildClientsContext(selectedClientId);
    if (ctx) sections.push(ctx);
  }

  if (page.startsWith("/calendar") || page === "/setup/calendar") {
    const ctx = await buildCalendarPageContext(today, month);
    if (ctx) sections.push(ctx);
  }

  // 3b ── Proposals overview (always included — brief, high value) ─────────
  try {
    const { data: allProposals } = await supabase
      .from("proposals")
      .select("id, title, amount, currency, status, followup_date, client_id")
      .order("followup_date", { ascending: true, nullsFirst: false });

    const CLOSED = new Set(["נסגר", "לא נסגר"]);
    const open = (allProposals ?? []).filter((p) => !CLOSED.has(p.status));
    if (open.length > 0) {
      const overdue  = open.filter((p) => p.followup_date && p.followup_date < today);
      const todayDue = open.filter((p) => p.followup_date === today);
      const potential = open.filter((p) => p.currency === "₪").reduce((s, p) => s + (p.amount ?? 0), 0);
      const lines = [`== הצעות מחיר פתוחות (${open.length}) ==`];
      if (overdue.length)  lines.push(`⚠ עבר תאריך מעקב: ${overdue.length}`);
      if (todayDue.length) lines.push(`📌 מעקב היום: ${todayDue.length}`);
      if (potential > 0)   lines.push(`פוטנציאל: ${fmt(potential)}₪`);
      lines.push("הצעות (עד 8 הכי דחופות):");
      [...overdue, ...todayDue, ...open.filter((p) => !overdue.includes(p) && !todayDue.includes(p))]
        .slice(0, 8)
        .forEach((p) => {
          const fu = p.followup_date
            ? (p.followup_date < today ? ` ⚠ מעקב פג (${p.followup_date})` : ` | מעקב: ${p.followup_date}`)
            : "";
          lines.push(`  • ${p.title} | ${p.status}${p.amount > 0 ? ` | ${fmt(p.amount)}${p.currency}` : ""}${fu}`);
        });
      sections.push(lines.join("\n"));
    }
  } catch { /* ignore */ }

  // 4 ── Selected entity context (always, regardless of page) ──────────────
  if (selectedProjectId) {
    const ctx = await buildProjectDetailContext(selectedProjectId, today, month);
    if (ctx) sections.push(ctx);
  }

  if (selectedClientId) {
    const ctx = await buildClientDetailContext(selectedClientId);
    if (ctx) sections.push(ctx);
  }

  return "\n\n" + sections.filter(Boolean).join("\n\n");
}

// ── Finance context ───────────────────────────────────────────────────────────

async function buildFinanceContext(month: string): Promise<string> {
  try {
    const lines: string[] = [`== כספים — ${month} ==`];

    // Transactions: this month + older pending income
    const monthStart = `${month}-01`;
    const [{ data: monthTxns }, { data: oldPending }] = await Promise.all([
      supabase
        .from("transactions")
        .select("project_id, amount, currency, type, payment_status, date, description")
        .gte("date", monthStart)
        .order("date", { ascending: false })
        .limit(150),
      supabase
        .from("transactions")
        .select("project_id, amount, currency, type, payment_status, date, description")
        .lt("date", monthStart)
        .not("payment_status", "in", '("שולם","התקבל")')
        .neq("type", "הוצאה")
        .order("date", { ascending: true })
        .limit(30),
    ]);

    // Build project name map
    const allTxns = [...(monthTxns ?? []), ...(oldPending ?? [])];
    const pids = [...new Set(allTxns.map((t) => t.project_id).filter(Boolean))];
    const projMap = new Map<string, string>();
    if (pids.length > 0) {
      const { data: projs } = await supabase
        .from("projects")
        .select("id, name, artist")
        .in("id", pids);
      (projs ?? []).forEach((p) => projMap.set(p.id, `${p.name}${p.artist ? ` (${p.artist})` : ""}`));
    }

    // Month totals
    const mt = monthTxns ?? [];
    const revenueReceived = mt
      .filter((t) => t.type !== "הוצאה" && PAID_STATUSES.has(t.payment_status))
      .reduce((s, t) => s + (t.amount ?? 0), 0);
    const revenuePending = allTxns
      .filter((t) => t.type !== "הוצאה" && !PAID_STATUSES.has(t.payment_status))
      .reduce((s, t) => s + (t.amount ?? 0), 0);
    const expensesPaid = mt
      .filter((t) => t.type === "הוצאה" && PAID_STATUSES.has(t.payment_status))
      .reduce((s, t) => s + (t.amount ?? 0), 0);
    const expensesPending = mt
      .filter((t) => t.type === "הוצאה" && !PAID_STATUSES.has(t.payment_status))
      .reduce((s, t) => s + (t.amount ?? 0), 0);

    lines.push(`הכנסות שהתקבלו: ${fmt(revenueReceived)}₪`);
    lines.push(`הכנסות ממתינות: ${fmt(revenuePending)}₪`);
    lines.push(`הוצאות ששולמו: ${fmt(expensesPaid)}₪`);
    lines.push(`הוצאות צפויות: ${fmt(expensesPending)}₪`);
    lines.push(`נטו בפועל: ${fmt(revenueReceived - expensesPaid)}₪`);

    // Top pending income items (up to 10, by amount desc)
    const pendingIncome = allTxns
      .filter((t) => t.type !== "הוצאה" && !PAID_STATUSES.has(t.payment_status))
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      .slice(0, 10);

    if (pendingIncome.length > 0) {
      lines.push(`\nתשלומים שטרם התקבלו (עד 10, לפי סכום):`);
      pendingIncome.forEach((t) => {
        const proj = t.project_id ? (projMap.get(t.project_id) ?? "לא ידוע") : "כללי";
        const date = t.date ? ` | ${t.date}` : "";
        lines.push(`• ${fmt(t.amount ?? 0)}${t.currency ?? "₪"} — ${proj}${date} [${t.payment_status ?? "ממתין"}]`);
      });
    }

    // Recent large expenses (up to 5)
    const bigExpenses = mt
      .filter((t) => t.type === "הוצאה")
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      .slice(0, 5);

    if (bigExpenses.length > 0) {
      lines.push(`\nהוצאות גדולות החודש:`);
      bigExpenses.forEach((t) => {
        const desc = t.description ? ` — ${t.description}` : "";
        lines.push(`• ${fmt(t.amount ?? 0)}${t.currency ?? "₪"}${desc} [${t.payment_status}]`);
      });
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// ── Team / Victor context ─────────────────────────────────────────────────────

async function buildTeamContext(month: string): Promise<string> {
  try {
    const lines: string[] = ["== צוות — ויקטור =="];

    const { getVictorMonthStats, getVictorWork } = await import("@/lib/vendor-store");
    const [stats, allWork] = await Promise.all([
      getVictorMonthStats(month),
      getVictorWork(),
    ]);

    const onPace = stats.paceValue >= stats.expectedByNow;
    lines.push(`יעד חודשי: ${stats.goal} | קצב: ${stats.paceValue} בפועל / ${stats.expectedByNow} צפוי עד עכשיו${onPace ? " ✓" : " ⚠ מתחת ליעד"}`);
    lines.push(`• פעילים: ${stats.active} | הושלמו החודש: ${stats.completed} | בוטלו: ${stats.cancelled}`);
    lines.push(`• תקועים: ${stats.stuck} | דורשים בדיקה: ${stats.needsReview} | דורשים תיקון: ${stats.needsFix}`);
    lines.push(`• אושרו: ${stats.approved} | נכנסו לפרויקט: ${stats.enteredProject}`);
    lines.push(`תשלום: ${stats.paymentStatus} | משכורת: ${stats.monthlySalary}${stats.salaryCurrency}`);

    // Active work — sort: stuck first, then by days since sent desc
    const active = allWork
      .filter((w) => w.status === "פעיל")
      .sort((a, b) => {
        if (a.isStuck !== b.isStuck) return a.isStuck ? -1 : 1;
        return (b.daysSinceSent ?? 0) - (a.daysSinceSent ?? 0);
      })
      .slice(0, 10);

    if (active.length > 0) {
      lines.push(`\nפרויקטים פעילים אצל ויקטור (${allWork.filter((w) => w.status === "פעיל").length} סה"כ, מוצגים ${active.length}):`);
      active.forEach((w) => {
        const stuck  = w.isStuck ? " ⚠ תקוע" : "";
        const days   = w.daysSinceSent !== null ? ` | ${w.daysSinceSent}ד'` : "";
        const state  = w.workState ? ` | ${w.workState}` : "";
        const ddl    = w.internalDeadline ? ` | דדליין: ${w.internalDeadline}` : "";
        lines.push(`• ${w.projectName} (${w.artist})${state}${days}${ddl}${stuck}`);
      });
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// ── Projects enrichment (cross-data: finance + sessions) ─────────────────────

async function buildProjectsEnrichment(today: string): Promise<string> {
  try {
    const lines: string[] = ["== מידע נוסף על פרויקטים =="];

    // Projects with no agreed price
    const { data: financeRows } = await supabase
      .from("settings")
      .select("key, value")
      .like("key", "finance_%");
    const pricedIds = new Set(
      (financeRows ?? [])
        .filter((r) => (r.value as Record<string, unknown>)?.agreedPrice)
        .map((r) => r.key.replace("finance_", ""))
    );

    // Stale sessions (past date, still "נקבע")
    const { data: staleSess } = await supabase
      .from("sessions")
      .select("project_id, date")
      .lt("date", today)
      .eq("status", "נקבע")
      .limit(50);
    const staleProjectIds = new Set((staleSess ?? []).map((s) => s.project_id));

    // Pending income by project (projects with open balance)
    const { data: pendingTxns } = await supabase
      .from("transactions")
      .select("project_id, amount")
      .neq("type", "הוצאה")
      .not("payment_status", "in", '("שולם","התקבל")')
      .not("project_id", "is", null)
      .limit(200);
    const pendingByProject = new Map<string, number>();
    (pendingTxns ?? []).forEach((t) => {
      if (t.project_id) {
        pendingByProject.set(t.project_id, (pendingByProject.get(t.project_id) ?? 0) + (t.amount ?? 0));
      }
    });

    lines.push(`פרויקטים עם מחיר מוגדר: ${pricedIds.size}`);
    lines.push(`פרויקטים עם סשנים שדורשים עדכון סטטוס: ${staleProjectIds.size}`);
    lines.push(`פרויקטים עם יתרה פתוחה: ${pendingByProject.size}`);

    if (pendingByProject.size > 0) {
      const top = [...pendingByProject.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      lines.push(`גבוהים ביותר:`);
      top.forEach(([id, amt]) => lines.push(`  • project_id ${id} — ${fmt(amt)}₪`));
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// ── Insights context (categorised alerts) ────────────────────────────────────

async function buildInsightsContext(): Promise<string> {
  try {
    const raw = await getAlerts({ status: "new", limit: 50, sinceHours: 7 * 24 });
    if (raw.length === 0) return "";

    const CATEGORIES: Array<{ key: string; label: string; types: string[] }> = [
      { key: "deadline", label: "דדליינים", types: ["overdue_deadline", "deadline_approaching"] },
      { key: "finance",  label: "כספים",    types: ["payment_overdue", "project_no_pricing"] },
      { key: "sessions", label: "סשנים",    types: ["session_needs_update", "stale_session"] },
      { key: "victor",   label: "ויקטור",   types: ["victor_stuck", "victor_below_pace"] },
      { key: "activity", label: "חוסר פעילות", types: ["inactivity"] },
      { key: "goals",    label: "יעדים",    types: ["goal_behind"] },
    ];

    const lines: string[] = [`== תובנות — ריכוז התראות (${raw.length} פתוחות) ==`];

    CATEGORIES.forEach(({ label, types }) => {
      const items = raw.filter((a) => types.includes(a.type));
      if (items.length > 0) {
        lines.push(`${label} (${items.length}):`);
        items.slice(0, 5).forEach((a) => lines.push(`  • [${SEV_HE[a.severity]}] ${a.message}`));
      }
    });

    return lines.join("\n");
  } catch {
    return "";
  }
}

// ── Clients context ───────────────────────────────────────────────────────────

async function buildClientsContext(selectedClientId?: string): Promise<string> {
  try {
    const { listClients } = await import("@/lib/clients-store");
    const clients = await listClients();

    const lines: string[] = [`== לקוחות ואמנים (${clients.length} סה"כ) ==`];

    const byStatus: Record<string, number> = {};
    clients.forEach((c) => { byStatus[c.status] = (byStatus[c.status] ?? 0) + 1; });
    lines.push(Object.entries(byStatus).map(([s, n]) => `${s}: ${n}`).join(" | "));

    const vip = clients.filter((c) => c.status === "VIP");
    if (vip.length > 0) lines.push(`VIP: ${vip.map((c) => c.name).join(", ")}`);

    const noContact = clients.filter((c) => !c.email && !c.phone);
    if (noContact.length > 0) lines.push(`ללא פרטי קשר: ${noContact.length} (${noContact.slice(0, 5).map((c) => c.name).join(", ")})`);

    if (selectedClientId) {
      const detail = await buildClientDetailContext(selectedClientId);
      if (detail) lines.push("\n" + detail);
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// ── Client detail context ─────────────────────────────────────────────────────

async function buildClientDetailContext(clientId: string): Promise<string> {
  try {
    const { getClient } = await import("@/lib/clients-store");
    const client = await getClient(clientId);
    if (!client) return "";

    const lines: string[] = [`== לקוח/אמן נבחר: ${client.name} ==`];
    lines.push(`סוג: ${client.type} | סטטוס: ${client.status}`);
    if (client.notes) lines.push(`הערות: ${client.notes}`);

    // Projects for this client (by artist name)
    const { data: projs } = await supabase
      .from("projects")
      .select("id, name, status, deadline, is_overdue")
      .ilike("artist", `%${client.name}%`)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (projs && projs.length > 0) {
      const active = projs.filter((p) => p.status !== "הושלם" && p.status !== "בהשהייה");
      const done   = projs.filter((p) => p.status === "הושלם");
      lines.push(`פרויקטים: ${projs.length} סה"כ | פעילים: ${active.length} | הושלמו: ${done.length}`);
      if (active.length > 0) {
        lines.push(`פעילים:`);
        active.slice(0, 5).forEach((p) => {
          const ddl = p.deadline ? ` | דדליין: ${p.deadline}` : "";
          const ov  = p.is_overdue ? " ⚠ בפיגור" : "";
          lines.push(`  • ${p.name} (${p.status})${ddl}${ov}`);
        });
      }
    }

    // Pending revenue for this client
    const projIds = (projs ?? []).map((p) => p.id);
    if (projIds.length > 0) {
      const { data: txns } = await supabase
        .from("transactions")
        .select("amount, currency, payment_status, date, type")
        .in("project_id", projIds)
        .neq("type", "הוצאה")
        .not("payment_status", "in", '("שולם","התקבל")');

      const pending = (txns ?? []).reduce((s, t) => s + (t.amount ?? 0), 0);
      if (pending > 0) lines.push(`יתרה פתוחה: ${fmt(pending)}₪`);
    }

    // Proposals for this client
    const { data: props } = await supabase
      .from("proposals")
      .select("title, amount, currency, status, followup_date")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (props && props.length > 0) {
      const todayStr = new Date().toISOString().split("T")[0];
      const CLOSED = new Set(["נסגר", "לא נסגר"]);
      const open   = props.filter((p) => !CLOSED.has(p.status));
      if (open.length > 0) {
        lines.push(`\nהצעות מחיר פתוחות (${open.length}):`);
        open.forEach((p) => {
          const fu = p.followup_date
            ? (p.followup_date < todayStr ? ` ⚠ פג מעקב (${p.followup_date})` : ` | מעקב: ${p.followup_date}`)
            : "";
          lines.push(`  • ${p.title} | ${p.status}${p.amount > 0 ? ` | ${fmt(p.amount)}${p.currency}` : ""}${fu}`);
        });
      }
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// ── Calendar / sessions page context ─────────────────────────────────────────

async function buildCalendarPageContext(today: string, month: string): Promise<string> {
  try {
    const lines: string[] = ["== יומן וסשנים =="];

    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = weekEnd.toISOString().split("T")[0];

    const [{ data: todaySess }, { data: weekSess }, { data: staleSess }] = await Promise.all([
      supabase.from("sessions").select("project_id, date, start_time, end_time, status, session_type, notes")
        .eq("date", today).order("start_time", { ascending: true }),
      supabase.from("sessions").select("project_id, date, start_time, status, session_type")
        .gt("date", today).lte("date", weekEndStr).eq("status", "נקבע")
        .order("date", { ascending: true }).limit(20),
      supabase.from("sessions").select("project_id, date, status")
        .lt("date", today).eq("status", "נקבע").limit(20),
    ]);

    // Build project map
    const allPids = [
      ...(todaySess ?? []), ...(weekSess ?? []), ...(staleSess ?? [])
    ].map((s) => s.project_id).filter(Boolean);
    const uniquePids = [...new Set(allPids)];
    const projMap = new Map<string, string>();
    if (uniquePids.length > 0) {
      const { data: projs } = await supabase.from("projects").select("id, name, artist").in("id", uniquePids);
      (projs ?? []).forEach((p) => projMap.set(p.id, `${p.name} (${p.artist})`));
    }

    // Today
    if ((todaySess ?? []).length > 0) {
      lines.push(`סשנים היום (${todaySess!.length}):`);
      todaySess!.forEach((s) => {
        const proj = projMap.get(s.project_id) ?? "פרויקט לא ידוע";
        const time = s.start_time ? ` ${s.start_time.slice(0, 5)}${s.end_time ? `–${s.end_time.slice(0, 5)}` : ""}` : "";
        lines.push(`  • ${proj}${time} [${s.status}]${s.notes ? ` — ${s.notes}` : ""}`);
      });
    } else {
      lines.push("אין סשנים היום.");
    }

    // Week
    if ((weekSess ?? []).length > 0) {
      lines.push(`סשנים קרובים השבוע (${weekSess!.length}):`);
      weekSess!.slice(0, 10).forEach((s) => {
        const proj = projMap.get(s.project_id) ?? "פרויקט לא ידוע";
        const time = s.start_time ? ` ${s.start_time.slice(0, 5)}` : "";
        lines.push(`  • ${s.date}${time} — ${proj}`);
      });
    }

    // Stale sessions
    if ((staleSess ?? []).length > 0) {
      lines.push(`סשנים שעברו ולא עודכנו: ${staleSess!.length} (דורשים עדכון סטטוס)`);
      staleSess!.slice(0, 5).forEach((s) => {
        const proj = projMap.get(s.project_id) ?? "פרויקט לא ידוע";
        lines.push(`  • ${s.date} — ${proj}`);
      });
    }

    // Sessions with pending payment
    const { data: sessWithPayment } = await supabase
      .from("sessions")
      .select("project_id, date, notes")
      .gte("date", `${month}-01`)
      .not("notes", "is", null)
      .limit(50);

    // Check which projects have pending income txns
    const monthProjIds = [...new Set((sessWithPayment ?? []).map((s) => s.project_id).filter(Boolean))];
    if (monthProjIds.length > 0) {
      const { data: pendingTxns } = await supabase
        .from("transactions")
        .select("project_id, amount")
        .in("project_id", monthProjIds)
        .neq("type", "הוצאה")
        .not("payment_status", "in", '("שולם","התקבל")');
      const pendingProjIds = new Set((pendingTxns ?? []).map((t) => t.project_id));
      const sessWithOpenMoney = (sessWithPayment ?? []).filter((s) => pendingProjIds.has(s.project_id));
      if (sessWithOpenMoney.length > 0) {
        lines.push(`פרויקטים עם סשנים + יתרה פתוחה: ${sessWithOpenMoney.length}`);
      }
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// ── Project detail context ────────────────────────────────────────────────────

async function buildProjectDetailContext(
  projectId: string,
  today: string,
  month: string
): Promise<string> {
  try {
    // Fetch all in parallel
    const [
      { data: proj },
      { data: finRow },
      { data: txns },
      { data: sessions },
    ] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("settings").select("value").eq("key", `finance_${projectId}`).maybeSingle(),
      supabase.from("transactions")
        .select("amount, currency, type, payment_status, date, description, expense_scope, category")
        .eq("project_id", projectId)
        .order("date", { ascending: false })
        .limit(50),
      supabase.from("sessions")
        .select("date, start_time, end_time, status, session_type, notes, photographer, location")
        .eq("project_id", projectId)
        .order("date", { ascending: false })
        .limit(10),
    ]);

    if (!proj) return "";

    const lines: string[] = [`== פרויקט נבחר: ${proj.name} ==`];
    lines.push(`אמן: ${proj.artist || "לא צוין"} | סטטוס: ${proj.status} | סוג: ${proj.project_type || "—"}`);
    if (proj.deadline) {
      const isOverdue = proj.is_overdue ? " ⚠ בפיגור" : "";
      lines.push(`דדליין: ${proj.deadline}${isOverdue}`);
    }
    if (proj.start_date) lines.push(`התחלה: ${proj.start_date}`);
    if (proj.end_date)   lines.push(`הסתיים: ${proj.end_date}`);
    if (proj.notes)      lines.push(`הערות: ${proj.notes}`);

    // Finance
    const finance = finRow?.value as Record<string, unknown> | null;
    if (finance) {
      const agreed  = (finance.agreedPrice as number | null) ?? null;
      const curr    = (finance.currency   as string) ?? "₪";
      if (agreed) {
        const received = (txns ?? [])
          .filter((t) => t.type !== "הוצאה" && PAID_STATUSES.has(t.payment_status))
          .reduce((s, t) => s + (t.amount ?? 0), 0);
        const balance = agreed - received;
        lines.push(`מחיר מוסכם: ${fmt(agreed)}${curr} | שולם: ${fmt(received)}${curr} | יתרה: ${fmt(balance)}${curr}`);
      }
    } else {
      lines.push("מחיר: לא הוגדר");
    }

    // Pending transactions
    const pendingTxns = (txns ?? []).filter(
      (t) => t.type !== "הוצאה" && !PAID_STATUSES.has(t.payment_status)
    );
    if (pendingTxns.length > 0) {
      lines.push(`תשלומים ממתינים (${pendingTxns.length}):`);
      pendingTxns.slice(0, 5).forEach((t) => {
        const desc = t.description ? ` — ${t.description}` : "";
        lines.push(`  • ${fmt(t.amount ?? 0)}${t.currency ?? "₪"}${desc} [${t.payment_status}]`);
      });
    }

    // Sessions
    if ((sessions ?? []).length > 0) {
      const past    = sessions!.filter((s) => s.date <= today).slice(0, 5);
      const future  = sessions!.filter((s) => s.date > today);
      lines.push(`סשנים אחרונים (${past.length}):`);
      past.forEach((s) => {
        const time = s.start_time ? ` ${s.start_time.slice(0, 5)}` : "";
        lines.push(`  • ${s.date}${time} [${s.status}]${s.notes ? ` — ${s.notes}` : ""}`);
      });
      if (future.length > 0) {
        lines.push(`סשן הבא: ${future[0].date}${future[0].start_time ? ` ${future[0].start_time.slice(0, 5)}` : ""}`);
      }
    } else {
      lines.push("אין סשנים מתועדים לפרויקט זה.");
    }

    // Victor work for this project
    let victorConnected = false;
    try {
      const { getVictorWorkForProject } = await import("@/lib/vendor-store");
      const vw = await getVictorWorkForProject(projectId);
      if (vw) {
        victorConnected = true;
        lines.push(`ויקטור: ${vw.status}${vw.workState ? ` — ${vw.workState}` : ""}${vw.isStuck ? " ⚠ תקוע" : ""}`);
        if (vw.sentDate)     lines.push(`  נשלח: ${vw.sentDate}${vw.daysSinceSent !== null ? ` (לפני ${vw.daysSinceSent} ימים)` : ""}`);
        if (vw.returnedDate) lines.push(`  חזר: ${vw.returnedDate}`);
        if (vw.outcome)      lines.push(`  תוצאה: ${vw.outcome}`);
        if (vw.notes)        lines.push(`  הערות: ${vw.notes}`);
      }
    } catch { /* ignore */ }

    // Sound engineer work for this project
    let soundEngineerConnected = false;
    let soundEngineerBalance = 0;
    let soundEngineerHasTx = false;
    try {
      const { getSoundEngineerWorkForProject } = await import("@/lib/sound-engineer-store");
      const sw = await getSoundEngineerWorkForProject(projectId);
      if (sw) {
        soundEngineerConnected = true;
        soundEngineerBalance   = sw.balance;
        soundEngineerHasTx     = !!sw.linkedTransactionId;
        lines.push(`איש סאונד חיצוני: ${sw.engineerName} — ${sw.workType} | סטטוס: ${sw.status}`);
        if (sw.agreedPrice > 0) {
          lines.push(`  מחיר: ${sw.currency}${sw.agreedPrice} | שולם: ${sw.currency}${sw.amountPaid} | יתרה: ${sw.currency}${sw.balance}`);
          lines.push(`  הוצאה בכספים: ${sw.linkedTransactionId ? "✓ רשומה" : "⚠ לא נרשמה — לסנכרן"}`);
        } else {
          lines.push(`  מחיר: לא הוגדר`);
        }
        if (sw.internalDeadline) lines.push(`  דדליין פנימי: ${sw.internalDeadline}`);
        if (sw.filesLink)        lines.push(`  לינק קבצים: קיים`);
        if (sw.notes)            lines.push(`  הערות: ${sw.notes}`);
      }
    } catch { /* ignore */ }

    // ── Explicit "missing" summary — helps AI answer "מה חסר?" ──────────────
    // Checks are context-aware: different checks per project status
    const status: string = (proj.status as string) ?? "";
    const isMixStage = status === "מחכה למיקס" || status === "במיקס";
    const isDone     = status === "הושלם";

    const missing: string[] = [];

    // Always required
    if (!proj.artist)       missing.push("אמן לא מוגדר");
    if (!proj.project_type) missing.push("סוג פרויקט לא מוגדר");
    if (!proj.notes)        missing.push("אין הערות");

    // Financial basics
    if (!finance || !(finance as Record<string, unknown>)?.agreedPrice) {
      missing.push("מחיר לא הוגדר");
    }

    // Session checks (not for completed/held projects)
    if (!isDone && status !== "בהשהייה") {
      if (!proj.deadline)  missing.push("דדליין לא מוגדר");
      if (!(sessions ?? []).length) missing.push("אין סשנים מתועדים");
      if (!(sessions ?? []).some((s) => s.date > today)) missing.push("אין סשן המשך מתוכנן");
    }

    // Mix stage checks
    if (isMixStage) {
      if (!soundEngineerConnected)        missing.push("לא הוגדר איש סאונד חיצוני");
      else if (soundEngineerBalance > 0 && !soundEngineerHasTx)
                                          missing.push(`יתרה לאיש הסאונד (${soundEngineerBalance}) לא נרשמה כהוצאה`);
      else if (soundEngineerBalance > 0)  missing.push(`יתרה פתוחה לאיש הסאונד: ${soundEngineerBalance}`);
    }

    // Victor check (always)
    if (!victorConnected) missing.push("לא נשלח לויקטור");

    // Completion checks
    if (isDone) {
      // Check all income received
      const allPaid = (txns ?? [])
        .filter((t) => t.type !== "הוצאה")
        .every((t) => PAID_STATUSES.has(t.payment_status));
      if (!allPaid) missing.push("יש תשלום לא מסומן כהתקבל (בדוק סגירה פיננסית)");
    }

    // Clip planning items
    const { data: clipItems } = await supabase
      .from("clip_items")
      .select("category, description, amount, currency, status, linked_transaction_id")
      .eq("project_id", projectId)
      .neq("status", "בוטל");
    if (clipItems && clipItems.length > 0) {
      const totalPlanned  = clipItems.reduce((s: number, i: Record<string, unknown>) => s + ((i.amount as number) ?? 0), 0);
      const totalSynced   = clipItems.filter((i: Record<string, unknown>) => i.linked_transaction_id).reduce((s: number, i: Record<string, unknown>) => s + ((i.amount as number) ?? 0), 0);
      const totalUnsynced = clipItems.filter((i: Record<string, unknown>) => i.status === "תכנון בלבד").reduce((s: number, i: Record<string, unknown>) => s + ((i.amount as number) ?? 0), 0);
      const totalPaidItems = clipItems.filter((i: Record<string, unknown>) => i.status === "שולם").reduce((s: number, i: Record<string, unknown>) => s + ((i.amount as number) ?? 0), 0);
      lines.push(`\nתכנון תקציב קליפ (${clipItems.length} פריטים):`);
      lines.push(`  מתוכנן: ${fmt(totalPlanned)}₪ | הועבר לכספים: ${fmt(totalSynced)}₪ | שולם: ${fmt(totalPaidItems)}₪`);
      if (totalUnsynced > 0) lines.push(`  ⚠ ${fmt(totalUnsynced)}₪ בתכנון שעדיין לא עברו לכספים`);
    }

    // Filming days summary
    const filmingDays = (sessions ?? []).filter((s) => s.session_type === "צילום קליפ");
    if (filmingDays.length > 0) {
      lines.push(`\nימי צילום (${filmingDays.length}):`);
      filmingDays.slice(0, 5).forEach((s) => {
        const row = s as Record<string, unknown>;
        const parts = [
          s.date,
          row.photographer ? `צלם: ${row.photographer}` : null,
          row.location     ? `מיקום: ${row.location}` : null,
          `[${s.status}]`,
        ].filter(Boolean);
        lines.push(`  • ${parts.join(" | ")}`);
      });
      const nextFilming = filmingDays.find((s) => s.date && s.date >= today);
      if (nextFilming) lines.push(`  יום צילום הבא: ${nextFilming.date}`);
    }

    // Clip expenses summary
    const clipExp = (txns ?? []).filter((t) => t.type === "expense" && (t as Record<string, unknown>).expense_scope === "קליפ");
    if (clipExp.length > 0) {
      const clipPaid    = clipExp.filter((t) => PAID_STATUSES.has(t.payment_status)).reduce((s, t) => s + (t.amount ?? 0), 0);
      const clipPending = clipExp.filter((t) => !PAID_STATUSES.has(t.payment_status)).reduce((s, t) => s + (t.amount ?? 0), 0);
      lines.push(`\nהוצאות קליפ (${clipExp.length} פריטים):`);
      lines.push(`  שולם: ${fmt(clipPaid)}₪ | צפוי / לא שולם: ${fmt(clipPending)}₪ | סה"כ: ${fmt(clipPaid + clipPending)}₪`);
      const topClip = [...clipExp].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 5);
      topClip.forEach((t) => {
        const cat  = (t as Record<string, unknown>).category as string || "";
        const desc = t.description || cat || "הוצאת קליפ";
        lines.push(`  • ${fmt(t.amount ?? 0)}${t.currency ?? "₪"} — ${desc} [${t.payment_status}]`);
      });
    }

    if (missing.length > 0) {
      lines.push(`\nחסר בפרויקט: ${missing.join(" · ")}`);
    } else {
      lines.push(`\nהפרויקט מלא — אין שדות חסרים ברורים.`);
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("he-IL");
}
