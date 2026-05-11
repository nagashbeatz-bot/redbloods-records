"use client";

import { useState, useRef, useEffect } from "react";
import type { ProjectStatus } from "@/lib/types";
import { ALL_STATUSES } from "@/lib/types";
import { getStatusColor } from "@/lib/utils";
import { useProjects } from "@/components/ProjectsProvider";
import StatusBadge from "./Badge";

interface StatusDropdownProps {
  projectId: string;
  status: ProjectStatus;
  small?: boolean;
}

export default function StatusDropdown({ projectId, status, small }: StatusDropdownProps) {
  const { updateProjectField } = useProjects();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Clear error timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, []);

  const handleTrigger = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (saving) return;
    setOpen((v) => !v);
  };

  const handleSelect = async (e: React.MouseEvent, next: ProjectStatus) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen(false);
    if (next === status || saving) return;

    setSaving(true);
    setError(null);
    if (errorTimer.current) clearTimeout(errorTimer.current);

    try {
      // Manual user action — no confirm needed, execute immediately
      await updateProjectField(projectId, "status", next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה";
      setError(msg);
      // Auto-clear error after 3 s
      errorTimer.current = setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={ref}
      style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
    >
      {/* Trigger */}
      <button
        onClick={handleTrigger}
        title="שנה סטטוס"
        disabled={saving}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: saving ? "wait" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          opacity: saving ? 0.6 : 1,
        }}
      >
        <StatusBadge status={status} small={small} />
      </button>

      {/* Error tooltip */}
      {error && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 120,
            background: "#2A1010",
            border: "1px solid #5A1A1A",
            borderRadius: 8,
            padding: "4px 10px",
            fontSize: 12,
            color: "#FF6B6B",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {error}
        </div>
      )}

      {/* Status dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 110,
            background: "#1A1A1A",
            border: "1px solid #333",
            borderRadius: 12,
            padding: 6,
            minWidth: 160,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}
        >
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={(e) => handleSelect(e, s)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "right",
                padding: "7px 10px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "inherit",
                background: s === status ? `${getStatusColor(s)}18` : "transparent",
                color: s === status ? getStatusColor(s) : "#C0C0C0",
                fontWeight: s === status ? 600 : 400,
              }}
              onMouseEnter={(e) => {
                if (s !== status)
                  (e.currentTarget as HTMLButtonElement).style.background = "#252525";
              }}
              onMouseLeave={(e) => {
                if (s !== status)
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
