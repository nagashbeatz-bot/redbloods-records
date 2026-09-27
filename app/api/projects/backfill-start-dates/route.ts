import { NextResponse } from "next/server";

/**
 * POST /api/projects/backfill-start-dates
 * One-time (or recurring) job: for every project with no start_date,
 * find its earliest session and set start_date accordingly.
 */
export async function POST() {
  try {
    // shared writer (lib/writes/backfills): plan = earliest session per project without a start date; apply is guarded
    const { startDatePlan, applyStartDates } = await import("@/lib/writes/backfills");
    const plan = await startDatePlan();
    if (plan.rows.length === 0 && plan.withoutSessions === 0) {
      return NextResponse.json({ updated: 0, message: "כל הפרויקטים כבר מעודכנים" });
    }
    const { updated } = await applyStartDates(plan.rows);
    return NextResponse.json({
      updated,
      skipped: plan.withoutSessions,
      message: `עודכנו ${updated} פרויקטים, ${plan.withoutSessions} ללא סשנים`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
