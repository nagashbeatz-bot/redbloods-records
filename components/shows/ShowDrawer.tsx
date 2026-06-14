"use client";

import { useState } from "react";
import type { Show, ShowStatus, PaymentStatus } from "@/lib/shows-types";
import { SHOW_STATUSES, PAYMENT_STATUSES } from "@/lib/shows-types";

// ─── colors ──────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<ShowStatus, { bg: string; text: string }> = {
  "ליד חדש":        { bg: "rgba(59,130,246,0.15)",  text: "#60A5FA" },
  "ממתין לתשובה":   { bg: "rgba(245,158,11,0.15)",  text: "#F59E0B" },
  "צריך פולואפ":    { bg: "rgba(239,68,68,0.15)",   text: "#EF4444" },
  "נסגר":           { bg: "rgba(16,185,129,0.15)",  text: "#10B981" },
  "בוצע":           { bg: "rgba(167,139,250,0.15)", text: "#A78BFA" },
  "בוטל":           { bg: "rgba(107,114,128,0.15)", text: "#6B7280" },
};
const PAYMENT_COLOR: Record<PaymentStatus, { bg: string; text: string }> = {
  "לא שולם": { bg: "rgba(239,68,68,0.15)",   text: "#EF4444" },
  "חלקי":    { bg: "rgba(245,158,11,0.15)",  text: "#F59E0B" },
  "שולם":    { bg: "rgba(16,185,129,0.15)",  text: "#10B981" },
};

function Badge({ children, bg, text }: { children: React.ReactNode; bg: string; text: string }) {
  return (
    <span style={{ background: bg, color: text, borderRadius: 100, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 13, color: "#D0D0D0" }}>{children || "—"}</div>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 8,
  border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = "תקציר" | "כספים" | "לוגיסטיקה" | "קבצים" | "משימות";
const TABS: Tab[] = ["תקציר", "כספים", "לוגיסטיקה", "קבצים", "משימות"];

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  show: Show;
  onClose: () => void;
  onUpdated: (s: Show) => void;
  onDeleted: (id: string) => void;
}

export default function ShowDrawer({ show, onClose, onUpdated, onDeleted }: Props) {
  const [tab,     setTab]     = useState<Tab>("תקציר");
  const [saving,  setSaving]  = useState(false);
  const [deleting,setDeleting]= useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // local editable state
  const [draft, setDraft] = useState<Show>({ ...show });

  function set<K extends keyof Show>(k: K, v: Show[K]) {
    setDraft(prev => ({ ...prev, [k]: v }));
  }

  const sc    = STATUS_COLOR[draft.status];
  const pc    = PAYMENT_COLOR[draft.payment_status];

  const distributable = Math.max(0, (draft.show_price || 0) - (draft.dj_fee || 0));
  const artistShare   = distributable / 2;
  const labelShare    = distributable / 2;
  const remaining     = Math.max(0, (draft.show_price || 0) - (draft.advance_payment || 0));

  const dirty = JSON.stringify(draft) !== JSON.stringify(show);

  async function save() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/shows/${show.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:           draft.name,
          artist:         draft.artist,
          date:           draft.date,
          start_time:     draft.start_time,
          location:       draft.location,
          contact_person: draft.contact_person,
          phone:          draft.phone,
          status:         draft.status,
          payment_status: draft.payment_status,
          show_price:     draft.show_price,
          dj_fee:         draft.dj_fee,
          advance_payment:draft.advance_payment,
          notes:          draft.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה בשמירה");
      onUpdated(data.show);
      setDraft(data.show);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true); setError(null);
    try {
      const res = await fetch(`/api/shows/${show.id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "שגיאה"); }
      onDeleted(show.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאת מחיקה");
      setConfirmDel(false);
    } finally { setDeleting(false); }
  }

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 399 }}
      />

      {/* Drawer — slides from right in RTL */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: 360, background: "#111", borderLeft: "1px solid #2A2A2A",
        zIndex: 400, display: "flex", flexDirection: "column",
        overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px 0", borderBottom: "1px solid #1E1E1E", paddingBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F0", lineHeight: 1.3 }}>{draft.name}</div>
              {draft.artist && <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{draft.artist}</div>}
            </div>
            <button onClick={onClose} style={{ color: "#555", fontSize: 18, background: "none", border: "none", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Badge bg={sc.bg} text={sc.text}>{draft.status}</Badge>
            <Badge bg={pc.bg} text={pc.text}>{draft.payment_status}</Badge>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1E1E1E", overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "10px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: "none", border: "none", whiteSpace: "nowrap",
              borderBottom: `2px solid ${tab === t ? "#6366F1" : "transparent"}`,
              color: tab === t ? "#6366F1" : "#555",
            }}>{t}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: "20px", overflowY: "auto" }}>
          {error && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#EF4444", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12 }}>{error}</div>}

          {tab === "תקציר" && (
            <div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>שם ההופעה</div>
                <input value={draft.name} onChange={e => set("name", e.target.value)} style={inp} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>אמן</div>
                <input value={draft.artist} onChange={e => set("artist", e.target.value)} style={inp} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>תאריך</div>
                  <input type="date" value={draft.date ?? ""} onChange={e => set("date", e.target.value || null)} style={{ ...inp, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>שעה</div>
                  <input type="time" value={draft.start_time ?? ""} onChange={e => set("start_time", e.target.value || null)} style={{ ...inp, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
                </div>
              </div>

              {/* Financial summary in תקציר */}
              <div style={{ background: "#0D0D0D", borderRadius: 10, padding: "14px 16px", marginBottom: 14, border: "1px solid #1E1E1E" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#888" }}>מחיר שוסכם</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#F0F0F0" }}>₪{(draft.show_price || 0).toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#888" }}>מקדמה</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#F59E0B" }}>₪{(draft.advance_payment || 0).toLocaleString()}</span>
                </div>
                <div style={{ height: 1, background: "#1E1E1E", margin: "8px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "#888" }}>יתרה לתשלום</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: remaining > 0 ? "#10B981" : "#6B7280" }}>₪{remaining.toLocaleString()}</span>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>סטטוס</div>
                <select value={draft.status} onChange={e => set("status", e.target.value as ShowStatus)} style={{ ...inp, cursor: "pointer" }}>
                  {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>סטטוס תשלום</div>
                <select value={draft.payment_status} onChange={e => set("payment_status", e.target.value as PaymentStatus)} style={{ ...inp, cursor: "pointer" }}>
                  {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}

          {tab === "כספים" && (
            <div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>מחיר הופעה (₪)</div>
                <input type="number" value={draft.show_price} onChange={e => set("show_price", Number(e.target.value) || 0)} style={inp} min={0} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>דיג׳יי (₪)</div>
                <input type="number" value={draft.dj_fee} onChange={e => set("dj_fee", Number(e.target.value) || 0)} style={inp} min={0} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>מקדמה (₪)</div>
                <input type="number" value={draft.advance_payment} onChange={e => set("advance_payment", Number(e.target.value) || 0)} style={inp} min={0} />
              </div>

              {/* Breakdown */}
              <div style={{ background: "#0D0D0D", borderRadius: 10, padding: "16px", border: "1px solid #1E1E1E", marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#555", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>פירוט חלוקה</div>
                {[
                  { label: "מחיר הופעה",       value: draft.show_price || 0,   color: "#F0F0F0" },
                  { label: "הפחתת דיג׳יי",      value: -(draft.dj_fee || 0),    color: "#EF4444" },
                  { label: "יתרה לחלוקה",       value: distributable,           color: "#F59E0B" },
                  { label: "חלק אמן (50%)",      value: artistShare,            color: "#60A5FA" },
                  { label: "חלק לייבל (50%)",    value: labelShare,             color: "#C084FC" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: "#888" }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color }}>{value < 0 ? "-" : ""}₪{Math.abs(value).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "לוגיסטיקה" && (
            <div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>מקום</div>
                <input value={draft.location} onChange={e => set("location", e.target.value)} style={inp} placeholder="שם הבמה / מקום" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>איש קשר</div>
                <input value={draft.contact_person} onChange={e => set("contact_person", e.target.value)} style={inp} placeholder="שם מלא" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>טלפון</div>
                <input value={draft.phone} onChange={e => set("phone", e.target.value)} style={inp} placeholder="05X-XXXXXXX" dir="ltr" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>הערות</div>
                <textarea value={draft.notes} onChange={e => set("notes", e.target.value)}
                  rows={5} style={{ ...inp, resize: "vertical", lineHeight: 1.6 }} placeholder="פרטים נוספים..." />
              </div>
            </div>
          )}

          {tab === "קבצים" && (
            <div style={{ textAlign: "center", color: "#444", padding: "40px 0", fontSize: 13 }}>
              🗂 ניהול קבצים יתווסף בהמשך
            </div>
          )}

          {tab === "משימות" && (
            <div style={{ textAlign: "center", color: "#444", padding: "40px 0", fontSize: 13 }}>
              ✓ ניהול משימות להופעה יתווסף בהמשך
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid #1E1E1E", display: "flex", gap: 8, alignItems: "center" }}>
          {confirmDel ? (
            <>
              <span style={{ fontSize: 12, color: "#888", flex: 1 }}>למחוק את ההופעה?</span>
              <button onClick={() => setConfirmDel(false)} disabled={deleting} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #333", background: "none", color: "#888", cursor: "pointer", fontSize: 12 }}>ביטול</button>
              <button onClick={handleDelete} disabled={deleting} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#EF4444", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                {deleting ? "מוחק..." : "מחק"}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setConfirmDel(true)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #2A2A2A", background: "none", color: "#555", cursor: "pointer", fontSize: 13 }}>🗑</button>
              {dirty && (
                <button onClick={save} disabled={saving} style={{
                  flex: 1, padding: "8px", borderRadius: 8, border: "none",
                  background: "#6366F1", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13,
                }}>
                  {saving ? "שומר..." : "✓ שמור שינויים"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
