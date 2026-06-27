"use client";

// ── Live read-only preview — /dashboard-preview ───────────────────────────
// Real data: projects (KPI + rows). Calendar / Alerts / Focus = dummy.
// No writes, no drawer, no dispatch.

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useProjects } from "@/components/ProjectsProvider";
import { daysUntilDeadline } from "@/lib/utils";
import type { Project, AgentAlert } from "@/lib/types";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import SensitiveValue from "@/components/ui/SensitiveValue";
import { usePrivacyMode } from "@/lib/use-privacy";
import Link from "next/link";
import TasksAttentionModal from "@/components/dashboard/TasksAttentionModal";

// Minimal calendar event shape (only what preview needs)
interface CalEvent { title: string; startTime: string; endTime: string; isAllDay: boolean; type: string; artist: string; }

const ALERT_CATEGORIES = [
  { key: "deadline", label: "דדליינים",    icon: "📅", types: ["overdue_deadline", "deadline_approaching"], color: "#EF4444", bg: "rgba(239,68,68,0.07)"  },
  { key: "finance",  label: "כספים",       icon: "₪",  types: ["payment_overdue", "project_no_pricing", "balance_missing_due_date"],   color: "#F59E0B", bg: "rgba(245,158,11,0.07)" },
  { key: "sessions", label: "סשנים",       icon: "🎵", types: ["session_needs_update", "stale_session"],   color: "#3B82F6", bg: "rgba(59,130,246,0.07)"  },
  { key: "victor",   label: "ויקטור",      icon: "👤", types: ["victor_stuck", "victor_below_pace"],       color: "#A855F7", bg: "rgba(168,85,247,0.07)"  },
  { key: "proposals", label: "הצעות",      icon: "📋", types: ["proposal_followup_due"],                   color: "#06B6D4", bg: "rgba(6,182,212,0.07)"  },
] as const;

const CLOSED_PROPOSAL = new Set(["נסגר", "לא נסגר"]);

const BRAND   = "#DC2626";
const BG      = "#0D0D0D";
const CARD    = "#181818";
const CARD2   = "#1E1E1E";
const BORDER  = "rgba(255,255,255,0.07)";
const BORDER2 = "rgba(255,255,255,0.04)";
const TEXT    = "#F2F2F2";
const SUB     = "#A0A0A0";
const MUTED   = "#606060";
const DIM     = "#404040";

// ── "דורש טיפול" category detail modal ────────────────────────────────────────
const SEV_HE:    Record<string, string> = { urgent: "דחוף", important: "חשוב", warning: "שים לב", info: "מידע" };
const SEV_COLOR: Record<string, string> = { urgent: "#EF4444", important: "#F59E0B", warning: "#3B82F6", info: "#6B7280" };
const ALERT_CATEGORY_EXPLAIN: Record<string, string> = {
  deadline:  "פרויקטים שעברו את הדדליין או מתקרבים אליו ודורשים עדכון.",
  finance:   "בעיות כספיות — תשלום בפיגור, יתרה ללא תאריך, או פרויקט ללא מחיר מוסכם.",
  sessions:  "פרויקטים פעילים ללא סשן לאחרונה, או סשנים שעברו וטרם עודכנו.",
  victor:    "פרויקטים תקועים אצל ויקטור או קצב עבודה מתחת ליעד החודשי.",
  proposals: "הצעות מחיר פתוחות שהגיע תאריך המעקב שלהן — צריך לחזור ללקוח.",
};

function relTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return "";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1)  return "כעת";
  if (mins < 60) return `לפני ${mins} דק'`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `לפני ${hrs} ש'`;
  const days = Math.floor(hrs / 24);
  return `לפני ${days} ${days === 1 ? "יום" : "ימים"}`;
}

function AlertCategoryModal({
  category, alerts, projects, onClose,
}: {
  category: { key: string; label: string; icon: string; types: readonly string[]; color: string };
  alerts: AgentAlert[];
  projects: Project[];
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 199999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(4px)" }} />
      <div dir="rtl" style={{
        position: "relative", width: 520, maxWidth: "92vw", maxHeight: "84vh", overflowY: "auto",
        borderRadius: 20, background: "linear-gradient(160deg, #15151B 0%, #0F0F14 100%)",
        border: `1.5px solid ${category.color}40`, boxShadow: "0 32px 80px rgba(0,0,0,0.85)",
        padding: "22px 22px 18px", display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 20 }}>{category.icon}</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: TEXT }}>{category.label}</div>
              <div style={{ fontSize: 11.5, color: SUB }}>{alerts.length} {alerts.length === 1 ? "בעיה פעילה" : "בעיות פעילות"}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: `1px solid ${BORDER2}`, color: SUB, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>

        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.5 }}>{ALERT_CATEGORY_EXPLAIN[category.key] ?? ""}</div>

        {alerts.length === 0 ? (
          <div style={{ fontSize: 13, color: MUTED, textAlign: "center", padding: "24px 0" }}>✅ אין בעיות פעילות בקטגוריה זו</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {alerts.map((a) => {
              const sevColor = SEV_COLOR[a.severity] ?? "#6B7280";
              const count    = typeof a.metadata?.count === "number" ? (a.metadata.count as number) : undefined;
              const ids      = Array.isArray(a.metadata?.projectIds) ? (a.metadata.projectIds as string[]) : [];
              const names    = ids.map(id => projects.find(p => p.id === id)?.name).filter(Boolean) as string[];
              const shown    = names.slice(0, 8);
              const more     = names.length - shown.length;
              return (
                <div key={a.id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 13, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: sevColor, background: `${sevColor}1A`, border: `1px solid ${sevColor}3A`, borderRadius: 6, padding: "2px 8px" }}>{SEV_HE[a.severity] ?? a.severity}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>{a.title}</span>
                  </div>
                  {a.message && <div style={{ fontSize: 12, color: "#C8C8C8", lineHeight: 1.5 }}>{a.message}</div>}
                  <div style={{ fontSize: 11, color: MUTED }}>
                    {relTime(a.createdAt)}{count != null ? ` · ${count} פרויקטים` : ""}
                  </div>
                  {a.suggestedActions?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {a.suggestedActions.map((s, i) => (
                        <span key={i} style={{ fontSize: 11, fontWeight: 600, color: category.color, background: `${category.color}14`, border: `1px solid ${category.color}30`, borderRadius: 8, padding: "3px 9px" }}>{s}</span>
                      ))}
                    </div>
                  )}
                  {shown.length > 0 && (
                    <div style={{ fontSize: 11.5, color: SUB }}>
                      <span style={{ color: MUTED }}>פרויקטים: </span>
                      {shown.join(", ")}{more > 0 ? ` ועוד ${more}` : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

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

function KpiCard({ label, count, sub, color, icon, iconBg, onMouseEnter, onMouseLeave }: {
  label: string; count: number | string; sub: string; color: string; icon: string; iconBg: string;
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
      background: "#1C1C1C", border: `1px solid rgba(255,255,255,0.09)`, borderRadius: 16,
      padding: "18px 15px 14px", minHeight: 140,
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      boxShadow: `0 2px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px ${color}11`,
      position: "relative", cursor: onMouseEnter ? "default" : undefined,
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
      <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, color }}>
        {typeof count === "string" && /[₪$]/.test(count) ? <SensitiveValue>{count}</SensitiveValue> : count}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {sub && <Dot color={color} />}
        <span style={{ fontSize: 10, color: sub ? "#707070" : "transparent" }}>{sub || "—"}</span>
      </div>
    </div>
  );
}

// ── KPI hover preview — same pattern as the Projects page ─────────────────
type KpiPopoverItem = { id: string; primary: string; secondary?: string; value?: string; sortDate?: string | null };

// Sort popover items by date ascending (nearest / oldest first). Past/overdue
// dates naturally precede future ones; items without a date go last. Order only —
// never changes which items or how many are shown.
function sortByDate(items: KpiPopoverItem[]): KpiPopoverItem[] {
  return [...items].sort((a, b) => {
    const da = a.sortDate || "";
    const db = b.sortDate || "";
    if (!da && !db) return 0;
    if (!da) return 1;   // a has no date → after b
    if (!db) return -1;  // b has no date → after a
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

function KpiPopover({ popover, onClose }: {
  popover: { rect: DOMRect; title: string; color: string; items: KpiPopoverItem[] };
  onClose: () => void;
}) {
  const MAX_ITEMS = 5;
  const shown = popover.items.slice(0, MAX_ITEMS);
  const overflow = popover.items.length - MAX_ITEMS;

  const style: React.CSSProperties = {
    position: "fixed",
    top: popover.rect.bottom + 8,
    left: popover.rect.left + popover.rect.width / 2,
    transform: "translateX(-50%)",
    zIndex: 9999,
    background: "#141414",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 14,
    boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
    padding: "14px 16px",
    minWidth: 280,
    maxWidth: 360,
    direction: "rtl",
  };

  return createPortal(
    <div style={style} onMouseLeave={onClose}>
      <div style={{ fontSize: 11, fontWeight: 800, color: popover.color, letterSpacing: "0.07em", marginBottom: 10 }}>
        {popover.title}
      </div>
      {popover.items.length === 0 ? (
        <div style={{ fontSize: 12, color: "#555" }}>אין פריטים להצגה</div>
      ) : (
        <>
          {shown.map(item => (
            <div key={item.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#F2F2F2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.primary}
                </div>
                {item.secondary && (
                  <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{item.secondary}</div>
                )}
              </div>
              {item.value && (
                <div style={{ flexShrink: 0, textAlign: "left", fontSize: 13, fontWeight: 800, color: popover.color }}>
                  {item.value}
                </div>
              )}
            </div>
          ))}
          {overflow > 0 && (
            <div style={{ fontSize: 11, color: "#555", marginTop: 8, textAlign: "center" }}>
              ועוד {overflow} פריטים נוספים
            </div>
          )}
        </>
      )}
    </div>,
    document.body
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

// ── Stat cache — module-level (survives nav) + localStorage (survives cold start) ──
const STAT_CACHE_KEY = "rb_stat_cache";
const STAT_CACHE_TTL = 10 * 60 * 1000; // 10 min

type StatCacheData = {
  openTasks: number;
  pendingPayments: number;
  openProposals: number;
  upcomingSessions: number;
  upcomingShows: number;
  activeCampaigns: number;
  ts: number;
};

let _statCache = {
  openTasks:        null as number | null,
  pendingPayments:  null as number | null,
  openProposals:    null as number | null,
  upcomingSessions: null as number | null,
  upcomingShows:    null as number | null,
  activeCampaigns:  null as number | null,
};

function loadStatCacheFromStorage(): void {
  try {
    const raw = localStorage.getItem(STAT_CACHE_KEY);
    if (!raw) return;
    const parsed: StatCacheData = JSON.parse(raw);
    if (Date.now() - parsed.ts > STAT_CACHE_TTL) return;
    if (parsed.openTasks        != null) _statCache.openTasks        = parsed.openTasks;
    if (parsed.pendingPayments  != null) _statCache.pendingPayments  = parsed.pendingPayments;
    if (parsed.openProposals    != null) _statCache.openProposals    = parsed.openProposals;
    if (parsed.upcomingSessions != null) _statCache.upcomingSessions = parsed.upcomingSessions;
    if (parsed.upcomingShows    != null) _statCache.upcomingShows    = parsed.upcomingShows;
    if (parsed.activeCampaigns  != null) _statCache.activeCampaigns  = parsed.activeCampaigns;
  } catch {}
}

function updateStatCache(partial: Partial<Omit<StatCacheData, "ts">>): void {
  Object.assign(_statCache, partial);
  try {
    localStorage.setItem(STAT_CACHE_KEY, JSON.stringify({
      openTasks:        _statCache.openTasks        ?? 0,
      pendingPayments:  _statCache.pendingPayments  ?? 0,
      openProposals:    _statCache.openProposals    ?? 0,
      upcomingSessions: _statCache.upcomingSessions ?? 0,
      upcomingShows:    _statCache.upcomingShows    ?? 0,
      activeCampaigns:  _statCache.activeCampaigns  ?? 0,
      ts: Date.now(),
    }));
  } catch {}
}

// ── Dashboard snapshot — full KPI array + pills for cold-start display ──
const SNAP_KEY = "rb_dash_snap";

type KpiItem = { label: string; count: number | string; sub: string; color: string; iconBg: string; icon: string };
type DashSnap = { kpi: KpiItem[]; pills: { active: number; overdue: number }; ts: number };

function loadSnap(): DashSnap | null {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    if (!raw) return null;
    const s: DashSnap = JSON.parse(raw);
    if (Date.now() - s.ts > STAT_CACHE_TTL) return null;
    return s;
  } catch { return null; }
}

function saveSnap(kpi: KpiItem[], pills: { active: number; overdue: number }): void {
  try { localStorage.setItem(SNAP_KEY, JSON.stringify({ kpi, pills, ts: Date.now() })); }
  catch {}
}

// ── Main export ───────────────────────────────────────────────────────────

export default function DashboardDesignPreview() {
  const { projects, loading } = useProjects();
  const [privacyHidden] = usePrivacyMode();

  // ── Live-2: real alerts, calendar, proposals ──────────────────────────
  const [alerts, setAlerts]             = useState<AgentAlert[]>([]);
  const [selectedAlertCategory, setSelectedAlertCategory] = useState<string | null>(null);
  const [tasksAttentionOpen, setTasksAttentionOpen] = useState(false);
  // Display-only dedupe (shared by the panel counts and the detail modal):
  // one per entityKey, and one per type for bulk/no-key alerts.
  const dedupedAlerts = useMemo(() => {
    const seen = new Set<string>();
    return alerts.filter(a => {
      const key = a.entityKey ? `k:${a.entityKey}` : `t:${a.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [alerts]);
  const [calToday, setCalToday]         = useState<CalEvent[]>([]);
  const [calTomorrow, setCalTomorrow]   = useState<CalEvent[]>([]);
  const [calConnected, setCalConnected] = useState<boolean | null>(null);
  const [openProposals, setOpenProposals] = useState<number | null>(_statCache.openProposals);

  // ── Live-3: payments, sessions, tasks (read-only counts) ──────────────
  const [pendingPayments, setPendingPayments] = useState<number | null>(_statCache.pendingPayments);
  const [upcomingSessions, setUpcomingSessions] = useState<number | null>(_statCache.upcomingSessions);
  const [openTasks, setOpenTasks] = useState<number | null>(_statCache.openTasks);
  const [upcomingShows, setUpcomingShows] = useState<number | null>(_statCache.upcomingShows);
  const [activeCampaigns, setActiveCampaigns] = useState<number | null>(_statCache.activeCampaigns);

  // Per-project finance summary (agreed price + actually-paid) — same source as
  // the Projects page "הכנסה צפויה". Drives the "תשלומים צפויים" card + popover.
  const [financeSummary, setFinanceSummary] = useState<Record<string, { paid: number; agreed: number; financeException?: boolean }>>({});
  const [financeLoaded,  setFinanceLoaded]  = useState(false);

  // ── Underlying lists behind the counts — used only for KPI hover previews ──
  const [sessionsList,        setSessionsList]        = useState<{ id: string; project_id: string; date?: string | null; start_time?: string | null }[]>([]);
  const [showsList,           setShowsList]           = useState<{ id: string; name: string; artist?: string; date?: string | null }[]>([]);
  const [proposalsList,       setProposalsList]       = useState<{ id: string; title: string; client_name?: string; amount?: number; currency?: string; followup_date?: string | null }[]>([]);
  const [campaignsList,       setCampaignsList]       = useState<{ id: string; title: string; artist_name?: string }[]>([]);

  // ── "מה קורה היום" sources: open tasks + today's expected income ──
  const [tasksList,      setTasksList]      = useState<{ id: string; title: string; due_date?: string | null; start_time?: string | null }[]>([]);
  const [incomeDueToday, setIncomeDueToday] = useState<{ id: string; project_id: string | null; amount: number; currency?: string }[]>([]);
  // Expected income from shows — income transactions tagged category="הופעה" + "צפוי".
  // Counted separately from project balances so the two never double-count.
  const [showsExpected, setShowsExpected] = useState(0);
  const [showsExpectedItems, setShowsExpectedItems] = useState<{ id: string; description: string; artist: string; amount: number; date?: string | null }[]>([]);

  // ── KPI hover popover (same state machine as the Projects page) ──
  const [kpiPopover, setKpiPopover] = useState<{ rect: DOMRect; title: string; color: string; items: KpiPopoverItem[] } | null>(null);
  const kpiHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hasMounted, setHasMounted] = useState(false);
  const [cachedKpi,   setCachedKpi]   = useState<KpiItem[] | null>(null);
  const [cachedPills, setCachedPills] = useState<{ active: number; overdue: number } | null>(null);

  // ── Load localStorage cache before first paint (cold start) ──────────
  useLayoutEffect(() => {
    loadStatCacheFromStorage();
    if (_statCache.openTasks        != null) setOpenTasks(_statCache.openTasks);
    if (_statCache.pendingPayments  != null) setPendingPayments(_statCache.pendingPayments);
    if (_statCache.openProposals    != null) setOpenProposals(_statCache.openProposals);
    if (_statCache.upcomingSessions != null) setUpcomingSessions(_statCache.upcomingSessions);
    if (_statCache.upcomingShows    != null) setUpcomingShows(_statCache.upcomingShows);
    if (_statCache.activeCampaigns  != null) setActiveCampaigns(_statCache.activeCampaigns);
    const snap = loadSnap();
    if (snap) { setCachedKpi(snap.kpi); setCachedPills(snap.pills); }
    setHasMounted(true);
  }, []);

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
        const open = all.filter((p: { status: string }) => !CLOSED_PROPOSAL.has(p.status));
        updateStatCache({ openProposals: open.length });
        setOpenProposals(open.length);
        setProposalsList(open.map((p: { id: string; title?: string; client_name?: string; amount?: number; currency?: string; followup_date?: string | null }) => ({
          id: p.id, title: p.title ?? "הצעה", client_name: p.client_name, amount: p.amount, currency: p.currency, followup_date: p.followup_date,
        })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/transactions?all=1")
      .then(r => r.json())
      .then(d => {
        // Same logic as the Projects page: agreed from settings, paid from
        // actually-received income (שולם / התקבל). NOT based on "צפוי" rows.
        const map: Record<string, { paid: number; agreed: number; financeException?: boolean }> = {};
        (d.settings ?? []).forEach((s: { project_id: string; agreedPrice?: number; financeException?: boolean }) => {
          if (!map[s.project_id]) map[s.project_id] = { paid: 0, agreed: 0 };
          map[s.project_id].agreed = s.agreedPrice ?? 0;
          map[s.project_id].financeException = s.financeException ?? false;
        });
        (d.transactions ?? []).forEach((t: { project_id: string; type: string; payment_status: string; amount: number }) => {
          if (!map[t.project_id]) map[t.project_id] = { paid: 0, agreed: 0 };
          if (t.type === "income" && ["התקבל", "שולם"].includes(t.payment_status))
            map[t.project_id].paid += t.amount;
        });
        setFinanceSummary(map);
        setFinanceLoaded(true);

        // Expected income whose due date is today (for "מה קורה היום").
        const todayStr = new Date().toISOString().slice(0, 10);
        const dueToday = (d.transactions ?? [])
          .filter((t: { type: string; payment_status: string; date?: string | null }) =>
            t.type === "income" && t.payment_status === "צפוי" && t.date === todayStr)
          .map((t: { id: string; project_id: string | null; amount: number; currency?: string }) => ({
            id: t.id, project_id: t.project_id, amount: t.amount, currency: t.currency,
          }));
        setIncomeDueToday(dueToday);

        // Expected income from shows: income "צפוי" tagged category="הופעה".
        // Filtered by category so project balances aren't double-counted.
        const showItems = (d.transactions ?? [])
          .filter((t: { type: string; payment_status: string; category?: string }) =>
            t.type === "income" && t.payment_status === "צפוי" && t.category === "הופעה")
          .map((t: { id: string; description?: string; artist?: string; amount?: number; date?: string | null }) => ({
            id: t.id, description: t.description ?? "הופעה", artist: t.artist ?? "", amount: t.amount ?? 0, date: t.date,
          }));
        setShowsExpectedItems(showItems);
        setShowsExpected(showItems.reduce((sum: number, t: { amount: number }) => sum + t.amount, 0));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/sessions?all=1")
      .then(r => r.json())
      .then(d => {
        const sessions = Array.isArray(d.sessions) ? d.sessions : [];
        const planned = sessions.filter((s: { status?: string }) => s.status === "מתוכנן");
        updateStatCache({ upcomingSessions: planned.length });
        setUpcomingSessions(planned.length);
        setSessionsList(planned.map((s: { id: string; project_id: string; date?: string | null; start_time?: string | null }) => ({
          id: s.id, project_id: s.project_id, date: s.date, start_time: s.start_time,
        })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/tasks?status=פתוח")
      .then(r => r.json())
      .then(d => {
        const tasks = Array.isArray(d.tasks) ? d.tasks : [];
        updateStatCache({ openTasks: tasks.length });
        setOpenTasks(tasks.length);
        setTasksList(tasks.map((t: { id: string; title?: string; due_date?: string | null; start_time?: string | null }) => ({
          id: t.id, title: t.title ?? "משימה", due_date: t.due_date, start_time: t.start_time,
        })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/shows")
      .then(r => r.json())
      .then(d => {
        const shows = Array.isArray(d.shows) ? d.shows : [];
        const today = new Date().toISOString().slice(0, 10);
        const upcoming = shows.filter((s: { date?: string | null; status?: string }) =>
          s.date && s.date >= today && s.status !== "בוטל"
        );
        updateStatCache({ upcomingShows: upcoming.length });
        setUpcomingShows(upcoming.length);
        setShowsList(upcoming.map((s: { id: string; name?: string; artist?: string; date?: string | null }) => ({
          id: s.id, name: s.name ?? "הופעה", artist: s.artist, date: s.date,
        })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/social/campaigns")
      .then(r => r.json())
      .then(d => {
        const campaigns = Array.isArray(d.campaigns) ? d.campaigns : [];
        const active = campaigns.filter((c: { status?: string }) => c.status === "active");
        const n = active.length;
        setCampaignsList(active.map((c: { id: string; title?: string; artist_name?: string }) => ({
          id: c.id, title: c.title ?? "קמפיין", artist_name: c.artist_name,
        })));
        updateStatCache({ activeCampaigns: n });
        setActiveCampaigns(n);
      })
      .catch(() => {});
  }, []);

  // ── Real KPI filters ──────────────────────────────────────────────────
  const overdueProjects = projects.filter(p => p.isOverdue && p.status !== "הושלם" && p.status !== "בהשהייה");
  const activeProjects  = projects.filter(p => ["בעבודה", "מחכה למיקס", "במיקס"].includes(p.status));

  // Open tasks due today or overlate — surfaced as one consolidated "דורש טיפול"
  // row + the "בדיקת משימות" modal. Derived from the already-loaded tasksList.
  const attentionToday = new Date().toISOString().slice(0, 10);
  const attentionTasks = tasksList.filter(t => !!t.due_date && (t.due_date as string) <= attentionToday);

  // Local list updates after a modal action (no full reload).
  const handleTaskDone = (id: string) => {
    setTasksList(prev => prev.filter(t => t.id !== id));
    setOpenTasks(c => (c == null ? c : Math.max(0, c - 1)));
  };
  const handleTaskDefer = (id: string, newDate: string) => {
    setTasksList(prev => prev.map(t => t.id === id ? { ...t, due_date: newDate } : t));
  };
  const dueSoonProjects = projects.filter(p => { const d = daysUntilDeadline(p.deadline); return d !== null && d >= 0 && d <= 7 && p.status !== "הושלם"; });
  const onHoldProjects  = projects.filter(p => p.status === "בהשהייה");
  const doneProjects    = projects.filter(p => p.status === "הושלם");

  // "מה קורה היום" — time-based / schedule items only (today & deadlines).
  // Agent alerts are intentionally excluded here; they live in the "דורש טיפול" panel.
  const todayFocusItems = useMemo(() => {
    type FocusItem = { icon: string; iconBg: string; iconColor: string; title: string; sub: string };
    const items: FocusItem[] = [];
    const today = new Date().toISOString().slice(0, 10);

    // 1. Calendar events today (timed first)
    calToday.slice(0, 2).forEach((ev) => items.push({
      icon: "🎙", iconBg: "rgba(168,85,247,0.15)", iconColor: "#A855F7",
      title: ev.title,
      sub: ev.isAllDay ? "כל היום" : (ev.startTime ? new Date(ev.startTime).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : ""),
    }));

    // 2. Open tasks due today
    tasksList.filter((t) => t.due_date === today).forEach((t) => items.push({
      icon: "✓", iconBg: "rgba(59,130,246,0.15)", iconColor: "#3B82F6",
      title: t.title,
      sub: t.start_time ? t.start_time.slice(0, 5) : "משימה להיום",
    }));

    // 3. Expected payments due today
    incomeDueToday.forEach((t) => {
      const name = t.project_id ? (projects.find((p) => p.id === t.project_id)?.name ?? "פרויקט") : "כללי";
      items.push({
        icon: "$", iconBg: "rgba(16,185,129,0.15)", iconColor: "#10B981",
        title: `תשלום צפוי היום: ${privacyHidden ? "••••" : `${t.currency ?? "₪"}${t.amount.toLocaleString()}`}`,
        sub: name,
      });
    });

    // 4. Proposal follow-ups due today
    proposalsList.filter((p) => p.followup_date === today).forEach((p) => items.push({
      icon: "📋", iconBg: "rgba(249,115,22,0.15)", iconColor: "#F97316",
      title: `פולואפ הצעה: ${p.client_name || p.title}`,
      sub: p.amount ? (privacyHidden ? "••••" : `${p.currency ?? "₪"}${p.amount.toLocaleString()}`) : p.title,
    }));

    // 5. Most overdue project (today-relevant deadline)
    const mostOverdue = [...overdueProjects].sort((a, b) => {
      const da = daysUntilDeadline(a.deadline) ?? 0;
      const db = daysUntilDeadline(b.deadline) ?? 0;
      return da - db;
    })[0];
    if (mostOverdue) items.push({
      icon: "📅", iconBg: "rgba(239,68,68,0.15)", iconColor: "#EF4444",
      title: `דדליין עבר — ${mostOverdue.name}`,
      sub: mostOverdue.artist || "ללא אמן",
    });

    return items.slice(0, 7);
  }, [overdueProjects, calToday, tasksList, incomeDueToday, proposalsList, projects, privacyHidden]);

  // ── Expected income = outstanding balance (agreed − paid), same as Projects ──
  const expectedIncome = useMemo(() => {
    const items = projects
      .filter(p => !p.isHidden)
      // Exclude finance-exception projects (no charge / favor) from expected income.
      .filter(p => !financeSummary[p.id]?.financeException)
      .map(p => {
        const agreed = financeSummary[p.id]?.agreed ?? 0;
        const paid   = financeSummary[p.id]?.paid   ?? 0;
        return { id: p.id, name: p.name, artist: p.artist ?? "", agreed, remaining: Math.max(0, agreed - paid) };
      })
      .filter(p => p.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining);
    const total = items.reduce((s, p) => s + p.remaining, 0);
    return { total, items };
  }, [projects, financeSummary]);

  // Drive the cached "תשלומים צפויים" signal: project balances + shows' expected income.
  useEffect(() => {
    if (!financeLoaded) return;
    const total = expectedIncome.total + showsExpected;
    updateStatCache({ pendingPayments: total });
    setPendingPayments(total);
  }, [financeLoaded, expectedIncome.total, showsExpected]);

  // ── KPI cards — 7 cards: תמונת מצב מהירה ──────────────────────────────
  const KPI = [
    { label: "פרויקטים פעילים", count: loading ? 0 : activeProjects.length,   sub: loading ? "..." : `מתוך ${projects.length} פרויקטים`,        color: "#3B82F6", iconBg: "rgba(59,130,246,0.15)",  icon: "▶"  },
    { label: "דחופים",          count: loading ? 0 : overdueProjects.length,   sub: "דורש טיפול",                                                  color: "#EF4444", iconBg: "rgba(239,68,68,0.15)",   icon: "⚠"  },
    { label: "סשנים קרובים",    count: upcomingSessions ?? 0,                   sub: upcomingSessions !== null ? "מתוכננים" : "...",                color: "#8B5CF6", iconBg: "rgba(139,92,246,0.15)",  icon: "🎙" },
    { label: "הופעות קרובות",   count: upcomingShows ?? 0,                      sub: upcomingShows !== null ? "עתידיות" : "...",                    color: "#06B6D4", iconBg: "rgba(6,182,212,0.15)",   icon: "🎤" },
    { label: "תשלומים צפויים",  count: pendingPayments !== null ? `₪${pendingPayments.toLocaleString()}` : "…", sub: pendingPayments !== null ? "יתרה לגבייה" : "...",     color: "#10B981", iconBg: "rgba(16,185,129,0.15)",  icon: "$"  },
    { label: "הצעות פתוחות",    count: openProposals ?? 0,                      sub: openProposals !== null ? "ממתינות לאישור" : "...",             color: "#F97316", iconBg: "rgba(249,115,22,0.15)",  icon: "📋" },
    { label: "קמפיינים פעילים", count: activeCampaigns ?? 0,                    sub: activeCampaigns !== null ? "בהרצה" : "...",                    color: "#A855F7", iconBg: "rgba(168,85,247,0.15)",  icon: "🎯" },
  ];

  // ── KPI hover previews: per-card breakdown of what each number is based on ──
  const projName  = (id: string) => projects.find(p => p.id === id)?.name ?? "—";
  const shortDate = (d?: string | null) =>
    d ? new Date(d).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }) : "";
  const money = (amount?: number, currency?: string) =>
    amount ? `${currency ?? "₪"}${amount.toLocaleString()}` : undefined;

  const kpiBreakdowns = useMemo<Record<string, { title: string; items: KpiPopoverItem[] }>>(() => ({
    "פרויקטים פעילים": {
      title: "▶ פרויקטים פעילים — פירוט",
      items: sortByDate(activeProjects.map(p => ({ id: p.id, primary: p.name, secondary: p.artist || undefined, sortDate: p.deadline }))),
    },
    "דחופים": {
      title: "⚠ דחופים — פירוט",
      items: sortByDate(overdueProjects.map(p => ({
        id: p.id, primary: p.name,
        secondary: [p.artist, shortDate(p.deadline)].filter(Boolean).join(" · ") || undefined,
        sortDate: p.deadline,
      }))),
    },
    "סשנים קרובים": {
      title: "🎙 סשנים מתוכננים — פירוט",
      items: sortByDate(sessionsList.map(s => ({
        id: s.id, primary: projName(s.project_id),
        secondary: [shortDate(s.date), s.start_time ? s.start_time.slice(0, 5) : ""].filter(Boolean).join(" · ") || undefined,
        sortDate: s.date,
      }))),
    },
    "הופעות קרובות": {
      title: "🎤 הופעות קרובות — פירוט",
      items: sortByDate(showsList.map(s => ({
        id: s.id, primary: s.name,
        secondary: [s.artist, shortDate(s.date)].filter(Boolean).join(" · ") || undefined,
        sortDate: s.date,
      }))),
    },
    "תשלומים צפויים": {
      title: "$ תשלומים צפויים — פירוט",
      items: [
        ...expectedIncome.items.map(p => ({
          id: p.id,
          primary: p.name,
          secondary: p.artist || undefined,
          value: privacyHidden ? "••••" : `₪${p.remaining.toLocaleString()} מתוך ₪${p.agreed.toLocaleString()}`,
        })),
        ...showsExpectedItems.map(s => ({
          id: s.id,
          primary: s.description,
          secondary: `🎤 הופעה צפויה${s.artist ? ` · ${s.artist}` : ""}${s.date ? ` · ${shortDate(s.date)}` : ""}`,
          value: privacyHidden ? "••••" : `₪${s.amount.toLocaleString()}`,
        })),
      ],
    },
    "הצעות פתוחות": {
      title: "📋 הצעות פתוחות — פירוט",
      items: proposalsList.map(p => ({
        id: p.id, primary: p.title, secondary: p.client_name || undefined,
        value: money(p.amount, p.currency),
      })),
    },
    "קמפיינים פעילים": {
      title: "🎯 קמפיינים פעילים — פירוט",
      items: campaignsList.map(c => ({ id: c.id, primary: c.title, secondary: c.artist_name || undefined })),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [activeProjects, overdueProjects, sessionsList, showsList, expectedIncome, showsExpectedItems, proposalsList, campaignsList, projects, privacyHidden]);

  function handleKpiEnter(title: string, color: string, items: KpiPopoverItem[], e: React.MouseEvent<HTMLDivElement>) {
    if (kpiHoverTimer.current) clearTimeout(kpiHoverTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    kpiHoverTimer.current = setTimeout(() => setKpiPopover({ rect, title, color, items }), 700);
  }
  function handleKpiLeave() {
    if (kpiHoverTimer.current) clearTimeout(kpiHoverTimer.current);
  }

  const allStatsReady =
    pendingPayments !== null &&
    openProposals !== null &&
    upcomingSessions !== null &&
    upcomingShows !== null &&
    activeCampaigns !== null;

  const liveReady = !loading && allStatsReady;

  // Save full snapshot when all data is available
  useEffect(() => {
    if (!liveReady) return;
    saveSnap(KPI, { active: activeProjects.length, overdue: overdueProjects.length });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveReady]);

  // What to display: live data when ready, else cached snapshot
  const displayKpi   = liveReady ? KPI   : cachedKpi;
  const displayPills = liveReady
    ? { active: activeProjects.length, overdue: overdueProjects.length }
    : cachedPills;

  // Show up to 10 real projects; fall back to an empty list while loading
  const visibleProjects: Project[] = loading ? [] : projects.filter(p => p.status !== "הושלם").slice(0, 10);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "לילה טוב" : hour < 12 ? "בוקר טוב" : hour < 17 ? "צהריים טובים" : "ערב טוב";

  const { openProject } = useGlobalProjectDrawer();
  const player = usePlayerSafe();

  const [isMobile, setIsMobile] = useState(false);
  useLayoutEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div style={{
      background: BG, color: TEXT,
      fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      transition: "none", minHeight: "100%",
      padding: isMobile ? "16px 14px" : "28px 32px",
    }}>

          {kpiPopover && (
            <KpiPopover popover={kpiPopover} onClose={() => setKpiPopover(null)} />
          )}

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
              {displayPills && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {displayPills.overdue > 0 && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 99,
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444",
                    }}><Dot color="#EF4444" /> {displayPills.overdue} פרויקטים עברו דדליין</span>
                  )}
                  {displayPills.active > 0 && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 99,
                      background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.18)", color: "#3B82F6",
                    }}><Dot color="#3B82F6" /> {displayPills.active} פרויקטים בעבודה פעילה</span>
                  )}
                  {displayPills.overdue === 0 && displayPills.active === 0 && liveReady && (
                    <span style={{ fontSize: 13, color: MUTED }}>הכל תחת שליטה 🎵</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── KPI grid ── */}
          {!hasMounted ? (
            // SSR / pre-hydration: placeholder שקוף, לא skeleton גדול
            <div style={{ marginBottom: 26, minHeight: 140 }} />
          ) : displayKpi == null ? (
            // mounted + אין snapshot בכלל: skeleton כרגיל
            <div className="grid grid-cols-4 md:grid-cols-7" style={{ gap: isMobile ? 8 : 11, marginBottom: 26 }}>
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} style={{
                  background: "#1C1C1C", border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 16, minHeight: 140, opacity: 0.4,
                }} />
              ))}
            </div>
          ) : (
            // mounted + snapshot (cache או live): KPI מלא
            <div className="grid grid-cols-4 md:grid-cols-7" style={{ gap: isMobile ? 8 : 11, marginBottom: 26 }}>
              {displayKpi.map((k) => {
                const bd = kpiBreakdowns[k.label];
                return (
                  <KpiCard
                    key={k.label}
                    {...k}
                    onMouseEnter={bd ? (e) => handleKpiEnter(bd.title, k.color, bd.items, e) : undefined}
                    onMouseLeave={bd ? handleKpiLeave : undefined}
                  />
                );
              })}
            </div>
          )}

          {/* ── Middle 3 cards ── */}
          <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: isMobile ? 12 : 18, marginBottom: 26 }}>

            {/* "דורש טיפול" — agent alerts */}
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
                  count: dedupedAlerts.filter(a => (c.types as readonly string[]).includes(a.type)).length,
                })).filter(c => c.count > 0);
                const urgentCount = dedupedAlerts.filter(a => a.severity === "urgent" || a.severity === "important").length;
                return (
                  <>
                    {selectedAlertCategory && (
                      <AlertCategoryModal
                        category={ALERT_CATEGORIES.find(c => c.key === selectedAlertCategory)!}
                        alerts={dedupedAlerts.filter(a => (ALERT_CATEGORIES.find(c => c.key === selectedAlertCategory)!.types as readonly string[]).includes(a.type))}
                        projects={projects}
                        onClose={() => setSelectedAlertCategory(null)}
                      />
                    )}
                    {tasksAttentionOpen && (
                      <TasksAttentionModal
                        tasks={attentionTasks.map(t => ({ id: t.id, title: t.title, due_date: t.due_date ?? null }))}
                        today={attentionToday}
                        onClose={() => setTasksAttentionOpen(false)}
                        onDone={handleTaskDone}
                        onDefer={handleTaskDefer}
                      />
                    )}
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "16px 20px 12px", borderBottom: `1px solid rgba(255,255,255,0.07)`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 16 }}>🔔</span>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: "#F0F0F0" }}>דורש טיפול</span>
                      </div>
                      {dedupedAlerts.length > 0 ? (
                        <span style={{ fontSize: 10, fontWeight: 900, background: BRAND, color: "#fff", borderRadius: 99, padding: "2px 8px", boxShadow: "0 0 8px rgba(220,38,38,0.4)" }}>
                          {dedupedAlerts.length}
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, color: DIM }}>אין</span>
                      )}
                    </div>
                    <div style={{ padding: "12px 16px", flex: 1 }}>
                      {(cats.length > 0 || attentionTasks.length > 0) ? (
                        <>
                          {cats.map((a, i) => (
                            <button key={i}
                              onClick={() => setSelectedAlertCategory(a.key)}
                              title="לחץ לפירוט"
                              style={{
                                width: "100%", textAlign: "right", fontFamily: "inherit", cursor: "pointer",
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                padding: "10px 12px", borderRadius: 11, marginBottom: 7,
                                background: a.bg, border: `1px solid ${a.color}20`,
                              }}
                              onMouseEnter={e => (e.currentTarget.style.borderColor = `${a.color}55`)}
                              onMouseLeave={e => (e.currentTarget.style.borderColor = `${a.color}20`)}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                                <span style={{ fontSize: 17 }}>{a.icon}</span>
                                <span style={{ fontSize: 12.5, color: "#C8C8C8", fontWeight: 600 }}>{a.label}</span>
                              </div>
                              <span style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.04em", color: a.color, lineHeight: 1 }}>{a.count}</span>
                            </button>
                          ))}
                          {attentionTasks.length > 0 && (
                            <button
                              onClick={() => setTasksAttentionOpen(true)}
                              title="לחץ לפירוט"
                              style={{
                                width: "100%", textAlign: "right", fontFamily: "inherit", cursor: "pointer",
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                padding: "10px 12px", borderRadius: 11, marginBottom: 7,
                                background: "rgba(245,158,11,0.07)", border: "1px solid #F59E0B20",
                              }}
                              onMouseEnter={e => (e.currentTarget.style.borderColor = "#F59E0B55")}
                              onMouseLeave={e => (e.currentTarget.style.borderColor = "#F59E0B20")}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                                <span style={{ fontSize: 17 }}>📝</span>
                                <span style={{ fontSize: 12.5, color: "#C8C8C8", fontWeight: 600 }}>משימות להיום / באיחור</span>
                              </div>
                              <span style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.04em", color: "#F59E0B", lineHeight: 1 }}>{attentionTasks.length}</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <div style={{ fontSize: 12, color: MUTED, textAlign: "center", paddingTop: 16 }}>
                          {dedupedAlerts.length === 0 ? "✅ אין התראות פתוחות" : "טוען..."}
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

            {/* "מה קורה היום" — time-based / schedule items */}
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
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: "#F0F0F0" }}>מה קורה היום</span>
                </div>
                {todayFocusItems.length > 0 && (
                  <span style={{
                    fontSize: 10, padding: "3px 10px", borderRadius: 99,
                    background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)",
                    color: "#EF4444", fontWeight: 800,
                  }}>{todayFocusItems.length} {todayFocusItems.length === 1 ? "פריט" : "פריטים"}</span>
                )}
              </div>
              {(() => {
                const focusItems = todayFocusItems;
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
                      <div style={{ fontSize: 12, color: MUTED, textAlign: "center", paddingTop: 20 }}>✅ אין אירועים להיום</div>
                    )}
                  </div>
                );
              })()}
              <div style={{ padding: "10px 22px 14px", borderTop: `1px solid ${BORDER2}` }}>
                <span style={{ fontSize: 10, color: DIM }}>מה קורה היום — נתונים אמיתיים</span>
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
          <div className="flex md:hidden" style={{ flexDirection: "column", gap: 10 }}>
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

          {/* ── Desktop: table ── */}
          <div className="hidden md:block" style={{
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
          </div>{/* ── end desktop table ── */}

          {/* Live badge */}
          <div style={{
            marginTop: 24, padding: "9px 16px", borderRadius: 10,
            background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.1)",
            fontSize: 11, color: DIM, textAlign: "center",
          }}>
            👁 /dashboard-preview — Live read-only · פרויקטים אמיתיים · Calendar / Alerts / מוקד = dummy עד Phase Live-2
          </div>

    </div>
  );
}
