"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Props {
  value: string;
  artists: string[];                      // all existing artist names from board
  onSave: (val: string) => Promise<void>;
  /** Content shown in view mode. Falls back to plain value text. */
  children?: React.ReactNode;
}

const INPUT_STYLE: React.CSSProperties = {
  background: "#0D0D0D",
  border: "1px solid #3B82F6",
  borderRadius: 5,
  color: "#E8E8E8",
  fontSize: 12,
  padding: "2px 6px",
  outline: "none",
  width: "100%",
  fontFamily: "inherit",
};

export default function ArtistCellEdit({ value, artists, onSave, children }: Props) {
  const [editing, setEditing]     = useState(false);
  const [draft,   setDraft]       = useState(value);
  const [saving,  setSaving]      = useState(false);
  const [errored, setErrored]     = useState(false);
  const [hiIdx,   setHiIdx]       = useState(-1);   // highlighted dropdown index
  const inputRef      = useRef<HTMLInputElement | null>(null);
  const committingRef = useRef(false);

  // Sync draft when external value changes (e.g. optimistic rollback)
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing) {
      setTimeout(() => inputRef.current?.focus(), 0);
      setHiIdx(-1);
    }
  }, [editing]);

  // Filtered suggestions — exclude exact match and empty
  const suggestions = artists.filter(
    (a) => a && a !== draft && a.toLowerCase().includes(draft.toLowerCase())
  );

  const commit = useCallback(async (val: string) => {
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
  }, [value, onSave]);

  const cancel = () => {
    setDraft(value);
    setEditing(false);
    setErrored(false);
    setHiIdx(-1);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); cancel(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHiIdx((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHiIdx((i) => Math.max(i - 1, -1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (hiIdx >= 0 && suggestions[hiIdx]) {
        const chosen = suggestions[hiIdx];
        setDraft(chosen);
        commit(chosen);
      } else {
        commit(draft);
      }
    }
    if (e.key === "Tab") {
      // Tab picks highlighted item or saves current draft
      if (hiIdx >= 0 && suggestions[hiIdx]) {
        e.preventDefault();
        const chosen = suggestions[hiIdx];
        setDraft(chosen);
        commit(chosen);
      }
      // else let Tab blur naturally → onBlur will commit
    }
  };

  // ── View mode ────────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
            setDraft(value);
          }
        }}
        style={{
          cursor: "text",
          borderRadius: 4,
          padding: "1px 3px",
          margin: "-1px -3px",
          transition: "background 0.12s",
          display: "inline-flex",
          alignItems: "center",
          maxWidth: "100%",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(59,130,246,0.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {children ?? (
          <span style={{ color: value ? "#666" : "#444" }}>{value || "—"}</span>
        )}
      </div>
    );
  }

  // ── Edit mode ────────────────────────────────────────────────────────────
  const borderColor = errored ? "#EF4444" : "#3B82F6";

  return (
    <div style={{ position: "relative", width: "100%" }} onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setHiIdx(-1); }}
        onBlur={() => commit(draft)}
        onKeyDown={handleKey}
        disabled={saving}
        style={{ ...INPUT_STYLE, border: `1px solid ${borderColor}` }}
      />

      {suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            left: 0,
            zIndex: 9999,
            background: "#1A1A1A",
            border: "1px solid #2A2A2A",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            maxHeight: 160,
            overflowY: "auto",
            marginTop: 2,
          }}
        >
          {suggestions.map((a, idx) => (
            <div
              key={a}
              onMouseDown={(e) => {
                // Prevent blur before click registers
                e.preventDefault();
                setDraft(a);
                commit(a);
              }}
              onMouseEnter={() => setHiIdx(idx)}
              onMouseLeave={() => setHiIdx(-1)}
              style={{
                padding: "5px 10px",
                fontSize: 12,
                color: hiIdx === idx ? "#E8E8E8" : "#888",
                background: hiIdx === idx ? "rgba(59,130,246,0.15)" : "transparent",
                cursor: "pointer",
                transition: "background 0.1s, color 0.1s",
                textAlign: "right",
              }}
            >
              {a}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
