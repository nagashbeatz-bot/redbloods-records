/**
 * Report schedule configuration.
 *
 * Priority order (highest → lowest):
 *   1. .report-config.json  — written by the UI, works on local dev
 *   2. MORNING_REPORT_TIME / EVENING_REPORT_TIME env vars — set in Railway dashboard
 *   3. Hardcoded defaults (07:00 / 19:00)
 *
 * On Railway the JSON file is ephemeral (wiped on redeploy).
 * Set env vars in the Railway dashboard for persistent schedule.
 */
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), ".report-config.json");

export interface ReportConfig {
  morningTime: string; // "HH:MM"
  eveningTime: string; // "HH:MM"
  source:      "file" | "env" | "default";
  isRailway:   boolean;
}

export function getReportConfig(): ReportConfig {
  const isRailway = !!(
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_SERVICE_ID
  );

  // 1. Try JSON file first
  try {
    const raw    = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { morningTime?: string; eveningTime?: string };
    const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (
      parsed.morningTime && timeRe.test(parsed.morningTime) &&
      parsed.eveningTime && timeRe.test(parsed.eveningTime)
    ) {
      return {
        morningTime: parsed.morningTime,
        eveningTime: parsed.eveningTime,
        source:      "file",
        isRailway,
      };
    }
  } catch { /* file missing or invalid */ }

  // 2. Env vars
  const envMorning = process.env.MORNING_REPORT_TIME;
  const envEvening = process.env.EVENING_REPORT_TIME;
  const timeRe     = /^([01]\d|2[0-3]):([0-5]\d)$/;

  if (envMorning && timeRe.test(envMorning) && envEvening && timeRe.test(envEvening)) {
    return {
      morningTime: envMorning,
      eveningTime: envEvening,
      source:      "env",
      isRailway,
    };
  }

  // 3. Hardcoded defaults
  return {
    morningTime: "07:00",
    eveningTime: "19:00",
    source:      "default",
    isRailway,
  };
}

export function saveReportConfig(config: Omit<ReportConfig, "source" | "isRailway">): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    morningTime: config.morningTime,
    eveningTime: config.eveningTime,
  }, null, 2));
}
