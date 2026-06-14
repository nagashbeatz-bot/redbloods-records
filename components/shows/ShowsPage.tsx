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
  return <span className="badge" style={{ background: bg, color: text }}>{children}</span>;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

// ─── Client select component ──────────────────────────────────────────────────

function ClientSelect({ clients, value, onChange, placeholder, filterVip, onCreateNew }: {
  clients: Client[];
  value: string;
  onChange: (id: string, name: string) => void;
  placeholder: string;
  filterVip?: boolean;
  onCreateNew?: () => void;
}) {
  const filtered = filterVip ? clients.filter(c => c.status === "VIP") : clients;
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select
        value={value}
        onChange={e => {
          const c = clients.find(x => x.id === e.target.value);
          onChange(e.target.value, c?.name ?? "");
        }}
        style={{
          flex: 1, padding: "8px 10px", borderRadius: 8,
          border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
          fontSize: 13, fontFamily: "inherit", outline: "none",
        }}
      >
        <option value="">{placeholder}</option>
        {filtered.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {onCreateNew && (
        <button
          onClick={onCreateNew}
          type="button"
          style={{
            padding: "8px 10px", borderRadius: 8, border: "1px solid #2A2A2A",
            background: "none", color: "#6366F1", cursor: "pointer", fontSize: 12,
            fontWeight: 700, whiteSpace: "nowrap",
          }}
        >+ צור לקוח</button>
      )}
    </div>
  );
}

// ─── Create Client Modal (quick) ──────────────────────────────────────────────

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

// ─── New Show Modal ───────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  fontSize: 11, color: "#555", marginBottom: 4, fontWeight: 600,
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
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [newClientFor, setNewClientFor] = useState<"artist" | "booker" | null>(null);

  function set(k: string, v: string) { setForm(prev => ({ ...prev, [k]: v })); }

  async function handleCreate() {
    if (!form.name.trim()) { setError("שם ההופעה חובה"); return; }
    setSaving(true); setError(null);
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
        width: 500, maxWidth: "95vw", maxHeight: "88vh", overflowY: "auto",
        zIndex: 500, padding: 24,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#F0F0F0" }}>הופעה חדשה</div>
          <button onClick={onClose} style={{ color: "#555", fontSize: 18, background: "none", border: "none", cursor: "pointer" }}>×</button>
        </div>

        {error && <div style={{ color: "#EF4444", fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* שם הופעה — full width */}
          <div style={{ gridColumn: "1/-1" }}>
            <div style={lbl}>שם ההופעה *</div>
            <input value={form.name} onChange={e => set("name", e.target.value)} style={inp} placeholder="לדוגמה: שליו טסמה — זאפה ירושלים" autoFocus />
          </div>

          {/* אמן מופיע */}
          <div style={{ gridColumn: "1/-1" }}>
            <div style={lbl}>אמן מופיע</div>
            <ClientSelect
              clients={clients}
              value={form.artist_client_id}
              onChange={(id, name) => setForm(p => ({ ...p, artist_client_id: id, artist: name }))}
              placeholder="בחר אמן מהרשימה (VIP)"
              filterVip
            />
          </div>

          {/* מזמין / לקוח */}
          <div style={{ gridColumn: "1/-1" }}>
            <div style={lbl}>מזמין / לקוח</div>
            <ClientSelect
              clients={clients}
              value={form.booker_client_id}
              onChange={(id, name) => setForm(p => ({ ...p, booker_client_id: id, booker_name: name }))}
              placeholder="בחר מזמין מהרשימה"
              onCreateNew={() => setNewClientFor("booker")}
            />
          </div>

          {/* איש קשר + טלפון */}
          <div>
            <div style={lbl}>איש קשר</div>
            <input value={form.contact_person} onChange={e => set("contact_person", e.target.value)} style={inp} placeholder="שם" />
          </div>
          <div>
            <div style={lbl}>טלפון</div>
            <input value={form.phone} onChange={e => set("phone", e.target.value)} style={inp} placeholder="05X-XXXXXXX" dir="ltr" />
          </div>

          {/* תאריך + שעה */}
          <div>
            <div style={lbl}>תאריך</div>
            <input type="date" value={form.date} onChange={e => set("date", e.target.value)}
              style={{ ...inp, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
          </div>
          <div>
            <div style={lbl}>שעה</div>
            <input type="time" value={form.start_time} onChange={e => set("start_time", e.target.value)}
              style={{ ...inp, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
          </div>

          {/* מקום */}
          <div style={{ gridColumn: "1/-1" }}>
            <div style={lbl}>מקום</div>
            <input value={form.location} onChange={e => set("location", e.target.value)} style={inp} placeholder="שם הבמה / מקום" />
          </div>

          {/* מחיר + דיג׳יי */}
          <div>
            <div style={lbl}>מחיר הופעה (₪)</div>
            <input type="number" value={form.show_price} onChange={e => set("show_price", e.target.value)} style={inp} min={0} placeholder="0" />
          </div>
          <div>
            <div style={lbl}>דיג׳יי (₪)</div>
            <input type="number" value={form.dj_fee} onChange={e => set("dj_fee", e.target.value)} style={inp} min={0} />
          </div>

          {/* סטטוס + תשלום */}
          <div>
            <div style={lbl}>סטטוס</div>
            <select value={form.status} onChange={e => set("status", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div style={lbl}>תשלום</div>
            <select value={form.payment_status} onChange={e => set("payment_status", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={saving}
          style={{
            width: "100%", marginTop: 20, padding: "10px", borderRadius: 10,
            border: "none", background: "#6366F1", color: "#fff",
            fontWeight: 700, fontSize: 14, cursor: saving ? "wait" : "pointer",
          }}
        >
          {saving ? "יוצר..." : "✓ צור הופעה"}
        </button>
      </div>

      {newClientFor && (
        <CreateClientModal
          onCreated={c => {
            onClientAdded(c);
            if (newClientFor === "booker") setForm(p => ({ ...p, booker_client_id: c.id, booker_name: c.name }));
            setNewClientFor(null);
          }}
          onClose={() => setNewClientFor(null)}
        />
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ShowsPage() {
  const [shows,   setShows]   = useState<Show[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [selected,  setSelected]  = useState<Show | null>(null);
  const [newModal,  setNewModal]  = useState(false);

  // filters
  const [search,        setSearch]        = useState("");
  const [filterStatus,  setFilterStatus]  = useState<ShowStatus | "">("");
  const [filterPayment, setFilterPayment] = useState<PaymentStatus | "">("");
  const [filterMonth,   setFilterMonth]   = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/shows").then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "שגיאה");
        return d.shows as Show[];
      }),
      fetch("/api/clients").then(r => r.json()).then(d => (d.clients ?? []) as Client[]),
    ])
      .then(([s, c]) => { setShows(s); setClients(c); })
      .catch(e => setError(e instanceof Error ? e.message : "שגיאה בטעינה"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => shows.filter(s => {
    if (filterStatus  && s.status         !== filterStatus)  return false;
    if (filterPayment && s.payment_status !== filterPayment) return false;
    if (filterMonth   && s.date           && !s.date.startsWith(filterMonth)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) &&
          !s.artist.toLowerCase().includes(q) &&
          !s.booker_name.toLowerCase().includes(q) &&
          !s.location.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [shows, search, filterStatus, filterPayment, filterMonth]);

  // KPI cards
  const now      = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const CARDS = [
    { label: "הופעות החודש",       value: shows.filter(s => s.date?.startsWith(monthKey)).length, sub: `חודש ${now.getMonth() + 1}`, color: "#60A5FA" },
    { label: "ממתינות לפולואפ",    value: shows.filter(s => s.status === "צריך פולואפ" || s.status === "ממתין לתשובה").length, sub: "צריכות טיפול", color: "#F59E0B" },
    { label: "נסגרו",              value: shows.filter(s => s.status === "נסגר" || s.status === "בוצע").length, sub: "הופעות מאושרות", color: "#10B981" },
    { label: 'סה"כ הכנסות צפויות', value: `₪${shows.filter(s => s.status !== "בוטל").reduce((sum, s) => sum + (s.show_price || 0), 0).toLocaleString()}`, sub: "לא כולל מבוטלות", color: "#A78BFA" },
  ];

  const sel: React.CSSProperties = {
    padding: "6px 10px", borderRadius: 8, border: "1px solid #2A2A2A",
    background: "#111", color: "#E0E0E0", fontSize: 12, cursor: "pointer", outline: "none",
  };

  return (
    <div style={{ padding: "24px 28px", minHeight: "100%", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F0", margin: 0 }}>הופעות</h1>
          <p style={{ fontSize: 13, color: "#555", margin: "4px 0 0" }}>ניהול הופעות חיות</p>
        </div>
        <button onClick={() => setNewModal(true)} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 18px", borderRadius: 10, border: "none",
          background: "#6366F1", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
          הופעה חדשה
        </button>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
        {CARDS.map(({ label, value, sub, color }) => (
          <div key={label} className="skin-card" style={{ background: "#141414", borderRadius: 14, padding: "18px 20px", border: "1px solid #2A2A2A" }}>
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
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש הופעה / אמן / מזמין / מקום"
            style={{ ...sel, width: "100%", paddingRight: 32 }} />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as ShowStatus | "")} style={sel}>
          <option value="">כל הסטטוסים</option>
          {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterPayment} onChange={e => setFilterPayment(e.target.value as PaymentStatus | "")} style={sel}>
          <option value="">כל התשלומים</option>
          {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
          style={{ ...sel, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#444" }}>טוען...</div>
      ) : error ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#EF4444" }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#444" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🎤</div>
          <div style={{ fontSize: 14 }}>{shows.length === 0 ? "אין הופעות עדיין — צור הופעה ראשונה" : "לא נמצאו תוצאות"}</div>
        </div>
      ) : (
        <div style={{ background: "#141414", borderRadius: 14, border: "1px solid #2A2A2A", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr 80px 36px", padding: "10px 16px", borderBottom: "1px solid #1E1E1E" }}>
            {["שם ההופעה","אמן","מזמין","תאריך","מקום","סטטוס","תשלום","סכום",""].map(h => (
              <div key={h} className="tbl-header">{h}</div>
            ))}
          </div>
          {filtered.map((show, i) => {
            const sc = STATUS_COLOR[show.status];
            const pc = PAYMENT_COLOR[show.payment_status];
            const isSelected = selected?.id === show.id;
            return (
              <div key={show.id} onClick={() => setSelected(show)}
                style={{
                  display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr 80px 36px",
                  padding: "12px 16px", borderBottom: i < filtered.length - 1 ? "1px solid #1A1A1A" : "none",
                  cursor: "pointer", background: isSelected ? "rgba(99,102,241,0.08)" : "transparent",
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "#E0E0E0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.name}</div>
                <div style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.artist || "—"}</div>
                <div style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.booker_name || "—"}</div>
                <div style={{ fontSize: 12, color: "#888" }}>{fmtDate(show.date)}</div>
                <div style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.location || "—"}</div>
                <div><Badge bg={sc.bg} text={sc.text}>{show.status}</Badge></div>
                <div><Badge bg={pc.bg} text={pc.text}>{show.payment_status}</Badge></div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#E0E0E0" }}>₪{(show.show_price || 0).toLocaleString()}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 16 }}>›</div>
              </div>
            );
          })}
        </div>
      )}

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
