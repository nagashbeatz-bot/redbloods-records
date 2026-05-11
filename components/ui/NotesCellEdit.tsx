"use client";

import { useState, useRef } from "react";
import { createPortal } from "react-dom";

interface Props {
  value: string;
  onSave: (val: string) => Promise<void>;
}

export default function NotesCellEdit({ value, onSave }: Props) {
  const [open,   setOpen]   = useState(false);
  const [draft,  setDraft]  = useState(value);
  const [saving, setSaving] = useState(false);

  const triggerRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState({ top: 0, left: 0 });

  // Sync draft when external value changes (e.g. optimistic rollback)
  // Only when popover is closed
  const prevValue = useRef(value);
  if (!open && prevValue.current !== value) {
    prevValue.current = value;
    // draft will be set fresh when popover opens
  }

  function openPopover(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const POP_H = 160; // approximate popover height
    const POP_W = 300;

    // Vertical: open below if space, else above
    const top = rect.bottom + POP_H + 8 > window.innerHeight
      ? rect.top - POP_H - 4
      : rect.bottom + 4;

    // Horizontal: anchor to right edge of cell, but clamp to viewport
    const left = Math.min(
      Math.max(rect.right - POP_W, 8),
      window.innerWidth - POP_W - 8
    );

    setPopPos({ top, left });
    setDraft(value);
    setOpen(true);
  }

  function close(save = false) {
    if (!save) { setDraft(value); }
    setOpen(false);
  }

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) { close(); return; }
    setSaving(true);
    try {
      await onSave(trimmed);
      setOpen(false);
    } catch {
      // stay open on error
    } finally {
      setSaving(false);
    }
  }

  const popover = (
    <>
      {/* Click-outside overlay */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 99998 }}
        onClick={() => close()}
      />

      {/* Popover */}
      <div
        style={{
          position: "fixed",
          top: popPos.top,
          left: popPos.left,
          width: 300,
          zIndex: 99999,
          background: "#1C1C1C",
          border: "1px solid #3B82F6",
          borderRadius: 12,
          padding: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.85)",
          direction: "rtl",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          fontSize: 10, fontWeight: 700, color: "#444",
          letterSpacing: "0.05em", textTransform: "uppercase",
          marginBottom: 8,
        }}>
          הערות
        </div>

        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); close(); }
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          rows={3}
          placeholder="הוסף הערה..."
          style={{
            width: "100%",
            background: "#111",
            border: "1px solid #2A2A2A",
            borderRadius: 8,
            color: "#E0E0E0",
            fontSize: 13,
            padding: "8px 10px",
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
            direction: "rtl",
            boxSizing: "border-box",
            lineHeight: 1.55,
          }}
        />

        <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-start" }}>
          <button
            onClick={commit}
            disabled={saving}
            style={{
              padding: "5px 14px", borderRadius: 8,
              border: "1px solid rgba(59,130,246,0.4)",
              background: "rgba(59,130,246,0.15)", color: "#3B82F6",
              fontSize: 12, fontWeight: 600,
              cursor: saving ? "default" : "pointer",
              fontFamily: "inherit", opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "שומר..." : "שמור"}
          </button>
          <button
            onClick={() => close()}
            style={{
              padding: "5px 12px", borderRadius: 8,
              border: "1px solid #252525", background: "transparent",
              color: "#555", fontSize: 12, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ביטול
          </button>
          <span style={{ marginRight: "auto", fontSize: 10, color: "#333", alignSelf: "center" }}>
            ⌘↵ לשמירה
          </span>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* View mode trigger */}
      <div
        ref={triggerRef}
        role="button"
        tabIndex={0}
        onClick={openPopover}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openPopover(e); }}
        style={{
          cursor: "text",
          borderRadius: 4,
          padding: "1px 3px",
          margin: "-1px -3px",
          transition: "background 0.12s",
          minWidth: 0,
          display: "block",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(59,130,246,0.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <span
          style={{
            fontSize: 12,
            color: value ? "#999" : "#383838",
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            direction: "rtl",
          }}
          title={value || undefined}
        >
          {value || "—"}
        </span>
      </div>

      {/* Portal popover */}
      {open && typeof document !== "undefined" && createPortal(popover, document.body)}
    </>
  );
}
