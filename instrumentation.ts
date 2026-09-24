/**
 * Next.js Instrumentation — runs once when the server starts.
 *
 * 1. Loads schedule config from Supabase (persistent across Railway redeploys).
 * 2. Schedules daily email reports using node-cron.
 * 3. Calls report functions DIRECTLY — no HTTP fetch, no port dependency.
 *    Works reliably on Railway and any other host.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Partner MCP connector staging service (connector-only): start NO scheduler, and block every outgoing
  // request except database reads + the connector's own OAuth / audit writes. Unset in production.
  if (process.env.REDBLOODS_MCP_ONLY === "true") {
    const { installMcpOnlyFetchGuard } = await import("@/lib/integrations/partner-mcp/mcp-only");
    installMcpOnlyFetchGuard(process.env.SUPABASE_URL ?? "https://invalid.invalid", (m) => console.warn(m));
    console.log("[mcp-only] connector-only mode — no schedulers started");
    return;
  }

  const { default: cron }                      = await import("node-cron");
  const { getRuntimeConfig, setRuntimeConfig, markSchedulerStarted, markCronTick, markSent } = await import("@/lib/reports/runtime-config");

  // ── Load config from Supabase on startup ─────────────────────────────────
  try {
    const { readReportConfig } = await import("@/lib/reports/monday-config");
    const stored = await readReportConfig();
    if (stored) {
      setRuntimeConfig(stored);
      console.log(`[reports] הגדרות נטענו מ-Supabase — בוקר: ${stored.morningTime} · ערב: ${stored.eveningTime}`);
    } else {
      const def = getRuntimeConfig();
      console.log(`[reports] ברירת מחדל — בוקר: ${def.morningTime} · ערב: ${def.eveningTime}`);
    }
  } catch (err) {
    console.warn("[reports] לא ניתן לטעון הגדרות:", err);
  }

  // ── Send helpers (call functions directly, no HTTP) ───────────────────────

  async function sendReport(type: "morning" | "evening"): Promise<void> {
    try {
      const { fetchReportData }    = await import("@/lib/reports/data");
      const { getRecommendations } = await import("@/lib/reports/ai");
      const { sendReportEmail, isEmailConfigured } = await import("@/lib/reports/email");

      if (!isEmailConfigured()) {
        console.warn(`[reports] אימייל לא מוגדר — דוח ${type} לא נשלח`);
        return;
      }

      const data = await fetchReportData();
      const recs = await getRecommendations(data, type);

      if (type === "morning") {
        const { generateMorningReport } = await import("@/lib/reports/templates");
        const report = generateMorningReport(data, recs);
        await sendReportEmail(report);
        markSent("morning");
        console.log(`[reports] ✓ דוח בוקר נשלח: ${report.subject}`);
      } else {
        const { generateEveningReport } = await import("@/lib/reports/templates");
        const report = generateEveningReport(data, recs);
        await sendReportEmail(report);
        markSent("evening");
        console.log(`[reports] ✓ דוח ערב נשלח: ${report.subject}`);
      }
    } catch (err) {
      console.error(`[reports] שגיאה בשליחת דוח ${type}:`, err);
    }
  }

  // ── Cron — fires every minute ─────────────────────────────────────────────

  const TZ       = "Asia/Jerusalem";
  const lastSent: Record<string, string> = {};

  async function maybeSend(type: "morning" | "evening"): Promise<void> {
    const config = getRuntimeConfig();
    const target = type === "morning" ? config.morningTime : config.eveningTime;

    const now   = new Date();
    const nowHM = now.toLocaleString("en-GB", {
      timeZone:  TZ,
      hour:      "2-digit",
      minute:    "2-digit",
      hour12:    false,
    });

    if (nowHM === target && lastSent[type] !== nowHM) {
      lastSent[type] = nowHM;
      console.log(`[reports] שולח דוח ${type} (${nowHM})`);
      await sendReport(type);
    }
  }

  cron.schedule("* * * * *", () => {
    markCronTick();
    maybeSend("morning");
    maybeSend("evening");
  }, { timezone: TZ });

  // ── Supplier upload notices — flush due coalesced batches (owner-only push) ──
  cron.schedule("* * * * *", async () => {
    try {
      const { flushDueVictorUploadNotices } = await import("@/lib/victor-upload-notify");
      await flushDueVictorUploadNotices();
    } catch (err) {
      console.error("[victor-upload-notify] flush tick failed:", err);
    }
    try {
      const { flushDueStevenUploadNotices } = await import("@/lib/steven-notify");
      await flushDueStevenUploadNotices();
    } catch (err) {
      console.error("[steven-notify] flush tick failed:", err);
    }
    // Fallback ONLY — the primary signal is the client's explicit
    // batch-complete call right after its upload loop finishes. This catches
    // an abandoned batch (tab closed/crash) so a real upload is never
    // silently un-notified.
    try {
      const { flushStaleFinalFilesBatches } = await import("@/lib/final-files-batch-notify");
      await flushStaleFinalFilesBatches();
    } catch (err) {
      console.error("[final-files-batch] flush tick failed:", err);
    }
  }, { timezone: TZ });

  // ── Shalev weekly sessions summary — Sunday 10:00–10:15 Asia/Jerusalem window ──
  // Same every-minute-tick + toLocaleString(timeZone) pattern as the reports
  // above (DST-safe — never a fixed UTC offset). A window (not a single minute)
  // means a missed 10:00 tick (redeploy/crash/restart) can still fire later in
  // the same window. The real duplicate-send guard is an atomic DB claim inside
  // the job itself (lib/shalev-weekly-notify.ts) — a redeploy, a stuck/crashed
  // attempt, or two overlapping cron instances can never both send.
  cron.schedule("* * * * *", async () => {
    try {
      const { isShalevWeeklyWindowOpen, runShalevWeeklyJob } = await import("@/lib/shalev-weekly-notify");
      if (isShalevWeeklyWindowOpen(new Date())) await runShalevWeeklyJob();
    } catch (err) {
      console.error("[shalev-weekly] cron tick failed:", err);
    }
  }, { timezone: TZ });

  // ── Shalev per-session pre-session reminder — fires ~3h before each of his
  // sessions (Asia/Jerusalem). Same every-minute-tick pattern as the jobs
  // above; the duplicate-send guard is the atomic DB claim inside the job
  // itself (lib/shalev-session-reminder-notify.ts), keyed per
  // session+date+start_time so a reschedule is handled automatically.
  cron.schedule("* * * * *", async () => {
    try {
      const { runShalevSessionReminderTick } = await import("@/lib/shalev-session-reminder-notify");
      await runShalevSessionReminderTick(new Date());
    } catch (err) {
      console.error("[shalev-session-reminder] cron tick failed:", err);
    }
  }, { timezone: TZ });

  // ── Shalev weekly-availability reminder — up to 3 conditional pushes
  // (Thu 12:00 / Thu 18:00 / Fri 09:00 Asia/Jerusalem), each skipped once a
  // valid ≥2-day submission exists for the active cycle. Same every-minute
  // tick pattern as the jobs above; the duplicate-send guard is the atomic
  // DB claim inside the job itself (lib/shalev-availability-reminder-notify.ts).
  cron.schedule("* * * * *", async () => {
    try {
      const { runShalevAvailabilityReminderTick } = await import("@/lib/shalev-availability-reminder-notify");
      await runShalevAvailabilityReminderTick(new Date());
    } catch (err) {
      console.error("[shalev-availability-reminder] cron tick failed:", err);
    }
  }, { timezone: TZ });

  // ── Week-strength agent alert — creates "השבוע הבא עדיין לא סגור" in the
  // Friday 10:00–10:15 Asia/Jerusalem window if next week isn't well-planned
  // yet (≥3 significant activities across ≥2 days). Every tick ALSO
  // re-checks any already-open alert and clears it the moment its week
  // becomes closed — cheap no-op when nothing is open, so this isn't tied to
  // next Friday. Same every-minute-tick pattern as the jobs above.
  cron.schedule("* * * * *", async () => {
    try {
      const { isWeekStrengthCheckWindowOpen } = await import("@/lib/week-strength-pure");
      const { checkWeekStrengthAndAlert, resolveWeekStrengthAlertsIfClosed } = await import("@/lib/week-strength-notify");
      if (isWeekStrengthCheckWindowOpen(new Date())) await checkWeekStrengthAndAlert();
      await resolveWeekStrengthAlertsIfClosed();
    } catch (err) {
      console.error("[week-strength] cron tick failed:", err);
    }
  }, { timezone: TZ });

  // ── Steven mix-notes reminder — every 5h after the owner clicks "Send
  // notes" (lib/steven-notes-notify.ts) until Steven uploads a new mix
  // version for that same work. Same every-minute-tick pattern as the jobs
  // above; the cadence/dedup guard is the atomic DB claim inside the job
  // itself (lib/steven-mix-reminder-notify.ts).
  cron.schedule("* * * * *", async () => {
    try {
      const { runStevenMixReminderTick } = await import("@/lib/steven-mix-reminder-notify");
      await runStevenMixReminderTick(new Date());
    } catch (err) {
      console.error("[steven-mix-reminder] cron tick failed:", err);
    }
  }, { timezone: TZ });

  // ── Steven deadline digest — once daily at 09:00 America/New_York (Steven is
  // in Maryland, NOT Israel — deliberately a different zone than every other
  // job in this file). Same every-minute-tick pattern as the jobs above; the
  // window check (09:00–09:15) and the daily dedup are both inside
  // runStevenDeadlineDigestTick / isDigestWindowOpen (DST-safe via Intl, never
  // a fixed UTC offset). On confirmed delivery to Steven, it also sends a
  // Hebrew confirmation push to the owner — see lib/steven-deadline-digest-notify.ts.
  cron.schedule("* * * * *", async () => {
    try {
      const { runStevenDeadlineDigestTick } = await import("@/lib/steven-deadline-digest-notify");
      await runStevenDeadlineDigestTick(new Date());
    } catch (err) {
      console.error("[steven-deadline-digest] cron tick failed:", err);
    }
  }, { timezone: "America/New_York" });

  // ── Owner weekly notification-bell reset — Friday 06:00–06:15 Asia/Jerusalem.
  // Deletes ONLY the Owner's rows in `notifications` (read + unread), so the
  // bell starts each week as a clean "what happened this week" feed. Never
  // touches agent_alerts, push_subscriptions, or any other recipient's rows —
  // see lib/owner-notifications-cleanup.ts for the exact scope. A DELETE is
  // naturally idempotent, so (unlike the push-sending jobs above) no atomic
  // claim/dedup guard is needed — a repeat tick in the same window just
  // deletes 0 rows the second time.
  cron.schedule("* * * * *", async () => {
    try {
      const { isOwnerWeeklyCleanupWindowOpen, cleanupOwnerNotifications } = await import("@/lib/owner-notifications-cleanup");
      if (isOwnerWeeklyCleanupWindowOpen(new Date())) {
        const { deleted } = await cleanupOwnerNotifications();
        if (deleted > 0) console.log(`[owner-notifications-cleanup] deleted ${deleted} row(s)`);
      }
    } catch (err) {
      console.error("[owner-notifications-cleanup] cron tick failed:", err);
    }
  }, { timezone: TZ });

  markSchedulerStarted();
  console.log("[reports] Scheduler הופעל ✓");
}
