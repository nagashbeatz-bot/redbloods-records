"use client";

import { useState, useEffect } from "react";
import { useProjects } from "@/components/ProjectsProvider";
import type { Project } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────
type Period = "month" | "prev-month" | "30days" | "year" | "custom";

interface Session {
  id: string;
  project_id: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
  session_type: string;
}

interface Transaction {
  id: string;
  project_id: string;
  type: "income" | "expense";
  date: string | null;
  amount: number;
  currency: string;
  payment_status: string;
}

interface FinanceSetting {
  project_id: string;
  agreedPrice: number;
  currency: string;
}

interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: string;
  status: string;
}

interface Alert {
  level: "danger" | "warning" | "info";
  text: string;
}

// ── Period helpers ─────────────────────────────────────────────────────────────
const HEB_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: "month",      label: "החודש" },
  { key: "prev-month", label: "חודש קודם" },
  { key: "30days",     label: "30 יום" },
  { key: "year",       label: "שנה נוכחית" },
  { key: "custom",     label: "מותאם" },
];

function getRange(period: Period, cf = "", ct = ""): { from: Date | null; to: Date | null } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "month":      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59) };
    case "prev-month": { const pm = m === 0 ? 11 : m - 1; const py = m === 0 ? y - 1 : y; return { from: new Date(py, pm, 1), to: new Date(py, pm + 1, 0, 23, 59, 59) }; }
    case "30days":     { const from = new Date(now); from.setDate(from.getDate() - 30); return { from, to: new Date(y, m, now.getDate(), 23, 59, 59) }; }
    case "year":       return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59) };
    case "custom":     return cf && ct ? { from: new Date(cf), to: new Date(ct + "T23:59:59") } : { from: null, to: null };
  }
}

function getPeriodLabel(period: Period, cf = "", ct = ""): { heading: string; sub: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "month":      return { heading: "חודש נוכחי",      sub: `${HEB_MONTHS[m]} ${y}` };
    case "prev-month": { const pm = m === 0 ? 11 : m - 1; const py = m === 0 ? y - 1 : y; return { heading: "חודש קודם", sub: `${HEB_MONTHS[pm]} ${py}` }; }
    case "30days":     return { heading: "30 ימים אחרונים", sub: "" };
    case "year":       return { heading: "שנה נוכחית",       sub: `${y}` };
    case "custom":     return { heading: "מותאם אישית",      sub: cf && ct ? `${cf.split("-").reverse().join(".")} – ${ct.split("-").reverse().join(".")}` : "" };
  }
}

function inRange(date: string | null, range: { from: Date | null; to: Date | null }): boolean {
  if (!date || !range.from || !range.to) return false;
  const d = new Date(date);
  return d >= range.from && d <= range.to;
}

function sessionHours(s: Session): number {
  if (!s.start_time || !s.end_time) return 0;
  const [sh, sm] = s.start_time.split(":").map(Number);
  const [eh, em] = s.end_time.split(":").map(Number);
  const mins = eh * 60 + em - sh * 60 - sm;
  return mins > 0 ? mins / 60 : 0;
}

function fmtMoney(n: number, currency = "₪"): string {
  return `${n.toLocaleString("he-IL", { maximumFractionDigits: 0 })}${currency}`;
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} דק׳`;
  const full = Math.floor(h);
  const rem  = Math.round((h - full) * 60);
  return rem > 0 ? `${full}:${String(rem).padStart(2, "0")} שע׳` : `${full} שע׳`;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ── Shared card wrapper ───────────────────────────────────────────────────────
function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "#1C1C1C", border: "1px solid #252525", borderRadius: 16,
      padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#C0C0C0" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

// ── Stat row inside a card ────────────────────────────────────────────────────
function StatRow({ label, value, color = "#AAA", sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <span style={{ fontSize: 12, color: "#777" }}>{label}</span>
        {sub && <span style={{ fontSize: 10, color: "#444", marginRight: 6 }}>{sub}</span>}
      </div>
      <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

// ── Project chip ──────────────────────────────────────────────────────────────
function ProjectChip({ name, sub, color = "#F59E0B" }: { name: string; sub?: string; color?: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "6px 10px", background: `${color}0D`, border: `1px solid ${color}25`,
      borderRadius: 8, gap: 8,
    }}>
      <span style={{ fontSize: 11, color: "#666" }}>{sub}</span>
      <span style={{ fontSize: 12, color: "#CCC", fontWeight: 500 }}>{name}</span>
    </div>
  );
}

// ── Alert item ────────────────────────────────────────────────────────────────
const ALERT_COLOR = { danger: "#EF4444", warning: "#F59E0B", info: "#3B82F6" } as const;
const ALERT_ICON  = { danger: "🔴", warning: "🟡", info: "🔵" } as const;

function AlertItem({ alert }: { alert: Alert }) {
  const color = ALERT_COLOR[alert.level];
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "9px 12px", borderRadius: 10,
      background: `${color}08`, border: `1px solid ${color}22`,
    }}>
      <span style={{ fontSize: 11, flexShrink: 0, marginTop: 1 }}>{ALERT_ICON[alert.level]}</span>
      <span style={{ fontSize: 13, color: "#C0C0C0", lineHeight: 1.5 }}>{alert.text}</span>
    </div>
  );
}

// ── Summary chip ──────────────────────────────────────────────────────────────
function SummaryChip({ label, value, color = "#AAA" }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      flex: "1 1 0", minWidth: 0,
      background: "#1C1C1C", border: "1px solid #252525", borderRadius: 12,
      padding: "14px 16px", textAlign: "right",
    }}>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: "-0.5px" }}>{value}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function InsightsPage() {
  const { projects } = useProjects();
  const [sessions,    setSessions]    = useState<Session[]>([]);
  const [limits,      setLimits]      = useState<Record<string, number>>({});
  const [transactions,setTransactions]= useState<Transaction[]>([]);
  const [finSettings, setFinSettings] = useState<FinanceSetting[]>([]);
  const [clients,     setClients]     = useState<Client[]>([]);
  const [loaded,      setLoaded]      = useState(false);

  const [period,     setPeriod]     = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/sessions?all=1").then((r) => r.json()),
      fetch("/api/transactions?all=1").then((r) => r.json()),
      fetch("/api/clients").then((r) => r.json()),
    ]).then(([s, t, c]) => {
      setSessions(s.sessions ?? []);
      setLimits(s.limits ?? {});
      setTransactions(t.transactions ?? []);
      setFinSettings(t.settings ?? []);
      setClients(c.clients ?? []);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  // ── Period ──────────────────────────────────────────────────────────────────
  const range = getRange(period, customFrom, customTo);
  const { heading: periodHeading, sub: periodSub } = getPeriodLabel(period, customFrom, customTo);

  // ── Project helpers ─────────────────────────────────────────────────────────
  const activeProjects = projects.filter((p) => !["הושלם", "בהשהייה"].includes(p.status));

  const getLimit = (id: string) => limits[id] ?? 3;

  // Session counts per project (all time)
  const sessionsByProject: Record<string, number> = {};
  sessions.forEach((s) => {
    sessionsByProject[s.project_id] = (sessionsByProject[s.project_id] ?? 0) + 1;
  });

  // Sessions in period
  const periodSessions   = sessions.filter((s) => inRange(s.date, range));
  const totalHours       = periodSessions.reduce((acc, s) => acc + sessionHours(s), 0);
  const avgSessionsPerProj = activeProjects.length > 0
    ? (Object.values(sessionsByProject).reduce((a, b) => a + b, 0) / Math.max(activeProjects.length, 1))
    : 0;

  // Session limits
  const projectsOverLimit  = activeProjects.filter((p) => (sessionsByProject[p.id] ?? 0) >  getLimit(p.id));
  const projectsAtLimit    = activeProjects.filter((p) => (sessionsByProject[p.id] ?? 0) === getLimit(p.id));
  const projectsOneBeforeLimit = activeProjects.filter((p) => (sessionsByProject[p.id] ?? 0) === getLimit(p.id) - 1);

  // ── Finance ─────────────────────────────────────────────────────────────────
  const paidByProject: Record<string, number> = {};
  transactions.filter((t) => t.type === "income" && t.payment_status === "התקבל").forEach((t) => {
    paidByProject[t.project_id] = (paidByProject[t.project_id] ?? 0) + t.amount;
  });

  const periodIncome    = transactions.filter((t) => t.type === "income"  && inRange(t.date, range));
  const periodExpenses  = transactions.filter((t) => t.type === "expense" && inRange(t.date, range));

  const incomeReceived  = periodIncome.filter((t) => t.payment_status === "התקבל").reduce((s, t) => s + t.amount, 0);
  const incomeExpected  = periodIncome.filter((t) => ["צפוי","חלקי","לבדיקה"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const expensesPaid    = periodExpenses.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const expensesExpected= periodExpenses.filter((t) => ["צפוי","לא שולם","חלקי"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const profitReal      = incomeReceived - expensesPaid;
  const profitEst       = incomeReceived + incomeExpected - expensesPaid - expensesExpected;

  // Projects with open balance (all time)
  const projectsWithOpenBalance = projects.filter((p) => {
    const setting = finSettings.find((s) => s.project_id === p.id);
    const agreed  = setting?.agreedPrice ?? 0;
    const paid    = paidByProject[p.id] ?? 0;
    return agreed > 0 && paid < agreed;
  });

  // In mix with unpaid balance
  const projectsInMixUnpaid = projects.filter((p) =>
    ["מחכה למיקס","במיקס"].includes(p.status) && projectsWithOpenBalance.some((op) => op.id === p.id)
  );

  // ── Deadlines ────────────────────────────────────────────────────────────────
  const today = new Date();
  const overdue     = projects.filter((p) => p.isOverdue && p.status !== "הושלם");
  const dueToday    = projects.filter((p) => { const d = daysUntil(p.deadline); return d === 0 && p.status !== "הושלם"; });
  const dueThisWeek = projects.filter((p) => { const d = daysUntil(p.deadline); return d !== null && d > 0 && d <= 7 && p.status !== "הושלם"; });
  const noDeadline  = activeProjects.filter((p) => !p.deadline);

  // ── Artists ──────────────────────────────────────────────────────────────────
  const clientsNoEmail = clients.filter((c) => !c.email?.trim());

  const artistProjectCount: Record<string, number> = {};
  activeProjects.forEach((p) => {
    p.artist.split(/[,،;]/).map((a) => a.trim()).filter(Boolean).forEach((a) => {
      artistProjectCount[a] = (artistProjectCount[a] ?? 0) + 1;
    });
  });

  const artistSessionCount: Record<string, number> = {};
  sessions.forEach((s) => {
    const proj = projects.find((p) => p.id === s.project_id);
    if (!proj?.artist) return;
    proj.artist.split(/[,،;]/).map((a) => a.trim()).filter(Boolean).forEach((a) => {
      artistSessionCount[a] = (artistSessionCount[a] ?? 0) + 1;
    });
  });

  const artistBalances: Record<string, number> = {};
  projectsWithOpenBalance.forEach((p) => {
    const setting = finSettings.find((s) => s.project_id === p.id);
    const agreed  = setting?.agreedPrice ?? 0;
    const paid    = paidByProject[p.id] ?? 0;
    const balance = agreed - paid;
    p.artist.split(/[,،;]/).map((a) => a.trim()).filter(Boolean).forEach((a) => {
      artistBalances[a] = (artistBalances[a] ?? 0) + balance;
    });
  });

  const topProjArtist    = Object.entries(artistProjectCount).sort((a, b) => b[1] - a[1])[0];
  const topSessionArtist = Object.entries(artistSessionCount).sort((a, b) => b[1] - a[1])[0];
  const topBalanceArtist = Object.entries(artistBalances).sort((a, b) => b[1] - a[1])[0];

  // ── Profitability risk ────────────────────────────────────────────────────────
  const riskyProjects: { project: Project; reason: string }[] = [];
  activeProjects.forEach((p) => {
    const count   = sessionsByProject[p.id] ?? 0;
    const limit   = getLimit(p.id);
    const setting = finSettings.find((s) => s.project_id === p.id);
    const agreed  = setting?.agreedPrice ?? 0;
    const paid    = paidByProject[p.id] ?? 0;
    const projectExp = transactions.filter((t) => t.type === "expense" && t.project_id === p.id).reduce((s, t) => s + t.amount, 0);
    const hasOpenBalance = projectsWithOpenBalance.some((op) => op.id === p.id);
    const netEst  = agreed > 0 ? agreed - projectExp : paid - projectExp;

    if (count > limit && hasOpenBalance) {
      riskyProjects.push({ project: p, reason: `${count}/${limit} סשנים + יתרה פתוחה` });
    } else if (agreed > 0 && netEst < 0) {
      riskyProjects.push({ project: p, reason: `רווח משוער שלילי: ${fmtMoney(netEst)}` });
    } else if (["מחכה למיקס","במיקס"].includes(p.status) && hasOpenBalance) {
      riskyProjects.push({ project: p, reason: `${p.status} — לא שולם במלואו` });
    }
  });
  const topRiskyProjects = riskyProjects.slice(0, 5);

  // ── Build alerts (max 5, sorted by priority) ──────────────────────────────────
  const alerts: Alert[] = [];

  // Danger: in-mix unpaid
  if (projectsInMixUnpaid.length === 1) {
    alerts.push({ level: "danger", text: `"${projectsInMixUnpaid[0].name}" ב${projectsInMixUnpaid[0].status} עם יתרה לא משולמת` });
  } else if (projectsInMixUnpaid.length > 1) {
    alerts.push({ level: "danger", text: `${projectsInMixUnpaid.length} פרויקטים במיקס עם יתרה לא משולמת` });
  }

  // Danger: overdue
  overdue.slice(0, 2).forEach((p) => {
    const days = Math.abs(daysUntil(p.deadline) ?? 0);
    alerts.push({ level: "danger", text: `"${p.name}" עבר דדליין לפני ${days} ${days === 1 ? "יום" : "ימים"}` });
  });

  // Warning: over session limit
  if (alerts.length < 5 && projectsOverLimit.length > 0) {
    if (projectsOverLimit.length === 1) {
      const p = projectsOverLimit[0];
      alerts.push({ level: "warning", text: `"${p.name}" חרג מהמכסה: ${sessionsByProject[p.id]}/${getLimit(p.id)} סשנים` });
    } else {
      alerts.push({ level: "warning", text: `${projectsOverLimit.length} פרויקטים חרגו ממכסת הסשנים` });
    }
  }

  // Warning: at limit (one session away from overrun)
  if (alerts.length < 5 && projectsAtLimit.length > 0) {
    const p = projectsAtLimit[0];
    alerts.push({ level: "warning", text: `"${p.name}" הגיע למכסה: ${sessionsByProject[p.id]}/${getLimit(p.id)} סשנים` });
  }

  // Warning: due this week
  if (alerts.length < 5 && dueThisWeek.length > 0) {
    alerts.push({ level: "warning", text: `${dueThisWeek.length} ${dueThisWeek.length === 1 ? "פרויקט" : "פרויקטים"} עם דדליין בשבוע הקרוב` });
  }

  // Info: clients with no email
  if (alerts.length < 5 && clientsNoEmail.length > 0) {
    alerts.push({ level: "info", text: `${clientsNoEmail.length} לקוחות / אמנים ללא כתובת מייל` });
  }

  // Info: open balances
  if (alerts.length < 5 && projectsWithOpenBalance.length > 0) {
    alerts.push({ level: "info", text: `${projectsWithOpenBalance.length} פרויקטים עם יתרה פתוחה` });
  }

  const displayAlerts = alerts.slice(0, 5);

  // ── Style helpers ──────────────────────────────────────────────────────────
  const SEL_S: React.CSSProperties = {
    background: "transparent", border: "1px solid #2A2A2A", borderRadius: 8,
    color: "#555", fontSize: 12, padding: "5px 10px", outline: "none", fontFamily: "inherit",
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" style={{ padding: "28px 32px", maxWidth: 1200, margin: "0 auto" }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#E8E8E8", margin: "0 0 2px" }}>
          תובנות
          {periodHeading && <span style={{ fontSize: 14, fontWeight: 400, color: "#555", marginRight: 10 }}>— {periodHeading}</span>}
        </h1>
        <p style={{ fontSize: 12, color: "#555", margin: 0 }}>
          {periodSub || "ניתוח פרויקטים, זמן, סשנים וכסף"}
        </p>
      </div>

      {/* ── Period selector ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
        {PERIOD_OPTIONS.map(({ key, label }) => {
          const active = period === key;
          return (
            <button key={key} onClick={() => setPeriod(key)} style={{
              padding: "6px 14px", borderRadius: 10, border: "none", cursor: "pointer",
              background: active ? "rgba(59,130,246,0.14)" : "#1C1C1C",
              color: active ? "#3B82F6" : "#555",
              fontSize: 12, fontWeight: active ? 700 : 400, fontFamily: "inherit",
              outline: active ? "1px solid rgba(59,130,246,0.35)" : "1px solid #252525",
            }}>
              {label}
            </button>
          );
        })}
        {period === "custom" && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              style={{ ...SEL_S, colorScheme: "dark", width: 140 }} />
            <span style={{ color: "#333" }}>—</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              style={{ ...SEL_S, colorScheme: "dark", width: 140 }} />
          </>
        )}
      </div>

      {!loaded ? (
        <div style={{ color: "#444", fontSize: 13, padding: "60px", textAlign: "center" }}>טוען נתונים...</div>
      ) : (
        <>
          {/* ── ⚠ מה דורש תשומת לב ── */}
          {displayAlerts.length > 0 && (
            <div style={{
              background: "#181818", border: "1px solid #2A2A2A", borderRadius: 16,
              padding: "16px 18px", marginBottom: 24,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 12, letterSpacing: "0.05em" }}>
                ⚠ מה דורש תשומת לב
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {displayAlerts.map((a, i) => <AlertItem key={i} alert={a} />)}
              </div>
            </div>
          )}

          {/* ── Summary chips ── */}
          <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
            <SummaryChip label="סשנים בתקופה" value={periodSessions.length} color="#A855F7" />
            <SummaryChip label="שעות עבודה בתקופה" value={totalHours > 0 ? fmtHours(totalHours) : "—"} color="#A855F7" />
            <SummaryChip label="פרויקטים פעילים" value={activeProjects.length} color="#3B82F6" />
            <SummaryChip
              label="רווח בפועל"
              value={fmtMoney(profitReal)}
              color={profitReal >= 0 ? "#10B981" : "#EF4444"}
            />
            <SummaryChip
              label="רווח משוער"
              value={fmtMoney(profitEst)}
              color={profitEst >= 0 ? "#10B981" : "#EF4444"}
            />
          </div>

          {/* ── Cards grid ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>

            {/* ── סשנים וזמן ── */}
            <Card title="סשנים וזמן" icon="⏱">
              <StatRow label="סה״כ סשנים בתקופה"      value={periodSessions.length}           color="#A855F7" />
              <StatRow label="שעות בתקופה"              value={totalHours > 0 ? fmtHours(totalHours) : "—"} color="#A855F7" />
              <StatRow label="ממוצע סשנים לפרויקט פעיל" value={avgSessionsPerProj.toFixed(1)}   color="#888" />
              <div style={{ height: 1, background: "#222", margin: "4px 0" }} />
              <StatRow label="פרויקטים שחרגו ממכסה"     value={projectsOverLimit.length}        color={projectsOverLimit.length > 0 ? "#EF4444" : "#555"} />
              <StatRow label="פרויקטים שהגיעו למכסה"     value={projectsAtLimit.length}          color={projectsAtLimit.length > 0 ? "#F59E0B" : "#555"} />
              <StatRow label="פרויקט אחד לפני חריגה"     value={projectsOneBeforeLimit.length}   color={projectsOneBeforeLimit.length > 0 ? "#F59E0B" : "#555"} />
              {projectsOverLimit.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                  {projectsOverLimit.slice(0, 3).map((p) => (
                    <ProjectChip
                      key={p.id}
                      name={p.name}
                      sub={`${sessionsByProject[p.id]}/${getLimit(p.id)} סשנים`}
                      color="#EF4444"
                    />
                  ))}
                </div>
              )}
            </Card>

            {/* ── כספים ── */}
            <Card title="כספים" icon="₪">
              <StatRow label="הכנסות שהתקבלו"  value={fmtMoney(incomeReceived)}  color="#10B981" />
              <StatRow label="הכנסות צפויות"    value={fmtMoney(incomeExpected)}  color="#3B82F6" />
              <StatRow label="הוצאות ששולמו"    value={fmtMoney(expensesPaid)}    color="#F59E0B" />
              <StatRow label="הוצאות צפויות"    value={fmtMoney(expensesExpected)} color="#F59E0B" />
              <div style={{ height: 1, background: "#222", margin: "4px 0" }} />
              <StatRow label="רווח בפועל"       value={fmtMoney(profitReal)}       color={profitReal >= 0 ? "#10B981" : "#EF4444"} />
              <StatRow label="רווח משוער"        value={fmtMoney(profitEst)}        color={profitEst >= 0 ? "#10B981" : "#EF4444"} />
              <div style={{ height: 1, background: "#222", margin: "4px 0" }} />
              <StatRow label="פרויקטים עם יתרה פתוחה" value={projectsWithOpenBalance.length} color={projectsWithOpenBalance.length > 0 ? "#F59E0B" : "#555"} />
              <StatRow label="פרויקטים במיקס לא משולמים" value={projectsInMixUnpaid.length}  color={projectsInMixUnpaid.length > 0 ? "#EF4444" : "#555"} />
              {projectsInMixUnpaid.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                  {projectsInMixUnpaid.slice(0, 3).map((p) => {
                    const agreed  = finSettings.find((s) => s.project_id === p.id)?.agreedPrice ?? 0;
                    const paid    = paidByProject[p.id] ?? 0;
                    return (
                      <ProjectChip key={p.id} name={p.name} sub={`יתרה: ${fmtMoney(agreed - paid)}`} color="#EF4444" />
                    );
                  })}
                </div>
              )}
            </Card>

            {/* ── דד-ליינים ── */}
            <Card title="דד-ליינים" icon="📅">
              <StatRow label="פרויקטים שעברו דדליין"   value={overdue.length}      color={overdue.length > 0 ? "#EF4444" : "#555"} />
              <StatRow label="דדליין היום"              value={dueToday.length}     color={dueToday.length > 0 ? "#EF4444" : "#555"} />
              <StatRow label="דדליין השבוע הקרוב"       value={dueThisWeek.length}  color={dueThisWeek.length > 0 ? "#F59E0B" : "#555"} />
              <StatRow label="פרויקטים בלי דדליין"      value={noDeadline.length}   color={noDeadline.length > 5 ? "#F59E0B" : "#555"} />
              {(overdue.length > 0 || dueThisWeek.length > 0) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                  {[...overdue, ...dueToday].slice(0, 2).map((p) => {
                    const d = daysUntil(p.deadline);
                    return (
                      <ProjectChip
                        key={p.id}
                        name={p.name}
                        sub={d !== null && d < 0 ? `עבר לפני ${Math.abs(d)} ימים` : "היום!"}
                        color="#EF4444"
                      />
                    );
                  })}
                  {dueThisWeek.slice(0, 3).map((p) => {
                    const d = daysUntil(p.deadline);
                    return (
                      <ProjectChip
                        key={p.id}
                        name={p.name}
                        sub={`עוד ${d} ימים`}
                        color="#F59E0B"
                      />
                    );
                  })}
                </div>
              )}
            </Card>

            {/* ── אמנים ולקוחות ── */}
            <Card title="אמנים ולקוחות" icon="🎤">
              {topSessionArtist && (
                <StatRow
                  label="הכי הרבה סשנים"
                  value={`${topSessionArtist[0]} (${topSessionArtist[1]})`}
                  color="#A855F7"
                />
              )}
              {topProjArtist && (
                <StatRow
                  label="הכי הרבה פרויקטים פעילים"
                  value={`${topProjArtist[0]} (${topProjArtist[1]})`}
                  color="#3B82F6"
                />
              )}
              {topBalanceArtist && (
                <StatRow
                  label="יתרה פתוחה גדולה ביותר"
                  value={`${topBalanceArtist[0]}: ${fmtMoney(topBalanceArtist[1])}`}
                  color="#EF4444"
                />
              )}
              <div style={{ height: 1, background: "#222", margin: "4px 0" }} />
              <StatRow label="לקוחות ללא מייל"  value={clientsNoEmail.length} color={clientsNoEmail.length > 0 ? "#F59E0B" : "#555"} />
              <StatRow label="פרויקטים שעברו דדליין" value={overdue.length}   color={overdue.length > 0 ? "#EF4444" : "#555"} />
              {clientsNoEmail.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                  {clientsNoEmail.slice(0, 3).map((c) => (
                    <ProjectChip key={c.id} name={c.name} sub="ללא מייל" color="#F59E0B" />
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ── סיכון רווחיות — full width ── */}
          {topRiskyProjects.length > 0 ? (
            <Card title="סיכון רווחיות" icon="⚡">
              <div style={{ fontSize: 11, color: "#555", marginTop: -6 }}>
                פרויקטים עם שילוב של סשנים רבים, יתרה פתוחה או רווח שלילי
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {topRiskyProjects.map(({ project: p, reason }) => (
                  <div key={p.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)",
                    borderRadius: 10,
                  }}>
                    <span style={{ fontSize: 11, color: "#F59E0B" }}>{reason}</span>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, color: "#DDD", fontWeight: 500 }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: "#555" }}>{p.artist} · {p.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <div style={{
              background: "#181818", border: "1px solid #252525", borderRadius: 16,
              padding: "20px", textAlign: "center",
            }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
              <div style={{ fontSize: 13, color: "#555" }}>אין פרויקטים עם סיכון רווחיות מזוהה</div>
            </div>
          )}

          {/* ── Footer note ── */}
          <div style={{ marginTop: 20, fontSize: 10, color: "#333", textAlign: "center" }}>
            הנתונים מחושבים ישירות מתוך Redbloods OS · מסונן לפי {periodHeading}
            {periodSub && ` (${periodSub})`}
          </div>
        </>
      )}
    </div>
  );
}
