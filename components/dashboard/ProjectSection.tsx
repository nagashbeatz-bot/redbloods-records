"use client";

import { useState, useEffect } from "react";
import type { Project } from "@/lib/types";
import { deadlineLabel, daysUntilDeadline } from "@/lib/utils";
import { OverdueTag, DueSoonTag } from "@/components/ui/Badge";
import StatusDropdown from "@/components/ui/StatusDropdown";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";

interface ProjectSectionProps {
  title: string;
  projects: Project[];
  accentColor?: string;
  emptyText?: string;
  maxItems?: number;
  showDeadline?: boolean;
}

// ── Single project row — mobile-aware ────────────────────────────────────────

function ProjectRow({ p, showDeadline, isMobile }: { p: Project; showDeadline: boolean; isMobile: boolean }) {
  const player = usePlayerSafe();
  const { openProject } = useGlobalProjectDrawer();
  const days = daysUntilDeadline(p.deadline);
  const showDueSoon = days !== null && days >= 0 && days <= 7 && p.status !== "הושלם";
  const latestAudio = getLatestAudioFile(p.files);
  const isLoaded  = player?.track?.projectId === p.id;
  const isPlaying = isLoaded && player!.playing;

  const playBtn = latestAudio && player ? (
    <button
      onClick={async (e) => {
        e.stopPropagation();
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
        width: isMobile ? 36 : 26,
        height: isMobile ? 36 : 26,
        borderRadius: "50%",
        border: "none",
        cursor: "pointer",
        flexShrink: 0,
        background: isLoaded ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.06)",
        color: isLoaded ? "#3B82F6" : "#555",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: isMobile ? 13 : 9,
        transition: "all 0.15s",
      }}
    >
      {isPlaying ? "⏸" : "▶"}
    </button>
  ) : (
    <div style={{ width: isMobile ? 36 : 26, flexShrink: 0 }} />
  );

  // ── Mobile: vertical card ─────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div
        style={{
          background: "#1A1A1A",
          border: "1px solid #252525",
          borderRadius: 12,
        }}
      >
        <button
          onClick={() => openProject(p.id)}
          style={{
            width: "100%", background: "none", border: "none",
            cursor: "pointer", fontFamily: "inherit",
            padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 6,
            textAlign: "right",
          }}
        >
          {/* Row 1: name + play button */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, width: "100%" }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: "#F0F0F0",
              lineHeight: 1.3, flex: 1, textAlign: "right",
              wordBreak: "break-word",
            }}>
              {p.name}
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              {playBtn}
            </div>
          </div>

          {/* Row 2: artist */}
          {p.artist && (
            <div style={{ fontSize: 13, color: "#777", textAlign: "right" }}>
              {p.artist}
            </div>
          )}

          {/* Row 3: status + deadline tags */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
            onClick={(e) => e.stopPropagation()}
          >
            <StatusDropdown projectId={p.id} status={p.status} small />
            {p.isOverdue && p.status !== "הושלם" && <OverdueTag small />}
            {showDueSoon && <DueSoonTag days={days!} small />}
            {showDeadline && p.deadline && !p.isOverdue && !showDueSoon && (
              <span style={{ fontSize: 12, color: "#666" }}>{deadlineLabel(p.deadline)}</span>
            )}
            {showDeadline && p.deadline && p.isOverdue && (
              <span style={{ fontSize: 12, color: "#EF4444" }}>{deadlineLabel(p.deadline)}</span>
            )}
          </div>
        </button>
      </div>
    );
  }

  // ── Desktop: horizontal row ───────────────────────────────────────────────
  return (
    <div
      className="flex items-center justify-between px-4 rounded-xl border transition-all"
      style={{ background: "#1A1A1A", borderColor: "#252525", paddingTop: 13, paddingBottom: 13 }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "#333";
        el.style.background = "#1E1E1E";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "#252525";
        el.style.background = "#1A1A1A";
      }}
    >
      {/* Play button */}
      <div className="flex-shrink-0 ml-2">
        {playBtn}
      </div>

      {/* Name + artist */}
      <button
        onClick={() => openProject(p.id)}
        className="flex items-center gap-3 min-w-0 flex-1"
        style={{ background: "none", border: "none", cursor: "pointer", textAlign: "right", padding: 0 }}
      >
        <div className="min-w-0">
          <div className="font-medium truncate" style={{ fontSize: 15, color: "#E8E8E8" }}>{p.name}</div>
          <div className="truncate" style={{ fontSize: 13, color: "#777", marginTop: 2 }}>{p.artist}</div>
        </div>
      </button>

      {/* Right: status + tags + deadline */}
      <div className="flex items-center gap-2 flex-shrink-0 mr-3">
        <StatusDropdown projectId={p.id} status={p.status} small />
        {p.isOverdue && p.status !== "הושלם" && <OverdueTag small />}
        {showDueSoon && <DueSoonTag days={days!} small />}
        {showDeadline && p.deadline && !p.isOverdue && !showDueSoon && (
          <span style={{ fontSize: 12, color: "#666" }}>{deadlineLabel(p.deadline)}</span>
        )}
        {showDeadline && p.deadline && p.isOverdue && (
          <span style={{ fontSize: 12, color: "#EF4444" }}>{deadlineLabel(p.deadline)}</span>
        )}
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

export default function ProjectSection({
  title,
  projects,
  accentColor = "#3B82F6",
  emptyText = "אין פרויקטים",
  maxItems,
  showDeadline = true,
}: ProjectSectionProps) {
  const items = maxItems ? projects.slice(0, maxItems) : projects;
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div>
      {/* Section title */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-1.5 h-4 rounded-full flex-shrink-0"
          style={{ background: accentColor }}
        />
        <h2 className="text-sm font-semibold" style={{ color: "#C0C0C0" }}>
          {title}
        </h2>
        <span
          className="text-xs px-2 py-0.5 rounded-full border font-medium"
          style={{
            color: accentColor,
            background: `${accentColor}15`,
            borderColor: `${accentColor}30`,
          }}
        >
          {projects.length}
        </span>
      </div>

      {items.length === 0 ? (
        <div
          className="rounded-xl px-4 py-3 text-sm text-center"
          style={{ color: "#555", background: "#161616", border: "1px solid #222" }}
        >
          {emptyText}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <ProjectRow key={p.id} p={p} showDeadline={showDeadline} isMobile={isMobile} />
          ))}
        </div>
      )}
    </div>
  );
}
