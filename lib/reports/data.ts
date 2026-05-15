/**
 * Fetch and compute all data needed for a daily report.
 * SERVER ONLY — imports Supabase + Calendar server modules.
 */
import "server-only";
import { listProjects } from "@/lib/projects-store";
import { daysUntilDeadline } from "@/lib/utils";
import type { ReportData, ReportProject, ReportCalendarEvent } from "./types";

export async function fetchReportData(): Promise<ReportData> {
  // ── Supabase projects ────────────────────────────────────────────────────────
  const raw = await listProjects();

  const projects: ReportProject[] = raw.map((p) => ({
    id:        p.id,
    name:      p.name,
    artist:    p.artist,
    status:    p.status,
    deadline:  p.deadline,
    notes:     p.notes,
    isOverdue: p.isOverdue,
    isDueSoon: p.isDueSoon,
    daysUntil: daysUntilDeadline(p.deadline),
  }));

  // ── Google Calendar (best-effort) ────────────────────────────────────────────
  let calendarEvents: ReportCalendarEvent[] = [];
  let calendarConnected = false;

  try {
    const { isConnected, fetchTodayAndWeek } = await import("@/lib/google-calendar");
    if (await isConnected()) {
      calendarConnected = true;
      const { today } = await fetchTodayAndWeek();
      calendarEvents = today.map((e) => ({
        title:              e.title,
        type:               e.type,
        startTime:          e.startTime,
        endTime:            e.endTime,
        isAllDay:           e.isAllDay,
        durationMinutes:    e.durationMinutes,
        location:           e.location,
        matchedProjectName: e.matchedProjectName,
      }));
    }
  } catch {
    /* calendar unavailable — continue without it */
  }

  // ── Computed buckets ─────────────────────────────────────────────────────────

  const COMPLETED = "הושלם";
  const ON_HOLD   = "בהשהייה";

  const activeProjects = projects.filter(
    (p) => p.status !== COMPLETED && p.status !== ON_HOLD
  );

  const overdueProjects = projects.filter(
    (p) => p.isOverdue && p.status !== COMPLETED
  );

  const dueTodayProjects = projects.filter(
    (p) => p.daysUntil === 0 && p.status !== COMPLETED
  );

  const dueSoonProjects = projects.filter(
    (p) =>
      p.isDueSoon &&
      p.daysUntil !== 0 &&
      p.status !== COMPLETED &&
      !p.isOverdue
  );

  const missingInfoProjects = projects.filter(
    (p) =>
      p.status !== COMPLETED &&
      (!p.deadline || !p.artist)
  );

  return {
    projects,
    calendarEvents,
    generatedAt: new Date(),
    calendarConnected,
    activeProjects,
    overdueProjects,
    dueTodayProjects,
    dueSoonProjects,
    missingInfoProjects,
  };
}
