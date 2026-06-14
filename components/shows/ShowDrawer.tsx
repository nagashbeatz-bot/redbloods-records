"use client";

import { useState } from "react";
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

const inp: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 8,
  border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600,
  letterSpacing: "0.06em", textTransform: "uppercase",
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
        {filtered.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {onCreateNew && (
        <button
          onClick={onCreateNew}
          type="button"
          style={{
            padding: "7px 10px", borderRadius: 8, border: "1px solid #2A2A2A",
            background: "none", color: "#6366F1", cursor: "pointer", fontSize: 11,
            fontWeight: 700, whiteSpace: "nowrap",
          }}
        >+ צור</button>
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
  const [newClientModal, setNewClientModal] = useState(false);

  const [draft, setDraft] = useState<Show>({ ...show });

  function set<K extends keyof Show>(k: K, v: Show[K]) {
    setDraft(prev => ({ ...prev, [k]: v }));
  }

  const sc = STATUS_COLOR[draft.status];
  const pc = PAYMENT_COLOR[draft.payment_status];

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
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 399 }} />

      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: 360, background: "#111", borderLeft: "1px solid #2A2A2A",
        zIndex: 400, display: "flex", flexDirection: "column", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #1E1E1E" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F0", lineHeight: 1.3 }}>{draft.name}</div>
              {(draft.artist || draft.booker_name) && (
                <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                  {draft.artist && <span>{draft.artist}</span>}
                  {draft.artist && draft.booker_name && <span style={{ color: "#444", margin: "0 4px" }}>·</span>}
                  {draft.booker_name && <span>{draft.booker_name}</span>}
                </div>
              )}
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
          {error && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#EF4444", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12 }}>
              {error}
            </div>
          )}

          {tab === "תקציר" && (
            <div>
              <div style={{ marginBottom: 14 }}>
                <div style={lbl}>שם ההופעה</div>
                <input value={draft.name} onChange={e => set("name", e.target.value)} style={inp} />
              </div>

              {/* Artist — VIP clients only */}
              <div style={{ marginBottom: 14 }}>
                <div style={lbl}>אמן מופיע</div>
                <ClientSelect
                  clients={clients}
                  value={draft.artist_client_id ?? ""}
                  onChange={(id, name) => setDraft(p => ({ ...p, artist_client_id: id || null, artist: name }))}
                  placeholder="בחר אמן (VIP)"
                  filterVip
                />
                {draft.artist && !draft.artist_client_id && (
                  <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>שמור: {draft.artist}</div>
                )}
              </div>

              {/* Booker — all clients */}
              <div style={{ marginBottom: 14 }}>
                <div style={lbl}>מזמין / לקוח</div>
                <ClientSelect
                  clients={clients}
                  value={draft.booker_client_id ?? ""}
                  onChange={(id, name) => setDraft(p => ({ ...p, booker_client_id: id || null, booker_name: name }))}
                  placeholder="בחר מזמין"
                  onCreateNew={() => setNewClientModal(true)}
                />
                {draft.booker_name && !draft.booker_client_id && (
                  <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>שמור: {draft.booker_name}</div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
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

              {/* Finance summary */}
              <div style={{ background: "#0D0D0D", borderRadius: 10, padding: "14px 16px", marginBottom: 14, border: "1px solid #1E1E1E" }}>
                {[
                  { label: "מחיר הופעה", value: draft.show_price || 0, color: "#F0F0F0" },
                  { label: "מקדמה",       value: draft.advance_payment || 0, color: "#F59E0B" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: "#888" }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color }}>₪{value.toLocaleString()}</span>
                  </div>
                ))}
                <div style={{ height: 1, background: "#1E1E1E", margin: "8px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "#888" }}>יתרה לתשלום</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: remaining > 0 ? "#10B981" : "#6B7280" }}>₪{remaining.toLocaleString()}</span>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={lbl}>סטטוס</div>
                <select value={draft.status} onChange={e => set("status", e.target.value as ShowStatus)} style={{ ...inp, cursor: "pointer" }}>
                  {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={lbl}>סטטוס תשלום</div>
                <select value={draft.payment_status} onChange={e => set("payment_status", e.target.value as PaymentStatus)} style={{ ...inp, cursor: "pointer" }}>
                  {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}

          {tab === "כספים" && (
            <div>
              {[
                { key: "show_price" as const,      label: "מחיר הופעה (₪)" },
                { key: "dj_fee" as const,           label: "דיג׳יי (₪)" },
                { key: "advance_payment" as const,  label: "מקדמה (₪)" },
              ].map(({ key, label }) => (
                <div key={key} style={{ marginBottom: 14 }}>
                  <div style={lbl}>{label}</div>
                  <input type="number" value={draft[key] as number}
                    onChange={e => set(key, Number(e.target.value) || 0)} style={inp} min={0} />
                </div>
              ))}

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
              {[
                { key: "location"       as const, label: "מקום",      ph: "שם הבמה / מקום" },
                { key: "contact_person" as const, label: "איש קשר",   ph: "שם מלא" },
                { key: "phone"          as const, label: "טלפון",     ph: "05X-XXXXXXX", dir: "ltr" as const },
              ].map(({ key, label, ph, dir }) => (
                <div key={key} style={{ marginBottom: 14 }}>
                  <div style={lbl}>{label}</div>
                  <input value={draft[key] as string} onChange={e => set(key, e.target.value)} style={inp} placeholder={ph} dir={dir} />
                </div>
              ))}
              <div style={{ marginBottom: 14 }}>
                <div style={lbl}>הערות</div>
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
