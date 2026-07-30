"use client";

/**
 * TimePickerInput — modern custom time field (twin of DatePickerInput's
 * trigger look). Replaces the browser's native time roller with a clean,
 * system-themed field: type "22:00" directly, or open a simple dropdown of
 * time options in even steps. No native OS artifacts either way.
 *
 * Saves in HH:MM — identical value contract to <input type="time">.
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
  step?: number;             // minutes between dropdown options (default 15)
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

/** Normalize free-typed text ("2200", "22:0", "9:5") into HH:MM, or null if unusable. */
function normalizeTime(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  let h: number, m: number;
  if (digits.length <= 2) { h = parseInt(digits, 10); m = 0; }
  else { h = parseInt(digits.slice(0, digits.length - 2), 10); m = parseInt(digits.slice(-2), 10); }
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  h = Math.min(Math.max(h, 0), 23);
  m = Math.min(Math.max(m, 0), 59);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function TimePickerInput({
  value, onChange, placeholder = "--:--", className, style, disabled, step = 15,
}: TimePickerInputProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const [draft, setDraft] = useState(value);
  const times = buildTimes(value, step);

  // Keep the draft text in sync with external value changes (e.g. form reset).
  useEffect(() => { setDraft(value); }, [value]);

  function openPanel() {
    if (disabled) return;
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 132) });
    setOpen(true);
  }

  function commitDraft() {
    const normalized = normalizeTime(draft);
    if (normalized) {
      setDraft(normalized);
      if (normalized !== value) onChange(normalized);
    } else {
      setDraft(value); // revert unusable input
    }
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const panel = document.getElementById("rb-time-portal");
      if (panel?.contains(e.target as Node)) return;
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      commitDraft();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setDraft(value); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, value]);

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
            onMouseDown={(e) => e.preventDefault()} // keep focus so blur-commit doesn't race the click
            onClick={() => { setDraft(t); onChange(t); setOpen(false); }}
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
        ref={wrapRef}
        className={className}
        style={{
          position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 6, cursor: disabled ? "not-allowed" : "text",
          ...style,
          ...(open ? { borderColor: "rgba(99,102,241,0.55)", boxShadow: "0 0 0 3px rgba(99,102,241,0.14)" } : {}),
        }}
      >
        {/* Free-typed value — digits stay left-to-right and readable even inside an RTL field */}
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          value={draft}
          placeholder={placeholder}
          onFocus={openPanel}
          onClick={openPanel}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitDraft(); setOpen(false); }
            if (e.key === "Escape") { setDraft(value); setOpen(false); }
          }}
          onBlur={() => { commitDraft(); setOpen(false); }}
          style={{
            border: "none", outline: "none", background: "transparent", color: "inherit",
            font: "inherit", padding: 0, width: "100%",
            direction: "ltr", textAlign: "right", unicodeBidi: "plaintext",
            fontVariantNumeric: "tabular-nums",
          } as React.CSSProperties}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()} // don't blur the input before onClick runs
          onClick={() => { if (open) { setOpen(false); commitDraft(); } else { inputRef.current?.focus(); openPanel(); } }}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={{ display: "flex", flexShrink: 0, background: "none", border: "none", padding: 0, cursor: disabled ? "not-allowed" : "pointer", opacity: 0.5 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && typeof document !== "undefined" && createPortal(dropdown, document.body)}
    </>
  );
}
