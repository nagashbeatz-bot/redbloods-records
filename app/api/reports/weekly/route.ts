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
    const { generateWeeklyReport }               = await import("@/lib/reports/weekly");
    const { sendReportEmail, isEmailConfigured }  = await import("@/lib/reports/email");

    if (!isEmailConfigured()) {
      return NextResponse.json(
        { ok: false, error: "אימייל לא מוגדר" },
        { status: 400 }
      );
    }

    const report = await generateWeeklyReport();
    await sendReportEmail(report);

    return NextResponse.json({ ok: true, subject: report.subject });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[reports/weekly POST]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
