/**
 * GET /api/agent/check?secret=CRON_SECRET[&weekly=1]
 *
 * Main proactive agent endpoint — called by cron-job.org every 3 hours.
 * 1. Runs all rule checks (no AI)
 * 2. Persists new alerts (with cooldown)
 * 3. Sends push notifications for important/urgent alerts
 * 4. At 09:00 Israel time: triggers morning report email
 * 5. At 22:00 Israel time: triggers evening report email
 * 6. When &weekly=1 (Sunday): triggers weekly report email
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  checkOverdueProjects,
  checkDueSoonProjects,
  checkSessionsNeedingUpdate,
  checkOverduePayments,
  checkProjectsNoPricing,
  checkVictorStuck,
  checkVictorBelowPace,
  checkInactivity,
  checkGoalsProgress,
  checkCompletedNoDelivery,
  checkStaleSessions,
} from "@/lib/agent/rules";
import { createAlertIfNotCoolingDown } from "@/lib/agent/alerts-store";
import { sendAlertsAsNotifications } from "@/lib/agent/notifications";
import { getGoalsProgress } from "@/lib/agent/goals";
import type { AgentAlert, AlertInput } from "@/lib/types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const PAID_STATUSES = new Set(["שולם", "התקבל", "שולם חלקית"]);
const DONE_PROJECT_STATUSES = new Set(["הושלם", "בהשהייה"]);

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const isWeekly = req.nextUrl.searchParams.get("weekly") === "1";

  try {
    const now   = new Date();
    const today = now.toISOString().split("T")[0];
    // Israel time = UTC + 3
    const israelHour = (now.getUTCHours() + 3) % 24;

    // ── Load data ────────────────────────────────────────────────────────────

    // Projects
    const { data: rawProjects } = await supabase
      .from("projects")
      .select("id, name, artist, status, deadline, end_date, files, updated_at")
      .eq("is_hidden", false);
    const projects = rawProjects ?? [];
    const activeProjects = projects.filter((p) => !DONE_PROJECT_STATUSES.has(p.status));

    // Sessions — today + recent (last 30 days for stale check)
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data: rawSessions } = await supabase
      .from("sessions")
      .select("id, project_id, date, start_time, status, created_at")
      .gte("date", thirtyDaysAgo.toISOString().split("T")[0])
      .order("created_at", { ascending: false });
    const sessions = rawSessions ?? [];

    // Today's sessions for the needs-update check
    const todaySessions = sessions
      .filter((s) => s.date === today)
      .map((s) => ({
        id:         s.id,
        projectName: projects.find((p) => p.id === s.project_id)?.name ?? "פרויקט",
        date:       s.date,
        startTime:  s.start_time,
        status:     s.status,
      }));

    // Transactions
    const { data: rawTxns } = await supabase
      .from("transactions")
      .select("id, project_id, amount, currency, date, type, payment_status")
      .order("created_at", { ascending: false });
    const txns = (rawTxns ?? []).map((t) => ({
      id:            t.id,
      projectName:   projects.find((p) => p.id === t.project_id)?.name ?? "פרויקט",
      amount:        t.amount,
      currency:      t.currency,
      date:          t.date,
      type:          t.type,
      paymentStatus: t.payment_status,
    }));

    // Finance settings (agreed prices)
    const { data: financeRows } = await supabase
      .from("settings")
      .select("key, value")
      .like("key", "finance_%");
    const financeMap = new Map<string, { agreedPrice?: number | null }>();
    for (const row of financeRows ?? []) {
      const projectId = row.key.replace("finance_", "");
      financeMap.set(projectId, (row.value as Record<string, unknown>) as { agreedPrice?: number });
    }

    // Victor vendor work
    const { data: rawVendorWork } = await supabase
      .from("vendor_project_work")
      .select("id, project_id, status, work_state, sent_date")
      .eq("vendor_name", "victor");
    const vendorWork = (rawVendorWork ?? []).map((w) => ({
      id:          w.id,
      projectId:   w.project_id,
      projectName: projects.find((p) => p.id === w.project_id)?.name ?? "פרויקט",
      status:      w.status,
      workState:   w.work_state,
      sentDate:    w.sent_date,
    }));

    // Victor settings (stuckAfterDays)
    let stuckAfterDays = 5;
    let victorStats = null;
    try {
      const { getVictorSettings, getVictorMonthStats } = await import("@/lib/vendor-store");
      const vs = await getVictorSettings();
      stuckAfterDays = vs.stuckAfterDays;
      victorStats    = await getVictorMonthStats(today.slice(0, 7));
    } catch { /* ignore */ }

    // Inactivity data
    const lastActivity = {
      lastProjectUpdate:   null as Date | null,
      lastSessionCreated:  null as Date | null,
      lastPaymentReceived: null as Date | null,
      lastVictorUpdate:    null as Date | null,
    };
    if (projects.length > 0) {
      const sorted = [...projects].sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      if (sorted[0]) lastActivity.lastProjectUpdate = new Date(sorted[0].updated_at);
    }
    if (sessions.length > 0) {
      lastActivity.lastSessionCreated = new Date(sessions[0].created_at);
    }
    const paidTxns = txns.filter((t) => PAID_STATUSES.has(t.paymentStatus));
    if (paidTxns.length > 0) {
      const { data: lastPaid } = await supabase
        .from("transactions")
        .select("updated_at")
        .in("payment_status", Array.from(PAID_STATUSES))
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastPaid?.updated_at) lastActivity.lastPaymentReceived = new Date(lastPaid.updated_at);
    }
    try {
      const { data: lastVictor } = await supabase
        .from("vendor_project_work")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastVictor?.updated_at) lastActivity.lastVictorUpdate = new Date(lastVictor.updated_at);
    } catch { /* ignore */ }

    // Goals progress
    let goalsProgress = null;
    try {
      goalsProgress = await getGoalsProgress(today.slice(0, 7));
    } catch { /* ignore */ }

    // ── Run all rule checks ──────────────────────────────────────────────────

    const allInputs: AlertInput[] = [
      ...checkOverdueProjects(projects),
      ...checkDueSoonProjects(projects),
      ...checkSessionsNeedingUpdate(todaySessions),
      ...checkOverduePayments(txns),
      ...checkProjectsNoPricing(activeProjects, financeMap),
      ...checkVictorStuck(vendorWork, stuckAfterDays),
      ...checkVictorBelowPace(victorStats, victorStats?.goal ?? 0),
      ...checkInactivity(lastActivity, activeProjects.length),
      ...(goalsProgress ? checkGoalsProgress(goalsProgress) : []),
      ...checkCompletedNoDelivery(projects),
      ...checkStaleSessions(activeProjects, sessions),
    ];

    // ── Auto-resolve: close alerts whose entity is no longer problematic ────
    // Only affects alerts that have an entity_key — bulk/aggregate alerts (null key) are untouched.
    let autoResolved = 0;
    try {
      const activeEntityKeys = new Set(
        allInputs.filter((i) => i.entityKey).map((i) => i.entityKey!)
      );
      if (activeEntityKeys.size > 0) {
        const { data: trackedAlerts } = await supabase
          .from("agent_alerts")
          .select("id, entity_key")
          .eq("status", "new")
          .not("entity_key", "is", null);

        const toResolve = (trackedAlerts ?? [])
          .filter((a) => a.entity_key && !activeEntityKeys.has(a.entity_key))
          .map((a) => a.id);

        if (toResolve.length > 0) {
          await supabase
            .from("agent_alerts")
            .update({ status: "handled", updated_at: new Date().toISOString() })
            .in("id", toResolve);
          autoResolved = toResolve.length;
        }
      }
    } catch (e) {
      console.error("[agent/check] auto-resolve error:", e);
    }

    // ── Persist with cooldown ────────────────────────────────────────────────

    const newAlerts: AgentAlert[] = [];
    for (const input of allInputs) {
      const alert = await createAlertIfNotCoolingDown(input);
      if (alert) newAlerts.push(alert);
    }

    // ── Send push notifications for important/urgent new alerts ──────────────
    const notificationsSent = await sendAlertsAsNotifications(newAlerts);

    // ── Time-triggered reports ───────────────────────────────────────────────
    const reportsTriggered: string[] = [];
    const baseUrl = process.env.REPORTS_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://redbloods-records-production.up.railway.app";

    if (israelHour >= 9 && israelHour < 10) {
      // Morning report
      try {
        await fetch(`${baseUrl}/api/reports/morning`, { method: "POST" });
        reportsTriggered.push("morning");
      } catch (e) { console.error("morning report trigger failed:", e); }
    }

    if (israelHour >= 22 && israelHour < 23) {
      // Evening report
      try {
        await fetch(`${baseUrl}/api/reports/evening`, { method: "POST" });
        reportsTriggered.push("evening");
      } catch (e) { console.error("evening report trigger failed:", e); }
    }

    if (isWeekly || now.getDay() === 0 && israelHour >= 9 && israelHour < 10) {
      // Weekly report (Sunday morning, or forced via ?weekly=1)
      try {
        await fetch(`${baseUrl}/api/reports/weekly`, { method: "POST" });
        reportsTriggered.push("weekly");
      } catch (e) { console.error("weekly report trigger failed:", e); }
    }

    return NextResponse.json({
      ok: true,
      checkedRules:       allInputs.length,
      newAlerts:          newAlerts.length,
      autoResolved,
      notificationsSent,
      reportsTriggered,
      time:               now.toISOString(),
      israelHour,
    });

  } catch (e) {
    console.error("[agent/check] error:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
