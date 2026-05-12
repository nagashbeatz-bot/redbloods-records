import { NextResponse } from "next/server";
import { getSchedulerStatus } from "@/lib/reports/runtime-config";

export async function GET() {
  const status = getSchedulerStatus();

  // Current time in Jerusalem
  const now = new Date();
  const jerusalemTime = now.toLocaleString("en-GB", {
    timeZone:  "Asia/Jerusalem",
    hour:      "2-digit",
    minute:    "2-digit",
    second:    "2-digit",
    hour12:    false,
  });

  // Also try Intl.DateTimeFormat for comparison
  let intlTime = "N/A";
  try {
    const fmt   = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour:     "2-digit",
      minute:   "2-digit",
      hour12:   false,
    });
    const parts = fmt.formatToParts(now);
    const h = parts.find(p => p.type === "hour")?.value   ?? "?";
    const m = parts.find(p => p.type === "minute")?.value ?? "?";
    intlTime = `${h}:${m}`;
  } catch { /* ignore */ }

  return NextResponse.json({
    ok:          true,
    utcNow:      now.toISOString(),
    jerusalemTime,
    intlTime,
    ...status,
    nodeVersion: process.version,
    env:         process.env.RAILWAY_ENVIRONMENT ?? "local",
  });
}
