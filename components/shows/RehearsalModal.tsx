"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { Show } from "@/lib/shows-types";
import DatePickerInput from "@/components/ui/DatePickerInput";
import TimePickerInput from "@/components/ui/TimePickerInput";

// Shared dark field + label styling — matches the system's session/form look.
const field: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10,
  border: "1px solid #2A2A2A", background: "#0D0D0D", color: "#E8E8E8",
  fontSize: 13.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  fontSize: 10.5, color: "#6B6B6B", marginBottom: 6, fontWeight: 700, letterSpacing: "0.05em",
};

/** A rehearsal session as returned by GET /api/sessions?showId (enriched). */
export interface RehearsalSession {
  id: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string;
  status: string;
  cost: number | null;
  notes: string;
  calendar_event_id: string | null;
  payment_status: string | null; // from the linked transaction (null if none)
}

const OP_STATUSES = ["מתוכנן", "בוצע", "בוטל"] as const;

/**
 * Schedule OR edit a rehearsal for a show. Rehearsals are sessions
 * (session_type="חזרה להופעה") linked to the show via sessions.show_id, carrying
 * an optional cost. When cost > 0 the server creates/updates ONE canonical
 * expense transaction (idempotent via linked_session_id) and re-derives the
 * show's Fin-2 split. Google Calendar behaviour is unchanged (create on add,
 * update the existing event on edit, never duplicate).
 */
export default function RehearsalModal({ show, onClose, onCreated, rehearsal }: {
  show: Show;
  onClose: () => void;
  onCreated?: () => void;
  rehearsal?: RehearsalSession | null;
}) {
  const isEdit = !!rehearsal;
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());

  const [date,      setDate]      = useState<string>(rehearsal?.date || show.date || todayStr);
  const [startTime, setStartTime] = useState<string>(rehearsal?.start_time || show.start_time || "");
  const [endTime,   setEndTime]   = useState<string>(rehearsal?.end_time || "");
  const [location,  setLocation]  = useState<string>(rehearsal?.location ?? "גרוב הוד השרון");
  const [userNotes, setUserNotes] = useState<string>(isEdit ? (rehearsal?.notes ?? "") : "");
  const [cost,      setCost]      = useState<string>(rehearsal?.cost != null ? String(rehearsal.cost) : "");
  const [opStatus,  setOpStatus]  = useState<string>(rehearsal?.status || "מתוכנן");
  // Payment toggle: only "לא שולם" / "שולם" are offered. A legacy "חלקי" is not
  // pre-selected (unsupported) — the owner must explicitly pick one to resolve it.
  const initialPay = rehearsal?.payment_status === "שולם" ? "שולם"
    : rehearsal?.payment_status === "לא שולם" ? "לא שולם"
    : isEdit ? null : "לא שולם";
  const [pay,       setPay]       = useState<"שולם" | "לא שולם" | null>(initialPay);
  const [addToCal,  setAddToCal]  = useState<boolean>(false);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState<string | null>(null);

  const isPartial = rehearsal?.payment_status === "חלקי";
  const costNum = cost.trim() === "" ? 0 : Number(cost);
  const costInvalid = cost.trim() !== "" && (!Number.isFinite(costNum) || costNum < 0);

  async function handleSave() {
    if (!date || !startTime) { setErr("צריך תאריך ושעת התחלה"); return; }
    if (costInvalid) { setErr("עלות לא תקינה"); return; }
    setSaving(true); setErr(null);
    // The show reference stays in the notes for readability (the real link is
    // sessions.show_id). On edit we keep whatever the owner typed.
    const ref   = `חזרה עבור הופעה: ${show.name}${show.artist ? ` | אמן: ${show.artist}` : ""}`;
    const notes = isEdit
      ? (userNotes.trim() || ref)
      : (userNotes.trim() ? `${ref}\n${userNotes.trim()}` : ref);
    try {
      let res: Response;
      if (isEdit && rehearsal) {
        // Compute Israel-local ISO for calendar update (only meaningful if the
        // rehearsal already has a calendar event; the route no-ops otherwise).
        const startIso = `${date}T${startTime}:00`;
        const endIso   = endTime ? `${date}T${endTime}:00` : undefined;
        res = await fetch(`/api/sessions/${rehearsal.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date, startTime, endTime: endTime || null,
            status: opStatus, location: location.trim() || "גרוב הוד השרון", notes,
            cost: cost.trim() === "" ? null : costNum,
            ...(pay ? { paymentStatus: pay } : {}),
            startIso, endIso, summary: `חזרה להופעה - ${show.name}`,
          }),
        });
      } else {
        res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title:         show.name,
            date,
            startTime,
            endTime:       endTime || null,
            status:        opStatus,
            sessionType:   "חזרה להופעה",
            location:      location.trim() || "גרוב הוד השרון",
            notes,
            showId:        show.id,
            cost:          cost.trim() === "" ? null : costNum,
            paymentStatus: pay ?? "לא שולם",
            addToCalendar: addToCal,
          }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "שגיאה בשמירת החזרה");
      onCreated?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
      setSaving(false);
    }
  }

  const payBtn = (val: "לא שולם" | "שולם", color: string): React.CSSProperties => ({
    flex: 1, padding: "9px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
    fontSize: 12.5, fontWeight: 700,
    background: pay === val ? `${color}22` : "#0D0D0D",
    color: pay === val ? color : "#8A8A8A",
    border: `1px solid ${pay === val ? `${color}66` : "#242424"}`,
  });

  const modal = (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.74)", backdropFilter: "blur(4px)", zIndex: 200000 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        background: "#141414", border: "1px solid #262626", borderRadius: 18,
        width: 396, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto",
        zIndex: 200001, padding: "24px 24px 22px", direction: "rtl",
        fontFamily: "'Heebo', Arial, sans-serif",
        boxShadow: "0 24px 70px rgba(0,0,0,0.85)",
      }}>
        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11, flexShrink: 0,
            background: "rgba(99,102,241,0.13)", border: "1px solid rgba(99,102,241,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>🥁</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#818CF8", letterSpacing: "0.08em", textTransform: "uppercase" }}>{isEdit ? "עריכת חזרה" : "קביעת חזרה"}</div>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: "#F2F2F2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.name}</div>
            {show.artist && <div style={{ fontSize: 12, color: "#777", marginTop: 1 }}>{show.artist}</div>}
          </div>
        </div>

        <div style={{ borderTop: "1px solid #222", marginBottom: 16 }} />

        {err && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "8px 12px", color: "#F87171", fontSize: 12.5, marginBottom: 14 }}>
            {err}
          </div>
        )}

        {/* ── Date ── */}
        <div style={{ marginBottom: 14 }}>
          <div style={lbl}>תאריך חזרה</div>
          <DatePickerInput value={date} onChange={setDate} placeholder="בחר תאריך" style={field} />
        </div>

        {/* ── Times ── */}
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={lbl}>שעת התחלה</div>
            <TimePickerInput value={startTime} onChange={setStartTime} style={field} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={lbl}>שעת סיום</div>
            <TimePickerInput value={endTime} onChange={setEndTime} style={field} />
          </div>
        </div>

        {/* ── Location ── */}
        <div style={{ marginBottom: 14 }}>
          <div style={lbl}>מיקום / חדר חזרות</div>
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="גרוב הוד השרון" style={field} />
        </div>

        {/* ── Cost ── */}
        <div style={{ marginBottom: 14 }}>
          <div style={lbl}>עלות (₪)</div>
          <input type="number" min={0} value={cost} onChange={e => setCost(e.target.value)} placeholder="0"
            style={{ ...field, ...(costInvalid ? { borderColor: "rgba(239,68,68,0.5)" } : {}) }} />
          <div style={{ fontSize: 10.5, color: "#5C5C5C", marginTop: 5 }}>ריק או 0 = לא נוצרת הוצאה כספית</div>
        </div>

        {/* ── Payment status (only when there's a cost) ── */}
        {costNum > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={lbl}>סטטוס תשלום</div>
            {isPartial && (
              <div style={{ background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.3)", borderRadius: 9, padding: "7px 10px", color: "#F5A623", fontSize: 11.5, marginBottom: 8 }}>
                ⚠ ההוצאה במצב "חלקי" — לא נתמך בחזרות ואינו מקוזז. בחר סטטוס כדי לפתור.
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setPay("לא שולם")} style={payBtn("לא שולם", "#EF4444")}>לא שולם</button>
              <button type="button" onClick={() => setPay("שולם")} style={payBtn("שולם", "#13C99A")}>שולם</button>
            </div>
          </div>
        )}

        {/* ── Operational status (edit only) ── */}
        {isEdit && (
          <div style={{ marginBottom: 14 }}>
            <div style={lbl}>סטטוס חזרה</div>
            <div style={{ display: "flex", gap: 8 }}>
              {OP_STATUSES.map(s => (
                <button key={s} type="button" onClick={() => setOpStatus(s)} style={{
                  flex: 1, padding: "9px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                  fontSize: 12.5, fontWeight: 700,
                  background: opStatus === s ? "rgba(99,102,241,0.18)" : "#0D0D0D",
                  color: opStatus === s ? "#A5B4FC" : "#8A8A8A",
                  border: `1px solid ${opStatus === s ? "rgba(99,102,241,0.5)" : "#242424"}`,
                }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {/* ── Notes ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={lbl}>הערות</div>
          <textarea value={userNotes} onChange={e => setUserNotes(e.target.value)} rows={2}
            placeholder="פרטים נוספים (לא חובה)…"
            style={{ ...field, resize: "vertical", lineHeight: 1.5 }} />
        </div>

        {/* ── Calendar checkbox (create only) ── */}
        {!isEdit && (
          <label style={{
            display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none",
            marginBottom: 18, padding: "10px 12px", borderRadius: 10,
            border: `1px solid ${addToCal ? "rgba(99,102,241,0.35)" : "#222"}`,
            background: addToCal ? "rgba(99,102,241,0.06)" : "#0D0D0D", transition: "all 0.15s",
          }}>
            <div onClick={() => setAddToCal(v => !v)} style={{
              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
              border: `1.5px solid ${addToCal ? "#6366F1" : "#333"}`,
              background: addToCal ? "rgba(99,102,241,0.25)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{addToCal && <span style={{ color: "#A5B4FC", fontSize: 12, lineHeight: 1 }}>✓</span>}</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: addToCal ? "#A5B4FC" : "#9A9A9A" }}>📅 הוסף ליומן Google</span>
          </label>
        )}

        {/* ── Actions ── */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} disabled={saving} style={{
            flex: 1, padding: "11px", borderRadius: 10, border: "1px solid #2E2E2E",
            background: "transparent", color: "#999", cursor: saving ? "default" : "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 600,
          }}>ביטול</button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 2, padding: "11px", borderRadius: 10, border: "none",
            background: "#6366F1", color: "#fff", cursor: saving ? "default" : "pointer",
            fontWeight: 800, fontFamily: "inherit", fontSize: 13.5,
            boxShadow: "0 4px 16px rgba(99,102,241,0.35)", opacity: saving ? 0.7 : 1,
          }}>{saving ? "שומר…" : isEdit ? "💾 שמור שינויים" : "🥁 קבע חזרה"}</button>
        </div>
      </div>
    </>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
