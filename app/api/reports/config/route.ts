import { NextResponse } from "next/server";
import { getRuntimeConfig } from "@/lib/reports/runtime-config";
import { readReportConfig } from "@/lib/reports/monday-config";
import { setReportSchedule, SystemInputError } from "@/lib/writes/system";

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

// POST /api/reports/config — save schedule to Supabase + memory + local file (shared writer lib/writes/system)
export async function POST(req: Request) {
  try {
    const body = await req.json() as { morningTime?: string; eveningTime?: string };
    const { morningTime, eveningTime } = body;
    await setReportSchedule(String(morningTime ?? ""), String(eveningTime ?? ""));
    return NextResponse.json({ ok: true, morningTime, eveningTime });
  } catch (err) {
    if (err instanceof SystemInputError) return NextResponse.json({ error: err.message }, { status: 400 });
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
