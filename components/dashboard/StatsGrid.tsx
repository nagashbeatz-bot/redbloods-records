"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/types";
import { daysUntilDeadline } from "@/lib/utils";

// ── Proposal stats ────────────────────────────────────────────────────────────

interface ProposalStats {
  open: number;
  followupToday: number;
  overdue: number;
  totalAmount: number;
}

const CLOSED_STATUSES = new Set(["נסגר", "לא נסגר"]);

function useProposalData(): { stats: ProposalStats; items: ProposalItem[]; today: string; refresh: () => void } {
  const today = new Date().toISOString().split("T")[0];
  const [stats, setStats] = useState<ProposalStats>({ open: 0, followupToday: 0, overdue: 0, totalAmount: 0 });
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [tick,  setTick]  = useState(0);

  useEffect(() => {
    fetch("/api/proposals/all")
      .then((r) => r.json())
      .then((data) => {
        const all: ProposalItem[] = data.proposals ?? [];
        const open          = all.filter((p) => !CLOSED_STATUSES.has(p.status));
        const followupToday = open.filter((p) => p.followup_date === today).length;
        const overdue       = open.filter((p) => p.followup_date && p.followup_date < today).length;
        const totalAmount   = open.filter((p) => p.currency === "₪").reduce((s, p) => s + (p.amount ?? 0), 0);
        setStats({ open: open.length, followupToday, overdue, totalAmount });
        setItems(open);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { stats, items, today, refresh };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scrollToSection(sectionId: string) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("section-highlight");
  setTimeout(() => el.classList.remove("section-highlight"), 900);
}

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
}

// ── Desktop stat card (existing style) ───────────────────────────────────────

interface StatCardProps {
  label: string;
  count: number;
  color: string;
  icon: string;
  dim?: boolean;
  sectionId?: string;
}

function StatCard({ label, count, color, icon, dim, sectionId }: StatCardProps) {
  const clickable = !!sectionId;
  return (
    <div
      className="rounded-2xl border flex flex-col justify-between"
      onClick={clickable ? () => scrollToSection(sectionId) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && scrollToSection(sectionId) : undefined}
      style={{
        background: "#1A1A1A", borderColor: "#252525",
        opacity: dim && count === 0 ? 0.45 : 1,
        cursor: clickable ? "pointer" : "default",
        transition: "border-color 150ms, background 150ms",
        outline: "none", minHeight: 108, padding: "16px 18px 14px",
      }}
      onMouseEnter={(e) => { if (!clickable) return; const el = e.currentTarget as HTMLDivElement; el.style.borderColor = "#3A3A3A"; el.style.background = "#1E1E1E"; }}
      onMouseLeave={(e) => { if (!clickable) return; const el = e.currentTarget as HTMLDivElement; el.style.borderColor = "#252525"; el.style.background = "#1A1A1A"; }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: "#666", lineHeight: 1.3 }}>{label}</span>
        <span style={{ fontSize: 15, opacity: 0.6, flexShrink: 0, lineHeight: 1 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, color }}>
        {count}
      </div>
      <div style={{ fontSize: 11, color: clickable ? "#4A4A4A" : "transparent", userSelect: "none", lineHeight: 1 }}>
        ↓ לצפייה
      </div>
    </div>
  );
}

// ── Mobile stat pill (compact 2×2) ────────────────────────────────────────────

function MobileStatPill({
  label, count, color, icon, sectionId, dim,
}: StatCardProps) {
  const clickable = !!sectionId;
  return (
    <button
      onClick={clickable ? () => scrollToSection(sectionId) : undefined}
      style={{
        flex: "1 1 0", minWidth: 0,
        display: "flex", flexDirection: "column", gap: 4,
        background: "#1A1A1A", border: `1px solid ${count > 0 ? color + "28" : "#252525"}`,
        borderRadius: 14, padding: "14px 14px 12px",
        cursor: clickable ? "pointer" : "default",
        fontFamily: "inherit", textAlign: "right",
        transition: "background 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "#555", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 13, opacity: dim && count === 0 ? 0.3 : 0.7 }}>{icon}</span>
      </div>
      <div style={{
        fontSize: 32, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em",
        color: dim && count === 0 ? "#333" : color,
      }}>
        {count}
      </div>
    </button>
  );
}

// ── Proposal types & colors ───────────────────────────────────────────────────

type ProposalStatus =
  | "הצעה נשלחה" | "ממתין לתשובה" | "צריך פולואפ"
  | "נסגר" | "לא נסגר" | "לחזור בעתיד";

const STATUS_COLOR: Record<ProposalStatus, { bg: string; color: string }> = {
  "הצעה נשלחה":   { bg: "rgba(59,130,246,0.12)",  color: "#60A5FA" },
  "ממתין לתשובה": { bg: "rgba(245,158,11,0.12)",  color: "#FBBF24" },
  "צריך פולואפ":  { bg: "rgba(239,68,68,0.12)",   color: "#F87171" },
  "נסגר":         { bg: "rgba(16,185,129,0.12)",  color: "#34D399" },
  "לא נסגר":      { bg: "rgba(107,114,128,0.12)", color: "#6B7280" },
  "לחזור בעתיד": { bg: "rgba(168,85,247,0.12)",  color: "#C084FC" },
};

const FALLBACK_COLOR = { bg: "rgba(107,114,128,0.12)", color: "#9CA3AF" };

interface ProposalItem {
  id: string; title: string; client_name: string; client_id: string;
  amount: number; currency: string; status: string;
  followup_date: string | null;
}

// ── Proposal detail modal ─────────────────────────────────────────────────────

function ProposalDetailModal({ proposal, today, onClose, onActionDone }: {
  proposal: ProposalItem;
  today: string;
  onClose: () => void;
  onActionDone: () => void;
}) {
  const router = useRouter();
  const [convertStep, setConvertStep] = useState(false);
  const [closeStep,   setCloseStep]   = useState(false);
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const sc       = STATUS_COLOR[proposal.status as ProposalStatus] ?? FALLBACK_COLOR;
  const isClosed = CLOSED_STATUSES.has(proposal.status);

  function openClient() {
    router.push(`/clients?open=${proposal.client_id}`);
    onClose();
  }

  async function handleConvert() {
    if (!convertStep) { setConvertStep(true); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/convert`, { method: "POST" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "שגיאה"); }
      onActionDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
      setConvertStep(false);
    } finally { setBusy(false); }
  }

  async function handleMarkNotClosed() {
    if (!closeStep) { setCloseStep(true); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "לא נסגר" }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "שגיאה"); }
      onActionDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
      setCloseStep(false);
    } finally { setBusy(false); }
  }

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#141414", border: "1px solid #2A2A2A", borderRadius: 18, width: "100%", maxWidth: 420, direction: "rtl", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #1E1E1E" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#D8D8D8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proposal.title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 22, cursor: "pointer", lineHeight: 1, paddingRight: 8 }}>×</button>
        </div>

        {/* Details */}
        <div style={{ padding: "14px 18px 6px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#555" }}>לקוח</span>
            <span style={{ fontSize: 13, color: "#C8C8C8", fontWeight: 500 }}>{proposal.client_name}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#555" }}>סטטוס</span>
            <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 20, background: sc.bg, color: sc.color, border: `1px solid ${sc.color}25` }}>{proposal.status}</span>
          </div>
          {proposal.followup_date && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#555" }}>מעקב</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: proposal.followup_date < today ? "#F87171" : proposal.followup_date === today ? "#FBBF24" : "#777" }}>
                {fmtDate(proposal.followup_date)}
                {proposal.followup_date < today  && " · עבר ⚠"}
                {proposal.followup_date === today && " · היום"}
              </span>
            </div>
          )}
          {error && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 2 }}>{error}</div>}
        </div>

        {/* Actions */}
        <div style={{ padding: "10px 18px 18px", display: "flex", flexDirection: "column", gap: 7, borderTop: "1px solid #1E1E1E", marginTop: 10 }}>

          {/* פתח לקוח — primary */}
          <button
            onClick={openClient}
            style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid rgba(59,130,246,0.4)", background: "rgba(59,130,246,0.1)", color: "#60A5FA", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textAlign: "right" }}
          >
            👤 פתח לקוח
          </button>

          {!isClosed && (
            <>
              {/* פתח הצעה בלקוח */}
              <button
                onClick={openClient}
                style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid #2A2A2A", background: "none", color: "#888", fontSize: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "right" }}
              >
                📋 פתח הצעה בלקוח
              </button>

              {/* הפוך לפרויקט */}
              <button
                onClick={handleConvert}
                disabled={busy}
                style={{
                  padding: "9px 14px", borderRadius: 10,
                  border:      convertStep ? "1px solid rgba(245,158,11,0.5)" : "1px solid #2A2A2A",
                  background:  convertStep ? "rgba(245,158,11,0.1)" : "none",
                  color:       convertStep ? "#FBBF24" : "#888",
                  fontSize: 12, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", textAlign: "right",
                }}
              >
                {busy && convertStep ? "מעבד..." : convertStep ? "לחץ שוב לאישור ←" : "⚡ הפוך לפרויקט"}
              </button>

              {/* סמן כלא נסגר */}
              <button
                onClick={handleMarkNotClosed}
                disabled={busy}
                style={{
                  padding: "8px 14px", borderRadius: 10,
                  border:     closeStep ? "1px solid rgba(107,114,128,0.4)" : "1px solid #1E1E1E",
                  background: "none",
                  color:      closeStep ? "#9CA3AF" : "#3A3A3A",
                  fontSize: 11, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", textAlign: "right",
                }}
              >
                {closeStep ? "לחץ שוב לאישור — סמן כלא נסגר" : "✕ סמן כלא נסגר"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Proposals list modal ──────────────────────────────────────────────────────

function ProposalsModal({ proposals, today, onClose, onActionDone }: {
  proposals: ProposalItem[];
  today: string;
  onClose: () => void;
  onActionDone: () => void;
}) {
  const [selected, setSelected] = useState<ProposalItem | null>(null);

  const overdue  = proposals.filter((p) => p.followup_date && p.followup_date < today);
  const todayDue = proposals.filter((p) => p.followup_date === today);
  const future   = proposals.filter((p) => !p.followup_date || p.followup_date > today);

  const groups: Array<{ label: string; color: string; items: ProposalItem[] }> = [
    { label: "⚠ עבר תאריך מעקב", color: "#EF4444", items: overdue },
    { label: "📌 מעקב היום",       color: "#F59E0B", items: todayDue },
    { label: "הצעות פתוחות",       color: "#A855F7", items: future },
  ].filter((g) => g.items.length > 0);

  return createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "80vh", display: "flex", flexDirection: "column", direction: "rtl", overflow: "hidden" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #222", flexShrink: 0 }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0" }}>📋 הצעות מחיר</span>
              {(overdue.length > 0 || todayDue.length > 0) && (
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>הצעות שדורשות מעקב</div>
              )}
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>

          {/* Body */}
          <div style={{ overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
            {proposals.length === 0 ? (
              <div style={{ textAlign: "center", color: "#444", fontSize: 13, padding: "24px 0" }}>אין הצעות פתוחות</div>
            ) : groups.map((g) => (
              <div key={g.label}>
                <div style={{ fontSize: 10, fontWeight: 700, color: g.color, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>{g.label}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {g.items.map((p) => {
                    const sc = STATUS_COLOR[p.status as ProposalStatus] ?? FALLBACK_COLOR;
                    return (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelected(p)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelected(p)}
                        style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10, padding: "10px 12px", cursor: "pointer", transition: "border-color 120ms, background 120ms" }}
                        onMouseEnter={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = "#333"; el.style.background = "#1E1E1E"; }}
                        onMouseLeave={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = "#252525"; el.style.background = "#1A1A1A"; }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: p.followup_date ? 5 : 0 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#D8D8D8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{p.client_name}</div>
                          </div>
                          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: sc.bg, color: sc.color, border: `1px solid ${sc.color}25`, whiteSpace: "nowrap", flexShrink: 0 }}>{p.status}</span>
                        </div>
                        {p.followup_date && (
                          <div style={{ fontSize: 11, color: p.followup_date < today ? "#EF4444" : p.followup_date === today ? "#F59E0B" : "#555" }}>
                            מעקב: {fmtDate(p.followup_date)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <ProposalDetailModal
          proposal={selected}
          today={today}
          onClose={() => setSelected(null)}
          onActionDone={() => { setSelected(null); onActionDone(); }}
        />
      )}
    </>,
    document.body
  );
}

// ── Proposals card ────────────────────────────────────────────────────────────

function ProposalsCard({ stats, proposals, today, onActionDone }: {
  stats: ProposalStats;
  proposals: ProposalItem[];
  today: string;
  onActionDone: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  const mainCount = stats.overdue > 0 ? stats.overdue : stats.followupToday > 0 ? stats.followupToday : stats.open;
  const mainColor = stats.overdue > 0 ? "#EF4444" : stats.followupToday > 0 ? "#F59E0B" : stats.open > 0 ? "#A855F7" : "#333";
  const sub = [
    stats.open > 0 ? `${stats.open} פתוחות` : null,
    stats.overdue > 0
      ? `${stats.overdue} דורשות מעקב`
      : stats.followupToday > 0
      ? "מעקב היום"
      : null,
  ].filter(Boolean).join(" · ");

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setModalOpen(true); }
  }, []);

  return (
    <>
      <div
        className="rounded-2xl border flex flex-col justify-between"
        role="button"
        tabIndex={0}
        onClick={() => setModalOpen(true)}
        onKeyDown={handleKey}
        style={{
          background: "#1A1A1A", borderColor: "#252525",
          cursor: "pointer", transition: "border-color 150ms, background 150ms",
          outline: "none", minHeight: 108, padding: "16px 18px 14px",
        }}
        onMouseEnter={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = "#3A3A3A"; el.style.background = "#1E1E1E"; }}
        onMouseLeave={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = "#252525"; el.style.background = "#1A1A1A"; }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: "#666", lineHeight: 1.3 }}>הצעות מחיר</span>
          <span style={{ fontSize: 15, opacity: 0.6, flexShrink: 0, lineHeight: 1 }}>📋</span>
        </div>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, color: mainColor }}>
          {mainCount}
        </div>
        <div style={{ fontSize: 11, color: "#4A4A4A", lineHeight: 1, userSelect: "none" }}>
          {sub || "↓ לצפייה"}
        </div>
      </div>

      {modalOpen && (
        <ProposalsModal
          proposals={proposals}
          today={today}
          onClose={() => setModalOpen(false)}
          onActionDone={() => { setModalOpen(false); onActionDone(); }}
        />
      )}
    </>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function StatsGrid({ projects }: { projects: Project[] }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { stats: proposalStats, items: proposalItems, today: proposalToday, refresh } = useProposalData();

  const total    = projects.length;
  const active   = projects.filter((p) => p.status === "בעבודה" || p.status === "מחכה למיקס" || p.status === "במיקס").length;
  const waitMix  = projects.filter((p) => p.status === "מחכה למיקס").length;
  const inMix    = projects.filter((p) => p.status === "במיקס").length;
  const onHold   = projects.filter((p) => p.status === "בהשהייה").length;
  const done     = projects.filter((p) => p.status === "הושלם").length;
  const overdue  = projects.filter((p) => p.isOverdue && p.status !== "הושלם").length;
  const dueSoon  = projects.filter((p) => {
    const d = daysUntilDeadline(p.deadline);
    return d !== null && d >= 0 && d <= 7 && p.status !== "הושלם";
  }).length;

  return (
    <>
      {/* ── Desktop: 4/8-col grid ── */}
      <div className="hidden md:grid grid-cols-4 xl:grid-cols-9 gap-3">
        <StatCard label="סה״כ"          count={total}   color="#F0F0F0" icon="◈" />
        <StatCard label="פעילים"        count={active}  color="#3B82F6" icon="▶"  sectionId="section-active" />
        <StatCard label="מחכה למיקס"   count={waitMix} color="#F59E0B" icon="🎚" dim sectionId="section-wait-mix" />
        <StatCard label="במיקס"         count={inMix}   color="#A855F7" icon="🎛" dim sectionId="section-in-mix" />
        <StatCard label="בהשהייה"      count={onHold}  color="#6B7280" icon="⏸" dim sectionId="section-on-hold" />
        <StatCard label="הושלמו"       count={done}    color="#10B981" icon="✓"  dim sectionId="section-done" />
        <StatCard label="עברו דדליין"  count={overdue} color="#EF4444" icon="⚠" dim sectionId="section-overdue" />
        <StatCard label="קרוב לדדליין" count={dueSoon} color="#F97316" icon="⏳" dim sectionId="section-due-soon" />
        <ProposalsCard
          stats={proposalStats}
          proposals={proposalItems}
          today={proposalToday}
          onActionDone={refresh}
        />
      </div>

      {/* ── Mobile: 4 key pills + accordion ── */}
      <div className="md:hidden">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <MobileStatPill label="פעילים"       count={active}  color="#3B82F6" icon="▶"  sectionId="section-active" />
          <MobileStatPill label="עברו דדליין"  count={overdue} color="#EF4444" icon="⚠" dim sectionId="section-overdue" />
          <MobileStatPill label="קרוב לדדליין" count={dueSoon} color="#F97316" icon="⏳" dim sectionId="section-due-soon" />
          <MobileStatPill label="סה״כ"          count={total}   color="#888"    icon="◈" />
        </div>

        <button
          onClick={() => setMoreOpen((v) => !v)}
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 10,
            border: "1px solid #252525", background: "#141414",
            color: "#555", fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <span>עוד מדדים</span>
          <span style={{ fontSize: 10 }}>{moreOpen ? "▲" : "▼"}</span>
        </button>

        {moreOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <MobileStatPill label="מחכה למיקס"  count={waitMix} color="#F59E0B" icon="🎚" dim sectionId="section-wait-mix" />
            <MobileStatPill label="במיקס"        count={inMix}   color="#A855F7" icon="🎛" dim sectionId="section-in-mix" />
            <MobileStatPill label="בהשהייה"     count={onHold}  color="#6B7280" icon="⏸" dim sectionId="section-on-hold" />
            <MobileStatPill label="הושלמו"      count={done}    color="#10B981" icon="✓"  dim sectionId="section-done" />
            <div style={{ gridColumn: "1 / -1" }}>
              <ProposalsCard
                stats={proposalStats}
                proposals={proposalItems}
                today={proposalToday}
                onActionDone={refresh}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
