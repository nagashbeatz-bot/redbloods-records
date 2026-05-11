/**
 * Report schedule configuration — stored in .report-config.json
 * Falls back to env vars or hardcoded defaults.
 */
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), ".report-config.json");

export interface ReportConfig {
  morningTime: string; // "HH:MM"
  eveningTime: string; // "HH:MM"
}

const DEFAULTS: ReportConfig = {
  morningTime: process.env.MORNING_REPORT_TIME ?? "07:00",
  eveningTime: process.env.EVENING_REPORT_TIME ?? "19:43",
};

export function getReportConfig(): ReportConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      morningTime: parsed.morningTime ?? DEFAULTS.morningTime,
      eveningTime: parsed.eveningTime ?? DEFAULTS.eveningTime,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveReportConfig(config: ReportConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
