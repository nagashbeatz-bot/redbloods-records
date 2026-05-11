"use client";

import { useState, useEffect, useRef } from "react";
import type { ParsedCalendarEvent } from "@/lib/calendar-utils";

// ─── Grid constants ───────────────────────────────────────────────────────────

const HOUR_H         = 64;   // pixels per hour
const PPM            = HOUR_H / 60;  // pixels per minute
const DAY_START_H    = 8;
const DAY_END_H      = 22;
const TOTAL_HOURS    = DAY_END_H - DAY_START_H;
const GRID_H         = TOTAL_HOURS * HOUR_H;
const TIME_COL_W     = 52;
const MIN_EVENT_H    = 24;

// ─── Label data ───────────────────────────────────────────────────────────────

const DAYS_HE   = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני",
                   "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

// ─── Event colors ─────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, { bg: string; border: string; text: string; dim: string }> = {
  "סשן":        { bg:"rgba(168,85,247,0.18)",  border:"#A855F7", text:"#C084FC", dim:"#9333EA" },
  "חזרה":       { bg:"rgba(59,130,246,0.18)",  border:"#3B82F6", text:"#93C5FD", dim:"#2563EB" },
  "הופעה":      { bg:"rgba(236,72,153,0.18)",  border:"#EC4899", text:"#F9A8D4", dim:"#DB2777" },
  "סאונדצ'ק":   { bg:"rgba(251,146,60,0.18)",  border:"#F97316", text:"#FDBA74", dim:"#EA580C" },
  "פגישה":      { bg:"rgba(16,185,129,0.18)",  border:"#10B981", text:"#6EE7B7", dim:"#059669" },
  "אחר":        { bg:"rgba(107,114,128,0.15)", border:"#6B7280", text:"#D1D5DB", dim:"#4B5563" },
};

function colorOf(type: string) {
  return TYPE_COLORS[type] ?? TYPE_COLORS["אחר"];
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getWeekSunday(weekOffset: number): Date {
  const now = new Date();
  const d   = new Date(now);
  d.setDate(now.getDate() - now.getDay() + weekOffset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDays(weekOffset: number): Date[] {
  const sun = getWeekSunday(weekOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sun);
    d.setDate(sun.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

function isToday(d: Date): boolean { return isSameDay(d, new Date()); }

function fmtHour(h: number): string {
  return `${String(h).padStart(2,"0")}:00`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function weekLabel(weekOffset: number, days: Date[]): string {
  const s = `${days[0].getDate()} ${MONTHS_HE[days[0].getMonth()]}`;
  const e = `${days[6].getDate()} ${MONTHS_HE[days[6].getMonth()]}`;
  if (weekOffset === 0)  return `השבוע  ${s} – ${e}`;
  if (weekOffset === -1) return `שבוע שעבר  ${s} – ${e}`;
  if (weekOffset === 1)  return `שבוע הבא  ${s} – ${e}`;
  return `${s} – ${e}`;
}

// ─── Positioning ──────────────────────────────────────────────────────────────

function topPx(startIso: string): number {
  const d    = new Date(startIso);
  const mins = d.getHours() * 60 + d.getMinutes() - DAY_START_H * 60;
  return Math.max(0, Math.round(mins * PPM));
}

function heightPx(durationMin: number): number {
  return Math.max(Math.round(durationMin * PPM), MIN_EVENT_H);
}

function nowLinePx(): number {
  const n    = new Date();
  const mins = n.getHours() * 60 + n.getMinutes() - DAY_START_H * 60;
  return Math.round(mins * PPM);
}

// ─── Overlap layout ───────────────────────────────────────────────────────────

interface LayoutEvent { event: ParsedCalendarEvent; col: number; cols: number }

function layoutDay(events: ParsedCalendarEvent[]): LayoutEvent[] {
  // Sort by start time
  const sorted = [...events].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const result: LayoutEvent[] = [];
  const columns: ParsedCalendarEvent[][] = [];

  for (const ev of sorted) {
    const evStart = new Date(ev.startTime).getTime();
    const evEnd   = new Date(ev.endTime).getTime();

    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      const last = columns[c].at(-1)!;
      if (new Date(last.endTime).getTime() <= evStart) {
        columns[c].push(ev);
        result.push({ event: ev, col: c, cols: 0 });
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([ev]);
      result.push({ event: ev, col: columns.length - 1, cols: 0 });
    }
  }

  // Set cols (total concurrent columns) for each event
  for (const item of result) {
    const evStart = new Date(item.event.startTime).getTime();
    const evEnd   = new Date(item.event.endTime).getTime();
    let maxCol = item.col;
    for (const other of result) {
      const os = new Date(other.event.startTime).getTime();
      const oe = new Date(other.event.endTime).getTime();
      if (os < evEnd && oe > evStart) maxCol = Math.max(maxCol, other.col);
    }
    item.cols = maxCol + 1;
  }

  return result;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onManageConnection: () => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WeekCalendar({ onManageConnection }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [events,     setEvents]     = useState<ParsedCalendarEvent[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [nowPx,      setNowPx]      = useState(nowLinePx());

  const scrollRef = useRef<HTMLDivElement>(null);
  const weekDays  = getWeekDays(weekOffset);

  // Scroll to ~current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, nowLinePx() - 120);
    }
  }, []);

  // Tick the current-time line every minute
  useEffect(() => {
    const id = setInterval(() => setNowPx(nowLinePx()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch events when week changes
  useEffect(() => {
    loadEvents();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const weekStart = weekDays[0].toISOString().slice(0, 10);
      const res = await fetch(`/api/calendar/week?weekStart=${weekStart}`);
      const d   = await res.json();
      if (d.error) { setError(d.error); return; }
      setEvents(d.events ?? []);
    } catch {
      setError("שגיאת רשת");
    } finally {
      setLoading(false);
    }
  }

  function dayEvents(day: Date): ParsedCalendarEvent[] {
    return events.filter((e) => !e.isAllDay && isSameDay(new Date(e.startTime), day));
  }

  function allDayEvents(day: Date): ParsedCalendarEvent[] {
    return events.filter((e) => e.isAllDay && isSameDay(new Date(e.startTime), day));
  }

  const todayInView = weekDays.some((d) => isToday(d));

  // Reverse for RTL display: Sunday appears on the RIGHT, Saturday on the LEFT
  const displayDays = [...weekDays].reverse();

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "calc(100vh - 57px)",  // viewport minus AppShell top bar
      background: "#0D0D0D", direction: "ltr",
    }}>

      {/* ── Week header ──────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", borderBottom: "1px solid #1E1E1E",
        background: "#141414", flexShrink: 0, gap: 12,
      }}>
        {/* Navigation */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <NavBtn onClick={() => setWeekOffset((w) => w - 1)}>‹</NavBtn>
          <button
            onClick={() => setWeekOffset(0)}
            style={{
              padding: "4px 10px", borderRadius: 8, border: "1px solid #2A2A2A",
              background: weekOffset === 0 ? "rgba(59,130,246,0.15)" : "#1A1A1A",
              color: weekOffset === 0 ? "#3B82F6" : "#777",
              fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            היום
          </button>
          <NavBtn onClick={() => setWeekOffset((w) => w + 1)}>›</NavBtn>
        </div>

        {/* Week label */}
        <div style={{ fontSize: 13, fontWeight: 600, color: "#C0C0C0", direction: "rtl", flex: 1, textAlign: "center" }}>
          {weekLabel(weekOffset, weekDays)}
          {loading && <span style={{ fontSize: 11, color: "#444", marginRight: 8 }}>טוען...</span>}
          {error && <span style={{ fontSize: 11, color: "#EF4444", marginRight: 8 }}>{error}</span>}
        </div>

        {/* Connection status + manage */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "3px 9px", borderRadius: 20,
            background: "rgba(16,185,129,0.08)",
            border: "1px solid rgba(16,185,129,0.2)",
          }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#10B981" }} />
            <span style={{ fontSize: 11, color: "#10B981", direction: "rtl" }}>Google Calendar מחובר</span>
          </div>
          <button
            onClick={onManageConnection}
            style={{
              padding: "3px 9px", borderRadius: 8, border: "1px solid #252525",
              background: "transparent", color: "#555", fontSize: 11,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ניהול ↗
          </button>
        </div>
      </div>

      {/* ── Day columns header ────────────────────────────────────────── */}
      <div style={{
        display: "flex", borderBottom: "1px solid #1A1A1A",
        background: "#141414", flexShrink: 0,
      }}>
        {/* spacer for time column */}
        <div style={{ width: TIME_COL_W, flexShrink: 0 }} />

        {displayDays.map((day) => {
          const dow      = day.getDay();   // 0=Sun … 6=Sat
          const today    = isToday(day);
          const workDay  = dow <= 4;       // Sun–Thu
          const allDay   = allDayEvents(day);

          return (
            <div key={dow} style={{
              flex: 1, borderRight: "1px solid #1A1A1A",
              background: today ? "rgba(59,130,246,0.05)" : "transparent",
              opacity: workDay ? 1 : 0.45,
              minWidth: 0,
            }}>
              {/* Day name + date */}
              <div style={{ padding: "8px 4px 4px", textAlign: "center" }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "#555",
                  letterSpacing: "0.05em", direction: "rtl",
                }}>
                  {DAYS_HE[dow]}
                </div>
                <div style={{
                  fontSize: 20, fontWeight: 800, lineHeight: 1.1, marginTop: 1,
                  color: today ? "#3B82F6" : "#C0C0C0",
                }}>
                  {day.getDate()}
                </div>
                <div style={{ fontSize: 9, color: "#333", direction: "rtl" }}>
                  {MONTHS_HE[day.getMonth()]}
                </div>
              </div>

              {/* All-day events */}
              {allDay.length > 0 && (
                <div style={{ padding: "0 2px 4px" }}>
                  {allDay.map((e) => {
                    const c = colorOf(e.type);
                    return (
                      <div key={e.id} style={{
                        background: c.bg, border: `1px solid ${c.border}`,
                        borderRadius: 4, padding: "1px 4px",
                        fontSize: 9, color: c.text, direction: "rtl",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        marginBottom: 2,
                      }}>
                        {e.artist || e.title}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Time grid ────────────────────────────────────────────────── */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", position: "relative" }}>
        <div style={{ display: "flex", height: GRID_H }}>

          {/* Time column */}
          <div style={{ width: TIME_COL_W, flexShrink: 0, position: "relative" }}>
            {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
              <div key={i} style={{
                position: "absolute",
                top: i * HOUR_H - 8,
                right: 0, left: 0,
                textAlign: "right", paddingRight: 6,
              }}>
                <span style={{ fontSize: 10, color: "#3A3A3A" }}>
                  {fmtHour(DAY_START_H + i)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {displayDays.map((day) => {
            const dow     = day.getDay();
            const today   = isToday(day);
            const workDay = dow <= 4;
            const layout  = layoutDay(dayEvents(day));

            return (
              <div key={dow} style={{
                flex: 1, position: "relative",
                borderRight: "1px solid #171717",
                background: today
                  ? "rgba(59,130,246,0.03)"
                  : workDay ? "transparent" : "rgba(0,0,0,0.15)",
                minWidth: 0,
              }}>
                {/* Hour grid lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div key={i} style={{
                    position: "absolute", top: i * HOUR_H,
                    left: 0, right: 0, height: 1,
                    background: i === 0 ? "transparent" : "#151515",
                  }} />
                ))}

                {/* Half-hour lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div key={`h${i}`} style={{
                    position: "absolute", top: i * HOUR_H + HOUR_H / 2,
                    left: 0, right: 0, height: 1,
                    background: "#111",
                  }} />
                ))}

                {/* Current time indicator */}
                {today && todayInView && nowPx >= 0 && nowPx <= GRID_H && (
                  <div style={{
                    position: "absolute", top: nowPx,
                    left: 0, right: 0, height: 2,
                    background: "#3B82F6", zIndex: 20,
                    boxShadow: "0 0 8px rgba(59,130,246,0.5)",
                  }}>
                    <div style={{
                      position: "absolute", right: -4, top: -4,
                      width: 10, height: 10,
                      borderRadius: "50%", background: "#3B82F6",
                    }} />
                  </div>
                )}

                {/* Events */}
                {layout.map(({ event: ev, col, cols }) => {
                  const top    = topPx(ev.startTime);
                  const height = heightPx(ev.durationMinutes);
                  const c      = colorOf(ev.type);
                  const colW   = 100 / cols;
                  const short  = height < 40;
                  const medium = height >= 40 && height < 70;

                  const displayName = ev.artist || ev.title;

                  return (
                    <div
                      key={ev.id}
                      title={[ev.title, ev.location, `${fmtTime(ev.startTime)} – ${fmtTime(ev.endTime)}`].filter(Boolean).join("\n")}
                      style={{
                        position: "absolute",
                        top, height,
                        left:  `calc(${col * colW}% + 2px)`,
                        width: `calc(${colW}% - 4px)`,
                        background:  c.bg,
                        border:      `1px solid ${c.border}`,
                        borderRadius: 7,
                        padding:     short ? "2px 5px" : "5px 7px",
                        overflow:    "hidden",
                        zIndex:      5,
                        cursor:      "default",
                        direction:   "rtl",
                        boxSizing:   "border-box",
                      }}
                    >
                      {/* Type badge (hide on very short) */}
                      {!short && (
                        <div style={{
                          fontSize: 10, fontWeight: 700,
                          color: c.dim, letterSpacing: "0.04em",
                          marginBottom: 2, textTransform: "uppercase",
                        }}>
                          {ev.type}
                        </div>
                      )}

                      {/* Artist / title */}
                      <div style={{
                        fontSize: short ? 11 : 13,
                        fontWeight: 700, color: "#E8E8E8",
                        lineHeight: 1.25,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {displayName}
                      </div>

                      {/* Project name */}
                      {!short && ev.matchedProjectName && (
                        <div style={{
                          fontSize: 11, color: "#A855F7",
                          marginTop: 1,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {ev.matchedProjectName}
                        </div>
                      )}

                      {/* Time */}
                      {!short && (
                        <div style={{ fontSize: 11, color: "#666", marginTop: medium ? 1 : 3 }}>
                          {fmtTime(ev.startTime)} – {fmtTime(ev.endTime)}
                          {ev.location && ` · ${ev.location}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Legend ───────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 12, padding: "6px 16px",
        borderTop: "1px solid #151515", background: "#141414",
        flexShrink: 0, direction: "rtl", flexWrap: "wrap",
      }}>
        {Object.entries(TYPE_COLORS).map(([type, c]) => (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: c.border, opacity: 0.8 }} />
            <span style={{ fontSize: 10, color: "#444" }}>{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── NavBtn ───────────────────────────────────────────────────────────────────

function NavBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      width: 28, height: 28, borderRadius: 8,
      border: "1px solid #2A2A2A", background: "#1A1A1A",
      color: "#888", fontSize: 18, lineHeight: 1,
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "inherit",
    }}>
      {children}
    </button>
  );
}
