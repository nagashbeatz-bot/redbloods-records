"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useProjects } from "@/components/ProjectsProvider";

// ── Types ─────────────────────────────────────────────────────────────────────
type PaymentStatus = "שולם" | "צפוי" | "לא שולם" | "חלקי" | "בוטל" | "התקבל" | "לבדיקה";
type Period = "month" | "prev-month" | "30days" | "year" | "custom";
type SortMode = "date-desc" | "date-asc" | "amount-desc" | "project" | "status" | "type";

interface Transaction {
  id: string;
  project_id: string;
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
const EXPENSE_CATEGORIES = ["מיקס / מאסטר", "חדר חזרות", "צילום", "נסיעות", "אחר"];
const INCOME_TYPES       = ["מקדמה", "תשלום חלקי", "תשלום סופי", "תשלום מלא", "תוספת / חריגה", "אחר"];
const INCOME_STATUSES:  PaymentStatus[] = ["צפוי", "התקבל", "חלקי", "בוטל", "לבדיקה"];
const EXPENSE_STATUSES: PaymentStatus[] = ["שולם", "צפוי", "לא שולם", "חלקי", "בוטל"];
const PAYMENT_METHODS    = ["ביט", "העברה בנקאית", "מזומן", "PayPal", "Payoneer", "אשראי", "אחר"];
const HEB_MONTHS         = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: "month",      label: "החודש" },
  { key: "prev-month", label: "חודש קודם" },
  { key: "30days",     label: "30 יום" },
  { key: "year",       label: "שנה נוכחית" },
  { key: "custom",     label: "מותאם אישית" },
];

const STATUS_COLOR: Record<string, string> = {
  "שולם":    "#10B981",
  "התקבל":   "#10B981",
  "צפוי":    "#3B82F6",
  "לא שולם": "#EF4444",
  "חלקי":    "#F59E0B",
  "בוטל":    "#6B7280",
  "לבדיקה":  "#A855F7",
};

// ── Period helpers ─────────────────────────────────────────────────────────────
function getRange(period: Period, customFrom = "", customTo = ""): { from: Date | null; to: Date | null } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "month":
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59) };
    case "prev-month": {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      return { from: new Date(py, pm, 1), to: new Date(py, pm + 1, 0, 23, 59, 59) };
    }
    case "30days": {
      const from = new Date(now); from.setDate(from.getDate() - 30);
      return { from, to: new Date(y, m, now.getDate(), 23, 59, 59) };
    }
    case "year":
      return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59) };
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
    case "month": {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      return { from: new Date(py, pm, 1), to: new Date(py, pm + 1, 0, 23, 59, 59) };
    }
    case "prev-month": {
      const pm = m <= 1 ? (m === 0 ? 10 : 11) : m - 2;
      const py = m <= 1 ? y - 1 : y;
      return { from: new Date(py, pm, 1), to: new Date(py, pm + 1, 0, 23, 59, 59) };
    }
    case "30days": {
      const from = new Date(now); from.setDate(from.getDate() - 60);
      const to   = new Date(now); to.setDate(to.getDate() - 30);
      return { from, to };
    }
    case "year":
      return { from: new Date(y - 1, 0, 1), to: new Date(y - 1, 11, 31, 23, 59, 59) };
    default:
      return { from: null, to: null };
  }
}

function getCompLabel(period: Period): string {
  switch (period) {
    case "month":      return "מול חודש קודם";
    case "prev-month": return "מול חודשיים קודמים";
    case "30days":     return "מול 30 יום קודמים";
    case "year":       return "מול שנה קודמת";
    default:           return "";
  }
}

function getPeriodTitle(period: Period, customFrom = "", customTo = ""): { heading: string; sub: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "month":      return { heading: "חודש נוכחי",      sub: `${HEB_MONTHS[m]} ${y}` };
    case "prev-month": {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      return { heading: "חודש קודם", sub: `${HEB_MONTHS[pm]} ${py}` };
    }
    case "30days":     return { heading: "30 ימים אחרונים", sub: "" };
    case "year":       return { heading: "שנה נוכחית",       sub: `${y}` };
    case "custom":     return { heading: "מותאם אישית",      sub: customFrom && customTo ? `${fmtDate(customFrom)} – ${fmtDate(customTo)}` : "" };
  }
}

function inRange(date: string | null, range: { from: Date | null; to: Date | null }): boolean {
  if (!date || !range.from || !range.to) return false;
  const d = new Date(date);
  return d >= range.from && d <= range.to;
}

// ── General helpers ────────────────────────────────────────────────────────────
function emptyDraft(projectId = ""): TxDraft {
  return {
    projectId, type: "income", date: "", description: "", artist: "",
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
  const income   = txList.filter((t) => t.type === "income");
  const expenses = txList.filter((t) => t.type === "expense");
  const incomeReceived  = income.filter((t) => t.payment_status === "התקבל").reduce((s, t) => s + t.amount, 0);
  const incomeExpected  = income.filter((t) => ["צפוי", "חלקי", "לבדיקה"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const expensesPaid    = expenses.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const expensesExpected = expenses.filter((t) => ["צפוי", "לא שולם", "חלקי"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const profitReal      = incomeReceived - expensesPaid;
  const profitEst       = incomeReceived + incomeExpected - expensesPaid - expensesExpected;
  return { incomeReceived, incomeExpected, expensesPaid, expensesExpected, profitReal, profitEst };
}

// ── Style helpers ─────────────────────────────────────────────────────────────
const INPUT_S: React.CSSProperties = {
  background: "#1A1A1A", border: "1px solid #2E2E2E", borderRadius: 8,
  color: "#E8E8E8", fontSize: 13, padding: "8px 12px", outline: "none",
  fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};

const LABEL_S: React.CSSProperties = {
  fontSize: 11, color: "#555", marginBottom: 5, display: "block", textAlign: "right",
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: "#3A3A3A", letterSpacing: "0.08em",
  textTransform: "uppercase", marginBottom: 10, paddingBottom: 6,
  borderBottom: "1px solid #1E1E1E",
};

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#6B7280";
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color,
      background: `${color}18`, border: `1px solid ${color}35`,
      borderRadius: 5, padding: "1px 7px", whiteSpace: "nowrap",
    }}>
      {status}
    </span>
  );
}

// ── Summary Card ──────────────────────────────────────────────────────────────
function SummaryCard({
  label, value, color, countLabel, icon,
  delta, deltaCurrency = "₪", compLabel, deltaPositiveIsGood = true,
}: {
  label: string; value: string; color: string; countLabel?: string; icon?: string;
  delta?: number; deltaCurrency?: string; compLabel?: string; deltaPositiveIsGood?: boolean;
}) {
  const showDelta = delta !== undefined && compLabel;
  const deltaColor = !showDelta || delta === 0
    ? "#555"
    : (delta > 0) === deltaPositiveIsGood ? "#10B981" : "#EF4444";
  const deltaSign  = delta !== undefined && delta > 0 ? "+" : "";

  return (
    <div style={{
      background: "#1C1C1C", border: "1px solid #252525", borderRadius: 14,
      padding: "16px 18px", flex: "1 1 0", minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
        <div style={{ fontSize: 11, color: "#555" }}>{label}</div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, letterSpacing: "-0.5px" }}>{value}</div>
      {showDelta && (
        <div style={{ fontSize: 10, color: deltaColor, marginTop: 5, display: "flex", alignItems: "center", gap: 3 }}>
          <span>{deltaSign}{Math.abs(delta!).toLocaleString()}{deltaCurrency}</span>
          <span style={{ color: "#444" }}>{compLabel}</span>
        </div>
      )}
      {!showDelta && countLabel && (
        <div style={{ fontSize: 10, color: "#444", marginTop: 5 }}>{countLabel}</div>
      )}
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
  const [open, setOpen]   = useState(false);
  const [search, setSearch] = useState("");
  const btnRef            = useRef<HTMLButtonElement>(null);
  const [pos, setPos]     = useState({ top: 0, left: 0, width: 0 });

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
        zIndex: 999999, background: "#1A1A1A", border: "1px solid #333",
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
          ? <div style={{ fontSize: 12, color: "#444", padding: "8px 10px", textAlign: "center" }}>אין תוצאות</div>
          : filtered.map((p) => (
            <button key={p.id}
              onClick={() => { onChange(p.id, p.artist); setOpen(false); }}
              style={{
                display: "block", width: "100%", textAlign: "right",
                padding: "8px 10px", borderRadius: 8, border: "none",
                background: p.id === value ? "rgba(59,130,246,0.12)" : "transparent",
                cursor: "pointer", fontFamily: "inherit",
              }}
              onMouseEnter={(e) => { if (p.id !== value) (e.currentTarget as HTMLButtonElement).style.background = "#252525"; }}
              onMouseLeave={(e) => { if (p.id !== value) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <div style={{ fontSize: 13, color: p.id === value ? "#3B82F6" : "#DDD", fontWeight: p.id === value ? 600 : 400 }}>{p.name}</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 1 }}>{p.artist}</div>
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
        color: selected ? "#E8E8E8" : "#555",
      }}>
        <span style={{ fontSize: 12, color: "#555" }}>▾</span>
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
  const categoryList = isIncome ? INCOME_TYPES : EXPENSE_CATEGORIES;
  const statusList   = isIncome ? INCOME_STATUSES : EXPENSE_STATUSES;
  const isOther      = draft.category === "אחר";

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onCancel]);

  const modal = (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#141414", border: "1px solid #2A2A2A",
        borderRadius: 18, padding: "22px 22px 18px",
        width: 460, maxWidth: "95vw", direction: "rtl",
        boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
        maxHeight: "92vh", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>✕</button>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#E8E8E8", margin: 0 }}>{title}</h2>
        </div>

        {/* Type toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {(["income", "expense"] as const).map((t) => (
            <button key={t} type="button"
              onClick={() => setDraft({ ...draft, type: t, paymentStatus: t === "income" ? "צפוי" : "שולם", category: "" })}
              style={{
                flex: 1, padding: "9px", borderRadius: 10, border: "none", cursor: "pointer",
                fontSize: 13, fontFamily: "inherit", fontWeight: 600,
                background: draft.type === t ? (t === "income" ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.14)") : "#1C1C1C",
                color: draft.type === t ? (t === "income" ? "#10B981" : "#EF4444") : "#555",
                outline: draft.type === t ? `1px solid ${t === "income" ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.3)"}` : "1px solid #252525",
              }}
            >
              {t === "income" ? "💰 הכנסה" : "💸 הוצאה"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

          {/* ── בלוק 1: פרויקט וסוג ── */}
          <div>
            <div style={SECTION_LABEL}>פרויקט וסוג</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={LABEL_S}>פרויקט *</label>
                <ProjectSelect value={draft.projectId} projects={projects}
                  onChange={(id, artist) => setDraft({ ...draft, projectId: id, artist })} />
              </div>
              <div>
                <label style={LABEL_S}>{isIncome ? "סוג הכנסה" : "קטגוריית הוצאה"}</label>
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} style={INPUT_S}>
                  <option value="">בחר...</option>
                  {categoryList.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {isOther && (
                  <div style={{ fontSize: 10, color: "#F59E0B", marginTop: 4 }}>⚠ נא למלא תיאור מפורט בשדה &quot;תיאור&quot;</div>
                )}
              </div>
            </div>
          </div>

          {/* ── בלוק 2: מול מי + תיאור ── */}
          <div>
            <div style={SECTION_LABEL}>{isIncome ? "לקוח ותיאור" : "ספק ותיאור"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={LABEL_S}>{isIncome ? "לקוח / אמן" : "ספק / למי שולם"}</label>
                <input type="text" value={draft.artist} onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
                  placeholder={isIncome ? "שם הלקוח / האמן..." : "שם הספק..."} style={INPUT_S} />
              </div>
              <div>
                <label style={{ ...LABEL_S, ...(isOther ? { color: "#F59E0B" } : {}) }}>
                  תיאור{isOther ? " *" : ""}
                </label>
                <input type="text" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder={isIncome ? "למשל: תשלום ראשון, מקדמה לפרויקט..." : "למשל: Bill - מיקס לשיר יהלום..."}
                  style={{ ...INPUT_S, ...(isOther && !draft.description ? { borderColor: "rgba(245,158,11,0.5)" } : {}) }} />
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
                  onKeyDown={(e) => { if (e.key === "Enter") onSave(); }} />
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onCancel} style={{
              flex: 1, padding: "11px", borderRadius: 10,
              border: "1px solid #2A2A2A", background: "transparent",
              color: "#777", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
            }}>ביטול</button>
            <button type="button" onClick={onSave}
              disabled={saving || !draft.projectId || !draft.amount || (isOther && !draft.description)}
              style={{
                flex: 2, padding: "11px", borderRadius: 10, border: "none",
                background: saving || !draft.projectId || !draft.amount || (isOther && !draft.description)
                  ? "#1A2A3A" : (isIncome ? "#065F46" : "#7C2D12"),
                color: saving || !draft.projectId || !draft.amount || (isOther && !draft.description) ? "#445" : "#fff",
                cursor: saving || !draft.projectId || !draft.amount ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: 700, fontFamily: "inherit",
              }}
            >
              {saving ? "שומר..." : isIncome ? "שמור הכנסה" : "שמור הוצאה"}
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

  // Table filters (on top of period)
  const [typeFilter,    setTypeFilter]    = useState<"all" | "income" | "expense">("all");
  const [statusFilter,  setStatusFilter]  = useState<string>("");
  const [projectFilter, setProjectFilter] = useState("");
  const [sortMode,      setSortMode]      = useState<SortMode>("date-desc");
  const [groupByMonth,  setGroupByMonth]  = useState(false);

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

  // ── Period computations ────────────────────────────────────────────────────
  const range     = getRange(period, customFrom, customTo);
  const compRange = getCompRange(period);
  const compLabel = getCompLabel(period);
  const { heading: periodHeading, sub: periodSub } = getPeriodTitle(period, customFrom, customTo);

  const periodTx   = transactions.filter((t) => inRange(t.date, range));
  const compTx     = transactions.filter((t) => inRange(t.date, compRange));
  const noDateTx   = transactions.filter((t) => !t.date);

  const stats     = calcStats(periodTx);
  const compStats = compRange.from ? calcStats(compTx) : null;

  // ── Table filtered rows ────────────────────────────────────────────────────
  function matchesFilters(t: Transaction) {
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (statusFilter && t.payment_status !== statusFilter) return false;
    if (projectFilter && t.project_id !== projectFilter) return false;
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
      case "amount-desc":
        return copy.sort((a, b) => b.amount - a.amount);
      case "project":
        return copy.sort((a, b) => {
          const pA = projects.find((p) => p.id === a.project_id)?.name ?? "";
          const pB = projects.find((p) => p.id === b.project_id)?.name ?? "";
          return pA.localeCompare(pB, "he");
        });
      case "status":
        return copy.sort((a, b) => a.payment_status.localeCompare(b.payment_status, "he"));
      case "type":
        return copy.sort((a, b) => a.type.localeCompare(b.type));
      default:
        return copy;
    }
  }

  // Build display items (with optional month grouping)
  type DisplayItem =
    | { kind: "header"; label: string; key: string }
    | { kind: "row";    tx: Transaction; rowIndex: number };

  function buildDisplayItems(sorted: Transaction[], undated: Transaction[]): DisplayItem[] {
    if (!groupByMonth) {
      const items: DisplayItem[] = sorted.map((tx, i) => ({ kind: "row" as const, tx, rowIndex: i }));
      if (showUndated) undated.forEach((tx, i) => items.push({ kind: "row", tx, rowIndex: sorted.length + i }));
      return items;
    }
    // Group dated transactions by YYYY-MM
    const groups: { key: string; label: string; txs: Transaction[] }[] = [];
    const seen = new Map<string, number>();
    sorted.forEach((tx) => {
      if (!tx.date) return;
      const key = tx.date.substring(0, 7);
      const [y, m] = key.split("-");
      const label = `${HEB_MONTHS[parseInt(m) - 1]} ${y}`;
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
      projectId: tx.project_id, type: tx.type, date: tx.date ?? "",
      description: tx.description, artist: tx.artist, amount: String(tx.amount),
      currency: tx.currency, paymentStatus: tx.payment_status, paymentMethod: tx.payment_method,
      receiptRef: tx.receipt_ref, notes: tx.notes, category: tx.category,
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!draft.projectId || !draft.amount) return;
    setSaving(true);
    try {
      const body = {
        projectId: draft.projectId, type: draft.type, date: draft.date || null,
        description: draft.description, artist: draft.artist, amount: Number(draft.amount) || 0,
        currency: draft.currency, paymentStatus: draft.paymentStatus, paymentMethod: draft.paymentMethod,
        receiptRef: draft.receiptRef, notes: draft.notes, category: draft.category,
      };
      if (editingId) {
        const res  = await fetch(`/api/transactions/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.transaction) setTransactions((prev) => prev.map((t) => t.id === editingId ? data.transaction : t));
      } else {
        const res  = await fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" style={{ padding: "28px 32px", maxWidth: 1200, margin: "0 auto" }}>

      {modalOpen && (
        <TxModal draft={draft} setDraft={setDraft} saving={saving}
          onSave={handleSave}
          onCancel={() => { setModalOpen(false); setEditingId(null); }}
          projects={projects}
          title={editingId ? "עריכת תנועה" : "תנועה חדשה"} />
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#E8E8E8", margin: 0 }}>
            כספים
            {periodHeading && (
              <span style={{ fontSize: 15, fontWeight: 400, color: "#555", marginRight: 10 }}>— {periodHeading}</span>
            )}
          </h1>
          {periodSub && (
            <p style={{ fontSize: 13, color: "#666", margin: "4px 0 0", fontWeight: 500 }}>{periodSub}</p>
          )}
        </div>
        <button onClick={openAdd} style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "10px 20px", borderRadius: 12,
          border: "1px solid rgba(59,130,246,0.4)", background: "rgba(59,130,246,0.1)",
          color: "#3B82F6", fontSize: 14, fontWeight: 700, cursor: "pointer",
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
          הוסף תנועה
        </button>
      </div>

      {/* ── Period selector ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PERIOD_OPTIONS.map(({ key, label }) => {
            const active = period === key;
            return (
              <button key={key} onClick={() => setPeriod(key)} style={{
                padding: "7px 16px", borderRadius: 10, border: "none", cursor: "pointer",
                background: active ? "rgba(59,130,246,0.14)" : "#1C1C1C",
                color: active ? "#3B82F6" : "#555",
                fontSize: 12, fontWeight: active ? 700 : 400, fontFamily: "inherit",
                outline: active ? "1px solid rgba(59,130,246,0.35)" : "1px solid #252525",
                transition: "all 0.15s",
              }}>
                {label}
              </button>
            );
          })}
        </div>

        {/* Custom date range */}
        {period === "custom" && (
          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 11, color: "#555" }}>מ</label>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                style={{ ...INPUT_S, width: 150, colorScheme: "dark", fontSize: 12 }} />
            </div>
            <span style={{ color: "#333", fontSize: 14 }}>—</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 11, color: "#555" }}>עד</label>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                style={{ ...INPUT_S, width: 150, colorScheme: "dark", fontSize: 12 }} />
            </div>
          </div>
        )}
      </div>

      {/* ── No-date warning ─────────────────────────────────────────────── */}
      {noDateTx.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 14px", marginBottom: 18,
          background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.18)",
          borderRadius: 10, fontSize: 12,
        }}>
          <span style={{ color: "#F59E0B" }}>⚠</span>
          <span style={{ color: "#777" }}>
            יש <strong style={{ color: "#F59E0B" }}>{noDateTx.length}</strong> תנועות ללא תאריך שלא נכללות בסיכום התקופה.
          </span>
          <button onClick={() => setShowUndated((v) => !v)} style={{
            marginRight: "auto", fontSize: 11, fontFamily: "inherit",
            color: showUndated ? "#F59E0B" : "#555", background: "none",
            border: "none", cursor: "pointer", textDecoration: "underline",
          }}>
            {showUndated ? "הסתר" : "הצג אותן בטבלה"}
          </button>
        </div>
      )}

      {/* ── Summary cards ───────────────────────────────────────────────── */}
      {/* Row 1: income & expenses */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
        <SummaryCard
          icon="✅" label="הכנסות שהתקבלו"
          value={fmtAmount(stats.incomeReceived)}
          color="#10B981"
          countLabel={`${periodTx.filter((t) => t.type === "income" && t.payment_status === "התקבל").length} תשלומים`}
          delta={compStats ? stats.incomeReceived - compStats.incomeReceived : undefined}
          compLabel={compLabel}
          deltaPositiveIsGood={true}
        />
        <SummaryCard
          icon="⏳" label="הכנסות צפויות"
          value={fmtAmount(stats.incomeExpected)}
          color={stats.incomeExpected > 0 ? "#3B82F6" : "#555"}
          countLabel={`${periodTx.filter((t) => t.type === "income" && ["צפוי","חלקי","לבדיקה"].includes(t.payment_status)).length} פתוחות`}
          delta={compStats ? stats.incomeExpected - compStats.incomeExpected : undefined}
          compLabel={compLabel}
          deltaPositiveIsGood={true}
        />
        <SummaryCard
          icon="💳" label="הוצאות ששולמו"
          value={fmtAmount(stats.expensesPaid)}
          color={stats.expensesPaid > 0 ? "#F59E0B" : "#555"}
          countLabel={`${periodTx.filter((t) => t.type === "expense" && t.payment_status === "שולם").length} הוצאות`}
          delta={compStats ? stats.expensesPaid - compStats.expensesPaid : undefined}
          compLabel={compLabel}
          deltaPositiveIsGood={false}
        />
        <SummaryCard
          icon="📋" label="הוצאות צפויות"
          value={fmtAmount(stats.expensesExpected)}
          color={stats.expensesExpected > 0 ? "#F59E0B" : "#555"}
          countLabel={`${periodTx.filter((t) => t.type === "expense" && ["צפוי","לא שולם","חלקי"].includes(t.payment_status)).length} פתוחות`}
          delta={compStats ? stats.expensesExpected - compStats.expensesExpected : undefined}
          compLabel={compLabel}
          deltaPositiveIsGood={false}
        />
      </div>

      {/* Row 2: profit */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 28 }}>
        <SummaryCard
          icon="📊" label="רווח בפועל"
          value={fmtAmount(stats.profitReal)}
          color={stats.profitReal >= 0 ? "#10B981" : "#EF4444"}
          countLabel="הכנסות שהתקבלו פחות הוצאות ששולמו"
          delta={compStats ? stats.profitReal - compStats.profitReal : undefined}
          compLabel={compLabel}
          deltaPositiveIsGood={true}
        />
        <SummaryCard
          icon="🔮" label="רווח משוער"
          value={fmtAmount(stats.profitEst)}
          color={stats.profitEst >= 0 ? "#10B981" : "#EF4444"}
          countLabel="כולל הכנסות וההוצאות הצפויות"
          delta={compStats ? stats.profitEst - compStats.profitEst : undefined}
          compLabel={compLabel}
          deltaPositiveIsGood={true}
        />
      </div>

      {/* ── Table filters ────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14,
        alignItems: "center", padding: "12px 16px",
        background: "#1A1A1A", border: "1px solid #252525", borderRadius: 12,
      }}>
        {(["all", "income", "expense"] as const).map((f) => (
          <button key={f} onClick={() => setTypeFilter(f)} style={{
            padding: "5px 12px", borderRadius: 8, border: "none", cursor: "pointer",
            background: typeFilter === f ? (f === "income" ? "rgba(16,185,129,0.15)" : f === "expense" ? "rgba(239,68,68,0.12)" : "rgba(59,130,246,0.12)") : "transparent",
            color: typeFilter === f ? (f === "income" ? "#10B981" : f === "expense" ? "#EF4444" : "#3B82F6") : "#555",
            fontSize: 12, fontWeight: 600, fontFamily: "inherit",
            outline: typeFilter === f ? `1px solid ${f === "income" ? "rgba(16,185,129,0.35)" : f === "expense" ? "rgba(239,68,68,0.3)" : "rgba(59,130,246,0.35)"}` : "none",
          }}>
            {f === "all" ? "הכל" : f === "income" ? "הכנסות" : "הוצאות"}
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: "#2A2A2A", margin: "0 2px" }} />

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{
          background: "transparent", border: `1px solid ${statusFilter ? "#3B82F6" : "#2A2A2A"}`,
          borderRadius: 8, color: statusFilter ? "#3B82F6" : "#555",
          fontSize: 12, padding: "5px 10px", outline: "none", fontFamily: "inherit",
        }}>
          <option value="">כל הסטטוסים</option>
          {allStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={{
          background: "transparent", border: `1px solid ${projectFilter ? "#3B82F6" : "#2A2A2A"}`,
          borderRadius: 8, color: projectFilter ? "#3B82F6" : "#555",
          fontSize: 12, padding: "5px 10px", outline: "none", fontFamily: "inherit",
        }}>
          <option value="">כל הפרויקטים</option>
          {projectsWithTx.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <div style={{ width: 1, height: 20, background: "#2A2A2A", margin: "0 2px" }} />

        {/* Sort */}
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} style={{
          background: "transparent", border: `1px solid ${sortMode !== "date-desc" ? "#A855F7" : "#2A2A2A"}`,
          borderRadius: 8, color: sortMode !== "date-desc" ? "#A855F7" : "#555",
          fontSize: 12, padding: "5px 10px", outline: "none", fontFamily: "inherit",
        }}>
          <option value="date-desc">מהחדש לישן</option>
          <option value="date-asc">מהישן לחדש</option>
          <option value="amount-desc">לפי סכום</option>
          <option value="project">לפי פרויקט</option>
          <option value="status">לפי סטטוס</option>
          <option value="type">לפי סוג</option>
        </select>

        {/* Group by month */}
        <button onClick={() => setGroupByMonth((v) => !v)} style={{
          padding: "5px 10px", borderRadius: 8, border: "none", cursor: "pointer",
          background: groupByMonth ? "rgba(168,85,247,0.12)" : "transparent",
          color: groupByMonth ? "#A855F7" : "#555",
          fontSize: 12, fontWeight: 600, fontFamily: "inherit",
          outline: groupByMonth ? "1px solid rgba(168,85,247,0.3)" : "none",
        }}>
          קיבוץ חודשי
        </button>

        <span style={{ fontSize: 11, color: "#444", marginRight: "auto" }}>{filtered.length} תנועות</span>
      </div>

      {/* ── Transactions table ───────────────────────────────────────────── */}
      {!loaded ? (
        <div style={{ color: "#444", fontSize: 13, padding: "48px", textAlign: "center" }}>טוען...</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 14, padding: "60px", textAlign: "center", color: "#444", fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          {transactions.length === 0 ? "אין תנועות כספיות עדיין" : `אין תנועות ב${periodHeading}`}
          <div style={{ marginTop: 14 }}>
            <button onClick={openAdd} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid rgba(59,130,246,0.35)", background: "rgba(59,130,246,0.08)", color: "#3B82F6", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              + הוסף תנועה
            </button>
          </div>
        </div>
      ) : (
        <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 14, overflow: "hidden" }}>
          {/* Table header */}
          <div style={{ display: "grid", gridTemplateColumns: "90px 50px 2fr 1.5fr 2fr 110px 80px 100px 50px", gap: 8, padding: "10px 16px", background: "#141414", borderBottom: "1px solid #252525", fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.05em" }}>
            <div>תאריך</div><div>סוג</div><div>פרויקט</div><div>אמן / ספק</div>
            <div>תיאור / קטגוריה</div><div>סכום</div><div>סטטוס</div><div>אמצעי תשלום</div><div />
          </div>

          {displayItems.map((item) => {
            if (item.kind === "header") {
              return (
                <div key={`hdr-${item.key}`} style={{
                  padding: "8px 16px 6px", background: "#111",
                  borderBottom: "1px solid #252525",
                  fontSize: 11, fontWeight: 700, color: "#555",
                  letterSpacing: "0.06em",
                }}>
                  {item.label}
                </div>
              );
            }
            const { tx, rowIndex: i } = item;
            const proj     = projects.find((p) => p.id === tx.project_id);
            const isIncome = tx.type === "income";
            const undated  = !tx.date;
            return (
              <div key={tx.id}
                style={{
                  display: "grid", gridTemplateColumns: "90px 50px 2fr 1.5fr 2fr 110px 80px 100px 50px",
                  gap: 8, padding: "10px 16px", alignItems: "center",
                  borderBottom: "1px solid #202020",
                  background: undated ? "#1D1810" : i % 2 === 0 ? "#1A1A1A" : "#181818",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = undated ? "#231E12" : "#1E1E1E")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = undated ? "#1D1810" : i % 2 === 0 ? "#1A1A1A" : "#181818")}
              >
                <div style={{ fontSize: 11, color: undated ? "#F59E0B" : "#666" }}>
                  {undated ? "ללא תאריך" : fmtDate(tx.date)}
                </div>
                <div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, borderRadius: 4, padding: "2px 5px",
                    background: isIncome ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                    color: isIncome ? "#10B981" : "#F59E0B",
                    border: `1px solid ${isIncome ? "rgba(16,185,129,0.25)" : "rgba(245,158,11,0.25)"}`,
                  }}>
                    {isIncome ? "הכנסה" : "הוצאה"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#DDD", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj?.name ?? "—"}</div>
                <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.artist || proj?.artist || "—"}</div>
                <div style={{ fontSize: 11, color: "#777", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.description || tx.category || "—"}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: isIncome ? "#10B981" : "#F59E0B" }}>
                  {isIncome ? "+" : "−"}{fmtAmount(tx.amount, tx.currency)}
                </div>
                <div><StatusBadge status={tx.payment_status} /></div>
                <div style={{ fontSize: 11, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.payment_method || "—"}</div>
                <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                  <button onClick={() => openEdit(tx)} title="ערוך"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 12, padding: "3px 5px" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#AAA")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}>✏</button>
                  <button onClick={() => handleDelete(tx.id)} title="מחק"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 14, padding: "3px 5px" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}>×</button>
                </div>
              </div>
            );
          })}

          {/* Footer totals */}
          <div style={{ display: "flex", gap: 24, padding: "12px 16px", borderTop: "1px solid #252525", background: "#141414", fontSize: 11, color: "#555" }}>
            <span>הכנסות: <strong style={{ color: "#10B981" }}>{fmtAmount(filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0))}</strong></span>
            <span>הוצאות: <strong style={{ color: "#F59E0B" }}>{fmtAmount(filtered.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0))}</strong></span>
            <span style={{ marginRight: "auto" }}>{filtered.length} תנועות מסוננות</span>
          </div>
        </div>
      )}
    </div>
  );
}
