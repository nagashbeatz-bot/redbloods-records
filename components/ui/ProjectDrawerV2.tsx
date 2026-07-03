"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl, isDeliveryFile } from "@/components/PlayerProvider";
import UploadButton from "@/components/ui/UploadButton";
import SensitiveValue from "@/components/ui/SensitiveValue";
import { usePrivacyMode } from "@/lib/use-privacy";
import DatePickerInput from "@/components/ui/DatePickerInput";
import StatusDropdown from "@/components/ui/StatusDropdown";
import { deadlineLabel, daysUntilDeadline, getStatusColor } from "@/lib/utils";
import type { Project } from "@/lib/types";
import ScheduleModal from "@/components/project/ScheduleModal";
import StevenIntakeModal from "@/components/project/StevenIntakeModal";
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
  followup_date?: string;
  created_at?:    string;
  status?:        string;
  notes?:         string;
  linked_work_id?: string | null;
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
  const [deadline,   setDeadline]  = useState<string>("");
  // Victor-only work title (display name at Victor); does NOT change the project.
  const [victorTitle, setVictorTitle] = useState<string>("");

  function goBack() { setStep(1); setDest(null); setSelection(null); setError(null); setDeadline(""); setVictorTitle(""); }

  function buildPayload() {
    const base = { projectId, actionType: "sent", actionDate: new Date().toISOString().slice(0, 10) };
    if (dest === "הפקה") return {
      ...base,
      recipientRole: "external_producer",
      recipientName: "ויקטור",
      contentType:   "הפקה",
      notes:         "נשלח להפקה",
      status:        "pending_version",
      ...(deadline ? { followupDate: deadline } : {}),
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
      // For Victor sends: find/create work FIRST so we can link it to the action
      let linkedWorkId: string | null = null;
      if (dest === "הפקה" && selection === "ויקטור") {
        try {
          const workGet = await fetch(`/api/vendor/victor/work?projectId=${projectId}`);
          const workData = await workGet.json() as { ok: boolean; work: { id: string } | null };

          const vTitle = victorTitle.trim();
          if (workData.ok && workData.work) {
            linkedWorkId = workData.work.id;
            // Re-send with a name → update the Victor-only title on the existing work.
            if (vTitle) {
              await fetch(`/api/vendor/victor/work/${linkedWorkId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: vTitle }),
              });
            }
          } else {
            const workPost = await fetch("/api/vendor/victor/work", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId,
                title: vTitle || undefined,   // Victor-only display name; empty → falls back to project name
                workState: "נשלח לויקטור",
                sentDate: new Date().toISOString().split("T")[0],
                status: "פעיל",
              }),
            });
            const workPostData = await workPost.json() as { ok: boolean; work: { id: string } };
            if (workPostData.ok && workPostData.work) linkedWorkId = workPostData.work.id;
          }

          // If deadline provided, PATCH work to trigger Task + Google Task sync
          if (linkedWorkId && deadline) {
            await fetch(`/api/vendor/victor/work/${linkedWorkId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                internalDeadline: deadline,
                workState: "נשלח לויקטור",
                status: "פעיל",
              }),
            });
          }
        } catch {
          // Work sync failure is non-fatal — continue to save the action
        }
      }

      // For Mix/Master sends to a sound engineer: create the sound_engineer_work
      // record FIRST so we can link it to the action (parallels the Victor flow).
      if (dest === "מיקס / מאסטר" && selection) {
        try {
          const today    = new Date().toISOString().slice(0, 10);
          const dl       = new Date();
          dl.setDate(dl.getDate() + 3);
          const deadline3 = dl.toISOString().slice(0, 10);

          const workPost = await fetch("/api/sound-engineer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              engineerName:     selection,        // "Steven" | "Bill"
              workType:         "מיקס + מאסטר",   // no mix/master selector in send → default combined
              status:           "נשלח",           // supported equivalent of "just sent"
              agreedPrice:      200,
              currency:         "$",              // USD
              amountPaid:       0,
              sentDate:         today,
              internalDeadline: deadline3,
              skipFinanceSync:  true,             // do NOT create a Finance expense for Steven
            }),
          });
          // The work is created and will show for the engineer on /team/steven
          // (and Bill's listing). We intentionally do NOT link its id to the
          // project_action: project_actions.linked_work_id is FK-bound to
          // vendor_project_work(id) ONLY, so a sound_engineer_work id would
          // violate project_actions_linked_work_id_fkey. The action is saved
          // without a link (linkedWorkId stays null for the sound-engineer case).
          await workPost.json().catch(() => ({}));
        } catch {
          // Work creation failure is non-fatal — continue to save the action
        }
      }

      // Create the action, linking to the work record if available
      const payload = { ...buildPayload(), ...(linkedWorkId ? { linkedWorkId } : {}) };
      const res = await fetch("/api/project-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
            {selection === "ויקטור" && (
              <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: MUTED, display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    שם העבודה אצל Victor (אופציונלי)
                  </label>
                  <input
                    type="text"
                    value={victorTitle}
                    onChange={e => setVictorTitle(e.target.value)}
                    placeholder="לדוגמה: Michtav - Afro Drill 95BPM"
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 10,
                      background: "#0D0D10", border: `1px solid ${victorTitle.trim() ? PURPLE : "#2A2A35"}`,
                      color: "#EDE9FE", fontSize: 13, fontFamily: "inherit", outline: "none",
                      boxSizing: "border-box" as const,
                    }}
                  />
                  <div style={{ fontSize: 10.5, color: MUTED, marginTop: 5, lineHeight: 1.5 }}>
                    השם הזה יוצג ל-Victor בלבד. הפרויקט המקורי יישאר מקושר ולא ישתנה.
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: MUTED, display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    דדליין פנימי (אופציונלי)
                  </label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={e => setDeadline(e.target.value)}
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 10,
                      background: "#0D0D10", border: `1px solid ${deadline ? PURPLE : "#2A2A35"}`,
                      color: deadline ? "#C4B5FD" : MUTED,
                      fontSize: 13, fontFamily: "inherit", outline: "none",
                      boxSizing: "border-box" as const,
                      colorScheme: "dark",
                    }}
                  />
                </div>
              </div>
            )}
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
  const { projects, refresh, updateProjectField } = useProjects();
  const player = usePlayerSafe();

  const [isMobile,     setIsMobile]     = useState(false);
  const [privacyHidden] = usePrivacyMode();
  const [activeTab,       setActiveTab]       = useState<DrawerTab>("סקירה");
  const [financeFormType, setFinanceFormType] = useState<"income" | "expense">("income");
  const [financeFormSeq,  setFinanceFormSeq]  = useState(0);
  const [quickTxOpen,  setQuickTxOpen]  = useState(false);
  const [quickTxMode,  setQuickTxMode]  = useState<"income" | "expense">("income");
  const [quickTxSeq,   setQuickTxSeq]   = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [agreedPrice,  setAgreedPrice]  = useState(0);
  const [currency,     setCurrency]     = useState("₪");
  const [financeException, setFinanceException] = useState(false);
  const [finLoaded,    setFinLoaded]    = useState(false);
  // Dismisses the "missing balance due date" reminder for the current opening only.
  const [balanceReminderDismissed, setBalanceReminderDismissed] = useState(false);
  const [showArtistPicker, setShowArtistPicker] = useState(false);
  const [sessions,        setSessions]        = useState<Session[]>([]);
  const [projectActions,  setProjectActions]  = useState<ProjectAction[]>([]);
  const [mounted,         setMounted]         = useState(false);
  const [scheduleAction, setScheduleAction] = useState<ActionDef | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
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
    setFinanceException(false);
    setBalanceReminderDismissed(false);
    setFinLoaded(false);
    fetch(`/api/transactions?projectId=${projectId}`)
      .then(r => r.json())
      .then(d => {
        setTransactions(d.transactions ?? []);
        setAgreedPrice(d.agreedPrice ?? 0);
        setCurrency(d.currency ?? "₪");
        setFinanceException(d.financeException ?? false);
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

  // Inline session status change (סשנים tab) — optimistic update + PATCH,
  // revert to server truth on failure. Status flow only; no other session logic.
  async function updateSessionStatus(id: string, status: string) {
    setSessions(prev => prev.map(s => (s.id === id ? { ...s, status } : s)));
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("status update failed");
    } catch {
      fetch(`/api/sessions?projectId=${projectId}`)
        .then(r => r.json())
        .then(d => setSessions(d.sessions ?? []))
        .catch(() => {});
    }
  }

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
    const action = projectActions.find(a => a.id === actionId);
    const linkedWorkId = action?.linked_work_id;

    if (linkedWorkId && action?.recipient_role === "sound_engineer") {
      // Sound-engineer cascade (Steven/Bill): remove the linked sound_engineer_work.
      // The linked expense transaction is intentionally left in place (Finance untouched).
      const workDel = await fetch(`/api/sound-engineer/${linkedWorkId}`, { method: "DELETE" });
      if (!workDel.ok) throw new Error("מחיקת עבודת סאונד נכשלה");
    } else if (linkedWorkId) {
      // Victor cascade: Google Task → tasks row → vendor_project_work → project_action

      // 1. Fetch work to get linkedTaskId
      const workRes = await fetch(`/api/vendor/victor/work/${linkedWorkId}`);
      if (!workRes.ok && workRes.status !== 404) throw new Error("שגיאה בטעינת work");

      if (workRes.ok) {
        const workData = await workRes.json() as { ok: boolean; work: { linkedTaskId?: string | null } | null };
        const linkedTaskId = workData.work?.linkedTaskId;

        // 2. Delete Google Task + tasks row if linked
        if (linkedTaskId) {
          const taskRes = await fetch(`/api/tasks/${linkedTaskId}`, { method: "DELETE" });
          if (!taskRes.ok) throw new Error("מחיקת משימה נכשלה");
        }
      }

      // 3. Delete vendor_project_work
      const workDel = await fetch(`/api/vendor/victor/work/${linkedWorkId}`, { method: "DELETE" });
      if (!workDel.ok) throw new Error("מחיקת work נכשלה");
    } else if (action?.action_type === "נשלח לויקטור" || action?.recipient_name === "ויקטור") {
      // Victor action without linkedWorkId — delete action only, no guessing by projectId/title/date
      console.warn("[handleDeleteAction] Victor action missing linked_work_id — deleting action only");
    }

    // 4. Delete project_action
    const res = await fetch(`/api/project-actions/${actionId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("מחיקה נכשלה");
    setProjectActions(prev => prev.filter(a => a.id !== actionId));
  }

  const project = projects.find(p => p.id === projectId);
  if (!mounted || !project) return null;

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
    .filter(t => t.type === "expense" && t.payment_status === "שולם")
    .reduce((s, t) => s + t.amount, 0);
  // Finance-exception projects (no charge / favor) carry no receivable balance.
  const balance     = financeException ? 0 : agreedPrice - received;

  // Reminder to set a due date for an open balance that has no expected payment yet.
  const hasExpectedIncome = transactions.some(t => t.type === "income" && t.payment_status === "צפוי");
  const showBalanceReminder =
    finLoaded &&
    !financeException &&
    !balanceReminderDismissed &&
    agreedPrice > 0 &&
    received < agreedPrice &&
    balance > 0 &&
    !hasExpectedIncome;
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
    <div dir="rtl" style={{ position: "fixed", top: 60, bottom: 0, left: 0, right: isMobile ? 0 : 248, zIndex: 99999 }}>

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
                  🎤 {project.artist || "ללא אמן"}
                </span>
                <button
                  onClick={() => setShowArtistPicker(true)}
                  title="שייך / שנה אמן"
                  style={{
                    fontSize: 11, fontWeight: 700, color: TEXT2,
                    background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER2}`,
                    borderRadius: 8, padding: "3px 10px", cursor: "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", gap: 4,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = TEXT; e.currentTarget.style.borderColor = BORDER; }}
                  onMouseLeave={e => { e.currentTarget.style.color = TEXT2; e.currentTarget.style.borderColor = BORDER2; }}
                >✎ שייך אמן</button>
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
                    {finLoaded ? <SensitiveValue>{`${currency}${balance.toLocaleString()}`}</SensitiveValue> : "…"}
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
                    {finLoaded ? <SensitiveValue>{`${currency}${agreedPrice.toLocaleString()}`}</SensitiveValue> : "…"}
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
                  status={project.status}
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
            privacyHidden ? (
              <PrivacyHiddenCard text="מצב לקוח פעיל — נתוני הכספים של הפרויקט מוסתרים" minHeight={320} />
            ) : (
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
            )
          ) : activeTab === "סשנים" ? (
            <SessionsContent sessions={sessions} sessDone={sessDone} onStatusChange={updateSessionStatus} onEditSession={setEditingSession} />
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

      {/* ── Missing balance due-date reminder ── */}
      {showBalanceReminder && (
        <BalanceReminderModal
          balance={balance}
          currency={currency}
          onSetDate={async (date) => {
            const res = await fetch("/api/transactions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId,
                type: "income",
                amount: balance,
                paymentStatus: "צפוי",
                date: date || null,
                description: "יתרת תשלום לפרויקט",
              }),
            });
            if (!res.ok) return false;
            const d = await fetch(`/api/transactions?projectId=${projectId}`).then(r => r.json()).catch(() => null);
            if (d) { setTransactions(d.transactions ?? []); setAgreedPrice(d.agreedPrice ?? 0); }
            setBalanceReminderDismissed(true);
            return true;
          }}
          onMarkException={async () => {
            const today = new Date().toISOString().slice(0, 10);
            const res = await fetch(`/api/transactions?projectId=${projectId}&type=settings`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                financeException: true,
                financeExceptionReason: "סומן כחריג דרך פופאפ יתרת תשלום",
                financeExceptionDate: today,
              }),
            });
            if (!res.ok) return false;
            setFinanceException(true);
            setBalanceReminderDismissed(true);
            return true;
          }}
          onDismiss={() => setBalanceReminderDismissed(true)}
        />
      )}

      {/* ── Artist picker ── */}
      {showArtistPicker && (
        <ArtistPickerModal
          currentArtist={project.artist ?? ""}
          onSave={async (name) => {
            await updateProjectField(project.id, "artist", name);
            await refresh();
          }}
          onClose={() => setShowArtistPicker(false)}
        />
      )}

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

      {/* ── Edit existing session (same modal, edit mode) ── */}
      {editingSession && (
        <ScheduleModal
          action={
            editingSession.session_type === "חזרה"
              ? (ACTIONS.find(a => a.id === "rehearsal") ?? ACTIONS[0])
              : editingSession.session_type === "ניקוי מיקס"
                ? (ACTIONS.find(a => a.id === "channel-clean") ?? ACTIONS[0])
                : ACTIONS[0]
          }
          projectId={projectId}
          projectName={project.name}
          artist={project.artist}
          editSession={{
            id:         editingSession.id,
            date:       editingSession.date,
            start_time: editingSession.start_time ?? null,
            end_time:   editingSession.end_time ?? null,
          }}
          onClose={() => setEditingSession(null)}
          onSessionCreated={() => {
            fetch(`/api/sessions?projectId=${projectId}`)
              .then(r => r.json())
              .then(d => setSessions(d.sessions ?? []))
              .catch(() => {});
            setEditingSession(null);
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

// Privacy Mode placeholder — shown in place of any financial block while
// client mode is active. Keeps a stable min-height so layout doesn't jump.
function PrivacyHiddenCard({ text, minHeight = 180 }: { text: string; minHeight?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, minHeight, padding: "28px 22px", textAlign: "center" }}>
      <div style={{ fontSize: 32, color: "#EAB308" }}>👁</div>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: "#E8E8EC", lineHeight: 1.6 }}>{text}</div>
    </div>
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
  const [privacyHidden] = usePrivacyMode();
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
    const amt = privacyHidden ? "••••" : `${currency}${amount.toLocaleString()}`;
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
    // Victor — ספציפי (לפני external_producer הכללי)
    if (name.toLowerCase() === "victor" || name === "ויקטור")
      return `נשלח לויקטור${ct ? `: ${ct}` : ""}`;
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
    const name = a.recipient_name ?? "";
    const isVictor = name.toLowerCase() === "victor" || name === "ויקטור";
    allFeedItems.push({
      icon: "📤",
      title: actionFeedTitle(a),
      sub: isVictor && a.followup_date ? `דדליין: ${fmtDisplayDate(a.followup_date)}` : undefined,
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
        {privacyHidden ? (
          <PrivacyHiddenCard text="מצב לקוח פעיל — הסיכום הכספי מוסתר" minHeight={150} />
        ) : finLoaded ? (
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

// ─── BalanceReminderModal ─────────────────────────────────────────────────────
// Prompts to set a due date for an open balance with no expected payment yet.
// Creating the date posts a real "צפוי" income transaction so Finance can track it.
function BalanceReminderModal({
  balance, currency, onSetDate, onMarkException, onDismiss,
}: {
  balance:   number;
  currency:  string;
  onSetDate: (date: string) => Promise<boolean>;
  onMarkException: () => Promise<boolean>;
  onDismiss: () => void;
}) {
  const [privacyHidden] = usePrivacyMode();
  const [date,   setDate]   = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onDismiss]);

  const amountLabel = privacyHidden ? "••••" : `${currency}${balance.toLocaleString()}`;

  async function handleConfirm() {
    if (!date || saving) return;
    setSaving(true);
    setErr("");
    const ok = await onSetDate(date);
    if (!ok) { setErr("שגיאה בשמירה"); setSaving(false); }
    // On success the parent unmounts this modal — no need to reset state.
  }

  async function handleMarkException() {
    if (saving) return;
    setSaving(true);
    setErr("");
    const ok = await onMarkException();
    if (!ok) { setErr("שגיאה בסימון כחריג"); setSaving(false); }
    // On success the parent unmounts this modal (financeException → no reminder).
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 199999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* overlay */}
      <div onClick={onDismiss} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(4px)" }} />
      {/* card */}
      <div dir="rtl" style={{
        position: "relative", width: 560, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto",
        borderRadius: 24,
        background: "linear-gradient(160deg, #14110F 0%, #100C0C 100%)",
        border: `1.5px solid ${RED_WARN}3A`,
        boxShadow: `0 32px 80px rgba(0,0,0,0.85), 0 0 0 1px ${RED_WARN}18`,
        padding: "34px 38px 30px",
        textAlign: "center",
      }}>
        {/* X close */}
        <button
          onClick={onDismiss}
          style={{
            position: "absolute", top: 16, left: 16, zIndex: 1,
            width: 36, height: 36, borderRadius: "50%",
            background: "rgba(255,255,255,0.07)", border: `1px solid ${BORDER2}`,
            color: TEXT2, fontSize: 17, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "inherit", transition: "none", outline: "none",
          }}
        >✕</button>

        {/* Warning icon */}
        <div style={{
          width: 64, height: 64, borderRadius: "50%", margin: "4px auto 18px",
          background: `${RED_WARN}1A`, border: `1.5px solid ${RED_WARN}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: RED_WARN, fontSize: 30, fontWeight: 900,
        }}>!</div>

        {/* Title */}
        <div style={{ fontSize: 23, fontWeight: 900, color: TEXT, marginBottom: 12, letterSpacing: "-0.02em" }}>
          חסר תאריך לתשלום היתרה
        </div>

        {/* Body text */}
        <div style={{ fontSize: 14, lineHeight: 1.6, color: TEXT2, marginBottom: 22, maxWidth: 440, marginInline: "auto" }}>
          בפרויקט הזה נשארה יתרה של {amountLabel}, כדי שהמערכת תוכל לעקוב ולהתריע, צריך לקבוע תאריך לתשלום הבא.
        </div>

        {/* Highlight: open balance */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
          padding: "16px 20px", borderRadius: 14, marginBottom: 22,
          background: "rgba(239,68,68,0.12)", border: `1.5px solid ${RED_WARN}3A`,
        }}>
          <span style={{ fontSize: 20 }}>🗄️</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: RED_WARN }}>
            יתרה פתוחה: {amountLabel}
          </span>
        </div>

        {/* Date field */}
        <div style={{ textAlign: "right", marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: TEXT2, marginBottom: 8, letterSpacing: "0.04em" }}>
            תאריך יעד לתשלום היתרה
          </div>
          <DatePickerInput
            value={date}
            onChange={setDate}
            style={{
              width: "100%", boxSizing: "border-box",
              background: CARD_BG, border: `1px solid ${BORDER2}`,
              borderRadius: 12, color: TEXT, fontSize: 15,
              padding: "13px 14px", outline: "none", fontFamily: "inherit",
              colorScheme: "dark",
            }}
          />
        </div>

        {err && <div style={{ color: RED_WARN, fontSize: 13, marginBottom: 14 }}>{err}</div>}

        {/* Buttons */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          {/* סמן כחריג — marks the project as a finance exception (no charge / favor). */}
          <button
            onClick={handleMarkException}
            disabled={saving}
            title="סמן פרויקט זה כחריג כספי (ללא חיוב)"
            style={{
              background: "transparent", border: "none", color: TEXT2,
              fontSize: 13, fontWeight: 600, fontFamily: "inherit",
              cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1, padding: "10px 4px",
            }}
          >סמן כחריג</button>

          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={onDismiss}
              disabled={saving}
              style={{
                padding: "12px 24px", borderRadius: 12,
                background: CARD_BG, border: `1px solid ${BORDER2}`,
                color: TEXT, fontSize: 14, fontWeight: 700, fontFamily: "inherit",
                cursor: saving ? "default" : "pointer", outline: "none",
              }}
            >לא עכשיו</button>
            <button
              onClick={handleConfirm}
              disabled={saving || !date}
              style={{
                padding: "12px 26px", borderRadius: 12, border: "none",
                background: BRAND, color: "#fff",
                fontSize: 14, fontWeight: 800, fontFamily: "inherit",
                cursor: saving || !date ? "default" : "pointer",
                opacity: saving || !date ? 0.7 : 1,
                boxShadow: "0 2px 16px rgba(220,38,38,0.45)", outline: "none",
              }}
            >{saving ? "שומר…" : "קבע תאריך תשלום"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── ArtistPickerModal ────────────────────────────────────────────────────────
// Pick an existing client (type "אמן" first) or create a new artist by name.
// Saving only sets project.artist; the server-side upsert creates the client if
// it's missing (deduped by name). No POST /api/clients, no client_id.
interface PickClient { id: string; name: string; type?: string; status?: string }

function ArtistPickerModal({
  currentArtist, onSave, onClose,
}: {
  currentArtist: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [clients,  setClients]  = useState<PickClient[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [loadErr,  setLoadErr]  = useState("");
  const [query,    setQuery]    = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    fetch("/api/clients")
      .then(r => r.json())
      .then(d => { if (alive) setClients(Array.isArray(d.clients) ? d.clients : []); })
      .catch(() => { if (alive) setLoadErr("שגיאה בטעינת לקוחות"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const q = query.trim();
  const filtered = clients
    .filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      const aw = a.type === "אמן" ? 0 : 1;
      const bw = b.type === "אמן" ? 0 : 1;
      return aw !== bw ? aw - bw : a.name.localeCompare(b.name, "he");
    });
  const exactMatch = !!q && clients.some(c => c.name.trim().toLowerCase() === q.toLowerCase());

  const effective = (selected ?? query).trim();
  const currentNames = (currentArtist || "").split(/[,،;]/).map(s => s.trim()).filter(Boolean);

  async function commit(nextValue: string) {
    if (saving) return;
    setSaving(true);
    setSaveErr("");
    try {
      await onSave(nextValue);
      onClose();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "שמירה נכשלה");
      setSaving(false);
    }
  }

  function handleReplace() {
    if (!effective) return;
    commit(effective);
  }

  function handleAdd() {
    if (!effective) return;
    // Don't append a name the project already has (case-insensitive).
    if (currentNames.some(n => n.toLowerCase() === effective.toLowerCase())) {
      setSaveErr("האמן כבר משויך לפרויקט");
      return;
    }
    const next = currentNames.length > 0 ? [...currentNames, effective].join(", ") : effective;
    commit(next);
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 199999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(4px)" }} />
      <div dir="rtl" style={{
        position: "relative", width: 460, maxWidth: "92vw", maxHeight: "82vh",
        borderRadius: 20, background: "linear-gradient(160deg, #12121A 0%, #0E0E14 100%)",
        border: `1.5px solid ${BORDER2}`, boxShadow: "0 32px 80px rgba(0,0,0,0.85)",
        padding: "22px 22px 18px", display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: TEXT }}>ניהול אמנים בפרויקט</div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: `1px solid ${BORDER2}`, color: TEXT2, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(null); }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
            placeholder="חפש אמן/לקוח קיים או הקלד שם חדש…"
            style={{ width: "100%", boxSizing: "border-box", background: CARD_BG, border: `1px solid ${BORDER2}`, borderRadius: 11, color: TEXT, fontSize: 14, padding: "11px 13px", outline: "none", fontFamily: "inherit" }}
          />
          <div style={{ fontSize: 11, color: MUTED }}>אפשר לבחור אמן קיים או להקליד שם חדש</div>
          <div style={{ fontSize: 11.5, color: TEXT2 }}>
            אמנים נוכחיים: <span style={{ color: TEXT, fontWeight: 700 }}>{currentArtist || "ללא אמן"}</span>
          </div>
        </div>

        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, minHeight: 80, maxHeight: "42vh" }}>
          {loading ? (
            <div style={{ fontSize: 13, color: MUTED, textAlign: "center", padding: "24px 0" }}>טוען…</div>
          ) : loadErr ? (
            <div style={{ fontSize: 13, color: RED_WARN, textAlign: "center", padding: "24px 0" }}>{loadErr}</div>
          ) : (
            <>
              {q && !exactMatch && (() => {
                const createActive = selected === q || selected === null;
                return (
                  <button
                    onClick={() => setSelected(q)}
                    style={{
                      display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 11,
                      background: createActive ? `${GREEN}1A` : "rgba(255,255,255,0.03)",
                      border: `1px solid ${createActive ? GREEN + "55" : BORDER}`,
                      color: GREEN, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "right",
                    }}
                  >＋ צור אמן חדש: &quot;{q}&quot;</button>
                );
              })()}
              {filtered.map(c => {
                const sel = selected === c.name;
                return (
                  <button
                    key={c.id}
                    onClick={() => { setSelected(c.name); setQuery(c.name); }}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 9,
                      padding: "10px 12px", borderRadius: 11,
                      background: sel ? `${BLUE}1A` : CARD_BG,
                      border: `1px solid ${sel ? BLUE + "55" : BORDER}`,
                      cursor: "pointer", fontFamily: "inherit", textAlign: "right",
                    }}
                  >
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🎤 {c.name}</span>
                    <span style={{ fontSize: 10.5, color: MUTED, flexShrink: 0 }}>{c.type || "לקוח"}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && !q && (
                <div style={{ fontSize: 12.5, color: MUTED, textAlign: "center", padding: "20px 0" }}>אין לקוחות עדיין</div>
              )}
            </>
          )}
        </div>

        {saveErr && <div style={{ color: RED_WARN, fontSize: 12.5 }}>{saveErr}</div>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-start", flexWrap: "wrap" }}>
          {(() => {
            const canSave = !!effective && !saving;
            const btn = (active: boolean): React.CSSProperties => ({
              padding: "10px 20px", borderRadius: 11, fontSize: 14, fontWeight: 800,
              fontFamily: "inherit", cursor: active ? "pointer" : "default", opacity: active ? 1 : 0.6,
            });
            return (
              <>
                <button onClick={handleAdd} disabled={!canSave} style={{ ...btn(canSave), border: "none", background: BRAND, color: "#fff" }}>
                  {saving ? "שומר…" : "הוסף אמן"}
                </button>
                <button onClick={handleReplace} disabled={!canSave} style={{ ...btn(canSave), background: CARD_BG, border: `1px solid ${BORDER2}`, color: TEXT }}>
                  החלף אמן
                </button>
              </>
            );
          })()}
          <button onClick={onClose} disabled={saving} style={{ padding: "10px 20px", borderRadius: 11, background: "transparent", border: `1px solid ${BORDER2}`, color: TEXT2, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
        </div>
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

// The only three statuses a session can be set to from the drawer.
const SESSION_STATUSES = ["מתוכנן", "התקיים", "בוטל"] as const;
const SESSION_STATUS_COLOR: Record<string, string> = {
  "מתוכנן": "#3B82F6",
  "התקיים": "#10B981",
  "בוטל":   "#555568",
};

// Lightweight inline status control — a small colored pill that opens a compact
// dark dropdown of the three statuses. No modal/popup. Matches the badge style.
function SessionStatusControl({ status, onChange }: { status: string; onChange: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const col = SESSION_STATUS_COLOR[status] ?? "#555568";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 11, fontWeight: 700, color: col,
          background: `${col}18`, border: `1px solid ${col}30`,
          borderRadius: 8, padding: "3px 8px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 5, fontFamily: "inherit",
        }}
      >
        {status}
        <span style={{ fontSize: 8, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 30,
            background: "#16161B", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10, padding: 4, minWidth: 116,
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            display: "flex", flexDirection: "column", gap: 2,
          }}
        >
          {SESSION_STATUSES.map(opt => {
            const oc = SESSION_STATUS_COLOR[opt];
            const active = opt === status;
            return (
              <button
                key={opt}
                onClick={() => { setOpen(false); if (opt !== status) onChange(opt); }}
                style={{
                  fontSize: 12, fontWeight: 700, color: oc, textAlign: "right",
                  background: active ? `${oc}1A` : "transparent",
                  border: "none", borderRadius: 7, padding: "6px 10px", cursor: "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: oc, display: "inline-block", flexShrink: 0 }} />
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SessionsContent({ sessions, sessDone, onStatusChange, onEditSession }: { sessions: Session[]; sessDone: number; onStatusChange: (id: string, status: string) => void; onEditSession: (s: Session) => void }) {
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
            return (
              <div key={s.id}
                onClick={() => onEditSession(s)}
                title="לחץ לעריכת הסשן"
                style={{
                  display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
                  padding: "10px 14px", background: "rgba(255,255,255,0.034)",
                  borderRadius: 12, border: "1px solid rgba(255,255,255,0.09)",
                  transition: "background 0.13s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.06)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.034)"; }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#F4F4F4" }}>
                    {s.date
                      ? new Date(s.date).toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
                      : "ללא תאריך"}
                    {s.start_time ? <span style={{ color: MUTED, fontWeight: 500 }}> · {s.start_time}</span> : null}
                  </div>
                </div>
                <div onClick={e => e.stopPropagation()}>
                  <SessionStatusControl status={s.status} onChange={(ns) => onStatusChange(s.id, ns)} />
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

// Delivery file types — chip label, the type label baked into the generated
// file name, the Dropbox subfolder, and whether to keep the original file name.
// "ערוצים" (channels/stems) goes to a nested subfolder and keeps its real name.
const DELIVERY_TYPES: { label: string; typeLabel?: string; subfolder: string; preserveOriginalName?: boolean; icon: string }[] = [
  { label: "מאסטר",       typeLabel: "מאסטר",       subfolder: "Delivery", icon: "🎚" },
  { label: "גרסת הופעה",  typeLabel: "גרסת הופעה",  subfolder: "Delivery", icon: "🎙" },
  { label: "אקפלה",       typeLabel: "אקפלה",       subfolder: "Delivery", icon: "🎤" },
  { label: "אינסטרומנטל", typeLabel: "אינסטרומנטל", subfolder: "Delivery", icon: "🎵" },
  { label: "ערוצים",      subfolder: "Delivery/ערוצים", preserveOriginalName: true, icon: "🔀" },
  { label: "אחר",         typeLabel: "מסירה אחרת",  subfolder: "Delivery", icon: "📄" },
];

// Basic delivery file type tag, inferred from the Dropbox path first (channels
// live in a "/Delivery/ערוצים/" subfolder and keep original names), then the file name.
function deliveryTag(name: string, dropboxPath?: string): { label: string; color: string } {
  if (dropboxPath?.includes("/Delivery/ערוצים/")) return { label: "ערוצים", color: "#06B6D4" };
  const n = name.toLowerCase();
  if (n.includes("master") || name.includes("מאסטר"))                              return { label: "מאסטר", color: "#EF4444" };
  if (n.includes("performance") || name.includes("הופעה"))                          return { label: "גרסת הופעה", color: "#F59E0B" };
  if (n.includes("acapella") || n.includes("acappella") || name.includes("אקפלה")) return { label: "אקפלה", color: "#A855F7" };
  if (n.includes("instrumental") || name.includes("אינסטרומנטל"))                   return { label: "אינסטרומנטל", color: "#3B82F6" };
  if (n.includes("stems") || name.includes("גבעולים"))                              return { label: "Stems", color: "#10B981" };
  return { label: "אחר", color: "#6B7280" };
}

function FilesContent({ project, onFileDeleted }: { project: Project; onFileDeleted: () => void }) {
  const files = project.files ?? [];
  const reversed = [...files].reverse();
  const [intakeOpen, setIntakeOpen] = useState(false);
  // Delivery zone tabs: manual upload vs. automatic Steven intake.
  const [deliveryMode, setDeliveryMode] = useState<"manual" | "auto">("manual");
  // Multi-select delete — PROJECT files only.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);

  // Delivery files = anything under a "/Delivery/" subfolder OR carrying an
  // intake delivery category (same rule the player uses, so old intake files
  // saved before the path fix are still recognized). Newest first.
  const deliveryFiles = reversed.filter(f => isDeliveryFile(f));
  // Main Delivery folder PATH (app-folder-relative). Prefer a file actually under
  // "/Delivery/" so the folder share link resolves correctly; never a /home URL.
  const deliveryFolderPath = (() => {
    const marker = "/Delivery/";
    const withMarker = deliveryFiles.find(f => f.dropboxPath?.includes(marker))?.dropboxPath;
    if (withMarker) return withMarker.slice(0, withMarker.indexOf(marker) + marker.length - 1);
    const p = deliveryFiles.find(f => f.dropboxPath)?.dropboxPath;
    return p ? p.slice(0, p.lastIndexOf("/")) : "";
  })();
  const [openingFolder, setOpeningFolder] = useState(false);
  const [openFolderErr, setOpenFolderErr] = useState<string | null>(null);
  const [folderLink, setFolderLink] = useState<string | null>(null);
  // Open a Dropbox folder (delivery folder or the ערוצים sub-folder) in a new tab.
  async function openFolder(path: string) {
    if (!path || openingFolder) return;
    // Do NOT pre-open a tab — a failed/empty fetch would leave an orphan
    // about:blank. Fetch the real share link first, then open it. If the popup
    // blocker stops us, stash the link so the user can click it directly.
    setOpeningFolder(true);
    setOpenFolderErr(null);
    setFolderLink(null);
    try {
      const res = await fetch("/api/dropbox/folder-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.shareLink) throw new Error(data.error || "no-link");
      const w = window.open(data.shareLink, "_blank", "noopener,noreferrer");
      if (!w) setFolderLink(data.shareLink); // popup blocked → show a manual link
    } catch (e) {
      const detail = e instanceof Error && e.message && e.message !== "no-link" ? ` (${e.message})` : "";
      setOpenFolderErr(`לא ניתן לפתוח את תיקיית Dropbox${detail}`);
    } finally {
      setOpeningFolder(false);
    }
  }

  // Copy a public external share link for a folder (delivery or ערוצים).
  const [copyingLink, setCopyingLink] = useState(false);
  const [copyState, setCopyState] = useState<"" | "copied" | "notpublic">("");
  async function copyLink(path: string) {
    if (!path || copyingLink) return;
    setCopyingLink(true);
    setOpenFolderErr(null);
    setCopyState("");
    try {
      const res = await fetch("/api/dropbox/folder-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.shareLink) throw new Error(data.error || "no-link");
      await navigator.clipboard.writeText(data.shareLink);
      // Dropbox couldn't make it public (account/team policy) → warn the user.
      setCopyState(data.visibility === "public" ? "copied" : "notpublic");
      setTimeout(() => setCopyState(""), 6000);
    } catch (e) {
      const detail = e instanceof Error && e.message && e.message !== "no-link" ? ` (${e.message})` : "";
      setOpenFolderErr(`לא ניתן ליצור לינק ללקוח${detail}`);
    } finally {
      setCopyingLink(false);
    }
  }

  // ── Channels (ערוצים) folder: path + manual delete ──
  const [channelsConfirm, setChannelsConfirm] = useState(false);
  const [channelsDeleting, setChannelsDeleting] = useState(false);
  const [channelsErr, setChannelsErr] = useState<string | null>(null);

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
      if (!res.ok) throw new Error(data.error || "delete failed");
      // Success: drop the file from the UI immediately (refresh re-fetches without it).
      setDeletingFilePath(null);
      onFileDeleted();
    } catch (err) {
      // On failure keep the file in the UI; show a clear Hebrew message.
      console.error("[ProjectDrawerV2] delete file failed:", err);
      setFileDelErr("לא הצלחנו למחוק את הקובץ מ-Dropbox. נסה שוב.");
      setTimeout(() => setFileDelErr(null), 5000);
    } finally {
      setFileDelLoading(false);
    }
  }

  const projectFiles = reversed.filter(f => !isDeliveryFile(f));
  const isDone = project.status === "הושלם";

  // ── Delivery files grouped by category (for the "קבצי מסירה" section) ──
  const DELIVERY_CAT_ORDER = ["מאסטר", "גרסת הופעה", "אקפלה", "אינסטרומנטל", "ערוצים", "אחר"];
  const DELIVERY_CAT_COLOR: Record<string, string> = {
    "מאסטר": "#EF4444", "גרסת הופעה": "#F59E0B", "אקפלה": "#A855F7",
    "אינסטרומנטל": "#3B82F6", "ערוצים": "#06B6D4", "אחר": "#6B7280",
  };
  const deliveryCategoryOf = (f: (typeof files)[number]): string => {
    if (f.category && DELIVERY_CAT_ORDER.includes(f.category)) return f.category;
    const tag = deliveryTag(f.name, f.dropboxPath);
    if (tag.label === "Stems") return "ערוצים";
    return DELIVERY_CAT_ORDER.includes(tag.label) ? tag.label : "אחר";
  };
  const deliveryGroups = DELIVERY_CAT_ORDER
    .map(cat => ({ cat, list: deliveryFiles.filter(f => deliveryCategoryOf(f) === cat) }))
    .filter(g => g.list.length > 0);

  const DELIVERY_CAT_META: Record<string, { icon: string; desc: string }> = {
    "מאסטר":       { icon: "🎚", desc: "הקבצים הסופיים המוכנים" },
    "גרסת הופעה":  { icon: "🎙", desc: "גרסה להופעות" },
    "אקפלה":       { icon: "🎤", desc: "שירה בלבד" },
    "אינסטרומנטל": { icon: "🎵", desc: "ללא שירה" },
    "ערוצים":      { icon: "🗂", desc: "התיקייה מכילה את כל ה-Stems" },
    "אחר":         { icon: "📄", desc: "קבצים נוספים" },
  };

  // ── Channels (ערוצים) folder ──
  const channelFiles = deliveryFiles.filter(f => deliveryCategoryOf(f) === "ערוצים");
  // Folder path = directory of any channel file (handles both new /Delivery/ערוצים
  // and legacy /05_Delivery/ערוצים layouts).
  const channelsFolderPath = (() => {
    const p = channelFiles.find(f => f.dropboxPath)?.dropboxPath;
    return p ? p.slice(0, p.lastIndexOf("/")) : "";
  })();
  async function deleteChannelsFolder() {
    if (!channelsFolderPath) return;
    setChannelsDeleting(true); setChannelsErr(null);
    try {
      // delete_v2 removes the folder + contents in Dropbox; the store then drops
      // every project.files entry nested under that path.
      const res = await fetch("/api/dropbox/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropboxPath: channelsFolderPath, projectId: project.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "מחיקה נכשלה");
      setChannelsConfirm(false);
      onFileDeleted();
    } catch (e) {
      setChannelsErr(e instanceof Error ? e.message : "שגיאה במחיקה");
      setTimeout(() => setChannelsErr(null), 5000);
    } finally {
      setChannelsDeleting(false);
    }
  }

  // ── View switch + per-category expand ──
  const [view, setView] = useState<"project" | "delivery">("project");
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  // ── Multi-select delete (project files only) ──
  const selectableProjectPaths = projectFiles.filter(f => f.dropboxPath).map(f => f.dropboxPath!);
  const toggleSelect = (path: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; });
  };
  const allSelected = selectableProjectPaths.length > 0 && selectableProjectPaths.every(p => selected.has(p));
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableProjectPaths));
  };
  async function bulkDeleteProjectFiles() {
    const paths = projectFiles.filter(f => f.dropboxPath && selected.has(f.dropboxPath)).map(f => f.dropboxPath!);
    if (paths.length === 0) return;
    setBulkDeleting(true); setBulkErr(null);
    const failed: string[] = [];
    // Sequential — each delete does a read-modify-write of project.files; parallel
    // would race. The endpoint removes from the system ONLY after Dropbox succeeds.
    for (const p of paths) {
      try {
        const res = await fetch("/api/dropbox/delete", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dropboxPath: p, projectId: project.id }),
        });
        if (!res.ok) failed.push(p);
      } catch { failed.push(p); }
    }
    setBulkDeleting(false);
    setBulkConfirm(false);
    setSelected(new Set());
    if (failed.length) setBulkErr(`${failed.length} קבצים לא נמחקו (שגיאת Dropbox) — לא הוסרו מהמערכת`);
    onFileDeleted();
  }

  const sectionCard: React.CSSProperties = {
    border: `1px solid ${BORDER}`, borderRadius: 16, background: "rgba(255,255,255,0.018)",
    padding: "16px 18px", display: "flex", flexDirection: "column", gap: 11,
  };
  const renderFileRow = (f: (typeof files)[number], i: number, prefix: string) => {
    const href      = f.dropboxShareUrl || f.url || "";
    const tag       = deliveryTag(f.name, f.dropboxPath);
    const rowKey    = f.dropboxPath ?? `${prefix}_${i}`;
    const canDelete = !!f.dropboxPath;

    if (deletingFilePath === rowKey) {
      return (
        <div key={rowKey} style={{ padding: "12px 14px", background: `${RED_WARN}08`, borderRadius: 11, border: `1px solid ${RED_WARN}25`, display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEXT2 }}>למחוק את הקובץ מ-Dropbox?</div>
            <div style={{ fontSize: 11, color: LABEL, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setDeletingFilePath(null)} disabled={fileDelLoading} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 7, background: "transparent", border: `1px solid ${BORDER2}`, color: TEXT2, cursor: "pointer" }}>ביטול</button>
            <button onClick={() => handleDeleteFile(f.dropboxPath!)} disabled={fileDelLoading} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 7, background: `${RED_WARN}15`, border: `1px solid ${RED_WARN}40`, color: RED_WARN, cursor: "pointer", fontWeight: 700, opacity: fileDelLoading ? 0.5 : 1 }}>{fileDelLoading ? "מוחק…" : "מחק"}</button>
          </div>
        </div>
      );
    }

    return (
      <div key={rowKey} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 12, padding: "9px 12px", background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 11 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: tag.color, background: `${tag.color}1A`, border: `1px solid ${tag.color}33`, borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap" }}>{tag.label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={{ fontSize: 14, color: LABEL, flexShrink: 0 }}>🎵</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
            {f.versionLabel && <div style={{ fontSize: 10.5, color: LABEL, marginTop: 1 }}>{f.versionLabel}</div>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, justifySelf: "start" }}>
          {href && <a href={href} target="_blank" rel="noopener noreferrer" title="פתח ב-Dropbox" style={{ ...ghostSm, color: BLUE, textDecoration: "none" }}>פתח ↗</a>}
          {canDelete && <button onClick={() => setDeletingFilePath(rowKey)} title="מחק קובץ" style={ghostSm} onMouseEnter={e => (e.currentTarget.style.color = RED_WARN)} onMouseLeave={e => (e.currentTarget.style.color = TEXT2)}>🗑 מחק</button>}
        </div>
      </div>
    );
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "8px 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
    fontFamily: "inherit", border: `1px solid ${active ? BRAND + "55" : BORDER}`,
    background: active ? `${BRAND}18` : "transparent", color: active ? BRAND : TEXT2, whiteSpace: "nowrap",
  });
  const segBtn = (active: boolean): React.CSSProperties => ({
    padding: "8px 18px", borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer",
    fontFamily: "inherit", border: `1px solid ${active ? BRAND + "66" : "transparent"}`,
    background: active ? `${BRAND}1A` : "transparent", color: active ? BRAND : TEXT2, whiteSpace: "nowrap",
    boxShadow: active ? `0 0 16px ${BRAND}22` : "none", transition: "all .15s",
  });
  const ghostSm: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", color: TEXT2, background: "transparent",
    border: `1px solid ${BORDER2}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, whiteSpace: "nowrap",
  };
  const dangerSm: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", color: RED_WARN, background: `${RED_WARN}12`,
    border: `1px solid ${RED_WARN}38`, borderRadius: 8, padding: "6px 10px", cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, whiteSpace: "nowrap",
  };

  const iconBox = (color: string, glyph: string) => (
    <span style={{
      width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
      background: `${color}1A`, border: `1px solid ${color}33`, color, fontSize: 18, lineHeight: 1,
    }}>{glyph}</span>
  );
  const fileFormat = (name: string): string => {
    const ext = name.split(".").pop()?.toUpperCase() ?? "";
    return ext && ext.length <= 5 ? ext : "FILE";
  };
  const fileColor = (name: string): string => {
    const e = name.toLowerCase().split(".").pop() ?? "";
    if (["wav", "aiff", "aif", "flac"].includes(e)) return "#A855F7";
    if (["mp3", "m4a", "ogg"].includes(e)) return "#F59E0B";
    return BLUE;
  };

  // ── Project file card (preview/sketch only) ──
  const renderProjectCard = (f: (typeof files)[number], i: number) => {
    const rowKey  = f.dropboxPath ?? `p_${i}`;
    const href    = f.dropboxShareUrl || f.url || "";
    const checked = !!f.dropboxPath && selected.has(f.dropboxPath);

    if (deletingFilePath === rowKey) {
      return (
        <div key={rowKey} style={{ background: `${RED_WARN}08`, border: `1px solid ${RED_WARN}25`, borderRadius: 14, padding: "14px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT2 }}>למחוק את הקובץ?</div>
          <div style={{ fontSize: 11, color: MUTED }}>הקובץ יימחק גם מ-Dropbox. הפעולה אינה ניתנת לביטול.</div>
          <div style={{ fontSize: 11, color: LABEL, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setDeletingFilePath(null)} disabled={fileDelLoading} style={ghostSm}>ביטול</button>
            <button onClick={() => handleDeleteFile(f.dropboxPath!)} disabled={fileDelLoading} style={{ ...dangerSm, opacity: fileDelLoading ? 0.5 : 1 }}>{fileDelLoading ? "מוחק…" : "מחק קובץ"}</button>
          </div>
        </div>
      );
    }

    return (
      <div key={rowKey} style={{
        background: CARD_BG, border: `1px solid ${checked ? BRAND + "55" : BORDER}`, borderRadius: 14,
        padding: "13px 14px", display: "flex", flexDirection: "column", gap: 12,
        boxShadow: checked ? `0 0 0 1px ${BRAND}33` : "none", transition: "border .15s, box-shadow .15s",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
            {iconBox(fileColor(f.name), "🎵")}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
              <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>{fileFormat(f.name)}{f.versionLabel ? ` · ${f.versionLabel}` : ""}</div>
            </div>
          </div>
          {f.dropboxPath
            ? <input type="checkbox" checked={checked} onChange={() => toggleSelect(f.dropboxPath!)} style={{ cursor: "pointer", flexShrink: 0, marginTop: 2 }} />
            : <span style={{ width: 13, flexShrink: 0 }} />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "auto" }}>
          {href && <a href={href} target="_blank" rel="noopener noreferrer" title="פתח ב-Dropbox" style={{ ...ghostSm, color: BLUE, textDecoration: "none" }}>פתח ↗</a>}
          {f.dropboxPath && <button onClick={() => setDeletingFilePath(rowKey)} title="מחק קובץ" style={ghostSm} onMouseEnter={e => (e.currentTarget.style.color = RED_WARN)} onMouseLeave={e => (e.currentTarget.style.color = TEXT2)}>🗑 מחק</button>}
        </div>
      </div>
    );
  };

  // ── Delivery category card ──
  const renderCategoryCard = (g: { cat: string; list: typeof files }) => {
    const color  = DELIVERY_CAT_COLOR[g.cat] ?? "#6B7280";
    const meta   = DELIVERY_CAT_META[g.cat] ?? { icon: "📄", desc: "" };
    const isChannels = g.cat === "ערוצים";
    return (
      <div key={g.cat} style={{
        background: CARD_BG, border: `1px solid ${isChannels ? AMBER + "55" : BORDER}`, borderRadius: 14,
        padding: "15px 15px 13px", display: "flex", flexDirection: "column", gap: 9,
        boxShadow: isChannels ? `0 0 18px ${AMBER}14` : "none",
      }}>
        {iconBox(color, meta.icon)}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>{g.cat}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color, background: `${color}1A`, border: `1px solid ${color}33`, borderRadius: 999, padding: "2px 9px" }}>{g.list.length} קבצים</span>
        </div>
        <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5, minHeight: 30 }}>{meta.desc}</div>

        {isChannels ? (
          channelsConfirm ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
              <div style={{ fontSize: 11.5, color: TEXT2, fontWeight: 700 }}>למחוק את כל תיקיית הערוצים?</div>
              <div style={{ fontSize: 10.5, color: MUTED }}>התיקייה וכל ה-Stems יימחקו מ-Dropbox ומהמערכת.</div>
              <div style={{ display: "flex", gap: 7 }}>
                <button onClick={() => setChannelsConfirm(false)} disabled={channelsDeleting} style={{ ...ghostSm, flex: 1 }}>ביטול</button>
                <button onClick={deleteChannelsFolder} disabled={channelsDeleting} style={{ ...dangerSm, flex: 1, opacity: channelsDeleting ? 0.5 : 1 }}>{channelsDeleting ? "מוחק…" : "מחק תיקייה"}</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: "auto" }}>
              <button onClick={() => setChannelsConfirm(true)} style={dangerSm}>🗑 מחק תיקיית ערוצים</button>
              <div style={{ display: "flex", gap: 7 }}>
                <button onClick={() => copyLink(channelsFolderPath)} disabled={copyingLink} style={{ ...ghostSm, flex: 1 }}>{copyingLink ? "…" : "🔗 העתק לינק"}</button>
                <button onClick={() => openFolder(channelsFolderPath)} disabled={openingFolder} style={{ ...ghostSm, flex: 1 }}>{openingFolder ? "…" : "פתח תיקייה ↗"}</button>
              </div>
            </div>
          )
        ) : (
          <button onClick={() => setExpandedCat(expandedCat === g.cat ? null : g.cat)} style={{ ...ghostSm, marginTop: "auto" }}>
            👁 {expandedCat === g.cat ? "הסתר קבצים" : "צפה בקבצים"}
          </button>
        )}
      </div>
    );
  };

  const showDeliveryTab = isDone || deliveryFiles.length > 0;
  const cardGrid = (min: number): React.CSSProperties => ({
    display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 12,
  });

  return (
    <div dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {intakeOpen && (
        <StevenIntakeModal
          projectId={project.id}
          projectName={project.name}
          onClose={() => setIntakeOpen(false)}
          onDone={onFileDeleted}
        />
      )}

      {/* ── A. Main view switch + (project) bulk controls ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {view === "project" && (
            <>
              {selectableProjectPaths.length > 0 && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: MUTED, cursor: "pointer", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "5px 10px" }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} style={{ cursor: "pointer" }} />
                  בחר הכל
                </label>
              )}
              {selected.size > 0 && (
                <button onClick={() => setBulkConfirm(true)} disabled={bulkDeleting} style={{ ...dangerSm, padding: "6px 12px" }}>🗑 מחק נבחרים ({selected.size})</button>
              )}
              <span style={{ fontSize: 11, color: MUTED, display: "inline-flex", alignItems: "center", gap: 5 }}>
                קבצים להזנה ולשמיעה על ידי הנגן <span title="רק קבצי preview/סקיצה מתנגנים בנגן; קבצי מסירה לא" style={{ cursor: "help" }}>ⓘ</span>
              </span>
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}`, borderRadius: 11, padding: 4 }}>
          {showDeliveryTab && <button onClick={() => setView("delivery")} style={segBtn(view === "delivery")}>מסירה ללקוח</button>}
          <button onClick={() => setView("project")} style={segBtn(view === "project")}>קבצי פרויקט</button>
        </div>
      </div>

      {fileDelErr && (
        <div style={{ fontSize: 12, color: RED_WARN, background: `${RED_WARN}12`, border: `1px solid ${RED_WARN}30`, borderRadius: 8, padding: "8px 12px" }}>{fileDelErr}</div>
      )}

      {/* ── B. Project files view (cards) ── */}
      {view === "project" && (
        <div style={sectionCard}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>
              קבצי פרויקט <span style={{ color: MUTED, fontWeight: 700 }}>({projectFiles.length})</span>
            </div>
            <UploadButton
              projectId={project.id}
              projectName={project.name}
              artist={project.artist ?? ""}
              existingFiles={project.files ?? []}
              status={project.status}
              size="sm"
            />
          </div>

          {bulkConfirm && (
            <div style={{ background: `${RED_WARN}08`, border: `1px solid ${RED_WARN}25`, borderRadius: 11, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT2 }}>למחוק {selected.size} קבצים?</div>
              <div style={{ fontSize: 11.5, color: MUTED }}>הקבצים יימחקו גם מ-Dropbox וגם מהמערכת. להמשיך?</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setBulkConfirm(false)} disabled={bulkDeleting} style={ghostSm}>ביטול</button>
                <button onClick={bulkDeleteProjectFiles} disabled={bulkDeleting} style={{ ...dangerSm, opacity: bulkDeleting ? 0.5 : 1 }}>{bulkDeleting ? "מוחק…" : "מחק קבצים"}</button>
              </div>
            </div>
          )}
          {bulkErr && <div style={{ fontSize: 12, color: RED_WARN, background: `${RED_WARN}12`, border: `1px solid ${RED_WARN}30`, borderRadius: 8, padding: "8px 12px" }}>{bulkErr}</div>}

          {projectFiles.length > 0 ? (
            <div style={cardGrid(220)}>
              {projectFiles.map((f, i) => renderProjectCard(f, i))}
            </div>
          ) : (
            <div style={{ textAlign: "center", color: MUTED, fontSize: 13, padding: "28px 0" }}>אין קבצים עדיין</div>
          )}
        </div>
      )}

      {/* ── C. Delivery view ── */}
      {view === "delivery" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Intake area — only for completed projects */}
          {isDone ? (
            <div style={{
              border: `1px solid ${BRAND}40`, borderRadius: 16, padding: "18px 20px",
              background: `${BRAND}08`, display: "flex", flexDirection: "column", gap: 14,
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>📦 מסירה ללקוח</div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setDeliveryMode("manual")} style={tabBtn(deliveryMode === "manual")}>⬆ קליטה ידנית</button>
                <button onClick={() => setDeliveryMode("auto")}   style={tabBtn(deliveryMode === "auto")}>↓ קליטה אוטומטית (Steven)</button>
              </div>

              {deliveryMode === "manual" ? (
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch", border: `1px solid ${BORDER}`, borderRadius: 14, background: "rgba(255,255,255,0.02)", padding: 16 }}>
                  <div style={{ flex: "1 1 300px", minWidth: 240, display: "flex", flexDirection: "column", gap: 11 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT2, letterSpacing: "0.04em" }}>בחר סוג קובץ להעלאה</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
                      {DELIVERY_TYPES.map((t) => (
                        <UploadButton
                          key={t.label}
                          projectId={project.id}
                          projectName={project.name}
                          artist={project.artist ?? ""}
                          existingFiles={deliveryFiles}
                          size="md"
                          subfolder={t.subfolder}
                          deliveryTypeLabel={t.typeLabel}
                          label={t.label}
                          icon={t.icon}
                          acceptAnyFile
                          preserveOriginalName={t.preserveOriginalName}
                          stableLabelOnDrag
                        />
                      ))}
                    </div>
                  </div>
                  <div style={{ flex: "0 1 200px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7, textAlign: "center", padding: "8px 6px" }}>
                    <div style={{ fontSize: 32, lineHeight: 1, opacity: 0.8 }}>☁️</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>גרור קבצים לכאן</div>
                    <div style={{ fontSize: 11.5, color: TEXT2 }}>או בחר סוג קובץ להעלאה</div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", border: `1px solid ${BORDER}`, borderRadius: 14, background: "rgba(255,255,255,0.02)", padding: 16 }}>
                  <span style={{ fontSize: 11.5, color: TEXT2, flex: "1 1 240px", lineHeight: 1.6 }}>
                    הקבצים נכלטים אוטומטית מתיקיית סטיבן — הדבק shared link / home URL, סרוק, בדוק ואשר העברה. בלי הורדה/העלאה ידנית.
                  </span>
                  <button onClick={() => setIntakeOpen(true)} style={{
                    display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 18px", borderRadius: 10,
                    border: `1px solid ${BRAND}40`, background: `${BRAND}12`, color: BRAND,
                    fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                  }}>↓ קליטה מ-Steven</button>
                </div>
              )}

              {/* General delivery actions */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, color: MUTED }}>🗂 הקבצים יופיעו באזור &quot;קבצי מסירה&quot; מטה</span>
                {deliveryFolderPath && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {openFolderErr && <span style={{ fontSize: 11, color: "#EF4444" }}>{openFolderErr}</span>}
                    {copyState === "copied" && <span style={{ fontSize: 11, color: "#10B981" }}>✓ לינק ללקוח הועתק</span>}
                    {copyState === "notpublic" && <span style={{ fontSize: 11, color: "#F59E0B" }}>הועתק, אך הלינק אינו ציבורי — בדוק הגדרות שיתוף ב-Dropbox</span>}
                    {folderLink ? (
                      <a href={folderLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: TEXT2, textDecoration: "none", border: `1px solid ${BORDER2}`, borderRadius: 9, padding: "7px 14px" }}>פתח תיקיית מסירה ↗</a>
                    ) : (
                      <button onClick={() => openFolder(deliveryFolderPath)} disabled={openingFolder} style={{ fontSize: 12, fontWeight: 700, color: TEXT2, fontFamily: "inherit", background: "transparent", border: `1px solid ${BORDER2}`, borderRadius: 9, padding: "7px 14px", cursor: openingFolder ? "default" : "pointer", opacity: openingFolder ? 0.6 : 1 }}>{openingFolder ? "פותח…" : "פתח תיקיית מסירה ↗"}</button>
                    )}
                    <button onClick={() => copyLink(deliveryFolderPath)} disabled={copyingLink} style={{ fontSize: 12, fontWeight: 700, color: TEXT, fontFamily: "inherit", background: "transparent", border: `1px solid ${BORDER2}`, borderRadius: 9, padding: "7px 14px", cursor: copyingLink ? "default" : "pointer", opacity: copyingLink ? 0.6 : 1 }}>{copyingLink ? "מכין…" : "העתק לינק ללקוח"}</button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: MUTED, background: "rgba(255,255,255,0.02)", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 16px" }}>
              אזור המסירה (העלאה ידנית / קליטה מ-Steven) ייפתח כשהפרויקט יסומן כ&quot;הושלם&quot;.
            </div>
          )}

          {/* Delivery files as category cards */}
          <div style={sectionCard}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>
              קבצי מסירה <span style={{ color: MUTED, fontWeight: 700 }}>({deliveryFiles.length})</span>
            </div>
            {channelsErr && <div style={{ fontSize: 12, color: RED_WARN, background: `${RED_WARN}12`, border: `1px solid ${RED_WARN}30`, borderRadius: 8, padding: "8px 12px" }}>{channelsErr}</div>}
            {deliveryGroups.length > 0 ? (
              <>
                <div style={cardGrid(240)}>
                  {deliveryGroups.map((g) => renderCategoryCard(g))}
                </div>
                {expandedCat && (() => {
                  const grp = deliveryGroups.find(g => g.cat === expandedCat);
                  if (!grp) return null;
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4, borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: TEXT2 }}>{expandedCat} — קבצים</div>
                      {grp.list.map((f, i) => renderFileRow(f, i, `x_${expandedCat}`))}
                    </div>
                  );
                })()}
              </>
            ) : (
              <div style={{ fontSize: 12, color: MUTED, padding: "6px 2px" }}>עדיין לא הועלו קבצי מסירה</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
