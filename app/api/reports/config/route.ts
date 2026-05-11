import { NextResponse } from "next/server";
import { getReportConfig, saveReportConfig } from "@/lib/reports/config";

export async function GET() {
  try {
    const config = getReportConfig();
    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const morningTime: string = body.morningTime;
    const eveningTime: string = body.eveningTime;

    // Validate "HH:MM" format
    const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRe.test(morningTime) || !timeRe.test(eveningTime)) {
      return NextResponse.json(
        { error: "פורמט שעה לא תקין — נדרש HH:MM" },
        { status: 400 }
      );
    }

    saveReportConfig({ morningTime, eveningTime });
    return NextResponse.json({ ok: true, morningTime, eveningTime });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
