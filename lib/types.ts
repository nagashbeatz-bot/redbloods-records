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

export type VictorStatus =
  | "לא נשלח"
  | "נשלח לויקטור"
  | "בעבודה אצל ויקטור"
  | "מחכה לקבצים"
  | "הוחזר מויקטור"
  | "דורש תיקונים"
  | "אושר"
  | "לא רלוונטי";

export const VICTOR_STATUSES: VictorStatus[] = [
  "לא נשלח",
  "נשלח לויקטור",
  "בעבודה אצל ויקטור",
  "מחכה לקבצים",
  "הוחזר מויקטור",
  "דורש תיקונים",
  "אושר",
  "לא רלוונטי",
];

/** Statuses that mean "active / in Victor's court" → used for stuck detection */
export const VICTOR_ACTIVE_STATUSES = new Set<VictorStatus>([
  "נשלח לויקטור",
  "בעבודה אצל ויקטור",
  "מחכה לקבצים",
]);

export type VictorQuality = "מצוין" | "אושר" | "חלקי" | "דורש תיקון" | "נדחה";
export type VictorEntered = "כן" | "לא" | "חלקית";

export interface VendorWork {
  id: string;
  vendorName: string;
  projectId: string;
  projectName: string;   // joined from projects table
  artist: string;        // joined from projects table
  status: VictorStatus;
  sentDate: string | null;           // YYYY-MM-DD
  internalDeadline: string | null;   // YYYY-MM-DD
  returnedDate: string | null;       // YYYY-MM-DD
  dropboxFolder: string | null;      // base path, e.g. "Victor/Shalev - HaMida"
  dropboxShareLink: string | null;   // public share link to base folder
  quality: VictorQuality | null;
  enteredProject: VictorEntered | null;
  notes: string;
  filesSent: FileLink[];
  filesReceived: FileLink[];
  isStuck: boolean;                  // computed
  daysSinceSent: number | null;      // computed
  createdAt: string;
  updatedAt: string;
}

export interface VendorSettings {
  monthlyGoal: number;       // target approved projects per month
  monthlySalary: number;     // e.g. 550
  salaryCurrency: string;    // "$"
  salaryPayDay: number;      // day of month, e.g. 10
  stuckAfterDays: number;    // default 5
}

export interface VictorMonthStats {
  month: string;             // "YYYY-MM"
  goal: number;
  sent: number;
  inProgress: number;        // currently in active statuses
  returned: number;          // returned (any terminal/returned status)
  approved: number;
  needsFix: number;
  rejected: number;
  enteredProject: number;    // entered_project = "כן" or "חלקית"
  stuck: number;             // computed
  expectedByNow: number;     // pace target for today's date
  successRate: number;       // approved / max(returned,1) * 100
  paymentStatus: string;     // "שולם" | "צפוי" | "לא שולם"
  monthlySalary: number;
  salaryCurrency: string;
}

