"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useProjects } from "@/components/ProjectsProvider";
import { usePrivacyMode } from "@/lib/use-privacy";

// ── Design Tokens ─────────────────────────────────────────────────────────────
const BRAND  = "#DC2626";
const GREEN  = "#13C99A"; // bright teal-green (income / received / positive net)
const AMBER  = "#F5A623"; // gold (expected / pending / goal / warnings)
const RED    = "#EF4444";
const BLUE   = "#3B82F6";
const PURPLE = "#A855F7";
const CARD   = "#131620"; // card surface — slightly lighter than the page
const CARD2  = "#0E1017"; // deeper surface (table/section headers)
const BDR    = "rgba(132,148,176,0.12)"; // cool blue-gray hairline
const BDR2   = "rgba(132,148,176,0.20)"; // cool blue-gray, stronger
const TEXT   = "#F4F6FA";
const TEXT2  = "#9AA3B6"; // cool secondary gray
const MUTED  = "#5B6274"; // cool muted

// Monthly net-profit goal (UI-only; no settings/DB source yet).
const NET_MONTHLY_GOAL = 15000;

// ── Types ─────────────────────────────────────────────────────────────────────
type PaymentStatus = "שולם" | "צפוי" | "לא שולם" | "חלקי" | "בוטל" | "התקבל" | "לבדיקה";
type Period        = "month" | "3months" | "custom";
type SortMode      = "date-desc" | "date-asc" | "amount-desc" | "project" | "status" | "type";
type Scope         = "project" | "general";
type SourceFilter  = "all" | "project" | "general";
type ViewTab       = "all" | "income" | "expense" | "shows" | "unpaid" | "attention";

interface Transaction {
  id: string;
  project_id: string | null;
  scope: Scope;
  type: "income" | "expense";
  date: string | null;
  description: string;
  artist: string;
  amount: number;
  currency: string;
  payment_status: PaymentStatus;
  payment_method: string;
  receipt_ref: string;
  notes: string;
  category: string;
  expense_scope: string;
  created_at: string;
}

/** A transaction that originated from the Shows module (categorized as הופעה). */
function isShowTx(tx: Transaction): boolean {
  return tx.expense_scope === "הופעה" || tx.category === "הופעה";
}

interface FinanceSetting {
  project_id: string;
  agreedPrice: number;
  currency: string;
}

interface TxDraft {
  scope: Scope;
  projectId: string;
  type: "income" | "expense";
  date: string;
  description: string;
  artist: string;
  amount: string;
  currency: string;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  receiptRef: string;
  notes: string;
  category: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PROJECT_EXPENSE_CATEGORIES = ["מיקס / מאסטר", "חדר חזרות", "צילום", "נסיעות", "ציוד", "אחר"];
const GENERAL_EXPENSE_CATEGORIES = ["שכירות", "חשמל", "מים", "אינטרנט", "תוכנות ומנויים", "ציוד", "צוות", "שיווק", "נסיעות", "חובות", "משרד / סטודיו", "אחר"];
const INCOME_TYPES               = ["מקדמה", "תשלום חלקי", "תשלום סופי", "תשלום מלא", "תוספת / חריגה", "אחר"];
// Unified status set for ALL transactions (income + expense). "התקבל" is no
// longer offered in the UI — it is shown as "שולם" and saved as "שולם".
const ALL_STATUSES: PaymentStatus[] = ["שולם", "לא שולם", "צפוי", "בוטל", "חלקי"];
const INCOME_STATUSES        = ALL_STATUSES;
const EXPENSE_STATUSES       = ALL_STATUSES;
const QUICK_INCOME_STATUSES  = ALL_STATUSES;
const QUICK_EXPENSE_STATUSES = ALL_STATUSES;
const PAYMENT_METHODS   = ["ביט", "העברה בנקאית", "מזומן", "PayPal", "Payoneer", "אשראי", "אחר"];
const HEB_MONTHS        = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

// Single-month presets carry the offset they map to (0 = current month).
const PERIOD_OPTIONS: { label: string; period: Period; offset?: number }[] = [
  { label: "חודש קודם",    period: "month",   offset: -1 },
  { label: "חודש נוכחי",   period: "month",   offset: 0 },
  { label: "חודש הבא",     period: "month",   offset: 1 },
  { label: "3 חודשים",     period: "3months" },
  { label: "מותאם אישית",  period: "custom" },
];

const STATUS_COLOR: Record<string, string> = {
  "שולם":    GREEN,
  "התקבל":   GREEN,
  "צפוי":    BLUE,
  "לא שולם": RED,
  "חלקי":    AMBER,
  "בוטל":    "#6B7280",
  "לבדיקה":  PURPLE,
};

// ── Period helpers ─────────────────────────────────────────────────────────────
// monthOffset is relative to the current system month (0 = current, 1 = next, -1 = prev).
// Building dates via `new Date(y, m + monthOffset, 1)` handles year rollover both ways.
function getRange(period: Period, monthOffset: number, customFrom = "", customTo = ""): { from: Date | null; to: Date | null } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "month":
      return { from: new Date(y, m + monthOffset, 1), to: new Date(y, m + monthOffset + 1, 0, 23, 59, 59) };
    case "3months":
      // Current month + next 2 months
      return { from: new Date(y, m, 1), to: new Date(y, m + 3, 0, 23, 59, 59) };
    case "custom":
      if (customFrom && customTo)
        return { from: new Date(customFrom), to: new Date(customTo + "T23:59:59") };
      return { from: null, to: null };
  }
}

function getCompRange(period: Period, monthOffset: number): { from: Date | null; to: Date | null } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "month":
      // Previous month relative to the displayed month
      return { from: new Date(y, m + monthOffset - 1, 1), to: new Date(y, m + monthOffset, 0, 23, 59, 59) };
    case "3months":
      // Previous 3 months
      return { from: new Date(y, m - 3, 1), to: new Date(y, m, 0, 23, 59, 59) };
    default:
      return { from: null, to: null };
  }
}

function getCompLabel(period: Period): string {
  switch (period) {
    case "month":       return "מול חודש קודם";
    case "3months":     return "מול 3 חודשים קודמים";
    default:            return "";
  }
}

function getPeriodTitle(period: Period, monthOffset: number, customFrom = "", customTo = ""): string {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "month": {
      const d = new Date(y, m + monthOffset, 1);
      return `${HEB_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    }
    case "3months": {
      const start = new Date(y, m, 1);
      const end   = new Date(y, m + 2, 1);
      return `${HEB_MONTHS[start.getMonth()]} עד ${HEB_MONTHS[end.getMonth()]} ${end.getFullYear()}`;
    }
    case "custom":
      return customFrom && customTo ? `${fmtDate(customFrom)} עד ${fmtDate(customTo)}` : "מותאם אישית";
  }
}

function inRange(date: string | null, range: { from: Date | null; to: Date | null }): boolean {
  if (!date || !range.from || !range.to) return false;
  const d = new Date(date);
  return d >= range.from && d <= range.to;
}

// ── General helpers ────────────────────────────────────────────────────────────
function emptyDraft(projectId = "", scope: Scope = "project"): TxDraft {
  return {
    scope, projectId, type: "income", date: "", description: "", artist: "",
    amount: "", currency: "₪", paymentStatus: "צפוי",
    paymentMethod: "", receiptRef: "", notes: "", category: "",
  };
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, mo, day] = d.split("-");
  return `${day}.${mo}.${y}`;
}

function fmtAmount(amount: number, currency = "₪"): string {
  return `${amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${currency}`;
}

/**
 * User-facing notes: strips the internal "show_id:<uuid>" marker that the
 * Shows→Finance sync stores in notes (an internal link, not a user note).
 * Returns the remaining real note, or "" if the note was purely technical.
 * Anything a user typed survives — only the technical token is removed.
 */
function userVisibleNotes(notes: string | null | undefined): string {
  return (notes ?? "")
    .replace(/show_id:\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The internal "show_id:<uuid>" marker inside notes, or "" if none. */
function notesMarker(notes: string | null | undefined): string {
  const m = (notes ?? "").match(/show_id:\S+/);
  return m ? m[0] : "";
}

/** Re-attach the technical marker to a user-edited note (marker stays in DB). */
function mergeNotes(marker: string, userText: string): string {
  return [marker, (userText ?? "").trim()].filter(Boolean).join(" ");
}

/**
 * Display label for the "תנועה" column — never empty, even for older rows that
 * were saved without a description/category. Display-only (no DB change):
 *   1. description → 2. category → 3. show fallback → 4. project fallback →
 *   5. general fallback, by type.
 */
function getTransactionLabel(tx: Transaction): string {
  if (tx.description && tx.description.trim()) return tx.description.trim();
  if (tx.category && tx.category.trim())       return tx.category.trim();
  const isIncome = tx.type === "income";
  if (isShowTx(tx)) {
    return isIncome ? "הכנסה מהופעה" : "תנועת הופעה";
  }
  const isProject = !!tx.project_id || (tx.scope ?? "project") === "project";
  if (isProject) return isIncome ? "הכנסה מפרויקט" : "הוצאה לפרויקט";
  return isIncome ? "הכנסה כללית" : "הוצאה כללית";
}

function calcStats(txList: Transaction[]) {
  const income          = txList.filter((t) => t.type === "income");
  const expenses        = txList.filter((t) => t.type === "expense");
  const projectExpenses = expenses.filter((t) => (t.scope ?? "project") === "project");
  const generalExpenses = expenses.filter((t) => t.scope === "general");

  const incomeReceived    = income.filter((t) => ["התקבל", "שולם"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const incomeExpected    = income.filter((t) => ["צפוי", "חלקי", "לבדיקה"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const projExpPaid       = projectExpenses.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const genExpPaid        = generalExpenses.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const expensesPaid      = projExpPaid + genExpPaid;
  const expensesExpected  = expenses.filter((t) => ["צפוי", "לא שולם", "חלקי"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const profitReal        = incomeReceived - expensesPaid;
  const profitEst         = incomeReceived + incomeExpected - expensesPaid - expensesExpected;
  return { incomeReceived, incomeExpected, projExpPaid, genExpPaid, expensesPaid, expensesExpected, profitReal, profitEst };
}

// ── Style helpers ─────────────────────────────────────────────────────────────
const INPUT_S: React.CSSProperties = {
  background: CARD, border: `1px solid ${BDR2}`, borderRadius: 8,
  color: TEXT, fontSize: 13, padding: "8px 12px", outline: "none",
  fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};

const LABEL_S: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.06em",
  textTransform: "uppercase", marginBottom: 6, display: "block", textAlign: "right",
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.08em",
  textTransform: "uppercase", marginBottom: 10, paddingBottom: 6,
  borderBottom: `1px solid ${BDR}`,
};

const selectStyle: React.CSSProperties = {
  background: CARD, border: `1px solid ${BDR}`, borderRadius: 10,
  color: TEXT2, fontSize: 13, padding: "9px 14px", outline: "none",
  fontFamily: "inherit", cursor: "pointer",
};

// ── Status Badge ──────────────────────────────────────────────────────────────
/** Legacy "התקבל" rows are shown as "שולם" (same color); never display "התקבל". */
function statusLabel(status: string): string {
  return status === "התקבל" ? "שולם" : status;
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#6B7280";
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color,
      background: `${color}18`, border: `1px solid ${color}35`,
      borderRadius: 100, padding: "2px 8px", whiteSpace: "nowrap",
      display: "inline-flex", alignItems: "center",
    }}>
      {statusLabel(status)}
    </span>
  );
}

// ── Summary Card ──────────────────────────────────────────────────────────────
function SummaryCard({
  label, value, color, sub, icon, progress, progressLabel,
}: {
  label: string; value: string; color: string; sub?: string; icon?: string;
  progress?: number; progressLabel?: string;
}) {
  const pct = progress === undefined ? undefined : Math.max(0, Math.min(1, progress));

  return (
    <div style={{
      background: `linear-gradient(158deg, ${color}12, ${CARD} 52%)`,
      border: `1px solid ${BDR2}`, borderRadius: 18,
      padding: "22px 24px 20px", flex: "1 1 0", minWidth: 0, minHeight: 176,
      position: "relative", overflow: "hidden", display: "flex", flexDirection: "column",
      boxShadow: `0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 26px rgba(0,0,0,0.32)`,
    }}>
      {/* top accent */}
      <div style={{ position: "absolute", top: 0, insetInline: 0, height: 4, background: `linear-gradient(270deg, ${color}, ${color}00)` }} />
      {/* header: label + icon, chevron drill affordance */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: MUTED, fontSize: 15, opacity: 0.7 }}>‹</span>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT, letterSpacing: "0.01em", lineHeight: 1.2, marginInlineStart: "auto", textAlign: "left" }}>
          {label}
        </div>
        {icon && (
          <div style={{
            width: 46, height: 46, borderRadius: 13, flexShrink: 0,
            background: `${color}1E`, border: `1px solid ${color}38`, color,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23,
          }}>{icon}</div>
        )}
      </div>
      <div style={{ fontSize: 42, fontWeight: 900, color, letterSpacing: "-0.045em", lineHeight: 1, marginTop: "auto", textShadow: `0 0 26px ${color}33` }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 12, color: TEXT2, marginTop: 8 }}>{sub}</div>
      )}
      {pct !== undefined && (
        <div style={{ marginTop: 11 }}>
          <div style={{ height: 7, borderRadius: 100, background: BDR2, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(pct * 100)}%`, height: "100%", background: color, borderRadius: 100 }} />
          </div>
          {progressLabel && (
            <div style={{ fontSize: 10.5, color: MUTED, marginTop: 6, textAlign: "left" }}>{progressLabel}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Monthly Donut ─────────────────────────────────────────────────────────────
function MonthlyDonut({ income, expenses, pending }: { income: number; expenses: number; pending: number }) {
  const total = income + expenses;
  const pct   = total > 0 ? income / total : 0.5;
  const net   = income - expenses;

  const R = 64, CX = 80, stroke = 14;
  const circumference = 2 * Math.PI * R;
  const incomeArc = circumference * pct;
  const expArc    = circumference * (1 - pct);

  const row = (label: string, val: number, col: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 12.5, color: TEXT2, display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: col, display: "inline-block", flexShrink: 0 }} />
        {label}
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 800, color: col }}>₪{val.toLocaleString()}</span>
    </div>
  );

  return (
    <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "22px 20px" }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 18 }}>סקירה חודשית</div>
      <svg viewBox="0 0 160 160" width={170} style={{ display: "block", margin: "0 auto", direction: "ltr" }}>
        <circle cx={CX} cy={CX} r={R} fill="none" stroke={BDR2} strokeWidth={stroke} />
        <circle cx={CX} cy={CX} r={R} fill="none" stroke={AMBER} strokeWidth={stroke}
          strokeDasharray={`${expArc} ${circumference}`}
          strokeDashoffset={0}
          transform={`rotate(-90 ${CX} ${CX})`}
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CX} r={R} fill="none" stroke={GREEN} strokeWidth={stroke}
          strokeDasharray={`${incomeArc} ${circumference}`}
          strokeDashoffset={-expArc}
          transform={`rotate(-90 ${CX} ${CX})`}
          strokeLinecap="round"
        />
        <text x={CX} y={CX - 3} textAnchor="middle" fill={net >= 0 ? GREEN : RED} fontSize={22} fontWeight={900}>
          {net >= 0 ? "+" : "−"}{Math.abs(net).toLocaleString()}₪
        </text>
        <text x={CX} y={CX + 17} textAnchor="middle" fill={MUTED} fontSize={11}>נטו החודש</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 18, paddingTop: 16, borderTop: `1px solid ${BDR}` }}>
        {row("הכנסות", income, GREEN)}
        {row("הוצאות", expenses, AMBER)}
        {row("ממתין / לא שולם", pending, BLUE)}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, paddingTop: 11, borderTop: `1px solid ${BDR}` }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>נטו</span>
          <span style={{ fontSize: 16, fontWeight: 900, color: net >= 0 ? GREEN : RED }}>₪{net.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

// ── Custom Project Selector ───────────────────────────────────────────────────
function ProjectSelect({
  value, onChange, projects,
}: {
  value: string;
  onChange: (id: string, artist: string) => void;
  projects: { id: string; name: string; artist: string }[];
}) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const btnRef              = useRef<HTMLButtonElement>(null);
  const [pos, setPos]       = useState({ top: 0, left: 0, width: 0 });

  const selected = projects.find((p) => p.id === value);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const portal = document.getElementById("project-select-portal");
      if (portal && portal.contains(e.target as Node)) return;
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setSearch("");
    setOpen((v) => !v);
  };

  const filtered = projects.filter((p) =>
    !search || p.name.includes(search) || p.artist.includes(search)
  );

  const dropdown = (
    <div
      id="project-select-portal"
      style={{
        position: "fixed", top: pos.top, left: pos.left, width: Math.max(pos.width, 280),
        zIndex: 999999, background: CARD, border: `1px solid ${BDR2}`,
        borderRadius: 12, padding: 6, boxShadow: "0 12px 40px rgba(0,0,0,0.8)",
        maxHeight: 280, display: "flex", flexDirection: "column",
      }}
    >
      <input
        autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="חפש פרויקט..."
        style={{ ...INPUT_S, marginBottom: 6, fontSize: 12, padding: "6px 10px" }}
      />
      <div style={{ overflowY: "auto", flex: 1 }}>
        {filtered.length === 0
          ? <div style={{ fontSize: 12, color: MUTED, padding: "8px 10px", textAlign: "center" }}>אין תוצאות</div>
          : filtered.map((p) => (
            <button key={p.id}
              onClick={() => { onChange(p.id, p.artist); setOpen(false); }}
              style={{
                display: "block", width: "100%", textAlign: "right",
                padding: "8px 10px", borderRadius: 8, border: "none",
                background: p.id === value ? `${BRAND}15` : "transparent",
                cursor: "pointer", fontFamily: "inherit",
              }}
              onMouseEnter={(e) => { if (p.id !== value) (e.currentTarget as HTMLButtonElement).style.background = `rgba(255,255,255,0.04)`; }}
              onMouseLeave={(e) => { if (p.id !== value) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <div style={{ fontSize: 13, color: p.id === value ? BRAND : TEXT, fontWeight: p.id === value ? 600 : 400 }}>{p.name}</div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{p.artist}</div>
            </button>
          ))}
      </div>
    </div>
  );

  return (
    <>
      <button ref={btnRef} type="button" onClick={handleOpen} style={{
        ...INPUT_S, textAlign: "right", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        color: selected ? TEXT : MUTED,
      }}>
        <span style={{ fontSize: 12, color: MUTED }}>▾</span>
        <span>{selected ? selected.name : "בחר פרויקט..."}</span>
      </button>
      {open && typeof document !== "undefined" && createPortal(dropdown, document.body)}
    </>
  );
}

// ── Transaction Modal ─────────────────────────────────────────────────────────
function TxModal({
  draft, setDraft, saving, onSave, onCancel, projects, title, isEdit = false, onDelete,
}: {
  draft: TxDraft;
  setDraft: (d: TxDraft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  projects: { id: string; name: string; artist: string }[];
  title: string;
  isEdit?: boolean;
  onDelete?: () => void;
}) {
  const isIncome    = draft.type === "income";
  const isGeneral   = draft.scope === "general";
  const categoryList = isIncome
    ? INCOME_TYPES
    : isGeneral ? GENERAL_EXPENSE_CATEGORIES : PROJECT_EXPENSE_CATEGORIES;
  const statusList   = isIncome ? INCOME_STATUSES : EXPENSE_STATUSES;
  const isOther      = draft.category === "אחר";
  const canSave      = !saving && !!draft.amount && (isGeneral || !!draft.projectId) && (!isOther || !!draft.description);
  // In-modal delete confirmation (no window.confirm); resets when the modal
  // unmounts on close.
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onCancel]);

  const modal = (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: CARD2, border: `1px solid rgba(220,38,38,0.25)`,
        borderRadius: 20, padding: "22px 22px 18px",
        width: 460, maxWidth: "95vw", direction: "rtl",
        boxShadow: "0 24px 80px rgba(0,0,0,0.9)",
        maxHeight: "92vh", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>✕</button>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: TEXT, margin: 0 }}>{title}</h2>
        </div>

        {/* Type toggle — hidden when editing an existing transaction (type is fixed) */}
        {!isEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {(["income", "expense"] as const).map((t) => (
            <button key={t} type="button"
              onClick={() => setDraft({ ...draft, type: t, paymentStatus: t === "income" ? "צפוי" : "שולם", category: "" })}
              style={{
                flex: 1, padding: "9px", borderRadius: 10, border: "none", cursor: "pointer",
                fontSize: 13, fontFamily: "inherit", fontWeight: 600,
                background: draft.type === t ? (t === "income" ? `${GREEN}18` : `${RED}14`) : CARD,
                color: draft.type === t ? (t === "income" ? GREEN : RED) : MUTED,
                outline: draft.type === t ? `1px solid ${t === "income" ? `${GREEN}40` : `${RED}30`}` : `1px solid ${BDR}`,
              }}
            >
              {t === "income" ? "💰 הכנסה" : "💸 הוצאה"}
            </button>
          ))}
        </div>
        )}

        {/* Scope toggle — hidden when editing (scope is fixed for an existing tx) */}
        {!isEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {(["project", "general"] as Scope[]).map((s) => (
            <button key={s} type="button"
              onClick={() => setDraft({ ...draft, scope: s, projectId: s === "general" ? "" : draft.projectId, category: "" })}
              style={{
                flex: 1, padding: "7px", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 12, fontFamily: "inherit", fontWeight: 600,
                background: draft.scope === s ? `${BRAND}14` : CARD,
                color: draft.scope === s ? BRAND : MUTED,
                outline: draft.scope === s ? `1px solid ${BRAND}35` : `1px solid ${BDR}`,
              }}
            >
              {s === "project" ? "📁 פרויקט" : "🏢 כללי"}
            </button>
          ))}
        </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

          {/* ── בלוק 1: פרויקט וסוג ── */}
          <div>
            <div style={SECTION_LABEL}>{isGeneral ? "סוג" : "פרויקט וסוג"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {!isGeneral && (
                <div>
                  <label style={LABEL_S}>פרויקט *</label>
                  <ProjectSelect value={draft.projectId} projects={projects}
                    onChange={(id, artist) => setDraft({ ...draft, projectId: id, artist })} />
                </div>
              )}
              <div>
                <label style={LABEL_S}>{isIncome ? "סוג הכנסה" : "קטגוריה"}</label>
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} style={INPUT_S}>
                  <option value="">בחר...</option>
                  {categoryList.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {isOther && (
                  <div style={{ fontSize: 10, color: AMBER, marginTop: 4 }}>⚠ נא למלא תיאור מפורט</div>
                )}
              </div>
            </div>
          </div>

          {/* ── בלוק 2: מול מי + תיאור ── */}
          <div>
            <div style={SECTION_LABEL}>{isIncome ? "לקוח ותיאור" : "ספק ותיאור"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={LABEL_S}>{isIncome ? "לקוח / אמן" : isGeneral ? "ספק / שם" : "ספק / למי שולם"}</label>
                <input type="text" value={draft.artist} onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
                  placeholder={isIncome ? "שם הלקוח / האמן..." : "שם הספק..."} style={INPUT_S} />
              </div>
              <div>
                <label style={{ ...LABEL_S, ...(isOther ? { color: AMBER } : {}) }}>
                  תיאור{isOther ? " *" : ""}
                </label>
                <input type="text" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder={isIncome ? "למשל: מקדמה לפרויקט..." : "למשל: חשמל ינואר, מנוי Adobe..."}
                  style={{ ...INPUT_S, ...(isOther && !draft.description ? { borderColor: `${AMBER}50` } : {}) }} />
              </div>
            </div>
          </div>

          {/* ── בלוק 3: כסף וזמן ── */}
          <div>
            <div style={SECTION_LABEL}>כסף וזמן</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 10 }}>
                <div>
                  <label style={LABEL_S}>סכום *</label>
                  <input type="number" value={draft.amount} min={0}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                    placeholder="0" style={INPUT_S} />
                </div>
                <div>
                  <label style={LABEL_S}>מטבע</label>
                  <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} style={INPUT_S}>
                    {["₪", "$", "€"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={LABEL_S}>תאריך</label>
                  <input type="date" value={draft.date}
                    onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                    style={{ ...INPUT_S, colorScheme: "dark" }} />
                </div>
                <div>
                  <label style={LABEL_S}>סטטוס</label>
                  <select value={draft.paymentStatus} onChange={(e) => setDraft({ ...draft, paymentStatus: e.target.value as PaymentStatus })} style={INPUT_S}>
                    {statusList.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* ── בלוק 4: השלמות ── */}
          <div>
            <div style={SECTION_LABEL}>השלמות</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={LABEL_S}>אמצעי תשלום</label>
                <select value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })} style={INPUT_S}>
                  <option value="">בחר...</option>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={LABEL_S}>אסמכתא / קבלה / חשבונית</label>
                <input type="text" value={draft.receiptRef} onChange={(e) => setDraft({ ...draft, receiptRef: e.target.value })}
                  placeholder="מספר קבלה..." style={INPUT_S} />
              </div>
              <div>
                <label style={LABEL_S}>הערות</label>
                <input type="text" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="הערות נוספות..." style={INPUT_S}
                  onKeyDown={(e) => { if (e.key === "Enter" && canSave) onSave(); }} />
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onCancel} style={{
              flex: 1, padding: "11px", borderRadius: 10,
              border: `1px solid ${BDR2}`, background: "transparent",
              color: TEXT2, cursor: "pointer", fontSize: 13, fontFamily: "inherit",
            }}>ביטול</button>
            <button type="button" onClick={onSave} disabled={!canSave}
              style={{
                flex: 2, padding: "11px", borderRadius: 10, border: "none",
                background: canSave ? (isIncome ? "#065F46" : isGeneral ? "#4C1D95" : "#7C2D12") : CARD,
                color: canSave ? "#fff" : MUTED,
                cursor: canSave ? "pointer" : "not-allowed",
                fontSize: 13, fontWeight: 700, fontFamily: "inherit",
              }}
            >
              {saving ? "שומר..." : isIncome ? "שמור הכנסה" : "שמור הוצאה"}
            </button>
          </div>

          {/* Delete — edit mode only, with an in-modal confirm step */}
          {isEdit && onDelete && (
            confirmDelete ? (
              <div style={{
                marginTop: 2, padding: "13px 14px", borderRadius: 12,
                border: `1px solid ${RED}33`, background: `${RED}0F`,
              }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>למחוק את התנועה הזו?</div>
                <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 4, lineHeight: 1.5 }}>
                  הפעולה תמחק את התנועה מהכספים ולא ניתן לשחזר אותה.
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button type="button" onClick={() => setConfirmDelete(false)} style={{
                    flex: 1, padding: "9px", borderRadius: 9, border: `1px solid ${BDR2}`,
                    background: "transparent", color: TEXT2, cursor: "pointer",
                    fontSize: 12.5, fontFamily: "inherit",
                  }}>ביטול</button>
                  <button type="button" onClick={onDelete} disabled={saving} style={{
                    flex: 1, padding: "9px", borderRadius: 9, border: "none",
                    background: RED, color: "#fff", cursor: saving ? "not-allowed" : "pointer",
                    fontSize: 12.5, fontWeight: 700, fontFamily: "inherit",
                  }}>כן, מחק תנועה</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving} style={{
                padding: "10px", borderRadius: 10, border: `1px solid ${RED}30`,
                background: `${RED}0A`, color: RED, cursor: saving ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: 600, fontFamily: "inherit", marginTop: 2,
              }}>× מחק תנועה</button>
            )
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FinancePage() {
  const { projects } = useProjects();
  const [privacyHidden, togglePrivacy] = usePrivacyMode();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [_settings,    setSettings]     = useState<FinanceSetting[]>([]);
  const [loaded,       setLoaded]       = useState(false);

  // Period
  const [period,     setPeriod]     = useState<Period>("month");
  // Displayed month relative to the current system month (0 = current). Drives
  // the ‹ › navigator so it composes (next then prev returns to the same month).
  const [monthOffset, setMonthOffset] = useState(0);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");
  const [showUndated, setShowUndated] = useState(false);

  // Table filters
  const [viewTab,      setViewTab]      = useState<ViewTab>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState("");
  const [sortMode,     setSortMode]     = useState<SortMode>("date-desc");
  const [groupByMonth, setGroupByMonth] = useState(false);
  // Source-grouped card view (הופעות / פרויקטים / כללי) is now opt-in; the flat
  // table is the default (matches the approved design).
  const [groupBySource, setGroupBySource] = useState(false);
  // Client-side-only enrichment filters over already-loaded data (no API/DB):
  const [searchQuery,    setSearchQuery]    = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [contactFilter,  setContactFilter]  = useState("");

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft,     setDraft]     = useState<TxDraft>(emptyDraft());
  const [saving,    setSaving]    = useState(false);
  // Inline quick-status popover: which row is open + where to anchor it.
  const [statusMenu, setStatusMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // Source groups (הופעות / פרויקטים / כללי) that are collapsed.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const loadAll = useCallback(() => {
    setLoaded(false);
    fetch("/api/transactions?all=1")
      .then((r) => r.json())
      .then((d) => {
        setTransactions(d.transactions ?? []);
        setSettings(d.settings ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Period computations ────────────────────────────────────────────────────
  const range       = getRange(period, monthOffset, customFrom, customTo);
  const compRange   = getCompRange(period, monthOffset);
  const compLabel   = getCompLabel(period);
  const periodTitle = getPeriodTitle(period, monthOffset, customFrom, customTo);

  const periodTx = transactions.filter((t) => inRange(t.date, range));
  const compTx   = transactions.filter((t) => inRange(t.date, compRange));
  const noDateTx = transactions.filter((t) => !t.date);

  const stats     = calcStats(periodTx);
  const compStats = compRange.from ? calcStats(compTx) : null;

  // ── Needs attention (from ALL transactions, not just period) ──────────────
  // "צפוי" alone is NOT a problem (no overdue logic here) — only explicitly
  // unpaid/partial rows need attention, per the canonical meaning of the data.
  const attentionUnpaidIncome  = transactions.filter((t) => t.type === "income"  && ["לא שולם", "חלקי"].includes(t.payment_status));
  const attentionOpenExpenses  = transactions.filter((t) => t.type === "expense" && ["לא שולם", "חלקי"].includes(t.payment_status));
  const hasAttention = noDateTx.length > 0 || attentionUnpaidIncome.length > 0 || attentionOpenExpenses.length > 0;

  // ── Table filtered rows ────────────────────────────────────────────────────
  // Rows that "need attention": unpaid/partial on either side (same meaning as
  // the דורש טיפול band — no overdue-by-date inference).
  const needsAttention = (t: Transaction) =>
    (t.type === "income"  && ["לא שולם", "חלקי"].includes(t.payment_status)) ||
    (t.type === "expense" && ["לא שולם", "חלקי"].includes(t.payment_status));

  function matchesFilters(t: Transaction) {
    if (viewTab === "income"    && t.type !== "income")  return false;
    if (viewTab === "expense"   && t.type !== "expense") return false;
    if (viewTab === "shows"     && !isShowTx(t))         return false;
    if (viewTab === "unpaid"    && t.payment_status !== "לא שולם") return false;
    if (viewTab === "attention" && !needsAttention(t))   return false;
    if (statusFilter           && (t.payment_status === "התקבל" ? "שולם" : t.payment_status) !== statusFilter) return false;
    if (projectFilter          && t.project_id !== projectFilter) return false;
    if (sourceFilter !== "all" && (t.scope ?? "project") !== sourceFilter) return false;
    if (categoryFilter         && (t.category || "") !== categoryFilter) return false;
    if (contactFilter          && (t.artist   || "") !== contactFilter)  return false;
    if (searchQuery.trim()) {
      const q   = searchQuery.trim().toLowerCase();
      const hay = `${getTransactionLabel(t)} ${t.artist} ${t.category} ${t.description} ${userVisibleNotes(t.notes)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function sortTx(list: Transaction[]): Transaction[] {
    const copy = [...list];
    switch (sortMode) {
      case "date-desc":
        return copy.sort((a, b) => {
          if (!a.date && !b.date) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          if (!a.date) return 1; if (!b.date) return -1;
          const d = b.date.localeCompare(a.date);
          return d !== 0 ? d : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
      case "date-asc":
        return copy.sort((a, b) => {
          if (!a.date && !b.date) return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          if (!a.date) return 1; if (!b.date) return -1;
          const d = a.date.localeCompare(b.date);
          return d !== 0 ? d : new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
      case "amount-desc":  return copy.sort((a, b) => b.amount - a.amount);
      case "project":      return copy.sort((a, b) => {
        const pA = projects.find((p) => p.id === a.project_id)?.name ?? (a.scope === "general" ? "כללי" : "");
        const pB = projects.find((p) => p.id === b.project_id)?.name ?? (b.scope === "general" ? "כללי" : "");
        return pA.localeCompare(pB, "he");
      });
      case "status":       return copy.sort((a, b) => a.payment_status.localeCompare(b.payment_status, "he"));
      case "type":         return copy.sort((a, b) => a.type.localeCompare(b.type));
      default:             return copy;
    }
  }

  type DisplayItem =
    | { kind: "header"; label: string; key: string }
    | { kind: "row";    tx: Transaction; rowIndex: number };

  function buildDisplayItems(sorted: Transaction[], undated: Transaction[]): DisplayItem[] {
    if (!groupByMonth) {
      const items: DisplayItem[] = sorted.map((tx, i) => ({ kind: "row" as const, tx, rowIndex: i }));
      if (showUndated) undated.forEach((tx, i) => items.push({ kind: "row", tx, rowIndex: sorted.length + i }));
      return items;
    }
    const groups: { key: string; label: string; txs: Transaction[] }[] = [];
    const seen = new Map<string, number>();
    sorted.forEach((tx) => {
      if (!tx.date) return;
      const key = tx.date.substring(0, 7);
      const [y, m] = key.split("-");
      const label  = `${HEB_MONTHS[parseInt(m) - 1]} ${y}`;
      if (!seen.has(key)) { seen.set(key, groups.length); groups.push({ key, label, txs: [] }); }
      groups[seen.get(key)!].txs.push(tx);
    });
    const items: DisplayItem[] = [];
    let ri = 0;
    groups.forEach((g) => {
      items.push({ kind: "header", label: g.label, key: g.key });
      g.txs.forEach((tx) => items.push({ kind: "row", tx, rowIndex: ri++ }));
    });
    if (showUndated && undated.length > 0) {
      items.push({ kind: "header", label: "ללא תאריך", key: "undated" });
      undated.forEach((tx) => items.push({ kind: "row", tx, rowIndex: ri++ }));
    }
    return items;
  }

  const datedFiltered   = sortTx(periodTx.filter(matchesFilters));
  const undatedFiltered = noDateTx.filter(matchesFilters);
  const filtered        = showUndated ? [...datedFiltered, ...undatedFiltered] : datedFiltered;
  const displayItems    = buildDisplayItems(datedFiltered, undatedFiltered);

  const projectsWithTx = projects.filter((p) => transactions.some((t) => t.project_id === p.id));
  const allStatuses    = [...new Set(transactions.map((t) => t.payment_status === "התקבל" ? "שולם" : t.payment_status))];
  // Filter option lists derived from loaded data only (no invented values).
  const allCategories  = [...new Set(transactions.map((t) => (t.category || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
  const allContacts    = [...new Set(transactions.map((t) => (t.artist   || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));

  // ── CRUD ──────────────────────────────────────────────────────────────────
  function openAdd() {
    setEditingId(null);
    setDraft(emptyDraft());
    setModalOpen(true);
  }

  function openEdit(tx: Transaction) {
    setEditingId(tx.id);
    setDraft({
      scope: tx.scope ?? "project",
      projectId: tx.project_id ?? "", type: tx.type, date: tx.date ?? "",
      description: tx.description, artist: tx.artist, amount: String(tx.amount),
      // Normalize legacy "התקבל" to "שולם" so the form shows/saves the unified status.
      currency: tx.currency, paymentStatus: tx.payment_status === "התקבל" ? "שולם" : tx.payment_status, paymentMethod: tx.payment_method,
      // Show only the real note; the technical show_id marker is re-attached on save.
      receiptRef: tx.receipt_ref, notes: userVisibleNotes(tx.notes), category: tx.category,
    });
    setModalOpen(true);
  }

  // Status picked from the row badge: open the edit modal pre-set to that
  // status — NO immediate PATCH. The PATCH happens only on "שמור", together
  // with any extra detail/note the user adds first.
  function openEditWithStatus(tx: Transaction, status: PaymentStatus) {
    setStatusMenu(null);
    openEdit(tx);
    setDraft((prev) => ({ ...prev, paymentStatus: status }));
  }

  // Delete from inside the edit modal — confirmation is an in-modal UI (no
  // window.confirm); this just performs the existing delete.
  async function handleDeleteFromModal() {
    if (!editingId) return;
    const id = editingId;
    setModalOpen(false);
    setEditingId(null);
    await handleDelete(id);
  }

  async function handleSave() {
    if (!draft.amount) return;
    if (draft.scope === "project" && !draft.projectId) return;
    setSaving(true);
    try {
      // Preserve the technical show_id marker that openEdit stripped for display.
      const orig = editingId ? transactions.find((t) => t.id === editingId) : undefined;
      const mergedNotes = mergeNotes(notesMarker(orig?.notes), draft.notes);
      const body = {
        scope: draft.scope,
        projectId: draft.scope === "general" ? null : draft.projectId,
        type: draft.type, date: draft.date || null,
        description: draft.description, artist: draft.artist,
        amount: Number(draft.amount) || 0, currency: draft.currency,
        paymentStatus: draft.paymentStatus, paymentMethod: draft.paymentMethod,
        receiptRef: draft.receiptRef, notes: mergedNotes, category: draft.category,
      };
      if (editingId) {
        const res  = await fetch(`/api/transactions/${editingId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, project_id: body.projectId }),
        });
        const data = await res.json();
        if (data.transaction) setTransactions((prev) => prev.map((t) => t.id === editingId ? data.transaction : t));
      } else {
        const res  = await fetch("/api/transactions", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.transaction) setTransactions((prev) => [data.transaction, ...prev]);
      }
      setModalOpen(false);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const expensesPaid   = stats.projExpPaid + stats.genExpPaid;
  const unpaidCount    = periodTx.filter((t) => t.payment_status === "לא שולם").length;
  const attentionCount = periodTx.filter(needsAttention).length;

  // ── Source grouping (הופעות / פרויקטים / כללי) ─────────────────────────────
  const GRID_COLS = "72px 1.9fr 1.6fr 1.3fr 120px 100px 28px";
  // Flat "all transactions" table columns: תאריך · סוג · שם · קטגוריה · פרויקט · איש קשר · סכום · סטטוס · ⋮
  const FLAT_COLS = "106px 76px 1.7fr 1.1fr 1.25fr 1.15fr 136px 100px 30px";
  const isProjectTx = (t: Transaction) => !isShowTx(t) && (!!t.project_id || (t.scope ?? "project") === "project");
  const showsTxs    = filtered.filter(isShowTx);
  const projectTxs  = filtered.filter(isProjectTx);
  const generalTxs  = filtered.filter((t) => !isShowTx(t) && !isProjectTx(t));

  function groupSummary(txs: Transaction[]) {
    const inc = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const exp = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { inc, exp, net: inc - exp };
  }
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Single transaction row — extracted so it can render inside any group or the
  // flat month-grouped table. Behaviour (quick status, expand, edit) unchanged.
  function renderTxRow(tx: Transaction, i: number, affiliation?: { label: string; icon: string; col: string }) {
    const proj     = projects.find((p) => p.id === tx.project_id);
    const isIncome = tx.type === "income";
    const undated  = !tx.date;
    const baseBg   = undated ? "#1D1810" : i % 2 === 0 ? CARD : "rgba(255,255,255,0.025)";
    // שיוך — business source. Project rows MUST show the project name; show rows
    // get their name via the override; everything else is "כללי".
    const aff = affiliation ?? (
      isShowTx(tx)      ? { label: "הופעה", icon: "🎤", col: BRAND }
      : isProjectTx(tx) ? { label: proj?.name || "פרויקט", icon: "📁", col: BLUE }
      : { label: "כללי", icon: "🏢", col: PURPLE }
    );
    return (
      <div key={tx.id}>
        {/* Row — click anywhere opens the edit modal */}
        <div
          onClick={() => openEdit(tx)}
          style={{
            display: "grid", gridTemplateColumns: GRID_COLS,
            gap: 12, padding: "13px 16px", alignItems: "center",
            borderBottom: `1px solid rgba(255,255,255,0.06)`,
            background: baseBg,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = baseBg; }}
        >
          {/* סוג: income/expense ONLY */}
          <div>
            <span style={{
              fontSize: 10, fontWeight: 800, borderRadius: 6, padding: "3px 8px",
              background: isIncome ? `${GREEN}16` : `${RED}14`,
              color: isIncome ? GREEN : RED,
              border: `1px solid ${isIncome ? `${GREEN}30` : `${RED}2E`}`,
              display: "inline-block", whiteSpace: "nowrap",
            }}>
              {isIncome ? "הכנסה" : "הוצאה"}
            </span>
          </div>
          {/* תנועה — description / title, with date subline */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: TEXT, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {getTransactionLabel(tx)}
            </div>
            <div style={{ fontSize: 10.5, color: undated ? AMBER : MUTED, marginTop: 2 }}>
              {undated ? "ללא תאריך" : fmtDate(tx.date)}
            </div>
          </div>
          {/* שיוך — business source (project name / show / כללי) */}
          <div style={{ minWidth: 0 }}>
            <span title={aff.label} style={{
              display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%",
              fontSize: 11.5, fontWeight: 700, color: aff.col,
              background: `${aff.col}12`, border: `1px solid ${aff.col}2A`,
              borderRadius: 6, padding: "3px 9px",
            }}>
              <span style={{ flexShrink: 0 }}>{aff.icon}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{aff.label}</span>
            </span>
          </div>
          {/* אמן / ספק */}
          <div style={{ fontSize: 12.5, color: TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {tx.artist || proj?.artist || "—"}
          </div>
          {/* סכום — green in / red out */}
          <div style={{ fontSize: 15.5, fontWeight: 800, color: isIncome ? GREEN : RED, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
            {isIncome ? "+" : "−"}{fmtAmount(tx.amount, tx.currency)}
          </div>
          <div>
            <button type="button" title="שינוי סטטוס מהיר"
              onClick={(e) => {
                e.stopPropagation();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setStatusMenu(statusMenu?.id === tx.id ? null : { id: tx.id, x: r.left, y: r.bottom });
              }}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
              <StatusBadge status={tx.payment_status} />
            </button>
          </div>
          <button type="button" title="עריכת תנועה"
            onClick={(e) => { e.stopPropagation(); openEdit(tx); }}
            style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 13, fontFamily: "inherit", padding: 0 }}>
            ✏
          </button>
        </div>
      </div>
    );
  }

  // Shared per-group column header.
  function groupColHeader() {
    return (
      <div style={{
        display: "grid", gridTemplateColumns: GRID_COLS,
        gap: 12, padding: "9px 16px",
        background: CARD2, borderBottom: `1px solid ${BDR}`,
        fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.06em",
      }}>
        <div>סוג</div><div>תנועה</div><div>שיוך</div>
        <div>אמן / ספק</div><div>סכום</div><div>סטטוס</div><div />
      </div>
    );
  }

  // Collapsible source-group card with a mini income/expense/net summary.
  function renderGroup(key: string, title: string, icon: string, accent: string, txs: Transaction[], body: React.ReactNode) {
    if (txs.length === 0) return null;
    const collapsed = collapsedGroups.has(key);
    const { inc, exp, net } = groupSummary(txs);
    const pill = (label: string, val: number, col: string) => (
      <span style={{
        display: "inline-flex", alignItems: "baseline", gap: 5,
        background: `${col}12`, border: `1px solid ${col}28`, borderRadius: 100,
        padding: "4px 11px", fontSize: 11.5,
      }}>
        <span style={{ color: MUTED }}>{label}</span>
        <strong style={{ color: col, fontWeight: 800 }}>{fmtAmount(val)}</strong>
      </span>
    );
    return (
      <div key={key} style={{
        background: CARD, border: `1px solid ${accent}33`, borderRadius: 16,
        overflow: "hidden", marginBottom: 16,
      }}>
        <button onClick={() => toggleGroup(key)} style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "14px 18px", background: `${accent}12`, border: "none",
          borderBottom: collapsed ? "none" : `1px solid ${BDR}`, cursor: "pointer", fontFamily: "inherit",
        }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>{title}</span>
          <span style={{
            fontSize: 12, fontWeight: 800, color: accent, background: `${accent}1A`,
            borderRadius: 8, minWidth: 24, padding: "2px 8px", textAlign: "center",
          }}>{txs.length}</span>
          <span style={{ fontSize: 18, marginInlineEnd: 2 }}>{icon}</span>
          <span style={{ display: "flex", gap: 8, marginInlineStart: "auto", flexWrap: "wrap" }}>
            {pill("סך הכנסות", inc, GREEN)}
            {pill("סך הוצאות", exp, AMBER)}
            {pill("נטו", net, net >= 0 ? GREEN : RED)}
          </span>
          <span style={{ color: accent, fontSize: 14, transform: collapsed ? "rotate(180deg)" : "rotate(0deg)" }}>⌄</span>
        </button>
        {!collapsed && (
          <div>
            {groupColHeader()}
            {body}
          </div>
        )}
      </div>
    );
  }

  // הופעות group body: sub-group by the internal show_id marker (never shown)
  // ONLY to derive each show's name for the "שיוך" column, then render plain
  // rows like every other group. No inner show card. Marker-less rows show
  // "הופעה".
  function renderShowsBody(txs: Transaction[]): React.ReactNode {
    const byShow = new Map<string, Transaction[]>();
    txs.forEach((t) => {
      const k = notesMarker(t.notes) || "_none";
      if (!byShow.has(k)) byShow.set(k, []);
      byShow.get(k)!.push(t);
    });
    let ri = 0;
    const blocks: React.ReactNode[] = [];
    byShow.forEach((group, k) => {
      let groupAff: { label: string; icon: string; col: string } | undefined;
      if (k !== "_none") {
        const incomeTx = group.find((t) => t.type === "income");
        // Prefer the show name from the income description; otherwise the show
        // name in the last "(...)" of an expense description; else "הופעה".
        const title = incomeTx
          ? incomeTx.description.replace(/^הכנסה מהופעה\s*[—–-]\s*/, "")
          : (group[0]?.description.match(/\(([^)]+)\)\s*$/)?.[1] ?? "הופעה");
        groupAff = { label: title || "הופעה", icon: "🎤", col: BRAND };
      }
      group.forEach((tx) => blocks.push(renderTxRow(tx, ri++, groupAff)));
    });
    return blocks;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const navBtnStyle: React.CSSProperties = {
    background: CARD, border: `1px solid ${BDR2}`, borderRadius: 10,
    color: TEXT2, fontSize: 18, width: 36, height: 36,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", fontFamily: "inherit", outline: "none",
  };

  // ── Small render helpers for the redesigned sections ────────────────────────
  const attnCard = (col: string): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 14, padding: "16px 18px",
    borderRadius: 14, background: `${col}12`, border: `1px solid ${col}33`,
    cursor: "pointer", fontFamily: "inherit", textAlign: "right", width: "100%",
    minHeight: 66,
  });

  // תזרים החודש: one flow cell + a connector arrow.
  const flowArrow = () => (
    <div style={{ display: "flex", alignItems: "center", color: TEXT2, fontSize: 22, flexShrink: 0, alignSelf: "stretch", opacity: 0.55 }}>⇄</div>
  );
  const flowCell = (label: string, val: number, col: string, glyph: string) => (
    <div style={{ flex: "1 1 170px", minWidth: 150, background: `linear-gradient(158deg, ${col}12, ${CARD2} 60%)`, border: `1px solid ${col}2E`, borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: TEXT2 }}>{label}</span>
        <span style={{ width: 32, height: 32, borderRadius: 9, background: `${col}22`, color: col, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800 }}>{glyph}</span>
      </div>
      <div style={{ fontSize: 29, fontWeight: 900, color: col, letterSpacing: "-0.035em", marginTop: 11, textShadow: `0 0 22px ${col}2E` }}>{fmtAmount(val)}</div>
    </div>
  );

  const goalStat = (label: string, val: string, col: string) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: col, marginTop: 4 }}>{val}</div>
    </div>
  );

  const sumRow = (label: string, val: number, col: string, bold = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: bold ? 14 : 13, color: bold ? TEXT : TEXT2, fontWeight: bold ? 800 : 500 }}>{label}</span>
      <span style={{ fontSize: bold ? 18 : 15.5, fontWeight: bold ? 900 : 800, color: col }}>{fmtAmount(val)}</span>
    </div>
  );

  // Privacy / "מצב לקוח": never render any financial content — show a clean
  // placeholder instead (same route, no redirect). Toggling off re-renders the
  // real page immediately. Fixed min-height keeps the layout from jumping.
  if (privacyHidden) {
    return (
      <div dir="rtl" style={{ padding: "20px 40px", maxWidth: 1780, margin: "0 auto" }}>
        <div style={{ minHeight: "72vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", maxWidth: 440, padding: "40px 34px", borderRadius: 18, background: CARD, border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 42, marginBottom: 14, color: "#EAB308" }}>👁</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, marginBottom: 8 }}>מצב לקוח פעיל — תוכן הכספים מוסתר</div>
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 24, lineHeight: 1.7 }}>הסכומים, הטבלאות וה-KPI הכספיים מוסתרים. כבה את מצב הלקוח כדי לראות אותם שוב.</div>
            <button
              onClick={togglePrivacy}
              style={{ fontSize: 13, fontWeight: 800, color: "#15151A", padding: "9px 20px", borderRadius: 10, background: "#EAB308", border: "none", cursor: "pointer", fontFamily: "inherit" }}
            >כבה מצב לקוח</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" style={{ padding: "20px 40px", maxWidth: 1780, margin: "0 auto" }}>

      {modalOpen && (
        <TxModal draft={draft} setDraft={setDraft} saving={saving}
          onSave={handleSave}
          onCancel={() => { setModalOpen(false); setEditingId(null); }}
          projects={projects}
          isEdit={!!editingId}
          onDelete={editingId ? handleDeleteFromModal : undefined}
          title={editingId ? (draft.type === "income" ? "עריכת הכנסה" : "עריכת הוצאה") : "תנועה חדשה"} />
      )}

      {/* Quick inline status popover (anchored under the row badge) */}
      {statusMenu && typeof document !== "undefined" && createPortal((() => {
        const tx = transactions.find((t) => t.id === statusMenu.id);
        if (!tx) return null;
        const opts = tx.type === "income" ? QUICK_INCOME_STATUSES : QUICK_EXPENSE_STATUSES;
        return (
          <>
            <div onClick={() => setStatusMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 99998 }} />
            <div onClick={(e) => e.stopPropagation()} style={{
              position: "fixed", top: statusMenu.y + 4, left: statusMenu.x, zIndex: 99999,
              background: CARD2, border: `1px solid ${BDR2}`, borderRadius: 10,
              boxShadow: "0 12px 40px rgba(0,0,0,0.7)", padding: 4, minWidth: 130,
              display: "flex", flexDirection: "column", gap: 2, direction: "rtl",
            }}>
              {opts.map((s) => {
                const c = STATUS_COLOR[s] ?? MUTED;
                // Legacy "התקבל" rows highlight the "שולם" option.
                const active = s === tx.payment_status || (s === "שולם" && tx.payment_status === "התקבל");
                return (
                  <button key={s} type="button" onClick={() => openEditWithStatus(tx, s)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                      borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit",
                      fontSize: 12, fontWeight: 600, textAlign: "right",
                      background: active ? `${c}1F` : "transparent", color: c, whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = `${c}1F`; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = active ? `${c}1F` : "transparent"; }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: c }} />
                    {s}
                    {active && <span style={{ marginInlineStart: "auto", fontSize: 10 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </>
        );
      })(), document.body)}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        {/* Right: title */}
        <h1 style={{ fontSize: 34, fontWeight: 900, color: TEXT, margin: 0, letterSpacing: "-0.035em" }}>כספים</h1>

        {/* Center: month navigator */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => { setPeriod("month"); setMonthOffset((o) => o - 1); }} style={navBtnStyle}>‹</button>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, minWidth: 150, textAlign: "center" }}>
            📅 {periodTitle}
          </div>
          <button onClick={() => { setPeriod("month"); setMonthOffset((o) => o + 1); }} style={navBtnStyle}>›</button>
        </div>

        {/* Left: add button */}
        <button onClick={openAdd} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "12px 26px", borderRadius: 12,
          background: BRAND, border: "none", color: "#fff",
          fontSize: 15, fontWeight: 800, cursor: "pointer",
          boxShadow: "0 4px 20px rgba(220,38,38,0.5)",
          fontFamily: "inherit",
        }}>+ הוסף תנועה</button>
      </div>

      {/* ── Period selector ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PERIOD_OPTIONS.map(({ label, period: optPeriod, offset }) => {
            const active = optPeriod === "month"
              ? period === "month" && monthOffset === offset
              : period === optPeriod;
            const onSelect = optPeriod === "month"
              ? () => { setPeriod("month"); setMonthOffset(offset ?? 0); }
              : () => setPeriod(optPeriod);
            return (
              <button key={label} onClick={onSelect} style={{
                padding: "7px 16px", borderRadius: 10, border: "none", cursor: "pointer",
                background: active ? `${BRAND}15` : CARD,
                color: active ? BRAND : MUTED,
                fontSize: 12, fontWeight: active ? 700 : 400, fontFamily: "inherit",
                outline: active ? `1px solid ${BRAND}35` : `1px solid ${BDR}`,
                transition: "none",
              }}>
                {label}
              </button>
            );
          })}
        </div>

        {period === "custom" && (
          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 11, color: MUTED }}>מ</label>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                style={{ ...INPUT_S, width: 150, colorScheme: "dark", fontSize: 12 }} />
            </div>
            <span style={{ color: MUTED, fontSize: 14 }}>—</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 11, color: MUTED }}>עד</label>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                style={{ ...INPUT_S, width: 150, colorScheme: "dark", fontSize: 12 }} />
            </div>
          </div>
        )}
      </div>

      {/* ── KPI cards (4 in a row) ───────────────────────────────────────── */}
      {/* RTL, right→left: התקבל בפועל → הוצאות בפועל → נטו בפועל → הכנסות צפויות */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 18 }}>
        <SummaryCard icon="✅" label="התקבל בפועל"
          value={fmtAmount(stats.incomeReceived)} color={GREEN}
          sub={`${periodTx.filter((t) => t.type === "income" && ["שולם", "התקבל"].includes(t.payment_status)).length} תשלומים שהתקבלו`}
        />
        <SummaryCard icon="📉" label="הוצאות בפועל"
          value={fmtAmount(expensesPaid)} color={expensesPaid > 0 ? RED : MUTED}
          sub="שולם בפועל"
        />
        <SummaryCard icon="📈" label="נטו בפועל"
          value={fmtAmount(stats.profitReal)} color={stats.profitReal >= 0 ? GREEN : RED}
          sub="התקבל בפועל − שולם בפועל"
        />
        <SummaryCard icon="⏳" label="הכנסות צפויות"
          value={fmtAmount(stats.incomeExpected)} color={stats.incomeExpected > 0 ? AMBER : MUTED}
          sub="הכנסות שטרם התקבלו"
        />
      </div>

      {/* ── דורש טיפול היום (prominent band) ─────────────────────────────── */}
      {hasAttention && (
        <div style={{
          marginBottom: 18, borderRadius: 18, padding: "18px 20px",
          background: `linear-gradient(160deg, ${AMBER}10, ${CARD} 62%)`,
          border: `1px solid ${AMBER}33`,
          boxShadow: "0 8px 26px rgba(0,0,0,0.3)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>דורש טיפול היום</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: RED, borderRadius: 100, minWidth: 20, padding: "2px 8px", textAlign: "center" }}>
              {noDateTx.length + attentionUnpaidIncome.length + attentionOpenExpenses.length}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {attentionUnpaidIncome.length > 0 && (
              <button onClick={() => { setViewTab("income"); setStatusFilter("לא שולם"); }} style={attnCard(RED)}>
                <span style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0, background: `${RED}20`, border: `1px solid ${RED}38`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>⚡</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>
                    <strong style={{ color: RED }}>{attentionUnpaidIncome.length}</strong> הכנסות לא שולמו
                  </div>
                  <div style={{ fontSize: 12.5, color: TEXT2, marginTop: 3 }}>דורש גבייה · {fmtAmount(attentionUnpaidIncome.reduce((s, t) => s + t.amount, 0))}</div>
                </div>
              </button>
            )}
            {attentionOpenExpenses.length > 0 && (
              <button onClick={() => { setViewTab("expense"); setStatusFilter(""); }} style={attnCard(AMBER)}>
                <span style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0, background: `${AMBER}20`, border: `1px solid ${AMBER}38`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📋</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>
                    <strong style={{ color: AMBER }}>{attentionOpenExpenses.length}</strong> הוצאות פתוחות
                  </div>
                  <div style={{ fontSize: 12.5, color: TEXT2, marginTop: 3 }}>ממתינות לתשלום · {fmtAmount(attentionOpenExpenses.reduce((s, t) => s + t.amount, 0))}</div>
                </div>
              </button>
            )}
            {noDateTx.length > 0 && (
              <button onClick={() => setShowUndated((v) => !v)} style={attnCard(BLUE)}>
                <span style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0, background: `${BLUE}20`, border: `1px solid ${BLUE}38`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>⚠</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>
                    <strong style={{ color: BLUE }}>{noDateTx.length}</strong> תנועות ללא תאריך
                  </div>
                  <div style={{ fontSize: 12.5, color: TEXT2, marginTop: 3 }}>{showUndated ? "מוצגות בטבלה — לחץ להסתרה" : "לחץ להצגה בטבלה"}</div>
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── יעד נטו חודשי (horizontal progress) ──────────────────────────── */}
      {(() => {
        const goal    = NET_MONTHLY_GOAL;
        const real    = stats.profitReal;   // canonical net (received − paid)
        const est     = stats.profitEst;     // canonical net forecast (received + expected − paid − expected-expenses)
        const realPct = Math.max(0, Math.round((real / goal) * 100));
        const estPct  = Math.max(0, Math.round((est  / goal) * 100));
        const realW   = Math.max(0, Math.min(100, (real / goal) * 100));
        const estW    = Math.max(0, Math.min(100, (est  / goal) * 100));
        return (
      <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "20px 22px 22px", marginBottom: 20, boxShadow: "0 8px 26px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 18 }}>יעד נטו חודשי</div>
        <div style={{ display: "flex", gap: 30, alignItems: "center", flexWrap: "wrap" }}>
          {/* Right (RTL-first): headline percentage */}
          <div style={{ flex: "0 0 180px", minWidth: 150, textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, letterSpacing: "0.05em" }}>עמידה ביעד</div>
            <div style={{ fontSize: 50, fontWeight: 900, color: real >= 0 ? GREEN : RED, lineHeight: 1.05, letterSpacing: "-0.03em", textShadow: `0 0 30px ${(real >= 0 ? GREEN : RED)}38` }}>{realPct}%</div>
            {est > real && (
              <div style={{ fontSize: 12, color: AMBER, marginTop: 6 }}>אם כל הצפוי ייכנס: {estPct}%</div>
            )}
          </div>
          {/* Left: stat labels + long bar + baseline */}
          <div style={{ flex: "1 1 440px", minWidth: 300 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              {goalStat("נטו בפועל", fmtAmount(real), real >= 0 ? GREEN : RED)}
              {goalStat("נטו צפוי", fmtAmount(est), est >= 0 ? AMBER : RED)}
              {goalStat("יעד", fmtAmount(goal), TEXT)}
            </div>
            <div style={{ position: "relative", height: 22, borderRadius: 100, background: BDR2, overflow: "hidden" }}>
              {/* forecast (dashed outline, behind) */}
              <div style={{ position: "absolute", insetInlineStart: 0, top: 0, height: "100%", width: `${estW}%`, background: `${AMBER}1E`, border: `1px dashed ${AMBER}88`, borderRadius: 100, boxSizing: "border-box" }} />
              {/* real (solid, front) */}
              <div style={{ position: "absolute", insetInlineStart: 0, top: 0, height: "100%", width: `${realW}%`, background: real >= 0 ? GREEN : RED, borderRadius: 100, boxShadow: `0 0 18px ${(real >= 0 ? GREEN : RED)}55` }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
              <span style={{ fontSize: 12, color: MUTED }}>0</span>
              <span style={{ fontSize: 12.5, color: real >= 0 ? GREEN : RED, fontWeight: 800 }}>{fmtAmount(real)}</span>
              <span style={{ fontSize: 12, color: TEXT2, fontWeight: 700 }}>{fmtAmount(goal)}</span>
            </div>
            {/* Secondary: expected expenses (offset in the forecast) + clarifier */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BDR}` }}>
              <span style={{
                fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 6,
                background: `${RED}12`, border: `1px solid ${RED}2A`, borderRadius: 100, padding: "4px 11px",
              }}>
                <span style={{ color: MUTED }}>הוצאות צפויות</span>
                <strong style={{ color: RED }}>{fmtAmount(stats.expensesExpected)}</strong>
              </span>
              <span style={{ fontSize: 11, color: MUTED }}>נטו צפוי כולל הכנסות והוצאות צפויות</span>
            </div>
          </div>
        </div>
      </div>
        );
      })()}

      {/* ── Filter strip (full width) ────────────────────────────────────── */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14,
        alignItems: "center", padding: "12px 16px",
        background: CARD, border: `1px solid ${BDR}`, borderRadius: 14,
      }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 170 }}>
          <span style={{ position: "absolute", insetInlineStart: 13, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 13, pointerEvents: "none" }}>🔍</span>
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="חיפוש..."
            style={{ ...INPUT_S, padding: "9px 36px 9px 14px", fontSize: 13, border: `1px solid ${BDR}` }} />
        </div>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{
          ...selectStyle, color: statusFilter ? BRAND : TEXT2, borderColor: statusFilter ? `${BRAND}40` : BDR,
        }}>
          <option value="">כל הסטטוסים</option>
          {allStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{
          ...selectStyle, color: categoryFilter ? BRAND : TEXT2, borderColor: categoryFilter ? `${BRAND}40` : BDR,
        }}>
          <option value="">כל הקטגוריות</option>
          {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select value={contactFilter} onChange={(e) => setContactFilter(e.target.value)} style={{
          ...selectStyle, color: contactFilter ? BRAND : TEXT2, borderColor: contactFilter ? `${BRAND}40` : BDR,
        }}>
          <option value="">כל אנשי הקשר</option>
          {allContacts.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={selectStyle}>
          <option value="">כל הפרויקטים</option>
          {projectsWithTx.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as SourceFilter)} style={selectStyle}>
          <option value="all">כל המקורות</option>
          <option value="project">📁 פרויקטים</option>
          <option value="general">🏢 כללי</option>
        </select>

        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} style={selectStyle}>
          <option value="date-desc">מהחדש לישן</option>
          <option value="date-asc">מהישן לחדש</option>
          <option value="amount-desc">לפי סכום</option>
          <option value="project">לפי פרויקט</option>
          <option value="status">לפי סטטוס</option>
          <option value="type">לפי סוג</option>
        </select>

        <button onClick={() => setGroupBySource((v) => !v)} style={{
          ...selectStyle, background: groupBySource ? `${BLUE}15` : CARD,
          color: groupBySource ? BLUE : TEXT2, borderColor: groupBySource ? `${BLUE}40` : BDR,
        }}>קיבוץ מקור</button>

        <button onClick={() => setGroupByMonth((v) => !v)} style={{
          ...selectStyle, background: groupByMonth ? `${PURPLE}15` : CARD,
          color: groupByMonth ? PURPLE : TEXT2, borderColor: groupByMonth ? `${PURPLE}40` : BDR,
        }}>קיבוץ חודשי</button>

        <span style={{ fontSize: 11, color: MUTED, marginInlineStart: "auto" }}>{filtered.length} תנועות</span>
      </div>

      {/* ── Main: transactions table (left) + quick summary (right) ──────── */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>

        {/* Quick summary — real (existing) figures only */}
        <div style={{ flex: "0 0 280px", minWidth: 240 }}>
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "20px 20px", boxShadow: "0 8px 26px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 16 }}>סיכום מהיר</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {sumRow("הכנסות שהתקבלו", stats.incomeReceived, GREEN)}
              {sumRow("הוצאות ששולמו", expensesPaid, RED)}
              {sumRow("הכנסות צפויות", stats.incomeExpected, AMBER)}
              <div style={{ borderTop: `1px solid ${BDR}`, marginTop: 2, paddingTop: 14 }}>
                {sumRow("נטו בפועל", stats.profitReal, stats.profitReal >= 0 ? GREEN : RED, true)}
              </div>
            </div>
            <button
              onClick={() => { setViewTab("all"); setStatusFilter(""); setCategoryFilter(""); setContactFilter(""); setProjectFilter(""); setSourceFilter("all"); setSearchQuery(""); }}
              style={{
                marginTop: 18, width: "100%", padding: "10px", borderRadius: 10,
                border: `1px solid ${BDR2}`, background: "transparent", color: TEXT2,
                fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              }}
            >⤢ לכל הנתונים</button>
            <div style={{ fontSize: 10.5, color: MUTED, marginTop: 12, lineHeight: 1.6, textAlign: "center" }}>
              מבוסס על התנועות בטווח {periodTitle}.
            </div>
          </div>
        </div>

        {/* Table column */}
        <div style={{ flex: "1 1 560px", minWidth: 0 }}>

          {/* ── Table title + underline tabs ──────────────────────────── */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, marginBottom: 10, paddingInline: 4 }}>כל התנועות</div>
            <div style={{ display: "flex", gap: 2, flexWrap: "wrap", borderBottom: `1px solid ${BDR}`, paddingInline: 2 }}>
              {([["all","הכל"],["income","הכנסות"],["expense","הוצאות"],["unpaid","לא שולם"],["shows","הופעות"],["attention","דורש טיפול"]] as const).map(([k, label]) => {
                const active = viewTab === k;
                const badge  = k === "unpaid" ? unpaidCount : k === "attention" ? attentionCount : 0;
                return (
                  <button key={k} onClick={() => setViewTab(k)} style={{
                    padding: "10px 14px", border: "none", background: "transparent", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit",
                    fontSize: 14, fontWeight: active ? 800 : 600, whiteSpace: "nowrap",
                    color: active ? TEXT : TEXT2,
                    borderBottom: active ? `2px solid ${BRAND}` : "2px solid transparent",
                    marginBottom: -1,
                  }}>
                    {label}
                    {badge > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, color: "#fff", background: k === "attention" ? AMBER : RED,
                        borderRadius: 100, padding: "1px 6px", minWidth: 16, textAlign: "center",
                      }}>{badge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Transactions table ────────────────────────────────────── */}
          {!loaded ? (
            <div style={{ color: MUTED, fontSize: 13, padding: "48px", textAlign: "center" }}>טוען...</div>
          ) : filtered.length === 0 ? (
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "60px", textAlign: "center", color: MUTED, fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              {transactions.length === 0 ? "אין תנועות כספיות עדיין" : `אין תנועות — ${periodTitle}`}
              <div style={{ marginTop: 14 }}>
                <button onClick={openAdd} style={{ padding: "8px 18px", borderRadius: 10, border: `1px solid ${BRAND}35`, background: `${BRAND}10`, color: BRAND, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  + הוסף תנועה
                </button>
              </div>
            </div>
          ) : groupBySource ? (
            /* Optional source-grouped card view (opt-in) */
            <>
              {renderGroup("g-shows", "הופעות", "🎤", BRAND, showsTxs, renderShowsBody(showsTxs))}
              {renderGroup("g-projects", "פרויקטים", "📁", BLUE, projectTxs, projectTxs.map((tx, i) => renderTxRow(tx, i)))}
              {renderGroup("g-general", "כללי", "🏢", PURPLE, generalTxs, generalTxs.map((tx, i) => renderTxRow(tx, i)))}
              <div style={{ display: "flex", gap: 24, padding: "12px 16px", borderRadius: 12, background: CARD2, fontSize: 11, color: MUTED, border: `1px solid ${BDR}` }}>
                <span>הכנסות: <strong style={{ color: GREEN }}>{fmtAmount(filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0))}</strong></span>
                <span>הוצאות: <strong style={{ color: RED }}>{fmtAmount(filtered.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0))}</strong></span>
                <span style={{ marginInlineStart: "auto" }}>{filtered.length} תנועות מסוננות</span>
              </div>
            </>
          ) : (
            /* Default: flat "כל התנועות" table (month headers when קיבוץ חודשי is on) */
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 8px 26px rgba(0,0,0,0.3)" }}>
              {/* Table header */}
              <div style={{
                display: "grid", gridTemplateColumns: FLAT_COLS,
                gap: 10, padding: "13px 18px",
                background: CARD2, borderBottom: `1px solid ${BDR}`,
                fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: "0.05em",
              }}>
                <div>תאריך</div><div>סוג</div><div>שם</div><div>קטגוריה</div>
                <div>פרויקט</div><div>איש קשר</div><div>סכום</div><div>סטטוס</div><div />
              </div>

              {displayItems.map((item) => {
                if (item.kind === "header") {
                  return (
                    <div key={`hdr-${item.key}`} style={{
                      padding: "8px 16px 6px", background: CARD2,
                      borderBottom: `1px solid ${BDR}`,
                      fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: "0.06em",
                    }}>
                      {item.label}
                    </div>
                  );
                }

                const { tx, rowIndex: i } = item;
                const proj     = projects.find((p) => p.id === tx.project_id);
                const isIncome = tx.type === "income";
                const undated  = !tx.date;
                const baseBg   = undated ? "#1D1810" : i % 2 === 0 ? CARD : "rgba(255,255,255,0.025)";
                const src = isShowTx(tx) ? { label: "הופעה", icon: "🎤", col: BRAND }
                  : (!!tx.project_id || (tx.scope ?? "project") === "project") ? { label: proj?.name || "פרויקט", icon: "📁", col: BLUE }
                  : { label: "כללי", icon: "🏢", col: PURPLE };

                return (
                  <div key={tx.id}>
                    <div
                      onClick={() => openEdit(tx)}
                      style={{
                        display: "grid", gridTemplateColumns: FLAT_COLS,
                        gap: 10, padding: "16px 18px", alignItems: "center",
                        borderBottom: `1px solid ${BDR}`,
                        background: baseBg, cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.035)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = baseBg; }}
                    >
                      {/* תאריך */}
                      <div style={{ fontSize: 12.5, color: undated ? AMBER : TEXT2 }}>
                        {undated ? "ללא תאריך" : fmtDate(tx.date)}
                      </div>
                      {/* סוג */}
                      <div>
                        <span style={{
                          fontSize: 10.5, fontWeight: 800, borderRadius: 6, padding: "3px 9px",
                          background: isIncome ? `${GREEN}18` : `${RED}16`,
                          color: isIncome ? GREEN : RED,
                          border: `1px solid ${isIncome ? `${GREEN}33` : `${RED}30`}`,
                          display: "inline-block", whiteSpace: "nowrap",
                        }}>
                          {isIncome ? "הכנסה" : "הוצאה"}
                        </span>
                      </div>
                      {/* שם */}
                      <div style={{ fontSize: 13.5, color: TEXT, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {getTransactionLabel(tx)}
                      </div>
                      {/* קטגוריה */}
                      <div style={{ fontSize: 12.5, color: tx.category ? TEXT2 : MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tx.category || "—"}
                      </div>
                      {/* פרויקט / שיוך */}
                      <div>
                        <span title={src.label} style={{
                          display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%",
                          fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "4px 9px",
                          background: `${src.col}16`, color: src.col, border: `1px solid ${src.col}30`,
                        }}>
                          <span style={{ flexShrink: 0 }}>{src.icon}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{src.label}</span>
                        </span>
                      </div>
                      {/* איש קשר */}
                      <div style={{ fontSize: 12.5, color: TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tx.artist || proj?.artist || "—"}
                      </div>
                      {/* סכום */}
                      <div style={{ fontSize: 16.5, fontWeight: 800, color: isIncome ? GREEN : RED, whiteSpace: "nowrap", letterSpacing: "-0.02em" }}>
                        {isIncome ? "+" : "−"}{fmtAmount(tx.amount, tx.currency)}
                      </div>
                      {/* סטטוס */}
                      <div>
                        <button type="button" title="שינוי סטטוס מהיר"
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setStatusMenu(statusMenu?.id === tx.id ? null : { id: tx.id, x: r.left, y: r.bottom });
                          }}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
                          <StatusBadge status={tx.payment_status} />
                        </button>
                      </div>
                      {/* עריכה */}
                      <button type="button" title="עריכת תנועה"
                        onClick={(e) => { e.stopPropagation(); openEdit(tx); }}
                        style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 13, fontFamily: "inherit", padding: 0 }}>
                        ✏
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Footer totals */}
              <div style={{ display: "flex", gap: 24, padding: "12px 16px", borderTop: `1px solid ${BDR}`, background: CARD2, fontSize: 11, color: MUTED }}>
                <span>הכנסות: <strong style={{ color: GREEN }}>{fmtAmount(filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0))}</strong></span>
                <span>הוצאות: <strong style={{ color: RED }}>{fmtAmount(filtered.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0))}</strong></span>
                <span style={{ marginInlineStart: "auto" }}>{filtered.length} תנועות מסוננות</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
