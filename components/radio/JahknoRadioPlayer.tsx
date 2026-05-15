"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRadio, RADIO_CHANNELS } from "./RadioProvider";

// ── Equalizer bar data ────────────────────────────────────────────────────────
const BAR_COUNT = 22;
const EQ_PATTERNS = ["eq1", "eq2", "eq3", "eq4", "eq5"] as const;
const EQ_DURATIONS = [0.75, 0.90, 0.65, 1.05, 0.80] as const;

const BARS = Array.from({ length: BAR_COUNT }, (_, i) => ({
  pattern:  EQ_PATTERNS[i % 5],
  duration: EQ_DURATIONS[i % 5],
  delay:    +(((i * 0.073) % 0.55).toFixed(3)),
  alpha:    0.55 + (i % 4) * 0.12,
}));

// ── Visualizer — artwork bg + equalizer bars ──────────────────────────────────
function RadioVisualizer({
  playing,
  loading,
  artwork,
}: {
  playing: boolean;
  loading: boolean;
  artwork: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        height: 108,
        borderRadius: "0",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Blurred artwork background */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={artwork}
        alt=""
        style={{
          position: "absolute",
          inset: "-12px",
          width: "calc(100% + 24px)",
          height: "calc(100% + 24px)",
          objectFit: "cover",
          filter: "blur(10px) brightness(0.28) saturate(1.3)",
          transition: "filter 0.6s ease",
          pointerEvents: "none",
          userSelect: "none",
        }}
      />

      {/* Dark vignette overlay */}
      <div
        style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Green glow from bottom when playing */}
      <div
        style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse 100% 60% at 50% 100%, rgba(16,185,129,0.12) 0%, transparent 70%)",
          opacity: playing ? 1 : 0,
          transition: "opacity 0.8s ease",
          pointerEvents: "none",
        }}
      />

      {/* Equalizer bars */}
      <div
        style={{
          position: "absolute",
          bottom: 0, left: 14, right: 14,
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
              height: 80,
              borderRadius: "2px 2px 0 0",
              background: playing
                ? `rgba(16,185,129,${bar.alpha})`
                : "rgba(255,255,255,0.10)",
              animationName:     playing ? bar.pattern  : undefined,
              animationDuration: playing ? `${bar.duration}s` : undefined,
              animationDelay:    playing ? `${bar.delay}s`    : undefined,
              transition: "background 0.5s ease",
            }}
          />
        ))}
      </div>

      {/* LIVE / status badge */}
      <div style={{ position: "absolute", top: 9, left: 12, display: "flex", alignItems: "center", gap: 5 }}>
        <span
          style={{
            display: "inline-block",
            width: 6, height: 6, borderRadius: "50%",
            background: playing ? "#10B981" : "#555",
            boxShadow: playing ? "0 0 7px #10B981" : "none",
            transition: "all 0.4s ease",
          }}
        />
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
          color: playing ? "#10B981" : "#666",
          transition: "color 0.4s ease",
        }}>
          {loading ? "CONNECTING" : playing ? "LIVE" : "PAUSED"}
        </span>
      </div>
    </div>
  );
}

// ── Channel card — image + play overlay ──────────────────────────────────────
function ChannelCard({
  channel,
  active,
  playing,
  onClick,
}: {
  channel: typeof RADIO_CHANNELS[number];
  active: boolean;
  playing: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        aspectRatio: "1",
        borderRadius: 10,
        overflow: "hidden",
        border: active
          ? "2px solid rgba(16,185,129,0.7)"
          : "2px solid transparent",
        cursor: "pointer",
        padding: 0,
        background: "#111",
        transition: "border-color 0.2s, transform 0.15s",
        transform: hovered && !active ? "scale(0.97)" : "scale(1)",
        flexShrink: 0,
      }}
      title={channel.label}
    >
      {/* Artwork */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={channel.artwork}
        alt={channel.label}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          transition: "opacity 0.2s",
          opacity: active || hovered ? 1 : 0.75,
        }}
      />

      {/* Dark overlay */}
      <div
        style={{
          position: "absolute", inset: 0,
          background: active
            ? "rgba(0,0,0,0.25)"
            : hovered
            ? "rgba(0,0,0,0.30)"
            : "rgba(0,0,0,0.50)",
          transition: "background 0.2s",
        }}
      />

      {/* Play / Playing indicator */}
      <div
        style={{
          position: "absolute",
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: 28, height: 28,
          borderRadius: "50%",
          background: active && playing
            ? "rgba(16,185,129,0.95)"
            : "rgba(255,255,255,0.85)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.2s",
          opacity: active || hovered ? 1 : 0.5,
          boxShadow: active && playing ? "0 0 10px rgba(16,185,129,0.6)" : "none",
        }}
      >
        <span style={{
          fontSize: 9,
          color: active && playing ? "#fff" : "#111",
          marginLeft: active && playing ? 0 : 1,
          fontWeight: 700,
        }}>
          {active && playing ? "⏸" : "▶"}
        </span>
      </div>

      {/* Channel name */}
      <div
        style={{
          position: "absolute",
          bottom: 0, left: 0, right: 0,
          padding: "12px 5px 5px",
          background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
          fontSize: 8.5,
          fontWeight: 700,
          color: "#fff",
          textAlign: "center",
          lineHeight: 1.2,
          letterSpacing: "0.02em",
        }}
      >
        {channel.label}
      </div>

      {/* Active glow ring */}
      {active && playing && (
        <div
          style={{
            position: "absolute", inset: 0,
            borderRadius: 8,
            boxShadow: "inset 0 0 0 1.5px rgba(16,185,129,0.4)",
            pointerEvents: "none",
          }}
        />
      )}
    </button>
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
  const PANEL_W  = 278;
  const bottomPx = playerOffset > 0 ? playerOffset + 12 : 8;
  const rightPx  = sidebarWidth + 8;

  // ── Header dot ────────────────────────────────────────────────────────────
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
        boxShadow: "0 12px 48px rgba(0,0,0,0.8)",
        overflow: "hidden",
        transition: "bottom 0.25s",
        flexDirection: "column",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "11px 14px 10px",
          borderBottom: "1px solid #222",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {dot}
          <span style={{ color: "#F0F0F0", fontSize: 13, fontWeight: 800, letterSpacing: "0.04em" }}>
            RED VIBE
          </span>
          {playing && (
            <span style={{ color: "#10B981", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em" }}>
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
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#AAA")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#555")}
        >
          ✕
        </button>
      </div>

      {/* ── Visualizer ──────────────────────────────────────────────────── */}
      <RadioVisualizer
        playing={playing}
        loading={loading}
        artwork={currentChannel.artwork}
      />

      {/* ── Play + Volume ────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid #222",
          flexShrink: 0,
        }}
      >
        {/* Play / Pause */}
        <button
          onClick={handlePlayPause}
          style={{
            width: 32, height: 32, borderRadius: "50%",
            background: playing ? "#10B981" : "#252525",
            border: `1px solid ${playing ? "#10B981" : "#333"}`,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, color: playing ? "#fff" : "#888",
            flexShrink: 0,
            transition: "all 0.2s",
          }}
        >
          {loading ? <span style={{ fontSize: 9 }}>⋯</span> : playing ? "⏸" : "▶"}
        </button>

        {/* Now playing label */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 1 }}>
            {playing ? "עכשיו מנגן" : "בחר תחנה"}
          </div>
          <div style={{
            fontSize: 12, fontWeight: 600, color: "#E8E8E8",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {currentChannel.label}
          </div>
        </div>

        {/* Volume — dir="ltr": 🔈 left → right 🔊 */}
        <div dir="ltr" style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <span style={{ color: "#555", fontSize: 10 }}>🔈</span>
          <input
            type="range" min={0} max={100} value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ width: 64, accentColor: "#10B981", cursor: "pointer" }}
          />
          <span style={{ color: "#555", fontSize: 10 }}>🔊</span>
        </div>
      </div>

      {/* ── Channel grid — 3 × 2 ─────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
          padding: "10px 12px 12px",
        }}
      >
        {RADIO_CHANNELS.map((c) => (
          <ChannelCard
            key={c.id}
            channel={c}
            active={channel === c.id}
            playing={playing && channel === c.id}
            onClick={() => {
              if (channel === c.id) {
                handlePlayPause();
              } else {
                setChannel(c.id);
                if (!playing) play(c.id);
              }
            }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <>
      {/* Header trigger — two zones: [play/pause] + [panel toggle] */}
      <div
        style={{
          display: "flex", alignItems: "center",
          background: playing ? "rgba(16,185,129,0.10)" : "#161616",
          border: `1px solid ${playing ? "rgba(16,185,129,0.30)" : "#242424"}`,
          borderRadius: 100,
          overflow: "hidden",
          transition: "all 0.2s",
          whiteSpace: "nowrap",
        }}
      >
        {/* ── Zone A: Play / Pause (main action) ── */}
        <button
          onClick={handlePlayPause}
          title={playing ? "עצור רדיו" : "הפעל רדיו"}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 10px 5px 11px",
            background: "none", border: "none",
            color: playing ? "#34D399" : "#888",
            cursor: "pointer", fontFamily: "inherit",
            transition: "color 0.2s",
          }}
        >
          {/* Status dot */}
          <span
            style={{
              display: "inline-block",
              width: 6, height: 6, borderRadius: "50%",
              background: playing ? "#10B981" : "#333",
              boxShadow: playing ? "0 0 6px #10B981" : "none",
              flexShrink: 0,
              transition: "background 0.3s, box-shadow 0.3s",
            }}
          />

          {/* Play / Pause icon */}
          <span style={{ fontSize: 8, lineHeight: 1, marginRight: -1 }}>
            {loading ? "⋯" : playing ? "⏸" : "▶"}
          </span>

          {/* Label */}
          <span style={{
            fontSize: 11, fontWeight: 700,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
          }}>
            {playing ? "Pause" : "Listen"}
          </span>

          {/* LIVE badge */}
          {playing && !loading && (
            <span style={{
              fontSize: 8, fontWeight: 800,
              letterSpacing: "0.12em",
              color: "#10B981",
              marginLeft: -2,
            }}>
              LIVE
            </span>
          )}
          {loading && (
            <span style={{
              fontSize: 8, fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#888",
              marginLeft: -2,
            }}>
              ...
            </span>
          )}
        </button>

        {/* ── Divider ── */}
        <span style={{
          width: 1, height: 14,
          background: playing ? "rgba(16,185,129,0.25)" : "#2A2A2A",
          flexShrink: 0,
          transition: "background 0.2s",
        }} />

        {/* ── Zone B: Panel toggle (chevron) ── */}
        <button
          onClick={() => setPanelOpen((o) => !o)}
          title={panelOpen ? "סגור נגן" : "פתח נגן"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "5px 10px",
            background: "none", border: "none",
            color: panelOpen ? "#34D399" : "#555",
            cursor: "pointer", fontFamily: "inherit",
            fontSize: 9,
            transition: "color 0.2s",
          }}
        >
          {panelOpen ? "▲" : "▼"}
        </button>
      </div>

      {mounted && panelOpen && createPortal(panel, document.body)}
    </>
  );
}
