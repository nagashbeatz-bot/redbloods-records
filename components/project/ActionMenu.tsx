"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ACTIONS, type ActionDef } from "@/lib/action-types";
import ScheduleModal from "./ScheduleModal";
import QuickTxModal from "@/components/finance/QuickTxModal";
import { useProjects } from "@/components/ProjectsProvider";

interface Props {
  projectId:   string;
  projectName: string;
  artist:      string;
  onSessionCreated?: () => void;
}

export default function ActionMenu({ projectId, projectName, artist, onSessionCreated }: Props) {
  const [open,          setOpen]          = useState(false);
  const [active,        setActive]        = useState<ActionDef | null>(null);
  const [financeType,   setFinanceType]   = useState<"income" | "expense" | null>(null);
  const [pos,           setPos]           = useState({ top: 0, left: 0, openUp: false });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [deleteError,   setDeleteError]   = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const { deleteProject } = useProjects();

  // Finance section + delete section adds ≈ 130 + 50 extra
  const MENU_H_ESTIMATE = ACTIONS.length * 41 + 48 + 130 + 50;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    // Tell all other menus to close
    document.dispatchEvent(new CustomEvent("rb-menu-open", { detail: { id: projectId } }));
    const r    = btnRef.current!.getBoundingClientRect();
    const MENU_W = 210;
    // Flip horizontally if near right edge
    const left   = r.left + MENU_W > window.innerWidth ? r.right - MENU_W : r.left;
    // Flip vertically if near bottom edge
    const openUp = r.bottom + 6 + MENU_H_ESTIMATE > window.innerHeight;
    const top    = openUp ? r.top - MENU_H_ESTIMATE - 6 : r.bottom + 6;
    setPos({ top, left, openUp });
    setOpen(true);
  };

  // Close when another menu opens
  useEffect(() => {
    const h = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      if (id !== projectId) setOpen(false);
    };
    document.addEventListener("rb-menu-open", h);
    return () => document.removeEventListener("rb-menu-open", h);
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-rbmenu]")) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const pick = (a: ActionDef) => { setOpen(false); setActive(a); };

  const pickFinance = (type: "income" | "expense") => {
    setOpen(false);
    setFinanceType(type);
  };

  const menuItemStyle: React.CSSProperties = {
    display: "block", width: "100%",
    padding: "10px 14px",
    background: "transparent", border: "none",
    color: "#B0B0B0", fontSize: 13,
    cursor: "pointer", textAlign: "right",
    fontFamily: "inherit",
  };

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
            minWidth: 210,
            overflow: "hidden",
            direction: "rtl",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Project label */}
          <div style={{
            padding: "9px 14px 7px",
            fontSize: 10, fontWeight: 700, color: "#777",
            letterSpacing: "0.06em", textTransform: "uppercase",
            borderBottom: "1px solid #202020",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {projectName}
          </div>

          {/* ── פעולות עבודה ── */}
          <div style={{ padding: "4px 0 0" }}>
            {ACTIONS.map((a) => (
              <button key={a.id} onClick={() => pick(a)} style={menuItemStyle}
                onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLElement).style, { background: "rgba(168,85,247,0.11)", color: "#E0E0E0" })}
                onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLElement).style, { background: "transparent", color: "#B0B0B0" })}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* ── Separator ── */}
          <div style={{ height: 1, background: "#212121", margin: "4px 0" }} />

          {/* ── כספים ── */}
          <div style={{ padding: "2px 14px 4px", fontSize: 9, fontWeight: 700, color: "#444", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            כספים
          </div>
          <div style={{ padding: "0 0 4px" }}>
            <button onClick={() => pickFinance("income")} style={{ ...menuItemStyle, color: "#10B981" }}
              onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLElement).style, { background: "rgba(16,185,129,0.1)", color: "#34D399" })}
              onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLElement).style, { background: "transparent", color: "#10B981" })}
            >
              💰 הוסף הכנסה
            </button>
            <button onClick={() => pickFinance("expense")} style={{ ...menuItemStyle, color: "#F59E0B" }}
              onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLElement).style, { background: "rgba(245,158,11,0.1)", color: "#FBB040" })}
              onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLElement).style, { background: "transparent", color: "#F59E0B" })}
            >
              💸 הוסף הוצאה
            </button>
          </div>

          {/* ── Separator ── */}
          <div style={{ height: 1, background: "#212121", margin: "4px 0" }} />

          {/* ── מחיקה ── */}
          <div style={{ padding: "0 0 4px" }}>
            <button
              onClick={() => { setOpen(false); setDeleteError(null); setConfirmDelete(true); }}
              style={{ ...menuItemStyle, color: "#F87171" }}
              onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLElement).style, { background: "rgba(220,38,38,0.12)", color: "#FCA5A5" })}
              onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLElement).style, { background: "transparent", color: "#F87171" })}
            >
              🗑 מחק פרויקט
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Schedule modal */}
      {active && (
        <ScheduleModal
          action={active}
          projectId={projectId}
          projectName={projectName}
          artist={artist}
          onClose={() => setActive(null)}
          onSessionCreated={onSessionCreated}
        />
      )}

      {/* Finance quick-add modal */}
      {financeType && (
        <QuickTxModal
          projectId={projectId}
          projectName={projectName}
          artist={artist}
          initialType={financeType}
          onClose={() => setFinanceType(null)}
        />
      )}

      {/* Delete confirm modal */}
      {confirmDelete && typeof document !== "undefined" && createPortal(
        <div
          onClick={() => { if (!deleting) { setConfirmDelete(false); setDeleteError(null); } }}
          style={{
            position: "fixed", inset: 0, zIndex: 999999,
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#161616", border: "1px solid #2A2A2A",
              borderRadius: 16, padding: "24px 28px 22px",
              width: 340, direction: "rtl",
              boxShadow: "0 20px 60px rgba(0,0,0,0.9)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>🗑</div>
            <p style={{ color: "#E8E8E8", fontWeight: 700, fontSize: 15, margin: "0 0 8px" }}>
              מחיקת פרויקט
            </p>
            <p style={{ color: "#999", fontSize: 13, margin: "0 0 6px", lineHeight: 1.5 }}>
              למחוק את <strong style={{ color: "#CCC" }}>{projectName}</strong>?
            </p>
            <p style={{ color: "#666", fontSize: 12, margin: "0 0 6px", lineHeight: 1.55 }}>
              פעולה זו תמחק את הפרויקט מהמערכת ואינה ניתנת לביטול.
            </p>
            <p style={{ color: "#555", fontSize: 11, margin: "0 0 22px", lineHeight: 1.5 }}>
              קבצי Dropbox של הפרויקט לא יימחקו בשלב זה.
            </p>
            {deleteError && (
              <p style={{ color: "#F87171", fontSize: 12, margin: "0 0 14px" }}>{deleteError}</p>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                disabled={deleting}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 10,
                  border: "1px solid #2A2A2A", background: "transparent",
                  color: "#777", cursor: deleting ? "default" : "pointer",
                  fontSize: 13, fontFamily: "inherit",
                }}
              >
                ביטול
              </button>
              <button
                onClick={async () => {
                  setDeleting(true);
                  setDeleteError(null);
                  try {
                    await deleteProject(projectId);
                    setConfirmDelete(false);
                  } catch {
                    setDeleteError("שגיאה במחיקה — נסה שוב");
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 10,
                  border: "1px solid rgba(239,68,68,0.4)",
                  background: deleting ? "rgba(239,68,68,0.06)" : "rgba(239,68,68,0.12)",
                  color: deleting ? "#888" : "#EF4444",
                  cursor: deleting ? "default" : "pointer",
                  fontSize: 13, fontWeight: 700, fontFamily: "inherit",
                }}
              >
                {deleting ? "מוחק..." : "מחק פרויקט"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
