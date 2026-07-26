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

  markSchedulerStarted();
  console.log("[reports] Scheduler הופעל ✓");
}
