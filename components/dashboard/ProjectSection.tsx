"use client";

import Link from "next/link";
import type { Project } from "@/lib/types";
import { deadlineLabel, daysUntilDeadline } from "@/lib/utils";
import { OverdueTag, DueSoonTag } from "@/components/ui/Badge";
import StatusDropdown from "@/components/ui/StatusDropdown";
import { usePlayerSafe, getLatestAudioFile } from "@/components/PlayerProvider";

interface ProjectSectionProps {
  title: string;
  projects: Project[];
  accentColor?: string;
  emptyText?: string;
  maxItems?: number;
  showDeadline?: boolean;
}

export default function ProjectSection({
  title,
  projects,
  accentColor = "#3B82F6",
  emptyText = "אין פרויקטים",
  maxItems,
  showDeadline = true,
}: ProjectSectionProps) {
  const items = maxItems ? projects.slice(0, maxItems) : projects;
  const player = usePlayerSafe();

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
          {items.map((p) => {
            const days = daysUntilDeadline(p.deadline);
            const showDueSoon =
              days !== null && days >= 0 && days <= 7 && p.status !== "הושלם";
            const latestAudio = getLatestAudioFile(p.files);
            const isLoaded  = player?.track?.projectId === p.id;
            const isPlaying = isLoaded && player!.playing;

            return (
              <div
                key={p.id}
                className="flex items-center justify-between px-4 py-3 rounded-xl border transition-all"
                style={{ background: "#1A1A1A", borderColor: "#252525" }}
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
                  {latestAudio && player ? (
                    <button
                      onClick={() => {
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
                        fontSize: 9, transition: "all 0.15s",
                      }}
                    >
                      {isPlaying ? "⏸" : "▶"}
                    </button>
                  ) : (
                    <div style={{ width: 26 }} />
                  )}
                </div>

                {/* Name + artist — clicking navigates */}
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center gap-3 min-w-0 flex-1"
                  style={{ textDecoration: "none" }}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate" style={{ color: "#E8E8E8" }}>
                      {p.name}
                    </div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: "#666" }}>
                      {p.artist}
                    </div>
                  </div>
                </Link>

                {/* Right: status + tags + deadline */}
                <div className="flex items-center gap-2 flex-shrink-0 mr-3">
                  <StatusDropdown projectId={p.id} status={p.status} small />
                  {p.isOverdue && p.status !== "הושלם" && <OverdueTag small />}
                  {showDueSoon && <DueSoonTag days={days!} small />}
                  {showDeadline && p.deadline && !p.isOverdue && !showDueSoon && (
                    <span className="text-xs" style={{ color: "#555" }}>
                      {deadlineLabel(p.deadline)}
                    </span>
                  )}
                  {showDeadline && p.deadline && p.isOverdue && (
                    <span className="text-xs" style={{ color: "#EF4444" }}>
                      {deadlineLabel(p.deadline)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
