"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import QuickTxModal from "@/components/finance/QuickTxModal";

interface Transaction {
  id: string;
  type: "income" | "expense";
  amount: number;
  description: string;
  date: string;
  payment_status: string;
  category?: string;
}

interface TxData {
  transactions: Transaction[];
  agreedPrice: number;
  currency: string;
  financialNotes: string;
}

interface Props {
  project: Project;
  accentColor: string;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  return `${parts[2]}.${parts[1]}.${parts[0].slice(2)}`;
}

function statusBadge(status: string, type: "income" | "expense"): React.CSSProperties {
  if (status === "שולם" || status === "התקבל")
    return { background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" };
  if (status === "צפוי")
    return { background: "rgba(245,158,11,0.12)", color: "#F59E0B", border: "1px solid rgba(245,158,11,0.3)" };
  if (status === "בוטל")
    return { background: "rgba(239,68,68,0.10)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.3)" };
  if (status === "חלקי")
    return { background: "rgba(99,102,241,0.12)", color: "#818CF8", border: "1px solid rgba(99,102,241,0.3)" };
  return { background: "rgba(100,100,100,0.12)", color: "#666", border: "1px solid #333" };
}

export default function AlbumFinanceTab({ project, accentColor }: Props) {
  const [txData,          setTxData]          = useState<TxData | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [showAddTx,       setShowAddTx]       = useState<"income" | "expense" | null>(null);
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [savingStatus,    setSavingStatus]    = useState(false);
  const [deletingId,      setDeletingId]      = useState<string | null>(null);

  const INCOME_STATUSES = ["צפוי", "התקבל", "חלקי", "בוטל", "לבדיקה"];
  const EXPENSE_STATUSES = ["שולם", "צפוי", "לא שולם", "חלקי", "בוטל"];

  const handleDeleteTx = async (txId: string) => {
    await fetch(`/api/transactions/${txId}`, { method: "DELETE" });
    setDeletingId(null);
    load();
  };

  const handleStatusChange = async (txId: string, newStatus: string) => {
    setSavingStatus(true);
    try {
      await fetch(`/api/transactions/${txId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStatus: newStatus }),
      });
      setEditingStatusId(null);
      load();
    } finally {
      setSavingStatus(false);
    }
  };

  const load = () => {
    setLoading(true);
    fetch(`/api/transactions?projectId=${project.id}`)
      .then((r) => r.json())
      .then((data: TxData) => setTxData(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [project.id]);

  const agreedPrice  = txData?.agreedPrice ?? 0;
  const currency     = txData?.currency ?? "₪";
  const transactions = txData?.transactions ?? [];
  const fmt = (n: number) => `${currency}${n.toLocaleString("he-IL")}`;

  const received = transactions
    .filter((t) => t.type === "income" && ["שולם", "התקבל"].includes(t.payment_status))
    .reduce((s, t) => s + t.amount, 0);

  const expected = transactions
    .filter((t) => t.type === "income" && t.payment_status === "צפוי")
    .reduce((s, t) => s + t.amount, 0);

  const expenses = transactions
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);

  const balance = agreedPrice - received;

  const incomes  = transactions.filter((t) => t.type === "income");
  const expenseList = transactions.filter((t) => t.type === "expense");

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 13 }}>
        טוען כספים...
      </div>
    );
  }

  const cardStyle: React.CSSProperties = {
    background: "#1A1A1A",
    border: "1px solid #252525",
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 16,
  };

  const cardHead: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 18px",
    borderBottom: "1px solid #1E1E1E",
  };

  const addBtn = (label: string, type: "income" | "expense"): React.CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    borderRadius: 8,
    padding: "4px 12px",
    border: type === "income" ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(239,68,68,0.3)",
    background: type === "income" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
    color: type === "income" ? "#22c55e" : "#EF4444",
  });

  const TxRow = ({ t }: { t: Transaction }) => {
    const isEditingThis = editingStatusId === t.id;
    const isConfirmingDelete = deletingId === t.id;
    const statuses = t.type === "income" ? INCOME_STATUSES : EXPENSE_STATUSES;

    if (isConfirmingDelete) {
      return (
        <div style={{ padding: "10px 18px", borderBottom: "1px solid #141414", background: "rgba(239,68,68,0.06)", direction: "rtl" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#E0E0E0", marginBottom: 3 }}>למחוק את התשלום הזה?</div>
          <div style={{ fontSize: 10, color: "#666", marginBottom: 10 }}>הפעולה תסיר את התשלום מהפרויקט ולא ניתן יהיה לשחזרו.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => handleDeleteTx(t.id)}
              style={{ fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", borderRadius: 7, padding: "4px 14px", border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.12)", color: "#EF4444" }}
            >מחק תשלום</button>
            <button
              onClick={() => setDeletingId(null)}
              style={{ fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 7, padding: "4px 14px", border: "1px solid #333", background: "none", color: "#666" }}
            >ביטול</button>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 18px",
          borderBottom: "1px solid #141414",
        }}
      >
        <span style={{ fontSize: 11, color: "#555", flexShrink: 0, minWidth: 50 }}>{formatDate(t.date)}</span>
        <span style={{ fontSize: 12, color: "#888", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t.description || "—"}
        </span>
        {t.category && (
          <span style={{ fontSize: 10, color: "#555", flexShrink: 0 }}>{t.category}</span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {isEditingThis ? (
            <select
              autoFocus
              disabled={savingStatus}
              defaultValue={t.payment_status}
              onChange={(e) => handleStatusChange(t.id, e.target.value)}
              onBlur={() => setEditingStatusId(null)}
              style={{ fontSize: 10, fontFamily: "inherit", background: "#1E1E1E", color: "#ccc", border: "1px solid #444", borderRadius: 5, padding: "2px 4px", cursor: "pointer", direction: "rtl" }}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            <>
              <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 5, ...statusBadge(t.payment_status, t.type) }}>
                {t.payment_status}
              </span>
              <button
                onClick={() => setEditingStatusId(t.id)}
                style={{ fontSize: 9, background: "none", border: "none", color: "#444", cursor: "pointer", padding: "1px 3px", fontFamily: "inherit", lineHeight: 1 }}
                title="שנה סטטוס"
              >✎</button>
              <button
                onClick={() => setDeletingId(t.id)}
                style={{ fontSize: 11, background: "none", border: "none", color: "#3A3A3A", cursor: "pointer", padding: "1px 3px", fontFamily: "inherit", lineHeight: 1 }}
                title="מחק תשלום"
                onMouseEnter={(e) => (e.currentTarget.style.color = "#EF4444")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#3A3A3A")}
              >🗑</button>
            </>
          )}
        </div>
        <span style={{ fontSize: 13, color: t.type === "income" ? "#22c55e" : "#EF4444", fontWeight: 700, flexShrink: 0, minWidth: 70, textAlign: "left" }}>
          {t.type === "income" ? "+" : "-"}{currency}{t.amount.toLocaleString("he-IL")}
        </span>
      </div>
    );
  };

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "24px 28px",
        boxSizing: "border-box",
        direction: "rtl",
      }}
    >
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "סוכם",   value: fmt(agreedPrice), color: "#E0E0E0" },
          { label: "התקבל",  value: fmt(received),    color: "#22c55e" },
          { label: "צפוי",   value: fmt(expected),    color: "#F59E0B" },
          { label: "הוצאות", value: fmt(expenses),    color: "#EF4444" },
          { label: "יתרה",   value: fmt(balance),     color: balance >= 0 ? "#22c55e" : "#EF4444" },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: "#1A1A1A",
              border: "1px solid #252525",
              borderRadius: 12,
              padding: "14px 16px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Income */}
      <div style={cardStyle}>
        <div style={cardHead}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", display: "flex", alignItems: "center", gap: 6 }}>
            💚 הכנסות ({incomes.length})
          </div>
          <button style={addBtn("+ הוסף הכנסה", "income")} onClick={() => setShowAddTx("income")}>
            + הוסף הכנסה
          </button>
        </div>
        {incomes.length === 0 ? (
          <div style={{ padding: "16px 18px", color: "#333", fontSize: 12 }}>אין הכנסות מתועדות</div>
        ) : (
          incomes.map((t) => <TxRow key={t.id} t={t} />)
        )}
      </div>

      {/* Expenses */}
      <div style={{ ...cardStyle, marginBottom: 0 }}>
        <div style={cardHead}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", display: "flex", alignItems: "center", gap: 6 }}>
            🔴 הוצאות ({expenseList.length})
          </div>
          <button style={addBtn("+ הוסף הוצאה", "expense")} onClick={() => setShowAddTx("expense")}>
            + הוסף הוצאה
          </button>
        </div>
        {expenseList.length === 0 ? (
          <div style={{ padding: "16px 18px", color: "#333", fontSize: 12 }}>אין הוצאות מתועדות</div>
        ) : (
          expenseList.map((t) => <TxRow key={t.id} t={t} />)
        )}
      </div>

      {/* QuickTxModal */}
      {showAddTx && (
        <QuickTxModal
          projectId={project.id}
          projectName={project.name}
          artist={project.artist}
          initialType={showAddTx}
          onClose={() => {
            setShowAddTx(null);
            load(); // refresh after adding
          }}
        />
      )}
    </div>
  );
}
