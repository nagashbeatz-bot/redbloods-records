"use client";

import { useEffect } from "react";
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

interface Props {
  projectId: string;
  artists: string[];
  onClose: () => void;
}

// ── Small section card ────────────────────────────────────────────────────────
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "#1C1C1C",
      border: "1px solid #252525",
      borderRadius: 14,
      padding: "14px 16px",
      marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

// ── Divider line ──────────────────────────────────────────────────────────────
function Divider() {
  return <div style={{ height: 1, background: "#252525", margin: "10px 0" }} />;
}

// ── Row: label + value ────────────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

export default function ProjectDrawer({ projectId, artists, onClose }: Props) {
  const { projects, updateProjectField } = useProjects();
  const player = usePlayerSafe();

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const project = projects.find((p) => p.id === projectId);
  if (!project || typeof document === "undefined") return null;

  const latestAudio = getLatestAudioFile(project.files);
  const isPlaying   = player?.track?.projectId === project.id && player.playing;
  const isLoaded    = player?.track?.projectId === project.id;
  const canPlay     = !!latestAudio && !!player;

  const days        = daysUntilDeadline(project.deadline);
  const showDueSoon = days !== null && days >= 0 && days <= 7 && project.status !== "הושלם";
  const deadlineColor =
    project.isOverdue && project.status !== "הושלם" ? "#EF4444"
    : showDueSoon ? "#F97316"
    : "#888";

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

      {/* Slide-in panel */}
      <div style={{
        position: "absolute",
        top: 0, right: 0, bottom: 0,
        width: 440,
        background: "#141414",
        borderLeft: "1px solid #252525",
        display: "flex",
        flexDirection: "column",
        zIndex: 100000,
        animation: "rb-drawer-in 240ms cubic-bezier(.22,.68,0,1.2) forwards",
      }}>
        <style>{`
          @keyframes rb-drawer-in {
            from { transform: translateX(100%); opacity: 0.6; }
            to   { transform: translateX(0);    opacity: 1;   }
          }
        `}</style>

        {/* ── Header ─────────────────────────────────────────────── */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          height: 52,
          borderBottom: "1px solid #252525",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#555", fontSize: 20, lineHeight: 1, padding: "2px 4px",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#CCC")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#555")}
            >
              ×
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#777" }}>
              פרטי פרויקט
            </span>
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

        {/* ── Scrollable body ─────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>

          {/* Name + Artist */}
          <Card>
            <Row label="שם פרויקט">
              <InlineCellEdit
                value={project.name}
                onSave={(v) => updateProjectField(project.id, "name", v)}
                type="text"
              >
                <span style={{ fontSize: 15, fontWeight: 700, color: "#E8E8E8" }}>
                  {project.name}
                </span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="אמן">
              <ArtistCellEdit
                value={project.artist}
                artists={artists}
                onSave={(v) => updateProjectField(project.id, "artist", v)}
              />
            </Row>
          </Card>

          {/* Status / Deadline / Type / Parent / Notes */}
          <Card>
            <Row label="סטטוס">
              <StatusDropdown projectId={project.id} status={project.status} small />
            </Row>
            <Divider />
            <Row label="דדליין">
              <InlineCellEdit
                value={project.deadline || ""}
                onSave={(v) => updateProjectField(project.id, "deadline", v)}
                type="date"
              >
                <span style={{ fontSize: 12, color: deadlineColor }}>
                  {deadlineLabel(project.deadline)}
                </span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="סוג">
              <InlineCellEdit
                value={project.projectType}
                onSave={(v) => updateProjectField(project.id, "projectType", v)}
                type="select"
                options={[
                  { value: "", label: "ללא" },
                  ...PROJECT_TYPES.map((t) => ({ value: t, label: t })),
                ]}
              >
                <span style={{ fontSize: 12, color: project.projectType ? "#E0E0E0" : "#444" }}>
                  {project.projectType || "ללא"}
                </span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="שייך ל">
              <InlineCellEdit
                value={project.parentProject || ""}
                onSave={(v) => updateProjectField(project.id, "parentProject", v || "ללא שיוך")}
                type="text"
                placeholder="ללא שיוך"
              >
                <span style={{ fontSize: 12, color: project.parentProject ? "#888" : "#444" }}>
                  {project.parentProject || "—"}
                </span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="הערות">
              <NotesCellEdit
                value={project.notes || ""}
                onSave={(v) => updateProjectField(project.id, "notes", v)}
              />
            </Row>
          </Card>

          {/* Files + Player + Upload */}
          <Card>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}>
              <span style={{ fontSize: 10, color: "#555" }}>קבצים</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {canPlay && (
                  <button
                    onClick={() => {
                      if (!player) return;
                      if (isLoaded) {
                        isPlaying ? player.pause() : player.resume();
                      } else {
                        player.play({
                          projectId: project.id,
                          projectName: project.name,
                          artist: project.artist,
                          fileName: latestAudio!.name,
                          url: latestAudio!.url,
                        });
                      }
                    }}
                    title={isPlaying ? "השהה" : "נגן גרסה אחרונה"}
                    style={{
                      width: 28, height: 28, borderRadius: "50%",
                      border: "none", cursor: "pointer",
                      background: isLoaded ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.06)",
                      color: isLoaded ? "#3B82F6" : "#555",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isLoaded) (e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.12)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isLoaded) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
                    }}
                  >
                    {isPlaying ? "⏸" : "▶"}
                  </button>
                )}
                <UploadButton
                  projectId={project.id}
                  projectName={project.name}
                  artist={project.artist}
                  existingFiles={project.files}
                  size="sm"
                />
              </div>
            </div>

            {project.files.length === 0 ? (
              <div style={{ fontSize: 11, color: "#444" }}>אין קבצים</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {[...project.files].reverse().map((f, i) => (
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
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </Card>

          {/* Actions */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, color: "#555" }}>פעולות</span>
              <ActionMenu
                projectId={project.id}
                projectName={project.name}
                artist={project.artist}
              />
            </div>
          </Card>

        </div>
      </div>
    </div>,
    document.body
  );
}
