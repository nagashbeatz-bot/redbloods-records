"use client";

import { useProjects } from "@/components/ProjectsProvider";
import StatsGrid from "@/components/dashboard/StatsGrid";
import ProjectSection from "@/components/dashboard/ProjectSection";
import DailyHeader from "@/components/dashboard/DailyHeader";
import HealthAlert from "@/components/ui/HealthAlert";
import CalendarWidget from "@/components/dashboard/CalendarWidget";
import AgentSummaryCard from "@/components/dashboard/AgentSummaryCard";
import { SkeletonSection } from "@/components/ui/Skeleton";
import { daysUntilDeadline } from "@/lib/utils";
import type { Project } from "@/lib/types";

// Renders two optional section nodes in a responsive grid.
// • Both present  → 2-col grid
// • One present   → full-width single column
// • Neither       → null (caller guarantees at least one when using this)
function SectionPair({
  left,
  right,
}: {
  left: React.ReactNode | null;
  right: React.ReactNode | null;
}) {
  if (!left && !right) return null;
  if (!left || !right) {
    return <div>{left ?? right}</div>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {left}
      {right}
    </div>
  );
}

// Returns a section node only when the project list is non-empty.
function section(
  id: string,
  title: string,
  projects: Project[],
  accentColor: string,
  extra?: { showDeadline?: boolean }
): React.ReactNode | null {
  if (projects.length === 0) return null;
  return (
    <div id={id}>
      <ProjectSection
        title={title}
        projects={projects}
        accentColor={accentColor}
        showDeadline={extra?.showDeadline}
      />
    </div>
  );
}

export default function DashboardContent() {
  const { projects, loading } = useProjects();

  if (loading) {
    return (
      <div className="px-3 py-3 md:px-6 md:py-8 space-y-3 md:space-y-8">
        <div style={{ height: 52 }} />
        <div className="grid grid-cols-4 xl:grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 88,
                borderRadius: 16,
                background: "#1A1A1A",
                border: "1px solid #252525",
              }}
            />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SkeletonSection />
          <SkeletonSection />
        </div>
      </div>
    );
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  const overdueRaw = projects.filter(
    (p) => p.isOverdue && p.status !== "הושלם" && p.status !== "בהשהייה"
  );
  // Most overdue first (most negative daysUntil)
  const overdue = [...overdueRaw].sort((a, b) => {
    const da = daysUntilDeadline(a.deadline) ?? 0;
    const db = daysUntilDeadline(b.deadline) ?? 0;
    return da - db;
  });

  const dueSoonRaw = projects.filter((p) => {
    const d = daysUntilDeadline(p.deadline);
    return (
      d !== null &&
      d >= 0 &&
      d <= 7 &&
      p.status !== "הושלם" &&
      p.status !== "בהשהייה" &&
      !p.isOverdue
    );
  });
  // Soonest deadline first
  const dueSoon = [...dueSoonRaw].sort((a, b) => {
    const da = daysUntilDeadline(a.deadline) ?? 7;
    const db = daysUntilDeadline(b.deadline) ?? 7;
    return da - db;
  });
  const active     = projects.filter((p) => p.status === "בעבודה");
  const waitMix    = projects.filter((p) => p.status === "מחכה למיקס");
  const inMix      = projects.filter((p) => p.status === "במיקס");
  const onHold     = projects.filter((p) => p.status === "בהשהייה");
  const notStarted = projects.filter((p) => p.status === "לא התחיל");
  const done       = projects.filter((p) => p.status === "הושלם");

  // ── Section nodes (null when empty) ────────────────────────────────────────
  const secOverdue    = section("section-overdue",     "עברו דדליין",      overdue,     "#EF4444");
  const secDueSoon    = section("section-due-soon",    "קרובים לדדליין",   dueSoon,     "#F97316");
  const secActive     = section("section-active",      "בעבודה",           active,      "#3B82F6");
  const secWaitMix    = section("section-wait-mix",    "מחכה למיקס",       waitMix,     "#F59E0B");
  const secInMix      = section("section-in-mix",      "במיקס",            inMix,       "#A855F7");
  const secOnHold     = section("section-on-hold",     "בהשהייה",          onHold,      "#6B7280");
  const secNotStarted = section("section-not-started", "לא התחיל",        notStarted,  "#374151", { showDeadline: false });
  const secDone       = section("section-done",        "הושלמו",           done,        "#10B981", { showDeadline: false });

  const hasUrgent       = secOverdue || secDueSoon;
  const hasActiveRow    = secActive || secWaitMix;
  const hasMixRow       = secInMix || secOnHold;
  const hasRemainingRow = secNotStarted || secDone;

  return (
    <div className="px-3 py-3 md:px-6 md:py-8">

      {/* Daily header — full width */}
      <div className="mb-3 md:mb-8">
        <DailyHeader />
      </div>

      {/* Health alert — full width */}
      <HealthAlert />

      {/* Stats — full width */}
      <div className="mt-3 md:mt-8">
        <StatsGrid projects={projects} />
      </div>

      {/* 2-column layout: main + right sidebar (desktop only) */}
      <div className="mt-3 md:mt-8 md:grid md:gap-6" style={{ gridTemplateColumns: "1fr 320px" }}>

        {/* Main column */}
        <div className="space-y-3 md:space-y-6 min-w-0">
          {/* Urgent — stacked */}
          {hasUrgent && (
            <div className="space-y-4">
              {secOverdue}
              {secDueSoon}
            </div>
          )}

          {/* Active work row */}
          {hasActiveRow && (
            <div id="section-all-active">
              <SectionPair left={secActive} right={secWaitMix} />
            </div>
          )}

          {/* Mix row */}
          {hasMixRow && (
            <SectionPair left={secInMix} right={secOnHold} />
          )}

          {/* Remaining row */}
          {hasRemainingRow && (
            <SectionPair left={secNotStarted} right={secDone} />
          )}
        </div>

        {/* Right column — desktop only */}
        <div className="hidden md:flex flex-col gap-6 min-w-0">
          <CalendarWidget />
          <AgentSummaryCard />
        </div>

      </div>

      {/* Mobile: CalendarWidget + AgentSummaryCard below projects */}
      <div className="md:hidden mt-4 space-y-4">
        <CalendarWidget />
        <AgentSummaryCard />
      </div>

    </div>
  );
}
