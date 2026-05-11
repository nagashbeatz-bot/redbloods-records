import { NextResponse } from "next/server";

/**
 * POST /api/reports/morning
 * Fetches data, generates morning report, sends email.
 * Safe to call from the manual "שלח עכשיו" button or the local scheduler.
 */
export async function POST() {
  try {
    const { fetchReportData }       = await import("@/lib/reports/data");
    const { getRecommendations }    = await import("@/lib/reports/ai");
    const { generateMorningReport } = await import("@/lib/reports/templates");
    const { sendReportEmail, isEmailConfigured } = await import("@/lib/reports/email");

    if (!isEmailConfigured()) {
      return NextResponse.json(
        { ok: false, error: "אימייל לא מוגדר — הוסף SMTP_USER / SMTP_PASS / EMAIL_TO ל-.env.local" },
        { status: 400 }
      );
    }

    const data   = await fetchReportData();
    const recs   = await getRecommendations(data, "morning");
    const report = generateMorningReport(data, recs);

    await sendReportEmail(report);

    return NextResponse.json({
      ok:      true,
      subject: report.subject,
      stats: {
        active:  data.activeProjects.length,
        overdue: data.overdueProjects.length,
        dueToday: data.dueTodayProjects.length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[reports/morning]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
