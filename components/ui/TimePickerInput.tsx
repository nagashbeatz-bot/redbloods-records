"use client";

/**
 * TimePickerInput — styled time field, twin of DatePickerInput.
 *
 * - Shows the time as HH:MM (or a placeholder) inside a clean dark trigger with a
 *   clock icon, so the FIELD looks like the rest of the system (not a bare native
 *   control).
 * - On click: opens the browser's native time picker via showPicker() (modern
 *   browsers), falling back to focus()+click().
 * - Saves in HH:MM — identical to a plain <input type="time">. No dependencies.
 */

import { useRef } from "react";

interface TimePickerInputProps {
  value: string;             // HH:MM or ""
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

export default function TimePickerInput({
  value,
  onChange,
  placeholder = "--:--",
  className,
  style,
  disabled,
}: TimePickerInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    if (disabled) return;
    const el = inputRef.current;
    if (!el) return;
    const sp = (el as HTMLInputElement & { showPicker?: () => void }).showPicker;
    if (typeof sp === "function") {
      try { sp.call(el); return; } catch { /* fall through */ }
    }
    el.focus();
    el.click();
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
      }}
      className={className}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
        ...style,
      }}
    >
      {/* Visible value — tabular for steady alignment, LTR so HH:MM reads naturally */}
      <span style={{ opacity: value ? 1 : 0.35, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "plaintext" } as React.CSSProperties}>
        {value || placeholder}
      </span>

      {/* Clock icon */}
      <span style={{ fontSize: 11, opacity: 0.35, flexShrink: 0, lineHeight: 1 }}>🕐</span>

      {/* Native input — invisible but interactive via showPicker() */}
      <input
        ref={inputRef}
        type="time"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          colorScheme: "dark",
        }}
      />
    </div>
  );
}
