import { NextResponse } from "next/server";

/**
 * GET  /api/reports/weekly — preview HTML
 * POST /api/reports/weekly — generate + send weekly email
 */
export async function GET() {
  try {
    const { generateWeeklyReport } = await import("@/lib/reports/weekly");
    const report = await generateWeeklyReport();
    return new Response(report.html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[reports/weekly GET]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST() {
  try {
    const { sendReportNow, SystemInputError } = await import("@/lib/writes/system");
    try {
      const r = await sendReportNow("weekly"); // shared writer (lib/writes/system)
      return NextResponse.json({ ok: true, subject: r.subject });
    } catch (e) {
      if (e instanceof SystemInputError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
      throw e;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[reports/weekly POST]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
