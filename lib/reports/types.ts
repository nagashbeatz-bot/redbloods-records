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

export interface ReportSession {
  id: string;
  projectName: string;
  artist: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  sessionType: string;
  notes: string;
  createdAt: string;  // when this session record was created in the system
}

export interface ReportTransaction {
  id: string;
  projectName: string;
  artist: string;
  date: string | null;   // payment date (may differ from when it was added)
  type: string;
  description: string;
  amount: number;
  currency: string;
  paymentStatus: string;
  paymentMethod: string;
  scope: string;
  createdAt: string;     // when added to the system
}

/** One line in the "מה קרה היום" activity feed */
export interface ReportActivityItem {
  icon: string;
  text: string;         // e.g. "התקבל תשלום: 1,500₪ — המידה החמישי"
  sub?: string;         // optional second line
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

  // ── Evening: what actually happened today (by created_at) ──────────────────

  /** Activity feed — actions logged in the system today */
  activityItems:       ReportActivityItem[];

  /** Sessions with date = today, status = הושלם / בוצע */
  sessionsDone:        ReportSession[];
  /** Sessions with date = today, time has passed, status still = נקבע */
  sessionsNeedingUpdate: ReportSession[];
  /** Sessions with date = today, status = בוטל */
  sessionsCancelled:   ReportSession[];
  /** Sessions with date = today, time hasn't passed yet, status = נקבע */
  sessionsUpcoming:    ReportSession[];
  /** Sessions created today but scheduled for a future date */
  sessionsFutureScheduled: ReportSession[];

  /** Transactions added to the system today (created_at = today), type ≠ הוצאה, status = שולם */
  txReceivedToday:     ReportTransaction[];
  /** Transactions added today, type ≠ הוצאה, status ≠ שולם (pending/expected) */
  txPendingAddedToday: ReportTransaction[];
  /** Transactions added today, type = הוצאה */
  txExpensesToday:     ReportTransaction[];

  /** Transactions with date = today (planned for today — may or may not match created_at) */
  txExpectedToday:     ReportTransaction[];

  /** Tomorrow's sessions */
  tomorrowSessions:    ReportSession[];

  /** Projects completed today (end_date = today) */
  completedTodayProjects: ReportProject[];
  /** Projects created today */
  createdTodayProjects:   ReportProject[];

  /** Victor summary — only included when there's something to flag */
  victorSummary?: {
    active:         number;
    stuck:          number;
    needsReview:    number;
    needsFix:       number;
    completed:      number;
    paceValue:      number;
    expectedByNow:  number;
    belowPace:      boolean;
    paymentStatus:  string;
    month:          string;  // "YYYY-MM"
  };
}

export type ReportType = "morning" | "evening";

export interface GeneratedReport {
  subject: string;
  html:    string;
  text:    string;
}
