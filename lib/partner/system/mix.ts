/**
 * Sunny System Awareness — STEVEN + MIX PIPELINE DEEP CONTRACT (mix / master as Redbloods actually implements it).
 *
 * Produced by the Steven + Mix Pipeline Deep Brain discovery (2026-09-25). Sources: the engineer work store, the mix
 * version / comment / attachment / riddim line / pre-mix note / final file stores, the Owner routes and the Steven
 * supplier routes, the Steven portal page, the project mix setup, the completion flow, the reminder / digest / upload /
 * presence / payment / mix-ready / notes pushes, the COO / agent consumers, the live production schema and read-only
 * production counts. Pure data; served through system_awareness mode mix_model. The served text is semantic only:
 * the schema pin, route lists and reviewed files are internal.
 */
import type { ApprovalClass, Enforcement, Who } from "./project-actions";

export const MIX_BASELINE_VERSION = "2026.09.25-mix-1";

/** Live production columns of the seven mix tables (2026-09-25) — internal, pinned by the test. */
export const MIX_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  sound_engineer_work: ["id", "project_id", "engineer_name", "work_type", "status", "agreed_price", "currency", "amount_paid", "sent_date", "internal_deadline", "files_link", "notes", "linked_transaction_id", "created_at", "updated_at", "work_title", "sort_order", "payment_date"],
  mix_versions: ["id", "sound_engineer_work_id", "project_id", "label", "file_name", "dropbox_path", "file_size", "file_type", "status", "uploaded_by", "duration_seconds", "uploaded_at", "created_at", "updated_at", "mix_target_id"],
  mix_comments: ["id", "mix_version_id", "timestamp_seconds", "comment_text", "author", "created_at", "updated_at", "role", "status"],
  mix_comment_attachments: ["id", "comment_id", "dropbox_path", "file_name", "file_size", "mime_type", "uploaded_by", "created_at"],
  mix_targets: ["id", "work_id", "target_kind", "display_name", "sort_order", "removed_at", "created_at"],
  mix_target_notes: ["id", "mix_target_id", "note_text", "author", "status", "created_at", "updated_at"],
  final_files: ["id", "work_id", "project_id", "file_name", "dropbox_path", "file_size", "file_type", "uploaded_by", "created_at"],
};
/** Served field name → stored column where they differ (internal; keeps implementation names out of served text). */
export const MIX_FIELD_ALIASES: Readonly<Record<string, string>> = { "mix_version.engineer_work_id": "sound_engineer_work_id" };
/** Served entity → stored table (internal). */
export const MIX_ENTITY_TABLE: Readonly<Record<string, string>> = { engineer_work: "sound_engineer_work", mix_version: "mix_versions", mix_comment: "mix_comments", comment_attachment: "mix_comment_attachments", riddim_line: "mix_targets", premix_note: "mix_target_notes", final_file: "final_files" };
/** Database delete rules between them (internal, read from production 2026-09-25). */
export const MIX_DB_LINKS = [
  "work → project: CASCADE (deleting a project deletes its engineer works)",
  "version → work: CASCADE; version → project: SET NULL; version → riddim line: NO ACTION",
  "comment → version: CASCADE; attachment → comment: CASCADE",
  "riddim line → work: CASCADE; pre-mix note → line: CASCADE",
  "final file → work: RESTRICT (a work with final files cannot be deleted); final file → project: SET NULL",
] as const;

/** Mix settings key families present in production or written by code (internal) — each one classified below. */
export const MIX_SETTINGS_PREFIXES = ["steven_final_files_requested_project:", "steven_final_files_requested:", "steven_deadline_digest:", "steven_mix_reminder_cycle:", "steven_mix_reminder_send:", "steven_mix_ready_pushed_", "steven_payment_pushed_", "steven_upload_pending_", "final_files_batch:", "steven_login_seen", "steven_visit_last"] as const;

export type FieldClass = "CANONICAL" | "DERIVED" | "DISPLAY_ONLY" | "LEGACY" | "AMBIGUOUS" | "POSSIBLE_BUG" | "CONFLICT";
export interface MixField { entity: string; field: string; classification: FieldClass; meaning: string; nullDefault: string; writers: string; readers: string; stevenSees: string; history: string; sunnyReads: string }
const F = (entity: string, field: string, classification: FieldClass, meaning: string, o: Partial<MixField> = {}): MixField =>
  ({ entity, field, classification, meaning, nullDefault: "—", writers: "Owner (Steven page / project drawer / mix setup)", readers: "Steven page, project drawer, COO, agent, Partner", stevenSees: "yes", history: "no change history (updated time only)", sunnyReads: "mix_view", ...o });
const W = "engineer_work", V = "mix_version", C = "mix_comment", A = "comment_attachment", T = "riddim_line", N = "premix_note", FF = "final_file";

export const MIX_FIELDS: readonly MixField[] = [
  // ── engineer work (the canonical mix work unit) ──
  F(W, "id", "CANONICAL", "Engineer work identity — THE canonical unit of mix / master work.", { history: "—" }),
  F(W, "project_id", "CANONICAL", "The project — nullable: a standalone work has only a free-text title (1 of 14 in production). Deleting the project deletes the work.", { stevenSees: "project name only" }),
  F(W, "engineer_name", "AMBIGUOUS", "FREE TEXT — the only engineer identity. Exactly 'Steven' = Steven's work (his access, portal, pushes, completion flow); 'Bill' and any custom name are other engineers. No engineer record, no id; a typo is another engineer.", { writers: "Owner (mix setup: Bill / Steven / אחר / not chosen; Steven page: always Steven)", stevenSees: "his works only (filter = exactly 'Steven')" }),
  F(W, "work_title", "CANONICAL", "The name the engineer sees (Steven page: work title, else the project name); the only name of a standalone work.", { nullDefault: "null → the project name" }),
  F(W, "work_type", "CANONICAL", "מיקס / מאסטר / מיקס + מאסטר / תיקונים. The Steven page shows two labels (מיקס מאסטרינג, מאסטרינג); the mix setup offers three. All 14 production works are מיקס + מאסטר.", { nullDefault: "מיקס" }),
  F(W, "status", "CANONICAL", "לא נשלח / נשלח / בתהליך / חזר / אושר / בוטל (no server-side vocabulary check). The Steven page shows four: לא התחיל (לא נשלח with no version), פעיל (every other open status), הושלם (אושר), בוטל.", { nullDefault: "לא נשלח", writers: "Owner; the FIRST mix version moves a Steven work from לא נשלח to בתהליך automatically", stevenSees: "display status, read-only" }),
  F(W, "agreed_price", "CANONICAL", "The agreed price in the work's currency. 0 = no price recorded (never 'free').", { nullDefault: "0", stevenSees: "yes (read-only)" }),
  F(W, "currency", "CANONICAL", "Currency of the agreed price / amount paid ($ default; all production works $).", { nullDefault: "$" }),
  F(W, "amount_paid", "CANONICAL", "Amount paid — MANUAL (the Steven page sets it to the agreed price when the Owner picks שולם, 0 for לא שולם); not read from Finance. Partial payment is display-only (0 < paid < agreed).", { nullDefault: "0", stevenSees: "yes (read-only)" }),
  F(W, "payment_date", "CANONICAL", "When it was paid (YYYY-MM-DD). Paid = agreed > 0 AND paid ≥ agreed AND a payment date.", { stevenSees: "yes (read-only)" }),
  F(W, "linked_transaction_id", "CONFLICT", "The ONE Finance expense linked to this work. TWO writers use it: the price sync (work currency, amount = agreed, status from amounts) and the Steven payment sync (₪ at a fixed ratio, deleted when unpaid).", { writers: "price sync on create / update; payment sync on the paid toggle; manual re-sync", stevenSees: "no (stripped)" }),
  F(W, "sent_date", "CANONICAL", "When the work was sent / started (Steven page 'Start date').", {}),
  F(W, "internal_deadline", "CANONICAL", "The engineer's INTERNAL deadline — an expectation, never a client commitment. Feeds the daily deadline digest, COO signals and cases.", {}),
  F(W, "files_link", "LEGACY", "A raw external link field — 0 set in production; hidden from Steven.", { stevenSees: "no (stripped)" }),
  F(W, "notes", "CANONICAL", "Owner-internal notes (0 set in production); hidden from Steven.", { stevenSees: "no (stripped)" }),
  F(W, "sort_order", "DISPLAY_ONLY", "Manual order of the Steven jobs list (drag reorder).", {}),
  F(W, "created_at", "CANONICAL", "Created.", {}),
  F(W, "updated_at", "CANONICAL", "Last update — moves on ANY change (status, price, reorder); not a status-change time.", {}),
  // ── mix version (one FILE; a 'version' is the label group) ──
  F(V, "id", "CANONICAL", "One uploaded file of a mix version.", { history: "—" }),
  F(V, "engineer_work_id", "CANONICAL", "Owning engineer work.", {}),
  F(V, "project_id", "DERIVED", "Copied from the work's project at upload (nulled if the project is deleted).", {}),
  F(V, "label", "CANONICAL", "'Mix N' — the version. Several files share one label (mix / acapella / instrumental / stems of the same round). N = the LOWEST free number in scope (per riddim line on a riddim), so after a deletion a later upload can reuse a lower number: 'latest' is decided by upload time, never by the number.", {}),
  F(V, "file_name", "CANONICAL", "Stored file name (version + role word + extension).", {}),
  F(V, "dropbox_path", "CANONICAL", "Storage location — never shown to Steven (opaque stream handle).", { stevenSees: "no (opaque handle)", sunnyReads: "mix_view (metadata; storage not listed)" }),
  F(V, "file_size", "CANONICAL", "Size in bytes.", {}),
  F(V, "file_type", "CANONICAL", "Extension (wav / mp3 / zip …).", {}),
  F(V, "status", "LEGACY", "בבדיקה / מוכן / מאושר / נדחה — an Owner version status; every one of the 126 production files is בבדיקה (never used). It is NOT an approval record.", { nullDefault: "בבדיקה" }),
  F(V, "uploaded_by", "POSSIBLE_BUG", "Always the ENGINEER NAME of the work — even when the Owner uploaded the file. It does not prove who uploaded.", { writers: "upload (set to the work's engineer name)" }),
  F(V, "duration_seconds", "CANONICAL", "Audio length (0 of 126 set in production).", {}),
  F(V, "uploaded_at", "CANONICAL", "Upload time (same instant as created).", {}),
  F(V, "created_at", "CANONICAL", "Upload time — the app's canonical 'a new mix landed' instant (reminder stop condition, last-upload ordering).", {}),
  F(V, "updated_at", "CANONICAL", "Moves on a label / status edit.", {}),
  F(V, "mix_target_id", "CANONICAL", "Riddim only: which mix line (instrumental or an artist) this file belongs to. Null = a non-riddim work or a legacy unassigned file.", {}),
  // ── comment (Owner feedback) ──
  F(C, "id", "CANONICAL", "One Owner feedback item on ONE mix version.", { history: "—" }),
  F(C, "mix_version_id", "CANONICAL", "The version FILE it was written on (so feedback always knows its version).", {}),
  F(C, "timestamp_seconds", "CANONICAL", "Position in the audio; null = general note (75 of 131 in production).", { nullDefault: "0 in the database; null = general" }),
  F(C, "comment_text", "CANONICAL", "The feedback text (Owner-written; Steven cannot create or edit comments).", { writers: "Owner only" }),
  F(C, "author", "LEGACY", "Free-text author — null on all 131 production comments; Steven never authors comments.", {}),
  F(C, "role", "CANONICAL", "Which file role it is about: mix / acapella / instrumental / stems; null = shared / general.", {}),
  F(C, "status", "CANONICAL", "open / resolved (פתוחה / טופלה). Steven and the Owner can toggle both ways; there is no resolved-by or resolved-at field (the updated time moves).", { nullDefault: "open", writers: "Owner (any field); Steven (status only)", stevenSees: "yes + can mark done / open" }),
  F(C, "created_at", "CANONICAL", "When the Owner wrote it — the Owner-feedback instant.", {}),
  F(C, "updated_at", "CANONICAL", "Moves on an edit OR a resolve / reopen toggle — not a resolve time.", {}),
  // ── comment attachment ──
  F(A, "id", "CANONICAL", "An attachment on a comment.", { history: "—" }),
  F(A, "comment_id", "CANONICAL", "Owning comment.", {}),
  F(A, "dropbox_path", "CANONICAL", "Storage location — never leaves the server (ownership-checked stream).", { stevenSees: "no (opaque handle)" }),
  F(A, "file_name", "CANONICAL", "File name.", {}),
  F(A, "file_size", "CANONICAL", "Bytes (10 MB limit).", {}),
  F(A, "mime_type", "CANONICAL", "Image (jpeg / png / webp / gif) or audio (mp3 / wav / m4a) — an audio attachment is a reference on a comment, NEVER a mix version.", {}),
  F(A, "uploaded_by", "CANONICAL", "'owner' (only the Owner can attach).", { writers: "Owner only" }),
  F(A, "created_at", "CANONICAL", "Attached.", {}),
  // ── riddim mix line ──
  F(T, "id", "CANONICAL", "A riddim mix line (one work, several independent lines).", { history: "—" }),
  F(T, "work_id", "CANONICAL", "Owning work (only when the project type is רידים).", {}),
  F(T, "target_kind", "CANONICAL", "instrumental / artist.", {}),
  F(T, "display_name", "CANONICAL", "Free-text artist name — NO link to label artists or clients.", {}),
  F(T, "sort_order", "DISPLAY_ONLY", "Instrumental 0, artists follow.", {}),
  F(T, "removed_at", "CANONICAL", "Soft remove — history and comments are kept.", {}),
  F(T, "created_at", "CANONICAL", "Created.", {}),
  // ── pre-mix note ──
  F(N, "id", "CANONICAL", "A PRE-MIX note on a riddim line (no version yet) — not a comment.", { history: "—" }),
  F(N, "mix_target_id", "CANONICAL", "Owning line.", {}),
  F(N, "note_text", "CANONICAL", "Owner instruction before the first mix.", { writers: "Owner only" }),
  F(N, "author", "LEGACY", "Free-text author.", {}),
  F(N, "status", "CANONICAL", "open / resolved.", { nullDefault: "open" }),
  F(N, "created_at", "CANONICAL", "Written.", {}),
  F(N, "updated_at", "CANONICAL", "Edited / toggled.", {}),
  // ── final file (delivery, separate from versions) ──
  F(FF, "id", "CANONICAL", "A final delivery file ('Upload Final Files') — completely separate from mix versions (never in the player).", { history: "—" }),
  F(FF, "work_id", "CANONICAL", "Uploading work (a work with final files cannot be deleted).", {}),
  F(FF, "project_id", "CANONICAL", "The project — final files count PER PROJECT (a file uploaded through one work satisfies every work of that project).", {}),
  F(FF, "file_name", "CANONICAL", "Exact original name (unique per name / path, case-insensitive). No mix / master type is recorded.", {}),
  F(FF, "dropbox_path", "CANONICAL", "The project's / work's Final Files folder.", { stevenSees: "no" }),
  F(FF, "file_size", "CANONICAL", "Bytes (up to 1 GB, chunked).", {}),
  F(FF, "file_type", "CANONICAL", "Extension (wav / zip / rar in production).", {}),
  F(FF, "uploaded_by", "POSSIBLE_BUG", "'Steven' on all 17 production rows — the uploader is not provable (the Owner can upload on the same route family).", {}),
  F(FF, "created_at", "CANONICAL", "Uploaded — compared with the final-files request time.", {}),
];

export interface MixSetting { key: string; classification: FieldClass; meaning: string; sunnyReads: string }
export const MIX_SETTINGS: readonly MixSetting[] = [
  { key: "steven_final_files_requested_project:", classification: "CANONICAL", meaning: "Final files were requested for a project ({workId, at}) — written when Steven's LAST open work on the project became אושר; released when a new open work starts a new cycle", sunnyReads: "mix_view final files (request vs latest final file)" },
  { key: "steven_final_files_requested:", classification: "CANONICAL", meaning: "The same request for a standalone work", sunnyReads: "mix_view final files" },
  { key: "steven_deadline_digest:", classification: "CANONICAL", meaning: "The daily deadline digest was sent for a day (claim / outcome)", sunnyReads: "mix_view steven (digest history)" },
  { key: "steven_mix_reminder_cycle:", classification: "CANONICAL", meaning: "An ACTIVE notes-reminder cycle for a work: cycleStartAt = the instant the Owner pressed 'Send notes'; deleted when a newer version lands, the work closes or 3 reminders were sent", sunnyReads: "mix_view handoff (notes-sent evidence)" },
  { key: "steven_mix_reminder_send:", classification: "DERIVED", meaning: "One claim per reminder attempt; the key embeds the cycle start = a past 'Send notes' instant (only for cycles that reached a reminder — a notes send answered within 5 hours leaves no trace)", sunnyReads: "mix_view handoff (partial notes history)" },
  { key: "steven_mix_ready_pushed_", classification: "CANONICAL", meaning: "'Send to Steven' (new mix job) push dedupe marker per work", sunnyReads: "mix_view (sent-to-engineer evidence)" },
  { key: "steven_payment_pushed_", classification: "CANONICAL", meaning: "'Payment sent' push dedupe marker per work ({paymentDate})", sunnyReads: "mix_view money" },
  { key: "steven_upload_pending_", classification: "CANONICAL", meaning: "Steven uploads waiting to be batched into one Owner push", sunnyReads: "system_settings" },
  { key: "final_files_batch:", classification: "CANONICAL", meaning: "Final-file upload batch waiting for its Owner push", sunnyReads: "system_settings" },
  { key: "steven_login_seen", classification: "CANONICAL", meaning: "Last sign-in already announced (login push dedupe)", sunnyReads: "mix_view steven presence" },
  { key: "steven_visit_last", classification: "CANONICAL", meaning: "Last announced portal visit (30-minute cooldown)", sunnyReads: "mix_view steven presence" },
];

export const MIX_VOCABULARIES = {
  workStatus: ["לא נשלח", "נשלח", "בתהליך", "חזר", "אושר", "בוטל"],
  workType: ["מיקס", "מאסטר", "מיקס + מאסטר", "תיקונים"],
  stevenUiStatus: ["לא התחיל", "פעיל", "הושלם", "בוטל"],
  stevenUiWorkType: ["מיקס מאסטרינג", "מאסטרינג"],
  stevenUiPay: ["שולם", "חלקי", "לא שולם"],
  versionStatus: ["בבדיקה", "מוכן", "מאושר", "נדחה"],
  commentStatus: ["open", "resolved"],
  commentRole: ["mix", "acapella", "instrumental", "stems"],
  targetKind: ["instrumental", "artist"],
  albumTrackMixMaster: ["לא התחיל", "בתהליך", "הושלם"],
  projectMixStages: ["מחכה למיקס", "במיקס"],
  mixSetupEngineers: ["Bill", "Steven", "אחר", "עדיין לא נבחר"],
} as const;

export const STATUS_MACHINE = {
  stored: "Six stored statuses; the server does not validate them. Steven's page writes only לא נשלח (לא התחיל), בתהליך (פעיל), אושר (הושלם) and בוטל (creation only); נשלח / חזר come from other editors (1 production work is נשלח).",
  display: "Steven page: אושר → הושלם; בוטל → בוטל; לא נשלח with no version → לא התחיל; everything else (incl. לא נשלח WITH versions) → פעיל.",
  automatic: "The first mix version moves a Steven work from לא נשלח to בתהליך (no other side effect).",
  completion: "→ אושר (a real transition only): Steven work → if it was Steven's LAST open work on the project, the project becomes הושלם (unless בוטל / בהשהייה / already הושלם), a final-files request is written, Steven is pushed 'upload final files' and the Owner gets a confirmation. Comments, payment and the deadline are untouched.",
  reopen: "אושר / בוטל → open: releases the project's final-files request (a new cycle).",
  closed: "אושר and בוטל are 'closed' everywhere (reminders, digest, COO).",
  meaningOfStatus: "no status means 'Owner approved the mix': אושר is set by the Owner and is what the app calls completed; no approval record exists.",
} as const;

export const IDENTITY_MODEL = {
  steven: "Steven = a login role (configured email) AND engineer works whose engineer name is exactly 'Steven'. Everything portal-side (access, sanitizing, pushes, completion flow, reminders, digest, presence) keys on that exact name.",
  otherEngineers: "Other engineers exist only as free-text names on works (mix setup: Bill, or any typed name). No login, no portal, no pushes of their own, no completion flow. Production 2026-09-25: 0 non-Steven works.",
  identityQuality: "engineer name → person: TEXT_MATCH (no engineer record, no id). Steven → portal: CANONICAL (exact name + role).",
  financeParty: "no engineer party record: expenses carry the engineer name only in their description ('Steven — מיקס' / 'מיקס - <project>').",
  storage: "versions live in the project's Mix Versions folder; final files in its Final Files folder; comment attachments in their own folder — per project, not per engineer.",
} as const;

export const STEVEN_VS_GENERIC: ReadonlyArray<{ behavior: string; scope: "STEVEN_ONLY" | "GENERIC" | "STEVEN_ASSUMPTION_APPLIED_TO_ALL" }> = [
  { behavior: "portal access, sanitized data, opaque file handles", scope: "STEVEN_ONLY" },
  { behavior: "first version → בתהליך; upload push to the Owner", scope: "STEVEN_ONLY" },
  { behavior: "completion flow (project הושלם, final-files request, pushes)", scope: "STEVEN_ONLY" },
  { behavior: "notes reminder (every 5 h, max 3), daily deadline digest, presence pushes", scope: "STEVEN_ONLY" },
  { behavior: "new project-linked work only for שיר / רידים / אלבום / EP", scope: "STEVEN_ONLY" },
  { behavior: "work record, statuses, price sync to Finance, versions, comments, attachments, riddim lines, final files", scope: "GENERIC" },
  { behavior: "'Payment sent' push to Steven on any engineer's paid transition", scope: "STEVEN_ASSUMPTION_APPLIED_TO_ALL" },
  { behavior: "payment → ₪ expense at the fixed $→₪ ratio (3.25) — the route has no engineer check", scope: "STEVEN_ASSUMPTION_APPLIED_TO_ALL" },
  { behavior: "'Send notes' / 'Send to Steven' pushes go to Steven whatever the work's engineer (Owner-only routes, no engineer check)", scope: "STEVEN_ASSUMPTION_APPLIED_TO_ALL" },
];

export const WORK_MODEL = {
  unit: "one engineer work = one engineer × one project (or a standalone title) × one work type. Versions, comments, riddim lines and final files hang off it.",
  cardinality: "the store allows many works per project (different engineers / types / history); the project lookup returns only the NEWEST one, and the mix setup skips creating a second one — so a project with several works is shown as one in some places (production: at most one per project).",
  replacement: "changing the engineer name on a work rewrites it (no history); a replacement engineer = a new work.",
  creation: [
    "Project status → במיקס (status dropdown) opens the mix setup: engineer (Bill / Steven / other / not chosen), type, internal deadline, optional follow-up task ('מעקב מיקס — <project>') and Google Task. An engineer creates a work (status לא נשלח, no price).",
    "Steven page '+ New work for Steven': project (שיר / רידים / אלבום / EP only) or a standalone title, price $, deadline, type → a work with לא נשלח; Finance is NOT touched (Steven flow skips the price sync).",
    "Project drawer 'שלח ל… → מיקס / מאסטר → Steven / Bill': a work (Steven לא נשלח / Bill נשלח, $200, sent today, deadline today + 3 days, Finance skipped) + a send-log entry to the engineer (NOT linked to the work — the link only accepts Victor works) + for Steven the project status במיקס.",
    "Older project drawer engineer section: engineer + price → the price sync creates an expense (work currency, לא שולם).",
  ],
  sendLog: "send-log entries to the engineer (recipient Steven, 'מיקס / מאסטר'): 18 in production, all still 'pending_version' — the status is never updated, so it is send evidence (date) only, never a ball holder.",
  financeOnCreate: "only the generic path with a price creates an expense (work currency, amount = agreed, לא שולם / חלקי / שולם from the amounts); the Steven flow and standalone works never do.",
} as const;

export const HANDOFF_MODEL = {
  productionToMix: "NO canonical production → mix handoff record. Evidence Sunny can show: the project status (מחכה למיקס / במיקס), an engineer work exists, its creation / sent date, a send-log entry to the engineer (project + recipient; not linked to the work), the 'Send to Steven' marker, work materials sent (project files 'חומרי עבודה' + BPM / key / instructions), a Victor work on the same project. A completed Victor work does not start a mix.",
  mixStart: "No canonical 'mix started' definition. The app itself treats: a work exists (לא התחיל), the first version (→ בתהליך / פעיל). Sunny reports those facts, never a start date it cannot see.",
  ballRule: "Sunny's evidence rule (DERIVED — the app has no mix ball rule; the COO uses status only): latest Owner feedback = the newest comment / pre-mix note / 'Send notes' instant; latest engineer delivery = the newest version upload. Feedback after the latest version → WAITING_ON_ENGINEER; a version after the latest feedback → WAITING_ON_OWNER (the same comparison the app's notes reminder uses to stop). No version and no feedback → UNKNOWN (or WAITING_ON_ENGINEER when the work was sent). Closed → COMPLETED / CANCELLED.",
  conflicts: "CONFLICTING_EVIDENCE when the status חזר (returned to the Owner) disagrees with feedback after the latest version, or an active notes-reminder cycle exists while a newer version is recorded.",
  caveats: ["versions uploaded by the Owner are recorded as the engineer's (uploader not provable)", "comments are Owner-only, so a resolve toggle is the only engineer comment action — and it records no who", "outside communication (WhatsApp / phone / email) is invisible — stale evidence = ask, never blame"],
} as const;

export const VERSION_MODEL = {
  entity: "a version = the label group ('Mix N') of a work (per riddim line on a riddim); each FILE is its own record (mix / acapella / instrumental / stems roles; stems = archives, download only).",
  latest: "latest version = the label group holding the newest upload time — NOT the highest number (numbers are 'lowest free', so a deleted Mix 2 can be reused later).",
  ordering: "numeric where needed ('Mix 10' after 'Mix 9', never lexical); ties broken by upload time.",
  mutability: "a version file is immutable once uploaded (no replace); label and status are editable; a version can be deleted (the project-player copy of a full mix stays).",
  projectCopy: "a FULL mix on a project-linked work is also copied into the project's files (player) with a link back to the version.",
  approval: "the version status (בבדיקה / מוכן / מאושר / נדחה) exists but is never set (all 126 = בבדיקה) — not an approval.",
} as const;

export const COMMENT_MODEL = {
  owner: "only the Owner creates, edits and deletes comments, pre-mix notes and attachments; Steven can only mark a comment done / open.",
  version: "each comment belongs to ONE version file (so to one version round) — feedback on an older round stays on that round.",
  resolved: "resolved = someone marked it done (Steven or the Owner). No who, no when (the updated time also moves on edits); reopen is possible. A new version does NOT resolve anything.",
  openAfterNewVersion: "open comments on an older round after a newer version: still open in the data — Sunny reports them as 'open on an older version', never as handled.",
  preMix: "riddim pre-mix notes (a line with no version yet) are separate records, open / resolved.",
  attachments: "images (screenshots) and audio references on comments — a comment attachment is never a mix version.",
  notesSend: "'Send notes' (Owner button) pushes Steven + starts the 5-hour reminder cycle (max 3, stops on a newer version or a closed work). The only stored trace of the click is the active cycle row or a reminder claim.",
} as const;

export const FINAL_FILES_MODEL = {
  meaning: "'Upload Final Files' = the delivery files (masters, stems, instrumental, acapella …) — a separate record from versions; no mix / master / instrumental type is recorded (file name only).",
  scope: "per PROJECT: a final file uploaded through one work counts for every work of that project; a standalone work counts its own.",
  request: "when Steven's last open work of a project is completed, a final-files request is recorded; the request is satisfied only by a final file uploaded AFTER the request time (the app's own rule, reused by Sunny).",
  delivery: "final files are NOT the project delivery package: delivery (folder + status) is a separate project record the Owner manages; no automatic link.",
  deletion: "no delete route (the database blocks deleting a work that has final files).",
} as const;

export const MONEY_MODEL = {
  fields: "agreed price + currency + amount paid + payment date on the work (manual). Paid = agreed > 0 AND paid ≥ agreed AND a payment date.",
  writerA: "PRICE SYNC (generic, on create / update with a price, and a manual re-sync): an expense in the WORK currency, amount = the agreed price, status לא שולם / חלקי / שולם from the amounts, category מיקס / מאסטר, no date, no expense scope set.",
  writerB: "STEVEN PAYMENT SYNC (the Steven page 'paid' toggle): paid → an expense upserted in ₪ = agreed × 3.25 (a fixed working ratio in code), status שולם, dated the payment date, category מיקס / מאסטר, expense scope כללי, a note with the PayPal gross estimate (agreed × 1.05); unpaid → the linked expense is DELETED.",
  conflict: "both writers use the same link, so they can overwrite each other; production 2026-09-25: all 9 linked expenses have the payment-sync shape (₪650 for $200).",
  currencies: "the work is in $, its payment expense in ₪ (by the fixed ratio) — never add or subtract across currencies; Sunny shows both and checks the recorded ₪ against the app's own ratio.",
  expenseScope: "the intended engineer expense scope is מיקס / מאסטר; the payment sync writes כללי (all 9 production expenses) — reported, not changed.",
  statuses: "expense statuses: לא שולם / חלקי / שולם. התקבל is income-only — on an engineer expense it is invalid and never counts as paid.",
  rate: "no stored rate, no per-engineer rate and no PayPal fee policy. Hard-coded working values (IMPLEMENTATION_BEHAVIOR, not Owner policy): the project-drawer send pre-fills $200; the payment sync uses $→₪ 3.25 and notes a ×1.05 PayPal gross estimate. Each work's own agreed price wins.",
  noPrice: "no price ≠ free; no expense ≠ paid (the Steven flow creates the expense only when marked paid).",
} as const;

export const PORTAL_MODEL = {
  page: "Steven's page (English-locked for him): KPIs (open / active / completed jobs, debt to Steven, paid), Active Jobs + Jobs History tabs (search, work-type filter), payment history, recent files; a job modal with work materials (read-only: rough mix, references, stems, docs, BPM / key / instructions + a quick compare player), mix versions per round (player + timestamp comments), riddim lines + pre-mix notes, and 'Upload Final Files' (focus state after completion until a newer final file exists).",
  stevenCan: ["read his works (no Finance link, no Owner notes, no raw links) incl. price / paid / payment date", "upload versions (single + chunked, up to 1 GB)", "stream his versions / comment attachments / work materials", "mark a comment done / open", "upload final files (+ finish a batch)", "register push, ping presence"],
  stevenCannot: ["create / edit / delete comments or attachments", "change status, price, deadline, work type", "delete versions or final files", "see other engineers' works", "see Finance transactions"],
  ownerOnly: ["create / edit / delete works, price, paid toggle, deadline, status", "comments, attachments, pre-mix notes, riddim lines", "version label / status / delete", "work materials", "'Send to Steven', 'Send notes'", "reorder, force Finance re-sync"],
  player: "versions play in the page player; comments are placed at the playhead time (or general); the mobile MiniPlayer is shared; attachments preview inline (image) / play (audio).",
  presence: "each page mount pings: a login push once per real sign-in, a visit push at most every 30 minutes (Owner only). Presence = portal activity, never proof of work, listening or handling a comment.",
} as const;

export interface MixPush { id: string; trigger: string; recipients: string; kind: "MANUAL" | "EVENT" | "SCHEDULED" | "PAGE_LOAD"; dedupe: string; guard: string; note: string }
export const MIX_PUSHES: readonly MixPush[] = [
  { id: "STEVEN_MIX_READY", trigger: "Owner 'Send to Steven'", recipients: "Owner + Steven", kind: "MANUAL", dedupe: "per work marker (resend on explicit confirm)", guard: "production", note: "no engineer check on the route" },
  { id: "STEVEN_NOTES", trigger: "Owner 'Send notes'", recipients: "Owner + Steven", kind: "MANUAL", dedupe: "none (repeatable)", guard: "production", note: "starts the reminder cycle; no engineer check" },
  { id: "STEVEN_MIX_REMINDER", trigger: "5 h after notes with no newer version", recipients: "Steven", kind: "SCHEDULED", dedupe: "per cycle + attempt claim; max 3", guard: "production", note: "stops on a newer version or a closed work" },
  { id: "STEVEN_DEADLINE_DIGEST", trigger: "09:00 New York daily: overdue / today / tomorrow open works", recipients: "Steven (+ Owner confirmation on delivery)", kind: "SCHEDULED", dedupe: "one claim per day", guard: "production", note: "only when non-empty" },
  { id: "STEVEN_UPLOADS", trigger: "a version file on a Steven work (whoever clicked)", recipients: "Owner", kind: "EVENT", dedupe: "batched per work (~75 s)", guard: "production", note: "Owner uploads also announce 'Steven uploaded'" },
  { id: "FINAL_FILES_BATCH", trigger: "final-files batch completed (Steven)", recipients: "Owner", kind: "EVENT", dedupe: "per batch", guard: "production", note: "" },
  { id: "STEVEN_COMPLETED", trigger: "Steven's last open work of a project → אושר", recipients: "Steven ('upload final files') + Owner confirmation / failure notice", kind: "EVENT", dedupe: "claim per completion", guard: "production", note: "" },
  { id: "STEVEN_PAYMENT", trigger: "any engineer work becomes paid", recipients: "Owner + Steven", kind: "EVENT", dedupe: "per work + payment date", guard: "production", note: "BUG: no engineer check — another engineer's payment would push Steven" },
  { id: "STEVEN_PRESENCE", trigger: "Steven page mount (login / visit)", recipients: "Owner", kind: "PAGE_LOAD", dedupe: "login once; visit 30 min", guard: "production", note: "the only page-load push — presence, by design" },
];

export const OTHER_CONSUMERS = {
  agentAlerts: "no mix / engineer Agent Alert type exists (production: none). Project-level alerts (overdue deadline …) may fire on mix-stage projects.",
  coo: "COO signals: Steven work deadline (open work, internal deadline near / passed; not counted as his delay when a version exists and the status cannot tell), Steven waiting on Owner (status חזר), Steven approved-unpaid, Steven open-work watch (≥ 3). Thresholds are COO configuration, not Owner policy.",
  cases: "Partner cases: a Steven internal deadline passed.",
  agentChat: "the AI chat context lists a project's engineer work and, for mix-stage projects, flags a missing engineer / an unrecorded balance.",
  albumTracks: "album tracks carry their own mix / master status (לא התחיל / בתהליך / הושלם) — a separate, manual per-track concept NOT linked to engineer works (5 tracks, all לא התחיל).",
  tasks: "mix follow-up tasks 'מעקב מיקס — <project>' are linked to the PROJECT (not the work); relation to a work = project + title prefix (TEXT_MATCH).",
  calendar: "no mix calendar events; only optional Google Tasks from the mix setup. Sessions relate by project only.",
} as const;

export interface MixActionEntry { id: string; action: string; who: Who | "OWNER_OR_STEVEN"; enforcement: Enforcement; writes: string; finance: string | null; push: string | null; files: string | null; project: string | null; destructive: boolean; reversible: "YES" | "PARTIAL" | "NO"; approvalClass: ApprovalClass; sunnyToday: "KNOWLEDGE_ONLY"; futurePrimitive: string; internal: { routes: readonly string[] } }
type MA = Omit<MixActionEntry, "sunnyToday" | "internal"> & { routes: readonly string[] };
const X = (e: MA): MixActionEntry => { const { routes, ...rest } = e; return { ...rest, sunnyToday: "KNOWLEDGE_ONLY", internal: { routes } }; };
const SE = "app/api/sound-engineer", SS = "app/api/supplier/steven";
export const MIX_ACTIONS: readonly MixActionEntry[] = [
  X({ id: "ASSIGN_ENGINEER", action: "Create an engineer work (mix setup / Steven page / project drawer)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "work (לא נשלח)", finance: "price sync only on the generic path with a price", push: null, files: null, project: "mix setup also sets the project status במיקס", destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "ASSIGN_MIX_ENGINEER", routes: [`${SE}/route.ts`] }),
  X({ id: "EDIT_WORK", action: "Change engineer / type / price / currency / paid / deadline / sent date / notes / status", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "work", finance: "price sync when a money field changes (price > 0)", push: "paid transition → Steven payment push; completion → completion pushes", files: null, project: "Steven completion may set the project הושלם", destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "UPDATE_MIX_WORK", routes: [`${SE}/[id]/route.ts`] }),
  X({ id: "MARK_COMPLETED", action: "Mark a work הושלם (אושר)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "status", finance: null, push: "Steven + Owner (last open work)", files: "final-files request", project: "project הושלם when it was Steven's last open work", destructive: false, reversible: "PARTIAL", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "COMPLETE_MIX_WORK", routes: [`${SE}/[id]/route.ts`] }),
  X({ id: "RECORD_PAYMENT", action: "Toggle paid (Steven page) → Finance expense upsert / delete", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "amount paid + payment date, then the linked expense", finance: "₪ expense at the fixed ratio (deleted when unpaid)", push: "payment push (Owner + Steven)", files: null, project: null, destructive: true, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "RECORD_ENGINEER_PAYMENT", routes: [`${SE}/[id]/route.ts`, `${SE}/[id]/payment-expense/route.ts`] }),
  X({ id: "FORCE_FINANCE_SYNC", action: "Re-run the price sync", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "linked expense", finance: "work-currency expense", push: null, files: null, project: null, destructive: false, reversible: "PARTIAL", approvalClass: "FINANCIAL", futurePrimitive: "—", routes: [`${SE}/[id]/route.ts`] }),
  X({ id: "DELETE_WORK", action: "Delete an engineer work", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "work + its versions / comments / lines (cascade); blocked when final files exist", finance: "the expense is kept", push: null, files: "storage kept", project: null, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "DELETE_MIX_WORK", routes: [`${SE}/[id]/route.ts`] }),
  X({ id: "REORDER", action: "Reorder Steven's jobs list", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "display order", finance: null, push: null, files: null, project: null, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "—", routes: [`${SE}/reorder/route.ts`] }),
  X({ id: "SEND_TO_ENGINEER", action: "'Send to Steven' (new mix job push)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "push marker", finance: null, push: "Owner + Steven", files: null, project: null, destructive: false, reversible: "NO", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "SEND_MIX_JOB", routes: [`${SE}/[id]/notify-mix-ready/route.ts`] }),
  X({ id: "SEND_NOTES", action: "'Send notes' push (starts the reminder cycle)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "reminder cycle", finance: null, push: "Owner + Steven; reminders every 5 h (max 3)", files: null, project: null, destructive: false, reversible: "NO", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "SEND_MIX_NOTES", routes: [`${SE}/[id]/notify-notes/route.ts`] }),
  X({ id: "UPLOAD_VERSION", action: "Upload a mix version file (single / chunked)", who: "OWNER_OR_STEVEN", enforcement: "ROLE_SCOPED", writes: "version record (+ first version → בתהליך)", finance: null, push: "Owner upload push (Steven works)", files: "storage upload; full mix copied into the project player", project: "project file copy", destructive: false, reversible: "PARTIAL", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "—", routes: [`${SE}/[id]/versions/route.ts`, `${SE}/[id]/versions/chunk/route.ts`, `${SS}/work/[id]/versions/route.ts`, `${SS}/work/[id]/versions/chunk/route.ts`] }),
  X({ id: "EDIT_OR_DELETE_VERSION", action: "Edit a version label / status, or delete a version file", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "version record (delete cascades its comments)", finance: null, push: null, files: "storage delete (the project-player copy stays)", project: null, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "DELETE_MIX_VERSION", routes: [`${SE}/versions/[versionId]/route.ts`] }),
  X({ id: "ADD_COMMENT", action: "Add / edit / delete a timestamp or general comment", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "comment", finance: null, push: null, files: null, project: null, destructive: false, reversible: "PARTIAL", approvalClass: "STANDARD", futurePrimitive: "ADD_MIX_COMMENT", routes: [`${SE}/versions/[versionId]/comments/route.ts`, `${SE}/comments/[commentId]/route.ts`, `${SS}/versions/[versionId]/comments/route.ts`, `${SS}/comments/[commentId]/route.ts`] }),
  X({ id: "RESOLVE_COMMENT", action: "Mark a comment done / open", who: "OWNER_OR_STEVEN", enforcement: "ROLE_SCOPED", writes: "comment status", finance: null, push: null, files: null, project: null, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "RESOLVE_MIX_COMMENT", routes: [`${SE}/comments/[commentId]/route.ts`, `${SS}/comments/[commentId]/route.ts`] }),
  X({ id: "COMMENT_ATTACHMENT", action: "Attach / delete an image or audio file on a comment", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "attachment", finance: null, push: null, files: "storage upload / delete", project: null, destructive: true, reversible: "NO", approvalClass: "DESTRUCTIVE", futurePrimitive: "—", routes: [`${SE}/comments/[commentId]/attachments/route.ts`, `${SE}/comments/[commentId]/attachments/[attachmentId]/route.ts`] }),
  X({ id: "RIDDIM_LINES", action: "Create / rename / soft-remove riddim lines; pre-mix notes", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "lines / notes", finance: null, push: null, files: null, project: null, destructive: false, reversible: "YES", approvalClass: "STANDARD", futurePrimitive: "—", routes: [`${SE}/[id]/targets/route.ts`, `${SE}/[id]/targets/[targetId]/route.ts`, `${SE}/[id]/targets/[targetId]/notes/route.ts`, `${SE}/[id]/targets/[targetId]/notes/[noteId]/route.ts`] }),
  X({ id: "WORK_MATERIALS", action: "Upload / edit / delete work materials (rough mix, references, stems, docs, BPM / key / instructions)", who: "OWNER", enforcement: "ROUTE_CHECKS_OWNER", writes: "project files + project work materials", finance: null, push: null, files: "storage upload / delete", project: "project files", destructive: true, reversible: "PARTIAL", approvalClass: "DESTRUCTIVE", futurePrimitive: "—", routes: [`${SE}/[id]/work-materials/route.ts`, `${SE}/[id]/work-materials/chunk/route.ts`] }),
  X({ id: "UPLOAD_FINAL_FILES", action: "Upload final files (+ finish the batch → Owner push)", who: "OWNER_OR_STEVEN", enforcement: "ROLE_SCOPED", writes: "final file records", finance: null, push: "Owner (batch)", files: "storage upload (no delete route)", project: null, destructive: false, reversible: "NO", approvalClass: "EXTERNAL_EFFECT", futurePrimitive: "—", routes: [`${SE}/[id]/final-files/route.ts`, `${SE}/[id]/final-files/chunk/route.ts`, `${SE}/[id]/final-files/batch-complete/route.ts`, `${SS}/work/[id]/final-files/route.ts`, `${SS}/work/[id]/final-files/chunk/route.ts`, `${SS}/work/[id]/final-files/batch-complete/route.ts`] }),
];

export interface MixWorkflow { event: string; support: "SUPPORTED" | "PARTIAL" | "NOT_SUPPORTED"; concept: string; missing: string[] }
/** Mutating routes that are portal infrastructure, not business actions (internal; presence + push registration). */
export const MIX_INFRA_ROUTES = [`${SS}/ping/route.ts`, `${SS}/push-subscribe/route.ts`] as const;

export const MIX_WORKFLOWS: readonly MixWorkflow[] = [
  { event: "PRODUCTION_TO_MIX", support: "PARTIAL", concept: "project status מחכה למיקס / במיקס + mix setup", missing: ["no handoff record", "no link from a Victor work to the engineer work"] },
  { event: "ASSIGN_ENGINEER", support: "SUPPORTED", concept: "engineer work (free-text engineer)", missing: ["engineer identity record"] },
  { event: "SEND_JOB", support: "PARTIAL", concept: "'Send to Steven' push + marker", missing: ["other engineers have no send"] },
  { event: "VERSION_UPLOAD", support: "SUPPORTED", concept: "version files + round label", missing: ["who really uploaded"] },
  { event: "OWNER_REVIEW", support: "PARTIAL", concept: "comments on a version (+ attachments)", missing: ["'listened / reviewed' is not recorded"] },
  { event: "SEND_NOTES", support: "PARTIAL", concept: "push + reminder cycle", missing: ["notes-sent history is kept only while a cycle is active / reached a reminder"] },
  { event: "REVISION", support: "SUPPORTED", concept: "a newer version round after feedback", missing: [] },
  { event: "RESOLVE_FEEDBACK", support: "PARTIAL", concept: "comment open / resolved", missing: ["who resolved, when"] },
  { event: "OWNER_APPROVAL", support: "NOT_SUPPORTED", concept: "—", missing: ["no approval record (version status never used; אושר = completed)"] },
  { event: "COMPLETION", support: "SUPPORTED", concept: "status אושר (+ Steven completion flow)", missing: ["completion time is not recorded (updated time only)"] },
  { event: "FINAL_FILES", support: "SUPPORTED", concept: "final files per project + request", missing: ["mix / master / stems type not recorded"] },
  { event: "DELIVERY_TO_CLIENT", support: "NOT_SUPPORTED", concept: "project delivery is separate", missing: ["no link from final files to the delivery"] },
  { event: "RELEASE", support: "PARTIAL", concept: "the project's release record", missing: ["no mix-readiness concept"] },
  { event: "ENGINEER_PAYMENT", support: "PARTIAL", concept: "paid toggle + expense", missing: ["two conflicting finance writers", "expense scope כללי"] },
  { event: "HISTORY", support: "PARTIAL", concept: "timestamps of versions / comments / final files", missing: ["status / assignment / payment change history"] },
];

export const MIX_SIGNAL_MODEL: ReadonlyArray<{ code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; note: string }> = [
  { code: "WAITING_ON_ENGINEER", kind: "DERIVED_SIGNAL", note: "Owner feedback after the latest version" },
  { code: "WAITING_ON_OWNER", kind: "DERIVED_SIGNAL", note: "a version after the latest Owner feedback — review evidence is not recorded" },
  { code: "HANDOFF_UNKNOWN", kind: "UNKNOWN", note: "no version and no feedback" },
  { code: "HANDOFF_CONFLICT", kind: "DERIVED_SIGNAL", note: "status / reminder cycle disagree with the upload / feedback evidence" },
  { code: "INTERNAL_DEADLINE_PASSED", kind: "DERIVED_SIGNAL", note: "open work, internal deadline passed — investigate, never blame; not a client commitment" },
  { code: "OPEN_COMMENTS", kind: "CANONICAL_FACT", note: "open comments (latest round vs older rounds shown apart)" },
  { code: "COMPLETED_OPEN_COMMENTS", kind: "CANONICAL_FACT", note: "completed work still has open comments — contradiction reported, not resolved" },
  { code: "COMPLETED_NO_FINAL_FILES", kind: "CANONICAL_FACT", note: "completed work with no final file for its project / work" },
  { code: "FINAL_FILES_REQUEST_OPEN", kind: "CANONICAL_FACT", note: "final files were requested and no newer final file exists" },
  { code: "COMPLETED_UNPAID", kind: "CANONICAL_FACT", note: "completed, priced, not paid" },
  { code: "PAYMENT_FINANCE_CONFLICT", kind: "DERIVED_SIGNAL", note: "work paid state and its expense disagree (missing / not שולם / unexpected ratio / התקבל)" },
  { code: "EXPENSE_SCOPE_GENERAL", kind: "CANONICAL_FACT", note: "engineer expense recorded with expense scope כללי (intended מיקס / מאסטר)" },
  { code: "MIX_STAGE_NO_ENGINEER", kind: "CANONICAL_FACT", note: "project in מחכה למיקס / במיקס with no engineer work" },
  { code: "PRODUCTION_DONE_NO_MIX", kind: "DERIVED_SIGNAL", note: "a completed Victor work on a project without engineer work — handoff not recorded" },
  { code: "RELEASE_CONTEXT", kind: "CANONICAL_FACT", note: "the project has a release — context only, no readiness verdict" },
  { code: "ORPHAN_MIX_EXPENSE", kind: "CANONICAL_FACT", note: "a mix / master expense linked to no engineer work" },
];

export const MIX_INTEGRITY = {
  productionCounts20260925: {
    works: 14, steven: 14, otherEngineers: 0, byStatus: { "אושר": 12, "בתהליך": 1, "נשלח": 1 }, workType: { "מיקס + מאסטר": 14 }, linkedToProject: 13, standalone: 1, businessType: { "לקוח": 13 },
    withInternalDeadline: 14, openDeadlinePassed: 2, priced: 14, currency: { "$": 14 }, paid: 9, linkedExpenses: 9,
    versionFiles: 126, worksWithVersions: 10, versionRounds: 47, maxRoundNumber: 8, riddimTaggedFiles: 50, versionStatus: { "בבדיקה": 126 }, versionUploader: { Steven: 126 }, versionDurations: 0,
    comments: 131, openComments: 51, resolvedComments: 80, generalComments: 75, commentAuthorsRecorded: 0, attachments: 10, attachmentTypes: ["image/png", "audio/mpeg"],
    riddimLines: 7, riddimWorks: 1, preMixNotes: 6, openPreMixNotes: 6,
    finalFiles: 17, worksWithFinalFiles: 8, finalFileTypes: ["wav", "zip", "rar"], finalFilesRequestRows: 2,
    completedWithoutFinalFiles: 5, completedWithOpenComments: 5, completedUnpaid: 3, completedWithoutAnyVersion: 3,
    mixExpenses: { paidShekel: 10, paidShekelLinked: 9, unpaidDollarOrphans: 5 }, expenseScopeGeneral: 15,
    projectsInMixStage: { "במיקס": 2, "מחכה למיקס": 4 }, mixStageWithoutEngineer: 4, completedVictorWithoutEngineerWork: 1,
    mixFollowUpTasks: 4, mixAgentAlertTypes: 0, pushMarkers: { mixReady: 6, payment: 6 }, reminderClaims: 149, lastPortalVisit: "2026-07-05", albumTracksMixMaster: { "לא התחיל": 5 },
  },
  findingsHe: [
    "כל 14 עבודות המיקס הן של סטיבן (מיקס + מאסטר, בדולרים); אין איש סאונד אחר במערכת.",
    "5 עבודות שהושלמו עדיין עם הערות פתוחות (בסך הכול 44 הערות פתוחות על עבודות שהושלמו).",
    "5 עבודות שהושלמו בלי קבצים סופיים לפרויקט; 3 מהן בלי אף גרסת מיקס.",
    "3 עבודות שהושלמו לא סומנו כשולמו ($550 עצמאית, $200, $150).",
    "9 תשלומים לסטיבן נרשמו בכספים בשקלים ביחס קבוע ($200 → ₪650), עם היקף הוצאה 'כללי' ולא 'מיקס / מאסטר'.",
    "5 הוצאות מיקס בדולרים לא-משולמות (5 / 50 / 3 / 30 / 300) מ-2026-06-29 לא מקושרות לשום עבודה — שאריות של סנכרון מחיר ישן; ועוד הוצאה אחת ₪590 ששולמה בלי עבודה מקושרת.",
    "סטטוס הגרסה אף פעם לא נקבע (כל 126 'בבדיקה') ומי שהעלה נרשם תמיד 'Steven' — גם כשהבעלים העלה.",
    "4 פרויקטים במצב 'מחכה למיקס' בלי עבודת מיקס; עבודת ויקטור אחת שהושלמה בפרויקט בלי עבודת מיקס.",
    "אין סוג Agent Alert למיקס; ביקור אחרון של סטיבן בפורטל שנרשם: 2026-07-05.",
  ],
} as const;

/** Files whose Mix / Steven semantics the Sunny contract encodes — internal; the test pins their fingerprints. */
export const MIX_REVIEWED_FILES = [
  "lib/sound-engineer-store.ts", "lib/mix-versions-store.ts", "lib/mix-comments-store.ts", "lib/mix-comment-attachments-store.ts", "lib/mix-targets-store.ts", "lib/mix-target-notes-store.ts",
  "lib/final-files-store.ts", "lib/final-file-upload.ts", "lib/mix-version-upload.ts", "lib/mix-version-project-copy.ts", "lib/riddim-numbering-pure.ts",
  "lib/steven-scope.ts", "lib/steven-completion.ts", "lib/steven-completed-pure.ts", "lib/steven-mix-reminder-pure.ts", "lib/steven-mix-reminder-notify.ts", "lib/steven-deadline-digest-pure.ts",
  "lib/steven-payment-notify.ts", "lib/steven-notes-notify.ts", "lib/steven-mix-ready-notify.ts", "lib/steven-notify.ts", "lib/final-files-batch-notify.ts",
  "components/project/MixSetupModal.tsx",
] as const;
export const MIX_REVIEWED_FINGERPRINTS: Readonly<Record<string, string>> = {
  "lib/sound-engineer-store.ts": "dfdfd06da5c2affbbbfab32ead4a957ec03e81a3ad608fe565aee342b2dc99e3",
  "lib/mix-versions-store.ts": "0b4f094089c59e38b9f0e1e202859db8912d39c9a9354461d05160910a85fd37",
  "lib/mix-comments-store.ts": "a8d0000efc0661a8d70d291ab30924e5a1391748d2a2570f7fe27f5a866196ce",
  "lib/mix-comment-attachments-store.ts": "d2023bde3c1c01407e44d362b8c8c40fc5ea25af5fd255d4e706ea8f1b062418",
  "lib/mix-targets-store.ts": "67e0165ac651417e4740040bc52e1d4536e5835e78290c1c3e40fc18e72fdb53",
  "lib/mix-target-notes-store.ts": "35e66c02ee0fcf3d630a34a1d3c29ed1194eecac271dabea4a2f9e529cc9233a",
  "lib/final-files-store.ts": "19f07a85406a74bbb686a0ebacf01e220777228d01177f1230b2e0f2a41711d2",
  "lib/final-file-upload.ts": "69946f8198df6dfa332df82ceb23610f208503fb4595c7f7919916082dfa847e",
  "lib/mix-version-upload.ts": "4944a1e23d03be33f5d17170325e5c0d73a0ff252c224c372bc6fc8508146d82",
  "lib/mix-version-project-copy.ts": "3179f46fa386928edac4039d9acb49763bb3f81707c5248df87c0b50042b5389",
  "lib/riddim-numbering-pure.ts": "340aa1926d06a008e08a12b1ee1a50334cdc9f4ded7b4320abe1ca801b11360f",
  "lib/steven-scope.ts": "3e7125366f5f85e926bf0628bf17a1ebeaf63554171b834d0ead8161b1ccad69",
  "lib/steven-completion.ts": "acf0f9d641be01c23e043051788c59be68d69c5761ace93fcd803bbec022763e",
  "lib/steven-completed-pure.ts": "51283cfdd67a4ae4970609fbf6890e11bb9603441e71e0df581ae45f104c1210",
  "lib/steven-mix-reminder-pure.ts": "c27e362804b40614a31a5eae112769419714615c86f6410862fa9ecc23c3af65",
  "lib/steven-mix-reminder-notify.ts": "45b9a2f3e4b4ddb111ff49fcdac63c36b8d42f8899e33ab1bef68f6c22ad38de",
  "lib/steven-deadline-digest-pure.ts": "f0220ca36a509657dccfb6d95fb7a9ad70e07aa34560ae38fa5bde9f91cf3a0e",
  "lib/steven-payment-notify.ts": "28d375971b8c3d416eb608e30005cdceff217997ea330cece1770183bfd77538",
  "lib/steven-notes-notify.ts": "a59a2f814cede62b7e6cd0ed5e3893a1ef72bd8a96094c823ef4e68ea3ce067f",
  "lib/steven-mix-ready-notify.ts": "537f49cf3822eaee02f2df7ac237ed345ae7b33d831bad0e17574ee42fb9383e",
  "lib/steven-notify.ts": "ff6383f70ada1e4aba4d6b99ed78168a35b1b642c920ce0e881a89b7344bc03b",
  "lib/final-files-batch-notify.ts": "8f93f9d090436f02555508eae8a9d714668e9a10d6c5c6ed562abe75f3125967",
  "components/project/MixSetupModal.tsx": "4fb835a64fefea97650c073066a78e2694d9920172a592479079fb38ca5db201",
};

/** Route families touching mix / engineer work (internal — the test re-discovers them). */
export const MIX_ROUTE_GROUPS = [
  { pattern: "^app/api/sound-engineer/", note: "Owner engineer / version / comment / attachment / riddim / final-file / work-material routes" },
  { pattern: "^app/api/supplier/steven/", note: "Steven's scoped supplier routes" },
] as const;

export const SECURITY_REVIEW = {
  enforcement: "every Owner route checks the Owner in-route; every Steven route checks the Steven role in-route AND resolves the work / version / comment to a work whose engineer is exactly 'Steven' (else 403). Steven never receives a storage path (opaque handles); Finance links, Owner notes and raw links are stripped.",
  findings: [
    "the 'Payment sent' push has no engineer check (known: SG_STEVEN_PAYMENT_WRONG_RECIPIENT)",
    "the payment-expense route converts ANY engineer work at Steven's fixed ratio (no engineer check) — Owner-only, a behavior gap not an exposure",
    "'Send notes' / 'Send to Steven' routes have no engineer check (Owner-only; would push Steven about another engineer's work)",
    "Steven can see price, paid amount and payment date of his works (intended, read-only)",
  ],
} as const;
