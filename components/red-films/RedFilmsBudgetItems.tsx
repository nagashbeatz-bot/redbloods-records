"use client";

import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import BudgetItemDetailModal, { type BudgetPayment } from "./BudgetItemDetailModal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BudgetItem {
  id: string;
  production_id: string;
  title: string;
  category: string;
  planned_amount: number;
  actual_amount: number;
  vendor_name: string;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  productionId: string;
  generalBudget: number;
  onBudgetUpdate: (newBudget: number) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "צלם", "ציוד", "לוקיישן", "תלבושות / סטיילינג", "פוסט פרודקשן",
  "שחקנים / מודלים", "קייטרינג", "הובלה / לוגיסטיקה", "שיווק", "אחר",
];

const ITEM_STATUSES = ["מתוכנן", "שולם", "בוטל"];

// ── Style helpers ─────────────────────────────────────────────────────────────

const INPUT_S: CSSProperties = {
  background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6,
  color: "#E8E8E8", fontSize: 13, padding: "6px 10px", outline: "none",
  fontFamily: "inherit", height: 32, boxSizing: "border-box", width: "100%",
};

const SELECT_S: CSSProperties = { ...INPUT_S, cursor: "pointer" };

function fmtMoney(n: number) {
  return `₪${n.toLocaleString("he-IL")}`;
}

// ── Budget Gauge ──────────────────────────────────────────────────────────────

function BudgetGauge({
  generalBudget, plannedTotal, paidTotal,
  onEditBudget, onRaiseBudget,
}: {
  generalBudget: number;
  plannedTotal: number;
  paidTotal: number;
  onEditBudget: () => void;
  onRaiseBudget: () => void;
}) {
  if (generalBudget === 0) {
    return (
      <div style={{
        background: "#141414", border: "1px solid #252525", borderRadius: 12,
        padding: "16px 18px", marginBottom: 16,
      }}>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>מד ניצול תקציב</div>
        <div style={{ fontSize: 13, color: "#888", fontStyle: "italic", marginBottom: 10 }}>
          לא הוגדר תקציב כללי
        </div>
        <button
          onClick={onEditBudget}
          style={{
            fontSize: 12, color: "#60A5FA", background: "none",
            border: "1px solid rgba(96,165,250,0.3)", borderRadius: 6,
            cursor: "pointer", fontFamily: "inherit", padding: "4px 12px",
          }}
        >
          ✏ הגדר תקציב כללי בסקשן התקציב
        </button>
      </div>
    );
  }

  const usagePercent = (plannedTotal / generalBudget) * 100;
  const remaining = generalBudget - plannedTotal;
  const isOverrun = usagePercent > 100;
  const isWarning = usagePercent >= 80 && usagePercent <= 100;

  const barColor = isOverrun ? "#EF4444" : isWarning ? "#F59E0B" : "#22C55E";
  const barWidth = Math.min(usagePercent, 100);

  const statusLabel = isOverrun
    ? "חריגה מהתקציב"
    : isWarning
    ? "קרוב לחריגה"
    : "בתוך התקציב";

  const statusColor = isOverrun ? "#EF4444" : isWarning ? "#F59E0B" : "#22C55E";

  return (
    <div style={{
      background: "#141414", border: `1px solid ${isOverrun ? "rgba(239,68,68,0.3)" : "#252525"}`,
      borderRadius: 12, padding: "16px 18px", marginBottom: 16,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: "#666" }}>מד ניצול תקציב</div>
        <div style={{
          fontSize: 11, fontWeight: 700, color: statusColor,
          background: `${statusColor}18`, border: `1px solid ${statusColor}40`,
          borderRadius: 6, padding: "2px 8px",
        }}>
          {statusLabel}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 10, background: "#222", borderRadius: 99, overflow: "hidden", marginBottom: 12,
      }}>
        <div style={{
          height: "100%", width: `${barWidth}%`,
          background: barColor,
          borderRadius: 99, transition: "width 0.3s ease",
        }} />
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        {[
          ["תקציב",    fmtMoney(generalBudget),  "#888"],
          ["מתוכנן",   fmtMoney(plannedTotal),   isOverrun ? "#EF4444" : "#E8E8E8"],
          ["שולם",     fmtMoney(paidTotal),       "#22C55E"],
          ["נשאר",     remaining >= 0 ? fmtMoney(remaining) : `−${fmtMoney(Math.abs(remaining))}`,
                       remaining >= 0 ? "#22C55E" : "#EF4444"],
        ].map(([lbl, val, col]) => (
          <div key={lbl} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>{lbl}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: col as string }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Overrun alert */}
      {isOverrun && (
        <div style={{
          marginTop: 12, padding: "10px 14px",
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ fontSize: 12, color: "#F87171" }}>
            ⚠ חריגה מהתקציב: ההוצאות המתוכננות גבוהות ב-{fmtMoney(plannedTotal - generalBudget)} מהתקציב הכללי
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={onRaiseBudget}
              style={{
                fontSize: 11, fontWeight: 700, color: "#FFF",
                background: "#EF4444", border: "none", borderRadius: 6,
                cursor: "pointer", fontFamily: "inherit", padding: "4px 12px",
              }}
            >
              העלה תקציב
            </button>
          </div>
        </div>
      )}

      {/* Usage percent label */}
      <div style={{ marginTop: 8, fontSize: 11, color: "#444", textAlign: "left" }}>
        {Math.round(usagePercent)}% מהתקציב נוצל (מתוכנן)
      </div>
    </div>
  );
}

// ── Item row ──────────────────────────────────────────────────────────────────

function ItemRow({
  item, itemPaid, onSave, onDelete, onOpenDetail, onDuplicate, menuOpen, onMenuToggle, onMenuClose,
}: {
  item: BudgetItem;
  itemPaid: number;
  onSave: (id: string, fields: Partial<BudgetItem>) => Promise<void>;
  onDelete: (id: string) => void;
  onOpenDetail: () => void;
  onDuplicate: () => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(item);
  const [saving, setSaving]   = useState(false);

  useEffect(() => { setDraft(item); }, [item]);

  async function handleSave() {
    setSaving(true);
    await onSave(item.id, {
      title: draft.title, category: draft.category,
      planned_amount: Number(draft.planned_amount) || 0,
      vendor_name: draft.vendor_name,
      status: draft.status, notes: draft.notes,
    });
    setSaving(false);
    setEditing(false);
  }

  const isCancelled = item.status === "בוטל";
  const isPaid = item.status === "שולם";

  if (editing) {
    return (
      <tr style={{ background: "#1A1A1A" }}>
        <td style={{ padding: "8px 10px" }}>
          <input style={{ ...INPUT_S, width: "100%" }} value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
        </td>
        <td style={{ padding: "8px 10px" }}>
          <select style={{ ...SELECT_S, width: "100%" }} value={draft.category}
            onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </td>
        <td style={{ padding: "8px 10px" }}>
          <input type="number" style={{ ...INPUT_S, width: "100%" }}
            value={draft.planned_amount}
            onChange={e => setDraft(d => ({ ...d, planned_amount: +e.target.value }))} />
        </td>
        {/* שולם — read-only in edit mode (comes from payments) */}
        <td style={{ padding: "8px 10px", fontSize: 12, color: "#555", fontStyle: "italic" }}>
          {fmtMoney(itemPaid)}
        </td>
        <td style={{ padding: "8px 10px" }}>
          <select style={{ ...SELECT_S, width: "100%" }} value={draft.status}
            onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}>
            {ITEM_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </td>
        <td style={{ padding: "8px 10px" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleSave} disabled={saving}
              style={{ fontSize: 11, color: "#FFF", background: "#3B82F6", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "4px 10px", fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
              {saving ? "..." : "✓"}
            </button>
            <button onClick={() => { setEditing(false); setDraft(item); }}
              style={{ fontSize: 11, color: "#888", background: "none", border: "1px solid #333", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "4px 8px" }}>
              ✕
            </button>
          </div>
        </td>
      </tr>
    );
  }

  const statusColor = isCancelled ? "#555" : isPaid ? "#22C55E" : "#60A5FA";
  const statusBg    = isCancelled ? "#1A1A1A" : isPaid ? "rgba(34,197,94,0.1)" : "rgba(96,165,250,0.1)";
  const statusBorder= isCancelled ? "#2A2A2A" : isPaid ? "rgba(34,197,94,0.3)" : "rgba(96,165,250,0.3)";

  return (
    <tr style={{ opacity: isCancelled ? 0.45 : 1, borderBottom: "1px solid #1E1E1E" }}>
      <td style={{ padding: "9px 10px", fontSize: 13, color: isCancelled ? "#555" : "#CCC", textDecoration: isCancelled ? "line-through" : "none" }}>
        {item.title || "—"}
      </td>
      <td style={{ padding: "9px 10px", fontSize: 12, color: "#666" }}>
        {item.category || "—"}
      </td>
      <td style={{ padding: "9px 10px", fontSize: 13, color: "#E8E8E8", fontWeight: 700, textAlign: "left" }}>
        {item.planned_amount ? fmtMoney(item.planned_amount) : "—"}
      </td>
      {/* שולם — from payments */}
      <td style={{ padding: "9px 10px", fontSize: 13, color: "#22C55E", fontWeight: 700, textAlign: "left" }}>
        {itemPaid > 0 ? fmtMoney(itemPaid) : "—"}
      </td>
      <td style={{ padding: "9px 10px" }}>
        <span style={{
          fontSize: 11, fontWeight: 700,
          color: statusColor, background: statusBg, border: `1px solid ${statusBorder}`,
          borderRadius: 6, padding: "2px 8px",
        }}>
          {item.status}
        </span>
      </td>
      <td style={{ padding: "9px 10px" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {/* Quick "שולם" button or paid badge */}
          {!isCancelled && !isPaid && (
            <button
              onClick={() => onSave(item.id, { status: "שולם" })}
              style={{ fontSize: 11, fontWeight: 700, color: "#22C55E", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "3px 10px", whiteSpace: "nowrap" }}>
              שולם
            </button>
          )}
          {isPaid && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#22C55E", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap" }}>
              שולם ✓
            </span>
          )}
          {/* Three-dots menu */}
          <div style={{ position: "relative" }}>
            <button
              onClick={(e) => { e.stopPropagation(); onMenuToggle(); }}
              style={{ fontSize: 15, color: "#555", background: "none", border: "1px solid #2A2A2A", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "1px 8px", lineHeight: 1.2 }}>
              ⋯
            </button>
            {menuOpen && (
              <div style={{ position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 200, background: "#1C1C1C", border: "1px solid #2E2E2E", borderRadius: 10, minWidth: 140, boxShadow: "0 4px 20px rgba(0,0,0,0.6)", overflow: "hidden" }}>
                {[
                  { label: "✏ ערוך",       action: () => { setEditing(true); onMenuClose(); } },
                  { label: "📋 שכפל",       action: () => { onDuplicate(); onMenuClose(); } },
                  { label: "💳 תשלומים",    action: () => { onOpenDetail(); onMenuClose(); } },
                  ...(isPaid ? [{ label: "↩ בטל תשלום", action: () => { onSave(item.id, { status: "מתוכנן" }); onMenuClose(); }, red: false }] : []),
                  { label: "🗑 מחק",        action: () => { onDelete(item.id); onMenuClose(); }, red: true },
                ].map((opt) => (
                  <button key={opt.label} onClick={opt.action}
                    style={{ display: "block", width: "100%", padding: "9px 14px", textAlign: "right", background: "transparent", border: "none", borderBottom: "1px solid #252525", color: opt.red ? "#EF4444" : "#CCC", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#252525"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Add item form ─────────────────────────────────────────────────────────────

function AddItemForm({ onAdd }: { onAdd: (fields: Partial<BudgetItem>) => Promise<void> }) {
  const [open, setOpen]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft]   = useState({
    title: "", category: CATEGORIES[0], planned_amount: 0, actual_amount: 0,
    vendor_name: "", status: "מתוכנן", notes: "",
  });

  async function handleAdd() {
    if (!draft.title.trim()) return;
    setSaving(true);
    await onAdd(draft);
    setSaving(false);
    setOpen(false);
    setDraft({ title: "", category: CATEGORIES[0], planned_amount: 0, actual_amount: 0, vendor_name: "", status: "מתוכנן", notes: "" });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          fontSize: 12, color: "#60A5FA", background: "none",
          border: "1px dashed rgba(96,165,250,0.3)", borderRadius: 8,
          cursor: "pointer", fontFamily: "inherit", padding: "8px 16px",
          width: "100%", marginTop: 10,
        }}
      >
        + הוסף פריט תקציב
      </button>
    );
  }

  return (
    <div style={{
      marginTop: 10, background: "#1A1A1A", border: "1px solid #2A2A2A",
      borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 12, fontWeight: 700 }}>פריט חדש</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>שם הפריט *</div>
          <input style={INPUT_S} value={draft.title} placeholder="צלם, ציוד, לוקיישן..."
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>קטגוריה</div>
          <select style={SELECT_S} value={draft.category}
            onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>מתוכנן ₪</div>
          <input type="number" style={INPUT_S} value={draft.planned_amount || ""}
            placeholder="0"
            onChange={e => setDraft(d => ({ ...d, planned_amount: +e.target.value }))} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={() => setOpen(false)}
          style={{ fontSize: 12, color: "#888", background: "none", border: "1px solid #333", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "6px 14px" }}>
          ביטול
        </button>
        <button onClick={handleAdd} disabled={saving || !draft.title.trim()}
          style={{ fontSize: 12, color: "#FFF", background: "#3B82F6", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "6px 16px", fontWeight: 700, opacity: saving || !draft.title.trim() ? 0.6 : 1 }}>
          {saving ? "מוסיף..." : "הוסף"}
        </button>
      </div>
    </div>
  );
}

// ── Raise Budget Modal ────────────────────────────────────────────────────────

function RaiseBudgetModal({
  currentBudget, plannedTotal, onConfirm, onCancel, saving,
}: {
  currentBudget: number;
  plannedTotal: number;
  onConfirm: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return createPortal(
    <div
      onClick={() => { if (!saving) onCancel(); }}
      style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 16, padding: "28px 24px", width: "min(420px, 90vw)" }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800, color: "#F0F0F0", margin: "0 0 12px" }}>
          העלאת תקציב כללי
        </h2>
        <p style={{ fontSize: 13, color: "#888", lineHeight: 1.8, margin: "0 0 24px" }}>
          התקציב הנוכחי הוא <strong style={{ color: "#CCC" }}>{fmtMoney(currentBudget)}</strong>, וההוצאות המתוכננות הן <strong style={{ color: "#CCC" }}>{fmtMoney(plannedTotal)}</strong>.<br />
          להעלות את התקציב הכללי ל-<strong style={{ color: "#22C55E" }}>{fmtMoney(plannedTotal)}</strong>?
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} disabled={saving}
            style={{ padding: "8px 18px", borderRadius: 8, background: "none", border: "1px solid #333", color: "#888", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
            ביטול
          </button>
          <button onClick={onConfirm} disabled={saving}
            style={{ padding: "8px 20px", borderRadius: 8, background: "#22C55E", border: "none", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: saving ? 0.7 : 1 }}>
            {saving ? "מעדכן..." : "כן, העלה תקציב"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RedFilmsBudgetItems({ productionId, generalBudget, onBudgetUpdate }: Props) {
  const [items, setItems]             = useState<BudgetItem[]>([]);
  const [payments, setPayments]       = useState<BudgetPayment[]>([]);
  const [loading, setLoading]         = useState(true);
  const [raiseModal, setRaiseModal]   = useState(false);
  const [raiseSaving, setRaiseSaving] = useState(false);
  const [openItemId, setOpenItemId]   = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId]   = useState<string | null>(null);
  const [isMobile, setIsMobile]       = useState(false);

  // Close three-dots menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const close = () => setMenuOpenId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpenId]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, paymentsRes] = await Promise.all([
        fetch(`/api/red-films/productions/${productionId}/budget-items`),
        fetch(`/api/red-films/productions/${productionId}/budget-payments`),
      ]);
      const itemsData    = await itemsRes.json();
      const paymentsData = await paymentsRes.json();
      setItems(itemsData.items ?? []);
      setPayments(paymentsData.payments ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [productionId]);

  useEffect(() => { load(); }, [load]);

  // Totals — exclude cancelled items
  const active        = items.filter(i => i.status !== "בוטל");
  const plannedTotal  = active.reduce((s, i) => s + (i.planned_amount || 0), 0);

  // Payments — map itemId → sum of payment amounts
  const paidByItem = payments.reduce((map, p) => {
    map.set(p.budget_item_id, (map.get(p.budget_item_id) ?? 0) + p.amount);
    return map;
  }, new Map<string, number>());
  const paidTotal = active.reduce((s, i) => s + (paidByItem.get(i.id) ?? 0), 0);

  // Payments for the currently-open detail modal
  const openItemPayments = openItemId
    ? payments.filter(p => p.budget_item_id === openItemId)
    : [];

  async function handleAdd(fields: Partial<BudgetItem>) {
    const res  = await fetch(`/api/red-films/productions/${productionId}/budget-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    if (data.item) setItems(prev => [...prev, data.item]);
  }

  async function handleSave(id: string, fields: Partial<BudgetItem>) {
    const res  = await fetch(`/api/red-films/budget-items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    if (data.item) setItems(prev => prev.map(i => i.id === id ? data.item : i));
  }

  async function handleDelete(id: string) {
    if (!confirm("למחוק את הפריט?")) return;
    await fetch(`/api/red-films/budget-items/${id}`, { method: "DELETE" });
    setItems(prev => prev.filter(i => i.id !== id));
  }

  async function handleDuplicate(item: BudgetItem) {
    const res = await fetch(`/api/red-films/productions/${productionId}/budget-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title, category: item.category,
        planned_amount: item.planned_amount, actual_amount: 0,
        vendor_name: item.vendor_name, status: "מתוכנן", notes: item.notes,
      }),
    });
    const data = await res.json();
    if (data.item) setItems(prev => [...prev, data.item]);
  }

  function handlePaymentAdded(p: BudgetPayment) {
    setPayments(prev => [...prev, p]);
  }
  function handlePaymentDeleted(id: string) {
    setPayments(prev => prev.filter(p => p.id !== id));
  }
  function handlePaymentUpdated(p: BudgetPayment) {
    setPayments(prev => prev.map(x => x.id === p.id ? p : x));
  }

  async function handleRaiseBudget() {
    setRaiseSaving(true);
    try {
      const res = await fetch(`/api/red-films/productions/${productionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ general_budget: plannedTotal }),
      });
      const data = await res.json();
      if (data.production) onBudgetUpdate(data.production.general_budget);
    } catch { /* silent */ }
    setRaiseSaving(false);
    setRaiseModal(false);
  }

  return (
    <div>
      {/* Budget gauge */}
      <BudgetGauge
        generalBudget={generalBudget}
        plannedTotal={plannedTotal}
        paidTotal={paidTotal}
        onEditBudget={() => {/* parent section handles this */}}
        onRaiseBudget={() => setRaiseModal(true)}
      />

      {/* Items */}
      {loading ? (
        <div style={{ fontSize: 12, color: "#444", padding: "12px 0" }}>טוען פריטים...</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 13, color: "#3A3A3A", fontStyle: "italic", padding: "8px 0" }}>
          אין פריטי תקציב עדיין
        </div>
      ) : isMobile ? (
        /* ── Mobile: cards ─────────────────────────────────────── */
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map(item => {
            const itemPaid = paidByItem.get(item.id) ?? 0;
            const isCancelled = item.status === "בוטל";
            return (
              <div key={item.id} style={{
                background: "#1A1A1A", border: "1px solid #252525", borderRadius: 12,
                padding: "12px 14px", opacity: isCancelled ? 0.5 : 1,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#CCC",
                    textDecoration: isCancelled ? "line-through" : "none" }}>
                    {item.title || "—"}
                  </span>
                  <span style={{ fontSize: 11, color: "#555" }}>{item.category}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "#444", marginBottom: 2 }}>מתוכנן</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#E8E8E8" }}>{item.planned_amount ? fmtMoney(item.planned_amount) : "—"}</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "#444", marginBottom: 2 }}>שולם</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#22C55E" }}>{itemPaid > 0 ? fmtMoney(itemPaid) : "—"}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setOpenItemId(item.id)}
                    style={{ flex: 1, padding: "8px 0", borderRadius: 8, minHeight: 36,
                      background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)",
                      color: "#60A5FA", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {itemPaid > 0 ? `💳 פירוט (${payments.filter(p => p.budget_item_id === item.id).length})` : "+ תשלום"}
                  </button>
                  <button onClick={() => handleDelete(item.id)}
                    style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #2A2A2A",
                      background: "none", color: "#555", cursor: "pointer", fontSize: 14, flexShrink: 0 }}>
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
          {/* Mobile totals */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "10px 0 4px" }}>
            <div style={{ textAlign: "center", background: "#141414", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "#555" }}>סה״כ מתוכנן</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#E8E8E8" }}>{fmtMoney(plannedTotal)}</div>
            </div>
            <div style={{ textAlign: "center", background: "#141414", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "#555" }}>סה״כ שולם</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#22C55E" }}>{fmtMoney(paidTotal)}</div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Desktop: table ────────────────────────────────────── */
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #252525" }}>
                {["שם", "קטגוריה", "מתוכנן", "שולם", "סטטוס", ""].map(h => (
                  <th key={h} style={{ padding: "6px 10px", fontSize: 10, color: "#555", fontWeight: 700, textAlign: "right" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  itemPaid={paidByItem.get(item.id) ?? 0}
                  onSave={handleSave}
                  onDelete={handleDelete}
                  onOpenDetail={() => setOpenItemId(item.id)}
                  onDuplicate={() => handleDuplicate(item)}
                  menuOpen={menuOpenId === item.id}
                  onMenuToggle={() => setMenuOpenId(prev => prev === item.id ? null : item.id)}
                  onMenuClose={() => setMenuOpenId(null)}
                />
              ))}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: "1px solid #252525" }}>
                  <td colSpan={2} style={{ padding: "8px 10px", fontSize: 11, color: "#555", fontWeight: 700 }}>
                    סה״כ (ללא מבוטלים)
                  </td>
                  <td style={{ padding: "8px 10px", fontSize: 13, fontWeight: 800, color: "#E8E8E8", textAlign: "left" }}>
                    {fmtMoney(plannedTotal)}
                  </td>
                  <td style={{ padding: "8px 10px", fontSize: 13, fontWeight: 800, color: "#22C55E", textAlign: "left" }}>
                    {fmtMoney(paidTotal)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <AddItemForm onAdd={handleAdd} />

      {/* Raise budget modal */}
      {raiseModal && typeof window !== "undefined" && (
        <RaiseBudgetModal
          currentBudget={generalBudget}
          plannedTotal={plannedTotal}
          onConfirm={handleRaiseBudget}
          onCancel={() => setRaiseModal(false)}
          saving={raiseSaving}
        />
      )}

      {/* Budget item detail modal */}
      {openItemId && (() => {
        const item = items.find(i => i.id === openItemId);
        if (!item) return null;
        return (
          <BudgetItemDetailModal
            item={item}
            initialPayments={openItemPayments}
            onClose={() => setOpenItemId(null)}
            onPaymentAdded={handlePaymentAdded}
            onPaymentDeleted={handlePaymentDeleted}
            onPaymentUpdated={handlePaymentUpdated}
          />
        );
      })()}
    </div>
  );
}
