/**
 * Types for the daily report system.
 * Pure types only — no imports from server-only modules.
 */

export interface ReportProject {
  id: string;
  name: string;
  artist: string;
  status: string;
  deadline: string | null;
  notes: string;
  isOverdue: boolean;
  isDueSoon: boolean;
  daysUntil: number | null;
}

export interface ReportCalendarEvent {
  title: string;
  type: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  durationMinutes: number;
  location?: string;
  matchedProjectName?: string;
}

export interface ReportData {
  projects:            ReportProject[];
  calendarEvents:      ReportCalendarEvent[];   // today's events only
  generatedAt:         Date;
  calendarConnected:   boolean;

  // Pre-computed buckets (computed in data.ts)
  activeProjects:      ReportProject[];  // not הושלם / not בהשהייה
  overdueProjects:     ReportProject[];  // deadline passed, not completed
  dueTodayProjects:    ReportProject[];  // deadline is today, not completed
  dueSoonProjects:     ReportProject[];  // deadline within 7 days (excl today), not completed, not overdue
  missingInfoProjects: ReportProject[];  // no deadline or no artist (not completed)
}

export type ReportType = "morning" | "evening";

export interface GeneratedReport {
  subject: string;
  html:    string;
  text:    string;
}
