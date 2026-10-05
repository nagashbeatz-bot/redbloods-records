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
  { field: "status", meaning: "Work state", writtenBy: "Owner (status menu / drawer; accepting the Steven-completion suggestion), a Victor hand-off 'complete the project too' (server rule: refused for בוטל / בהשהייה / already הושלם), client restore, sending to Steven (במיקס)", cls: "CANONICAL", lifecycle: "a REAL transition into הושלם stamps the end date (a re-save keeps it); any other status clears it; not validated on the server; Steven completion never changes it (suggestion only, Owner decision 2026-09-27)", sunnyReads: true },
  { field: "project_type", meaning: "What kind of work", writtenBy: "Owner, label creation", cls: "CANONICAL", lifecycle: "One clip model (Owner decision 2026-10-01): a clip is its own project (קליפ) — there is no combined שיר + קליפ type and nothing retypes a song. Album / EP open the album center; רידים drives riddim mix mode; Steven accepts only שיר / רידים / אלבום / EP", sunnyReads: true },
  { field: "project_business_type", meaning: "לקוח or לייבל — the ONE classification field (2026-09-27)", writtenBy: "Create (UI, proposal conversion, Sunny) by the Owner rule: NagashBeatz credited → לייבל; שליו טסמה / אבי מולה credited with nobody external (solo or both) → לייבל; a Records artist next to an external party (a guest at an external host, e.g. בלאגן) → no rule (לקוח default, the Owner decides) — Owner decision 2026-09-28; else לקוח; label conversion / label creation; the Owner's explicit classification control", cls: "CANONICAL", lifecycle: "the only classifier for every screen and Sunny; never reclassified automatically — a stored לקוח the Owner rule would call לייבל is the signal MISMATCH_OWNER_RULE (fixed only by the Owner)", sunnyReads: true },
  { field: "deadline", meaning: "Target date", writtenBy: "Owner, the Partner deadline action", cls: "CANONICAL", lifecycle: "Overdue has ONE rule (valid date before today in Israel; never for הושלם / בוטל / בהשהייה / hidden); a value that is not a valid date is never overdue and is reported as unparseable", sunnyReads: true },
  { field: "start_date", meaning: "When work started", writtenBy: "Create (today), the session writer on the first session (only when empty), manual", cls: "DERIVED", lifecycle: "Auto-filled; editable; no page-load write (the legacy drawer backfill is retired, 2026-09-27)", sunnyReads: true },
  { field: "end_date", meaning: "Actual completion date", writtenBy: "Server on a status change", cls: "DERIVED", lifecycle: "Stamped (Israel day) only on a real transition into הושלם; kept on a re-save; cleared by any other status", sunnyReads: true },
  { field: "parent_project", meaning: "Belongs to another project (by NAME); ללא שיוך = none — legacy / display; NOT the song ↔ clip link", writtenBy: "Owner", cls: "AMBIGUOUS", lifecycle: "Renaming the parent silently orphans children", sunnyReads: true },
  { field: "song_project_id", meaning: "Clip project → its song project (canonical id link, Owner decision 2026-09-29); a song finds its clips by the reverse lookup", writtenBy: "No writer yet (P1: read-only; the link writer comes with the 'add clip' flow / the approved migration)", cls: "CANONICAL", lifecycle: "uuid NULL, FK ON DELETE SET NULL (deleting the song keeps the clip, unlinked), CHECK not self; the one application link rule: only on project_type 'קליפ', target an existing non-clip project", sunnyReads: true },
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
  projectType: ["שיר", "קליפ", "EP", "אלבום", "רידים", "לימודים", "אחר"],
  businessType: ["לקוח (default)", "לייבל"],
  conflicts: [
    "'Active' means בעבודה/מחכה למיקס/במיקס on the dashboard and stats, adds לא התחיל in health / agent rules, only בעבודה/מחכה למיקס in the projects KPI, and 'everything but הושלם' (incl. בוטל) in the projects filter.",
    "Album track status defaults to 'טרום הקלטה', which is not a project status.",
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
  L("FINANCE_SETTING", "agreed price / currency / exception", "settings row finance_<project id>", "1:1", "CANONICAL_RELATION", "SETTINGS_KEY", "deleted with the project; orphans exist (9 in production)", "project_view", null),
  L("SESSIONS", "session", "session project id", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "project delete hard-deletes sessions; their calendar events are removed after the database commit (failures reported) (1 orphan session exists)", "project_view", "sessions"),
  L("CALENDAR_EVENT", "Google Calendar event", "session's stored event id; the event title holds project + artist at creation", "1:1 per session", "CANONICAL_RELATION", "EXTERNAL_ID", "project rename does not retitle events", null, null),
  L("TASKS", "task", "task related type 'project' + related id (polymorphic)", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "not cleaned on project delete; a Victor task can have no id", "tasks", null),
  L("MEETINGS", "meeting", "meeting project id", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "not cleaned on delete; editable", "meetings", "meetings"),
  L("PROJECT_ACTIONS", "project action (send / receive log)", "action project id; linked work only to Victor work", "1:N", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the project", "project_actions", "project_actions"),
  L("VICTOR_WORK", "Victor work", "Victor work project id", "1:1 in practice", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the project through the Victor writer (its follow-up task + Google Task go with it; the Dropbox folder stays); Victor folder built from the CURRENT name, not the frozen folder", "project_view", "vendor_project_work"),
  L("ENGINEER_WORK", "Steven / external engineer work", "engineer work project id (engineer = free-text name)", "1:N", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the project by the database; completing Steven's last open work only SUGGESTS completing the project (the Owner decides)", "mix_pipeline", "sound_engineer_work"),
  L("MIX_VERSIONS", "mix version", "version project id (copied from the work); full mixes copied into project files", "1:N", "CANONICAL_RELATION", "DB_FK_SET_NULL", "project delete nulls it; deleting a version leaves the file copy", "mix_pipeline", "mix_versions"),
  L("FINAL_FILES", "final file", "final file project id + work id", "1:N", "CANONICAL_RELATION", "DB_FK_SET_NULL", "A5: a final file on one of the project's mix works BLOCKS the project delete (the work link is RESTRICT; zero writes, the Owner removes the final files first); a final file linked only by the project is nulled", "mix_pipeline", "final_files"),
  L("RED_FILMS", "Red Films production", "production project id + managed-clip pointer in the finance setting; artist / client name snapshots", "1:N", "CANONICAL_RELATION", "ID_NO_FK", "not cleaned on delete; renames not propagated to the snapshots; a bulk permanent delete of a cancelled production clears the project's clip pointer only while it still points at it (compare-and-swap)", "red_films", "red_films_productions"),
  L("SONG_CLIP", "clip project ↔ its song project", "projects.song_project_id on the CLIP project (Owner decision 2026-09-29; a song finds its clips by the reverse lookup) — only on project_type 'קליפ', target a non-clip project, never itself (the one application link rule + a database check against self-links)", "N clips : 1 song", "CANONICAL_RELATION", "DB_FK_SET_NULL", "deleting the song nulls the clip's link (the clip project is kept; the delete preview names them); parent_project text is NOT this link", "project_view", "projects"),
  L("CLIP_ITEMS", "clip planning row", "clip item project id", "1:N", "CANONICAL_RELATION", "DB_FK_CASCADE", "deleted with the project (a promoted row is kept as provenance of its Finance expense until then)", "clip_planning", "clip_items"),
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
    "The agreed price, currency and finance exception live in the project's finance setting — ONE price per project (a song's or a clip project's; one clip model 2026-10-01).",
    "Received income = שולם or התקבל (ONE shared status rule for every screen and Sunny); צפוי / לא שולם / בוטל are not received; חלקי is not paid.",
    "An expense is paid only when שולם.",
    "Every income row of the project in the PRICE currency counts against the price, whatever its expense scope (קליפ is a reporting tag — there is no clip deal).",
    "received ≥ agreed → no debt; received > agreed → overpayment / credit / tip (never income elsewhere).",
    "A finance exception (no charge / favour) means no receivable.",
    "A cancelled project's remaining balance is not collectible.",
    "No agreed price (0 / missing) is PRICE_UNKNOWN: never 'paid', never 'free' — fully paid needs agreed > 0 (one shared project summary for the UI badges and Sunny).",
    "Other currencies are listed separately and never converted; every total is a per-currency map.",
    "Task 4 (2026-09-28): the business unit is a property of each TRANSACTION (transactions.business_unit), not of the project — a project can hold money of more than one unit; the project type only feeds the ONE unit rule. Nothing is inherited from other rows of the project. Every screen that creates a project transaction asks for a unit when no rule is certain (422 NEEDS_BUSINESS_UNIT).",
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
    "C13–C14 (תוקן 2026-09-27): 'הכנסה צפויה' הוגדרה אחרת בכל מסך ו'לא שולם' לא נחשב צפוי בחלק מהמקומות — היום כל מסך (סטטיסטיקות כספים / תובנות, מגירת פרויקט, מגירת לקוח, בדיקת הבריאות, לשוניות האלבום, תזכורת היתרה, הדשבורד, הסוכן) וסאני משתמשים בכלל האחד isExpectedStatus (צפוי / לא שולם / חלקי).",
    "C15 במוח הכספים: פרויקט חריג עדיין יכול להציג שורות צפויות כחוב; פרויקטי לייבל נספרים כ'חסר מחיר'.",
    "C16 תצוגת הישות הקודמת של סאני הראתה רק יתרה כללית — חוב שכולו רשום כצפוי לא הופיע (תוקן בתצוגה המחוברת).",
    "C17 'יש מחיר' חושב כ'יש הגדרה' — גם חריג או מחיר 0.",
    "C19 (תוקן 2026-10-05, זיכרון החלטות): סאני שמרה החלטה על כסף של פרויקט ('מה באלי' — מחיר 2,000, לא נגבה, לא לרדוף) רק כ-BUSINESS_DECISION על החברה והבטיחה 'לא אשאל שוב', והשאלה חזרה. היום: ידע לא משנה רשומה ואומר זאת (canonicalEffect NONE); החלטה על רשומה מקושרת ב-about; שער ההחלטות הופך שאלה שנענתה / שכבר נאמרה לסנכרון (KNOWN_DECISION_RECONCILE) עם SET_FINANCE_EXCEPTION (החריגה קודם, המחיר אחריה); WRITTEN_OFF / BALANCE_WAIVED מבטאים ויתור בלי לעוות עובדות. ההחלטה מ-2026-10-03 עצמה (בלי about) נשארת לא מקושרת עד שהבעלים יאשר את הפעולה הקנונית (OWN_DECISION_RECORD_IDENTITY_TEXT_ONLY).",
    "C18 (תוקן 2026-09-29, שלב 1): סאני שאלה 'הושלם, יש הוצאה, אין הכנסה — מה קרה?' (COMPLETED_WORK_NO_INCOME / COMPLETED_WORK_EXPENSE_NO_INCOME) ו'התקבלה מקדמה?' גם על פרויקט חריג, ו-partner_entity הציג 'מחיר לא ידוע' בלי החריגה והסיבה — היום החריגה (כלל אחד: financeExceptionOf) נצרכת בכולם ומוצגת כ-OWNER_DECISION. C15 (שורות הכנסה פתוחות מפורשות על פרויקט חריג) נשאר פתוח — ממתין להחלטת בעלים.",
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
  { code: "LABEL_CLASSIFICATION_UNCLEAR", kind: "UNKNOWN", note: "no stored business type — context for the Owner (a roster-name match is evidence only)" },
  { code: "MISMATCH_OWNER_RULE", kind: "DERIVED_SIGNAL", note: "stored לקוח but the Owner rule says לייבל (NagashBeatz credited, or שליו / אבי with nobody external — a guest at an external host never fires it, Owner decision 2026-09-28) — never fixed automatically; the Owner's explicit classification fixes it" },
  { code: "DEADLINE_UNPARSEABLE", kind: "DERIVED_SIGNAL", note: "the stored deadline is not a valid date — overdue cannot be known (never counted overdue)" },
  { code: "WAITING_FOR_CLIENT / WAITING_FOR_ARTIST", kind: "UNKNOWN", note: "not computed anywhere — only the Owner can say (teach as PROJECT_BLOCKER)" },
  { code: "PRIORITY", kind: "OWNER_POLICY", note: "no universal ranking: quality before speed, protect label releases, stale is not urgent" },
] as const;

export const PROJECT_SURFACES = [
  { surface: "Projects page", purpose: "Portfolio list, KPIs, status changes, create, open drawer", notes: "KPI popover mixes currencies; the 'active' filter includes cancelled" },
  { surface: "Project drawer (current)", purpose: "Everything about one project: money, sessions, send log, clip, Victor / Steven sends, files", notes: "No writes on open" },
  { surface: "Project drawer (legacy, ?drawerLegacy=1)", purpose: "Same + delivery + session limit", notes: "No writes on open since 2026-09-27 (a passed planned session shows 'עבר — לא אושר' with explicit held / cancelled buttons)" },
  { surface: "Album center (album / EP)", purpose: "Tracks, album money, tasks, previous-system info", notes: "Balance ignores the finance exception; debt colour inverted" },
  { surface: "Status menu", purpose: "Change status", notes: "הושלם: delivery prompt + closes Victor work (may push Victor); בוטל: offers to cancel open income (amounts shown per currency)" },
  { surface: "Dashboard", purpose: "Receivables, releases, shows, 'סאני צריך ממך', approvals, outcomes", notes: "Read-only fetches" },
  { surface: "Client drawer", purpose: "The client's projects (by exact artist name)", notes: "Row balance ignores the exception; creates projects with artist = client name" },
  { surface: "Finance / Insights", purpose: "Money across projects", notes: "Hidden projects shown generically; collab balances double-counted per artist" },
  { surface: "Red Films / Steven / Victor pages", purpose: "Their work linked to a project", notes: "Victor never sees artist / project names" },
  { surface: "Artist portals", purpose: "Music / schedule of the artist's projects (by artist text)", notes: "Portal covers gated by the release row" },
] as const;

export const PROJECT_PAGE_LOAD_EFFECTS = [
  { trigger: "Opening a portal as its own user (Shalev / Avi / CLEANTONE / Steven / Victor)", writes: "portal last-seen (throttled) + at most ONE Owner presence push per real visit (30-minute absence window, atomic claim) — Owner decision Q1", idempotent: true, refresh: true, risk: "none for business data" },
  { trigger: "RETIRED 2026-09-27 — opening ANY app page or a project drawer", writes: "nothing: the session auto-mark (app load + legacy drawer) and the start-date backfill are gone (Owner canon: time passed ≠ session happened)", idempotent: true, refresh: true, risk: "none" },
  { trigger: "Opening the Tasks page", writes: "Open tasks completed in Google Tasks become done", idempotent: true, refresh: true, risk: "low" },
  { trigger: "Every Owner page", writes: "Re-saves the Owner's push subscription", idempotent: true, refresh: true, risk: "none for business data; never sends a push" },
] as const;

export const PROJECT_INTEGRITY = {
  productionCounts20260925: { projects: 38, hidden: 0, orphanTransactions: 0, orphanSessions: 1, orphanMeetings: 0, orphanRedFilms: 0, orphanSocialItems: 0, orphanOrNullProjectTasks: 0, orphanFinanceSettings: 9, orphanDeliverySettings: 0, artistWithoutClientMatch: 0, brokenParentNames: 0, nonVocabularyStatus: 0, completedWithoutEndDate: 0, unfrozenDropboxFolders: 12, storedLabelBusinessType: 1, openEngineerWorkOnClosedProject: 0 },
  risksHe: [
    "מחיקת פרויקט עדיין לא טרנזקציה אחת: בדיקה מקדימה חוסמת כשיש קבצים סופיים (בלי שום כתיבה), כל שלב נבדק והפרויקט נמחק אחרון; נשארים: משימות, פגישות, Red Films, תוכן סושיאל, התראות ותיקיות דרופבוקס.",
    "שינוי אמן בפרויקט שהתיקייה שלו לא 'קפואה' מזיז העלאות עתידיות לתיקייה אחרת.",
    "קבצי הפרויקט נשמרים בלי נעילה — שתי העלאות במקביל יכולות לאבד אחת.",
    "סטטוס פרויקט לא נבדק בשרת (כל טקסט מתקבל).",
    "המרת הצעה לפרויקט לא טרנזקציונית (עלול להיווצר פרויקט בלי קישור להצעה).",
  ],
} as const;

/** Files that define project semantics — changing any of them fails scripts/test-sunny-projects.tsx until reviewed. */
export const PROJECT_REVIEWED_FINGERPRINTS: Readonly<Record<string, string>> = {
  // 2026-09-29 review (song ↔ clip P1): the store reads song_project_id and lists a song's clips (listClipsOfSong) — new PROJECT_FIELDS song_project_id + PROJECT_LINKS SONG_CLIP; no write path, no money / vocabulary change
  "lib/projects-store.ts": "367952f3d58dd8514421fb6fc752f5e8fb0a27799511135f93fdee7bd5d6c3dc",
  // 2026-09-29 review (song ↔ clip P1): Project gained optional songProjectId (canonical clip → song link); parentProject documented as legacy / display — no vocabulary change
  // 2026-10-01 review (one clip model): no "שיר + קליפ" type; a clip is its own project; matchesTypeFilter = exact type
  "lib/types.ts": "1c593ce7f14a22b92639a7ab62a473223d4c5d3823a32b8a5539c3540d3d31e3",
  // 2026-09-27 review (Universal Actions): create / status / rename logic moved into the shared writers lib/writes/projects
  // (identical behaviour; the same writers back Sunny's typed primitives). No field, vocabulary or link semantics changed.
  "app/api/projects/route.ts": "486ceb2e7b45ed5419e86a97f5f59dfff0a3fd9925e2eca10af1e5b650dbbca5",
  // 2026-09-28 review: a credit change re-syncs the artist expense shares and a failure is now REPORTED (ShareSyncError →
  // 500 with the Hebrew message), never swallowed by .catch(() => 0). No field, vocabulary or link semantics changed.
  "app/api/projects/[id]/route.ts": "515506e0e771a3d5bdb7e40df1bfd0e6efbe080d7aca5028964aaba1d3a7ddaa",
  "lib/payment-status.ts": "99ed0806205a2fbaca511835f1cc1adfa3f78713b00026fa9f2c26d2a29b05e3",
  // 2026-10-01 review (one clip model): isProjectIncome — every income row counts toward the project's ONE price; no clip deal math
  "lib/clip-finance.ts": "53652a6d8b70f760b089dce8d3f7c087f7ff08de39a50e8bf04cc57a6bb3f61a",
  "lib/finance/classify.ts": "737c8f69b79f2b08606b78c26e9a3d4f0312f0b723edd68deea2ab02cd87aefd",
  "lib/project-paths.ts": "69c88d46ab47affddbe1b1d94dcfc118026e94a2bc0e41c85b5e4a5ae7e46b07",
  // 2026-10-01 review (one clip model): the legacy drawer counts the project's income through projectIncomeTotals
  "components/ui/ProjectDrawer.tsx": "0e8813138d4a21631c369c0fe232d8d499ddade0c63876fbdcd0626c775bf7cc",
  "components/AppShell.tsx": "9e6cab9ae8c07d28f32c07f37a078b05312627a751fa738fa67825eee5f9e800",
};
