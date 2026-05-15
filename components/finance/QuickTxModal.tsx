"use client";

/**
 * QuickTxModal — lightweight transaction form pre-filled for a specific project.
 * Used from ActionMenu (⚡) in ProjectsTable.
 * After save: dispatches "rb-finance-updated" so ProjectsTable refreshes the badge.
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

type PaymentStatus = "שולם" | "צפוי" | "לא שולם" | "חלקי" | "בוטל" | "התקבל" | "לבדיקה";

interface QuickTxDraft {
  type: "income" | "expense";
  date: string;
  description: string;
  artist: string;
  amount: string;
  currency: string;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  category: string;
  notes: string;
}

const EXPENSE_CATEGORIES = ["מיקס / מאסטר", "חדר חזרות", "צילום", "נסיעות", "אחר"];
const INCOME_TYPES       = ["מקדמה", "תשלום חלקי", "תשלום סופי", "תשלום מלא", "תוספת / חריגה", "אחר"];
const INCOME_STATUSES:  PaymentStatus[] = ["צפוי", "התקבל", "חלקי", "בוטל", "לבדיקה"];
const EXPENSE_STATUSES: PaymentStatus[] = ["שולם", "צפוי", "לא שולם", "חלקי", "בוטל"];
const PAYMENT_METHODS    = ["ביט", "העברה בנקאית", "מזומן", "PayPal", "Payoneer", "אשראי", "אחר"];

const INPUT_S: React.CSSProperties = {
  background: "#1A1A1A", border: "1px solid #2E2E2E", borderRadius: 8,
  color: "#E8E8E8", fontSize: 13, padding: "8px 12px", outline: "none",
  fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};

const LABEL_S: React.CSSProperties = {
  fontSize: 11, color: "#555", marginBottom: 5, display: "block", textAlign: "right",
};

function emptyDraft(type: "income" | "expense", artist: string): QuickTxDraft {
  return {
    type,
    date: new Date().toISOString().split("T")[0],
    description: "",
    artist: type === "income" ? artist : "",
    amount: "",
    currency: "₪",
    paymentStatus: type === "income" ? "צפוי" : "שולם",
    paymentMethod: "",
    category: "",
    notes: "",
  };
}

interface Props {
  projectId:   string;
  projectName: string;
  artist:      string;
  initialType: "income" | "expense";
  onClose:     () => void;
}

export default function QuickTxModal({ projectId, projectName, artist, initialType, onClose }: Props) {
  const [draft,  setDraft]  = useState<QuickTxDraft>(() => emptyDraft(initialType, artist));
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const isIncome    = draft.type === "income";
  const categoryList = isIncome ? INCOME_TYPES : EXPENSE_CATEGORIES;
  const statusList   = isIncome ? INCOME_STATUSES : EXPENSE_STATUSES;
  const isOther      = draft.category === "אחר";

  // Switch type
  const switchType = (t: "income" | "expense") => {
    setDraft(emptyDraft(t, artist));
  };

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const canSave = !!draft.amount && Number(draft.amount) > 0 && !(isOther && !draft.description);

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          type:          draft.type,
          date:          draft.date || null,
          description:   draft.description,
          artist:        draft.artist,
          amount:        Number(draft.amount) || 0,
          currency:      draft.currency,
          paymentStatus: draft.paymentStatus,
          paymentMethod: draft.paymentMethod,
          receiptRef:    "",
          notes:         draft.notes,
          category:      draft.category,
        }),
      });
      if (!res.ok) throw new Error("שגיאה בשמירה");
      // Notify ProjectsTable to refresh finance badges
      document.dispatchEvent(new CustomEvent("rb-finance-updated"));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 99999,
        background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#141414", border: "1px solid #2A2A2A",
          borderRadius: 18, padding: "20px 22px 18px",
          width: 440, maxWidth: "95vw", direction: "rtl",
          boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>✕</button>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#E8E8E8" }}>תנועה חדשה</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{projectName}</div>
          </div>
        </div>

        {/* Type toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {(["income", "expense"] as const).map((t) => (
            <button key={t} type="button" onClick={() => switchType(t)} style={{
              flex: 1, padding: "9px", borderRadius: 10, border: "none", cursor: "pointer",
              fontSize: 13, fontFamily: "inherit", fontWeight: 600,
              background: draft.type === t ? (t === "income" ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.14)") : "#1C1C1C",
              color: draft.type === t ? (t === "income" ? "#10B981" : "#EF4444") : "#555",
              outline: draft.type === t ? `1px solid ${t === "income" ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.3)"}` : "1px solid #252525",
            }}>
              {t === "income" ? "💰 הכנסה" : "💸 הוצאה"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Category / Income type */}
          <div>
            <label style={LABEL_S}>{isIncome ? "סוג הכנסה" : "קטגוריית הוצאה"}</label>
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} style={INPUT_S}>
              <option value="">בחר...</option>
              {categoryList.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {isOther && (
              <div style={{ fontSize: 10, color: "#F59E0B", marginTop: 4 }}>⚠ נא למלא תיאור מפורט</div>
            )}
          </div>

          {/* Artist / Vendor */}
          <div>
            <label style={LABEL_S}>{isIncome ? "לקוח / אמן" : "ספק / למי שולם"}</label>
            <input
              type="text" value={draft.artist}
              onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
              placeholder={isIncome ? "שם הלקוח / האמן..." : "שם הספק..."}
              style={INPUT_S}
            />
          </div>

          {/* Description */}
          <div>
            <label style={{ ...LABEL_S, ...(isOther ? { color: "#F59E0B" } : {}) }}>
              תיאור{isOther ? " *" : ""}
            </label>
            <input
              type="text" value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder={isIncome ? "למשל: מקדמה, תשלום חלקי..." : "למשל: מיקס שיר..."}
              style={{ ...INPUT_S, ...(isOther && !draft.description ? { borderColor: "rgba(245,158,11,0.5)" } : {}) }}
            />
          </div>

          {/* Amount + currency */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 10 }}>
            <div>
              <label style={LABEL_S}>סכום *</label>
              <input
                type="number" value={draft.amount} min={0}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                placeholder="0" style={INPUT_S}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
            </div>
            <div>
              <label style={LABEL_S}>מטבע</label>
              <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} style={INPUT_S}>
                {["₪", "$", "€"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Date + status */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={LABEL_S}>תאריך</label>
              <input
                type="date" value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                style={{ ...INPUT_S, colorScheme: "dark" }}
              />
            </div>
            <div>
              <label style={LABEL_S}>סטטוס</label>
              <select value={draft.paymentStatus} onChange={(e) => setDraft({ ...draft, paymentStatus: e.target.value as PaymentStatus })} style={INPUT_S}>
                {statusList.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Payment method */}
          <div>
            <label style={LABEL_S}>אמצעי תשלום</label>
            <select value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })} style={INPUT_S}>
              <option value="">בחר...</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label style={LABEL_S}>הערות</label>
            <input
              type="text" value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="הערות נוספות..."
              style={INPUT_S}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            />
          </div>

          {error && <div style={{ fontSize: 12, color: "#EF4444", textAlign: "center" }}>{error}</div>}

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: "11px", borderRadius: 10,
              border: "1px solid #2A2A2A", background: "transparent",
              color: "#777", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
            }}>ביטול</button>
            <button type="button" onClick={handleSave}
              disabled={saving || !canSave}
              style={{
                flex: 2, padding: "11px", borderRadius: 10, border: "none",
                background: saving || !canSave ? "#1A2A3A" : (isIncome ? "#065F46" : "#7C2D12"),
                color: saving || !canSave ? "#445" : "#fff",
                cursor: saving || !canSave ? "not-allowed" : "pointer",
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
