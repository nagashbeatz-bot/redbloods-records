/**
 * Local daily-reports scheduler.
 *
 * Run with:   npm run daily-reports
 *
 * Sends morning report at 07:00 and evening report at 19:00,
 * Asia/Jerusalem timezone. Works only while this process is alive
 * (i.e. while the machine is on and the Next.js server is running).
 *
 * The Next.js server MUST be running on BASE_URL (default: localhost:3000)
 * because this script delegates all work to the API routes.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import cron from "node-cron";

const BASE_URL = process.env.REPORTS_BASE_URL ?? "http://localhost:3000";
const TZ       = "Asia/Jerusalem";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowHE(): string {
  return new Date().toLocaleString("he-IL", { timeZone: TZ });
}

async function callReport(type: "morning" | "evening"): Promise<void> {
  const label = type === "morning" ? "☀️  דוח בוקר" : "🌙 דוח ערב";
  console.log(`\n[${nowHE()}] שולח ${label}...`);

  try {
    const res  = await fetch(`${BASE_URL}/api/reports/${type}`, { method: "POST" });
    const data = await res.json() as { ok: boolean; subject?: string; error?: string };

    if (data.ok) {
      console.log(`✓ נשלח: ${data.subject ?? label}`);
    } else {
      console.error(`✗ שגיאה: ${data.error}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ שגיאת רשת: ${msg}`);
    console.error("  ודא שהשרת פועל על", BASE_URL);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log("=".repeat(55));
console.log("📧  Redbloods OS — Local Report Scheduler");
console.log("=".repeat(55));
console.log(`🕐  דוח בוקר:  07:00 (${TZ})`);
console.log(`🕖  דוח ערב:   19:43 (${TZ})`);
console.log(`🌐  שרת:       ${BASE_URL}`);
console.log("=".repeat(55));
console.log("השאר טרמינל זה פתוח כדי שהדוחות יישלחו.");
console.log("Ctrl+C לעצירה.");
console.log("");

// Schedule morning at 07:00 Jerusalem
cron.schedule("0 7 * * *", () => callReport("morning"), { timezone: TZ });

// Schedule evening at 19:43 Jerusalem
cron.schedule("43 19 * * *", () => callReport("evening"), { timezone: TZ });

// Keep the process alive (node-cron handles this, but be explicit)
process.on("SIGINT", () => {
  console.log("\nScheduler עצר. להתראות.");
  process.exit(0);
});
