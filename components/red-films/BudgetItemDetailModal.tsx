"use client";

import { useState, useEffect, useRef, useCallback, type DragEvent } from "react";
import { createPortal } from "react-dom";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BudgetItem {
  id: string;
  production_id: string;
  title: string;
  category: string;
  planned_amount: number;
  actual_amount: number;
  vendor_name: string;
  status: string;
  notes: string;
}

export interface BudgetPayment {
  id: string;
  production_id: string;
  budget_item_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  notes: string;
  receipt_file_name: string;
  receipt_mime_type: string;
  receipt_dropbox_path: string;
  receipt_dropbox_url: string;
  created_at: string;
  updated_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYMENT_METHODS = [
  "ביט", "פייבוקס", "העברה בנקאית", "מזומן", "צ׳ק", "כרטיס אשראי", "אחר",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  return `₪${n.toLocaleString("he-IL")}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
}

function computedStatus(paid: number, planned: number, hasPayments: boolean): {
  label: string; color: string; bg: string; border: string;
} {
  if (!hasPayments) return { label: "מתוכנן", color: "#60A5FA", bg: "rgba(96,165,250,0.1)", border: "rgba(96,165,250,0.3)" };
  if (planned > 0 && paid >= planned * 1.01) return { label: "חריגה", color: "#F87171", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)" };
  if (planned > 0 && paid >= planned * 0.99) return { label: "שולם", color: "#22C55E", bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.3)" };
  return { label: "חלקי", color: "#F59E0B", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)" };
}

// ── Style constants ───────────────────────────────────────────────────────────

const INP: React.CSSProperties = {
  background: "#111", border: "1px solid #2A2A2A", borderRadius: 7,
  color: "#E0E0E0", fontSize: 13, padding: "7px 10px",
  fontFamily: "inherit", outline: "none", boxSizing: "border-box", width: "100%",
};

// ── AddPaymentForm ────────────────────────────────────────────────────────────

function AddPaymentForm({
  itemId,
  onSaved,
  onCancel,
}: {
  itemId: string;
  onSaved: (p: BudgetPayment) => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const [amount,        setAmount]        = useState("");
  const [paymentDate,   setPaymentDate]   = useState(today);
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [notes,         setNotes]         = useState("");
  const [receiptFile,   setReceiptFile]   = useState<File | null>(null);
  const [dragging,      setDragging]      = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setReceiptFile(f);
  }

  async function handleSave() {
    if (!amount || Number(amount) <= 0) { setError("נא להזין סכום תקין"); return; }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("amount",         amount);
      fd.append("payment_date",   paymentDate);
      fd.append("payment_method", paymentMethod);
      fd.append("notes",          notes);
      if (receiptFile) fd.append("receipt", receiptFile);

      const res  = await fetch(`/api/red-films/budget-items/${itemId}/payments`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאת שרת");
      onSaved(data.payment);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally { setSaving(false); }
  }

  return (
    <div style={{
      background: "#111", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 12,
      padding: "16px", marginTop: 8,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#60A5FA", marginBottom: 12 }}>
        + תשלום חדש
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        {/* Amount */}
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, marginBottom: 4, letterSpacing: "0.06em" }}>סכום ₪ *</div>
          <input type="number" min={0} placeholder="0" value={amount}
            onChange={e => setAmount(e.target.value)} style={INP} />
        </div>
        {/* Date */}
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, marginBottom: 4, letterSpacing: "0.06em" }}>תאריך</div>
          <input type="date" value={paymentDate}
            onChange={e => setPaymentDate(e.target.value)}
            style={{ ...INP, colorScheme: "dark" }} />
        </div>
        {/* Method */}
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, marginBottom: 4, letterSpacing: "0.06em" }}>אמצעי תשלום</div>
          <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={INP}>
            {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        {/* Notes */}
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, marginBottom: 4, letterSpacing: "0.06em" }}>הערה</div>
          <input value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="מקדמה, סגירת תשלום..." style={INP} />
        </div>
      </div>

      {/* Receipt drag & drop */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `1px dashed ${dragging ? "#60A5FA" : receiptFile ? "rgba(34,197,94,0.4)" : "#2A2A2A"}`,
          borderRadius: 8, padding: "10px 14px", cursor: "pointer", marginBottom: 12,
          background: dragging ? "rgba(59,130,246,0.06)" : receiptFile ? "rgba(34,197,94,0.04)" : "transparent",
          display: "flex", alignItems: "center", gap: 8,
          transition: "all 0.15s",
        }}
      >
        <span style={{ fontSize: 16 }}>{receiptFile ? "📎" : "📂"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {receiptFile ? (
            <>
              <div style={{ fontSize: 12, color: "#22C55E", fontWeight: 600,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {receiptFile.name}
              </div>
              <div style={{ fontSize: 10, color: "#555" }}>
                {(receiptFile.size / 1024).toFixed(0)} KB
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "#444" }}>
              גרור קובץ אסמכתא לכאן, או לחץ לבחירה
            </div>
          )}
        </div>
        {receiptFile && (
          <button
            onClick={e => { e.stopPropagation(); setReceiptFile(null); }}
            style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
          >✕</button>
        )}
        <input ref={fileInputRef} type="file" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) setReceiptFile(f); e.target.value = ""; }}
          accept=".jpg,.jpeg,.png,.webp,.heic,.gif,.pdf,.doc,.docx,.xls,.xlsx"
        />
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "#F87171", marginBottom: 10 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} disabled={saving}
          style={{ padding: "7px 16px", borderRadius: 8, background: "none", border: "1px solid #2A2A2A", color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          ביטול
        </button>
        <button onClick={handleSave} disabled={saving || !amount || Number(amount) <= 0}
          style={{
            padding: "7px 18px", borderRadius: 8, background: "#3B82F6", border: "none",
            color: "#FFF", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            opacity: saving || !amount || Number(amount) <= 0 ? 0.6 : 1,
            minHeight: 36,
          }}>
          {saving ? "שומר..." : "✓ שמור תשלום"}
        </button>
      </div>
    </div>
  );
}

// ── PaymentRow ────────────────────────────────────────────────────────────────

function PaymentRow({
  payment,
  onDelete,
  onReceiptUploaded,
}: {
  payment: BudgetPayment;
  onDelete: (id: string) => void;
  onReceiptUploaded: (p: BudgetPayment) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadReceipt(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("receipt", file);
      const res  = await fetch(`/api/red-films/budget-payments/${payment.id}/receipt`, { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) onReceiptUploaded(data.payment);
    } finally { setUploading(false); }
  }

  async function removeReceipt() {
    const res = await fetch(`/api/red-films/budget-payments/${payment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receipt_file_name: "", receipt_mime_type: "",
        receipt_dropbox_path: "", receipt_dropbox_url: "",
      }),
    });
    const data = await res.json();
    if (res.ok) onReceiptUploaded(data.payment);
  }

  async function del() {
    if (!confirm("למחוק תשלום זה?")) return;
    await fetch(`/api/red-films/budget-payments/${payment.id}`, { method: "DELETE" });
    onDelete(payment.id);
  }

  const hasReceipt = !!payment.receipt_dropbox_url;

  return (
    <div style={{
      background: "#111", border: "1px solid #1E1E1E", borderRadius: 10,
      padding: "10px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {/* Main info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#22C55E" }}>
              {fmtMoney(payment.amount)}
            </span>
            <span style={{ fontSize: 11, color: "#888" }}>{fmtDate(payment.payment_date)}</span>
            {payment.payment_method && (
              <span style={{
                fontSize: 10, color: "#60A5FA",
                background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)",
                borderRadius: 5, padding: "1px 7px",
              }}>
                {payment.payment_method}
              </span>
            )}
          </div>
          {payment.notes && (
            <div style={{ fontSize: 11, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {payment.notes}
            </div>
          )}
          {/* Receipt area */}
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {hasReceipt ? (
              <>
                <span style={{ fontSize: 11, color: "#888" }}>📎</span>
                <span style={{ fontSize: 11, color: "#666",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  maxWidth: 160,
                }}>
                  {payment.receipt_file_name || "אסמכתא"}
                </span>
                <a href={payment.receipt_dropbox_url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 10, color: "#60A5FA", textDecoration: "none",
                    border: "1px solid rgba(96,165,250,0.25)", borderRadius: 5, padding: "1px 7px" }}>
                  פתח
                </a>
                <button onClick={removeReceipt}
                  style={{ fontSize: 10, color: "#555", background: "none", border: "1px solid #2A2A2A",
                    borderRadius: 5, padding: "1px 7px", cursor: "pointer", fontFamily: "inherit" }}>
                  הסר
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  style={{ fontSize: 10, color: "#888", background: "none", border: "1px solid #2A2A2A",
                    borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit",
                    opacity: uploading ? 0.6 : 1, minHeight: 24 }}
                >
                  {uploading ? "מעלה..." : "📎 צרף אסמכתא"}
                </button>
                <input ref={fileRef} type="file" style={{ display: "none" }}
                  accept=".jpg,.jpeg,.png,.webp,.heic,.gif,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadReceipt(f); e.target.value = ""; }}
                />
              </>
            )}
          </div>
        </div>

        {/* Delete */}
        <button onClick={del}
          style={{ background: "none", border: "none", color: "#3A3A3A", cursor: "pointer",
            fontSize: 14, padding: "2px 4px", lineHeight: 1, flexShrink: 0, minHeight: 32, minWidth: 32,
            display: "flex", alignItems: "center", justifyContent: "center" }}>
          🗑
        </button>
      </div>
    </div>
  );
}

// ── BudgetItemDetailModal ─────────────────────────────────────────────────────

interface Props {
  item: BudgetItem;
  initialPayments?: BudgetPayment[];
  onClose: () => void;
  onPaymentAdded: (p: BudgetPayment) => void;
  onPaymentDeleted: (paymentId: string) => void;
  onPaymentUpdated: (p: BudgetPayment) => void;
}

export default function BudgetItemDetailModal({
  item,
  initialPayments = [],
  onClose,
  onPaymentAdded,
  onPaymentDeleted,
  onPaymentUpdated,
}: Props) {
  const [payments, setPayments] = useState<BudgetPayment[]>(initialPayments);
  const [loading,  setLoading]  = useState(initialPayments.length === 0);
  const [showForm, setShowForm] = useState(false);

  // ESC to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Lazy-load payments if not provided
  const load = useCallback(async () => {
    if (initialPayments.length > 0) { setLoading(false); return; }
    setLoading(true);
    try {
      const res  = await fetch(`/api/red-films/budget-items/${item.id}/payments`);
      const data = await res.json();
      setPayments(data.payments ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [item.id, initialPayments.length]);

  useEffect(() => { load(); }, [load]);

  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const balance   = item.planned_amount - totalPaid;
  const status    = computedStatus(totalPaid, item.planned_amount, payments.length > 0);

  function handleAdded(p: BudgetPayment) {
    setPayments(prev => [...prev, p].sort((a, b) => a.payment_date.localeCompare(b.payment_date)));
    setShowForm(false);
    onPaymentAdded(p);
  }

  function handleDeleted(id: string) {
    setPayments(prev => prev.filter(p => p.id !== id));
    onPaymentDeleted(id);
  }

  function handleUpdated(p: BudgetPayment) {
    setPayments(prev => prev.map(x => x.id === p.id ? p : x));
    onPaymentUpdated(p);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9800,
        background: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#141414", border: "1px solid #262626",
          borderRadius: "22px 22px 0 0",
          width: "100%", maxWidth: 640,
          margin: "0 auto",
          maxHeight: "92dvh",
          display: "flex", flexDirection: "column",
          direction: "rtl",
          boxShadow: "0 -16px 60px rgba(0,0,0,0.8)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: "18px 20px 14px",
          paddingTop: "max(18px, env(safe-area-inset-top))",
          borderBottom: "1px solid #222", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#F0F0F0", marginBottom: 4 }}>
                {item.title}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {item.category && (
                  <span style={{ fontSize: 11, color: "#888", background: "#1A1A1A",
                    border: "1px solid #2A2A2A", borderRadius: 5, padding: "2px 8px" }}>
                    {item.category}
                  </span>
                )}
                {item.vendor_name && (
                  <span style={{ fontSize: 11, color: "#666" }}>• {item.vendor_name}</span>
                )}
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  color: status.color, background: status.bg,
                  border: `1px solid ${status.border}`, borderRadius: 5, padding: "2px 8px",
                }}>
                  {status.label}
                </span>
              </div>
            </div>
            <button onClick={onClose}
              style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #2A2A2A",
                background: "#1A1A1A", color: "#666", fontSize: 18, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              ×
            </button>
          </div>
        </div>

        {/* Summary strip */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
          gap: 1, borderBottom: "1px solid #1E1E1E", flexShrink: 0,
        }}>
          {[
            { label: "מתוכנן",   value: item.planned_amount ? fmtMoney(item.planned_amount) : "—", color: "#888" },
            { label: "שולם",     value: fmtMoney(totalPaid),  color: "#22C55E" },
            { label: "יתרה",     value: balance > 0 ? fmtMoney(balance) : balance < 0 ? `חריגה ${fmtMoney(Math.abs(balance))}` : "✓ אפס", color: balance <= 0 ? "#22C55E" : "#F59E0B" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ padding: "12px 16px", textAlign: "center", background: "#0D0D0D" }}>
              <div style={{ fontSize: 10, color: "#444", marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Scrollable payments list */}
        <div style={{
          overflowY: "auto", flex: 1,
          padding: "14px 18px",
          paddingBottom: `calc(16px + env(safe-area-inset-bottom))`,
        }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "#444", fontSize: 13, padding: "24px 0" }}>טוען תשלומים...</div>
          ) : payments.length === 0 && !showForm ? (
            <div style={{ textAlign: "center", color: "#333", fontSize: 13, padding: "24px 0", fontStyle: "italic" }}>
              אין תשלומים עדיין
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {payments.map(p => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  onDelete={handleDeleted}
                  onReceiptUploaded={handleUpdated}
                />
              ))}
            </div>
          )}

          {/* Add payment */}
          {showForm ? (
            <AddPaymentForm
              itemId={item.id}
              onSaved={handleAdded}
              onCancel={() => setShowForm(false)}
            />
          ) : (
            <button
              onClick={() => setShowForm(true)}
              style={{
                width: "100%", padding: "10px 0",
                background: "rgba(59,130,246,0.08)",
                border: "1px dashed rgba(59,130,246,0.3)",
                borderRadius: 10, color: "#60A5FA",
                fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
                minHeight: 44,
              }}
            >
              + הוסף תשלום
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
