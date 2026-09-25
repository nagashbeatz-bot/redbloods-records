/**
 * Sunny System Awareness — PEOPLE, ACCESS and PUSH contracts (layer 2 system knowledge). Pure data.
 *
 * Every identity that can use Redbloods OS (login roles, no-login people, machine identities), every dedicated page /
 * tab they see and what it is for, what they can do and HOW that is enforced (UI only vs proxy vs route check vs RLS),
 * every actual Push sender (who gets it, why, when, what triggers it, how it is suppressed), security gaps and UI /
 * server mismatches — produced by the Sunny User / Portal / Push discovery (2026-09-25) and verified by
 * scripts/test-sunny-people.tsx against the real role allowlists and every push-sending module.
 *
 * SEMANTIC ONLY when served: `internal` fields (role ids, allowlist samples, sender modules) are stripped. This is system
 * knowledge — not push history, not personal data, not credentials. Sunny can NEVER send a push or change access.
 */
import type { RelationQuality } from "./types";

export const PEOPLE_BASELINE_VERSION = "2026.09.25-1";

/** How a capability is actually enforced (strongest applicable). */
export type Enforcement =
  | "UI_VISIBLE" | "UI_HIDDEN" | "ROUTE_GUARDED" | "SERVER_AUTHORIZED" | "RLS_ENFORCED" | "PROXY_ONLY" | "OWNER_ONLY" | "ROLE_RESTRICTED" | "PUBLIC" | "UNKNOWN";

export type MoneyVisibility = "NONE" | "OWN_FEE_ONLY" | "OWN_LEDGER_READ_ONLY" | "OWN_PAYMENTS_READ_ONLY" | "HIDDEN_BUT_IN_PAYLOAD" | "ALL";

export interface PortalTab {
  id: string;
  titleHe: string;
  purpose: string;
  visibleData: string;
  money: MoneyVisibility;
  /** Writes the user can make from this tab (business meaning + enforcement). */
  writes: ReadonlyArray<{ action: string; enforcement: Enforcement; sideEffects: string }>;
}

export interface UserContract {
  /** ^[A-Z][A-Z0-9_]{2,40}$ */
  id: string;
  titleHe: string;
  kind: "LOGIN_ROLE" | "NO_LOGIN_PERSON" | "MACHINE_IDENTITY" | "BLOCKED";
  whoTheyAre: string;
  whyAccess: string;
  authMethod: string;
  landing: string | null;
  language: string;
  /** Deterministic links to company entities (never by name similarity alone). */
  entities: ReadonlyArray<{ entity: string; quality: RelationQuality; basis: string }>;
  tabs: readonly PortalTab[];
  /** What they cannot do (and why), stated honestly. */
  cannot: readonly string[];
  /** Push contract ids they receive. */
  receivesPush: readonly string[];
  /** Push contract ids their own actions trigger (for others or themselves). */
  triggersPush: readonly string[];
  securityGapIds: readonly string[];
  limitationsHe: readonly string[];
  /** INTERNAL (tests only, never served): the code role and allowlist samples the test proves against lib/roles.ts. */
  internal: { role: string | null; allowedPaths: readonly string[]; deniedPaths: readonly string[] };
}

export type PushType = "MANUAL" | "EVENT" | "SCHEDULED" | "AGENT_CHECK" | "PAGE_LOAD_BEACON";

export interface PushContract {
  id: string;
  titleHe: string;
  recipientRoles: readonly string[];
  recipientEntity: string;
  purpose: string;
  sourceDomain: string;
  trigger: string;
  type: PushType;
  timing: string;
  conditions: string;
  dedupe: string;
  messageSemantics: string;
  postAction: string;
  /** Guarded so only production (or an explicit override) can send. */
  productionOnly: boolean;
  status: "ACTIVE" | "DISABLED" | "LEGACY";
  knownBugs: readonly string[];
  sunnyMayTrigger: false;
  /** INTERNAL (tests only): the modules that actually send it. */
  internal: { modules: readonly string[] };
}

export interface SecurityGap {
  id: string;
  severity: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  kind: "SECURITY_GAP" | "UI_SERVER_MISMATCH" | "PRIVACY";
  users: readonly string[];
  description: string;
  status: "REPORTED_NOT_FIXED";
}

const W = (action: string, enforcement: Enforcement, sideEffects = "none") => ({ action, enforcement, sideEffects });

// ─────────────────────────────── USERS ───────────────────────────────
export const USER_CONTRACTS: readonly UserContract[] = [
  {
    id: "OWNER", titleHe: "הבעלים", kind: "LOGIN_ROLE",
    whoTheyAre: "The owner of Redbloods (the label + studio). Full operator of the company OS.",
    whyAccess: "Runs the company: projects, clients, money, label, shows, vendors, content, approvals.",
    authMethod: "Email + password login; the role comes from the configured owner email list. Also the only person who can approve the Claude connector.",
    landing: "/dashboard", language: "Hebrew (RTL)",
    entities: [{ entity: "company:REDBLOODS", quality: "CANONICAL_RELATION", basis: "owner role = the company operator" }],
    tabs: [
      { id: "OPERATIONS", titleHe: "כל המערכת", purpose: "Every page of Redbloods OS (dashboard, projects, clients, finance, shows, label, portals preview, Victor, Steven, Red Films, social, tasks, calendar, settings).", visibleData: "Everything", money: "ALL", writes: [W("Any business mutation in the app", "OWNER_ONLY", "see the business action map (system_awareness actions)")] },
      { id: "PORTAL_PREVIEW", titleHe: "תצוגת פורטל אמן", purpose: "See each artist portal exactly as the artist does, plus owner controls (ratings, next work, send show to artist / DJ, balance management, cycle reminders, sketch notifications).", visibleData: "The artist's portal + full money", money: "ALL", writes: [W("Send a show to Shalev / DJ", "OWNER_ONLY", "push to the artist / DJ + owner ack"), W("Balance entries / cycles / reminder", "OWNER_ONLY", "cycle reminder pushes the artist"), W("Confirm a DJ show from the DJ preview", "ROUTE_GUARDED", "really confirms it and pushes the owner as if the DJ confirmed (gap)")] },
    ],
    cannot: ["Nothing is blocked for the owner inside the app; Sunny itself still cannot act for the owner outside the approved action primitives."],
    receivesPush: ["P_AVI_PRESENCE", "P_CLEANTONE_PRESENCE", "P_SHALEV_PRESENCE", "P_VICTOR_PRESENCE", "P_STEVEN_PRESENCE", "P_BEAT_ASSIGNED", "P_BEAT_UPLOADED", "P_BEAT_UPDATED", "P_SKETCH_NEW", "P_SKETCH_UPDATED", "P_SESSION_CREATED_SHALEV", "P_AVAILABILITY_SAVED", "P_DJ_CONFIRMED", "P_STEVEN_UPLOADS", "P_VICTOR_UPLOADS", "P_FINAL_FILES_BATCH", "P_STEVEN_PAYMENT", "P_STEVEN_COMPLETED", "P_VICTOR_COMPLETED", "P_CYCLE_REMIND", "P_SKETCH_NOTIFY_MANUAL", "P_SHOW_TO_ARTIST", "P_SHOW_TO_DJ", "P_STEVEN_MIX_READY", "P_STEVEN_NOTES", "P_VICTOR_NEW_WORK", "P_VICTOR_VERSION_NOTES", "P_SHALEV_WEEKLY", "P_SHALEV_SESSION_REMINDER", "P_STEVEN_DEADLINE_DIGEST", "P_EXTERNAL_PUSH_CRON", "P_AGENT_ALERTS", "P_PUSH_CHECK_LEGACY"],
    triggersPush: ["P_BEAT_ASSIGNED", "P_BEAT_UPLOADED", "P_BEAT_UPDATED", "P_SESSION_CREATED_SHALEV", "P_AVAILABILITY_SAVED", "P_STEVEN_PAYMENT", "P_STEVEN_COMPLETED", "P_VICTOR_COMPLETED", "P_CYCLE_REMIND", "P_SKETCH_NOTIFY_MANUAL", "P_SHOW_TO_ARTIST", "P_SHOW_TO_DJ", "P_STEVEN_MIX_READY", "P_STEVEN_NOTES", "P_VICTOR_NEW_WORK", "P_VICTOR_VERSION_NOTES"],
    securityGapIds: ["SG_OWNER_CAN_CONFIRM_AS_DJ", "SG_PROXY_ONLY_OWNER_ROUTES", "SG_OWNER_PAGE_LOAD_WRITES"],
    limitationsHe: ["כל פעולה במערכת פתוחה לבעלים; סאני עצמו לא פועל בשמו מעבר לפעולות המאושרות."],
    internal: { role: "owner", allowedPaths: [], deniedPaths: [] },
  },
  {
    id: "SHALEV", titleHe: "שליו טסמה (אמן לייבל)", kind: "LOGIN_ROLE",
    whoTheyAre: "Label artist שליו טסמה — the most connected artist portal.",
    whyAccess: "Follow his music (sketches), shows, balance, available beats and schedule, and send weekly availability to the label.",
    authMethod: "Email + password; role from the configured Shalev email.",
    landing: "/red-artists", language: "Hebrew (RTL)",
    entities: [{ entity: "label-artist שליו טסמה", quality: "DERIVED_RELATION", basis: "the portal is hard-wired to the label artist named 'שליו טסמה' (name constant + slug), not an id link" }],
    tabs: [
      { id: "HOME", titleHe: "בית", purpose: "Orientation: next release (countdown + cover), next session, next work, 4 latest sketches, next show, this week's calendar, label updates.", visibleData: "Release, session type, show name / date / place, week events", money: "NONE", writes: [] },
      { id: "MUSIC", titleHe: "המוזיקה שלי", purpose: "His sketches (own uploads + versions).", visibleData: "Sketch list (no version / date)", money: "NONE", writes: [W("Upload a sketch", "ROUTE_GUARDED", "push to Shalev + owner ack (P_SKETCH_NEW)"), W("New version / edit / soft-delete a sketch", "ROUTE_GUARDED", "new version → P_SKETCH_UPDATED")] },
      { id: "SHOWS", titleHe: "ההופעות שלי", purpose: "His upcoming and past shows.", visibleData: "Name, date, time, place, status — no money", money: "NONE", writes: [] },
      { id: "BALANCE", titleHe: "מאזן", purpose: "What the label owes him: his ledger + cycles, read-only.", visibleData: "Full ledger in ₪ + cycle card", money: "OWN_LEDGER_READ_ONLY", writes: [] },
      { id: "BEATS", titleHe: "ביטים פנויים", purpose: "Beats the label assigned to his portal.", visibleData: "Beat list + playback", money: "NONE", writes: [] },
      { id: "SCHEDULE", titleHe: "לו״ז ועדכונים", purpose: "Send next week's availability (≥2 days; the cycle flips Thursday 08:00) and see his weekly calendar.", visibleData: "7-day availability grid, week calendar, label updates", money: "NONE", writes: [W("Send weekly availability", "ROUTE_GUARDED", "saves availability; pushes Shalev + owner (P_AVAILABILITY_SAVED)")] },
      { id: "FILES", titleHe: "קבצי הופעות ויח״צ", purpose: "Performance files and press material.", visibleData: "File list", money: "NONE", writes: [W("Upload a performance / press file", "ROUTE_GUARDED", "Dropbox upload, no push")] },
      { id: "MANDATORY_AVAILABILITY", titleHe: "חלון זמינות חובה", purpose: "On mobile, Thursday 20:00 – Saturday 21:00, if he has not sent availability, a blocking screen sends him to the schedule tab.", visibleData: "Blocking modal", money: "NONE", writes: [] },
    ],
    cannot: ["Change his balance, cycles or beats (read-only; owner-only on the server).", "Pick next work, reorder sketches, rate sketches, press-kit link (owner-only on the server).", "See show prices or client payments."],
    receivesPush: ["P_SKETCH_NEW", "P_SKETCH_UPDATED", "P_SKETCH_NOTIFY_MANUAL", "P_BEAT_ASSIGNED", "P_SESSION_CREATED_SHALEV", "P_AVAILABILITY_SAVED", "P_SHOW_TO_ARTIST", "P_SHALEV_WEEKLY", "P_SHALEV_SESSION_REMINDER", "P_SHALEV_AVAILABILITY_REMINDER", "P_CYCLE_REMIND"],
    triggersPush: ["P_SHALEV_PRESENCE", "P_SKETCH_NEW", "P_SKETCH_UPDATED", "P_AVAILABILITY_SAVED"],
    securityGapIds: ["SG_SHALEV_BALANCE_EXPOSURE", "SG_DIRECT_REST_RLS_UNKNOWN"],
    limitationsHe: ["הקישור בין המשתמש לאמן הוא לפי שם קבוע בקוד — שינוי שם האמן ישבור אותו."],
    internal: { role: "shalev", allowedPaths: ["/red-artists", "/api/red-artists/shalev-summary", "/api/red-artists/availability", "/api/red-artists/sketches", "/api/beats", "/api/notifications"], deniedPaths: ["/dashboard", "/finance", "/api/transactions", "/api/beats/x/assignments", "/api/label/artists/x/balance", "/dj-cleantone", "/team/victor"] },
  },
  {
    id: "AVI", titleHe: "אבי מולה (אמן לייבל)", kind: "LOGIN_ROLE",
    whoTheyAre: "Label artist אבי מולה.",
    whyAccess: "Follow his home summary, shows, music (sketches) and available beats.",
    authMethod: "Email + password; role from the configured Avi email; his portal is scoped to his own label-artist id.",
    landing: "/label/artists/<Avi's label-artist id>", language: "Hebrew (RTL)",
    entities: [{ entity: "label-artist אבי מולה", quality: "CANONICAL_RELATION", basis: "the role is pinned to his label-artist id in code" }],
    tabs: [
      { id: "HOME", titleHe: "בית", purpose: "Next release, next session, next work, music card, next show, week, updates; footer to enable notifications.", visibleData: "No money (the server zeroes his balance)", money: "NONE", writes: [W("Enable notifications", "SERVER_AUTHORIZED", "saves his device subscription")] },
      { id: "SHOWS", titleHe: "ההופעות שלי", purpose: "His shows.", visibleData: "Name, date, time, place, status", money: "NONE", writes: [] },
      { id: "MUSIC", titleHe: "המוזיקה שלי", purpose: "Sketches the label shares with him (play / download).", visibleData: "Sketch list", money: "NONE", writes: [] },
      { id: "BEATS", titleHe: "ביטים פנויים", purpose: "Beats assigned to his portal.", visibleData: "Beat list", money: "NONE", writes: [] },
    ],
    cannot: ["Upload or edit sketches, pick next work, change avatar, see money, schedule / availability (no such tab)."],
    receivesPush: ["P_SKETCH_NOTIFY_MANUAL", "P_BEAT_ASSIGNED", "P_CYCLE_REMIND"],
    triggersPush: ["P_AVI_PRESENCE"],
    securityGapIds: ["SG_UI_AVI_CONTROLS_403", "SG_CYCLE_REMIND_WRONG_LINK", "SG_DIRECT_REST_RLS_UNKNOWN"],
    limitationsHe: ["לאבי אין לשונית זמינות/לו״ז ואין מאזן בפורטל."],
    internal: { role: "avi", allowedPaths: ["/label/artists/{AVI}", "/api/label/artists/{AVI}/summary", "/api/label/artists/{AVI}/sketches", "/api/beats", "/api/notifications"], deniedPaths: ["/label/artists/00000000-0000-4000-8000-000000000000", "/api/label/artists/{AVI}/balance", "/api/label/artists/00000000-0000-4000-8000-000000000000/summary", "/red-artists", "/api/transactions", "/api/beats/x/assignments"] },
  },
  {
    id: "CLEANTONE", titleHe: "DJ CLEANTONE (קלינטון)", kind: "LOGIN_ROLE",
    whoTheyAre: "DJ CLEANTONE — the label's DJ (Owner-confirmed knowledge: the label DJ, plays most label shows).",
    whyAccess: "See the shows he is booked on as DJ, his DJ fee, and confirm (or withdraw) each booking.",
    authMethod: "Email + password; role from the configured DJ CLEANTONE email; scoped to his client record as the show DJ.",
    landing: "/dj-cleantone", language: "Hebrew (RTL)",
    entities: [
      { entity: "client DJ CLEANTONE (show DJ)", quality: "CANONICAL_RELATION", basis: "the role is pinned to his client id, which shows use as the DJ" },
      { entity: "label-artist DJ CLEANTONE", quality: "CANONICAL_RELATION", basis: "the app's canonical link between his client and label-artist records" },
      { entity: "role: label DJ", quality: "OWNER_CONFIRMED_RELATION", basis: "taught by the Owner to Sunny (organizational memory)" },
    ],
    tabs: [
      { id: "HOME", titleHe: "בית", purpose: "Upcoming shows table + label updates; confirm / withdraw each booking.", visibleData: "Show name, artist, date, time, place, his DJ fee, payment pill, confirmation", money: "OWN_FEE_ONLY", writes: [W("Confirm a show", "SERVER_AUTHORIZED", "pending → confirmed; pushes the owner (P_DJ_CONFIRMED)"), W("Withdraw a confirmation", "SERVER_AUTHORIZED", "no push to anyone (gap)")] },
      { id: "SHOWS", titleHe: "ההופעות שלי", purpose: "All his DJ shows (upcoming + past) with the same confirm controls.", visibleData: "Same table", money: "OWN_FEE_ONLY", writes: [W("Confirm / withdraw", "SERVER_AUTHORIZED", "as above")] },
    ],
    cannot: ["See show status / notes / other money; change his fee; see beats or music; no notification bell."],
    receivesPush: ["P_SHOW_TO_DJ", "P_CYCLE_REMIND"],
    triggersPush: ["P_CLEANTONE_PRESENCE", "P_DJ_CONFIRMED"],
    securityGapIds: ["SG_DJ_PAYMENT_PILL", "SG_DJ_UNCONFIRM_SILENT", "SG_CYCLE_REMIND_WRONG_LINK", "SG_DIRECT_REST_RLS_UNKNOWN"],
    limitationsHe: ["תג 'שולם' בפורטל של הדי-ג׳יי מראה אם הלקוח שילם — לא אם הדי-ג׳יי קיבל תשלום.", "לדי-ג׳יי אין פעמון התראות."],
    internal: { role: "cleantone", allowedPaths: ["/dj-cleantone", "/api/red-artists/cleantone-summary", "/api/red-artists/cleantone/shows/x/confirm"], deniedPaths: ["/red-artists", "/api/red-artists/shalev-summary", "/api/beats", "/api/notifications", "/api/shows"] },
  },
  {
    id: "VICTOR", titleHe: "ויקטור (מפיק ספק)", kind: "LOGIN_ROLE",
    whoTheyAre: "Victor — an external producer who receives production work and uploads versions; paid a monthly salary.",
    whyAccess: "See the work sent to him (without artist / project names), download briefs, upload his files, follow notes.",
    authMethod: "Email + password; role from the configured Victor email.",
    landing: "/team/victor", language: "English by default for him (he can switch to Russian or Hebrew)",
    entities: [{ entity: "vendor:VICTOR", quality: "CANONICAL_RELATION", basis: "the vendor work records are filtered to Victor" }],
    tabs: [
      { id: "PROFILE", titleHe: "העמוד של ויקטור", purpose: "Month navigation, KPIs (goal, done, in progress, stuck), capacity, the month's work list.", visibleData: "Work titles and states (no artist / project / folder / owner notes); salary hidden in the UI", money: "HIDDEN_BUT_IN_PAYLOAD", writes: [W("Change his avatar", "SERVER_AUTHORIZED")] },
      { id: "WORK_DRAWER", titleHe: "מגירת עבודה", purpose: "One work: brief + brief files, references, steps, sent / received timeline, sent notes per version.", visibleData: "Brief, files, notes after they are sent", money: "NONE", writes: [W("Upload files", "SERVER_AUTHORIZED", "files land in the work folder; owner push (P_VICTOR_UPLOADS)"), W("Delete his own file", "SERVER_AUTHORIZED", "Dropbox delete (path trust gap)")] },
    ],
    cannot: ["Change status, title, brief, notes; see salary / settings / payment history (hidden in UI); send work notifications; delete work."],
    receivesPush: ["P_VICTOR_NEW_WORK", "P_VICTOR_VERSION_NOTES", "P_VICTOR_COMPLETED"],
    triggersPush: ["P_VICTOR_PRESENCE", "P_VICTOR_UPLOADS"],
    securityGapIds: ["SG_VICTOR_DROPBOX_PATHS", "SG_VENDOR_FOLDER_PUBLIC_LINK", "SG_VICTOR_SALARY_IN_PAYLOAD", "SG_VICTOR_GET_NO_VENDOR_CHECK"],
    limitationsHe: ["ויקטור לא רואה שם אמן או פרויקט — רק כותרת עבודה."],
    internal: { role: "victor", allowedPaths: ["/team/victor", "/api/vendor/victor", "/api/vendor/victor/work/x", "/api/dropbox/vendor-upload", "/api/dropbox/vendor-folder", "/api/notifications"], deniedPaths: ["/api/vendor/victor/salary", "/api/vendor/victor/settings", "/api/vendor/victor/notify-work", "/api/vendor/victor/notify-version-notes", "/dashboard", "/team/steven", "/api/dropbox/upload"] },
  },
  {
    id: "STEVEN", titleHe: "סטיבן (מהנדס מיקס/מאסטר)", kind: "LOGIN_ROLE",
    whoTheyAre: "Steven — the external mix / master engineer (based in the New York time zone).",
    whyAccess: "See his jobs, upload mix versions and final files, read notes, mark comments resolved, see his payments.",
    authMethod: "Email + password; role from the configured Steven email; every job is scoped by the engineer name 'Steven'.",
    landing: "/team/steven", language: "English (forced for him)",
    entities: [{ entity: "vendor:STEVEN", quality: "CANONICAL_RELATION", basis: "jobs are scoped by the exact engineer name 'Steven'" }],
    tabs: [
      { id: "JOBS", titleHe: "עבודות", purpose: "Active / history jobs with status and payment badges; KPIs incl. debt $ and paid $; payment history.", visibleData: "Job titles, statuses, prices, paid amounts, payment dates", money: "OWN_PAYMENTS_READ_ONLY", writes: [W("Enable notifications", "SERVER_AUTHORIZED")] },
      { id: "WORK_MODAL", titleHe: "חלון עבודה", purpose: "One job: mix versions, comments (with audio), riddim targets / notes, final files, work materials.", visibleData: "Versions, notes, materials (read-only)", money: "OWN_PAYMENTS_READ_ONLY", writes: [W("Upload a mix version", "SERVER_AUTHORIZED", "first version → בתהליך; full mix copied to the project player; owner push (P_STEVEN_UPLOADS)"), W("Upload final files", "SERVER_AUTHORIZED", "owner push (P_FINAL_FILES_BATCH)"), W("Mark a comment resolved / open", "SERVER_AUTHORIZED")] },
    ],
    cannot: ["Change status, price or payment; post / delete comments; manage targets; send notes."],
    receivesPush: ["P_STEVEN_MIX_READY", "P_STEVEN_NOTES", "P_STEVEN_MIX_REMINDER", "P_STEVEN_DEADLINE_DIGEST", "P_STEVEN_PAYMENT", "P_STEVEN_COMPLETED"],
    triggersPush: ["P_STEVEN_PRESENCE", "P_STEVEN_UPLOADS", "P_FINAL_FILES_BATCH"],
    securityGapIds: ["SG_STEVEN_PAYMENT_WRONG_RECIPIENT"],
    limitationsHe: ["סטיבן מזוהה לפי שם המהנדס 'Steven' בדיוק."],
    internal: { role: "steven", allowedPaths: ["/team/steven", "/api/supplier/steven", "/api/supplier/steven/work/x/versions", "/api/notifications"], deniedPaths: ["/api/sound-engineer", "/api/sound-engineer/x/notify-notes", "/team/victor", "/dashboard", "/api/dropbox/upload"] },
  },
  {
    id: "NAGASH_PORTAL", titleHe: "נגש ביטס (פורטל ללא התחברות)", kind: "NO_LOGIN_PERSON",
    whoTheyAre: "Label artist נגש ביטס — a registered portal with no login role.",
    whyAccess: "Only the Owner previews it (home + music).",
    authMethod: "No login exists for this portal.",
    landing: null, language: "Hebrew (RTL)",
    entities: [{ entity: "label-artist נגש ביטס", quality: "DERIVED_RELATION", basis: "portal registry by exact artist name" }, { entity: "the Owner", quality: "UNKNOWN", basis: "not canonically linked in the data; the Owner can teach it" }],
    tabs: [{ id: "PREVIEW", titleHe: "בית + מוזיקה", purpose: "Owner preview of the Nagash portal (next release + music management).", visibleData: "Release, sketches; no money", money: "NONE", writes: [] }],
    cannot: ["No one logs in as Nagash; no sketch notifications (not notify-enabled)."],
    receivesPush: [], triggersPush: [], securityGapIds: [], limitationsHe: ["אין משתמש מחובר לפורטל הזה."],
    internal: { role: null, allowedPaths: [], deniedPaths: [] },
  },
  {
    id: "EXTERNAL_ENGINEERS", titleHe: "מהנדסי סאונד חיצוניים", kind: "NO_LOGIN_PERSON",
    whoTheyAre: "Other mix / master engineers (e.g. Bill or custom names) recorded on engineer jobs as free-text names.",
    whyAccess: "They have no login; the Owner manages their jobs.",
    authMethod: "None.", landing: null, language: "—",
    entities: [{ entity: "engineer name (free text)", quality: "TEXT_MATCH", basis: "no engineer record exists" }],
    tabs: [], cannot: ["Cannot log in; receive no pushes (a payment on their job wrongly pushes Steven — gap)."],
    receivesPush: [], triggersPush: [], securityGapIds: ["SG_STEVEN_PAYMENT_WRONG_RECIPIENT"], limitationsHe: ["אין רשומת מהנדס — השם הוא טקסט חופשי."],
    internal: { role: null, allowedPaths: [], deniedPaths: [] },
  },
  {
    id: "UNKNOWN_ACCOUNT", titleHe: "חשבון לא מוכר", kind: "BLOCKED",
    whoTheyAre: "Any signed-in account whose email is not one of the configured roles.",
    whyAccess: "None — blocked by the gate.",
    authMethod: "Signed in but unmapped.", landing: "/login", language: "—",
    entities: [], tabs: [], cannot: ["Every page redirects to login; every API returns 403."],
    receivesPush: [], triggersPush: [], securityGapIds: ["SG_DIRECT_REST_RLS_UNKNOWN"], limitationsHe: [],
    internal: { role: "unknown", allowedPaths: [], deniedPaths: [] },
  },
  {
    id: "CLAUDE_CONNECTOR", titleHe: "החיבור של סאני ל-Claude", kind: "MACHINE_IDENTITY",
    whoTheyAre: "The Claude connector acting for the Owner (Sunny's conversational voice).",
    whyAccess: "Read company knowledge; answer surfaced questions; learn typed Owner knowledge after confirmation.",
    authMethod: "OAuth 2.1 + PKCE bearer token that only the Owner can approve; scopes read / answer / knowledge.",
    landing: null, language: "—",
    entities: [{ entity: "the Owner", quality: "CANONICAL_RELATION", basis: "tokens exist only after Owner consent" }],
    tabs: [], cannot: ["No business mutation, no Push, no Calendar write (live calendar READ only, through the Redbloods main service — the connector holds no Google credential), no finance execution, no settings / auth."],
    receivesPush: [], triggersPush: [], securityGapIds: [], limitationsHe: [],
    internal: { role: null, allowedPaths: [], deniedPaths: [] },
  },
  {
    id: "SCHEDULED_CALLERS", titleHe: "מתזמנים חיצוניים", kind: "MACHINE_IDENTITY",
    whoTheyAre: "External schedulers calling secret-protected endpoints (push cron, agent check, calendar pull) and in-process jobs.",
    whyAccess: "Periodic reminders, calendar sync, legacy agent checks.",
    authMethod: "A shared secret in the request; in-process jobs run inside the server.",
    landing: null, language: "—",
    entities: [], tabs: [], cannot: ["No UI; only their specific endpoints."],
    receivesPush: [], triggersPush: ["P_EXTERNAL_PUSH_CRON", "P_AGENT_ALERTS", "P_SHALEV_WEEKLY", "P_SHALEV_SESSION_REMINDER", "P_SHALEV_AVAILABILITY_REMINDER", "P_STEVEN_DEADLINE_DIGEST", "P_STEVEN_MIX_REMINDER"],
    securityGapIds: ["SG_PUSH_NO_PROD_GUARD", "SG_AGENT_CHECK_INFO_LEAK"], limitationsHe: [],
    internal: { role: null, allowedPaths: [], deniedPaths: [] },
  },
  {
    id: "SHARE_LINK_RECIPIENTS", titleHe: "מקבלי קישורי שיתוף", kind: "NO_LOGIN_PERSON",
    whoTheyAre: "Anyone holding a public Dropbox share link created by an upload / delivery.",
    whyAccess: "Receive files outside the app (Dropbox links); the in-app share page requires login and is effectively unused.",
    authMethod: "None (public Dropbox link).", landing: null, language: "—",
    entities: [], tabs: [], cannot: ["Cannot use the app."],
    receivesPush: [], triggersPush: [], securityGapIds: ["SG_PUBLIC_SHARE_LINKS"], limitationsHe: [],
    internal: { role: null, allowedPaths: [], deniedPaths: [] },
  },
];

// ─────────────────────────────── PUSH ───────────────────────────────
const P = (o: Omit<PushContract, "sunnyMayTrigger">): PushContract => ({ ...o, sunnyMayTrigger: false });
export const PUSH_CONTRACTS: readonly PushContract[] = [
  // page-load beacons (artist / vendor opens their own page → owner)
  P({ id: "P_SHALEV_PRESENCE", titleHe: "שליו נכנס לאפליקציה", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Let the Owner know Shalev opened his portal.", sourceDomain: "ARTIST_PORTALS", trigger: "Shalev opens his portal (on page load)", type: "PAGE_LOAD_BEACON", timing: "on open", conditions: "only when the viewer IS Shalev (owner preview never pings)", dedupe: "once per browser tab session + 60-second server guard", messageSemantics: "Shalev entered the app, with the time", postAction: "Informational", productionOnly: true, status: "ACTIVE", knownBugs: ["every new tab after 60 s pings again"], internal: { modules: ["lib/shalev-presence-notify.ts"] } }),
  P({ id: "P_AVI_PRESENCE", titleHe: "אבי נכנס לאפליקציה", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Presence of Avi.", sourceDomain: "ARTIST_PORTALS", trigger: "Avi opens his portal", type: "PAGE_LOAD_BEACON", timing: "on open", conditions: "viewer is Avi", dedupe: "tab session + 60 s", messageSemantics: "Avi entered", postAction: "Informational", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/avi-presence-notify.ts"] } }),
  P({ id: "P_CLEANTONE_PRESENCE", titleHe: "DJ CLEANTONE נכנס", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Presence of the DJ.", sourceDomain: "LABEL_DJ", trigger: "DJ CLEANTONE opens his portal", type: "PAGE_LOAD_BEACON", timing: "on open", conditions: "viewer is the DJ", dedupe: "tab session + 60 s", messageSemantics: "DJ CLEANTONE entered", postAction: "Informational", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/cleantone-presence-notify.ts"] } }),
  P({ id: "P_VICTOR_PRESENCE", titleHe: "ויקטור נכנס לעמוד", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Presence of Victor.", sourceDomain: "VICTOR", trigger: "Victor opens his page", type: "PAGE_LOAD_BEACON", timing: "on open", conditions: "viewer is Victor", dedupe: "30-minute cooldown (atomic)", messageSemantics: "Victor entered his page", postAction: "Informational", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/victor-presence-notify.ts"] } }),
  P({ id: "P_STEVEN_PRESENCE", titleHe: "סטיבן התחבר / ביקר", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Presence of Steven (login or visit).", sourceDomain: "STEVEN", trigger: "Steven opens his page", type: "PAGE_LOAD_BEACON", timing: "on open", conditions: "viewer is Steven; 'logged in' only if the sign-in is under 3 minutes old", dedupe: "per sign-in + 30-minute visit cooldown (not atomic)", messageSemantics: "Steven logged in / visited (English)", postAction: "Informational", productionOnly: true, status: "ACTIVE", knownBugs: ["two tabs at once can both push; a failed marker write re-pushes every refresh"], internal: { modules: ["lib/steven-notify.ts"] } }),
  // events
  P({ id: "P_BEAT_ASSIGNED", titleHe: "ביט חדש מחכה לך", recipientRoles: ["shalev", "avi", "owner"], recipientEntity: "The assigned artist (+ Owner ack)", purpose: "Tell the artist a new beat is available in their portal.", sourceDomain: "BEATS", trigger: "Owner assigns a beat to an artist", type: "EVENT", timing: "immediately", conditions: "only a brand-new assignment; owner ack only after a real delivery", dedupe: "event id per beat / artist / time", messageSemantics: "A new beat is waiting for you", postAction: "Artist opens the beats tab and listens", productionOnly: true, status: "ACTIVE", knownBugs: ["two concurrent clicks could both send"], internal: { modules: ["lib/beat-notify.ts"] } }),
  P({ id: "P_BEAT_UPLOADED", titleHe: "ביט הועלה", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Self-confirmation of a beat upload.", sourceDomain: "BEATS", trigger: "Owner uploads a beat", type: "EVENT", timing: "immediately", conditions: "—", dedupe: "event id per beat", messageSemantics: "New beat uploaded", postAction: "—", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/beat-notify.ts"] } }),
  P({ id: "P_BEAT_UPDATED", titleHe: "ביט עודכן", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Self-confirmation of a beat update.", sourceDomain: "BEATS", trigger: "Owner updates a beat", type: "EVENT", timing: "immediately", conditions: "—", dedupe: "none (every update)", messageSemantics: "Beat updated", postAction: "—", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/beat-notify.ts"] } }),
  P({ id: "P_SKETCH_NEW", titleHe: "סקיצה חדשה", recipientRoles: ["shalev", "owner"], recipientEntity: "Shalev (+ Owner ack)", purpose: "A new sketch is on Shalev's music page.", sourceDomain: "ARTIST_PORTALS", trigger: "A sketch is uploaded in Shalev's portal (by Shalev or the Owner)", type: "EVENT", timing: "immediately", conditions: "owner ack only after delivery to Shalev", dedupe: "event id per sketch", messageSemantics: "New sketch", postAction: "Shalev listens in the music tab", productionOnly: true, status: "ACTIVE", knownBugs: ["fires even when Shalev uploaded it himself"], internal: { modules: ["lib/red-artists/sketches-notify.ts"] } }),
  P({ id: "P_SKETCH_UPDATED", titleHe: "סקיצה עודכנה", recipientRoles: ["shalev", "owner"], recipientEntity: "Shalev (+ Owner ack)", purpose: "A sketch has a new version.", sourceDomain: "ARTIST_PORTALS", trigger: "A new sketch version in Shalev's portal", type: "EVENT", timing: "immediately", conditions: "owner ack after delivery", dedupe: "event id per sketch + version", messageSemantics: "Sketch updated", postAction: "Shalev listens to the new version", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/red-artists/sketches-notify.ts"] } }),
  P({ id: "P_SESSION_CREATED_SHALEV", titleHe: "נקבע לך סשן", recipientRoles: ["shalev", "owner"], recipientEntity: "Shalev + Owner", purpose: "Tell Shalev a session was scheduled for him.", sourceDomain: "SESSIONS", trigger: "Owner creates a session on a project of שליו טסמה", type: "EVENT", timing: "immediately (not awaited)", conditions: "project artist includes Shalev", dedupe: "event id per session", messageSemantics: "A new session was scheduled for you (day, time)", postAction: "Shalev sees it in his schedule", productionOnly: true, status: "ACTIVE", knownBugs: ["a session under 3 h away also fires the reminder immediately"], internal: { modules: ["lib/session-notify.ts"] } }),
  P({ id: "P_AVAILABILITY_SAVED", titleHe: "זמינות נשלחה", recipientRoles: ["shalev", "owner"], recipientEntity: "Shalev + Owner", purpose: "Confirm availability was sent (Shalev) / received (Owner).", sourceDomain: "ARTIST_PORTALS", trigger: "Shalev (or the Owner on Shalev's portal route) saves weekly availability", type: "EVENT", timing: "immediately", conditions: "only via Shalev's portal route (the Owner's label-page save sends nothing)", dedupe: "none — every re-save pushes both", messageSemantics: "Your availability was sent / Shalev sent availability", postAction: "Owner books sessions from the availability", productionOnly: true, status: "ACTIVE", knownBugs: ["no dedupe"], internal: { modules: ["lib/red-artists/availability.ts"] } }),
  P({ id: "P_DJ_CONFIRMED", titleHe: "הדי-ג׳יי אישר הופעה", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "The DJ confirmed a booking.", sourceDomain: "SHOWS", trigger: "DJ CLEANTONE presses 'אשר הופעה'", type: "EVENT", timing: "immediately", conditions: "only a real pending → confirmed change", dedupe: "event id per show + confirmation time", messageSemantics: "DJ CLEANTONE confirmed a show (details)", postAction: "Owner knows the DJ is locked in", productionOnly: true, status: "ACTIVE", knownBugs: ["the Owner confirming from the DJ preview triggers it as if the DJ confirmed"], internal: { modules: ["lib/dj-confirm-notify.ts"] } }),
  P({ id: "P_STEVEN_UPLOADS", titleHe: "סטיבן העלה קבצים", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "New mix versions from Steven.", sourceDomain: "STEVEN", trigger: "A mix version is uploaded on a Steven job (by Steven or the Owner)", type: "EVENT", timing: "coalesced ~75 s, flushed by the every-minute job", conditions: "—", dedupe: "coalescing window only (no claim)", messageSemantics: "Steven uploaded file(s)", postAction: "Owner listens and sends notes", productionOnly: true, status: "ACTIVE", knownBugs: ["overlapping ticks can double-send"], internal: { modules: ["lib/steven-notify.ts"] } }),
  P({ id: "P_VICTOR_UPLOADS", titleHe: "ויקטור העלה קבצים", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Victor delivered files.", sourceDomain: "VICTOR", trigger: "Victor uploads files", type: "EVENT", timing: "single file immediately, otherwise coalesced 60 s", conditions: "uploader is Victor", dedupe: "coalescing window only", messageSemantics: "Victor uploaded N files", postAction: "Owner reviews and sends notes", productionOnly: true, status: "ACTIVE", knownBugs: ["send-then-delete race"], internal: { modules: ["lib/victor-upload-notify.ts"] } }),
  P({ id: "P_FINAL_FILES_BATCH", titleHe: "סטיבן העלה קבצים סופיים", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Steven finished uploading final files.", sourceDomain: "MIX_PIPELINE", trigger: "Steven's final-files batch completes (or goes stale after 3 minutes)", type: "EVENT", timing: "on completion / stale flush", conditions: "at least one file succeeded", dedupe: "atomic claim", messageSemantics: "Steven uploaded N final files", postAction: "Owner delivers to the client", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/final-files-batch-notify.ts"] } }),
  P({ id: "P_STEVEN_PAYMENT", titleHe: "תשלום נשלח לסטיבן", recipientRoles: ["owner", "steven"], recipientEntity: "Owner + Steven", purpose: "Tell Steven he was paid for a job.", sourceDomain: "STEVEN", trigger: "Owner marks an engineer job paid", type: "EVENT", timing: "immediately", conditions: "real unpaid → paid change", dedupe: "per payment date (not atomic)", messageSemantics: "Payment sent: <job> · <price> paid. Thank you (English)", postAction: "Steven sees it in payment history", productionOnly: true, status: "ACTIVE", knownBugs: ["NO engineer check — a payment on another engineer's job pushes Steven too (privacy)"], internal: { modules: ["lib/steven-payment-notify.ts"] } }),
  P({ id: "P_STEVEN_COMPLETED", titleHe: "הפרויקט הושלם — העלה קבצים סופיים", recipientRoles: ["steven", "owner"], recipientEntity: "Steven + Owner", purpose: "Ask Steven for final files when his last open job on a project is approved.", sourceDomain: "MIX_PIPELINE", trigger: "Owner approves Steven's last open job on a project", type: "EVENT", timing: "immediately", conditions: "last open Steven job on the project; project auto-completes", dedupe: "atomic claim per completion cycle", messageSemantics: "Project completed, please upload the final files", postAction: "Steven uploads final files", productionOnly: true, status: "ACTIVE", knownBugs: ["the claim is written even when push is disabled (a dev run could suppress production)"], internal: { modules: ["lib/steven-completion.ts"] } }),
  P({ id: "P_VICTOR_COMPLETED", titleHe: "ויקטור — העבודה הושלמה", recipientRoles: ["victor", "owner"], recipientEntity: "Victor (+ Owner ack)", purpose: "Thank Victor when a work is completed.", sourceDomain: "VICTOR", trigger: "Owner marks a Victor work הושלם", type: "EVENT", timing: "immediately", conditions: "real change to completed", dedupe: "per completion (not atomic)", messageSemantics: "Project completed. Great work (English)", postAction: "—", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/victor-completed-notify.ts"] } }),
  // manual owner buttons
  P({ id: "P_CYCLE_REMIND", titleHe: "תזכורת מחזור מאזן", recipientRoles: ["owner", "shalev", "avi", "cleantone"], recipientEntity: "Owner and / or the artist", purpose: "Remind that the artist's 2-month balance cycle is closing.", sourceDomain: "ARTIST_BALANCES", trigger: "Owner presses the cycle reminder", type: "MANUAL", timing: "on click", conditions: "—", dedupe: "none", messageSemantics: "Your financial cycle with Redbloods closes in …", postAction: "Artist checks the balance", productionOnly: false, status: "ACTIVE", knownBugs: ["the artist link always points to Shalev's balance page (wrong for Avi / DJ)", "no production-only guard"], internal: { modules: ["app/api/label/artists/[id]/balance/cycles/remind/route.ts"] } }),
  P({ id: "P_SKETCH_NOTIFY_MANUAL", titleHe: "שלח התראה על סקיצה", recipientRoles: ["shalev", "avi", "owner"], recipientEntity: "The artist + Owner", purpose: "Tell an artist about a new / updated sketch.", sourceDomain: "ARTIST_PORTALS", trigger: "Owner presses 'שלח התראה' on a sketch (or links a project file to the portal)", type: "MANUAL", timing: "on click", conditions: "notify-enabled artists only (Shalev, Avi)", dedupe: "event id per sketch + version", messageSemantics: "New sketch / sketch updated", postAction: "Artist listens", productionOnly: false, status: "ACTIVE", knownBugs: ["no production-only guard"], internal: { modules: ["app/api/label/artists/[id]/sketches/[sketchId]/notify/route.ts"] } }),
  P({ id: "P_SHOW_TO_ARTIST", titleHe: "הופעה חדשה נכנסה", recipientRoles: ["shalev", "owner"], recipientEntity: "Shalev (+ Owner ack)", purpose: "Tell Shalev about a booked show.", sourceDomain: "SHOWS", trigger: "Owner presses 'שלח' on an upcoming confirmed show", type: "MANUAL", timing: "on click", conditions: "Shalev show, upcoming, confirmed", dedupe: "atomic claim on a fingerprint of name / date / time / location (money-only edits don't re-send)", messageSemantics: "A new show came in (details)", postAction: "Shalev sees it focused in his shows tab", productionOnly: true, status: "ACTIVE", knownBugs: ["the claim is taken before the production check"], internal: { modules: ["lib/show-notify.ts"] } }),
  P({ id: "P_SHOW_TO_DJ", titleHe: "הופעה לדי-ג׳יי", recipientRoles: ["cleantone", "owner"], recipientEntity: "DJ CLEANTONE (+ Owner ack)", purpose: "Tell the DJ about a show he is booked on.", sourceDomain: "SHOWS", trigger: "Owner presses 'שלח' in the DJ preview", type: "MANUAL", timing: "on click", conditions: "the show's DJ is DJ CLEANTONE", dedupe: "atomic fingerprint claim", messageSemantics: "New show (details)", postAction: "The DJ confirms in his portal → P_DJ_CONFIRMED", productionOnly: true, status: "ACTIVE", knownBugs: ["claim before the production check"], internal: { modules: ["lib/dj-show-notify.ts"] } }),
  P({ id: "P_STEVEN_MIX_READY", titleHe: "עבודת מיקס חדשה", recipientRoles: ["owner", "steven"], recipientEntity: "Owner + Steven", purpose: "Hand Steven a new mix job (files + notes ready).", sourceDomain: "STEVEN", trigger: "Owner presses 'Send to Steven'", type: "MANUAL", timing: "on click", conditions: "—", dedupe: "once per job unless resent", messageSemantics: "New mix job: files and notes are ready (English)", postAction: "Steven starts mixing and uploads a version", productionOnly: true, status: "ACTIVE", knownBugs: ["no engineer check on the route"], internal: { modules: ["lib/steven-mix-ready-notify.ts"] } }),
  P({ id: "P_STEVEN_NOTES", titleHe: "הערות מיקס חדשות", recipientRoles: ["owner", "steven"], recipientEntity: "Owner + Steven", purpose: "Send Steven mix notes; starts the 5-hour reminder cycle.", sourceDomain: "STEVEN", trigger: "Owner presses 'Send notes'", type: "MANUAL", timing: "on click", conditions: "—", dedupe: "none (repeatable)", messageSemantics: "New mix notes (English)", postAction: "Steven uploads a revised version (stops P_STEVEN_MIX_REMINDER)", productionOnly: true, status: "ACTIVE", knownBugs: ["no engineer check on the route"], internal: { modules: ["lib/steven-notes-notify.ts"] } }),
  P({ id: "P_VICTOR_NEW_WORK", titleHe: "עבודה חדשה לויקטור", recipientRoles: ["victor", "owner"], recipientEntity: "Victor (+ Owner ack)", purpose: "Tell Victor a new work is waiting.", sourceDomain: "VICTOR", trigger: "Owner presses notify-work", type: "MANUAL", timing: "on click", conditions: "work has a title", dedupe: "none (repeatable)", messageSemantics: "New work from Redbloods", postAction: "Victor opens the work and starts", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/victor-work-notify.ts"] } }),
  P({ id: "P_VICTOR_VERSION_NOTES", titleHe: "הערות לגרסה של ויקטור", recipientRoles: ["victor", "owner"], recipientEntity: "Victor (+ Owner ack)", purpose: "Send Victor feedback on a version.", sourceDomain: "VICTOR", trigger: "Owner sends version notes", type: "MANUAL", timing: "on click", conditions: "Victor has a device; notes become visible to him only after this", dedupe: "none", messageSemantics: "New notes – feedback on version N", postAction: "Victor revises and uploads", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/victor-version-notes-notify.ts"] } }),
  // scheduled
  P({ id: "P_SHALEV_WEEKLY", titleHe: "סיכום שבועי לשליו", recipientRoles: ["shalev", "owner"], recipientEntity: "Shalev (+ Owner ack / failure)", purpose: "Shalev's sessions for the week.", sourceDomain: "SESSIONS", trigger: "In-process schedule", type: "SCHEDULED", timing: "Sunday 10:00–10:15 Israel time", conditions: "only if he has sessions that week", dedupe: "atomic claim per week, up to 3 attempts", messageSemantics: "Good week Shalev + the week's sessions", postAction: "Shalev plans his week", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/shalev-weekly-notify.ts"] } }),
  P({ id: "P_SHALEV_SESSION_REMINDER", titleHe: "תזכורת סשן לשליו", recipientRoles: ["shalev", "owner"], recipientEntity: "Shalev (+ Owner ack)", purpose: "Remind Shalev before a session.", sourceDomain: "SESSIONS", trigger: "In-process schedule (every minute)", type: "SCHEDULED", timing: "from 3 hours before each session", conditions: "planned session of Shalev today / tomorrow", dedupe: "atomic claim per session / date / time", messageSemantics: "Session reminder: today at HH:MM", postAction: "Shalev arrives on time", productionOnly: true, status: "ACTIVE", knownBugs: ["says 'today' for after-midnight sessions"], internal: { modules: ["lib/shalev-session-reminder-notify.ts"] } }),
  P({ id: "P_SHALEV_AVAILABILITY_REMINDER", titleHe: "תזכורת לשלוח זמינות", recipientRoles: ["shalev"], recipientEntity: "Shalev", purpose: "Get next week's availability in time.", sourceDomain: "ARTIST_PORTALS", trigger: "In-process schedule", type: "SCHEDULED", timing: "Thursday 12:00, Thursday 18:00, Friday 09:00 Israel time (escalating)", conditions: "skipped once a valid submission (≥2 days) exists", dedupe: "atomic claim per week + slot", messageSemantics: "Time to send availability / still not sent / last reminder", postAction: "Shalev sends availability → P_AVAILABILITY_SAVED", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/shalev-availability-reminder-notify.ts"] } }),
  P({ id: "P_STEVEN_DEADLINE_DIGEST", titleHe: "תקציר דדליינים לסטיבן", recipientRoles: ["steven", "owner"], recipientEntity: "Steven (+ Owner ack)", purpose: "Daily list of Steven's overdue / today / tomorrow jobs.", sourceDomain: "STEVEN", trigger: "In-process schedule", type: "SCHEDULED", timing: "09:00 New York time daily", conditions: "only if something is due", dedupe: "atomic claim per New York date", messageSemantics: "English digest of overdue / today / tomorrow", postAction: "Steven prioritizes", productionOnly: true, status: "ACTIVE", knownBugs: [], internal: { modules: ["lib/steven-deadline-digest-notify.ts"] } }),
  P({ id: "P_STEVEN_MIX_REMINDER", titleHe: "תזכורת הערות מיקס", recipientRoles: ["steven"], recipientEntity: "Steven", purpose: "Nudge Steven to upload a revision after notes.", sourceDomain: "STEVEN", trigger: "In-process schedule (every minute) after P_STEVEN_NOTES", type: "SCHEDULED", timing: "every 5 hours, at most 3 times", conditions: "stops on a newer version, approval, cancellation or deletion", dedupe: "per-reminder claim", messageSemantics: "Mix notes reminder: upload an updated version", postAction: "Steven uploads", productionOnly: true, status: "ACTIVE", knownBugs: ["no quiet hours (can fire at night in New York)"], internal: { modules: ["lib/steven-mix-reminder-notify.ts"] } }),
  P({ id: "P_EXTERNAL_PUSH_CRON", titleHe: "פוש תזמון חיצוני לבעלים", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Owner digest: overdue / due-soon projects, today's sessions, overdue expected income, stuck Victor work, morning / evening summary.", sourceDomain: "PUSH_NOTIFICATIONS", trigger: "External scheduler calls a secret endpoint", type: "SCHEDULED", timing: "set outside the repo (unknown cadence)", conditions: "secret only", dedupe: "none", messageSemantics: "Deadlines, sessions, payments, Victor, summaries", postAction: "Owner acts in the dashboard", productionOnly: false, status: "ACTIVE", knownBugs: ["no dedupe", "fixed UTC+3 hour (wrong in winter)", "no production-only guard", "whether the external scheduler still exists cannot be verified from the repo"], internal: { modules: ["app/api/push/cron/route.ts"] } }),
  P({ id: "P_AGENT_ALERTS", titleHe: "התראות Agent", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Legacy agent: push important / urgent alerts.", sourceDomain: "AGENT_ALERTS", trigger: "External scheduler every 3 hours", type: "AGENT_CHECK", timing: "every 3 h", conditions: "important / urgent only; per-type cooldown", dedupe: "cooldown 6–48 h", messageSemantics: "Grouped alerts", postAction: "—", productionOnly: false, status: "DISABLED", knownBugs: ["disabled by the AI flag; fixed UTC+3 hour"], internal: { modules: ["lib/agent/notifications.ts"] } }),
  P({ id: "P_PUSH_CHECK_LEGACY", titleHe: "בדיקת פוש ישנה", recipientRoles: ["owner"], recipientEntity: "Owner", purpose: "Legacy 'check on app load' push — no longer called by any page.", sourceDomain: "PUSH_NOTIFICATIONS", trigger: "Only a manual call by the Owner (no page calls it)", type: "PAGE_LOAD_BEACON", timing: "30-minute throttle", conditions: "Owner only", dedupe: "throttle", messageSemantics: "Owner reminders", postAction: "—", productionOnly: false, status: "LEGACY", knownBugs: ["still reachable manually; no production-only guard"], internal: { modules: ["app/api/push/check/route.ts"] } }),
];

/** Modules that import the push primitive but never send (intentional exclusions). */
export const PUSH_MODULE_EXCLUSIONS: ReadonlyArray<{ module: string; reason: string }> = [
  { module: "lib/push.ts", reason: "the primitive itself (device delivery + owner bell rows)" },
];

// ─────────────────────────────── SECURITY GAPS / MISMATCHES (report only) ───────────────────────────────
const G = (id: string, severity: SecurityGap["severity"], kind: SecurityGap["kind"], users: string[], description: string): SecurityGap => ({ id, severity, kind, users, description, status: "REPORTED_NOT_FIXED" });
export const SECURITY_GAPS: readonly SecurityGap[] = [
  G("SG_VICTOR_DROPBOX_PATHS", "HIGH", "SECURITY_GAP", ["VICTOR"], "Victor can write file entries and his work folder with any Dropbox path; the server then streams / deletes / uploads by those paths — effectively arbitrary Dropbox read, delete and write. The restriction is UI-only."),
  G("SG_VENDOR_FOLDER_PUBLIC_LINK", "MEDIUM", "SECURITY_GAP", ["VICTOR"], "The vendor-folder endpoint builds folders from client-sent artist / project names and returns a public share link, contradicting 'Victor never receives folder links'."),
  G("SG_OAUTH_CALLBACK_STATE", "MEDIUM", "SECURITY_GAP", ["OWNER"], "The Dropbox and Google Calendar OAuth callbacks are public and have no state check — the company connection could be swapped."),
  G("SG_CALENDAR_WEEK_ROUTE_PROXY_ONLY", "LOW", "UI_SERVER_MISMATCH", ["OWNER"], "The Calendar page's week read relies only on the central gate for Owner protection — the route itself has no Owner check (Sunny's internal calendar read has its own service authentication)."),
  G("SG_VICTOR_DELETES_OWNER_FILES", "MEDIUM", "SECURITY_GAP", ["VICTOR"], "Victor's file-delete route removes any file entry of any Victor work — including files the Owner uploaded — with no uploader check."),
  G("SG_VICTOR_UPLOAD_RESPONSE_LEAK", "MEDIUM", "PRIVACY", ["VICTOR"], "Victor's upload responses return the unsanitized file entry: the storage path (revealing the project tree) and, for single uploads, a public share link."),
  G("SG_STORAGE_ROUTES_PROXY_ONLY", "MEDIUM", "UI_SERVER_MISMATCH", ["OWNER", "VICTOR", "STEVEN"], "Several storage routes (stream, delete, upload, share-link, intake, status) have no in-route role check and rely on the central proxy alone."),
  G("SG_VICTOR_WORK_LOOKUP_BY_PROJECT", "LOW", "PRIVACY", ["VICTOR"], "Victor can look up the (sanitized) work of any project id he knows; chunked upload sessions start with no work check."),
  G("SG_VICTOR_SALARY_IN_PAYLOAD", "MEDIUM", "PRIVACY", ["VICTOR"], "Victor's page data includes his salary / currency / payment status; only the UI hides it."),
  G("SG_OWNER_CAN_CONFIRM_AS_DJ", "MEDIUM", "UI_SERVER_MISMATCH", ["OWNER", "CLEANTONE"], "The Owner previewing the DJ portal can really confirm / withdraw a booking, and the Owner receives 'DJ CLEANTONE confirmed' as if the DJ did."),
  G("SG_STEVEN_PAYMENT_WRONG_RECIPIENT", "MEDIUM", "PRIVACY", ["STEVEN", "EXTERNAL_ENGINEERS"], "Marking ANY engineer's job paid pushes 'Payment sent' to Steven."),
  G("SG_PUSH_NO_PROD_GUARD", "MEDIUM", "SECURITY_GAP", ["OWNER", "SCHEDULED_CALLERS"], "Five senders (cycle reminder, manual sketch notify, external push cron, legacy push check, agent alerts) have no production-only guard — a local run could send real pushes."),
  G("SG_PROXY_ONLY_OWNER_ROUTES", "LOW", "SECURITY_GAP", ["OWNER"], "About half of the Owner mutation routes rely on the central gate only (no in-route check) — no second layer."),
  G("SG_PROXY_STATIC_EXT_MATCHER", "LOW", "SECURITY_GAP", ["UNKNOWN_ACCOUNT"], "The gate skips paths ending in static-file extensions; an API path ending that way would bypass it (not exploitable today)."),
  G("SG_VICTOR_GET_NO_VENDOR_CHECK", "LOW", "SECURITY_GAP", ["VICTOR"], "Reading one Victor work does not re-check the vendor (harmless while only Victor rows exist)."),
  G("SG_AGENT_CHECK_INFO_LEAK", "LOW", "SECURITY_GAP", ["SCHEDULED_CALLERS"], "With the AI flag off, the agent check answers callers without the secret with small holiday counts."),
  G("SG_DIRECT_REST_RLS_UNKNOWN", "UNKNOWN", "SECURITY_GAP", ["SHALEV", "AVI", "CLEANTONE", "UNKNOWN_ACCOUNT"], "Signed-in users could call the database REST API directly with their own session; protection there depends on table RLS policies, which are not in the repository (only the notification bell is known to be RLS-scoped)."),
  G("SG_SHALEV_BALANCE_EXPOSURE", "LOW", "UI_SERVER_MISMATCH", ["SHALEV"], "Code comments say the artist never receives financial figures, yet Shalev's balance tab shows his full ledger (read-only)."),
  G("SG_UI_AVI_CONTROLS_403", "LOW", "UI_SERVER_MISMATCH", ["AVI"], "Avi's portal shows a next-work picker and an editable avatar; saving returns 403 (server is correct, UI misleading)."),
  G("SG_CYCLE_REMIND_WRONG_LINK", "LOW", "UI_SERVER_MISMATCH", ["AVI", "CLEANTONE"], "The cycle reminder push opens Shalev's balance page, which Avi / the DJ cannot open."),
  G("SG_DJ_PAYMENT_PILL", "LOW", "UI_SERVER_MISMATCH", ["CLEANTONE"], "The DJ's payment pill reflects the client's payment, not the DJ's."),
  G("SG_DJ_UNCONFIRM_SILENT", "LOW", "UI_SERVER_MISMATCH", ["CLEANTONE"], "The DJ can withdraw a confirmation with no notification to the Owner."),
  G("SG_PUBLIC_SHARE_LINKS", "MEDIUM", "PRIVACY", ["SHARE_LINK_RECIPIENTS"], "Uploads, deliveries, receipts and documents create PUBLIC Dropbox links; the in-app share page is login-gated and unused."),
  G("SG_OWNER_PAGE_LOAD_WRITES", "LOW", "UI_SERVER_MISMATCH", ["OWNER"], "Opening pages as the Owner writes data: past planned sessions become held (device clock), the push subscription is re-saved, /tasks syncs Google Tasks, and a project drawer marks sessions / backfills the start date."),
];

/**
 * ACCESS REVIEW fingerprints (tests only, never served). SHA-256 (LF-normalized) of every file that decides who can
 * reach what, plus the push primitive. When any of them changes, scripts/test-sunny-people.tsx fails until the people /
 * access / push contracts above were reviewed for SUNNY IMPACT and these hashes updated in the same change.
 */
export const ACCESS_REVIEWED_FINGERPRINTS: Readonly<Record<string, string>> = {
  "lib/roles.ts": "23d4f79f97de0f10b81192c9afd6cb9e398a8cc891d245efc4ffe6614e8a1bd4",
  "proxy.ts": "3ea7871698926436fa12047c1660f12dbd298622c83f98318ca99f71bcf0af65",
  "lib/require-auth.ts": "5d28fa016ffe37c1b6c6847ac1ae2aa0f118977bba4c35e658f400a4ad3e5f8a",
  "lib/red-artists/portal-access.ts": "4d5454199c8f846043b3cc0097ec13ba867df5494961e5e7a3b517d35ae14b87",
  "lib/beat-scope.ts": "a14f3dddcae310f4ddf41f71f1b3c05d627095cf3b7b279616a6383580a64163",
  "lib/steven-scope.ts": "3e7125366f5f85e926bf0628bf17a1ebeaf63554171b834d0ead8161b1ccad69",
  "lib/push.ts": "8ca08c674d6e3a1849cf7d6796a3593c0b8bb7bcbfcf3bef150ab3b309c5fd56",
};
