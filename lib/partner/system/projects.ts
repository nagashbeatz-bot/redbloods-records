/**
 * Sunny System Awareness — the PROJECT contract (layer 2): the project as the central operational node of Redbloods
 * OS. Fields, vocabularies, lifecycle, every relationship (link method, cardinality, DB enforcement, what breaks it,
 * live read support), money model + known conflicts, operational signal model, UI surfaces, page-load side effects
 * and integrity risks. Produced by the Projects deep discovery (2026-09-25), verified against the production schema
 * (foreign keys) and code, and guarded by scripts/test-sunny-projects.tsx. Semantic only when served.
 */

export const PROJECT_BASELINE_VERSION = "2026.09.25-3";

export type FieldClass = "CANONICAL" | "DERIVED" | "LEGACY" | "DISPLAY_ONLY" | "AMBIGUOUS";
export interface ProjectField { field: string; meaning: string; writtenBy: string; cls: FieldClass; lifecycle: string; sunnyReads: boolean }

export const PROJECT_FIELDS: readonly ProjectField[] = [
  { field: "name", meaning: "Project title", writtenBy: "Owner (create / edit), proposal conversion, label release creation", cls: "CANONICAL", lifecycle: "First rename freezes the project's Dropbox folder", sunnyReads: true },
  { field: "artist", meaning: "Free-text artist name(s), several separated by , ، ;", writtenBy: "Owner, client rename (rewrites it), label conversion", cls: "CANONICAL", lifecycle: "The ONLY link to clients and (outside releases) to label artists — by name", sunnyReads: true },
  { field: "status", meaning: "Work state", writtenBy: "Owner (status menu / drawer), Steven completion (auto הושלם), client restore, sending to Steven (במיקס)", cls: "CANONICAL", lifecycle: "הושלם stamps the end date; any other status clears it; not validated on the server", sunnyReads: true },
  { field: "project_type", meaning: "What kind of work", writtenBy: "Owner, clip seeding (שיר → שיר + קליפ), label creation", cls: "CANONICAL", lifecycle: "Album / EP open the album center; רידים drives riddim mix mode; Steven accepts only שיר / רידים / אלבום / EP", sunnyReads: true },
  { field: "project_business_type", meaning: "לקוח or לייבל", writtenBy: "Create forces לקוח; label conversion / label creation / business-type switch set לייבל", cls: "AMBIGUOUS", lifecycle: "Competes with roster-name matching (label classification conflict)", sunnyReads: true },
  { field: "deadline", meaning: "Target date", writtenBy: "Owner, the Partner deadline action", cls: "CANONICAL", lifecycle: "Overdue / due-soon are computed", sunnyReads: true },
  { field: "start_date", meaning: "When work started", writtenBy: "Create (today), first session backfill, legacy drawer backfill (can overwrite for hidden projects), manual", cls: "DERIVED", lifecycle: "Auto-filled; editable", sunnyReads: true },
  { field: "end_date", meaning: "Actual completion date", writtenBy: "Server on status change", cls: "DERIVED", lifecycle: "Set on הושלם, cleared otherwise", sunnyReads: true },
  { field: "parent_project", meaning: "Belongs to another project (by NAME); ללא שיוך = none", writtenBy: "Owner", cls: "AMBIGUOUS", lifecycle: "Renaming the parent silently orphans children", sunnyReads: true },
  { field: "is_hidden", meaning: "Removed from the active views", writtenBy: "Owner (full edit)", cls: "CANONICAL", lifecycle: "Hidden projects vanish from almost every screen (not from Finance Brain)", sunnyReads: true },
  { field: "planned_hours / planned_days", meaning: "Lesson (לימודים) targets", writtenBy: "Owner", cls: "CANONICAL", lifecycle: "Actuals come from held sessions", sunnyReads: true },
  { field: "files", meaning: "Player / materials list: Dropbox paths, share links, versions, categories, durations", writtenBy: "Uploads, intake, mix-version copies, work materials", cls: "CANONICAL", lifecycle: "Read-modify-write without a lock (concurrent uploads can lose one)", sunnyReads: false },
  { field: "work_materials", meaning: "BPM / key / instructions for the engineer", writtenBy: "Owner", cls: "CANONICAL", lifecycle: "—", sunnyReads: false },
  { field: "dropbox_folder", meaning: "Frozen base folder", writtenBy: "First rename / backfill only (not on create, not on artist change)", cls: "CANONICAL", lifecycle: "Unfrozen projects move future writes when the artist changes", sunnyReads: false },
  { field: "notes", meaning: "Private free text", writtenBy: "Owner", cls: "CANONICAL", lifecycle: "—", sunnyReads: false },
  { field: "monday_id", meaning: "Old Monday.com import id", writtenBy: "Nothing today", cls: "LEGACY", lifecycle: "Dead", sunnyReads: false },
  { field: "cover / last asset / label-artist flag", meaning: "Display extras attached to the project list", writtenBy: "Computed on read", cls: "DISPLAY_ONLY", lifecycle: "—", sunnyReads: false },
];

export const PROJECT_VOCABULARIES = {
  status: ["לא התחיל (default)", "בעבודה", "מחכה למיקס", "במיקס", "בהשהייה", "הושלם", "בוטל"],
  projectType: ["שיר", "קליפ", "שיר + קליפ", "EP", "אלבום", "רידים", "לימודים", "אחר"],
  businessType: ["לקוח (default)", "לייבל"],
  conflicts: [
    "'Active' means בעבודה/מחכה למיקס/במיקס on the dashboard and stats, adds לא התחיל in health / agent rules, only בעבודה/מחכה למיקס in the projects KPI, and 'everything but הושלם' (incl. בוטל) in the projects filter.",
    "Album track status defaults to 'טרום הקלטה', which is not a project status.",
    "Steven's allowed types exclude 'שיר + קליפ'.",
  ],
} as const;

export type LinkQuality = "CANONICAL_RELATION" | "OWNER_CONFIRMED_RELATION" | "DERIVED_RELATION" | "TEXT_MATCH" | "AMBIGUOUS" | "UNKNOWN";
export interface ProjectLink {
  id: string; target: string; linkMethod: string; cardinality: string; direction: string; quality: LinkQuality;
  /** DB foreign key? and what happens on project delete (from the production schema + app delete code). */
  enforcement: "DB_FK_CASCADE" | "DB_FK_SET_NULL" | "ID_NO_FK" | "SETTINGS_KEY" | "TEXT" | "EXTERNAL_ID" | "COMPUTED";
  breaks: string;
  /** partner_query capability that reads it live (null = Sunny cannot read it live). */
  liveRead: string | null;
  /** INTERNAL (tests): the table / column it lives in. */
  internal: { table: string | null };
}
const L = (id: string, target: string, linkMethod: string, cardinality: string, quality: LinkQuality, enforcement: ProjectLink["enforcement"], breaks: string, liveRead: string | null, table: string | null, direction = "project → target"): ProjectLink =>
  ({ id, target, linkMethod, cardinality, direction, quality, enforcement, breaks, liveRead, internal: { table } });

export const PROJECT_LINKS: readonly ProjectLink[] = [
  L("CLIENT", "client", "project artist text equals the client name (token split; case handling differs by screen)", "N:M", "TEXT_MATCH", "TEXT", "artist edit / typo / client rename (rename rewrites project text, not atomic); a case variant creates a duplicate client", "project_view", null),
  L("LABEL_ARTIST_BY_NAME", "label artist", "artist text equals a roster name", "N:M", "TEXT_MATCH", "TEXT", "artist or roster rename", "project_view", null),
  L("LABEL_ARTIST_BY_RELEASE", "label artist", "release details carry the label-artist id", "1:1", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleting the project deletes the release row", "releases", "project_release_details"),
  L("PROPOSAL", "proposal", "proposal's linked project id (conversion)", "N:1 (one conversion)", "CANONICAL_RELATION", "DB_FK_SET_NULL", "project delete → proposal back to לא נסגר, follow-up task deleted; a proposal edit can point anywhere", "project_view", "proposals"),
  L("TRANSACTIONS", "finance transaction", "transaction project id (+ scope / expense scope)", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "project delete unlinks them (orphan project-scope rows)", "project_view", "transactions"),
  L("FINANCE_SETTING", "agreed price / currency / exception / clip price", "settings row finance_<project id>", "1:1", "CANONICAL_RELATION", "SETTINGS_KEY", "deleted with the project; orphans exist (9 in production)", "project_view", null),
  L("SESSIONS", "session", "session project id", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "project delete hard-deletes sessions + their calendar events (1 orphan session exists)", "project_view", "sessions"),
  L("CALENDAR_EVENT", "Google Calendar event", "session's stored event id; the event title holds project + artist at creation", "1:1 per session", "CANONICAL_RELATION", "EXTERNAL_ID", "project rename does not retitle events", null, null),
  L("TASKS", "task", "task related type 'project' + related id (polymorphic)", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "not cleaned on project delete; a Victor task can have no id", "tasks", null),
  L("MEETINGS", "meeting", "meeting project id", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "not cleaned on delete; editable", "meetings", "meetings"),
  L("PROJECT_ACTIONS", "project action (send / receive log)", "action project id; linked work only to Victor work", "1:N", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the project", "project_actions", "project_actions"),
  L("VICTOR_WORK", "Victor work", "Victor work project id", "1:1 in practice", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the project (tasks + Dropbox folder stay); Victor folder built from the CURRENT name, not the frozen folder", "project_view", "vendor_project_work"),
  L("ENGINEER_WORK", "Steven / external engineer work", "engineer work project id (engineer = free-text name)", "1:N", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the project by the database; Steven approval auto-completes the project", "mix_pipeline", "sound_engineer_work"),
  L("MIX_VERSIONS", "mix version", "version project id (copied from the work); full mixes copied into project files", "1:N", "CANONICAL_RELATION", "DB_FK_SET_NULL", "project delete nulls it; deleting a version leaves the file copy", "mix_pipeline", "mix_versions"),
  L("FINAL_FILES", "final file", "final file project id + work id", "1:N", "CANONICAL_RELATION", "DB_FK_SET_NULL", "project delete nulls it", "mix_pipeline", "final_files"),
  L("RED_FILMS", "Red Films production", "production project id + managed-clip pointer in the finance setting; artist / client name snapshots", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "not cleaned on delete; renames not propagated to the snapshots", "red_films", "red_films_productions"),
  L("CLIP_ITEMS", "clip planning row", "clip item project id", "1:N", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the project", "clip_planning", "clip_items"),
  L("SOCIAL_CAMPAIGN", "social campaign", "campaign project id (unique)", "1:1", "CANONICAL_RELATION", "DB_FK_SET_NULL", "project delete nulls it", "social", "social_campaigns"),
  L("SOCIAL_CONTENT", "social content item / file", "content project id", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "not cleaned; uploads live outside the project folder", "social", "social_content_items"),
  L("RELEASE", "label release", "release details keyed by project id", "1:1", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the project", "releases", "project_release_details"),
  L("ALBUM_TRACKS", "album / EP track", "track project id (+ files track id)", "1:N", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the project by the database", "albums", "album_tracks"),
  L("DELIVERY", "client delivery", "settings row delivery_<project id> + Dropbox Delivery folder", "1:1", "CANONICAL_RELATION", "SETTINGS_KEY", "setting deleted with the project; the Dropbox folder stays", "deliveries", null),
  L("DROPBOX_FOLDER", "Dropbox project folder", "computed /Projects/<primary artist>/<name> or the frozen folder", "1:1", "DERIVED_RELATION", "COMPUTED", "artist change on an unfrozen project moves future writes (12 unfrozen projects); delete never removes folders", null, null),
  L("PARENT_PROJECT", "parent project", "parent stored as a project NAME", "N:1", "TEXT_MATCH", "TEXT", "renaming the parent orphans children", "project_view", null),
  L("NOTIFICATIONS", "owner bell notification", "notification project id copied from the push", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "not cleaned", null, "notifications"),
  L("AGENT_ALERTS", "agent alert", "alert related project id + key '<rule>:<project id>'", "1:N", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the project by the database (the app first soft-closes 5 alert kinds)", null, "agent_alerts"),
  L("PARTNER_ACTIONS", "Sunny deadline action / outcome", "action subject id", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "append-only; outcome says target not found after delete", "project_view", null),
  L("OWNER_KNOWLEDGE", "Owner knowledge (P2)", "subject key project:<id>", "1:N", "OWNER_CONFIRMED_RELATION", "ID_NO_FK", "stays as history; live state wins", "project_view", null),
  L("PORTALS", "artist portal music / schedule / pushes", "artist text tokens → projects → sessions; sketch ↔ project file link", "N:M", "TEXT_MATCH", "TEXT", "artist text edits change who sees what", null, null),
  L("VICTOR_ENTERED_PROJECT", "Victor outcome", "Victor work 'entered project' outcome flag", "1:1", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the work", null, "vendor_project_work"),
  L("SHOWS", "show", "none — shows never reference projects", "—", "UNKNOWN", "TEXT", "—", null, null),
];

/** Project-referencing columns in the production schema (information_schema, 2026-09-25) — every one is covered above. */
export const PROJECT_SCHEMA_COLUMNS = [
  "agent_alerts.related_project_id", "album_tracks.project_id", "clip_items.project_id", "final_files.project_id", "meetings.project_id", "mix_versions.project_id",
  "notifications.project_id", "project_actions.project_id", "project_release_details.project_id", "proposals.linked_project_id", "red_films_productions.project_id",
  "sessions.project_id", "social_campaigns.project_id", "social_content_files.project_id", "social_content_items.project_id", "sound_engineer_work.project_id",
  "transactions.project_id", "vendor_project_work.project_id", "vendor_project_work.entered_project",
] as const;

export const PROJECT_MONEY_MODEL = {
  rules: [
    "The agreed price, currency, finance exception and clip price live in the project's finance setting.",
    "Received income = שולם or התקבל; צפוי / לא שולם / בוטל are not received; חלקי is not paid.",
    "An expense is paid only when שולם.",
    "Only song income in the PRICE currency counts against the price; clip income belongs to the clip deal (its own clip price).",
    "received ≥ agreed → no debt; received > agreed → overpayment / credit / tip (never income elsewhere).",
    "A finance exception (no charge / favour) means no receivable.",
    "A cancelled project's remaining balance is not collectible.",
    "Other currencies are listed separately and never converted.",
  ],
  sunnyImplementation: "project_view mirrors the Finance Brain's per-project loop with the same shared primitives and explains its verdict.",
  conflictsHe: [
    "C1 בדיקת 'תשלום באיחור' של הסוכן הישן סופרת הוצאות ששולמו כהכנסה (בדיקת סוג שגויה) ומערבבת מטבעות.",
    "C2–C4 הקשר ה-AI וההתראות הישנות מערבבים מטבעות ומסמנים הכול ב-₪.",
    "C5 המגירה הישנה סופרת כל הוצאה (לא רק ששולמה) לרווח.",
    "C6–C11 בדיקת הבריאות, טבלת הפרויקטים הישנה, לשוניות האלבום, מודל הקביעה ושורות הלקוח מתעלמים מחריג הכספים.",
    "C8 טבלת הפרויקטים הישנה מחברת יתרות במטבעות שונים.",
    "C10 בלשוניות האלבום צבע היתרה הפוך (חוב ירוק, עודף אדום).",
    "C12 תובנות סופרות כל הוצאה ומציגות פרויקט בדולר כשקלים.",
    "C13–C14 'הכנסה צפויה' מוגדרת אחרת בכל מסך; 'לא שולם' לא נחשב צפוי בחלק מהמקומות.",
    "C15 במוח הכספים: פרויקט חריג עדיין יכול להציג שורות צפויות כחוב; פרויקטי לייבל נספרים כ'חסר מחיר'.",
    "C16 תצוגת הישות הקודמת של סאני הראתה רק יתרה כללית — חוב שכולו רשום כצפוי לא הופיע (תוקן בתצוגה המחוברת).",
    "C17 'יש מחיר' חושב כ'יש הגדרה' — גם חריג או מחיר 0.",
  ],
} as const;

export const PROJECT_SIGNAL_MODEL = [
  { code: "DEADLINE_PASSED", kind: "DERIVED_SIGNAL", note: "a deadline alone never outranks quality or label work (Owner policy)" },
  { code: "NO_DEADLINE", kind: "CANONICAL_FACT", note: "active project with no deadline" },
  { code: "STALE", kind: "DERIVED_SIGNAL", note: "≥30 days without update — NOT urgent by itself; ask for context" },
  { code: "OUTSTANDING_CLIENT_MONEY / OVERPAYMENT / PRICE_UNKNOWN", kind: "DERIVED_SIGNAL", note: "from the canonical money rules" },
  { code: "AT_ENGINEER / ENGINEER_RETURNED_WORK", kind: "CANONICAL_FACT", note: "from engineer work status (returned = likely waiting for the Owner)" },
  { code: "AT_VICTOR / VICTOR_WAITING_OWNER", kind: "DERIVED_SIGNAL", note: "from recorded timestamps — does not prove it wasn't handled outside the system" },
  { code: "WAITING_FEEDBACK / WAITING_VERSION", kind: "CANONICAL_FACT", note: "from the project send / receive log" },
  { code: "CLIP_IN_PRODUCTION / RELEASE_TARGET_PASSED / NO_SESSIONS / COMPLETED_DELIVERY_OPEN", kind: "DERIVED_SIGNAL", note: "no session ≠ problem (some work needs none)" },
  { code: "LABEL_CLASSIFICATION_UNCLEAR", kind: "UNKNOWN", note: "stored לקוח but the artist is on the label roster — an Owner decision" },
  { code: "WAITING_FOR_CLIENT / WAITING_FOR_ARTIST", kind: "UNKNOWN", note: "not computed anywhere — only the Owner can say (teach as PROJECT_BLOCKER)" },
  { code: "PRIORITY", kind: "OWNER_POLICY", note: "no universal ranking: quality before speed, protect label releases, stale is not urgent" },
] as const;

export const PROJECT_SURFACES = [
  { surface: "Projects page", purpose: "Portfolio list, KPIs, status changes, create, open drawer", notes: "KPI popover mixes currencies; the 'active' filter includes cancelled" },
  { surface: "Project drawer (current)", purpose: "Everything about one project: money, sessions, send log, clip, Victor / Steven sends, files", notes: "No writes on open" },
  { surface: "Project drawer (legacy, ?drawerLegacy=1)", purpose: "Same + delivery + session limit", notes: "WRITES on open (see side effects)" },
  { surface: "Album center (album / EP)", purpose: "Tracks, album money, tasks, previous-system info", notes: "Balance ignores the finance exception; debt colour inverted" },
  { surface: "Status menu", purpose: "Change status", notes: "הושלם: delivery prompt + closes Victor work (may push Victor); בוטל: offers to cancel open income (mixes currencies)" },
  { surface: "Dashboard", purpose: "Receivables, releases, shows, 'סאני צריך ממך', approvals, outcomes", notes: "Read-only fetches" },
  { surface: "Client drawer", purpose: "The client's projects (by exact artist name)", notes: "Row balance ignores the exception; creates projects with artist = client name" },
  { surface: "Finance / Insights", purpose: "Money across projects", notes: "Hidden projects shown generically; collab balances double-counted per artist" },
  { surface: "Red Films / Steven / Victor pages", purpose: "Their work linked to a project", notes: "Victor never sees artist / project names" },
  { surface: "Artist portals", purpose: "Music / schedule of the artist's projects (by artist text)", notes: "Portal covers gated by the release row" },
] as const;

export const PROJECT_PAGE_LOAD_EFFECTS = [
  { trigger: "Opening ANY app page (every role; only the Owner is allowed through)", writes: "Planned sessions whose end time passed (by the DEVICE clock) become 'held'", idempotent: true, refresh: true, risk: "a wrong device clock marks future sessions held (the calendar pull reverts only moved events)" },
  { trigger: "Opening a project in the LEGACY drawer", writes: "Each passed planned session of that project → 'held' (bumps the project's updated time)", idempotent: true, refresh: true, risk: "reorders 'recently updated'" },
  { trigger: "Opening a project in the LEGACY drawer", writes: "Backfills the project start date from its earliest session", idempotent: false, refresh: true, risk: "for a HIDDEN project it overwrites an existing start date on every open (uses cancelled sessions too)" },
  { trigger: "Opening the Tasks page", writes: "Open tasks completed in Google Tasks become done", idempotent: true, refresh: true, risk: "low" },
  { trigger: "Every Owner page", writes: "Re-saves the Owner's push subscription", idempotent: true, refresh: true, risk: "none for business data; never sends a push" },
] as const;

export const PROJECT_INTEGRITY = {
  productionCounts20260925: { projects: 38, hidden: 0, orphanTransactions: 0, orphanSessions: 1, orphanMeetings: 0, orphanRedFilms: 0, orphanSocialItems: 0, orphanOrNullProjectTasks: 0, orphanFinanceSettings: 9, orphanDeliverySettings: 0, artistWithoutClientMatch: 0, brokenParentNames: 0, nonVocabularyStatus: 0, completedWithoutEndDate: 0, unfrozenDropboxFolders: 12, storedLabelBusinessType: 1, openEngineerWorkOnClosedProject: 0 },
  risksHe: [
    "מחיקת פרויקט לא טרנזקציונית: חלק נמחק באפליקציה, חלק בבסיס הנתונים (מדרג), חלק נשאר (משימות, פגישות, Red Films, תוכן סושיאל, התראות, הגדרות אלבום/מגבלת סשנים, תיקיות דרופבוקס).",
    "שינוי אמן בפרויקט שהתיקייה שלו לא 'קפואה' מזיז העלאות עתידיות לתיקייה אחרת.",
    "קבצי הפרויקט נשמרים בלי נעילה — שתי העלאות במקביל יכולות לאבד אחת.",
    "סטטוס פרויקט לא נבדק בשרת (כל טקסט מתקבל).",
    "המרת הצעה לפרויקט לא טרנזקציונית (עלול להיווצר פרויקט בלי קישור להצעה).",
  ],
} as const;

/** Files that define project semantics — changing any of them fails scripts/test-sunny-projects.tsx until reviewed. */
export const PROJECT_REVIEWED_FINGERPRINTS: Readonly<Record<string, string>> = {
  "lib/projects-store.ts": "33977432a48347e93dfe0d4bac8c450b71fe1d9bac34bf3a5596545ae8beb22f",
  "lib/types.ts": "f1a0d3b1450c72b2cf50edafd1900d4fef1f6cdead9864227b0e2074d96363a8",
  "app/api/projects/route.ts": "0d47fb66bc1bef0f008ac05bc32579643eb9739a39f5838b1e3e766caf713b92",
  "app/api/projects/[id]/route.ts": "09e3269e3451bf9271c6d05f3ec31ee124c378aa048bb97844a784d68a286229",
  "lib/payment-status.ts": "f2a0e2c061e0862c0595918d0389c17cc156f73d646e7c7891054d51baf538e8",
  "lib/clip-finance.ts": "c862ac29cd8849cd1a0234bea8f79ff6715b7d303ae21f285f76b4b1b70a492b",
  "lib/finance/classify.ts": "7a40590e70ca5c22423d1bbe88352aa7cc64a72252c54d1b0a651a3c4beded9f",
  "lib/project-paths.ts": "69c88d46ab47affddbe1b1d94dcfc118026e94a2bc0e41c85b5e4a5ae7e46b07",
  "components/ui/ProjectDrawer.tsx": "baa223afc99dba577b58d2604a4b616127282550708f48751c2ba3efceb4357c",
  "components/AppShell.tsx": "4249e7a7e41aeb55eaac6001fef9bae542e6e30f92ebd6bb7a148bcc064d3f6f",
};
