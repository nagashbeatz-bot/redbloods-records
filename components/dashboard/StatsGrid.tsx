"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
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

function useProposalData(): { stats: ProposalStats; items: ProposalItem[]; today: string } {
  const today = new Date().toISOString().split("T")[0];
  const [stats, setStats] = useState<ProposalStats>({ open: 0, followupToday: 0, overdue: 0, totalAmount: 0 });
  const [items, setItems] = useState<ProposalItem[]>([]);

  useEffect(() => {
    fetch("/api/proposals/all")
      .then((r) => r.json())
      .then((data) => {
        const all: ProposalItem[] = data.proposals ?? [];
        const open = all.filter((p) => !CLOSED_STATUSES.has(p.status));
        const followupToday = open.filter((p) => p.followup_date === today).length;
        const overdue       = open.filter((p) => p.followup_date && p.followup_date < today).length;
        const totalAmount   = open.filter((p) => p.currency === "₪").reduce((s, p) => s + (p.amount ?? 0), 0);
        setStats({ open: open.length, followupToday, overdue, totalAmount });
        setItems(open);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { stats, items, today };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scrollToSection(sectionId: string) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("section-highlight");
  setTimeout(() => el.classList.remove("section-highlight"), 900);
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

// ── Main ─────────────────────────────────────────────────────────────────────

// ── Proposals modal ───────────────────────────────────────────────────────────

interface ProposalItem {
  id: string; title: string; client_name: string; client_id: string;
  amount: number; currency: string; status: string;
  followup_date: string | null;
}

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
}

function ProposalsModal({ proposals, today, onClose }: {
  proposals: ProposalItem[]; today: string; onClose: () => void;
}) {
  const overdue = proposals.filter((p) => p.followup_date && p.followup_date < today);
  const todayDue = proposals.filter((p) => p.followup_date === today);
  const future = proposals.filter((p) => !p.followup_date || p.followup_date > today);

  const groups: Array<{ label: string; color: string; items: ProposalItem[] }> = [
    { label: "⚠ עבר תאריך מעקב",    color: "#EF4444", items: overdue },
    { label: "📌 מעקב היום",          color: "#F59E0B", items: todayDue },
    { label: "הצעות פתוחות",          color: "#A855F7", items: future },
  ].filter((g) => g.items.length > 0);

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "80vh", display: "flex", flexDirection: "column", direction: "rtl", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #222", flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0" }}>📋 הצעות מחיר</span>
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
                {g.items.map((p) => (
                  <div key={p.id} style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#D8D8D8" }}>{p.title}</div>
                        <div style={{ fontSize: 11, color: "#555" }}>{p.client_name}</div>
                      </div>
                      <div style={{ textAlign: "left", flexShrink: 0 }}>
                        {p.amount > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: "#A855F7" }}>{p.amount.toLocaleString("he-IL")}{p.currency}</div>}
                        <div style={{ fontSize: 10, color: "#444" }}>{p.status}</div>
                      </div>
                    </div>
                    {p.followup_date && (
                      <div style={{ fontSize: 11, color: p.followup_date < today ? "#EF4444" : p.followup_date === today ? "#F59E0B" : "#555" }}>
                        מעקב: {fmtDate(p.followup_date)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Proposals card ────────────────────────────────────────────────────────────

function ProposalsCard({ stats, proposals, today }: { stats: ProposalStats; proposals: ProposalItem[]; today: string }) {
  const [modalOpen, setModalOpen] = useState(false);

  // Main count: overdue > today > open
  const mainCount = stats.overdue > 0 ? stats.overdue : stats.followupToday > 0 ? stats.followupToday : stats.open;
  const mainColor = stats.overdue > 0 ? "#EF4444" : stats.followupToday > 0 ? "#F59E0B" : stats.open > 0 ? "#A855F7" : "#333";
  const sub = [
    stats.open > 0 ? `${stats.open} פתוחות` : null,
    stats.totalAmount > 0 ? `${stats.totalAmount.toLocaleString("he-IL")}₪` : null,
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
        {/* Label + icon row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: "#666", lineHeight: 1.3 }}>הצעות מחיר</span>
          <span style={{ fontSize: 15, opacity: 0.6, flexShrink: 0, lineHeight: 1 }}>📋</span>
        </div>

        {/* Main count */}
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, color: mainColor }}>
          {mainCount}
        </div>

        {/* Sub-line */}
        <div style={{ fontSize: 11, color: "#4A4A4A", lineHeight: 1, userSelect: "none" }}>
          {sub || "↓ לצפייה"}
        </div>
      </div>

      {modalOpen && (
        <ProposalsModal proposals={proposals} today={today} onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}

export default function StatsGrid({ projects }: { projects: Project[] }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { stats: proposalStats, items: proposalItems, today: proposalToday } = useProposalData();

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
        <ProposalsCard stats={proposalStats} proposals={proposalItems} today={proposalToday} />
      </div>

      {/* ── Mobile: 4 key pills + accordion ── */}
      <div className="md:hidden">
        {/* Primary 2×2 grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <MobileStatPill label="פעילים"       count={active}  color="#3B82F6" icon="▶"  sectionId="section-active" />
          <MobileStatPill label="עברו דדליין"  count={overdue} color="#EF4444" icon="⚠" dim sectionId="section-overdue" />
          <MobileStatPill label="קרוב לדדליין" count={dueSoon} color="#F97316" icon="⏳" dim sectionId="section-due-soon" />
          <MobileStatPill label="סה״כ"          count={total}   color="#888"    icon="◈" />
        </div>

        {/* Accordion for more stats */}
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
              <ProposalsCard stats={proposalStats} proposals={proposalItems} today={proposalToday} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
