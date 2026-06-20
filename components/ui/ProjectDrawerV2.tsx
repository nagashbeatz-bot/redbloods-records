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

interface Props {
  projectId: string;
  artists:   string[];
  onClose:   () => void;
}

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

// ─── Tokens ────────────────────────────────────────────────────────────────────
const PANEL_BG  = "linear-gradient(170deg, #0E0E12 0%, #0B0B0F 50%, #080808 100%)";
const HDR_BG    = "linear-gradient(180deg, rgba(5,2,2,0.72) 0%, rgba(8,4,4,0.50) 100%)";
const CARD_BG   = "rgba(255,255,255,0.034)";
const CARD_BG2  = "rgba(255,255,255,0.058)";
const BORDER    = "rgba(255,255,255,0.09)";
const BORDER2   = "rgba(255,255,255,0.14)";
const BRAND     = "#DC2626";
const BRAND_DIM = "rgba(220,38,38,0.13)";
const BLUE      = "#3B82F6";
const GREEN     = "#10B981";
const AMBER     = "#F59E0B";
const RED_WARN  = "#EF4444";
const TEXT      = "#F4F4F4";
const TEXT2     = "#A8A8B8";
const MUTED     = "#555568";

const PROJECT_TABS = ["סקירה", "כספים", "סשנים", "קליפ", "קבצים", "פעולות"] as const;
type DrawerTab = typeof PROJECT_TABS[number];

const TAB_ICONS: Record<DrawerTab, string> = {
  "סקירה": "◈", "כספים": "₪", "סשנים": "◷",
  "קליפ": "▷", "קבצים": "⊞", "פעולות": "⚡",
};

// Taller waveform bars for visual presence
const WAVE_H = [
  7,12,20,9,22,12,7,15,26,12,20,9,15,22,12,7,18,12,26,9,
  15,12,22,7,18,12,9,15,22,12,20,7,12,26,9,15,12,18,9,15,
];

function accentForType(t: string): string {
  if (t === "EP")     return "#A855F7";
  if (t === "אלבום") return "#EC4899";
  if (t === "קליפ")  return "#8B5CF6";
  return BRAND;
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

// ─── Arc ───────────────────────────────────────────────────────────────────────
function Arc({ pct, accent, size = 118 }: { pct: number; accent: string; size?: number }) {
  const r    = (size - 20) / 2;
  const cx   = size / 2;
  const cy   = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={11} />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke={accent} strokeWidth={11} strokeLinecap="round"
        strokeDasharray={`${dash} ${circ - dash}`}
        style={{ filter: `drop-shadow(0 0 9px ${accent}CC)` }}
      />
    </svg>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: CARD_BG, borderRadius: 18, padding: "22px 24px",
      border: `1px solid ${BORDER}`, display: "flex", flexDirection: "column",
      ...style,
    }}>
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, color: MUTED,
      textTransform: "uppercase", letterSpacing: "0.13em", marginBottom: 16,
    }}>
      {children}
    </div>
  );
}

// ─── Stat mini-card — standalone block with fixed height ───────────────────────
function StatCard({
  label, children, borderAccent,
}: {
  label: string;
  children: React.ReactNode;
  borderAccent?: string;
}) {
  return (
    <div style={{
      background: CARD_BG2,
      borderRadius: 16,
      border: `1px solid ${borderAccent ? borderAccent + "45" : BORDER2}`,
      padding: "16px 18px",
      minHeight: 82,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    }}>
      <div style={{
        fontSize: 10, fontWeight: 800, color: MUTED,
        textTransform: "uppercase", letterSpacing: "0.13em",
      }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
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

  const accent      = accentForType(project.projectType);
  const days        = daysUntilDeadline(project.deadline);
  const dlLabel     = deadlineLabel(project.deadline);
  const dlColor     = days !== null && days < 0 ? RED_WARN
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
      player.play({ projectId, projectName: project.name, artist: project.artist, fileName: latestFile.name, url });
    }
  }

  return createPortal(
    <div dir="rtl" style={{ position: "fixed", top: 60, bottom: 0, left: 0, right: 248, zIndex: 99999 }}>

      <div onClick={onClose} style={{
        position: "absolute", inset: 0,
        background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)",
      }} />

      <div style={{
        position: "absolute", inset: 10,
        background: PANEL_BG, borderRadius: 22, zIndex: 100000,
        display: "flex", flexDirection: "column", overflow: "hidden",
        border: `1px solid rgba(220,38,38,0.28)`,
        boxShadow: "0 0 0 1px rgba(220,38,38,0.09), 0 60px 140px rgba(0,0,0,0.97), 0 0 120px rgba(220,38,38,0.06)",
        animation: "v2-in 0.28s cubic-bezier(.32,.72,0,1) forwards",
      }}>

        <style>{`
          @keyframes v2-in {
            from { transform: scale(0.96) translateY(16px); opacity: 0; }
            to   { transform: scale(1)    translateY(0);    opacity: 1; }
          }
        `}</style>

        {/* ══════════════════════════════════════════════════════════════════
            HERO HEADER
        ══════════════════════════════════════════════════════════════════ */}
        <div style={{
          background: HDR_BG,
          backdropFilter: "blur(18px)",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
          padding: "28px 30px 0",
        }}>

          {/* LTR row: Artwork | Info+Stats | Player */}
          <div dir="ltr" style={{ display: "flex", gap: 26, marginBottom: 20, alignItems: "flex-start" }}>

            {/* ── Artwork 192×192 ── */}
            <div style={{
              width: 192, height: 192,
              borderRadius: 20, flexShrink: 0,
              background: `
                radial-gradient(ellipse at 25% 25%, rgba(220,38,38,0.30) 0%, transparent 55%),
                radial-gradient(ellipse at 75% 80%, rgba(139,0,0,0.18) 0%, transparent 50%),
                linear-gradient(145deg, #2E0A0A 0%, #1A0404 40%, #0C0202 75%, #060101 100%)
              `,
              border: `2px solid rgba(220,38,38,0.42)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: [
                `0 0 80px rgba(220,38,38,0.25)`,
                `0 0 30px rgba(220,38,38,0.14)`,
                `0 4px 40px rgba(0,0,0,0.8)`,
                `inset 0 0 50px rgba(0,0,0,0.55)`,
                `inset 0 1px 0 rgba(255,255,255,0.07)`,
                `inset 0 -1px 0 rgba(0,0,0,0.5)`,
              ].join(", "),
              position: "relative", overflow: "hidden",
            }}>
              {/* Corner gloss */}
              <div style={{
                position: "absolute", top: 0, left: 0, width: 90, height: 90,
                background: "radial-gradient(circle at 0 0, rgba(255,255,255,0.09) 0%, transparent 65%)",
              }} />
              <div style={{
                position: "absolute", bottom: 0, right: 0, width: 70, height: 70,
                background: "radial-gradient(circle at 100% 100%, rgba(220,38,38,0.14) 0%, transparent 65%)",
              }} />
              <span style={{
                fontSize: 80, fontWeight: 900, lineHeight: 1, letterSpacing: -5,
                color: accent,
                textShadow: `0 0 50px ${accent}BB, 0 0 20px ${accent}66`,
                position: "relative",
                userSelect: "none",
              }}>
                {project.name.charAt(0)}
              </span>
            </div>

            {/* ── Info + Stats ── */}
            <div dir="rtl" style={{
              flex: 1, minWidth: 0,
              display: "flex", flexDirection: "column",
              paddingTop: 4,
            }}>
              {/* Name */}
              <div style={{
                fontSize: 46, fontWeight: 900, color: TEXT,
                letterSpacing: -2, lineHeight: 1,
                marginBottom: 10,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {project.name}
              </div>

              {/* Type + artist */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                <span style={{
                  fontSize: 12, fontWeight: 800, color: accent,
                  background: `${accent}1C`, border: `1.5px solid ${accent}48`,
                  borderRadius: 8, padding: "4px 12px", letterSpacing: "0.06em",
                }}>
                  {project.projectType || "שיר"}
                </span>
                <span style={{ fontSize: 15, color: TEXT2, fontWeight: 600 }}>
                  🎤 {project.artist}
                </span>
              </div>

              {/* Stats row — 4 tall mini-cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>

                <StatCard label="סטטוס">
                  <div onClick={e => e.stopPropagation()}>
                    <StatusDropdown projectId={project.id} status={project.status} small />
                  </div>
                </StatCard>

                <StatCard label="תאריך יעד" borderAccent={dlColor !== TEXT2 ? dlColor : undefined}>
                  <div style={{ fontSize: 17, fontWeight: 900, color: dlColor, lineHeight: 1 }}>
                    {project.deadline ? dlLabel : "—"}
                  </div>
                </StatCard>

                <StatCard label="יתרה">
                  <div style={{
                    fontSize: 17, fontWeight: 900, lineHeight: 1,
                    color: finLoaded ? (balance > 0 ? RED_WARN : GREEN) : MUTED,
                  }}>
                    {finLoaded ? `${currency}${balance.toLocaleString()}` : "…"}
                  </div>
                </StatCard>

                <StatCard label="מחיר מוסכם">
                  <div style={{ fontSize: 17, fontWeight: 900, color: TEXT, lineHeight: 1 }}>
                    {finLoaded ? `${currency}${agreedPrice.toLocaleString()}` : "…"}
                  </div>
                </StatCard>

              </div>
            </div>

            {/* ── Player column ── */}
            <div style={{
              width: 480, flexShrink: 0,
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              {/* Controls row */}
              <div dir="ltr" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Link
                  href={`/projects/${projectId}`}
                  target="_blank"
                  style={{
                    fontSize: 12, color: TEXT2, textDecoration: "none",
                    border: `1px solid ${BORDER2}`, borderRadius: 10, padding: "7px 14px",
                    display: "flex", alignItems: "center", gap: 6,
                    background: CARD_BG2, whiteSpace: "nowrap", fontWeight: 600,
                  }}
                >
                  פתח עמוד מלא ↗
                </Link>
                <button
                  onClick={onClose}
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: CARD_BG2, border: `1px solid ${BORDER2}`,
                    color: TEXT2, cursor: "pointer", fontSize: 18,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "inherit",
                  }}
                >✕</button>
              </div>

              {/* Player card — tall */}
              <div style={{
                background: "rgba(255,255,255,0.042)",
                border: `1px solid ${BORDER2}`,
                borderRadius: 18,
                padding: "20px 22px",
                display: "flex", flexDirection: "column", gap: 14,
                flex: 1,
                minHeight: 112,
              }}>
                {/* Play row */}
                <div dir="rtl" style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  <button
                    onClick={latestFile ? handlePlay : undefined}
                    style={{
                      width: 58, height: 58, borderRadius: "50%", flexShrink: 0,
                      background: latestFile
                        ? isPlaying
                          ? `linear-gradient(135deg, #DC2626, #B91C1C)`
                          : `linear-gradient(145deg, #9B1C1C, #7F1D1D)`
                        : "#181818",
                      border: `2px solid ${latestFile ? "rgba(220,38,38,0.68)" : "#2A2A2A"}`,
                      color: "#fff", cursor: latestFile ? "pointer" : "default",
                      fontSize: 19,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "inherit",
                      boxShadow: latestFile && isPlaying
                        ? `0 0 40px rgba(220,38,38,0.85), 0 0 12px rgba(220,38,38,0.55)`
                        : latestFile
                          ? `0 0 24px rgba(220,38,38,0.48)`
                          : "none",
                      transition: "none",
                    }}
                  >
                    {isPlaying ? "⏸" : "▶"}
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 15, fontWeight: 700, color: TEXT,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      marginBottom: 5,
                    }}>
                      {latestFile ? latestFile.name : "אין קובץ שמע"}
                    </div>
                    <div style={{ fontSize: 12, color: MUTED }}>
                      {latestFile
                        ? ((latestFile as { versionLabel?: string }).versionLabel ?? "קובץ אחרון")
                        : "העלה קובץ כדי לנגן"}
                    </div>
                  </div>

                  {latestFile && (
                    <div style={{ fontSize: 12, color: MUTED, fontWeight: 700, flexShrink: 0 }}>—:——</div>
                  )}
                </div>

                {/* Waveform — taller bars */}
                <svg
                  width="100%" height="44"
                  viewBox="0 0 440 44"
                  preserveAspectRatio="none"
                  style={{ opacity: latestFile ? 0.72 : 0.18, display: "block" }}
                >
                  {WAVE_H.map((h, i) => (
                    <rect
                      key={i}
                      x={i * 11}
                      y={(44 - h) / 2}
                      width={4.5}
                      height={h}
                      fill={isPlaying ? BRAND : MUTED}
                      rx={2.5}
                    />
                  ))}
                </svg>
              </div>
            </div>
          </div>

          {/* ── Quick Actions ─────────────────────────────────────────────── */}
          <div dir="rtl" style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            {([
              { label: "סשן חדש", icon: "📅", color: BLUE,  tab: "סשנים" as DrawerTab },
              { label: "תשלום",   icon: "₪",  color: GREEN, tab: "כספים" as DrawerTab },
              { label: "הוצאה",   icon: "⊖",  color: AMBER, tab: "כספים" as DrawerTab },
            ] as { label: string; icon: string; color: string; tab: DrawerTab }[]).map(({ label, icon, color, tab }) => (
              <button
                key={label}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, height: 74, borderRadius: 16,
                  background: `linear-gradient(160deg, ${color}12 0%, ${color}08 100%)`,
                  border: `1.5px solid ${color}35`,
                  color, cursor: "pointer",
                  display: "flex", flexDirection: "column" as const,
                  alignItems: "center", justifyContent: "center", gap: 8,
                  fontFamily: "inherit",
                  transition: "none",
                  boxShadow: `inset 0 1px 0 ${color}18`,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = `linear-gradient(160deg, ${color}22 0%, ${color}14 100%)`;
                  e.currentTarget.style.borderColor = `${color}58`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = `linear-gradient(160deg, ${color}12 0%, ${color}08 100%)`;
                  e.currentTarget.style.borderColor = `${color}35`;
                }}
              >
                <span style={{ fontSize: 26, lineHeight: 1 }}>{icon}</span>
                <span style={{ fontSize: 14, fontWeight: 800, lineHeight: 1 }}>+ {label}</span>
              </button>
            ))}

            {/* Upload */}
            <div style={{
              flex: 1, height: 74, borderRadius: 16,
              background: `linear-gradient(160deg, rgba(220,38,38,0.14) 0%, rgba(220,38,38,0.08) 100%)`,
              border: `1.5px solid rgba(220,38,38,0.34)`,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
              position: "relative", overflow: "hidden",
              boxShadow: `inset 0 1px 0 rgba(220,38,38,0.18)`,
            }}>
              <span style={{ fontSize: 26, lineHeight: 1, pointerEvents: "none" }}>☁</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: BRAND, lineHeight: 1, pointerEvents: "none" }}>
                העלאת קובץ
              </span>
              <div style={{ position: "absolute", inset: 0, opacity: 0 }}>
                <UploadButton
                  projectId={project.id}
                  projectName={project.name}
                  artist={project.artist}
                  existingFiles={project.files}
                  size="sm"
                />
              </div>
            </div>
          </div>

          {/* ── Tabs ──────────────────────────────────────────────────────── */}
          <div dir="rtl" style={{
            display: "flex",
            background: "rgba(0,0,0,0.30)",
            borderRadius: "14px 14px 0 0",
            border: `1px solid ${BORDER}`,
            borderBottom: "none",
            padding: "0 8px",
            overflowX: "auto",
          }}>
            {PROJECT_TABS.map(tab => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "0 26px", height: 64,
                    borderRadius: "12px 12px 0 0",
                    border: "none",
                    background: active ? "rgba(220,38,38,0.11)" : "transparent",
                    color: active ? BRAND : MUTED,
                    cursor: "pointer",
                    fontSize: active ? 15 : 14,
                    fontWeight: active ? 900 : 500,
                    fontFamily: "inherit",
                    borderBottom: active ? `3.5px solid ${BRAND}` : "3.5px solid transparent",
                    whiteSpace: "nowrap",
                    display: "flex", alignItems: "center", gap: 8,
                    transition: "none",
                    flexShrink: 0,
                    textShadow: active ? `0 0 30px rgba(220,38,38,0.70)` : "none",
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.color = TEXT2; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.color = MUTED; }}
                >
                  <span style={{ fontSize: active ? 17 : 16, lineHeight: 1 }}>{TAB_ICONS[tab]}</span>
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            CONTENT
        ══════════════════════════════════════════════════════════════════ */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px 20px" }}>
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
              justifyContent: "center", height: "100%", minHeight: 280, gap: 16,
            }}>
              <span style={{ fontSize: 52, opacity: 0.30 }}>{TAB_ICONS[activeTab]}</span>
              <div style={{ fontSize: 18, fontWeight: 700, color: TEXT2 }}>טאב {activeTab}</div>
              <div style={{ fontSize: 13, color: MUTED }}>השתמש ב-ProjectDrawer הקיים לניהול מלא</div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Overview tab ──────────────────────────────────────────────────────────────
function OverviewContent({
  project, transactions, sessions,
  agreedPrice, currency, finLoaded, accent,
  received, totalExp, balance,
  pct, filesCount, sessDone, statusColor, onTabChange,
}: {
  project:      Project;
  transactions: Transaction[];
  sessions:     Session[];
  agreedPrice:  number;
  currency:     string;
  finLoaded:    boolean;
  accent:       string;
  received:     number;
  totalExp:     number;
  balance:      number;
  pct:          number;
  filesCount:   number;
  sessDone:     number;
  statusColor:  string;
  onTabChange:  (t: DrawerTab) => void;
}) {
  const days = daysUntilDeadline(project.deadline);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "220px 1fr 1fr 1fr",
      gridTemplateRows: "1fr 1fr",
      gap: 14,
      height: "100%",
      minHeight: 0,
    }}>

      {/* ── SIDEBAR ────────────────────────────────────────────────────── */}
      <div style={{ gridColumn: 1, gridRow: "1 / 3", display: "flex", flexDirection: "column", gap: 14 }}>

        <Card style={{ flex: "none" }}>
          <CardTitle>פעולות מהירות</CardTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {([
              { icon: "🎧", label: "LISTEN דמו",    color: BRAND },
              { icon: "📅", label: "פתיחת יומן",    color: BLUE },
              { icon: "📦", label: "פתיחה Dropbox", color: BLUE },
              { icon: "✦",  label: "שלח דוח AI",   color: "#A855F7" },
              { icon: "📄", label: "יצירת דוח",     color: MUTED },
              { icon: "⊕",  label: "העתק פרויקט",  color: MUTED },
            ]).map(({ icon, label, color }) => (
              <button
                key={label}
                disabled
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 13px", borderRadius: 12,
                  background: `${color}0A`, border: `1px solid ${color}22`,
                  color, fontSize: 13, fontWeight: 600,
                  cursor: "not-allowed", fontFamily: "inherit",
                  textAlign: "right", width: "100%",
                }}
              >
                <span style={{ fontSize: 16 }}>{icon}</span>{label}
              </button>
            ))}
          </div>
        </Card>

        <Card style={{ flex: 1 }}>
          <CardTitle>צוות</CardTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
            {[
              { name: "ויקטור",    role: "אחראי פרויקט", init: "V" },
              { name: "איש סאונד", role: "מיקס / מאסטר", init: "S" },
            ].map(({ name, role, init }) => (
              <div key={name} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 14px", borderRadius: 13,
                background: CARD_BG2, border: `1px solid ${BORDER}`,
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                  background: BRAND_DIM, border: `1.5px solid rgba(220,38,38,0.32)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 900, color: BRAND,
                }}>
                  {init}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{name}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{role}</div>
                </div>
              </div>
            ))}
          </div>
          <button disabled style={{
            marginTop: 12, width: "100%", padding: "11px 14px", borderRadius: 12,
            background: "transparent", border: `1px dashed ${BORDER2}`,
            color: MUTED, fontSize: 12, cursor: "not-allowed", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <span style={{ fontSize: 16 }}>+</span> הוסף חבר צוות
          </button>
        </Card>
      </div>

      {/* ── ROW 1 COL 4: הפעולה הבאה ──────────────────────────────────── */}
      <Card style={{ gridColumn: 4, gridRow: 1 }}>
        <CardTitle>הפעולה הבאה</CardTitle>
        {(() => {
          const next = sessions
            .filter(s => s.status !== "התקיים" && s.status !== "בוטל" && s.date)
            .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];
          return next ? (
            <div style={{
              padding: "16px 18px", borderRadius: 14, marginBottom: 12,
              background: `${BLUE}0E`, border: `1px solid ${BLUE}33`,
            }}>
              <div style={{ fontSize: 11, color: BLUE, fontWeight: 800, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                📅 סשן מתוכנן
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: TEXT }}>
                {next.date ? new Date(next.date).toLocaleDateString("he-IL", { day: "numeric", month: "short" }) : "—"}
              </div>
            </div>
          ) : (
            <div style={{
              padding: "16px 18px", borderRadius: 14, marginBottom: 12,
              background: CARD_BG2, border: `1px solid ${BORDER}`,
              fontSize: 13, color: MUTED, textAlign: "center",
            }}>
              אין סשן מתוכנן
            </div>
          );
        })()}
        <div style={{
          padding: "14px 16px", borderRadius: 14,
          background: BRAND_DIM, border: `1px solid rgba(220,38,38,0.24)`,
          flex: 1,
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: BRAND, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.12em" }}>
            הצעה
          </div>
          <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.7 }}>
            {project.status === "בעבודה" ? "זמן להוסיף סשן חדש" :
             project.status === "הושלם"  ? "הפרויקט הושלם ✓" :
             project.status === "במיקס"  ? "בדוק עדכונים מהמהנדס" :
             "עדכן את הסטטוס"}
          </div>
        </div>
      </Card>

      {/* ── ROW 1 COL 3: סטטוס פרויקט ─────────────────────────────────── */}
      <Card style={{ gridColumn: 3, gridRow: 1 }}>
        <CardTitle>סטטוס פרויקט</CardTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9, flex: 1 }}>
          {([
            {
              icon: "₪",  label: "כספים",
              val: finLoaded ? (transactions.filter(t => t.type === "income").length > 0 ? "תקין" : "—") : "…",
              color: transactions.filter(t => t.type === "income").length > 0 ? GREEN : MUTED,
            },
            {
              icon: "⊞", label: "קבצים",
              val: filesCount > 0 ? String(filesCount) : "—",
              color: filesCount > 0 ? BLUE : MUTED,
            },
            {
              icon: "◷", label: "סשנים",
              val: sessions.length > 0 ? `${sessDone}/${sessions.length}` : "—",
              color: sessions.length > 0 ? BLUE : MUTED,
            },
            {
              icon: "💰", label: "תקציב",
              val: finLoaded ? `${currency}${agreedPrice.toLocaleString()}` : "…",
              color: TEXT2,
            },
            {
              icon: "🎛️", label: "הקלטות",
              val: sessDone > 0 ? "עודכן" : "—",
              color: sessDone > 0 ? GREEN : MUTED,
            },
            {
              icon: "✓",  label: "בעיות",
              val: "אין",
              color: GREEN,
            },
          ]).map(({ icon, label, val, color }) => (
            <div key={label} style={{
              padding: "13px 14px", borderRadius: 13,
              background: `${color}0B`, border: `1px solid ${color}22`,
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
                <span style={{ fontSize: 10, color: MUTED, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em" }}>
                  {label}
                </span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 900, color }}>{val}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── ROW 1 COL 2: התקדמות כללית ────────────────────────────────── */}
      <Card style={{ gridColumn: 2, gridRow: 1, alignItems: "center" }}>
        <CardTitle>התקדמות כללית</CardTitle>
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
          <Arc pct={pct} accent={accent} size={118} />
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center", pointerEvents: "none",
          }}>
            <div style={{ fontSize: 29, fontWeight: 900, color: TEXT, letterSpacing: -1, lineHeight: 1 }}>{pct}%</div>
            <div style={{ fontSize: 9, color: MUTED, textTransform: "uppercase", letterSpacing: "0.12em", marginTop: 4 }}>סיום</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: TEXT2, fontWeight: 700, marginBottom: 16 }}>{project.status}</div>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 9 }}>
          {[
            { label: "סשנים שהתקיימו", val: `${sessDone} / ${sessions.length || 0}`, color: BLUE },
            { label: "קבצים", val: String(filesCount), color: TEXT2 },
            ...(project.deadline ? [{
              label: "ימים לדדליין",
              val: days !== null ? (days < 0 ? `פג ${Math.abs(days)} ימים` : `${days} ימים`) : "—",
              color: days !== null && days < 0 ? RED_WARN : days !== null && days <= 7 ? AMBER : TEXT2,
            }] : []),
          ].map(({ label, val, color }) => (
            <div key={label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 13px", borderRadius: 11,
              background: CARD_BG2, border: `1px solid ${BORDER}`,
            }}>
              <span style={{ fontSize: 12, color: MUTED }}>{label}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color }}>{val}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── ROW 2 COL 4: פרטים כלליים ─────────────────────────────────── */}
      <Card style={{ gridColumn: 4, gridRow: 2 }}>
        <CardTitle>פרטים כלליים</CardTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
          {[
            { label: "סוג פרויקט", val: project.projectType || "—", color: undefined },
            { label: "אמן",         val: project.artist || "—",       color: undefined },
            { label: "תאריך התחלה", val: project.startDate ? new Date(project.startDate).toLocaleDateString("he-IL") : "—", color: undefined },
            { label: "דדליין",      val: project.deadline  ? new Date(project.deadline).toLocaleDateString("he-IL")  : "—",
              color: days !== null && days < 0 ? RED_WARN : days !== null && days <= 7 ? AMBER : undefined },
            { label: "שייך ל",     val: project.parentProject || "—", color: undefined },
          ].map(({ label, val, color }) => (
            <div key={label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 13px", borderRadius: 11,
              background: CARD_BG2, border: `1px solid ${BORDER}`,
            }}>
              <span style={{ fontSize: 12, color: MUTED }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: color ?? TEXT2 }}>{val}</span>
            </div>
          ))}
        </div>
        {project.notes && (
          <div style={{
            marginTop: 10, padding: "11px 13px", background: CARD_BG2,
            borderRadius: 11, fontSize: 12, color: MUTED, lineHeight: 1.7,
            border: `1px solid ${BORDER}`,
          }}>
            {project.notes.slice(0, 130)}{project.notes.length > 130 ? "…" : ""}
          </div>
        )}
      </Card>

      {/* ── ROW 2 COL 3: סיכום כספי ────────────────────────────────────── */}
      <Card style={{ gridColumn: 3, gridRow: 2 }}>
        <CardTitle>סיכום כספי</CardTitle>
        {finLoaded ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 14px", borderRadius: 12, background: CARD_BG2, border: `1px solid ${BORDER}`,
            }}>
              <span style={{ fontSize: 13, color: MUTED }}>מחיר מוסכם</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: TEXT }}>{currency}{agreedPrice.toLocaleString()}</span>
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 14px", borderRadius: 12,
              background: `${GREEN}0C`, border: `1px solid ${GREEN}2A`,
            }}>
              <span style={{ fontSize: 13, color: MUTED }}>ס״כ התקבל</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: GREEN }}>{currency}{received.toLocaleString()}</span>
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 14px", borderRadius: 12,
              background: `${AMBER}0A`, border: `1px solid ${AMBER}28`,
            }}>
              <span style={{ fontSize: 13, color: MUTED }}>ס״כ הוצאות</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: AMBER }}>{currency}{totalExp.toLocaleString()}</span>
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "16px 18px", borderRadius: 14, marginTop: "auto",
              background: balance > 0 ? "rgba(239,68,68,0.13)" : `${GREEN}13`,
              border: `1.5px solid ${balance > 0 ? "rgba(239,68,68,0.38)" : GREEN + "48"}`,
            }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: balance > 0 ? RED_WARN : GREEN }}>
                {balance > 0 ? "יתרה לגביה" : "שולם במלואו"}
              </span>
              <span style={{ fontSize: 22, fontWeight: 900, color: balance > 0 ? RED_WARN : GREEN }}>
                {currency}{Math.abs(balance).toLocaleString()}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: MUTED }}>טוען…</div>
        )}
      </Card>

      {/* ── ROW 2 COL 2: קבצים אחרונים ────────────────────────────────── */}
      <Card style={{ gridColumn: 2, gridRow: 2 }}>
        <CardTitle>קבצים אחרונים</CardTitle>
        {project.files && project.files.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
            {project.files.slice(-4).reverse().map(f => {
              const isAudio = f.name.toLowerCase().endsWith(".mp3") || f.name.toLowerCase().endsWith(".wav");
              return (
                <div key={f.name} style={{
                  display: "flex", alignItems: "center", gap: 13,
                  padding: "11px 14px", borderRadius: 13,
                  background: CARD_BG2, border: `1px solid ${BORDER}`,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: isAudio ? `${BRAND}16` : "rgba(255,255,255,0.06)",
                    border: `1px solid ${isAudio ? BRAND + "34" : BORDER}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 17,
                  }}>
                    {isAudio ? "🎵" : "📄"}
                  </div>
                  <span style={{
                    fontSize: 13, color: TEXT2, fontWeight: 600,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                  }}>
                    {f.name}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: MUTED }}>
            אין קבצים
          </div>
        )}
        <button
          onClick={() => onTabChange("קבצים")}
          style={{
            marginTop: 12, width: "100%", padding: "12px 14px", borderRadius: 12,
            background: "transparent", border: `1.5px solid ${BORDER2}`,
            color: TEXT2, fontSize: 13, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "none",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = CARD_BG2; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          עבור לכל הקבצים ←
        </button>
      </Card>

    </div>
  );
}
