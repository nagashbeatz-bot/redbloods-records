"use client";

/**
 * DatePickerInput — fully custom calendar dropdown (no native <input type="date">
 * picker). The native picker is OS/browser-rendered chrome that ignores the app's
 * RTL layout (month-nav arrows end up backwards, wrong font, no theming), so this
 * builds the calendar ourselves — twin of TimePickerInput's portal pattern.
 *
 * - Trigger shows the date in Hebrew format (D.M.YYYY) or a placeholder.
 * - Month nav: left arrow = previous month, right arrow = next month, always —
 *   never flipped for RTL (a calendar is a timeline, not reading text).
 * - Weekday header + date grid render right-to-left (ראשון on the right), matching
 *   Hebrew calendar convention, via CSS direction (not by reordering days), so
 *   dates land under the correct weekday column without any manual mirroring.
 * - Saves in YYYY-MM-DD — identical value contract to <input type="date">.
 * - No external dependencies.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface DatePickerInputProps {
  value: string;             // YYYY-MM-DD or ""
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

const WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"]; // Sun..Sat
const MONTH_NAMES = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function pad2(n: number) { return String(n).padStart(2, "0"); }
function toISO(y: number, m: number, d: number) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }

/** Convert YYYY-MM-DD → "D.M.YYYY" for display */
function fmtHe(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`;
}

function parseISO(iso: string): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}

function todayISO(): string {
  const t = new Date();
  return toISO(t.getFullYear(), t.getMonth(), t.getDate());
}

/** 6 weeks × 7 days, starting on the Sunday on/before the 1st of the month. */
function buildGrid(y: number, m: number): { iso: string; day: number; inMonth: boolean }[] {
  const first = new Date(y, m, 1);
  const startOffset = first.getDay(); // 0 = Sunday
  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  const gridStart = new Date(y, m, 1 - startOffset);
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({
      iso: toISO(d.getFullYear(), d.getMonth(), d.getDate()),
      day: d.getDate(),
      inMonth: d.getMonth() === m,
    });
  }
  return cells;
}

export default function DatePickerInput({
  value,
  onChange,
  placeholder = "בחר תאריך",
  min,
  max,
  className,
  style,
  disabled,
}: DatePickerInputProps) {
  const btnRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const parsed = parseISO(value);
  const initial = parsed ?? parseISO(todayISO())!;
  const [viewY, setViewY] = useState(initial.y);
  const [viewM, setViewM] = useState(initial.m);

  function openPanel() {
    if (disabled) return;
    const p = parseISO(value);
    const base = p ?? parseISO(todayISO())!;
    setViewY(base.y);
    setViewM(base.m);
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 264) });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  function goPrevMonth() {
    setViewM(m => { if (m === 0) { setViewY(y => y - 1); return 11; } return m - 1; });
  }
  function goNextMonth() {
    setViewM(m => { if (m === 11) { setViewY(y => y + 1); return 0; } return m + 1; });
  }

  const grid = buildGrid(viewY, viewM);
  const weeks: typeof grid[] = [];
  for (let i = 0; i < 42; i += 7) weeks.push(grid.slice(i, i + 7));

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: "fixed", top: pos.top, left: pos.left, width: pos.width,
        zIndex: 200010, background: "#15151B", border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12, padding: 12, boxShadow: "0 18px 50px rgba(0,0,0,0.75)",
        direction: "ltr", fontFamily: "inherit",
      }}
    >
      {/* Header — left arrow = previous month, right arrow = next month. Always,
          regardless of Hebrew UI: a calendar timeline isn't reading text. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button
          type="button"
          onClick={goPrevMonth}
          aria-label="חודש קודם"
          style={navBtnStyle}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#F2F2F2" }}>
          {MONTH_NAMES[viewM]} {viewY}
        </div>
        <button
          type="button"
          onClick={goNextMonth}
          aria-label="חודש הבא"
          style={navBtnStyle}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      {/* Weekday header — direction:rtl so ראשון sits on the right (Hebrew convention) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", direction: "rtl", marginBottom: 4 }}>
        {WEEKDAYS.map(w => (
          <div key={w} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#6B6B80", padding: "4px 0" }}>{w}</div>
        ))}
      </div>

      {/* Date grid — same direction:rtl; DOM stays chronological (day 1, 2, 3…),
          only the visual placement mirrors, so dates fall under the right weekday
          column without any manual reversing of the day order. */}
      <div style={{ direction: "rtl" }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {week.map(cell => {
              const isSelected = cell.iso === value;
              const isToday = cell.iso === todayISO();
              const outOfRange = !!(min && cell.iso < min) || !!(max && cell.iso > max);
              const disabledCell = !cell.inMonth || outOfRange;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  disabled={outOfRange}
                  onClick={() => { if (outOfRange) return; onChange(cell.iso); setOpen(false); }}
                  style={{
                    margin: 2, height: 30, borderRadius: 8, border: "none",
                    cursor: outOfRange ? "not-allowed" : "pointer", fontFamily: "inherit",
                    fontSize: 12.5, fontVariantNumeric: "tabular-nums",
                    background: isSelected ? "rgba(220,38,38,0.9)" : (isToday ? "rgba(255,255,255,0.08)" : "transparent"),
                    color: isSelected ? "#fff" : disabledCell ? "#3E3E4A" : "#D8D8DE",
                    fontWeight: isSelected || isToday ? 800 : 500,
                    opacity: cell.inMonth ? 1 : 0.4,
                  }}
                  onMouseEnter={(e) => { if (!isSelected && !outOfRange) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)"; }}
                  onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = isToday ? "rgba(255,255,255,0.08)" : "transparent"; }}
                >{cell.day}</button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer shortcuts */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <button type="button" onClick={() => { onChange(""); setOpen(false); }} style={footerBtnStyle}>נקה</button>
        <button
          type="button"
          onClick={() => { const t = todayISO(); onChange(t); setOpen(false); }}
          style={{ ...footerBtnStyle, color: "#A5B4FC", fontWeight: 800 }}
        >היום</button>
      </div>
    </div>
  );

  return (
    <>
      <div
        ref={btnRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={openPanel}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPanel(); }
        }}
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          cursor: disabled ? "not-allowed" : "pointer",
          userSelect: "none",
          ...style,
          ...(open ? { borderColor: "rgba(99,102,241,0.55)", boxShadow: "0 0 0 3px rgba(99,102,241,0.14)" } : {}),
        }}
      >
        {/* Visible label — dates read left-to-right even inside an RTL field */}
        <span style={{ color: value ? "inherit" : undefined, opacity: value ? 1 : 0.35, direction: "ltr", unicodeBidi: "plaintext" } as React.CSSProperties}>
          {value ? fmtHe(value) : placeholder}
        </span>

        {/* Calendar icon */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
          <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      {/* Portal rendered as a SIBLING of the trigger, not a child of it — a
          portal's events bubble through the React tree (not the DOM tree), so
          nesting it inside the trigger's onClick={openPanel} meant every click
          inside the calendar (e.g. the month-nav arrows) re-triggered openPanel()
          right after, which re-synced viewY/viewM from `value` and silently
          cancelled the month change on the same click. */}
      {open && typeof document !== "undefined" && createPortal(panel, document.body)}
    </>
  );
}

const navBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 26, height: 26, borderRadius: 7, border: "none", cursor: "pointer",
  background: "rgba(255,255,255,0.06)", color: "#D8D8DE",
};

const footerBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
  fontSize: 12, fontWeight: 700, color: "#9A9AB0", padding: "4px 6px",
};
