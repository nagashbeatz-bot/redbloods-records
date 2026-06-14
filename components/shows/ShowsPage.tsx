"use client";

import { useEffect, useMemo, useState } from "react";
import type { Show, ShowStatus, PaymentStatus } from "@/lib/shows-types";
import { SHOW_STATUSES, PAYMENT_STATUSES } from "@/lib/shows-types";
import ShowDrawer from "./ShowDrawer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Client { id: string; name: string; phone: string; status: string; type: string; }

// ─── Colors ───────────────────────────────────────────────────────────────────

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
    <span style={{
      background: bg, color: text, borderRadius: 100,
      padding: "2px 9px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

// ─── Create Client Modal ──────────────────────────────────────────────────────

function CreateClientModal({ onCreated, onClose }: {
  onCreated: (c: Client) => void;
  onClose: () => void;
}) {
  const [name,  setName]  = useState("");
  const [phone, setPhone] = useState("");
  const [saving,setSaving]= useState(false);
  const [err,   setErr]   = useState<string | null>(null);

  const inp: React.CSSProperties = {
    width: "100%", padding: "8px 10px", borderRadius: 8,
    border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
    fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };

  async function handleCreate() {
    if (!name.trim()) { setErr("שם חובה"); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), email: "", type: "לקוח", status: "חדש", notes: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      onCreated(data.client);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
    } finally { setSaving(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 599 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        background: "#141414", border: "1px solid #2A2A2A", borderRadius: 14,
        width: 340, zIndex: 600, padding: 24,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F0", marginBottom: 16 }}>לקוח חדש</div>
        {err && <div style={{ color: "#EF4444", fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>שם *</div>
          <input value={name} onChange={e => setName(e.target.value)} style={inp} autoFocus />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>טלפון</div>
          <input value={phone} onChange={e => setPhone(e.target.value)} style={inp} dir="ltr" />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid #333", background: "none", color: "#888", cursor: "pointer" }}>ביטול</button>
          <button onClick={handleCreate} disabled={saving} style={{ flex: 2, padding: "8px", borderRadius: 8, border: "none", background: "#6366F1", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
            {saving ? "יוצר..." : "צור לקוח"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Client Select ────────────────────────────────────────────────────────────

function ClientSelect({ clients, value, onChange, placeholder, filterVip, onCreateNew }: {
  clients: Client[];
  value: string;
  onChange: (id: string, name: string) => void;
  placeholder: string;
  filterVip?: boolean;
  onCreateNew?: () => void;
}) {
  const filtered = filterVip ? clients.filter(c => c.status === "VIP") : clients;
  const inp: React.CSSProperties = {
    flex: 1, padding: "8px 10px", borderRadius: 8,
    border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
    fontSize: 13, fontFamily: "inherit", outline: "none",
  };
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select value={value} onChange={e => {
        const c = clients.find(x => x.id === e.target.value);
        onChange(e.target.value, c?.name ?? "");
      }} style={{ ...inp, cursor: "pointer" }}>
        <option value="">{placeholder}</option>
        {filtered.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {onCreateNew && (
        <button onClick={onCreateNew} type="button" style={{
          padding: "8px 10px", borderRadius: 8, border: "1px solid #2A2A2A",
          background: "none", color: "#6366F1", cursor: "pointer", fontSize: 12,
          fontWeight: 700, whiteSpace: "nowrap",
        }}>+ צור לקוח</button>
      )}
    </div>
  );
}

// ─── New Show Modal ───────────────────────────────────────────────────────────

const modalInp: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #222", background: "#0D0D0D", color: "#E0E0E0",
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const modalLbl: React.CSSProperties = {
  fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.06em",
};

function NewShowModal({ clients, onCreated, onClose, onClientAdded }: {
  clients: Client[];
  onCreated: (s: Show) => void;
  onClose: () => void;
  onClientAdded: (c: Client) => void;
}) {
  const [form, setForm] = useState({
    name: "", date: "", start_time: "", location: "",
    contact_person: "", phone: "",
    status: "ליד חדש" as ShowStatus,
    payment_status: "לא שולם" as PaymentStatus,
    show_price: "", dj_fee: "500",
    artist_client_id: "", artist: "",
    booker_client_id: "", booker_name: "",
  });
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [calWarn,       setCalWarn]       = useState<string | null>(null);
  const [addToCalendar, setAddToCalendar] = useState(false);
  const [newClientFor,  setNewClientFor]  = useState<"booker" | null>(null);

  function set(k: string, v: string) { setForm(prev => ({ ...prev, [k]: v })); }

  async function handleCreate() {
    if (!form.name.trim()) { setError("שם ההופעה חובה"); return; }
    setSaving(true); setError(null); setCalWarn(null);
    try {
      const res = await fetch("/api/shows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:             form.name.trim(),
          artist:           form.artist,
          artist_client_id: form.artist_client_id || null,
          booker_client_id: form.booker_client_id || null,
          booker_name:      form.booker_name,
          date:             form.date || null,
          start_time:       form.start_time || null,
          location:         form.location,
          contact_person:   form.contact_person,
          phone:            form.phone,
          status:           form.status,
          payment_status:   form.payment_status,
          show_price:       Number(form.show_price) || 0,
          dj_fee:           Number(form.dj_fee) || 500,
          addToCalendar:    addToCalendar && !!form.date,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      if (data.calendarWarning) {
        setCalWarn(data.calendarWarning);
      }
      onCreated(data.show);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally { setSaving(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 499 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        background: "#111", border: "1px solid #1E1E1E", borderRadius: 16,
        width: 520, maxWidth: "95vw", maxHeight: "88vh", overflowY: "auto",
        zIndex: 500, padding: 28,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#F0F0F0" }}>הופעה חדשה</div>
          <button onClick={onClose} style={{ color: "#444", fontSize: 20, background: "none", border: "none", cursor: "pointer" }}>×</button>
        </div>

        {error   && <div style={{ color: "#EF4444", fontSize: 12, marginBottom: 14, background: "rgba(239,68,68,0.1)", padding: "8px 12px", borderRadius: 8 }}>{error}</div>}
        {calWarn && <div style={{ color: "#F59E0B", fontSize: 12, marginBottom: 14, background: "rgba(245,158,11,0.1)", padding: "8px 12px", borderRadius: 8 }}>{calWarn}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <div style={modalLbl}>שם ההופעה *</div>
            <input value={form.name} onChange={e => set("name", e.target.value)} style={modalInp} autoFocus placeholder="לדוגמה: שליו טסמה — זאפה ירושלים" />
          </div>

          <div style={{ gridColumn: "1/-1" }}>
            <div style={modalLbl}>אמן מופיע</div>
            <ClientSelect
              clients={clients} value={form.artist_client_id}
              onChange={(id, name) => setForm(p => ({ ...p, artist_client_id: id, artist: name }))}
              placeholder="בחר אמן (VIP בלבד)" filterVip
            />
          </div>

          <div style={{ gridColumn: "1/-1" }}>
            <div style={modalLbl}>מזמין / לקוח</div>
            <ClientSelect
              clients={clients} value={form.booker_client_id}
              onChange={(id, name) => setForm(p => ({ ...p, booker_client_id: id, booker_name: name }))}
              placeholder="בחר מזמין"
              onCreateNew={() => setNewClientFor("booker")}
            />
          </div>

          <div>
            <div style={modalLbl}>איש קשר</div>
            <input value={form.contact_person} onChange={e => set("contact_person", e.target.value)} style={modalInp} placeholder="שם" />
          </div>
          <div>
            <div style={modalLbl}>טלפון</div>
            <input value={form.phone} onChange={e => set("phone", e.target.value)} style={modalInp} placeholder="05X-XXXXXXX" dir="ltr" />
          </div>

          <div>
            <div style={modalLbl}>תאריך</div>
            <input type="date" value={form.date} onChange={e => set("date", e.target.value)}
              style={{ ...modalInp, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
          </div>
          <div>
            <div style={modalLbl}>שעה</div>
            <input type="time" value={form.start_time} onChange={e => set("start_time", e.target.value)}
              style={{ ...modalInp, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
          </div>

          <div style={{ gridColumn: "1/-1" }}>
            <div style={modalLbl}>מקום</div>
            <input value={form.location} onChange={e => set("location", e.target.value)} style={modalInp} placeholder="שם הבמה / מקום" />
          </div>

          <div>
            <div style={modalLbl}>מחיר הופעה (₪)</div>
            <input type="number" value={form.show_price} onChange={e => set("show_price", e.target.value)} style={modalInp} min={0} placeholder="0" />
          </div>
          <div>
            <div style={modalLbl}>דיג׳יי (₪)</div>
            <input type="number" value={form.dj_fee} onChange={e => set("dj_fee", e.target.value)} style={modalInp} min={0} />
          </div>

          <div>
            <div style={modalLbl}>סטטוס</div>
            <select value={form.status} onChange={e => set("status", e.target.value)} style={{ ...modalInp, cursor: "pointer" }}>
              {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div style={modalLbl}>תשלום</div>
            <select value={form.payment_status} onChange={e => set("payment_status", e.target.value)} style={{ ...modalInp, cursor: "pointer" }}>
              {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Google Calendar checkbox */}
        <label style={{
          display: "flex", alignItems: "center", gap: 10, marginTop: 18,
          cursor: "pointer", padding: "10px 14px", borderRadius: 10,
          border: `1px solid ${addToCalendar ? "rgba(99,102,241,0.4)" : "#1A1A1A"}`,
          background: addToCalendar ? "rgba(99,102,241,0.08)" : "#0D0D0D",
          transition: "all 0.15s",
        }}>
          <input
            type="checkbox"
            checked={addToCalendar}
            onChange={e => setAddToCalendar(e.target.checked)}
            style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#6366F1" }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#C0C0C0" }}>📅 הוסף ליומן Google</div>
            {!form.date && addToCalendar && (
              <div style={{ fontSize: 11, color: "#F59E0B", marginTop: 2 }}>יש להגדיר תאריך להוספה ליומן</div>
            )}
          </div>
        </label>

        <button onClick={handleCreate} disabled={saving} style={{
          width: "100%", marginTop: 14, padding: "11px", borderRadius: 10,
          border: "none", background: "#6366F1", color: "#fff",
          fontWeight: 700, fontSize: 14, cursor: saving ? "wait" : "pointer",
        }}>
          {saving ? "יוצר..." : "✓ צור הופעה"}
        </button>
      </div>

      {newClientFor && (
        <CreateClientModal
          onCreated={c => {
            onClientAdded(c);
            setForm(p => ({ ...p, booker_client_id: c.id, booker_name: c.name }));
            setNewClientFor(null);
          }}
          onClose={() => setNewClientFor(null)}
        />
      )}
    </>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon }: { label: string; value: string | number; sub: string; color: string; icon: string }) {
  return (
    <div className="skin-card" style={{
      background: "#111", borderRadius: 14, padding: "20px 22px",
      border: "1px solid #1A1A1A", flex: 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#C0C0C0", marginTop: 6 }}>{label}</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>{sub}</div>
        </div>
        <div style={{ fontSize: 22, opacity: 0.4 }}>{icon}</div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const selSt: React.CSSProperties = {
  padding: "7px 11px", borderRadius: 8, border: "1px solid #1E1E1E",
  background: "#0D0D0D", color: "#C0C0C0", fontSize: 12, cursor: "pointer",
  outline: "none", fontFamily: "inherit",
};

export default function ShowsPage() {
  const [shows,   setShows]   = useState<Show[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [selected,  setSelected]  = useState<Show | null>(null);
  const [newModal,  setNewModal]  = useState(false);

  const [search,        setSearch]        = useState("");
  const [filterStatus,  setFilterStatus]  = useState<ShowStatus | "">("");
  const [filterPayment, setFilterPayment] = useState<PaymentStatus | "">("");
  const [filterMonth,   setFilterMonth]   = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/shows").then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d.shows as Show[]; }),
      fetch("/api/clients").then(r => r.json()).then(d => (d.clients ?? []) as Client[]),
    ])
      .then(([s, c]) => { setShows(s); setClients(c); })
      .catch(e => setError(e instanceof Error ? e.message : "שגיאה"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => shows.filter(s => {
    if (filterStatus  && s.status         !== filterStatus)  return false;
    if (filterPayment && s.payment_status !== filterPayment) return false;
    if (filterMonth   && s.date && !s.date.startsWith(filterMonth)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) &&
          !s.artist.toLowerCase().includes(q) &&
          !s.booker_name.toLowerCase().includes(q) &&
          !s.location.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [shows, search, filterStatus, filterPayment, filterMonth]);

  const now      = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const kpis = [
    { label: "הופעות החודש",        value: shows.filter(s => s.date?.startsWith(monthKey)).length,                               sub: `חודש ${now.getMonth() + 1}`,    color: "#60A5FA", icon: "📅" },
    { label: "ממתינות לפולואפ",     value: shows.filter(s => s.status === "צריך פולואפ" || s.status === "ממתין לתשובה").length, sub: "צריכות טיפול",                  color: "#F59E0B", icon: "⏰" },
    { label: "נסגרו",               value: shows.filter(s => s.status === "נסגר" || s.status === "בוצע").length,                sub: "מאושרות",                        color: "#10B981", icon: "✅" },
    { label: 'סה"כ הכנסות צפויות',  value: `₪${shows.filter(s => s.status !== "בוטל").reduce((sum, s) => sum + (s.show_price || 0), 0).toLocaleString()}`, sub: "לא כולל מבוטלות", color: "#A78BFA", icon: "💰" },
  ];

  // Table columns — fewer when drawer is open
  const cols = selected
    ? "1.6fr 0.9fr 0.9fr 80px 70px 36px"
    : "2fr 1fr 1fr 1fr 1fr 1fr 90px 70px 36px";
  const headers = selected
    ? ["שם ההופעה", "סטטוס", "תאריך", "סכום", "תשלום", ""]
    : ["שם ההופעה", "אמן", "מזמין", "תאריך", "מקום", "סטטוס", "סכום", "תשלום", ""];

  return (
    /* Outer: full height flex row — drawer on left, content on right */
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left: ShowDrawer panel ── */}
      {selected && (
        <ShowDrawer
          show={selected}
          clients={clients}
          onClose={() => setSelected(null)}
          onUpdated={s => { setShows(prev => prev.map(x => x.id === s.id ? s : x)); setSelected(s); }}
          onDeleted={id => { setShows(prev => prev.filter(x => x.id !== id)); setSelected(null); }}
          onClientAdded={c => setClients(prev => [...prev, c])}
        />
      )}

      {/* ── Right: Main content ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F0", margin: 0 }}>הופעות</h1>
            <p style={{ fontSize: 12, color: "#444", margin: "3px 0 0" }}>ניהול הופעות חיות</p>
          </div>
          <button onClick={() => setNewModal(true)} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 18px", borderRadius: 10, border: "none",
            background: "#6366F1", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            הופעה חדשה
          </button>
        </div>

        {/* KPI cards */}
        <div style={{ display: "flex", gap: 14, marginBottom: 24 }}>
          {kpis.map(k => <KpiCard key={k.label} {...k} />)}
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 180px", position: "relative" }}>
            <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "#444", fontSize: 13 }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש..."
              style={{ ...selSt, width: "100%", paddingRight: 30 }} />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as ShowStatus | "")} style={selSt}>
            <option value="">כל הסטטוסים</option>
            {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterPayment} onChange={e => setFilterPayment(e.target.value as PaymentStatus | "")} style={selSt}>
            <option value="">כל התשלומים</option>
            {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
            style={{ ...selSt, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#333" }}>טוען...</div>
        ) : error ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#EF4444" }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#333" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🎤</div>
            <div style={{ fontSize: 14 }}>{shows.length === 0 ? "אין הופעות עדיין" : "לא נמצאו תוצאות"}</div>
          </div>
        ) : (
          <div style={{ background: "#0D0D0D", borderRadius: 14, border: "1px solid #1A1A1A", overflow: "hidden" }}>
            {/* Header row */}
            <div style={{ display: "grid", gridTemplateColumns: cols, padding: "9px 16px", borderBottom: "1px solid #1A1A1A" }}>
              {headers.map(h => (
                <div key={h} style={{ fontSize: 10, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</div>
              ))}
            </div>
            {/* Data rows */}
            {filtered.map((show, i) => {
              const sc  = STATUS_COLOR[show.status];
              const pc  = PAYMENT_COLOR[show.payment_status];
              const isSel = selected?.id === show.id;
              return (
                <div
                  key={show.id}
                  onClick={() => setSelected(isSel ? null : show)}
                  style={{
                    display: "grid", gridTemplateColumns: cols,
                    padding: "12px 16px", cursor: "pointer",
                    borderBottom: i < filtered.length - 1 ? "1px solid #131313" : "none",
                    background: isSel ? "rgba(99,102,241,0.1)" : "transparent",
                    borderLeft: isSel ? "2px solid #6366F1" : "2px solid transparent",
                    transition: "background 0.1s",
                    alignItems: "center",
                  }}
                  onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#E0E0E0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {show.name}
                  </div>
                  {!selected && (
                    <>
                      <div style={{ fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.artist || "—"}</div>
                      <div style={{ fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.booker_name || "—"}</div>
                    </>
                  )}
                  <div style={{ fontSize: 12, color: "#555" }}>{fmtDate(show.date)}</div>
                  {!selected && (
                    <div style={{ fontSize: 12, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.location || "—"}</div>
                  )}
                  <div><Badge bg={sc.bg} text={sc.text}>{show.status}</Badge></div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#C0C0C0" }}>₪{(show.show_price || 0).toLocaleString()}</div>
                  <div><Badge bg={pc.bg} text={pc.text}>{show.payment_status}</Badge></div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 14 }}>›</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {newModal && (
        <NewShowModal
          clients={clients}
          onCreated={s => { setShows(prev => [s, ...prev]); setNewModal(false); setSelected(s); }}
          onClose={() => setNewModal(false)}
          onClientAdded={c => setClients(prev => [...prev, c])}
        />
      )}
    </div>
  );
}
