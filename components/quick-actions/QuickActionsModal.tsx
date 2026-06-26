"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useProjects } from "@/components/ProjectsProvider";
import { ACTIONS, type ActionDef } from "@/lib/action-types";
import ScheduleModal from "@/components/project/ScheduleModal";

// ─── Categories shown in the central "quick actions" grid ──────────────────────
// Only "session" is wired up; the rest are placeholders for the next phase.
interface Category {
  id:     string;
  icon:   string;
  title:  string;
  desc:   string;
  active: boolean;
}

const CATEGORIES: Category[] = [
  { id: "session",        icon: "📅", title: "קבע סשן / פגישה",          desc: "תיאום מועד ביומן ושיוך לפרויקט", active: true  },
  { id: "money-in",       icon: "₪",  title: "כסף נכנס",                 desc: "רישום תשלום שהתקבל",             active: false },
  { id: "money-out",      icon: "💸", title: "כסף יצא",                  desc: "רישום הוצאה",                    active: false },
  { id: "project-update", icon: "✏️", title: "עדכון פרויקט",             desc: "שינוי סטטוס או פרטים",            active: false },
  { id: "followup",       icon: "📞", title: "פולואפ ללקוח",            desc: "תזכורת ליצירת קשר",              active: false },
  { id: "vendor-task",    icon: "🛠", title: "משימה לספק / איש צוות",    desc: "הקצאת משימה",                    active: false },
  { id: "mix-note",       icon: "🎚", title: "הערת מיקס",               desc: "הערה לסשן מיקס",                 active: false },
  { id: "clip",           icon: "🎬", title: "קליפ / צילום",            desc: "תיאום צילום",                    active: false },
];

interface Props {
  /** Optional project to pre-select (e.g. when opened from within a project). */
  initialProjectId?: string | null;
  onClose: () => void;
}

type Phase = "grid" | "picker" | "schedule";

export default function QuickActionsModal({ initialProjectId, onClose }: Props) {
  const { projects } = useProjects();
  const [phase, setPhase] = useState<Phase>("grid");

  // Placeholder feedback — id of the inactive card the user just tapped.
  const [placeholderId, setPlaceholderId] = useState<string | null>(null);

  // ── Session-picker state ────────────────────────────────────────────────────
  const [clients, setClients]       = useState<{ name: string }[]>([]);
  const [clientName, setClientName] = useState<string>("");
  const [projectId, setProjectId]   = useState<string>(initialProjectId ?? "");
  const [action, setAction]         = useState<ActionDef>(ACTIONS[0]);

  // Active (non-hidden) projects only, sorted by name for the dropdown.
  const visibleProjects = useMemo(
    () => projects.filter((p) => !p.isHidden).sort((a, b) => a.name.localeCompare(b.name, "he")),
    [projects],
  );

  // Data rule: projects have no client_id — the link is projects.artist === clients.name.
  const filteredProjects = useMemo(
    () => (clientName ? visibleProjects.filter((p) => p.artist === clientName) : visibleProjects),
    [visibleProjects, clientName],
  );

  const selectedProject = useMemo(
    () => visibleProjects.find((p) => p.id === projectId) ?? null,
    [visibleProjects, projectId],
  );

  // Load client names once (read-only; never creates clients).
  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.clients)) {
          setClients((d.clients as { name: string }[]).filter((c) => c.name));
        }
      })
      .catch(() => {});
  }, []);

  // If the chosen client no longer contains the selected project, clear it.
  useEffect(() => {
    if (projectId && !filteredProjects.some((p) => p.id === projectId)) {
      setProjectId("");
    }
  }, [filteredProjects, projectId]);

  function handleCardClick(cat: Category) {
    if (!cat.active) { setPlaceholderId(cat.id); return; }
    if (cat.id === "session") { setPlaceholderId(null); setPhase("picker"); }
  }

  // ── Schedule hand-off: reuse the existing ScheduleModal as-is ────────────────
  if (phase === "schedule" && selectedProject) {
    return (
      <ScheduleModal
        action={action}
        projectId={selectedProject.id}
        projectName={selectedProject.name}
        artist={selectedProject.artist}
        onClose={onClose}
        onSessionCreated={onClose}
      />
    );
  }

  const modal = (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100000,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#141414", border: "1px solid #262626", borderRadius: 22,
          padding: "26px 24px 22px", width: "100%", maxWidth: 560,
          maxHeight: "90vh", overflowY: "auto",
          direction: "rtl", fontFamily: "inherit",
          boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            {phase === "picker" ? (
              <button
                onClick={() => setPhase("grid")}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "none", border: "none", padding: 0, marginBottom: 6,
                  color: "#A855F7", fontSize: 11, fontWeight: 700,
                  letterSpacing: "0.07em", textTransform: "uppercase",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                ← חזרה לפעולות מהירות
              </button>
            ) : (
              <div style={{ fontSize: 11, fontWeight: 700, color: "#A855F7", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
                ⚡ פעולות מהירות
              </div>
            )}
            <div style={{ fontSize: 20, fontWeight: 800, color: "#F5F5F5", lineHeight: 1.2 }}>
              {phase === "picker" ? "קבע סשן / פגישה" : "מה תרצה לעשות?"}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="סגור"
            style={{ background: "none", border: "none", color: "#666", fontSize: 22, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* ── Grid of categories ── */}
        {phase === "grid" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleCardClick(cat)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6,
                    padding: "14px 14px", borderRadius: 14, textAlign: "right",
                    cursor: "pointer", fontFamily: "inherit", transition: "all 0.14s",
                    border: cat.active ? "1.5px solid rgba(168,85,247,0.5)" : "1px solid #242424",
                    background: cat.active ? "rgba(168,85,247,0.10)" : "#191919",
                    opacity: cat.active ? 1 : 0.85,
                  }}
                >
                  <span style={{ fontSize: 22, lineHeight: 1 }}>{cat.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: cat.active ? "#C084FC" : "#D0D0D0" }}>
                    {cat.title}
                  </span>
                  <span style={{ fontSize: 11, color: "#666", lineHeight: 1.4 }}>{cat.desc}</span>
                  {cat.active && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#A855F7", marginTop: 2 }}>פעיל ←</span>
                  )}
                </button>
              ))}
            </div>

            {placeholderId && (
              <div style={{ marginTop: 14, fontSize: 12, color: "#888", textAlign: "center" }}>
                בקרוב — הפעולה הזו תתחבר בשלב הבא
              </div>
            )}
          </>
        )}

        {/* ── Session / meeting picker ── */}
        {phase === "picker" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Client (optional) */}
            <Field label="לקוח (לא חובה)">
              <select
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                style={selectStyle}
              >
                <option value="">כל הלקוחות</option>
                {clients.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </Field>

            {/* Project */}
            <Field label="פרויקט">
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                style={selectStyle}
              >
                <option value="">בחר פרויקט…</option>
                {filteredProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.artist ? ` — ${p.artist}` : ""}
                  </option>
                ))}
              </select>
              {filteredProjects.length === 0 && (
                <div style={{ fontSize: 11, color: "#F59E0B", marginTop: 6 }}>
                  {clientName ? "אין פרויקטים ללקוח זה." : "אין פרויקטים זמינים."}
                </div>
              )}
            </Field>

            {/* Session type */}
            <Field label="סוג סשן / פגישה">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {ACTIONS.map((a) => {
                  const active = a.id === action.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => setAction(a)}
                      style={{
                        padding: "8px 14px", borderRadius: 100, cursor: "pointer", fontFamily: "inherit",
                        fontSize: 13, fontWeight: active ? 700 : 400,
                        border: `1.5px solid ${active ? "rgba(168,85,247,0.55)" : "#252525"}`,
                        background: active ? "rgba(168,85,247,0.14)" : "#1C1C1C",
                        color: active ? "#C084FC" : "#B0B0B0",
                      }}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <div style={{ fontSize: 11, color: "#555", lineHeight: 1.5 }}>
              בשלב הבא נבחר תאריך, שעה ומשך, והסשן יישמר ביומן ויקושר לפרויקט.
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
              <button
                onClick={() => selectedProject && setPhase("schedule")}
                disabled={!selectedProject}
                style={{
                  padding: "10px 20px", borderRadius: 100, fontFamily: "inherit",
                  fontSize: 13, fontWeight: 600,
                  border: "1.5px solid rgba(168,85,247,0.4)",
                  background: "rgba(168,85,247,0.14)", color: "#C084FC",
                  cursor: selectedProject ? "pointer" : "not-allowed",
                  opacity: selectedProject ? 1 : 0.4,
                }}
              >
                המשך לקביעת מועד ←
              </button>
              <button
                onClick={() => setPhase("grid")}
                style={{
                  padding: "10px 20px", borderRadius: 100, fontFamily: "inherit",
                  fontSize: 13, border: "1.5px solid #383838", background: "#1E1E1E", color: "#999",
                  cursor: "pointer",
                }}
              >
                חזור
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

// ─── Tiny helpers ───────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#777", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10,
  border: "1px solid #303030", background: "#111", color: "#E8E8E8",
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
