/**
 * Next.js Instrumentation — runs once when the server starts.
 *
 * 1. Loads schedule config from Monday.com (persistent across Railway redeploys).
 * 2. Schedules daily email reports using node-cron.
 * 3. Calls report functions DIRECTLY — no HTTP fetch, no port dependency.
 *    Works reliably on Railway and any other host.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { default: cron }                      = await import("node-cron");
  const { getRuntimeConfig, setRuntimeConfig, markSchedulerStarted, markCronTick, markSent } = await import("@/lib/reports/runtime-config");

  // ── Load config from Monday.com on startup ────────────────────────────────
  try {
    const { readMondayConfig } = await import("@/lib/reports/monday-config");
    const stored = await readMondayConfig();
    if (stored) {
      setRuntimeConfig(stored);
      console.log(`[reports] הגדרות נטענו מ-Monday.com — בוקר: ${stored.morningTime} · ערב: ${stored.eveningTime}`);
    } else {
      const def = getRuntimeConfig();
      console.log(`[reports] ברירת מחדל — בוקר: ${def.morningTime} · ערב: ${def.eveningTime}`);
    }
  } catch (err) {
    console.warn("[reports] לא ניתן לטעון הגדרות מ-Monday.com:", err);
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

  markSchedulerStarted();
  console.log("[reports] Scheduler הופעל ✓");
}
