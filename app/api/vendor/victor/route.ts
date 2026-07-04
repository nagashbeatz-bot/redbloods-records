import { NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";

/**
 * GET /api/vendor/victor?month=YYYY-MM
 * Returns Victor stats + work list for the given month (default: current month).
 */
export async function GET(req: Request) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const now   = new Date();
    const month = searchParams.get("month") ??
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const { getVictorMonthStats, getVictorWork, sanitizeWorkForVictor } = await import("@/lib/vendor-store");
    const [stats, work] = await Promise.all([
      getVictorMonthStats(month),
      getVictorWork(month),
    ]);

    // Victor's list never carries Artist/Project/Dropbox-folder fields.
    const safeWork = (await getAuthRole()) === "victor" ? work.map(sanitizeWorkForVictor) : work;
    return NextResponse.json({ ok: true, stats, work: safeWork });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
