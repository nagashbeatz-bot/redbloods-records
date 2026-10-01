/**
 * SUNNY UNIVERSAL ACTION LAYER — background and page-load writers (guard G4).
 *
 * Writes that happen without a deliberate business decision: scheduled jobs, external crons, OAuth callbacks, GET
 * handlers that write, and writes a page makes when the Boss opens it. Each one is classified so Sunny can tell the
 * Boss's decisions apart from automatic changes, and so no plan ever triggers one. Push is never sent on page load.
 */
export type WriterTrigger = "PAGE_LOAD" | "IN_PROCESS_SCHEDULE" | "EXTERNAL_CRON" | "OAUTH_CALLBACK" | "GET_THAT_WRITES" | "PORTAL_HEARTBEAT";
export interface BackgroundWriter {
  id: string;
  trigger: WriterTrigger;
  /** route files involved (internal) */
  routes: readonly string[];
  /** BACKGROUND_JOBS ids this writer corresponds to */
  jobs: readonly string[];
  writesEn: string;
  /** a page-load / background writer never sends push unless it is an explicit scheduled push job, or the portal
   *  presence heartbeat through its one-push-per-real-visit claim (guard G4b: must equal the route's PUSH effect) */
  sendsPush: boolean;
  /** Set when a push sender is reachable in the scanned code but never fires for this writer (a switched-off flag, or
   *  a sender used only by another operation of the same module) — sendsPush stays false and this names why. */
  pushGatedOff?: string;
  sunny: "NEVER_TRIGGERS";
  noteEn: string;
}
const W = (w: Omit<BackgroundWriter, "sunny">): BackgroundWriter => ({ ...w, sunny: "NEVER_TRIGGERS" });

/**
 * Page-driven POSTs that do NOT write (a read carried by POST). Guard G4b accepts them next to BACKGROUND_WRITERS;
 * anything else a page fires from an effect must be a classified background writer.
 */
export const PAGE_LOAD_READ_POSTS: Readonly<Record<string, string>> = {
  "app/api/calendar/check-slot/route.ts": "a calendar availability read carried by POST (ProjectDrawer checks a chosen slot); writes nothing",
};

export const BACKGROUND_WRITERS: readonly BackgroundWriter[] = [
  W({ id: "TASKS_GOOGLE_SYNC", trigger: "PAGE_LOAD", routes: ["app/api/calendar/tasks/sync/route.ts"], jobs: ["PAGE_LOAD_WRITES"], writesEn: "tasks completed in Google Tasks → בוצע", sendsPush: false, noteEn: "Tasks page on load" }),
  W({ id: "PUSH_RESUBSCRIBE", trigger: "PAGE_LOAD", routes: ["app/api/push/subscribe/route.ts"], jobs: ["PAGE_LOAD_WRITES"], writesEn: "the device push subscription", sendsPush: false, noteEn: "PushManager; never calls /api/push/check and never sends a push" }),
  W({ id: "PORTAL_PRESENCE", trigger: "PORTAL_HEARTBEAT", routes: ["app/api/label/artists/[id]/ping/route.ts", "app/api/red-artists/ping/route.ts", "app/api/red-artists/cleantone/ping/route.ts", "app/api/supplier/steven/ping/route.ts", "app/api/vendor/victor/ping/route.ts"], jobs: [], writesEn: "portal last-seen (portal_last_seen:<portal>, throttled 60 s) + the visit presence-push claim (portal_visit_push:<portal>)", sendsPush: true, noteEn: "the portal user's OWN ping on open + a 5-minute visible-page heartbeat (Shalev / Avi / CLEANTONE / Steven / Victor; never the Owner). Owner decision Q1 (2026-09-27): ONE Owner push per REAL visit only — a new visit = no last-seen for 30 minutes, claimed atomically (several tabs → one push), marked sent only after delivery; a refresh, in-portal navigation, a re-render or a heartbeat never pushes. The only page-driven writer allowed to push, and only through that claim" }),
  W({ id: "SKETCH_DURATION_LEARN", trigger: "PAGE_LOAD", routes: ["app/api/red-artists/sketches/[id]/duration/route.ts", "app/api/label/artists/[id]/sketches/[sketchId]/duration/route.ts"], jobs: ["PAGE_LOAD_WRITES"], writesEn: "a sketch version's duration in the sketch manifest (learned from the player)", sendsPush: false, noteEn: "ArtistPortalPage: when the global player knows the playing sketch's duration and none is stored, it saves it once per file per session — playback, not a decision; never Projects" }),
  W({ id: "AGENT_CHECK", trigger: "EXTERNAL_CRON", routes: ["app/api/agent/check/route.ts"], jobs: ["AGENT_CHECK_ROUTE", "AGENT_SNAPSHOT_READ"], writesEn: "holiday agent alerts / markers", sendsPush: false, pushGatedOff: "the agent-alert push (P_AGENT_ALERTS, DISABLED) is reachable only after the AGENT_ALERT_RULES_ENABLED check, which is false", noteEn: "alert rules are off; context only" }),
  W({ id: "SESSION_AUTO_MARK", trigger: "IN_PROCESS_SCHEDULE", routes: [], jobs: ["SESSION_AUTO_MARK"], writesEn: "a planned session (סשן / ניקוי מיקס / צילום קליפ, no show link) whose real end passed → התקיים, status_source AUTO_MARK (guarded: only while still מתוכנן)", sendsPush: false, noteEn: "Owner decision 2026-10-01: server cron only (instrumentation.ts → lib/writes/sessions autoMarkPassedSessions), never a page load; never a show rehearsal / rehearsal (D6); AUTO_MARK is not the Owner's confirmation" }),
  W({ id: "SESSION_CALENDAR_PULL", trigger: "EXTERNAL_CRON", routes: ["app/api/sessions/calendar-pull/route.ts"], jobs: ["SESSION_CALENDAR_PULL"], writesEn: "session date / times copied from moved calendar events (never a status — A3)", sendsPush: false, pushGatedOff: "the shared session writer module can push only when a session is CREATED (Shalev session push); the pull only calls updateSession, which never pushes", noteEn: "calendar → Redbloods only, through updateSession(origin CALENDAR_PULL); a held session whose event moved to the future is reported as a statusConflict, never reverted; an API error is reported apart from a missing event" }),
  W({ id: "PUSH_CRON", trigger: "EXTERNAL_CRON", routes: ["app/api/push/cron/route.ts"], jobs: ["PUSH_CRON_ROUTE", "PUSH_STATUS_READ"], writesEn: "per-day push claims (push_cron:<type>:<Israel day>)", sendsPush: true, noteEn: "external scheduler with the cron secret; production-only (pushAllowed); Israel day / hour; hidden / completed / cancelled / paused projects never overdue; overdue income per currency; each type at most once per Israel day (shared with the legacy check), sent only after delivery; Victor stuck computed with the app's rule and returned, NEVER pushed (Owner decision Q3, 2026-09-27); Sunny never triggers a push" }),
  W({ id: "CALENDAR_OAUTH_CALLBACK", trigger: "OAUTH_CALLBACK", routes: ["app/api/calendar/callback/route.ts"], jobs: [], writesEn: "the Google token (credential)", sendsPush: false, noteEn: "security — never Sunny" }),
  W({ id: "CLIENTS_BACKFILL", trigger: "GET_THAT_WRITES", routes: ["app/api/projects/sync-artists/route.ts"], jobs: [], writesEn: "missing clients from project artists", sendsPush: false, noteEn: "one-off, no screen" }),
  W({ id: "DROPBOX_FOLDER_BACKFILL", trigger: "GET_THAT_WRITES", routes: ["app/api/projects/backfill-dropbox-folder/route.ts"], jobs: [], writesEn: "project Dropbox folder paths", sendsPush: false, noteEn: "one-off, no screen" }),
  W({ id: "IN_PROCESS_SCHEDULER", trigger: "IN_PROCESS_SCHEDULE", routes: [], jobs: ["REPORT_EMAILS", "UPLOAD_NOTICE_BATCHES", "SHALEV_WEEKLY_SUMMARY", "SHALEV_SESSION_REMINDER", "AVAILABILITY_REMINDER", "WEEK_STRENGTH", "STEVEN_MIX_REMINDER", "STEVEN_DEADLINE_DIGEST", "OWNER_BELL_RESET"], writesEn: "emails / pushes / delivery claims / alerts / bell reset", sendsPush: true, noteEn: "instrumentation.ts; runs in any server process with production keys (never run a local server). Report emails: one durable claim per type per Israel day (report_email:<type>:<day>). Upload-notice batches: claimed (compare-and-swap) before the push, removed only after delivery, a failure kept as a durable failed row" }),
];
