"use client";

import { useState, useRef, useEffect } from "react";

export type InlineEditType = "text" | "date" | "select";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onSave: (val: string) => Promise<void>;
  type?: InlineEditType;
  options?: SelectOption[];       // required when type="select"
  placeholder?: string;
  /** Content shown in view mode. Falls back to plain <value> text. */
  children?: React.ReactNode;
  /** Extra styles on the view-mode wrapper */
  viewStyle?: React.CSSProperties;
}

const INPUT_BASE: React.CSSProperties = {
  background: "#0D0D0D",
  border: "1px solid #3B82F6",
  borderRadius: 5,
  color: "#E8E8E8",
  fontSize: 12,
  padding: "2px 6px",
  outline: "none",
  width: "100%",
  fontFamily: "inherit",
  // Fixed height prevents the row from expanding when editing
  height: 24,
  boxSizing: "border-box",
  lineHeight: "1",
};

export default function InlineCellEdit({
  value,
  onSave,
  type = "text",
  options,
  placeholder,
  children,
  viewStyle,
}: Props) {
  const [editing, setEditing]   = useState(false);
  const [draft,   setDraft]     = useState(value);
  const [saving,  setSaving]    = useState(false);
  const [errored, setErrored]   = useState(false);
  const inputRef      = useRef<HTMLInputElement | null>(null);
  const selectRef     = useRef<HTMLSelectElement | null>(null);
  const savedRef      = useRef(false); // guard double-save on select
  const committingRef = useRef(false); // guard double-save on Enter → blur

  // Sync draft when external value changes (optimistic update rollback)
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Focus input when entering edit mode; auto-open native select picker
  useEffect(() => {
    if (editing) {
      setTimeout(() => {
        inputRef.current?.focus();
        if (selectRef.current) {
          selectRef.current.focus();
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (selectRef.current as any).showPicker?.();
          } catch { /* not supported — user can click manually */ }
        }
      }, 30);
    }
  }, [editing]);

  const commit = async (val: string) => {
    if (committingRef.current) return;
    committingRef.current = true;
    const trimmed = val.trim();
    if (trimmed === value.trim()) { setEditing(false); committingRef.current = false; return; }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch {
      setErrored(true);
      setTimeout(() => setErrored(false), 2500);
    } finally {
      setSaving(false);
      committingRef.current = false;
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
    setErrored(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter")  { e.preventDefault(); commit(draft); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  };

  // ── View mode ────────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(value); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(true); setDraft(value); } }}
        style={{
          cursor: type === "select" ? "pointer" : "text",
          borderRadius: 4,
          padding: "1px 3px",
          margin: "-1px -3px",
          transition: "background 0.12s",
          display: "inline-flex",
          alignItems: "center",
          maxWidth: "100%",
          ...viewStyle,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = type === "select" ? "rgba(168,85,247,0.08)" : "rgba(59,130,246,0.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {children ?? <span style={{ color: value ? undefined : "#444" }}>{value || placeholder || "—"}</span>}
      </div>
    );
  }

  const borderColor = errored ? "#EF4444" : "#3B82F6";
  const inputStyle: React.CSSProperties = { ...INPUT_BASE, border: `1px solid ${borderColor}` };

  // ── Select mode ──────────────────────────────────────────────────────────
  if (type === "select" && options) {
    return (
      <select
        ref={selectRef}
        value={draft}
        onChange={async (e) => {
          if (savedRef.current) return;
          savedRef.current = true;
          const val = e.target.value;
          setDraft(val);
          setSaving(true);
          try {
            await onSave(val);
            setEditing(false);
          } catch {
            setErrored(true);
            setTimeout(() => setErrored(false), 2500);
          } finally {
            setSaving(false);
            savedRef.current = false;
          }
        }}
        onBlur={cancel}
        onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
        onClick={(e) => e.stopPropagation()}
        disabled={saving}
        style={inputStyle}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  // ── Text / Date mode ─────────────────────────────────────────────────────
  return (
    <input
      ref={inputRef}
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={handleKey}
      onClick={(e) => e.stopPropagation()}
      placeholder={placeholder}
      disabled={saving}
      style={inputStyle}
    />
  );
}
