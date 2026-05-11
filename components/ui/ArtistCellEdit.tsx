"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Split comma/semicolon-separated artist string into individual names */
export function parseArtists(raw: string): string[] {
  return raw
    .split(/[,،;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Join array of artist names back to storage string */
export function joinArtists(arr: string[]): string {
  return arr.join(", ");
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

function ArtistChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <span
      style={{
        display:      "inline-flex",
        alignItems:   "center",
        gap:          3,
        padding:      "1px 7px",
        borderRadius: 6,
        background:   "rgba(168,85,247,0.10)",
        border:       "1px solid rgba(168,85,247,0.22)",
        color:        "#C084FC",
        fontSize:     11,
        fontWeight:   600,
        whiteSpace:   "nowrap",
        lineHeight:   "18px",
        flexShrink:   0,
      }}
    >
      {name}
      {onRemove && (
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ cursor: "pointer", color: "#7C3AED", fontSize: 13, lineHeight: 1 }}
        >
          ×
        </span>
      )}
    </span>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  value:   string;     // comma-separated storage, e.g. "נגש ביטס, אבי מולה"
  artists: string[];   // individual artist names for autocomplete
  onSave:  (val: string) => Promise<void>;
}

const MAX_VIEW = 2;

export default function ArtistCellEdit({ value, artists, onSave }: Props) {
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [tags, setTags]     = useState<string[]>([]);
  const [input, setInput]   = useState("");
  const [hiIdx, setHiIdx]   = useState(-1);

  const triggerRef          = useRef<HTMLDivElement>(null);
  const inputRef            = useRef<HTMLInputElement>(null);
  const [popPos, setPopPos] = useState({ top: 0, left: 0 });

  const parsed = parseArtists(value);

  const suggestions = artists.filter(
    (a) => a && !tags.includes(a) && a.toLowerCase().includes(input.toLowerCase())
  );

  function openPopover(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    if (!triggerRef.current) return;
    const rect  = triggerRef.current.getBoundingClientRect();
    const POP_W = 280;
    const left  = Math.min(Math.max(rect.left, 8), window.innerWidth - POP_W - 8);
    setPopPos({ top: rect.bottom + 4, left });
    setTags([...parsed]);
    setInput("");
    setHiIdx(-1);
    setOpen(true);
  }

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  function addTag(name: string) {
    const t = name.trim();
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setInput("");
    setHiIdx(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function removeTag(idx: number) {
    setTags((prev) => prev.filter((_, i) => i !== idx));
  }

  async function commit() {
    // If the user typed something but didn't press Enter yet, include it
    const pending   = input.trim();
    const finalTags = pending && !tags.includes(pending)
      ? [...tags, pending]
      : tags;
    setSaving(true);
    try {
      await onSave(joinArtists(finalTags));
      setOpen(false);
    } catch {
      /* stay open */
    } finally {
      setSaving(false);
    }
  }

  function cancel() { setOpen(false); setInput(""); }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape")    { e.preventDefault(); cancel(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHiIdx((i) => Math.min(i + 1, suggestions.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setHiIdx((i) => Math.max(i - 1, -1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (hiIdx >= 0 && suggestions[hiIdx]) addTag(suggestions[hiIdx]);
      else if (input.trim())               addTag(input);
      return;
    }
    if ((e.key === "," || e.key === ";") && input.trim()) { e.preventDefault(); addTag(input); return; }
    if (e.key === "Backspace" && !input && tags.length > 0) removeTag(tags.length - 1);
  }

  // ── Popover ────────────────────────────────────────────────────────────

  const popover = (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 99998 }} onClick={cancel} />
      <div
        style={{
          position:     "fixed",
          top:          popPos.top,
          left:         popPos.left,
          width:        280,
          zIndex:       99999,
          background:   "#1C1C1C",
          border:       "1px solid rgba(168,85,247,0.45)",
          borderRadius: 12,
          padding:      12,
          boxShadow:    "0 12px 40px rgba(0,0,0,0.85)",
          direction:    "rtl",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>
          שם אמן
        </div>

        {/* Tag input */}
        <div
          style={{
            display:      "flex",
            flexWrap:     "wrap",
            gap:          5,
            alignItems:   "center",
            marginBottom: 8,
            minHeight:    36,
            padding:      "5px 8px",
            background:   "#111",
            border:       "1px solid #2A2A2A",
            borderRadius: 8,
            cursor:       "text",
          }}
          onClick={() => inputRef.current?.focus()}
        >
          {tags.map((t, i) => (
            <ArtistChip key={t + i} name={t} onRemove={() => removeTag(i)} />
          ))}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setHiIdx(-1); }}
            onKeyDown={handleKeyDown}
            placeholder={tags.length === 0 ? "הוסף אמן..." : ""}
            style={{
              flex:       "1 1 60px",
              minWidth:   60,
              background: "transparent",
              border:     "none",
              outline:    "none",
              color:      "#E0E0E0",
              fontSize:   12,
              fontFamily: "inherit",
              direction:  "rtl",
              padding:    "1px 4px",
            }}
          />
        </div>

        {/* Autocomplete */}
        {input.trim() && suggestions.length > 0 && (
          <div style={{
            background:   "#141414",
            border:       "1px solid #2A2A2A",
            borderRadius: 8,
            marginBottom: 8,
            maxHeight:    130,
            overflowY:    "auto",
          }}>
            {suggestions.map((a, idx) => (
              <div
                key={a}
                onMouseDown={(e) => { e.preventDefault(); addTag(a); }}
                onMouseEnter={() => setHiIdx(idx)}
                onMouseLeave={() => setHiIdx(-1)}
                style={{
                  padding:    "6px 10px",
                  fontSize:   12,
                  color:      hiIdx === idx ? "#E8E8E8" : "#888",
                  background: hiIdx === idx ? "rgba(168,85,247,0.15)" : "transparent",
                  cursor:     "pointer",
                }}
              >
                {a}
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={commit}
            disabled={saving}
            style={{
              padding:      "5px 14px",
              borderRadius: 8,
              border:       "1px solid rgba(168,85,247,0.4)",
              background:   "rgba(168,85,247,0.12)",
              color:        "#A855F7",
              fontSize:     12,
              fontWeight:   600,
              cursor:       saving ? "default" : "pointer",
              fontFamily:   "inherit",
              opacity:      saving ? 0.7 : 1,
            }}
          >
            {saving ? "שומר..." : "שמור"}
          </button>
          <button
            onClick={cancel}
            style={{
              padding:      "5px 12px",
              borderRadius: 8,
              border:       "1px solid #252525",
              background:   "transparent",
              color:        "#555",
              fontSize:     12,
              cursor:       "pointer",
              fontFamily:   "inherit",
            }}
          >
            ביטול
          </button>
          <span style={{ marginRight: "auto", fontSize: 10, color: "#333", alignSelf: "center" }}>
            ↵ / פסיק להוספה
          </span>
        </div>
      </div>
    </>
  );

  // ── View ───────────────────────────────────────────────────────────────

  const viewChips = parsed.slice(0, MAX_VIEW);
  const overflow  = parsed.length - MAX_VIEW;

  return (
    <>
      <div
        ref={triggerRef}
        role="button"
        tabIndex={0}
        onClick={openPopover}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openPopover(e); }}
        style={{
          display:      "flex",
          alignItems:   "center",
          gap:          4,
          flexWrap:     "nowrap",
          overflow:     "hidden",
          cursor:       "pointer",
          borderRadius: 4,
          padding:      "1px 3px",
          margin:       "-1px -3px",
          transition:   "background 0.12s",
          minWidth:     0,
          maxWidth:     "100%",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(168,85,247,0.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {parsed.length === 0 ? (
          <span style={{ color: "#383838", fontSize: 12 }}>—</span>
        ) : (
          <>
            {viewChips.map((name) => (
              <ArtistChip key={name} name={name} />
            ))}
            {overflow > 0 && (
              <span style={{
                fontSize:     10,
                color:        "#7C3AED",
                background:   "rgba(168,85,247,0.08)",
                border:       "1px solid rgba(168,85,247,0.2)",
                borderRadius: 6,
                padding:      "1px 5px",
                flexShrink:   0,
              }}>
                +{overflow}
              </span>
            )}
          </>
        )}
      </div>

      {open && typeof document !== "undefined" && createPortal(popover, document.body)}
    </>
  );
}
