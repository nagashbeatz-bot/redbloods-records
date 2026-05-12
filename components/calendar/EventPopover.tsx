"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ParsedCalendarEvent } from "@/lib/calendar-utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" });
}

/** Convert ISO to "YYYY-MM-DD" for date input */
function toDateInputVal(iso: string): string {
  return iso ? iso.slice(0, 10) : "";
}

/** Convert ISO to "HH:MM" for time input */
function toTimeInputVal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Combine date string "YYYY-MM-DD" + time "HH:MM" → ISO with Israel timezone offset */
function combineDateTime(dateStr: string, timeStr: string): string {
  if (!dateStr || !timeStr) return "";
  // Build a local date and return ISO string
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, min]  = timeStr.split(":").map(Number);
  const dt = new Date(y, m - 1, d, h, min, 0, 0);
  return dt.toISOString();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  event:     ParsedCalendarEvent;
  anchor:    { top: number; left: number; width: number };
  onClose:   () => void;
  onDeleted: (id: string) => void;
  onUpdated: (updated: ParsedCalendarEvent) => void;
}

type Mode = "view" | "edit" | "confirm-delete";

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function EventPopover({ event, anchor, onClose, onDeleted, onUpdated }: Props) {
  const [mode, setMode]       = useState<Mode>("view");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Edit form state
  const [title,     setTitle]     = useState(event.title);
  const [dateVal,   setDateVal]   = useState(toDateInputVal(event.startTime));
  const [startTime, setStartTime] = useState(toTimeInputVal(event.startTime));
  const [endTime,   setEndTime]   = useState(toTimeInputVal(event.endTime));
  const [location,  setLocation]  = useState(event.location ?? "");

  const popRef = useRef<HTMLDivElement>(null);

  // Position: try to appear below the event; flip if too close to bottom
  const POP_W = 300;
  const left  = Math.min(Math.max(anchor.left, 8), window.innerWidth - POP_W - 8);
  const top   = anchor.top;

  // Outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  // Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/calendar/events/${encodeURIComponent(event.id)}?calendarId=${encodeURIComponent(event.calendarId)}`,
        { method: "DELETE" }
      );
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      onDeleted(event.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה במחיקה");
      setMode("view");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = {
        calendarId: event.calendarId,
        summary:    title.trim() || event.title,
      };
      if (location !== undefined) body.location = location;
      if (!event.isAllDay) {
        body.startIso = combineDateTime(dateVal, startTime);
        body.endIso   = combineDateTime(dateVal, endTime);
      }

      const res = await fetch(
        `/api/calendar/events/${encodeURIComponent(event.id)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      const d = await res.json();
      if (d.error) throw new Error(d.error);

      // Build updated event for optimistic UI
      const newStart = event.isAllDay ? event.startTime : combineDateTime(dateVal, startTime);
      const newEnd   = event.isAllDay ? event.endTime   : combineDateTime(dateVal, endTime);
      const durationMinutes = event.isAllDay ? event.durationMinutes
        : Math.round((new Date(newEnd).getTime() - new Date(newStart).getTime()) / 60_000);

      onUpdated({
        ...event,
        title:           body.summary,
        startTime:       newStart,
        endTime:         newEnd,
        durationMinutes,
        location:        location || undefined,
        htmlLink:        d.htmlLink ?? event.htmlLink,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בשמירה");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "6px 9px",
    background: "#111", border: "1px solid #2A2A2A",
    borderRadius: 7, color: "#E0E0E0", fontSize: 13,
    fontFamily: "inherit", outline: "none", direction: "rtl",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: "#555",
    letterSpacing: "0.05em", textTransform: "uppercase",
    marginBottom: 4, display: "block", direction: "rtl",
  };

  const popover = (
    <div
      ref={popRef}
      style={{
        position:     "fixed",
        top,
        left,
        width:        POP_W,
        zIndex:       99999,
        background:   "#1C1C1C",
        border:       "1px solid #2A2A2A",
        borderRadius: 14,
        boxShadow:    "0 16px 48px rgba(0,0,0,0.9)",
        overflow:     "hidden",
        direction:    "rtl",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── View mode ── */}
      {mode === "view" && (
        <>
          {/* Header */}
          <div style={{
            padding: "14px 16px 10px",
            borderBottom: "1px solid #222",
            background: "#181818",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#F0F0F0", lineHeight: 1.35, wordBreak: "break-word" }}>
                  {event.title}
                </div>
                {event.artist && (
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{event.artist}</div>
                )}
              </div>
              <button
                onClick={onClose}
                style={{ background: "none", border: "none", color: "#444", fontSize: 18, cursor: "pointer", flexShrink: 0, lineHeight: 1, padding: 0 }}
              >×</button>
            </div>
          </div>

          {/* Details */}
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Date & time */}
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 14 }}>📅</span>
              <span style={{ fontSize: 13, color: "#C0C0C0" }}>
                {fmtDate(event.startTime)}
                {!event.isAllDay && ` · ${fmtTime(event.startTime)} – ${fmtTime(event.endTime)}`}
                {event.isAllDay && " · כל היום"}
              </span>
            </div>

            {/* Location */}
            {event.location && (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 14 }}>📍</span>
                <span style={{ fontSize: 13, color: "#C0C0C0" }}>{event.location}</span>
              </div>
            )}

            {/* Matched project */}
            {event.matchedProjectName && (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 14 }}>🎵</span>
                <span style={{ fontSize: 13, color: "#A855F7" }}>{event.matchedProjectName}</span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{
                padding: "7px 10px", borderRadius: 8,
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
                color: "#EF4444", fontSize: 12,
              }}>✗ {error}</div>
            )}
          </div>

          {/* Actions */}
          <div style={{
            padding: "10px 16px 14px",
            display: "flex", gap: 8, borderTop: "1px solid #1A1A1A",
            flexWrap: "wrap",
          }}>
            <button
              onClick={() => { setMode("edit"); setError(null); }}
              style={{
                padding: "5px 14px", borderRadius: 8,
                border: "1px solid #2A2A2A", background: "#242424",
                color: "#C0C0C0", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              ✏️ עריכה
            </button>
            <button
              onClick={() => { setMode("confirm-delete"); setError(null); }}
              style={{
                padding: "5px 14px", borderRadius: 8,
                border: "1px solid rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.08)",
                color: "#EF4444", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              🗑️ מחיקה
            </button>
            {event.htmlLink && (
              <a
                href={event.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: "5px 14px", borderRadius: 8,
                  border: "1px solid rgba(59,130,246,0.3)",
                  background: "rgba(59,130,246,0.08)",
                  color: "#3B82F6", fontSize: 12, textDecoration: "none",
                  fontFamily: "inherit", display: "inline-block",
                  marginRight: "auto",
                }}
              >
                פתח בגוגל ↗
              </a>
            )}
          </div>
        </>
      )}

      {/* ── Edit mode ── */}
      {mode === "edit" && (
        <>
          <div style={{
            padding: "12px 16px 10px",
            borderBottom: "1px solid #222",
            background: "#181818",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#C0C0C0" }}>עריכת אירוע</span>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#444", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
          </div>

          <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Title */}
            <div>
              <label style={labelStyle}>שם אירוע</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Date */}
            {!event.isAllDay && (
              <div>
                <label style={labelStyle}>תאריך</label>
                <input
                  type="date"
                  value={dateVal}
                  onChange={(e) => setDateVal(e.target.value)}
                  style={inputStyle}
                />
              </div>
            )}

            {/* Start / End time */}
            {!event.isAllDay && (
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>התחלה</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>סיום</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>
            )}

            {/* Location */}
            <div>
              <label style={labelStyle}>מיקום</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="מיקום (אופציונלי)"
                style={{ ...inputStyle, color: location ? "#E0E0E0" : "#444" }}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{
                padding: "7px 10px", borderRadius: 8,
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
                color: "#EF4444", fontSize: 12,
              }}>✗ {error}</div>
            )}

            {/* Buttons */}
            <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
              <button
                onClick={handleSave}
                disabled={busy}
                style={{
                  flex: 1, padding: "7px 0", borderRadius: 8,
                  border: "1px solid rgba(59,130,246,0.4)",
                  background: "rgba(59,130,246,0.12)",
                  color: "#3B82F6", fontSize: 13, fontWeight: 600,
                  cursor: busy ? "default" : "pointer",
                  fontFamily: "inherit", opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? "שומר..." : "שמור"}
              </button>
              <button
                onClick={() => { setMode("view"); setError(null); }}
                disabled={busy}
                style={{
                  padding: "7px 14px", borderRadius: 8,
                  border: "1px solid #252525", background: "transparent",
                  color: "#555", fontSize: 13, cursor: busy ? "default" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Confirm delete ── */}
      {mode === "confirm-delete" && (
        <>
          <div style={{
            padding: "12px 16px 10px",
            borderBottom: "1px solid #222",
            background: "#181818",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#EF4444" }}>מחיקת אירוע</span>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#444", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
          </div>

          <div style={{ padding: "16px" }}>
            <p style={{ fontSize: 13, color: "#C0C0C0", margin: "0 0 6px", direction: "rtl" }}>
              למחוק את האירוע?
            </p>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#F0F0F0", margin: "0 0 16px", direction: "rtl" }}>
              &ldquo;{event.title}&rdquo;
            </p>
            <p style={{ fontSize: 11, color: "#666", margin: "0 0 16px", direction: "rtl" }}>
              הפעולה תמחק את האירוע מגוגל קלנדר ולא ניתן לשחזר.
            </p>

            {error && (
              <div style={{
                marginBottom: 12,
                padding: "7px 10px", borderRadius: 8,
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
                color: "#EF4444", fontSize: 12,
              }}>✗ {error}</div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleDelete}
                disabled={busy}
                style={{
                  flex: 1, padding: "7px 0", borderRadius: 8,
                  border: "1px solid rgba(239,68,68,0.4)",
                  background: "rgba(239,68,68,0.12)",
                  color: "#EF4444", fontSize: 13, fontWeight: 600,
                  cursor: busy ? "default" : "pointer",
                  fontFamily: "inherit", opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? "מוחק..." : "כן, מחק"}
              </button>
              <button
                onClick={() => { setMode("view"); setError(null); }}
                disabled={busy}
                style={{
                  padding: "7px 14px", borderRadius: 8,
                  border: "1px solid #252525", background: "transparent",
                  color: "#555", fontSize: 13, cursor: busy ? "default" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  return typeof document !== "undefined" ? createPortal(popover, document.body) : null;
}
