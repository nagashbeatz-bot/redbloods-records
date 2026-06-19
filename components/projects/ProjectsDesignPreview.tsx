"use client";

import { useState, useEffect, useMemo } from "react";
import { useProjects } from "@/components/ProjectsProvider";
import { daysUntilDeadline, getStatusColor, getStatusBg } from "@/lib/utils";
import type { Project, ProjectStatus, ProjectType } from "@/lib/types";
import { ALL_STATUSES, PROJECT_TYPES } from "@/lib/types";

// ── Design tokens (same as DashboardDesignPreview) ───────────────────────────
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

function deadlineBadgeColor(p: Project): string {
  if (p.isOverdue && p.status !== "הושלם") return "#EF4444";
  const d = daysUntilDeadline(p.deadline);
  if (d !== null && d <= 7 && p.status !== "הושלם") return "#F59E0B";
  return MUTED;
}

// ── SVG icons (identical to DashboardDesignPreview) ──────────────────────────
function PlayIcon({ size = 9, color = "#999" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 12" fill={color} style={{ display: "block" }}>
      <path d="M1 1L9 6L1 11V1Z" />
    </svg>
  );
}

// ── Play button — visual only, same style as dashboard PlayBtn ────────────────
function PlayBtn() {
  return (
    <div style={{
      width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.10)",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "default",
    }}>
      <PlayIcon size={8} color="#888" />
    </div>
  );
}

// ── KPI Card — compact, same language as dashboard ────────────────────────────
function KpiCard({
  label, value, sub, color, icon,
}: {
  label: string; value: string; sub?: string; color: string; icon: string;
}) {
  return (
    <div style={{
      background: CARD,
      border: `1px solid ${BORDER}`,
      borderRadius: 12,
      padding: "12px 14px",
      boxShadow: CARD_SHADOW,
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {label}
        </div>
        <span style={{ fontSize: 14, opacity: 0.6 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: MUTED }}>{sub}</div>}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: ProjectStatus }) {
  const color = getStatusColor(status);
  const bg    = getStatusBg(status);
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color,
      background: bg,
      border: `1px solid ${color}35`,
      borderRadius: 6,
      padding: "2px 7px",
      whiteSpace: "nowrap",
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }} />
      {status}
    </span>
  );
}

// ── Type badge ────────────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: ProjectType }) {
  if (!type) return null;
  const color = TYPE_COLORS[type] ?? "#6B7280";
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color,
      background: `${color}18`,
      border: `1px solid ${color}35`,
      borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap",
    }}>
      {type}
    </span>
  );
}

// ── Filter chip ───────────────────────────────────────────────────────────────
function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 10px", borderRadius: 7,
        border: `1px solid ${active ? "rgba(220,38,38,0.4)" : "#252525"}`,
        fontSize: 11, fontWeight: 500, cursor: "pointer",
        fontFamily: "inherit",
        background: active ? "rgba(220,38,38,0.1)" : "#1A1A1A",
        color: active ? BRAND : "#666",
        transition: "all 0.12s",
      }}
    >
      {label}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProjectsDesignPreview() {
  const { projects, loading } = useProjects();

  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState<"כל הסטטוסים" | ProjectStatus>("כל הסטטוסים");
  const [typeFilter,   setTypeFilter]   = useState<ProjectType | "">("");
  const [isMobile,     setIsMobile]     = useState(false);

  const [financeSummary, setFinanceSummary] = useState<
    Record<string, { paid: number; agreed: number }>
  >({});

  useEffect(() => {
    fetch("/api/transactions?all=1")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, { paid: number; agreed: number }> = {};
        (d.settings ?? []).forEach((s: { project_id: string; agreedPrice: number }) => {
          if (!map[s.project_id]) map[s.project_id] = { paid: 0, agreed: 0 };
          map[s.project_id].agreed = s.agreedPrice ?? 0;
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

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .filter((p) => !p.isHidden)
      .filter((p) => statusFilter === "כל הסטטוסים" || p.status === statusFilter)
      .filter((p) => !typeFilter || p.projectType === typeFilter)
      .filter((p) =>
        !q || p.name.toLowerCase().includes(q) || p.artist.toLowerCase().includes(q)
      );
  }, [projects, search, statusFilter, typeFilter]);

  const kpi = useMemo(() => {
    const active = projects.filter((p) => !p.isHidden);
    const knownIds = new Set(active.map((p) => p.id));
    const totalExpected = Object.entries(financeSummary)
      .filter(([id]) => knownIds.has(id))
      .reduce((s, [, f]) => s + Math.max(0, f.agreed - f.paid), 0);
    const now = new Date();
    return {
      total:          active.length,
      inProgress:     active.filter((p) => ["בעבודה", "במיקס", "מחכה למיקס"].includes(p.status)).length,
      completedMonth: active.filter((p) => {
        if (p.status !== "הושלם" || !p.endDate) return false;
        const d = new Date(p.endDate);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length,
      overdue:   active.filter((p) => p.isOverdue && p.status !== "הושלם").length,
      expected:  totalExpected,
    };
  }, [projects, financeSummary]);

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
  const PER_PAGE    = 10;
  const totalPages  = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const pageRows    = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  useEffect(() => setPage(1), [search, statusFilter, typeFilter]);

  if (loading) {
    return <div style={{ padding: 32, color: SUB }}>טוען פרויקטים...</div>;
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", color: TEXT, fontFamily: "inherit", direction: "rtl" }}>

      {/* ── Top action bar ───────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: isMobile ? "9px 14px" : "10px 24px",
        borderBottom: `1px solid ${BORDER}`,
        background: SURFACE,
      }}>
        <button
          onClick={() => console.log("upload — not wired")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 9,
            background: BRAND, border: "none",
            color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
          {!isMobile && "העלאת פרויקט / קובץ"}
        </button>

        <button
          onClick={() => console.log("quick actions — not wired")}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "7px 12px", borderRadius: 9,
            background: "rgba(220,38,38,0.07)",
            border: `1px solid rgba(220,38,38,0.25)`,
            color: BRAND, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}
        >
          <span style={{ fontSize: 13 }}>⚡</span>
          {!isMobile && "פעולות מהירות"}
        </button>
      </div>

      <div style={{ padding: isMobile ? "14px" : "20px 24px" }}>

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: TEXT, margin: 0 }}>פרויקטים</h1>
          <p style={{ fontSize: 11, color: MUTED, margin: "3px 0 0" }}>
            ניהול והפקה של {projects.filter(p => !p.isHidden).length} פרויקטים בלייבל
          </p>
        </div>

        {/* ── KPI cards — compact 5-col ────────────────────────────────────── */}
        {!isMobile && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 14 }}>
            <KpiCard label="סה״כ פרויקטים" value={String(kpi.total)}          sub="בכל הפרויקטים"       color="#818CF8" icon="📁" />
            <KpiCard label="בתהליך"         value={String(kpi.inProgress)}     sub="פרויקטים פעילים"     color="#60A5FA" icon="🎵" />
            <KpiCard label="הושלמו החודש"   value={String(kpi.completedMonth)} sub="הצלחה בהצלחה"        color="#10B981" icon="✅" />
            <KpiCard label="באיחור"          value={String(kpi.overdue)}        sub="דורש טיפול"          color={kpi.overdue > 0 ? "#EF4444" : MUTED} icon="⚠️" />
            <KpiCard label="הכנסה צפויה"    value={kpi.expected > 0 ? `₪${kpi.expected.toLocaleString()}` : "—"} sub="לגבייה" color="#F59E0B" icon="💰" />
          </div>
        )}

        {/* ── Search + filters ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: 12 }}>
          {/* Search + status chips in one row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: SURFACE, border: `1px solid ${BORDER}`,
              borderRadius: 8, padding: "5px 10px", flexShrink: 0,
            }}>
              <span style={{ color: MUTED, fontSize: 12 }}>🔍</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש..."
                style={{
                  background: "transparent", border: "none", outline: "none",
                  color: TEXT, fontSize: 12, fontFamily: "inherit",
                  width: 140, direction: "rtl",
                }}
              />
              {search && (
                <button onClick={() => setSearch("")} style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
              )}
            </div>

            {/* Status chips */}
            <FilterChip label="הכל" active={statusFilter === "כל הסטטוסים"} onClick={() => setStatusFilter("כל הסטטוסים")} />
            {ALL_STATUSES.map((s) => (
              <FilterChip key={s} label={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
            ))}
          </div>

          {/* Type chips */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <FilterChip label="כל הסוגים" active={typeFilter === ""} onClick={() => setTypeFilter("")} />
            {PROJECT_TYPES.map((t) => (
              <FilterChip key={t} label={t} active={typeFilter === t} onClick={() => setTypeFilter(t)} />
            ))}
          </div>
        </div>

        {/* Results count */}
        <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>
          {sorted.length} פרויקטים מוצגים
        </div>

        {/* ── Desktop table ─────────────────────────────────────────────────── */}
        {!isMobile && (
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
            {/* Header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "28px 2fr 1.1fr 120px 70px 100px 100px 1fr 72px",
              padding: "8px 14px",
              borderBottom: `1px solid ${BORDER}`,
              fontSize: 10, fontWeight: 700, color: MUTED,
              letterSpacing: "0.06em", textTransform: "uppercase",
              gap: 8,
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
              <div style={{ padding: "32px 16px", textAlign: "center", color: MUTED }}>לא נמצאו פרויקטים</div>
            ) : pageRows.map((p, i) => (
              <ProjectRow
                key={p.id}
                project={p}
                finance={financeSummary[p.id]}
                isLast={i === pageRows.length - 1}
              />
            ))}
          </div>
        )}

        {/* ── Mobile cards ─────────────────────────────────────────────────── */}
        {isMobile && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pageRows.length === 0
              ? <div style={{ padding: 32, textAlign: "center", color: MUTED }}>לא נמצאו פרויקטים</div>
              : pageRows.map((p) => (
                  <MobileProjectCard key={p.id} project={p} finance={financeSummary[p.id]} />
                ))
            }
          </div>
        )}

        {/* ── Pagination ───────────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={pageBtnStyle(page === 1)}>&gt;</button>
            <div style={{ display: "flex", gap: 5 }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => setPage(n)} style={{
                  width: 28, height: 28, borderRadius: 7,
                  border: `1px solid ${n === page ? "rgba(220,38,38,0.4)" : BORDER}`,
                  background: n === page ? "rgba(220,38,38,0.12)" : "transparent",
                  color: n === page ? BRAND : SUB,
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}>{n}</button>
              ))}
            </div>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={pageBtnStyle(page === totalPages)}>&lt;</button>
          </div>
        )}

        <div style={{ fontSize: 10, color: MUTED, marginTop: 8, textAlign: "center" }}>
          {PER_PAGE} פרויקטים לעמוד
        </div>
      </div>
    </div>
  );
}

function pageBtnStyle(disabled: boolean): React.CSSProperties {
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
  project: p, finance, isLast,
}: {
  project: Project;
  finance?: { paid: number; agreed: number };
  isLast: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const dlColor   = deadlineBadgeColor(p);
  const remaining = finance ? Math.max(0, finance.agreed - finance.paid) : 0;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "28px 2fr 1.1fr 120px 70px 100px 100px 1fr 72px",
        padding: "10px 14px",
        gap: 8,
        borderBottom: isLast ? "none" : `1px solid ${BORDER}`,
        background: hovered ? "rgba(255,255,255,0.018)" : "transparent",
        transition: "background 0.1s",
        alignItems: "center",
      }}
    >
      {/* Play — left of name, visual only */}
      <div><PlayBtn /></div>

      {/* Project name */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{
          fontSize: 13, fontWeight: 600, color: TEXT,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {p.name}
        </span>
        {p.isOverdue && p.status !== "הושלם" && (
          <span style={{ fontSize: 8, color: "#EF4444", flexShrink: 0 }}>●</span>
        )}
      </div>

      {/* Artist */}
      <div style={{ fontSize: 12, color: SUB, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {p.artist || "—"}
      </div>

      {/* Status */}
      <div><StatusBadge status={p.status} /></div>

      {/* Type */}
      <div><TypeBadge type={p.projectType} /></div>

      {/* Expected income */}
      <div style={{ fontSize: 12, color: remaining > 0 ? "#F59E0B" : MUTED, fontWeight: remaining > 0 ? 600 : 400 }}>
        {remaining > 0 ? `₪${remaining.toLocaleString()}` : "—"}
      </div>

      {/* Deadline */}
      <div>
        <div style={{ fontSize: 12, color: dlColor, fontWeight: p.isOverdue ? 700 : 400 }}>
          {formatDeadline(p.deadline)}
        </div>
        {p.isOverdue && p.status !== "הושלם" && (
          <div style={{ fontSize: 10, color: "#EF4444" }}>באיחור</div>
        )}
      </div>

      {/* Notes */}
      <div style={{
        fontSize: 11, color: MUTED,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {p.notes || "—"}
      </div>

      {/* Actions: upload + quick actions only */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
        <ActionBtn title="העלאת קובץ" label="↑" onClick={() => console.log("upload:", p.name)} />
        <ActionBtn title="פעולות מהירות" label="⚡" onClick={() => console.log("actions:", p.name)} />
      </div>
    </div>
  );
}

// ── Small action button (upload / quick-actions) ──────────────────────────────
function ActionBtn({ title, label, onClick }: { title: string; label: string; onClick: () => void }) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: 26, height: 26, borderRadius: "50%",
        background: h ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${h ? "rgba(255,255,255,0.15)" : BORDER}`,
        color: h ? SUB : MUTED,
        fontSize: 12, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.12s",
      }}
    >
      {label}
    </button>
  );
}

// ── Mobile card ───────────────────────────────────────────────────────────────
function MobileProjectCard({
  project: p, finance,
}: {
  project: Project;
  finance?: { paid: number; agreed: number };
}) {
  const remaining = finance ? Math.max(0, finance.agreed - finance.paid) : 0;
  return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12,
      padding: "12px 14px", boxShadow: CARD_SHADOW,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PlayBtn />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{p.name}</div>
            <div style={{ fontSize: 11, color: SUB }}>{p.artist || "—"}</div>
          </div>
        </div>
        <StatusBadge status={p.status} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <TypeBadge type={p.projectType} />
        {p.deadline && (
          <span style={{ fontSize: 11, color: deadlineBadgeColor(p) }}>📅 {formatDeadline(p.deadline)}</span>
        )}
        {remaining > 0 && (
          <span style={{ fontSize: 11, color: "#F59E0B" }}>₪{remaining.toLocaleString()}</span>
        )}
      </div>
      {p.notes && (
        <div style={{ fontSize: 11, color: MUTED, marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
          {p.notes}
        </div>
      )}
    </div>
  );
}
