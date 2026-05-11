/**
 * Next.js Instrumentation — runs once when the server starts.
 *
 * Schedules the daily email reports using node-cron.
 * The cron fires every minute and re-reads the config file each time,
 * so time changes made via /setup/reports take effect without a restart.
 */

export async function register() {
  // Only run in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { default: cron }  = await import("node-cron");
  const { getReportConfig } = await import("@/lib/reports/config");

  const BASE_URL = process.env.REPORTS_BASE_URL ?? "http://localhost:3000";
  const TZ       = "Asia/Jerusalem";

  // Track the last minute we sent each type to avoid double-sends
  const lastSent: Record<string, string> = {};

  async function maybeSend(type: "morning" | "evening"): Promise<void> {
    try {
      const config = getReportConfig();
      const target = type === "morning" ? config.morningTime : config.eveningTime;

      // Current time in Jerusalem as HH:MM
      const now   = new Date();
      const nowHM = now.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

      if (nowHM === target && lastSent[type] !== nowHM) {
        lastSent[type] = nowHM;
        console.log(`[reports] שולח דוח ${type} (${nowHM})`);
        const res  = await fetch(`${BASE_URL}/api/reports/${type}`, { method: "POST" });
        const data = await res.json() as { ok: boolean; subject?: string; error?: string };
        if (data.ok) {
          console.log(`[reports] ✓ נשלח: ${data.subject ?? type}`);
        } else {
          console.error(`[reports] ✗ שגיאה: ${data.error}`);
        }
      }
    } catch (err) {
      console.error(`[reports] שגיאה בשליחת דוח ${type}:`, err);
    }
  }

  // Fire every minute — reads config fresh each time
  cron.schedule("* * * * *", () => {
    maybeSend("morning");
    maybeSend("evening");
  }, { timezone: TZ });

  console.log("[reports] Scheduler הופעל — דוחות ישלחו לפי השעות בהגדרות.");
}
