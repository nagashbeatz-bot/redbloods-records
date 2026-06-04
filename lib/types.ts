export type ProjectStatus =
  | "בעבודה"
  | "מחכה למיקס"
  | "במיקס"
  | "הושלם"
  | "בהשהייה"
  | "לא התחיל";

export const ALL_STATUSES: ProjectStatus[] = [
  "בעבודה",
  "מחכה למיקס",
  "במיקס",
  "הושלם",
  "בהשהייה",
  "לא התחיל",
];

export type ProjectType = "שיר" | "EP" | "אלבום" | "קליפ" | "רידים" | "אחר" | "";

export const PROJECT_TYPES: Exclude<ProjectType, "">[] = [
  "שיר",
  "EP",
  "אלבום",
  "קליפ",
  "רידים",
  "אחר",
];

/** Canonical "no affiliation" value stored in DB and shown in UI */
export const NO_AFFILIATION = "ללא שיוך";

/** Returns true if a parentProject value means "not affiliated" */
export function isNoAffiliation(val: string): boolean {
  return !val || val.trim() === NO_AFFILIATION;
}

/** All fields that can be updated through the UI or agent */
export type UpdatableField =
  | "status"
  | "deadline"
  | "startDate"
  | "notes"
  | "projectType"
  | "parentProject"
  | "name"
  | "artist";

export interface FileLink {
  name: string;
  url: string;
  assetId?: number;          // legacy field (unused)
  dropboxPath?: string;      // Dropbox path — required for Dropbox file deletion
  dropboxShareUrl?: string;  // permanent Dropbox public share link
}

export interface Project {
  id: string;
  name: string;
  artist: string;
  status: ProjectStatus;
  startDate: string | null;    // תאריך תחילת פרויקט (אוטומטי = היום ביצירה)
  deadline: string | null;     // דדליין — תאריך יעד בלבד
  endDate: string | null;      // תאריך סיום בפועל (אוטומטי כשסטטוס = הושלם)
  notes: string;
  files: FileLink[];
  isOverdue: boolean;
  isDueSoon: boolean;
  projectType: ProjectType;    // סוג פרויקט
  parentProject: string;       // שייך ל
  isHidden: boolean;           // הסתרה — לא מופיע בתצוגה הפעילה
  updatedAt: string;           // ISO timestamp of last meaningful change
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  pendingAction?: MondayUpdateAction;
}

/** Bulk update — same field + same value across multiple projects */
export interface BulkUpdateAction {
  field: UpdatableField;
  value: string;
  ids: string[];         // project IDs to update
  label: string;         // e.g. "11 פרויקטים"
  filterDesc?: string;   // e.g. "כל הפרויקטים בלי סוג פרויקט"
}

export interface MondayUpdateAction {
  projectId: string;
  projectName: string;
  field: UpdatableField;
  currentValue: string;
  newValue: string;
}

/** New project proposed by the agent — requires confirmation before creation */
export interface PendingCreateAction {
  name: string;           // שם הפרויקט (required)
  artist: string;         // שם אמן
  projectType: ProjectType;
  status: ProjectStatus;
  deadline?: string;      // YYYY-MM-DD or ""
  notes?: string;
  parentProject?: string; // אלבום: שם / EP: שם / Riddim: שם / ללא שיוך
}

export interface MondayColumnMap {
  status: string;
  artist: string;
  deadline: string;
  notes: string;
  files: string;
  projectType: string;    // סוג פרויקט — empty string if column not yet added
  parentProject: string;  // שייך ל — empty string if column not yet added
}

// ── Vendor / Team types ────────────────────────────────────────────────────────

/** Primary status — 3 simple states */
export type VictorStatus = "פעיל" | "הושלם" | "בוטל";
export const VICTOR_STATUSES: VictorStatus[] = ["פעיל", "הושלם", "בוטל"];

/** Work state — what's happening inside the active work */
export type VictorWorkState =
  | "נשלח לויקטור"
  | "חזר מויקטור"
  | "דורש בדיקה"
  | "דורש תיקון"
  | "מחכה לקבצים"
  | "לא רלוונטי";
export const VICTOR_WORK_STATES: VictorWorkState[] = [
  "נשלח לויקטור", "חזר מויקטור", "דורש בדיקה", "דורש תיקון", "מחכה לקבצים", "לא רלוונטי",
];

/** Outcome — what came out of the work */
export type VictorOutcome =
  | "אושר"
  | "נכנס לפרויקט בפועל"
  | "חלקית"
  | "לא נכנס לפרויקט"
  | "נדחה";
export const VICTOR_OUTCOMES: VictorOutcome[] = [
  "אושר", "נכנס לפרויקט בפועל", "חלקית", "לא נכנס לפרויקט", "נדחה",
];

export interface VendorWork {
  id: string;
  vendorName: string;
  projectId: string;
  projectName: string;           // joined from projects table
  artist: string;                // joined from projects table
  status: VictorStatus;          // "פעיל" | "הושלם" | "בוטל"
  workState: VictorWorkState | null;  // detail state within active work
  outcome: VictorOutcome | null;     // what came out of the work
  sentDate: string | null;           // YYYY-MM-DD
  internalDeadline: string | null;   // YYYY-MM-DD
  returnedDate: string | null;       // YYYY-MM-DD
  dropboxFolder: string | null;      // base path, e.g. "Victor/Artist - Project"
  dropboxShareLink: string | null;   // public share link to base folder
  notes: string;
  filesSent: FileLink[];
  filesReceived: FileLink[];
  isStuck: boolean;                  // computed: פעיל + daysSinceSent > stuckAfterDays
  daysSinceSent: number | null;      // computed
  createdAt: string;
  updatedAt: string;
}

export interface VendorSettings {
  monthlyGoal: number;           // target per month
  monthlySalary: number;         // e.g. 550
  salaryCurrency: string;        // "$"
  salaryPayDay: number;          // day of month, e.g. 10
  stuckAfterDays: number;        // default 5
}

export interface VictorMonthStats {
  month: string;              // "YYYY-MM"
  goal: number;

  // Status counts (records in this month)
  sent: number;               // sentDate in month
  active: number;             // status = 'פעיל' (all, not month-filtered)
  completed: number;          // status = 'הושלם' in month
  cancelled: number;          // status = 'בוטל' in month

  // Detail counts (active records)
  needsReview: number;        // active + workState in ['חזר מויקטור', 'דורש בדיקה']
  needsFix: number;           // active + workState = 'דורש תיקון'
  stuck: number;              // active + daysSinceSent > stuckAfterDays

  // Outcome counts (in month)
  approved: number;           // outcome = 'אושר'
  enteredProject: number;     // outcome = 'נכנס לפרויקט בפועל'

  // Pace
  paceValue: number;          // actual value for paceMetric this month
  expectedByNow: number;      // goal * (dayOfMonth / daysInMonth)

  paymentStatus: string;      // "שולם" | "צפוי" | "לא שולם"
  monthlySalary: number;
  salaryCurrency: string;
}

// ── Agent / Proactive intelligence types ──────────────────────────────────────

export type AlertSeverity = "info" | "warning" | "important" | "urgent";
export type AlertStatus   = "new" | "handled" | "dismissed" | "ignored";

export interface AgentAlert {
  id: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  relatedProjectId: string | null;
  relatedClientId: string | null;
  metadata: Record<string, unknown>;
  suggestedActions: string[];
  source: "scheduled" | "manual" | "chat";
  status: AlertStatus;
  sentNotification: boolean;
  entityKey: string | null;   // e.g. "payment_overdue:tx-id", "overdue_deadline:proj-id"
  createdAt: string;
  updatedAt: string;
}

export interface BusinessGoals {
  monthlyRevenue:      { target: number; currency: string };
  weeklySessions:      { target: number };
  monthlyVictor:       { target: number };
  monthlyCompletions:  { target: number };
}

export interface GoalsProgress {
  monthlyRevenue:     { target: number; currency: string; actual: number; expectedByNow: number; pct: number };
  weeklySessions:     { target: number; actual: number; pct: number };
  monthlyVictor:      { target: number; actual: number; expectedByNow: number; pct: number };
  monthlyCompletions: { target: number; actual: number; expectedByNow: number; pct: number };
}

export interface BusinessMemoryEntry {
  key: string;
  value: string;
  category: string;
  relatedId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Sound Engineer / External Mix types ──────────────────────────────────────

export type SoundEngineerStatus =
  | "לא נשלח"
  | "נשלח"
  | "בתהליך"
  | "חזר"
  | "אושר"
  | "בוטל";

export type SoundEngineerWorkType =
  | "מיקס"
  | "מאסטר"
  | "מיקס + מאסטר"
  | "תיקונים";

export const SOUND_ENGINEER_STATUSES: SoundEngineerStatus[] = [
  "לא נשלח", "נשלח", "בתהליך", "חזר", "אושר", "בוטל",
];

export const SOUND_ENGINEER_WORK_TYPES: SoundEngineerWorkType[] = [
  "מיקס", "מאסטר", "מיקס + מאסטר", "תיקונים",
];

export interface SoundEngineerWork {
  id: string;
  projectId: string;
  projectName: string;           // joined from projects
  artist: string;                // joined from projects
  engineerName: string;          // "Bill" | "Steven" | custom
  workType: SoundEngineerWorkType;
  status: SoundEngineerStatus;
  agreedPrice: number;
  currency: string;              // "$" | "₪" | "€"
  amountPaid: number;
  balance: number;               // computed: agreedPrice - amountPaid
  sentDate: string | null;       // YYYY-MM-DD
  internalDeadline: string | null;
  filesLink: string | null;      // Dropbox / Drive / any URL
  notes: string;
  linkedTransactionId: string | null;  // references transactions(id)
  createdAt: string;
  updatedAt: string;
}

/** Input to create an alert (before DB insertion) */
export interface AlertInput {
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  relatedProjectId?: string | null;
  relatedClientId?: string | null;
  metadata?: Record<string, unknown>;
  suggestedActions?: string[];
  source?: "scheduled" | "manual" | "chat";
  /** Unique key identifying the specific entity this alert is about.
   *  Format: "<type>:<entity-id>", e.g. "payment_overdue:tx-abc123"
   *  Used for auto-resolve: if the entity is no longer problematic,
   *  the alert is automatically marked handled on the next agent/check run. */
  entityKey?: string | null;
}

