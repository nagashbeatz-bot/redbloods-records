"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";
import { daysUntilDeadline } from "@/lib/utils";

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

export default function StatsGrid({ projects }: { projects: Project[] }) {
  const [moreOpen, setMoreOpen] = useState(false);

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
      <div className="hidden md:grid grid-cols-4 xl:grid-cols-8 gap-3">
        <StatCard label="סה״כ"          count={total}   color="#F0F0F0" icon="◈" />
        <StatCard label="פעילים"        count={active}  color="#3B82F6" icon="▶"  sectionId="section-active" />
        <StatCard label="מחכה למיקס"   count={waitMix} color="#F59E0B" icon="🎚" dim sectionId="section-wait-mix" />
        <StatCard label="במיקס"         count={inMix}   color="#A855F7" icon="🎛" dim sectionId="section-in-mix" />
        <StatCard label="בהשהייה"      count={onHold}  color="#6B7280" icon="⏸" dim sectionId="section-on-hold" />
        <StatCard label="הושלמו"       count={done}    color="#10B981" icon="✓"  dim sectionId="section-done" />
        <StatCard label="עברו דדליין"  count={overdue} color="#EF4444" icon="⚠" dim sectionId="section-overdue" />
        <StatCard label="קרוב לדדליין" count={dueSoon} color="#F97316" icon="⏳" dim sectionId="section-due-soon" />
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
          </div>
        )}
      </div>
    </>
  );
}
