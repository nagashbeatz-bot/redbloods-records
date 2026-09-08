"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { ProjectType } from "@/lib/types";
import { useProjects } from "@/components/ProjectsProvider";

// The types offered for inline table editing. Matches the canonical
// `projectType` field / `project_type` column and the filter values — a subset
// of PROJECT_TYPES chosen for quick classification from the table.
const TYPE_OPTIONS: ProjectType[] = ["שיר", "קליפ", "EP", "אלבום", "רידים", "אחר"];

const TYPE_COLORS: Record<string, string> = {
  "שיר":         "#3B82F6",
  "קליפ":        "#F59E0B",
  "EP":          "#A855F7",
  "אלבום":       "#EC4899",
  "רידים":       "#10B981",
  "שיר + קליפ":  "#DC2626",
  "לימודים":     "#6366F1",
  "אחר":         "#6B7280",
};

function typeColor(t: string): string {
  return TYPE_COLORS[t] ?? "#6B7280";
}

interface Props {
  projectId: string;
  projectType: ProjectType;
  small?: boolean;
}

export default function ProjectTypeDropdown({ projectId, projectType, small }: Props) {
  const { updateProjectField } = useProjects();
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<{ top?: number; bottom?: number; left: number; minWidth: number }>({ left: 0, minWidth: 150 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      const portal = document.getElementById("project-type-dropdown-portal");
      if (portal && portal.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    return () => { if (errorTimer.current) clearTimeout(errorTimer.current); };
  }, []);

  const handleTrigger = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (saving) return;
    if (triggerRef.current) {
      const rect      = triggerRef.current.getBoundingClientRect();
      const dropWidth = 150;
      const DROP_H    = 280; // 6 options × ~38px + padding
      const left      = Math.max(rect.right - dropWidth, 8);
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      if (spaceBelow >= DROP_H) {
        setDropPos({ top: rect.bottom + 4, left, minWidth: dropWidth });
      } else {
        setDropPos({ bottom: window.innerHeight - rect.top + 4, left, minWidth: dropWidth });
      }
    }
    setOpen((v) => !v);
  };

  const doUpdate = useCallback(async (next: ProjectType) => {
    setSaving(true);
    setError(null);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    try {
      await updateProjectField(projectId, "projectType", next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה";
      setError(msg);
      errorTimer.current = setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  }, [projectId, updateProjectField]);

  const handleSelect = async (e: React.MouseEvent, next: ProjectType) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen(false);
    if (next === projectType || saving) return;
    await doUpdate(next);
  };

  const hasType = Boolean(projectType);
  const color   = hasType ? typeColor(projectType) : "#6B7280";

  const dropdown = (
    <div
      id="project-type-dropdown-portal"
      style={{
        position: "fixed",
        top:      dropPos.top,
        bottom:   dropPos.bottom,
        left:     dropPos.left,
        zIndex:   99999,
        background: "#1A1A1A",
        border:   "1px solid #333",
        borderRadius: 12,
        padding:  6,
        minWidth: dropPos.minWidth,
        boxShadow: "0 8px 32px rgba(0,0,0,0.75)",
      }}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
    >
      {TYPE_OPTIONS.map((t) => {
        const active = t === projectType;
        const c = typeColor(t);
        return (
          <button
            key={t}
            onClick={(e) => handleSelect(e, t)}
            style={{
              display:    "block",
              width:      "100%",
              textAlign:  "right",
              padding:    "7px 10px",
              borderRadius: 8,
              border:     "none",
              cursor:     "pointer",
              fontSize:   13,
              fontFamily: "inherit",
              background: active ? `${c}18` : "transparent",
              color:      active ? c : "#C0C0C0",
              fontWeight: active ? 600 : 400,
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLButtonElement).style.background = "#252525";
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
    >
      <button
        ref={triggerRef}
        onClick={handleTrigger}
        title="שנה סוג פרויקט"
        disabled={saving}
        style={{
          background: "none",
          border:     "none",
          padding:    0,
          cursor:     saving ? "wait" : "pointer",
          display:    "inline-flex",
          alignItems: "center",
          opacity:    saving ? 0.6 : 1,
        }}
      >
        {hasType ? (
          <span
            style={{
              fontSize: small ? 10 : 11,
              fontWeight: 600,
              color,
              background: `${color}18`,
              border: `1px solid ${color}35`,
              borderRadius: 6,
              padding: "1px 6px",
              whiteSpace: "nowrap",
            }}
          >
            {projectType}
          </span>
        ) : (
          <span
            style={{
              fontSize: small ? 10 : 11,
              fontWeight: 500,
              color: "#555",
              background: "rgba(255,255,255,0.03)",
              border: "1px dashed #333",
              borderRadius: 6,
              padding: "1px 8px",
              whiteSpace: "nowrap",
            }}
          >
            לא סווג
          </span>
        )}
      </button>

      {error && (
        <div
          style={{
            position:  "absolute",
            top:       "calc(100% + 4px)",
            right:     0,
            zIndex:    120,
            background: "#2A1010",
            border:    "1px solid #5A1A1A",
            borderRadius: 8,
            padding:   "4px 10px",
            fontSize:  12,
            color:     "#FF6B6B",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {error}
        </div>
      )}

      {open && typeof document !== "undefined" &&
        createPortal(dropdown, document.body)}
    </div>
  );
}
