"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useRef, Suspense } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { useProjects } from "@/components/ProjectsProvider";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import UploadButton from "@/components/ui/UploadButton";
import ActionMenu from "@/components/project/ActionMenu";
import StatusDropdown from "@/components/ui/StatusDropdown";
import DatePickerInput from "@/components/ui/DatePickerInput";
import { daysUntilDeadline, getStatusColor, getStatusBg } from "@/lib/utils";
import type { Project, ProjectStatus, ProjectType } from "@/lib/types";
import { ALL_STATUSES, PROJECT_TYPES } from "@/lib/types";

// ── Design tokens — identical to DashboardDesignPreview ──────────────────────
const BRAND   = "#DC2626";
const BG      = "#0D0D0D";
const SURFACE = "#141414";
const CARD    = "#181818";
const BORDER  = "rgba(255,255,255,0.07)";
const TEXT    = "#F2F2F2";
const SUB     = "#A0A0A0";
const MUTED   = "#505050";
const CARD_SHADOW = "0 2px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)";

const TYPE_COLORS: Record<string, string> = {
  "שיר":  "#3B82F6",
  "EP":   "#A855F7",
  "אלבום":"#EC4899",
  "קליפ": "#F59E0B",
  "רידים":"#10B981",
  "אחר":  "#6B7280",
};

function formatDeadline(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
}

function formatTimeRemaining(iso: string | null, status: ProjectStatus): string {
  if (!iso || status === "הושלם") return "";
  const days = daysUntilDeadline(iso);
  if (days === null || days < 0) return "";
  if (days === 0) return " - היום";
  if (days < 7) return ` - עוד ${days} ימים`;
  return ` - עוד ${Math.round(days / 7)} שבועות`;
}

function deadlineBadgeColor(p: Project): string {
  if (p.isOverdue && p.status !== "הושלם") return "#EF4444";
  const d = daysUntilDeadline(p.deadline);
  if (d !== null && d <= 7 && p.status !== "הושלם") return "#F59E0B";
  return MUTED;
}

// ── SVG play icon — same path as DashboardDesignPreview ─────────────────────
function PlayIcon({ size = 9, color = "#888" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 12" fill={color} style={{ display: "block" }}>
      <path d="M1 1L9 6L1 11V1Z" />
    </svg>
  );
}

// ── Pause icon ───────────────────────────────────────────────────────────────
function PauseIcon({ size = 10, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 12" fill={color} style={{ display: "block" }}>
      <rect x="1" y="0" width="3.2" height="12" rx="1" />
      <rect x="5.8" y="0" width="3.2" height="12" rx="1" />
    </svg>
  );
}

// ── Project Play Button (live) — copied from DashboardDesignPreview ───────────
function ProjectPlayBtn({ p, player, size = 28 }: {
  p: Project;
  player: ReturnType<typeof usePlayerSafe>;
  size?: number;
}) {
  const latestAudio = getLatestAudioFile(p.files ?? []);
  if (!latestAudio || !player) {
    return <div style={{ width: size, height: size, flexShrink: 0 }} />;
  }
  const isLoaded  = player.track?.projectId === p.id;
  const isPlaying = isLoaded && player.playing;
  const large = size >= 36;
  const iconSize  = large ? 14 : 9;
  return (
    <div
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
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: large
          ? (isPlaying ? BRAND : `${BRAND}CC`)
          : (isLoaded ? `${BRAND}22` : "rgba(255,255,255,0.07)"),
        border: large
          ? "none"
          : `1px solid ${isLoaded ? `${BRAND}66` : "rgba(255,255,255,0.14)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer",
        boxShadow: large
          ? (isPlaying ? `0 0 20px ${BRAND}88` : `0 0 10px ${BRAND}44`)
          : (isLoaded ? `0 0 8px ${BRAND}55` : "none"),
        transition: "all 0.15s",
      }}
    >
      {isPlaying
        ? <PauseIcon size={iconSize} color={large ? "#fff" : (isLoaded ? BRAND : "#999")} />
        : <PlayIcon  size={iconSize} color={large ? "#fff" : (isLoaded ? BRAND : "#999")} />
      }
    </div>
  );
}

// ── KPI card — matches dashboard KPI language ────────────────────────────────
function KpiCard({ label, value, sub, color, icon, onMouseEnter, onMouseLeave }: {
  label: string; value: string; sub?: string; color: string; icon: string;
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        padding: "14px 16px",
        boxShadow: CARD_SHADOW,
        display: "flex", flexDirection: "column", gap: 6,
        minHeight: 82,
        cursor: onMouseEnter ? "default" : undefined,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>
          {label}
        </span>
        <span style={{ fontSize: 16, opacity: 0.55 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 32, fontWeight: 900, color, lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── KPI Popover types ────────────────────────────────────────────────────────
type KpiPopoverItem = {
  id: string; name: string; artist: string;
  remaining: number; agreed: number; paid: number;
  deadline?: string | null;
};

// ── KPI Popover component ────────────────────────────────────────────────────
function KpiPopover({
  popover, onClose,
}: {
  popover: { rect: DOMRect; items: KpiPopoverItem[] };
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
      <div style={{ fontSize: 11, fontWeight: 800, color: "#F59E0B", letterSpacing: "0.07em", marginBottom: 10 }}>
        💰 הכנסה צפויה — פירוט
      </div>
      {popover.items.length === 0 ? (
        <div style={{ fontSize: 12, color: "#555" }}>אין פריטים להצגה</div>
      ) : (
        <>
          {shown.map(item => (
            <div key={item.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
              gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#F2F2F2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.name}
                </div>
                <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>
                  {item.artist}{item.deadline ? ` · ${item.deadline}` : ""}
                </div>
              </div>
              <div style={{ flexShrink: 0, textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#F59E0B" }}>
                  ₪{item.remaining.toLocaleString()}
                </div>
                <div style={{ fontSize: 10, color: "#555" }}>
                  מתוך ₪{item.agreed.toLocaleString()}
                </div>
              </div>
            </div>
          ))}
          {overflow > 0 && (
            <div style={{ fontSize: 11, color: "#555", marginTop: 8, textAlign: "center" }}>
              ועוד {overflow} פרויקטים נוספים
            </div>
          )}
        </>
      )}
    </div>,
    document.body
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: ProjectStatus }) {
  const color = getStatusColor(status);
  const bg    = getStatusBg(status);
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color, background: bg,
      border: `1px solid ${color}35`, borderRadius: 6,
      padding: "2px 8px", whiteSpace: "nowrap",
      display: "inline-flex", alignItems: "center", gap: 5,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }} />
      {status}
    </span>
  );
}

// ── Type badge ───────────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: ProjectType }) {
  if (!type) return <span style={{ color: MUTED, fontSize: 11 }}>—</span>;
  const color = TYPE_COLORS[type] ?? "#6B7280";
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color,
      background: `${color}18`, border: `1px solid ${color}35`,
      borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap",
    }}>
      {type}
    </span>
  );
}

// ── Filter chip ──────────────────────────────────────────────────────────────
function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: 8,
      border: `1px solid ${active ? "rgba(220,38,38,0.45)" : "#252525"}`,
      fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
      background: active ? "rgba(220,38,38,0.10)" : "#1A1A1A",
      color: active ? BRAND : "#666",
      transition: "all 0.12s",
    }}>
      {label}
    </button>
  );
}

// ── Action button (upload / quick-actions) ───────────────────────────────────
function ActionBtn({ title, label, onClick }: { title: string; label: string; onClick: () => void }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        width: 30, height: 30, borderRadius: "50%",
        background: h ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${h ? "rgba(255,255,255,0.18)" : BORDER}`,
        color: h ? "#C0C0C0" : MUTED,
        fontSize: 13, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.12s",
      }}
    >
      {label}
    </button>
  );
}

// ── Deep link handler — must be in own component for useSearchParams + Suspense
function OpenProjectFromURL({ openProject }: { openProject: (id: string) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const id = searchParams.get("open");
    if (id) openProject(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function ProjectsDesignPreview() {
  const { projects, loading, createProject } = useProjects();
  const { openProject } = useGlobalProjectDrawer();
  const player = usePlayerSafe();

  const [search,          setSearch]          = useState("");
  const [statusFilter,    setStatusFilter]    = useState<"הכל הפעיל" | "הושלמו" | ProjectStatus>("הכל הפעיל");
  const [typeFilter,      setTypeFilter]      = useState<ProjectType | "">("");
  const [isMobile,        setIsMobile]        = useState(false);
  const [showNewProject,  setShowNewProject]  = useState(false);
  const [clientNames,     setClientNames]     = useState<string[]>([]);

  const [financeSummary, setFinanceSummary] = useState<Record<string, { paid: number; agreed: number; financeException?: boolean }>>({});
  const [kpiPopover, setKpiPopover] = useState<{ rect: DOMRect; items: KpiPopoverItem[] } | null>(null);
  const kpiHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/transactions?all=1")
      .then(r => r.json())
      .then(d => {
        const map: Record<string, { paid: number; agreed: number; financeException?: boolean }> = {};
        (d.settings ?? []).forEach((s: { project_id: string; agreedPrice: number; financeException?: boolean }) => {
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
      })
      .catch(() => {});
  }, []);

  useLayoutEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    fetch("/api/clients")
      .then(r => r.json())
      .then(d => {
        if (d.clients) setClientNames((d.clients as { name: string }[]).map(c => c.name));
      })
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .filter(p => !p.isHidden)
      .filter(p => statusFilter === "הכל הפעיל" ? p.status !== "הושלם" : statusFilter === "הושלמו" ? p.status === "הושלם" : p.status === statusFilter)
      .filter(p => !typeFilter || p.projectType === typeFilter)
      .filter(p => !q || p.name.toLowerCase().includes(q) || p.artist.toLowerCase().includes(q));
  }, [projects, search, statusFilter, typeFilter]);

  const kpi = useMemo(() => {
    const active = projects.filter(p => !p.isHidden);
    const knownIds = new Set(active.map(p => p.id));
    const totalExpected = Object.entries(financeSummary)
      .filter(([id, f]) => knownIds.has(id) && !f.financeException)
      .reduce((s, [, f]) => s + Math.max(0, f.agreed - f.paid), 0);
    const now = new Date();
    return {
      total:          active.length,
      inProgress:     active.filter(p => ["בעבודה", "במיקס", "מחכה למיקס"].includes(p.status)).length,
      completedMonth: active.filter(p => {
        if (p.status !== "הושלם" || !p.endDate) return false;
        const d = new Date(p.endDate);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length,
      overdue:  active.filter(p => p.isOverdue && p.status !== "הושלם").length,
      expected: totalExpected,
    };
  }, [projects, financeSummary]);

  const expectedBreakdown = useMemo((): KpiPopoverItem[] => {
    return projects
      .filter(p => !p.isHidden)
      .filter(p => !financeSummary[p.id]?.financeException)
      .map(p => ({
        id: p.id, name: p.name, artist: p.artist ?? "",
        agreed: financeSummary[p.id]?.agreed ?? 0,
        paid:   financeSummary[p.id]?.paid   ?? 0,
        remaining: Math.max(0, (financeSummary[p.id]?.agreed ?? 0) - (financeSummary[p.id]?.paid ?? 0)),
        deadline: p.deadline ? new Date(p.deadline).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }) : null,
      }))
      .filter(p => p.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining);
  }, [projects, financeSummary]);

  function handleKpiEnter(items: KpiPopoverItem[], e: React.MouseEvent<HTMLDivElement>) {
    if (kpiHoverTimer.current) clearTimeout(kpiHoverTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    kpiHoverTimer.current = setTimeout(() => setKpiPopover({ rect, items }), 700);
  }
  function handleKpiLeave() {
    if (kpiHoverTimer.current) clearTimeout(kpiHoverTimer.current);
  }

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    const dA = daysUntilDeadline(a.deadline);
    const dB = daysUntilDeadline(b.deadline);
    if (dA !== null && dB === null) return -1;
    if (dA === null && dB !== null) return 1;
    if (dA !== null && dB !== null && dA !== dB) return dA - dB;
    return a.name.localeCompare(b.name, "he");
  }), [filtered]);

  const [page, setPage] = useState(1);
  const PER_PAGE   = 10;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const pageRows   = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  useEffect(() => setPage(1), [search, statusFilter, typeFilter]);

  const artists = Array.from(new Set([
    ...projects.flatMap(p => p.artist.split(/[,،;]/).map(a => a.trim()).filter(Boolean)),
    ...clientNames,
  ]));

  if (loading) return <div style={{ padding: 32, color: SUB }}>טוען פרויקטים...</div>;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: BG, minHeight: "100vh", color: TEXT, fontFamily: "inherit", direction: "rtl" }}>
      <Suspense fallback={null}>
        <OpenProjectFromURL openProject={openProject} />
      </Suspense>
      {kpiPopover && (
        <KpiPopover popover={kpiPopover} onClose={() => setKpiPopover(null)} />
      )}

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <div style={{ padding: isMobile ? "16px 14px" : "24px 28px", maxWidth: 1400, margin: "0 auto" }}>

        {/* Page header */}
        {isMobile ? (
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: TEXT, margin: "0 0 4px", letterSpacing: "-0.02em" }}>פרויקטים</h1>
            <p style={{ fontSize: 12, color: MUTED, margin: "0 0 16px" }}>
              ניהול והפקה של {projects.filter(p => !p.isHidden).length} פרויקטים בלייב
            </p>
            <button
              onClick={() => setShowNewProject(true)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                width: "100%", padding: "12px 0", borderRadius: 12,
                background: BRAND, border: "none",
                color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "0 3px 16px rgba(220,38,38,0.45)",
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
              פרויקט חדש
            </button>
          </div>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: TEXT, margin: 0, letterSpacing: "-0.02em" }}>פרויקטים</h1>
            <p style={{ fontSize: 12, color: MUTED, margin: "4px 0 0" }}>
              ניהול והפקה של {projects.filter(p => !p.isHidden).length} פרויקטים בלייבל
            </p>
          </div>
        )}

        {/* KPI cards */}
        {!isMobile && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
            <KpiCard label="סה״כ פרויקטים" value={String(kpi.total)}          color="#818CF8" icon="📁" sub="בכל הפרויקטים" />
            <KpiCard label="בתהליך"         value={String(kpi.inProgress)}     color="#60A5FA" icon="🎵" sub="פרויקטים פעילים" />
            <KpiCard label="הושלמו החודש"   value={String(kpi.completedMonth)} color="#10B981" icon="✅" sub="הצלחה בהצלחה" />
            <KpiCard label="באיחור"          value={String(kpi.overdue)}        color={kpi.overdue > 0 ? "#EF4444" : MUTED} icon="⚠️" sub="דורש טיפול" />
            <KpiCard label="הכנסה צפויה"    value={kpi.expected > 0 ? `₪${kpi.expected.toLocaleString()}` : "—"} color="#F59E0B" icon="💰" sub="לגבייה"
              onMouseEnter={(e) => handleKpiEnter(expectedBreakdown, e)}
              onMouseLeave={handleKpiLeave}
            />
          </div>
        )}

        {/* New project button — desktop only (mobile has it in header) */}
        {!isMobile && (
          <div style={{ marginBottom: 16 }}>
            <button
              onClick={() => setShowNewProject(true)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "8px 18px", borderRadius: 9,
                background: BRAND,
                border: "1px solid rgba(220,38,38,0.5)",
                color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 2px 14px rgba(220,38,38,0.35)",
                letterSpacing: "0.01em",
              }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
              פרויקט חדש
            </button>
          </div>
        )}

        {/* Search + filters */}
        <div style={{ marginBottom: 14 }}>
          {/* Search bar — full width on mobile */}
          <div style={{ marginBottom: 8 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: SURFACE, border: `1px solid ${BORDER}`,
              borderRadius: 10, padding: "8px 14px",
              width: isMobile ? "100%" : "auto",
              boxSizing: "border-box",
            }}>
              <span style={{ color: MUTED, fontSize: 13 }}>🔍</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="חיפוש פרויקטים או אמן..."
                style={{
                  background: "transparent", border: "none", outline: "none",
                  color: TEXT, fontSize: isMobile ? 16 : 13, fontFamily: "inherit",
                  flex: 1, direction: "rtl",
                  width: isMobile ? "100%" : 180,
                }}
              />
              {search && (
                <button onClick={() => setSearch("")} style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
              )}
            </div>
          </div>

          {/* Status filter chips — horizontal scroll on mobile */}
          <div style={{
            display: "flex",
            flexWrap: isMobile ? "nowrap" : "wrap",
            overflowX: isMobile ? "auto" : "visible",
            gap: 6, marginBottom: isMobile ? 4 : 6,
            paddingBottom: isMobile ? 4 : 0,
            scrollbarWidth: "none",
          }}>
            <FilterChip label="הכל הפעיל" active={statusFilter === "הכל הפעיל"} onClick={() => setStatusFilter("הכל הפעיל")} />
            {ALL_STATUSES.filter(s => s !== "הושלם").map(s => (
              <FilterChip key={s} label={s} active={statusFilter === s} onClick={() => setStatusFilter(s as ProjectStatus)} />
            ))}
            <FilterChip label="הושלמו" active={statusFilter === "הושלמו"} onClick={() => setStatusFilter("הושלמו")} />
          </div>

          {/* Type filter */}
          <div style={{
            display: "flex",
            flexWrap: isMobile ? "nowrap" : "wrap",
            overflowX: isMobile ? "auto" : "visible",
            gap: 6,
            paddingBottom: isMobile ? 2 : 0,
            scrollbarWidth: "none",
          }}>
            <FilterChip label="כל הסוגים" active={typeFilter === ""} onClick={() => setTypeFilter("")} />
            {PROJECT_TYPES.map(t => (
              <FilterChip key={t} label={t} active={typeFilter === t} onClick={() => setTypeFilter(t)} />
            ))}
          </div>
        </div>

        {/* Results count */}
        <div style={{ fontSize: 11, color: MUTED, marginBottom: 10 }}>
          {sorted.length} פרויקטים מוצגים
        </div>

        {/* Desktop table */}
        {!isMobile && (
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "36px 2.2fr 1.2fr 130px 80px 110px 110px 1fr 80px",
              padding: "10px 16px", gap: 10,
              borderBottom: `1px solid ${BORDER}`,
              fontSize: 10, fontWeight: 800, color: MUTED,
              letterSpacing: "0.07em", textTransform: "uppercase",
            }}>
              <div />
              <div>פרויקט</div>
              <div>אמן</div>
              <div>סטטוס</div>
              <div>סוג</div>
              <div>הכנסה צפויה</div>
              <div>יעד / איחור</div>
              <div>הערות</div>
              <div style={{ textAlign: "center" }}>פעולות</div>
            </div>

            {pageRows.length === 0 ? (
              <div style={{ padding: "36px 16px", textAlign: "center", color: MUTED }}>לא נמצאו פרויקטים</div>
            ) : pageRows.map((p, i) => (
              <ProjectRow
                key={p.id}
                project={p}
                finance={financeSummary[p.id]}
                isLast={i === pageRows.length - 1}
                onOpen={openProject}
                player={player}
              />
            ))}
          </div>
        )}

        {/* Mobile cards */}
        {isMobile && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pageRows.length === 0
              ? <div style={{ padding: 32, textAlign: "center", color: MUTED }}>לא נמצאו פרויקטים</div>
              : pageRows.map(p => <MobileCard key={p.id} project={p} finance={financeSummary[p.id]} onOpen={openProject} player={player} />)
            }
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={pagerBtn(page === 1)}>&gt;</button>
            <div style={{ display: "flex", gap: 5 }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                <button key={n} onClick={() => setPage(n)} style={{
                  width: 30, height: 30, borderRadius: 8,
                  border: `1px solid ${n === page ? "rgba(220,38,38,0.4)" : BORDER}`,
                  background: n === page ? "rgba(220,38,38,0.12)" : "transparent",
                  color: n === page ? BRAND : SUB,
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}>{n}</button>
              ))}
            </div>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={pagerBtn(page === totalPages)}>&lt;</button>
          </div>
        )}

        <div style={{ fontSize: 10, color: MUTED, marginTop: 10, textAlign: "center" }}>
          {PER_PAGE} פרויקטים לעמוד
        </div>
      </div>

      {showNewProject && typeof document !== "undefined" && (
        <NewProjectModal
          artists={artists}
          clientNames={clientNames}
          onClose={() => setShowNewProject(false)}
          onCreate={async (fields) => {
            const newId = await createProject({
              name: fields.name,
              artist: fields.artist,
              status: fields.status,
              projectType: fields.projectType,
              deadline: fields.deadline,
              notes: fields.notes,
            });
            const trimmed = fields.artist.trim();
            if (trimmed && !clientNames.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
              try {
                await fetch("/api/clients", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: trimmed, type: "אמן", status: "חדש" }),
                });
                const res = await fetch("/api/clients");
                const d = await res.json();
                if (d.clients) setClientNames((d.clients as { name: string }[]).map(c => c.name));
                if (newId && (fields.projectType === "אלבום" || fields.projectType === "EP")) {
                  setShowNewProject(false);
                  openProject(newId);
                  return { newClientAdded: trimmed };
                }
                return { newClientAdded: trimmed };
              } catch {
                return { newClientAdded: trimmed };
              }
            }
            if (newId && (fields.projectType === "אלבום" || fields.projectType === "EP")) {
              setShowNewProject(false);
              openProject(newId);
            }
            return {};
          }}
        />
      )}
    </div>
  );
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "5px 10px", borderRadius: 7,
    border: `1px solid ${BORDER}`,
    background: "transparent",
    color: disabled ? "#333" : SUB,
    fontSize: 12, cursor: disabled ? "default" : "pointer",
  };
}

// ── Desktop row ───────────────────────────────────────────────────────────────
function ProjectRow({
  project: p, finance, isLast, onOpen, player,
}: {
  project: Project; finance?: { paid: number; agreed: number }; isLast: boolean; onOpen: (id: string) => void; player: ReturnType<typeof usePlayerSafe>;
}) {
  const [hovered, setHovered] = useState(false);
  const dlColor   = deadlineBadgeColor(p);
  const remaining = finance ? Math.max(0, finance.agreed - finance.paid) : 0;

  // Split multi-artist string into chips
  const artistNames = p.artist
    ? p.artist.split(/[,،;]/).map(a => a.trim()).filter(Boolean)
    : [];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "36px 2.2fr 1.2fr 130px 80px 110px 110px 1fr 80px",
        padding: "13px 16px", gap: 10,
        borderBottom: isLast ? "none" : `1px solid ${BORDER}`,
        background: hovered ? "rgba(255,255,255,0.022)" : "transparent",
        transition: "background 0.1s",
        alignItems: "center",
      }}
    >
      {/* Play */}
      <div><ProjectPlayBtn p={p} player={player} /></div>

      {/* Project name */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span
          onClick={() => onOpen(p.id)}
          style={{
            fontSize: 13, fontWeight: 600, color: TEXT,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
          {p.name}
        </span>
      </div>

      {/* Artist chips — max 2 visible + overflow badge */}
      <div style={{ display: "flex", flexWrap: "nowrap", gap: 4, minWidth: 0, overflow: "hidden" }}>
        {artistNames.length > 0 ? (
          <>
            {artistNames.slice(0, 2).map(name => <ArtistChip key={name} name={name} />)}
            {artistNames.length > 2 && (
              <span
                title={artistNames.slice(2).join(", ")}
                style={{
                  display: "inline-block", fontSize: 10, fontWeight: 700,
                  color: MUTED, background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${BORDER}`, borderRadius: 6,
                  padding: "2px 6px", whiteSpace: "nowrap", cursor: "default",
                }}
              >
                +{artistNames.length - 2}
              </span>
            )}
          </>
        ) : (
          <span style={{ color: MUTED, fontSize: 12 }}>—</span>
        )}
      </div>

      {/* Status */}
      <div><StatusDropdown projectId={p.id} status={p.status} small /></div>

      {/* Type */}
      <div><TypeBadge type={p.projectType} /></div>

      {/* Expected income */}
      <div style={{ fontSize: 13, color: remaining > 0 ? "#F59E0B" : MUTED, fontWeight: remaining > 0 ? 700 : 400 }}>
        {remaining > 0 ? `₪${remaining.toLocaleString()}` : "—"}
      </div>

      {/* Deadline */}
      <div>
        <div style={{ fontSize: 12, color: dlColor, fontWeight: p.isOverdue && p.status !== "הושלם" ? 700 : 400 }}>
          {formatDeadline(p.deadline)}
        </div>
        {p.isOverdue && p.status !== "הושלם" && (
          <div style={{ fontSize: 10, color: "#EF4444", marginTop: 1 }}>באיחור</div>
        )}
      </div>

      {/* Notes */}
      <div style={{ fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {p.notes || "—"}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <div onClick={e => e.stopPropagation()}>
          <UploadButton
            projectId={p.id}
            projectName={p.name}
            artist={p.artist ?? ""}
            existingFiles={p.files}
            status={p.status}
            size="sm"
          />
        </div>
        <div onClick={e => e.stopPropagation()}>
          <ActionMenu
            projectId={p.id}
            projectName={p.name}
            artist={p.artist ?? ""}
          />
        </div>
      </div>
    </div>
  );
}

// ── Cover art placeholder (used by MobileCard) ───────────────────────────────
function CoverArt({ project: p, size }: { project: Project; size: number }) {
  const coverUrl = (p as unknown as Record<string, unknown>).cover_url as string | undefined;
  if (coverUrl) {
    return (
      <img
        src={coverUrl}
        alt={p.name}
        style={{ width: size, height: size, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  const typeColor = TYPE_COLORS[p.projectType] ?? "#6B7280";
  return (
    <div style={{
      width: size, height: size, borderRadius: 10, flexShrink: 0,
      background: `linear-gradient(145deg, ${typeColor}33, ${typeColor}11)`,
      border: `1px solid ${typeColor}30`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.4, fontWeight: 900, color: typeColor,
      letterSpacing: "-0.02em",
    }}>
      {p.name.charAt(0)}
    </div>
  );
}

// ── Mobile card ───────────────────────────────────────────────────────────────
function MobileCard({ project: p, finance, onOpen, player }: { project: Project; finance?: { paid: number; agreed: number }; onOpen: (id: string) => void; player: ReturnType<typeof usePlayerSafe> }) {
  const remaining = finance ? Math.max(0, finance.agreed - finance.paid) : 0;
  const artistList = p.artist ? p.artist.split(/[,،;]/).map(a => a.trim()).filter(Boolean) : [];
  const visibleArtists = artistList.slice(0, 3);
  const extraArtists = artistList.length > 3 ? artistList.length - 3 : 0;
  const dlColor = deadlineBadgeColor(p);

  return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16,
      padding: "14px 14px 10px", boxShadow: CARD_SHADOW,
    }}>
      {/* Main content row: info (right) + play (left) — RTL */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ProjectPlayBtn p={p} player={player} size={42} />
        <div
          onClick={() => onOpen(p.id)}
          style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
        >
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {p.name}
          </div>
          <div style={{ fontSize: 13, color: SUB, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {visibleArtists.length > 0
              ? visibleArtists.join(", ") + (extraArtists > 0 ? ` +${extraArtists}` : "")
              : "—"}
          </div>
          {p.deadline && (
            <div style={{ fontSize: 11, color: dlColor, marginTop: 5 }}>
              <span>📅 תאריך יעד: {formatDeadline(p.deadline)}{formatTimeRemaining(p.deadline, p.status)}</span>
              {p.isOverdue && p.status !== "הושלם" && (
                <span style={{ color: "#EF4444", fontWeight: 700 }}> · באיחור</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Actions row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
        <div onClick={e => e.stopPropagation()}>
          <ActionMenu projectId={p.id} projectName={p.name} artist={p.artist ?? ""} />
        </div>
        <div onClick={e => e.stopPropagation()}>
          <UploadButton projectId={p.id} projectName={p.name} artist={p.artist ?? ""} existingFiles={p.files} status={p.status} size="sm" />
        </div>
        {remaining > 0 && (
          <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 700, marginRight: 4 }}>
            ₪{remaining.toLocaleString()}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div onClick={e => e.stopPropagation()}>
          <StatusDropdown projectId={p.id} status={p.status} small />
        </div>
      </div>
    </div>
  );
}

// ── NewProjectModal — local copy (ProjectsTable.tsx is not exported) ─────────
function NewProjectModal({
  artists,
  clientNames,
  onClose,
  onCreate,
}: {
  artists: string[];
  clientNames: string[];
  onClose: () => void;
  onCreate: (fields: { name: string; artist: string; status: ProjectStatus; projectType: ProjectType; deadline: string; notes: string }) => Promise<{ newClientAdded?: string }>;
}) {
  const [name,        setName]        = useState("");
  const [artist,      setArtist]      = useState("");
  const [status,      setStatus]      = useState<ProjectStatus>("לא התחיל");
  const [projectType, setProjectType] = useState<ProjectType>("שיר");
  const [deadline,    setDeadline]    = useState("");
  const [notes,       setNotes]       = useState("");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [newClientWarning, setNewClientWarning] = useState("");
  const [artistOpen, setArtistOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !newClientWarning) onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose, newClientWarning]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("שם הפרויקט חובה"); return; }
    setSaving(true);
    setError("");
    try {
      const result = await onCreate({ name: name.trim(), artist: artist.trim(), status, projectType, deadline, notes });
      if (result?.newClientAdded) {
        setNewClientWarning(result.newClientAdded);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em",
    textTransform: "uppercase", marginBottom: 6, display: "block", textAlign: "right",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%", background: "#111", border: "1px solid #2A2A2A",
    borderRadius: 10, color: "#E8E8E8", fontSize: 13, padding: "9px 12px",
    outline: "none", direction: "rtl", fontFamily: "inherit", boxSizing: "border-box" as const,
  };

  const trimmedArtist = artist.trim();
  const isNewArtist = trimmedArtist.length > 0 && !clientNames.some(
    c => c.toLowerCase() === trimmedArtist.toLowerCase()
  );
  const filteredArtists = trimmedArtist.length === 0
    ? []
    : artists.filter(a => a.toLowerCase().includes(trimmedArtist.toLowerCase())).slice(0, 8);

  return createPortal(
    <div
      onClick={() => { if (!newClientWarning) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 99998,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#141414", border: "1px solid #2A2A2A",
          borderRadius: 18, padding: "28px 28px 22px",
          width: 420, maxWidth: "90vw", direction: "rtl",
          boxShadow: "0 24px 64px rgba(0,0,0,0.85)",
        }}
      >
        {newClientWarning ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#E8E8E8", margin: "0 0 10px" }}>
              הפרויקט נוצר בהצלחה!
            </h2>
            <div style={{
              background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 12, padding: "14px 16px", marginBottom: 20, textAlign: "right",
            }}>
              <p style={{ color: "#F59E0B", fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>
                🆕 אמן חדש נוסף ללקוחות
              </p>
              <p style={{ color: "#D4A855", fontSize: 12, margin: "0 0 4px" }}>
                <strong>{newClientWarning}</strong> נוסף אוטומטית לרשימת הלקוחות
              </p>
              <p style={{ color: "#888", fontSize: 12, margin: 0 }}>
                ⚡ נדרש טיפול: חסר כתובת מייל לאמן זה — כנסו ללקוחות והשלימו את הפרטים
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 10, border: "none",
                background: "#1E40AF", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
              }}
            >
              הבנתי, סגור
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#E8E8E8", margin: 0 }}>פרויקט חדש</h2>
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>שם הפרויקט *</label>
                <input ref={nameRef} value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="שם הפרויקט..." />
              </div>
              <div>
                <label style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {isNewArtist && (
                    <span style={{ color: "#F59E0B", fontSize: 10, fontWeight: 600 }}>
                      🆕 אמן חדש — יתווסף ללקוחות
                    </span>
                  )}
                  <span>אמן</span>
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    value={artist}
                    onChange={e => { setArtist(e.target.value); setArtistOpen(true); }}
                    onFocus={() => { if (artist.trim()) setArtistOpen(true); }}
                    onBlur={() => setTimeout(() => setArtistOpen(false), 150)}
                    style={{ ...inputStyle, borderColor: isNewArtist ? "rgba(245,158,11,0.4)" : "#2A2A2A" }}
                    placeholder="שם האמן..."
                  />
                  {artistOpen && filteredArtists.length > 0 && (
                    <ul style={{
                      position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
                      background: "#1A1A1A", border: "1px solid #2A2A2A",
                      borderRadius: 10, marginTop: 4,
                      maxHeight: 200, overflowY: "auto",
                      listStyle: "none", padding: "4px 0", margin: 0,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                    }}>
                      {filteredArtists.map(a => (
                        <li
                          key={a}
                          onMouseDown={() => { setArtist(a); setArtistOpen(false); }}
                          style={{ padding: "8px 14px", fontSize: 13, color: "#D0D0D0", cursor: "pointer", direction: "rtl" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >
                          {a}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={labelStyle}>סטטוס</label>
                  <select value={status} onChange={e => setStatus(e.target.value as ProjectStatus)} style={inputStyle}>
                    {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>סוג</label>
                  <select value={projectType} onChange={e => setProjectType(e.target.value as ProjectType)} style={inputStyle}>
                    {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>דדליין</label>
                <DatePickerInput value={deadline} onChange={setDeadline} style={{ ...inputStyle }} />
              </div>
              <div>
                <label style={labelStyle}>הערות</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle} placeholder="הערות אופציונליות..." />
              </div>
              {error && <p style={{ color: "#EF4444", fontSize: 12, margin: 0, textAlign: "center" }}>{error}</p>}
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button
                  type="button" onClick={onClose}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "1px solid #2A2A2A", background: "transparent", color: "#777", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}
                >
                  ביטול
                </button>
                <button
                  type="submit" disabled={saving}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: 12, border: "none",
                    background: saving ? "#1D3A5F" : "#1E40AF", color: "#fff",
                    cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                  }}
                >
                  {saving ? "שומר..." : "צור פרויקט"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── ArtistChip needs to be a standalone component for hooks ──────────────────
function ArtistChip({ name }: { name: string }) {
  const [h, setH] = useState(false);
  return (
    <span
      title="פתח תיק לקוח"
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => console.log("open client:", name)}
      style={{
        display: "inline-block",
        fontSize: 11, fontWeight: 600,
        color: h ? TEXT : SUB,
        background: h ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${h ? "rgba(255,255,255,0.18)" : BORDER}`,
        borderRadius: 6, padding: "2px 8px",
        cursor: "pointer", transition: "all 0.12s",
        whiteSpace: "nowrap", maxWidth: 140,
        overflow: "hidden", textOverflow: "ellipsis",
      }}
    >
      {name}
    </span>
  );
}
