"use client";

import type { Project } from "@/lib/types";
import { daysUntilDeadline } from "@/lib/utils";

interface StatCardProps {
  label: string;
  count: number;
  color: string;
  icon: string;
  dim?: boolean;
  sectionId?: string;
}

function scrollToSection(sectionId: string) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // Brief highlight pulse
  el.classList.add("section-highlight");
  setTimeout(() => el.classList.remove("section-highlight"), 900);
}

function StatCard({ label, count, color, icon, dim, sectionId }: StatCardProps) {
  const clickable = !!sectionId;

  return (
    <div
      className="rounded-2xl border p-5 flex flex-col gap-2"
      onClick={clickable ? () => scrollToSection(sectionId) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => (e.key === "Enter" || e.key === " ") && scrollToSection(sectionId)
          : undefined
      }
      style={{
        background: "#1A1A1A",
        borderColor: "#252525",
        opacity: dim && count === 0 ? 0.45 : 1,
        cursor: clickable ? "pointer" : "default",
        transition: "border-color 150ms, background 150ms",
        outline: "none",
      }}
      onMouseEnter={(e) => {
        if (!clickable) return;
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "#3A3A3A";
        el.style.background = "#1E1E1E";
      }}
      onMouseLeave={(e) => {
        if (!clickable) return;
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "#252525";
        el.style.background = "#1A1A1A";
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: "#666" }}>
          {label}
        </span>
        <span className="text-base" style={{ opacity: 0.6 }}>{icon}</span>
      </div>
      <div className="text-3xl font-bold tracking-tight" style={{ color }}>
        {count}
      </div>
      {clickable && (
        <div className="text-xs" style={{ color: "#3A3A3A", marginTop: -4 }}>
          ↓ לצפייה
        </div>
      )}
    </div>
  );
}

export default function StatsGrid({ projects }: { projects: Project[] }) {
  const active = projects.filter(
    (p) => p.status === "בעבודה" || p.status === "מחכה למיקס" || p.status === "במיקס"
  ).length;
  const waitMix = projects.filter((p) => p.status === "מחכה למיקס").length;
  const inMix = projects.filter((p) => p.status === "במיקס").length;
  const onHold = projects.filter((p) => p.status === "בהשהייה").length;
  const done = projects.filter((p) => p.status === "הושלם").length;
  const overdue = projects.filter((p) => p.isOverdue && p.status !== "הושלם").length;
  const dueSoon = projects.filter((p) => {
    const d = daysUntilDeadline(p.deadline);
    return d !== null && d >= 0 && d <= 7 && p.status !== "הושלם";
  }).length;

  return (
    <div className="grid grid-cols-4 xl:grid-cols-8 gap-3">
      <StatCard label="סה״כ"         count={projects.length} color="#F0F0F0" icon="◈" />
      <StatCard label="פעילים"       count={active}          color="#3B82F6" icon="▶"  sectionId="section-active" />
      <StatCard label="מחכה למיקס"  count={waitMix}         color="#F59E0B" icon="🎚" dim sectionId="section-wait-mix" />
      <StatCard label="במיקס"        count={inMix}           color="#A855F7" icon="🎛" dim sectionId="section-in-mix" />
      <StatCard label="בהשהייה"     count={onHold}          color="#6B7280" icon="⏸" dim sectionId="section-on-hold" />
      <StatCard label="הושלמו"      count={done}            color="#10B981" icon="✓"  dim sectionId="section-done" />
      <StatCard label="עברו דדליין" count={overdue}         color="#EF4444" icon="⚠" dim sectionId="section-overdue" />
      <StatCard label="קרוב לדדליין" count={dueSoon}        color="#F97316" icon="⏳" dim sectionId="section-due-soon" />
    </div>
  );
}
