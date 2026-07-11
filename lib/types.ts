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

// ── Label management (/label) ────────────────────────────────────────────────
// Classifies every project as client-facing or a label/internal release.
export type ProjectBusinessType = "לקוח" | "לייבל";
export const PROJECT_BUSINESS_TYPES: ProjectBusinessType[] = ["לקוח", "לייבל"];

// Explicit, owner-managed release pipeline (NOT derived from ProjectStatus).
export type ReleaseStage =
  | "רעיון" | "הפקה" | "הקלטה" | "עריכות" | "מיקס" | "מאסטר"
  | "עטיפה" | "הפצה" | "תוכן" | "מוכן ליציאה" | "יצא" | "בהשהייה";

export const RELEASE_STAGES: ReleaseStage[] = [
  "רעיון", "הפקה", "הקלטה", "עריכות", "מיקס", "מאסטר",
  "עטיפה", "הפצה", "תוכן", "מוכן ליציאה", "יצא", "בהשהייה",
];

/** Stages that mean the release is still "in the pipeline" (not out, not shelved). */
export const ACTIVE_RELEASE_STAGES: ReleaseStage[] =
  RELEASE_STAGES.filter((s) => s !== "יצא" && s !== "בהשהייה");

/** Suggested "responsible" values in the label UI; picking "אחר" unlocks free text. */
export const RESPONSIBLE_SUGGESTIONS = ["אני", "שליו", "ויקטור", "סטיבן", "אחר"] as const;

// The canonical, stable label-artist entity (public.label_artists). Releases link
// to it by id — the artist list is NEVER derived from projects.artist anymore.
export type LabelArtistStatus = "פעיל" | "בהשהייה" | "לא פעיל";
export const LABEL_ARTIST_STATUSES: LabelArtistStatus[] = ["פעיל", "בהשהייה", "לא פעיל"];

export interface LabelArtist {
  id: string;
  name: string;
  status: LabelArtistStatus;
  imageUrl: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** One row of project_release_details (1:1 with a project). */
export interface ProjectReleaseDetails {
  projectId: string;
  labelArtistId: string | null;     // FK → label_artists.id (authoritative artist link)
  releaseStage: ReleaseStage;
  releaseTargetDate: string | null; // YYYY-MM-DD
  nextAction: string;
  blocker: string;
  responsible: string;
  stageEnteredAt: string;           // ISO — when the current stage was entered
  releasedAt: string | null;        // ISO — set when stage becomes "יצא"
  createdAt: string;
  updatedAt: string;                // ISO — optimistic-lock token
}

/** A label project joined with its (optional) release details — the /label list item. */
export interface LabelRelease {
  projectId: string;
  name: string;
  artist: string;
  projectType: ProjectType;
  status: ProjectStatus;
  businessType: ProjectBusinessType;
  release: ProjectReleaseDetails | null;
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
  trackId?: string;          // UUID of album_tracks.id — links file to a track
  versionLabel?: string;     // e.g. "V1", "מיקס 1", "מאסטר"
  category?: string;         // intake category: מאסטר/אקפלה/אינסטרומנטל/ערוצים/גרסת הופעה/אחר
  durationSeconds?: number;  // audio length in whole seconds — captured client-side at upload (optional; older files lack it)
  size?: number;             // file size in bytes (optional; e.g. brief files)
  uploadedAt?: string;       // ISO timestamp set at upload — drives the Victor per-work version window (older files lack it)
  segments?: BriefSegment[]; // structure markers — ONLY on brief audio files (owner-authored, Victor read-only). Never on versions.
  fileRef?: string;          // opaque, path-free handle sent to Victor INSTEAD of dropboxPath/url/shareUrl (see sanitizeWorkForVictor). Resolved server-side per work.
}

/** Canonical song-structure type. Stored (not the display label) so the Victor
 *  view can localize to en/ru and never shows Hebrew. "custom" carries a free
 *  `label` typed by the owner. */
export type BriefSegmentType =
  | "intro" | "verse1" | "prechorus" | "chorus1" | "verse2" | "chorus3"
  | "cpart" | "bridge" | "finalChorus" | "outro" | "custom";

/** A colored structure region over a brief audio file's timeline. start/end are
 *  seconds into the track. Persisted inside brief_files jsonb (no dedicated DB). */
export interface BriefSegment {
  id: string;
  type: BriefSegmentType;
  label?: string;  // used only when type === "custom"
  color: string;   // hex accent
  start: number;   // seconds
  end: number;     // seconds
}

/**
 * A Steven/Bill mix version (Phase 2). Physical file lives in the ORIGINAL
 * project's Dropbox folder under /Mix Versions/; metadata lives ONLY here in
 * mix_versions (never in projects.files). `url` is a computed stream URL.
 */
export interface MixVersion {
  id:                  string;
  soundEngineerWorkId: string;
  projectId:           string | null;
  label:               string;
  fileName:            string;
  dropboxPath:         string;
  url:                 string;          // computed: /api/dropbox/stream?path=...
  fileSize:            number | null;
  fileType:            string | null;
  status:              string;          // בבדיקה | מוכן | מאושר | נדחה
  uploadedBy:          string | null;
  durationSeconds:     number | null;
  uploadedAt:          string;
  createdAt:           string;
  updatedAt:           string;
}

/** A time-stamped comment on a mix version (Phase 2 stage 4). */
export interface MixComment {
  id:               string;
  mixVersionId:     string;
  timestampSeconds: number;
  commentText:      string;
  author:           string | null;
  role:             string | null;   // "mix" | "acapella" | "instrumental" | "stems" | null (legacy = shared/כללי)
  createdAt:        string;
  updatedAt:        string;
}

/** A YouTube reference attached to a Victor work ("רפרנסים"). */
export interface VictorReference {
  id: string;
  url: string;
  title: string;
  note: string;
  provider: "youtube";
  createdAt: string;         // ISO
}

/** Album track status now uses the same values as ProjectStatus */
export type AlbumTrackStatus = ProjectStatus;
export type MixMasterStatus  = "לא התחיל" | "בתהליך" | "הושלם";

export const VERSION_LABELS = ["סקיצה", "V1", "V2", "מיקס 1", "מיקס 2", "מאסטר", "אחר"] as const;
export type VersionLabel = typeof VERSION_LABELS[number];

export const ALBUM_TRACK_STATUSES: AlbumTrackStatus[] = [...ALL_STATUSES];

// ── Album Finance (isolated from main transactions) ───────────────────────────

export interface AlbumPayment {
  id: string;
  amount: number;
  date: string;         // YYYY-MM-DD or free text
  status: "התקבל" | "שולם" | "צפוי" | "חלקי" | "בוטל";
  method: string;       // ביט / העברה בנקאית / מזומן / PayPal / אחר
  ref: string;          // אסמכתא / קישור
  notes: string;
}

export interface AlbumExpense {
  id: string;
  amount: number;
  date: string;
  category: string;     // מיקס / מאסטר / חדר חזרות / צילום / נסיעות / אחר
  paid: boolean;
  ref: string;
  notes: string;
}

export interface AlbumFinanceData {
  agreed: number;
  currency: string;
  notes: string;
  payments: AlbumPayment[];
  expenses: AlbumExpense[];
}

export interface AlbumTrack {
  id:            string;
  project_id:    string;
  track_number:  number;
  title:         string;
  status:        AlbumTrackStatus;
  mix_status:    MixMasterStatus;
  master_status: MixMasterStatus;
  notes:         string | null;
  created_at:    string;
  updated_at:    string;
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
  businessType: ProjectBusinessType; // לקוח / לייבל (projects.project_business_type)
  updatedAt: string;           // ISO timestamp of last meaningful change
  // Work-materials text metadata (BPM / Key / instructions) sent to the sound
  // engineer. Files live in `files` (category "חומרי עבודה"); this is the text only.
  workMaterials?: WorkMaterialsMeta;
  // Frozen canonical Dropbox base folder (projects.dropbox_folder). When set,
  // all writers use it instead of recomputing from the name → renaming a project
  // never moves/creates a Dropbox folder. Null on projects not yet frozen.
  dropboxFolder?: string | null;
}

/** Free-text work-materials metadata shown to Steven/Bill (stored in projects.work_materials jsonb). */
export interface WorkMaterialsMeta {
  bpm?: string;
  key?: string;
  instructions?: string;
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

/** Owner's review of a single Victor version (keyed by versionLabel, e.g. "V2").
 *  Phase 1C — stored in vendor_project_work.version_reviews (jsonb). Owner writes,
 *  Victor reads. Does NOT touch work status / project / finance. */
export type VersionReviewStatus = "waiting" | "needs_revision" | "approved" | "replaced";
export interface VersionReview {
  status: VersionReviewStatus;
  notes: string;
  reviewedAt: string;   // ISO
  reviewedBy: string;   // label only, e.g. "owner"
}

export interface VendorWork {
  id: string;
  vendorName: string;
  projectId: string | null;      // null = Victor-only work (no general project)
  title: string | null;          // standalone work title (when no project_id)
  projectName: string;           // title, or joined projects.name, or fallback
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
  briefText: string;                 // "קרא אותי קודם" brief (owner-editable)
  references: VictorReference[];     // YouTube reference links (owner-editable)
  filesSent: FileLink[];
  filesReceived: FileLink[];
  briefFiles: FileLink[];            // owner-attached brief helpers (NOT versions/player)
  isStuck: boolean;                  // computed: פעיל + daysSinceSent > stuckAfterDays
  daysSinceSent: number | null;      // computed
  linkedTaskId: string | null;       // FK → tasks(id), set when internalDeadline synced
  versionReviews: Record<string, VersionReview>; // owner review per versionLabel (Phase 1C)
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

// ── Victor salary types ───────────────────────────────────────────────────────

export type SalaryStatus =
  | "צפוי"
  | "לא שולם"
  | "נשלח לכספים"
  | "שולם"
  | "חלקי"
  | "בוטל";

export interface VictorSalaryMonth {
  workMonth: string;                    // "2026-06"
  dueDate: string;                      // "2026-07-10"
  amount: number;
  currency: string;
  status: SalaryStatus;
  transactionId: string | null;
  transactionPaymentStatus: string | null;
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
  projectId: string | null;      // null for a standalone (project-less) work
  projectName: string;           // linked project's name, else the standalone workTitle
  workTitle: string | null;      // free-text title for a standalone work (project_id = null)
  artist: string;                // joined from projects (empty for standalone)
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
  sortOrder: number | null;      // manual list order (sound_engineer_work.sort_order); null → fall back to created_at
  paymentDate: string | null;    // YYYY-MM-DD when marked paid (sound_engineer_work.payment_date); null = not paid / legacy
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

// ── Social / Marketing Center ──────────────────────────────────────────────────

export type SocialCampaignStatus = "draft" | "active" | "completed" | "paused";
export const SOCIAL_CAMPAIGN_STATUSES: SocialCampaignStatus[] = ["draft", "active", "completed", "paused"];
export const SOCIAL_CAMPAIGN_STATUS_LABELS: Record<SocialCampaignStatus, string> = {
  draft: "טיוטה",
  active: "פעיל",
  completed: "הסתיים",
  paused: "מושהה",
};

export type SocialContentStatus =
  | "draft"
  | "in_progress"
  | "ready_to_post"
  | "published"
  | "idea"
  | "needs_shoot"
  | "shot"
  | "in_edit"
  | "needs_review"
  | "ready"
  | "scheduled"
  | "posted"
  | "cancelled";

export const SOCIAL_CONTENT_STATUSES: SocialContentStatus[] = [
  "draft", "in_progress", "ready_to_post", "published",
  "idea", "needs_shoot", "shot", "in_edit", "needs_review", "ready", "scheduled", "posted", "cancelled",
];

export const SOCIAL_CONTENT_STATUS_LABELS: Record<SocialContentStatus, string> = {
  draft: "רעיון",
  in_progress: "בעבודה",
  ready_to_post: "מוכן להעלאה",
  published: "פורסם",
  idea: "רעיון",
  needs_shoot: "רעיון",
  shot: "רעיון",
  in_edit: "בעבודה",
  needs_review: "בעבודה",
  ready: "מוכן להעלאה",
  scheduled: "מוכן להעלאה",
  posted: "פורסם",
  cancelled: "בוטל",
};

export const SOCIAL_CONTENT_STATUS_COLORS: Record<SocialContentStatus, string> = {
  draft: "#8B5CF6",
  in_progress: "#3B82F6",
  ready_to_post: "#F59E0B",
  published: "#10B981",
  idea: "#8B5CF6",
  needs_shoot: "#8B5CF6",
  shot: "#8B5CF6",
  in_edit: "#3B82F6",
  needs_review: "#3B82F6",
  ready: "#F59E0B",
  scheduled: "#F59E0B",
  posted: "#10B981",
  cancelled: "#EF4444",
};

export type SocialPlatform = "tiktok" | "instagram" | "youtube" | "spotify" | "other";
export const SOCIAL_PLATFORMS: SocialPlatform[] = ["tiktok", "instagram", "youtube", "spotify", "other"];
export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  spotify: "Spotify",
  other: "אחר",
};
export const SOCIAL_PLATFORM_ICONS: Record<SocialPlatform, string> = {
  tiktok: "🎵",
  instagram: "📸",
  youtube: "▶️",
  spotify: "🎧",
  other: "🌐",
};

export const SOCIAL_CONTENT_TYPES = [
  "טיזר", "BTS", "ליפסינק", "סטורי", "קליפ קצר", "פוסט", "ריל", "הכרזה", "תוכן אישי", "אחר",
] as const;
export type SocialContentType = typeof SOCIAL_CONTENT_TYPES[number];

export interface SocialCampaign {
  id: string;
  project_id: string | null;
  title: string;
  artist_name: string;
  release_date: string | null;  // YYYY-MM-DD
  status: SocialCampaignStatus;
  marketing_angle: string;
  target_audience: string;
  main_message: string;
  platforms: SocialPlatform[];
  owner_id: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface SocialContentItem {
  id: string;
  campaign_id: string;
  project_id: string | null;
  title: string;
  content_type: string;
  status: SocialContentStatus;
  platform: SocialPlatform | null;
  due_date: string | null;       // YYYY-MM-DD
  publish_date: string | null;
  publish_time: string | null;   // HH:MM
  owner_name: string;
  asset_link: string;
  dropbox_link: string;
  calendar_event_id: string | null;
  task_id: string | null;
  caption: string;
  hook: string;
  notes: string;
  posted_url: string;
  created_at: string;
  updated_at: string;
}

export interface SocialContentFile {
  id: string;
  content_item_id: string;
  campaign_id: string;
  project_id: string | null;
  file_name: string;
  file_type: string;          // MIME type, e.g. "video/mp4"
  file_size: number;          // bytes
  dropbox_path: string;
  dropbox_file_id: string;
  dropbox_share_link: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileTypeIcon(mimeType: string): string {
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.startsWith("image/")) return "🖼";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType === "application/pdf") return "📄";
  return "📎";
}

export function dropboxRawUrl(url: string): string {
  return url.replace(/\?dl=0/, "?raw=1").replace(/&dl=0/, "&raw=1");
}
