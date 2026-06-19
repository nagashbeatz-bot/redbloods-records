"use client";

// ── Live read-only preview — /dashboard-preview ───────────────────────────
// Real data: projects (KPI + rows). Calendar / Alerts / Focus = dummy.
// No writes, no drawer, no dispatch.

import { useState, useEffect, useLayoutEffect } from "react";
import { useProjects } from "@/components/ProjectsProvider";
import { daysUntilDeadline } from "@/lib/utils";
import type { Project, AgentAlert } from "@/lib/types";
import JahknoRadioPlayer from "@/components/radio/JahknoRadioPlayer";
import MobileNav from "@/components/MobileNav";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import { useRadioSafe } from "@/components/radio/RadioProvider";

// Minimal calendar event shape (only what preview needs)
interface CalEvent { title: string; startTime: string; endTime: string; isAllDay: boolean; type: string; artist: string; }

const ALERT_CATEGORIES = [
  { key: "deadline", label: "דדליינים",    icon: "📅", types: ["overdue_deadline", "deadline_approaching"], color: "#EF4444", bg: "rgba(239,68,68,0.07)"  },
  { key: "finance",  label: "כספים",       icon: "₪",  types: ["payment_overdue", "project_no_pricing"],   color: "#F59E0B", bg: "rgba(245,158,11,0.07)" },
  { key: "sessions", label: "סשנים",       icon: "🎵", types: ["session_needs_update", "stale_session"],   color: "#3B82F6", bg: "rgba(59,130,246,0.07)"  },
  { key: "victor",   label: "ויקטור",      icon: "👤", types: ["victor_stuck", "victor_below_pace"],       color: "#A855F7", bg: "rgba(168,85,247,0.07)"  },
] as const;

const CLOSED_PROPOSAL = new Set(["נסגר", "לא נסגר"]);

const BRAND   = "#DC2626";
const BG      = "#0D0D0D";
const SURFACE = "#141414";
const CARD    = "#181818";
const CARD2   = "#1E1E1E";
const BORDER  = "rgba(255,255,255,0.07)";
const BORDER2 = "rgba(255,255,255,0.04)";
const TEXT    = "#F2F2F2";
const SUB     = "#A0A0A0";
const MUTED   = "#606060";
const DIM     = "#404040";
const SIDEBAR_W = 248;

const STATUS_COLORS: Record<string, string> = {
  "בעבודה":      "#3B82F6",
  "מחכה למיקס":  "#F59E0B",
  "במיקס":       "#A855F7",
  "הושלם":       "#10B981",
  "בהשהייה":     "#6B7280",
  "לא התחיל":    "#374151",
};

function statusColor(s: string) { return STATUS_COLORS[s] ?? "#6B7280"; }

function formatDl(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "long" });
}

// ── Nav ───────────────────────────────────────────────────────────────────

const NAV = [
  { label: "דשבורד",    icon: "⊞",  color: "#38BDF8", active: true,  href: "/dashboard"  },
  { label: "פרויקטים",  icon: "♫",  color: "#60A5FA", active: false, href: "/projects"   },
  { label: "סושיאל",    icon: "📱", color: "#EC4899", active: false, href: "/social"     },
  { label: "לקוחות",    icon: "☆",  color: "#C084FC", active: false, href: "/clients"    },
  { label: "משימות",    icon: "✓",  color: "#F59E0B", active: false, href: "/tasks"      },
  { label: "צוות",      icon: "👥", color: "#A855F7", active: false, href: "/team"       },
  { label: "הופעות",    icon: "🎤", color: "#F472B6", active: false, href: "/shows"      },
  { label: "Red Films", icon: "🎬", color: "#EF4444", active: false, href: "/red-films"  },
  { label: "כספים",     icon: "₪",  color: "#34D399", active: false, href: "/finance"    },
  { label: "תובנות",    icon: "◎",  color: "#2DD4BF", active: false, href: "/insights"   },
];

const NAV2 = [
  { label: "יומן",    icon: "📅", badge: undefined as number | undefined, href: "/setup/calendar" },
  { label: "Dropbox", icon: "📦", badge: undefined as number | undefined, href: "/setup/dropbox"  },
  { label: "דוחות",   icon: "📊", badge: undefined as number | undefined, href: "/setup/reports"  },
  { label: "התראות",  icon: "🔔", badge: 3 as number | undefined,         href: "/insights"       },
  { label: "ספקים",   icon: "🤝", badge: undefined as number | undefined, href: "/clients"        },
];

// ── Dummy Calendar / Focus / Alerts (Phase Live-2 will connect these) ─────

const CAL = [
  { time: "11:00–14:00", title: "סשן הקלטות — אלבום חדש",       sub: "אולפן A",     av: "YN", dot: "#A855F7", today: true  },
  { time: "16:00–15:00", title: "פגישת הפקה — קליפ חדש",        sub: "Zoom",         av: "RB", dot: "#10B981", today: true  },
  { time: "כל היום",     title: "שחרור סינגל — כל הפלטפורמות", sub: "",             av: "MA", dot: "#EC4899", today: true  },
  { time: "12:00–13:00", title: "פגישת צוות — הפקת EP",         sub: "חדר ישיבות",  av: "OM", dot: "#10B981", today: false },
];

const FOCUS = [
  { title: "אישור תשלום חסר",  sub: 'פרויקט "אלבום חדש" — מתן', ago: "לפני 20 דק׳", icon: "$",  iconBg: "rgba(16,185,129,0.15)",  iconColor: "#10B981" },
  { title: "סשן הקלטות היום",   sub: "11:00 | אולפן A",           ago: "לפני 45 דק׳", icon: "🎙", iconBg: "rgba(168,85,247,0.15)", iconColor: "#A855F7" },
  { title: "הצעה מחכה לאישור", sub: "הצעה #1042 — יוסי כהן",     ago: "לפני שעה",    icon: "📋", iconBg: "rgba(59,130,246,0.15)", iconColor: "#3B82F6" },
];

const ALERTS = [
  { count: 9, label: "דדליינים עברו",  icon: "📅", color: "#EF4444", bg: "rgba(239,68,68,0.07)"  },
  { count: 4, label: "תשלומים ממתינים", icon: "$",  color: "#10B981", bg: "rgba(16,185,129,0.07)" },
  { count: 3, label: "סשנים מתוזמנים", icon: "🎙", color: "#EC4899", bg: "rgba(236,72,153,0.07)" },
  { count: 1, label: "אישורים ממתינים",  icon: "📋", color: "#A855F7", bg: "rgba(168,85,247,0.07)" },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function Av({ t, size = 30 }: { t: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg,#2A2A2A,#1A1A1A)",
      border: "1px solid rgba(255,255,255,0.1)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, color: SUB,
    }}>{t}</div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span style={{
      width: 7, height: 7, borderRadius: "50%", background: color,
      display: "inline-block", flexShrink: 0,
      boxShadow: `0 0 6px ${color}99`,
    }} />
  );
}

// ── RR Logo SVG ───────────────────────────────────────────────────────────

function RRMark({ size = 60 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 60 60"
      fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0, filter: "drop-shadow(0 0 10px rgba(220,38,38,0.7)) drop-shadow(0 0 24px rgba(220,38,38,0.35))" }}
    >
      <line x1="8"  y1="12" x2="8"  y2="48" stroke={BRAND} strokeWidth="3.5" strokeLinecap="round"/>
      <path d="M8 12 Q8 12 18 12 Q26 12 26 20 Q26 28 18 28 L8 28" stroke={BRAND} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <line x1="17" y1="28" x2="27" y2="48" stroke={BRAND} strokeWidth="3" strokeLinecap="round"/>
      <line x1="33" y1="12" x2="33" y2="48" stroke={BRAND} strokeWidth="3.5" strokeLinecap="round"/>
      <path d="M33 12 Q33 12 43 12 Q51 12 51 20 Q51 28 43 28 L33 28" stroke={BRAND} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <line x1="42" y1="28" x2="52" y2="48" stroke={BRAND} strokeWidth="3" strokeLinecap="round"/>
    </svg>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────

function KpiCard({ label, count, sub, color, icon, iconBg }: {
  label: string; count: number; sub: string; color: string; icon: string; iconBg: string;
}) {
  return (
    <div style={{
      background: "#1C1C1C", border: `1px solid rgba(255,255,255,0.09)`, borderRadius: 16,
      padding: "18px 15px 14px", minHeight: 140,
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      boxShadow: `0 2px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px ${color}11`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, background: iconBg,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 17, border: `1px solid ${color}30`, boxShadow: `0 0 8px ${color}22`,
        }}>{icon}</div>
        <span style={{
          fontSize: 10, fontWeight: 700, color: "#888",
          textTransform: "uppercase", letterSpacing: "0.07em",
          lineHeight: 1.4, textAlign: "right", maxWidth: "52%",
        }}>{label}</span>
      </div>
      <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, color }}>{count}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {sub && <Dot color={color} />}
        <span style={{ fontSize: 10, color: sub ? "#707070" : "transparent" }}>{sub || "—"}</span>
      </div>
    </div>
  );
}

// ── SVG Icons ────────────────────────────────────────────────────────────

function PlayIcon({ size = 10, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 12" fill={color} style={{ display: "block" }}>
      <path d="M1 1L9 6L1 11V1Z" />
    </svg>
  );
}

function PauseIcon({ size = 10, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 12" fill={color} style={{ display: "block" }}>
      <rect x="1" y="0" width="3.2" height="12" rx="1" />
      <rect x="5.8" y="0" width="3.2" height="12" rx="1" />
    </svg>
  );
}

// ── Play Button (visual-only, disabled) ───────────────────────────────────

function PlayBtn({ color = BRAND }: { color?: string }) {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "default",
    }}>
      <PlayIcon size={8} color={MUTED} />
    </div>
  );
}

// ── Project Play Button (live) ────────────────────────────────────────────

function ProjectPlayBtn({ p, player, color = BRAND, size = 28 }: {
  p: Project;
  player: ReturnType<typeof usePlayerSafe>;
  color?: string;
  size?: number;
}) {
  const latestAudio = getLatestAudioFile(p.files ?? []);
  if (!latestAudio || !player) {
    return <div style={{ width: size, height: size, flexShrink: 0 }} />;
  }
  const isLoaded  = player.track?.projectId === p.id;
  const isPlaying = isLoaded && player.playing;
  const iconSize  = size <= 28 ? 9 : 13;
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: isLoaded ? `${color}22` : "rgba(255,255,255,0.07)",
        border: `1px solid ${isLoaded ? `${color}66` : "rgba(255,255,255,0.14)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer",
        boxShadow: isLoaded ? `0 0 ${size < 36 ? 8 : 14}px ${color}55` : "none",
        transition: "all 0.15s",
      }}
      onClick={async (e) => {
        e.stopPropagation();
        if (isLoaded) {
          isPlaying ? player.pause() : player.resume();
        } else {
          const url = await getFreshPlayUrl(latestAudio);
          player.play({ projectId: p.id, projectName: p.name, artist: p.artist ?? "", fileName: latestAudio.name, url });
        }
      }}
      title={isPlaying ? "השהה" : latestAudio.name}
    >
      {isPlaying
        ? <PauseIcon size={iconSize} color={isLoaded ? color : "#999"} />
        : <PlayIcon  size={iconSize} color={isLoaded ? color : "#999"} />
      }
    </div>
  );
}

// ── Dashboard Player Bar ──────────────────────────────────────────────────

function fmt(s: number): string {
  if (!isFinite(s) || isNaN(s)) return "0:00";
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
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

function DashboardPlayerBar({
  player,
  isMobile,
}: {
  player: NonNullable<ReturnType<typeof usePlayerSafe>>;
  isMobile: boolean;
}) {
  const { track, playing, currentTime, duration, volume, pause, resume, stop, seek, skip, setVolume } = player;
  if (!track) return null;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const canPlay  = track.url !== "#" && track.url !== "";

  // ── Mobile compact — fixed above MobileNav ──────────────────────────────
  if (isMobile) {
    return (
      <div style={{
        position: "fixed",
        bottom: "calc(56px + env(safe-area-inset-bottom))",
        left: 0, right: 0, zIndex: 145,
        background: "#141414",
        borderTop: `1px solid rgba(220,38,38,0.4)`,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        boxShadow: "0 -6px 24px rgba(0,0,0,0.6), 0 -2px 12px rgba(220,38,38,0.12)",
        padding: "8px 16px 10px",
        direction: "rtl",
      }}>
        {/* Top row: waveform + name/artist + play + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <WaveformBars playing={playing} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#F0F0F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.projectName}</div>
            <div style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.artist}</div>
          </div>
          <button
            onClick={canPlay ? (playing ? pause : resume) : undefined}
            style={{
              width: 40, height: 40, borderRadius: "50%", border: "none", flexShrink: 0,
              background: canPlay ? BRAND : "#333", color: "#fff", fontSize: 17,
              cursor: canPlay ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: canPlay ? "0 0 18px rgba(220,38,38,0.6)" : "none",
            }}
          >{playing ? <PauseIcon size={16} color="#fff" /> : <PlayIcon size={16} color="#fff" />}</button>
          <button onClick={stop} style={{ background: "none", border: "none", cursor: "pointer", color: "#555", fontSize: 22, flexShrink: 0, padding: "0 2px" }}>×</button>
        </div>
        {/* Progress bar */}
        <div
          style={{ marginTop: 8, height: 3, background: "#2A2A2A", borderRadius: 2, cursor: "pointer", position: "relative" }}
          onClick={e => {
            if (!duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - rect.left) / rect.width) * duration);
          }}
        >
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${progress}%`, background: BRAND, borderRadius: 2,
            transition: "width 0.1s linear",
          }} />
        </div>
      </div>
    );
  }

  // ── Desktop — floating centered card ───────────────────────────────────
  return (
    /* Outer centering shell */
    <div style={{
      position: "fixed", bottom: 18, left: 0, right: 0, zIndex: 150,
      display: "flex", justifyContent: "center",
      padding: "0 20px",
      pointerEvents: "none",
    }}>
      {/* Player card */}
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

        {/* RIGHT section: waveform + track info (rightmost in LTR = rendered last; swap to first for RTL feel) */}
        <div dir="rtl" style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, minWidth: 0, maxWidth: 220 }}>
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

        {/* CENTER: controls row + progress row */}
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
                color: "#fff", fontSize: 20, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: canPlay ? "0 0 28px rgba(220,38,38,0.65), 0 0 8px rgba(220,38,38,1)" : "none",
                transition: "box-shadow 0.2s",
              }}
            >{playing ? <PauseIcon size={16} color="#fff" /> : <PlayIcon size={16} color="#fff" />}</button>
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

        {/* LEFT section: volume + download + close */}
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
          />
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

// ── Sidebar ───────────────────────────────────────────────────────────────

function Sidebar() {
  return (
    <aside className="hidden md:flex" style={{
      width: SIDEBAR_W, flexShrink: 0,
      background: SURFACE, borderLeft: `1px solid ${BORDER}`,
      flexDirection: "column", overflowY: "auto",
    }}>
      <div style={{
        padding: "24px 20px 22px", borderBottom: `1px solid rgba(255,255,255,0.08)`,
        background: "linear-gradient(180deg, rgba(220,38,38,0.07) 0%, rgba(220,38,38,0.01) 100%)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <RRMark size={64} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 19, fontWeight: 900, color: "#FFFFFF", letterSpacing: "-0.01em", lineHeight: 1.15, textShadow: "0 1px 8px rgba(0,0,0,0.5)" }}>Redbloods</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: BRAND, letterSpacing: "0.26em", textTransform: "uppercase", marginTop: 3, textShadow: `0 0 12px rgba(220,38,38,0.5)` }}>Records</div>
        </div>
      </div>
      <div style={{ padding: "16px 12px 6px", flex: 1 }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: DIM, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0 8px 10px" }}>ראשי</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV.map((n) => (
            <a key={n.label} href={n.href} style={{ position: "relative", borderRadius: 10, overflow: "hidden", display: "block", textDecoration: "none" }}>
              {n.active && (
                <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 3, background: BRAND, borderRadius: "0 2px 2px 0" }} />
              )}
              <div style={{
                display: "flex", alignItems: "center", gap: 11,
                padding: "10px 12px 10px 14px",
                background: n.active ? "linear-gradient(90deg,rgba(220,38,38,0.13),rgba(220,38,38,0.03))" : "transparent",
                border: `1px solid ${n.active ? "rgba(220,38,38,0.2)" : "transparent"}`,
                borderRadius: 10, cursor: "pointer",
                color: n.active ? BRAND : SUB,
                fontSize: 13.5, fontWeight: n.active ? 700 : 500,
              }}>
                <span style={{
                  width: 27, height: 27, borderRadius: 8, flexShrink: 0,
                  background: n.active ? "rgba(220,38,38,0.18)" : `${n.color}15`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, color: n.active ? BRAND : n.color,
                }}>{n.icon}</span>
                <span style={{ flex: 1 }}>{n.label}</span>
              </div>
            </a>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 1, background: BORDER2, margin: "0 4px 12px" }} />
          <div style={{ fontSize: 9, fontWeight: 800, color: DIM, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0 8px 10px" }}>כלים</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV2.map((n) => (
              <a key={n.label} href={n.href} style={{
                display: "flex", alignItems: "center", gap: 11,
                padding: "9px 12px 9px 14px", borderRadius: 10,
                color: MUTED, fontSize: 13.5, fontWeight: 500, cursor: "pointer",
                textDecoration: "none",
              }}>
                <span style={{ fontSize: 14, width: 27, textAlign: "center" }}>{n.icon}</span>
                <span style={{ flex: 1 }}>{n.label}</span>
                {n.badge && (
                  <span style={{ fontSize: 9, fontWeight: 800, background: BRAND, color: "#fff", borderRadius: 99, padding: "2px 7px", boxShadow: "0 0 6px rgba(220,38,38,0.5)" }}>{n.badge}</span>
                )}
              </a>
            ))}
          </div>
        </div>
      </div>
      <div style={{ padding: "14px 16px 18px", borderTop: `1px solid ${BORDER2}`, display: "flex", alignItems: "center", gap: 10 }}>
        <Av t="RB" size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Redbloods Admin</div>
          <div style={{ fontSize: 10, color: MUTED }}>מנהל מערכת</div>
        </div>
        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.3)", color: BRAND, fontWeight: 900, letterSpacing: "0.04em" }}>PRO</span>
      </div>
    </aside>
  );
}

// ── Main export ───────────────────────────────────────────────────────────

export default function DashboardDesignPreview() {
  const { projects, loading } = useProjects();

  // ── Live-2: real alerts, calendar, proposals ──────────────────────────
  const [alerts, setAlerts]             = useState<AgentAlert[]>([]);
  const [calToday, setCalToday]         = useState<CalEvent[]>([]);
  const [calTomorrow, setCalTomorrow]   = useState<CalEvent[]>([]);
  const [calConnected, setCalConnected] = useState<boolean | null>(null);
  const [openProposals, setOpenProposals] = useState<number | null>(null);

  // ── Live-3: payments, sessions, tasks (read-only counts) ──────────────
  const [pendingPayments, setPendingPayments] = useState<number | null>(null);
  const [upcomingSessions, setUpcomingSessions] = useState<number | null>(null);
  const [openTasks, setOpenTasks] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/agent/alerts?status=new&limit=50")
      .then(r => r.json())
      .then(d => setAlerts(Array.isArray(d.alerts) ? d.alerts : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/calendar/events")
      .then(r => r.json())
      .then(d => {
        setCalConnected(d.error !== "not_connected");
        setCalToday(Array.isArray(d.today) ? d.today : []);
        setCalTomorrow(Array.isArray(d.week) ? d.week : []);
      })
      .catch(() => setCalConnected(false));
  }, []);

  useEffect(() => {
    fetch("/api/proposals/all")
      .then(r => r.json())
      .then(d => {
        const all = Array.isArray(d.proposals) ? d.proposals : [];
        setOpenProposals(all.filter((p: { status: string }) => !CLOSED_PROPOSAL.has(p.status)).length);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/transactions?all=1")
      .then(r => r.json())
      .then(d => {
        const txs = Array.isArray(d.transactions) ? d.transactions : [];
        setPendingPayments(txs.filter((t: { payment_status?: string; type?: string }) =>
          t.type === "income" && t.payment_status !== "שולם"
        ).length);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/sessions?all=1")
      .then(r => r.json())
      .then(d => {
        const sessions = Array.isArray(d.sessions) ? d.sessions : [];
        setUpcomingSessions(sessions.filter((s: { status?: string }) => s.status === "מתוכנן").length);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/tasks?status=פתוח")
      .then(r => r.json())
      .then(d => {
        const tasks = Array.isArray(d.tasks) ? d.tasks : [];
        setOpenTasks(tasks.length);
      })
      .catch(() => {});
  }, []);

  // ── Real KPI filters ──────────────────────────────────────────────────
  const overdueProjects = projects.filter(p => p.isOverdue && p.status !== "הושלם" && p.status !== "בהשהייה");
  const activeProjects  = projects.filter(p => ["בעבודה", "מחכה למיקס", "במיקס"].includes(p.status));
  const dueSoonProjects = projects.filter(p => { const d = daysUntilDeadline(p.deadline); return d !== null && d >= 0 && d <= 7 && p.status !== "הושלם"; });
  const onHoldProjects  = projects.filter(p => p.status === "בהשהייה");
  const doneProjects    = projects.filter(p => p.status === "הושלם");

  // ── KPI cards (real counts for projects; dummy for tasks/payments/proposals/sessions) ──
  const KPI = [
    { label: "פרויקטים",    count: loading ? 0 : projects.length,          sub: `${activeProjects.length} פעילים`,         color: "#3B82F6", iconBg: "rgba(59,130,246,0.15)",  icon: "▶"  },
    { label: "הושלמו",      count: loading ? 0 : doneProjects.length,       sub: "הושלמו",                                   color: "#10B981", iconBg: "rgba(16,185,129,0.15)",  icon: "✓"  },
    { label: "בהשהייה",     count: loading ? 0 : onHoldProjects.length,     sub: "צריך מעקב",                               color: "#6B7280", iconBg: "rgba(107,114,128,0.15)", icon: "⏸" },
    { label: "משימות",      count: openTasks ?? 0,                           sub: openTasks !== null ? "פתוחות" : "...",     color: "#EF4444", iconBg: "rgba(239,68,68,0.15)",   icon: "☑"  },
    { label: "תשלומים",     count: pendingPayments ?? 0,                     sub: pendingPayments !== null ? "ממתינים" : "...", color: "#10B981", iconBg: "rgba(16,185,129,0.15)", icon: "$"  },
    { label: "הצעות",       count: openProposals ?? 0,                       sub: openProposals !== null ? "פתוחות" : "...", color: "#A855F7", iconBg: "rgba(168,85,247,0.15)",  icon: "📋" },
    { label: "עברו דדליין", count: loading ? 0 : overdueProjects.length,    sub: "דורש טיפול",                             color: "#EF4444", iconBg: "rgba(239,68,68,0.15)",   icon: "⚠"  },
    { label: "פעילים",      count: loading ? 0 : activeProjects.length,     sub: projects.length > 0 ? `${Math.round(activeProjects.length / projects.length * 100)}% מהפרויקטים` : "", color: "#3B82F6", iconBg: "rgba(59,130,246,0.15)", icon: "⚡" },
    { label: "סשנים",       count: upcomingSessions ?? 0,                   sub: upcomingSessions !== null ? "מתוכננים" : "...", color: "#EC4899", iconBg: "rgba(236,72,153,0.15)", icon: "🎙" },
  ];

  // Show up to 10 real projects; fall back to an empty list while loading
  const visibleProjects: Project[] = loading ? [] : projects.filter(p => p.status !== "הושלם").slice(0, 10);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "לילה טוב" : hour < 12 ? "בוקר טוב" : hour < 17 ? "צהריים טובים" : "ערב טוב";

  const { openProject } = useGlobalProjectDrawer();
  const player = usePlayerSafe();
  const radio  = useRadioSafe();

  const [isMobile, setIsMobile] = useState(false);
  useLayoutEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, background: BG, color: TEXT,
      fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      display: "flex", flexDirection: "column",
    }}>
      {/* ── Inner row: sidebar + main ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {!isMobile && <Sidebar />}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

        {/* ── Top bar ── */}
        <header style={{
          height: 60, flexShrink: 0,
          background: SURFACE, borderBottom: `1px solid ${BORDER}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 14px", position: "sticky", top: 0, zIndex: 40,
        }}>
          {/* Mobile — CSS hidden on desktop (no JS flash) */}
          <div className="flex md:hidden" style={{ width: "100%", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
            <JahknoRadioPlayer playerOffset={0} sidebarWidth={0} />
            <div style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              textAlign: "center",
              lineHeight: 1.15,
              pointerEvents: "none",
            }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: "#fff", letterSpacing: "-0.01em" }}>Redbloods</div>
              <div style={{ fontSize: 8, fontWeight: 800, color: BRAND, letterSpacing: "0.22em", textTransform: "uppercase" }}>Records</div>
            </div>
            <button style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px 5px 12px", borderRadius: 100,
              fontSize: 11, fontWeight: 700,
              background: BRAND,
              border: "1px solid rgba(220,38,38,0.5)",
              color: "#fff", cursor: "pointer",
              outline: "none",
              WebkitTapHighlightColor: "transparent",
              transition: "none",
              boxShadow: "none",
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
            }}>
              <span style={{ fontSize: 11 }}>⚡</span>
              פעולות
              <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
            </button>
          </div>

          {/* Desktop — CSS hidden on mobile (no JS flash) */}
          <div className="hidden md:flex" style={{ width: "100%", alignItems: "center", justifyContent: "space-between" }}>
            <JahknoRadioPlayer playerOffset={0} sidebarWidth={224} />
            <button style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 20px", borderRadius: 10,
              fontSize: 13, fontWeight: 700,
              background: BRAND,
              border: "none",
              color: "#fff", cursor: "pointer",
              outline: "none",
              WebkitTapHighlightColor: "transparent",
              transition: "none",
              boxShadow: "0 2px 14px rgba(220,38,38,0.45)",
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
            }}>
              <span style={{ fontSize: 13 }}>⚡</span>
              פעולות מהירות
              <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
            </button>
          </div>
        </header>

        {/* ── Page content ── */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: isMobile ? "16px 14px" : "28px 32px",
          paddingBottom: isMobile
            ? ((player?.track || radio?.playing || radio?.loading) ? "calc(56px + env(safe-area-inset-bottom) + 74px)" : "calc(56px + env(safe-area-inset-bottom))")
            : (player?.track ? 112 : 32),
        }}>

          {/* ── Hero header ── */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <h1 style={{ fontSize: isMobile ? 30 : 42, fontWeight: 900, color: TEXT, margin: 0, lineHeight: 1, letterSpacing: "-0.03em" }}>{greeting}</h1>
                <span style={{ fontSize: 26, lineHeight: 1 }}>✦</span>
              </div>
              <p style={{ fontSize: 14, color: MUTED, margin: "0 0 14px", fontWeight: 500 }}>
                {new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
              </p>
              {!loading && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {overdueProjects.length > 0 && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 99,
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444",
                    }}><Dot color="#EF4444" /> {overdueProjects.length} פרויקטים עברו דדליין</span>
                  )}
                  {activeProjects.length > 0 && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 99,
                      background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.18)", color: "#3B82F6",
                    }}><Dot color="#3B82F6" /> {activeProjects.length} פרויקטים בעבודה פעילה</span>
                  )}
                  {overdueProjects.length === 0 && activeProjects.length === 0 && (
                    <span style={{ fontSize: 13, color: MUTED }}>הכל תחת שליטה 🎵</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── KPI grid ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(9, 1fr)", gap: isMobile ? 8 : 11, marginBottom: 26 }}>
            {KPI.map((k) => <KpiCard key={k.label} {...k} />)}
          </div>

          {/* ── Middle 3 cards ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: isMobile ? 12 : 18, marginBottom: 26 }}>

            {/* Agent alerts (dummy) */}
            <div style={{
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{ height: 3, background: `linear-gradient(90deg, ${BRAND}, #F97316)` }} />
              {(() => {
                const cats = ALERT_CATEGORIES.map(c => ({
                  ...c,
                  count: alerts.filter(a => (c.types as readonly string[]).includes(a.type)).length,
                })).filter(c => c.count > 0);
                const urgentCount = alerts.filter(a => a.severity === "urgent" || a.severity === "important").length;
                return (
                  <>
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "16px 20px 12px", borderBottom: `1px solid rgba(255,255,255,0.07)`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 16 }}>🔔</span>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: "#F0F0F0" }}>התראות סוכן</span>
                      </div>
                      {alerts.length > 0 ? (
                        <span style={{ fontSize: 10, fontWeight: 900, background: BRAND, color: "#fff", borderRadius: 99, padding: "2px 8px", boxShadow: "0 0 8px rgba(220,38,38,0.4)" }}>
                          {alerts.length}
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, color: DIM }}>אין</span>
                      )}
                    </div>
                    <div style={{ padding: "12px 16px", flex: 1 }}>
                      {cats.length > 0 ? cats.map((a, i) => (
                        <div key={i} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "10px 12px", borderRadius: 11, marginBottom: 7,
                          background: a.bg, border: `1px solid ${a.color}20`,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <span style={{ fontSize: 17 }}>{a.icon}</span>
                            <span style={{ fontSize: 12.5, color: "#C8C8C8", fontWeight: 600 }}>{a.label}</span>
                          </div>
                          <span style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.04em", color: a.color, lineHeight: 1 }}>{a.count}</span>
                        </div>
                      )) : (
                        <div style={{ fontSize: 12, color: MUTED, textAlign: "center", paddingTop: 16 }}>
                          {alerts.length === 0 ? "✅ אין התראות פתוחות" : "טוען..."}
                        </div>
                      )}
                    </div>
                    <div style={{ padding: "10px 20px 14px", borderTop: `1px solid ${BORDER2}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "#3B82F6" }}>הצג את כל ההתראות ←</span>
                      {urgentCount > 0 && <span style={{ fontSize: 10, color: "#EF4444", fontWeight: 700 }}>{urgentCount} דחופות</span>}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Daily focus (dummy) */}
            <div style={{
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "18px 22px 14px", borderBottom: `1px solid rgba(255,255,255,0.07)`,
                background: "rgba(255,255,255,0.015)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>⚙</span>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: "#F0F0F0" }}>מוקד יומי</span>
                </div>
                <span style={{
                  fontSize: 10, padding: "3px 10px", borderRadius: 99,
                  background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)",
                  color: "#EF4444", fontWeight: 800,
                }}>3 דחופים</span>
              </div>
              {(() => {
                // Build focus items from real data — read-only, no AI
                type FocusItem = { icon: string; iconBg: string; iconColor: string; title: string; sub: string; };
                const focusItems: FocusItem[] = [];
                // 1. Most overdue project
                const mostOverdue = overdueProjects.sort((a, b) => {
                  const da = daysUntilDeadline(a.deadline) ?? 0;
                  const db = daysUntilDeadline(b.deadline) ?? 0;
                  return da - db;
                })[0];
                if (mostOverdue) focusItems.push({
                  icon: "📅", iconBg: "rgba(239,68,68,0.15)", iconColor: "#EF4444",
                  title: `דדליין עבר — ${mostOverdue.name}`,
                  sub: mostOverdue.artist || "ללא אמן",
                });
                // 2. Next calendar event today
                const nextEvent = calToday[0];
                if (nextEvent) focusItems.push({
                  icon: "🎙", iconBg: "rgba(168,85,247,0.15)", iconColor: "#A855F7",
                  title: nextEvent.title,
                  sub: nextEvent.isAllDay ? "כל היום" : (nextEvent.startTime ? new Date(nextEvent.startTime).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : ""),
                });
                // 3. Top urgent alert
                const topAlert = [...alerts].sort((a, b) => {
                  const w: Record<string, number> = { urgent: 4, important: 3, warning: 2, info: 1 };
                  return (w[b.severity] ?? 0) - (w[a.severity] ?? 0);
                })[0];
                if (topAlert) focusItems.push({
                  icon: "🔔", iconBg: "rgba(59,130,246,0.15)", iconColor: "#3B82F6",
                  title: topAlert.title,
                  sub: topAlert.message?.slice(0, 60) || "",
                });
                return (
                  <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                    {focusItems.length > 0 ? focusItems.map((f, i) => (
                      <div key={i} style={{ background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 13, padding: "13px 14px", boxShadow: "0 1px 6px rgba(0,0,0,0.3)" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 9, background: f.iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: f.iconColor, flexShrink: 0 }}>{f.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#DEDEDE", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.title}</div>
                            <div style={{ fontSize: 11, color: MUTED }}>{f.sub}</div>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <div style={{ fontSize: 12, color: MUTED, textAlign: "center", paddingTop: 20 }}>✅ אין פריטים דחופים</div>
                    )}
                  </div>
                );
              })()}
              <div style={{ padding: "10px 22px 14px", borderTop: `1px solid ${BORDER2}` }}>
                <span style={{ fontSize: 10, color: DIM }}>מוקד יומי — נתונים אמיתיים</span>
              </div>
            </div>

            {/* Calendar (dummy) */}
            <div style={{
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "18px 22px 14px", borderBottom: `1px solid rgba(255,255,255,0.07)`,
                background: "rgba(255,255,255,0.015)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>📅</span>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: "#F0F0F0" }}>אירועים קרובים</span>
                </div>
                <span style={{ fontSize: 11, color: MUTED }}>הצג יומן ←</span>
              </div>
              {(() => {
                const TYPE_COLORS: Record<string, string> = {
                  "סשן": "#A855F7", "הקלטות": "#A855F7", "חזרה": "#3B82F6",
                  "הופעה": "#EC4899", "סאונדצ'ק": "#F97316", "פגישה": "#10B981", "אחר": "#6B7280",
                };
                const evColor = (type: string) => TYPE_COLORS[type] ?? "#6B7280";
                const fmtTime = (ev: CalEvent) => {
                  if (ev.isAllDay) return "כל היום";
                  const t = (iso: string) => iso ? new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : "";
                  return `${t(ev.startTime)}${ev.endTime ? "–" + t(ev.endTime) : ""}`;
                };
                return (
                  <div style={{ padding: "0 20px 0", flex: 1 }}>
                    {calConnected === false ? (
                      <div style={{ fontSize: 12, color: MUTED, textAlign: "center", paddingTop: 24 }}>יומן לא מחובר</div>
                    ) : (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0 8px" }}>
                          <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 99, background: BRAND, color: "#fff" }}>היום</span>
                        </div>
                        {calToday.length === 0 ? (
                          <div style={{ fontSize: 11, color: MUTED, paddingBottom: 8 }}>אין אירועים היום</div>
                        ) : calToday.slice(0, 3).map((ev, i, arr) => (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: i < arr.length - 1 ? `1px solid ${BORDER2}` : "none" }}>
                            <Dot color={evColor(ev.type)} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginBottom: 2 }}>{fmtTime(ev)}</div>
                              <div style={{ fontSize: 12.5, color: "#E0E0E0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</div>
                              {ev.artist && <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{ev.artist}</div>}
                            </div>
                          </div>
                        ))}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0 8px" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: "rgba(255,255,255,0.06)", color: SUB }}>מחר</span>
                        </div>
                        {calTomorrow.length === 0 ? (
                          <div style={{ fontSize: 11, color: MUTED }}>אין אירועים מחר</div>
                        ) : calTomorrow.slice(0, 2).map((ev, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0" }}>
                            <Dot color={evColor(ev.type)} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginBottom: 2 }}>{fmtTime(ev)}</div>
                              <div style={{ fontSize: 12.5, color: "#C8C8C8", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                );
              })()}
              <div style={{ padding: "10px 22px 14px", borderTop: `1px solid ${BORDER2}` }}>
                <span style={{ fontSize: 10, color: DIM }}>יומן — נתונים אמיתיים</span>
              </div>
            </div>

          </div>

          {/* ── Projects section ── */}
          {/* Section header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
            padding: isMobile ? "0 2px" : "0",
          }}>
            <span style={{ fontSize: 18 }}>🎵</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>פרויקטים פעילים</span>
            {!loading && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 99,
                background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", color: "#3B82F6",
              }}>{projects.length} פרויקטים</span>
            )}
          </div>

          {/* ── Mobile: vertical cards ── */}
          {isMobile && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {loading && (
                <div style={{ padding: "32px", textAlign: "center", color: MUTED, fontSize: 13 }}>טוען פרויקטים...</div>
              )}
              {!loading && visibleProjects.length === 0 && (
                <div style={{ padding: "32px", textAlign: "center", color: MUTED, fontSize: 13 }}>אין פרויקטים פעילים</div>
              )}
              {visibleProjects.map((p) => {
                const days = daysUntilDeadline(p.deadline);
                const sc = statusColor(p.status);
                return (
                  <div key={p.id}
                    style={{
                      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16,
                      padding: "14px 16px",
                      boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
                      cursor: "pointer",
                    }}
                    onClick={() => openProject(p.id)}
                  >
                    {/* Row 1: name + status */}
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#F5F5F5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: p.artist ? "#606060" : "#404040", fontStyle: p.artist ? "normal" : "italic" }}>
                          {p.artist || "ללא אמן"}
                        </div>
                      </div>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
                        fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 99,
                        background: `${sc}18`, color: sc, border: `1px solid ${sc}35`,
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: sc, display: "inline-block" }} />
                        {p.status}
                      </span>
                    </div>
                    {/* Row 2: type + deadline */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 11, color: p.projectType ? "#888" : "#404040", fontStyle: p.projectType ? "normal" : "italic" }}>
                        {p.projectType || "לא הוגדר"}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{
                          fontSize: 11.5,
                          color: p.isOverdue ? "#EF4444" : days !== null && days <= 7 ? "#F97316" : p.deadline ? "#707070" : "#404040",
                          fontWeight: p.isOverdue || (days !== null && days <= 7) ? 700 : 400,
                          fontStyle: p.deadline ? "normal" : "italic",
                        }}>{p.deadline ? formatDl(p.deadline) : "אין דדליין"}</span>
                        {days !== null && (
                          <span style={{
                            fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 99,
                            background: p.isOverdue ? "rgba(239,68,68,0.12)" : days <= 7 ? "rgba(249,115,22,0.12)" : "rgba(255,255,255,0.04)",
                            color: p.isOverdue ? "#EF4444" : days <= 7 ? "#F97316" : SUB,
                            border: `1px solid ${p.isOverdue ? "rgba(239,68,68,0.25)" : days <= 7 ? "rgba(249,115,22,0.2)" : BORDER2}`,
                            whiteSpace: "nowrap",
                          }}>
                            {p.isOverdue ? `+${Math.abs(days)}` : days}d
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Row 3: play + dots */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER2}` }}>
                      <div onClick={e => e.stopPropagation()}><ProjectPlayBtn p={p} player={player} color={sc} size={40} /></div>
                      <span onClick={e => e.stopPropagation()} style={{ fontSize: 16, color: "#505050" }}>⋯</span>
                    </div>
                  </div>
                );
              })}
              {!loading && visibleProjects.length > 0 && (
                <div style={{ textAlign: "center", paddingTop: 4 }}>
                  <span style={{ fontSize: 11, color: DIM }}>מציג {visibleProjects.length} מתוך {projects.length} · read-only</span>
                </div>
              )}
            </div>
          )}

          {/* ── Desktop: table ── */}
          {!isMobile && (
          <div style={{
            background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}>
            {/* Column headers */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "36px 36px 2fr 1fr 1fr 1.2fr 100px 36px",
              padding: "9px 20px", borderBottom: `1px solid ${BORDER2}`,
              background: "rgba(255,255,255,0.015)",
              fontSize: 10, fontWeight: 800, color: "#505050",
              letterSpacing: "0.08em", textTransform: "uppercase",
              alignItems: "center", gap: 8,
            }}>
              <span></span>
              <span></span>
              <span>פרויקט</span>
              <span>סטטוס</span>
              <span>סוג</span>
              <span>עדכון אחרון</span>
              <span>תאריך יעד</span>
              <span></span>
            </div>

            {loading && (
              <div style={{ padding: "32px", textAlign: "center", color: MUTED, fontSize: 13 }}>טוען פרויקטים...</div>
            )}

            {!loading && visibleProjects.length === 0 && (
              <div style={{ padding: "32px", textAlign: "center", color: MUTED, fontSize: 13 }}>אין פרויקטים פעילים</div>
            )}

            {visibleProjects.map((p, i) => {
              const days = daysUntilDeadline(p.deadline);
              const sc = statusColor(p.status);
              return (
                <div
                  key={p.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 36px 2fr 1fr 1fr 1.2fr 100px 36px",
                    padding: "14px 20px", alignItems: "center", gap: 8,
                    borderBottom: i < visibleProjects.length - 1 ? `1px solid ${BORDER2}` : "none",
                    cursor: "pointer",
                  }}
                  onClick={() => openProject(p.id)}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                >
                  <div style={{ display: "flex", justifyContent: "center" }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 16, color: "#505050", letterSpacing: "0.05em" }}>⋯</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "center" }} onClick={e => e.stopPropagation()}>
                    <ProjectPlayBtn p={p} player={player} color={sc} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#F5F5F5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>{p.name}</div>
                    {p.artist ? (
                      <div style={{ fontSize: 11, color: "#606060", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.artist}</div>
                    ) : (
                      <div style={{ fontSize: 10.5, color: "#404040", fontStyle: "italic" }}>ללא אמן</div>
                    )}
                  </div>
                  <div>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 99,
                      background: `${sc}18`, color: sc, border: `1px solid ${sc}35`,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: sc, display: "inline-block" }} />
                      {p.status}
                    </span>
                  </div>
                  <span style={{ fontSize: 11.5, color: p.projectType ? "#888" : "#404040", fontStyle: p.projectType ? "normal" : "italic" }}>
                    {p.projectType || "לא הוגדר"}
                  </span>
                  <span style={{ fontSize: 11, color: p.updatedAt ? "#585858" : "#404040", fontStyle: p.updatedAt ? "normal" : "italic" }}>
                    {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString("he-IL", { day: "numeric", month: "short" }) : "לא עודכן"}
                  </span>
                  <span style={{
                    fontSize: 11.5,
                    color: p.isOverdue ? "#EF4444" : days !== null && days <= 7 ? "#F97316" : p.deadline ? "#707070" : "#404040",
                    fontWeight: p.isOverdue || (days !== null && days <= 7) ? 700 : 400,
                    fontStyle: p.deadline ? "normal" : "italic",
                  }}>{p.deadline ? formatDl(p.deadline) : "אין דדליין"}</span>
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {days !== null ? (
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 99,
                        background: p.isOverdue ? "rgba(239,68,68,0.12)" : days <= 7 ? "rgba(249,115,22,0.12)" : "rgba(255,255,255,0.04)",
                        color: p.isOverdue ? "#EF4444" : days <= 7 ? "#F97316" : SUB,
                        border: `1px solid ${p.isOverdue ? "rgba(239,68,68,0.25)" : days <= 7 ? "rgba(249,115,22,0.2)" : BORDER2}`,
                        whiteSpace: "nowrap",
                      }}>
                        {p.isOverdue ? `+${Math.abs(days)}` : days}d
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: DIM }}>—</span>
                    )}
                  </div>
                </div>
              );
            })}

            <div style={{
              padding: "13px 24px", borderTop: `1px solid ${BORDER2}`,
              background: "rgba(255,255,255,0.01)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 12, color: MUTED }}>מציג {visibleProjects.length} מתוך {projects.length}</span>
              <span style={{ fontSize: 11, color: DIM }}>read-only · live data</span>
            </div>
          </div>
          )}{/* ── end desktop table ── */}

          {/* Live badge */}
          <div style={{
            marginTop: 24, padding: "9px 16px", borderRadius: 10,
            background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.1)",
            fontSize: 11, color: DIM, textAlign: "center",
          }}>
            👁 /dashboard-preview — Live read-only · פרויקטים אמיתיים · Calendar / Alerts / מוקד = dummy עד Phase Live-2
          </div>

        </div>
      </div>
      </div>{/* ── end inner row ── */}
      <MobileNav />
      {player?.track && (
        <DashboardPlayerBar player={player} isMobile={isMobile} />
      )}
    </div>
  );
}
