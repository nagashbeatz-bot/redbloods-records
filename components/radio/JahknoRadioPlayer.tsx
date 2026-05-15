"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";

// ── Stream URLs ────────────────────────────────────────────────────────────────
const CHANNELS = [
  { id: "main",      label: "Jahkno! Main",          url: "https://streaming.radio.co/s00d41a200/listen" },
  { id: "dancehall", label: "Dancehall Reggae",       url: "http://stream.zeno.fm/7qrr5rm9g0hvv" },
  { id: "hiphop",    label: "Hip-Hop × R&B",          url: "http://stream.zeno.fm/4k3px7s9g0hvv" },
  { id: "afrobeats", label: "Afrobeats × Amapiano",   url: "http://stream.zeno.fm/n95vb4dah0hvv" },
  { id: "gospel",    label: "Gospel",                 url: "https://stream.zeno.fm/azvi4fweulauv" },
  { id: "trending",  label: "Trending",               url: "https://stream-163.zeno.fm/ce1jvste7tpuv" },
] as const;

type ChannelId = (typeof CHANNELS)[number]["id"];

// ── Props ──────────────────────────────────────────────────────────────────────
interface Props {
  /** How many px the project MiniPlayer occupies at the bottom (0 when hidden) */
  playerOffset: number;
  /** Right offset = sidebar width (always 224) */
  sidebarWidth: number;
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function JahknoRadioPlayer({ playerOffset, sidebarWidth }: Props) {
  const [open,    setOpen]    = useState(false);
  const [playing, setPlaying] = useState(false);
  const [channel, setChannel] = useState<ChannelId>("main");
  const [volume,  setVolume]  = useState(80);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Mount guard for portal
  useEffect(() => { setMounted(true); }, []);

  // ── Audio control ────────────────────────────────────────────────────────────
  const ch = CHANNELS.find(c => c.id === channel) ?? CHANNELS[0];

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume / 100;
  }, [volume]);

  const startStream = useCallback((url: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    setLoading(true);
    audio.src = url;
    audio.volume = volume / 100;
    audio.play()
      .then(() => setLoading(false))
      .catch(() => setLoading(false));
  }, [volume]);

  const stopStream = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.src = "";
  }, []);

  const handlePlayPause = () => {
    if (playing) {
      stopStream();
      setPlaying(false);
    } else {
      startStream(ch.url);
      setPlaying(true);
    }
  };

  const handleChannelChange = (id: ChannelId) => {
    setChannel(id);
    if (playing) {
      const newCh = CHANNELS.find(c => c.id === id);
      if (newCh) startStream(newCh.url);
    }
  };

  // ── Positioning ──────────────────────────────────────────────────────────────
  // Float in bottom-right corner, above MiniPlayer (if visible), left of sidebar
  const PANEL_W  = 260;
  const bottomPx = playerOffset > 0 ? playerOffset + 12 : 8;
  const rightPx  = sidebarWidth + 8;

  // ── Render ───────────────────────────────────────────────────────────────────
  const dot = (
    <span
      style={{
        display: "inline-block",
        width: 6, height: 6, borderRadius: "50%",
        background: playing ? "#10B981" : "#3A3A3A",
        boxShadow: playing ? "0 0 5px #10B981" : "none",
        marginLeft: 6,
        flexShrink: 0,
        transition: "background 0.3s, box-shadow 0.3s",
      }}
    />
  );

  // Header trigger button — rendered in the header by the parent (AppShell)
  // This component renders: the <audio> tag + the floating panel via portal

  const panel = (
    <div
      className="hidden md:block"
      style={{
        position: "fixed",
        bottom: bottomPx,
        right: rightPx,
        width: PANEL_W,
        background: "#181818",
        border: "1px solid #2A2A2A",
        borderRadius: 16,
        zIndex: 55, // below MiniPlayer (z-50) overlay but above page content
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
        overflow: "hidden",
        transition: "bottom 0.25s",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 14px 10px",
          borderBottom: "1px solid #222",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {dot}
          <span style={{ color: "#F0F0F0", fontSize: 13, fontWeight: 700 }}>Jahkno Radio</span>
          {playing && (
            <span
              style={{
                color: "#10B981", fontSize: 9, fontWeight: 700,
                letterSpacing: "0.08em", opacity: 0.9,
              }}
            >
              LIVE
            </span>
          )}
        </div>
        <button
          onClick={() => setOpen(false)}
          style={{
            background: "none", border: "none", color: "#555",
            cursor: "pointer", fontSize: 13, padding: "2px 4px",
            fontFamily: "inherit", lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Play / Volume controls */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid #1E1E1E",
        }}
      >
        {/* Play/Pause button */}
        <button
          onClick={handlePlayPause}
          style={{
            width: 34, height: 34, borderRadius: "50%",
            background: playing ? "#10B981" : "#2A2A2A",
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, color: playing ? "#fff" : "#888",
            flexShrink: 0,
            transition: "background 0.2s",
          }}
        >
          {loading ? "⋯" : playing ? "⏸" : "▶"}
        </button>

        {/* Volume */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#555", fontSize: 11 }}>🔊</span>
          <input
            type="range" min={0} max={100} value={volume}
            onChange={e => setVolume(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#3B82F6", cursor: "pointer" }}
          />
          <span style={{ color: "#555", fontSize: 10, minWidth: 22, textAlign: "right" }}>
            {volume}%
          </span>
        </div>
      </div>

      {/* Channel list */}
      <div style={{ padding: "8px 10px 10px" }}>
        {CHANNELS.map(c => (
          <button
            key={c.id}
            onClick={() => handleChannelChange(c.id)}
            style={{
              display: "block", width: "100%",
              background: channel === c.id ? "rgba(59,130,246,0.12)" : "transparent",
              border: `1px solid ${channel === c.id ? "rgba(59,130,246,0.25)" : "transparent"}`,
              borderRadius: 8,
              padding: "6px 10px",
              color: channel === c.id ? "#60A5FA" : "#666",
              fontSize: 12,
              fontWeight: channel === c.id ? 600 : 400,
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "inherit",
              marginBottom: 2,
              transition: "all 0.15s",
            }}
          >
            {channel === c.id && playing && (
              <span style={{ marginRight: 6, color: "#10B981", fontSize: 8 }}>●</span>
            )}
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="none" />

      {/* Trigger button — rendered inline, placed by parent in header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 10px",
          background: open ? "rgba(16,185,129,0.12)" : "#1A1A1A",
          border: `1px solid ${open ? "rgba(16,185,129,0.3)" : "#2A2A2A"}`,
          borderRadius: 10,
          color: open ? "#10B981" : "#777",
          fontSize: 12, fontWeight: 500,
          cursor: "pointer", fontFamily: "inherit",
          transition: "all 0.2s",
          whiteSpace: "nowrap",
        }}
      >
        {dot}
        <span>Jahkno Radio</span>
        {playing && (
          <span style={{ color: "#10B981", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em" }}>
            LIVE
          </span>
        )}
      </button>

      {/* Floating panel — portal to body */}
      {mounted && open && createPortal(panel, document.body)}
    </>
  );
}
