"use client";

/**
 * TimePickerInput — modern custom time dropdown (twin of DatePickerInput's
 * trigger look). Replaces the browser's native time roller with a clean,
 * system-themed dropdown of 15-minute options, so there are no native
 * artifacts. Saves in HH:MM — identical value contract to <input type="time">.
 *
 * Only used by the rehearsal modal (safe to own its UI). Same props API as
 * before (value/onChange/placeholder/className/style/disabled).
 */

import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";

interface TimePickerInputProps {
  value: string;             // HH:MM or ""
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  step?: number;             // minutes between options (default 15)
}

function buildTimes(current: string, step: number): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  // Keep an existing off-grid value selectable (e.g. a legacy 20:10).
  if (current && !out.includes(current)) { out.push(current); out.sort(); }
  return out;
}

export default function TimePickerInput({
  value, onChange, placeholder = "--:--", className, style, disabled, step = 15,
}: TimePickerInputProps) {
  const btnRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const times = buildTimes(value, step);

  function openPanel() {
    if (disabled) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const panel = document.getElementById("rb-time-portal");
      if (panel?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  // Scroll the selected option into view when the panel opens.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const sel = listRef.current.querySelector<HTMLElement>("[data-selected='true']");
    if (sel) sel.scrollIntoView({ block: "center" });
  }, [open]);

  const dropdown = (
    <div
      id="rb-time-portal"
      style={{
        position: "fixed", top: pos.top, left: pos.left, width: Math.max(pos.width, 132),
        zIndex: 200010, background: "#15151B", border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12, padding: 6, boxShadow: "0 18px 50px rgba(0,0,0,0.75)",
        maxHeight: 244, overflowY: "auto", direction: "ltr",
      }}
      ref={listRef}
    >
      {times.map((t) => {
        const active = t === value;
        return (
          <button
            key={t}
            type="button"
            data-selected={active}
            onClick={() => { onChange(t); setOpen(false); }}
            style={{
              display: "block", width: "100%", textAlign: "center", padding: "8px 10px",
              borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit",
              fontSize: 13, fontVariantNumeric: "tabular-nums",
              background: active ? "rgba(99,102,241,0.22)" : "transparent",
              color: active ? "#A5B4FC" : "#D8D8DE", fontWeight: active ? 700 : 500,
            }}
            onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; }}
            onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >{t}</button>
        );
      })}
    </div>
  );

  return (
    <>
      <div
        ref={btnRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={openPanel}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPanel(); } }}
        className={className}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 6, cursor: disabled ? "not-allowed" : "pointer", userSelect: "none",
          ...style,
          ...(open ? { borderColor: "rgba(99,102,241,0.55)", boxShadow: "0 0 0 3px rgba(99,102,241,0.14)" } : {}),
        }}
      >
        <span style={{ opacity: value ? 1 : 0.35, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "plaintext" } as React.CSSProperties}>
          {value || placeholder}
        </span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {open && typeof document !== "undefined" && createPortal(dropdown, document.body)}
    </>
  );
}
