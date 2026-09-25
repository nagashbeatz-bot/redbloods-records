/**
 * Sunny System Awareness — FULL-BRAIN COMPLETION: Sessions / Tasks / Meetings / Albums / Delivery / Social.
 *
 * One contract per domain: meaning, schema (every production column, 2026-09-25 read-only census) with its meaning,
 * vocabularies (pinned against the code by scripts/test-sunny-work-domains.tsx), routes (every route of the family,
 * with auth + what it writes), relationships with quality, rules (classified), side effects, integrations, security,
 * production state, anomalies, the gaps that stay open, and how Sunny reads it. Semantic text only — internal
 * paths live only in `internal` fields that are never served.
 */

export type RuleClass = "CANONICAL_BUSINESS_RULE" | "IMPLEMENTATION_BEHAVIOR" | "OWNER_POLICY" | "LEGACY_BEHAVIOR" | "POSSIBLE_BUG" | "CONFLICT";
export type RouteAuth = "OWNER_IN_ROUTE" | "PROXY_ONLY" | "CRON_SECRET" | "MIGRATION_SECRET" | "ROLE_SCOPED";
export interface DomainRoute { route: string; methods: string; auth: RouteAuth; writes: string; sideEffects?: string }
export interface DomainRule { id: string; cls: RuleClass; text: string }
export interface DomainRelation { to: string; via: string; quality: "CANONICAL_RELATION" | "TEXT_MATCH" | "DERIVED_RELATION" | "UNKNOWN"; note?: string }
export interface WorkDomainContract {
  id: "SESSIONS" | "TASKS" | "MEETINGS" | "ALBUMS" | "DELIVERY" | "SOCIAL";
  meaningHe: string;
  /** table → column → meaning (every production column). Settings families are listed under settings. */
  fields: Record<string, Record<string, string>>;
  settings: Array<{ family: string; meaning: string }>;
  vocabularies: Record<string, readonly string[]>;
  relations: DomainRelation[];
  internal: { routes: DomainRoute[]; vocabularySources: Record<string, { file: string; pattern: string }> };
  rules: DomainRule[];
  sideEffects: string[];
  integrations: string[];
  security: string[];
  production20260925: Record<string, unknown>;
  anomalies: string[];
  gaps: string[];
  sunnyReads: string[];
}
const R = (id: string, cls: RuleClass, text: string): DomainRule => ({ id, cls, text });
const rt = (route: string, methods: string, auth: RouteAuth, writes: string, sideEffects?: string): DomainRoute => ({ route, methods, auth, writes, ...(sideEffects ? { sideEffects } : {}) });

export const WORK_DOMAINS: readonly WorkDomainContract[] = [
  {
    id: "SESSIONS", meaningHe: "עבודה מתוזמנת על תאריך ושעה: סשן אולפן, ניקוי ערוצים למיקס, חזרה, חזרה להופעה ויום צילום קליפ — אופציונלית עם אירוע ביומן Google.",
    fields: { sessions: {
      id: "session id", project_id: "project id (text-like id, no FK) — a standalone session has a title instead", show_id: "show id for show rehearsals", title: "standalone session title", date: "YYYY-MM-DD", start_time: "HH:MM", end_time: "HH:MM (end ≤ start = next day on the calendar event)",
      status: "מתוכנן / התקיים / בוטל / נדחה / לא הגיע (rehearsal dialog also writes בוצע)", session_type: "סשן / ניקוי מיקס / חזרה / צילום קליפ / חזרה להופעה", notes: "free text (clip shoots store the location here too)", location: "free text", photographer: "clip shoot photographer name (free text)",
      cost: "rehearsal cost (≥0, no currency column) — drives the rehearsal expense", calendar_event_id: "the Google event id (the only canonical calendar link)", created_at: "created",
    } },
    settings: [{ family: "session_limit_<project>", meaning: "{limit} studio-session cap per project (default 3; only type סשן counts)" }, { family: "shalev_session_reminder:* / shalev_weekly_sessions:*", meaning: "dedupe markers of Shalev's session reminder / weekly summary pushes" }],
    vocabularies: { status: ["מתוכנן", "התקיים", "בוטל", "נדחה", "לא הגיע"], type: ["סשן", "ניקוי מיקס", "חזרה", "צילום קליפ"], rehearsalStatus: ["מתוכנן", "בוצע", "בוטל"], showRehearsalType: ["חזרה להופעה"] },
    relations: [{ to: "PROJECT", via: "project id", quality: "CANONICAL_RELATION", note: "no DB FK" }, { to: "SHOW", via: "show id (rehearsal)", quality: "CANONICAL_RELATION" }, { to: "CALENDAR_EVENT", via: "stored event id", quality: "CANONICAL_RELATION" }, { to: "FINANCE_TRANSACTION", via: "transaction linked session id", quality: "CANONICAL_RELATION", note: "the same column also carries Victor salary keys (victor_salary_*) — not sessions" }, { to: "RED_FILMS_PRODUCTION", via: "same project only", quality: "DERIVED_RELATION" }, { to: "LABEL_ARTIST", via: "the project's artist text", quality: "TEXT_MATCH" }],
    internal: {
      routes: [
        rt("app/api/sessions/route.ts", "GET/POST/PATCH(?type=limit)", "OWNER_IN_ROUTE", "creates a session (+ optional Google event, + rehearsal expense sync); PATCH limit upserts session_limit_ (no in-route check — proxy only)", "Shalev push when the project artist is שליו טסמה"),
        rt("app/api/sessions/[id]/route.ts", "PATCH/DELETE", "OWNER_IN_ROUTE", "edits date/time/status/type/notes/photographer/location/cost (updates an existing event only); DELETE removes the row then its Google event"),
        rt("app/api/sessions/auto-mark/route.ts", "POST", "PROXY_ONLY", "marks מתוכנן sessions whose end time passed as התקיים (called on every app load with the browser clock)"),
        rt("app/api/sessions/calendar-pull/route.ts", "GET", "CRON_SECRET", "copies moved Google times back into sessions; can set התקיים → מתוכנן when the event end is in the future; never deletes"),
        rt("app/api/sessions/sync/route.ts", "GET", "PROXY_ONLY", "read-only report of sessions whose calendar event is missing"),
      ],
      vocabularySources: { status: { file: "components/ui/ProjectDrawer.tsx", pattern: "const STATUS_OPTIONS:\\s*SessionStatus\\[\\]\\s*=\\s*\\[([^\\]]+)\\]" }, type: { file: "components/ui/ProjectDrawer.tsx", pattern: "const TYPE_OPTIONS:\\s*SessionType\\[\\]\\s*=\\s*\\[([^\\]]+)\\]" }, rehearsalStatus: { file: "components/shows/RehearsalModal.tsx", pattern: "OP_STATUSES[^=]*=\\s*\\[([^\\]]+)\\]" }, showRehearsalType: { file: "lib/shows-finance-sync.ts", pattern: "REHEARSAL_SESSION_TYPE\\s*=\\s*(\"[^\"]+\")" } },
    },
    rules: [
      R("SESSION_HAPPENED_NOT_PROVEN", "IMPLEMENTATION_BEHAVIOR", "התקיים can be written automatically on app load when the end time passes (browser clock) — it is not proof the session happened; a passed date with מתוכנן means 'not recorded'."),
      R("SESSION_CANCEL_KEEPS_EVENT", "POSSIBLE_BUG", "Changing a session to בוטל does not delete or change its Google event; only deleting the session deletes the event."),
      R("REHEARSAL_TWO_VOCABULARIES", "CONFLICT", "Show rehearsals are edited with מתוכנן / בוצע / בוטל and the show split counts only בוצע, but the app-wide auto-mark turns a passed rehearsal into התקיים — so an auto-marked rehearsal is not counted."),
      R("SESSION_NEEDS_UPDATE_DEAD_RULE", "POSSIBLE_BUG", "The agent rule 'session needs update' looks for status נקבע, which sessions never use — the rule can never fire."),
      R("SESSION_CLIENT_DRAWER_TYPE", "POSSIBLE_BUG", "Booking a session from the client drawer sends the LOCATION as the session type."),
      R("SESSION_DELETE_EXPENSE_ORPHAN", "POSSIBLE_BUG", "Deleting a session keeps its rehearsal / shoot expense transaction."),
      R("SESSION_LIMIT", "IMPLEMENTATION_BEHAVIOR", "A per-project studio-session limit (default 3) is a planning aid in the drawer — not Owner policy."),
    ],
    sideEffects: ["Google event on create (no attendees) / update of an existing event / delete with the session", "rehearsal expense upsert (category חזרה, scope הופעה, never deleted) + show split recompute", "clip shoot day = session + a separate unpaid clip expense (two calls)", "Shalev + Owner push on a Shalev session; 'today's session' pushes from the push cron; Shalev reminder 3h before; weekly summary", "project delete deletes its sessions and their events (best effort)"],
    integrations: ["GOOGLE_CALENDAR (events)", "FINANCE (rehearsal / shoot expenses via linked session id)", "PUSH (Shalev)"],
    security: ["session create / edit / delete check the Owner in-route", "auto-mark, sync and the limit PATCH rely on the central proxy only", "calendar-pull is public-bypassed and protected by a cron secret"],
    production20260925: { total: 75, "סשן|התקיים": 70, "סשן|מתוכנן": 1, "חזרה להופעה|התקיים": 2, "צילום קליפ|התקיים": 2, withCalendarEvent: 55, withProject: 59, showRehearsals: 2 },
    anomalies: ["2 show rehearsals are התקיים (auto-marked) — the show split counts only בוצע", "15 studio sessions have no project (standalone titles)"],
    gaps: ["WK_SESSION_HAPPENED_UNPROVEN", "WK_REHEARSAL_STATUS_CONFLICT"],
    sunnyReads: ["session_view", "sessions", "project_view", "calendar"],
  },
  {
    id: "TASKS", meaningHe: "משימות: כללי / לקוח / פרויקט / הפקת Red Films, עם תאריך יעד, קישור להופעה, ומראה ב-Google Tasks. מעקבי הצעה / הצעת הופעה / ויקטור / מיקס הם משימות רגילות שמזוהות לפי סימון טקסט.",
    fields: { tasks: {
      id: "task id", title: "title (some origins use a title convention)", notes: "free text; carries text markers [proposal_id:…] / [quote_followup] (hidden in the tasks page)", status: "פתוח / בוצע / בוטל", related_type: "general / client / project / red_film_production",
      related_id: "the related entity id (null for general)", due_date: "YYYY-MM-DD", start_time: "HH:MM:SS", end_time: "HH:MM:SS", calendar_event_id: "the mirrored GOOGLE TASK id (despite the name)", show_id: "show id (set on insert only)", created_at: "created", updated_at: "updated",
    } },
    settings: [],
    vocabularies: { status: ["פתוח", "בוצע", "בוטל"], relatedType: ["general", "client", "project", "red_film_production"] },
    relations: [{ to: "PROJECT / CLIENT / RED_FILMS_PRODUCTION", via: "related type + id", quality: "CANONICAL_RELATION" }, { to: "SHOW", via: "show id", quality: "CANONICAL_RELATION" }, { to: "PROPOSAL", via: "[proposal_id:…] marker in the notes", quality: "TEXT_MATCH" }, { to: "SHOW_QUOTE", via: "[quote_followup] marker + show id", quality: "TEXT_MATCH" }, { to: "VICTOR_WORK", via: "the work's linked task id", quality: "CANONICAL_RELATION" }, { to: "PROJECT_ACTION", via: "the send-log entry's linked task id", quality: "CANONICAL_RELATION" }, { to: "MIX_WORK", via: "title 'מעקב מיקס — <project>'", quality: "TEXT_MATCH" }, { to: "GOOGLE_TASK", via: "mirrored id", quality: "CANONICAL_RELATION" }],
    internal: {
      routes: [
        rt("app/api/tasks/route.ts", "GET/POST", "PROXY_ONLY", "creates a task (default פתוח / general; accepts show id)"),
        rt("app/api/tasks/[id]/route.ts", "PATCH/DELETE", "PROXY_ONLY", "partial edit — a status change also patches the Google Task (title / due are NOT synced); DELETE deletes the Google Task first (a Google failure aborts)"),
        rt("app/api/calendar/create-task/route.ts", "POST", "PROXY_ONLY", "creates a Google Task only (the client then stores its id)"),
        rt("app/api/calendar/tasks/[id]/route.ts", "DELETE", "PROXY_ONLY", "deletes a Google Task only"),
        rt("app/api/calendar/tasks/sync/route.ts", "POST", "PROXY_ONLY", "Google → Redbloods completion only: open tasks whose Google Task is completed become בוצע (runs on every tasks-page load)"),
      ],
      vocabularySources: { status: { file: "lib/tasks-store.ts", pattern: "export const TASK_STATUSES: TaskStatus\\[\\]\\s*=\\s*\\[([^\\]]+)\\]" }, relatedType: { file: "lib/tasks-store.ts", pattern: "export const TASK_RELATED_TYPES: TaskRelatedType\\[\\]\\s*=\\s*\\[([^\\]]+)\\]" } },
    },
    rules: [
      R("TASK_TEXT_MARKERS", "IMPLEMENTATION_BEHAVIOR", "Proposal follow-ups and show quote follow-ups are found by markers inside the notes — a TEXT link, never a foreign key."),
      R("TASK_GOOGLE_ONE_WAY_COMPLETION", "IMPLEMENTATION_BEHAVIOR", "Completion flows Google → Redbloods only when the tasks page loads (a page-load write); a Redbloods status change patches Google; due / title changes are synced only for proposal and Victor follow-ups."),
      R("TASK_NO_ASSIGNEE", "IMPLEMENTATION_BEHAVIOR", "There is no assignee, owner or priority on a task."),
      R("TASK_REDFILMS_CANCEL", "POSSIBLE_BUG", "Cancelling a Red Films production sets its future tasks בוטל locally but DELETES them in Google."),
      R("TASK_MIX_ORPHAN_GOOGLE", "POSSIBLE_BUG", "The mix setup dialog can create a Google Task even when no Redbloods task was created."),
      R("TASK_DELETE_WRONG_ROUTE", "POSSIBLE_BUG", "The tasks page first calls the calendar-EVENT delete route with a Google TASK id."),
    ],
    sideEffects: ["Google Task create / complete / delete mirror", "proposal delete / date clear / project delete cascade the follow-up task (+ Google)", "show cancel → open show tasks בוטל; confirmed show → quote follow-up בוצע", "Red Films cancel / permanent delete cascade"],
    integrations: ["GOOGLE_TASKS (the default list, through the calendar credential)"],
    security: ["all task routes rely on the central proxy (owner-only); no in-route Owner check"],
    production20260925: { total: 51, "general|פתוח": 12, "general|בוצע": 17, "general|בוטל": 2, "project|פתוח": 6, "project|בוצע": 6, "client|בוצע": 6, "red_film_production|בוצע": 1, "red_film_production|בוטל": 1, mirroredToGoogle: 43, openOverdue: 18 },
    anomalies: ["every open task (18) is past its due date"],
    gaps: ["WK_TASK_TEXT_LINKS", "WK_GOOGLE_TASKS_NOT_READ"],
    sunnyReads: ["task_view", "tasks", "project_view", "client_view", "show_view", "video_view"],
  },
  {
    id: "MEETINGS", meaningHe: "פגישות עם לקוחות (ואופציונלית פרויקט), עם תאריך, שעה, משך, מיקום ואירוע ביומן בעת הקביעה.",
    fields: { meetings: { id: "meeting id", client_id: "client id stored as TEXT (no FK)", client_name: "client name snapshot at booking (a rename does not update it)", project_id: "project id as text (no FK)", date: "YYYY-MM-DD", time: "HH:MM", duration: "minutes (30/45/60/90/120)", location: "free text (face to face / zoom / phone / studio / other)", notes: "free text", status: "נקבעה / התקיימה / בוטלה", calendar_event_id: "Google event id (set at booking only)", created_at: "created" } },
    settings: [],
    vocabularies: { status: ["נקבעה", "התקיימה", "בוטלה"] },
    relations: [{ to: "CLIENT", via: "client id text", quality: "CANONICAL_RELATION", note: "no FK; name snapshot can drift" }, { to: "PROJECT", via: "project id text", quality: "CANONICAL_RELATION" }, { to: "CALENDAR_EVENT", via: "stored event id", quality: "CANONICAL_RELATION" }],
    internal: {
      routes: [rt("app/api/meetings/route.ts", "GET/POST", "PROXY_ONLY", "books a meeting (+ Google event when requested)"), rt("app/api/meetings/[id]/route.ts", "PATCH/DELETE", "PROXY_ONLY", "edits date/time/duration/location/notes/status/project; DELETE removes the row — neither touches the Google event")],
      vocabularySources: { status: { file: "components/clients/ClientDrawer.tsx", pattern: "MEETING_STATUS_COLOR[^=]*=\\s*\\{([^}]+)\\}" } },
    },
    rules: [
      R("MEETING_NO_OUTCOME", "IMPLEMENTATION_BEHAVIOR", "A meeting has no outcome, follow-up or task; a past meeting still נקבעה may or may not have happened."),
      R("MEETING_EVENT_NOT_SYNCED", "POSSIBLE_BUG", "Editing, cancelling or deleting a meeting never updates or deletes its Google event."),
      R("MEETING_CLIENT_TEXT_ID", "IMPLEMENTATION_BEHAVIOR", "The client id is text without a FK plus a name snapshot."),
    ],
    sideEffects: ["Google event at booking only"], integrations: ["GOOGLE_CALENDAR"], security: ["meeting routes rely on the central proxy only"],
    production20260925: { total: 2, "נקבעה": 2, pastStillScheduled: 2, withCalendarEvent: 1, withProject: 0 },
    anomalies: ["both meetings are past and still נקבעה"], gaps: ["WK_MEETING_OUTCOME_NOT_RECORDED"], sunnyReads: ["meeting_view", "meetings", "client_view"],
  },
  {
    id: "ALBUMS", meaningHe: "פרויקט מסוג אלבום / EP עם רשימת שירים; לכל שיר סטטוס, סטטוס מיקס וסטטוס מאסטר ידניים. אין ישות אלבום נפרדת — האלבום הוא הפרויקט.",
    fields: { album_tracks: { id: "track id", project_id: "the album project (cascade delete)", track_number: "order (unique per project, reordered in two passes)", title: "track title", status: "project-status vocabulary (default on create 'טרום הקלטה', outside the vocabulary)", mix_status: "לא התחיל / בתהליך / הושלם (manual)", master_status: "לא התחיל / בתהליך / הושלם (manual)", notes: "free text", created_at: "created", updated_at: "updated" } },
    settings: [{ family: "album_prev_info_<project>", meaning: "previous-system per-track cost / mix / paid rows + note (Owner-only route)" }, { family: "album_finance_<project>", meaning: "LEGACY finance blob — no UI uses it (albums use normal Finance transactions)" }],
    vocabularies: { trackStatus: ["בעבודה", "מחכה למיקס", "במיקס", "הושלם", "בהשהייה", "לא התחיל", "בוטל"], mixMasterStatus: ["לא התחיל", "בתהליך", "הושלם"], albumProjectTypes: ["אלבום", "EP"] },
    relations: [{ to: "PROJECT", via: "project id", quality: "CANONICAL_RELATION" }, { to: "MIX_WORK", via: "none — same project only", quality: "DERIVED_RELATION", note: "track mix / master statuses are NOT the engineer works" }, { to: "PROJECT_FILE", via: "a project file's track id", quality: "CANONICAL_RELATION" }, { to: "RELEASE", via: "per project only (not per track)", quality: "DERIVED_RELATION" }],
    internal: {
      routes: [rt("app/api/album-tracks/route.ts", "GET/POST", "PROXY_ONLY", "creates a track (defaults טרום הקלטה / לא התחיל / לא התחיל)"), rt("app/api/album-tracks/[id]/route.ts", "PATCH/DELETE", "PROXY_ONLY", "edits title / number / statuses / notes; hard delete (the UI also deletes the track's files)"), rt("app/api/album-tracks/reorder/route.ts", "POST", "PROXY_ONLY", "renumbers in two non-atomic passes"), rt("app/api/album-finance/route.ts", "GET/PATCH", "PROXY_ONLY", "LEGACY finance blob (no UI caller)"), rt("app/api/album-prev-info/route.ts", "GET/PATCH", "OWNER_IN_ROUTE", "previous-system info rows")],
      vocabularySources: { mixMasterStatus: { file: "lib/types.ts", pattern: "export type MixMasterStatus\\s*=\\s*([^;]+);" }, albumProjectTypes: { file: "components/GlobalProjectDrawer.tsx", pattern: "ALBUM_TYPES = new Set\\(\\[([^\\]]+)\\]\\)" } },
    },
    rules: [
      R("ALBUM_TRACK_DEFAULT_OUT_OF_VOCAB", "CONFLICT", "The API default track status 'טרום הקלטה' is not in the project-status vocabulary the UI uses."),
      R("ALBUM_TRACK_MIX_MANUAL", "IMPLEMENTATION_BEHAVIOR", "Track mix / master statuses are manual and never derived from the engineer works of the project."),
      R("ALBUM_FINANCE_BLOB_LEGACY", "LEGACY_BEHAVIOR", "The album finance blob has no consumer; album money = the project's Finance transactions."),
    ],
    sideEffects: ["deleting a track in the album overview also deletes its storage files"], integrations: ["FILES_DROPBOX (track files)"], security: ["track / legacy finance routes rely on the proxy; previous-info is Owner-checked in-route"],
    production20260925: { albumProjectsWithTracks: 1, tracks: 5, "הושלם|mix לא התחיל|master לא התחיל": 1, "לא התחיל|לא התחיל|לא התחיל": 4 },
    anomalies: ["a track marked הושלם has mix and master לא התחיל (manual statuses disagree)"], gaps: ["MIX_ALBUM_TRACK_STATUS_UNLINKED"], sunnyReads: ["album_view", "albums", "project_view"],
  },
  {
    id: "DELIVERY", meaningHe: "מסירה ללקוח: רשומת מסירה לכל פרויקט (תיקייה + קישור ציבורי + סטטוס + תאריך). קבצים סופיים, סיום פרויקט וקישור וידאו סופי הם דברים אחרים — אף אחד מהם לא מוכיח מסירה.",
    fields: { "settings:delivery_<project>": { folderPath: "delivery folder (never served)", deliveryLink: "PUBLIC share link (never served — boolean only)", deliveryStatus: "not_created / ready / delivered", deliveredAt: "YYYY-MM-DD set when marked delivered" }, final_files: { id: "file id", work_id: "the engineer work", project_id: "project", file_name: "name", dropbox_path: "storage path (never served)", file_size: "bytes", file_type: "type", uploaded_by: "uploader label", created_at: "uploaded" } },
    settings: [{ family: "delivery_<project>", meaning: "the delivery record (one overwritable value — no history, no recipient)" }, { family: "steven_final_files_requested(_project):*", meaning: "final-files request flags set when the last open engineer work is approved" }, { family: "final_files_batch:*", meaning: "batching state of the 'Steven uploaded final files' push" }, { family: "share_token_*", meaning: "single-file share tokens written for every project upload (the /share page requires login — effectively unused)" }],
    vocabularies: { deliveryStatus: ["not_created", "ready", "delivered"] },
    relations: [{ to: "PROJECT", via: "settings key suffix", quality: "CANONICAL_RELATION" }, { to: "FINAL_FILE", via: "none (same project only)", quality: "DERIVED_RELATION" }, { to: "CLIENT", via: "none recorded (the recipient is not stored)", quality: "UNKNOWN" }, { to: "PROJECT_ACTION", via: "the delivery link can pre-fill a send-log entry", quality: "DERIVED_RELATION" }, { to: "RECEIVABLE", via: "same project", quality: "DERIVED_RELATION" }],
    internal: {
      routes: [rt("app/api/delivery/route.ts", "GET/POST/PATCH/DELETE", "PROXY_ONLY", "POST creates the folder + a PUBLIC share link (ready); PATCH merges any field (e.g. delivered + date); DELETE deletes the storage folder and resets the record; GET also lists the folder live"), rt("app/api/delivery/upload/route.ts", "POST", "PROXY_ONLY", "uploads a file into the delivery folder (overwrite; no DB record)")],
      vocabularySources: { deliveryStatus: { file: "components/ui/ProjectDrawer.tsx", pattern: "deliveryStatus:\\s*(\"not_created\"\\s*\\|\\s*\"ready\"\\s*\\|\\s*\"delivered\")" } },
    },
    rules: [
      R("DELIVERED_ONLY_FROM_RECORD", "CANONICAL_BUSINESS_RULE", "Sunny calls a project delivered only when its delivery record is 'delivered'; project completion, final files or a final video link never prove delivery."),
      R("DELIVERY_NO_RECIPIENT_HISTORY", "IMPLEMENTATION_BEHAVIOR", "The record has no recipient, no who-marked and no history; the send log is the only indirect trace."),
      R("DELIVERY_PUBLIC_LINK", "IMPLEMENTATION_BEHAVIOR", "Preparing a delivery creates a PUBLIC link; deleting the delivery deletes the folder."),
      R("COMPLETED_NO_DELIVERY_ALERT_FILES", "CONFLICT", "The agent alert 'completed without delivery' checks project files, not the delivery record."),
    ],
    sideEffects: ["storage folder create / delete", "final-files push to the Owner per batch", "final-files request push to Steven"], integrations: ["FILES_DROPBOX"], security: ["delivery routes rely on the central proxy only; the delivery link is public"],
    production20260925: { finalFiles: 17, finalFilesUploader: "Steven", deliveryRecords: 1, deliveryReady: 1, delivered: 0, testLeftoverRecords: 1, completedClientProjectsWithoutDeliveryEvidence: 17 },
    anomalies: ["no project is marked delivered in production (0 of 1 real delivery records)", "a leftover test delivery record (key not a project id) exists — reported, never treated as a project"], gaps: ["WK_DELIVERY_RECIPIENT_NOT_RECORDED", "RF_NO_DELIVERY_RECORD"], sunnyReads: ["delivery_view", "deliveries", "mix_view", "project_view"],
  },
  {
    id: "SOCIAL", meaningHe: "קמפיין סושיאל לכל פרויקט (אחד לפרויקט), תכנים עם סטטוס/סוג/פלטפורמה/תאריכים, קבצים, וקידום ממומן שנרשם ככסף. כללי 'מה חסר' הם של האפליקציה — לא מדיניות.",
    fields: {
      social_campaigns: { id: "campaign id", project_id: "project (unique — one campaign per project)", title: "title", artist_name: "artist text", release_date: "campaign release date (NOT synced with the release record)", status: "draft / active / completed / paused", marketing_angle: "text", target_audience: "text", main_message: "text", platforms: "platform list", owner_id: "user id", notes: "text", created_at: "created", updated_at: "updated", promotion_budget: "planned promotion budget (₪ assumed)" },
      social_content_items: { id: "item id", campaign_id: "campaign", project_id: "project (no FK)", title: "title", content_type: "טיזר / BTS / ליפסינק / …", status: "13 English keys shown as 5 Hebrew labels", platform: "one platform — or a comma-joined list written by the preview page", due_date: "due", publish_date: "publish date", owner_name: "free text", asset_link: "link (boolean when served)", dropbox_link: "link (boolean)", calendar_event_id: "never written", task_id: "never written", caption: "text", hook: "text", notes: "text", posted_url: "posted URL", created_at: "created", updated_at: "updated", publish_time: "HH:MM" },
      social_content_files: { id: "file id", content_item_id: "item", campaign_id: "campaign", project_id: "project", file_name: "name", file_type: "MIME", file_size: "bytes", dropbox_path: "path (never served)", dropbox_file_id: "storage id", dropbox_share_link: "PUBLIC link (boolean only)", uploaded_by: "always empty", created_at: "uploaded", updated_at: "updated" },
      social_promotions: { id: "promotion id", campaign_id: "campaign", channel: "YouTube / TikTok / Instagram / אחר", promo_type: "paid / dancer-creator / influencer / page / other", name: "name", planned_amount: "planned", status: "מתוכנן / פעיל / בוצע / בוטל", promo_date: "date", notes: "text", linked_transaction_id: "the actual marketing expense (paid) in Finance", created_at: "created", updated_at: "updated" },
    },
    settings: [],
    vocabularies: { campaignStatus: ["draft", "active", "completed", "paused"], contentStatus: ["draft", "in_progress", "ready_to_post", "published", "idea", "needs_shoot", "shot", "in_edit", "needs_review", "ready", "scheduled", "posted", "cancelled"], platform: ["tiktok", "instagram", "youtube", "spotify", "other"], contentType: ["טיזר", "BTS", "ליפסינק", "סטורי", "קליפ קצר", "פוסט", "ריל", "הכרזה", "תוכן אישי", "אחר"] },
    relations: [{ to: "PROJECT", via: "campaign project id (unique)", quality: "CANONICAL_RELATION" }, { to: "RELEASE", via: "campaign release date vs release target", quality: "DERIVED_RELATION", note: "two dates, never synced" }, { to: "RED_FILMS_PRODUCTION", via: "same project only", quality: "DERIVED_RELATION" }, { to: "FINANCE_TRANSACTION", via: "promotion linked transaction (marketing expense)", quality: "CANONICAL_RELATION" }, { to: "LABEL_ARTIST", via: "artist name text", quality: "TEXT_MATCH" }],
    internal: {
      routes: [rt("app/api/social/campaigns/route.ts", "GET/POST", "PROXY_ONLY", "creates a campaign (409 on a duplicate project)"), rt("app/api/social/campaigns/[id]/route.ts", "GET/PATCH/DELETE", "PROXY_ONLY", "whole-body update; hard delete"), rt("app/api/social/content/route.ts", "GET/POST", "PROXY_ONLY", "creates a content item"), rt("app/api/social/content/[id]/route.ts", "GET/PATCH/DELETE", "PROXY_ONLY", "DELETE removes the item's storage files then the row"), rt("app/api/social/files/route.ts", "GET/DELETE", "PROXY_ONLY", "DELETE removes the storage file then the row"), rt("app/api/social/upload/route.ts", "POST", "PROXY_ONLY", "uploads to storage + creates a PUBLIC link + a file row"), rt("app/api/social/promotions/route.ts", "GET/POST", "OWNER_IN_ROUTE", "creates a promotion; an actual amount creates a paid marketing expense"), rt("app/api/social/promotions/[id]/route.ts", "PATCH/DELETE", "OWNER_IN_ROUTE", "edits / deletes (the expense is never deleted)"), rt("app/api/social/migrate-paths/route.ts", "GET/POST", "MIGRATION_SECRET", "one-off storage move of social files")],
      vocabularySources: { campaignStatus: { file: "lib/types.ts", pattern: "export const SOCIAL_CAMPAIGN_STATUSES: SocialCampaignStatus\\[\\] = \\[([^\\]]+)\\]" }, platform: { file: "lib/types.ts", pattern: "export const SOCIAL_PLATFORMS: SocialPlatform\\[\\] = \\[([^\\]]+)\\]" }, contentType: { file: "lib/types.ts", pattern: "export const SOCIAL_CONTENT_TYPES = \\[([^\\]]+)\\]" }, contentStatus: { file: "lib/types.ts", pattern: "export type SocialContentStatus =([^;]+);" } },
    },
    rules: [
      R("SOCIAL_CHECKLIST_IS_APP_BEHAVIOR", "IMPLEMENTATION_BEHAVIOR", "The 'what is missing' checklist (teaser / BTS / lip-sync / announcement post, nothing ready, <3 items within 14 days of release, ready without a file link, overdue) and the recommendations are the app's defaults — not Owner policy, never a verdict that a release cannot happen."),
      R("SOCIAL_STATUS_KEYS_COLLAPSE", "IMPLEMENTATION_BEHAVIOR", "13 stored status keys collapse to 5 Hebrew labels; different pages write different subsets."),
      R("SOCIAL_PLATFORM_FORMAT", "POSSIBLE_BUG", "The preview page writes comma-joined platforms; the recommendation rule compares a single value, so it can never match them."),
      R("SOCIAL_RELEASE_DATE_UNSYNCED", "CONFLICT", "The campaign release date is not synced with the release record's target date."),
      R("SOCIAL_PROMOTION_EXPENSE", "CANONICAL_BUSINESS_RULE", "A promotion's actual amount becomes a paid marketing expense (scope שיווק) in Finance; deleting the promotion keeps the expense."),
    ],
    sideEffects: ["storage upload + PUBLIC link per file; item / file delete removes storage files", "promotion actual → Finance expense (₪, paid)"], integrations: ["FILES_DROPBOX", "FINANCE"], security: ["campaign / content / files / upload routes rely on the proxy only; promotions are Owner-checked in-route; social file links are public"],
    production20260925: { campaigns: 1, activeCampaigns: 1, contentItems: 5, "published|טיזר|instagram,tiktok": 5, files: 5, promotions: 1, "promotion|מתוכנן": 1 },
    anomalies: ["all 5 items carry the comma-joined platform 'instagram,tiktok'"], gaps: ["CO_SOCIAL_NOT_DEEP"], sunnyReads: ["social_view", "social", "project_view"],
  },
];
