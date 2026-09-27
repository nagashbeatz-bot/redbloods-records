import { NextResponse } from "next/server";

/**
 * GET /api/reports/morning
 * Preview the morning report HTML without sending — for dev/testing.
 */
export async function GET() {
  try {
    const { fetchReportData }       = await import("@/lib/reports/data");
    const { getRecommendations }    = await import("@/lib/reports/ai");
    const { generateMorningReport } = await import("@/lib/reports/templates");

    const data   = await fetchReportData();
    const recs   = await getRecommendations(data, "morning");
    const report = generateMorningReport(data, recs);

    return new Response(report.html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[reports/morning GET]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/reports/morning
 * Fetches data, generates morning report, sends email.
 * Safe to call from the manual "שלח עכשיו" button or the local scheduler.
 */
export async function POST() {
  try {
    const { sendReportNow, SystemInputError } = await import("@/lib/writes/system");
    try {
      const r = await sendReportNow("morning"); // shared writer (lib/writes/system)
      return NextResponse.json({ ok: true, subject: r.subject });
    } catch (e) {
      if (e instanceof SystemInputError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
      throw e;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[reports/morning POST]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
