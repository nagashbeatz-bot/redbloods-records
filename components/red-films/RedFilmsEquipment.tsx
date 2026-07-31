"use client";

/**
 * Red Films — "ציוד" tab. Simple inventory list for the label's camera/AV
 * equipment: protocol/bookkeeping only in this phase — no assignment to
 * productions, no loan tracking, no barcodes/QR, no alerts. Deliberately
 * mirrors the SAME visual language as RedFilmsPage.tsx (panel/KPI-card/
 * table/mobile-card/status-pill styling) rather than introducing a new look.
 *
 * "הסר מהמלאי" NEVER deletes the row — it's a status flip (status="הוסר
 * מהמלאי" + removed_at=now()) via PATCH /api/red-films/equipment/[id]. There
 * is no DELETE route for this table at all. Each record represents an
 * equipment TYPE + its total quantity (e.g. "Sony A7C II", qty 2) — removal
 * always affects the whole record, never a single unit out of the quantity.
 */

import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import DatePickerInput from "@/components/ui/DatePickerInput";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EquipmentItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  acquired_date: string;
  purchase_price: number | null;
  purchased_from: string | null;
  serial_number: string | null;
  notes: string | null;
  added_by: string;
  status: "קיים" | "הוסר מהמלאי";
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RED       = "#DC2626";
const RED_LIGHT = "#F87171";

export const EQUIPMENT_CATEGORIES = ["מצלמות", "עדשות", "ייצוב", "תאורה", "סאונד", "אביזרים", "אחר"];

const EQUIPMENT_STATUS_MAP: Record<string, { color: string; bg: string }> = {
  "קיים":         { color: "#4ADE80", bg: "rgba(74,222,128,0.1)" },
  "הוסר מהמלאי":  { color: "#6B7280", bg: "rgba(107,114,128,0.08)" },
};

function EquipmentStatusBadge({ status, small = false }: { status: string; small?: boolean }) {
  const { color, bg } = EQUIPMENT_STATUS_MAP[status] ?? { color: "#888", bg: "rgba(136,136,136,0.1)" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: small ? 4 : 5,
      padding: small ? "2px 7px" : "3px 9px", borderRadius: 20,
      fontSize: small ? 10 : 11, fontWeight: 600, color, background: bg,
      border: `1px solid ${color}33`, whiteSpace: "nowrap",
    }}>
      <span style={{ width: small ? 5 : 6, height: small ? 5 : 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {status}
    </span>
  );
}

const INPUT_S: CSSProperties = {
  background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 8,
  color: "#E8E8E8", fontSize: 13.5, padding: "9px 12px", outline: "none",
  fontFamily: "inherit", boxSizing: "border-box", width: "100%",
};
const SELECT_S: CSSProperties = { ...INPUT_S, cursor: "pointer" };
const LABEL_S: CSSProperties = { fontSize: 12, color: "#8C8C93", marginBottom: 6, fontWeight: 600, display: "block" };

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y.slice(2)}`;
}
function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `₪${n.toLocaleString("he-IL")}`;
}

// ── KPI card (same visual as RedFilmsPage's KpiCard — not exported there, so
//    reproduced here at the same styling; matches this file's existing
//    per-component duplication convention, e.g. RaiseBudgetModal). ──────────
function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div style={{
      position: "relative", overflow: "hidden", minWidth: 0,
      background: "linear-gradient(160deg, rgba(28,16,17,0.9), rgba(14,11,12,0.96))",
      border: `1px solid ${RED}24`, borderRadius: 18, padding: "26px 24px 22px",
      boxShadow: `0 10px 30px rgba(0,0,0,0.42), 0 0 14px rgba(220,38,38,0.05)`,
    }}>
      <div aria-hidden style={{
        position: "absolute", top: -32, insetInlineStart: -26, width: 108, height: 108,
        borderRadius: "50%", background: RED, opacity: 0.09, filter: "blur(34px)", pointerEvents: "none",
      }} />
      <div style={{ position: "relative", minHeight: 50, display: "flex", alignItems: "center" }}>
        <div style={{
          position: "absolute", insetInlineStart: 0, top: "50%", transform: "translateY(-50%)",
          width: 50, height: 50, borderRadius: "50%", flexShrink: 0, color: RED_LIGHT,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "radial-gradient(circle at 50% 38%, rgba(220,38,38,0.20), rgba(220,38,38,0.04))",
          border: `1px solid ${RED}54`,
          boxShadow: `0 0 12px rgba(220,38,38,0.2), inset 0 0 8px rgba(220,38,38,0.12)`,
        }}>{icon}</div>
        <div style={{ width: "100%", textAlign: "center", fontSize: 34, fontWeight: 800, color: "#F4F4F6", letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
      </div>
      <div style={{ position: "relative", fontSize: 13.5, color: "#96969C", marginTop: 16, fontWeight: 600, textAlign: "center" }}>{label}</div>
    </div>
  );
}

const ICON_PROPS = {
  width: 22, height: 22, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.6,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};
const IcBox      = () => <svg {...ICON_PROPS}><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>;
const IcTag       = () => <svg {...ICON_PROPS}><path d="M20.6 12.4 12 21l-9-9V4h8l9.6 8.4Z" /><circle cx="7.5" cy="7.5" r="1.2" /></svg>;
const IcPlus      = () => <svg {...ICON_PROPS}><path d="M12 5v14M5 12h14" /></svg>;
const IcTrash     = () => <svg {...ICON_PROPS}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>;
const IcMoney     = () => <svg {...ICON_PROPS}><circle cx="12" cy="12" r="9" /><path d="M9 15c0 1.1 1.3 2 3 2s3-.9 3-2-1.3-1.5-3-2-3-.9-3-2 1.3-2 3-2 3 .9 3 2" /></svg>;

// ── Add / Edit modal ─────────────────────────────────────────────────────────

function EquipmentModal({ item, onClose, onSaved }: {
  item: EquipmentItem | null; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const isEdit = !!item;
  const [name, setName]                 = useState(item?.name ?? "");
  const [category, setCategory]         = useState(item?.category ?? EQUIPMENT_CATEGORIES[0]);
  const [quantity, setQuantity]         = useState(String(item?.quantity ?? 1));
  const [acquiredDate, setAcquiredDate] = useState(item?.acquired_date ?? new Date().toISOString().slice(0, 10));
  const [price, setPrice]               = useState(item?.purchase_price != null ? String(item.purchase_price) : "");
  const [purchasedFrom, setPurchasedFrom] = useState(item?.purchased_from ?? "");
  const [serialNumber, setSerialNumber] = useState(item?.serial_number ?? "");
  const [notes, setNotes]               = useState(item?.notes ?? "");
  const [addedBy, setAddedBy]           = useState(item?.added_by ?? "NagashBeatz");
  const [saving, setSaving]             = useState(false);
  const [err, setErr]                   = useState<string | null>(null);

  const quantityNum = Number(quantity);
  const validQuantity = Number.isFinite(quantityNum) && quantityNum > 0;
  const priceNum = price.trim() === "" ? null : Number(price);
  const validPrice = price.trim() === "" || (Number.isFinite(priceNum) && (priceNum as number) >= 0);
  const canSave = !!name.trim() && !!category && validQuantity && validPrice && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true); setErr(null);
    try {
      const fields = {
        name: name.trim(),
        category,
        quantity: quantityNum,
        acquired_date: acquiredDate,
        purchase_price: priceNum,
        purchased_from: purchasedFrom.trim() || null,
        serial_number: serialNumber.trim() || null,
        notes: notes.trim() || null,
        added_by: addedBy.trim() || "NagashBeatz",
      };
      const url = isEdit ? `/api/red-films/equipment/${item!.id}` : "/api/red-films/equipment";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "השמירה נכשלה"); setSaving(false); return; }
      await onSaved();
    } catch {
      setErr("שגיאת רשת, נסה שוב"); setSaving(false);
    }
  }

  return createPortal(
    <div
      onClick={() => { if (!saving) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 16, padding: "26px 24px", width: "min(480px, 92vw)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800, color: "#F0F0F0", margin: "0 0 20px" }}>
          {isEdit ? "עריכת ציוד" : "הוסף ציוד"}
        </h2>

        {err && (
          <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "#F87171", marginBottom: 16 }}>
            {err}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={LABEL_S}>שם הציוד *</label>
          <input style={INPUT_S} value={name} onChange={e => setName(e.target.value)} placeholder="לדוגמה: Sony A7C II" disabled={saving} />
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 2 }}>
            <label style={LABEL_S}>קטגוריה *</label>
            <select className="rap-select" style={SELECT_S} value={category} onChange={e => setCategory(e.target.value)} disabled={saving}>
              {EQUIPMENT_CATEGORIES.map(c => <option key={c} value={c} style={{ background: "#161617" }}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={LABEL_S}>כמות *</label>
            <input type="number" inputMode="numeric" min={1} step={1} style={{ ...INPUT_S, direction: "ltr", textAlign: "right" }} value={quantity} onChange={e => setQuantity(e.target.value)} disabled={saving} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={LABEL_S}>תאריך קנייה / הוספה</label>
          <DatePickerInput value={acquiredDate} onChange={setAcquiredDate} disabled={saving} style={{ ...INPUT_S, justifyContent: "space-between" }} />
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={LABEL_S}>מחיר קנייה (אופציונלי)</label>
            <input type="number" inputMode="decimal" min={0} step="1" style={{ ...INPUT_S, direction: "ltr", textAlign: "right" }} value={price} onChange={e => setPrice(e.target.value)} placeholder="0" disabled={saving} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={LABEL_S}>חנות / ממי נקנה (אופציונלי)</label>
            <input style={INPUT_S} value={purchasedFrom} onChange={e => setPurchasedFrom(e.target.value)} disabled={saving} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={LABEL_S}>מספר סידורי (אופציונלי)</label>
          <input style={{ ...INPUT_S, direction: "ltr", textAlign: "right" }} value={serialNumber} onChange={e => setSerialNumber(e.target.value)} disabled={saving} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={LABEL_S}>הערות (אופציונלי)</label>
          <textarea style={{ ...INPUT_S, resize: "vertical", minHeight: 60 }} value={notes} onChange={e => setNotes(e.target.value)} disabled={saving} />
        </div>

        <div style={{ marginBottom: 22 }}>
          <label style={LABEL_S}>מי הוסיף</label>
          <input style={INPUT_S} value={addedBy} onChange={e => setAddedBy(e.target.value)} disabled={saving} />
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: "9px 18px", borderRadius: 9, background: "none", border: "1px solid #333", color: "#888", fontSize: 13, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
            ביטול
          </button>
          <button onClick={save} disabled={!canSave}
            style={{
              padding: "9px 22px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: canSave ? "pointer" : "default",
              fontFamily: "inherit", color: "#FFF", border: "1px solid rgba(248,113,113,0.4)",
              background: "linear-gradient(135deg, #EF4444, #B91C1C)", opacity: canSave ? 1 : 0.55,
            }}>
            {saving ? "שומר…" : isEdit ? "שמור שינויים" : "הוסף ציוד"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Remove / restore confirm dialog ─────────────────────────────────────────

function EquipmentConfirmDialog({ title, body, confirmLabel, danger, saving, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; danger?: boolean; saving: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return createPortal(
    <div onClick={() => { if (!saving) onCancel(); }} style={{ position: "fixed", inset: 0, zIndex: 9600, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 14, padding: 24, width: "min(380px, 90vw)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F0", marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 22, lineHeight: 1.6 }}>{body}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, background: "none", border: "1px solid #333", color: "#888", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
          <button onClick={onConfirm} disabled={saving} style={{ padding: "8px 20px", borderRadius: 8, background: danger ? "#EF4444" : "linear-gradient(135deg, #EF4444, #B91C1C)", border: "none", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: saving ? 0.7 : 1 }}>{saving ? "מעדכן…" : confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RedFilmsEquipment() {
  const [items, setItems]     = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"הכל" | "קיים" | "הוסר מהמלאי">("קיים");
  const [search, setSearch]   = useState("");
  const [modalItem, setModalItem] = useState<EquipmentItem | "new" | null>(null);
  const [statusConfirm, setStatusConfirm] = useState<EquipmentItem | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/red-films/equipment");
      const data = await res.json().catch(() => ({}));
      setItems(data.equipment ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Summary (all-time, unaffected by the current status filter) ──────────
  const totalItems = items.length;
  const categoriesCount = new Set(items.map(i => i.category)).size;
  const now = new Date();
  const addedThisMonth = items.filter(i => {
    const d = new Date(i.created_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const removedCount = items.filter(i => i.status === "הוסר מהמלאי").length;
  const priced = items.filter(i => i.purchase_price !== null);
  const totalInvestment = priced.reduce((sum, i) => sum + (i.purchase_price ?? 0) * i.quantity, 0);

  // ── Filter + search ────────────────────────────────────────────────────────
  const visible = items
    .filter(i => statusFilter === "הכל" || i.status === statusFilter)
    .filter(i => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q) ||
        (i.serial_number ?? "").toLowerCase().includes(q) || (i.purchased_from ?? "").toLowerCase().includes(q);
    });

  async function toggleStatus() {
    if (!statusConfirm) return;
    setStatusSaving(true);
    try {
      const nextStatus = statusConfirm.status === "קיים" ? "הוסר מהמלאי" : "קיים";
      await fetch(`/api/red-films/equipment/${statusConfirm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      await load();
    } finally {
      setStatusSaving(false);
      setStatusConfirm(null);
    }
  }

  const COL = "1.6fr 1fr 0.7fr 1fr 1fr 1fr 1fr 130px";

  return (
    <>
      {/* ── Add button ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
        <button
          onClick={() => setModalItem("new")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: isMobile ? "11px 20px" : "13px 24px", borderRadius: 12,
            background: "linear-gradient(135deg, #EF4444, #B91C1C)",
            border: "1px solid rgba(248,113,113,0.4)", color: "#FFF", fontSize: isMobile ? 13.5 : 14.5, fontWeight: 800,
            cursor: "pointer", fontFamily: "inherit",
            boxShadow: "0 0 16px rgba(220,38,38,0.3), 0 6px 18px rgba(220,38,38,0.22)",
          }}
        >
          <IcPlus /> הוסף ציוד
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "repeat(2, minmax(0,1fr))" : `repeat(${totalInvestment > 0 || priced.length > 0 ? 5 : 4}, minmax(0,1fr))`,
        gap: isMobile ? 12 : 16, marginBottom: 24,
      }}>
        <KpiCard icon={<IcBox />} label="סך הכול פריטים" value={totalItems} />
        <KpiCard icon={<IcTag />} label="קטגוריות" value={categoriesCount} />
        <KpiCard icon={<IcPlus />} label="נוספו החודש" value={addedThisMonth} />
        <KpiCard icon={<IcTrash />} label="הוסרו מהמלאי" value={removedCount} />
        {priced.length > 0 && <KpiCard icon={<IcMoney />} label="סך ההשקעה" value={fmtMoney(totalInvestment)} />}
      </div>

      {/* ── Search + status filter ── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="חיפוש ציוד..."
          style={{ ...INPUT_S, maxWidth: 280, flex: "1 1 220px" }}
        />
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          {(["קיים", "הוסר מהמלאי", "הכל"] as const).map(f => {
            const on = statusFilter === f;
            return (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                style={{
                  padding: "8px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit", border: "1px solid",
                  background:  on ? "rgba(220,38,38,0.15)" : "rgba(255,255,255,0.03)",
                  color:       on ? "#FCA5A5" : "#78787F",
                  borderColor: on ? "rgba(220,38,38,0.6)" : "rgba(255,255,255,0.08)",
                  boxShadow:   on ? "0 0 16px rgba(220,38,38,0.3)" : "none",
                  transition: "all 0.15s",
                }}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Equipment table ── */}
      {loading ? (
        <div style={{ color: "#555", fontSize: 13, padding: "40px 0", textAlign: "center" }}>טוען ציוד...</div>
      ) : visible.length === 0 ? (
        <div style={{ background: "linear-gradient(180deg, rgba(24,24,29,0.6), rgba(17,17,20,0.6))", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 18, padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 12 }}>🎥</div>
          <div style={{ fontSize: 15, color: "#9A9AA2", fontWeight: 700, marginBottom: 6 }}>
            {items.length === 0 ? "אין עדיין ציוד רשום" : "אין פריטים תואמים"}
          </div>
          {items.length === 0 && (
            <div style={{ fontSize: 13, color: "#6E6E76" }}>לחץ "+ הוסף ציוד" כדי להתחיל</div>
          )}
        </div>
      ) : isMobile ? (
        /* ── Mobile card list ── */
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {visible.map(item => (
            <div key={item.id} style={{
              background: "linear-gradient(165deg, rgba(26,17,18,0.9), rgba(16,12,13,0.92))",
              border: `1px solid ${RED}24`, borderRadius: 16, padding: "14px 15px",
              boxShadow: "0 8px 26px rgba(0,0,0,0.36), 0 0 18px rgba(220,38,38,0.05)",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 9 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#EDEDF2" }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: "#8A8A92", marginTop: 2 }}>{item.category} · כמות {item.quantity}</div>
                </div>
                <EquipmentStatusBadge status={item.status} small />
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11.5, color: "#8A8A92", marginBottom: 12 }}>
                <span>📅 {fmtDate(item.acquired_date)}</span>
                {item.purchase_price !== null && <span style={{ color: "#4ADE80", fontWeight: 700 }}>{fmtMoney(item.purchase_price)}</span>}
                <span>מי הוסיף: {item.added_by}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setModalItem(item)} style={{ flex: 1, padding: "8px 0", borderRadius: 9, background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.42)", color: "#FCA5A5", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>ערוך</button>
                <button onClick={() => setStatusConfirm(item)} style={{ flex: 1, padding: "8px 0", borderRadius: 9, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#9A9AA2", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  {item.status === "קיים" ? "הסר מהמלאי" : "שחזר למלאי"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          background: "linear-gradient(180deg, rgba(24,16,17,0.72), rgba(15,12,13,0.8))",
          border: `1px solid ${RED}1F`, borderRadius: 18, overflow: "hidden",
          boxShadow: "0 14px 44px rgba(0,0,0,0.42), 0 0 14px rgba(220,38,38,0.035)",
        }}>
          {/* Table header */}
          <div style={{
            display: "grid", gridTemplateColumns: COL, gap: 0, padding: "16px 24px",
            background: "rgba(220,38,38,0.04)", borderBottom: `1px solid ${RED}1F`,
            fontSize: 12, color: "#847072", fontWeight: 700, letterSpacing: "0.01em", alignItems: "center",
          }}>
            {["שם הציוד", "קטגוריה", "כמות", "תאריך קנייה / הוספה", "מחיר קנייה", "סטטוס", "מי הוסיף", "פעולות"].map((h, i) => (
              <div key={i} style={{ paddingRight: i > 0 ? 8 : 0, textAlign: i === 0 ? "start" : "center" }}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          {visible.map((item, idx) => (
            <div
              key={item.id}
              style={{
                display: "grid", gridTemplateColumns: COL, gap: 0, padding: "17px 24px",
                borderBottom: idx < visible.length - 1 ? "1px solid rgba(255,255,255,0.045)" : "none",
                fontSize: 13.5, color: "#C6C6CE", alignItems: "center", transition: "background 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.028)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ fontWeight: 700, color: "#EDEDF2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
              <div style={{ color: "#8A8A92", textAlign: "center" }}>{item.category}</div>
              <div style={{ color: "#8A8A92", textAlign: "center" }}>{item.quantity}</div>
              <div style={{ color: "#8A8A92", textAlign: "center", direction: "ltr" }}>{fmtDate(item.acquired_date)}</div>
              <div style={{ color: "#8A8A92", textAlign: "center" }}>{fmtMoney(item.purchase_price)}</div>
              <div style={{ display: "flex", justifyContent: "center" }}><EquipmentStatusBadge status={item.status} small /></div>
              <div style={{ color: "#8A8A92", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.added_by}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <button
                  onClick={() => setModalItem(item)}
                  style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.42)", color: "#FCA5A5", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >
                  ערוך
                </button>
                <button
                  onClick={() => setStatusConfirm(item)}
                  title={item.status === "קיים" ? "הסר מהמלאי" : "שחזר למלאי"}
                  style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#9A9AA2", cursor: "pointer", fontFamily: "inherit" }}
                >
                  {item.status === "קיים" ? <IcTrash /> : "↺"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add/Edit modal ── */}
      {modalItem && (
        <EquipmentModal
          item={modalItem === "new" ? null : modalItem}
          onClose={() => setModalItem(null)}
          onSaved={async () => { setModalItem(null); await load(); }}
        />
      )}

      {/* ── Remove/restore confirm ── */}
      {statusConfirm && (
        <EquipmentConfirmDialog
          title={statusConfirm.status === "קיים" ? "להסיר ציוד מהמלאי?" : "לשחזר ציוד למלאי?"}
          body={
            statusConfirm.status === "קיים"
              ? `"${statusConfirm.name}" יסומן כהוסר מהמלאי. הרשומה לא תימחק — ניתן לשחזר בכל עת.`
              : `"${statusConfirm.name}" יסומן כקיים שוב במלאי.`
          }
          confirmLabel={statusConfirm.status === "קיים" ? "הסר מהמלאי" : "שחזר למלאי"}
          danger={statusConfirm.status === "קיים"}
          saving={statusSaving}
          onConfirm={toggleStatus}
          onCancel={() => setStatusConfirm(null)}
        />
      )}
    </>
  );
}
