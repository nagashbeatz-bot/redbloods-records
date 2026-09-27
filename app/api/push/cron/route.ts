/**
 * GET /api/push/cron?secret=CRON_SECRET
 * Called by an external scheduler. Sends the Owner push digest (overdue / due-soon deadlines, today's sessions,
 * overdue expected income per currency, morning / evening summary) through lib/push-digest.ts:
 *   - production-only (pushAllowed — the same guard as every other sender); outside production nothing is sent;
 *   - Israel day / hour (DST-safe), never a fixed UTC+3;
 *   - hidden, completed, cancelled and paused projects are never overdue / due soon;
 *   - each notification type is claimed once per Israel day (push_cron:<type>:<day>) — a repeated call, a second
 *     scheduler or the legacy check never re-sends it; "sent" only after delivery, "failed" otherwise;
 *   - Victor stuck is computed with the app's one rule and returned here, but NEVER pushed (Owner decision Q3,
 *     2026-09-27).
 */
import { NextRequest, NextResponse } from "next/server";
import { sendPushToAll } from "@/lib/push";
import { runOwnerDigest } from "@/lib/push-digest";
import { victorStuckSignals, type VictorStuckSignal } from "@/lib/victor-stuck";

/** The app's own Victor store + the ONE stuck rule (status פעיל + more than stuckAfterDays since sent, with the ball). */
async function loadVictorStuck(): Promise<VictorStuckSignal[]> {
  const { getVictorWork, getVictorSettings } = await import("@/lib/vendor-store");
  const [works, settings] = await Promise.all([getVictorWork(), getVictorSettings()]);
  return victorStuckSignals(works.map((w) => ({ id: w.id, title: w.title, projectName: w.projectName, projectId: w.projectId, status: w.status, daysSinceSent: w.daysSinceSent, filesSent: w.filesSent, versionReviews: w.versionReviews as never })), settings.stuckAfterDays);
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const run = await runOwnerDigest({ withSummary: true, send: (p) => sendPushToAll(p), loadVictorStuck });
    return NextResponse.json({ ok: true, sent: run.sent, pushAllowed: run.pushAllowed, day: run.today, hourIL: run.hour, results: run.results, paymentTotals: run.paymentTotals, victorStuck: run.victorStuck, time: new Date().toISOString() });
  } catch (e) {
    console.error("cron error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
