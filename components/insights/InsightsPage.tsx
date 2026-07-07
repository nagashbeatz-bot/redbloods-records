"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useProjects } from "@/components/ProjectsProvider";
import { MAI_AI_ENABLED } from "@/lib/feature-flags";
import type { Project, AgentAlert, AlertStatus } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────
type Period = "month" | "prev-month" | "30days" | "year" | "custom";
type ModalKey =
  | "open-balance" | "in-mix-unpaid"
  | "overdue" | "due-today" | "due-this-week" | "no-deadline"
  | "over-limit" | "at-limit" | "one-before-limit"
  | "no-email" | "risky"
  | "proposals-open" | "proposals-followup";

interface ProposalRow {
  id: string; client_id: string; client_name: string; client_status: string;
  title: string; amount: number; currency: string; status: string;
  sent_date: string | null; followup_date: string | null; notes: string;
  linked_project_id: string | null;
}

interface Session {
  id: string; project_id: string; date: string | null;
  start_time: string | null; end_time: string | null;
  status: string; session_type: string;
}
interface Transaction {
  id: string; project_id: string; type: "income" | "expense";
  date: string | null; amount: number; currency: string; payment_status: string;
}
interface FinanceSetting { project_id: string; agreedPrice: number; currency: string; financeException?: boolean; }
interface Client { id: string; name: string; email: string; phone: string; type: string; status: string; }
interface Alert { level: "danger" | "warning" | "info"; text: string; modal: ModalKey | null; }

// ── Period helpers ─────────────────────────────────────────────────────────────
const HEB_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: "month", label: "החודש" }, { key: "prev-month", label: "חודש קודם" },
  { key: "30days", label: "30 יום" }, { key: "year", label: "שנה נוכחית" }, { key: "custom", label: "מותאם" },
];

function getRange(period: Period, cf = "", ct = ""): { from: Date | null; to: Date | null } {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "month":      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59) };
    case "prev-month": { const pm = m === 0 ? 11 : m - 1; const py = m === 0 ? y - 1 : y; return { from: new Date(py, pm, 1), to: new Date(py, pm + 1, 0, 23, 59, 59) }; }
    case "30days":     { const from = new Date(now); from.setDate(from.getDate() - 30); return { from, to: new Date(y, m, now.getDate(), 23, 59, 59) }; }
    case "year":       return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59) };
    case "custom":     return cf && ct ? { from: new Date(cf), to: new Date(ct + "T23:59:59") } : { from: null, to: null };
  }
}
function getPeriodLabel(period: Period, cf = "", ct = ""): { heading: string; sub: string } {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "month":      return { heading: "חודש נוכחי", sub: `${HEB_MONTHS[m]} ${y}` };
    case "prev-month": { const pm = m === 0 ? 11 : m - 1; const py = m === 0 ? y - 1 : y; return { heading: "חודש קודם", sub: `${HEB_MONTHS[pm]} ${py}` }; }
    case "30days":     return { heading: "30 ימים אחרונים", sub: "" };
    case "year":       return { heading: "שנה נוכחית", sub: `${y}` };
    case "custom":     return { heading: "מותאם אישית", sub: cf && ct ? `${cf.split("-").reverse().join(".")} – ${ct.split("-").reverse().join(".")}` : "" };
  }
}
function inRange(date: string | null, range: { from: Date | null; to: Date | null }): boolean {
  if (!date || !range.from || !range.to) return false;
  const d = new Date(date); return d >= range.from && d <= range.to;
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
  const full = Math.floor(h); const rem = Math.round((h - full) * 60);
  return rem > 0 ? `${full}:${String(rem).padStart(2, "0")} שע׳` : `${full} שע׳`;
}
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y}`;
}

// ── Shared card wrapper ───────────────────────────────────────────────────────
function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#1C1C1C", border: "1px solid #252525", borderRadius: 16, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#C0C0C0" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

// ── Stat row ──────────────────────────────────────────────────────────────────
function StatRow({ label, value, color = "#AAA", sub, onClick }: {
  label: string; value: string | number; color?: string; sub?: string; onClick?: () => void;
}) {
  const isClickable = !!onClick;
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: isClickable ? "3px 6px" : undefined,
        borderRadius: isClickable ? 6 : undefined,
        cursor: isClickable ? "pointer" : "default",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => { if (isClickable) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)"; }}
      onMouseLeave={(e) => { if (isClickable) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      <div>
        <span style={{ fontSize: 12, color: "#777" }}>{label}</span>
        {sub && <span style={{ fontSize: 10, color: "#444", marginRight: 6 }}>{sub}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}</span>
        {isClickable && <span style={{ fontSize: 10, color: "#444" }}>←</span>}
      </div>
    </div>
  );
}

// ── Alert item ────────────────────────────────────────────────────────────────
const ALERT_COLOR = { danger: "#EF4444", warning: "#F59E0B", info: "#3B82F6" } as const;
const ALERT_ICON  = { danger: "🔴", warning: "🟡", info: "🔵" } as const;

function AlertItem({ alert, onClick }: { alert: Alert; onClick?: () => void }) {
  const color = ALERT_COLOR[alert.level];
  const isClickable = !!onClick;
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        padding: "9px 12px", borderRadius: 10,
        background: `${color}08`, border: `1px solid ${color}22`,
        cursor: isClickable ? "pointer" : "default",
        transition: "background 0.12s, border-color 0.12s",
      }}
      onMouseEnter={(e) => { if (isClickable) { (e.currentTarget as HTMLDivElement).style.background = `${color}14`; (e.currentTarget as HTMLDivElement).style.borderColor = `${color}44`; } }}
      onMouseLeave={(e) => { if (isClickable) { (e.currentTarget as HTMLDivElement).style.background = `${color}08`; (e.currentTarget as HTMLDivElement).style.borderColor = `${color}22`; } }}
    >
      <span style={{ fontSize: 11, flexShrink: 0, marginTop: 1 }}>{ALERT_ICON[alert.level]}</span>
      <span style={{ fontSize: 13, color: "#C0C0C0", lineHeight: 1.5, flex: 1 }}>{alert.text}</span>
      {isClickable && <span style={{ fontSize: 11, color: "#444", flexShrink: 0, marginTop: 1 }}>פירוט ←</span>}
    </div>
  );
}

// ── Summary chip ──────────────────────────────────────────────────────────────
function SummaryChip({ label, value, color = "#AAA" }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ flex: "1 1 0", minWidth: 0, background: "#1C1C1C", border: "1px solid #252525", borderRadius: 12, padding: "14px 16px", textAlign: "right" }}>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: "-0.5px" }}>{value}</div>
    </div>
  );
}

// ── Action button ─────────────────────────────────────────────────────────────
function ActionBtn({ label, onClick, variant = "ghost" }: { label: string; onClick: () => void; variant?: "ghost" | "primary" }) {
  const isPrimary = variant === "primary";
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
      border: isPrimary ? "1px solid rgba(59,130,246,0.4)" : "1px solid #2A2A2A",
      background: isPrimary ? "rgba(59,130,246,0.12)" : "#1A1A1A",
      color: isPrimary ? "#3B82F6" : "#777",
      fontFamily: "inherit", transition: "opacity 0.12s",
    }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.75"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
    >
      {label}
    </button>
  );
}

// ── Agent alert severity config ───────────────────────────────────────────────
const AGENT_SEV_COLOR = {
  urgent:    "#EF4444",
  important: "#F97316",
  warning:   "#F59E0B",
  info:      "#3B82F6",
} as const;
const AGENT_SEV_LABEL = {
  urgent:    "דחוף",
  important: "חשוב",
  warning:   "אזהרה",
  info:      "מידע",
} as const;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2)  return "עכשיו";
  if (mins < 60) return `לפני ${mins} דקות`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `לפני ${hrs} שעות`;
  const days = Math.floor(hrs / 24);
  return `לפני ${days} ימים`;
}

// ── Agent alert card ──────────────────────────────────────────────────────────
function AgentAlertCard({
  alert, onAction, updating,
}: {
  alert: AgentAlert;
  onAction: (id: string, status: AlertStatus) => void;
  updating: boolean;
}) {
  const color = AGENT_SEV_COLOR[alert.severity] ?? "#3B82F6";
  const label = AGENT_SEV_LABEL[alert.severity] ?? alert.severity;
  return (
    <div style={{
      background: `${color}08`,
      border: `1px solid ${color}22`,
      borderRadius: 12,
      padding: "12px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      opacity: updating ? 0.5 : 1,
      transition: "opacity 0.15s",
    }}>
      {/* Top row: severity badge + title + time */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color, flexShrink: 0,
          background: `${color}18`, border: `1px solid ${color}33`,
          borderRadius: 5, padding: "2px 6px", marginTop: 1,
        }}>
          {label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#D0D0D0", flex: 1, lineHeight: 1.4 }}>
          {alert.title}
        </span>
        <span style={{ fontSize: 10, color: "#444", flexShrink: 0, marginTop: 2 }}>
          {timeAgo(alert.createdAt)}
        </span>
      </div>
      {/* Message */}
      <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5, paddingRight: 2 }}>
        {alert.message}
      </div>
      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          onClick={() => onAction(alert.id, "handled")}
          disabled={updating}
          style={{
            padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
            border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.08)",
            color: "#10B981", cursor: updating ? "not-allowed" : "pointer", fontFamily: "inherit",
          }}
        >
          ✓ טופל
        </button>
        <button
          onClick={() => onAction(alert.id, "dismissed")}
          disabled={updating}
          style={{
            padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
            border: "1px solid #2A2A2A", background: "#1A1A1A",
            color: "#666", cursor: updating ? "not-allowed" : "pointer", fontFamily: "inherit",
          }}
        >
          ✗ דחה
        </button>
        <button
          onClick={() => onAction(alert.id, "ignored")}
          disabled={updating}
          style={{
            padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
            border: "1px solid #2A2A2A", background: "#1A1A1A",
            color: "#555", cursor: updating ? "not-allowed" : "pointer", fontFamily: "inherit",
          }}
        >
          👁 התעלם
        </button>
      </div>
    </div>
  );
}

// ── Detail Modal ──────────────────────────────────────────────────────────────
function InsightDetailModal({
  modalKey, onClose,
  projects, finSettings, paidByProject, sessionsByProject, limits,
  overdue, dueToday, dueThisWeek, noDeadline,
  projectsWithOpenBalance, projectsInMixUnpaid,
  projectsOverLimit, projectsAtLimit, projectsOneBeforeLimit,
  clientsNoEmail, riskyProjects,
  openProposals, followupOverdue, followupToday, todayStr,
}: {
  modalKey: ModalKey; onClose: () => void;
  projects: Project[];
  finSettings: FinanceSetting[];
  paidByProject: Record<string, number>;
  sessionsByProject: Record<string, number>;
  limits: Record<string, number>;
  overdue: Project[]; dueToday: Project[]; dueThisWeek: Project[];
  noDeadline: Project[]; projectsWithOpenBalance: Project[];
  projectsInMixUnpaid: Project[]; projectsOverLimit: Project[];
  projectsAtLimit: Project[]; projectsOneBeforeLimit: Project[];
  clientsNoEmail: Client[]; riskyProjects: { project: Project; reason: string }[];
  openProposals: ProposalRow[]; followupOverdue: ProposalRow[];
  followupToday: ProposalRow[]; todayStr: string;
}) {
  const router = useRouter();

  const goToProject = useCallback((id: string) => {
    onClose();
    router.push(`/projects?open=${id}`);
  }, [router, onClose]);

  const goToClient = useCallback((id: string) => {
    onClose();
    router.push(`/clients?open=${id}`);
  }, [router, onClose]);

  const MODAL_META: Record<ModalKey, { title: string; icon: string }> = {
    "open-balance":      { title: "פרויקטים עם יתרה פתוחה",        icon: "₪" },
    "in-mix-unpaid":     { title: "פרויקטים במיקס — לא שולם",       icon: "⚠️" },
    "overdue":           { title: "פרויקטים שעברו דדליין",           icon: "🔴" },
    "due-today":         { title: "דדליין היום",                      icon: "🔴" },
    "due-this-week":     { title: "דדליין השבוע הקרוב",              icon: "🟡" },
    "no-deadline":       { title: "פרויקטים פעילים ללא דדליין",      icon: "📅" },
    "over-limit":        { title: "פרויקטים שחרגו ממכסת סשנים",     icon: "⚡" },
    "at-limit":          { title: "פרויקטים שהגיעו למכסה",           icon: "🟡" },
    "one-before-limit":  { title: "פרויקט אחד לפני מכסה",           icon: "🔵" },
    "no-email":           { title: "לקוחות / אמנים ללא כתובת מייל",  icon: "📧" },
    "risky":              { title: "סיכון רווחיות",                    icon: "⚡" },
    "proposals-open":     { title: "הצעות מחיר פתוחות",               icon: "📋" },
    "proposals-followup": { title: "הצעות — דורשות פולואפ",           icon: "⏰" },
  };

  const { title, icon } = MODAL_META[modalKey];

  // ── Finance project row ────────────────────────────────────────────────────
  function FinRow({ p }: { p: Project }) {
    const setting = finSettings.find((s) => s.project_id === p.id);
    const agreed  = setting?.agreedPrice ?? 0;
    const paid    = paidByProject[p.id] ?? 0;
    const balance = agreed - paid;
    return (
      <div style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#E0E0E0" }}>{p.name}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{p.artist} · <span style={{ color: "#888" }}>{p.status}</span></div>
          </div>
          <div style={{ textAlign: "left", direction: "ltr" }}>
            <div style={{ fontSize: 11, color: "#555" }}>יתרה</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: balance > 0 ? "#EF4444" : "#10B981" }}>{fmtMoney(balance)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, marginBottom: 10, borderTop: "1px solid #252525", paddingTop: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#444" }}>מוסכם</div>
            <div style={{ fontSize: 12, color: "#888" }}>{fmtMoney(agreed)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#444" }}>שולם</div>
            <div style={{ fontSize: 12, color: "#10B981" }}>{fmtMoney(paid)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#444" }}>נותר</div>
            <div style={{ fontSize: 12, color: "#EF4444" }}>{fmtMoney(balance)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <ActionBtn label="פתח פרויקט" onClick={() => goToProject(p.id)} variant="primary" />
        </div>
      </div>
    );
  }

  // ── Deadline project row ───────────────────────────────────────────────────
  function DeadlineRow({ p }: { p: Project }) {
    const d = daysUntil(p.deadline);
    const isOverdue = d !== null && d < 0;
    const label = d === null ? "—" : d === 0 ? "היום!" : isOverdue ? `עבר לפני ${Math.abs(d)} ימים` : `עוד ${d} ימים`;
    const labelColor = isOverdue || d === 0 ? "#EF4444" : "#F59E0B";
    return (
      <div style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#E0E0E0" }}>{p.name}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{p.artist}</div>
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 11, color: "#555" }}>{fmtDate(p.deadline)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: labelColor }}>{label}</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <ActionBtn label="פתח פרויקט" onClick={() => goToProject(p.id)} variant="primary" />
          </div>
          <span style={{ fontSize: 11, color: "#555" }}>{p.status}</span>
        </div>
      </div>
    );
  }

  // ── Session limit row ──────────────────────────────────────────────────────
  function SessionRow({ p }: { p: Project }) {
    const count = sessionsByProject[p.id] ?? 0;
    const limit = limits[p.id] ?? 3;
    const overBy = count - limit;
    return (
      <div style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#E0E0E0" }}>{p.name}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{p.artist} · {p.status}</div>
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 11, color: "#555" }}>סשנים</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: overBy > 0 ? "#EF4444" : "#F59E0B" }}>{count}/{limit}</div>
            {overBy > 0 && <div style={{ fontSize: 10, color: "#EF4444" }}>+{overBy} מעל מכסה</div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <ActionBtn label="פתח פרויקט" onClick={() => goToProject(p.id)} variant="primary" />
        </div>
      </div>
    );
  }

  // ── Client row ─────────────────────────────────────────────────────────────
  function ClientRow({ c }: { c: Client }) {
    return (
      <div style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#E0E0E0" }}>{c.name}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
              {c.phone ? `📞 ${c.phone}` : "ללא טלפון"} · <span style={{ color: "#EF4444" }}>ללא מייל</span>
            </div>
          </div>
          <span style={{ fontSize: 11, color: "#555", padding: "3px 8px", background: "#252525", borderRadius: 6 }}>{c.status || c.type}</span>
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <ActionBtn label="פתח לקוח" onClick={() => goToClient(c.id)} variant="primary" />
          {c.phone && (
            <ActionBtn label="וואטסאפ" onClick={() => window.open(`https://wa.me/972${c.phone.replace(/^0/, "").replace(/\D/g, "")}`, "_blank")} />
          )}
        </div>
      </div>
    );
  }

  // ── Risky row ──────────────────────────────────────────────────────────────
  function RiskyRow({ p, reason }: { p: Project; reason: string }) {
    return (
      <div style={{ background: "#1A1A1A", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#E0E0E0" }}>{p.name}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{p.artist} · {p.status}</div>
          </div>
          <span style={{ fontSize: 11, color: "#F59E0B", textAlign: "left", maxWidth: 140 }}>{reason}</span>
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <ActionBtn label="פתח פרויקט" onClick={() => goToProject(p.id)} variant="primary" />
        </div>
      </div>
    );
  }

  // ── No-deadline row ────────────────────────────────────────────────────────
  function NoDeadlineRow({ p }: { p: Project }) {
    return (
      <div style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#E0E0E0" }}>{p.name}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{p.artist}</div>
          </div>
          <span style={{ fontSize: 11, color: "#555" }}>{p.status}</span>
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <ActionBtn label="פתח פרויקט" onClick={() => goToProject(p.id)} variant="primary" />
        </div>
      </div>
    );
  }

  // ── Render list by modal key ───────────────────────────────────────────────
  function renderList() {
    switch (modalKey) {
      case "open-balance":
        if (!projectsWithOpenBalance.length) return <Empty />;
        return projectsWithOpenBalance.map((p) => <FinRow key={p.id} p={p} />);
      case "in-mix-unpaid":
        if (!projectsInMixUnpaid.length) return <Empty />;
        return projectsInMixUnpaid.map((p) => <FinRow key={p.id} p={p} />);
      case "proposals-open":
        if (!openProposals.length) return <Empty />;
        return openProposals.map((p) => <ProposalInsightRow key={p.id} p={p} today={todayStr} />);
      case "proposals-followup": {
        const followupList = [...followupOverdue, ...followupToday.filter((p) => !followupOverdue.some((o) => o.id === p.id))];
        if (!followupList.length) return <Empty />;
        return followupList.map((p) => <ProposalInsightRow key={p.id} p={p} today={todayStr} />);
      }
      case "overdue":
        if (!overdue.length) return <Empty />;
        return overdue.map((p) => <DeadlineRow key={p.id} p={p} />);
      case "due-today":
        if (!dueToday.length) return <Empty />;
        return dueToday.map((p) => <DeadlineRow key={p.id} p={p} />);
      case "due-this-week":
        if (!dueThisWeek.length) return <Empty />;
        return dueThisWeek.map((p) => <DeadlineRow key={p.id} p={p} />);
      case "no-deadline":
        if (!noDeadline.length) return <Empty />;
        return noDeadline.map((p) => <NoDeadlineRow key={p.id} p={p} />);
      case "over-limit":
        if (!projectsOverLimit.length) return <Empty />;
        return projectsOverLimit.map((p) => <SessionRow key={p.id} p={p} />);
      case "at-limit":
        if (!projectsAtLimit.length) return <Empty />;
        return projectsAtLimit.map((p) => <SessionRow key={p.id} p={p} />);
      case "one-before-limit":
        if (!projectsOneBeforeLimit.length) return <Empty />;
        return projectsOneBeforeLimit.map((p) => <SessionRow key={p.id} p={p} />);
      case "no-email":
        if (!clientsNoEmail.length) return <Empty />;
        return clientsNoEmail.map((c) => <ClientRow key={c.id} c={c} />);
      case "risky":
        if (!riskyProjects.length) return <Empty />;
        return riskyProjects.map(({ project: p, reason }) => <RiskyRow key={p.id} p={p} reason={reason} />);
      default:
        return <Empty />;
    }
  }

  function ProposalInsightRow({ p, today }: { p: ProposalRow; today: string }) {
    const isOverdue = !!p.followup_date && p.followup_date < today;
    const isToday   = p.followup_date === today;
    const followupColor = isOverdue ? "#EF4444" : isToday ? "#F59E0B" : "#555";
    return (
      <div style={{ padding: "10px 0", borderBottom: "1px solid #1E1E1E", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#D8D8D8" }}>{p.title}</div>
            <div style={{ fontSize: 11, color: "#666" }}>{p.client_name}</div>
          </div>
          <div style={{ textAlign: "left", flexShrink: 0 }}>
            {p.amount > 0 && (
              <div style={{ fontSize: 13, fontWeight: 700, color: "#A855F7" }}>
                {p.amount.toLocaleString("he-IL")}{p.currency}
              </div>
            )}
            <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{p.status}</div>
          </div>
        </div>
        {p.followup_date && (
          <div style={{ fontSize: 11, color: followupColor }}>
            {isOverdue ? "⚠ עבר תאריך מעקב: " : isToday ? "📌 מעקב היום: " : "מעקב: "}
            {p.followup_date}
          </div>
        )}
        {p.notes && <div style={{ fontSize: 11, color: "#444", lineHeight: 1.4 }}>{p.notes}</div>}
      </div>
    );
  }

  function Empty() {
    return <div style={{ textAlign: "center", color: "#444", fontSize: 13, padding: "24px 0" }}>אין פריטים להצגה</div>;
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 20, width: "100%", maxWidth: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", direction: "rtl" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: "1px solid #222" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0" }}>{title}</span>
            <span style={{ fontSize: 18 }}>{icon}</span>
          </div>
        </div>

        {/* List */}
        <div style={{ overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {renderList()}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function InsightsPage() {
  const { projects } = useProjects();
  const [sessions,     setSessions]     = useState<Session[]>([]);
  const [limits,       setLimits]       = useState<Record<string, number>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [finSettings,  setFinSettings]  = useState<FinanceSetting[]>([]);
  const [clients,      setClients]      = useState<Client[]>([]);
  const [loaded,       setLoaded]       = useState(false);
  const [activeModal,  setActiveModal]  = useState<ModalKey | null>(null);

  // Agent alerts
  const [agentAlerts,       setAgentAlerts]       = useState<AgentAlert[]>([]);
  const [agentAlertsLoaded, setAgentAlertsLoaded] = useState(false);
  const [updatingIds,       setUpdatingIds]       = useState<Set<string>>(new Set());
  const [snapshotCopied,    setSnapshotCopied]    = useState(false);
  const [snapshotLoading,   setSnapshotLoading]   = useState(false);

  const [period,     setPeriod]     = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");

  const [proposals, setProposals] = useState<ProposalRow[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/sessions?all=1").then((r) => r.json()),
      fetch("/api/transactions?all=1").then((r) => r.json()),
      fetch("/api/clients").then((r) => r.json()),
      fetch("/api/proposals/all").then((r) => r.json()),
    ]).then(([s, t, c, p]) => {
      setSessions(s.sessions ?? []);
      setLimits(s.limits ?? {});
      setTransactions(t.transactions ?? []);
      setFinSettings(t.settings ?? []);
      setClients(c.clients ?? []);
      setProposals(p.proposals ?? []);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  // Fetch agent alerts separately — skipped entirely while the agent is disabled
  // (no fetch, no stale alerts shown).
  useEffect(() => {
    if (!MAI_AI_ENABLED) { setAgentAlertsLoaded(true); return; }
    fetch("/api/agent/alerts?status=new&limit=20")
      .then((r) => r.json())
      .then((data) => {
        setAgentAlerts(data.alerts ?? []);
        setAgentAlertsLoaded(true);
      })
      .catch(() => setAgentAlertsLoaded(true));
  }, []);

  const handleAlertAction = useCallback(async (id: string, status: AlertStatus) => {
    setUpdatingIds((prev) => new Set(prev).add(id));
    try {
      await fetch(`/api/agent/alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setAgentAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // ignore
    } finally {
      setUpdatingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  }, []);

  const handleSnapshot = useCallback(async () => {
    setSnapshotLoading(true);
    try {
      const res = await fetch("/api/agent/context");
      if (!res.ok) throw new Error("שגיאה");
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setSnapshotCopied(true);
      setTimeout(() => setSnapshotCopied(false), 3000);
    } catch {
      alert("שגיאה ביצירת תמונת מצב");
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  const openModal = useCallback((key: ModalKey) => setActiveModal(key), []);
  const closeModal = useCallback(() => setActiveModal(null), []);

  // ── Period ──────────────────────────────────────────────────────────────────
  const range = getRange(period, customFrom, customTo);
  const { heading: periodHeading, sub: periodSub } = getPeriodLabel(period, customFrom, customTo);

  // ── Project helpers ─────────────────────────────────────────────────────────
  const activeProjects = projects.filter((p) => !["הושלם", "בהשהייה"].includes(p.status));
  const getLimit = (id: string) => limits[id] ?? 3;

  const sessionsByProject: Record<string, number> = {};
  sessions.forEach((s) => { sessionsByProject[s.project_id] = (sessionsByProject[s.project_id] ?? 0) + 1; });

  const periodSessions    = sessions.filter((s) => inRange(s.date, range));
  const totalHours        = periodSessions.reduce((acc, s) => acc + sessionHours(s), 0);
  const avgSessionsPerProj= activeProjects.length > 0
    ? (Object.values(sessionsByProject).reduce((a, b) => a + b, 0) / Math.max(activeProjects.length, 1))
    : 0;

  const projectsOverLimit      = activeProjects.filter((p) => (sessionsByProject[p.id] ?? 0) >  getLimit(p.id));
  const projectsAtLimit        = activeProjects.filter((p) => (sessionsByProject[p.id] ?? 0) === getLimit(p.id));
  const projectsOneBeforeLimit = activeProjects.filter((p) => (sessionsByProject[p.id] ?? 0) === getLimit(p.id) - 1);

  // ── Finance ─────────────────────────────────────────────────────────────────
  // Must match ProjectDrawer's PAID_STATUSES: both "שולם" and "התקבל" count as received.
  const PAID_STATUSES_SET = new Set(["שולם", "התקבל"]);
  const paidByProject: Record<string, number> = {};
  transactions.filter((t) => t.type === "income" && PAID_STATUSES_SET.has(t.payment_status)).forEach((t) => {
    paidByProject[t.project_id] = (paidByProject[t.project_id] ?? 0) + t.amount;
  });

  const periodIncome    = transactions.filter((t) => t.type === "income"  && inRange(t.date, range));
  const periodExpenses  = transactions.filter((t) => t.type === "expense" && inRange(t.date, range));
  const incomeReceived  = periodIncome.filter((t) => PAID_STATUSES_SET.has(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const incomeExpected  = periodIncome.filter((t) => ["צפוי","חלקי","לבדיקה"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const expensesPaid    = periodExpenses.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const expensesExpected= periodExpenses.filter((t) => ["צפוי","לא שולם","חלקי"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const profitReal      = incomeReceived - expensesPaid;
  const profitEst       = incomeReceived + incomeExpected - expensesPaid - expensesExpected;

  const projectsWithOpenBalance = projects.filter((p) => {
    const setting = finSettings.find((s) => s.project_id === p.id);
    // Skip projects flagged as a finance exception (no charge / favor) — they
    // must not be counted as debt/balance anywhere downstream.
    if (setting?.financeException) return false;
    const agreed  = setting?.agreedPrice ?? 0;
    const paid    = paidByProject[p.id] ?? 0;
    return agreed > 0 && paid < agreed;
  });
  const projectsInMixUnpaid = projects.filter((p) =>
    ["מחכה למיקס","במיקס"].includes(p.status) && projectsWithOpenBalance.some((op) => op.id === p.id)
  );

  // ── Proposals ────────────────────────────────────────────────────────────────
  const CLOSED_PROPOSAL = new Set(["נסגר", "לא נסגר"]);
  const todayStr = new Date().toISOString().split("T")[0];
  const openProposals    = proposals.filter((p) => !CLOSED_PROPOSAL.has(p.status));
  const followupOverdue  = openProposals.filter((p) => p.followup_date && p.followup_date < todayStr);
  const followupToday    = openProposals.filter((p) => p.followup_date === todayStr);
  const proposalPotential = openProposals.filter((p) => p.currency === "₪").reduce((s, p) => s + (p.amount ?? 0), 0);

  // ── Deadlines ────────────────────────────────────────────────────────────────
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

  // ── Build alerts ──────────────────────────────────────────────────────────────
  const alerts: Alert[] = [];
  if (projectsInMixUnpaid.length === 1) {
    alerts.push({ level: "danger", text: `"${projectsInMixUnpaid[0].name}" ב${projectsInMixUnpaid[0].status} עם יתרה לא משולמת`, modal: "in-mix-unpaid" });
  } else if (projectsInMixUnpaid.length > 1) {
    alerts.push({ level: "danger", text: `${projectsInMixUnpaid.length} פרויקטים במיקס עם יתרה לא משולמת`, modal: "in-mix-unpaid" });
  }
  if (overdue.length === 1) {
    const days = Math.abs(daysUntil(overdue[0].deadline) ?? 0);
    alerts.push({ level: "danger", text: `"${overdue[0].name}" עבר דדליין לפני ${days} ${days === 1 ? "יום" : "ימים"}`, modal: "overdue" });
  } else if (overdue.length > 1) {
    alerts.push({ level: "danger", text: `${overdue.length} פרויקטים עברו את הדדליין`, modal: "overdue" });
  }
  if (alerts.length < 5 && projectsOverLimit.length > 0) {
    if (projectsOverLimit.length === 1) {
      const p = projectsOverLimit[0];
      alerts.push({ level: "warning", text: `"${p.name}" חרג מהמכסה: ${sessionsByProject[p.id]}/${getLimit(p.id)} סשנים`, modal: "over-limit" });
    } else {
      alerts.push({ level: "warning", text: `${projectsOverLimit.length} פרויקטים חרגו ממכסת הסשנים`, modal: "over-limit" });
    }
  }
  if (alerts.length < 5 && projectsAtLimit.length > 0) {
    const p = projectsAtLimit[0];
    alerts.push({ level: "warning", text: `"${p.name}" הגיע למכסה: ${sessionsByProject[p.id]}/${getLimit(p.id)} סשנים`, modal: "at-limit" });
  }
  if (alerts.length < 5 && dueThisWeek.length > 0) {
    alerts.push({ level: "warning", text: `${dueThisWeek.length} ${dueThisWeek.length === 1 ? "פרויקט" : "פרויקטים"} עם דדליין בשבוע הקרוב`, modal: "due-this-week" });
  }
  if (alerts.length < 5 && clientsNoEmail.length > 0) {
    alerts.push({ level: "info", text: `${clientsNoEmail.length} לקוחות / אמנים ללא כתובת מייל`, modal: "no-email" });
  }
  if (alerts.length < 5 && projectsWithOpenBalance.length > 0) {
    alerts.push({ level: "info", text: `${projectsWithOpenBalance.length} פרויקטים עם יתרה פתוחה`, modal: "open-balance" });
  }
  const displayAlerts = alerts.slice(0, 5);

  const SEL_S: React.CSSProperties = {
    background: "transparent", border: "1px solid #2A2A2A", borderRadius: 8,
    color: "#555", fontSize: 12, padding: "5px 10px", outline: "none", fontFamily: "inherit",
  };

  // ── Shared modal props ─────────────────────────────────────────────────────
  const modalProps = {
    projects, finSettings, paidByProject, sessionsByProject, limits,
    overdue, dueToday, dueThisWeek, noDeadline,
    projectsWithOpenBalance, projectsInMixUnpaid,
    projectsOverLimit, projectsAtLimit, projectsOneBeforeLimit,
    clientsNoEmail, riskyProjects: topRiskyProjects,
    openProposals, followupOverdue, followupToday, todayStr,
    onClose: closeModal,
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" style={{ padding: "28px 32px", maxWidth: 1200, margin: "0 auto" }}>

      {/* Detail modal */}
      {activeModal && <InsightDetailModal modalKey={activeModal} {...modalProps} />}

      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#E8E8E8", margin: "0 0 2px" }}>
          תובנות
          {periodHeading && <span style={{ fontSize: 14, fontWeight: 400, color: "#555", marginRight: 10 }}>— {periodHeading}</span>}
        </h1>
        <p style={{ fontSize: 12, color: "#555", margin: 0 }}>
          {periodSub || "לחץ על כל תובנה לפירוט המלא"}
        </p>
      </div>

      {/* Period selector */}
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
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ ...SEL_S, colorScheme: "dark", width: 140 }} />
            <span style={{ color: "#333" }}>—</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ ...SEL_S, colorScheme: "dark", width: 140 }} />
          </>
        )}
      </div>

      {!loaded ? (
        <div style={{ color: "#444", fontSize: 13, padding: "60px", textAlign: "center" }}>טוען נתונים...</div>
      ) : (
        <>
          {/* 🤖 התראות סוכן — hidden while Mai AI is disabled; show a calm off state */}
          {!MAI_AI_ENABLED ? (
            <div style={{ background: "#181818", border: "1px solid #252525", borderRadius: 16, padding: "18px 18px", marginBottom: 24, textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#555" }}>🤖 התובנות החכמות כבויות כרגע</div>
            </div>
          ) : (agentAlertsLoaded || agentAlerts.length > 0) && (
            <div style={{ background: "#181818", border: "1px solid #252525", borderRadius: 16, padding: "16px 18px", marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: agentAlerts.length > 0 ? 12 : 0 }}>
                <button
                  onClick={handleSnapshot}
                  disabled={snapshotLoading}
                  style={{
                    padding: "5px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                    border: snapshotCopied ? "1px solid rgba(16,185,129,0.4)" : "1px solid #2A2A2A",
                    background: snapshotCopied ? "rgba(16,185,129,0.1)" : "#1A1A1A",
                    color: snapshotCopied ? "#10B981" : "#666",
                    cursor: snapshotLoading ? "wait" : "pointer",
                    fontFamily: "inherit", transition: "all 0.2s",
                  }}
                >
                  {snapshotCopied ? "✓ הועתק!" : snapshotLoading ? "מכין..." : "📋 צור תמונת מצב"}
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#555", letterSpacing: "0.05em" }}>🤖 התראות סוכן</span>
                  {agentAlerts.length > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: "#141414",
                      background: "#EF4444", borderRadius: 10,
                      padding: "1px 6px", minWidth: 18, textAlign: "center",
                    }}>
                      {agentAlerts.length}
                    </span>
                  )}
                </div>
              </div>
              {agentAlerts.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {agentAlerts.map((a) => (
                    <AgentAlertCard
                      key={a.id}
                      alert={a}
                      onAction={handleAlertAction}
                      updating={updatingIds.has(a.id)}
                    />
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: "center", color: "#444", fontSize: 12, padding: "16px 0" }}>
                  ✓ אין התראות פעילות
                </div>
              )}
            </div>
          )}

          {/* ⚠ מה דורש תשומת לב */}
          {displayAlerts.length > 0 && (
            <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: 16, padding: "16px 18px", marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 12, letterSpacing: "0.05em" }}>
                ⚠ מה דורש תשומת לב
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {displayAlerts.map((a, i) => (
                  <AlertItem
                    key={i}
                    alert={a}
                    onClick={a.modal ? () => openModal(a.modal!) : undefined}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Summary chips */}
          <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
            <SummaryChip label="סשנים בתקופה"      value={periodSessions.length}       color="#A855F7" />
            <SummaryChip label="שעות עבודה בתקופה" value={totalHours > 0 ? fmtHours(totalHours) : "—"} color="#A855F7" />
            <SummaryChip label="פרויקטים פעילים"   value={activeProjects.length}        color="#3B82F6" />
            <SummaryChip label="רווח בפועל"        value={fmtMoney(profitReal)}         color={profitReal >= 0 ? "#10B981" : "#EF4444"} />
            <SummaryChip label="רווח משוער"         value={fmtMoney(profitEst)}          color={profitEst >= 0 ? "#10B981" : "#EF4444"} />
          </div>

          {/* Cards grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>

            {/* סשנים וזמן */}
            <Card title="סשנים וזמן" icon="⏱">
              <StatRow label="סה״כ סשנים בתקופה"       value={periodSessions.length}       color="#A855F7" />
              <StatRow label="שעות בתקופה"               value={totalHours > 0 ? fmtHours(totalHours) : "—"} color="#A855F7" />
              <StatRow label="ממוצע סשנים לפרויקט פעיל" value={avgSessionsPerProj.toFixed(1)} color="#888" />
              <div style={{ height: 1, background: "#222", margin: "4px 0" }} />
              <StatRow
                label="פרויקטים שחרגו ממכסה"
                value={projectsOverLimit.length}
                color={projectsOverLimit.length > 0 ? "#EF4444" : "#555"}
                onClick={projectsOverLimit.length > 0 ? () => openModal("over-limit") : undefined}
              />
              <StatRow
                label="פרויקטים שהגיעו למכסה"
                value={projectsAtLimit.length}
                color={projectsAtLimit.length > 0 ? "#F59E0B" : "#555"}
                onClick={projectsAtLimit.length > 0 ? () => openModal("at-limit") : undefined}
              />
              <StatRow
                label="פרויקט אחד לפני חריגה"
                value={projectsOneBeforeLimit.length}
                color={projectsOneBeforeLimit.length > 0 ? "#F59E0B" : "#555"}
                onClick={projectsOneBeforeLimit.length > 0 ? () => openModal("one-before-limit") : undefined}
              />
            </Card>

            {/* כספים */}
            <Card title="כספים" icon="₪">
              <StatRow label="הכנסות שהתקבלו"   value={fmtMoney(incomeReceived)}   color="#10B981" />
              <StatRow label="הכנסות צפויות"     value={fmtMoney(incomeExpected)}   color="#3B82F6" />
              <StatRow label="הוצאות ששולמו"     value={fmtMoney(expensesPaid)}     color="#F59E0B" />
              <StatRow label="הוצאות צפויות"     value={fmtMoney(expensesExpected)} color="#F59E0B" />
              <div style={{ height: 1, background: "#222", margin: "4px 0" }} />
              <StatRow label="רווח בפועל"        value={fmtMoney(profitReal)}       color={profitReal >= 0 ? "#10B981" : "#EF4444"} />
              <StatRow label="רווח משוער"         value={fmtMoney(profitEst)}        color={profitEst >= 0 ? "#10B981" : "#EF4444"} />
              <div style={{ height: 1, background: "#222", margin: "4px 0" }} />
              <StatRow
                label="פרויקטים עם יתרה פתוחה"
                value={projectsWithOpenBalance.length}
                color={projectsWithOpenBalance.length > 0 ? "#F59E0B" : "#555"}
                onClick={projectsWithOpenBalance.length > 0 ? () => openModal("open-balance") : undefined}
              />
              <StatRow
                label="פרויקטים במיקס לא משולמים"
                value={projectsInMixUnpaid.length}
                color={projectsInMixUnpaid.length > 0 ? "#EF4444" : "#555"}
                onClick={projectsInMixUnpaid.length > 0 ? () => openModal("in-mix-unpaid") : undefined}
              />
            </Card>

            {/* הצעות מחיר */}
            <Card title="הצעות מחיר" icon="📋">
              <StatRow
                label="הצעות פתוחות"
                value={openProposals.length}
                color={openProposals.length > 0 ? "#A855F7" : "#555"}
                onClick={openProposals.length > 0 ? () => openModal("proposals-open") : undefined}
              />
              <StatRow
                label="עבר תאריך מעקב"
                value={followupOverdue.length}
                color={followupOverdue.length > 0 ? "#EF4444" : "#555"}
                onClick={followupOverdue.length > 0 ? () => openModal("proposals-followup") : undefined}
              />
              <StatRow
                label="מעקב היום"
                value={followupToday.length}
                color={followupToday.length > 0 ? "#F59E0B" : "#555"}
                onClick={followupToday.length > 0 ? () => openModal("proposals-followup") : undefined}
              />
              {proposalPotential > 0 && (
                <StatRow
                  label="פוטנציאל ₪"
                  value={proposalPotential.toLocaleString("he-IL") + "₪"}
                  color="#A855F7"
                  sub="סכום הצעות פתוחות"
                />
              )}
            </Card>

            {/* דד-ליינים */}
            <Card title="דד-ליינים" icon="📅">
              <StatRow
                label="פרויקטים שעברו דדליין"
                value={overdue.length}
                color={overdue.length > 0 ? "#EF4444" : "#555"}
                onClick={overdue.length > 0 ? () => openModal("overdue") : undefined}
              />
              <StatRow
                label="דדליין היום"
                value={dueToday.length}
                color={dueToday.length > 0 ? "#EF4444" : "#555"}
                onClick={dueToday.length > 0 ? () => openModal("due-today") : undefined}
              />
              <StatRow
                label="דדליין השבוע הקרוב"
                value={dueThisWeek.length}
                color={dueThisWeek.length > 0 ? "#F59E0B" : "#555"}
                onClick={dueThisWeek.length > 0 ? () => openModal("due-this-week") : undefined}
              />
              <StatRow
                label="פרויקטים בלי דדליין"
                value={noDeadline.length}
                color={noDeadline.length > 5 ? "#F59E0B" : "#555"}
                onClick={noDeadline.length > 0 ? () => openModal("no-deadline") : undefined}
              />
            </Card>

            {/* אמנים ולקוחות */}
            <Card title="אמנים ולקוחות" icon="🎤">
              {topSessionArtist && (
                <StatRow label="הכי הרבה סשנים" value={`${topSessionArtist[0]} (${topSessionArtist[1]})`} color="#A855F7" />
              )}
              {topProjArtist && (
                <StatRow label="הכי הרבה פרויקטים פעילים" value={`${topProjArtist[0]} (${topProjArtist[1]})`} color="#3B82F6" />
              )}
              {topBalanceArtist && (
                <StatRow label="יתרה פתוחה גדולה ביותר" value={`${topBalanceArtist[0]}: ${fmtMoney(topBalanceArtist[1])}`} color="#EF4444" />
              )}
              <div style={{ height: 1, background: "#222", margin: "4px 0" }} />
              <StatRow
                label="לקוחות ללא מייל"
                value={clientsNoEmail.length}
                color={clientsNoEmail.length > 0 ? "#F59E0B" : "#555"}
                onClick={clientsNoEmail.length > 0 ? () => openModal("no-email") : undefined}
              />
              <StatRow
                label="פרויקטים שעברו דדליין"
                value={overdue.length}
                color={overdue.length > 0 ? "#EF4444" : "#555"}
                onClick={overdue.length > 0 ? () => openModal("overdue") : undefined}
              />
            </Card>
          </div>

          {/* סיכון רווחיות */}
          {topRiskyProjects.length > 0 ? (
            <Card title="סיכון רווחיות" icon="⚡">
              <div style={{ fontSize: 11, color: "#555", marginTop: -6 }}>
                פרויקטים עם שילוב של סשנים רבים, יתרה פתוחה או רווח שלילי
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {topRiskyProjects.map(({ project: p, reason }) => (
                  <div
                    key={p.id}
                    onClick={() => openModal("risky")}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 12px",
                      background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)",
                      borderRadius: 10, cursor: "pointer", transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(239,68,68,0.12)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(239,68,68,0.06)"; }}
                  >
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
            <div style={{ background: "#181818", border: "1px solid #252525", borderRadius: 16, padding: "20px", textAlign: "center" }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
              <div style={{ fontSize: 13, color: "#555" }}>אין פרויקטים עם סיכון רווחיות מזוהה</div>
            </div>
          )}

          <div style={{ marginTop: 20, fontSize: 10, color: "#333", textAlign: "center" }}>
            הנתונים מחושבים ישירות מתוך Redbloods OS · מסונן לפי {periodHeading}{periodSub && ` (${periodSub})`}
          </div>
        </>
      )}
    </div>
  );
}
