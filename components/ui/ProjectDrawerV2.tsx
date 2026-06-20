"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import UploadButton from "@/components/ui/UploadButton";
import StatusDropdown from "@/components/ui/StatusDropdown";
import { deadlineLabel, daysUntilDeadline, getStatusColor, getStatusBg } from "@/lib/utils";
import type { Project } from "@/lib/types";

// ── Props (identical to ProjectDrawer) ────────────────────────────────────────

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

// ── Design tokens ─────────────────────────────────────────────────────────────

const BG      = "#0E0E0E";
const SURFACE = "#141414";
const CARD    = "#1A1A1A";
const BORDER  = "#1E1E1E";
const BORDER2 = "#252525";
const TEXT    = "#F0F0F0";
const TEXT2   = "#CCC";
const MUTED   = "#666";
const MUTED2  = "#444";

const PROJECT_TABS = ["סקירה", "כספים", "סשנים", "קליפ", "קבצים", "פעולות"] as const;
type DrawerTab = typeof PROJECT_TABS[number];

const TAB_ICONS: Record<DrawerTab, string> = {
  "סקירה":  "🏠",
  "כספים":  "₪",
  "סשנים":  "📅",
  "קליפ":   "🎬",
  "קבצים":  "📁",
  "פעולות": "⚡",
};

// Static waveform heights (deterministic, no hydration issues)
const WAVE_H = [6, 10, 8, 14, 6, 12, 8, 10, 16, 6, 12, 8, 14, 10, 6, 12, 8, 16, 6, 10, 8, 12, 6, 14, 8, 10, 16, 6, 12, 8];

function accentForType(t: string): string {
  if (t === "EP")     return "#A855F7";
  if (t === "אלבום") return "#EC4899";
  if (t === "קליפ")  return "#8B5CF6";
  return "#3B82F6";
}

function progressForStatus(status: string): number {
  switch (status) {
    case "לא התחיל":   return 5;
    case "בעבודה":     return 30;
    case "מחכה למיקס": return 55;
    case "במיקס":      return 75;
    case "בהשהייה":    return 50;
    case "הושלם":      return 100;
    default:           return 20;
  }
}

// ── Progress Arc SVG ─────────────────────────────────────────────────────────

function ArcProgress({ pct, accent, size = 90 }: { pct: number; accent: string; size?: number }) {
  const r = (size - 14) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#252525" strokeWidth={8} />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={accent}
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ - dash}`}
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
    </svg>
  );
}

// ── Small info row ────────────────────────────────────────────────────────────

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "6px 0", borderBottom: `1px solid ${BORDER}`,
      fontSize: 12,
    }}>
      <span style={{ color: MUTED }}>{label}</span>
      <span style={{ color: valueColor ?? TEXT2, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ── Status chip for the status grid ──────────────────────────────────────────

function StatusChip({
  label, icon, value, color,
}: { label: string; icon: string; value: string; color: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 12px", borderRadius: 8,
      background: `${color}0A`, border: `1px solid ${color}22`,
    }}>
      <span style={{ fontSize: 12, color: MUTED }}>
        <span style={{ marginLeft: 4 }}>{icon}</span>{label}
      </span>
      <span style={{ fontSize: 12, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  project, transactions, sessions, agreedPrice, currency, finLoaded, accent,
  received, totalExpense,
}: {
  project:      Project;
  transactions: Transaction[];
  sessions:     Session[];
  agreedPrice:  number;
  currency:     string;
  finLoaded:    boolean;
  accent:       string;
  received:     number;
  totalExpense: number;
}) {
  const pct = progressForStatus(project.status);
  const filesCount = project.files?.length ?? 0;
  const sessionsTotal = sessions.length;
  const sessionsDone  = sessions.filter(s => s.status === "התקיים").length;
  const balance       = agreedPrice - received;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 200px", gap: 14 }}>

      {/* Column 1 — פרטים כלליים */}
      <div style={{ background: CARD, borderRadius: 12, padding: 16, border: `1px solid ${BORDER2}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
          פרטים כלליים
        </div>
        <InfoRow label="סוג פרויקט" value={project.projectType || "—"} />
        <InfoRow label="אמן" value={project.artist || "—"} />
        <InfoRow
          label="תאריך התחלה"
          value={project.startDate
            ? new Date(project.startDate).toLocaleDateString("he-IL")
            : "—"}
        />
        <InfoRow
          label="דדליין"
          value={project.deadline
            ? new Date(project.deadline).toLocaleDateString("he-IL")
            : "—"}
          valueColor={project.deadline
            ? (daysUntilDeadline(project.deadline) ?? 999) < 0 ? "#EF4444"
              : (daysUntilDeadline(project.deadline) ?? 999) <= 7 ? "#F97316"
              : TEXT2
            : MUTED}
        />
        <InfoRow label="שייך ל" value={project.parentProject || "—"} />
        {project.notes && (
          <div style={{ marginTop: 10, padding: 8, background: "#0D0D0D", borderRadius: 8, fontSize: 11, color: MUTED, lineHeight: 1.6 }}>
            {project.notes.slice(0, 100)}{project.notes.length > 100 ? "…" : ""}
          </div>
        )}
      </div>

      {/* Column 2 — סטטוס פרויקט */}
      <div style={{ background: CARD, borderRadius: 12, padding: 16, border: `1px solid ${BORDER2}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
          סטטוס פרויקט
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <StatusChip
            label="כספים"
            icon="₪"
            value={finLoaded ? (transactions.length > 0 ? "✓ תקין" : "—") : "…"}
            color={transactions.length > 0 ? "#10B981" : "#6B7280"}
          />
          <StatusChip
            label="סשנים"
            icon="📅"
            value={sessionsTotal > 0 ? `${sessionsDone}/${sessionsTotal}` : "—"}
            color={sessionsTotal > 0 ? "#3B82F6" : "#6B7280"}
          />
          <StatusChip
            label="קבצים"
            icon="📁"
            value={filesCount > 0 ? `${filesCount} קבצים` : "—"}
            color={filesCount > 0 ? "#3B82F6" : "#6B7280"}
          />
          {project.projectType === "קליפ" && (
            <StatusChip label="קליפ" icon="🎬" value="בתכנון" color="#8B5CF6" />
          )}
          <StatusChip label="ויקטור" icon="🎛️" value="עדכן בטאב פעולות" color="#6B7280" />
          <StatusChip label="מסירה" icon="📤" value="לא הוגדר" color="#6B7280" />
        </div>
      </div>

      {/* Column 3 — התקדמות */}
      <div style={{ background: CARD, borderRadius: 12, padding: 16, border: `1px solid ${BORDER2}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
          התקדמות כללית
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <ArcProgress pct={pct} accent={accent} size={88} />
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: TEXT }}>{pct}%</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: MUTED }}>מתוך 100%</div>
        </div>

        {/* Finance summary */}
        {finLoaded && (
          <div style={{ borderTop: `1px solid ${BORDER2}`, paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 8 }}>
              סיכום כספי
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: MUTED }}>מחיר מוסכם</span>
                <span style={{ color: TEXT2, fontWeight: 600 }}>{currency}{agreedPrice.toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: MUTED }}>ס״כ התקבל</span>
                <span style={{ color: "#10B981", fontWeight: 600 }}>{currency}{received.toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: MUTED }}>ס״כ הוצאות</span>
                <span style={{ color: "#F59E0B", fontWeight: 600 }}>{currency}{totalExpense.toLocaleString()}</span>
              </div>
              {balance > 0 && (
                <div style={{
                  display: "flex", justifyContent: "space-between", fontSize: 12,
                  marginTop: 4, padding: "4px 8px",
                  background: "rgba(239,68,68,0.08)", borderRadius: 6,
                  border: "1px solid rgba(239,68,68,0.2)",
                }}>
                  <span style={{ color: "#EF4444" }}>יתרה לגביה</span>
                  <span style={{ color: "#EF4444", fontWeight: 700 }}>{currency}{balance.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Column 4 — פעולות מהירות (sidebar) */}
      <div style={{ background: CARD, borderRadius: 12, padding: 14, border: `1px solid ${BORDER2}`, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
          פעולות מהירות
        </div>
        {[
          { icon: "🎧", label: "LISTEN", color: "#3B82F6" },
          { icon: "📅", label: "פתח ביומן", color: "#10B981" },
          { icon: "📦", label: "Dropbox", color: "#0061FF" },
          { icon: "✨", label: "שלח למאי AI", color: "#A855F7" },
          { icon: "📄", label: "יצירת דוח", color: "#F59E0B" },
          { icon: "📋", label: "שכפל פרויקט", color: "#6B7280" },
        ].map(({ icon, label, color }) => (
          <button
            key={label}
            disabled
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 10px", borderRadius: 8,
              background: `${color}0A`, border: `1px solid ${color}22`,
              color, fontSize: 12, fontWeight: 600, cursor: "not-allowed",
              opacity: 0.7, fontFamily: "inherit", textAlign: "right",
              width: "100%",
            }}
          >
            <span style={{ fontSize: 14 }}>{icon}</span>
            {label}
          </button>
        ))}
        <div style={{ borderTop: `1px solid ${BORDER2}`, marginTop: 4, paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: MUTED2, marginBottom: 6, fontWeight: 700 }}>צוות</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: MUTED }}>ויקטור</span>
            <span style={{ color: "#888" }}>אחראי פרויקט</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: MUTED }}>איש סאונד</span>
            <span style={{ color: "#888" }}>מיקס / מאסטר</span>
          </div>
          <button
            disabled
            style={{
              marginTop: 6, width: "100%", padding: "6px 10px", borderRadius: 8,
              background: "transparent", border: `1px solid ${BORDER2}`,
              color: MUTED, fontSize: 11, cursor: "not-allowed", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            }}
          >
            + הוסף חבר צוות
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProjectDrawerV2({ projectId, artists, onClose }: Props) {
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

  // Phase 1: desktop only
  if (!mounted || !project || isMobile) return null;

  const accent       = accentForType(project.projectType);
  const statusColor  = getStatusColor(project.status);
  const statusBg     = getStatusBg(project.status);
  const days         = daysUntilDeadline(project.deadline);
  const dlLabel      = deadlineLabel(project.deadline);
  const dlColor      = days !== null && days < 0 ? "#EF4444"
                     : days !== null && days <= 7 ? "#F97316"
                     : "#888";

  const received     = transactions
    .filter(t => t.type === "income" && (t.payment_status === "התקבל" || t.payment_status === "שולם"))
    .reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions
    .filter(t => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const balance      = agreedPrice - received;

  const latestFile = project.files ? getLatestAudioFile(project.files) : null;
  const isPlaying  = player?.track?.projectId === projectId && (player?.playing ?? false);

  async function handlePlay() {
    if (!latestFile || !player || !project) return;
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

  return createPortal(
    <div dir="rtl" style={{ position: "fixed", inset: 0, zIndex: 99999 }}>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute", inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(3px)",
        }}
      />

      {/* Panel */}
      <div style={{
        position: "absolute", inset: 20,
        background: BG, borderRadius: 18,
        display: "flex", flexDirection: "column",
        zIndex: 100000, overflow: "hidden",
        border: `1px solid ${accent}22`,
        boxShadow: `0 0 0 1px #1A1A1A, 0 32px 80px rgba(0,0,0,0.85)`,
        animation: "rb-drawer-in 0.22s cubic-bezier(.32,.72,0,1) forwards",
      }}>
        <style>{`
          @keyframes rb-drawer-in {
            from { transform: translateX(100%); opacity: 0.6; }
            to   { transform: translateX(0);    opacity: 1;   }
          }
        `}</style>

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <div style={{
          background: "#0D0D0D",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
          padding: "20px 28px 0",
        }}>

          {/* Top row: cover + info + controls */}
          <div style={{ display: "flex", gap: 18, marginBottom: 14, alignItems: "flex-start" }}>

            {/* Cover art placeholder */}
            <div style={{
              width: 80, height: 80, borderRadius: 10, flexShrink: 0,
              background: `linear-gradient(145deg, #200808, #0D0D20)`,
              border: `1px solid ${accent}33`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 30, fontWeight: 900, color: accent,
            }}>
              {project.name.charAt(0)}
            </div>

            {/* Project info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: TEXT, letterSpacing: -0.3, lineHeight: 1.2 }}>
                  {project.name}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: accent,
                  background: `${accent}18`, border: `1px solid ${accent}30`,
                  borderRadius: 6, padding: "2px 8px", flexShrink: 0,
                }}>
                  {project.projectType || "שיר"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
                🎤 {project.artist}
              </div>
              {/* Badges row */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <StatusDropdown projectId={project.id} status={project.status} small />
                {project.deadline && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: dlColor,
                    background: `${dlColor}15`, border: `1px solid ${dlColor}30`,
                    borderRadius: 6, padding: "3px 9px", flexShrink: 0,
                  }}>
                    📅 {dlLabel}
                  </span>
                )}
                {finLoaded && balance > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: "#EF4444",
                    background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                    borderRadius: 6, padding: "3px 9px", flexShrink: 0,
                  }}>
                    יתרה {currency}{balance.toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            {/* Control buttons */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, paddingTop: 4 }}>
              <Link
                href={`/projects/${projectId}`}
                target="_blank"
                style={{
                  fontSize: 11, color: "#555", textDecoration: "none",
                  border: "1px solid #2A2A2A", borderRadius: 8, padding: "6px 10px",
                  display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
                }}
              >
                פתח עמוד מלא ↗
              </Link>
              <button
                onClick={onClose}
                style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: "none", border: "1px solid #2A2A2A",
                  color: "#777", cursor: "pointer", fontSize: 18,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "inherit",
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Audio player row */}
          {latestFile && (
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              background: SURFACE, borderRadius: 10, padding: "8px 14px",
              marginBottom: 14, border: `1px solid ${BORDER}`,
            }}>
              <button
                onClick={handlePlay}
                style={{
                  width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                  background: isPlaying ? accent : `${accent}22`,
                  border: `1px solid ${accent}55`,
                  color: isPlaying ? "#fff" : accent,
                  cursor: "pointer", fontSize: 14,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "inherit",
                }}
              >
                {isPlaying ? "⏸" : "▶"}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: TEXT2, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {latestFile.name}
                </div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                  {(latestFile as { versionLabel?: string }).versionLabel ?? "קובץ אחרון"}
                </div>
              </div>
              {/* Static waveform */}
              <svg width="120" height="24" viewBox="0 0 120 24" style={{ flexShrink: 0, opacity: 0.4 }}>
                {WAVE_H.map((h, i) => (
                  <rect
                    key={i}
                    x={i * 4}
                    y={(24 - h) / 2}
                    width={2.5}
                    height={h}
                    fill={accent}
                    rx={1}
                  />
                ))}
              </svg>
            </div>
          )}

          {/* Quick Actions */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {([
              { label: "סשן חדש", icon: "📅", color: "#60A5FA" },
              { label: "תשלום",   icon: "₪",  color: "#34D399" },
              { label: "הוצאה",  icon: "⊖",  color: "#F59E0B" },
            ] as { label: string; icon: string; color: string }[]).map(({ label, icon, color }) => (
              <button
                key={label}
                onClick={() => setActiveTab(label === "סשן חדש" ? "סשנים" : "כספים")}
                style={{
                  flex: 1, height: 50, borderRadius: 12,
                  background: `${color}0D`, border: `1px solid ${color}30`,
                  color, cursor: "pointer", fontSize: 13, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  fontFamily: "inherit",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = `${color}1A`)}
                onMouseLeave={e => (e.currentTarget.style.background = `${color}0D`)}
              >
                <span>{icon}</span>
                {label}
              </button>
            ))}
            {/* Upload button */}
            <div style={{ flex: 1, display: "flex" }}>
              <UploadButton
                projectId={project.id}
                projectName={project.name}
                artist={project.artist}
                existingFiles={project.files}
                size="sm"
              />
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
            {PROJECT_TABS.map(tab => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "10px 18px",
                    borderRadius: "10px 10px 0 0",
                    border: "none",
                    background: active ? SURFACE : "transparent",
                    color: active ? accent : "#4A4A4A",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: active ? 700 : 400,
                    fontFamily: "inherit",
                    borderBottom: active ? `2px solid ${accent}` : "2px solid transparent",
                    whiteSpace: "nowrap",
                    display: "flex", alignItems: "center", gap: 5,
                    transition: "all 0.15s",
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: 12 }}>{TAB_ICONS[tab]}</span>
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── CONTENT ────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, background: SURFACE }}>
          {activeTab === "סקירה" ? (
            <OverviewTab
              project={project}
              transactions={transactions}
              sessions={sessions}
              agreedPrice={agreedPrice}
              currency={currency}
              finLoaded={finLoaded}
              accent={accent}
              received={received}
              totalExpense={totalExpense}
            />
          ) : (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: "100%", minHeight: 200, gap: 12, color: MUTED,
            }}>
              <span style={{ fontSize: 36 }}>{TAB_ICONS[activeTab]}</span>
              <div style={{ fontSize: 14 }}>טאב {activeTab} — יועבר בשלב הבא</div>
              <div style={{ fontSize: 11, color: MUTED2 }}>
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
