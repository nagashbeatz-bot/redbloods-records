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

const PANEL_BG = "linear-gradient(160deg, #0D0D10 0%, #0A0A0D 60%, #080808 100%)";
const HDR_BG   = "rgba(0,0,0,0.40)";
const CARD_BG  = "rgba(255,255,255,0.028)";
const CARD_BG2 = "rgba(255,255,255,0.045)";
const BORDER   = "rgba(255,255,255,0.08)";
const BORDER2  = "rgba(255,255,255,0.11)";
const BRAND    = "#DC2626";
const BLUE     = "#3B82F6";
const GREEN    = "#10B981";
const AMBER    = "#F59E0B";
const RED_WARN = "#EF4444";
const TEXT     = "#F2F2F2";
const TEXT2    = "#A0A0B0";
const MUTED    = "#52526A";

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
  return BRAND; // שיר / default → Redbloods red
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
      background: CARD_BG, borderRadius: 16, padding: 18,
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
    <div dir="rtl" style={{ position: "fixed", top: 60, bottom: 0, left: 0, right: 248, zIndex: 99999 }}>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute", inset: 0,
          background: "rgba(0,0,0,0.78)",
          backdropFilter: "blur(6px)",
        }}
      />

      {/* Panel */}
      <div style={{
        position: "absolute", inset: 10,
        background: PANEL_BG,
        borderRadius: 22,
        zIndex: 100000,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        border: `1px solid rgba(220,38,38,0.22)`,
        boxShadow: [
          `0 0 0 1px rgba(220,38,38,0.06)`,
          `0 50px 120px rgba(0,0,0,0.92)`,
          `0 0 80px rgba(220,38,38,0.04)`,
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

          {/* Top row (LTR for physical layout): cover | info | player | close */}
          <div dir="ltr" style={{ display: "flex", gap: 22, marginBottom: 18, alignItems: "stretch" }}>

            {/* Cover art — 180×180 */}
            <div style={{
              width: 180, height: 180, borderRadius: 18, flexShrink: 0,
              background: `linear-gradient(145deg, #2A0808 0%, #180404 55%, #090202 100%)`,
              border: `1.5px solid rgba(220,38,38,0.35)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 60, fontWeight: 900, color: accent,
              boxShadow: `0 0 40px rgba(220,38,38,0.18), inset 0 0 24px rgba(0,0,0,0.5)`,
              letterSpacing: -2,
            }}>
              {project.name.charAt(0)}
            </div>

            {/* Project info (RTL inside) */}
            <div dir="rtl" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 4px" }}>
              {/* Project name — large */}
              <div style={{
                fontSize: 44, fontWeight: 900, color: TEXT,
                letterSpacing: -1.5, lineHeight: 1.05, marginBottom: 8,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {project.name}
              </div>

              {/* Type badge + artist */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 11, fontWeight: 800, color: accent,
                  background: `${accent}18`, border: `1px solid ${accent}35`,
                  borderRadius: 6, padding: "3px 10px", flexShrink: 0, letterSpacing: "0.04em",
                }}>
                  {project.projectType || "שיר"}
                </span>
                <span style={{ fontSize: 13, color: TEXT2 }}>🎤 {project.artist}</span>
              </div>

              {/* Stats row — 4 items with separators */}
              <div style={{
                display: "flex", alignItems: "center", gap: 0,
                background: "rgba(255,255,255,0.03)", borderRadius: 12,
                border: `1px solid ${BORDER}`, overflow: "hidden",
              }}>
                {/* סטטוס */}
                <div style={{ flex: 1, padding: "10px 14px", borderLeft: `1px solid ${BORDER}` }}
                     onClick={e => e.stopPropagation()}>
                  <div style={{ fontSize: 9, color: MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>סטטוס</div>
                  <StatusDropdown projectId={project.id} status={project.status} small />
                </div>
                {/* תאריך */}
                <div style={{ flex: 1, padding: "10px 14px", borderLeft: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 9, color: MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>תאריך יעד</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: dlColor }}>
                    {project.deadline ? dlLabel : "—"}
                  </div>
                </div>
                {/* יתרה */}
                <div style={{ flex: 1, padding: "10px 14px", borderLeft: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 9, color: MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>יתרה</div>
                  <div style={{
                    fontSize: 12, fontWeight: 700,
                    color: finLoaded ? (balance > 0 ? RED_WARN : GREEN) : MUTED,
                  }}>
                    {finLoaded ? `${currency}${balance.toLocaleString()}` : "…"}
                  </div>
                </div>
                {/* מחיר */}
                <div style={{ flex: 1, padding: "10px 14px" }}>
                  <div style={{ fontSize: 9, color: MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>מחיר</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: TEXT2 }}>
                    {finLoaded ? `${currency}${agreedPrice.toLocaleString()}` : "…"}
                  </div>
                </div>
              </div>
            </div>

            {/* Player card — 470px wide */}
            <div style={{
              width: 470, flexShrink: 0,
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${BORDER2}`,
              borderRadius: 16, padding: "16px 20px",
              display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 12,
            }}>
              {/* Top: close + open link (physical right side since this is LTR column) */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Link
                  href={`/projects/${projectId}`}
                  target="_blank"
                  style={{
                    fontSize: 11, color: TEXT2, textDecoration: "none",
                    border: `1px solid ${BORDER2}`, borderRadius: 9, padding: "6px 12px",
                    display: "flex", alignItems: "center", gap: 5,
                    whiteSpace: "nowrap", background: "rgba(255,255,255,0.04)",
                  }}
                >
                  פתח עמוד מלא ↗
                </Link>
                <button
                  onClick={onClose}
                  style={{
                    width: 34, height: 34, borderRadius: 9,
                    background: "rgba(255,255,255,0.05)",
                    border: `1px solid ${BORDER2}`,
                    color: TEXT2, cursor: "pointer", fontSize: 17,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "inherit",
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Player row */}
              <div dir="rtl" style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {/* Red play button */}
                <button
                  onClick={latestFile ? handlePlay : undefined}
                  style={{
                    width: 50, height: 50, borderRadius: "50%", flexShrink: 0,
                    background: latestFile
                      ? (isPlaying
                          ? `linear-gradient(135deg, #DC2626, #991B1B)`
                          : `linear-gradient(135deg, #991B1B, #7F1D1D)`)
                      : "#1A1A1A",
                    border: `1.5px solid ${BRAND}55`,
                    color: "#fff", cursor: latestFile ? "pointer" : "default",
                    fontSize: 16,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "inherit",
                    boxShadow: latestFile && isPlaying ? `0 0 24px rgba(220,38,38,0.7)` : latestFile ? `0 0 14px rgba(220,38,38,0.35)` : "none",
                  }}
                >
                  {isPlaying ? "⏸" : "▶"}
                </button>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>
                    {latestFile ? latestFile.name : "אין קובץ שמע"}
                  </div>
                  <div style={{ fontSize: 10, color: MUTED }}>
                    {latestFile
                      ? ((latestFile as { versionLabel?: string }).versionLabel ?? "קובץ אחרון")
                      : "העלה קובץ כדי לנגן"}
                  </div>
                </div>
              </div>

              {/* Waveform */}
              <svg width="100%" height="32" viewBox="0 0 428 32" preserveAspectRatio="none"
                   style={{ opacity: latestFile ? 0.55 : 0.2 }}>
                {WAVE_H.map((h, i) => (
                  <rect
                    key={i}
                    x={i * 10.7}
                    y={(32 - h) / 2}
                    width={4}
                    height={h}
                    fill={isPlaying ? BRAND : MUTED}
                    rx={2}
                  />
                ))}
              </svg>
            </div>
          </div>

          {/* ── Quick Actions ───────────────────────────────────────────────── */}
          <div dir="rtl" style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {([
              { label: "+ סשן חדש", icon: "📅", color: BLUE,  tab: "סשנים" as DrawerTab },
              { label: "+ תשלום",   icon: "₪",  color: GREEN, tab: "כספים" as DrawerTab },
              { label: "+ הוצאה",  icon: "⊖",  color: AMBER, tab: "כספים" as DrawerTab },
            ]).map(({ label, icon, color, tab }) => (
              <button
                key={label}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, height: 68, borderRadius: 14,
                  background: `${color}0C`, border: `1px solid ${color}28`,
                  color, cursor: "pointer", fontSize: 14, fontWeight: 700,
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
                <span style={{ fontSize: 17 }}>{icon}</span>
                {label}
              </button>
            ))}
            {/* Upload — red accent */}
            <div style={{
              flex: 1, height: 68, borderRadius: 14,
              background: `rgba(220,38,38,0.05)`, border: `1px solid rgba(220,38,38,0.22)`,
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
                    padding: "13px 22px",
                    borderRadius: "12px 12px 0 0",
                    border: "none",
                    background: active ? "rgba(220,38,38,0.07)" : "transparent",
                    color: active ? BRAND : MUTED,
                    cursor: "pointer", fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    fontFamily: "inherit",
                    borderBottom: active ? `2.5px solid ${BRAND}` : "2.5px solid transparent",
                    whiteSpace: "nowrap",
                    display: "flex", alignItems: "center", gap: 6,
                    transition: "none",
                    flexShrink: 0,
                    textShadow: active ? `0 0 20px rgba(220,38,38,0.5)` : "none",
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

  // RTL grid: col 1 = physical right (sidebar), cols 2-4 = main content left-to-right in DOM
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 1fr 1fr", gridTemplateRows: "auto auto", gap: 14 }}>

      {/* ── Col 1, rows 1+2: Sidebar ─────────────────────────────────────── */}
      <div style={{ gridColumn: 1, gridRow: "1 / 3", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Quick links */}
        <Card>
          <CardTitle>פעולות מהירות</CardTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {([
              { icon: "🎧", label: "LISTEN דמו",     color: BRAND  },
              { icon: "📅", label: "פתיחת יומן",     color: BLUE   },
              { icon: "📦", label: "פתיחה Dropbox",  color: BLUE   },
              { icon: "✦",  label: "שליחת דוח AI",  color: "#A855F7" },
              { icon: "📄", label: "יצירת דוח",      color: MUTED  },
              { icon: "⊕",  label: "העתק פרויקט",   color: MUTED  },
            ]).map(({ icon, label, color }) => (
              <button
                key={label}
                disabled
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 10px", borderRadius: 9,
                  background: `${color}08`, border: `1px solid ${color}1E`,
                  color, fontSize: 12, fontWeight: 600, cursor: "not-allowed",
                  fontFamily: "inherit", textAlign: "right", width: "100%",
                  opacity: 0.7,
                }}
              >
                <span style={{ fontSize: 13 }}>{icon}</span>{label}
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
        <div style={{
          marginTop: 12, padding: "10px 12px", borderRadius: 10,
          background: `rgba(220,38,38,0.06)`, border: `1px solid rgba(220,38,38,0.18)`,
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

      {/* ── Col 2, row 1: התקדמות כללית ─────────────────────────────────── */}
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
                color: days !== null && days < 0 ? RED_WARN : days !== null && days <= 7 ? AMBER : TEXT2,
                fontWeight: 600,
              }}>
                {days !== null ? (days < 0 ? `פג ${Math.abs(days)} ימים` : `${days} ימים`) : "—"}
              </span>
            </div>
          )}
        </div>
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
          vc={days !== null && days < 0 ? RED_WARN : days !== null && days <= 7 ? AMBER : undefined}
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
                <span style={{ fontSize: 12, color: RED_WARN }}>יתרה לגביה</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: RED_WARN }}>{currency}{balance.toLocaleString()}</span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: MUTED, textAlign: "center", padding: "16px 0" }}>טוען…</div>
        )}
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
        <button
          onClick={() => onTabChange("קבצים")}
          style={{
            marginTop: 10, width: "100%", padding: "8px 10px", borderRadius: 9,
            background: "transparent", border: `1px solid ${BORDER2}`,
            color: TEXT2, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            transition: "none",
          }}
        >
          עבור לכל הקבצים ←
        </button>
      </Card>

    </div>
  );
}
