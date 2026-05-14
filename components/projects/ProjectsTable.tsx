"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProjectStatus, ProjectType } from "@/lib/types";
import { ALL_STATUSES, PROJECT_TYPES, NO_AFFILIATION, isNoAffiliation } from "@/lib/types";
import { deadlineLabel, daysUntilDeadline } from "@/lib/utils";
import StatusDropdown from "@/components/ui/StatusDropdown";
import { useProjects } from "@/components/ProjectsProvider";
import { SkeletonCard } from "@/components/ui/Skeleton";
import ColumnSetupModal from "./ColumnSetupModal";
import { usePlayerSafe, getLatestAudioFile } from "@/components/PlayerProvider";
import UploadButton from "@/components/ui/UploadButton";
import InlineCellEdit from "@/components/ui/InlineCellEdit";
import ArtistCellEdit from "@/components/ui/ArtistCellEdit";
import ActionMenu from "@/components/project/ActionMenu";
import NotesCellEdit from "@/components/ui/NotesCellEdit";

type FilterStatus = ProjectStatus | "כל הסטטוסים" | "באיחור" | "קרובים לדדליין";

const FILTER_OPTIONS: FilterStatus[] = [
  "כל הסטטוסים",
  "באיחור",
  "קרובים לדדליין",
  ...ALL_STATUSES,
];

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

export default function ProjectsTable() {
  const { projects, loading, updateProjectField } = useProjects();
  const player = usePlayerSafe();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("כל הסטטוסים");
  const [typeFilter, setTypeFilter] = useState<ProjectType | "">("");
  const [parentFilter, setParentFilter] = useState("");
  const [artistFilter, setArtistFilter] = useState("");
  const [sortBy, setSortBy] = useState<"deadline" | "name" | "artist">("deadline");
  const [showSetup, setShowSetup] = useState(false);
  const [optionalColumnsReady, setOptionalColumnsReady] = useState<boolean | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [clientNames, setClientNames] = useState<string[]>([]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
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

  useEffect(() => {
    fetch("/api/monday/column")
      .then((r) => r.json())
      .then((data) => setOptionalColumnsReady(!!(data.projectType && data.parentProject)))
      .catch(() => setOptionalColumnsReady(false));
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
      projects
        .map((p) => p.parentProject)
        .filter((v) => !isNoAffiliation(v))
    )
  ).sort();

  const filtered = projects
    .filter((p) => {
      if (artistFilter && p.artist !== artistFilter) return false;
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
      if (sortBy === "deadline") {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      }
      if (sortBy === "name") return a.name.localeCompare(b.name, "he");
      return a.artist.localeCompare(b.artist, "he");
    });

  return (
    <div>
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

      {/* Filters row 2 — type + parent */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
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
            style={{ background: "#1A1A1A", borderColor: "#252525", color: "#666" }}
          >
            <option value="deadline">מיון: דדליין</option>
            <option value="name">מיון: שם</option>
            <option value="artist">מיון: אמן</option>
          </select>

          {/* Column setup button — shown only when optional columns not yet on board */}
          {optionalColumnsReady === false && (
            <button
              onClick={() => setShowSetup(true)}
              className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
              style={{
                background: "rgba(245,158,11,0.08)",
                borderColor: "rgba(245,158,11,0.3)",
                color: "#F59E0B",
                cursor: "pointer",
              }}
            >
              + הוסף עמודות
            </button>
          )}
        </div>
      </div>

      <p className="text-xs mb-4" style={{ color: "#555" }}>
        {filtered.length} פרויקטים
      </p>

      {/* Table */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "#252525" }}>
        {/* Header */}
        <div
          className="grid px-4 py-3 text-xs font-medium border-b"
          style={{
            gridTemplateColumns: isMobile
              ? "56px 1fr auto auto"
              : "80px 3fr 2fr 2.4fr 1fr 1.5fr 1.5fr 1fr",
            gap: isMobile ? "8px" : "12px",
            background: "#141414",
            borderColor: "#252525",
            color: "#555",
          }}
        >
          <div />
          <div>שם פרויקט</div>
          {!isMobile && <div>אמן</div>}
          <div>סטטוס</div>
          {!isMobile && <div>סוג</div>}
          {!isMobile && <div>שייך ל</div>}
          <div>דדליין</div>
          {!isMobile && <div>הערות</div>}
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
                    : "80px 3fr 2fr 2.4fr 1fr 1.5fr 1.5fr 1fr",
                  gap: isMobile ? "8px" : "12px",
                  paddingLeft: isMobile ? "12px" : "20px",
                  paddingRight: isMobile ? "12px" : "20px",
                  alignItems:  "stretch",
                  background:  i % 2 === 0 ? "#1A1A1A" : "#171717",
                  borderColor: "#252525",
                  height:      52,
                  overflow:    "hidden",
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
                <div style={{ ...cell, gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <ActionMenu
                    projectId={p.id}
                    projectName={p.name}
                    artist={p.artist}
                  />
                  {latestAudio && player ? (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        if (isLoaded) {
                          isPlaying ? player.pause() : player.resume();
                        } else {
                          player.play({
                            projectId: p.id,
                            projectName: p.name,
                            artist: p.artist,
                            fileName: latestAudio.name,
                            url: latestAudio.url,
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
                  {p.files.length > 0 && (
                    <span className="text-xs flex-shrink-0" style={{ color: "#444" }}>📎</span>
                  )}
                  <Link
                    href={`/projects/${p.id}`}
                    onClick={(e) => e.stopPropagation()}
                    title="פתח פרויקט"
                    style={{ color: "#333", fontSize: 10, flexShrink: 0, lineHeight: 1, textDecoration: "none" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#888")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#333")}
                  >
                    ↗
                  </Link>
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
                <div style={cell} onClick={(e) => e.stopPropagation()}>
                  <StatusDropdown projectId={p.id} status={p.status} small />
                </div>

                {/* ── Type — hidden on mobile ── */}
                {!isMobile && (
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

                {/* ── שייך ל — hidden on mobile ── */}
                {!isMobile && (
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

                {/* ── הערות — hidden on mobile ── */}
                {!isMobile && (
                  <div style={cell} onClick={(e) => e.stopPropagation()}>
                    <NotesCellEdit
                      value={p.notes || ""}
                      onSave={(v) => updateProjectField(p.id, "notes", v)}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {showSetup && <ColumnSetupModal onClose={() => setShowSetup(false)} />}
    </div>
  );
}
