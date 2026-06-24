"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Show, ShowStatus, PaymentStatus } from "@/lib/shows-types";
import { SHOW_STATUSES, PAYMENT_STATUSES } from "@/lib/shows-types";
import DatePickerInput from "@/components/ui/DatePickerInput";

// ─── Design tokens ─────────────────────────────────────────────────────────
const BG    = "#080808";
const BG2   = "#101010";
const CARD  = "rgba(255,255,255,0.032)";
const CARD2 = "rgba(255,255,255,0.07)";
const BDR   = "rgba(255,255,255,0.08)";
const BDR2  = "rgba(255,255,255,0.15)";
const TEXT  = "#F2F2F2";
const TEXT2 = "#A0A0B0";
const MUTED = "#52526A";
const BRAND = "#DC2626";
const GREEN = "#10B981";
const AMBER = "#F59E0B";
const BLUE  = "#3B82F6";
const PURPLE = "#8B5CF6";

const STATUS_COLOR: Record<ShowStatus, { bg: string; text: string }> = {
  "ליד חדש":      { bg: "rgba(59,130,246,0.18)",  text: "#60A5FA" },
  "ממתין לתשובה": { bg: "rgba(245,158,11,0.18)",  text: "#F59E0B" },
  "צריך פולואפ":  { bg: "rgba(239,68,68,0.18)",   text: "#EF4444" },
  "נסגר":         { bg: "rgba(16,185,129,0.18)",  text: "#10B981" },
  "בוצע":         { bg: "rgba(167,139,250,0.18)", text: "#A78BFA" },
  "בוטל":         { bg: "rgba(107,114,128,0.18)", text: "#6B7280" },
};
const PAY_COLOR: Record<PaymentStatus, { bg: string; text: string }> = {
  "לא שולם": { bg: "rgba(239,68,68,0.18)",   text: "#EF4444" },
  "חלקי":    { bg: "rgba(245,158,11,0.18)",  text: "#F59E0B" },
  "שולם":    { bg: "rgba(16,185,129,0.18)",  text: "#10B981" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtIls(n: number) { return `₪${n.toLocaleString("he-IL")}`; }

const MONTHS = ["","ינו","פבר","מרץ","אפר","מאי","יוני","יולי","אוג","ספט","אוק","נוב","דצ"];
const DAYS   = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [, m, day] = d.split("-");
  return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10)]}`;
}
function fmtDay(d: string | null): string {
  if (!d) return "—";
  return DAYS[new Date(d).getDay()];
}
function isUpcoming(d: string | null): boolean {
  if (!d) return false;
  return new Date(d) >= new Date(new Date().toDateString());
}
function calcDistributable(s: Show) { return Math.max(0, s.show_price - s.dj_fee); }
function calcLabelShare(s: Show)    { return calcDistributable(s) / 2; }
function calcArtistShare(s: Show)   { return calcDistributable(s) / 2; }
function calcRemaining(s: Show)     { return Math.max(0, s.show_price - s.advance_payment); }

// ─── Tabs ────────────────────────────────────────────────────────────────────
type TabKey  = "all" | "upcoming" | "unpaid" | "followup" | "done" | "cancelled";
type SortKey = "date" | "price" | "remaining" | "label";

const TABS: { key: TabKey; label: string; color: string }[] = [
  { key: "all",       label: "כל ההופעות",  color: BRAND  },
  { key: "upcoming",  label: "קרובות",       color: BLUE   },
  { key: "unpaid",    label: "לא שולמו",     color: AMBER  },
  { key: "followup",  label: "צריך פולואפ",  color: "#EF4444" },
  { key: "done",      label: "בוצעו",        color: PURPLE },
  { key: "cancelled", label: "בוטלו",        color: MUTED  },
];

// ─── Badge ───────────────────────────────────────────────────────────────────
function Badge({ bg, text, children }: { bg: string; text: string; children: React.ReactNode }) {
  return (
    <span style={{
      background: bg, color: text, borderRadius: 100,
      padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      border: `1px solid ${text}28`,
    }}>{children}</span>
  );
}

// ─── Decorative gradients ────────────────────────────────────────────────────
const CARD_GRADS = [
  "linear-gradient(145deg,#1f0707 0%,#2d0a0a 60%,#0d0d0d 100%)",
  "linear-gradient(145deg,#060d1f 0%,#0d1a2d 60%,#0d0d0d 100%)",
  "linear-gradient(145deg,#091a09 0%,#0d2d0d 60%,#0d0d0d 100%)",
  "linear-gradient(145deg,#1a060c 0%,#2d0d12 60%,#0d0d0d 100%)",
  "linear-gradient(145deg,#0a0915 0%,#150d2d 60%,#0d0d0d 100%)",
];
const CARD_ACCENTS = [BRAND, BLUE, GREEN, "#E879F9", AMBER];

// ─── Show Card ───────────────────────────────────────────────────────────────
function ShowCard({ show, accent, grad, onClick, selected }: {
  show: Show; accent: string; grad: string; onClick: () => void; selected: boolean;
}) {
  return (
    <div onClick={onClick} style={{
      width: "100%", borderRadius: 18, background: grad,
      border: `1.5px solid ${selected ? accent : BDR}`,
      boxShadow: selected ? `0 0 0 2px ${accent}40, 0 12px 36px rgba(0,0,0,0.6)` : "0 6px 24px rgba(0,0,0,0.5)",
      cursor: "pointer", overflow: "hidden", display: "flex", flexDirection: "column",
    }}>
      <div style={{ height: 120, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 65%, ${accent}30 0%, transparent 68%)` }} />
        <svg viewBox="0 0 420 70" style={{ position: "absolute", bottom: 0, width: "100%", opacity: 0.12 }} preserveAspectRatio="none">
          {Array.from({ length: 20 }).map((_, i) => (
            <ellipse key={i} cx={i * 22 + 11} cy={70} rx={7 + (i % 3) * 2} ry={12 + (i % 5) * 6} fill={accent} />
          ))}
        </svg>
        <div style={{ position: "absolute", top: 10, right: 10, background: accent, borderRadius: 10, padding: "4px 10px", textAlign: "center", minWidth: 40 }}>
          {show.date ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{parseInt(show.date.split("-")[2], 10)}</div>
              <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: "0.04em" }}>{MONTHS[parseInt(show.date.split("-")[1], 10)]}</div>
            </>
          ) : <div style={{ fontSize: 10, color: "#fff" }}>—</div>}
        </div>
        {show.date && (
          <div style={{ position: "absolute", bottom: 8, right: 12, fontSize: 10, color: `${accent}CC`, fontWeight: 700 }}>
            {fmtDay(show.date)}{show.start_time ? ` · ${show.start_time}` : ""}
          </div>
        )}
      </div>
      <div style={{ padding: "12px 14px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, lineHeight: 1.2 }}>{show.name}</div>
        <div style={{ fontSize: 11, color: TEXT2, fontWeight: 600 }}>{show.artist || "—"}</div>
        <div style={{ fontSize: 10, color: MUTED }}>{show.location || "—"}</div>
        <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
          <Badge bg={STATUS_COLOR[show.status].bg} text={STATUS_COLOR[show.status].text}>{show.status}</Badge>
          <Badge bg={PAY_COLOR[show.payment_status].bg} text={PAY_COLOR[show.payment_status].text}>{show.payment_status}</Badge>
        </div>
        <div style={{ display: "flex", marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BDR}` }}>
          {[
            { label: "מחיר",  val: fmtIls(show.show_price),    color: TEXT  },
            { label: "אמן",   val: fmtIls(calcArtistShare(show)), color: AMBER },
            { label: "לייבל", val: fmtIls(calcLabelShare(show)),  color: GREEN },
          ].map((item, idx) => (
            <div key={idx} style={{ flex: 1, textAlign: "center", borderRight: idx < 2 ? `1px solid ${BDR}` : undefined }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: item.color }}>{item.val}</div>
              <div style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon }: {
  label: string; value: string | number; sub: string; color: string; icon: string;
}) {
  return (
    <div style={{
      background: `${color}08`,
      borderLeft: `1px solid ${color}22`, borderRight: `1px solid ${color}22`,
      borderBottom: `1px solid ${color}22`, borderTop: `3px solid ${color}`,
      borderRadius: 16, padding: "18px 20px", position: "relative", overflow: "hidden",
      minHeight: 115, display: "flex", flexDirection: "column", justifyContent: "space-between",
    }}>
      <div style={{ position: "absolute", bottom: -10, left: -6, fontSize: 64, opacity: 0.05, userSelect: "none", lineHeight: 1 }}>{icon}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: TEXT2, textTransform: "uppercase", letterSpacing: "0.1em", lineHeight: 1.3 }}>{label}</div>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: `${color}15`, border: `1px solid ${color}28`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{icon}</div>
      </div>
      <div>
        <div style={{ fontSize: 32, fontWeight: 900, color, lineHeight: 1, marginBottom: 4 }}>{value}</div>
        <div style={{ fontSize: 11, color: `${color}70` }}>{sub}</div>
      </div>
    </div>
  );
}

// ─── Show Form (create / edit) ───────────────────────────────────────────────

// Statuses available in the form (subset of canonical SHOW_STATUSES — no DB change needed)
// NOTE: "בהמתנה" is NOT included because it does not exist in SHOW_STATUSES enum → would
// require a DB migration. To add it: extend SHOW_STATUSES in lib/shows-types.ts + Supabase enum.
const FORM_STATUSES: ShowStatus[] = ["ממתין לתשובה", "בוצע", "בוטל"];

interface FormState {
  name: string; artist: string; artist_client_id: string | null;
  date: string; start_time: string; location: string;
  contact_person: string; phone: string; status: ShowStatus; payment_status: PaymentStatus;
  show_price: string; dj_fee: string; advance_payment: string; notes: string;
  booker_client_id: string | null;
  dj_client_id: string | null; dj_name: string;
}

const FORM_DEFAULTS: FormState = {
  name: "", artist: "", artist_client_id: null, date: "", start_time: "", location: "",
  contact_person: "", phone: "", status: "ממתין לתשובה", payment_status: "לא שולם",
  show_price: "", dj_fee: "500", advance_payment: "0", notes: "",
  booker_client_id: null,
  dj_client_id: null, dj_name: "",
};

function showToForm(s: Show): FormState {
  return {
    name:             s.name,
    artist:           s.artist,
    artist_client_id: s.artist_client_id ?? null,
    date:             s.date ?? "",
    start_time:       s.start_time ?? "",
    location:         s.location,
    contact_person:   s.contact_person,
    phone:            s.phone,
    status:           s.status,
    payment_status:   s.payment_status,
    show_price:       String(s.show_price),
    dj_fee:           String(s.dj_fee),
    advance_payment:  String(s.advance_payment),
    notes:            s.notes,
    booker_client_id: s.booker_client_id ?? null,
    dj_client_id:     s.dj_client_id    ?? null,
    dj_name:          s.dj_name         ?? "",
  };
}

interface ClientRow { id: string; name: string; phone: string; type: string; status: string; }

function ShowFormModal({
  mode, editShow, onClose, onSaved,
}: {
  mode: "create" | "edit";
  editShow?: Show;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const initForm = mode === "edit" && editShow ? showToForm(editShow) : FORM_DEFAULTS;
  const [form, setForm] = useState<FormState>(initForm);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Inject spin-button removal CSS once (avoids <style> tag in JSX)
  useEffect(() => {
    const id = "rb-shows-no-spin-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `.rb-shows-no-spin::-webkit-outer-spin-button,.rb-shows-no-spin::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}`;
    document.head.appendChild(s);
  }, []);

  const [clients, setClients]   = useState<ClientRow[]>([]);
  const [cliLoad, setCliLoad]   = useState(false);

  // Fetch all clients once on mount
  useEffect(() => {
    setCliLoad(true);
    fetch("/api/clients")
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.clients)) setClients(d.clients); })
      .catch(() => {})
      .finally(() => setCliLoad(false));
  }, []);

  // VIP clients → artist dropdown; type "לקוח" → booker dropdown; type "איש צוות" → DJ dropdown
  const vipClients    = clients.filter(c => c.status === "VIP");
  const bookerClients = clients.filter(c => c.type === "לקוח");
  const crewClients   = clients.filter(c => c.type === "איש צוות");

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  function selectArtist(id: string) {
    const c = clients.find(x => x.id === id);
    if (!c) return;
    setForm(prev => ({ ...prev, artist: c.name, artist_client_id: c.id }));
  }

  function selectBooker(id: string) {
    const c = clients.find(x => x.id === id);
    if (!c) return;
    setForm(prev => ({
      ...prev,
      contact_person:   c.name,
      phone:            c.phone || prev.phone,
      booker_client_id: c.id,
    }));
  }

  function selectDj(id: string) {
    if (!id) { setForm(prev => ({ ...prev, dj_client_id: null, dj_name: "" })); return; }
    const c = clients.find(x => x.id === id);
    if (!c) return;
    setForm(prev => ({ ...prev, dj_client_id: c.id, dj_name: c.name }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setErr("שם ההופעה חובה"); return; }
    setSaving(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {
        name:             form.name.trim(),
        artist:           form.artist.trim(),
        artist_client_id: form.artist_client_id ?? null,
        date:             form.date || null,
        start_time:       form.start_time || null,
        location:         form.location.trim(),
        contact_person:   form.contact_person.trim(),
        phone:            form.phone.trim(),
        status:           form.status,
        payment_status:   form.payment_status,
        show_price:       Number(form.show_price) || 0,
        dj_fee:           Number(form.dj_fee) || 0,
        advance_payment:  Number(form.advance_payment) || 0,
        notes:            form.notes.trim(),
        dj_client_id:     form.dj_client_id ?? null,
        dj_name:          form.dj_name.trim(),
        // never send addToCalendar / removeFromCalendar / calendar_event_id
      };
      // Include booker_client_id + booker_name when a client was selected
      if (form.booker_client_id) {
        payload.booker_client_id = form.booker_client_id;
        payload.booker_name      = form.contact_person.trim();
      }

      const url    = mode === "edit" ? `/api/shows/${editShow!.id}` : "/api/shows";
      const method = mode === "edit" ? "PATCH" : "POST";
      const res    = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "שגיאה בשמירה"); return; }

      onSaved(mode === "edit" ? "ההופעה עודכנה בהצלחה ✓" : "ההופעה נוצרה בהצלחה ✓");
    } catch {
      setErr("שגיאת רשת — נסה שוב");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: BG2, border: `1px solid ${BDR2}`, color: TEXT, borderRadius: 9,
    padding: "9px 12px", fontSize: 13, fontFamily: "inherit", outline: "none",
    width: "100%", boxSizing: "border-box", direction: "rtl",
  };
  const numInputStyle: React.CSSProperties = {
    ...inputStyle,
    // appearance: textfield removes spin arrows in Firefox; Chrome needs the CSS class below
    MozAppearance: "textfield" as React.CSSProperties["MozAppearance"],
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: MUTED,
    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5, display: "block",
  };

  // Build status options: always include current value (in case it's outside FORM_STATUSES)
  const statusOptions: ShowStatus[] = [
    ...FORM_STATUSES,
    ...(FORM_STATUSES.includes(form.status) ? [] : [form.status]),
  ];

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.65)" }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 301, width: 560, maxWidth: "95vw", maxHeight: "90vh",
        background: "#0E0E0E", borderRadius: 20,
        border: `1px solid ${BDR2}`, boxShadow: "0 32px 80px rgba(0,0,0,0.9)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        direction: "rtl",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${BDR}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>
            {mode === "edit" ? "עריכת הופעה" : "הופעה חדשה"}
          </div>
          <button onClick={onClose} style={{ background: CARD2, border: `1px solid ${BDR}`, cursor: "pointer", color: TEXT2, fontSize: 14, padding: "6px 10px", borderRadius: 8, lineHeight: 1 }}>✕</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Row: name + artist */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>שם הופעה *</label>
              <input value={form.name} onChange={e => set("name", e.target.value)} style={inputStyle} placeholder="שם ההופעה" required />
            </div>
            <div>
              <label style={labelStyle}>אמן</label>
              {cliLoad ? (
                <div style={{ ...inputStyle, color: MUTED }}>טוען…</div>
              ) : vipClients.length === 0 ? (
                <div style={{ ...inputStyle, color: MUTED, fontSize: 12 }}>אין אמנים מסוג VIP</div>
              ) : (
                <select
                  value={form.artist_client_id ?? ""}
                  onChange={e => selectArtist(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">בחר אמן…</option>
                  {vipClients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Row: date + time */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>תאריך</label>
              <DatePickerInput
                value={form.date}
                onChange={v => set("date", v)}
                placeholder="בחר תאריך"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>שעה</label>
              <input
                type="time"
                value={form.start_time}
                onChange={e => set("start_time", e.target.value)}
                style={{ ...inputStyle, colorScheme: "dark" }}
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label style={labelStyle}>מיקום</label>
            <input value={form.location} onChange={e => set("location", e.target.value)} style={inputStyle} placeholder="עיר / מקום" />
          </div>

          {/* Row: client (booker) + phone */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>לקוח</label>
              {cliLoad ? (
                <div style={{ ...inputStyle, color: MUTED }}>טוען…</div>
              ) : bookerClients.length === 0 ? (
                <div style={{ ...inputStyle, color: MUTED, fontSize: 12 }}>אין לקוחות מסוג לקוח</div>
              ) : (
                <select
                  value={form.booker_client_id ?? ""}
                  onChange={e => selectBooker(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">בחר לקוח…</option>
                  {bookerClients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label style={labelStyle}>טלפון</label>
              <input value={form.phone} onChange={e => set("phone", e.target.value)} style={inputStyle} placeholder="050-0000000" />
            </div>
          </div>

          {/* Row: status + payment_status */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>סטטוס</label>
              <select value={form.status} onChange={e => set("status", e.target.value as ShowStatus)} style={inputStyle}>
                {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>סטטוס תשלום</label>
              <select value={form.payment_status} onChange={e => set("payment_status", e.target.value as PaymentStatus)} style={inputStyle}>
                {PAYMENT_STATUSES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* DJ dropdown */}
          <div>
            <label style={labelStyle}>דיג׳יי</label>
            {cliLoad ? (
              <div style={{ ...inputStyle, color: MUTED }}>טוען…</div>
            ) : crewClients.length === 0 ? (
              <div style={{ ...inputStyle, color: MUTED, fontSize: 12 }}>אין אנשי צוות להצגה</div>
            ) : (
              <select value={form.dj_client_id ?? ""} onChange={e => selectDj(e.target.value)} style={inputStyle}>
                <option value="">ללא דיג׳יי</option>
                {crewClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          {/* Row: prices — no spin buttons */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>מחיר הופעה ₪</label>
              <input type="number" min="0" value={form.show_price} onChange={e => set("show_price", e.target.value)} style={numInputStyle} className="rb-shows-no-spin" placeholder="0" />
            </div>
            <div>
              <label style={labelStyle}>שכר דיג׳יי ₪</label>
              <input type="number" min="0" value={form.dj_fee} onChange={e => set("dj_fee", e.target.value)} style={numInputStyle} className="rb-shows-no-spin" placeholder="500" />
            </div>
            <div>
              <label style={labelStyle}>מקדמה ₪</label>
              <input type="number" min="0" value={form.advance_payment} onChange={e => set("advance_payment", e.target.value)} style={numInputStyle} className="rb-shows-no-spin" placeholder="0" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>הערות</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} style={{ ...inputStyle, height: 72, resize: "vertical" }} placeholder="הערות נוספות…" />
          </div>

          {/* Error */}
          {err && (
            <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#FCA5A5" }}>
              {err}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              padding: "10px 20px", borderRadius: 10, fontSize: 13, fontWeight: 700,
              background: "none", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer",
            }}>ביטול</button>
            <button type="submit" disabled={saving} style={{
              padding: "10px 24px", borderRadius: 10, fontSize: 13, fontWeight: 800,
              background: saving ? MUTED : BRAND, border: "none", color: "#fff",
              cursor: saving ? "default" : "pointer",
              boxShadow: saving ? "none" : "0 4px 16px rgba(220,38,38,0.4)",
            }}>
              {saving ? "שומר…" : mode === "edit" ? "שמור שינויים" : "צור הופעה"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function Toast({ message, type, onDone }: { message: string; type: "success" | "error"; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{
      position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
      zIndex: 400, pointerEvents: "none",
      background: type === "success" ? "rgba(16,185,129,0.95)" : "rgba(220,38,38,0.95)",
      color: "#fff", fontWeight: 700, fontSize: 14,
      padding: "12px 28px", borderRadius: 14,
      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
      whiteSpace: "nowrap",
    }}>
      {type === "success" ? "✓ " : "✕ "}{message}
    </div>
  );
}

// ─── Show Panel (centered modal) ─────────────────────────────────────────────
function ShowPanel({ show, onClose, onEdit }: {
  show: Show; onClose: () => void; onEdit: () => void;
}) {
  const distributable = calcDistributable(show);
  const artistShare   = calcArtistShare(show);
  const labelShare    = calcLabelShare(show);
  const remaining     = calcRemaining(show);
  const canEdit       = !show.calendar_event_id;

  const sectionLabel = (text: string, icon: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: "0.1em" }}>{text}</span>
    </div>
  );

  const finCard = (label: string, value: string, color: string, bold = false, fullWidth = false) => (
    <div style={{
      background: `${color}0D`, border: `1px solid ${color}28`,
      borderRadius: 12, padding: "12px 14px",
      ...(fullWidth ? { gridColumn: "1 / -1" } : {}),
      display: "flex", flexDirection: "column", gap: 5,
    }}>
      <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: bold ? 22 : 18, fontWeight: 900, color }}>{value}</div>
    </div>
  );

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(3px)",
      }} />

      {/* Modal */}
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 201, width: 560, maxWidth: "95vw", maxHeight: "90vh",
        background: "#0D0D0D",
        borderRadius: 20,
        border: "1px solid rgba(220,38,38,0.35)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(220,38,38,0.06)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        direction: "rtl",
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: "18px 20px 14px",
          borderBottom: `1px solid ${BDR}`,
          background: "#0D0D0D",
          position: "relative",
        }}>
          {/* X close */}
          <button onClick={onClose} style={{
            position: "absolute", top: 14, right: 16,
            background: CARD2, border: `1px solid ${BDR}`,
            borderRadius: 8, width: 30, height: 30,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: TEXT2, fontSize: 14, lineHeight: 1,
          }}>✕</button>

          {/* Bookmark icon top-left */}
          <button disabled style={{
            position: "absolute", top: 14, left: 16,
            background: BRAND, border: "none",
            borderRadius: 8, width: 36, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "not-allowed", fontSize: 16,
          }}>🎫</button>

          {/* Title */}
          <div style={{ textAlign: "center", paddingTop: 2 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: TEXT, marginBottom: 10 }}>{show.name}</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              <Badge bg={STATUS_COLOR[show.status].bg} text={STATUS_COLOR[show.status].text}>{show.status}</Badge>
              <Badge bg={PAY_COLOR[show.payment_status].bg} text={PAY_COLOR[show.payment_status].text}>{show.payment_status}</Badge>
              {show.calendar_event_id && <Badge bg="rgba(59,130,246,0.18)" text={BLUE}>📅 ביומן</Badge>}
            </div>
          </div>
        </div>

        {/* ── Body (scrollable) ── */}
        <div style={{ overflowY: "auto", flex: 1, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* פרטי הופעה */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "14px 16px" }}>
            {sectionLabel("פרטי הופעה", "📅")}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
              {/* עמודה ימין — location / contact / booker / phone */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, borderLeft: `1px solid ${BDR}`, paddingLeft: 14 }}>
                {[
                  { icon: "📍", label: "מיקום",    val: show.location      || "—" },
                  { icon: "👤", label: "איש קשר",  val: show.contact_person || "לא נבחר" },
                  ...(show.booker_name ? [{ icon: "👤", label: "מזמין", val: show.booker_name }] : []),
                  { icon: "📞", label: "טלפון",    val: show.phone          || "—" },
                ].map(r => (
                  <div key={r.label} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 13, marginTop: 1, flexShrink: 0 }}>{r.icon}</span>
                    <div>
                      <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 1 }}>{r.label}</div>
                      <div style={{ fontSize: 13, color: TEXT, fontWeight: 600 }}>{r.val}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* עמודה שמאל — date / day / time / dj */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingRight: 14 }}>
                {[
                  { label: "תאריך", val: show.date ? fmtDate(show.date)    : "—" },
                  { label: "יום",   val: show.date ? fmtDay(show.date)     : "—" },
                  { label: "שעה",   val: show.start_time                   || "—" },
                  { label: "דיג׳יי", val: show.dj_name                     || "—" },
                ].map(r => (
                  <div key={r.label}>
                    <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 1 }}>{r.label}</div>
                    <div style={{ fontSize: 13, color: TEXT, fontWeight: 600 }}>{r.val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* סיכום כספי */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "14px 16px" }}>
            {sectionLabel("סיכום כספי", "💰")}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {finCard("מחיר הופעה",      fmtIls(show.show_price),   TEXT2)}
              {finCard("שכר דיג׳יי",        fmtIls(show.dj_fee),       MUTED)}
              {finCard("יתרה לחלוקה",     fmtIls(distributable),     AMBER, true)}
              {finCard("חלק אמן (50%)",   fmtIls(artistShare),       BLUE)}
              {finCard("חלק לייבל (50%)", fmtIls(labelShare),        GREEN)}
              {finCard("יתרה לגבייה",     fmtIls(remaining),         remaining > 0 ? BRAND : GREEN, true)}
              {finCard("מקדמה ששולמה",    fmtIls(show.advance_payment), TEXT2, false, true)}
            </div>
          </div>

          {/* הערות */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "14px 16px" }}>
            {sectionLabel("הערות", "📝")}
            {show.notes
              ? <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{show.notes}</div>
              : <div style={{ fontSize: 13, color: MUTED, textAlign: "center", padding: "8px 0" }}>אין הערות להצגה.</div>
            }
          </div>

          {/* Lock notice */}
          {!canEdit && (
            <div style={{ fontSize: 11, color: MUTED, textAlign: "center", lineHeight: 1.6 }}>
              🔒 הופעה זו מסונכרנת עם Google Calendar.<br/>עריכה זמינה מהעמוד הראשי בלבד.
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: "14px 20px",
          borderTop: `1px solid ${BDR}`,
          background: "#0D0D0D",
          display: "flex", gap: 10,
        }}>
          {/* Calendar — always disabled */}
          <button disabled style={{
            flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
            background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`,
            color: MUTED, cursor: "not-allowed",
          }}>📅 הוסף ליומן</button>

          {/* Close */}
          <button onClick={onClose} style={{
            flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
            background: CARD2, border: `1px solid ${BDR2}`,
            color: TEXT2, cursor: "pointer",
          }}>סגור</button>

          {/* Edit */}
          <button
            onClick={canEdit ? onEdit : undefined}
            disabled={!canEdit}
            title={canEdit ? "ערוך הופעה" : "הופעה זו מסונכרנת עם Google Calendar — עריכה זמינה מהעמוד הראשי בלבד"}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
              background: canEdit ? BRAND : "rgba(255,255,255,0.04)",
              border: `1px solid ${canEdit ? "rgba(220,38,38,0.5)" : BDR}`,
              color: canEdit ? "#fff" : MUTED,
              cursor: canEdit ? "pointer" : "not-allowed",
              boxShadow: canEdit ? "0 4px 16px rgba(220,38,38,0.35)" : "none",
            }}
          >✏️ עריכה{!canEdit ? " 🔒" : ""}</button>
        </div>
      </div>
    </>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function ShowsHubPreview() {
  const [shows,     setShows]     = useState<Show[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [tab,       setTab]       = useState<TabKey>("all");
  const [search,    setSearch]    = useState("");
  const [filterSt,  setFilterSt]  = useState<ShowStatus | "">("");
  const [filterPay, setFilterPay] = useState<PaymentStatus | "">("");
  const [sort,      setSort]      = useState<SortKey>("date");
  const [selected,  setSelected]  = useState<Show | null>(null);
  const [modal,     setModal]     = useState<{ mode: "create" | "edit"; show?: Show } | null>(null);
  const [toast,     setToast]     = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadShows = useCallback(() => {
    return fetch("/api/shows")
      .then(r => r.json())
      .then(d => {
        setShows(Array.isArray(d.shows) ? d.shows : []);
        setLoading(false);
      })
      .catch(() => { setError("לא הצלחנו לטעון הופעות"); setLoading(false); });
  }, []);

  useEffect(() => { loadShows(); }, [loadShows]);

  const upcoming = useMemo(() =>
    [...shows]
      .filter(s => isUpcoming(s.date) && s.status !== "בוטל")
      .sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"))
      .slice(0, 5),
    [shows]
  );

  const tabCounts = useMemo(() => ({
    all:       shows.length,
    upcoming:  shows.filter(s => isUpcoming(s.date) && s.status !== "בוטל").length,
    unpaid:    shows.filter(s => s.payment_status === "לא שולם").length,
    followup:  shows.filter(s => s.status === "צריך פולואפ").length,
    done:      shows.filter(s => s.status === "בוצע").length,
    cancelled: shows.filter(s => s.status === "בוטל").length,
  }), [shows]);

  function tabFilter(s: Show): boolean {
    switch (tab) {
      case "upcoming":  return isUpcoming(s.date) && s.status !== "בוטל";
      case "unpaid":    return s.payment_status === "לא שולם";
      case "followup":  return s.status === "צריך פולואפ";
      case "done":      return s.status === "בוצע";
      case "cancelled": return s.status === "בוטל";
      default:          return true;
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const base = shows.filter(s => {
      if (!tabFilter(s)) return false;
      if (filterSt  && s.status         !== filterSt)  return false;
      if (filterPay && s.payment_status !== filterPay) return false;
      if (q && !`${s.name} ${s.artist} ${s.location} ${s.contact_person ?? ""} ${s.booker_name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return [...base].sort((a, b) => {
      switch (sort) {
        case "date":      return (a.date ?? "9").localeCompare(b.date ?? "9");
        case "price":     return b.show_price - a.show_price;
        case "remaining": return calcRemaining(b) - calcRemaining(a);
        case "label":     return calcLabelShare(b) - calcLabelShare(a);
        default:          return 0;
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shows, tab, search, filterSt, filterPay, sort]);

  const kpis = useMemo(() => {
    const active = shows.filter(s => s.status !== "בוטל");
    return {
      total:       shows.length,
      upCount:     upcoming.length,
      expIncome:   active.reduce((a, s) => a + s.show_price, 0),
      remaining:   active.reduce((a, s) => a + calcRemaining(s), 0),
      labelProfit: active.reduce((a, s) => a + calcLabelShare(s), 0),
    };
  }, [shows, upcoming]);

  function handleSaved(msg: string) {
    setModal(null);
    setToast({ message: msg, type: "success" });
    // Refresh list
    fetch("/api/shows")
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.shows)) setShows(d.shows); })
      .catch(() => {});
    // Sync selected panel if editing
    if (modal?.mode === "edit" && modal.show) setSelected(null);
  }

  const selectStyle: React.CSSProperties = {
    background: BG2, border: `1px solid ${BDR2}`, color: TEXT2,
    borderRadius: 9, padding: "8px 12px", fontSize: 12, fontFamily: "inherit",
    outline: "none", direction: "rtl",
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl" }}>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(180deg,#1a0505 0%,#0f0404 50%,#080808 100%)",
        borderBottom: `1px solid rgba(220,38,38,0.20)`,
      }}>
        <div style={{ position: "absolute", top: -40, right: "20%", width: 360, height: 220, background: "radial-gradient(ellipse,rgba(220,38,38,0.12) 0%,transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 44, opacity: 0.055, pointerEvents: "none" }}>
          <svg viewBox="0 0 1400 44" style={{ width: "100%", height: "100%" }} preserveAspectRatio="none">
            {Array.from({ length: 64 }).map((_, i) => (
              <ellipse key={i} cx={i * 22 + 11} cy={44} rx={6 + (i % 3) * 2} ry={9 + (i % 5) * 4} fill={BRAND} />
            ))}
          </svg>
        </div>
        <div style={{ padding: "22px 28px 20px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 36, fontWeight: 900, color: TEXT, letterSpacing: "-0.02em", lineHeight: 1 }}>הופעות הלייבל</div>
                <span style={{ fontSize: 26 }}>🎤</span>
              </div>
              <div style={{ fontSize: 13, color: TEXT2, marginTop: 6 }}>
                ניהול כל ההופעות — תאריכים, סטטוסים, הזמנות ותשלומים.
              </div>
            </div>
            <button
              onClick={() => setModal({ mode: "create" })}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: BRAND, border: "none", borderRadius: 12,
                padding: "11px 22px", fontSize: 14, fontWeight: 700,
                color: "#fff", cursor: "pointer",
                boxShadow: "0 4px 20px rgba(220,38,38,0.40)",
                flexShrink: 0, transition: "none",
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> הופעה חדשה
            </button>
          </div>
        </div>
      </div>

      {/* ── Page body ──────────────────────────────────────────────────────── */}
      <div style={{ padding: "24px 28px 64px" }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "100px 0", color: TEXT2 }}>
            <div style={{ fontSize: 44, marginBottom: 14, opacity: 0.2 }}>🎤</div>
            <div style={{ fontSize: 14 }}>טוען הופעות…</div>
          </div>
        )}
        {error && (
          <div style={{ textAlign: "center", padding: "100px 0", color: "#EF4444" }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>⚠️</div>
            <div>{error}</div>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* ── KPI ──────────────────────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 28 }}>
              <KpiCard label="סה״כ הופעות"    value={kpis.total}               sub="הופעות רשומות"      color={BRAND}  icon="🎤" />
              <KpiCard label="הופעות קרובות"   value={kpis.upCount}             sub="לא בוטלו"           color={BLUE}   icon="📅" />
              <KpiCard label="הכנסות צפויות"   value={fmtIls(kpis.expIncome)}   sub="מהופעות פעילות"     color={GREEN}  icon="💰" />
              <KpiCard label="יתרה לגבייה"     value={fmtIls(kpis.remaining)}   sub="טרם שולם"           color={AMBER}  icon="⏳" />
              <KpiCard label="רווח לייבל צפוי" value={fmtIls(kpis.labelProfit)} sub="50% מיתרה לחלוקה"  color={PURPLE} icon="🏷️" />
            </div>

            {/* ── Two-column CSS Grid ───────────────────────────────────────── */}
            <div style={{
              display: "grid",
              gridTemplateColumns: upcoming.length > 0 ? "clamp(280px, 26%, 360px) 1fr" : "1fr",
              gap: 20, alignItems: "flex-start",
            }}>

              {/* ── Upcoming shows ─────────────────────────────────────────── */}
              {upcoming.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <div style={{ width: 4, height: 18, borderRadius: 2, background: BLUE, flexShrink: 0 }} />
                    <div style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>הופעות קרובות</div>
                    <div style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${BLUE}15`, border: `1px solid ${BLUE}28`, color: BLUE }}>{upcoming.length}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {upcoming.map((s, i) => (
                      <ShowCard
                        key={s.id} show={s}
                        accent={CARD_ACCENTS[i % CARD_ACCENTS.length]}
                        grad={CARD_GRADS[i % CARD_GRADS.length]}
                        selected={selected?.id === s.id}
                        onClick={() => setSelected(prev => prev?.id === s.id ? null : s)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── Table ─────────────────────────────────────────────────── */}
              <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, overflow: "hidden" }}>

                {/* Tabs */}
                <div style={{ display: "flex", borderBottom: `1px solid ${BDR}`, overflowX: "auto" }}>
                  {TABS.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)} style={{
                      padding: "14px 16px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                      background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
                      color: tab === t.key ? t.color : MUTED,
                      borderBottom: tab === t.key ? `2px solid ${t.color}` : "2px solid transparent",
                      transition: "none",
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                      {t.label}
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
                        background: tab === t.key ? `${t.color}20` : "rgba(255,255,255,0.06)",
                        color: tab === t.key ? t.color : MUTED,
                      }}>{tabCounts[t.key]}</span>
                    </button>
                  ))}
                </div>

                {/* Toolbar */}
                <div style={{ padding: "14px 20px", borderBottom: `1px solid ${BDR}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ position: "relative", flex: "1 1 160px", minWidth: 140 }}>
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="חיפוש שם, אמן, מיקום…"
                      style={{ ...selectStyle, paddingRight: 30, width: "100%", boxSizing: "border-box", color: TEXT }}
                    />
                    <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 12, pointerEvents: "none" }}>🔍</span>
                  </div>
                  <select value={filterSt}  onChange={e => setFilterSt(e.target.value as ShowStatus | "")}    style={selectStyle}>
                    <option value="">כל הסטטוסים</option>
                    {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={filterPay} onChange={e => setFilterPay(e.target.value as PaymentStatus | "")} style={selectStyle}>
                    <option value="">כל התשלומים</option>
                    {PAYMENT_STATUSES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={sort} onChange={e => setSort(e.target.value as SortKey)} style={selectStyle}>
                    <option value="date">תאריך קרוב</option>
                    <option value="price">מחיר גבוה</option>
                    <option value="remaining">יתרה לגבייה</option>
                    <option value="label">רווח לייבל</option>
                  </select>
                  <div style={{ marginRight: "auto", fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>{filtered.length} הופעות</div>
                </div>

                {/* Table */}
                {filtered.length === 0 ? (
                  <div style={{ padding: "56px 0", textAlign: "center", color: MUTED }}>
                    <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.2 }}>🎤</div>
                    <div style={{ fontSize: 13 }}>אין הופעות להצגה</div>
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.016)" }}>
                          {["אמן","הופעה","תאריך","סטטוס","תשלום","יתרה"].map(h => (
                            <th key={h} style={{ padding: "12px 16px", textAlign: "right", fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((s, i) => {
                          const sel = selected?.id === s.id;
                          return (
                            <tr key={s.id} onClick={() => setSelected(prev => prev?.id === s.id ? null : s)} style={{
                              borderBottom: `1px solid ${BDR}`,
                              background: sel ? "rgba(220,38,38,0.06)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.014)",
                              cursor: "pointer",
                              outline: sel ? `1px solid rgba(220,38,38,0.24)` : "none", outlineOffset: -1,
                            }}>
                              <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                                <div style={{ fontWeight: 600, color: TEXT2 }}>{s.artist || <span style={{ color: MUTED }}>—</span>}</div>
                              </td>
                              <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                                <div style={{ fontWeight: 700, color: TEXT }}>{s.name}</div>
                              </td>
                              <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                                {s.date ? (
                                  <>
                                    <div style={{ fontWeight: 600, color: TEXT }}>{fmtDate(s.date)}</div>
                                    <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{fmtDay(s.date)}{s.start_time ? ` · ${s.start_time}` : ""}</div>
                                  </>
                                ) : <span style={{ color: MUTED }}>—</span>}
                              </td>
                              <td style={{ padding: "14px 16px" }}>
                                <Badge bg={STATUS_COLOR[s.status].bg} text={STATUS_COLOR[s.status].text}>{s.status}</Badge>
                              </td>
                              <td style={{ padding: "14px 16px" }}>
                                <Badge bg={PAY_COLOR[s.payment_status].bg} text={PAY_COLOR[s.payment_status].text}>{s.payment_status}</Badge>
                              </td>
                              <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                                <span style={{ color: calcRemaining(s) > 0 ? BRAND : GREEN, fontWeight: 700 }}>{fmtIls(calcRemaining(s))}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>{/* end CSS Grid */}
          </>
        )}
      </div>

      {/* ── Side panel ─────────────────────────────────────────────────────── */}
      {selected && (
        <ShowPanel
          show={selected}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setModal({ mode: "edit", show: selected });
            setSelected(null);
          }}
        />
      )}

      {/* ── Form modal ─────────────────────────────────────────────────────── */}
      {modal && (
        <ShowFormModal
          mode={modal.mode}
          editShow={modal.show}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
