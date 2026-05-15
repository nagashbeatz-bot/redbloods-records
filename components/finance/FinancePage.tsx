"use client";

import { useState, useEffect, useCallback } from "react";
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
  financialNotes: string;
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

function fmtAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${currency}`;
}

// ── Summary Card ──────────────────────────────────────────────────────────────
function SummaryCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{
      background: "#1C1C1C", border: "1px solid #252525", borderRadius: 14,
      padding: "16px 18px", flex: "1 1 160px", minWidth: 130,
    }}>
      <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

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

// ── Inline form ───────────────────────────────────────────────────────────────
const INPUT_S: React.CSSProperties = {
  background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6,
  color: "#E8E8E8", fontSize: 12, padding: "5px 9px", outline: "none",
  fontFamily: "inherit", height: 30, boxSizing: "border-box",
};

function TxForm({
  draft, setDraft, saving, onSave, onCancel, projects,
}: {
  draft: TxDraft;
  setDraft: (d: TxDraft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  projects: { id: string; name: string; artist: string }[];
}) {
  const isIncome = draft.type === "income";
  return (
    <div style={{
      background: "#181818", border: "1px solid #2A2A2A", borderRadius: 12,
      padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
      marginBottom: 14,
    }}>
      {/* Type toggle */}
      <div style={{ display: "flex", gap: 6 }}>
        {(["income", "expense"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setDraft({ ...draft, type: t })}
            style={{
              padding: "4px 14px", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 12, fontFamily: "inherit", fontWeight: 600,
              background: draft.type === t
                ? (t === "income" ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.15)")
                : "transparent",
              color: draft.type === t
                ? (t === "income" ? "#10B981" : "#EF4444")
                : "#555",
              outline: draft.type === t
                ? `1px solid ${t === "income" ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.3)"}`
                : "none",
            }}
          >
            {t === "income" ? "הכנסה" : "הוצאה"}
          </button>
        ))}
      </div>

      {/* Project + Date row */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select
          value={draft.projectId}
          onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}
          style={{ ...INPUT_S, flex: "2 1 180px" }}
        >
          <option value="">בחר פרויקט...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name} — {p.artist}</option>
          ))}
        </select>
        <input
          type="date"
          value={draft.date}
          onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          style={{ ...INPUT_S, flex: "1 1 130px", colorScheme: "dark" }}
        />
      </div>

      {/* Description */}
      <input
        type="text"
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        placeholder={isIncome ? "תיאור (למשל: תשלום ראשון)" : "תיאור הוצאה"}
        style={{ ...INPUT_S, width: "100%", boxSizing: "border-box" }}
      />

      {/* Amount + Currency + Status row */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="number"
          value={draft.amount}
          onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          placeholder="סכום"
          min={0}
          style={{ ...INPUT_S, flex: "2 1 120px" }}
        />
        <select
          value={draft.currency}
          onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
          style={{ ...INPUT_S, flex: "0 0 60px" }}
        >
          {["₪", "$", "€"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {isIncome && (
          <select
            value={draft.paymentStatus}
            onChange={(e) => setDraft({ ...draft, paymentStatus: e.target.value as PaymentStatus })}
            style={{ ...INPUT_S, flex: "1 1 100px" }}
          >
            {PAYMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {!isIncome && (
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            style={{ ...INPUT_S, flex: "1 1 130px" }}
          >
            <option value="">קטגוריה...</option>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Notes */}
      <input
        type="text"
        value={draft.notes}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        placeholder="הערות (אופציונלי)"
        style={{ ...INPUT_S, width: "100%", boxSizing: "border-box" }}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
      />

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            flex: 1, padding: "6px 0", borderRadius: 8, border: "none",
            background: "#3B82F6", color: "#fff", fontSize: 12,
            cursor: saving ? "wait" : "pointer", fontFamily: "inherit", fontWeight: 600,
          }}
        >
          {saving ? "שומר..." : "שמור"}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "6px 18px", borderRadius: 8,
            border: "1px solid #2A2A2A", background: "transparent",
            color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          ביטול
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FinancePage() {
  const { projects } = useProjects();
  const [transactions,  setTransactions]  = useState<Transaction[]>([]);
  const [settings,      setSettings]      = useState<FinanceSetting[]>([]);
  const [loaded,        setLoaded]        = useState(false);
  const [typeFilter,    setTypeFilter]    = useState<"all" | "income" | "expense">("all");
  const [statusFilter,  setStatusFilter]  = useState<PaymentStatus | "">("");
  const [projectFilter, setProjectFilter] = useState("");
  const [showForm,      setShowForm]      = useState(false);
  const [draft,         setDraft]         = useState<TxDraft>(emptyDraft());
  const [saving,        setSaving]        = useState(false);
  const [editingId,     setEditingId]     = useState<string | null>(null);
  const [editDraft,     setEditDraft]     = useState<TxDraft>(emptyDraft());
  const [editSaving,    setEditSaving]    = useState(false);

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
  const income    = transactions.filter((t) => t.type === "income");
  const expenses  = transactions.filter((t) => t.type === "expense");
  const totalPaid = income.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const totalExpected = income.filter((t) => t.payment_status !== "בוטל").reduce((s, t) => s + t.amount, 0);
  const totalBalance  = income.filter((t) => ["צפוי", "לא שולם", "חלקי"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const totalExpenses = expenses.reduce((s, t) => s + t.amount, 0);
  const profit        = totalPaid - totalExpenses;

  // ── Filters ──────────────────────────────────────────────────────────────
  const filtered = transactions.filter((t) => {
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (statusFilter && t.payment_status !== statusFilter) return false;
    if (projectFilter && t.project_id !== projectFilter) return false;
    return true;
  });

  const projectsWithTx = projects.filter((p) => transactions.some((t) => t.project_id === p.id));

  // ── CRUD ─────────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!draft.projectId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });
      const data = await res.json();
      if (data.transaction) {
        setTransactions((prev) => [data.transaction, ...prev]);
        setShowForm(false);
        setDraft(emptyDraft());
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!editingId) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/transactions/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type:          editDraft.type,
          date:          editDraft.date || null,
          description:   editDraft.description,
          artist:        editDraft.artist,
          amount:        Number(editDraft.amount) || 0,
          currency:      editDraft.currency,
          paymentStatus: editDraft.paymentStatus,
          notes:         editDraft.notes,
          category:      editDraft.category,
        }),
      });
      const data = await res.json();
      if (data.transaction) {
        setTransactions((prev) => prev.map((t) => t.id === editingId ? data.transaction : t));
        setEditingId(null);
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setTransactions((prev) => prev.filter((t) => t.id !== id)); // optimistic
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
  }

  function startEdit(tx: Transaction) {
    setEditingId(tx.id);
    setEditDraft({
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
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#E8E8E8", margin: 0 }}>כספים</h1>
          <p style={{ fontSize: 12, color: "#555", margin: "4px 0 0" }}>מעקב הכנסות והוצאות</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setDraft(emptyDraft()); }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 10,
            border: "1px solid rgba(59,130,246,0.35)",
            background: "rgba(59,130,246,0.08)",
            color: "#3B82F6", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
          הוסף עסקה
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <SummaryCard label="הכנסות שולמו"   value={fmtAmount(totalPaid, "₪")}      color="#10B981" />
        <SummaryCard label="הכנסות צפויות"  value={fmtAmount(totalExpected, "₪")}  color="#3B82F6" />
        <SummaryCard label="יתרות פתוחות"   value={fmtAmount(totalBalance, "₪")}   color={totalBalance > 0 ? "#EF4444" : "#555"} />
        <SummaryCard label="הוצאות"          value={fmtAmount(totalExpenses, "₪")} color="#F59E0B" />
        <SummaryCard label="רווח משוער"      value={fmtAmount(profit, "₪")}         color={profit >= 0 ? "#10B981" : "#EF4444"} />
      </div>

      {/* Inline add form */}
      {showForm && (
        <TxForm
          draft={draft}
          setDraft={setDraft}
          saving={saving}
          onSave={handleAdd}
          onCancel={() => setShowForm(false)}
          projects={projects}
        />
      )}

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "center" }}>
        {/* Type filter */}
        {(["all", "income", "expense"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setTypeFilter(f)}
            style={{
              padding: "5px 12px", borderRadius: 8,
              border: `1px solid ${typeFilter === f ? "rgba(59,130,246,0.4)" : "#252525"}`,
              background: typeFilter === f ? "rgba(59,130,246,0.1)" : "#1A1A1A",
              color: typeFilter === f ? "#3B82F6" : "#555",
              fontSize: 12, fontWeight: 500, cursor: "pointer",
            }}
          >
            {f === "all" ? "הכל" : f === "income" ? "הכנסות" : "הוצאות"}
          </button>
        ))}

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PaymentStatus | "")}
          style={{
            background: "#1A1A1A", border: `1px solid ${statusFilter ? "rgba(59,130,246,0.4)" : "#252525"}`,
            borderRadius: 8, color: statusFilter ? "#3B82F6" : "#555",
            fontSize: 12, padding: "5px 10px", outline: "none",
          }}
        >
          <option value="">כל הסטטוסים</option>
          {PAYMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Project filter */}
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          style={{
            background: "#1A1A1A", border: `1px solid ${projectFilter ? "rgba(59,130,246,0.4)" : "#252525"}`,
            borderRadius: 8, color: projectFilter ? "#3B82F6" : "#555",
            fontSize: 12, padding: "5px 10px", outline: "none",
          }}
        >
          <option value="">כל הפרויקטים</option>
          {projectsWithTx.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Result count */}
        <span style={{ fontSize: 11, color: "#444", marginRight: "auto" }}>
          {filtered.length} עסקאות
        </span>
      </div>

      {/* Transactions table */}
      {!loaded ? (
        <div style={{ color: "#444", fontSize: 13, padding: "24px", textAlign: "center" }}>טוען...</div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: "#1A1A1A", border: "1px solid #252525", borderRadius: 14,
          padding: "40px", textAlign: "center", color: "#444", fontSize: 13,
        }}>
          אין עסקאות
        </div>
      ) : (
        <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 14, overflow: "hidden" }}>
          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "100px 2fr 1.5fr 2fr 1fr 80px 80px 60px",
            gap: 8, padding: "10px 16px",
            background: "#141414", borderBottom: "1px solid #252525",
            fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.05em",
          }}>
            <div>תאריך</div>
            <div>פרויקט</div>
            <div>אמן / ספק</div>
            <div>תיאור</div>
            <div>סכום</div>
            <div>סטטוס</div>
            <div>סוג</div>
            <div />
          </div>

          {/* Rows */}
          {filtered.map((tx, i) => {
            const proj = projects.find((p) => p.id === tx.project_id);
            const isEditing = editingId === tx.id;

            if (isEditing) {
              return (
                <div key={tx.id} style={{ padding: "12px 16px", borderBottom: i < filtered.length - 1 ? "1px solid #222" : "none", background: "#1C1C1C" }}>
                  <TxForm
                    draft={editDraft}
                    setDraft={setEditDraft}
                    saving={editSaving}
                    onSave={handleUpdate}
                    onCancel={() => setEditingId(null)}
                    projects={projects}
                  />
                </div>
              );
            }

            return (
              <div
                key={tx.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 2fr 1.5fr 2fr 1fr 80px 80px 60px",
                  gap: 8, padding: "11px 16px", alignItems: "center",
                  borderBottom: i < filtered.length - 1 ? "1px solid #202020" : "none",
                  background: i % 2 === 0 ? "#1A1A1A" : "#181818",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "#1E1E1E")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = i % 2 === 0 ? "#1A1A1A" : "#181818")}
              >
                <div style={{ fontSize: 11, color: "#666" }}>{fmtDate(tx.date)}</div>
                <div style={{ fontSize: 12, color: "#DDD", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {proj?.name ?? tx.project_id.slice(0, 8)}
                </div>
                <div style={{ fontSize: 11, color: "#777", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tx.artist || proj?.artist || "—"}
                </div>
                <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tx.description || (tx.category || "—")}
                </div>
                <div style={{
                  fontSize: 13, fontWeight: 700,
                  color: tx.type === "income" ? "#10B981" : "#F59E0B",
                }}>
                  {tx.type === "expense" ? "−" : "+"}{fmtAmount(tx.amount, tx.currency)}
                </div>
                <div>
                  {tx.type === "income" ? <StatusBadge status={tx.payment_status} /> : (
                    <span style={{ fontSize: 10, color: "#F59E0B", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 5, padding: "1px 7px" }}>
                      הוצאה
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "#555" }}>
                  {tx.category || (tx.type === "income" ? tx.payment_method || "" : "")}
                </div>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => startEdit(tx)}
                    title="ערוך"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 12, padding: "2px 4px" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#AAA")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}
                  >✏</button>
                  <button
                    onClick={() => handleDelete(tx.id)}
                    title="מחק"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 14, padding: "2px 4px" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}
                  >×</button>
                </div>
              </div>
            );
          })}

          {/* Footer totals */}
          <div style={{
            display: "flex", gap: 20, padding: "12px 16px",
            borderTop: "1px solid #252525", background: "#141414",
            fontSize: 11, color: "#666",
          }}>
            <span>
              הכנסות (מסונן):{" "}
              <strong style={{ color: "#10B981" }}>
                {fmtAmount(filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0), "₪")}
              </strong>
            </span>
            <span>
              הוצאות (מסונן):{" "}
              <strong style={{ color: "#F59E0B" }}>
                {fmtAmount(filtered.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0), "₪")}
              </strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
