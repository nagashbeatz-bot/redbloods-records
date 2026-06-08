"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  SECTION_LABELS,
  DEFAULT_ORDER,
  type ProductionLayout,
} from "@/lib/production-layout";

interface Props {
  layout:  ProductionLayout;
  onSave:  (next: ProductionLayout) => void;
  onReset: () => void;
  onClose: () => void;
}

export default function RedFilmsLayoutModal({ layout, onSave, onReset, onClose }: Props) {
  const [order,  setOrder]  = useState<string[]>([...layout.order]);
  const [hidden, setHidden] = useState<Set<string>>(new Set(layout.hidden));

  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...order];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setOrder(next);
  }

  function moveDown(i: number) {
    if (i === order.length - 1) return;
    const next = [...order];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    setOrder(next);
  }

  function toggleHidden(id: string) {
    setHidden(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleSave() {
    onSave({ order, hidden: [...hidden] });
    onClose();
  }

  function handleReset() {
    onReset();
    onClose();
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9600,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#1A1A1A", border: "1px solid #2A2A2A",
          borderRadius: 16, padding: "24px", width: "min(420px, 92vw)",
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: "#E8E8E8", margin: 0 }}>
            ⚙️ סידור תצוגה
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: 12, color: "#555", margin: 0, lineHeight: 1.5 }}>
          סדר את הסקשנים לפי סדר ההעדפה שלך. השינויים נשמרים בדפדפן בלבד.
        </p>

        {/* Section list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {order.map((id, i) => {
            const isHidden  = hidden.has(id);
            const isFirst   = i === 0;
            const isLast    = i === order.length - 1;
            return (
              <div
                key={id}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "#141414", border: "1px solid #222",
                  borderRadius: 8, padding: "8px 10px",
                  opacity: isHidden ? 0.45 : 1,
                  transition: "opacity 0.1s",
                }}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onChange={() => toggleHidden(id)}
                  style={{ cursor: "pointer", accentColor: "#60A5FA", flexShrink: 0 }}
                />

                {/* Label */}
                <span style={{ flex: 1, fontSize: 13, color: isHidden ? "#555" : "#CCC" }}>
                  {SECTION_LABELS[id] ?? id}
                </span>

                {/* Arrows */}
                <button
                  onClick={() => moveUp(i)}
                  disabled={isFirst}
                  title="העלה"
                  style={{
                    background: "none", border: "1px solid #333", borderRadius: 5,
                    color: isFirst ? "#333" : "#888", fontSize: 11,
                    cursor: isFirst ? "default" : "pointer", padding: "2px 7px", lineHeight: 1,
                  }}
                >
                  ↑
                </button>
                <button
                  onClick={() => moveDown(i)}
                  disabled={isLast}
                  title="הורד"
                  style={{
                    background: "none", border: "1px solid #333", borderRadius: 5,
                    color: isLast ? "#333" : "#888", fontSize: 11,
                    cursor: isLast ? "default" : "pointer", padding: "2px 7px", lineHeight: 1,
                  }}
                >
                  ↓
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer buttons */}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 4 }}>
          <button
            onClick={handleReset}
            style={{
              fontSize: 12, color: "#888", background: "none",
              border: "1px solid #333", borderRadius: 8,
              cursor: "pointer", fontFamily: "inherit", padding: "6px 14px",
            }}
          >
            איפוס לברירת מחדל
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                fontSize: 12, color: "#888", background: "none",
                border: "1px solid #333", borderRadius: 8,
                cursor: "pointer", fontFamily: "inherit", padding: "6px 14px",
              }}
            >
              ביטול
            </button>
            <button
              onClick={handleSave}
              style={{
                fontSize: 12, color: "#FFF", fontWeight: 700,
                background: "#3B82F6", border: "none", borderRadius: 8,
                cursor: "pointer", fontFamily: "inherit", padding: "6px 16px",
              }}
            >
              שמור תצוגה
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
