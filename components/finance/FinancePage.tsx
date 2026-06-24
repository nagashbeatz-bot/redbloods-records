"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useProjects } from "@/components/ProjectsProvider";

// ── Design Tokens ─────────────────────────────────────────────────────────────
const BRAND  = "#DC2626";
const GREEN  = "#10B981";
const AMBER  = "#F59E0B";
const RED    = "#EF4444";
const BLUE   = "#3B82F6";
const PURPLE = "#A855F7";
const CARD   = "#111318";
const CARD2  = "#0D0D12";
const BDR    = "rgba(255,255,255,0.07)";
const BDR2   = "rgba(255,255,255,0.11)";
const TEXT   = "#F2F2F2";
const TEXT2  = "#A0A0B0";
const MUTED  = "#52526A";

// ── Types ─────────────────────────────────────────────────────────────────────
type PaymentStatus = "שולם" | "צפוי" | "לא שולם" | "חלקי" | "בוטל" | "התקבל" | "לבדיקה";
type Period        = "prev-month" | "month" | "next-month" | "3months" | "custom";
type SortMode      = "date-desc" | "date-asc" | "amount-desc" | "project" | "status" | "type";
type Scope         = "project" | "general";
type SourceFilter  = "all" | "project" | "general";

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
  created_at: string;
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
const INCOME_STATUSES:  PaymentStatus[] = ["צפוי", "התקבל", "חלקי", "בוטל", "לבדיקה"];
const EXPENSE_STATUSES: PaymentStatus[] = ["שולם", "צפוי", "לא שולם", "חלקי", "בוטל"];
const PAYMENT_METHODS   = ["ביט", "העברה בנקאית", "מזומן", "PayPal", "Payoneer", "אשראי", "אחר"];
const HEB_MONTHS        = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: "prev-month",  label: "חודש קודם" },
  { key: "month",       label: "חודש נוכחי" },
  { key: "next-month",  label: "חודש הבא" },
  { key: "3months",     label: "3 חודשים" },
  { key: "custom",      label: "מותאם אישית" },
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
function getRange(period: Period, customFrom = "", customTo = ""): { from: Date | null; to: Date | null } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "prev-month": {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      return { from: new Date(py, pm, 1), to: new Date(py, pm + 1, 0, 23, 59, 59) };
    }
    case "month":
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59) };
    case "next-month":
      return { from: new Date(y, m + 1, 1), to: new Date(y, m + 2, 0, 23, 59, 59) };
    case "3months":
      // Current month + next 2 months
      return { from: new Date(y, m, 1), to: new Date(y, m + 3, 0, 23, 59, 59) };
    case "custom":
      if (customFrom && customTo)
        return { from: new Date(customFrom), to: new Date(customTo + "T23:59:59") };
      return { from: null, to: null };
  }
}

function getCompRange(period: Period): { from: Date | null; to: Date | null } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "prev-month": {
      // 2 months ago
      return { from: new Date(y, m - 2, 1), to: new Date(y, m - 1, 0, 23, 59, 59) };
    }
    case "month": {
      // Previous month
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59) };
    }
    case "next-month": {
      // Current month (compare next month to current)
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59) };
    }
    case "3months": {
      // Previous 3 months
      return { from: new Date(y, m - 3, 1), to: new Date(y, m, 0, 23, 59, 59) };
    }
    default:
      return { from: null, to: null };
  }
}

function getCompLabel(period: Period): string {
  switch (period) {
    case "prev-month":  return "מול חודשיים קודמים";
    case "month":       return "מול חודש קודם";
    case "next-month":  return "מול החודש הנוכחי";
    case "3months":     return "מול 3 חודשים קודמים";
    default:            return "";
  }
}

function getPeriodTitle(period: Period, customFrom = "", customTo = ""): string {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "prev-month": {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      return `${HEB_MONTHS[pm]} ${py}`;
    }
    case "month":
      return `${HEB_MONTHS[m]} ${y}`;
    case "next-month": {
      const nm = (m + 1) % 12;
      const ny = m === 11 ? y + 1 : y;
      return `${HEB_MONTHS[nm]} ${ny}`;
    }
    case "3months": {
      const endMonth = (m + 2) % 12;
      const endYear  = m + 2 > 11 ? y + 1 : y;
      return `${HEB_MONTHS[m]} עד ${HEB_MONTHS[endMonth]} ${endYear}`;
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
  color: TEXT2, fontSize: 12, padding: "7px 12px", outline: "none",
  fontFamily: "inherit", cursor: "pointer",
};

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#6B7280";
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color,
      background: `${color}18`, border: `1px solid ${color}35`,
      borderRadius: 100, padding: "2px 8px", whiteSpace: "nowrap",
      display: "inline-flex", alignItems: "center",
    }}>
      {status}
    </span>
  );
}

// ── Summary Card ──────────────────────────────────────────────────────────────
function SummaryCard({
  label, value, color, sub, icon,
  delta, deltaCurrency = "₪", compLabel, deltaPositiveIsGood = true,
}: {
  label: string; value: string; color: string; sub?: string; icon?: string;
  delta?: number; deltaCurrency?: string; compLabel?: string; deltaPositiveIsGood?: boolean;
}) {
  const showDelta = delta !== undefined && compLabel;
  const deltaColor = !showDelta || delta === 0
    ? MUTED
    : (delta > 0) === deltaPositiveIsGood ? GREEN : RED;
  const deltaSign = delta !== undefined && delta > 0 ? "+" : "";

  return (
    <div style={{
      background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16,
      padding: "20px 20px", flex: "1 1 0", minWidth: 0, position: "relative", overflow: "hidden",
    }}>
      {icon && (
        <div style={{ position: "absolute", bottom: -6, left: -4, fontSize: 52, opacity: 0.04, userSelect: "none", pointerEvents: "none", lineHeight: 1 }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, color, letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</div>
      {showDelta && (
        <div style={{ fontSize: 10, color: deltaColor, marginTop: 6, display: "flex", alignItems: "center", gap: 3 }}>
          <span>{deltaSign}{Math.abs(delta!).toLocaleString()}{deltaCurrency}</span>
          <span style={{ color: MUTED }}>{compLabel}</span>
        </div>
      )}
      {!showDelta && sub && (
        <div style={{ fontSize: 11, color: TEXT2, marginTop: 6 }}>{sub}</div>
      )}
    </div>
  );
}

// ── Monthly Donut ─────────────────────────────────────────────────────────────
function MonthlyDonut({ income, expenses }: { income: number; expenses: number }) {
  const total = income + expenses;
  const pct   = total > 0 ? income / total : 0.5;
  const net   = income - expenses;

  const R = 52, CX = 65, stroke = 10;
  const circumference = 2 * Math.PI * R;
  const incomeArc = circumference * pct;
  const expArc    = circumference * (1 - pct);

  return (
    <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "22px 20px" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 16 }}>סקירה חודשית</div>
      <svg viewBox="0 0 130 130" width={130} style={{ display: "block", margin: "0 auto", direction: "ltr" }}>
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
        <text x={CX} y={CX - 4} textAnchor="middle" fill={TEXT} fontSize={13} fontWeight={900}>
          {net >= 0 ? "+" : ""}{Math.abs(net).toLocaleString()}₪
        </text>
        <text x={CX} y={CX + 14} textAnchor="middle" fill={MUTED} fontSize={9}>נטו</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: TEXT2, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, display: "inline-block", flexShrink: 0 }} />
            הכנסות
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: GREEN }}>₪{income.toLocaleString()}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: TEXT2, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: AMBER, display: "inline-block", flexShrink: 0 }} />
            הוצאות
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: AMBER }}>₪{expenses.toLocaleString()}</span>
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
  draft, setDraft, saving, onSave, onCancel, projects, title,
}: {
  draft: TxDraft;
  setDraft: (d: TxDraft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  projects: { id: string; name: string; artist: string }[];
  title: string;
}) {
  const isIncome    = draft.type === "income";
  const isGeneral   = draft.scope === "general";
  const categoryList = isIncome
    ? INCOME_TYPES
    : isGeneral ? GENERAL_EXPENSE_CATEGORIES : PROJECT_EXPENSE_CATEGORIES;
  const statusList   = isIncome ? INCOME_STATUSES : EXPENSE_STATUSES;
  const isOther      = draft.category === "אחר";
  const canSave      = !saving && !!draft.amount && (isGeneral || !!draft.projectId) && (!isOther || !!draft.description);

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

        {/* Type toggle */}
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

        {/* Scope toggle */}
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
              {saving ? "שומר..." : isIncome ? "שמור הכנסה" : isGeneral ? "שמור הוצאה כללית" : "שמור הוצאה"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FinancePage() {
  const { projects } = useProjects();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [_settings,    setSettings]     = useState<FinanceSetting[]>([]);
  const [loaded,       setLoaded]       = useState(false);

  // Period
  const [period,     setPeriod]     = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");
  const [showUndated, setShowUndated] = useState(false);

  // Table filters
  const [typeFilter,   setTypeFilter]   = useState<"all" | "income" | "expense">("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState("");
  const [sortMode,     setSortMode]     = useState<SortMode>("date-desc");
  const [groupByMonth, setGroupByMonth] = useState(false);
  const [expandedIds,  setExpandedIds]  = useState<Set<string>>(new Set());

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft,     setDraft]     = useState<TxDraft>(emptyDraft());
  const [saving,    setSaving]    = useState(false);

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

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Period computations ────────────────────────────────────────────────────
  const range       = getRange(period, customFrom, customTo);
  const compRange   = getCompRange(period);
  const compLabel   = getCompLabel(period);
  const periodTitle = getPeriodTitle(period, customFrom, customTo);

  const periodTx = transactions.filter((t) => inRange(t.date, range));
  const compTx   = transactions.filter((t) => inRange(t.date, compRange));
  const noDateTx = transactions.filter((t) => !t.date);

  const stats     = calcStats(periodTx);
  const compStats = compRange.from ? calcStats(compTx) : null;

  // ── Needs attention (from ALL transactions, not just period) ──────────────
  const attentionUnpaidIncome  = transactions.filter((t) => t.type === "income"  && t.payment_status === "לא שולם");
  const attentionOpenExpenses  = transactions.filter((t) => t.type === "expense" && ["צפוי", "לא שולם"].includes(t.payment_status));
  const hasAttention = noDateTx.length > 0 || attentionUnpaidIncome.length > 0 || attentionOpenExpenses.length > 0;

  // ── Table filtered rows ────────────────────────────────────────────────────
  function matchesFilters(t: Transaction) {
    if (typeFilter !== "all"   && t.type !== typeFilter) return false;
    if (statusFilter           && t.payment_status !== statusFilter) return false;
    if (projectFilter          && t.project_id !== projectFilter) return false;
    if (sourceFilter !== "all" && (t.scope ?? "project") !== sourceFilter) return false;
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
  const allStatuses    = [...new Set(transactions.map((t) => t.payment_status))];

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
      currency: tx.currency, paymentStatus: tx.payment_status, paymentMethod: tx.payment_method,
      receiptRef: tx.receipt_ref, notes: tx.notes, category: tx.category,
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!draft.amount) return;
    if (draft.scope === "project" && !draft.projectId) return;
    setSaving(true);
    try {
      const body = {
        scope: draft.scope,
        projectId: draft.scope === "general" ? null : draft.projectId,
        type: draft.type, date: draft.date || null,
        description: draft.description, artist: draft.artist,
        amount: Number(draft.amount) || 0, currency: draft.currency,
        paymentStatus: draft.paymentStatus, paymentMethod: draft.paymentMethod,
        receiptRef: draft.receiptRef, notes: draft.notes, category: draft.category,
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
    setExpandedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const expensesPaid = stats.projExpPaid + stats.genExpPaid;

  // ── Render ────────────────────────────────────────────────────────────────
  const navBtnStyle: React.CSSProperties = {
    background: CARD, border: `1px solid ${BDR2}`, borderRadius: 10,
    color: TEXT2, fontSize: 18, width: 36, height: 36,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", fontFamily: "inherit", outline: "none",
  };

  return (
    <div dir="rtl" style={{ padding: "16px 40px" }}>

      {modalOpen && (
        <TxModal draft={draft} setDraft={setDraft} saving={saving}
          onSave={handleSave}
          onCancel={() => { setModalOpen(false); setEditingId(null); }}
          projects={projects}
          title={editingId ? "עריכת תנועה" : "תנועה חדשה"} />
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        {/* Right: title */}
        <h1 style={{ fontSize: 30, fontWeight: 900, color: TEXT, margin: 0, letterSpacing: "-0.03em" }}>כספים</h1>

        {/* Center: month navigator */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setPeriod("prev-month")} style={navBtnStyle}>‹</button>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, minWidth: 140, textAlign: "center" }}>
            📅 {periodTitle}
          </div>
          <button onClick={() => setPeriod("next-month")} style={navBtnStyle}>›</button>
        </div>

        {/* Left: add button */}
        <button onClick={openAdd} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 22px", borderRadius: 12,
          background: BRAND, border: "none", color: "#fff",
          fontSize: 14, fontWeight: 800, cursor: "pointer",
          boxShadow: "0 2px 16px rgba(220,38,38,0.45)",
          fontFamily: "inherit",
        }}>+ הוסף תנועה</button>
      </div>

      {/* ── Period selector ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PERIOD_OPTIONS.map(({ key, label }) => {
            const active = period === key;
            return (
              <button key={key} onClick={() => setPeriod(key)} style={{
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

      {/* ── KPI cards (6 in a row) ───────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 14 }}>
        <SummaryCard icon="💎" label='סה"כ נטו'
          value={fmtAmount(stats.profitReal)}
          color={stats.profitReal >= 0 ? GREEN : RED}
          sub={stats.profitReal >= 0 ? "רווח בפועל" : "גירעון"}
          delta={compStats ? stats.profitReal - compStats.profitReal : undefined}
          compLabel={compLabel} deltaPositiveIsGood={true}
        />
        <SummaryCard icon="💰" label='סה"כ הכנסות'
          value={fmtAmount(stats.incomeReceived)}
          color={GREEN}
          sub={`${periodTx.filter((t) => t.type === "income" && t.payment_status === "התקבל").length} תשלומים`}
          delta={compStats ? stats.incomeReceived - compStats.incomeReceived : undefined}
          compLabel={compLabel} deltaPositiveIsGood={true}
        />
        <SummaryCard icon="💸" label='סה"כ הוצאות'
          value={fmtAmount(expensesPaid)}
          color={expensesPaid > 0 ? AMBER : MUTED}
          sub={`${periodTx.filter((t) => t.type === "expense" && t.payment_status === "שולם").length} הוצאות`}
          delta={compStats ? expensesPaid - (compStats.projExpPaid + compStats.genExpPaid) : undefined}
          compLabel={compLabel} deltaPositiveIsGood={false}
        />
        <SummaryCard icon="✅" label="הכנסות מוכרות"
          value={fmtAmount(stats.incomeReceived)}
          color={GREEN}
          sub={stats.incomeReceived > 0 && (stats.incomeReceived + stats.incomeExpected) > 0
            ? `${Math.round(stats.incomeReceived / (stats.incomeReceived + stats.incomeExpected) * 100)}% מהסה"כ`
            : "—"}
        />
        <SummaryCard icon="⏳" label="הכנסות עתידיות"
          value={fmtAmount(stats.incomeExpected)}
          color={stats.incomeExpected > 0 ? BLUE : MUTED}
          sub={`${periodTx.filter((t) => t.type === "income" && ["צפוי","חלקי","לבדיקה"].includes(t.payment_status)).length} פתוחות`}
          delta={compStats ? stats.incomeExpected - compStats.incomeExpected : undefined}
          compLabel={compLabel} deltaPositiveIsGood={true}
        />
        <SummaryCard icon="🔮" label="הוצאות עתידיות"
          value={fmtAmount(stats.expensesExpected)}
          color={stats.expensesExpected > 0 ? PURPLE : MUTED}
          sub={`${periodTx.filter((t) => t.type === "expense" && ["צפוי","לא שולם","חלקי"].includes(t.payment_status)).length} פתוחות`}
          delta={compStats ? stats.expensesExpected - compStats.expensesExpected : undefined}
          compLabel={compLabel} deltaPositiveIsGood={false}
        />
      </div>

      {/* ── Two-column layout ────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>

        {/* Left: monthly summary */}
        <div style={{ flexShrink: 0, width: 300 }}>
          <MonthlyDonut income={stats.incomeReceived} expenses={expensesPaid} />

          {/* Needs attention */}
          {hasAttention && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 2 }}>
                דורש תשומת לב
              </div>
              {noDateTx.length > 0 && (
                <button onClick={() => setShowUndated((v) => !v)} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 12px", borderRadius: 10, width: "100%",
                  background: `${AMBER}08`, border: `1px solid ${AMBER}22`,
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  <span style={{ color: AMBER, fontSize: 12 }}>⚠</span>
                  <span style={{ fontSize: 11, color: TEXT2, flex: 1, textAlign: "right" }}>
                    <strong style={{ color: AMBER }}>{noDateTx.length}</strong> ללא תאריך
                  </span>
                  <span style={{ fontSize: 9, color: showUndated ? AMBER : MUTED }}>
                    {showUndated ? "▲" : "▼"}
                  </span>
                </button>
              )}
              {attentionUnpaidIncome.length > 0 && (
                <button onClick={() => { setTypeFilter("income"); setStatusFilter("לא שולם"); }} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 12px", borderRadius: 10, width: "100%",
                  background: `${RED}08`, border: `1px solid ${RED}22`,
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  <span style={{ color: RED, fontSize: 12 }}>⚡</span>
                  <span style={{ fontSize: 11, color: TEXT2, flex: 1, textAlign: "right" }}>
                    <strong style={{ color: RED }}>{attentionUnpaidIncome.length}</strong> לא שולמו
                  </span>
                </button>
              )}
              {attentionOpenExpenses.length > 0 && (
                <button onClick={() => { setTypeFilter("expense"); setStatusFilter(""); }} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 12px", borderRadius: 10, width: "100%",
                  background: `${AMBER}08`, border: `1px solid ${AMBER}22`,
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  <span style={{ color: AMBER, fontSize: 12 }}>📋</span>
                  <span style={{ fontSize: 11, color: TEXT2, flex: 1, textAlign: "right" }}>
                    <strong style={{ color: AMBER }}>{attentionOpenExpenses.length}</strong> הוצאות פתוחות
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right: filters + tabs + table */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* ── Filter strip ──────────────────────────────────────────── */}
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10,
            alignItems: "center", padding: "10px 14px",
            background: CARD, border: `1px solid ${BDR}`, borderRadius: 12,
          }}>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as SourceFilter)} style={selectStyle}>
              <option value="all">כל המקורות</option>
              <option value="project">📁 פרויקטים</option>
              <option value="general">🏢 כללי</option>
            </select>

            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={selectStyle}>
              <option value="">כל הפרויקטים</option>
              {projectsWithTx.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>

            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{
              ...selectStyle,
              color: statusFilter ? BRAND : TEXT2,
              borderColor: statusFilter ? `${BRAND}40` : BDR,
            }}>
              <option value="">כל הסטטוסים</option>
              {allStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} style={selectStyle}>
              <option value="date-desc">מהחדש לישן</option>
              <option value="date-asc">מהישן לחדש</option>
              <option value="amount-desc">לפי סכום</option>
              <option value="project">לפי פרויקט</option>
              <option value="status">לפי סטטוס</option>
              <option value="type">לפי סוג</option>
            </select>

            <button onClick={() => setGroupByMonth((v) => !v)} style={{
              ...selectStyle,
              background: groupByMonth ? `${PURPLE}15` : CARD,
              color: groupByMonth ? PURPLE : TEXT2,
              borderColor: groupByMonth ? `${PURPLE}40` : BDR,
            }}>
              קיבוץ חודשי
            </button>

            <span style={{ fontSize: 11, color: MUTED, marginRight: "auto" }}>{filtered.length} תנועות</span>
          </div>

          {/* ── Segmented tabs ────────────────────────────────────────── */}
          <div style={{
            display: "flex", gap: 4, marginBottom: 12,
            background: CARD, border: `1px solid ${BDR}`, borderRadius: 12, padding: 4,
          }}>
            {([["all","הכל",TEXT2],[" income","הכנסות",GREEN],["expense","הוצאות",AMBER]] as const).map(([key, label, color]) => {
              const k = key.trim() as "all" | "income" | "expense";
              const active = typeFilter === k;
              return (
                <button key={k} onClick={() => setTypeFilter(k)} style={{
                  flex: 1, padding: "8px 0", borderRadius: 10, border: "none", cursor: "pointer",
                  background: active ? `${color}18` : "transparent",
                  color: active ? color : MUTED,
                  fontSize: 13, fontWeight: active ? 700 : 500,
                  outline: active ? `1px solid ${color}35` : "none",
                  fontFamily: "inherit",
                }}>{label}</button>
              );
            })}
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
          ) : (
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" }}>
              {/* Table header */}
              <div style={{
                display: "grid", gridTemplateColumns: "90px 70px 2fr 1.5fr 1.5fr 110px 90px 30px",
                gap: 8, padding: "10px 16px",
                background: CARD2, borderBottom: `1px solid ${BDR}`,
                fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.06em",
              }}>
                <div>תאריך</div><div>סוג</div><div>פרויקט / מקור</div>
                <div>אמן / ספק</div><div>תיאור / קטגוריה</div>
                <div>סכום</div><div>סטטוס</div><div />
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
                const isGen    = (tx.scope ?? "project") === "general";
                const undated  = !tx.date;
                const expanded = expandedIds.has(tx.id);

                return (
                  <div key={tx.id}>
                    {/* Main row */}
                    <div
                      onClick={() => toggleExpand(tx.id)}
                      style={{
                        display: "grid", gridTemplateColumns: "90px 70px 2fr 1.5fr 1.5fr 110px 90px 30px",
                        gap: 8, padding: "17px 16px", alignItems: "center",
                        borderBottom: expanded ? "none" : `1px solid rgba(255,255,255,0.06)`,
                        background: undated ? "#1D1810" : expanded ? `${BRAND}08` : i % 2 === 0 ? CARD : "rgba(255,255,255,0.025)",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { if (!expanded) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)"; }}
                      onMouseLeave={(e) => { if (!expanded) (e.currentTarget as HTMLDivElement).style.background = undated ? "#1D1810" : expanded ? `${BRAND}08` : i % 2 === 0 ? CARD : CARD2; }}
                    >
                      <div style={{ fontSize: 12, color: undated ? AMBER : TEXT2 }}>
                        {undated ? "ללא תאריך" : fmtDate(tx.date)}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, borderRadius: 4, padding: "2px 5px",
                          background: isIncome ? `${GREEN}12` : `${AMBER}12`,
                          color: isIncome ? GREEN : AMBER,
                          border: `1px solid ${isIncome ? `${GREEN}25` : `${AMBER}25`}`,
                          display: "inline-block", width: "fit-content",
                        }}>
                          {isIncome ? "הכנסה" : "הוצאה"}
                        </span>
                        {isGen && (
                          <span style={{
                            fontSize: 8, fontWeight: 700, borderRadius: 4, padding: "2px 5px",
                            background: `${PURPLE}12`, color: PURPLE,
                            border: `1px solid ${PURPLE}25`,
                            display: "inline-block", width: "fit-content",
                          }}>
                            כללי
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {isGen
                          ? <span style={{ color: PURPLE }}>🏢 כללי</span>
                          : (proj?.name ?? "—")}
                      </div>
                      <div style={{ fontSize: 12, color: TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tx.artist || proj?.artist || "—"}
                      </div>
                      <div style={{ fontSize: 12, color: TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tx.description || tx.category || "—"}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: isIncome ? GREEN : isGen ? PURPLE : AMBER }}>
                        {isIncome ? "+" : "−"}{fmtAmount(tx.amount, tx.currency)}
                      </div>
                      <div><StatusBadge status={tx.payment_status} /></div>
                      <div style={{ textAlign: "center", color: expanded ? BRAND : MUTED, fontSize: 11 }}>
                        {expanded ? "▲" : "▼"}
                      </div>
                    </div>

                    {/* Expanded details */}
                    {expanded && (
                      <div style={{
                        padding: "10px 16px 12px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`,
                        background: `rgba(255,255,255,0.02)`,
                        display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
                      }}>
                        {tx.payment_method && (
                          <div style={{ fontSize: 11, color: TEXT2 }}>
                            <span style={{ color: MUTED, marginLeft: 4 }}>אמצעי תשלום:</span>
                            {tx.payment_method}
                          </div>
                        )}
                        {tx.receipt_ref && (
                          <div style={{ fontSize: 11, color: TEXT2 }}>
                            <span style={{ color: MUTED, marginLeft: 4 }}>אסמכתא:</span>
                            {tx.receipt_ref}
                          </div>
                        )}
                        {tx.category && (
                          <div style={{ fontSize: 11, color: TEXT2 }}>
                            <span style={{ color: MUTED, marginLeft: 4 }}>קטגוריה:</span>
                            {tx.category}
                          </div>
                        )}
                        {tx.notes && (
                          <div style={{ fontSize: 11, color: TEXT2 }}>
                            <span style={{ color: MUTED, marginLeft: 4 }}>הערות:</span>
                            {tx.notes}
                          </div>
                        )}
                        {!tx.payment_method && !tx.receipt_ref && !tx.category && !tx.notes && (
                          <div style={{ fontSize: 11, color: MUTED }}>אין פרטים נוספים</div>
                        )}
                        <div style={{ display: "flex", gap: 8, marginRight: "auto" }}>
                          <button onClick={(e) => { e.stopPropagation(); openEdit(tx); }} style={{
                            padding: "5px 14px", borderRadius: 8, border: `1px solid ${BDR2}`,
                            background: "transparent", color: TEXT2, cursor: "pointer",
                            fontSize: 12, fontFamily: "inherit",
                          }}>
                            ✏ ערוך
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(tx.id); }} style={{
                            padding: "5px 14px", borderRadius: 8, border: `1px solid ${RED}25`,
                            background: `${RED}06`, color: RED, cursor: "pointer",
                            fontSize: 12, fontFamily: "inherit",
                          }}>
                            × מחק
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Footer totals */}
              <div style={{ display: "flex", gap: 24, padding: "12px 16px", borderTop: `1px solid ${BDR}`, background: CARD2, fontSize: 11, color: MUTED }}>
                <span>הכנסות: <strong style={{ color: GREEN }}>{fmtAmount(filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0))}</strong></span>
                <span>הוצאות: <strong style={{ color: AMBER }}>{fmtAmount(filtered.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0))}</strong></span>
                <span style={{ marginRight: "auto" }}>{filtered.length} תנועות מסוננות</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
