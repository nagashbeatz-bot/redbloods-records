/**
 * Fetch and compute all data needed for a daily report.
 * SERVER ONLY — imports Supabase + Calendar server modules.
 */
import "server-only";
import { listProjects } from "@/lib/projects-store";
import { supabase } from "@/lib/supabase";
import { daysUntilDeadline } from "@/lib/utils";
import type {
  ReportData,
  ReportProject,
  ReportCalendarEvent,
  ReportSession,
  ReportTransaction,
  ReportActivityItem,
} from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True if a HH:MM time string refers to a moment already past (server time) */
function hasTimePassed(timeStr: string | null): boolean {
  if (!timeStr) return true; // no time → treat as past for safety
  const [h, m] = timeStr.split(":").map(Number);
  const now = new Date();
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}

function fmtMoney(amount: number, currency: string): string {
  return `${amount.toLocaleString("he-IL")}${currency}`;
}

// ── Main fetch ────────────────────────────────────────────────────────────────

export async function fetchReportData(): Promise<ReportData> {
  // ── Projects ─────────────────────────────────────────────────────────────────
  const raw = await listProjects();

  const projects: ReportProject[] = raw.map((p) => ({
    id:        p.id,
    name:      p.name,
    artist:    p.artist,
    status:    p.status,
    deadline:  p.deadline,
    notes:     p.notes,
    isOverdue: p.isOverdue,
    isDueSoon: p.isDueSoon,
    daysUntil: daysUntilDeadline(p.deadline),
  }));

  // ── Google Calendar (best-effort) ─────────────────────────────────────────
  let calendarEvents: ReportCalendarEvent[] = [];
  let calendarConnected = false;

  try {
    const { isConnected, fetchTodayAndWeek } = await import("@/lib/google-calendar");
    if (await isConnected()) {
      calendarConnected = true;
      const { today } = await fetchTodayAndWeek();
      calendarEvents = today.map((e) => ({
        title:              e.title,
        type:               e.type,
        startTime:          e.startTime,
        endTime:            e.endTime,
        isAllDay:           e.isAllDay,
        durationMinutes:    e.durationMinutes,
        location:           e.location,
        matchedProjectName: e.matchedProjectName,
      }));
    }
  } catch {
    /* calendar unavailable — continue without it */
  }

  // ── Computed project buckets ──────────────────────────────────────────────
  const COMPLETED = "הושלם";
  const ON_HOLD   = "בהשהייה";

  const activeProjects = projects.filter(
    (p) => p.status !== COMPLETED && p.status !== ON_HOLD
  );
  const overdueProjects = projects.filter(
    (p) => p.isOverdue && p.status !== COMPLETED
  );
  const dueTodayProjects = projects.filter(
    (p) => p.daysUntil === 0 && p.status !== COMPLETED
  );
  const dueSoonProjects = projects.filter(
    (p) => p.isDueSoon && p.daysUntil !== 0 && p.status !== COMPLETED && !p.isOverdue
  );
  const missingInfoProjects = projects.filter(
    (p) => p.status !== COMPLETED && (!p.deadline || !p.artist)
  );

  // ── Date strings ──────────────────────────────────────────────────────────
  const now         = new Date();
  const todayStr    = now.toISOString().split("T")[0];
  const tomorrowStr = (() => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  })();
  const todayStart  = `${todayStr}T00:00:00`;
  const todayEnd    = `${todayStr}T23:59:59`;

  // ── Project lookup map ─────────────────────────────────────────────────────
  const projectMap = new Map<string, { name: string; artist: string }>(
    raw.map((p) => [p.id, { name: p.name, artist: p.artist }])
  );

  function sessionFromRow(s: Record<string, unknown>): ReportSession {
    const proj = projectMap.get(s.project_id as string);
    return {
      id:          s.id          as string,
      projectName: proj?.name    ?? "פרויקט לא ידוע",
      artist:      proj?.artist  ?? "",
      date:        (s.date       as string) ?? todayStr,
      startTime:   (s.start_time as string | null) ?? null,
      endTime:     (s.end_time   as string | null) ?? null,
      status:      (s.status     as string) ?? "",
      sessionType: (s.session_type as string) ?? "",
      notes:       (s.notes      as string) ?? "",
      createdAt:   (s.created_at as string) ?? "",
    };
  }

  function txFromRow(t: Record<string, unknown>): ReportTransaction {
    const proj = t.project_id ? projectMap.get(t.project_id as string) : null;
    return {
      id:            t.id            as string,
      projectName:   proj?.name      ?? (t.scope === "general" ? "כללי" : "פרויקט לא ידוע"),
      artist:        proj?.artist    ?? ((t.artist as string) ?? ""),
      date:          (t.date         as string | null) ?? null,
      type:          (t.type         as string) ?? "",
      description:   (t.description  as string) ?? "",
      amount:        Number(t.amount) || 0,
      currency:      (t.currency     as string) ?? "₪",
      paymentStatus: (t.payment_status as string) ?? "",
      paymentMethod: (t.payment_method as string) ?? "",
      scope:         (t.scope        as string) ?? "project",
      createdAt:     (t.created_at   as string) ?? "",
    };
  }

  // ── Sessions: date = today ────────────────────────────────────────────────
  const { data: rawTodaySessions } = await supabase
    .from("sessions")
    .select("*")
    .eq("date", todayStr)
    .order("start_time", { ascending: true });

  const todaySessionsAll = (rawTodaySessions ?? []).map(sessionFromRow);

  const sessionsDone           = todaySessionsAll.filter(
    (s) => s.status === "הושלם" || s.status === "בוצע"
  );
  const sessionsCancelled      = todaySessionsAll.filter((s) => s.status === "בוטל");
  const sessionsNeedingUpdate  = todaySessionsAll.filter(
    (s) => s.status === "נקבע" && hasTimePassed(s.startTime)
  );
  const sessionsUpcoming       = todaySessionsAll.filter(
    (s) => s.status === "נקבע" && !hasTimePassed(s.startTime)
  );

  // ── Sessions created today for FUTURE dates ───────────────────────────────
  const { data: rawCreatedTodaySessions } = await supabase
    .from("sessions")
    .select("*")
    .gte("created_at", todayStart)
    .lte("created_at", todayEnd)
    .gt("date", todayStr)   // only future dates (not today's sessions)
    .order("date", { ascending: true });

  const sessionsFutureScheduled = (rawCreatedTodaySessions ?? []).map(sessionFromRow);

  // ── Sessions: date = tomorrow ─────────────────────────────────────────────
  const { data: rawTomorrowSessions } = await supabase
    .from("sessions")
    .select("*")
    .eq("date", tomorrowStr)
    .order("start_time", { ascending: true });

  const tomorrowSessions = (rawTomorrowSessions ?? []).map(sessionFromRow);

  // ── Transactions added today (by created_at) ──────────────────────────────
  const { data: rawTxCreatedToday } = await supabase
    .from("transactions")
    .select("*")
    .gte("created_at", todayStart)
    .lte("created_at", todayEnd)
    .order("created_at", { ascending: true });

  const txCreatedToday = (rawTxCreatedToday ?? []).map(txFromRow);

  const PAID_STATUSES = new Set(["שולם", "התקבל", "שולם חלקית"]);

  const txReceivedToday     = txCreatedToday.filter(
    (t) => t.type !== "הוצאה" && PAID_STATUSES.has(t.paymentStatus)
  );
  const txPendingAddedToday = txCreatedToday.filter(
    (t) => t.type !== "הוצאה" && !PAID_STATUSES.has(t.paymentStatus)
  );
  const txExpensesToday     = txCreatedToday.filter((t) => t.type === "הוצאה");

  // ── Transactions expected today (by payment date) ─────────────────────────
  const { data: rawTxExpectedToday } = await supabase
    .from("transactions")
    .select("*")
    .eq("date", todayStr)
    .order("created_at", { ascending: true });

  const txExpectedToday = (rawTxExpectedToday ?? []).map(txFromRow);

  // ── Projects completed today ──────────────────────────────────────────────
  const { data: rawCompletedToday } = await supabase
    .from("projects")
    .select("id")
    .eq("end_date", todayStr)
    .eq("is_hidden", false);

  const completedTodayIds      = new Set((rawCompletedToday ?? []).map((r) => r.id as string));
  const completedTodayProjects = projects.filter((p) => completedTodayIds.has(p.id));

  // ── Projects created today ────────────────────────────────────────────────
  const { data: rawCreatedToday } = await supabase
    .from("projects")
    .select("id")
    .gte("created_at", todayStart)
    .lte("created_at", todayEnd)
    .eq("is_hidden", false);

  const createdTodayIds      = new Set((rawCreatedToday ?? []).map((r) => r.id as string));
  const createdTodayProjects = projects.filter((p) => createdTodayIds.has(p.id));

  // ── Activity feed ─────────────────────────────────────────────────────────
  const activityItems: ReportActivityItem[] = [];

  // Projects created today
  createdTodayProjects.forEach((p) => {
    activityItems.push({
      icon: "＋",
      text: `נוצר פרויקט: ${p.name}${p.artist ? ` — ${p.artist}` : ""}`,
    });
  });

  // Projects completed today
  completedTodayProjects.forEach((p) => {
    activityItems.push({
      icon: "★",
      text: `פרויקט הושלם: ${p.name}${p.artist ? ` — ${p.artist}` : ""}`,
    });
  });

  // Sessions that happened today
  sessionsDone.forEach((s) => {
    const time = s.startTime ? ` · ${s.startTime.slice(0, 5)}${s.endTime ? `–${s.endTime.slice(0, 5)}` : ""}` : "";
    activityItems.push({
      icon: "✓",
      text: `התקיים סשן: ${s.projectName}${s.artist ? ` — ${s.artist}` : ""}${time}`,
      sub:  s.notes || undefined,
    });
  });

  // Sessions scheduled today for future dates
  sessionsFutureScheduled.forEach((s) => {
    const time = s.startTime ? ` ${s.startTime.slice(0, 5)}${s.endTime ? `–${s.endTime.slice(0, 5)}` : ""}` : "";
    activityItems.push({
      icon: "📅",
      text: `נקבע סשן: ${s.projectName}${s.artist ? ` — ${s.artist}` : ""} ל-${s.date}${time}`,
    });
  });

  // Payments received today — brief line only (full details are in "כספים היום")
  txReceivedToday.forEach((t) => {
    activityItems.push({
      icon: "💵",
      text: `התקבל תשלום — ${t.projectName}${t.artist ? ` · ${t.artist}` : ""}`,
    });
  });

  // Pending payments added today — brief line
  txPendingAddedToday.forEach((t) => {
    activityItems.push({
      icon: "📋",
      text: `נוסף תשלום צפוי — ${t.projectName}${t.artist ? ` · ${t.artist}` : ""}`,
    });
  });

  // Expenses added today — brief line
  txExpensesToday.forEach((t) => {
    activityItems.push({
      icon: "💸",
      text: `הוצאה נוספה — ${t.projectName}${t.description ? ` · ${t.description}` : ""}`,
    });
  });

  // ── Victor summary (best-effort) ─────────────────────────────────────────
  let victorSummary: ReportData["victorSummary"] | undefined;
  try {
    const { getVictorMonthStats } = await import("@/lib/vendor-store");
    const vs = await getVictorMonthStats(todayStr.slice(0, 7));
    if (vs.stuck > 0 || vs.needsReview > 0 || vs.needsFix > 0 || vs.paceValue < vs.expectedByNow) {
      victorSummary = {
        active:        vs.active,
        stuck:         vs.stuck,
        needsReview:   vs.needsReview,
        needsFix:      vs.needsFix,
        completed:     vs.completed,
        paceValue:     vs.paceValue,
        expectedByNow: vs.expectedByNow,
        belowPace:     vs.paceValue < vs.expectedByNow,
        paymentStatus: vs.paymentStatus,
        month:         vs.month,
      };
    }
  } catch {
    /* victor data unavailable — continue without it */
  }

  return {
    projects,
    calendarEvents,
    generatedAt: new Date(),
    calendarConnected,
    activeProjects,
    overdueProjects,
    dueTodayProjects,
    dueSoonProjects,
    missingInfoProjects,
    activityItems,
    sessionsDone,
    sessionsCancelled,
    sessionsNeedingUpdate,
    sessionsUpcoming,
    sessionsFutureScheduled,
    txReceivedToday,
    txPendingAddedToday,
    txExpensesToday,
    txExpectedToday,
    tomorrowSessions,
    completedTodayProjects,
    createdTodayProjects,
    victorSummary,
  };
}
