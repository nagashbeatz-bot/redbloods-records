"use client";

import { useRef, useState } from "react";
import { usePlayerSafe, type AudioTrack } from "@/components/PlayerProvider";
import { useProjects } from "@/components/ProjectsProvider";
import UploadButton from "@/components/ui/UploadButton";

const BRAND = "#DC2626";

function fmt(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// A sensible download filename for a track (never a UUID). If the track name has no
// audio extension, the secure stream endpoint still serves the real file (Dropbox
// sets the download name); this attribute is only the same-origin hint.
function downloadName(track: { fileName?: string; projectName?: string; url: string }): string {
  const base = (track.fileName?.trim() || track.projectName?.trim() || "track");
  if (/\.(mp3|wav|m4a|ogg|flac|aiff?|aac)$/i.test(base)) return base;
  const ext = track.url.match(/\.(mp3|wav|m4a|ogg|flac|aiff?|aac)(?=$|\?)/i)?.[0] ?? "";
  return base + ext;
}

function DownloadIcon({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M6.5 1v7M3.5 5.5l3 3 3-3" /><path d="M1.5 10.5h10" />
    </svg>
  );
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <>
      <style>{`@keyframes mpSpin{to{transform:rotate(360deg)}}`}</style>
      <span style={{
        width: size, height: size, borderRadius: "50%", boxSizing: "border-box",
        border: "2px solid rgba(255,255,255,0.25)", borderTopColor: "#fff",
        display: "inline-block", animation: "mpSpin 0.7s linear infinite",
      }} />
    </>
  );
}

// Extract a clean filename from a Content-Disposition header (RFC 5987 first).
function parseFilename(cd: string | null): string | null {
  if (!cd) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch { return star[1].trim(); } }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1].trim() : null;
}

function ShareIcon({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg",
  flac: "audio/flac", aiff: "audio/aiff", aif: "audio/aiff", aac: "audio/aac",
};
function guessMime(name: string): string {
  const ext = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
// Touch-primary device (phone/tablet) — feature detection, not UA sniffing. Used to
// decide whether to open the native Share Sheet instead of a browser download.
function isTouchPrimary(): boolean {
  if (typeof window === "undefined") return false;
  try { return !!window.matchMedia?.("(pointer: coarse)")?.matches; } catch { return false; }
}
function blobDownload(blob: Blob, name: string) {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
}

/**
 * Download control. When the track carries a secure SAME-ORIGIN attachment endpoint
 * (`downloadUrl`), it fetches the bytes → Blob → clean filename (from
 * Content-Disposition). On a TOUCH device that supports the File Share API it opens
 * the native Share Sheet with a real File (iOS → "Save to Files" / WhatsApp /
 * AirDrop, no Quick Look, no navigation); on desktop/Android it does a normal Blob
 * download. Legacy tracks with no downloadUrl keep the plain anchor. Never uses
 * window.open / opens a new tab / navigates the app.
 */
function DownloadControl({ track, size, iconSize, radius }: {
  track: AudioTrack; size: number; iconSize: number; radius: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  // Heuristic for the icon/label only; the real path is decided at click time via
  // navigator.canShare({ files }) with the actual file.
  const shareMode = isTouchPrimary() && typeof navigator !== "undefined"
    && typeof navigator.share === "function" && typeof navigator.canShare === "function";

  const box: React.CSSProperties = {
    width: size, height: size, borderRadius: radius, flexShrink: 0, textDecoration: "none",
    background: "rgba(255,255,255,0.05)", border: `1px solid ${err ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.1)"}`,
    display: "flex", alignItems: "center", justifyContent: "center",
    color: err ? "#F87171" : "#AAA",
  };

  if (!track.downloadUrl) {
    return (
      <a href={track.url} download={downloadName(track)} title="הורד קובץ" onClick={e => e.stopPropagation()}
        style={{ ...box, cursor: "pointer" }}>
        <DownloadIcon size={iconSize} />
      </a>
    );
  }

  const onClick = async () => {
    if (busy) return;
    setBusy(true); setErr(false);
    try {
      const res = await fetch(track.downloadUrl!, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const name = parseFilename(res.headers.get("Content-Disposition")) || downloadName(track);

      // Touch + File Share API → native Share Sheet with a real file (no Quick Look).
      if (shareMode) {
        const file = new File([blob], name, { type: blob.type || guessMime(name) });
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: name });
            return; // user shared / saved, or is handling it
          } catch (e) {
            if ((e as Error)?.name === "AbortError") return; // cancelled the sheet → NOT an error
            throw e;
          }
        }
      }
      // Desktop / Android / no File Share → normal download.
      blobDownload(blob, name);
    } catch {
      setErr(true);
      setTimeout(() => setErr(false), 3500);
    } finally {
      setBusy(false);
    }
  };

  const label = shareMode ? "שמור או שתף" : "הורד קובץ";
  return (
    <button onClick={onClick} disabled={busy} aria-label={label}
      title={err ? "לא ניתן היה להכין את הקובץ לשמירה" : label}
      style={{ ...box, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
      {busy ? <Spinner size={iconSize} />
        : shareMode ? <ShareIcon size={iconSize} color={err ? "#F87171" : "currentColor"} />
        : <DownloadIcon size={iconSize} color={err ? "#F87171" : "currentColor"} />}
    </button>
  );
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
  const miniSkipBtn: React.CSSProperties = {
    background: "none", border: "none", cursor: "pointer", color: "#8A8A8A",
    fontSize: 11, fontWeight: 800, padding: "8px 4px", flexShrink: 0, whiteSpace: "nowrap", fontFamily: "inherit",
  };
  if (mobile) {
    return (
      <div style={{
        background: "#141414",
        borderTop: `1px solid rgba(220,38,38,0.4)`,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        boxShadow: "0 -6px 24px rgba(0,0,0,0.6), 0 -2px 12px rgba(220,38,38,0.12)",
        padding: "8px 14px 10px",
        direction: "rtl",
      }}>
        {/* Row 1: waveform + name/artist + download + play + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <WaveformBars playing={playing} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#F0F0F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {track.projectName}
            </div>
            <div style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {track.artist}
            </div>
          </div>
          {canPlay && <DownloadControl track={track} size={38} iconSize={15} radius={11} />}
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
        {/* Row 2 (LTR so the timeline reads left→right): ⟪10 · time · big seek · time · 10⟫.
            The touch target is tall (~34px) though the line is thin; touchAction:none +
            preventDefault/stopPropagation + pointer capture so a horizontal drag scrubs
            smoothly and NEVER triggers page scroll / swipe-navigation. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, direction: "ltr" }}>
          <button onClick={() => skip(-10)} aria-label="אחורה 10 שניות" style={miniSkipBtn}>⟪10</button>
          <span style={{ fontSize: 10, color: "#777", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmt(currentTime)}</span>
          <div
            ref={barRef}
            onPointerDown={e => {
              if (!duration) return;
              e.preventDefault(); e.stopPropagation();
              try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
              draggingRef.current = true;
              seekFromClientX(e.clientX);
            }}
            onPointerMove={e => {
              if (!draggingRef.current) return;
              e.preventDefault(); e.stopPropagation();
              seekFromClientX(e.clientX);
            }}
            onPointerUp={e => {
              draggingRef.current = false;
              try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            }}
            onPointerCancel={() => { draggingRef.current = false; }}
            style={{ flex: 1, minWidth: 0, padding: "14px 0", cursor: "pointer", position: "relative", touchAction: "none" }}
          >
            <div style={{ height: 4, background: "#2A2A2A", borderRadius: 2, position: "relative" }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${progress}%`, background: BRAND, borderRadius: 2,
              }} />
              <div style={{
                position: "absolute", left: `${progress}%`, top: "50%", transform: "translate(-50%, -50%)",
                width: 14, height: 14, borderRadius: "50%", background: "#fff",
                boxShadow: `0 0 8px ${BRAND}`, pointerEvents: "none",
              }} />
            </div>
          </div>
          <span style={{ fontSize: 10, color: "#777", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmt(duration)}</span>
          <button onClick={() => skip(10)} aria-label="קדימה 10 שניות" style={miniSkipBtn}>10⟫</button>
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
          {canPlay && <DownloadControl track={track} size={30} iconSize={13} radius={9} />}
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
