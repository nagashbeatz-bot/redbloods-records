/**
 * Sunny System Awareness — VICTOR DEEP CONTRACT (the external producer as Redbloods actually implements him).
 *
 * Produced by the Victor Deep Brain discovery (2026-09-25): the work store, portal, upload / stream / delete / folder
 * routes, owner review + notes flow, ball-holder rule, deadline → task, salary months + finance, settings, pushes,
 * agent / COO / report consumers, the live production schema and read-only production counts. Pure data; served
 * through system_awareness mode victor_model. Semantic only — schema pin, route patterns and reviewed files are internal.
 */
import type { ApprovalClass, Enforcement, Who } from "./project-actions";

export const VICTOR_BASELINE_VERSION = "2026.09.25-victor-1";

/** Live production columns of the Victor work table (2026-09-25) — internal, pinned by the test. */
export const VICTOR_SCHEMA_COLUMNS = ["id", "vendor_name", "project_id", "status", "sent_date", "internal_deadline", "returned_date", "dropbox_folder", "dropbox_share_link", "quality", "entered_project", "notes", "files_sent", "files_received", "created_at", "updated_at", "work_state", "outcome", "linked_task_id", "title", "brief_text", "reference_links", "version_reviews", "brief_files"] as const;
/** Victor settings keys present in production (internal) — each one is classified below. */
export const VICTOR_SETTINGS_KEYS = ["vendor_victor_settings", "vendor_victor_salary_overrides", "vendor_victor_salary_status_overrides", "vendor_victor_payment_<YYYY_MM>", "victor_avatar", "victor_visit_last", "victor_work_completed_pushed_<workId>", "victor_upload_pending_<workId>", "push_cooldown_victor_stuck", "push_cooldown_victor_below_pace", "goal_monthly_victor"] as const;

export type FieldClass = "CANONICAL" | "DERIVED" | "DISPLAY_ONLY" | "LEGACY" | "AMBIGUOUS" | "POSSIBLE_BUG" | "CONFLICT";
export interface VictorField { field: string; classification: FieldClass; meaning: string; validation: string; writers: string; readers: string; victorSees: string; history: string; sunnyReads: string }
const F = (field: string, classification: FieldClass, meaning: string, o: Partial<VictorField> = {}): VictorField =>
  ({ field, classification, meaning, validation: "none server-side", writers: "Owner (portal / project drawer)", readers: "Victor portal, COO, agent, reports, Partner", victorSees: "yes", history: "no change history (updated time only)", sunnyReads: "victor_view", ...o });

export const VICTOR_FIELDS: readonly VictorField[] = [
  F("id", "CANONICAL", "Victor work identity.", { history: "—" }),
  F("vendor_name", "CANONICAL", "Always 'victor' on insert — every list filters on it (one lookup by id does not).", { writers: "insert" }),
  F("project_id", "CANONICAL", "The project this work belongs to — NULLABLE: a standalone Victor work has no project (24 of 31 in production).", { victorSees: "no (stripped)" }),
  F("title", "CANONICAL", "The name Victor sees (blank → null).", {}),
  F("status", "CANONICAL", "פעיל / הושלם / בוטל — the real lifecycle. הושלם stamps the returned date; any other status clears it.", { writers: "Owner only (Victor cannot change it); marking a project הושלם also completes its active Victor work", victorSees: "read-only chip" }),
  F("work_state", "LEGACY", "Display-only state set at send time: נשלח לויקטור / חזר מויקטור / דורש בדיקה / דורש תיקון / מחכה לקבצים / לא רלוונטי — no screen changes it afterwards (all 31 production works: נשלח לויקטור).", { writers: "send-to-Victor flow" }),
  F("outcome", "LEGACY", "אושר / נכנס לפרויקט בפועל / חלקית / לא נכנס לפרויקט / נדחה — shown in the drawer, no editor exists (0 set in production).", { writers: "nobody today" }),
  F("sent_date", "CANONICAL", "When the work was sent (defaults to today).", {}),
  F("internal_deadline", "CANONICAL", "Victor's INTERNAL deadline — an expectation, never a client commitment. Setting it creates / moves a follow-up task (+ Google Task).", { writers: "Owner only", history: "overwritten; clearing it leaves the old task" }),
  F("returned_date", "DERIVED", "Stamped when status becomes הושלם; cleared otherwise.", { writers: "status change" }),
  F("dropbox_folder", "CANONICAL", "The work's storage folder = its security scope: /Projects/{artist}/{project}/Victor or /Projects/Victor/{title}. Every Victor read / delete / upload must lie inside it (a folder of another shape is refused). Production 2026-09-25: all 30 stored folders are canonical; every file entry lies inside its work's folder.", { writers: "lazy folder creation on first upload (server); Owner (Victor's PATCH is refused since 2026-09-25)", victorSees: "no (stripped), not writable", sunnyReads: "victor_view (path metadata)" }),
  F("dropbox_share_link", "CANONICAL", "PUBLIC share link to the work folder (bearer access material), created by the Owner's folder builder.", { victorSees: "no (stripped), not writable", sunnyReads: "hasFolderLink only (secret)" }),
  F("quality", "LEGACY", "Exists in the database; never read or written by the app.", { writers: "nobody", victorSees: "no" }),
  F("entered_project", "LEGACY", "Exists in the database; never read or written by the app.", { writers: "nobody", victorSees: "no" }),
  F("notes", "CANONICAL", "Owner-internal notes.", { victorSees: "no (stripped)" }),
  F("files_sent", "CONFLICT", "EVERY version upload (Victor's AND the Owner's) lands here: {name, versionLabel, uploadedAt, uploadedBy, path, share link, duration, size}. uploadedBy (owner / victor) is recorded server-side from the session since 2026-09-25; older entries have none (unknown uploader).", { writers: "upload routes; Owner PATCH; file delete (Victor: his own uploads only)", victorSees: "sanitized (no path / links; opaque file ref)", sunnyReads: "victor_view (metadata; links → boolean)" }),
  F("files_received", "LEGACY", "Same shape — no code path writes it (always empty).", { writers: "nobody (Owner PATCH possible; Victor's PATCH refused)" }),
  F("brief_files", "CANONICAL", "Brief audio / files (+ optional segments).", { writers: "Owner only" }),
  F("reference_links", "CANONICAL", "YouTube references {title, note, url}.", { writers: "Owner" }),
  F("version_reviews", "CANONICAL", "Per version: {status (always 'waiting' — no UI sets it), notes (draft), sentNotes, sentAt, draft, reviewedAt, reviewedBy}. sentAt is written only after the push to Victor was delivered.", { writers: "Owner (save draft / send notes)", victorSees: "sent notes only" }),
  F("linked_task_id", "CANONICAL", "The follow-up task created from the internal deadline.", { writers: "deadline PATCH" }),
  F("brief_text", "CANONICAL", "The 'קרא אותי קודם' brief.", { writers: "Owner" }),
  F("created_at", "CANONICAL", "Created (portal order).", { history: "creation only" }),
  F("updated_at", "CANONICAL", "Last change (also the completion-push dedupe key).", { history: "last change only" }),
];

export const VICTOR_SETTINGS: ReadonlyArray<{ key: string; classification: FieldClass; meaning: string; sunnyReads: string }> = [
  { key: "vendor_victor_settings", classification: "CANONICAL", meaning: "{monthlyGoal (code default 10; production 12), monthlySalary (default 550; production 550), salaryCurrency ($), salaryPayDay (10 — IGNORED: due date is hardcoded to the 10th), stuckAfterDays (5), paceMetric}", sunnyReads: "victor_view money + system_settings" },
  { key: "vendor_victor_salary_overrides", classification: "CANONICAL", meaning: "per-month amount overrides (e.g. 2026-06: 500)", sunnyReads: "victor_view money" },
  { key: "vendor_victor_salary_status_overrides", classification: "CONFLICT", meaning: "per-month status overrides — they OUTRANK the finance transaction in the salary view (May–Aug 2026 = שולם while only August has a finance row)", sunnyReads: "victor_view money" },
  { key: "vendor_victor_payment_<YYYY_MM>", classification: "LEGACY", meaning: "old per-month {status, paidDate} (May / June 2026 = צפוי) — still read into the portal stats", sunnyReads: "victor_view money (evidence only)" },
  { key: "goal_monthly_victor", classification: "CONFLICT", meaning: "agent goal target (default 12) — while its 'expected by now' uses the vendor monthlyGoal", sunnyReads: "system_settings" },
  { key: "victor_visit_last", classification: "CANONICAL", meaning: "last portal visit {at} (30-minute presence cooldown)", sunnyReads: "victor_view presence" },
  { key: "victor_work_completed_pushed_<workId>", classification: "CANONICAL", meaning: "completion push dedupe {fromUpdatedAt}", sunnyReads: "victor_view notifications" },
  { key: "victor_upload_pending_<workId>", classification: "CANONICAL", meaning: "upload push batching (1-minute window)", sunnyReads: "system_settings" },
  { key: "push_cooldown_victor_stuck", classification: "CANONICAL", meaning: "agent / cron stuck-work push cooldown", sunnyReads: "system_settings" },
  { key: "push_cooldown_victor_below_pace", classification: "CANONICAL", meaning: "agent below-pace push cooldown", sunnyReads: "system_settings" },
  { key: "victor_avatar", classification: "DISPLAY_ONLY", meaning: "avatar image choice (image at a fixed storage path)", sunnyReads: "not read (display only)" },
];

export const VICTOR_IDENTITY = {
  loginRole: "the victor role is decided by the configured account email (proxy + role helper)",
  vendor: "work rows are filtered by vendor name 'victor' — the canonical work identity (vendor:VICTOR)",
  financeParty: "salary finance rows: artist text 'Victor', category צוות, business key victor_salary_YYYY-MM on the row's link field",
  sendLog: "the project send log names him by text ('ויקטור', recipient role external_producer)",
  releaseResponsible: "'ויקטור' is a suggested free-text value of a release's responsible field",
  storage: "work folders under the projects tree (…/Victor) or a standalone Victor folder; avatar at a fixed path",
  hardcoded: ["role email", "stuck days 5 in the cron + agent (setting ignored there)", "salary due = the 10th of the next month (pay-day setting ignored)", "portal start date 12.03.2024 (display)", "portal list capped at 12 works"],
} as const;

export const VICTOR_STATES = {
  status: [{ value: "פעיל", meaning: "open work" }, { value: "הושלם", meaning: "Owner marked it complete (returned date stamped; optionally the project too)" }, { value: "בוטל", meaning: "cancelled" }],
  workState: "display-only after send (see field) — the ball holder is derived from timestamps instead",
  completion: "Owner only. On a linked work the Owner may also complete the PROJECT ('כן, סמן הכול') or only the Victor work. A real transition pushes Victor 'Project completed' then the Owner (deduped by the pre-update time). Completing never proves the project moved to mix.",
  reopen: "any non-הושלם status clears the returned date; re-completing pushes again",
  conflicts: ["the cron stuck check filters status by work-state values → never fires", "portal isStuck uses '>' days while the agent uses '>='", "'active' stats are month-filtered despite the documentation"],
} as const;

export const HANDOFF_MODEL = {
  rule: "the app's ball rule: compare the latest upload time (ALL uploads — the Owner's own uploads included) with the latest notes-sent time (tie tolerance 60 s). Upload later → OWNER holds; notes later → VICTOR holds; missing / legacy / too close → UNKNOWN.",
  evidence: ["upload times (versions)", "notes sent times (per version)", "drafts (not sent)", "status / completion", "send-log entry (pending_version / got_notes)", "internal deadline", "Owner knowledge (blocker)"],
  caveats: ["an Owner upload counts as an 'upload' and can make the rule say the Owner holds the ball", "WhatsApp / phone / in-person are invisible — a stale in-app state is a question, not a conclusion", "age never decides responsibility", "the send log can disagree with the upload / notes evidence — Sunny shows both"],
  sunnyStates: ["WAITING_ON_VICTOR", "WAITING_ON_OWNER", "COMPLETED", "UNKNOWN", "CONFLICTING_EVIDENCE"],
} as const;

export const FILE_MODEL = {
  uploads: "single upload or chunked (> 140 MB, 1 GB cap). The server derives the destination: the work's own folder (never a client path), a sanitized name, bucket Production / 02_From_Victor for Victor (the Owner may use any plain bucket); mode add + autorename (no overwrite); the committed path must stay inside the folder; the uploader is recorded. Single uploads also create a PUBLIC share link per file (stored for the Owner; never returned to Victor)",
  versions: "a client-chosen label per upload batch (V1, V2 …): join the latest version if touched < 10 minutes ago; audio starts a new V; archives join the latest. The server does not validate labels. 'Latest' = highest append index, not the newest time. Not true version records.",
  delete: "Victor: only a version file HE uploaded (recorded uploader) inside the work folder, by file ref — storage delete first; Owner uploads and older entries with no uploader record are refused (the Owner deletes them). Owner: any version file of the work. No replace.",
  stream: "stream / download by work + file ref (a legacy path form matches a Victor work's own entries); the path must also lie inside that work's folder; returns a temporary storage link",
  authorization: "enforced server-side on every Victor route (2026-09-25): session role in-route (Owner or Victor), a well-formed work id of a Victor row, no Victor PATCH at all, folder-scoped paths (traversal / malformed / out-of-folder paths fail closed), Owner-only lookups by project id, folder building and raw storage routes. The proxy stays a second layer.",
  player: "desktop drawer audio + playlist; mobile uses the app MiniPlayer",
  stemsAndDelivery: "no stems / MIDI / final-production / delivery marker — file roles (vocals / instrumental / stems) are guessed in the browser from names",
  sunnyVisibility: "Sunny reads the stored file METADATA (name, version, upload time, size, duration, path) — never links; a live storage listing is not available (capability gap), so 'no stored file entry' ≠ 'no file in storage'",
} as const;

export const FEEDBACK_MODEL = {
  draft: "'שמור' saves notes as a draft (not visible to Victor)",
  send: "'שלח לויקטור' pushes Victor; ONLY after delivery are sentNotes / sentAt written (409 when Victor has no subscribed device — nothing marked sent)",
  statusField: "a review's status is always 'waiting' (no UI sets it) — Sunny never reads it as 'approved'",
  victorView: "Victor sees sent notes only, read-only",
  responseEvidence: "Owner response = a sentAt later than the upload; a project update is never treated as a response",
} as const;

export const MONEY_MODEL = {
  model: "a monthly SALARY (retainer) per calendar month — not per project. Amount = the month's override, else the settings salary (550); currency from settings ($).",
  quota: "a monthly GOAL of works exists (settings monthlyGoal = 12 in production; agent goal 12; code default 10) with pace metric 'נכנסו לפרויקט בפועל' — used for KPIs / below-pace alerts, NOT tied to pay in any code",
  due: "the 10th of the following month (hardcoded)",
  statusOrder: "status override → (no finance row: לא שולם when past due, else צפוי) → finance row שולם → חלקי → בוטל = as if none → otherwise נשלח לכספים",
  financeRow: "expense, category צוות, scope כללי, party 'Victor', description 'משכורת Victor — <month>', key victor_salary_YYYY-MM; created by the salary route (no live UI caller — Partner's approved finance action executed August 2026)",
  paidRule: "Finance Brain: a vendor expense is fully paid only when שולם (התקבל is not a valid vendor-expense paid status; חלקי is not paid); currencies never added",
  sources: ["finance rows (canonical money)", "status / amount overrides (Owner statements in settings — outrank finance in the salary view)", "legacy month keys (evidence)", "Owner Context answers (Finance Brain)", "Partner memory conflicts"],
} as const;

export const PORTAL_MODEL = {
  page: "one page (no tabs): top bar (language, month switcher), avatar, KPI cards (goal, completed of goal, in progress, stuck; salary Owner-only), the month's works (first 12 + 'N more'; newest first; no filters), capacity card, Owner-only files card / salary column",
  drawer: "title, status, deadline chip, brief + brief audio, references, versions with upload / download / delete / notes, progress steps, dates; Owner-only: send work, remove, open storage folder",
  victorCan: ["read his works (sanitized)", "upload versions (into the work's own folder)", "stream / download files inside a work's folder", "delete his OWN uploads", "change language / avatar", "ping presence, register push"],
  victorCannot: ["status / deadline / outcome", "notes", "any work PATCH (files / folder / link included)", "look up a work by project id", "build folders / receive a folder link", "read / delete / upload outside a work's folder", "delete Owner uploads or older unattributed files", "salary / settings / notify routes"],
  privacyLeak: "none known since 2026-09-25: salary / currency / payment status and the avatar storage path are removed server-side; upload responses carry no path / link",
} as const;

export const VICTOR_PUSHES = [
  { id: "WORK_SENT", trigger: "Owner presses 'שלח עבודה לויקטור' (manual; no dedupe; resendable)", recipients: "Victor, then Owner ack", guard: "production", deepLink: "his portal ?workId" },
  { id: "VERSION_NOTES", trigger: "Owner sends notes on a version", recipients: "Victor, then Owner ack; sent state written only on delivery", guard: "production", deepLink: "?workId" },
  { id: "VICTOR_UPLOAD", trigger: "Victor uploads (single → immediate; batch → 1-minute window, flushed by the minute ticker)", recipients: "Owner", guard: "production", deepLink: "?workId" },
  { id: "WORK_COMPLETED", trigger: "status → הושלם (real transition)", recipients: "Victor, then Owner", guard: "production", deepLink: "?workId" },
  { id: "PRESENCE", trigger: "Victor loads his page (30-minute cooldown)", recipients: "Owner", guard: "production", deepLink: "his portal" },
  { id: "STUCK_CRON", trigger: "push cron — filters status by work-state values, so it NEVER fires on current data", recipients: "Owner", guard: "production", deepLink: "team" },
  { id: "STUCK_AGENT", trigger: "agent check (switched off by the MAI flag)", recipients: "Owner (12-hour cooldown)", guard: "production", deepLink: "team" },
] as const;

export interface VictorActionEntry { id: string; action: string; who: Who | "VICTOR_OR_OWNER"; enforcement: Enforcement; entryPoint: string; writes: string; files: string | null; project: string | null; finance: string | null; calendar: string | null; push: string | null; destructive: boolean; reversible: "YES" | "PARTIAL" | "NO"; approvalClass: ApprovalClass; sunnyToday: "KNOWLEDGE_ONLY" | "EXECUTE_AFTER_DASHBOARD_APPROVAL"; futurePrimitive: string; internal: { routes: readonly string[] } }
type VA = Omit<VictorActionEntry, "sunnyToday" | "internal"> & { routes: readonly string[]; sunnyToday?: VictorActionEntry["sunnyToday"] };
const X = (e: VA): VictorActionEntry => { const { routes, sunnyToday, ...rest } = e; return { ...rest, sunnyToday: sunnyToday ?? "KNOWLEDGE_ONLY", internal: { routes } }; };
const WR = "app/api/vendor/victor/work/route.ts", WI = "app/api/vendor/victor/work/[id]/route.ts";
export const VICTOR_ACTIONS: readonly VictorActionEntry[] = [
  X({ id: "SEND_TO_VICTOR", action: "Send a project to Victor (create / reuse the work + send-log entry)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "project drawer 'שלח ל… → הפקה → ויקטור'", writes: "work (פעיל, נשלח לויקטור, sent today) + send-log pending_version", files: "none (folder lazily on first upload)", project: "status unchanged", finance: null, calendar: null, push: "none (manual 'שלח עבודה')", destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "SEND_TO_VICTOR", routes: [WR, "app/api/project-actions/route.ts"] }),
  X({ id: "NEW_STANDALONE_WORK", action: "New Victor work without a project", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "portal '+ New work'", writes: "work", files: null, project: null, finance: null, calendar: null, push: null, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "CREATE_VICTOR_WORK", routes: [WR] }),
  X({ id: "NOTIFY_WORK", action: "Push the work to Victor", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "drawer 'שלח עבודה לויקטור'", writes: "—", files: null, project: null, finance: null, calendar: null, push: "Victor + Owner ack", destructive: false, reversible: "NO", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "NOTIFY_VICTOR", routes: ["app/api/vendor/victor/notify-work/route.ts"] }),
  X({ id: "SET_DEADLINE", action: "Set / change the internal deadline", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "drawer / project send", writes: "deadline + follow-up task (+ Google Task)", files: null, project: null, finance: null, calendar: "Google Task", push: null, destructive: false, reversible: "YES", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "SET_VICTOR_DEADLINE", routes: [WI] }),
  X({ id: "CHANGE_STATUS", action: "Change status / complete (optionally the project too)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "status dropdown / steps", writes: "status + returned date", files: null, project: "optional project הושלם", finance: null, calendar: null, push: "completion → Victor + Owner", destructive: false, reversible: "PARTIAL", approvalClass: "STANDARD", futurePrimitive: "UPDATE_VICTOR_STATUS", routes: [WI, "app/api/projects/[id]/route.ts"] }),
  X({ id: "EDIT_BRIEF", action: "Edit title / brief / brief files / references / notes", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "drawer", writes: "work", files: "brief audio", project: null, finance: null, calendar: null, push: null, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "UPDATE_VICTOR_BRIEF", routes: [WI, "app/api/vendor/victor/work/[id]/brief/route.ts"] }),
  X({ id: "UPLOAD_VERSION", action: "Upload files / a version (Owner or Victor)", who: "VICTOR_OR_OWNER", enforcement: "ROLE_SCOPED", entryPoint: "drawer versions", writes: "file entries", files: "storage upload into the work folder only (+ public link per single file, never returned to Victor)", project: null, finance: null, calendar: null, push: "Victor upload → Owner", destructive: false, reversible: "PARTIAL", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "—", routes: ["app/api/dropbox/vendor-upload/route.ts", "app/api/dropbox/vendor-upload/chunk/route.ts"] }),
  X({ id: "DELETE_FILE", action: "Delete a version file", who: "VICTOR_OR_OWNER", enforcement: "ROLE_SCOPED", entryPoint: "drawer", writes: "file entry removed, orphan reviews pruned", files: "storage delete (Victor: his own uploads inside the work folder only)", project: null, finance: null, calendar: null, push: null, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "DELETE_VICTOR_FILE", routes: ["app/api/vendor/victor/work/[id]/file/route.ts", "app/api/dropbox/vendor-delete/route.ts"] }),
  X({ id: "SEND_VERSION_NOTES", action: "Save draft / send notes on a version", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "drawer notes", writes: "review (sent on delivery only)", files: null, project: null, finance: null, calendar: null, push: "Victor + Owner ack", destructive: false, reversible: "NO", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "SEND_VICTOR_NOTES", routes: [WI, "app/api/vendor/victor/notify-version-notes/route.ts"] }),
  X({ id: "REMOVE_WORK", action: "Remove a work (task then work)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "drawer 'remove'", writes: "work + task deleted", files: "storage kept", project: null, finance: null, calendar: "Google Task", push: null, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "DELETE_VICTOR_WORK", routes: [WI] }),
  X({ id: "SALARY_OVERRIDES", action: "Set a month's salary amount / status override", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "portal salary modal", writes: "settings overrides", files: null, project: null, finance: "changes the salary view (outranks finance)", calendar: null, push: null, destructive: false, reversible: "YES", approvalClass: "FINANCIAL", futurePrimitive: "SET_VICTOR_SALARY_OVERRIDE", routes: ["app/api/vendor/victor/salary/route.ts"] }),
  X({ id: "RECORD_SALARY_EXPENSE", action: "Record a month's salary finance row", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "no live UI (dead drawer) — Partner approved action", writes: "finance expense (deduped per month)", files: null, project: null, finance: "expense row", calendar: null, push: null, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "RECORD_PAID_EXPENSE (Partner — approved + executed Aug 2026)", sunnyToday: "EXECUTE_AFTER_DASHBOARD_APPROVAL", routes: ["app/api/vendor/victor/salary/route.ts"] }),
  X({ id: "SETTINGS", action: "Edit Victor settings (salary, currency, goal, stuck days)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", entryPoint: "settings", writes: "settings", files: null, project: null, finance: "salary base", calendar: null, push: null, destructive: false, reversible: "YES", approvalClass: "FINANCIAL", futurePrimitive: "—", routes: ["app/api/vendor/victor/settings/route.ts"] }),
  X({ id: "FOLDER_LINK", action: "Create / open the work folder + public link", who: "VICTOR_OR_OWNER", enforcement: "ROLE_SCOPED", entryPoint: "drawer open", writes: "folder + share link", files: "storage folder", project: null, finance: null, calendar: null, push: null, destructive: false, reversible: "PARTIAL", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "—", routes: ["app/api/dropbox/vendor-folder/route.ts"] }),
];

export interface VictorWorkflow { event: string; support: "SUPPORTED" | "PARTIAL" | "NOT_SUPPORTED"; concept: string; missing: string[] }
export const VICTOR_WORKFLOWS: readonly VictorWorkflow[] = [
  { event: "ASSIGN_TO_VICTOR", support: "SUPPORTED", concept: "project send (drawer) or standalone work", missing: ["duplicate guard"] },
  { event: "SEND_TO_VICTOR", support: "PARTIAL", concept: "manual push 'שלח עבודה' (no sent marker)", missing: ["evidence that the push was sent (no marker)"] },
  { event: "WORK_STARTED", support: "NOT_SUPPORTED", concept: "no 'started' state", missing: ["a start event"] },
  { event: "VICTOR_UPLOAD", support: "SUPPORTED", concept: "upload + Owner push", missing: [] },
  { event: "NEW_VERSION", support: "PARTIAL", concept: "client-chosen version labels", missing: ["true version records"] },
  { event: "OWNER_REVIEW", support: "PARTIAL", concept: "draft notes", missing: ["a review decision (status always waiting)"] },
  { event: "OWNER_FEEDBACK", support: "SUPPORTED", concept: "send notes (sent on delivery)", missing: [] },
  { event: "REVISION_REQUESTED", support: "PARTIAL", concept: "notes sent = implied revision", missing: ["an explicit revision state"] },
  { event: "WAITING_ON_VICTOR", support: "SUPPORTED", concept: "ball rule: notes later than the last upload", missing: ["outside communication"] },
  { event: "WAITING_ON_OWNER", support: "SUPPORTED", concept: "ball rule: upload later than the last notes", missing: ["Owner uploads count as uploads"] },
  { event: "VICTOR_COMPLETED", support: "SUPPORTED", concept: "Owner sets הושלם (+ push)", missing: ["Victor cannot mark his own work done"] },
  { event: "HANDOFF_TO_MIX", support: "NOT_SUPPORTED", concept: "no link from Victor work to the mix engineer / project mix status", missing: ["a production → mix handoff record"] },
  { event: "DEADLINE_SET", support: "SUPPORTED", concept: "internal deadline + follow-up task", missing: [] },
  { event: "DEADLINE_CHANGED", support: "PARTIAL", concept: "overwritten; task moved", missing: ["deadline history"] },
  { event: "DEADLINE_PASSED", support: "SUPPORTED", concept: "COO signal (skipped when the Owner holds the ball)", missing: [] },
  { event: "MONTHLY_PAYMENT_EXPECTED", support: "SUPPORTED", concept: "salary month due the 10th of the next month", missing: [] },
  { event: "MONTHLY_PAYMENT_RECORDED", support: "PARTIAL", concept: "finance row (no live UI) or status override", missing: ["one authoritative record"] },
  { event: "PORTAL_ACTIVITY", support: "SUPPORTED", concept: "presence (last visit) — activity evidence only", missing: [] },
];

export const VICTOR_SIGNAL_MODEL: ReadonlyArray<{ code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; note: string }> = [
  { code: "WAITING_ON_VICTOR", kind: "DERIVED_SIGNAL", note: "notes sent after the last upload (in-app evidence)" },
  { code: "WAITING_ON_OWNER", kind: "DERIVED_SIGNAL", note: "an upload after the last notes (the Owner's own uploads count)" },
  { code: "HANDOFF_UNKNOWN", kind: "UNKNOWN", note: "no / too-close / legacy evidence" },
  { code: "HANDOFF_CONFLICT", kind: "DERIVED_SIGNAL", note: "the send log says something different from the upload / notes evidence" },
  { code: "INTERNAL_DEADLINE_PASSED", kind: "DERIVED_SIGNAL", note: "internal expectation — not a client commitment, not blame" },
  { code: "NO_PROJECT_LINK", kind: "CANONICAL_FACT", note: "standalone work — no project / artist / client context" },
  { code: "NO_FILE_ENTRIES", kind: "CANONICAL_FACT", note: "no stored file entries (storage itself not listable)" },
  { code: "DRAFT_NOTES_NOT_SENT", kind: "CANONICAL_FACT", note: "notes saved but not sent to Victor" },
  { code: "COMPLETED_NO_MIX_EVIDENCE", kind: "DERIVED_SIGNAL", note: "work completed, no engineer work on the project" },
  { code: "OPEN_PROJECT_CLOSED", kind: "DERIVED_SIGNAL", note: "the Victor work is open while its project is הושלם / בוטל" },
  { code: "LABEL_WORK", kind: "CANONICAL_FACT", note: "the project is label work (release / stored לייבל / Owner classification)" },
  { code: "RELEASE_CONTEXT", kind: "CANONICAL_FACT", note: "the project has a release row" },
];

export const VICTOR_INTEGRITY = {
  productionCounts20260925: {
    works: 31, byStatus: { "פעיל": 25, "הושלם": 6 }, workState: { "נשלח לויקטור": 31 }, withProject: 7, withoutProject: 24, orphanProjectLinks: 0,
    businessType: { "לקוח": 6, "לייבל": 1, noProject: 24 }, withInternalDeadline: 7, activeDeadlinePassed: 5, returned: 6,
    withFileEntries: 30, filesReceivedUsed: 0, fileEntries: 101, withReviews: 19, reviewStatuses: { waiting: 25 }, withEngineerWork: 1, deadlineTasks: 7, outcomeSet: 0, qualitySet: 0, enteredProjectSet: 0,
    completionPushMarkers: 6, lastPortalVisit: "2026-09-23",
    salarySettings: { monthlySalary: 550, currency: "$", monthlyGoal: 12, stuckAfterDays: 5, paceMetric: "נכנסו לפרויקט בפועל" },
    salaryFinanceRows: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-08"], statusOverridesPaid: ["2026-05", "2026-06", "2026-07", "2026-08"], amountOverrides: { "2026-05": 550, "2026-06": 500, "2026-07": 550, "2026-08": 550 }, legacyMonthKeys: { "2026-05": "צפוי", "2026-06": "צפוי" },
  },
  findingsHe: [
    "24 מתוך 31 העבודות של ויקטור לא מקושרות לפרויקט — אין להן הקשר אמן / לקוח / לייבל.",
    "כל 31 העבודות במצב 'נשלח לויקטור' — השדה לא מתעדכן אחרי השליחה; הכדור נגזר מתאריכי העלאה / הערות.",
    "5 עבודות פעילות עם דדליין פנימי שעבר — ציפייה פנימית, לא התחייבות ללקוח.",
    "מאי–יולי 2026: מסומנים 'שולם' ב-overrides אבל אין שורת כספים; מפתחות ישנים של מאי / יוני אומרים 'צפוי'. אוגוסט: יש שורת כספים ששולמה ($550).",
    "יוני 2026: override של סכום 500 (במקום 550) — הסיבה לא רשומה.",
    "סטטוס ה-reviews תמיד 'waiting' — אין החלטת אישור במערכת.",
  ],
} as const;

/** Server-side Victor files — a change must review this contract (internal). */
export const VICTOR_REVIEWED_FILES = [
  "lib/vendor-store.ts", "lib/vendor-folder.ts", "lib/victor-files.ts", "lib/coo/victor-ball.ts", "lib/victor-salary-format.ts",
  "lib/victor-completed-notify.ts", "lib/victor-upload-notify.ts", "lib/victor-work-notify.ts", "lib/victor-version-notes-notify.ts", "lib/victor-presence-notify.ts",
  "app/api/vendor/victor/work/route.ts", "app/api/vendor/victor/work/[id]/route.ts", "app/api/vendor/victor/work/[id]/file/route.ts", "app/api/vendor/victor/salary/route.ts",
  "app/api/dropbox/vendor-upload/route.ts", "app/api/dropbox/vendor-upload/chunk/route.ts", "app/api/dropbox/vendor-folder/route.ts",
  "lib/victor-scope.ts", "app/api/vendor/victor/route.ts", "app/api/vendor/victor/stream/route.ts", "app/api/vendor/victor/download/route.ts", "app/api/vendor/victor/avatar/route.ts",
] as const;
export const VICTOR_REVIEWED_FINGERPRINTS: Readonly<Record<string, string>> = {
  "lib/vendor-store.ts": "abe8ee7f7f0b62bc1c1787c3838853804fe8a8fae1d64869c3654c838cf70a55",
  "lib/vendor-folder.ts": "cbd63b60c770a9a01712464848b32e6d26184bdcfc882750395b0361fd385c0d",
  "lib/victor-files.ts": "4852e479431d23c2403a743b6a22bb06cf61965ec98ce340882c439539f2e272",
  "lib/coo/victor-ball.ts": "90baf51e8c245f368641460819b4e8d7b50c3f6dd71bdc23807ff1f59ba10231",
  "lib/victor-salary-format.ts": "6385d71cbbea9dba2dc0f0eb276997cf812c30cb7556e8ac942182538cf6bc64",
  "lib/victor-completed-notify.ts": "da5f698281367b8f7d3b5cbe609f29a098a0ce615399e3015cfda1c5985e0077",
  "lib/victor-upload-notify.ts": "15607a441e2ee5a33aefe3be27c84a15783ae043a58b9bff06d00006c723b929",
  "lib/victor-work-notify.ts": "7f5a56a97cbaf261ed40df759d16a154263fa0d8e67168d91b8d548e00d48306",
  "lib/victor-version-notes-notify.ts": "cf42862f128758edae5ec620717824ed7f9058b6ecfddfbdf87a049c6b833f86",
  "lib/victor-presence-notify.ts": "2609032407255e16fb29b4250c983b40115702aa435c6a52156f743c64eb323f",
  "app/api/vendor/victor/work/route.ts": "6bbc30e1afe3a6b733b548f95627f368afc198d50af9b13192ce85f98b6c0343",
  "app/api/vendor/victor/work/[id]/route.ts": "833e7a2c8ea66cf5ebdadb3babb1afc0a3c3b7242c91a00b680ffde0bce026f3",
  "app/api/vendor/victor/work/[id]/file/route.ts": "a36bbf003246f48f3b2be0ba3a99a8afaab226273aa97ad5f225684792cdc9d5",
  "app/api/vendor/victor/salary/route.ts": "f1f09e33afce9489d40a42b8e740dc5efbaf0be1db1b5c43dd3f0d8f1a23ff48",
  "app/api/dropbox/vendor-upload/route.ts": "3cba9c3f1eebf81583ec1d88af82cc1b544d2792d776e56491ac59696889648e",
  "app/api/dropbox/vendor-upload/chunk/route.ts": "1b47767b820f9fc32a763d9151e124e04c23a71ec46fe2bce03c8159ac76f474",
  "app/api/dropbox/vendor-folder/route.ts": "7da07a75dd3ae46da764c859965f6d64e32bdf3e3cd289ea46671525568da66a",
  "lib/victor-scope.ts": "312c3d7a949eb874b2b8b02d93e2f11ce1519f0dce3908fd36789bfda76a8988",
  "app/api/vendor/victor/route.ts": "40b1dc5f3c47c191909c4d7c97fbd813b695acf897d8d8bc5f5ad2171bf7c443",
  "app/api/vendor/victor/stream/route.ts": "b542c1b8fc8fc1865061973237ef636a3981b71538da2a146493f39bb88a6878",
  "app/api/vendor/victor/download/route.ts": "2c38189be62edd293bc1b1108b87877822962e3c1a1880a2fca6304601c2b595",
  "app/api/vendor/victor/avatar/route.ts": "7e3d53875e7eb69126890b4b6c5ae1af9e59270baa0e2d083408e3e00f01ba83",
};

/** Route families touching Victor (internal — the test re-discovers them). */
export const VICTOR_ROUTE_GROUPS: ReadonlyArray<{ pattern: string; purpose: string }> = [
  { pattern: "^app/api/vendor/victor/", purpose: "Victor works, files, stream / download, brief, salary, settings, notify, ping, push registration" },
  { pattern: "^app/api/dropbox/vendor-", purpose: "Victor folder / upload / delete" },
];

/** Vocabularies as the code declares them (the test pins them to the code). */
export const VICTOR_VOCABULARIES = {
  status: ["פעיל", "הושלם", "בוטל"],
  workState: ["נשלח לויקטור", "חזר מויקטור", "דורש בדיקה", "דורש תיקון", "מחכה לקבצים", "לא רלוונטי"],
  outcome: ["אושר", "נכנס לפרויקט בפועל", "חלקית", "לא נכנס לפרויקט", "נדחה"],
  ballHolder: ["owner", "victor", "unknown"],
} as const;
