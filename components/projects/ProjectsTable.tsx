"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useRouter } from "next/navigation";
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
import ActionMenu from "@/components/project/ActionMenu";
import NotesCellEdit from "@/components/ui/NotesCellEdit";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";

// ── Open project from URL param (?open=<id>) ──────────────────────────────────
function OpenProjectFromURL() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const { openProject } = useGlobalProjectDrawer();

  useEffect(() => {
    const id = searchParams.get("open");
    if (id) {
      openProject(id);
      router.replace("/projects");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

type FilterStatus = ProjectStatus | "כל הסטטוסים" | "באיחור" | "קרובים לדדליין";

const FILTER_OPTIONS: FilterStatus[] = [
  "כל הסטטוסים",
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
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={{ ...inputStyle, colorScheme: "dark" }} />
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

// ─────────────────────────────────────────────────────────────────────────────

export default function ProjectsTable() {
  const { projects, loading, updateProjectField, createProject, deleteProject, refresh } = useProjects();
  const player = usePlayerSafe();
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("כל הסטטוסים");
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

  // ── Hidden-projects mode ────────────────────────────────────────────────────
  const [showHidden,    setShowHidden]    = useState(false);
  const [hiddenProjects, setHiddenProjects] = useState<import("@/lib/types").Project[]>([]);
  const [hiddenLoading,  setHiddenLoading]  = useState(false);

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
          if (t.type === "income" && t.payment_status === "שולם") map[t.project_id].paid += t.amount;
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

  return (
    <div>
      <Suspense fallback={null}>
        <OpenProjectFromURL />
      </Suspense>
      {/* Filters row 1 — status */}
      <div className="flex flex-wrap gap-2 mb-3">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt}
            onClick={() => setStatusFilter(opt)}
            className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
            style={{
              background: statusFilter === opt ? "rgba(59,130,246,0.12)" : "#1A1A1A",
              borderColor: statusFilter === opt ? "rgba(59,130,246,0.35)" : "#252525",
              color: statusFilter === opt ? "#3B82F6" : "#666",
            }}
          >
            {opt}
          </button>
        ))}
      </div>

      {/* Hidden-mode toggle — sits after status row, before type row */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => {
            setShowHidden((v) => !v);
            setStatusFilter("כל הסטטוסים");
            setTypeFilter("");
            setParentFilter("");
            setArtistFilter("");
          }}
          className="px-3 py-1 rounded-lg border text-xs font-medium transition-all"
          style={{
            background: showHidden ? "rgba(107,114,128,0.15)" : "transparent",
            borderColor: showHidden ? "rgba(107,114,128,0.5)" : "#252525",
            color: showHidden ? "#9CA3AF" : "#444",
          }}
        >
          {showHidden ? "← חזור לפרויקטים" : "🚫 מוסתרים"}
          {!showHidden && hiddenProjects.length === 0 && projects.length > 0 ? "" : ""}
        </button>
        {showHidden && (
          <span style={{ fontSize: 11, color: "#555" }}>
            {hiddenLoading ? "טוען..." : `${hiddenProjects.length} פרויקטים מוסתרים`}
          </span>
        )}
      </div>

      {/* Filters row 2 + 3 — hidden when in hidden-mode */}
      {!showHidden && <><div className="flex flex-wrap items-center gap-2 mb-2">
        {/* Project type filter */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setTypeFilter("")}
            className="px-2.5 py-1 rounded-lg border text-xs font-medium transition-all"
            style={{
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
                className="px-2.5 py-1 rounded-lg border text-xs font-medium transition-all"
                style={{
                  background: active ? `${color}18` : "#1A1A1A",
                  borderColor: active ? `${color}40` : "#252525",
                  color: active ? color : "#555",
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters row 3 — parent project + artist + sort + setup */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {/* Parent project filter */}
        <select
          value={parentFilter}
          onChange={(e) => setParentFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border text-xs font-medium"
          style={{
            background: "#1A1A1A",
            borderColor: parentFilter ? "rgba(16,185,129,0.4)" : "#252525",
            color: parentFilter ? "#10B981" : "#666",
          }}
        >
          <option value="">כל השיוכים</option>
          <option value={NO_AFFILIATION}>{NO_AFFILIATION}</option>
          {uniqueParents.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <div className="flex gap-2 mr-auto">
          <select
            value={artistFilter}
            onChange={(e) => setArtistFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-xs font-medium"
            style={{
              background: "#1A1A1A",
              borderColor: "#252525",
              color: artistFilter ? "#F0F0F0" : "#666",
            }}
          >
            <option value="">כל האמנים</option>
            {artists.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-1.5 rounded-lg border text-xs font-medium"
            style={{
              background: "#1A1A1A",
              borderColor: sortBy !== "updated" ? "rgba(168,85,247,0.4)" : "#252525",
              color: sortBy !== "updated" ? "#A855F7" : "#666",
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
      </div>
      </>}

      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setShowNewProject(true)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 10,
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
        <p className="text-xs" style={{ color: "#555" }}>
          {filtered.length} {showHidden ? "פרויקטים מוסתרים" : "פרויקטים"}
        </p>
      </div>

      {/* Table */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "#252525" }}>
        {/* Header */}
        <div
          className="grid py-3 border-b tbl-header"
          style={{
            gridTemplateColumns: isMobile
              ? "56px 1fr auto auto"
              : isUltraCompact
              ? "90px 3fr 2fr 3fr 2fr 44px"
              : isCompact
              ? "90px 2.5fr 2fr 3fr 1fr 1.8fr 44px"
              : "90px 3fr 2.8fr 2.4fr 1fr 1.5fr 2fr 1fr 44px",
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
          <div>סטטוס</div>
          {!isMobile && !isUltraCompact && <div>סוג</div>}
          {!isMobile && !isCompact && !isUltraCompact && <div>שייך ל</div>}
          <div>דדליין</div>
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
                    ? "90px 3fr 2fr 3fr 2fr 44px"
                    : isCompact
                    ? "90px 2.5fr 2fr 3fr 1fr 1.8fr 44px"
                    : "90px 3fr 2.8fr 2.4fr 1fr 1.5fr 2fr 1fr 44px",
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

                {/* ── Status ── */}
                <div style={{ ...cell, gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <StatusDropdown projectId={p.id} status={p.status} small />
                </div>

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

                {/* ── שייך ל — hidden on mobile/compact/ultra-compact ── */}
                {!isMobile && !isCompact && !isUltraCompact && (
                  <div style={cell} onClick={(e) => e.stopPropagation()}>
                    <InlineCellEdit
                      value={p.parentProject || ""}
                      onSave={(v) => updateProjectField(p.id, "parentProject", v || "ללא שיוך")}
                      type="text"
                      placeholder="ללא שיוך"
                      viewStyle={{ minWidth: 0 }}
                    >
                      <span className="text-xs truncate block" style={{ color: p.parentProject ? "#888" : "#333" }}>
                        {p.parentProject || "—"}
                      </span>
                    </InlineCellEdit>
                  </div>
                )}

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
      </div>

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

      {showNewProject && typeof document !== "undefined" && (
        <NewProjectModal
          artists={artists}
          clientNames={clientNames}
          onClose={() => setShowNewProject(false)}
          onCreate={async (fields) => {
            // 1. Create the project
            await createProject({
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
                return { newClientAdded: trimmed };
              } catch {
                // If client creation fails, still return success for project
                return { newClientAdded: trimmed };
              }
            }
            return {};
          }}
        />
      )}
    </div>
  );
}
