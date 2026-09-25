/**
 * Sunny System Awareness — FULL-BRAIN COMPLETION: Files / Dropbox, Reports (+ every background job and attention engine),
 * Sunny core and the Sunny connector. System knowledge (how Redbloods works); live facts are read by the storage /
 * reports / sunny_self capabilities. No secret value, token, share link or storage path is ever served — `internal`
 * fields hold implementation pointers for the tests only.
 */

// ═══════════════════════════════ FILES / DROPBOX ═══════════════════════════════
export interface StorageNamespace { id: string; meaningHe: string; holds: string; uploadedBy: string; dbRecord: "PER_FILE_ROW" | "JSON_ON_RECORD" | "FOLDER_ONLY" | "NONE_DROPBOX_ONLY"; recordedIn: string; sunnyReads: string; publicLinks: boolean; internal: { builder: string } }
export const STORAGE_BACKENDS = { dropbox: "the ONLY file store (app-folder-relative paths; OAuth credential in settings, never read by Sunny)", databaseFileBuckets: "not used (no buckets)", other: "none" } as const;
export const STORAGE_NAMESPACES: readonly StorageNamespace[] = [
  { id: "PROJECT_FILES", meaningHe: "קבצי פרויקט (העלאות ידניות, סקיצות, סטמים, מיקסים שהועתקו)", holds: "audio / documents per project", uploadedBy: "Owner (+ server copies of mix versions)", dbRecord: "JSON_ON_RECORD", recordedIn: "the project's file list (name, category, version label, track id, duration, size, uploaded at, share link)", sunnyReads: "project_view / storage_view (metadata)", publicLinks: true, internal: { builder: "lib/project-paths.ts" } },
  { id: "PROJECT_INSTRUCTIONS", meaningHe: "חומרי עבודה שנשלחו למהנדס", holds: "work materials", uploadedBy: "Owner", dbRecord: "JSON_ON_RECORD", recordedIn: "the project's file list", sunnyReads: "project_view / mix_view", publicLinks: true, internal: { builder: "lib/project-paths.ts" } },
  { id: "MIX_VERSIONS", meaningHe: "גרסאות מיקס + קבצים מצורפים להערות", holds: "mix versions, comment attachments", uploadedBy: "Owner / Steven", dbRecord: "PER_FILE_ROW", recordedIn: "mix versions + comment attachments", sunnyReads: "mix_view / storage_view", publicLinks: false, internal: { builder: "lib/project-paths.ts" } },
  { id: "FINAL_FILES", meaningHe: "קבצים סופיים של עבודת מיקס", holds: "final mix files", uploadedBy: "Steven / Owner", dbRecord: "PER_FILE_ROW", recordedIn: "final files", sunnyReads: "mix_view / delivery_view / storage_view", publicLinks: false, internal: { builder: "lib/final-file-upload.ts" } },
  { id: "DELIVERY", meaningHe: "תיקיית מסירה ללקוח", holds: "files for the client", uploadedBy: "Owner (+ intake moves)", dbRecord: "FOLDER_ONLY", recordedIn: "the project's delivery record (folder + public link + status) — no per-file rows", sunnyReads: "delivery_view (status only; contents not listed)", publicLinks: true, internal: { builder: "app/api/delivery/route.ts" } },
  { id: "VICTOR_WORK", meaningHe: "תיקיות עבודה של ויקטור (בריף / מאיתנו / ממנו / מאושר / הפקה)", holds: "production files", uploadedBy: "Owner / Victor (only Production + From Victor)", dbRecord: "JSON_ON_RECORD", recordedIn: "the Victor work's sent / received / brief file lists", sunnyReads: "victor_view / storage_view", publicLinks: true, internal: { builder: "lib/vendor-folder.ts" } },
  { id: "ARTIST_PORTAL", meaningHe: "תיקיית פורטל אמן: 'המוזיקה שלי' (manifest), קבצי הופעה, פרס קיט, תמונת פרופיל", holds: "sketch versions + beats + manifest (versions, order, next release / work, ratings), performance audio, press kit, avatar + crop", uploadedBy: "the artist / Owner", dbRecord: "NONE_DROPBOX_ONLY", recordedIn: "nothing in the database — the manifest file in storage is the source of truth", sunnyReads: "NOT READ (CAPABILITY_GAP)", publicLinks: true, internal: { builder: "lib/red-artists/portal-files.ts" } },
  { id: "BEATS", meaningHe: "ספריית ביטים", holds: "beat audio", uploadedBy: "Owner", dbRecord: "PER_FILE_ROW", recordedIn: "beats + beat assignments", sunnyReads: "artist_view / beats", publicLinks: false, internal: { builder: "lib/beat-upload.ts" } },
  { id: "RED_FILMS", meaningHe: "תיקיית הפקת Red Films: מסמכים, רפרנסים (+ תמונות ממוזערות), קבלות", holds: "documents, reference images, receipts", uploadedBy: "Owner", dbRecord: "PER_FILE_ROW", recordedIn: "Red Films documents / reference images / budget payment receipts", sunnyReads: "video_view / storage_view", publicLinks: true, internal: { builder: "app/api/red-films/productions/[id]/dropbox-folder/route.ts" } },
  { id: "SOCIAL", meaningHe: "קבצי סושיאל לפי קמפיין", holds: "social media files", uploadedBy: "Owner", dbRecord: "PER_FILE_ROW", recordedIn: "social content files", sunnyReads: "social_view / storage_view", publicLinks: true, internal: { builder: "app/api/social/upload/route.ts" } },
  { id: "PROJECT_COVERS", meaningHe: "תמונות כריכה של פרויקטים", holds: "cover images", uploadedBy: "Owner", dbRecord: "JSON_ON_RECORD", recordedIn: "the project cover setting (theme / custom image flag)", sunnyReads: "project_view (cover setting)", publicLinks: false, internal: { builder: "lib/project-cover.ts" } },
  { id: "TEAM_AVATARS", meaningHe: "תמונת פרופיל של ויקטור", holds: "avatar", uploadedBy: "Victor", dbRecord: "JSON_ON_RECORD", recordedIn: "the Victor avatar setting (display only)", sunnyReads: "NOT READ (display detail)", publicLinks: false, internal: { builder: "lib/victor-avatar.ts" } },
];
export const STORAGE_OPERATIONS = [
  { op: "UPLOAD", where: "project / delivery / Victor / Steven versions + final files / portal / beats / Red Films / social", guard: "Owner in-route, or role-scoped (Victor / Steven / portal artists) with server path scoping" },
  { op: "LIST", where: "delivery folder (live), portal performance files, portal manifest, intake scan, top-level status", guard: "Owner / portal scope" },
  { op: "STREAM_PREVIEW_DOWNLOAD", where: "generic stream (Owner, any path), Victor by file reference, Steven by version, portal by artist folder, beats by assignment, Red Films previews", guard: "role-scoped" },
  { op: "SHARE_LINK", where: "every project upload, delivery, Victor uploads / brief / folder, Red Films folder / documents / references / receipts, social files, press kit (returned only)", guard: "Owner — all links are PUBLIC" },
  { op: "DELETE / MOVE", where: "project files, delivery folder, Victor files (his own uploads only), social items / files, Red Films docs / refs, intake, album track files", guard: "Owner / Victor own-upload rule" },
] as const;
export const STORAGE_READ_DECISION = {
  canSunnyListStorageSafelyToday: false,
  why: "Sunny's connector never holds storage credentials. A live listing would need the MAIN service to expose a secret-protected, read-only listing endpoint (the same pattern as the live calendar read) — a new integration surface that needs Owner approval, like the calendar read did.",
  safeDesign: "MAIN-only list_folder (files/list_folder + /continue, no writes) → internal endpoint behind the dedicated service secret → connector; bounded to known namespaces; returns names / sizes / modified dates / counts — never paths, links or tokens.",
  whatSunnyKnowsWithoutIt: "every file that has a database record (project file lists, mix versions, attachments, final files, Victor file lists, beats, Red Films documents / references / receipts, social files, covers) — name, type, size, uploader, date, owning entity.",
  blindWithoutIt: ["artist portal 'המוזיקה שלי' manifest (versions, ratings, next release / work)", "portal performance files, press kit, profile image", "delivery folder contents", "files added to storage outside the app"],
} as const;

// ═══════════════════════════════ REPORTS + BACKGROUND JOBS + ATTENTION ENGINES ═══════════════════════════════
export const REPORTS_MODEL = {
  meaningHe: "דוחות מייל לבעלים: בוקר וערב (אוטומטיים, בשעות שמוגדרות), שבועי (רק ידני / דרך נתיב סוכן כבוי). נשלחים ב-Resend לנמען אחד; ההמלצות הן כללים סטטיים כי ה-AI כבוי.",
  types: [
    { id: "MORNING", schedule: "daily at the configured time (Israel), in-process scheduler", sentAutomatically: true },
    { id: "EVENING", schedule: "daily at the configured time (Israel), in-process scheduler", sentAutomatically: true },
    { id: "WEEKLY", schedule: "only by a manual send, or by the old agent check route which is switched off", sentAutomatically: false },
  ],
  configuration: "a settings value with the morning / evening times (defaults 07:00 / 19:00), cached in memory; the setup page edits it",
  recipients: "one address from server configuration (not stored in the database)",
  history: "NOT_RECORDED — only an in-memory 'last sent' time; no record of what was sent",
  dedupe: "in memory only — a restart in the same minute can send twice",
  aiRecommendations: "deterministic rule-based recommendations only (the model-call path was removed with the retired in-app assistant on 2026-09-25)",
  moneySemantics: [
    { report: "daily 'added today'", rule: "transactions CREATED today (created_at), received = שולם/התקבל, expense paid = שולם only, per currency", vsFinanceBrain: "CONFLICT — the Finance Brain uses the transaction DATE, not the creation date" },
    { report: "daily 'expected today'", rule: "transactions DATED today", vsFinanceBrain: "consistent in date semantics" },
    { report: "weekly revenue / expenses", rule: "created_at within a Sunday–Saturday week, ₪ ONLY, English type names only", vsFinanceBrain: "CONFLICT — creation date + other currencies dropped" },
    { report: "weekly pending", rule: "all-time open income, ₪ only", vsFinanceBrain: "partial (other currencies dropped)" },
  ],
  dateSemantics: "the daily / weekly reports compute 'today' as a UTC date — between 00:00 and 03:00 Israel time they use the previous day",
  vsSunnyMorningBrief: "Sunny's brief is on request only, Israel dates, Finance Brain money (transaction date, every currency apart); the email is scheduled, creation-date money. They can show different numbers for the same day — never reconciled silently.",
  internal: { files: ["lib/reports/data.ts", "lib/reports/weekly.ts", "lib/reports/ai.ts", "lib/reports/email.ts", "lib/reports/runtime-config.ts", "lib/reports/monday-config.ts", "instrumentation.ts"], routes: ["app/api/reports/morning/route.ts", "app/api/reports/evening/route.ts", "app/api/reports/weekly/route.ts", "app/api/reports/config/route.ts", "app/api/reports/status/route.ts", "app/api/reports/debug/route.ts"] },
  anomalies: ["the status route and setup page still describe SMTP although sending uses Resend", "the old agent check route triggers reports by an unauthenticated server fetch that the gate would refuse", "no report history is kept"],
} as const;

export type EngineClass = "ACTIVE_OPERATIONAL" | "LEGACY" | "OBSERVATION_SOURCE" | "USER_VISIBLE" | "BACKGROUND" | "DISABLED";
export const BACKGROUND_JOBS: ReadonlyArray<{ id: string; trigger: string; does: string; writes: string; classes: EngineClass[] }> = [
  { id: "REPORT_EMAILS", trigger: "in-process every minute (morning / evening time match)", does: "sends the morning / evening email", writes: "email only", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND"] },
  { id: "UPLOAD_NOTICE_BATCHES", trigger: "in-process every minute", does: "flushes batched Victor / Steven upload and final-files pushes to the Owner", writes: "push + batch markers", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND"] },
  { id: "SHALEV_WEEKLY_SUMMARY", trigger: "Sunday 10:00–10:15", does: "pushes Shalev his week's sessions", writes: "push + claim marker", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND"] },
  { id: "SHALEV_SESSION_REMINDER", trigger: "every minute (~3h before a session)", does: "pushes Shalev a session reminder", writes: "push + marker", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND"] },
  { id: "AVAILABILITY_REMINDER", trigger: "Thu 12:00 / Thu 18:00 / Fri 09:00", does: "asks the artist for weekly availability", writes: "push + marker", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND"] },
  { id: "WEEK_STRENGTH", trigger: "Friday 10:00–10:15 (+ resolve every tick)", does: "raises / resolves the 'week understaffed' agent alert", writes: "agent alert", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND", "OBSERVATION_SOURCE"] },
  { id: "STEVEN_MIX_REMINDER", trigger: "every 5h after notes", does: "reminds Steven about pending mix notes", writes: "push + state", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND"] },
  { id: "STEVEN_DEADLINE_DIGEST", trigger: "09:00–09:15 New York time", does: "daily deadline digest to Steven", writes: "push + marker", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND"] },
  { id: "OWNER_BELL_RESET", trigger: "Friday 06:00–06:15", does: "deletes the Owner's notification bell rows", writes: "deletes notifications", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND"] },
  { id: "AGENT_CHECK_ROUTE", trigger: "external cron every 3h (cron secret)", does: "holiday alerts always; the rule-based alert pipeline + pushes + report triggers only when the agent-alert rules switch is on (it is off)", writes: "holiday agent alerts", classes: ["BACKGROUND", "DISABLED", "LEGACY"] },
  { id: "PUSH_CRON_ROUTE", trigger: "external cron (cron secret)", does: "Owner pushes for overdue / due-soon deadlines + today's sessions", writes: "push", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND"] },
  { id: "SESSION_CALENDAR_PULL", trigger: "external cron (cron secret)", does: "copies moved Google event times into sessions", writes: "sessions", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND"] },
  { id: "AGENT_SNAPSHOT_READ", trigger: "external call (cron secret)", does: "returns a read-only business snapshot of the old agent", writes: "nothing", classes: ["BACKGROUND", "LEGACY"] },
  { id: "PUSH_STATUS_READ", trigger: "external call (cron secret)", does: "reports push delivery status", writes: "nothing", classes: ["BACKGROUND"] },
  { id: "PAGE_LOAD_WRITES", trigger: "the Owner opens the app / a page", does: "session auto-mark, tasks completion sync, push re-subscribe", writes: "sessions / tasks / push subscriptions", classes: ["ACTIVE_OPERATIONAL"] },
];
/** Internal (tests only, never served): which job each scheduler / secret route belongs to. */
export const JOB_SOURCES_INTERNAL = {
  inProcessSchedules: ["REPORT_EMAILS", "UPLOAD_NOTICE_BATCHES", "SHALEV_WEEKLY_SUMMARY", "SHALEV_SESSION_REMINDER", "AVAILABILITY_REMINDER", "WEEK_STRENGTH", "STEVEN_MIX_REMINDER", "STEVEN_DEADLINE_DIGEST", "OWNER_BELL_RESET"],
  secretRoutes: { "app/api/agent/check/route.ts": "AGENT_CHECK_ROUTE", "app/api/agent/snapshot/route.ts": "AGENT_SNAPSHOT_READ", "app/api/push/cron/route.ts": "PUSH_CRON_ROUTE", "app/api/push/status/route.ts": "PUSH_STATUS_READ", "app/api/sessions/calendar-pull/route.ts": "SESSION_CALENDAR_PULL" } as Record<string, string>,
} as const;
export const ATTENTION_ENGINES: ReadonlyArray<{ id: string; what: string; classes: EngineClass[]; sunnyTreatment: string }> = [
  { id: "SUNNY_COMPANY_ATTENTION", what: "company_view: every domain signal by nature + dimensions + whose move; no score", classes: ["ACTIVE_OPERATIONAL"], sunnyTreatment: "Sunny's own reasoning (on request)" },
  { id: "AGENT_ALERTS", what: "16 rule-based alert types in a table; only holiday + week-strength still run", classes: ["LEGACY", "OBSERVATION_SOURCE", "USER_VISIBLE", "BACKGROUND"], sunnyTreatment: "context observations — never action truth (Owner decision)" },
  { id: "DASHBOARD_HEALTH_RULES", what: "dashboard health (active without deadline, overdue in mix, finance health)", classes: ["USER_VISIBLE", "ACTIVE_OPERATIONAL"], sunnyTreatment: "equivalent facts via the project / finance views; the rules are implementation" },
  { id: "COO_BRIEF", what: "the older deterministic COO brief with P0–P3 tiers", classes: ["LEGACY", "OBSERVATION_SOURCE"], sunnyTreatment: "its tiers are implementation, never the Owner's priority; its company state feeds Sunny's readers" },
  { id: "REPORT_RECOMMENDATIONS", what: "static rule-based recommendations inside the report emails", classes: ["ACTIVE_OPERATIONAL", "BACKGROUND"], sunnyTreatment: "a separate product; can disagree with Sunny" },
];
/** Fresh discovery (Full-Brain): business goals hard-coded in the old agent code (no settings rows exist → code defaults). */
export const CODE_BUSINESS_GOALS = {
  goals: { monthlyRevenueIls: 20000, weeklySessions: 8, monthlyVictor: 12, monthlyCompletions: 4 },
  semantics: "monthly revenue = GROSS income received in ₪ this month (never net); sessions = sessions done this week; completions = projects completed this month; Victor = his pace metric",
  consumers: ["the 'goal behind' agent alerts (context only)", "the weekly report goal section", "the old agent snapshot"],
  classification: "IMPLEMENTATION_BEHAVIOR — code defaults, not Owner policy",
  vsOwnerPolicy: "CONFLICT — the Owner's target is realized NET ₪20,000 floor / ₪30,000 preferred (received − paid); the code goal is ₪20,000 GROSS income. Victor 12 matches the Owner's stated target; 8 sessions / 4 completions were never confirmed by the Owner.",
  internal: { file: "lib/agent/goals.ts" },
} as const;

export const LEGACY_AI = {
  status: "RETIRED AND REMOVED (2026-09-25, Owner decision) — chat, prompt, context builder, provider router, AI budget tracking, memory route and context snapshot no longer exist; there is no flag that can bring it back",
  flagAlsoGates: ["its old kill switch was replaced by a neutral agent-alert rules switch (still off) — it gates only the rule-based alert pipeline"],
  sunnyDependsOnIt: false,
  memory: "the memory table (0 rows) and the AI budget / log settings keys remain as orphaned storage pending an approved drop — never Sunny's knowledge",
} as const;

// ═══════════════════════════════ SUNNY CORE ═══════════════════════════════
export const SUNNY_CORE_MODEL = {
  meaningHe: "המוח הארגוני של סאני: ידע מערכת (חוזים), ידע בעלים (P2), הקשר בעלים (תשובות), פעולות ותוצאות, רישום שלמות, מקרים, זיכרון נגזר, קטלוג יכולות.",
  stores: [
    { id: "OWNER_CONTEXT", meaning: "the Owner's answers to Sunny's questions (finance / integrity / deadline change) — append-only, with provenance (manual or via Claude)", conversationText: "never — the note is null for answers via Claude; the question text is Sunny's own wording", readVia: "owner_decisions / integrity learned / memory / sunny_self" },
    { id: "OWNER_KNOWLEDGE", meaning: "typed facts the Owner taught through Claude (aliases, roles, relationships, blockers, follow-ups, vendor commitments, release priorities, reported payments, friction, working-policy candidates) — append-only, ASSERT / WITHDRAW", conversationText: "never — a normalised Hebrew read-back", readVia: "owner_knowledge / sunny_self" },
    { id: "ACTION_EVENTS", meaning: "approve / not now / reject / executed / stale events of the two executable primitives", conversationText: "no", readVia: "outcomes / owner_needs / sunny_self" },
    { id: "FEEDBACK", meaning: "a designed feedback store with NO writer yet (0 rows)", conversationText: "no", readVia: "sunny_self (count)" },
    { id: "CONNECTOR_AUDIT", meaning: "one row per connector call: time, method / capability, entity key, input HASHES, status, sizes — never payloads", conversationText: "no — and parameters are hashed", readVia: "NOT READABLE (the service role has insert-only rights by design)" },
  ],
  derived: ["cases (pure, not persisted)", "integrity register (live, from state + Owner context)", "memory (pure, from finance + Owner context + actions + outcomes)", "system awareness contracts", "company model", "capability catalog"],
  epistemics: ["FACT", "DERIVED", "OWNER_DECISION", "OWNER_REPORTED", "OWNER_POLICY_CANDIDATE", "OBSERVATION", "HYPOTHESIS", "PATTERN_CANDIDATE", "UNKNOWN"],
  relationshipQuality: ["CANONICAL_RELATION", "OWNER_CONFIRMED_RELATION", "DERIVED_RELATION", "TEXT_MATCH", "AMBIGUOUS", "UNKNOWN"],
  whatSunnyCanAnswerAboutItself: [
    "what it knows (catalog + system awareness + company model)",
    "why it believes something (epistemic status + source on every item)",
    "what you answered before (Owner context history, with provenance)",
    "what you taught it (Owner knowledge history, incl. withdrawals)",
    "what it executed and what happened (action events + derived outcomes)",
    "what it does not know (known unknowns + gap registry)",
  ],
  cannotAnswer: ["the exact text of past conversations (never stored by design)", "which queries it ran in a past conversation (the audit is insert-only and hashes parameters)"],
} as const;

// ═══════════════════════════════ SUNNY CONNECTOR ═══════════════════════════════
export const SUNNY_CONNECTOR_MODEL = {
  meaningHe: "הגשר Claude ↔ סאני: שרת MCP ב-Redbloods עם OAuth של הבעלים בלבד, כלים מוגבלים, ביקורת לכל קריאה, ומצב 'MCP בלבד' בשירות נפרד.",
  services: "a separate connector deployment in MCP-only mode (no schedulers, database writes limited to the connector's own functions, the audit and — when enabled — the Owner answer / knowledge inserts); the MAIN service owns every integration credential",
  auth: { flow: "OAuth 2.1 with dynamic client registration (public clients), PKCE S256, exact redirect allowlist, resource binding to the MCP endpoint, Owner-only consent (role check on verified claims)", tokens: "access 1h, refresh 30 days rotating, family 90 days — stored only as hashes; revocation revokes the family", scopes: ["partner:read", "partner:answer (flag + MCP-only)", "partner:knowledge (flag + MCP-only)"] },
  tools: [
    { tool: "partner_brief", reads: "what matters now (≤5 items)" },
    { tool: "partner_resolve", reads: "name → entity candidates" },
    { tool: "partner_entity", reads: "one entity with enrichment" },
    { tool: "partner_query", reads: "any registered capability (progressive, paged)" },
    { tool: "partner_answer_question", reads: "answers one of Sunny's open questions (writes Owner context) — flag-gated" },
    { tool: "partner_propose_knowledge", reads: "preview → confirm → commit typed Owner knowledge — flag-gated" },
  ],
  notAvailable: ["action proposal / execution from Claude (flag off, not wired)", "finance answers from Claude (refused)"],
  limits: "in-memory per token: 30/min, 300/h; answer 10/h 30/day; knowledge 20/h 60/day; 60s tool timeout; 100k-char result cap; 16KB request cap",
  audit: "fail-closed: a call whose audit row cannot be written is refused",
  failureStates: ["MISSING / MALFORMED / UNKNOWN / REVOKED / EXPIRED token", "WRONG_AUDIENCE", "INSUFFICIENT_SCOPE", "RATE_LIMITED", "TIMEOUT", "GATEWAY_ERROR", "AUDIT unavailable", "connector disabled / misconfigured (404)"],
  flags: ["connector enabled", "answer tool", "knowledge tool", "MCP-only mode", "Owner knowledge read", "action proposal (off)"],
  production20260925: { auditRows: 200, auditFrom: "2026-09-24", rejectedAuth: 21, initialize: 15, queries: "by capability", answerAttempts: 2, knowledgeCommits: 1 },
} as const;
