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
  /** a page-load / background writer never sends push unless it is an explicit scheduled push job */
  sendsPush: boolean;
  sunny: "NEVER_TRIGGERS";
  noteEn: string;
}
const W = (w: Omit<BackgroundWriter, "sunny">): BackgroundWriter => ({ ...w, sunny: "NEVER_TRIGGERS" });

export const BACKGROUND_WRITERS: readonly BackgroundWriter[] = [
  W({ id: "SESSION_AUTO_MARK", trigger: "PAGE_LOAD", routes: ["app/api/sessions/auto-mark/route.ts"], jobs: ["PAGE_LOAD_WRITES"], writesEn: "passed planned sessions → held (device clock)", sendsPush: false, noteEn: "AppShell on load; the device clock decides — never proof a session happened" }),
  W({ id: "TASKS_GOOGLE_SYNC", trigger: "PAGE_LOAD", routes: ["app/api/calendar/tasks/sync/route.ts"], jobs: ["PAGE_LOAD_WRITES"], writesEn: "tasks completed in Google Tasks → בוצע", sendsPush: false, noteEn: "Tasks page on load" }),
  W({ id: "PUSH_RESUBSCRIBE", trigger: "PAGE_LOAD", routes: ["app/api/push/subscribe/route.ts"], jobs: ["PAGE_LOAD_WRITES"], writesEn: "the device push subscription", sendsPush: false, noteEn: "PushManager; never calls /api/push/check and never sends a push" }),
  W({ id: "NOTIFICATIONS_HOUSEKEEPING", trigger: "GET_THAT_WRITES", routes: ["app/api/notifications/route.ts"], jobs: ["PAGE_LOAD_WRITES"], writesEn: "notification housekeeping on list", sendsPush: false, noteEn: "the bell's list read" }),
  W({ id: "PORTAL_PRESENCE", trigger: "PORTAL_HEARTBEAT", routes: ["app/api/label/artists/[id]/ping/route.ts", "app/api/red-artists/ping/route.ts", "app/api/red-artists/cleantone/ping/route.ts", "app/api/supplier/steven/ping/route.ts", "app/api/vendor/victor/ping/route.ts"], jobs: [], writesEn: "last-seen presence settings", sendsPush: false, noteEn: "portal heartbeat" }),
  W({ id: "AGENT_CHECK", trigger: "EXTERNAL_CRON", routes: ["app/api/agent/check/route.ts"], jobs: ["AGENT_CHECK_ROUTE", "AGENT_SNAPSHOT_READ"], writesEn: "holiday agent alerts / markers", sendsPush: false, noteEn: "alert rules are off; context only" }),
  W({ id: "SESSION_CALENDAR_PULL", trigger: "EXTERNAL_CRON", routes: ["app/api/sessions/calendar-pull/route.ts"], jobs: ["SESSION_CALENDAR_PULL"], writesEn: "session times copied from moved calendar events", sendsPush: false, noteEn: "calendar → Redbloods only" }),
  W({ id: "PUSH_CRON", trigger: "EXTERNAL_CRON", routes: ["app/api/push/cron/route.ts"], jobs: ["PUSH_CRON_ROUTE", "PUSH_STATUS_READ"], writesEn: "scheduled pushes + markers", sendsPush: true, noteEn: "scheduled; Sunny never triggers a push" }),
  W({ id: "CALENDAR_OAUTH_CALLBACK", trigger: "OAUTH_CALLBACK", routes: ["app/api/calendar/callback/route.ts"], jobs: [], writesEn: "the Google token (credential)", sendsPush: false, noteEn: "security — never Sunny" }),
  W({ id: "CLIENTS_BACKFILL", trigger: "GET_THAT_WRITES", routes: ["app/api/projects/sync-artists/route.ts"], jobs: [], writesEn: "missing clients from project artists", sendsPush: false, noteEn: "one-off, no screen" }),
  W({ id: "DROPBOX_FOLDER_BACKFILL", trigger: "GET_THAT_WRITES", routes: ["app/api/projects/backfill-dropbox-folder/route.ts"], jobs: [], writesEn: "project Dropbox folder paths", sendsPush: false, noteEn: "one-off, no screen" }),
  W({ id: "IN_PROCESS_SCHEDULER", trigger: "IN_PROCESS_SCHEDULE", routes: [], jobs: ["REPORT_EMAILS", "UPLOAD_NOTICE_BATCHES", "SHALEV_WEEKLY_SUMMARY", "SHALEV_SESSION_REMINDER", "AVAILABILITY_REMINDER", "WEEK_STRENGTH", "STEVEN_MIX_REMINDER", "STEVEN_DEADLINE_DIGEST", "OWNER_BELL_RESET"], writesEn: "emails / pushes / markers / alerts / bell reset", sendsPush: true, noteEn: "instrumentation.ts; runs in any server process with production keys (never run a local server)" }),
];
