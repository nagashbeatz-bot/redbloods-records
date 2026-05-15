"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRadio, RADIO_CHANNELS } from "./RadioProvider";

// ── Props — positioning hints passed by AppShell ───────────────────────────
interface Props {
  /** How many px the project MiniPlayer occupies at the bottom (0 when hidden) */
  playerOffset: number;
  /** Right offset = sidebar width (always 224) */
  sidebarWidth: number;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function JahknoRadioPlayer({ playerOffset, sidebarWidth }: Props) {
  const { playing, loading, channel, volume, panelOpen, play, pause, setChannel, setVolume, setPanelOpen } = useRadio();
  const [mounted, setMounted] = useState(false);

  // Portal mount guard
  useEffect(() => { setMounted(true); }, []);

  const handlePlayPause = () => {
    if (playing) {
      pause();
    } else {
      play();
    }
  };

  const handleChannelChange = (id: typeof RADIO_CHANNELS[number]["id"]) => {
    setChannel(id);
  };

  // ── Positioning ────────────────────────────────────────────────────────────
  const PANEL_W  = 260;
  const bottomPx = playerOffset > 0 ? playerOffset + 12 : 8;
  const rightPx  = sidebarWidth + 8;

  // ── Live dot ───────────────────────────────────────────────────────────────
  const dot = (
    <span
      style={{
        display: "inline-block",
        width: 6, height: 6, borderRadius: "50%",
        background: playing ? "#10B981" : "#3A3A3A",
        boxShadow: playing ? "0 0 5px #10B981" : "none",
        flexShrink: 0,
        transition: "background 0.3s, box-shadow 0.3s",
      }}
    />
  );

  // ── Floating panel ─────────────────────────────────────────────────────────
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
        zIndex: 55,
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
            <span style={{ color: "#10B981", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em" }}>
              LIVE
            </span>
          )}
        </div>
        <button
          onClick={() => setPanelOpen(false)}
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

        {/* dir="ltr" forces slider to go left=low → right=high regardless of page RTL */}
        <div dir="ltr" style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#555", fontSize: 11 }}>🔈</span>
          <input
            type="range" min={0} max={100} value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#3B82F6", cursor: "pointer" }}
          />
          <span style={{ color: "#555", fontSize: 11 }}>🔊</span>
        </div>
      </div>

      {/* Channel list */}
      <div style={{ padding: "8px 10px 10px" }}>
        {RADIO_CHANNELS.map((c) => (
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
      {/* Header trigger button */}
      <button
        onClick={() => setPanelOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 10px",
          background: panelOpen ? "rgba(16,185,129,0.12)" : "#1A1A1A",
          border: `1px solid ${panelOpen ? "rgba(16,185,129,0.3)" : "#2A2A2A"}`,
          borderRadius: 10,
          color: panelOpen ? "#10B981" : "#777",
          fontSize: 12, fontWeight: 500,
          cursor: "pointer", fontFamily: "inherit",
          transition: "all 0.2s",
          whiteSpace: "nowrap",
        }}
      >
        {dot}
        <span style={{ marginRight: 2 }}>Jahkno Radio</span>
        {playing && (
          <span style={{ color: "#10B981", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em" }}>
            LIVE
          </span>
        )}
      </button>

      {/* Floating panel — portal to body */}
      {mounted && panelOpen && createPortal(panel, document.body)}
    </>
  );
}
