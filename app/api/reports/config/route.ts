import { NextResponse } from "next/server";
import { getRuntimeConfig, setRuntimeConfig } from "@/lib/reports/runtime-config";
import { readReportConfig, writeReportConfig } from "@/lib/reports/monday-config";
import { saveReportConfig } from "@/lib/reports/config";

// GET /api/reports/config — returns current schedule + Railway URL if available
export async function GET() {
  try {
    const runtime    = getRuntimeConfig();
    const domain     = process.env.RAILWAY_PUBLIC_DOMAIN;
    const railwayUrl = domain ? `https://${domain}` : null;
    return NextResponse.json({ ...runtime, railwayUrl });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/reports/config — save schedule to Supabase + memory + local file
export async function POST(req: Request) {
  try {
    const body = await req.json() as { morningTime?: string; eveningTime?: string };
    const { morningTime, eveningTime } = body;

    const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (
      !morningTime || !timeRe.test(morningTime) ||
      !eveningTime || !timeRe.test(eveningTime)
    ) {
      return NextResponse.json({ error: "פורמט שעה לא תקין — נדרש HH:MM" }, { status: 400 });
    }

    const config = { morningTime, eveningTime };

    // 1. Save to Supabase (persistent across Railway redeploys)
    await writeReportConfig(config);

    // 2. Update in-memory config immediately (cron picks it up next minute)
    setRuntimeConfig(config);

    // 3. Save local file as backup for dev
    try { saveReportConfig(config); } catch { /* non-fatal on Railway */ }

    return NextResponse.json({ ok: true, morningTime, eveningTime });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Read current stored config from Supabase (diagnostics)
export async function PUT() {
  try {
    const stored = await readReportConfig();
    return NextResponse.json({ stored });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
