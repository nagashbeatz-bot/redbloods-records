"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ACTIONS, type ActionDef } from "@/lib/action-types";
import ScheduleModal from "./ScheduleModal";

interface Props {
  projectId:   string;
  projectName: string;
  artist:      string;
}

export default function ActionMenu({ projectId, projectName, artist }: Props) {
  const [open,    setOpen]    = useState(false);
  const [active,  setActive]  = useState<ActionDef | null>(null);
  const [pos,     setPos]     = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = btnRef.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-rbmenu]")) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const pick = (a: ActionDef) => { setOpen(false); setActive(a); };

  return (
    <>
      {/* ⚡ trigger */}
      <button
        ref={btnRef}
        data-rbmenu
        onClick={toggle}
        title="פעולה"
        style={{
          width: 26, height: 26,
          borderRadius: "50%",
          border: "none",
          background: open ? "rgba(168,85,247,0.22)" : "rgba(255,255,255,0.04)",
          color: open ? "#C084FC" : "#555",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, flexShrink: 0, transition: "all 0.13s",
        }}
        onMouseEnter={(e) => {
          if (!open) Object.assign((e.currentTarget as HTMLElement).style, {
            background: "rgba(168,85,247,0.14)", color: "#C084FC",
          });
        }}
        onMouseLeave={(e) => {
          if (!open) Object.assign((e.currentTarget as HTMLElement).style, {
            background: "rgba(255,255,255,0.04)", color: "#555",
          });
        }}
      >⚡</button>

      {/* Portal dropdown */}
      {open && typeof document !== "undefined" && createPortal(
        <div
          data-rbmenu
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            zIndex: 99999,
            background: "#181818",
            border: "1px solid #2A2A2A",
            borderRadius: 14,
            boxShadow: "0 16px 48px rgba(0,0,0,0.85)",
            minWidth: 196,
            overflow: "hidden",
            direction: "rtl",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* project label */}
          <div style={{
            padding: "9px 14px 7px",
            fontSize: 10, fontWeight: 700, color: "#777",
            letterSpacing: "0.06em", textTransform: "uppercase",
            borderBottom: "1px solid #202020",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {projectName}
          </div>

          {ACTIONS.map((a) => (
            <button
              key={a.id}
              onClick={() => pick(a)}
              style={{
                display: "block", width: "100%",
                padding: "10px 14px",
                background: "transparent", border: "none",
                color: "#B0B0B0", fontSize: 13,
                cursor: "pointer", textAlign: "right",
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLElement).style, {
                background: "rgba(168,85,247,0.11)", color: "#E0E0E0",
              })}
              onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLElement).style, {
                background: "transparent", color: "#B0B0B0",
              })}
            >
              {a.label}
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* Modal */}
      {active && (
        <ScheduleModal
          action={active}
          projectName={projectName}
          artist={artist}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}
