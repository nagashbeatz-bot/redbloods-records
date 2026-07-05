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

/**
 * Schedule a rehearsal for a show as an INDEPENDENT session via the existing
 * POST /api/sessions (Option A — no new API, no DB, no show_id). Shared by the
 * production Shows drawer (ShowsHubPreview → ShowPanel) and the legacy ShowDrawer.
 * Rendered through a portal with a high z-index so it sits above the show modal.
 */
export default function RehearsalModal({ show, onClose, onCreated }: {
  show: Show;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const [date,      setDate]      = useState<string>(show.date || todayStr);
  const [startTime, setStartTime] = useState<string>(show.start_time || "");
  const [endTime,   setEndTime]   = useState<string>("");
  const [location,  setLocation]  = useState<string>("גרוב הוד השרון");
  const [userNotes, setUserNotes] = useState<string>("");
  const [addToCal,  setAddToCal]  = useState<boolean>(false);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState<string | null>(null);

  async function handleCreate() {
    if (!date || !startTime) { setErr("צריך תאריך ושעת התחלה"); return; }
    setSaving(true); setErr(null);
    // The show reference is always kept in the notes; user notes go below it.
    const ref   = `חזרה עבור הופעה: ${show.name}${show.artist ? ` | אמן: ${show.artist}` : ""}`;
    const notes = userNotes.trim() ? `${ref}\n${userNotes.trim()}` : ref;
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Independent session — shows have no project_id, so we never link/create one.
          title:         show.name,
          date,
          startTime,
          endTime:       endTime || null,
          status:        "מתוכנן",
          sessionType:   "חזרה להופעה",
          location:      location.trim() || "גרוב הוד השרון",
          notes,
          addToCalendar: addToCal,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "שגיאה בשמירת החזרה");
      onCreated?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
      setSaving(false);
    }
  }

  const modal = (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.74)", backdropFilter: "blur(4px)", zIndex: 200000 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        background: "#141414", border: "1px solid #262626", borderRadius: 18,
        width: 384, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto",
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
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#818CF8", letterSpacing: "0.08em", textTransform: "uppercase" }}>קביעת חזרה</div>
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
          <DatePickerInput value={date} onChange={setDate} min={todayStr} placeholder="בחר תאריך" style={field} />
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

        {/* ── Notes ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={lbl}>הערות</div>
          <textarea value={userNotes} onChange={e => setUserNotes(e.target.value)} rows={2}
            placeholder="פרטים נוספים (לא חובה)…"
            style={{ ...field, resize: "vertical", lineHeight: 1.5 }} />
        </div>

        {/* ── Calendar checkbox ── */}
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

        {/* ── Actions ── */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} disabled={saving} style={{
            flex: 1, padding: "11px", borderRadius: 10, border: "1px solid #2E2E2E",
            background: "transparent", color: "#999", cursor: saving ? "default" : "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 600,
          }}>ביטול</button>
          <button onClick={handleCreate} disabled={saving} style={{
            flex: 2, padding: "11px", borderRadius: 10, border: "none",
            background: "#6366F1", color: "#fff", cursor: saving ? "default" : "pointer",
            fontWeight: 800, fontFamily: "inherit", fontSize: 13.5,
            boxShadow: "0 4px 16px rgba(99,102,241,0.35)", opacity: saving ? 0.7 : 1,
          }}>{saving ? "שומר…" : "🥁 קבע חזרה"}</button>
        </div>
      </div>
    </>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
