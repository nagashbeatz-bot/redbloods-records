"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRadio, RADIO_CHANNELS } from "./RadioProvider";

// ── Bar config for the equalizer visualizer ───────────────────────────────────
// 5 keyframe patterns (eq1–eq5), each bar gets one + a staggered delay.
const BAR_COUNT = 22;
const EQ_PATTERNS = ["eq1", "eq2", "eq3", "eq4", "eq5"] as const;
const EQ_DURATIONS = [0.75, 0.90, 0.65, 1.05, 0.80] as const; // seconds per pattern

// Pre-compute bar data once (stable across renders)
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => ({
  pattern:  EQ_PATTERNS[i % 5],
  duration: EQ_DURATIONS[i % 5],
  delay:    +(((i * 0.073) % 0.55).toFixed(3)),
  // slight variation in opacity for depth
  alpha: 0.45 + (i % 4) * 0.12,
}));

// ── Equalizer visualizer component ───────────────────────────────────────────
function RadioVisualizer({
  playing,
  loading,
  channelLabel,
}: {
  playing: boolean;
  loading: boolean;
  channelLabel: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        height: 96,
        background: "linear-gradient(180deg, #0A130C 0%, #0D0D0D 100%)",
        borderRadius: 10,
        overflow: "hidden",
        margin: "10px 14px 0",
        flexShrink: 0,
      }}
    >
      {/* Subtle green glow when playing */}
      <div
        style={{
          position: "absolute", inset: 0,
          background: playing
            ? "radial-gradient(ellipse 90% 80% at 50% 100%, rgba(16,185,129,0.09) 0%, transparent 70%)"
            : "transparent",
          transition: "opacity 1s ease",
          opacity: playing ? 1 : 0,
          pointerEvents: "none",
        }}
      />

      {/* Equalizer bars — full height div, bars sit at the bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 14,
          right: 14,
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
        }}
      >
        {BARS.map((bar, i) => (
          <div
            key={i}
            className={`eq-bar ${playing ? "playing" : "paused"}`}
            style={{
              flex: 1,
              height: 72, // full height; scaleY controls visible height
              borderRadius: "2px 2px 0 0",
              background: playing
                ? `rgba(16,185,129,${bar.alpha})`
                : "rgba(255,255,255,0.07)",
              // per-bar: override animation-name and timing
              animationName: playing ? bar.pattern : undefined,
              animationDuration: playing ? `${bar.duration}s` : undefined,
              animationDelay: playing ? `${bar.delay}s` : undefined,
              transition: "background 0.5s ease",
            }}
          />
        ))}
      </div>

      {/* LIVE / PAUSED badge — top left */}
      <div
        style={{
          position: "absolute",
          top: 9, left: 12,
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 6, height: 6, borderRadius: "50%",
            background: playing ? "#10B981" : "#444",
            boxShadow: playing ? "0 0 6px #10B981" : "none",
            transition: "all 0.4s ease",
          }}
        />
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: playing ? "#10B981" : "#555",
            transition: "color 0.4s ease",
          }}
        >
          {loading ? "CONNECTING" : playing ? "LIVE" : "PAUSED"}
        </span>
      </div>

      {/* Current channel name — bottom right */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 10,
          fontSize: 10,
          fontWeight: 600,
          color: playing ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.2)",
          letterSpacing: "0.03em",
          transition: "color 0.4s ease",
          maxWidth: "65%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {channelLabel}
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  playerOffset: number;
  sidebarWidth: number;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function JahknoRadioPlayer({ playerOffset, sidebarWidth }: Props) {
  const {
    playing, loading, channel, volume, panelOpen,
    play, pause, setChannel, setVolume, setPanelOpen,
  } = useRadio();

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const handlePlayPause = () => (playing ? pause() : play());

  const currentChannel = RADIO_CHANNELS.find((c) => c.id === channel) ?? RADIO_CHANNELS[0];

  // ── Positioning ────────────────────────────────────────────────────────────
  const PANEL_W  = 272;
  const bottomPx = playerOffset > 0 ? playerOffset + 12 : 8;
  const rightPx  = sidebarWidth + 8;

  // ── Live dot for header button ─────────────────────────────────────────────
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
      className="hidden md:flex"
      style={{
        position: "fixed",
        bottom: bottomPx,
        right: rightPx,
        width: PANEL_W,
        background: "#181818",
        border: "1px solid #2A2A2A",
        borderRadius: 16,
        zIndex: 55,
        boxShadow: "0 8px 40px rgba(0,0,0,0.75)",
        overflow: "hidden",
        transition: "bottom 0.25s",
        flexDirection: "column",
        paddingBottom: 10,
      }}
    >
      {/* ── Panel header ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 14px 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {dot}
          <span style={{ color: "#F0F0F0", fontSize: 13, fontWeight: 700, letterSpacing: "0.01em" }}>
            Jahkno Radio
          </span>
        </div>
        <button
          onClick={() => setPanelOpen(false)}
          style={{
            background: "none", border: "none", color: "#555",
            cursor: "pointer", fontSize: 13, padding: "2px 4px",
            fontFamily: "inherit", lineHeight: 1,
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#AAA")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#555")}
        >
          ✕
        </button>
      </div>

      {/* ── Visualizer ────────────────────────────────────────────────────── */}
      <RadioVisualizer
        playing={playing}
        loading={loading}
        channelLabel={currentChannel.label}
      />

      {/* ── Play / Volume ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 14px 8px",
          borderBottom: "1px solid #222",
        }}
      >
        {/* Play / Pause */}
        <button
          onClick={handlePlayPause}
          style={{
            width: 34, height: 34, borderRadius: "50%",
            background: playing ? "#10B981" : "#252525",
            border: `1px solid ${playing ? "#10B981" : "#333"}`,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, color: playing ? "#fff" : "#888",
            flexShrink: 0,
            transition: "all 0.2s",
          }}
        >
          {loading ? (
            <span style={{ fontSize: 10, opacity: 0.7 }}>⋯</span>
          ) : playing ? (
            "⏸"
          ) : (
            "▶"
          )}
        </button>

        {/* Volume — dir="ltr" so slider goes low (left) → high (right) */}
        <div dir="ltr" style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#555", fontSize: 11, flexShrink: 0 }}>🔈</span>
          <input
            type="range" min={0} max={100} value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#10B981", cursor: "pointer" }}
          />
          <span style={{ color: "#555", fontSize: 11, flexShrink: 0 }}>🔊</span>
        </div>
      </div>

      {/* ── Channel list ──────────────────────────────────────────────────── */}
      <div style={{ padding: "6px 10px 0" }}>
        {RADIO_CHANNELS.map((c) => {
          const active = channel === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setChannel(c.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                background: active ? "rgba(16,185,129,0.08)" : "transparent",
                border: `1px solid ${active ? "rgba(16,185,129,0.2)" : "transparent"}`,
                borderRadius: 8,
                padding: "6px 10px",
                color: active ? "#34D399" : "#666",
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                marginBottom: 2,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!active) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              {/* Active playing indicator dot */}
              <span
                style={{
                  width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                  background: active && playing ? "#10B981" : active ? "#34D399" : "#333",
                  boxShadow: active && playing ? "0 0 4px #10B981" : "none",
                  transition: "all 0.3s",
                }}
              />
              {c.label}
            </button>
          );
        })}
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
          background: panelOpen ? "rgba(16,185,129,0.1)" : "#1A1A1A",
          border: `1px solid ${panelOpen ? "rgba(16,185,129,0.3)" : "#2A2A2A"}`,
          borderRadius: 10,
          color: panelOpen ? "#34D399" : "#777",
          fontSize: 12, fontWeight: 500,
          cursor: "pointer", fontFamily: "inherit",
          transition: "all 0.2s",
          whiteSpace: "nowrap",
        }}
      >
        {dot}
        <span style={{ marginRight: 1 }}>Jahkno Radio</span>
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
