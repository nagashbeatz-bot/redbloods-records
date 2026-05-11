import { NextResponse } from "next/server";

/**
 * POST /api/reports/evening
 * Fetches data, generates evening report, sends email.
 * Safe to call from the manual "שלח עכשיו" button or the local scheduler.
 */
export async function POST() {
  try {
    const { fetchReportData }       = await import("@/lib/reports/data");
    const { getRecommendations }    = await import("@/lib/reports/ai");
    const { generateEveningReport } = await import("@/lib/reports/templates");
    const { sendReportEmail, isEmailConfigured } = await import("@/lib/reports/email");

    if (!isEmailConfigured()) {
      return NextResponse.json(
        { ok: false, error: "אימייל לא מוגדר — הוסף SMTP_USER / SMTP_PASS / EMAIL_TO ל-.env.local" },
        { status: 400 }
      );
    }

    const data   = await fetchReportData();
    const recs   = await getRecommendations(data, "evening");
    const report = generateEveningReport(data, recs);

    await sendReportEmail(report);

    return NextResponse.json({
      ok:      true,
      subject: report.subject,
      stats: {
        active:  data.activeProjects.length,
        overdue: data.overdueProjects.length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[reports/evening]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
