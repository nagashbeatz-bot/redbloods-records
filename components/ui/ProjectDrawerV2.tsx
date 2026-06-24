"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import UploadButton from "@/components/ui/UploadButton";
import DatePickerInput from "@/components/ui/DatePickerInput";
import StatusDropdown from "@/components/ui/StatusDropdown";
import { deadlineLabel, daysUntilDeadline, getStatusColor } from "@/lib/utils";
import type { Project } from "@/lib/types";
import ScheduleModal from "@/components/project/ScheduleModal";
import { ACTIONS, type ActionDef } from "@/lib/action-types";

interface Props {
  projectId: string;
  artists:   string[];
  onClose:   () => void;
}

type PaymentStatus = "שולם" | "התקבל" | "צפוי" | "לא שולם" | "חלקי" | "בוטל" | "לבדיקה";

interface Transaction {
  id:              string;
  type:            "income" | "expense";
  amount:          number;
  payment_status:  PaymentStatus;
  description:     string;
  date?:           string;
  created_at?:     string;
  payment_method?: string;
  category?:       string;
  notes?:          string;
}

interface Session {
  id:           string;
  date:         string | null;
  status:       string;
  session_type?: string;
  start_time?:  string;
  end_time?:    string;
  created_at?:  string;
  notes?:       string;
}

interface ProjectAction {
  id:             string;
  action_type?:   string;
  content_type?:  string;
  recipient_role?: string;
  recipient_name?: string;
  action_date?:   string;
  created_at?:    string;
  status?:        string;
  notes?:         string;
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
const LABEL     = "rgba(255,255,255,0.50)";  // readable secondary label on dark bg

const PROJECT_TABS = ["סקירה", "כספים", "סשנים", "קליפ", "קבצים"] as const;
type DrawerTab = typeof PROJECT_TABS[number];

const TAB_ICONS: Record<DrawerTab, string> = {
  "סקירה": "◈", "כספים": "₪", "סשנים": "◷",
  "קליפ": "▷", "קבצים": "⊞",
};

// Taller waveform bars for visual presence
const WAVE_H = [
  7,12,20,9,22,12,7,15,26,12,20,9,15,22,12,7,18,12,26,9,
  15,12,22,7,18,12,9,15,22,12,20,7,12,26,9,15,12,18,9,15,
];

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

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
    <svg width={size} height={size} overflow="visible" style={{ transform: "rotate(-90deg)", display: "block" }}>
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
      fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.70)",
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
        fontSize: 10, fontWeight: 800, color: LABEL,
        textTransform: "uppercase", letterSpacing: "0.13em",
      }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ─── SendModal ────────────────────────────────────────────────────────────────
type SendDestination = "הפקה" | "מיקס / מאסטר" | "לקוח";

const CLIENT_CONTENT_TYPES = ["סקיצה", "גרסה לאישור", "בקשת הערות", "אישור סופי"] as const;
const PURPLE = "#8B5CF6";

interface SendModalProps {
  projectId:     string;
  artistName:    string;
  onClose:       () => void;
  onActionSent?: (action: ProjectAction) => void;
}

function SendModal({ projectId, artistName, onClose, onActionSent }: SendModalProps) {
  const [step,       setStep]      = useState<1 | 2>(1);
  const [dest,       setDest]      = useState<SendDestination | null>(null);
  const [selection,  setSelection] = useState<string | null>(null);
  const [saving,     setSaving]    = useState(false);
  const [error,      setError]     = useState<string | null>(null);

  function goBack() { setStep(1); setDest(null); setSelection(null); setError(null); }

  function buildPayload() {
    const base = { projectId, actionType: "sent", actionDate: new Date().toISOString().slice(0, 10) };
    if (dest === "הפקה") return {
      ...base,
      recipientRole: "external_producer",
      recipientName: "ויקטור",
      contentType:   "הפקה",
      notes:         "נשלח להפקה",
      status:        "pending_version",
    };
    if (dest === "מיקס / מאסטר") return {
      ...base,
      recipientRole: "sound_engineer",
      recipientName: selection ?? "",
      contentType:   "מיקס / מאסטר",
      notes:         "נשלח למיקס / מאסטר",
      status:        "pending_version",
    };
    // לקוח
    return {
      ...base,
      recipientRole: "client",
      recipientName: artistName || "לקוח",
      contentType:   selection ?? "",
      notes:         `נשלח ללקוח — ${selection ?? ""}`,
      status:        "pending_feedback",
    };
  }

  async function handleSave() {
    if (saving || !selection) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/project-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "שגיאה בשמירה");
      }
      const resData = await res.json().catch(() => ({}));
      if (onActionSent && resData.action) onActionSent(resData.action as ProjectAction);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  // ── card grid for choices ──────────────────────────────────────────────────
  function ChoiceCard({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
    return (
      <button
        onClick={onClick}
        style={{
          padding: "16px 12px", borderRadius: 14,
          border: selected ? `2px solid ${PURPLE}` : `1.5px solid ${BORDER2}`,
          background: selected ? `${PURPLE}18` : CARD_BG2,
          color: selected ? "#C4B5FD" : TEXT2,
          fontWeight: selected ? 800 : 600,
          fontSize: 14, cursor: "pointer", fontFamily: "inherit",
          textAlign: "center", transition: "none",
          boxShadow: selected ? `0 0 0 3px ${PURPLE}22` : "none",
        }}
      >{label}</button>
    );
  }

  const destinations: SendDestination[] = ["הפקה", "מיקס / מאסטר", "לקוח"];

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 199999,
        background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        dir="rtl"
        onClick={e => e.stopPropagation()}
        style={{
          background: "#111113",
          border: `1px solid ${BORDER2}`,
          borderRadius: 20,
          padding: "26px 26px 22px",
          width: "min(400px, 92vw)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.85)",
          display: "flex", flexDirection: "column", gap: 20,
        }}
      >
        {/* ── header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {step === 2 && (
              <button onClick={goBack} style={{
                background: "none", border: "none", color: TEXT2,
                fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1,
              }}>←</button>
            )}
            <div style={{ fontSize: 17, fontWeight: 900, color: TEXT }}>
              {step === 1 ? "↗ שלח ל..." : `↗ ${dest}`}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: MUTED,
            fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0,
          }}>✕</button>
        </div>

        {/* ── step 1: בחירת יעד ── */}
        {step === 1 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {destinations.map(d => (
              <button
                key={d}
                onClick={() => { setDest(d); setSelection(d === "הפקה" ? "ויקטור" : null); setStep(2); }}
                style={{
                  padding: "22px 8px", borderRadius: 14,
                  border: `1.5px solid ${BORDER2}`,
                  background: CARD_BG2,
                  color: TEXT,
                  fontWeight: 700, fontSize: 13,
                  cursor: "pointer", fontFamily: "inherit",
                  textAlign: "center", transition: "none",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 8,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = PURPLE;
                  e.currentTarget.style.background = `${PURPLE}12`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = BORDER2;
                  e.currentTarget.style.background = CARD_BG2;
                }}
              >
                <span style={{ fontSize: 24 }}>
                  {d === "הפקה" ? "🎵" : d === "מיקס / מאסטר" ? "🎚" : "🎤"}
                </span>
                {d}
              </button>
            ))}
          </div>
        )}

        {/* ── step 2: בחירות משנה ── */}
        {step === 2 && dest === "הפקה" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            <ChoiceCard label="ויקטור" selected={selection === "ויקטור"} onClick={() => setSelection("ויקטור")} />
          </div>
        )}

        {step === 2 && dest === "מיקס / מאסטר" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {["Bill", "Steven"].map(name => (
              <ChoiceCard key={name} label={name} selected={selection === name} onClick={() => setSelection(name)} />
            ))}
          </div>
        )}

        {step === 2 && dest === "לקוח" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {CLIENT_CONTENT_TYPES.map(ct => (
              <ChoiceCard key={ct} label={ct} selected={selection === ct} onClick={() => setSelection(ct)} />
            ))}
          </div>
        )}

        {/* ── error ── */}
        {error && (
          <div style={{ fontSize: 12, color: RED_WARN, background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: "8px 12px" }}>
            {error}
          </div>
        )}

        {/* ── save button (step 2 only) ── */}
        {step === 2 && (
          <button
            onClick={handleSave}
            disabled={saving || !selection}
            style={{
              padding: "13px 0", borderRadius: 12, border: "none",
              background: (!selection || saving) ? MUTED : PURPLE,
              color: "#fff", fontWeight: 800, fontSize: 14,
              cursor: (!selection || saving) ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              boxShadow: (!selection || saving) ? "none" : `0 4px 18px ${PURPLE}55`,
              transition: "none",
            }}
          >
            {saving ? "שולח..." : "שלח"}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function ProjectDrawerV2({ projectId, onClose }: Props) {
  const { projects, refresh } = useProjects();
  const player = usePlayerSafe();

  const [isMobile,     setIsMobile]     = useState(false);
  const [activeTab,       setActiveTab]       = useState<DrawerTab>("סקירה");
  const [financeFormType, setFinanceFormType] = useState<"income" | "expense">("income");
  const [financeFormSeq,  setFinanceFormSeq]  = useState(0);
  const [quickTxOpen,  setQuickTxOpen]  = useState(false);
  const [quickTxMode,  setQuickTxMode]  = useState<"income" | "expense">("income");
  const [quickTxSeq,   setQuickTxSeq]   = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [agreedPrice,  setAgreedPrice]  = useState(0);
  const [currency,     setCurrency]     = useState("₪");
  const [finLoaded,    setFinLoaded]    = useState(false);
  const [sessions,        setSessions]        = useState<Session[]>([]);
  const [projectActions,  setProjectActions]  = useState<ProjectAction[]>([]);
  const [mounted,         setMounted]         = useState(false);
  const [scheduleAction, setScheduleAction] = useState<ActionDef | null>(null);
  const [showSendModal,  setShowSendModal]  = useState(false);
  const [copyFeedback,   setCopyFeedback]   = useState<"idle" | "copied" | "nolink">("idle");
  const uploadWrapRef  = useRef<HTMLDivElement>(null);
  const [uploadTitle,  setUploadTitle]  = useState("");

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

  useEffect(() => {
    setProjectActions([]);
    fetch(`/api/project-actions?projectId=${projectId}`)
      .then(r => r.json())
      .then(d => setProjectActions(d.actions ?? []))
      .catch(() => {});
  }, [projectId]);

  // MutationObserver: reads title attribute of the sm UploadButton to derive upload state/progress
  useEffect(() => {
    setUploadTitle("");
    const container = uploadWrapRef.current;
    if (!container) return;
    const btn = container.querySelector("button");
    if (!btn) return;
    const obs = new MutationObserver(() => setUploadTitle(btn.title ?? ""));
    obs.observe(btn, { attributes: true, attributeFilter: ["title"] });
    return () => obs.disconnect();
  }, [projectId, mounted]);

  async function handleDeleteAction(actionId: string): Promise<void> {
    const res = await fetch(`/api/project-actions/${actionId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("מחיקה נכשלה");
    setProjectActions(prev => prev.filter(a => a.id !== actionId));
  }

  const project = projects.find(p => p.id === projectId);
  if (!mounted || !project || isMobile) return null;

  const isUploading    = uploadTitle.startsWith("מעלה");
  const uploadDone     = uploadTitle === "הועלה בהצלחה ✓";
  const uploadProgress = isUploading
    ? Math.min(100, parseInt(uploadTitle.match(/(\d+)/)?.[1] ?? "0", 10))
    : uploadDone ? 100 : 0;

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
          .v2-upload-overlay { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
          .v2-upload-overlay > div { width: 100%; height: 100%; }
          .v2-upload-overlay button { width: 100% !important; height: 100% !important; border-radius: 0 !important; }
          .v2-select option { background: #111116 !important; color: #F4F4F4 !important; }
          .v2-select { color-scheme: dark; }
          input[type="number"]::-webkit-outer-spin-button,
          input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
          input[type="number"] { -moz-appearance: textfield; }
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
          <div dir="ltr" style={{
            display: "grid",
            gridTemplateColumns: "200px minmax(0, 580px) 490px",
            columnGap: 32,
            justifyContent: "center",
            marginBottom: 20,
            alignItems: "start",
            maxWidth: 1420,
            marginLeft: "auto",
            marginRight: "auto",
          }}>

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
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, position: "relative" }}>
                <span style={{
                  fontSize: 86, fontWeight: 900, lineHeight: 1, letterSpacing: -5,
                  color: accent,
                  textShadow: `0 0 60px ${accent}CC, 0 0 24px ${accent}77`,
                  userSelect: "none",
                }}>
                  {project.name.charAt(0)}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 800, color: "rgba(255,255,255,0.22)",
                  letterSpacing: "0.22em", textTransform: "uppercase",
                  userSelect: "none",
                }}>
                  PROJECT COVER
                </span>
              </div>
            </div>

            {/* ── Info + Stats ── */}
            <div dir="rtl" style={{
              display: "flex", flexDirection: "column",
              paddingTop: 6, paddingRight: 20,
            }}>
              {/* Name */}
              <div style={{
                fontSize: 48, fontWeight: 900, color: TEXT,
                letterSpacing: -2, lineHeight: 1,
                marginBottom: 12,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {project.name}
              </div>

              {/* Type + artist */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
                <span style={{
                  fontSize: 12, fontWeight: 800, color: accent,
                  background: `${accent}1C`, border: `1.5px solid ${accent}48`,
                  borderRadius: 8, padding: "4px 12px", letterSpacing: "0.06em",
                }}>
                  {project.projectType || "שיר"}
                </span>
                <span style={{ fontSize: 14, color: TEXT2, fontWeight: 600 }}>
                  🎤 {project.artist}
                </span>
              </div>

              {/* Stats — 2×2 grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 165px))", gap: 10 }}>

                {/* ── סטטוס ── */}
                <div style={{
                  background: CARD_BG2, borderRadius: 16,
                  border: `1px solid ${BORDER2}`,
                  padding: "11px 14px",
                  display: "flex", flexDirection: "column", gap: 8,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.62)", textTransform: "uppercase", letterSpacing: "0.13em" }}>סטטוס</div>
                  <div onClick={e => e.stopPropagation()}>
                    <StatusDropdown projectId={project.id} status={project.status} small />
                  </div>
                </div>

                {/* ── תאריך יעד ── */}
                <div style={{
                  background: CARD_BG2, borderRadius: 16,
                  border: `1px solid ${dlColor !== TEXT2 ? dlColor + "45" : BORDER2}`,
                  padding: "11px 14px",
                  display: "flex", flexDirection: "column", gap: 8,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.62)", textTransform: "uppercase", letterSpacing: "0.13em" }}>תאריך יעד</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: dlColor, lineHeight: 1.3 }}>
                    {project.deadline ? dlLabel : "—"}
                  </div>
                </div>

                {/* ── יתרה ── */}
                <div style={{
                  background: CARD_BG2, borderRadius: 16,
                  border: `1px solid ${BORDER2}`,
                  padding: "11px 14px",
                  display: "flex", flexDirection: "column", gap: 8,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.62)", textTransform: "uppercase", letterSpacing: "0.13em" }}>יתרה</div>
                  <div style={{
                    fontSize: finLoaded && balance !== 0 ? 18 : 15,
                    fontWeight: finLoaded && balance !== 0 ? 900 : 600,
                    lineHeight: 1,
                    color: finLoaded ? (balance > 0 ? RED_WARN : GREEN) : MUTED,
                  }}>
                    {finLoaded ? `${currency}${balance.toLocaleString()}` : "…"}
                  </div>
                </div>

                {/* ── מחיר מוסכם ── */}
                <div style={{
                  background: CARD_BG2, borderRadius: 16,
                  border: `1px solid ${BORDER2}`,
                  padding: "11px 14px",
                  display: "flex", flexDirection: "column", gap: 8,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.62)", textTransform: "uppercase", letterSpacing: "0.13em" }}>מחיר מוסכם</div>
                  <div style={{
                    fontSize: finLoaded && agreedPrice !== 0 ? 18 : 15,
                    fontWeight: finLoaded && agreedPrice !== 0 ? 900 : 600,
                    color: finLoaded && agreedPrice !== 0 ? TEXT : MUTED,
                    lineHeight: 1,
                  }}>
                    {finLoaded ? `${currency}${agreedPrice.toLocaleString()}` : "…"}
                  </div>
                </div>

              </div>
            </div>

            {/* ── Player column ── */}
            <div style={{
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              {/* Controls row */}
              <div dir="ltr" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
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
                    {latestFile ? (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          const link = (latestFile as { dropboxShareUrl?: string; url?: string }).dropboxShareUrl
                            ?? (latestFile as { url?: string }).url
                            ?? "";
                          if (!link) { setCopyFeedback("nolink"); setTimeout(() => setCopyFeedback("idle"), 1800); return; }
                          if (navigator?.clipboard?.writeText) {
                            navigator.clipboard.writeText(link).then(() => {
                              setCopyFeedback("copied");
                              setTimeout(() => setCopyFeedback("idle"), 1800);
                            }).catch(() => { setCopyFeedback("nolink"); setTimeout(() => setCopyFeedback("idle"), 1800); });
                          } else {
                            setCopyFeedback("nolink");
                            setTimeout(() => setCopyFeedback("idle"), 1800);
                          }
                        }}
                        style={{
                          background: "none", border: "none", padding: 0,
                          cursor: "pointer", fontFamily: "inherit",
                          fontSize: 12,
                          color: copyFeedback === "copied" ? GREEN : copyFeedback === "nolink" ? RED_WARN : TEXT2,
                          display: "flex", alignItems: "center", gap: 4,
                          transition: "color 0.15s",
                        }}
                        onMouseEnter={e => { if (copyFeedback === "idle") e.currentTarget.style.color = TEXT; }}
                        onMouseLeave={e => { if (copyFeedback === "idle") e.currentTarget.style.color = TEXT2; }}
                      >
                        {copyFeedback === "copied" ? "✓ הקישור הועתק" : copyFeedback === "nolink" ? "אין קישור" : "⎘ העתק לינק"}
                      </button>
                    ) : (
                      <div style={{ fontSize: 12, color: TEXT2 }}>העלה קובץ כדי לנגן</div>
                    )}
                  </div>

                  {latestFile && (
                    <div style={{ fontSize: 12, color: MUTED, fontWeight: 700, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                      {isPlaying || (player?.track?.projectId === projectId && (player?.currentTime ?? 0) > 0)
                        ? `${fmt(player?.currentTime ?? 0)} / ${player?.duration ? fmt(player.duration) : "--:--"}`
                        : "--:--"}
                    </div>
                  )}
                </div>

                {/* Waveform — progress + seek */}
                {(() => {
                  const thisTrack = player?.track?.projectId === projectId;
                  const wavePct   = thisTrack && (player?.duration ?? 0) > 0
                    ? (player!.currentTime / player!.duration)
                    : 0;
                  return (
                    <svg
                      width="100%" height="44"
                      viewBox="0 0 440 44"
                      preserveAspectRatio="none"
                      style={{ display: "block", cursor: latestFile ? "pointer" : "default" }}
                      onClick={latestFile && player && (player.duration ?? 0) > 0 ? (e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        player.seek(((e.clientX - rect.left) / rect.width) * player.duration);
                      } : undefined}
                    >
                      {WAVE_H.map((h, i) => {
                        const barPct = i / WAVE_H.length;
                        const fill = !latestFile
                          ? MUTED
                          : wavePct > 0 && barPct <= wavePct
                            ? BRAND
                            : wavePct > 0
                              ? "rgba(220,38,38,0.22)"
                              : isPlaying ? BRAND : MUTED;
                        return (
                          <rect
                            key={i}
                            x={i * 11} y={(44 - h) / 2}
                            width={4.5} height={h}
                            fill={fill} rx={2.5}
                            opacity={!latestFile ? 0.18 : 1}
                          />
                        );
                      })}
                    </svg>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* ── Quick Actions ─────────────────────────────────────────────── */}
          <div dir="rtl" style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            {([
              { label: "שלח",     icon: "↗",  color: "#8B5CF6", action: "send" },
              { label: "סשן חדש", icon: "📅", color: BLUE,      action: "session" },
              { label: "תשלום",   icon: "₪",  color: GREEN,     action: "income" },
            ] as { label: string; icon: string; color: string; action: string }[]).map(({ label, icon, color, action }) => (
              <button
                key={label}
                onClick={() => {
                  if (action === "send")    { setShowSendModal(true); return; }
                  if (action === "session") { setScheduleAction(ACTIONS[0]); return; }
                  setQuickTxMode("income"); setQuickTxSeq(s => s + 1); setQuickTxOpen(true);
                }}
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
                <span style={{ fontSize: action === "send" ? 22 : 26, lineHeight: 1, fontWeight: action === "send" ? 700 : 400 }}>{icon}</span>
                <span style={{ fontSize: 14, fontWeight: 800, lineHeight: 1 }}>{action === "send" ? label : `+ ${label}`}</span>
              </button>
            ))}

            {/* Upload */}
            <div ref={uploadWrapRef} style={{
              flex: 1, height: 74, borderRadius: 16,
              background: `linear-gradient(160deg, rgba(220,38,38,0.14) 0%, rgba(220,38,38,0.08) 100%)`,
              border: `1.5px solid ${isUploading ? "rgba(220,38,38,0.6)" : uploadDone ? "rgba(16,185,129,0.45)" : "rgba(220,38,38,0.34)"}`,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
              position: "relative", overflow: "hidden",
              boxShadow: isUploading
                ? `inset 0 1px 0 rgba(220,38,38,0.3), 0 0 20px rgba(220,38,38,0.15)`
                : `inset 0 1px 0 rgba(220,38,38,0.18)`,
              transition: "border-color 0.3s, box-shadow 0.3s",
            }}>
              {/* Progress fill bar */}
              {(isUploading || uploadDone) && (
                <div style={{
                  position: "absolute", top: 0, bottom: 0, left: 0,
                  width: `${uploadProgress}%`,
                  background: uploadDone
                    ? "rgba(16,185,129,0.18)"
                    : "rgba(220,38,38,0.2)",
                  borderRadius: 16,
                  transition: "width 0.5s ease",
                  pointerEvents: "none",
                }} />
              )}
              <span style={{ fontSize: 26, lineHeight: 1, pointerEvents: "none", position: "relative", zIndex: 1 }}>
                {uploadDone ? "✓" : "☁"}
              </span>
              <span style={{
                fontSize: 14, fontWeight: 800,
                color: uploadDone ? GREEN : BRAND,
                lineHeight: 1, pointerEvents: "none", position: "relative", zIndex: 1,
              }}>
                {isUploading
                  ? `מעלה... ${uploadProgress > 0 ? `${uploadProgress}%` : ""}`.trim()
                  : uploadDone ? "הועלה ✓"
                  : "העלאת קובץ"}
              </span>
              <div className="v2-upload-overlay">
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
                    color: active ? BRAND : LABEL,
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
                  onMouseLeave={e => { if (!active) e.currentTarget.style.color = LABEL; }}
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
              projectActions={projectActions}
              onDeleteAction={handleDeleteAction}
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
          ) : activeTab === "כספים" ? (
            <FinanceContent
              key={`fin-${financeFormSeq}`}
              transactions={transactions}
              agreedPrice={agreedPrice}
              currency={currency}
              finLoaded={finLoaded}
              received={received}
              totalExp={totalExp}
              balance={balance}
              projectId={projectId}
              initialFormType={financeFormType}
              onTxAdded={() => {
                fetch(`/api/transactions?projectId=${projectId}`)
                  .then(r => r.json())
                  .then(d => {
                    setTransactions(d.transactions ?? []);
                    setAgreedPrice(d.agreedPrice ?? 0);
                  })
                  .catch(() => {});
              }}
              onPriceUpdate={(newPrice: number) => setAgreedPrice(newPrice)}
            />
          ) : activeTab === "סשנים" ? (
            <SessionsContent sessions={sessions} sessDone={sessDone} />
          ) : activeTab === "קבצים" ? (
            <FilesContent project={project} onFileDeleted={refresh} />
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

      {/* ── Quick Transaction Modal ── */}
      {quickTxOpen && (
        <QuickTransactionModal
          mode={quickTxMode}
          projectId={projectId}
          currency={currency}
          formKey={quickTxSeq}
          onSaved={() => {
            fetch(`/api/transactions?projectId=${projectId}`)
              .then(r => r.json())
              .then(d => {
                setTransactions(d.transactions ?? []);
                setAgreedPrice(d.agreedPrice ?? 0);
              })
              .catch(() => {});
          }}
          onClose={() => setQuickTxOpen(false)}
        />
      )}

      {/* ── Schedule Session Modal ── */}
      {scheduleAction && (
        <ScheduleModal
          action={scheduleAction}
          projectId={projectId}
          projectName={project.name}
          artist={project.artist}
          onClose={() => setScheduleAction(null)}
          onSessionCreated={() => {
            fetch(`/api/sessions?projectId=${projectId}`)
              .then(r => r.json())
              .then(d => setSessions(d.sessions ?? []))
              .catch(() => {});
            setScheduleAction(null);
          }}
        />
      )}
      {showSendModal && (
        <SendModal
          projectId={projectId}
          artistName={project.artist}
          onClose={() => setShowSendModal(false)}
          onActionSent={action => setProjectActions(prev => [action, ...prev])}
        />
      )}
    </div>,
    document.body
  );
}

// ─── Overview tab ──────────────────────────────────────────────────────────────
function OverviewContent({
  project, transactions, sessions, projectActions,
  agreedPrice, currency, finLoaded, accent,
  received, totalExp, balance,
  pct, filesCount, sessDone, statusColor, onTabChange, onDeleteAction,
}: {
  project:         Project;
  transactions:    Transaction[];
  sessions:        Session[];
  projectActions:  ProjectAction[];
  agreedPrice:     number;
  currency:        string;
  finLoaded:       boolean;
  accent:          string;
  received:        number;
  totalExp:        number;
  balance:         number;
  pct:             number;
  filesCount:      number;
  sessDone:        number;
  statusColor:     string;
  onTabChange:     (t: DrawerTab) => void;
  onDeleteAction:  (id: string) => Promise<void>;
}) {
  const days = daysUntilDeadline(project.deadline);

  // ── פיד עדכונים — state ──────────────────────────────────────────────
  const FEED_PAGE_SIZE = 5;
  const [feedPage,         setFeedPage]         = useState(0);
  const [deletingActionId, setDeletingActionId] = useState<string | null>(null);
  const [deleteErrorId,    setDeleteErrorId]    = useState<string | null>(null);
  const [confirmDeleteId,  setConfirmDeleteId]  = useState<string | null>(null);

  async function handleDeleteFeedAction(actionId: string) {
    setDeletingActionId(actionId);
    setDeleteErrorId(null);
    setConfirmDeleteId(null);
    try {
      await onDeleteAction(actionId);
    } catch {
      setDeleteErrorId(actionId);
      setTimeout(() => setDeleteErrorId(null), 3000);
    } finally {
      setDeletingActionId(null);
    }
  }

  // אפס עמוד כשמקורות הנתונים משתנים
  useEffect(() => { setFeedPage(0); }, [transactions.length, sessions.length, (project.files ?? []).length, projectActions.length]);

  // ── בניית פיד מלא ────────────────────────────────────────────────────
  type FeedItem = { icon: string; title: string; sub?: string; sortKey: string; displayDate?: string; displayTime?: string; color: string; actionId?: string };

  const txStatusColor = (status: string, type: "income" | "expense"): string => {
    if (status === "התקבל" || status === "שולם") return GREEN;
    if (status === "לא שולם") return type === "expense" ? RED_WARN : MUTED;
    if (status === "בוטל")   return MUTED;
    if (status === "חלקי")   return AMBER;
    if (status === "צפוי")   return AMBER;
    return type === "income" ? GREEN : AMBER;
  };

  const txTitle = (status: string, type: "income" | "expense", amount: number): string => {
    const amt = `${currency}${amount.toLocaleString()}`;
    if (type === "income") {
      if (status === "התקבל") return `התקבל תשלום: ${amt}`;
      if (status === "שולם")  return `שולם תשלום: ${amt}`;
      if (status === "חלקי")  return `חלקי תשלום: ${amt}`;
      return `${status} תשלום: ${amt}`;
    } else {
      if (status === "שולם")     return `שולם הוצאה: ${amt}`;
      if (status === "לא שולם")  return `לא שולם הוצאה: ${amt}`;
      if (status === "בוטל")     return `בוטל הוצאה: ${amt}`;
      return `${status} הוצאה: ${amt}`;
    }
  };

  const sessionTitle = (status: string): string => {
    if (status === "מתוכנן" || status === "נקבע") return "סשן נקבע";
    if (status === "התקיים") return "סשן התקיים";
    if (status === "בוטל" || status === "נדחה")   return "סשן נדחה";
    return `סשן: ${status}`;
  };

  const fmtDisplayDate = (d?: string | null): string | undefined => {
    if (!d) return undefined;
    try {
      return new Date(d).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" });
    } catch { return undefined; }
  };

  const fmtTime = (iso?: string | null): string | undefined => {
    if (!iso) return undefined;
    try {
      return new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    } catch { return undefined; }
  };

  const allFeedItems: FeedItem[] = [];

  // Sessions — כולם, ללא filter על date
  sessions.forEach(s => {
    allFeedItems.push({
      icon: "📅",
      title: sessionTitle(s.status),
      sortKey: s.created_at ?? s.date ?? "",
      displayDate: fmtDisplayDate(s.date) ?? "ללא תאריך",
      displayTime: s.start_time?.slice(0, 5),
      color: BLUE,
    });
  });

  // Transactions — כולם
  if (finLoaded) {
    transactions.forEach(tx => {
      allFeedItems.push({
        icon: tx.type === "income" ? "₪" : "💸",
        title: txTitle(tx.payment_status, tx.type, tx.amount),
        sub: tx.description || undefined,
        sortKey: tx.created_at ?? tx.date ?? "",
        displayDate: fmtDisplayDate(tx.date ?? tx.created_at) ?? "ללא תאריך",
        displayTime: fmtTime(tx.created_at),
        color: txStatusColor(tx.payment_status, tx.type),
      });
    });
  }

  // Files — כולם, כותרת "הועלה קובץ", ללא תאריך (FileLink אין timestamp)
  (project.files ?? []).forEach(() => {
    allFeedItems.push({
      icon: "📁",
      title: "הועלה קובץ",
      sortKey: "",
      displayDate: "ללא תאריך",
      color: TEXT2,
    });
  });

  // Project actions — שליחות (מ-GET /api/project-actions + optimistic אחרי POST)
  const actionFeedTitle = (a: ProjectAction): string => {
    const name = a.recipient_name ?? "";
    const role = a.recipient_role ?? "";
    const ct   = a.content_type  ?? "";
    // הפקה (עברית או אנגלית)
    if (role === "external_producer" || role === "הפקה" || ct === "הפקה")
      return `נשלח להפקה${name ? `: ${name}` : ""}`;
    // מיקס / מאסטר
    if (role === "sound_engineer" || role === "מיקס" || role === "מאסטר" || role === "מיקס / מאסטר" || ct === "מיקס / מאסטר")
      return `נשלח למיקס / מאסטר${name ? `: ${name}` : ""}`;
    // לקוח — מציגים את content_type כסוג השליחה
    if (role === "client" || role === "לקוח")
      return `נשלח ללקוח${ct ? `: ${ct}` : name ? `: ${name}` : ""}`;
    // fallback — מנסה להציג context מובן
    if (ct)   return `נשלח: ${ct}`;
    if (name) return `נשלח: ${name}`;
    return "נשלח";
  };

  projectActions.forEach(a => {
    allFeedItems.push({
      icon: "📤",
      title: actionFeedTitle(a),
      sortKey: a.created_at ?? a.action_date ?? "",
      displayDate: fmtDisplayDate(a.action_date ?? a.created_at) ?? "ללא תאריך",
      displayTime: fmtTime(a.created_at),
      color: PURPLE,
      actionId: a.id,
    });
  });

  // מיון: date יורד; ללא date (sortKey = "") → סוף הפיד
  allFeedItems.sort((a, b) => {
    if (!a.sortKey && !b.sortKey) return 0;
    if (!a.sortKey) return 1;
    if (!b.sortKey) return -1;
    return b.sortKey.localeCompare(a.sortKey);
  });

  const totalFeedPages = Math.max(1, Math.ceil(allFeedItems.length / FEED_PAGE_SIZE));
  const visibleFeedItems = allFeedItems.slice(feedPage * FEED_PAGE_SIZE, (feedPage + 1) * FEED_PAGE_SIZE);


  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gridTemplateRows: "auto auto",
      gap: 14,
      height: "100%",
      minHeight: 0,
    }}>

      {/* ── ROWS 1-2 COL 3: עדכונים אחרונים (גדול — RTL שמאל) ─────────── */}
      <Card style={{ gridColumn: 3, gridRow: "1 / 3" }}>
        <CardTitle>עדכונים אחרונים</CardTitle>

        {allFeedItems.length === 0 ? (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 10,
          }}>
            <span style={{ fontSize: 36, opacity: 0.22 }}>📋</span>
            <div style={{ fontSize: 13, color: MUTED }}>עדיין אין פעילות בפרויקט</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            {/* פריטי הפיד */}
            <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
              {visibleFeedItems.map((item, i) => {
                  const isConfirm = item.actionId ? confirmDeleteId === item.actionId : false;
                  return (
                    <div key={i} style={{
                      position: "relative",
                      display: "flex",
                      flexDirection: isConfirm ? "column" : "row",
                      alignItems: isConfirm ? "stretch" : "center",
                      gap: isConfirm ? 0 : 12,
                      padding: (!isConfirm && item.actionId) ? "11px 13px 11px 36px" : "11px 13px",
                      borderRadius: 12,
                      background: CARD_BG2,
                      border: `1px solid ${deleteErrorId === item.actionId ? RED_WARN + "55" : isConfirm ? RED_WARN + "33" : BORDER}`,
                      transition: "border-color 0.2s",
                    }}>
                      {/* שורה ראשית — תמיד מוצגת */}
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 16, flexShrink: 0, color: item.color }}>{item.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 13, fontWeight: 700, color: TEXT,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{item.title}</div>
                          {item.sub && (
                            <div style={{ fontSize: 11, color: LABEL, marginTop: 2 }}>
                              {item.sub.slice(0, 50)}
                            </div>
                          )}
                          {item.actionId && deleteErrorId === item.actionId && (
                            <div style={{ fontSize: 11, color: RED_WARN, marginTop: 2 }}>שגיאה במחיקה</div>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: TEXT2, flexShrink: 0, fontWeight: 500 }}>
                          {item.displayDate}
                          {item.displayTime && (
                            <span style={{ color: MUTED }}> · {item.displayTime}</span>
                          )}
                        </span>
                      </div>
                      {/* X — רק במצב רגיל */}
                      {!isConfirm && item.actionId && (
                        <button
                          onClick={() => { if (deletingActionId !== item.actionId) setConfirmDeleteId(item.actionId!); }}
                          disabled={deletingActionId === item.actionId}
                          title="מחק פעולה"
                          style={{
                            position: "absolute", top: "50%", transform: "translateY(-50%)",
                            left: 10, zIndex: 2,
                            background: "none", border: "none",
                            cursor: deletingActionId === item.actionId ? "default" : "pointer",
                            color: MUTED,
                            fontSize: 13, lineHeight: 1, padding: "4px 6px",
                            borderRadius: 6, opacity: 0.7, fontFamily: "inherit",
                            minWidth: 22, minHeight: 22,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            transition: "color 0.15s, opacity 0.15s",
                          }}
                          onMouseEnter={e => { if (deletingActionId !== item.actionId) { (e.currentTarget as HTMLElement).style.color = RED_WARN; (e.currentTarget as HTMLElement).style.opacity = "1"; } }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = MUTED; (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
                        >
                          {deletingActionId === item.actionId ? "…" : "✕"}
                        </button>
                      )}
                      {/* Confirm row — רק במצב confirm */}
                      {isConfirm && (
                        <div style={{
                          display: "flex", alignItems: "center", gap: 6,
                          marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BORDER}`,
                        }}>
                          <span style={{ fontSize: 11, color: TEXT2, flex: 1 }}>למחוק פעולה זו?</span>
                          <button
                            onClick={() => handleDeleteFeedAction(item.actionId!)}
                            style={{
                              fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6,
                              background: "rgba(239,68,68,0.18)", border: `1px solid ${RED_WARN}55`,
                              color: RED_WARN, cursor: "pointer", fontFamily: "inherit", lineHeight: 1,
                            }}
                          >אישור</button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            style={{
                              fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6,
                              background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER}`,
                              color: MUTED, cursor: "pointer", fontFamily: "inherit", lineHeight: 1,
                            }}
                          >בטל</button>
                        </div>
                      )}
                    </div>
                  );
              })}
            </div>

            {/* Pagination */}
            {totalFeedPages > 1 && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDER}`,
              }}>
                <button
                  onClick={() => setFeedPage(p => Math.max(0, p - 1))}
                  disabled={feedPage === 0}
                  style={{
                    background: "none", border: `1px solid ${BORDER2}`, borderRadius: 8,
                    padding: "5px 10px", fontSize: 12, color: feedPage === 0 ? MUTED : TEXT2,
                    cursor: feedPage === 0 ? "default" : "pointer", fontFamily: "inherit",
                  }}
                >← הקודם</button>
                <span style={{ fontSize: 11, color: MUTED }}>
                  {feedPage + 1} / {totalFeedPages}
                </span>
                <button
                  onClick={() => setFeedPage(p => Math.min(totalFeedPages - 1, p + 1))}
                  disabled={feedPage >= totalFeedPages - 1}
                  style={{
                    background: "none", border: `1px solid ${BORDER2}`, borderRadius: 8,
                    padding: "5px 10px", fontSize: 12,
                    color: feedPage >= totalFeedPages - 1 ? MUTED : TEXT2,
                    cursor: feedPage >= totalFeedPages - 1 ? "default" : "pointer", fontFamily: "inherit",
                  }}
                >הבא →</button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── ROW 1 COL 1: התקדמות כללית ────────────────────────────────── */}
      <Card style={{ gridColumn: 1, gridRow: 1, alignItems: "center" }}>
        <CardTitle>התקדמות כללית</CardTitle>
        <div style={{ position: "relative", width: 118, height: 118, flexShrink: 0, marginBottom: 12 }}>
          <Arc pct={pct} accent={accent} size={118} />
          {/* pct% — geometric center of circle */}
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: 29, fontWeight: 900, color: TEXT, letterSpacing: -1, lineHeight: 1,
            pointerEvents: "none",
          }}>{pct}%</div>
        </div>
        <div style={{ fontSize: 13, color: TEXT, fontWeight: 700, marginBottom: 16 }}>{project.status}</div>
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
              <span style={{ fontSize: 12, color: LABEL }}>{label}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color }}>{val}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── ROW 2 COL 1: פרטים כלליים ─────────────────────────────────── */}
      <Card style={{ gridColumn: 1, gridRow: 2 }}>
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
              <span style={{ fontSize: 12, color: LABEL }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: color ?? TEXT2 }}>{val}</span>
            </div>
          ))}
        </div>
        {project.notes && (
          <div style={{
            marginTop: 10, padding: "11px 13px", background: CARD_BG2,
            borderRadius: 11, fontSize: 12, color: TEXT2, lineHeight: 1.7,
            border: `1px solid ${BORDER}`,
          }}>
            {project.notes.slice(0, 130)}{project.notes.length > 130 ? "…" : ""}
          </div>
        )}
      </Card>

      {/* ── ROW 1 COL 2: סיכום כספי ────────────────────────────────────── */}
      <Card style={{ gridColumn: 2, gridRow: 1 }}>
        <CardTitle>סיכום כספי</CardTitle>
        {finLoaded ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
            {/* 2×2 grid */}
            {(() => {
              const netProfit = received - totalExp;
              const npColor = netProfit >= 0 ? GREEN : RED_WARN;
              const cells = [
                { label: "מחיר מוסכם", val: agreedPrice, color: TEXT,    bg: CARD_BG2,          border: BORDER },
                { label: "התקבל",       val: received,    color: GREEN,   bg: `${GREEN}0C`,      border: `${GREEN}2A` },
                { label: "הוצאות",      val: totalExp,    color: AMBER,   bg: `${AMBER}0A`,      border: `${AMBER}28` },
                { label: "רווח נקי",    val: netProfit,   color: npColor, bg: `${npColor}0B`,    border: `${npColor}28` },
              ];
              return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                  {cells.map(({ label, val, color, bg, border }) => (
                    <div key={label} style={{
                      padding: "12px 14px", borderRadius: 12,
                      background: bg, border: `1px solid ${border}`,
                      display: "flex", flexDirection: "column", gap: 6,
                    }}>
                      <div style={{ fontSize: 10, color: LABEL, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em" }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color }}>
                        {val < 0 ? "-" : ""}{currency}{Math.abs(val).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
            {/* Divider */}
            <div style={{ height: 1, background: BORDER, margin: "2px 0" }} />
            {/* Highlight */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "14px 16px", borderRadius: 14,
              background: balance > 0 ? "rgba(239,68,68,0.13)" : `${GREEN}13`,
              border: `1.5px solid ${balance > 0 ? "rgba(239,68,68,0.38)" : GREEN + "48"}`,
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: balance > 0 ? RED_WARN : GREEN }}>
                {balance > 0 ? "יתרה לקבלה" : balance < 0 ? "שולם ביתר" : "שולם במלואו ✓"}
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


    </div>
  );
}

// ─── Tab: כספים ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  "שולם": "#10B981", "התקבל": "#10B981",
  "צפוי": "#F59E0B", "חלקי": "#F59E0B", "לבדיקה": "#F59E0B",
  "לא שולם": "#EF4444", "בוטל": "#555568",
};

const PAYMENT_METHODS = ["העברה בנקאית", "Bit", "PayBox", "מזומן", "צ'ק", "אחר"];
const EXPENSE_CATEGORIES = ["שירותים", "ציוד", "אולפן", "שיווק", "אחר"];
const INCOME_STATUSES:  PaymentStatus[] = ["התקבל", "צפוי"];
const EXPENSE_STATUSES: PaymentStatus[] = ["שולם", "צפוי", "בוטל"];

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", borderRadius: 11, fontSize: 14,
  background: CARD_BG2, border: `1px solid ${BORDER2}`,
  color: TEXT, outline: "none", fontFamily: "inherit",
  boxSizing: "border-box" as const, height: 46,
};

function FieldWrap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, color: TEXT2, fontWeight: 700, letterSpacing: "0.05em" }}>{label}</label>
      {children}
    </div>
  );
}

// ─── QuickTransactionForm ─────────────────────────────────────────────────────
// Self-contained form card. Used in FinanceContent tab and QuickTransactionModal.
function QuickTransactionForm({
  initialType, projectId, currency, onSaved,
}: {
  initialType: "income" | "expense";
  projectId:   string;
  currency:    string;
  onSaved:     () => void;
}) {
  const [formType,    setFormType]    = useState<"income" | "expense">(initialType);
  const [fAmount,     setFAmount]     = useState("");
  const [fStatus,     setFStatus]     = useState<PaymentStatus>(initialType === "expense" ? "שולם" : "התקבל");
  const [fDate,       setFDate]       = useState(() => new Date().toISOString().slice(0, 10));
  const [fMethod,     setFMethod]     = useState("");
  const [fNote,       setFNote]       = useState("");
  const [fCat,        setFCat]        = useState("");
  const [fReceiptRef, setFReceiptRef] = useState("");
  const [saving,      setSaving]      = useState(false);
  const [saveErr,     setSaveErr]     = useState("");

  const accentForm = formType === "income" ? GREEN : AMBER;

  async function handleSave() {
    if (!fAmount || saving) return;
    setSaving(true);
    setSaveErr("");
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          type: formType,
          amount: Number(fAmount),
          paymentStatus: fStatus,
          date: fDate || null,
          paymentMethod: formType === "income" ? fMethod : "",
          category: formType === "expense" ? fCat : "",
          description: fNote,
          receiptRef: fReceiptRef.trim(),
        }),
      });
      if (!res.ok) { setSaveErr("שגיאה בשמירה"); return; }
      setFAmount(""); setFDate(new Date().toISOString().slice(0, 10)); setFMethod(""); setFNote(""); setFCat(""); setFReceiptRef("");
      setFStatus(formType === "expense" ? "שולם" : "התקבל");
      onSaved();
    } catch {
      setSaveErr("שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      background: CARD_BG, borderRadius: 18,
      border: `1px solid ${accentForm}30`,
      padding: "22px 24px",
      display: "flex", flexDirection: "column", gap: 14,
      boxShadow: `0 0 0 1px ${accentForm}10`,
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, marginBottom: 2 }}>
        {formType === "income" ? "➕ הוספת תשלום" : "➕ הוספת הוצאה"}
      </div>

      {/* Toggle */}
      <div style={{
        display: "flex", gap: 6, padding: 5,
        background: "rgba(0,0,0,0.30)", borderRadius: 14,
        border: `1px solid ${BORDER}`,
      }}>
        {(["income", "expense"] as const).map(t => {
          const active = formType === t;
          const ac = t === "income" ? GREEN : AMBER;
          return (
            <button key={t} onClick={() => { setFormType(t); setFStatus(t === "expense" ? "שולם" : "התקבל"); setFMethod(""); setFCat(""); }} style={{
              flex: 1, padding: "11px 0", borderRadius: 10, cursor: "pointer",
              background: active ? `${ac}22` : "transparent",
              border: active ? `1px solid ${ac}55` : "1px solid transparent",
              color: active ? ac : LABEL,
              fontSize: 14, fontWeight: 800, fontFamily: "inherit", transition: "none",
            }}>
              {t === "income" ? "תשלום" : "הוצאה"}
            </button>
          );
        })}
      </div>

      <FieldWrap label="סכום *">
        <input
          type="text" inputMode="numeric" placeholder="₪ 0"
          value={fAmount} onChange={e => setFAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          style={{ ...inputStyle, fontSize: 18, fontWeight: 700, color: accentForm }}
        />
      </FieldWrap>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <FieldWrap label="סטטוס">
          <select className="v2-select" value={fStatus} onChange={e => setFStatus(e.target.value as PaymentStatus)} style={inputStyle}>
            {(formType === "income" ? INCOME_STATUSES : EXPENSE_STATUSES).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FieldWrap>
        <FieldWrap label="תאריך">
          <DatePickerInput value={fDate} onChange={setFDate} style={inputStyle} />
        </FieldWrap>
      </div>

      {formType === "income" ? (
        <FieldWrap label="אמצעי תשלום">
          <select className="v2-select" value={fMethod} onChange={e => setFMethod(e.target.value)} style={inputStyle}>
            <option value="">בחר…</option>
            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </FieldWrap>
      ) : (
        <FieldWrap label="קטגוריה">
          <select className="v2-select" value={fCat} onChange={e => setFCat(e.target.value)} style={inputStyle}>
            <option value="">בחר…</option>
            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </FieldWrap>
      )}

      <FieldWrap label="אסמכתא">
        <div style={{ position: "relative" }}>
          <input
            type="url" placeholder="הדבק קישור לאסמכתא…"
            value={fReceiptRef} onChange={e => setFReceiptRef(e.target.value)}
            style={{ ...inputStyle, paddingLeft: fReceiptRef.trim() ? 68 : 14 }}
          />
          <span style={{
            position: "absolute", top: "50%", right: 14, transform: "translateY(-50%)",
            fontSize: 13, opacity: 0.35, pointerEvents: "none", lineHeight: 1,
          }}>🔗</span>
          {fReceiptRef.trim() && (
            <a href={fReceiptRef.trim()} target="_blank" rel="noopener noreferrer" style={{
              position: "absolute", top: "50%", left: 10, transform: "translateY(-50%)",
              fontSize: 11, fontWeight: 700, color: "#60A5FA",
              background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)",
              borderRadius: 6, padding: "3px 8px", textDecoration: "none",
              whiteSpace: "nowrap", lineHeight: 1.4,
            }}>פתח</a>
          )}
        </div>
      </FieldWrap>

      <FieldWrap label="הערה / תיאור">
        <input
          type="text" placeholder="תיאור קצר…"
          value={fNote} onChange={e => setFNote(e.target.value)}
          style={inputStyle}
        />
      </FieldWrap>

      {saveErr && (
        <div style={{ fontSize: 12, color: RED_WARN, background: `${RED_WARN}12`, borderRadius: 8, padding: "8px 12px" }}>
          {saveErr}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          width: "100%", padding: "15px 0", borderRadius: 12,
          background: !fAmount ? `${accentForm}18` : saving ? `${accentForm}88` : accentForm,
          border: !fAmount ? `1.5px dashed ${accentForm}44` : "none",
          color: !fAmount ? accentForm : "#000",
          fontSize: 15, fontWeight: 900,
          cursor: saving || !fAmount ? "default" : "pointer",
          fontFamily: "inherit", transition: "none",
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? "שומר…" : !fAmount ? "הזן סכום לשמירה" : formType === "income" ? "שמור תשלום ✓" : "שמור הוצאה ✓"}
      </button>
    </div>
  );
}

// ─── QuickTransactionModal ─────────────────────────────────────────────────────
function QuickTransactionModal({
  mode, projectId, currency, formKey, onSaved, onClose,
}: {
  mode:      "income" | "expense";
  projectId: string;
  currency:  string;
  formKey:   number;
  onSaved:   () => void;
  onClose:   () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const accent = mode === "income" ? GREEN : AMBER;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 199999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* overlay */}
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} />
      {/* card */}
      <div dir="rtl" style={{
        position: "relative", width: 460, maxHeight: "90vh", overflowY: "auto",
        borderRadius: 22,
        background: "linear-gradient(160deg, #12121A 0%, #0E0E14 100%)",
        border: `1.5px solid ${accent}40`,
        boxShadow: `0 32px 80px rgba(0,0,0,0.85), 0 0 0 1px ${accent}18`,
        padding: 4,
      }}>
        {/* X close */}
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 14, left: 14, zIndex: 1,
            width: 32, height: 32, borderRadius: "50%",
            background: "rgba(255,255,255,0.07)", border: `1px solid ${BORDER2}`,
            color: TEXT2, fontSize: 16, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "inherit", transition: "none", outline: "none",
          }}
        >✕</button>
        <QuickTransactionForm
          key={formKey}
          initialType={mode}
          projectId={projectId}
          currency={currency}
          onSaved={() => { onSaved(); onClose(); }}
        />
      </div>
    </div>,
    document.body
  );
}

// ─── FinanceContent ────────────────────────────────────────────────────────────
function FinanceContent({
  transactions, agreedPrice, currency, finLoaded, received, totalExp, balance,
  projectId, initialFormType, onTxAdded, onPriceUpdate,
}: {
  transactions:    Transaction[];
  agreedPrice:     number;
  currency:        string;
  finLoaded:       boolean;
  received:        number;
  totalExp:        number;
  balance:         number;
  projectId:       string;
  initialFormType: "income" | "expense";
  onTxAdded:       () => void;
  onPriceUpdate:   (newPrice: number) => void;
}) {
  const [deletingTxId,    setDeletingTxId]    = useState<string | null>(null);
  const [txActionLoading, setTxActionLoading] = useState<string | null>(null);
  const [statusMenuTxId,  setStatusMenuTxId]  = useState<string | null>(null);

  // ── edit agreed price ──────────────────────────────────────────────
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput,   setPriceInput]   = useState("");
  const [priceSaving,  setPriceSaving]  = useState(false);
  const [priceFeedback, setPriceFeedback] = useState<"" | "saved" | "error">("");

  async function handleSavePrice() {
    const cleaned = priceInput.replace(/[₪,\s]/g, "");
    const val = Number(cleaned);
    if (!cleaned || isNaN(val) || val < 0) { setPriceFeedback("error"); return; }
    setPriceSaving(true);
    try {
      const res = await fetch(`/api/transactions?projectId=${encodeURIComponent(projectId)}&type=settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreedPrice: val }),
      });
      if (!res.ok) throw new Error();
      onPriceUpdate(val);
      setEditingPrice(false);
      setPriceFeedback("saved");
      setTimeout(() => setPriceFeedback(""), 2000);
    } catch {
      setPriceFeedback("error");
    } finally {
      setPriceSaving(false);
    }
  }

  async function handleDeleteTx(id: string) {
    setTxActionLoading(id);
    setDeletingTxId(null);
    try {
      await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      onTxAdded();
    } finally {
      setTxActionLoading(null);
    }
  }

  async function handleMarkPaid(tx: Transaction) {
    setTxActionLoading(tx.id);
    try {
      await fetch(`/api/transactions/${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStatus: tx.type === "income" ? "התקבל" : "שולם" }),
      });
      onTxAdded();
    } finally {
      setTxActionLoading(null);
    }
  }

  const incomes  = transactions.filter(t => t.type === "income");
  const expenses = transactions.filter(t => t.type === "expense");

  const pctOf = (n: number) => agreedPrice > 0 ? Math.round(n / agreedPrice * 100) : 0;

  const kpis = [
    { label: "מחיר מוסכם", value: agreedPrice,       color: TEXT,     sub: "סכום כולל" },
    { label: "התקבל",       value: received,          color: GREEN,    sub: `${pctOf(received)}% מהסכום` },
    { label: "הוצאות",      value: totalExp,          color: AMBER,    sub: `${pctOf(totalExp)}% מהסכום` },
    { label: "יתרה לקבלה", value: Math.abs(balance), color: balance > 0 ? RED_WARN : GREEN,
      sub: balance > 0 ? "טרם שולם" : balance < 0 ? "שולם ביתר" : "שולם במלואו ✓" },
  ];

  const CardHdr = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 14, letterSpacing: "0.02em" }}>
      {children}
    </div>
  );

  return (
    <div dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── KPI row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {kpis.map(({ label, value, color, sub }) => {
          const isAgreed = label === "מחיר מוסכם";
          return (
            <div key={label} style={{
              background: `${color}0D`, borderRadius: 16,
              border: `1px solid ${color}28`, padding: "18px 20px",
              position: "relative",
            }}>
              {/* Header row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.62)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em" }}>
                  {label}
                </div>
                {isAgreed && !editingPrice && (
                  <button
                    onClick={() => { setPriceInput(agreedPrice > 0 ? String(agreedPrice) : ""); setEditingPrice(true); setPriceFeedback(""); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, fontSize: 12, padding: 0, fontFamily: "inherit" }}
                    title="ערוך מחיר מוסכם"
                  >✏️</button>
                )}
              </div>

              {/* Value or edit input */}
              {isAgreed && editingPrice ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    autoFocus
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    value={priceInput}
                    onChange={e => { setPriceInput(e.target.value); setPriceFeedback(""); }}
                    onKeyDown={e => { if (e.key === "Enter") handleSavePrice(); if (e.key === "Escape") setEditingPrice(false); }}
                    style={{
                      width: "100%", padding: "7px 10px", borderRadius: 8, fontSize: 18, fontWeight: 900,
                      background: "rgba(255,255,255,0.07)", border: `1.5px solid ${priceFeedback === "error" ? RED_WARN : BORDER2}`,
                      color: TEXT, outline: "none", fontFamily: "inherit", boxSizing: "border-box",
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={handleSavePrice}
                      disabled={priceSaving}
                      style={{
                        flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 12, fontWeight: 700,
                        background: GREEN, border: "none", color: "#fff", cursor: priceSaving ? "default" : "pointer",
                        fontFamily: "inherit", opacity: priceSaving ? 0.7 : 1,
                      }}
                    >{priceSaving ? "…" : "שמור"}</button>
                    <button
                      onClick={() => { setEditingPrice(false); setPriceFeedback(""); }}
                      style={{
                        flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 12, fontWeight: 700,
                        background: "none", border: `1px solid ${BORDER2}`, color: TEXT2,
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >בטל</button>
                  </div>
                  {priceFeedback === "error" && (
                    <div style={{ fontSize: 11, color: RED_WARN }}>ערך לא תקין</div>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1, marginBottom: 7 }}>
                    {finLoaded ? `${currency}${value.toLocaleString()}` : "…"}
                  </div>
                  <div style={{ fontSize: 12, color: TEXT2, fontWeight: 600 }}>
                    {isAgreed && priceFeedback === "saved" ? <span style={{ color: GREEN }}>✓ נשמר</span> : sub}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* ── body: form right | incomes | expenses ── */}
      {/* RTL: first child = rightmost. Grid: 360px form | 1fr incomes | 1fr expenses */}
      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr 1fr", gap: 14, alignItems: "start" }}>

        {/* ── הוספת תשלום (RIGHT in RTL) ── */}
        <QuickTransactionForm
          initialType={initialFormType}
          projectId={projectId}
          currency={currency}
          onSaved={onTxAdded}
        />

        {/* ── תשלומים שהתקבלו ── */}
        <div style={{ background: CARD_BG, borderRadius: 18, border: `1px solid ${BORDER}`, padding: "22px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
          <CardHdr>תשלומים שהתקבלו</CardHdr>
          {incomes.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "22px 16px",
              background: CARD_BG2, borderRadius: 14, border: `1px solid ${BORDER}`,
            }}>
              <span style={{ fontSize: 24, opacity: 0.22 }}>₪</span>
              <div style={{ fontSize: 13, color: MUTED }}>אין תשלומים עדיין</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {incomes.map(tx => {
                const col          = STATUS_COLORS[tx.payment_status] ?? TEXT2;
                const isLoading    = txActionLoading === tx.id;
                const isDelConf    = deletingTxId === tx.id;
                const isStatusOpen = statusMenuTxId === tx.id;
                const canMarkPaid  = tx.payment_status === "צפוי";
                return (
                  <div key={tx.id} style={{
                    padding: "13px 15px", background: CARD_BG2,
                    borderRadius: 13, border: `1px solid ${BORDER}`,
                    display: "flex", flexDirection: "column", gap: 7,
                    opacity: isLoading ? 0.5 : 1,
                    position: "relative",
                  }}>
                    {/* top row: description + amount */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {tx.description || "הכנסה"}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: GREEN, whiteSpace: "nowrap", flexShrink: 0 }}>
                        +{currency}{tx.amount.toLocaleString()}
                      </div>
                    </div>
                    {/* bottom row */}
                    {isDelConf ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 12, color: TEXT2, fontWeight: 600 }}>למחוק את התשלום?</div>
                          <div style={{ fontSize: 11, color: MUTED }}>הפעולה אינה ניתנת לביטול</div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => setDeletingTxId(null)} disabled={isLoading} style={{ fontSize: 12, padding: "4px 11px", borderRadius: 7, background: "transparent", border: `1px solid ${BORDER2}`, color: TEXT2, cursor: "pointer" }}>
                            ביטול
                          </button>
                          <button onClick={() => handleDeleteTx(tx.id)} disabled={isLoading} style={{ fontSize: 12, padding: "4px 11px", borderRadius: 7, background: `${RED_WARN}15`, border: `1px solid ${RED_WARN}35`, color: RED_WARN, cursor: "pointer", fontWeight: 700 }}>
                            מחק
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {tx.date && (
                          <span style={{ fontSize: 11, color: MUTED }}>
                            {new Date(tx.date).toLocaleDateString("he-IL")}
                          </span>
                        )}
                        {tx.payment_method && (
                          <span style={{ fontSize: 11, color: MUTED }}>· {tx.payment_method}</span>
                        )}
                        {/* clickable status badge — opens mini menu only when canMarkPaid */}
                        <div style={{ position: "relative", marginRight: "auto" }}>
                          <span
                            onClick={() => canMarkPaid && !isLoading && setStatusMenuTxId(isStatusOpen ? null : tx.id)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 11, fontWeight: 700, color: col,
                              background: `${col}18`, border: `1px solid ${col}30`,
                              borderRadius: 7, padding: "2px 8px",
                              cursor: canMarkPaid ? "pointer" : "default",
                            }}
                          >
                            {tx.payment_status}
                            {canMarkPaid && <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>}
                          </span>
                          {isStatusOpen && (
                            <div style={{
                              position: "absolute", top: "calc(100% + 4px)", right: 0,
                              background: "#1C1C22", border: `1px solid ${BORDER2}`,
                              borderRadius: 10, overflow: "hidden",
                              boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
                              zIndex: 10, minWidth: 120,
                            }}>
                              <button
                                onClick={() => { setStatusMenuTxId(null); handleMarkPaid(tx); }}
                                style={{
                                  display: "block", width: "100%", textAlign: "right",
                                  padding: "9px 14px", fontSize: 12, fontWeight: 700,
                                  color: GREEN, background: "transparent", border: "none",
                                  cursor: "pointer",
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = `${GREEN}12`)}
                                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                              >
                                ✓ סמן כשולם
                              </button>
                            </div>
                          )}
                        </div>
                        {/* subtle trash icon */}
                        <button
                          onClick={() => { setStatusMenuTxId(null); setDeletingTxId(tx.id); }}
                          disabled={isLoading}
                          title="מחק תשלום"
                          style={{ background: "none", border: "none", padding: "2px 4px", cursor: "pointer", color: "#44445A", lineHeight: 1, flexShrink: 0, fontSize: 13, borderRadius: 5, transition: "color 0.15s" }}
                          onMouseEnter={e => (e.currentTarget.style.color = RED_WARN)}
                          onMouseLeave={e => (e.currentTarget.style.color = "#44445A")}
                        >
                          ⌫
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── הוצאות ── */}
        <div style={{ background: CARD_BG, borderRadius: 18, border: `1px solid ${BORDER}`, padding: "22px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
          <CardHdr>הוצאות</CardHdr>
          {expenses.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "22px 16px",
              background: CARD_BG2, borderRadius: 14, border: `1px solid ${BORDER}`,
            }}>
              <span style={{ fontSize: 24, opacity: 0.22 }}>⊖</span>
              <div style={{ fontSize: 13, color: MUTED }}>אין הוצאות עדיין</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {expenses.map(tx => {
                const col          = STATUS_COLORS[tx.payment_status] ?? TEXT2;
                const isLoading    = txActionLoading === tx.id;
                const isDelConf    = deletingTxId === tx.id;
                const isStatusOpen = statusMenuTxId === tx.id;
                const canMarkPaid  = tx.payment_status === "צפוי";
                return (
                  <div key={tx.id} style={{
                    padding: "13px 15px", background: CARD_BG2,
                    borderRadius: 13, border: `1px solid ${BORDER}`,
                    display: "flex", flexDirection: "column", gap: 7,
                    opacity: isLoading ? 0.5 : 1,
                    position: "relative",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {tx.description || "הוצאה"}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: AMBER, whiteSpace: "nowrap", flexShrink: 0 }}>
                        -{currency}{tx.amount.toLocaleString()}
                      </div>
                    </div>
                    {isDelConf ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 12, color: TEXT2, fontWeight: 600 }}>למחוק את ההוצאה?</div>
                          <div style={{ fontSize: 11, color: MUTED }}>הפעולה אינה ניתנת לביטול</div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => setDeletingTxId(null)} disabled={isLoading} style={{ fontSize: 12, padding: "4px 11px", borderRadius: 7, background: "transparent", border: `1px solid ${BORDER2}`, color: TEXT2, cursor: "pointer" }}>
                            ביטול
                          </button>
                          <button onClick={() => handleDeleteTx(tx.id)} disabled={isLoading} style={{ fontSize: 12, padding: "4px 11px", borderRadius: 7, background: `${RED_WARN}15`, border: `1px solid ${RED_WARN}35`, color: RED_WARN, cursor: "pointer", fontWeight: 700 }}>
                            מחק
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {tx.date && (
                          <span style={{ fontSize: 11, color: MUTED }}>
                            {new Date(tx.date).toLocaleDateString("he-IL")}
                          </span>
                        )}
                        {tx.category && (
                          <span style={{ fontSize: 11, color: MUTED }}>· {tx.category}</span>
                        )}
                        {/* clickable status badge */}
                        <div style={{ position: "relative", marginRight: "auto" }}>
                          <span
                            onClick={() => canMarkPaid && !isLoading && setStatusMenuTxId(isStatusOpen ? null : tx.id)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 11, fontWeight: 700, color: col,
                              background: `${col}18`, border: `1px solid ${col}30`,
                              borderRadius: 7, padding: "2px 8px",
                              cursor: canMarkPaid ? "pointer" : "default",
                            }}
                          >
                            {tx.payment_status}
                            {canMarkPaid && <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>}
                          </span>
                          {isStatusOpen && (
                            <div style={{
                              position: "absolute", top: "calc(100% + 4px)", right: 0,
                              background: "#1C1C22", border: `1px solid ${BORDER2}`,
                              borderRadius: 10, overflow: "hidden",
                              boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
                              zIndex: 10, minWidth: 120,
                            }}>
                              <button
                                onClick={() => { setStatusMenuTxId(null); handleMarkPaid(tx); }}
                                style={{
                                  display: "block", width: "100%", textAlign: "right",
                                  padding: "9px 14px", fontSize: 12, fontWeight: 700,
                                  color: GREEN, background: "transparent", border: "none",
                                  cursor: "pointer",
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = `${GREEN}12`)}
                                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                              >
                                ✓ סמן כשולם
                              </button>
                            </div>
                          )}
                        </div>
                        {/* subtle trash icon */}
                        <button
                          onClick={() => { setStatusMenuTxId(null); setDeletingTxId(tx.id); }}
                          disabled={isLoading}
                          title="מחק הוצאה"
                          style={{ background: "none", border: "none", padding: "2px 4px", cursor: "pointer", color: "#44445A", lineHeight: 1, flexShrink: 0, fontSize: 13, borderRadius: 5, transition: "color 0.15s" }}
                          onMouseEnter={e => (e.currentTarget.style.color = RED_WARN)}
                          onMouseLeave={e => (e.currentTarget.style.color = "#44445A")}
                        >
                          ⌫
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Tab: סשנים ───────────────────────────────────────────────────────────────

function SessionsContent({ sessions, sessDone }: { sessions: Session[]; sessDone: number }) {
  const sessionColor: Record<string, string> = {
    "התקיים": "#10B981",
    "מתוכנן": "#3B82F6",
    "בוטל":   "#555568",
  };

  const upcoming = [...sessions]
    .filter(s => s.date && s.status !== "בוטל" && new Date(s.date) >= new Date())
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];

  const sorted = [...sessions].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return (
    <div dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {[
          { label: "הושלמו", value: sessDone,                   color: "#10B981" },
          { label: 'סה"כ',   value: sessions.length,            color: "#F4F4F4" },
          { label: "נותרו",  value: sessions.length - sessDone, color: "#F59E0B" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: "rgba(255,255,255,0.058)", borderRadius: 14,
            padding: "12px 14px", border: "1px solid rgba(255,255,255,0.14)",
          }}>
            <div style={{ fontSize: 10, color: LABEL, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
          </div>
        ))}
      </div>

      {upcoming && (
        <div style={{
          background: "rgba(59,130,246,0.07)", borderRadius: 14,
          padding: "14px 16px", border: "1px solid rgba(59,130,246,0.25)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#3B82F6", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>הסשן הבא</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#F4F4F4" }}>
            {new Date(upcoming.date!).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
      )}

      {sessions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map(s => {
            const col = sessionColor[s.status] ?? "#555568";
            return (
              <div key={s.id} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 14px", background: "rgba(255,255,255,0.034)",
                borderRadius: 12, border: "1px solid rgba(255,255,255,0.09)",
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#F4F4F4" }}>
                    {s.date
                      ? new Date(s.date).toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
                      : "ללא תאריך"}
                  </div>
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: col,
                  background: `${col}18`, border: `1px solid ${col}30`,
                  borderRadius: 8, padding: "3px 8px",
                }}>
                  {s.status}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: "center", color: MUTED, fontSize: 13, padding: "40px 0" }}>אין סשנים עדיין</div>
      )}
    </div>
  );
}

// ─── Tab: קבצים ───────────────────────────────────────────────────────────────

function FilesContent({ project, onFileDeleted }: { project: Project; onFileDeleted: () => void }) {
  const files = project.files ?? [];
  const reversed = [...files].reverse();

  const [deletingFilePath, setDeletingFilePath] = useState<string | null>(null);
  const [fileDelLoading,   setFileDelLoading]   = useState(false);
  const [fileDelErr,       setFileDelErr]        = useState<string | null>(null);

  async function handleDeleteFile(dropboxPath: string) {
    setFileDelLoading(true);
    setFileDelErr(null);
    try {
      const res = await fetch("/api/dropbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropboxPath, projectId: project.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "מחיקה נכשלה");
      setDeletingFilePath(null);
      onFileDeleted();
    } catch (err) {
      setFileDelErr(err instanceof Error ? err.message : "שגיאה במחיקה");
      setTimeout(() => setFileDelErr(null), 4000);
    } finally {
      setFileDelLoading(false);
    }
  }

  return (
    <div dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <UploadButton
          projectId={project.id}
          projectName={project.name}
          artist={project.artist ?? ""}
          existingFiles={project.files ?? []}
          size="sm"
        />
      </div>

      {fileDelErr && (
        <div style={{ fontSize: 12, color: RED_WARN, background: `${RED_WARN}12`, border: `1px solid ${RED_WARN}30`, borderRadius: 8, padding: "8px 12px" }}>
          {fileDelErr}
        </div>
      )}

      {reversed.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {reversed.map((f, i) => {
            const href        = f.dropboxShareUrl || f.url || "";
            const isDelConf   = deletingFilePath === (f.dropboxPath ?? `__idx_${i}`);
            const canDelete   = !!f.dropboxPath;

            if (isDelConf) {
              return (
                <div key={i} style={{
                  padding: "12px 14px", background: `${RED_WARN}08`,
                  borderRadius: 12, border: `1px solid ${RED_WARN}25`,
                  display: "flex", flexDirection: "column", gap: 8,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TEXT2 }}>למחוק את הקובץ?</div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                      הקובץ יימחק גם מ-Dropbox. הפעולה אינה ניתנת לביטול.
                    </div>
                    <div style={{ fontSize: 11, color: LABEL, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-start" }}>
                    <button
                      onClick={() => setDeletingFilePath(null)}
                      disabled={fileDelLoading}
                      style={{ fontSize: 12, padding: "4px 12px", borderRadius: 7, background: "transparent", border: `1px solid ${BORDER2}`, color: TEXT2, cursor: "pointer" }}
                    >
                      ביטול
                    </button>
                    <button
                      onClick={() => handleDeleteFile(f.dropboxPath!)}
                      disabled={fileDelLoading}
                      style={{ fontSize: 12, padding: "4px 12px", borderRadius: 7, background: `${RED_WARN}15`, border: `1px solid ${RED_WARN}40`, color: RED_WARN, cursor: "pointer", fontWeight: 700, opacity: fileDelLoading ? 0.5 : 1 }}
                    >
                      {fileDelLoading ? "מוחק…" : "מחק קובץ"}
                    </button>
                  </div>
                </div>
              );
            }

            const rowContent = (
              <>
                <span style={{ fontSize: 15, color: LABEL, flexShrink: 0 }}>🎵</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.name}
                  </div>
                  {f.versionLabel && (
                    <div style={{ fontSize: 11, color: LABEL, marginTop: 2 }}>{f.versionLabel}</div>
                  )}
                </div>
                {href ? (
                  <span style={{ fontSize: 11, color: BLUE, whiteSpace: "nowrap", flexShrink: 0 }}>פתח ↗</span>
                ) : (
                  <span style={{ fontSize: 11, color: MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>אין קישור</span>
                )}
                {canDelete && (
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setDeletingFilePath(f.dropboxPath!); }}
                    title="מחק קובץ"
                    style={{ background: "none", border: "none", padding: "2px 4px", cursor: "pointer", color: "#44445A", lineHeight: 1, flexShrink: 0, fontSize: 13, borderRadius: 5, marginRight: 2 }}
                    onMouseEnter={e => (e.currentTarget.style.color = RED_WARN)}
                    onMouseLeave={e => (e.currentTarget.style.color = "#44445A")}
                  >
                    ⌫
                  </button>
                )}
              </>
            );

            const rowStyle: React.CSSProperties = {
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 14px", background: "rgba(255,255,255,0.034)",
              borderRadius: 12, border: "1px solid rgba(255,255,255,0.09)",
              textDecoration: "none",
              ...(href ? { cursor: "pointer" } : {}),
            };

            return href ? (
              <a key={i} href={href} target="_blank" rel="noreferrer" style={rowStyle}>{rowContent}</a>
            ) : (
              <div key={i} style={rowStyle}>{rowContent}</div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: "center", color: MUTED, fontSize: 13, padding: "40px 0" }}>אין קבצים עדיין</div>
      )}
    </div>
  );
}
