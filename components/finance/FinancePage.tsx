"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useProjects } from "@/components/ProjectsProvider";

// ── Types ─────────────────────────────────────────────────────────────────────
type PaymentStatus = "שולם" | "צפוי" | "לא שולם" | "חלקי" | "בוטל";

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
const PAYMENT_STATUS_OPTIONS: PaymentStatus[] = ["שולם", "צפוי", "לא שולם", "חלקי", "בוטל"];
const EXPENSE_CATEGORIES = ["מיקס/מאסטר", "צילום", "עריכת וידאו", "גרפיקה", "הפצה", "שיווק", "ציוד", "אחר"];

const STATUS_COLOR: Record<PaymentStatus, string> = {
  "שולם":    "#10B981",
  "צפוי":    "#3B82F6",
  "לא שולם": "#EF4444",
  "חלקי":    "#F59E0B",
  "בוטל":    "#6B7280",
};

function emptyDraft(projectId = ""): TxDraft {
  return {
    projectId, type: "income", date: "", description: "", artist: "",
    amount: "", currency: "₪", paymentStatus: "צפוי",
    paymentMethod: "", receiptRef: "", notes: "", category: "",
  };
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

function fmtAmount(amount: number, currency = "₪"): string {
  return `${amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${currency}`;
}

function isThisMonth(date: string | null): boolean {
  if (!date) return false;
  const now = new Date();
  const d = new Date(date);
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

// ── Input style ───────────────────────────────────────────────────────────────
const INPUT_S: React.CSSProperties = {
  background: "#1A1A1A", border: "1px solid #333", borderRadius: 8,
  color: "#E8E8E8", fontSize: 13, padding: "8px 12px", outline: "none",
  fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};

const LABEL_S: React.CSSProperties = {
  fontSize: 11, color: "#555", marginBottom: 5, display: "block", textAlign: "right",
};

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: PaymentStatus }) {
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
function SummaryCard({ label, value, color, sub, icon }: {
  label: string; value: string; color: string; sub?: string; icon?: string;
}) {
  return (
    <div style={{
      background: "#1C1C1C", border: "1px solid #252525", borderRadius: 14,
      padding: "16px 18px", flex: "1 1 160px", minWidth: 140,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
        <div style={{ fontSize: 11, color: "#555" }}>{label}</div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>{sub}</div>}
    </div>
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
  const isIncome = draft.type === "income";

  // Close on ESC
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onCancel]);

  const modal = (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 99999,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#141414", border: "1px solid #2A2A2A",
          borderRadius: 18, padding: "24px 24px 20px",
          width: 460, maxWidth: "95vw", direction: "rtl",
          boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>✕</button>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#E8E8E8", margin: 0 }}>{title}</h2>
        </div>

        {/* Type toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {(["income", "expense"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setDraft({ ...draft, type: t })}
              style={{
                flex: 1, padding: "8px", borderRadius: 10, border: "none", cursor: "pointer",
                fontSize: 13, fontFamily: "inherit", fontWeight: 600,
                background: draft.type === t
                  ? (t === "income" ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.15)")
                  : "#1A1A1A",
                color: draft.type === t
                  ? (t === "income" ? "#10B981" : "#EF4444")
                  : "#555",
                outline: draft.type === t
                  ? `1px solid ${t === "income" ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.3)"}`
                  : "1px solid #252525",
              }}
            >
              {t === "income" ? "💰 הכנסה" : "💸 הוצאה"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Project */}
          <div>
            <label style={LABEL_S}>פרויקט *</label>
            <select
              value={draft.projectId}
              onChange={(e) => {
                const proj = projects.find((p) => p.id === e.target.value);
                setDraft({ ...draft, projectId: e.target.value, artist: proj?.artist ?? draft.artist });
              }}
              style={{ ...INPUT_S }}
            >
              <option value="">בחר פרויקט...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.artist}</option>
              ))}
            </select>
          </div>

          {/* Artist / Client / Vendor */}
          <div>
            <label style={LABEL_S}>{isIncome ? "לקוח / אמן" : "ספק"}</label>
            <input type="text" value={draft.artist} onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
              placeholder={isIncome ? "שם הלקוח..." : "שם הספק..."}
              style={INPUT_S} />
          </div>

          {/* Description */}
          <div>
            <label style={LABEL_S}>תיאור</label>
            <input type="text" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder={isIncome ? "למשל: תשלום ראשון, תשלום סופי..." : "למשל: מיקס, עריכת וידאו..."}
              style={INPUT_S} />
          </div>

          {/* Amount + Currency row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 10 }}>
            <div>
              <label style={LABEL_S}>סכום *</label>
              <input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                placeholder="0" min={0} style={INPUT_S} />
            </div>
            <div>
              <label style={LABEL_S}>מטבע</label>
              <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} style={INPUT_S}>
                {["₪", "$", "€"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Date + Status/Category row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={LABEL_S}>תאריך</label>
              <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                style={{ ...INPUT_S, colorScheme: "dark" }} />
            </div>
            <div>
              {isIncome ? (
                <>
                  <label style={LABEL_S}>סטטוס</label>
                  <select value={draft.paymentStatus} onChange={(e) => setDraft({ ...draft, paymentStatus: e.target.value as PaymentStatus })} style={INPUT_S}>
                    {PAYMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </>
              ) : (
                <>
                  <label style={LABEL_S}>קטגוריה</label>
                  <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} style={INPUT_S}>
                    <option value="">בחר...</option>
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </>
              )}
            </div>
          </div>

          {/* Payment method */}
          <div>
            <label style={LABEL_S}>אמצעי תשלום</label>
            <input type="text" value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })}
              placeholder="מזומן, העברה, ביט..." style={INPUT_S} />
          </div>

          {/* Receipt ref */}
          <div>
            <label style={LABEL_S}>אסמכתא</label>
            <input type="text" value={draft.receiptRef} onChange={(e) => setDraft({ ...draft, receiptRef: e.target.value })}
              placeholder="מספר חשבונית / קבלה..." style={INPUT_S} />
          </div>

          {/* Notes */}
          <div>
            <label style={LABEL_S}>הערות</label>
            <input type="text" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="הערות נוספות..." style={INPUT_S}
              onKeyDown={(e) => { if (e.key === "Enter") onSave(); }} />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={onCancel} style={{
              flex: 1, padding: "10px", borderRadius: 10,
              border: "1px solid #2A2A2A", background: "transparent",
              color: "#777", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
            }}>ביטול</button>
            <button onClick={onSave} disabled={saving || !draft.projectId} style={{
              flex: 2, padding: "10px", borderRadius: 10, border: "none",
              background: saving || !draft.projectId ? "#1A2A3A" : "#1E40AF",
              color: saving || !draft.projectId ? "#445" : "#fff",
              cursor: saving || !draft.projectId ? "not-allowed" : "pointer",
              fontSize: 13, fontWeight: 700, fontFamily: "inherit",
            }}>
              {saving ? "שומר..." : "שמור תנועה"}
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
  const [transactions,  setTransactions]  = useState<Transaction[]>([]);
  const [settings,      setSettings]      = useState<FinanceSetting[]>([]);
  const [loaded,        setLoaded]        = useState(false);

  // Filters
  const [typeFilter,    setTypeFilter]    = useState<"all" | "income" | "expense">("all");
  const [statusFilter,  setStatusFilter]  = useState<PaymentStatus | "">("");
  const [projectFilter, setProjectFilter] = useState("");
  const [monthFilter,   setMonthFilter]   = useState(false);

  // Modal
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [draft,      setDraft]      = useState<TxDraft>(emptyDraft());
  const [saving,     setSaving]     = useState(false);

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

  // ── Computed totals ──────────────────────────────────────────────────────
  const income       = transactions.filter((t) => t.type === "income");
  const expenses     = transactions.filter((t) => t.type === "expense");
  const totalReceived = income.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const totalOpen    = income.filter((t) => ["צפוי", "לא שולם", "חלקי"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const totalExpPaid = expenses.filter((t) => t.payment_status === "שולם" || t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const profit       = totalReceived - totalExpPaid;

  // ── Filters ──────────────────────────────────────────────────────────────
  const filtered = transactions.filter((t) => {
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (statusFilter && t.payment_status !== statusFilter) return false;
    if (projectFilter && t.project_id !== projectFilter) return false;
    if (monthFilter && !isThisMonth(t.date)) return false;
    return true;
  });

  const projectsWithTx = projects.filter((p) => transactions.some((t) => t.project_id === p.id));

  // ── CRUD ─────────────────────────────────────────────────────────────────
  function openAdd() {
    setEditingId(null);
    setDraft(emptyDraft());
    setModalOpen(true);
  }

  function openEdit(tx: Transaction) {
    setEditingId(tx.id);
    setDraft({
      projectId:     tx.project_id,
      type:          tx.type,
      date:          tx.date ?? "",
      description:   tx.description,
      artist:        tx.artist,
      amount:        String(tx.amount),
      currency:      tx.currency,
      paymentStatus: tx.payment_status,
      paymentMethod: tx.payment_method,
      receiptRef:    tx.receipt_ref,
      notes:         tx.notes,
      category:      tx.category,
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!draft.projectId) return;
    setSaving(true);
    try {
      const body = {
        projectId:     draft.projectId,
        type:          draft.type,
        date:          draft.date || null,
        description:   draft.description,
        artist:        draft.artist,
        amount:        Number(draft.amount) || 0,
        currency:      draft.currency,
        paymentStatus: draft.paymentStatus,
        paymentMethod: draft.paymentMethod,
        receiptRef:    draft.receiptRef,
        notes:         draft.notes,
        category:      draft.category,
      };

      if (editingId) {
        const res = await fetch(`/api/transactions/${editingId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.transaction) setTransactions((prev) => prev.map((t) => t.id === editingId ? data.transaction : t));
      } else {
        const res = await fetch("/api/transactions", {
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" style={{ padding: "28px 32px", maxWidth: 1200, margin: "0 auto" }}>

      {/* Modal */}
      {modalOpen && (
        <TxModal
          draft={draft}
          setDraft={setDraft}
          saving={saving}
          onSave={handleSave}
          onCancel={() => { setModalOpen(false); setEditingId(null); }}
          projects={projects}
          title={editingId ? "עריכת תנועה" : "תנועה חדשה"}
        />
      )}

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#E8E8E8", margin: 0 }}>כספים</h1>
          <p style={{ fontSize: 12, color: "#555", margin: "4px 0 0" }}>מעקב הכנסות והוצאות</p>
        </div>
        <button
          onClick={openAdd}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "10px 20px", borderRadius: 12,
            border: "1px solid rgba(59,130,246,0.4)",
            background: "rgba(59,130,246,0.1)",
            color: "#3B82F6", fontSize: 14, fontWeight: 700, cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.background = "rgba(59,130,246,0.2)";
            el.style.borderColor = "rgba(59,130,246,0.6)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.background = "rgba(59,130,246,0.1)";
            el.style.borderColor = "rgba(59,130,246,0.4)";
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
          הוסף תנועה
        </button>
      </div>

      {/* Summary cards — business logic order */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 28 }}>
        <SummaryCard
          icon="✅" label="הכנסות שהתקבלו"
          value={fmtAmount(totalReceived)}
          color="#10B981"
          sub={`${income.filter((t) => t.payment_status === "שולם").length} תשלומים`}
        />
        <SummaryCard
          icon="⏳" label="יתרות / חובות פתוחים"
          value={fmtAmount(totalOpen)}
          color={totalOpen > 0 ? "#EF4444" : "#555"}
          sub={`${income.filter((t) => ["צפוי","לא שולם","חלקי"].includes(t.payment_status)).length} פתוחים`}
        />
        <SummaryCard
          icon="💸" label="הוצאות"
          value={fmtAmount(totalExpPaid)}
          color="#F59E0B"
          sub={`${expenses.length} תנועות`}
        />
        <SummaryCard
          icon="📈" label="רווח משוער"
          value={fmtAmount(profit)}
          color={profit >= 0 ? "#10B981" : "#EF4444"}
          sub="הכנסות שהתקבלו פחות הוצאות"
        />
      </div>

      {/* Filters bar */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14,
        alignItems: "center", padding: "12px 16px",
        background: "#1A1A1A", border: "1px solid #252525", borderRadius: 12,
      }}>
        {/* Type */}
        <div style={{ display: "flex", gap: 4 }}>
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
        </div>

        <div style={{ width: 1, height: 20, background: "#2A2A2A", margin: "0 2px" }} />

        {/* Status */}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PaymentStatus | "")} style={{
          background: "transparent", border: `1px solid ${statusFilter ? "#3B82F6" : "#2A2A2A"}`,
          borderRadius: 8, color: statusFilter ? "#3B82F6" : "#555",
          fontSize: 12, padding: "5px 10px", outline: "none", fontFamily: "inherit",
        }}>
          <option value="">כל הסטטוסים</option>
          {PAYMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Project */}
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={{
          background: "transparent", border: `1px solid ${projectFilter ? "#3B82F6" : "#2A2A2A"}`,
          borderRadius: 8, color: projectFilter ? "#3B82F6" : "#555",
          fontSize: 12, padding: "5px 10px", outline: "none", fontFamily: "inherit",
        }}>
          <option value="">כל הפרויקטים</option>
          {projectsWithTx.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Month toggle */}
        <button onClick={() => setMonthFilter((v) => !v)} style={{
          padding: "5px 12px", borderRadius: 8, border: "none", cursor: "pointer",
          background: monthFilter ? "rgba(168,85,247,0.12)" : "transparent",
          color: monthFilter ? "#A855F7" : "#555",
          fontSize: 12, fontWeight: 600, fontFamily: "inherit",
          outline: monthFilter ? "1px solid rgba(168,85,247,0.3)" : "none",
        }}>
          החודש בלבד
        </button>

        {/* Count */}
        <span style={{ fontSize: 11, color: "#444", marginRight: "auto" }}>
          {filtered.length} תנועות
        </span>
      </div>

      {/* Transactions table */}
      {!loaded ? (
        <div style={{ color: "#444", fontSize: 13, padding: "48px", textAlign: "center" }}>טוען...</div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: "#1A1A1A", border: "1px solid #252525", borderRadius: 14,
          padding: "60px", textAlign: "center", color: "#444", fontSize: 13,
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          אין תנועות כספיות עדיין
          <div style={{ marginTop: 14 }}>
            <button onClick={openAdd} style={{
              padding: "8px 18px", borderRadius: 10, border: "1px solid rgba(59,130,246,0.35)",
              background: "rgba(59,130,246,0.08)", color: "#3B82F6",
              fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>+ הוסף תנועה ראשונה</button>
          </div>
        </div>
      ) : (
        <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 14, overflow: "hidden" }}>
          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "90px 50px 2fr 1.5fr 2fr 110px 80px 100px 50px",
            gap: 8, padding: "10px 16px",
            background: "#141414", borderBottom: "1px solid #252525",
            fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.05em",
          }}>
            <div>תאריך</div>
            <div>סוג</div>
            <div>פרויקט</div>
            <div>אמן / ספק</div>
            <div>תיאור</div>
            <div>סכום</div>
            <div>סטטוס</div>
            <div>אמצעי תשלום</div>
            <div />
          </div>

          {filtered.map((tx, i) => {
            const proj = projects.find((p) => p.id === tx.project_id);
            const isIncome = tx.type === "income";
            return (
              <div
                key={tx.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "90px 50px 2fr 1.5fr 2fr 110px 80px 100px 50px",
                  gap: 8, padding: "10px 16px", alignItems: "center",
                  borderBottom: i < filtered.length - 1 ? "1px solid #202020" : "none",
                  background: i % 2 === 0 ? "#1A1A1A" : "#181818",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "#1E1E1E")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = i % 2 === 0 ? "#1A1A1A" : "#181818")}
              >
                <div style={{ fontSize: 11, color: "#666" }}>{fmtDate(tx.date)}</div>
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
                <div style={{ fontSize: 12, color: "#DDD", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {proj?.name ?? "—"}
                </div>
                <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tx.artist || proj?.artist || "—"}
                </div>
                <div style={{ fontSize: 11, color: "#777", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tx.description || tx.category || "—"}
                </div>
                <div style={{
                  fontSize: 13, fontWeight: 700,
                  color: isIncome ? "#10B981" : "#F59E0B",
                }}>
                  {isIncome ? "+" : "−"}{fmtAmount(tx.amount, tx.currency)}
                </div>
                <div>
                  {isIncome
                    ? <StatusBadge status={tx.payment_status} />
                    : <span style={{ fontSize: 10, color: "#777" }}>{tx.category || "—"}</span>
                  }
                </div>
                <div style={{ fontSize: 11, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tx.payment_method || "—"}
                </div>
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

          {/* Footer */}
          <div style={{
            display: "flex", gap: 24, padding: "12px 16px",
            borderTop: "1px solid #252525", background: "#141414",
            fontSize: 11, color: "#555",
          }}>
            <span>הכנסות: <strong style={{ color: "#10B981" }}>{fmtAmount(filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0))}</strong></span>
            <span>הוצאות: <strong style={{ color: "#F59E0B" }}>{fmtAmount(filtered.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0))}</strong></span>
            <span style={{ marginRight: "auto" }}>{filtered.length} תנועות מסוננות</span>
          </div>
        </div>
      )}
    </div>
  );
}
