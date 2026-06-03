"use client";

/**
 * DatePickerInput — styled date field that opens native calendar on click.
 *
 * - Displays the date in Hebrew format (DD.MM.YYYY) or a placeholder.
 * - On click: calls showPicker() on the hidden native input (modern browsers),
 *   falls back to focus() + click() for older ones.
 * - Saves in YYYY-MM-DD — identical to a plain <input type="date">.
 * - Accepts the same className / style as any regular input (e.g. rb-session-input).
 * - No external dependencies.
 */

import { useRef } from "react";

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

/** Convert YYYY-MM-DD → "D.M.YYYY" for display */
function fmtHe(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`;
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
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    if (disabled) return;
    const el = inputRef.current;
    if (!el) return;
    // showPicker() is supported in Chrome 99+, Edge 99+, Safari 15.4+
    const sp = (el as HTMLInputElement & { showPicker?: () => void }).showPicker;
    if (typeof sp === "function") {
      try {
        sp.call(el);
        return;
      } catch {
        // fall through to focus()
      }
    }
    // Fallback: focus + programmatic click
    el.focus();
    el.click();
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
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
      {/* Visible label */}
      <span style={{ color: value ? "inherit" : undefined, opacity: value ? 1 : 0.35 }}>
        {value ? fmtHe(value) : placeholder}
      </span>

      {/* Calendar icon */}
      <span style={{ fontSize: 11, opacity: 0.35, flexShrink: 0, lineHeight: 1 }}>📅</span>

      {/* Native input — invisible but interactive via showPicker() */}
      <input
        ref={inputRef}
        type="date"
        value={value}
        min={min}
        max={max}
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
