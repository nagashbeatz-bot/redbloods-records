/**
 * Rule-based alert checks — no AI, pure data logic.
 * Each function returns AlertInput[] for issues found.
 * The caller decides whether to persist them (with cooldown).
 */
import type { AlertInput, BusinessGoals, GoalsProgress, VictorMonthStats } from "@/lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

const PAID_STATUSES = new Set(["שולם", "התקבל", "שולם חלקית"]);

/** Aggregate: if many items of same type, return one combined alert */
function aggregate<T extends { id?: string; name: string; artist?: string }>(
  items: T[],
  singleFn: (item: T) => AlertInput,
  bulkFn: (items: T[]) => AlertInput,
  threshold = 3,
): AlertInput[] {
  if (items.length === 0) return [];
  if (items.length < threshold) return items.map(singleFn);
  return [bulkFn(items)];
}

// ── 1. Overdue projects ───────────────────────────────────────────────────────

export function checkOverdueProjects(
  projects: Array<{ id: string; name: string; artist: string; status: string; deadline: string | null }>
): AlertInput[] {
  const today = new Date().toISOString().split("T")[0];
  const DONE_STATUSES = new Set(["הושלם", "בהשהייה"]);
  const overdue = projects.filter(
    (p) => p.deadline && p.deadline < today && !DONE_STATUSES.has(p.status)
  );
  return aggregate(
    overdue,
    (p) => ({
      type: "overdue_deadline",
      severity: "important",
      title: `⚠ דדליין עבר — ${p.name}`,
      message: `הפרויקט "${p.name}"${p.artist ? ` (${p.artist})` : ""} עבר את תאריך היעד שלו. יש לעדכן סטטוס או לקבוע דדליין חדש.`,
      relatedProjectId: p.id,
      entityKey: `overdue_deadline:${p.id}`,
      suggestedActions: ["עדכן סטטוס", "קבע דדליין חדש", "סמן כהושלם"],
    }),
    (items) => ({
      type: "overdue_deadline",
      severity: "important",
      title: `⚠ ${items.length} פרויקטים עברו דדליין`,
      message: `יש ${items.length} פרויקטים שעברו את תאריך היעד שלהם: ${items.slice(0, 3).map((p) => p.name).join(", ")}${items.length > 3 ? ` ועוד ${items.length - 3}` : ""}. כדאי לעדכן עדיפויות.`,
      metadata: { projectIds: items.map((p) => p.id), count: items.length },
      suggestedActions: ["פתח רשימת פרויקטים", "עדכן דדליינים"],
    }),
  );
}

// ── 2. Due soon (1–7 days) ────────────────────────────────────────────────────

export function checkDueSoonProjects(
  projects: Array<{ id: string; name: string; artist: string; status: string; deadline: string | null }>
): AlertInput[] {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const DONE_STATUSES = new Set(["הושלם", "בהשהייה"]);
  const soon = projects.filter((p) => {
    if (!p.deadline || p.deadline <= today || DONE_STATUSES.has(p.status)) return false;
    const diff = daysBetween(now, new Date(p.deadline));
    return diff >= 1 && diff <= 3;
  });
  return aggregate(
    soon,
    (p) => {
      const diff = daysBetween(now, new Date(p.deadline!));
      return {
        type: "deadline_approaching",
        severity: "warning",
        title: `⏳ דדליין מתקרב — ${p.name}`,
        message: `לפרויקט "${p.name}" נשארו ${diff === 1 ? "יום אחד" : `${diff} ימים`} לדדליין. כדאי לבדוק סטטוס.`,
        relatedProjectId: p.id,
        entityKey: `deadline_approaching:${p.id}`,
        suggestedActions: ["בדוק סטטוס", "עדכן התקדמות"],
      };
    },
    (items) => ({
      type: "deadline_approaching",
      severity: "warning",
      title: `⏳ ${items.length} דדליינים מתקרבים`,
      message: `יש ${items.length} פרויקטים עם דדליין ב-3 הימים הקרובים: ${items.map((p) => p.name).join(", ")}.`,
      metadata: { projectIds: items.map((p) => p.id), count: items.length },
      suggestedActions: ["פתח דשבורד"],
    }),
  );
}

// ── 3. Sessions needing update ────────────────────────────────────────────────

export function checkSessionsNeedingUpdate(
  sessions: Array<{ id: string; projectName: string; date: string; startTime: string | null; status: string }>
): AlertInput[] {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const stale = sessions.filter((s) => {
    if (s.status !== "נקבע") return false;
    if (s.date > today) return false;
    if (s.date < today) return true; // past date, still "נקבע"
    // today: check if time passed
    if (!s.startTime) return true;
    const [h, m] = s.startTime.split(":").map(Number);
    return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
  });
  if (stale.length === 0) return [];
  if (stale.length === 1) {
    const s = stale[0];
    return [{
      type: "session_needs_update",
      severity: "warning",
      title: `📅 סשן עבר — ${s.projectName}`,
      message: `סשן של "${s.projectName}" מתאריך ${s.date} עדיין מסומן כ"נקבע". יש לסמן התקיים / בוטל / לא הגיע.`,
      metadata: { sessionId: s.id, date: s.date },
      entityKey: `session_needs_update:${s.id}`,
      suggestedActions: ["סמן התקיים", "סמן בוטל"],
    }];
  }
  return [{
    type: "session_needs_update",
    severity: "warning",
    title: `📅 ${stale.length} סשנים דורשים עדכון`,
    message: `יש ${stale.length} סשנים שעברו ועדיין מסומנים כ"נקבע". יש לעדכן סטטוס לכל אחד.`,
    metadata: { sessionIds: stale.map((s) => s.id), count: stale.length },
    suggestedActions: ["פתח יומן", "עדכן סשנים"],
  }];
}

// ── 4. Overdue payments ───────────────────────────────────────────────────────

const FULLY_PAID_STATUSES = new Set(["שולם", "התקבל"]);

export function checkOverduePayments(
  transactions: Array<{ id: string; projectId: string | null; projectName: string; amount: number; currency: string; date: string | null; type: string; paymentStatus: string }>,
  financeMap: Map<string, { agreedPrice?: number | null }>
): AlertInput[] {
  const today = new Date().toISOString().split("T")[0];

  // Compute total paid income per project (same statuses as ProjectDrawer)
  const paidByProject = new Map<string, number>();
  for (const t of transactions) {
    if (t.projectId && t.type !== "הוצאה" && FULLY_PAID_STATUSES.has(t.paymentStatus)) {
      paidByProject.set(t.projectId, (paidByProject.get(t.projectId) ?? 0) + t.amount);
    }
  }

  const overdue = transactions.filter((t) => {
    if (t.type === "הוצאה" || !t.date || t.date >= today || PAID_STATUSES.has(t.paymentStatus)) return false;
    // Skip if project is already fully paid or overpaid
    if (t.projectId) {
      const agreedPrice = financeMap.get(t.projectId)?.agreedPrice ?? null;
      const paidIncome  = paidByProject.get(t.projectId) ?? 0;
      if (agreedPrice != null && paidIncome >= agreedPrice) return false;
    }
    return true;
  });
  if (overdue.length === 0) return [];
  const total = overdue.reduce((s, t) => s + t.amount, 0);
  const currency = overdue[0]?.currency ?? "₪";
  if (overdue.length === 1) {
    const t = overdue[0];
    return [{
      type: "payment_overdue",
      severity: "important",
      title: `💸 תשלום בפיגור — ${t.projectName}`,
      message: `תשלום של ${t.amount.toLocaleString("he-IL")}${t.currency} מפרויקט "${t.projectName}" לא עודכן כהתקבל. האם התשלום הגיע?`,
      metadata: { transactionId: t.id, amount: t.amount, currency: t.currency },
      entityKey: `payment_overdue:${t.id}`,
      suggestedActions: ["סמן כהתקבל", "שלח תזכורת"],
    }];
  }
  return [{
    type: "payment_overdue",
    severity: "important",
    title: `💸 ${overdue.length} תשלומים בפיגור`,
    message: `יש ${overdue.length} תשלומים שלא עודכנו כהתקבלו, סה״כ ${total.toLocaleString("he-IL")}${currency}. כדאי לבדוק מה הגיע.`,
    metadata: { transactionIds: overdue.map((t) => t.id), total, currency, count: overdue.length },
    suggestedActions: ["פתח עמוד כספים", "עדכן תשלומים"],
  }];
}

// ── 5. Projects with no pricing ───────────────────────────────────────────────

export function checkProjectsNoPricing(
  projects: Array<{ id: string; name: string; artist: string; status: string }>,
  financeSettings: Map<string, { agreedPrice?: number | null }>
): AlertInput[] {
  const DONE_STATUSES = new Set(["הושלם", "בהשהייה"]);
  const noPrice = projects.filter(
    (p) => !DONE_STATUSES.has(p.status) && !financeSettings.get(p.id)?.agreedPrice
  );
  return aggregate(
    noPrice,
    (p) => ({
      type: "project_no_pricing",
      severity: "warning",
      title: `₪ פרויקט ללא מחיר — ${p.name}`,
      message: `לפרויקט "${p.name}" אין מחיר מוסכם מוגדר. זה עלול לגרום לאי-דיוק בדוחות כספיים ולסיכון בגבייה.`,
      relatedProjectId: p.id,
      entityKey: `project_no_pricing:${p.id}`,
      suggestedActions: ["הגדר מחיר", "סמן כחינמי", "סמן כחריג"],
    }),
    (items) => ({
      type: "project_no_pricing",
      severity: "warning",
      title: `₪ ${items.length} פרויקטים ללא מחיר`,
      message: `יש ${items.length} פרויקטים פעילים בלי מחיר מוסכם: ${items.slice(0, 3).map((p) => p.name).join(", ")}${items.length > 3 ? ` ועוד ${items.length - 3}` : ""}. הדוחות הכספיים לא מדויקים.`,
      metadata: { projectIds: items.map((p) => p.id), count: items.length },
      suggestedActions: ["פתח רשימת פרויקטים", "הגדר מחירים"],
    }),
  );
}

// ── 6. Victor stuck ───────────────────────────────────────────────────────────

export function checkVictorStuck(
  vendorWork: Array<{ id: string; projectId: string; projectName: string; sentDate: string | null; status: string; workState: string | null }>,
  stuckAfterDays: number
): AlertInput[] {
  const now = new Date();
  const ACTIVE_STATES = new Set(["נשלח לויקטור", "מחכה לקבצים", "חזר מויקטור", "דורש בדיקה", "דורש תיקון"]);
  const stuck = vendorWork.filter((w) => {
    if (w.status !== "פעיל") return false;
    if (!w.sentDate) return false;
    if (w.workState && !ACTIVE_STATES.has(w.workState)) return false;
    return daysBetween(new Date(w.sentDate), now) >= stuckAfterDays;
  });
  if (stuck.length === 0) return [];
  if (stuck.length === 1) {
    const w = stuck[0];
    const days = daysBetween(new Date(w.sentDate!), now);
    return [{
      type: "victor_stuck",
      severity: "important",
      title: `👥 ויקטור — פרויקט תקוע`,
      message: `"${w.projectName}" תקוע אצל ויקטור כבר ${days} ימים. האם לשלוח תזכורת?`,
      relatedProjectId: w.projectId,
      metadata: { vendorWorkId: w.id, daysSinceSent: days },
      entityKey: `victor_stuck:${w.id}`,
      suggestedActions: ["שלח תזכורת לויקטור", "עדכן סטטוס"],
    }];
  }
  return [{
    type: "victor_stuck",
    severity: "important",
    title: `👥 ויקטור — ${stuck.length} פרויקטים תקועים`,
    message: `יש ${stuck.length} פרויקטים תקועים אצל ויקטור מעל ${stuckAfterDays} ימים: ${stuck.map((w) => w.projectName).join(", ")}.`,
    metadata: { vendorWorkIds: stuck.map((w) => w.id), count: stuck.length, stuckAfterDays },
    suggestedActions: ["פתח דף צוות", "שלח תזכורת"],
  }];
}

// ── 7. Victor below pace ──────────────────────────────────────────────────────

export function checkVictorBelowPace(
  stats: VictorMonthStats | null,
  goal: number
): AlertInput[] {
  if (!stats || goal === 0) return [];
  if (stats.expectedByNow === 0) return [];
  const pct = stats.paceValue / stats.expectedByNow;
  if (pct >= 0.6) return []; // on pace or close enough
  return [{
    type: "victor_below_pace",
    severity: "warning",
    title: `👥 ויקטור מתחת לקצב`,
    message: `ויקטור בפועל: ${stats.paceValue} פרויקטים, צפוי עד עכשיו: ${stats.expectedByNow} (יעד חודשי: ${goal}). הקצב מתחת ל-60% מהצפוי.`,
    metadata: { paceValue: stats.paceValue, expectedByNow: stats.expectedByNow, goal, month: stats.month },
    suggestedActions: ["שלח פרויקטים לויקטור", "עדכן יעד"],
  }];
}

// ── 8. Inactivity ─────────────────────────────────────────────────────────────

export function checkInactivity(
  lastActivityDates: {
    lastProjectUpdate: Date | null;
    lastSessionCreated: Date | null;
    lastPaymentReceived: Date | null;
    lastVictorUpdate: Date | null;
  },
  activeProjectCount: number,
  threshold = 3
): AlertInput[] {
  if (activeProjectCount === 0) return []; // nothing to worry about
  const now = new Date();
  const all = [
    lastActivityDates.lastProjectUpdate,
    lastActivityDates.lastSessionCreated,
    lastActivityDates.lastPaymentReceived,
    lastActivityDates.lastVictorUpdate,
  ].filter(Boolean) as Date[];
  if (all.length === 0) return [];
  const mostRecent = all.reduce((a, b) => (a > b ? a : b));
  const days = daysBetween(mostRecent, now);
  if (days < threshold) return [];
  return [{
    type: "inactivity",
    severity: "important",
    title: `⚡ לא הייתה פעילות עסקית ${days} ימים`,
    message: `לא הייתה פעילות משמעותית במערכת ב-${days} הימים האחרונים. יש כרגע ${activeProjectCount} פרויקטים פעילים שדורשים קידום. האם זה שבוע שקט בכוונה?`,
    metadata: { daysSinceLastActivity: days, activeProjectCount, mostRecentActivity: mostRecent.toISOString() },
    suggestedActions: ["בדוק פרויקטים פעילים", "קבע סשן", "עדכן סטטוס"],
  }];
}

// ── 9. Goals progress ─────────────────────────────────────────────────────────

export function checkGoalsProgress(progress: GoalsProgress | null): AlertInput[] {
  if (!progress) return [];
  const alerts: AlertInput[] = [];

  const check = (
    key: string,
    label: string,
    actual: number,
    expectedByNow: number,
    target: number,
    suffix = ""
  ) => {
    if (expectedByNow === 0) return;
    const pct = actual / expectedByNow;
    if (pct >= 0.6) return;
    alerts.push({
      type: "goal_behind",
      severity: "warning",
      title: `🎯 מתחת לקצב — ${label}`,
      message: `${label}: בפועל ${actual}${suffix}, צפוי עד עכשיו ${expectedByNow}${suffix} (יעד חודשי/שבועי: ${target}${suffix}). הקצב מתחת ל-60%.`,
      metadata: { goalKey: key, actual, expectedByNow, target },
      suggestedActions: ["עדכן יעד", "בדוק ביצועים"],
    });
  };

  const r = progress.monthlyRevenue;
  check("monthlyRevenue", "הכנסות חודשיות", r.actual, r.expectedByNow, r.target, r.currency);
  const s = progress.weeklySessions;
  check("weeklySessions", "סשנים שבועיים", s.actual, s.target, s.target, "");
  const v = progress.monthlyVictor;
  check("monthlyVictor", "יעד ויקטור", v.actual, v.expectedByNow, v.target, "");
  const c = progress.monthlyCompletions;
  check("monthlyCompletions", "פרויקטים שהושלמו", c.actual, c.expectedByNow, c.target, "");

  return alerts;
}

// ── 10. Completed projects with no delivery folder ────────────────────────────

export function checkCompletedNoDelivery(
  projects: Array<{ id: string; name: string; status: string; files?: Array<{ dropboxPath?: string }> }>
): AlertInput[] {
  const completed = projects.filter(
    (p) => p.status === "הושלם" && (!p.files || !p.files.some((f) => f.dropboxPath))
  );
  return aggregate(
    completed,
    (p) => ({
      type: "completed_no_delivery",
      severity: "info",
      title: `📦 פרויקט הושלם ללא תיקיית מסירה — ${p.name}`,
      message: `"${p.name}" הושלם אבל אין תיקיית Dropbox עם קבצי מסירה. כדאי ליצור תיקיה ולהעלות את הגרסה הסופית.`,
      relatedProjectId: p.id,
      entityKey: `completed_no_delivery:${p.id}`,
      suggestedActions: ["צור תיקיית מסירה", "העלה קבצים"],
    }),
    (items) => ({
      type: "completed_no_delivery",
      severity: "info",
      title: `📦 ${items.length} פרויקטים הושלמו ללא תיקיית מסירה`,
      message: `יש ${items.length} פרויקטים שהושלמו ללא קבצי מסירה ב-Dropbox.`,
      metadata: { projectIds: items.map((p) => p.id), count: items.length },
      suggestedActions: ["פתח פרויקטים", "הוסף קבצי מסירה"],
    }),
  );
}

// ── 11. Stale sessions (active project, no session in 14+ days) ───────────────

export function checkStaleSessions(
  projects: Array<{ id: string; name: string; status: string }>,
  recentSessions: Array<{ project_id: string; created_at: string }>,
  days = 14
): AlertInput[] {
  const ACTIVE_STATUSES = new Set(["בעבודה", "במיקס", "מחכה למיקס", "לא התחיל"]);
  const now = new Date();
  const active = projects.filter((p) => ACTIVE_STATUSES.has(p.status));
  const stale = active.filter((p) => {
    const lastSession = recentSessions
      .filter((s) => s.project_id === p.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    if (!lastSession) return true; // never had a session
    return daysBetween(new Date(lastSession.created_at), now) >= days;
  });
  return aggregate(
    stale,
    (p) => ({
      type: "stale_session",
      severity: "warning",
      title: `🎵 פרויקט ללא סשן — ${p.name}`,
      message: `לפרויקט "${p.name}" לא נקבע סשן ב-${days}+ הימים האחרונים. האם הפרויקט בהתקדמות?`,
      relatedProjectId: p.id,
      entityKey: `stale_session:${p.id}`,
      suggestedActions: ["קבע סשן", "עדכן סטטוס"],
    }),
    (items) => ({
      type: "stale_session",
      severity: "warning",
      title: `🎵 ${items.length} פרויקטים ללא סשן ב-${days} ימים`,
      message: `יש ${items.length} פרויקטים פעילים שלא היה להם סשן ב-${days}+ ימים. ${items.slice(0, 3).map((p) => p.name).join(", ")}${items.length > 3 ? ` ועוד` : ""}.`,
      metadata: { projectIds: items.map((p) => p.id), count: items.length, daysSinceSession: days },
      suggestedActions: ["פתח פרויקטים", "קבע סשנים"],
    }),
  );
}
