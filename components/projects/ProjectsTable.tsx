"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import type { ProjectStatus, ProjectType, Project } from "@/lib/types";
import { ALL_STATUSES, PROJECT_TYPES, NO_AFFILIATION, isNoAffiliation } from "@/lib/types";
import { deadlineLabel, daysUntilDeadline } from "@/lib/utils";
import StatusDropdown from "@/components/ui/StatusDropdown";
import { useProjects } from "@/components/ProjectsProvider";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import UploadButton from "@/components/ui/UploadButton";
import InlineCellEdit from "@/components/ui/InlineCellEdit";
import ArtistCellEdit from "@/components/ui/ArtistCellEdit";
import DatePickerInput from "@/components/ui/DatePickerInput";
import ActionMenu from "@/components/project/ActionMenu";
import NotesCellEdit from "@/components/ui/NotesCellEdit";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";

// ── Open project from URL param (?open=<id>) ──────────────────────────────────
function OpenProjectFromURL() {
  const searchParams = useSearchParams();
  const { openProject } = useGlobalProjectDrawer();

  useEffect(() => {
    const id = searchParams.get("open");
    if (id) {
      openProject(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

type FilterStatus = ProjectStatus | "פעילים" | "כל הסטטוסים" | "באיחור" | "קרובים לדדליין";

const FILTER_OPTIONS: FilterStatus[] = [
  "פעילים",         // default — all statuses except "הושלם"
  "כל הסטטוסים",   // truly all, including completed
  "באיחור",
  "קרובים לדדליין",
  ...ALL_STATUSES,
];

// ── Urgency sort ──────────────────────────────────────────────────────────────
// Tier 0 = overdue  |  1 = due ≤7 days  |  2–7 = by status  |  8 = unknown

function urgencyTier(p: Project, days: number | null): number {
  if (p.isOverdue && p.status !== "הושלם") return 0;
  if (days !== null && days >= 0 && days <= 7 && p.status !== "הושלם") return 1;
  const STATUS_TIER: Partial<Record<ProjectStatus, number>> = {
    "בעבודה":      2,
    "מחכה למיקס":  3,
    "במיקס":       4,
    "בהשהייה":     5,
    "לא התחיל":    6,
    "הושלם":       7,
  };
  return STATUS_TIER[p.status] ?? 8;
}

function urgencyCompare(a: Project, b: Project): number {
  const dA = daysUntilDeadline(a.deadline);
  const dB = daysUntilDeadline(b.deadline);
  const tA = urgencyTier(a, dA);
  const tB = urgencyTier(b, dB);
  if (tA !== tB) return tA - tB;
  // Same tier → closest deadline first
  if (a.deadline && b.deadline) {
    const diff = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    if (diff !== 0) return diff;
  }
  if (a.deadline && !b.deadline) return -1;
  if (!a.deadline && b.deadline) return 1;
  return a.name.localeCompare(b.name, "he");
}

// Project type badge colors
const TYPE_COLORS: Record<string, string> = {
  "שיר":  "#3B82F6",
  "EP":   "#A855F7",
  "אלבום":"#EC4899",
  "קליפ": "#F59E0B",
  "רידים":"#10B981",
  "אחר":  "#6B7280",
};

function ProjectTypeBadge({ type }: { type: ProjectType }) {
  if (!type) return null;
  const color = TYPE_COLORS[type] ?? "#6B7280";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color,
        background: `${color}18`,
        border: `1px solid ${color}35`,
        borderRadius: 6,
        padding: "1px 6px",
        whiteSpace: "nowrap",
      }}
    >
      {type}
    </span>
  );
}

// ── New-project modal ─────────────────────────────────────────────────────────
function NewProjectModal({
  artists,
  clientNames,
  onClose,
  onCreate,
}: {
  artists: string[];
  clientNames: string[];
  onClose: () => void;
  onCreate: (fields: { name: string; artist: string; status: ProjectStatus; projectType: ProjectType; deadline: string; notes: string }) => Promise<{ newClientAdded?: string }>;
}) {
  const [name,        setName]        = useState("");
  const [artist,      setArtist]      = useState("");
  const [status,      setStatus]      = useState<ProjectStatus>("לא התחיל");
  const [projectType, setProjectType] = useState<ProjectType>("שיר");
  const [deadline,    setDeadline]    = useState("");
  const [notes,       setNotes]       = useState("");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [newClientWarning, setNewClientWarning] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  // Close on ESC (only if not showing warning)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !newClientWarning) onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose, newClientWarning]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("שם הפרויקט חובה"); return; }
    setSaving(true);
    setError("");
    try {
      const result = await onCreate({ name: name.trim(), artist: artist.trim(), status, projectType, deadline, notes });
      if (result?.newClientAdded) {
        setNewClientWarning(result.newClientAdded);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em",
    textTransform: "uppercase", marginBottom: 6, display: "block", textAlign: "right",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%", background: "#111", border: "1px solid #2A2A2A",
    borderRadius: 10, color: "#E8E8E8", fontSize: 13, padding: "9px 12px",
    outline: "none", direction: "rtl", fontFamily: "inherit", boxSizing: "border-box" as const,
  };
  const selectStyle: React.CSSProperties = { ...inputStyle };

  // Indicator: is artist new (not in clients)?
  const trimmedArtist = artist.trim();
  const isNewArtist = trimmedArtist.length > 0 && !clientNames.some(
    (c) => c.toLowerCase() === trimmedArtist.toLowerCase()
  );

  return createPortal(
    <div
      onClick={() => { if (!newClientWarning) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 99998,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#141414", border: "1px solid #2A2A2A",
          borderRadius: 18, padding: "28px 28px 22px",
          width: 420, maxWidth: "90vw", direction: "rtl",
          boxShadow: "0 24px 64px rgba(0,0,0,0.85)",
        }}
      >
        {/* ── Success / warning state after creation ── */}
        {newClientWarning ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#E8E8E8", margin: "0 0 10px" }}>
              הפרויקט נוצר בהצלחה!
            </h2>
            <div style={{
              background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 12, padding: "14px 16px", marginBottom: 20, textAlign: "right",
            }}>
              <p style={{ color: "#F59E0B", fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>
                🆕 אמן חדש נוסף ללקוחות
              </p>
              <p style={{ color: "#D4A855", fontSize: 12, margin: "0 0 4px" }}>
                <strong>{newClientWarning}</strong> נוסף אוטומטית לרשימת הלקוחות
              </p>
              <p style={{ color: "#888", fontSize: 12, margin: 0 }}>
                ⚡ נדרש טיפול: חסר כתובת מייל לאמן זה — כנסו ללקוחות והשלימו את הפרטים
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 10, border: "none",
                background: "#1E40AF", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
              }}
            >
              הבנתי, סגור
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#E8E8E8", margin: 0 }}>פרויקט חדש</h2>
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Name */}
              <div>
                <label style={labelStyle}>שם הפרויקט *</label>
                <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="שם הפרויקט..." />
              </div>

              {/* Artist */}
              <div>
                <label style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {isNewArtist && (
                    <span style={{ color: "#F59E0B", fontSize: 10, fontWeight: 600 }}>
                      🆕 אמן חדש — יתווסף ללקוחות
                    </span>
                  )}
                  <span>אמן</span>
                </label>
                <input
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  list="new-project-artists"
                  style={{
                    ...inputStyle,
                    borderColor: isNewArtist ? "rgba(245,158,11,0.4)" : "#2A2A2A",
                  }}
                  placeholder="שם האמן..."
                />
                <datalist id="new-project-artists">
                  {artists.map((a) => <option key={a} value={a} />)}
                </datalist>
              </div>

              {/* Status + Type row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={labelStyle}>סטטוס</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} style={selectStyle}>
                    {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>סוג</label>
                  <select value={projectType} onChange={(e) => setProjectType(e.target.value as ProjectType)} style={selectStyle}>
                    {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Deadline */}
              <div>
                <label style={labelStyle}>דדליין</label>
                <DatePickerInput value={deadline} onChange={setDeadline} style={{ ...inputStyle }} />
              </div>

              {/* Notes */}
              <div>
                <label style={labelStyle}>הערות</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} placeholder="הערות אופציונליות..." />
              </div>

              {error && <p style={{ color: "#EF4444", fontSize: 12, margin: 0, textAlign: "center" }}>{error}</p>}

              {/* Buttons */}
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button
                  type="button" onClick={onClose}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "1px solid #2A2A2A", background: "transparent", color: "#777", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}
                >
                  ביטול
                </button>
                <button
                  type="submit" disabled={saving}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: 12, border: "none",
                    background: saving ? "#1D3A5F" : "#1E40AF", color: "#fff",
                    cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                  }}
                >
                  {saving ? "שומר..." : "צור פרויקט"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Mobile project card ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "בעבודה":     { bg: "rgba(59,130,246,0.15)",  color: "#60A5FA" },
  "מחכה למיקס": { bg: "rgba(245,158,11,0.15)",  color: "#FBBF24" },
  "במיקס":      { bg: "rgba(168,85,247,0.15)",  color: "#C084FC" },
  "הושלם":      { bg: "rgba(16,185,129,0.15)",  color: "#34D399" },
  "בהשהייה":    { bg: "rgba(107,114,128,0.15)", color: "#9CA3AF" },
  "לא התחיל":   { bg: "rgba(75,85,99,0.15)",    color: "#6B7280" },
};

function MobileProjectCard({
  p,
  openProject,
  financeSummary,
}: {
  p: import("@/lib/types").Project;
  openProject: (id: string) => void;
  financeSummary: Record<string, { paid: number; agreed: number; currency: string }>;
}) {
  const days = daysUntilDeadline(p.deadline);
  const overdue = p.isOverdue && p.status !== "הושלם";
  const dueSoon = days !== null && days >= 0 && days <= 7 && p.status !== "הושלם";
  const fin = financeSummary[p.id];
  const balance = fin ? fin.agreed - fin.paid : 0;
  const sc = STATUS_COLORS[p.status] ?? { bg: "rgba(75,85,99,0.15)", color: "#6B7280" };

  const player = usePlayerSafe();
  const latestAudio = getLatestAudioFile(p.files);
  const isLoaded  = player?.track?.projectId === p.id;
  const isPlaying = isLoaded && player!.playing;

  return (
    <div
      style={{
        background: "#1A1A1A", border: "1px solid #252525",
        borderRadius: 14, overflow: "hidden",
      }}
    >
      <button
        onClick={() => openProject(p.id)}
        style={{
          width: "100%", textAlign: "right", direction: "rtl",
          background: "none", border: "none",
          padding: "14px 16px",
          cursor: "pointer", fontFamily: "inherit",
          display: "flex", flexDirection: "column", gap: 7,
        }}
      >
        {/* Row 1: name + play button */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, width: "100%" }}>
          <div style={{
            fontSize: 16, fontWeight: 700, color: "#F0F0F0",
            lineHeight: 1.3, flex: 1, textAlign: "right",
            wordBreak: "break-word",
          }}>
            {p.name}
          </div>
          {/* Play button — 44px touch target */}
          {latestAudio && player && (
            <div onClick={(e) => e.stopPropagation()}>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (isLoaded) {
                    isPlaying ? player.pause() : player.resume();
                  } else {
                    const url = await getFreshPlayUrl(latestAudio);
                    player.play({
                      projectId: p.id, projectName: p.name,
                      artist: p.artist, fileName: latestAudio.name, url,
                    });
                  }
                }}
                style={{
                  width: 36, height: 36, borderRadius: "50%", border: "none",
                  cursor: "pointer", flexShrink: 0,
                  background: isLoaded ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.08)",
                  color: isLoaded ? "#3B82F6" : "#888",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, transition: "all 0.15s",
                }}
              >
                {isPlaying ? "⏸" : "▶"}
              </button>
            </div>
          )}
        </div>

        {/* Row 2: artist */}
        {p.artist && (
          <div style={{ fontSize: 13, color: "#666", textAlign: "right" }}>{p.artist}</div>
        )}

        {/* Row 3: status + deadline tags */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 11, fontWeight: 600, borderRadius: 8, padding: "3px 10px",
            background: sc.bg, color: sc.color, whiteSpace: "nowrap",
          }}>
            {p.status}
          </span>

          {overdue && (
            <span style={{
              fontSize: 11, fontWeight: 600, borderRadius: 8, padding: "3px 10px",
              background: "rgba(239,68,68,0.08)", color: "#EF4444",
              border: "1px solid rgba(239,68,68,0.2)", whiteSpace: "nowrap",
            }}>
              {deadlineLabel(p.deadline)}
            </span>
          )}
          {!overdue && dueSoon && (
            <span style={{
              fontSize: 11, fontWeight: 600, borderRadius: 8, padding: "3px 10px",
              background: "rgba(245,158,11,0.08)", color: "#F59E0B",
              border: "1px solid rgba(245,158,11,0.2)", whiteSpace: "nowrap",
            }}>
              עוד {days} {days === 1 ? "יום" : "ימים"}
            </span>
          )}
          {!overdue && !dueSoon && p.deadline && (
            <span style={{ fontSize: 11, color: "#444" }}>
              {deadlineLabel(p.deadline)}
            </span>
          )}

          {fin && balance > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "#F59E0B", marginRight: "auto" }}>
              יתרה: {fin.currency}{balance.toLocaleString()}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

// ── Mobile filter bottom sheet ────────────────────────────────────────────────

function MobileFilterSheet({
  onClose,
  statusFilter, setStatusFilter,
  typeFilter, setTypeFilter,
  artistFilter, setArtistFilter,
  sortBy, setSortBy,
  artists,
  showHidden, setShowHidden,
}: {
  onClose: () => void;
  statusFilter: FilterStatus; setStatusFilter: (v: FilterStatus) => void;
  typeFilter: ProjectType | ""; setTypeFilter: (v: ProjectType | "") => void;
  artistFilter: string; setArtistFilter: (v: string) => void;
  sortBy: string; setSortBy: (v: string) => void;
  artists: string[];
  showHidden: boolean; setShowHidden: (v: boolean) => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 99980,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rb-sheet-in"
        style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          background: "#141414", borderTop: "1px solid #2A2A2A",
          borderRadius: "20px 20px 0 0",
          paddingBottom: "env(safe-area-inset-bottom)",
          maxHeight: "85dvh", overflowY: "auto",
          direction: "rtl",
        }}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
        </div>
        <div style={{ padding: "4px 16px 8px", fontSize: 14, fontWeight: 700, color: "#E8E8E8", textAlign: "right" }}>
          פילטרים ומיון
        </div>

        <div style={{ padding: "0 16px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Status */}
          <div>
            <div style={{ fontSize: 11, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10, textAlign: "right" }}>סטטוס</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setStatusFilter(opt)}
                  style={{
                    padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                    border: "1px solid",
                    background: statusFilter === opt ? "rgba(59,130,246,0.15)" : "#1A1A1A",
                    borderColor: statusFilter === opt ? "rgba(59,130,246,0.4)" : "#2A2A2A",
                    color: statusFilter === opt ? "#3B82F6" : "#777",
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Type */}
          <div>
            <div style={{ fontSize: 11, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10, textAlign: "right" }}>סוג</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(["", ...PROJECT_TYPES] as (ProjectType | "")[]).map((t) => {
                const label = t === "" ? "כל הסוגים" : t;
                const color = t ? (TYPE_COLORS[t] ?? "#6B7280") : "#A855F7";
                const active = typeFilter === t;
                return (
                  <button
                    key={t || "all"}
                    onClick={() => setTypeFilter(active && t !== "" ? "" : t)}
                    style={{
                      padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                      border: "1px solid",
                      background: active ? `${color}18` : "#1A1A1A",
                      borderColor: active ? `${color}40` : "#2A2A2A",
                      color: active ? color : "#777",
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Artist */}
          <div>
            <div style={{ fontSize: 11, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10, textAlign: "right" }}>אמן</div>
            <select
              value={artistFilter}
              onChange={(e) => setArtistFilter(e.target.value)}
              style={{
                width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A",
                borderRadius: 10, color: artistFilter ? "#F0F0F0" : "#666",
                fontSize: 13, padding: "10px 12px", direction: "rtl",
                fontFamily: "inherit",
              }}
            >
              <option value="">כל האמנים</option>
              {artists.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {/* Sort */}
          <div>
            <div style={{ fontSize: 11, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10, textAlign: "right" }}>מיון</div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A",
                borderRadius: 10, color: "#F0F0F0",
                fontSize: 13, padding: "10px 12px", direction: "rtl",
                fontFamily: "inherit",
              }}
            >
              <option value="updated">עודכן לאחרונה</option>
              <option value="urgency">דחיפות</option>
              <option value="deadline">דדליין</option>
              <option value="name">שם פרויקט</option>
              <option value="artist">אמן</option>
              <option value="status">סטטוס</option>
            </select>
          </div>

          {/* Hidden projects toggle */}
          <div>
            <button
              onClick={() => { setShowHidden(!showHidden); onClose(); }}
              style={{
                width: "100%", padding: "11px 16px", borderRadius: 12,
                border: `1px solid ${showHidden ? "rgba(107,114,128,0.5)" : "#2A2A2A"}`,
                background: showHidden ? "rgba(107,114,128,0.15)" : "#1A1A1A",
                color: showHidden ? "#9CA3AF" : "#555",
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                textAlign: "right",
              }}
            >
              {showHidden ? "← חזור לפרויקטים" : "🚫 הצג מוסתרים"}
            </button>
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            style={{
              width: "100%", padding: "13px 0", borderRadius: 14,
              border: "none", background: "rgba(59,130,246,0.15)",
              color: "#3B82F6", fontSize: 14, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            סגור
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Collection detail modal ───────────────────────────────────────────────────
// paidIncome = income transactions with payment_status "התקבל" or legacy "שולם"
function CollectionDetailModal({
  financeSummary,
  projects,
  onClose,
}: {
  financeSummary: Record<string, { paid: number; agreed: number; currency: string }>;
  projects: import("@/lib/types").Project[];
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;

  const knownIds = new Set(projects.map((p) => p.id));

  const allRows = Object.entries(financeSummary)
    .map(([projectId, fin]) => {
      const project = projects.find((p) => p.id === projectId);
      const remaining = Math.max(0, fin.agreed - fin.paid);
      return { projectId, project, fin, remaining, isKnown: knownIds.has(projectId) };
    })
    .filter((r) => r.fin.agreed > 0 || r.fin.paid > 0);

  // Known = project exists in loaded projects list
  const rows = allRows.filter((r) => r.isKnown).sort((a, b) => b.remaining - a.remaining);
  // Orphaned = settings/transactions for deleted or hidden projects
  const orphaned = allRows.filter((r) => !r.isKnown).sort((a, b) => b.remaining - a.remaining);

  // Total = only known projects (matches the card value exactly)
  const total = rows.reduce((s, r) => s + r.remaining, 0);

  const cell: React.CSSProperties = {
    padding: "10px 12px", fontSize: 12, borderBottom: "1px solid #1E1E1E", verticalAlign: "middle",
  };
  const hCell: React.CSSProperties = {
    padding: "8px 12px", fontSize: 10, fontWeight: 700, color: "#555",
    letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid #252525",
    textAlign: "right",
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#141414", border: "1px solid #2A2A2A", borderRadius: 18, width: "min(960px, 95vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", direction: "rtl", boxShadow: "0 24px 64px rgba(0,0,0,0.85)" }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px 14px", borderBottom: "1px solid #222", flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#F0F0F0", margin: 0 }}>פירוט גבייה</h2>
            <p style={{ fontSize: 11, color: "#555", margin: "3px 0 0" }}>
              paidIncome = סטטוסים "התקבל" + "שולם" (legacy) על עסקאות הכנסה בלבד
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>סה״כ לגבייה</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#F59E0B" }}>₪{total.toLocaleString()}</div>
            </div>
            <button
              onClick={onClose}
              style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid #2A2A2A", background: "#1A1A1A", color: "#666", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}
            >✕</button>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: "#141414", zIndex: 1 }}>
              <tr>
                {["שם פרויקט", "אמן / לקוח", "מחיר מוסכם", "התקבל בפועל", "יתרה לגבייה", "סטטוס"].map((h) => (
                  <th key={h} style={hCell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ ...cell, textAlign: "center", color: "#555" }}>אין נתונים</td></tr>
              ) : rows.map(({ projectId, project, fin, remaining }) => {
                const overpaid = fin.paid > fin.agreed && fin.agreed > 0;
                const fullyPaid = !overpaid && fin.paid >= fin.agreed && fin.agreed > 0;
                const noAgreed = fin.agreed === 0;
                const statusLabel = overpaid ? "שולם ביתר" : fullyPaid ? "שולם ✓" : noAgreed ? "אין מחיר מוסכם" : "יתרה פתוחה";
                const statusColor = overpaid ? "#A855F7" : fullyPaid ? "#34D399" : noAgreed ? "#555" : "#F59E0B";
                const rowBg = remaining > 0 ? "transparent" : fullyPaid ? "rgba(52,211,153,0.03)" : "transparent";

                return (
                  <tr key={projectId} style={{ background: rowBg }}>
                    <td style={{ ...cell, color: "#E8E8E8", fontWeight: 600 }}>
                      {project?.name ?? <span style={{ color: "#555", fontStyle: "italic" }}>פרויקט לא ידוע ({projectId.slice(0, 6)})</span>}
                    </td>
                    <td style={{ ...cell, color: "#888" }}>{project?.artist || "—"}</td>
                    <td style={{ ...cell, color: "#CCC", textAlign: "left" }}>
                      {fin.agreed > 0 ? `${fin.currency}${fin.agreed.toLocaleString()}` : <span style={{ color: "#444" }}>—</span>}
                    </td>
                    <td style={{ ...cell, color: fin.paid > 0 ? "#34D399" : "#555", textAlign: "left" }}>
                      {fin.paid > 0 ? `${fin.currency}${fin.paid.toLocaleString()}` : "0"}
                    </td>
                    <td style={{ ...cell, fontWeight: 700, textAlign: "left", color: remaining > 0 ? "#F59E0B" : "#34D399" }}>
                      {remaining > 0 ? `${fin.currency}${remaining.toLocaleString()}` : "0"}
                    </td>
                    <td style={{ ...cell }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, background: `${statusColor}15`, border: `1px solid ${statusColor}30`, borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>
                        {statusLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Orphaned section — not counted in total */}
        {orphaned.length > 0 && (
          <div style={{ borderTop: "1px solid #252525", padding: "12px 24px 8px", flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#EF4444", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
              ⚠ חריגים לבדיקה — לא נספרים בסכום ({orphaned.length})
            </div>
            <p style={{ fontSize: 10, color: "#555", margin: "0 0 8px" }}>
              נתונים כספיים שאינם משויכים לפרויקט קיים — פרויקטים שנמחקו, הוסתרו, או שגיאת ID.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {orphaned.map(({ projectId, fin, remaining }) => (
                  <tr key={projectId}>
                    <td style={{ padding: "5px 8px", fontSize: 11, color: "#777", fontFamily: "monospace" }}>{projectId.slice(0, 12)}…</td>
                    <td style={{ padding: "5px 8px", fontSize: 11, color: "#555" }}>מוסכם: {fin.agreed > 0 ? `${fin.currency}${fin.agreed.toLocaleString()}` : "—"}</td>
                    <td style={{ padding: "5px 8px", fontSize: 11, color: "#555" }}>התקבל: {fin.paid > 0 ? `${fin.currency}${fin.paid.toLocaleString()}` : "0"}</td>
                    <td style={{ padding: "5px 8px", fontSize: 11, color: "#EF4444" }}>{remaining > 0 ? `יתרה: ${fin.currency}${remaining.toLocaleString()}` : "שולם"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: "12px 24px", borderTop: "1px solid #1E1E1E", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ fontSize: 10, color: "#444", margin: 0 }}>
            נוסחה: max(0, agreedPrice − paidIncome) · מקור: טבלת settings + transactions
          </p>
          <span style={{ fontSize: 11, color: "#555" }}>{rows.length} פרויקטים · {orphaned.length > 0 ? `${orphaned.length} חריגים` : "אין חריגים"}</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ProjectsTable() {
  const { projects, loading, updateProjectField, createProject, deleteProject, refresh } = useProjects();
  const player = usePlayerSafe();
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("פעילים");
  const [typeFilter, setTypeFilter] = useState<ProjectType | "">("");
  const [parentFilter, setParentFilter] = useState("");
  const [artistFilter, setArtistFilter] = useState("");
  const [sortBy, setSortBy] = useState<"updated" | "urgency" | "deadline" | "name" | "artist" | "status">("updated");
  const [isMobile,  setIsMobile]  = useState(false);
  const [isCompact,      setIsCompact]      = useState(false); // 900–1300px
  const [isUltraCompact, setIsUltraCompact] = useState(false); // 768–900px
  const { openProject } = useGlobalProjectDrawer();
  const [showNewProject, setShowNewProject] = useState(false);
  const [confirmDeleteId,   setConfirmDeleteId]   = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState("");
  const [clientNames, setClientNames] = useState<string[]>([]);
  const [financeSummary, setFinanceSummary] = useState<Record<string, { paid: number; agreed: number; currency: string }>>({});
  const [showCollectionDetail, setShowCollectionDetail] = useState(false);

  // ── Hidden-projects mode ────────────────────────────────────────────────────
  const [showHidden,    setShowHidden]    = useState(false);
  const [hiddenProjects, setHiddenProjects] = useState<import("@/lib/types").Project[]>([]);
  const [hiddenLoading,  setHiddenLoading]  = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const fetchHidden = useCallback(() => {
    setHiddenLoading(true);
    fetch("/api/projects?hidden=1")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setHiddenProjects(d); })
      .catch(() => {})
      .finally(() => setHiddenLoading(false));
  }, []);

  useEffect(() => {
    if (showHidden) fetchHidden();
  }, [showHidden, fetchHidden]);

  // Re-fetch hidden list when a project is hidden/unhidden from the drawer
  useEffect(() => {
    const onHiddenChange = () => { refresh(); if (showHidden) fetchHidden(); };
    document.addEventListener("rb-hidden-changed", onHiddenChange);
    return () => document.removeEventListener("rb-hidden-changed", onHiddenChange);
  }, [showHidden, fetchHidden, refresh]);

  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      setIsMobile(w < 768);
      setIsUltraCompact(w >= 768 && w < 900);
      setIsCompact(w >= 900 && w < 1300);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);


  // Fetch client names for artist autocomplete
  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => {
        if (d.clients) {
          setClientNames((d.clients as { name: string }[]).map((c) => c.name));
        }
      })
      .catch(() => {});
  }, []);

  // Fetch finance summary for all projects
  const fetchFinance = () => {
    fetch("/api/transactions?all=1")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, { paid: number; agreed: number; currency: string }> = {};
        (d.transactions ?? []).forEach((t: { project_id: string; type: string; payment_status: string; amount: number }) => {
          if (!map[t.project_id]) map[t.project_id] = { paid: 0, agreed: 0, currency: "₪" };
          if (t.type === "income" && ["התקבל", "שולם"].includes(t.payment_status)) map[t.project_id].paid += t.amount;
        });
        (d.settings ?? []).forEach((s: { project_id: string; agreedPrice: number; currency: string }) => {
          if (!map[s.project_id]) map[s.project_id] = { paid: 0, agreed: 0, currency: "₪" };
          map[s.project_id].agreed = s.agreedPrice ?? 0;
          map[s.project_id].currency = s.currency ?? "₪";
        });
        setFinanceSummary(map);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchFinance();
    // Re-fetch when a QuickTxModal saves a new transaction
    document.addEventListener("rb-finance-updated", fetchFinance);
    return () => document.removeEventListener("rb-finance-updated", fetchFinance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  // Active list: visible projects or hidden projects depending on mode
  const activeProjects = showHidden ? hiddenProjects : projects;

  // Build individual artist list — projects + clients (deduplicated)
  const artists = Array.from(new Set([
    ...projects.flatMap((p) =>
      p.artist.split(/[,،;]/).map((a) => a.trim()).filter(Boolean)
    ),
    ...clientNames,
  ])).sort((a, b) => a.localeCompare(b, "he"));

  // Unique parent project values (excluding "ללא שיוך" and empty — shown as separate option)
  const uniqueParents = Array.from(
    new Set(
      activeProjects
        .map((p) => p.parentProject)
        .filter((v) => !isNoAffiliation(v))
    )
  ).sort();

  const filtered = activeProjects
    .filter((p) => {
      if (artistFilter) {
        const projectArtists = p.artist.split(/[,،;]/).map((a) => a.trim()).filter(Boolean);
        if (!projectArtists.includes(artistFilter)) return false;
      }
      if (typeFilter) {
        // For אלבום/EP/רידים: include both the project itself AND items belonging to it via parentProject
        const parentPrefix: Record<string, string> = {
          "אלבום": "אלבום:",
          "EP":    "EP:",
          "רידים": "Riddim:",
        };
        const prefix = parentPrefix[typeFilter];
        if (prefix) {
          const matchesType = p.projectType === typeFilter;
          const matchesParent = p.parentProject?.startsWith(prefix) ?? false;
          if (!matchesType && !matchesParent) return false;
        } else {
          if (p.projectType !== typeFilter) return false;
        }
      }
      if (parentFilter === NO_AFFILIATION && !isNoAffiliation(p.parentProject)) return false;
      if (parentFilter && parentFilter !== NO_AFFILIATION && p.parentProject !== parentFilter) return false;
      if (statusFilter === "פעילים") return p.status !== "הושלם";
      if (statusFilter === "כל הסטטוסים") return true;
      if (statusFilter === "באיחור") return p.isOverdue && p.status !== "הושלם";
      if (statusFilter === "קרובים לדדליין") {
        const d = daysUntilDeadline(p.deadline);
        return d !== null && d >= 0 && d <= 7 && p.status !== "הושלם";
      }
      return p.status === statusFilter;
    })
    .sort((a, b) => {
      if (sortBy === "updated") {
        const tA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tB - tA; // newest first
      }
      if (sortBy === "urgency") return urgencyCompare(a, b);
      if (sortBy === "deadline") {
        if (!a.deadline && !b.deadline) return a.name.localeCompare(b.name, "he");
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      }
      if (sortBy === "name")   return a.name.localeCompare(b.name, "he");
      if (sortBy === "artist") return a.artist.localeCompare(b.artist, "he");
      if (sortBy === "status") {
        const dA = daysUntilDeadline(a.deadline);
        const dB = daysUntilDeadline(b.deadline);
        const t = urgencyTier(a, dA) - urgencyTier(b, dB);
        return t !== 0 ? t : a.name.localeCompare(b.name, "he");
      }
      return 0;
    });

  const hasActiveFilters = statusFilter !== "פעילים" || typeFilter !== "" || artistFilter !== "" || sortBy !== "updated" || showHidden;

  return (
    <div style={{ overflowX: "hidden" }}>
      <Suspense fallback={null}>
        <OpenProjectFromURL />
      </Suspense>

      {/* ── Mobile filter sheet ─────────────────────────────────────────────── */}
      {filterSheetOpen && isMobile && (
        <MobileFilterSheet
          onClose={() => setFilterSheetOpen(false)}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          typeFilter={typeFilter} setTypeFilter={setTypeFilter}
          artistFilter={artistFilter} setArtistFilter={setArtistFilter}
          sortBy={sortBy} setSortBy={(v) => setSortBy(v as typeof sortBy)}
          artists={artists}
          showHidden={showHidden} setShowHidden={(v) => {
            setShowHidden(v);
            if (v) { setStatusFilter("פעילים"); setTypeFilter(""); setParentFilter(""); setArtistFilter(""); }
          }}
        />
      )}

      {/* ── Mobile: compact header bar ──────────────────────────────────────── */}
      {isMobile && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <button
            onClick={() => setShowNewProject(true)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "9px 14px", borderRadius: 12,
              border: "1px solid rgba(59,130,246,0.35)",
              background: "rgba(59,130,246,0.08)",
              color: "#3B82F6", fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            חדש
          </button>

          <span style={{ flex: 1, fontSize: 12, color: "#555", textAlign: "center" }}>
            {filtered.length} פרויקטים
          </span>

          <button
            onClick={() => setFilterSheetOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "9px 14px", borderRadius: 12,
              border: "1px solid",
              borderColor: hasActiveFilters ? "rgba(168,85,247,0.4)" : "#252525",
              background: hasActiveFilters ? "rgba(168,85,247,0.12)" : "#1A1A1A",
              color: hasActiveFilters ? "#A855F7" : "#666",
              fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ⚙ פילטרים
            {hasActiveFilters && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#A855F7", display: "inline-block" }} />}
          </button>
        </div>
      )}

      {/* ── Desktop: header + summary + filters ────────────────────────────── */}
      {!isMobile && (
        <>
          {/* Page header row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F0", margin: 0 }}>
                {showHidden ? "פרויקטים מוסתרים" : "פרויקטים"}
              </h1>
              <p style={{ fontSize: 12, color: "#555", margin: "3px 0 0" }}>
                {showHidden
                  ? (hiddenLoading ? "טוען..." : `${hiddenProjects.length} פרויקטים`)
                  : `${filtered.length} מוצגים`}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => {
                  setShowHidden((v) => !v);
                  setStatusFilter("פעילים");
                  setTypeFilter("");
                  setParentFilter("");
                  setArtistFilter("");
                }}
                style={{
                  padding: "6px 12px", borderRadius: 9, border: "1px solid",
                  fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  background: showHidden ? "rgba(107,114,128,0.15)" : "transparent",
                  borderColor: showHidden ? "rgba(107,114,128,0.5)" : "#252525",
                  color: showHidden ? "#9CA3AF" : "#444",
                }}
              >
                {showHidden ? "← חזור" : "🚫 מוסתרים"}
              </button>
              <button
                onClick={() => setShowNewProject(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "7px 16px", borderRadius: 9,
                  border: "1px solid rgba(59,130,246,0.35)",
                  background: "rgba(59,130,246,0.08)",
                  color: "#3B82F6", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  Object.assign((e.currentTarget as HTMLElement).style, {
                    background: "rgba(59,130,246,0.15)",
                    borderColor: "rgba(59,130,246,0.55)",
                  });
                }}
                onMouseLeave={(e) => {
                  Object.assign((e.currentTarget as HTMLElement).style, {
                    background: "rgba(59,130,246,0.08)",
                    borderColor: "rgba(59,130,246,0.35)",
                  });
                }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
                פרויקט חדש
              </button>
            </div>
          </div>

          {/* Summary cards — only in normal mode */}
          {!showHidden && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 18 }}>
              {[
                {
                  label: "סה״כ פרויקטים",
                  value: String(projects.length),
                  color: "#3B82F6",
                },
                {
                  label: "בתהליך",
                  value: String(projects.filter((p) => ["בעבודה", "במיקס", "מחכה למיקס"].includes(p.status)).length),
                  color: "#60A5FA",
                },
                {
                  label: "באיחור",
                  value: String(projects.filter((p) => p.isOverdue && p.status !== "הושלם").length),
                  color: projects.some((p) => p.isOverdue && p.status !== "הושלם") ? "#EF4444" : "#555",
                },
                {
                  label: "לגבייה",
                  value: (() => {
                    // Only include projects that actually exist — orphaned settings/transactions are excluded
                    const knownIds = new Set(projects.map((p) => p.id));
                    const total = Object.entries(financeSummary)
                      .filter(([id]) => knownIds.has(id))
                      .reduce((s, [, f]) => s + Math.max(0, f.agreed - f.paid), 0);
                    return total > 0 ? `₪${total.toLocaleString()}` : "—";
                  })(),
                  color: "#F59E0B",
                },
              ].map(({ label, value, color }) => {
                const isClickable = label === "לגבייה";
                return (
                  <div
                    key={label}
                    onClick={isClickable ? () => setShowCollectionDetail(true) : undefined}
                    style={{
                      background: "#141414",
                      border: `1px solid ${isClickable ? "rgba(245,158,11,0.25)" : "#252525"}`,
                      borderRadius: 12,
                      padding: "12px 16px",
                      cursor: isClickable ? "pointer" : "default",
                      transition: "border-color 0.15s",
                    }}
                    onMouseEnter={isClickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(245,158,11,0.5)"; } : undefined}
                    onMouseLeave={isClickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(245,158,11,0.25)"; } : undefined}
                  >
                    <div style={{ fontSize: 10, color: "#444", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                      {label}
                      {isClickable && <span style={{ fontSize: 9, color: "#666" }}>↗</span>}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color }}>
                      {value}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Filters — only in normal mode */}
          {!showHidden && (
            <>
              {/* Row 1: Status */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setStatusFilter(opt)}
                    style={{
                      padding: "5px 12px", borderRadius: 8, border: "1px solid",
                      fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                      background: statusFilter === opt ? "rgba(59,130,246,0.12)" : "#1A1A1A",
                      borderColor: statusFilter === opt ? "rgba(59,130,246,0.35)" : "#252525",
                      color: statusFilter === opt ? "#3B82F6" : "#666",
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>

              {/* Row 2: Type + selects */}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 16 }}>
                <button
                  onClick={() => setTypeFilter("")}
                  style={{
                    padding: "4px 10px", borderRadius: 7, border: "1px solid",
                    fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                    background: typeFilter === "" ? "rgba(168,85,247,0.12)" : "#1A1A1A",
                    borderColor: typeFilter === "" ? "rgba(168,85,247,0.35)" : "#252525",
                    color: typeFilter === "" ? "#A855F7" : "#555",
                  }}
                >
                  כל הסוגים
                </button>
                {PROJECT_TYPES.map((t) => {
                  const color = TYPE_COLORS[t] ?? "#6B7280";
                  const active = typeFilter === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(active ? "" : t)}
                      style={{
                        padding: "4px 10px", borderRadius: 7, border: "1px solid",
                        fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                        background: active ? `${color}18` : "#1A1A1A",
                        borderColor: active ? `${color}40` : "#252525",
                        color: active ? color : "#555",
                      }}
                    >
                      {t}
                    </button>
                  );
                })}

                <div style={{ width: 1, height: 16, background: "#2A2A2A", margin: "0 2px" }} />

                <select
                  value={parentFilter}
                  onChange={(e) => setParentFilter(e.target.value)}
                  style={{
                    padding: "4px 10px", borderRadius: 7,
                    border: `1px solid ${parentFilter ? "rgba(16,185,129,0.4)" : "#252525"}`,
                    background: "#1A1A1A",
                    color: parentFilter ? "#10B981" : "#555",
                    fontSize: 11, fontFamily: "inherit", cursor: "pointer",
                  }}
                >
                  <option value="">כל השיוכים</option>
                  <option value={NO_AFFILIATION}>{NO_AFFILIATION}</option>
                  {uniqueParents.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>

                <select
                  value={artistFilter}
                  onChange={(e) => setArtistFilter(e.target.value)}
                  style={{
                    padding: "4px 10px", borderRadius: 7,
                    border: `1px solid ${artistFilter ? "rgba(255,255,255,0.2)" : "#252525"}`,
                    background: "#1A1A1A",
                    color: artistFilter ? "#F0F0F0" : "#555",
                    fontSize: 11, fontFamily: "inherit", cursor: "pointer",
                  }}
                >
                  <option value="">כל האמנים</option>
                  {artists.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  style={{
                    padding: "4px 10px", borderRadius: 7,
                    border: `1px solid ${sortBy !== "updated" ? "rgba(168,85,247,0.4)" : "#252525"}`,
                    background: "#1A1A1A",
                    color: sortBy !== "updated" ? "#A855F7" : "#555",
                    fontSize: 11, fontFamily: "inherit", cursor: "pointer",
                  }}
                >
                  <option value="updated">מיון: עודכן לאחרונה</option>
                  <option value="urgency">מיון: דחיפות</option>
                  <option value="deadline">מיון: דדליין</option>
                  <option value="name">מיון: שם פרויקט</option>
                  <option value="artist">מיון: אמן</option>
                  <option value="status">מיון: סטטוס</option>
                </select>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Mobile: card list ─────────────────────────────────────────────── */}
      {isMobile && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#555", fontSize: 14 }}>
              אין פרויקטים מתאימים
            </div>
          ) : (
            filtered.map((p) => (
              <MobileProjectCard
                key={p.id}
                p={p}
                openProject={openProject}
                financeSummary={financeSummary}
              />
            ))
          )}
        </div>
      )}

      {/* ── Desktop: table ────────────────────────────────────────────────── */}
      {!isMobile && <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "#252525" }}>
        {/* Header */}
        <div
          className="grid py-3 border-b tbl-header"
          style={{
            gridTemplateColumns: isMobile
              ? "56px 1fr auto auto"
              : isUltraCompact
              ? "80px 3fr 2fr 2.5fr 1.8fr 40px"
              : isCompact
              ? "80px 2.5fr 2fr 0.9fr 2.2fr 1.6fr 40px"
              : "80px 2.8fr 2fr 0.9fr 2.2fr 1.4fr 1.1fr 1.3fr 40px",
            gap: isMobile ? "8px" : "12px",
            paddingLeft: isMobile ? "12px" : "20px",
            paddingRight: isMobile ? "12px" : "20px",
            background: "#141414",
            borderColor: "#252525",
          }}
        >
          <div />
          <div>שם פרויקט</div>
          {!isMobile && <div>אמן</div>}
          {!isMobile && !isUltraCompact && <div>סוג</div>}
          <div>סטטוס</div>
          <div>דדליין</div>
          {!isMobile && !isCompact && !isUltraCompact && <div>כסף</div>}
          {!isMobile && !isCompact && !isUltraCompact && <div>הערות</div>}
          {!isMobile && <div />}
        </div>

        {filtered.length === 0 ? (
          <div
            className="px-5 py-8 text-center text-sm"
            style={{ color: "#555", background: "#1A1A1A" }}
          >
            אין פרויקטים מתאימים
          </div>
        ) : (
          filtered.map((p, i) => {
            const days = daysUntilDeadline(p.deadline);
            const showDueSoon = days !== null && days >= 0 && days <= 7 && p.status !== "הושלם";
            const latestAudio = getLatestAudioFile(p.files);
            const isPlaying = player?.track?.projectId === p.id && player.playing;
            const isLoaded = player?.track?.projectId === p.id;

            // Shared cell style — every cell stretches to full row height and centers content
            const cell: React.CSSProperties = {
              display:    "flex",
              alignItems: "center",
              overflow:   "hidden",
              minWidth:   0,
            };

            return (
              <div
                key={p.id}
                className="grid border-b transition-all"
                style={{
                  gridTemplateColumns: isMobile
                    ? "56px 1fr auto auto"
                    : isUltraCompact
                    ? "80px 3fr 2fr 2.5fr 1.8fr 40px"
                    : isCompact
                    ? "80px 2.5fr 2fr 0.9fr 2.2fr 1.6fr 40px"
                    : "80px 2.8fr 2fr 0.9fr 2.2fr 1.4fr 1.1fr 1.3fr 40px",
                  gap: isMobile ? "8px" : "12px",
                  paddingLeft: isMobile ? "12px" : "20px",
                  paddingRight: isMobile ? "12px" : "20px",
                  alignItems:  "stretch",
                  background:  i % 2 === 0 ? "#1A1A1A" : "#171717",
                  borderColor: "#252525",
                  height:      52,
                  overflow:    "visible",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "#1E1E1E";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background =
                    i % 2 === 0 ? "#1A1A1A" : "#171717";
                }}
              >
                {/* ── Actions ── */}
                <div style={{ ...cell, gap: 4, overflow: "visible" }} onClick={(e) => e.stopPropagation()}>
                  <ActionMenu
                    projectId={p.id}
                    projectName={p.name}
                    artist={p.artist}
                  />
                  {latestAudio && player ? (
                    <button
                      onClick={async (e) => {
                        e.preventDefault();
                        if (isLoaded) {
                          isPlaying ? player.pause() : player.resume();
                        } else {
                          const url = await getFreshPlayUrl(latestAudio);
                          player.play({
                            projectId: p.id,
                            projectName: p.name,
                            artist: p.artist,
                            fileName: latestAudio.name,
                            url,
                          });
                        }
                      }}
                      title={isPlaying ? "השהה" : "נגן גרסה אחרונה"}
                      style={{
                        width: 26, height: 26, borderRadius: "50%",
                        border: "none", cursor: "pointer",
                        background: isLoaded ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.06)",
                        color: isLoaded ? "#3B82F6" : "#555",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, flexShrink: 0, transition: "all 0.15s",
                      }}
                    >
                      {isPlaying ? "⏸" : "▶"}
                    </button>
                  ) : (
                    <div style={{ width: 26, flexShrink: 0 }} />
                  )}
                  <UploadButton
                    projectId={p.id}
                    projectName={p.name}
                    artist={p.artist}
                    existingFiles={p.files}
                    status={p.status}
                    size="sm"
                  />
                </div>

                {/* ── Name ── */}
                <div style={{ ...cell, gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <InlineCellEdit
                    value={p.name}
                    onSave={(v) => updateProjectField(p.id, "name", v)}
                    type="text"
                    viewStyle={{ flex: 1, minWidth: 0 }}
                  >
                    <span className="font-medium text-sm truncate" style={{ color: "#E8E8E8", display: "block", maxWidth: "100%" }}>
                      {p.name}
                    </span>
                  </InlineCellEdit>
                  <button
                    onClick={(e) => { e.stopPropagation(); openProject(p.id); }}
                    title="פתח פרטי פרויקט"
                    style={{
                      width: 22, height: 22, borderRadius: 5,
                      border: "1px solid #2A2A2A",
                      background: "rgba(255,255,255,0.03)",
                      color: "#444", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, transition: "all 0.13s",
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.borderColor = "#3B82F6";
                      el.style.color = "#3B82F6";
                      el.style.background = "rgba(59,130,246,0.08)";
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.borderColor = "#2A2A2A";
                      el.style.color = "#444";
                      el.style.background = "rgba(255,255,255,0.03)";
                    }}
                  >
                    {/* Sidebar-panel icon */}
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                      <rect x="0.7" y="0.7" width="9.6" height="9.6" rx="1.5" />
                      <line x1="7.2" y1="0.7" x2="7.2" y2="10.3" />
                    </svg>
                  </button>
                </div>

                {/* ── Artist chips — hidden on mobile ── */}
                {!isMobile && (
                  <div style={cell} onClick={(e) => e.stopPropagation()}>
                    <ArtistCellEdit
                      value={p.artist}
                      artists={artists}
                      onSave={(v) => updateProjectField(p.id, "artist", v)}
                    />
                  </div>
                )}

                {/* ── Type — hidden on mobile and ultra-compact ── */}
                {!isMobile && !isUltraCompact && (
                  <div style={cell} onClick={(e) => e.stopPropagation()}>
                    <InlineCellEdit
                      value={p.projectType}
                      onSave={(v) => updateProjectField(p.id, "projectType", v)}
                      type="select"
                      options={[
                        { value: "", label: "ללא" },
                        ...PROJECT_TYPES.map((t) => ({ value: t, label: t })),
                      ]}
                    >
                      <ProjectTypeBadge type={p.projectType} />
                    </InlineCellEdit>
                  </div>
                )}

                {/* ── Status ── */}
                <div style={{ ...cell, gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <StatusDropdown projectId={p.id} status={p.status} small />
                </div>

                {/* ── דדליין ── */}
                <div style={cell} onClick={(e) => e.stopPropagation()}>
                  <InlineCellEdit
                    value={p.deadline || ""}
                    onSave={(v) => updateProjectField(p.id, "deadline", v)}
                    type="date"
                  >
                    <span
                      className="text-xs"
                      style={{
                        color: p.isOverdue && p.status !== "הושלם" ? "#EF4444"
                          : showDueSoon ? "#F97316"
                          : "#555",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {deadlineLabel(p.deadline)}
                    </span>
                  </InlineCellEdit>
                </div>

                {/* ── כסף — hidden on mobile/compact/ultra-compact ── */}
                {!isMobile && !isCompact && !isUltraCompact && (
                  <div style={cell} onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const fin = financeSummary[p.id];
                      if (!fin) return <span style={{ fontSize: 11, color: "#2A2A2A" }}>—</span>;
                      const bal = fin.agreed - fin.paid;
                      if (bal <= 0) return <span style={{ fontSize: 11, color: "#34D399" }}>שולם ✓</span>;
                      return (
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#F59E0B", whiteSpace: "nowrap" }}>
                          {fin.currency}{bal.toLocaleString()}
                        </span>
                      );
                    })()}
                  </div>
                )}

                {/* ── הערות — hidden on mobile/compact/ultra-compact ── */}
                {!isMobile && !isCompact && !isUltraCompact && (
                  <div style={cell} onClick={(e) => e.stopPropagation()}>
                    <NotesCellEdit
                      value={p.notes || ""}
                      onSave={(v) => updateProjectField(p.id, "notes", v)}
                    />
                  </div>
                )}

                {/* ── מחיקה — last column, hidden on mobile ── */}
                {!isMobile && (
                  <div style={{ ...cell, justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(p.id);
                        setConfirmDeleteName(p.name);
                      }}
                      title="מחק פרויקט"
                      style={{
                        width: 26, height: 26, borderRadius: "50%",
                        border: "none", background: "transparent",
                        color: "#333", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.13s",
                      }}
                      onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLElement).style, { background: "rgba(239,68,68,0.1)", color: "#EF4444" })}
                      onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLElement).style, { background: "transparent", color: "#333" })}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1,3 11,3" />
                        <path d="M4,3V2a1,1,0,0,1,1-1H7a1,1,0,0,1,1,1V3" />
                        <rect x="2" y="3" width="8" height="8" rx="1" />
                        <line x1="5" y1="6" x2="5" y2="9" />
                        <line x1="7" y1="6" x2="7" y2="9" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>}

      {/* ── Delete confirmation popup ── */}
      {confirmDeleteId && typeof document !== "undefined" && createPortal(
        <div
          onClick={() => setConfirmDeleteId(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 99999,
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#161616", border: "1px solid #2A2A2A",
              borderRadius: 16, padding: "24px 28px 20px",
              width: 320, direction: "rtl",
              boxShadow: "0 20px 60px rgba(0,0,0,0.9)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>🗑</div>
            <p style={{ color: "#E8E8E8", fontWeight: 700, fontSize: 15, margin: "0 0 6px" }}>
              מחיקת פרויקט
            </p>
            <p style={{ color: "#777", fontSize: 13, margin: "0 0 22px", lineHeight: 1.5 }}>
              למחוק את <strong style={{ color: "#CCC" }}>{confirmDeleteName}</strong>?<br />
              <span style={{ fontSize: 11, color: "#555" }}>פעולה זו אינה ניתנת לביטול</span>
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirmDeleteId(null)}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 10,
                  border: "1px solid #2A2A2A", background: "transparent",
                  color: "#777", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
                }}
              >
                ביטול
              </button>
              <button
                onClick={() => {
                  const id = confirmDeleteId;
                  setConfirmDeleteId(null);
                  deleteProject(id);
                }}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 10,
                  border: "1px solid rgba(239,68,68,0.4)",
                  background: "rgba(239,68,68,0.12)",
                  color: "#EF4444", cursor: "pointer", fontSize: 13,
                  fontWeight: 700, fontFamily: "inherit",
                }}
              >
                כן, מחק
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showCollectionDetail && typeof document !== "undefined" && (
        <CollectionDetailModal
          financeSummary={financeSummary}
          projects={projects}
          onClose={() => setShowCollectionDetail(false)}
        />
      )}

      {showNewProject && typeof document !== "undefined" && (
        <NewProjectModal
          artists={artists}
          clientNames={clientNames}
          onClose={() => setShowNewProject(false)}
          onCreate={async (fields) => {
            // 1. Create the project
            const newId = await createProject({
              name: fields.name,
              artist: fields.artist,
              status: fields.status,
              projectType: fields.projectType,
              deadline: fields.deadline,
              notes: fields.notes,
            });

            // 2. If artist is new (not in clients), auto-add them
            const trimmed = fields.artist.trim();
            if (trimmed && !clientNames.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
              try {
                await fetch("/api/clients", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: trimmed, type: "אמן", status: "חדש" }),
                });
                // Refresh client names
                const res = await fetch("/api/clients");
                const d = await res.json();
                if (d.clients) {
                  setClientNames((d.clients as { name: string }[]).map((c) => c.name));
                }
                // Open album center directly for album/EP projects
                if (newId && (fields.projectType === "אלבום" || fields.projectType === "EP")) {
                  setShowNewProject(false);
                  openProject(newId);
                  return { newClientAdded: trimmed };
                }
                return { newClientAdded: trimmed };
              } catch {
                return { newClientAdded: trimmed };
              }
            }

            // Open album center directly for album/EP projects
            if (newId && (fields.projectType === "אלבום" || fields.projectType === "EP")) {
              setShowNewProject(false);
              openProject(newId);
            }
            return {};
          }}
        />
      )}
    </div>
  );
}
