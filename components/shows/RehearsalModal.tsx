"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { Show } from "@/lib/shows-types";

const inp: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #222", background: "#0D0D0D", color: "#E0E0E0",
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600,
  letterSpacing: "0.06em", textTransform: "uppercase",
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
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 200000 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        background: "#141414", border: "1px solid #2A2A2A", borderRadius: 14,
        width: 360, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto",
        zIndex: 200001, padding: 24, direction: "rtl", fontFamily: "'Heebo', Arial, sans-serif",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6366F1", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>🥁 קבע חזרה</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#F0F0F0", marginBottom: 2 }}>{show.name}</div>
        {show.artist && <div style={{ fontSize: 12, color: "#666", marginBottom: 14 }}>{show.artist}</div>}
        {err && <div style={{ color: "#EF4444", fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <div style={{ marginBottom: 12 }}>
          <div style={lbl}>תאריך חזרה *</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={lbl}>שעת התחלה *</div>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={inp} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={lbl}>שעת סיום</div>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={inp} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={lbl}>מיקום / חדר חזרות</div>
          <input value={location} onChange={e => setLocation(e.target.value)} style={inp} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={lbl}>הערות</div>
          <textarea value={userNotes} onChange={e => setUserNotes(e.target.value)} rows={2} style={{ ...inp, resize: "vertical" }} />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 18, userSelect: "none" }}>
          <div onClick={() => setAddToCal(v => !v)} style={{
            width: 18, height: 18, borderRadius: 5, flexShrink: 0,
            border: `1.5px solid ${addToCal ? "#6366F1" : "#333"}`,
            background: addToCal ? "rgba(99,102,241,0.2)" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>{addToCal && <span style={{ color: "#818CF8", fontSize: 12, lineHeight: 1 }}>✓</span>}</div>
          <span style={{ fontSize: 13, fontWeight: 600, color: addToCal ? "#818CF8" : "#888" }}>הוסף ליומן Google</span>
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} disabled={saving} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "1px solid #333", background: "none", color: "#888", cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
          <button onClick={handleCreate} disabled={saving} style={{ flex: 2, padding: "9px", borderRadius: 8, border: "none", background: "#6366F1", color: "#fff", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
            {saving ? "שומר..." : "קבע חזרה"}
          </button>
        </div>
      </div>
    </>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
