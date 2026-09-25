/**
 * Sunny System Awareness — the SETTINGS FAMILY REGISTRY. Redbloods keeps a lot of real business / system state in the
 * key-value `settings` store (prices, delivery, Victor salary config, balance-cycle anchors, report schedule, goals,
 * availability, push dedupe markers, portal presence, Sunny's own baseline …). Settings are NOT a Sunny blind spot:
 * every key family is classified here, and scripts/test-sunny-settings.tsx fails when code or production introduces a
 * family that is not.
 *
 *   A  BUSINESS / SYSTEM INFORMATION   → read (values, secrets inside reduced to booleans)
 *   B  AUTHENTICATION SECRET           → NEVER read, not even the key (only "exists / connected" elsewhere)
 *   C  INTERNAL STATE WITH MEANING     → read (what was sent / when / pending), values scrubbed + bounded
 *   D  PURE IMPLEMENTATION DETAIL      → documented, not read (no system meaning)
 *
 * The reader (lib/partner/settings/reader.ts) queries ONLY the families listed here with read !== "NEVER_SECRET" / "NOT_READ",
 * one bounded prefix / exact key at a time — it is not a generic settings reader.
 * `internal` (match pattern + query) exists for the reader + tests only and is never served.
 */

export type SettingsClass = "A_BUSINESS_SYSTEM_INFORMATION" | "B_AUTHENTICATION_SECRET" | "C_INTERNAL_STATE_WITH_MEANING" | "D_PURE_IMPLEMENTATION_DETAIL";
export type SettingsRead = "PROJECT_DETAIL" | "SYSTEM_SETTINGS" | "NEVER_SECRET" | "NOT_READ";

export interface SettingsFamily {
  id: string;
  class: SettingsClass;
  domain: string;
  meaning: string;
  /** Who / what writes it. */
  writtenBy: string;
  /** Where Sunny reads it (PROJECT_DETAIL = project_view; SYSTEM_SETTINGS = system_settings capability). */
  read: SettingsRead;
  /** Links a value to a project (PROJECT) or to an engineer / Victor work of a project (WORK). */
  link: "PROJECT" | "WORK" | "SHOW" | "SESSION" | "ARTIST" | "NONE";
  internal: { match: string; query: { like: string } | { in: readonly string[] } | null };
}

const F = (id: string, cls: SettingsClass, domain: string, meaning: string, writtenBy: string, read: SettingsRead, link: SettingsFamily["link"], match: string, query: SettingsFamily["internal"]["query"]): SettingsFamily =>
  ({ id, class: cls, domain, meaning, writtenBy, read, link, internal: { match, query } });
const A: SettingsClass = "A_BUSINESS_SYSTEM_INFORMATION", B: SettingsClass = "B_AUTHENTICATION_SECRET", C: SettingsClass = "C_INTERNAL_STATE_WITH_MEANING", D: SettingsClass = "D_PURE_IMPLEMENTATION_DETAIL";

export const SETTINGS_FAMILIES: readonly SettingsFamily[] = [
  // ── A: business / system information ──
  F("PROJECT_FINANCE", A, "FINANCE", "A project's agreed price, currency, finance exception (+ reason / date), clip price, managed clip production and financial notes", "Owner (price / exception / clip), proposal conversion, clip flow", "PROJECT_DETAIL", "PROJECT", "^finance_", { like: "finance_" }),
  F("PROJECT_DELIVERY", A, "DELIVERY", "A project's delivery folder, status and delivered date (the share link is reduced to a boolean)", "Owner (legacy drawer)", "PROJECT_DETAIL", "PROJECT", "^delivery_", { like: "delivery_" }),
  F("PROJECT_SESSION_LIMIT", A, "SESSIONS", "How many sessions a project was sold with", "Owner", "PROJECT_DETAIL", "PROJECT", "^session_limit_", { like: "session_limit_" }),
  F("ALBUM_FINANCE_LEGACY", A, "ALBUMS", "Legacy album finance (agreed / payments / expenses) — no UI caller today", "old album finance route", "PROJECT_DETAIL", "PROJECT", "^album_finance_", { like: "album_finance_" }),
  F("ALBUM_PREVIOUS_SYSTEM_INFO", A, "ALBUMS", "Per-song figures copied from the previous (Monday) system", "Owner", "PROJECT_DETAIL", "PROJECT", "^album_prev_info_", { like: "album_prev_info_" }),
  F("PROJECT_COVER", A, "PROJECTS", "A project's cover theme / image", "Owner", "PROJECT_DETAIL", "PROJECT", "^project_cover_", { like: "project_cover_" }),
  F("STEVEN_FINAL_FILES_REQUESTED_PROJECT", A, "STEVEN", "Steven was asked for final files for this project (written when his last work was approved; cleared when a new work is sent)", "Steven completion flow", "PROJECT_DETAIL", "PROJECT", "^steven_final_files_requested_project:", { like: "steven_final_files_requested_project:" }),
  F("STEVEN_FINAL_FILES_REQUESTED_WORK", A, "STEVEN", "Steven was asked for final files for this engineer work", "Steven completion flow", "PROJECT_DETAIL", "WORK", "^steven_final_files_requested:", { like: "steven_final_files_requested:" }),
  F("VICTOR_SALARY_SETTINGS", A, "VICTOR", "Victor's salary configuration (amount, currency, pay day, stuck-after days …)", "Owner (Victor settings)", "SYSTEM_SETTINGS", "NONE", "^vendor_victor_settings$", { in: ["vendor_victor_settings"] }),
  F("VICTOR_SALARY_OVERRIDES", A, "VICTOR", "Per-month Victor salary amount / status overrides", "Owner", "SYSTEM_SETTINGS", "NONE", "^vendor_victor_salary_(status_)?overrides$", { in: ["vendor_victor_salary_overrides", "vendor_victor_salary_status_overrides"] }),
  F("VICTOR_LEGACY_MONTH_PAYMENT", A, "VICTOR", "Legacy per-month Victor payment record (evidence only; the canonical salary status wins)", "old Victor page", "SYSTEM_SETTINGS", "NONE", "^vendor_victor_payment_", { like: "vendor_victor_payment_" }),
  F("ARTIST_BALANCE_CYCLE_ANCHOR", A, "ARTIST_BALANCES", "The date a label artist's balance cycles are anchored to", "Owner (balance cycles)", "SYSTEM_SETTINGS", "ARTIST", "^balance_cycle_anchor:", { like: "balance_cycle_anchor:" }),
  F("ARTIST_BALANCE_FIRST_CYCLE", A, "ARTIST_BALANCES", "The effective start of a label artist's first balance cycle", "Owner (balance cycles)", "SYSTEM_SETTINGS", "ARTIST", "^balance_cycle_first_cycle_bootstrap:", { like: "balance_cycle_first_cycle_bootstrap:" }),
  F("REPORT_SCHEDULE", A, "REPORTS", "The morning / evening email report times (the weekly report has no schedule)", "Owner", "SYSTEM_SETTINGS", "NONE", "^report_schedule$", { in: ["report_schedule"] }),
  F("MAINTENANCE_MODE", A, "PLATFORM_ACCESS", "Whether the app is in maintenance mode (and since when)", "Owner", "SYSTEM_SETTINGS", "NONE", "^maintenance_mode$", { in: ["maintenance_mode"] }),
  F("BUSINESS_GOALS", A, "COMPANY_OVERVIEW", "Business goals (monthly revenue, weekly sessions, monthly Victor, monthly completions)", "Owner (old agent goals)", "SYSTEM_SETTINGS", "NONE", "^goal_", { like: "goal_" }),
  F("ARTIST_WEEKLY_AVAILABILITY", A, "ARTIST_PORTALS", "An artist's weekly availability for sessions (Shalev and other portal artists)", "the artist in their portal", "SYSTEM_SETTINGS", "ARTIST", "^(shalev_weekly_availability$|weekly_availability_)", { like: "%weekly_availability%" }),
  // ── C: internal state with system meaning ──
  F("SUNNY_CHANGE_BASELINE", C, "SUNNY_CORE", "Sunny's last company snapshot used to detect what changed", "Partner change detection", "SYSTEM_SETTINGS", "NONE", "^partner_change_baseline$", { in: ["partner_change_baseline"] }),
  F("AGENT_PUSH_COOLDOWN", C, "AGENT_ALERTS", "When the old agent last pushed a given alert type (cooldown)", "old agent", "SYSTEM_SETTINGS", "NONE", "^push_cooldown_", { like: "push_cooldown_" }),
  F("LEGACY_PUSH_CHECK", C, "PUSH_NOTIFICATIONS", "When the legacy push check last ran", "legacy push check", "SYSTEM_SETTINGS", "NONE", "^push_last_check$", { in: ["push_last_check"] }),
  F("SHOW_SENT_TO_ARTIST", C, "SHOWS", "A show was sent (pushed) to the artist — fingerprint + when (dedupe claim)", "show notify", "SYSTEM_SETTINGS", "SHOW", "^show_notify:", { like: "show_notify:" }),
  F("SHOW_SENT_TO_DJ", C, "LABEL_DJ", "A show was sent (pushed) to the DJ — fingerprint + when (dedupe claim)", "DJ show notify", "SYSTEM_SETTINGS", "SHOW", "^dj_show_notify:", { like: "dj_show_notify:" }),
  F("SHALEV_SESSION_REMINDER_SENT", C, "ARTIST_PORTALS", "A session reminder push was sent to Shalev for a session / time", "session reminder cron", "SYSTEM_SETTINGS", "SESSION", "^shalev_session_reminder:", { like: "shalev_session_reminder:" }),
  F("SHALEV_WEEKLY_SESSIONS_SENT", C, "ARTIST_PORTALS", "The weekly sessions summary push was sent to Shalev for a week", "weekly cron", "SYSTEM_SETTINGS", "NONE", "^shalev_weekly_sessions:", { like: "shalev_weekly_sessions:" }),
  F("AVAILABILITY_REMINDER_SENT", C, "ARTIST_PORTALS", "An availability reminder push was sent to an artist for a week / slot", "availability reminder cron", "SYSTEM_SETTINGS", "ARTIST", "^availability_reminder:", { like: "availability_reminder:" }),
  F("STEVEN_DEADLINE_DIGEST_SENT", C, "STEVEN", "The daily Steven deadline digest was sent for a day", "digest cron", "SYSTEM_SETTINGS", "NONE", "^steven_deadline_digest:", { like: "steven_deadline_digest:" }),
  F("STEVEN_MIX_REMINDER_STATE", C, "STEVEN", "Steven mix reminder cycle / sends for a work", "mix reminder cron", "SYSTEM_SETTINGS", "WORK", "^steven_mix_reminder_(cycle|send):", { like: "steven_mix_reminder_%" }),
  F("PUSH_SENT_ONCE_MARKERS", C, "PUSH_NOTIFICATIONS", "One-time push markers per work: Steven mix ready / Steven payment / Victor work completed", "those push senders", "SYSTEM_SETTINGS", "WORK", "^(steven_mix_ready_pushed_|steven_payment_pushed_|victor_work_completed_pushed_)", { like: "%_pushed_%" }),
  F("PENDING_UPLOAD_NOTIFICATIONS", C, "PUSH_NOTIFICATIONS", "Uploads waiting to be batched into one Owner push (Steven / Victor uploads)", "upload notify", "SYSTEM_SETTINGS", "WORK", "^(steven_upload_pending_|victor_upload_pending_)", { like: "%_upload_pending_%" }),
  F("PENDING_FINAL_FILE_BATCHES", C, "PUSH_NOTIFICATIONS", "Final-file upload batches waiting for their Owner push", "final files batch notify", "SYSTEM_SETTINGS", "WORK", "^final_files_batch:", { like: "final_files_batch:" }),
  F("PORTAL_PRESENCE", C, "ARTIST_PORTALS", "When Steven / Victor / Shalev / Avi / CLEANTONE last entered their portal (presence push dedupe)", "presence notify", "SYSTEM_SETTINGS", "NONE", "^(steven_login_seen|steven_visit_last|victor_visit_last|shalev_entry_last|avi_entry_last|cleantone_entry_last)$", { in: ["steven_login_seen", "steven_visit_last", "victor_visit_last", "shalev_entry_last", "avi_entry_last", "cleantone_entry_last"] }),
  // ── B: authentication secrets (never read) ──
  F("GOOGLE_CALENDAR_CREDENTIAL", B, "GOOGLE_CALENDAR", "Google Calendar OAuth credential — Sunny knows only whether the calendar is connected", "OAuth connect flow", "NEVER_SECRET", "NONE", "^google_calendar_token$", null),
  F("DROPBOX_CREDENTIAL", B, "FILES_DROPBOX", "Dropbox OAuth credential — Sunny knows only whether Dropbox is connected", "Dropbox connect flow", "NEVER_SECRET", "NONE", "^dropbox_tokens$", null),
  F("PUBLIC_SHARE_TOKENS", B, "FILES_DROPBOX", "Public share-page tokens (the key itself is the bearer token that opens a file)", "project file upload", "NEVER_SECRET", "NONE", "^share_token_", null),
  // ── D: pure implementation detail ──
  F("VICTOR_AVATAR", D, "VICTOR", "Victor's avatar image choice in his portal (display only)", "Victor", "NOT_READ", "NONE", "^victor_avatar$", null),
];

/** Production snapshot (2026-09-25, keys only — values never read): every key family that exists. */
export const PRODUCTION_SETTING_FAMILIES_20260925 = [
  "album_finance_<id>", "album_prev_info_<id>", "availability_reminder:shalev-tasama:<date>:fri-0900",
  "availability_reminder:shalev-tasama:<date>:thu-1200", "availability_reminder:shalev-tasama:<date>:thu-1800", "avi_entry_last", "balance_cycle_anchor:<id>",
  "balance_cycle_first_cycle_bootstrap:<id>", "cleantone_entry_last", "delivery___test_token_check__", "delivery_<id>", "dropbox_tokens", "finance_<id>",
  "google_calendar_token", "maintenance_mode", "partner_change_baseline", "project_cover_<id>", "push_cooldown_overdue_deadline", "push_cooldown_payment_overdue",
  "push_cooldown_victor_stuck", "push_last_check", "report_schedule", "session_limit_<num>", "shalev_entry_last", "shalev_session_reminder:<id>:<date>:16:00",
  "shalev_session_reminder:<id>:<date>:17:00", "shalev_weekly_availability", "shalev_weekly_sessions:<date>", "share_token_<hex>",
] as const;

/** Every repository file that touches the settings store — a NEW file forces a review of this registry. */
export const SETTINGS_ACCESS_FILES = [
  "app/api/agent/check/route.ts",
  "app/api/album-finance/route.ts",
  "app/api/album-prev-info/route.ts",
  "app/api/calendar/debug/route.ts",
  "app/api/delivery/route.ts",
  "app/api/delivery/upload/route.ts",
  "app/api/dropbox/status/route.ts",
  "app/api/projects/[id]/clip/payments/route.ts",
  "app/api/projects/[id]/clip/route.ts",
  "app/api/projects/[id]/clip/send/route.ts",
  "app/api/projects/[id]/route.ts",
  "app/api/proposals/[id]/convert/route.ts",
  "app/api/push/check/route.ts",
  "app/api/sessions/route.ts",
  "app/api/transactions/route.ts",
  "app/share/[token]/page.tsx",
  "lib/agent/goals.ts",
  "lib/agent/notifications.ts",
  "lib/agent/snapshot.ts",
  "lib/artist-balance-cycles-store.ts",
  "lib/avi-presence-notify.ts",
  "lib/cleantone-presence-notify.ts",
  "lib/clip-production.ts",
  "lib/coo/readers.ts",
  "lib/dj-show-notify.ts",
  "lib/dropbox-token.ts",
  "lib/final-files-batch-notify.ts",
  "lib/google-calendar.ts",
  "lib/maintenance.ts",
  "lib/partner/baseline/store.ts",
  "lib/project-cover-store.ts",
  "lib/project-file-commit.ts",
  "lib/projects-sort-meta.ts",
  "lib/red-artists/availability.ts",
  "lib/reports/monday-config.ts",
  "lib/shalev-availability-reminder-notify.ts",
  "lib/shalev-presence-notify.ts",
  "lib/shalev-session-reminder-notify.ts",
  "lib/shalev-weekly-notify.ts",
  "lib/show-notify.ts",
  "lib/sound-engineer-store.ts",
  "lib/steven-completion.ts",
  "lib/steven-deadline-digest-notify.ts",
  "lib/steven-mix-ready-notify.ts",
  "lib/steven-mix-reminder-notify.ts",
  "lib/steven-notify.ts",
  "lib/steven-payment-notify.ts",
  "lib/vendor-store.ts",
  "lib/victor-avatar.ts",
  "lib/victor-completed-notify.ts",
  "lib/victor-presence-notify.ts",
  "lib/victor-upload-notify.ts",
] as const;

export function familyOfKey(key: string): SettingsFamily | null {
  // most specific first (longer match patterns win: e.g. …_requested_project: before …_requested:)
  const sorted = [...SETTINGS_FAMILIES].sort((a, b) => b.internal.match.length - a.internal.match.length);
  return sorted.find((f) => new RegExp(f.internal.match).test(key)) ?? null;
}

export function validateSettingsFamilies(o: { domainIds: readonly string[] }): string[] {
  const e: string[] = [];
  const ids = new Set<string>();
  for (const f of SETTINGS_FAMILIES) {
    if (ids.has(f.id)) e.push(`duplicate settings family ${f.id}`);
    ids.add(f.id);
    if (!o.domainIds.includes(f.domain)) e.push(`${f.id}: unknown domain ${f.domain}`);
    if (f.class === "B_AUTHENTICATION_SECRET" && (f.read !== "NEVER_SECRET" || f.internal.query !== null)) e.push(`${f.id}: a secret family must never be queried`);
    if (f.read === "NEVER_SECRET" && f.class !== "B_AUTHENTICATION_SECRET") e.push(`${f.id}: NEVER_SECRET is only for authentication secrets`);
    if ((f.class === "A_BUSINESS_SYSTEM_INFORMATION" || f.class === "C_INTERNAL_STATE_WITH_MEANING") && (f.read === "NOT_READ" || f.read === "NEVER_SECRET")) e.push(`${f.id}: A / C families must be readable by Sunny`);
    if (f.read === "SYSTEM_SETTINGS" && !f.internal.query) e.push(`${f.id}: readable family without a bounded query`);
  }
  return e;
}
