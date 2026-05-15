"use client";

import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe, getLatestAudioFile } from "@/components/PlayerProvider";
import { PROJECT_TYPES } from "@/lib/types";
import { deadlineLabel, daysUntilDeadline } from "@/lib/utils";
import StatusDropdown from "@/components/ui/StatusDropdown";
import InlineCellEdit from "@/components/ui/InlineCellEdit";
import ArtistCellEdit from "@/components/ui/ArtistCellEdit";
import NotesCellEdit from "@/components/ui/NotesCellEdit";
import UploadButton from "@/components/ui/UploadButton";
import ActionMenu from "@/components/project/ActionMenu";

// ── Types ─────────────────────────────────────────────────────────────────────
type SessionStatus = "מתוכנן" | "התקיים" | "בוטל" | "נדחה" | "לא הגיע";

interface Session {
  id: string;
  project_id: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: SessionStatus;
  notes: string;
}

interface Draft {
  date: string;
  startTime: string;
  endTime: string;
  status: SessionStatus;
  notes: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_OPTIONS: SessionStatus[] = ["מתוכנן", "התקיים", "בוטל", "נדחה", "לא הגיע"];

const STATUS_COLOR: Record<SessionStatus, string> = {
  "מתוכנן":  "#3B82F6",
  "התקיים":  "#10B981",
  "בוטל":    "#6B7280",
  "נדחה":    "#F59E0B",
  "לא הגיע": "#EF4444",
};

const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aiff", ".aif"];
function isAudio(name: string) {
  return AUDIO_EXTS.some((ext) => name.toLowerCase().endsWith(ext));
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background: "#1C1C1C", border: "1px solid #252525",
      borderRadius: 14, padding: "14px 16px", marginBottom: 10,
      ...style,
    }}>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "#252525", margin: "10px 0" }} />;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function emptyDraft(): Draft {
  return { date: "", startTime: "", endTime: "", status: "מתוכנן", notes: "" };
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

// ── Input style ───────────────────────────────────────────────────────────────
const INPUT_S: CSSProperties = {
  background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6,
  color: "#E8E8E8", fontSize: 12, padding: "4px 8px", outline: "none",
  fontFamily: "inherit", height: 28, boxSizing: "border-box",
};

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  projectId: string;
  artists: string[];
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ProjectDrawer({ projectId, artists, onClose }: Props) {
  const { projects, updateProjectField } = useProjects();
  const player = usePlayerSafe();

  // ── Session state ──────────────────────────────────────────────────────────
  const [sessions,       setSessions]       = useState<Session[]>([]);
  const [sessionLimit,   setSessionLimit]   = useState(3);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [addingSession,  setAddingSession]  = useState(false);
  const [addDraft,       setAddDraft]       = useState<Draft>(emptyDraft);
  const [addSaving,      setAddSaving]      = useState(false);
  const [editingId,      setEditingId]      = useState<string | null>(null);
  const [editDraft,      setEditDraft]      = useState<Draft>(emptyDraft);
  const [editSaving,     setEditSaving]     = useState(false);
  const [editingLimit,   setEditingLimit]   = useState(false);
  const [limitDraft,     setLimitDraft]     = useState("");

  // ── Fetch sessions ─────────────────────────────────────────────────────────
  const fetchSessions = (withSync = false) => {
    setSessionsLoaded(false);
    fetch(`/api/sessions?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions ?? []);
        setSessionLimit(d.limit ?? 3);
        setSessionsLoaded(true);

        // After loading, run calendar sync in background to remove deleted events
        if (withSync) {
          fetch(`/api/sessions/sync?projectId=${projectId}`)
            .then((r) => r.json())
            .then((s) => {
              if (s.deleted > 0) {
                // Some sessions were removed — reload the list
                fetch(`/api/sessions?projectId=${projectId}`)
                  .then((r) => r.json())
                  .then((d2) => setSessions(d2.sessions ?? []));
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => setSessionsLoaded(true));
  };

  useEffect(() => {
    setSessions([]);
    fetchSessions(true); // run calendar sync on every drawer open
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── ESC to close ───────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const project = projects.find((p) => p.id === projectId);
  if (!project || typeof document === "undefined") return null;

  // ── Player ─────────────────────────────────────────────────────────────────
  const latestAudio = getLatestAudioFile(project.files);
  const isPlaying   = player?.track?.projectId === project.id && player.playing;
  const isLoaded    = player?.track?.projectId === project.id;
  const canPlay     = !!latestAudio && !!player;

  // ── Deadline color ─────────────────────────────────────────────────────────
  const days        = daysUntilDeadline(project.deadline);
  const showDueSoon = days !== null && days >= 0 && days <= 7 && project.status !== "הושלם";
  const deadlineColor =
    project.isOverdue && project.status !== "הושלם" ? "#EF4444"
    : showDueSoon ? "#F97316"
    : "#888";

  // ── Session stats ──────────────────────────────────────────────────────────
  const done      = sessions.filter((s) => s.status === "התקיים").length;
  const planned   = sessions.filter((s) => s.status === "מתוכנן").length;
  const remaining = Math.max(0, sessionLimit - done);
  const overLimit = done > sessionLimit;
  const progress  = sessionLimit > 0 ? Math.min(100, (done / sessionLimit) * 100) : 0;

  // ── Session CRUD ───────────────────────────────────────────────────────────
  async function handleAddSession() {
    setAddSaving(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          date:      addDraft.date      || null,
          startTime: addDraft.startTime || null,
          endTime:   addDraft.endTime   || null,
          status:    addDraft.status,
          notes:     addDraft.notes,
        }),
      });
      const data = await res.json();
      if (data.session) {
        setSessions((prev) => [...prev, data.session]);
        setAddDraft(emptyDraft());
        setAddingSession(false);
      }
    } finally {
      setAddSaving(false);
    }
  }

  async function handleUpdateSession() {
    if (!editingId) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/sessions/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date:      editDraft.date      || null,
          startTime: editDraft.startTime || null,
          endTime:   editDraft.endTime   || null,
          status:    editDraft.status,
          notes:     editDraft.notes,
        }),
      });
      const data = await res.json();
      if (data.session) {
        setSessions((prev) => prev.map((s) => s.id === editingId ? data.session : s));
        setEditingId(null);
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id)); // optimistic
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  }

  async function handleLimitSave(val: string) {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 0) { setEditingLimit(false); return; }
    setSessionLimit(n);
    setEditingLimit(false);
    await fetch(`/api/sessions?projectId=${projectId}&type=limit`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: n }),
    });
  }

  function startEdit(s: Session) {
    setEditingId(s.id);
    setEditDraft({
      date:      s.date       ?? "",
      startTime: s.start_time ?? "",
      endTime:   s.end_time   ?? "",
      status:    s.status,
      notes:     s.notes,
    });
  }

  // ── Files ─────────────────────────────────────────────────────────────────
  const allFiles = [...project.files].reverse(); // newest first

  // ── Render ────────────────────────────────────────────────────────────────
  return createPortal(
    <div dir="rtl" style={{ position: "fixed", inset: 0, zIndex: 99999 }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute", inset: 0,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(2px)",
        }}
      />

      {/* Panel */}
      <div style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: 460,
        background: "#141414", borderLeft: "1px solid #252525",
        display: "flex", flexDirection: "column", zIndex: 100000,
        animation: "rb-drawer-in 240ms cubic-bezier(.22,.68,0,1.2) forwards",
      }}>
        <style>{`
          @keyframes rb-drawer-in {
            from { transform: translateX(100%); opacity: 0.6; }
            to   { transform: translateX(0);    opacity: 1;   }
          }
          .rb-session-input { background:#0D0D0D; border:1px solid #3A3A3A; border-radius:6px; color:#E8E8E8; font-size:12px; padding:4px 8px; outline:none; font-family:inherit; height:28px; box-sizing:border-box; }
          .rb-session-input:focus { border-color:#3B82F6; }
        `}</style>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 16px", height: 52, borderBottom: "1px solid #252525", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#555", fontSize: 20, lineHeight: 1, padding: "2px 4px" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#CCC")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#555")}
            >×</button>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#777" }}>פרטי פרויקט</span>
          </div>
          <Link
            href={`/projects/${project.id}`}
            style={{ fontSize: 11, color: "#444", textDecoration: "none" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#888")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#444")}
          >
            פתח עמוד מלא ↗
          </Link>
        </div>

        {/* ── Scrollable body ──────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>

          {/* Name + Artist */}
          <Card>
            <Row label="שם פרויקט">
              <InlineCellEdit value={project.name} onSave={(v) => updateProjectField(project.id, "name", v)} type="text">
                <span style={{ fontSize: 15, fontWeight: 700, color: "#E8E8E8" }}>{project.name}</span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="אמן">
              <ArtistCellEdit value={project.artist} artists={artists} onSave={(v) => updateProjectField(project.id, "artist", v)} />
            </Row>
          </Card>

          {/* Status / Deadline / Type / Parent / Notes */}
          <Card>
            <Row label="סטטוס">
              <StatusDropdown projectId={project.id} status={project.status} small />
            </Row>
            <Divider />
            <Row label="דדליין">
              <InlineCellEdit value={project.deadline || ""} onSave={(v) => updateProjectField(project.id, "deadline", v)} type="date">
                <span style={{ fontSize: 12, color: deadlineColor }}>{deadlineLabel(project.deadline)}</span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="סוג">
              <InlineCellEdit
                value={project.projectType}
                onSave={(v) => updateProjectField(project.id, "projectType", v)}
                type="select"
                options={[{ value: "", label: "ללא" }, ...PROJECT_TYPES.map((t) => ({ value: t, label: t }))]}
              >
                <span style={{ fontSize: 12, color: project.projectType ? "#E0E0E0" : "#444" }}>{project.projectType || "ללא"}</span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="שייך ל">
              <InlineCellEdit value={project.parentProject || ""} onSave={(v) => updateProjectField(project.id, "parentProject", v || "ללא שיוך")} type="text" placeholder="ללא שיוך">
                <span style={{ fontSize: 12, color: project.parentProject ? "#888" : "#444" }}>{project.parentProject || "—"}</span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="הערות">
              <NotesCellEdit value={project.notes || ""} onSave={(v) => updateProjectField(project.id, "notes", v)} />
            </Row>
          </Card>

          {/* ── מעקב סשנים ──────────────────────────────────────────────── */}
          <Card>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>מעקב סשנים</span>
              <button
                onClick={() => { setAddingSession(true); setAddDraft(emptyDraft()); }}
                style={{
                  fontSize: 11, color: "#3B82F6", background: "rgba(59,130,246,0.08)",
                  border: "1px solid rgba(59,130,246,0.25)", borderRadius: 8,
                  padding: "3px 10px", cursor: "pointer",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.16)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.08)")}
              >
                + הוסף סשן
              </button>
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: overLimit ? "#EF4444" : "#E8E8E8" }}>
                  סשנים: {done}/{sessionLimit}
                </span>
                {overLimit && (
                  <span style={{ fontSize: 11, color: "#EF4444", fontWeight: 600 }}>⚠ חריגה!</span>
                )}
              </div>
              <div style={{ height: 6, background: "#252525", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  width: `${progress}%`,
                  background: overLimit ? "#EF4444" : "#3B82F6",
                  transition: "width 0.3s ease",
                }} />
              </div>
            </div>

            {/* Stats row */}
            <div style={{
              display: "flex", gap: 16, fontSize: 11, color: "#666", marginBottom: 10,
            }}>
              <span>התקיימו: <strong style={{ color: "#10B981" }}>{done}</strong></span>
              <span>מתוכננים: <strong style={{ color: "#3B82F6" }}>{planned}</strong></span>
              <span>נותרו: <strong style={{ color: "#F0F0F0" }}>{remaining}</strong></span>
            </div>

            {/* Limit row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#555", marginBottom: 14 }}>
              <span>מגבלת סשנים:</span>
              {editingLimit ? (
                <input
                  autoFocus
                  type="number"
                  min={0}
                  value={limitDraft}
                  onChange={(e) => setLimitDraft(e.target.value)}
                  onBlur={() => handleLimitSave(limitDraft)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLimitSave(limitDraft);
                    if (e.key === "Escape") setEditingLimit(false);
                  }}
                  style={{ ...INPUT_S, width: 52 }}
                />
              ) : (
                <button
                  onClick={() => { setLimitDraft(String(sessionLimit)); setEditingLimit(true); }}
                  style={{
                    background: "rgba(255,255,255,0.05)", border: "1px solid #2A2A2A",
                    borderRadius: 6, padding: "2px 10px", color: "#DDD", fontSize: 12,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                  title="לחץ לעריכה"
                >
                  {sessionLimit}
                </button>
              )}
            </div>

            {/* Session list */}
            {!sessionsLoaded ? (
              <div style={{ fontSize: 11, color: "#444" }}>טוען...</div>
            ) : sessions.length === 0 && !addingSession ? (
              <div style={{ fontSize: 11, color: "#444" }}>אין סשנים עדיין</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sessions.map((s) => (
                  <div key={s.id}>
                    {editingId === s.id ? (
                      /* ── Inline edit form ── */
                      <SessionForm
                        draft={editDraft}
                        setDraft={setEditDraft}
                        saving={editSaving}
                        onSave={handleUpdateSession}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      /* ── Session row ── */
                      <div style={{
                        display: "flex", alignItems: "flex-start", gap: 8,
                        padding: "6px 8px", borderRadius: 8,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid #222",
                      }}>
                        {/* Color dot */}
                        <div style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: STATUS_COLOR[s.status], flexShrink: 0, marginTop: 4,
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: "#CCC", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600 }}>{s.date ? fmtDate(s.date) : "—"}</span>
                            {(s.start_time || s.end_time) && (
                              <span style={{ color: "#666", fontSize: 11 }}>
                                {s.start_time || ""}{ s.end_time ? `–${s.end_time}` : ""}
                              </span>
                            )}
                            <span style={{
                              fontSize: 10, fontWeight: 600,
                              color: STATUS_COLOR[s.status],
                              background: `${STATUS_COLOR[s.status]}18`,
                              border: `1px solid ${STATUS_COLOR[s.status]}35`,
                              borderRadius: 5, padding: "1px 6px",
                            }}>
                              {s.status}
                            </span>
                          </div>
                          {s.notes && (
                            <div style={{ fontSize: 11, color: "#555", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {s.notes}
                            </div>
                          )}
                        </div>
                        {/* Actions */}
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          <button
                            onClick={() => startEdit(s)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 12, padding: "2px 4px" }}
                            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#AAA")}
                            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}
                            title="ערוך"
                          >✏</button>
                          <button
                            onClick={() => handleDeleteSession(s.id)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 14, padding: "2px 4px" }}
                            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}
                            title="מחק"
                          >×</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add form */}
                {addingSession && (
                  <SessionForm
                    draft={addDraft}
                    setDraft={setAddDraft}
                    saving={addSaving}
                    onSave={handleAddSession}
                    onCancel={() => setAddingSession(false)}
                  />
                )}
              </div>
            )}
          </Card>

          {/* ── Files + Player ───────────────────────────────────────────── */}
          <Card>
            {/* Card header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>קבצים</span>
              <UploadButton
                projectId={project.id}
                projectName={project.name}
                artist={project.artist}
                existingFiles={project.files}
                size="sm"
              />
            </div>

            {/* Latest audio version */}
            {latestAudio ? (
              <div style={{
                background: "#141414", border: "1px solid #2A2A2A",
                borderRadius: 10, padding: "10px 12px", marginBottom: 10,
              }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>גרסה אחרונה</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Play/Pause */}
                  {player && (
                    <button
                      onClick={() => {
                        if (isLoaded) {
                          isPlaying ? player.pause() : player.resume();
                        } else {
                          player.play({
                            projectId: project.id,
                            projectName: project.name,
                            artist: project.artist,
                            fileName: latestAudio.name,
                            url: latestAudio.url,
                          });
                        }
                      }}
                      title={isPlaying ? "השהה" : "נגן גרסה אחרונה"}
                      style={{
                        width: 32, height: 32, borderRadius: "50%", border: "none",
                        cursor: "pointer", flexShrink: 0,
                        background: isLoaded ? "#3B82F6" : "rgba(59,130,246,0.15)",
                        color: isLoaded ? "#fff" : "#3B82F6",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        if (!isLoaded) (e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.25)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isLoaded) (e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.15)";
                      }}
                    >
                      {isPlaying ? "⏸" : "▶"}
                    </button>
                  )}
                  {/* Filename */}
                  <span
                    title={latestAudio.name}
                    style={{
                      flex: 1, fontSize: 11, color: "#CCC",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {latestAudio.name}
                  </span>
                  {/* Download */}
                  <a
                    href={latestAudio.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="הורד / פתח קובץ מקורי"
                    style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: "rgba(255,255,255,0.04)", color: "#555",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      textDecoration: "none", transition: "all 0.13s",
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLAnchorElement;
                      el.style.background = "rgba(255,255,255,0.1)";
                      el.style.color = "#AAA";
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLAnchorElement;
                      el.style.background = "rgba(255,255,255,0.04)";
                      el.style.color = "#555";
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6.5 1v7M3.5 5.5l3 3 3-3" />
                      <path d="M1.5 10.5h10" />
                    </svg>
                  </a>
                </div>
              </div>
            ) : (
              <div style={{
                padding: "12px", borderRadius: 10, border: "1px dashed #252525",
                fontSize: 12, color: "#444", textAlign: "center", marginBottom: 10,
              }}>
                אין גרסה להשמעה
              </div>
            )}

            {/* All files list — shown if more than one file */}
            {allFiles.length > 1 && (
              <div>
                <div style={{ fontSize: 10, color: "#444", marginBottom: 6 }}>כל הקבצים</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {allFiles.map((f, i) => (
                    <a
                      key={i}
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 11, color: "#555", textDecoration: "none",
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "4px 6px", borderRadius: 6,
                        transition: "color 0.12s, background 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget as HTMLAnchorElement;
                        el.style.color = "#3B82F6";
                        el.style.background = "rgba(59,130,246,0.07)";
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget as HTMLAnchorElement;
                        el.style.color = "#555";
                        el.style.background = "transparent";
                      }}
                    >
                      <span style={{ flexShrink: 0, fontSize: 10 }}>↓</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* No files at all */}
            {project.files.length === 0 && (
              <div style={{ fontSize: 11, color: "#444" }}>אין קבצים</div>
            )}
          </Card>

          {/* ── Actions ──────────────────────────────────────────────────── */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, color: "#555" }}>פעולות</span>
              <ActionMenu projectId={project.id} projectName={project.name} artist={project.artist} onSessionCreated={fetchSessions} />
            </div>
          </Card>

        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Inline session form (add / edit) ──────────────────────────────────────────
function SessionForm({
  draft, setDraft, saving, onSave, onCancel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      background: "#181818", border: "1px solid #2A2A2A",
      borderRadius: 10, padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      {/* Date + times row */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          type="date"
          value={draft.date}
          onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          className="rb-session-input"
          style={{ flex: "1 1 120px" }}
        />
        <input
          type="time"
          value={draft.startTime}
          onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
          className="rb-session-input"
          style={{ width: 90 }}
          placeholder="התחלה"
        />
        <span style={{ lineHeight: "28px", color: "#555", fontSize: 12 }}>–</span>
        <input
          type="time"
          value={draft.endTime}
          onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
          className="rb-session-input"
          style={{ width: 90 }}
          placeholder="סיום"
        />
      </div>

      {/* Status */}
      <select
        value={draft.status}
        onChange={(e) => setDraft({ ...draft, status: e.target.value as SessionStatus })}
        className="rb-session-input"
        style={{ width: "100%" }}
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {/* Notes */}
      <input
        type="text"
        value={draft.notes}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        placeholder="הערות (אופציונלי)"
        className="rb-session-input"
        style={{ width: "100%", boxSizing: "border-box" }}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
      />

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            flex: 1, padding: "5px 0", borderRadius: 7, border: "none",
            background: "#3B82F6", color: "#fff", fontSize: 12,
            cursor: saving ? "wait" : "pointer", fontFamily: "inherit",
          }}
        >
          {saving ? "שומר..." : "שמור"}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "5px 14px", borderRadius: 7,
            border: "1px solid #2A2A2A", background: "transparent",
            color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          ביטול
        </button>
      </div>
    </div>
  );
}
