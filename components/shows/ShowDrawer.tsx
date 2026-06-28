"use client";

import { useEffect, useState } from "react";
import type { Show, ShowStatus, PaymentStatus } from "@/lib/shows-types";
import { SHOW_STATUSES, PAYMENT_STATUSES } from "@/lib/shows-types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Client { id: string; name: string; phone: string; status: string; type: string; }

// ─── Colors ───────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<ShowStatus, { bg: string; text: string }> = {
  "ליד חדש":        { bg: "rgba(59,130,246,0.15)",  text: "#60A5FA" },
  "ממתין לתשובה":   { bg: "rgba(245,158,11,0.15)",  text: "#F59E0B" },
  "צריך פולואפ":    { bg: "rgba(239,68,68,0.15)",   text: "#EF4444" },
  "נסגר":           { bg: "rgba(16,185,129,0.15)",  text: "#10B981" },
  "אושרה":          { bg: "rgba(99,102,241,0.15)",  text: "#818CF8" },
  "בוצע":           { bg: "rgba(167,139,250,0.15)", text: "#A78BFA" },
  "בוטל":           { bg: "rgba(107,114,128,0.15)", text: "#6B7280" },
};
const PAYMENT_COLOR: Record<PaymentStatus, { bg: string; text: string }> = {
  "שולם":    { bg: "rgba(16,185,129,0.15)",  text: "#10B981" },
  "לא שולם": { bg: "rgba(239,68,68,0.15)",   text: "#EF4444" },
  "צפוי":    { bg: "rgba(59,130,246,0.15)",  text: "#3B82F6" },
  "מקדמה":   { bg: "rgba(245,158,11,0.15)",  text: "#F59E0B" },
  "בוטל":    { bg: "rgba(107,114,128,0.15)", text: "#9CA3AF" },
  "חלקי":    { bg: "rgba(245,158,11,0.15)",  text: "#F59E0B" },
};

function Badge({ children, bg, text }: { children: React.ReactNode; bg: string; text: string }) {
  return (
    <span style={{ background: bg, color: text, borderRadius: 100, padding: "3px 10px", fontSize: 11, fontWeight: 600 }}>
      {children}
    </span>
  );
}

const inp: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 8,
  border: "1px solid #222", background: "#0D0D0D", color: "#E0E0E0",
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600,
  letterSpacing: "0.06em", textTransform: "uppercase",
};
const card: React.CSSProperties = {
  background: "#0D0D0D", borderRadius: 10, padding: "14px 16px",
  border: "1px solid #1A1A1A", marginBottom: 14,
};

// ─── Create Client Modal ──────────────────────────────────────────────────────

function CreateClientModal({ onCreated, onClose }: {
  onCreated: (c: Client) => void;
  onClose: () => void;
}) {
  const [name,  setName]  = useState("");
  const [phone, setPhone] = useState("");
  const [saving,setSaving]= useState(false);
  const [err,   setErr]   = useState<string | null>(null);

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
        width: 320, zIndex: 600, padding: 24,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F0", marginBottom: 16 }}>לקוח חדש</div>
        {err && <div style={{ color: "#EF4444", fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <div style={{ marginBottom: 12 }}>
          <div style={lbl}>שם *</div>
          <input value={name} onChange={e => setName(e.target.value)} style={inp} autoFocus />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={lbl}>טלפון</div>
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
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select
        value={value}
        onChange={e => {
          const c = clients.find(x => x.id === e.target.value);
          onChange(e.target.value, c?.name ?? "");
        }}
        style={{ flex: 1, ...inp, cursor: "pointer" }}
      >
        <option value="">{placeholder}</option>
        {filtered.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {onCreateNew && (
        <button onClick={onCreateNew} type="button" style={{
          padding: "7px 10px", borderRadius: 8, border: "1px solid #222",
          background: "none", color: "#6366F1", cursor: "pointer", fontSize: 11,
          fontWeight: 700, whiteSpace: "nowrap",
        }}>+ צור</button>
      )}
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = "תקציר" | "כספים" | "לוגיסטיקה" | "קבצים" | "משימות";
const TABS: Tab[] = ["תקציר", "כספים", "לוגיסטיקה", "קבצים", "משימות"];

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  show: Show;
  clients: Client[];
  onClose: () => void;
  onUpdated: (s: Show) => void;
  onDeleted: (id: string) => void;
  onClientAdded: (c: Client) => void;
}

export default function ShowDrawer({ show, clients, onClose, onUpdated, onDeleted, onClientAdded }: Props) {
  const [tab,      setTab]      = useState<Tab>("תקציר");
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [calWarn,  setCalWarn]  = useState<string | null>(null);
  const [addingCal,setAddingCal]= useState(false);
  const [newClientModal, setNewClientModal] = useState(false);

  const [draft, setDraft] = useState<Show>({ ...show });

  // If artist_client_id is set but artist text is empty, sync name from clients list
  useEffect(() => {
    if (!draft.artist && draft.artist_client_id) {
      const c = clients.find(x => x.id === draft.artist_client_id);
      if (c?.name) setDraft(p => ({ ...p, artist: c.name }));
    }
  }, [clients]); // eslint-disable-line react-hooks/exhaustive-deps

  function set<K extends keyof Show>(k: K, v: Show[K]) {
    setDraft(prev => ({ ...prev, [k]: v }));
  }

  const sc = STATUS_COLOR[draft.status];
  const pc = PAYMENT_COLOR[draft.payment_status];

  const distributable = Math.max(0, (draft.show_price || 0) - (draft.dj_fee || 0));
  const remaining     = Math.max(0, (draft.show_price || 0) - (draft.advance_payment || 0));

  const dirty = JSON.stringify(draft) !== JSON.stringify(show);

  async function save() {
    setSaving(true); setError(null); setCalWarn(null);
    try {
      const res = await fetch(`/api/shows/${show.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:             draft.name,
          artist:           draft.artist,
          artist_client_id: draft.artist_client_id,
          booker_client_id: draft.booker_client_id,
          booker_name:      draft.booker_name,
          date:             draft.date,
          start_time:       draft.start_time,
          location:         draft.location,
          contact_person:   draft.contact_person,
          phone:            draft.phone,
          status:           draft.status,
          payment_status:   draft.payment_status,
          show_price:       draft.show_price,
          dj_fee:           draft.dj_fee,
          advance_payment:  draft.advance_payment,
          notes:            draft.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה בשמירה");
      if (data.calendarWarning) setCalWarn(data.calendarWarning);
      onUpdated(data.show);
      setDraft(data.show);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally { setSaving(false); }
  }

  async function handleAddToCalendar() {
    if (!draft.date) { setError("צריך להגדיר תאריך להופעה לפני הוספה ליומן"); return; }
    setAddingCal(true); setError(null); setCalWarn(null);
    try {
      const res = await fetch(`/api/shows/${show.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Send current draft artist so server can use it even if DB is stale
        body: JSON.stringify({
          addToCalendar:    true,
          artist:           draft.artist,
          artist_client_id: draft.artist_client_id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      if (data.calendarWarning) setCalWarn(data.calendarWarning);
      onUpdated(data.show);
      setDraft(data.show);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally { setAddingCal(false); }
  }

  async function handleRemoveFromCalendar() {
    setAddingCal(true); setError(null); setCalWarn(null);
    try {
      const res = await fetch(`/api/shows/${show.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeFromCalendar: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      onUpdated(data.show);
      setDraft(data.show);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally { setAddingCal(false); }
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
      {/* Panel — static left column, no overlay */}
      <div style={{
        width: 440, flexShrink: 0,
        background: "#111",
        borderRight: "1px solid #1E1E1E",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 20px 0", borderBottom: "1px solid #1E1E1E", paddingBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#F0F0F0", lineHeight: 1.3 }}>{draft.name}</div>
              {(draft.artist || draft.booker_name) && (
                <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>
                  {draft.artist && <span>{draft.artist}</span>}
                  {draft.artist && draft.booker_name && <span style={{ color: "#333", margin: "0 5px" }}>·</span>}
                  {draft.booker_name && <span>{draft.booker_name}</span>}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{
              color: "#444", fontSize: 20, background: "none", border: "none",
              cursor: "pointer", lineHeight: 1, flexShrink: 0, padding: "2px 6px",
              borderRadius: 6,
            }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Badge bg={sc.bg} text={sc.text}>{draft.status}</Badge>
            <Badge bg={pc.bg} text={pc.text}>{draft.payment_status}</Badge>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1A1A1A" }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "11px 4px", fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: "none", border: "none", whiteSpace: "nowrap",
              borderBottom: `2px solid ${tab === t ? "#6366F1" : "transparent"}`,
              color: tab === t ? "#6366F1" : "#444",
              transition: "color 0.15s",
            }}>{t}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
          {error && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#EF4444", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12 }}>
              {error}
            </div>
          )}
          {calWarn && (
            <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", color: "#F59E0B", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12 }}>
              {calWarn}
            </div>
          )}

          {/* ── תקציר ── */}
          {tab === "תקציר" && (
            <div>
              <div style={card}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>פרטי הופעה</div>
                <div style={{ marginBottom: 12 }}>
                  <div style={lbl}>שם ההופעה</div>
                  <input value={draft.name} onChange={e => set("name", e.target.value)} style={inp} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={lbl}>תאריך</div>
                    <input type="date" value={draft.date ?? ""} onChange={e => set("date", e.target.value || null)}
                      style={{ ...inp, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
                  </div>
                  <div>
                    <div style={lbl}>שעה</div>
                    <input type="time" value={draft.start_time ?? ""} onChange={e => set("start_time", e.target.value || null)}
                      style={{ ...inp, colorScheme: "dark" as React.CSSProperties["colorScheme"] }} />
                  </div>
                </div>
              </div>

              <div style={card}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>אמן ומזמין</div>
                <div style={{ marginBottom: 12 }}>
                  <div style={lbl}>אמן מופיע (VIP)</div>
                  <ClientSelect
                    clients={clients} value={draft.artist_client_id ?? ""}
                    onChange={(id, name) => setDraft(p => ({ ...p, artist_client_id: id || null, artist: name }))}
                    placeholder="בחר אמן" filterVip
                  />
                  {draft.artist && !draft.artist_client_id && (
                    <div style={{ fontSize: 10, color: "#444", marginTop: 3 }}>{draft.artist}</div>
                  )}
                </div>
                <div>
                  <div style={lbl}>מזמין / לקוח</div>
                  <ClientSelect
                    clients={clients} value={draft.booker_client_id ?? ""}
                    onChange={(id, name) => setDraft(p => ({ ...p, booker_client_id: id || null, booker_name: name }))}
                    placeholder="בחר מזמין"
                    onCreateNew={() => setNewClientModal(true)}
                  />
                  {draft.booker_name && !draft.booker_client_id && (
                    <div style={{ fontSize: 10, color: "#444", marginTop: 3 }}>{draft.booker_name}</div>
                  )}
                </div>
              </div>

              <div style={card}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>סטטוס</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={lbl}>סטטוס</div>
                    <select value={draft.status} onChange={e => set("status", e.target.value as ShowStatus)} style={{ ...inp, cursor: "pointer" }}>
                      {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={lbl}>תשלום</div>
                    <select value={draft.payment_status} onChange={e => set("payment_status", e.target.value as PaymentStatus)} style={{ ...inp, cursor: "pointer" }}>
                      {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Google Calendar card */}
              <div style={{ background: "#0A0A0A", borderRadius: 10, padding: "14px 16px", border: "1px solid #1A1A1A", marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>📅</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#C0C0C0" }}>Google Calendar</div>
                      {draft.calendar_event_id
                        ? <div style={{ fontSize: 11, color: "#10B981", marginTop: 1 }}>✓ נוסף ליומן</div>
                        : <div style={{ fontSize: 11, color: "#444", marginTop: 1 }}>לא נוסף עדיין</div>
                      }
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {draft.calendar_event_id ? (
                      <button
                        onClick={handleRemoveFromCalendar}
                        disabled={addingCal}
                        style={{
                          padding: "6px 10px", borderRadius: 8,
                          border: "1px solid #2A2A2A", background: "none",
                          color: "#EF4444", cursor: "pointer", fontSize: 11, fontWeight: 600,
                        }}
                      >
                        {addingCal ? "..." : "הסר"}
                      </button>
                    ) : (
                      <button
                        onClick={handleAddToCalendar}
                        disabled={addingCal || !draft.date}
                        title={!draft.date ? "צריך תאריך להוספה ליומן" : "הוסף ליומן Google"}
                        style={{
                          padding: "6px 12px", borderRadius: 8,
                          border: "1px solid #2A2A2A", background: "none",
                          color: draft.date ? "#6366F1" : "#333",
                          cursor: draft.date ? "pointer" : "not-allowed",
                          fontSize: 12, fontWeight: 600,
                        }}
                      >
                        {addingCal ? "מוסיף..." : "+ הוסף ליומן"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Finance summary card */}
              <div style={{ background: "#0A0A0A", borderRadius: 10, padding: "14px 16px", border: "1px solid #1A1A1A" }}>
                {[
                  { label: "מחיר שוסכם", value: `₪${(draft.show_price || 0).toLocaleString()}`, color: "#F0F0F0" },
                  { label: "מקדמה",       value: `₪${(draft.advance_payment || 0).toLocaleString()}`, color: "#F59E0B" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: "#555" }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
                  </div>
                ))}
                <div style={{ height: 1, background: "#1A1A1A", margin: "10px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#555" }}>יתרה לתשלום</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: remaining > 0 ? "#10B981" : "#6B7280" }}>₪{remaining.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── כספים ── */}
          {tab === "כספים" && (
            <div>
              <div style={card}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>עריכת כספים</div>
                {([
                  ["show_price",     "מחיר הופעה (₪)"],
                  ["dj_fee",         "דיג׳יי (₪)"],
                  ["advance_payment","מקדמה (₪)"],
                ] as [keyof Show, string][]).map(([key, label]) => (
                  <div key={key as string} style={{ marginBottom: 12 }}>
                    <div style={lbl}>{label}</div>
                    <input type="number" value={draft[key] as number}
                      onChange={e => set(key, Number(e.target.value) || 0)} style={inp} min={0} />
                  </div>
                ))}
              </div>

              <div style={{ background: "#0A0A0A", borderRadius: 10, padding: "16px", border: "1px solid #1A1A1A" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>פירוט חלוקה</div>
                {[
                  { label: "מחיר הופעה",     value: draft.show_price || 0,    color: "#F0F0F0", neg: false },
                  { label: "הפחתת דיג׳יי",    value: draft.dj_fee || 0,        color: "#EF4444", neg: true  },
                  { label: "יתרה לחלוקה",     value: distributable,            color: "#F59E0B", neg: false },
                  { label: "חלק אמן (50%)",    value: distributable / 2,       color: "#60A5FA", neg: false },
                  { label: "חלק לייבל (50%)",  value: distributable / 2,       color: "#C084FC", neg: false },
                ].map(({ label, value, color, neg }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: "#555" }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color }}>{neg ? "-" : ""}₪{value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── לוגיסטיקה ── */}
          {tab === "לוגיסטיקה" && (
            <div style={card}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>פרטי לוגיסטיקה</div>
              {([
                ["location",       "מקום",      "שם הבמה / מקום",  undefined],
                ["contact_person", "איש קשר",   "שם מלא",          undefined],
                ["phone",          "טלפון",     "05X-XXXXXXX",     "ltr"],
              ] as [keyof Show, string, string, string | undefined][]).map(([key, label, ph, dir]) => (
                <div key={key as string} style={{ marginBottom: 12 }}>
                  <div style={lbl}>{label}</div>
                  <input value={draft[key] as string} onChange={e => set(key, e.target.value)} style={inp} placeholder={ph} dir={dir} />
                </div>
              ))}
              <div>
                <div style={lbl}>הערות</div>
                <textarea value={draft.notes} onChange={e => set("notes", e.target.value)}
                  rows={5} style={{ ...inp, resize: "vertical", lineHeight: 1.6 }} placeholder="פרטים נוספים..." />
              </div>
            </div>
          )}

          {tab === "קבצים" && (
            <div style={{ ...card, textAlign: "center", color: "#333", padding: "40px 0", fontSize: 13 }}>
              🗂 ניהול קבצים יתווסף בהמשך
            </div>
          )}

          {tab === "משימות" && (
            <div style={{ ...card, textAlign: "center", color: "#333", padding: "40px 0", fontSize: 13 }}>
              ✓ ניהול משימות להופעה יתווסף בהמשך
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid #1A1A1A", display: "flex", gap: 8, alignItems: "center" }}>
          {confirmDel ? (
            <>
              <span style={{ fontSize: 12, color: "#666", flex: 1 }}>למחוק את ההופעה?</span>
              <button onClick={() => setConfirmDel(false)} disabled={deleting}
                style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #333", background: "none", color: "#666", cursor: "pointer", fontSize: 12 }}>
                ביטול
              </button>
              <button onClick={handleDelete} disabled={deleting}
                style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#EF4444", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                {deleting ? "מוחק..." : "מחק"}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setConfirmDel(true)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #1E1E1E", background: "none", color: "#444", cursor: "pointer", fontSize: 13 }}>
                🗑
              </button>
              {dirty && (
                <button onClick={save} disabled={saving} style={{
                  flex: 1, padding: "9px", borderRadius: 8, border: "none",
                  background: "#6366F1", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13,
                }}>
                  {saving ? "שומר..." : "✓ שמור שינויים"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {newClientModal && (
        <CreateClientModal
          onCreated={c => {
            onClientAdded(c);
            setDraft(p => ({ ...p, booker_client_id: c.id, booker_name: c.name }));
            setNewClientModal(false);
          }}
          onClose={() => setNewClientModal(false)}
        />
      )}
    </>
  );
}
