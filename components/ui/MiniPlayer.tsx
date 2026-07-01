"use client";

import { useRef } from "react";
import { usePlayerSafe } from "@/components/PlayerProvider";
import { useProjects } from "@/components/ProjectsProvider";
import UploadButton from "@/components/ui/UploadButton";

const BRAND = "#DC2626";

function fmt(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function PlayIcon({ size = 16, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 12" fill={color} style={{ display: "block" }}>
      <path d="M1 1L9 6L1 11V1Z" />
    </svg>
  );
}

function PauseIcon({ size = 16, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 12" fill={color} style={{ display: "block" }}>
      <rect x="1" y="0" width="3.2" height="12" rx="1" />
      <rect x="5.8" y="0" width="3.2" height="12" rx="1" />
    </svg>
  );
}

function WaveformBars({ playing }: { playing: boolean }) {
  const HEIGHTS = [6, 14, 20, 26, 18, 10, 22, 16, 8, 24, 12, 18];
  return (
    <>
      <style>{`@keyframes wvBar{0%{transform:scaleY(.25)}100%{transform:scaleY(1)}}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 2, height: 28, flexShrink: 0 }}>
        {HEIGHTS.map((h, i) => (
          <div key={i} style={{
            width: 3, height: h, borderRadius: 2,
            background: playing ? BRAND : "#3A3A3A",
            opacity: playing ? 0.85 : 0.4,
            transformOrigin: "bottom",
            animation: playing ? `wvBar ${0.55 + (i % 4) * 0.14}s ease-in-out infinite alternate` : "none",
            animationDelay: `${i * 0.06}s`,
          }} />
        ))}
      </div>
    </>
  );
}

export default function MiniPlayer({ mobile = false }: { mobile?: boolean }) {
  const player = usePlayerSafe();
  const { projects } = useProjects();
  // Refs for the mobile scrub bar (hooks must run before the early return).
  const barRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  if (!player || !player.track) return null;

  const { track, playing, currentTime, duration, volume, pause, resume, stop, seek, skip, setVolume } = player;
  const project = projects.find((p) => p.id === track.projectId);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const canPlay = track.url !== "#" && track.url !== "";

  // Seek to the point under a horizontal position (used by tap AND drag on mobile).
  // Uses the physical left edge, so progress stays left→right like desktop (RTL-safe).
  const seekFromClientX = (clientX: number) => {
    const el = barRef.current;
    if (!el || !duration) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seek(ratio * duration);
  };

  // ── Mobile 2-row card layout ───────────────────────────────────────────────
  if (mobile) {
    return (
      <div style={{
        background: "#141414",
        borderTop: `1px solid rgba(220,38,38,0.4)`,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        boxShadow: "0 -6px 24px rgba(0,0,0,0.6), 0 -2px 12px rgba(220,38,38,0.12)",
        padding: "8px 16px 10px",
        direction: "rtl",
      }}>
        {/* Row 1: waveform + name/artist + play + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <WaveformBars playing={playing} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#F0F0F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {track.projectName}
            </div>
            <div style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {track.artist}
            </div>
          </div>
          <button
            onClick={canPlay ? (playing ? pause : resume) : undefined}
            style={{
              width: 40, height: 40, borderRadius: "50%", border: "none", flexShrink: 0,
              background: canPlay ? BRAND : "#333", color: "#fff",
              cursor: canPlay ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: canPlay ? "0 0 18px rgba(220,38,38,0.6)" : "none",
            }}
          >{playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}</button>
          <button onClick={stop} style={{ background: "none", border: "none", cursor: "pointer", color: "#555", fontSize: 22, flexShrink: 0, padding: "0 2px" }}>×</button>
        </div>
        {/* Row 2: progress bar — tap OR drag to seek. The touch area is tall
            (~24px) even though the line is thin; touchAction:none so a horizontal
            drag on the bar scrubs instead of scrolling the page. */}
        <div
          ref={barRef}
          onPointerDown={e => {
            if (!duration) return;
            try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
            draggingRef.current = true;
            seekFromClientX(e.clientX);
          }}
          onPointerMove={e => { if (draggingRef.current) seekFromClientX(e.clientX); }}
          onPointerUp={e => {
            draggingRef.current = false;
            try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
          }}
          onPointerCancel={() => { draggingRef.current = false; }}
          style={{ marginTop: 4, padding: "10px 0", cursor: "pointer", position: "relative", touchAction: "none" }}
        >
          <div style={{ height: 3, background: "#2A2A2A", borderRadius: 2, position: "relative" }}>
            <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0,
              width: `${progress}%`, background: BRAND, borderRadius: 2,
              transition: "width 0.1s linear",
            }} />
            <div style={{
              position: "absolute", left: `${progress}%`, top: "50%", transform: "translate(-50%, -50%)",
              width: 12, height: 12, borderRadius: "50%", background: "#fff",
              boxShadow: `0 0 8px ${BRAND}`, pointerEvents: "none",
            }} />
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop — floating centered card ──────────────────────────────────────
  return (
    <div style={{
      position: "fixed", bottom: 18, left: 0, right: 0, zIndex: 200,
      display: "flex", justifyContent: "center",
      padding: "0 20px",
      pointerEvents: "none",
    }}>
      <div dir="ltr" style={{
        width: "62%", maxWidth: 920, minWidth: 700,
        height: 92, borderRadius: 22,
        background: "linear-gradient(145deg, #1E1E1E 0%, #161616 100%)",
        border: "1px solid rgba(220,38,38,0.45)",
        boxShadow: "0 8px 48px rgba(0,0,0,0.75), 0 0 40px rgba(220,38,38,0.14), inset 0 1px 0 rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center",
        padding: "0 22px", gap: 18,
        pointerEvents: "auto",
      }}>

        {/* Track info + waveform */}
        <div dir="rtl" style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, minWidth: 0, maxWidth: 240 }}>
          <WaveformBars playing={playing} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#F0F0F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>
              {track.projectName}
            </div>
            <div style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
              {track.artist}
            </div>
          </div>
        </div>

        {/* Center: controls + progress */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7, minWidth: 0 }}>
          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button onClick={() => skip(-10)} title="אחורה 10 שניות" style={{
              background: "none", border: "none", cursor: "pointer", color: "#666",
              display: "flex", alignItems: "center", gap: 2, fontSize: 11, padding: "4px 6px",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#CCC"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#666"; }}>
              <span style={{ fontSize: 15 }}>⟪</span><span>10</span>
            </button>
            <button
              onClick={canPlay ? (playing ? pause : resume) : undefined}
              title={canPlay ? (playing ? "השהה" : "נגן") : "לא ניתן לנגן"}
              style={{
                width: 52, height: 52, borderRadius: "50%",
                background: canPlay ? BRAND : "#333",
                border: "none", cursor: canPlay ? "pointer" : "not-allowed",
                color: "#fff", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: canPlay ? "0 0 28px rgba(220,38,38,0.65), 0 0 8px rgba(220,38,38,1)" : "none",
                transition: "box-shadow 0.2s",
              }}
            >{playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}</button>
            <button onClick={() => skip(10)} title="קדימה 10 שניות" style={{
              background: "none", border: "none", cursor: "pointer", color: "#666",
              display: "flex", alignItems: "center", gap: 2, fontSize: 11, padding: "4px 6px",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#CCC"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#666"; }}>
              <span>10</span><span style={{ fontSize: 15 }}>⟫</span>
            </button>
          </div>
          {/* Progress */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
            <span style={{ fontSize: 10, color: "#555", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmt(currentTime)}</span>
            <div
              style={{ flex: 1, height: 4, background: "#2C2C2C", borderRadius: 2, cursor: "pointer", position: "relative" }}
              onClick={e => {
                if (!duration) return;
                const rect = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - rect.left) / rect.width) * duration);
              }}
            >
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${progress}%`,
                background: `linear-gradient(90deg, ${BRAND}, #F97316)`,
                borderRadius: 2, transition: "width 0.1s linear",
              }} />
              <div style={{
                position: "absolute", top: "50%", transform: "translateY(-50%)",
                left: `${progress}%`, marginLeft: -5,
                width: 10, height: 10, borderRadius: "50%",
                background: "#fff", boxShadow: `0 0 6px ${BRAND}`,
              }} />
            </div>
            <span style={{ fontSize: 10, color: "#555", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmt(duration)}</span>
          </div>
        </div>

        {/* Right: volume + upload + download + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button onClick={() => setVolume(volume === 0 ? 80 : 0)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#666", fontSize: 15, padding: 0 }}
            title={volume === 0 ? "בטל השתקה" : "השתק"}
          >
            {volume === 0 ? "🔇" : volume < 50 ? "🔉" : "🔊"}
          </button>
          <input type="range" min={0} max={100} value={volume}
            onChange={e => setVolume(Number(e.target.value))}
            style={{ width: 64, accentColor: BRAND, cursor: "pointer", opacity: 0.75 }}
            title={`ווליום: ${volume}%`}
          />
          {project && (
            <UploadButton
              projectId={project.id}
              projectName={project.name}
              artist={project.artist}
              existingFiles={project.files}
              status={project.status}
              size="sm"
            />
          )}
          {canPlay && (
            <a href={track.url} download title="הורד קובץ"
              style={{
                width: 30, height: 30, borderRadius: 9,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#777", textDecoration: "none", flexShrink: 0,
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.color = "#CCC"; el.style.background = "rgba(255,255,255,0.1)"; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.color = "#777"; el.style.background = "rgba(255,255,255,0.04)"; }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.5 1v7M3.5 5.5l3 3 3-3" /><path d="M1.5 10.5h10" />
              </svg>
            </a>
          )}
          <button onClick={stop} title="סגור נגן"
            style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", color: "#666", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.color = "#EEE"; el.style.background = "rgba(255,255,255,0.1)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.color = "#666"; el.style.background = "rgba(255,255,255,0.04)"; }}
          >×</button>
        </div>
      </div>
    </div>
  );
}
