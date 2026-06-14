"use client";

import { useEffect, useMemo, useState } from "react";
import type { Show, ShowStatus, PaymentStatus } from "@/lib/shows-store";
import { SHOW_STATUSES, PAYMENT_STATUSES } from "@/lib/shows-store";
import ShowDrawer from "./ShowDrawer";

// ─── colors ──────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<ShowStatus, { bg: string; text: string }> = {
  "ליד חדש":       { bg: "rgba(59,130,246,0.15)",  text: "#60A5FA" },
  "ממתין לתשובה":  { bg: "rgba(245,158,11,0.15)",  text: "#F59E0B" },
  "צריך פולואפ":   { bg: "rgba(239,68,68,0.15)",   text: "#EF4444" },
  "נסגר":          { bg: "rgba(16,185,129,0.15)",  text: "#10B981" },
  "בוצע":          { bg: "rgba(167,139,250,0.15)", text: "#A78BFA" },
  "בוטל":          { bg: "rgba(107,114,128,0.15)", text: "#6B7280" },
};
const PAYMENT_COLOR: Record<PaymentStatus, { bg: string; text: string }> = {
  "לא שולם": { bg: "rgba(239,68,68,0.15)",   text: "#EF4444" },
  "חלקי":    { bg: "rgba(245,158,11,0.15)",  text: "#F59E0B" },
  "שולם":    { bg: "rgba(16,185,129,0.15)",  text: "#10B981" },
};

function Badge({ bg, text, children }: { bg: string; text: string; children: React.ReactNode }) {
  return (
    <span className="badge" style={{ background: bg, color: text }}>{children}</span>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

// ─── New Show Modal ───────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};

function NewShowModal({ onCreated, onClose }: { onCreated: (s: Show) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    name: "", artist: "", date: "", start_time: "", location: "",
    contact_person: "", phone: "", status: "ליד חדש" as ShowStatus,
    payment_status: "לא שולם" as PaymentStatus,
    show_price: "", dj_fee: "500", advance_payment: "0",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  function set(k: string, v: string) { setForm(prev => ({ ...prev, [k]: v })); }

  async function handleCreate() {
    if (!form.name.trim()) { setError("שם ההופעה חובה"); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/shows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          show_price:     Number(form.show_price)     || 0,
          dj_fee:         Number(form.dj_fee)         || 500,
          advance_payment:Number(form.advance_payment)|| 0,
          date:           form.date      || null,
          start_time:     form.start_time|| null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      onCreated(data.show);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally { setSaving(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 499 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        background: "#141414", border: "1px solid #2A2A2A", borderRadius: 16,
        width: 480, maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto",
        zIndex: 500, padding: 24,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#F0F0F0" }}>הופעה חדשה</div>
          <button onClick={onClose} style={{ color: "#555", fontSize: 18, background: "none", border: "none", cursor: "pointer" }}>×</button>
        </div>

        {error && <div style={{ color: "#EF4444", fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>שם ההופעה *</div>
            <input value={form.name} onChange={e => set("name", e.target.value)} style={inp} placeholder="לדוגמה: שליו טסמה - זאפה ירושלים" autoFocus />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>אמן</div>
            <input value={form.artist} onChange={e => set("artist", e.target.value)} style={inp} placeholder="שם האמן" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>מקום</div>
            <input value={form.location} onChange={e => set("location", e.target.value)} style={inp} placeholder="שם המקום" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>תאריך</div>
            <input type="date" value={form.date} onChange={e => set("date", e.target.value)} style={{ ...inp, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>שעה</div>
            <input type="time" value={form.start_time} onChange={e => set("start_time", e.target.value)} style={{ ...inp, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>מחיר הופעה (₪)</div>
            <input type="number" value={form.show_price} onChange={e => set("show_price", e.target.value)} style={inp} min={0} placeholder="0" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>דיג׳יי (₪)</div>
            <input type="number" value={form.dj_fee} onChange={e => set("dj_fee", e.target.value)} style={inp} min={0} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>סטטוס</div>
            <select value={form.status} onChange={e => set("status", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>תשלום</div>
            <select value={form.payment_status} onChange={e => set("payment_status", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={saving}
          style={{
            width: "100%", padding: "10px", borderRadius: 10, border: "none",
            background: "#6366F1", color: "#fff", fontWeight: 700, fontSize: 14,
            cursor: saving ? "wait" : "pointer",
          }}
        >
          {saving ? "יוצר..." : "✓ צור הופעה"}
        </button>
      </div>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ShowsPage() {
  const [shows,   setShows]   = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const [selected,    setSelected]    = useState<Show | null>(null);
  const [newModal,    setNewModal]    = useState(false);

  // filters
  const [search,         setSearch]         = useState("");
  const [filterStatus,   setFilterStatus]   = useState<ShowStatus | "">("");
  const [filterPayment,  setFilterPayment]  = useState<PaymentStatus | "">("");
  const [filterMonth,    setFilterMonth]    = useState("");

  useEffect(() => {
    fetch("/api/shows")
      .then(r => r.json())
      .then(d => setShows(d.shows ?? []))
      .catch(() => setError("שגיאה בטעינת הופעות"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return shows.filter(s => {
      if (filterStatus  && s.status         !== filterStatus)  return false;
      if (filterPayment && s.payment_status !== filterPayment) return false;
      if (filterMonth   && s.date           && !s.date.startsWith(filterMonth)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!s.name.toLowerCase().includes(q) &&
            !s.artist.toLowerCase().includes(q) &&
            !s.location.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [shows, search, filterStatus, filterPayment, filterMonth]);

  // KPI cards
  const now      = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonth      = shows.filter(s => s.date?.startsWith(monthKey));
  const pending        = shows.filter(s => s.status === "צריך פולואפ" || s.status === "ממתין לתשובה");
  const closed         = shows.filter(s => s.status === "נסגר" || s.status === "בוצע");
  const totalRevenue   = shows.filter(s => s.status !== "בוטל").reduce((sum, s) => sum + (s.show_price || 0), 0);

  const CARDS = [
    { label: "הופעות החודש",          value: thisMonth.length,             sub: `חודש ${now.getMonth() + 1}`,       color: "#60A5FA" },
    { label: "ממתינות לפולואפ",        value: pending.length,               sub: "צריכות טיפול",                     color: "#F59E0B" },
    { label: "נסגרו",                  value: closed.length,                sub: "הופעות מאושרות",                   color: "#10B981" },
    { label: "סה\"כ הכנסות צפויות",    value: `₪${totalRevenue.toLocaleString()}`, sub: "לא כולל מבוטלות",          color: "#A78BFA" },
  ];

  function handleUpdated(updated: Show) {
    setShows(prev => prev.map(s => s.id === updated.id ? updated : s));
    setSelected(updated);
  }
  function handleDeleted(id: string) {
    setShows(prev => prev.filter(s => s.id !== id));
    setSelected(null);
  }

  const sel: React.CSSProperties = {
    padding: "6px 10px", borderRadius: 8, border: "1px solid #2A2A2A",
    background: "#111", color: "#E0E0E0", fontSize: 12, cursor: "pointer", outline: "none",
  };

  return (
    <div style={{ padding: "24px 28px", minHeight: "100%", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F0", margin: 0 }}>הופעות</h1>
          <p style={{ fontSize: 13, color: "#555", margin: "4px 0 0" }}>ניהול הופעות חיות</p>
        </div>
        <button
          onClick={() => setNewModal(true)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 18px", borderRadius: 10, border: "none",
            background: "#6366F1", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
          הופעה חדשה
        </button>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {CARDS.map(({ label, value, sub, color }) => (
          <div key={label} className="skin-card" style={{
            background: "#141414", borderRadius: 14, padding: "18px 20px",
            border: "1px solid #2A2A2A",
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#D0D0D0", marginTop: 6 }}>{label}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: "1 1 200px", position: "relative" }}>
          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#555", fontSize: 14 }}>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש הופעה / אמן / מקום"
            style={{ ...sel, width: "100%", paddingRight: 32 }}
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as ShowStatus | "")} style={sel}>
          <option value="">כל הסטטוסים</option>
          {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterPayment} onChange={e => setFilterPayment(e.target.value as PaymentStatus | "")} style={sel}>
          <option value="">כל התשלומים</option>
          {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="month"
          value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)}
          style={{ ...sel, colorScheme: "dark" as React.CSSProperties["colorScheme"] }}
        />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#444" }}>טוען...</div>
      ) : error ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#EF4444" }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#444" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🎤</div>
          <div style={{ fontSize: 14 }}>{shows.length === 0 ? "אין הופעות עדיין — צור הופעה ראשונה" : "לא נמצאו תוצאות לפילטר הנוכחי"}</div>
        </div>
      ) : (
        <div style={{ background: "#141414", borderRadius: 14, border: "1px solid #2A2A2A", overflow: "hidden" }}>
          {/* Table header */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr 44px", gap: 0, padding: "10px 16px", borderBottom: "1px solid #1E1E1E" }}>
            {["שם ההופעה","אמן","תאריך","מקום","סטטוס","תשלום","סכום",""].map(h => (
              <div key={h} className="tbl-header">{h}</div>
            ))}
          </div>

          {/* Rows */}
          {filtered.map((show, i) => {
            const sc = STATUS_COLOR[show.status];
            const pc = PAYMENT_COLOR[show.payment_status];
            const isSelected = selected?.id === show.id;
            return (
              <div
                key={show.id}
                onClick={() => setSelected(show)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr 44px",
                  gap: 0,
                  padding: "12px 16px",
                  borderBottom: i < filtered.length - 1 ? "1px solid #1A1A1A" : "none",
                  cursor: "pointer",
                  background: isSelected ? "rgba(99,102,241,0.08)" : "transparent",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "#E0E0E0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.name}</div>
                <div style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.artist || "—"}</div>
                <div style={{ fontSize: 12, color: "#888" }}>{fmtDate(show.date)}</div>
                <div style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.location || "—"}</div>
                <div><Badge bg={sc.bg} text={sc.text}>{show.status}</Badge></div>
                <div><Badge bg={pc.bg} text={pc.text}>{show.payment_status}</Badge></div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#E0E0E0" }}>₪{(show.show_price || 0).toLocaleString()}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ color: "#555", fontSize: 16 }}>›</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drawer */}
      {selected && (
        <ShowDrawer
          show={selected}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}

      {/* New show modal */}
      {newModal && (
        <NewShowModal
          onCreated={s => { setShows(prev => [s, ...prev]); setNewModal(false); setSelected(s); }}
          onClose={() => setNewModal(false)}
        />
      )}
    </div>
  );
}
