"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import UploadButton from "@/components/ui/UploadButton";
import StatusDropdown from "@/components/ui/StatusDropdown";
import { deadlineLabel, daysUntilDeadline, getStatusColor } from "@/lib/utils";
import type { Project } from "@/lib/types";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  artists:   string[];
  onClose:   () => void;
}

// ── Local types ───────────────────────────────────────────────────────────────

type PaymentStatus = "שולם" | "התקבל" | "צפוי" | "לא שולם" | "חלקי" | "בוטל" | "לבדיקה";

interface Transaction {
  id:             string;
  type:           "income" | "expense";
  amount:         number;
  payment_status: PaymentStatus;
  description:    string;
}

interface Session {
  id:     string;
  date:   string | null;
  status: string;
}

// ── Tokens ────────────────────────────────────────────────────────────────────

const PANEL_BG   = "linear-gradient(160deg, #0B0B18 0%, #08080F 55%, #060609 100%)";
const HDR_BG     = "rgba(0,0,0,0.35)";
const CARD_BG    = "rgba(255,255,255,0.024)";
const CARD_BG2   = "rgba(255,255,255,0.04)";
const BORDER     = "rgba(255,255,255,0.07)";
const BORDER2    = "rgba(255,255,255,0.10)";
const PURPLE     = "#8B5CF6";
const PURPLE_S   = "#A78BFA";
const BLUE       = "#3B82F6";
const GREEN      = "#10B981";
const AMBER      = "#F59E0B";
const RED        = "#EF4444";
const TEXT       = "#F0F0FC";
const TEXT2      = "#B0B0CC";
const MUTED      = "#5A5A80";

const PROJECT_TABS = ["סקירה", "כספים", "סשנים", "קליפ", "קבצים", "פעולות"] as const;
type DrawerTab = typeof PROJECT_TABS[number];

const TAB_ICONS: Record<DrawerTab, string> = {
  "סקירה": "◈", "כספים": "₪", "סשנים": "◷",
  "קליפ": "▷", "קבצים": "⊞", "פעולות": "⚡",
};

// Deterministic waveform bars (40 bars)
const WAVE_H = [
  4,8,12,6,14,8,4,10,16,8,12,6,10,14,8,4,12,8,16,6,
  10,8,14,4,12,8,6,10,14,8,12,4,8,16,6,10,8,12,6,10,
];

function accentForType(t: string): string {
  if (t === "EP")     return "#A855F7";
  if (t === "אלבום") return "#EC4899";
  if (t === "קליפ")  return "#8B5CF6";
  return BLUE;
}

function progressForStatus(status: string): number {
  switch (status) {
    case "לא התחיל":    return 5;
    case "בעבודה":      return 30;
    case "מחכה למיקס": return 55;
    case "במיקס":       return 75;
    case "בהשהייה":    return 50;
    case "הושלם":       return 100;
    default:            return 20;
  }
}

// ── Arc progress SVG ──────────────────────────────────────────────────────────

function Arc({ pct, accent, size = 100 }: { pct: number; accent: string; size?: number }) {
  const r    = (size - 16) / 2;
  const cx   = size / 2;
  const cy   = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={9} />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke={accent} strokeWidth={9} strokeLinecap="round"
        strokeDasharray={`${dash} ${circ - dash}`}
        style={{ filter: `drop-shadow(0 0 5px ${accent}88)` }}
      />
    </svg>
  );
}

// ── Compact info row ──────────────────────────────────────────────────────────

function Row({ label, value, vc }: { label: string; value: string; vc?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "5px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 12,
    }}>
      <span style={{ color: MUTED }}>{label}</span>
      <span style={{ color: vc ?? TEXT2, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: CARD_BG, borderRadius: 14, padding: 16,
      border: `1px solid ${BORDER}`, ...style,
    }}>
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 800, color: MUTED,
      textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProjectDrawerV2({ projectId, onClose }: Props) {
  const { projects } = useProjects();
  const player = usePlayerSafe();

  const [isMobile,     setIsMobile]     = useState(false);
  const [activeTab,    setActiveTab]    = useState<DrawerTab>("סקירה");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [agreedPrice,  setAgreedPrice]  = useState(0);
  const [currency,     setCurrency]     = useState("₪");
  const [finLoaded,    setFinLoaded]    = useState(false);
  const [sessions,     setSessions]     = useState<Session[]>([]);
  const [mounted,      setMounted]      = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    setTransactions([]);
    setFinLoaded(false);
    fetch(`/api/transactions?projectId=${projectId}`)
      .then(r => r.json())
      .then(d => {
        setTransactions(d.transactions ?? []);
        setAgreedPrice(d.agreedPrice ?? 0);
        setCurrency(d.currency ?? "₪");
        setFinLoaded(true);
      })
      .catch(() => setFinLoaded(true));
  }, [projectId]);

  useEffect(() => {
    setSessions([]);
    fetch(`/api/sessions?projectId=${projectId}`)
      .then(r => r.json())
      .then(d => setSessions(d.sessions ?? []))
      .catch(() => {});
  }, [projectId]);

  const project = projects.find(p => p.id === projectId);
  if (!mounted || !project || isMobile) return null;

  // ── Derived values ─────────────────────────────────────────────────────────

  const accent      = accentForType(project.projectType);
  const days        = daysUntilDeadline(project.deadline);
  const dlLabel     = deadlineLabel(project.deadline);
  const dlColor     = days !== null && days < 0 ? RED
                    : days !== null && days <= 7 ? AMBER
                    : TEXT2;
  const received    = transactions
    .filter(t => t.type === "income" && ["התקבל","שולם"].includes(t.payment_status))
    .reduce((s, t) => s + t.amount, 0);
  const totalExp    = transactions
    .filter(t => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const balance     = agreedPrice - received;
  const latestFile  = project.files ? getLatestAudioFile(project.files) : null;
  const isPlaying   = player?.track?.projectId === projectId && (player?.playing ?? false);
  const pct         = progressForStatus(project.status);
  const filesCount  = project.files?.length ?? 0;
  const sessDone    = sessions.filter(s => s.status === "התקיים").length;
  const statusColor = getStatusColor(project.status);

  async function handlePlay() {
    if (!latestFile || !player) return;
    if (!project) return;
    if (isPlaying) {
      player.pause();
    } else if (player.track?.projectId === projectId) {
      player.resume();
    } else {
      const url = await getFreshPlayUrl(latestFile);
      player.play({
        projectId,
        projectName: project.name,
        artist: project.artist,
        fileName: latestFile.name,
        url,
      });
    }
  }

  // ── Panel ──────────────────────────────────────────────────────────────────

  return createPortal(
    <div dir="rtl" style={{ position: "fixed", inset: 0, zIndex: 99999 }}>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute", inset: 0,
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(6px)",
        }}
      />

      {/* Panel */}
      <div style={{
        position: "absolute", inset: 14,
        background: PANEL_BG,
        borderRadius: 22,
        zIndex: 100000,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        border: `1px solid rgba(139,92,246,0.28)`,
        boxShadow: [
          `0 0 0 1px rgba(139,92,246,0.08)`,
          `0 50px 120px rgba(0,0,0,0.95)`,
          `0 0 100px rgba(80,40,180,0.07)`,
        ].join(", "),
        animation: "v2-in 0.26s cubic-bezier(.32,.72,0,1) forwards",
      }}>
        <style>{`
          @keyframes v2-in {
            from { transform: scale(0.96) translateY(14px); opacity: 0; }
            to   { transform: scale(1)    translateY(0px);  opacity: 1; }
          }
        `}</style>

        {/* ═══ HEADER ════════════════════════════════════════════════════════ */}
        <div style={{
          background: HDR_BG,
          backdropFilter: "blur(12px)",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
          padding: "22px 28px 0",
        }}>

          {/* Top row (LTR for physical left=left layout): cover | info | player | close */}
          <div dir="ltr" style={{ display: "flex", gap: 20, marginBottom: 18, alignItems: "stretch" }}>

            {/* Cover art */}
            <div style={{
              width: 92, height: 92, borderRadius: 14, flexShrink: 0,
              background: `linear-gradient(145deg, #1C082E 0%, #0E081E 60%, #060610 100%)`,
              border: `1.5px solid ${accent}44`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 34, fontWeight: 900, color: accent,
              boxShadow: `0 0 28px ${accent}22, inset 0 0 20px rgba(0,0,0,0.4)`,
              letterSpacing: -1,
            }}>
              {project.name.charAt(0)}
            </div>

            {/* Project info (RTL inside) */}
            <div dir="rtl" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: TEXT, letterSpacing: -0.5, lineHeight: 1.15 }}>
                  {project.name}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 800, color: accent,
                  background: `${accent}18`, border: `1px solid ${accent}35`,
                  borderRadius: 6, padding: "3px 9px", flexShrink: 0, letterSpacing: "0.04em",
                }}>
                  {project.projectType || "שיר"}
                </span>
              </div>

              <div style={{ fontSize: 12, color: MUTED, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: MUTED }}>🎤</span>
                <span style={{ color: TEXT2 }}>{project.artist}</span>
              </div>

              {/* Stats row */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div onClick={e => e.stopPropagation()}>
                  <StatusDropdown projectId={project.id} status={project.status} small />
                </div>
                {project.deadline && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: dlColor,
                    background: `${dlColor}14`, border: `1px solid ${dlColor}30`,
                    borderRadius: 7, padding: "4px 10px", flexShrink: 0,
                  }}>
                    📅 {dlLabel}
                  </span>
                )}
                {finLoaded && balance > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: RED,
                    background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                    borderRadius: 7, padding: "4px 10px", flexShrink: 0,
                  }}>
                    יתרה {currency}{balance.toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            {/* Player card */}
            {latestFile && (
              <div style={{
                width: 260, flexShrink: 0,
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${BORDER2}`,
                borderRadius: 14, padding: "12px 16px",
                display: "flex", flexDirection: "column", justifyContent: "center", gap: 10,
              }}>
                <div dir="rtl" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Purple play button */}
                  <button
                    onClick={handlePlay}
                    style={{
                      width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                      background: isPlaying
                        ? `linear-gradient(135deg, ${PURPLE}, #6D28D9)`
                        : `linear-gradient(135deg, #3D1F6E, #2D1550)`,
                      border: `1.5px solid ${PURPLE}55`,
                      color: "#fff", cursor: "pointer", fontSize: 15,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "inherit",
                      boxShadow: isPlaying ? `0 0 20px ${PURPLE}66` : `0 0 12px rgba(109,40,217,0.3)`,
                    }}
                  >
                    {isPlaying ? "⏸" : "▶"}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {latestFile.name}
                    </div>
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                      {(latestFile as { versionLabel?: string }).versionLabel ?? "קובץ אחרון"}
                    </div>
                  </div>
                </div>
                {/* Waveform */}
                <svg width="100%" height="28" viewBox="0 0 228 28" preserveAspectRatio="none" style={{ opacity: 0.5 }}>
                  {WAVE_H.map((h, i) => (
                    <rect
                      key={i}
                      x={i * 5.7}
                      y={(28 - h) / 2}
                      width={3.2}
                      height={h}
                      fill={isPlaying ? PURPLE_S : MUTED}
                      rx={1.5}
                    />
                  ))}
                </svg>
              </div>
            )}

            {/* Controls (LTR: rightmost = right side of screen) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center", flexShrink: 0 }}>
              <Link
                href={`/projects/${projectId}`}
                target="_blank"
                style={{
                  fontSize: 11, color: TEXT2, textDecoration: "none",
                  border: `1px solid ${BORDER2}`,
                  borderRadius: 9, padding: "7px 12px",
                  display: "flex", alignItems: "center", gap: 5,
                  whiteSpace: "nowrap",
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                פתח עמוד מלא ↗
              </Link>
              <button
                onClick={onClose}
                style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${BORDER2}`,
                  color: TEXT2, cursor: "pointer", fontSize: 18,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "inherit",
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* ── Quick Actions ───────────────────────────────────────────────── */}
          <div dir="rtl" style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {([
              { label: "סשן חדש", icon: "📅", color: BLUE,  tab: "סשנים" as DrawerTab },
              { label: "תשלום",   icon: "₪",  color: GREEN, tab: "כספים" as DrawerTab },
              { label: "הוצאה",  icon: "⊖",  color: AMBER, tab: "כספים" as DrawerTab },
            ]).map(({ label, icon, color, tab }) => (
              <button
                key={label}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, height: 58, borderRadius: 14,
                  background: `${color}0C`, border: `1px solid ${color}28`,
                  color, cursor: "pointer", fontSize: 13, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  fontFamily: "inherit",
                  letterSpacing: "0.01em",
                  transition: "none",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = `${color}1C`;
                  e.currentTarget.style.border = `1px solid ${color}45`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = `${color}0C`;
                  e.currentTarget.style.border = `1px solid ${color}28`;
                }}
              >
                <span style={{ fontSize: 16 }}>{icon}</span>
                {label}
              </button>
            ))}
            {/* Upload */}
            <div style={{
              flex: 1, height: 58, borderRadius: 14,
              background: `${PURPLE}0C`, border: `1px solid ${PURPLE}28`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <UploadButton
                projectId={project.id}
                projectName={project.name}
                artist={project.artist}
                existingFiles={project.files}
                size="sm"
              />
            </div>
          </div>

          {/* ── Tabs ────────────────────────────────────────────────────────── */}
          <div dir="rtl" style={{ display: "flex", gap: 2, overflowX: "auto" }}>
            {PROJECT_TABS.map(tab => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "11px 20px",
                    borderRadius: "11px 11px 0 0",
                    border: "none",
                    background: active ? "rgba(255,255,255,0.05)" : "transparent",
                    color: active ? PURPLE_S : MUTED,
                    cursor: "pointer", fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    fontFamily: "inherit",
                    borderBottom: active ? `2.5px solid ${PURPLE}` : "2.5px solid transparent",
                    whiteSpace: "nowrap",
                    display: "flex", alignItems: "center", gap: 6,
                    transition: "none",
                    flexShrink: 0,
                    textShadow: active ? `0 0 20px ${PURPLE}88` : "none",
                  }}
                >
                  <span style={{ fontSize: 13 }}>{TAB_ICONS[tab]}</span>
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {/* ═══ CONTENT ═══════════════════════════════════════════════════════ */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 24px" }}>
          {activeTab === "סקירה" ? (
            <OverviewContent
              project={project}
              transactions={transactions}
              sessions={sessions}
              agreedPrice={agreedPrice}
              currency={currency}
              finLoaded={finLoaded}
              accent={accent}
              received={received}
              totalExp={totalExp}
              balance={balance}
              pct={pct}
              filesCount={filesCount}
              sessDone={sessDone}
              statusColor={statusColor}
              onTabChange={setActiveTab}
            />
          ) : (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", height: "100%", minHeight: 240, gap: 14, color: MUTED,
            }}>
              <span style={{ fontSize: 40, opacity: 0.4 }}>{TAB_ICONS[activeTab]}</span>
              <div style={{ fontSize: 15, fontWeight: 600, color: TEXT2 }}>
                טאב {activeTab}
              </div>
              <div style={{ fontSize: 12, color: MUTED, opacity: 0.7 }}>
                השתמש ב-ProjectDrawer הקיים לניהול מלא
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewContent({
  project, transactions, sessions,
  agreedPrice, currency, finLoaded, accent,
  received, totalExp, balance,
  pct, filesCount, sessDone, statusColor, onTabChange,
}: {
  project:     Project;
  transactions: Transaction[];
  sessions:    Session[];
  agreedPrice: number;
  currency:    string;
  finLoaded:   boolean;
  accent:      string;
  received:    number;
  totalExp:    number;
  balance:     number;
  pct:         number;
  filesCount:  number;
  sessDone:    number;
  statusColor: string;
  onTabChange: (t: DrawerTab) => void;
}) {
  const days = daysUntilDeadline(project.deadline);

  // RTL grid: col 1 = physical right, col 4 = physical left
  // We want: sidebar(200px) | progress | status | next-action
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 1fr 1fr", gridTemplateRows: "auto auto", gap: 14 }}>

      {/* ── Col 1, rows 1+2: Sidebar ─────────────────────────────────────── */}
      <div style={{ gridColumn: 1, gridRow: "1 / 3", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Quick links */}
        <Card>
          <CardTitle>פעולות מהירות</CardTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {([
              { icon: "📅", label: "סשנים", color: BLUE,   tab: "סשנים" as DrawerTab },
              { icon: "₪",  label: "כספים",  color: GREEN,  tab: "כספים" as DrawerTab },
              { icon: "📁", label: "קבצים",  color: PURPLE, tab: "קבצים" as DrawerTab },
              { icon: "⚡", label: "פעולות", color: AMBER,  tab: "פעולות" as DrawerTab },
            ]).map(({ icon, label, color, tab }) => (
              <button
                key={label}
                onClick={() => onTabChange(tab)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 10px", borderRadius: 9,
                  background: `${color}0A`, border: `1px solid ${color}20`,
                  color, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  fontFamily: "inherit", textAlign: "right", width: "100%",
                  transition: "none",
                }}
                onMouseEnter={e => e.currentTarget.style.background = `${color}18`}
                onMouseLeave={e => e.currentTarget.style.background = `${color}0A`}
              >
                <span style={{ fontSize: 14 }}>{icon}</span>{label}
              </button>
            ))}
          </div>
        </Card>

        {/* Team */}
        <Card style={{ flex: 1 }}>
          <CardTitle>צוות</CardTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { name: "ויקטור", role: "אחראי פרויקט" },
              { name: "איש סאונד", role: "מיקס / מאסטר" },
            ].map(({ name, role }) => (
              <div key={name} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "7px 10px", borderRadius: 9, background: CARD_BG2,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: TEXT2 }}>{name}</span>
                <span style={{ fontSize: 10, color: MUTED }}>{role}</span>
              </div>
            ))}
          </div>
          <button disabled style={{
            marginTop: 10, width: "100%", padding: "8px 10px", borderRadius: 9,
            background: "transparent", border: `1px solid ${BORDER2}`,
            color: MUTED, fontSize: 11, cursor: "not-allowed", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
          }}>
            + הוסף חבר צוות
          </button>
        </Card>
      </div>

      {/* ── Col 2, row 1: התקדמות כללית ────────────────────────────────── */}
      <Card style={{ gridColumn: 2, gridRow: 1 }}>
        <CardTitle>התקדמות כללית</CardTitle>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <Arc pct={pct} accent={accent} size={96} />
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)", textAlign: "center",
            }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: TEXT, letterSpacing: -1 }}>{pct}%</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: MUTED }}>{project.status}</div>
        </div>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: MUTED }}>סשנים שהתקיימו</span>
            <span style={{ color: TEXT2, fontWeight: 600 }}>{sessDone}/{sessions.length}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: MUTED }}>קבצים</span>
            <span style={{ color: TEXT2, fontWeight: 600 }}>{filesCount}</span>
          </div>
          {project.deadline && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ color: MUTED }}>ימים לדדליין</span>
              <span style={{
                color: days !== null && days < 0 ? RED : days !== null && days <= 7 ? AMBER : TEXT2,
                fontWeight: 600,
              }}>
                {days !== null ? (days < 0 ? `פג ${Math.abs(days)} ימים` : `${days} ימים`) : "—"}
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* ── Col 3, row 1: סטטוס פרויקט ─────────────────────────────────── */}
      <Card style={{ gridColumn: 3, gridRow: 1 }}>
        <CardTitle>סטטוס פרויקט</CardTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {([
            { label: "כספים",  icon: "₪",  val: finLoaded ? (transactions.length > 0 ? "✓ תקין" : "—") : "…", color: transactions.length > 0 ? GREEN : MUTED },
            { label: "סשנים",  icon: "◷",  val: sessions.length > 0 ? `${sessDone}/${sessions.length}` : "—", color: sessions.length > 0 ? BLUE : MUTED },
            { label: "קבצים",  icon: "⊞",  val: filesCount > 0 ? `${filesCount}` : "—", color: filesCount > 0 ? BLUE : MUTED },
            { label: "ויקטור", icon: "🎛️", val: "עדכן בפעולות", color: MUTED },
            { label: "מסירה",  icon: "📤", val: "לא הוגדר", color: MUTED },
          ]).map(({ label, icon, val, color }) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "7px 10px", borderRadius: 9,
              background: `${color}09`, border: `1px solid ${color}1E`,
            }}>
              <span style={{ fontSize: 11, color: MUTED }}>
                <span style={{ marginLeft: 5 }}>{icon}</span>{label}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color }}>{val}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Col 4, row 1: הפעולה הבאה ──────────────────────────────────── */}
      <Card style={{ gridColumn: 4, gridRow: 1 }}>
        <CardTitle>הפעולה הבאה</CardTitle>
        {sessions.length > 0 ? (() => {
          const next = sessions
            .filter(s => s.status !== "התקיים" && s.status !== "בוטל" && s.date)
            .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
            [0];
          return next ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{
                padding: "10px 12px", borderRadius: 10,
                background: `${BLUE}0C`, border: `1px solid ${BLUE}25`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: TEXT2, marginBottom: 4 }}>
                  📅 סשן מתוכנן
                </div>
                <div style={{ fontSize: 11, color: MUTED }}>
                  {next.date ? new Date(next.date).toLocaleDateString("he-IL") : "—"}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: MUTED, textAlign: "center", padding: "20px 0" }}>
              אין סשן מתוכנן
            </div>
          );
        })() : (
          <div style={{ fontSize: 12, color: MUTED, textAlign: "center", padding: "20px 0" }}>
            אין נתונים
          </div>
        )}
        {/* Next action suggestion */}
        <div style={{
          marginTop: 12, padding: "10px 12px", borderRadius: 10,
          background: `${PURPLE}0A`, border: `1px solid ${PURPLE}22`,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, marginBottom: 5 }}>הצעה</div>
          <div style={{ fontSize: 11, color: TEXT2, lineHeight: 1.5 }}>
            {project.status === "בעבודה" ? "זמן להוסיף סשן חדש" :
             project.status === "הושלם"  ? "הפרויקט הושלם בהצלחה ✓" :
             project.status === "במיקס"  ? "בדוק עדכונים ממהנדס הסאונד" :
             "עדכן את הסטטוס"}
          </div>
        </div>
      </Card>

      {/* ── Col 2, row 2: קבצים אחרונים ─────────────────────────────────── */}
      <Card style={{ gridColumn: 2, gridRow: 2 }}>
        <CardTitle>קבצים אחרונים</CardTitle>
        {project.files && project.files.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {project.files.slice(-4).reverse().map(f => (
              <div key={f.name} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 10px", borderRadius: 9, background: CARD_BG2,
              }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>
                  {f.name.toLowerCase().endsWith(".mp3") || f.name.toLowerCase().endsWith(".wav") ? "🎵" : "📄"}
                </span>
                <span style={{
                  fontSize: 11, color: TEXT2, fontWeight: 600,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                }}>
                  {f.name}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: MUTED, textAlign: "center", padding: "16px 0" }}>
            אין קבצים
          </div>
        )}
      </Card>

      {/* ── Col 3, row 2: סיכום כספי ────────────────────────────────────── */}
      <Card style={{ gridColumn: 3, gridRow: 2 }}>
        <CardTitle>סיכום כספי</CardTitle>
        {finLoaded ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 10px", borderRadius: 9, background: CARD_BG2,
            }}>
              <span style={{ fontSize: 12, color: MUTED }}>מחיר מוסכם</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{currency}{agreedPrice.toLocaleString()}</span>
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 10px", borderRadius: 9, background: `${GREEN}0A`, border: `1px solid ${GREEN}20`,
            }}>
              <span style={{ fontSize: 12, color: MUTED }}>ס״כ התקבל</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: GREEN }}>{currency}{received.toLocaleString()}</span>
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 10px", borderRadius: 9, background: `${AMBER}0A`, border: `1px solid ${AMBER}20`,
            }}>
              <span style={{ fontSize: 12, color: MUTED }}>ס״כ הוצאות</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: AMBER }}>{currency}{totalExp.toLocaleString()}</span>
            </div>
            {balance > 0 && (
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 10px", borderRadius: 9, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)",
              }}>
                <span style={{ fontSize: 12, color: RED }}>יתרה לגביה</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: RED }}>{currency}{balance.toLocaleString()}</span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: MUTED, textAlign: "center", padding: "16px 0" }}>טוען…</div>
        )}
      </Card>

      {/* ── Col 4, row 2: פרטים כלליים ──────────────────────────────────── */}
      <Card style={{ gridColumn: 4, gridRow: 2 }}>
        <CardTitle>פרטים כלליים</CardTitle>
        <Row label="סוג פרויקט" value={project.projectType || "—"} />
        <Row label="אמן" value={project.artist || "—"} />
        <Row
          label="תאריך התחלה"
          value={project.startDate ? new Date(project.startDate).toLocaleDateString("he-IL") : "—"}
        />
        <Row
          label="דדליין"
          value={project.deadline ? new Date(project.deadline).toLocaleDateString("he-IL") : "—"}
          vc={days !== null && days < 0 ? RED : days !== null && days <= 7 ? AMBER : undefined}
        />
        <Row label="שייך ל" value={project.parentProject || "—"} />
        {project.notes && (
          <div style={{
            marginTop: 10, padding: "8px 10px", background: CARD_BG2,
            borderRadius: 9, fontSize: 11, color: MUTED, lineHeight: 1.6,
          }}>
            {project.notes.slice(0, 120)}{project.notes.length > 120 ? "…" : ""}
          </div>
        )}
      </Card>

    </div>
  );
}
