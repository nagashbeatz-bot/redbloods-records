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
  deadline: string | null;
  notes: string;
  files: FileLink[];
  isOverdue: boolean;
  isDueSoon: boolean;
  projectType: ProjectType;    // סוג פרויקט
  parentProject: string;       // שייך ל
  isHidden: boolean;           // הסתרה — לא מופיע בתצוגה הפעילה
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

