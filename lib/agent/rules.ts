/**
 * Rule-based alert checks — no AI, pure data logic.
 * Each function returns AlertInput[] for issues found.
 * The caller decides whether to persist them (with cooldown).
 */
import type { AlertInput, BusinessGoals, GoalsProgress, VictorMonthStats } from "@/lib/types";
import { isCancelledPayment, actualOutstandingAgainstAgreedPrice } from "@/lib/payment-status";
import { projectIncomeTotals } from "@/lib/finance/project-summary";
import { isExpectedStatus, isReceivedStatus } from "@/lib/finance/classify";
import { normalizeCurrency, orderCurrencies, type CurrencyTotals } from "@/lib/finance/currency";
import { sessionEndLocal, israelNowString } from "@/lib/session-duration";
import { NOT_OVERDUE_STATUSES, isProjectOverdue, isStrictYmd, israelTodayYmd } from "@/lib/project-deadline";

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

/**
 * A row that is no longer "overdue": received (lib/finance/classify — the one status rule) or the legacy
 * legacy partial-paid label below (absent in production; kept so behaviour is unchanged — it is still never FULLY paid).
 */
const LEGACY_PARTIAL_PAID_STATUS = "שולם חלקית";
const isNotOverdueStatus = (s: string | null | undefined) => isReceivedStatus(s) || s === LEGACY_PARTIAL_PAID_STATUS;

/** "1,200₪ · $300" — each currency on its own, never a mixed sum (no FX). */
function formatByCurrency(totals: CurrencyTotals): string {
  return orderCurrencies(Object.keys(totals)).map((c) => `${totals[c].toLocaleString("he-IL")}${c}`).join(" · ");
}

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
  // Read parity (B5): THE project-overdue rule (lib/project-deadline.ts) — Israel day, strict date, closed / on hold never.
  const today = israelTodayYmd();
  const overdue = projects.filter((p) => isProjectOverdue(p, today));
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
      entityKey: "overdue_deadline:bulk",
      suggestedActions: ["פתח רשימת פרויקטים", "עדכן דדליינים"],
    }),
  );
}

// ── 2. Due soon (1–7 days) ────────────────────────────────────────────────────

export function checkDueSoonProjects(
  projects: Array<{ id: string; name: string; artist: string; status: string; deadline: string | null }>
): AlertInput[] {
  const now = new Date();
  const today = israelTodayYmd();
  const DONE_STATUSES = new Set<string>(NOT_OVERDUE_STATUSES);
  const soon = projects.filter((p) => {
    if (!isStrictYmd(p.deadline) || p.deadline <= today || DONE_STATUSES.has(p.status)) return false;
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
      entityKey: "deadline_approaching:bulk",
      suggestedActions: ["פתח דשבורד"],
    }),
  );
}

// ── 3. Sessions needing update ────────────────────────────────────────────────

export function checkSessionsNeedingUpdate(
  sessions: Array<{ id: string; projectName: string; date: string; startTime: string | null; endTime?: string | null; status: string }>
): AlertInput[] {
  // Read parity with the real session vocabulary (A3): a planned (מתוכנן) session whose END passed (overnight-aware,
  // Israel wall clock; no times → end of its day) still needs the Owner's update. Passed ≠ happened.
  const nowIL = israelNowString();
  const stale = sessions.filter((s) => {
    if (s.status !== "מתוכנן" || !s.date) return false;
    const end = sessionEndLocal(s.date, s.startTime, s.endTime ?? null) ?? `${s.date}T23:59:59`;
    return end < nowIL;
  });
  if (stale.length === 0) return [];
  if (stale.length === 1) {
    const s = stale[0];
    return [{
      type: "session_needs_update",
      severity: "warning",
      title: `📅 סשן עבר — ${s.projectName}`,
      message: `סשן של "${s.projectName}" מתאריך ${s.date} עדיין מסומן כ"מתוכנן" (עבר — לא אושר). יש לסמן התקיים / בוטל / לא הגיע.`,
      metadata: { sessionId: s.id, date: s.date },
      entityKey: `session_needs_update:${s.id}`,
      suggestedActions: ["סמן התקיים", "סמן בוטל"],
    }];
  }
  return [{
    type: "session_needs_update",
    severity: "warning",
    title: `📅 ${stale.length} סשנים דורשים עדכון`,
    message: `יש ${stale.length} סשנים שעברו ועדיין מסומנים כ"מתוכנן" (עבר — לא אושר). יש לעדכן סטטוס לכל אחד.`,
    metadata: { sessionIds: stale.map((s) => s.id), count: stale.length },
    entityKey: "session_needs_update:bulk",
    suggestedActions: ["פתח יומן", "עדכן סשנים"],
  }];
}

// ── 4. Overdue payments ───────────────────────────────────────────────────────

/** Finance setting fields the rules read. `currency` = the agreed price's currency (blank = ₪). */
export type RuleFinanceSetting = { agreedPrice?: number | null; financeException?: boolean; currency?: string | null };

/**
 * Received income per project — the ONE aggregation (lib/finance/project-summary projectIncomeTotals): every income row
 * of the project, whatever its expense_scope (one clip model 2026-10-01), ONLY in the project's own finance currency
 * (income in another currency is never compared with the agreed price — no FX).
 */
function paidIncomeByProject(
  transactions: ReadonlyArray<{ projectId: string | null; amount: number; type: string; paymentStatus: string; currency?: string | null }>,
  financeMap: Map<string, RuleFinanceSetting>,
): Map<string, number> {
  const rows = new Map<string, Array<{ type: string; payment_status: string; amount: number; currency?: string | null }>>();
  for (const t of transactions) {
    if (!t.projectId) continue;
    const list = rows.get(t.projectId) ?? [];
    list.push({ type: t.type, payment_status: t.paymentStatus, amount: t.amount, currency: t.currency });
    rows.set(t.projectId, list);
  }
  const paid = new Map<string, number>();
  for (const [id, list] of rows) paid.set(id, projectIncomeTotals(list, financeMap.get(id)?.currency).received);
  return paid;
}

export function checkOverduePayments(
  transactions: Array<{ id: string; projectId: string | null; projectName: string; amount: number; currency: string; date: string | null; type: string; paymentStatus: string; expenseScope?: string | null }>,
  financeMap: Map<string, RuleFinanceSetting>
): AlertInput[] {
  const today = new Date().toISOString().split("T")[0];

  // Received income per project, in the project's currency — every income row counts (one clip model 2026-10-01).
  const paidByProject = paidIncomeByProject(transactions, financeMap);

  const overdue = transactions.filter((t) => {
    // Cancelled ("בוטל") income is never overdue — it counts as no income at all.
    if (!INCOME_TYPES.has(t.type) || !t.date || t.date >= today || isNotOverdueStatus(t.paymentStatus) || isCancelledPayment(t.paymentStatus)) return false;
    if (t.projectId) {
      // Skip projects flagged as a finance exception (no charge / favor).
      if (financeMap.get(t.projectId)?.financeException) return false;
      // Skip if project is already fully paid or overpaid (its ONE agreed price).
      // A missing / zero agreed price is PRICE_UNKNOWN — never "fully paid".
      const agreedPrice = Number(financeMap.get(t.projectId)?.agreedPrice ?? 0) || 0;
      const paidIncome  = paidByProject.get(t.projectId) ?? 0;
      if (agreedPrice > 0 && paidIncome >= agreedPrice) return false;
    }
    return true;
  });
  if (overdue.length === 0) return [];
  // Totals PER CURRENCY — never one mixed number.
  const totalsByCurrency: CurrencyTotals = {};
  for (const t of overdue) { const c = normalizeCurrency(t.currency); totalsByCurrency[c] = (totalsByCurrency[c] ?? 0) + t.amount; }
  const currencies = Object.keys(totalsByCurrency);
  const total = currencies.length === 1 ? totalsByCurrency[currencies[0]] : null;
  const currency = currencies.length === 1 ? currencies[0] : null;
  if (overdue.length === 1) {
    const t = overdue[0];
    return [{
      type: "payment_overdue",
      severity: "important",
      title: `💸 תשלום בפיגור — ${t.projectName}`,
      message: `תשלום של ${t.amount.toLocaleString("he-IL")}${normalizeCurrency(t.currency)} מפרויקט "${t.projectName}" לא עודכן כהתקבל. האם התשלום הגיע?`,
      metadata: { transactionId: t.id, amount: t.amount, currency: normalizeCurrency(t.currency) },
      entityKey: `payment_overdue:${t.id}`,
      suggestedActions: ["סמן כהתקבל", "שלח תזכורת"],
    }];
  }
  return [{
    type: "payment_overdue",
    severity: "important",
    title: `💸 ${overdue.length} תשלומים בפיגור`,
    message: `יש ${overdue.length} תשלומים שלא עודכנו כהתקבלו, סה״כ ${formatByCurrency(totalsByCurrency)}. כדאי לבדוק מה הגיע.`,
    metadata: { transactionIds: overdue.map((t) => t.id), total, currency, totalsByCurrency, count: overdue.length },
    entityKey: "payment_overdue:bulk",
    suggestedActions: ["פתח עמוד כספים", "עדכן תשלומים"],
  }];
}

// ── 4b. Open balance with no scheduled payment date ───────────────────────────

// Income transaction types. The DB stores both Hebrew and English type values
// depending on the code path that created the row (see lib/reports/data.ts).
// We treat ONLY these explicit values as income — never "anything not expense".
const INCOME_TYPES = new Set(["income", "הכנסה"]);

export function checkBalanceMissingDueDate(
  projects: Array<{ id: string; name: string; artist: string; status: string }>,
  transactions: Array<{ projectId: string | null; amount: number; type: string; paymentStatus: string; date: string | null; expenseScope?: string | null; currency?: string | null }>,
  financeMap: Map<string, RuleFinanceSetting>
): AlertInput[] {
  // Paid income per project — same income predicate + statuses as the UI balance, in the project's currency only.
  const paidByProject = paidIncomeByProject(transactions, financeMap);
  // Projects that already have an expected ("צפוי") income carrying a date.
  const hasDatedExpected = new Set<string>();
  for (const t of transactions) {
    if (!t.projectId || !INCOME_TYPES.has(t.type)) continue;
    if (isExpectedStatus(t.paymentStatus) && t.date) {
      hasDatedExpected.add(t.projectId);
    }
  }

  const alerts: AlertInput[] = [];
  for (const p of projects) {
    if (p.status === "בוטל") continue;                        // cancelled project → no open-balance alert
    const setting = financeMap.get(p.id);
    if (setting?.financeException) continue;                  // (5) finance exception
    const agreed = setting?.agreedPrice ?? 0;
    if (!agreed || agreed <= 0) continue;                     // (1) agreedPrice > 0
    const paidIncome = paidByProject.get(p.id) ?? 0;
    // Actual payment truth — agreedPrice vs paidIncome only. This function only
    // ever reaches non-cancelled projects (the `p.status === "בוטל"` check
    // above), so an individually-cancelled transaction on one of these must
    // never suppress a real balance (Finance Semantics Unification audit,
    // 2026-09-22 — this was a confirmed live miss: a completed project with
    // agreedPrice=3200/received=1600/one cancelled ₪1600 line item was
    // silently never alerted on).
    const balance = actualOutstandingAgainstAgreedPrice(agreed, paidIncome);
    if (balance <= 0) continue;                               // (2)(3)(6) open balance
    if (hasDatedExpected.has(p.id)) continue;                 // (4) no dated expected income

    alerts.push({
      type: "balance_missing_due_date",
      severity: "warning",
      title: "חסר תאריך לתשלום יתרה",
      message: `לפרויקט ${p.name} נשארה יתרה של ${balance.toLocaleString("he-IL")}${normalizeCurrency(setting?.currency)} ללא תאריך תשלום.`,
      relatedProjectId: p.id,
      metadata: { projectId: p.id, balance, agreedPrice: agreed, paidIncome, currency: normalizeCurrency(setting?.currency) },
      entityKey: `balance_missing_due_date:${p.id}`,
      suggestedActions: ["קבע תאריך תשלום", "סמן כחריג", "עדכן תשלום"],
    });
  }
  return alerts;
}

// ── 5. Projects with no pricing ───────────────────────────────────────────────

export function checkProjectsNoPricing(
  projects: Array<{ id: string; name: string; artist: string; status: string }>,
  financeSettings: Map<string, { agreedPrice?: number | null }>
): AlertInput[] {
  const DONE_STATUSES = new Set(["הושלם", "בהשהייה", "בוטל"]);
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
      entityKey: "project_no_pricing:bulk",
      suggestedActions: ["פתח רשימת פרויקטים", "הגדר מחירים"],
    }),
  );
}

// ── 5b. Proposal follow-up due ────────────────────────────────────────────────

// Closed proposal statuses (same set used across dashboard/insights/context).
const CLOSED_PROPOSAL_STATUSES = new Set(["נסגר", "לא נסגר"]);

export function checkProposalFollowupDue(
  proposals: Array<{ id: string; clientId: string | null; clientName: string; amount: number; currency: string; status: string; followupDate: string | null }>
): AlertInput[] {
  const today = new Date().toISOString().split("T")[0];
  const alerts: AlertInput[] = [];
  for (const p of proposals) {
    if (!p.followupDate) continue;                       // (2) has a follow-up date
    if (p.followupDate > today) continue;                // (3) due today or past
    if (CLOSED_PROPOSAL_STATUSES.has(p.status)) continue; // (4)(5) still open only

    const name = p.clientName || "לקוח";
    const amountPart = p.amount > 0 ? ` על סך ${p.amount.toLocaleString("he-IL")}${p.currency || "₪"}` : "";
    alerts.push({
      type: "proposal_followup_due",
      severity: "warning",
      title: "צריך פולואפ להצעת מחיר",
      message: `צריך לחזור ל-${name} לגבי הצעה${amountPart}.`,
      relatedClientId: p.clientId ?? null,
      metadata: {
        proposalId: p.id, clientId: p.clientId, clientName: name,
        amount: p.amount, followupDate: p.followupDate, status: p.status,
      },
      entityKey: `proposal_followup_due:${p.id}`,
      suggestedActions: ["חזור ללקוח", "עדכן סטטוס", "עדכן תאריך מעקב"],
    });
  }
  return alerts;
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
    entityKey: "victor_stuck:bulk",
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
    entityKey: "victor_below_pace:bulk",
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
    entityKey: "inactivity:bulk",
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
      entityKey: `goal_behind:${key}`,
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
  projects: Array<{ id: string; name: string; status: string }>,
  deliveries: ReadonlyMap<string, { deliveryStatus?: string; folderPath?: string; lastDeliveredAt?: string }>,
): AlertInput[] {
  // Read parity (B5): the DELIVERY RECORD (settings delivery_<project>) decides — not projects.files. A completed project
  // is flagged only when it has no delivery folder in its record, is not delivered and was never delivered before.
  const completed = projects.filter((p) => {
    if (p.status !== "הושלם") return false;
    const d = deliveries.get(p.id);
    return !d || (!d.folderPath && d.deliveryStatus !== "delivered" && !d.lastDeliveredAt);
  });
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
      entityKey: "completed_no_delivery:bulk",
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
      entityKey: "stale_session:bulk",
      suggestedActions: ["פתח פרויקטים", "קבע סשנים"],
    }),
  );
}
