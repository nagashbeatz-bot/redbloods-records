"use client";

import { usePlayerSafe } from "@/components/PlayerProvider";
import { useProjects } from "@/components/ProjectsProvider";
import UploadButton from "@/components/ui/UploadButton";

function fmt(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MiniPlayer() {
  const player = usePlayerSafe();
  const { projects } = useProjects();
  if (!player || !player.track) return null;

  const { track, playing, currentTime, duration, pause, resume, stop, seek, skip } = player;
  const project = projects.find((p) => p.id === track.projectId);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const canPlay = track.url !== "#" && track.url !== "";

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        background: "#141414",
        borderTop: "1px solid #2A2A2A",
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      {/* Track info */}
      <div style={{ minWidth: 0, flex: "0 0 220px" }}>
        <div
          className="truncate"
          style={{ fontSize: 13, fontWeight: 600, color: "#E8E8E8" }}
        >
          {track.projectName}
        </div>
        <div className="truncate" style={{ fontSize: 11, color: "#666" }}>
          {track.artist} · {track.fileName}
        </div>
      </div>

      {/* Controls — always LTR: ⟪ | ▶ | ⟫ */}
      <div dir="ltr" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {/* −10s */}
        <CtrlBtn onClick={() => skip(-10)} title="אחורה 10 שניות">
          <span style={{ fontSize: 14 }}>⟪</span>
          <span style={{ fontSize: 9 }}>10</span>
        </CtrlBtn>

        {/* Play / Pause */}
        <button
          onClick={canPlay ? (playing ? pause : resume) : undefined}
          title={canPlay ? (playing ? "השהה" : "נגן") : "לא ניתן לנגן קובץ זה"}
          style={{
            width: 36, height: 36, borderRadius: "50%",
            border: "none", cursor: canPlay ? "pointer" : "not-allowed",
            background: canPlay ? "#3B82F6" : "#333",
            color: "#fff", fontSize: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {playing ? "⏸" : "▶"}
        </button>

        {/* +10s */}
        <CtrlBtn onClick={() => skip(10)} title="קדימה 10 שניות">
          <span style={{ fontSize: 9 }}>10</span>
          <span style={{ fontSize: 14 }}>⟫</span>
        </CtrlBtn>
      </div>

      {/* Progress bar — always LTR: 0:00 ←fill→ duration */}
      <div dir="ltr" style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: "#555", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
          {fmt(currentTime)}
        </span>
        <div
          style={{
            flex: 1, height: 4, background: "#2A2A2A", borderRadius: 2,
            cursor: "pointer", position: "relative",
          }}
          onClick={(e) => {
            if (!duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            seek(ratio * duration);
          }}
        >
          <div
            style={{
              position: "absolute", left: 0, top: 0, bottom: 0,
              width: `${progress}%`,
              background: "#3B82F6", borderRadius: 2,
              transition: "width 0.1s linear",
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: "#555", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
          {fmt(duration)}
        </span>
      </div>

      {/* Right side: upload + open original + close */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {!canPlay && (
          <span style={{ fontSize: 11, color: "#555" }}>אין גרסה להשמעה</span>
        )}
        {/* Upload button — shown when we can resolve the project */}
        {project && (
          <UploadButton
            projectId={project.id}
            projectName={project.name}
            artist={project.artist}
            existingFiles={project.files}
            size="sm"
          />
        )}
        {canPlay && (
          <a
            href={track.url}
            target="_blank"
            rel="noopener noreferrer"
            title="פתח / הורד קובץ מקורי"
            style={{
              width: 26, height: 26, borderRadius: "50%",
              border: "none", background: "rgba(255,255,255,0.04)",
              color: "#555", textDecoration: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, flexShrink: 0, transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLAnchorElement;
              el.style.background = "rgba(255,255,255,0.09)";
              el.style.color = "#AAA";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLAnchorElement;
              el.style.background = "rgba(255,255,255,0.04)";
              el.style.color = "#555";
            }}
          >
            {/* Download / open-source icon */}
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.5 1v7M3.5 5.5l3 3 3-3" />
              <path d="M1.5 10.5h10" />
            </svg>
          </a>
        )}
        <button
          onClick={stop}
          title="סגור נגן"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#555", fontSize: 18, padding: "2px 6px",
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function CtrlBtn({
  onClick, title, children,
}: {
  onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: "#666", display: "flex", alignItems: "center", gap: 1,
        padding: "4px 6px", borderRadius: 6,
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#AAA")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#666")}
    >
      {children}
    </button>
  );
}
