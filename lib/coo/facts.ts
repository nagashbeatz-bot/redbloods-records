/**
 * Company State builder — PURE (no I/O). Turns the raw rows the readers fetched
 * into reliable facts + coverage + data-quality notes.
 *
 * Non-negotiables:
 *   - a source that failed becomes `null` (unknown), never an empty list / zero;
 *   - money is per currency and never merged (lib/finance);
 *   - project finance is looked up project → finance_<id> only (never a scan of
 *     every finance_* row), and only in the project's own currency (R5);
 *   - only links that carry a real ID are trusted (see signals/cases).
 */
import type { CooConfig } from "./config";
import type {
  CompanyState, CooRawInput, CoverageEntry, DataQualityItem, ProjectFact, TaskFact, TasksFact,
  StevenFact, StevenWorkFact, VictorFact, VictorWorkFact, ProposalFact, ShowFact, ShowsFact,
  SessionFact, FinanceFact, MonthTotals, ExpectedIncomeFact, ReceivablesFact, ReceivableRow,
  ReleasesFact, ReleaseFact, AlertsFact, AlertFact, RawFinanceSetting, RawStevenWork,
} from "./types";
import { COO_TZ, addDays, daysSinceIso, diffDays, ilYmd, monthOf, parseYmd, prevMonth, weekdayHe } from "./dates";
import { addToTotals, normalizeCurrency, partitionByCurrency, isReceivedStatus, isCancelledStatus, DEFAULT_CURRENCY, type CurrencyTotals } from "../finance";
import { isSongIncome } from "../clip-finance";
import { collectibleBalance } from "../payment-status";
import { totalsRich, richText } from "./rich";
import { computeVictorBall } from "./victor-ball";

const SCHEMA_VERSION = "coo-state-1";

const cov = (key: string, label: string, total: number | null, usable: number | null, note: string): CoverageEntry =>
  ({ key, label, total, usable, note });
const dqi = (id: string, label: string, count: number, detail: string, severity: "info" | "warn" = "info"): DataQualityItem =>
  ({ id, label, count, detail, severity });

const CLOSED_PROPOSAL = new Set(["נסגר", "לא נסגר"]);
const CONFIRMED_SHOW = new Set(["אושרה", "נסגר"]);
const LEAD_SHOW = new Set(["ליד חדש", "ממתין לתשובה", "צריך פולואפ"]);

function uiStatusOfSteven(status: string, hasMixVersion: boolean): string {
  if (status === "אושר") return "הושלם";
  if (status === "בוטל") return "בוטל";
  if (status === "לא נשלח" && !hasMixVersion) return "לא התחיל";
  return "פעיל";
}

export function buildCompanyState(raw: CooRawInput, now: Date, cfg: CooConfig): CompanyState {
  const today = ilYmd(now);
  const coverage: CoverageEntry[] = [];
  const dq: DataQualityItem[] = [];
  const unavailable = (key: string, label: string) => coverage.push(cov(key, label, null, null, "המקור לא היה זמין בריצה הזו — אין מידע"));

  // ── projects ───────────────────────────────────────────────────────────────
  const settingsByProject = new Map<string, RawFinanceSetting>();
  for (const s of raw.financeSettings ?? []) settingsByProject.set(s.projectId, s);

  let projects: CompanyState["projects"] = null;
  const projectIndex: Record<string, { name: string; status: string; businessType: string; artistText: string }> = {};
  if (raw.projects) {
    const open: ProjectFact[] = [];
    const byStatus: Record<string, number> = {};
    for (const p of raw.projects) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      projectIndex[p.id] = { name: p.name, status: p.status, businessType: p.businessType, artistText: p.artist };
      if (cfg.closedProjectStatuses.includes(p.status)) continue;
      const ymd = parseYmd(p.deadline);
      const hasRaw = !!(p.deadline && p.deadline.trim());
      open.push({
        id: p.id, name: p.name, artistText: p.artist, status: p.status, projectType: p.projectType, businessType: p.businessType,
        deadline: { raw: p.deadline, ymd, daysTo: ymd ? diffDays(today, ymd) : null, parseOk: !hasRaw || ymd !== null },
        daysSinceUpdate: daysSinceIso(p.updatedAt, now),
        active: !cfg.inactiveProjectStatuses.includes(p.status),
        hasFinanceSetting: settingsByProject.has(p.id),
      });
    }
    projects = { total: raw.projects.length, byStatus, open, index: projectIndex };
    const active = open.filter((p) => p.active);
    const withDeadline = active.filter((p) => p.deadline.ymd !== null);
    coverage.push(cov("projects.deadline", "פרויקטים פעילים עם דדליין תקין", active.length, withDeadline.length,
      "רק פרויקטים פעילים (לא הושלם/בוטל/בהשהייה). פרויקט בלי דדליין לא נבדק מול דדליין."));
    const noDeadline = active.filter((p) => !p.deadline.raw || !p.deadline.raw.trim());
    if (noDeadline.length) dq.push(dqi("projects.no_deadline", "פרויקטים פעילים בלי דדליין", noDeadline.length, "לא נבדקים מול דדליין — אין מידע."));
    const badDeadline = active.filter((p) => !p.deadline.parseOk);
    if (badDeadline.length) dq.push(dqi("projects.bad_deadline", "דדליין שלא ניתן לפענוח", badDeadline.length, "הדדליין הוא טקסט ולא בפורמט YYYY-MM-DD.", "warn"));
  } else unavailable("projects.deadline", "פרויקטים");

  // ── tasks ──────────────────────────────────────────────────────────────────
  let tasks: TasksFact | null = null;
  if (raw.tasks) {
    const items: TaskFact[] = [];
    let unresolved = 0;
    // tasks auto-created from a Victor internal deadline (vendor_project_work.linked_task_id): the same fact as the work's deadline
    const derivedTask = new Map<string, string>();
    for (const w of raw.victor?.works ?? []) if (w.linkedTaskId) derivedTask.set(w.linkedTaskId, w.id);
    for (const t of raw.tasks) {
      const due = parseYmd(t.dueDate);
      let projectId: string | null = null;
      let linkUnresolved = false;
      if (t.relatedType === "project" && t.relatedId) {
        if (projectIndex[t.relatedId]) projectId = t.relatedId; else { linkUnresolved = true; unresolved++; }
      }
      const createdYmd = t.createdAt && !Number.isNaN(Date.parse(t.createdAt)) ? ilYmd(new Date(t.createdAt)) : null;
      const vw = derivedTask.get(t.id);
      items.push({
        id: t.id, title: t.title, dueYmd: due, daysOverdue: due ? diffDays(due, today) : null, relatedType: t.relatedType, projectId, linkUnresolved,
        createdYmd, ageDays: createdYmd ? diffDays(createdYmd, today) : null, leadDays: createdYmd && due ? diffDays(createdYmd, due) : null,
        derivedFrom: vw ? { type: "victor_work", id: vw } : null,
      });
    }
    const overdue = items.filter((t) => t.daysOverdue !== null && t.daysOverdue > 0);
    tasks = {
      openCount: items.length,
      overdueCount: overdue.length,
      noDueCount: items.filter((t) => t.dueYmd === null).length,
      ageBuckets: {
        d1_7: overdue.filter((t) => (t.daysOverdue as number) <= 7).length,
        d8_30: overdue.filter((t) => (t.daysOverdue as number) > 7 && (t.daysOverdue as number) <= 30).length,
        d31plus: overdue.filter((t) => (t.daysOverdue as number) > 30).length,
      },
      linkedToProject: items.filter((t) => t.projectId).length,
      autoVictor: { open: items.filter((t) => t.derivedFrom).length, overdue: overdue.filter((t) => t.derivedFrom).length },
      age: (() => {
        const ages = items.map((t) => t.ageDays).filter((d): d is number => d !== null && d >= 0).sort((a, b) => a - b);
        return {
          median: ages.length === 0 ? null : ages.length % 2 ? ages[(ages.length - 1) / 2] : Math.round((ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2),
          oldest: ages.length ? ages[ages.length - 1] : null,
          d0_7: ages.filter((d) => d <= 7).length, d8_30: ages.filter((d) => d > 7 && d <= 30).length, d31plus: ages.filter((d) => d > 30).length,
          unknown: items.length - ages.length,
        };
      })(),
      createdOnDueDate: items.filter((t) => t.createdYmd !== null && t.dueYmd === t.createdYmd).length,
      items,
    };
    coverage.push(cov("tasks.link", "משימות פתוחות שמקושרות לפרויקט קיים", tasks.openCount, tasks.linkedToProject,
      "רק משימות עם related_type=project ו-related_id תקין. שאר המשימות נספרות באגרגט בלבד."));
    if (unresolved) dq.push(dqi("tasks.unresolved_link", "משימות מקושרות לפרויקט שלא קיים / מוסתר", unresolved, "הקישור לא ניתן לפענוח, המשימות לא משויכות לפרויקט."));
  } else unavailable("tasks.link", "משימות");

  // ── Steven ─────────────────────────────────────────────────────────────────
  let steven: StevenFact | null = null;
  if (raw.steven) {
    const mapWork = (w: RawStevenWork): StevenWorkFact => {
      const ymd = parseYmd(w.internalDeadline);
      return {
        id: w.id, projectId: w.projectId && projectIndex[w.projectId] ? w.projectId : null, title: w.title, status: w.status,
        uiStatus: uiStatusOfSteven(w.status, w.hasMixVersion), agreedPrice: w.agreedPrice, currency: normalizeCurrency(w.currency),
        amountPaid: w.amountPaid, sentDate: parseYmd(w.sentDate), internalDeadline: ymd, daysToInternal: ymd ? diffDays(today, ymd) : null,
        hasMixVersion: w.hasMixVersion, lastUploadAt: w.lastUploadAt,
      };
    };
    const all = raw.steven.map(mapWork);
    const open = all.filter((w) => !cfg.stevenClosedStatuses.includes(w.status));
    const approvedUnpaid = all.filter((w) => w.status === "אושר" && w.agreedPrice > 0 && w.amountPaid < w.agreedPrice);
    const byCurrency: CurrencyTotals = {};
    for (const w of approvedUnpaid) addToTotals(byCurrency, w.currency, w.agreedPrice - w.amountPaid);
    steven = { totalWorks: all.length, open, approvedUnpaid: { works: approvedUnpaid, byCurrency }, linkedOpen: open.filter((w) => w.projectId).length };
    coverage.push(cov("steven.link", "עבודות Steven פתוחות שמקושרות לפרויקט", open.length, steven.linkedOpen,
      "רק עבודות עם project_id תקין מחוברות ל-Case של פרויקט. השאר מופיעות ברמת הצוות."));
  } else unavailable("steven.link", "עבודות Steven");

  // ── Victor ─────────────────────────────────────────────────────────────────
  let victor: VictorFact | null = null;
  if (raw.victor) {
    const activeRaw = raw.victor.works.filter((w) => w.status === "פעיל");
    const mapV = (w: (typeof activeRaw)[number]): VictorWorkFact => {
      const b = computeVictorBall(w, cfg);
      return {
        id: w.id, projectId: w.projectId && projectIndex[w.projectId] ? w.projectId : null, title: w.title, workState: w.workState,
        sentDate: parseYmd(w.sentDate), daysSinceSent: w.daysSinceSent, internalDeadline: parseYmd(w.internalDeadline), isStuck: w.isStuck,
        lastUploadAt: b.lastUploadAt, lastNotesSentAt: b.lastNotesSentAt, ball: b.ball, linkedTaskId: w.linkedTaskId,
        waitingOwnerDays: b.ball.holder === "owner" && b.lastUploadAt ? diffDays(ilYmd(new Date(b.lastUploadAt)), today) : null,
      };
    };
    const active = activeRaw.map(mapV);
    const ownerItems = active.filter((w) => w.ball.holder === "owner").sort((a, b) => (b.waitingOwnerDays ?? 0) - (a.waitingOwnerDays ?? 0));
    const waits = ownerItems.map((w) => w.waitingOwnerDays as number).sort((a, b) => a - b);
    // Age of the active works (days since sent) — the COO shows this instead of the portal's "stuck" label.
    const edges = cfg.victorAgeEdges;
    const ages = active.map((w) => w.daysSinceSent).filter((d): d is number => d !== null && d >= 0).sort((a, b) => a - b);
    const bucketDefs = edges.map((hi, i) => ({ label: i === 0 ? `0–${hi} ימים` : `${edges[i - 1] + 1}–${hi} ימים`, lo: i === 0 ? 0 : edges[i - 1] + 1, hi }));
    const buckets = [
      ...bucketDefs.map((b) => ({ label: b.label, count: ages.filter((d) => d >= b.lo && d <= b.hi).length })),
      { label: `${edges[edges.length - 1] + 1}+ ימים`, count: ages.filter((d) => d > edges[edges.length - 1]).length },
    ];
    const median = ages.length === 0 ? null : ages.length % 2 ? ages[(ages.length - 1) / 2] : Math.round((ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2);
    victor = {
      totalWorks: raw.victor.works.length, active,
      stuckCount: active.filter((w) => w.isStuck).length,
      ballCounts: { owner: ownerItems.length, victor: active.filter((w) => w.ball.holder === "victor").length, unknown: active.filter((w) => w.ball.holder === "unknown").length },
      ownerQueue: {
        items: ownerItems, count: ownerItems.length, oldDays: cfg.victorBall.ownerWaitingOldDays,
        oldCount: waits.filter((d) => d >= cfg.victorBall.ownerWaitingOldDays).length,
        median: waits.length === 0 ? null : waits.length % 2 ? waits[(waits.length - 1) / 2] : Math.round((waits[waits.length / 2 - 1] + waits[waits.length / 2]) / 2),
        oldest: waits.length ? waits[waits.length - 1] : null,
        noNotes: ownerItems.filter((w) => w.lastNotesSentAt === null).length,
      },
      linkedActive: active.filter((w) => w.projectId).length,
      stuckAfterDays: raw.victor.stuckAfterDays,
      ageStats: { buckets, noDate: active.length - ages.length, median, oldest: ages.length ? ages[ages.length - 1] : null },
    };
    coverage.push(cov("victor.link", "עבודות Victor פעילות שמקושרות לפרויקט", active.length, active.filter((w) => w.projectId).length,
      "רוב העבודות של Victor הן בלי פרויקט. הן מופיעות ברמת הצוות בלבד."));
  } else unavailable("victor.link", "עבודות Victor");

  // ── proposals ──────────────────────────────────────────────────────────────
  let proposals: ProposalFact[] | null = null;
  if (raw.proposals) {
    proposals = raw.proposals.filter((p) => !CLOSED_PROPOSAL.has(p.status)).map((p) => {
      const f = parseYmd(p.followupDate);
      return {
        id: p.id, clientName: p.clientName, title: p.title, amount: p.amount, currency: normalizeCurrency(p.currency), status: p.status,
        followupYmd: f, daysOverdue: f ? diffDays(f, today) : null, linkedProjectId: p.linkedProjectId,
      };
    });
  }

  // ── shows ──────────────────────────────────────────────────────────────────
  let shows: ShowsFact | null = null;
  if (raw.shows) {
    const facts: ShowFact[] = raw.shows.map((s) => {
      const d = parseYmd(s.date);
      return {
        id: s.id, name: s.name, status: s.status, paymentStatus: s.paymentStatus, dateYmd: d, daysTo: d ? diffDays(today, d) : null, price: s.price, advance: s.advance, incomeTxId: s.incomeTxId,
        djClientId: s.djClientId ?? null, djConfirmationStatus: s.djConfirmationStatus ?? null, djConfirmedAt: s.djConfirmedAt ?? null,
      };
    });
    const cancelled = (s: ShowFact) => s.status === "בוטל" || s.paymentStatus === "בוטל";
    const upcoming = facts.filter((s) => CONFIRMED_SHOW.has(s.status) && !cancelled(s) && s.daysTo !== null && s.daysTo >= 0)
      .sort((a, b) => (a.daysTo as number) - (b.daysTo as number));
    const done = facts.filter((s) => s.status === "בוצע" && !cancelled(s));
    const doneUnpaid = done.filter((s) => s.paymentStatus !== "שולם" && s.price > 0);
    const performedDates = done.map((s) => s.dateYmd).filter((d): d is string => !!d).sort();
    shows = { total: facts.length, upcoming, doneUnpaid, leadsCount: facts.filter((s) => LEAD_SHOW.has(s.status)).length, lastPerformedYmd: performedDates.length ? performedDates[performedDates.length - 1] : null };
    const zeroPriced = done.filter((s) => s.paymentStatus !== "שולם" && !(s.price > 0));
    if (zeroPriced.length) dq.push(dqi("shows.done_no_price", "הופעות שבוצעו בלי מחיר ובלי סטטוס תשלום 'שולם'", zeroPriced.length, "לא ניתן לדעת אם יש כסף לגבות — לא נכללות בהתראת גבייה.", "warn"));
    coverage.push(cov("shows", "הופעות", facts.length, facts.length, "אין שדה מטבע בהופעות (מוצג ₪ כהנחה); רק הופעות שנרשמו במערכת. אין נתוני 'לידים' בפועל."));
  } else unavailable("shows", "הופעות");

  // ── sessions (planned only) ────────────────────────────────────────────────
  let sessions: SessionFact[] | null = null;
  if (raw.sessions) {
    sessions = raw.sessions
      .filter((s) => s.status === "מתוכנן" && parseYmd(s.date))
      .map((s): SessionFact => {
        const d = parseYmd(s.date) as string;
        return { id: s.id, projectId: s.projectId && projectIndex[s.projectId] ? s.projectId : null, projectName: s.projectId && projectIndex[s.projectId] ? projectIndex[s.projectId].name : null, dateYmd: d, daysTo: diffDays(today, d), start: s.startTime, end: s.endTime, sessionType: s.sessionType };
      })
      .filter((s) => s.daysTo >= 0 && s.daysTo <= cfg.sessionWindowDays)
      .sort((a, b) => a.daysTo - b.daysTo || ((a.start ?? "") < (b.start ?? "") ? -1 : 1));
    coverage.push(cov("sessions", "סשנים מתוכננים", null, sessions.length,
      `רק סשנים במצב 'מתוכנן' ב-${cfg.sessionWindowDays} הימים הקרובים. יומן Google לא נכלל, ואין מידע על נוכחות בפועל.`));
  } else unavailable("sessions", "סשנים");

  // ── finance (per currency) ─────────────────────────────────────────────────
  let finance: FinanceFact | null = null;
  let receivables: ReceivablesFact | null = null;
  if (raw.transactions) {
    const curMonth = monthOf(today);
    const prev = prevMonth(curMonth);
    const mk = (m: string): MonthTotals => ({ month: m, receivedByCurrency: {}, paidExpensesByCurrency: {} });
    const cm = mk(curMonth), pm = mk(prev);
    const expectedOverdue: ExpectedIncomeFact[] = [];
    const undatedByCur: CurrencyTotals = {};
    let undatedCount = 0;
    const currencies = new Set<string>();
    let badType = 0;
    let dated = 0;
    for (const t of raw.transactions) {
      const cur = normalizeCurrency(t.currency);
      currencies.add(cur);
      if (t.type !== "income" && t.type !== "expense") badType++;
      const d = parseYmd(t.date);
      if (!d) {
        if (!isCancelledStatus(t.status)) { undatedCount++; addToTotals(undatedByCur, cur, t.amount); }
        continue;
      }
      dated++;
      const bucket = monthOf(d) === curMonth ? cm : monthOf(d) === prev ? pm : null;
      if (bucket) {
        if (t.type === "income" && isReceivedStatus(t.status)) addToTotals(bucket.receivedByCurrency, cur, t.amount);
        if (t.type === "expense" && t.status === "שולם") addToTotals(bucket.paidExpensesByCurrency, cur, t.amount);
      }
      if (t.type === "income" && t.status === "צפוי" && diffDays(d, today) > 0) {
        expectedOverdue.push({ txId: t.id, projectId: t.projectId, amount: t.amount, currency: cur, dateYmd: d, daysOverdue: diffDays(d, today), category: t.category ?? "", clip: t.expenseScope === "קליפ" });
      }
    }
    finance = { currentMonth: cm, previousMonth: pm, expectedOverdue, undated: { count: undatedCount, byCurrency: undatedByCur }, currenciesPresent: Array.from(currencies).sort() };
    coverage.push(cov("finance.dated", "תנועות עם תאריך", raw.transactions.length, dated,
      "תקבולים והוצאות שנרשמו כתנועות בלבד. לא נכללים הכנסות מדיה, תקציבי Red Films וספר האמנים. אין חישוב רווח כולל."));
    if (undatedCount) dq.push(dqi("finance.undated", "תנועות ללא תאריך", undatedCount, `לא נכנסות לסכומי החודש. סכום לפי מטבע: ${richText(totalsRich(undatedByCur))}`, "warn"));
    const nonIls = finance.currenciesPresent.filter((c) => c !== DEFAULT_CURRENCY);
    if (nonIls.length) dq.push(dqi("finance.non_ils", "תנועות במטבע שאינו ₪", raw.transactions.filter((t) => normalizeCurrency(t.currency) !== DEFAULT_CURRENCY).length, `מטבעות: ${nonIls.join(", ")}. מוצגות בנפרד, לא מוסיפות ל-₪.`));
    if (badType) dq.push(dqi("finance.bad_type", "תנועות עם type לא צפוי", badType, "type שאינו income/expense — לא נספרות.", "warn"));

    // receivables: project → finance_<id> only (never a scan of settings)
    if (raw.projects) {
      const considered = raw.projects.filter((p) => p.status !== "בוטל");
      const rows: ReceivableRow[] = [];
      let withPrice = 0, exceptions = 0;
      const exceptionIds: string[] = [];
      const balanceByCurrency: CurrencyTotals = {};
      for (const p of considered) {
        const st = settingsByProject.get(p.id);
        if (!st) continue;
        if (st.financeException) { exceptions++; exceptionIds.push(p.id); continue; }
        if (!(st.agreedPrice > 0)) continue;
        withPrice++;
        const currency = normalizeCurrency(st.currency);
        const mine = raw.transactions
          .filter((t) => t.projectId === p.id)
          .map((t) => ({ ...t, currency: t.currency, type: t.type, expense_scope: t.expenseScope }));
        const song = partitionByCurrency(mine.filter((t) => isSongIncome(t)), currency).same;
        const received = song.filter((t) => isReceivedStatus(t.status)).reduce((s, t) => s + t.amount, 0);
        const cancelledSum = song.filter((t) => isCancelledStatus(t.status)).reduce((s, t) => s + t.amount, 0);
        const balance = collectibleBalance(st.agreedPrice, received, cancelledSum);
        const hasDatedExpected = song.some((t) => t.status === "צפוי" && parseYmd(t.date) !== null);
        rows.push({ projectId: p.id, projectName: p.name, projectStatus: p.status, agreedPrice: st.agreedPrice, currency, received, cancelled: cancelledSum, balance, financeException: false, hasDatedExpected });
        if (balance > 0) addToTotals(balanceByCurrency, currency, balance);
      }
      receivables = { considered: considered.length, withPrice, exceptions, exceptionIds, rows, withBalance: rows.filter((r) => r.balance > 0).length, balanceByCurrency };
      coverage.push(cov("receivables", "פרויקטים עם מחיר מוסכם", considered.length, withPrice,
        "יתרה/גבייה ידועה רק לפרויקטים עם agreedPrice. לשאר אין מידע — זה לא 'אפס'."));
      const other = raw.transactions.filter((t) => t.projectId && t.type === "income" && rows.some((r) => r.projectId === t.projectId && normalizeCurrency(t.currency) !== r.currency)).length;
      if (other) dq.push(dqi("receivables.currency_mismatch", "הכנסות בפרויקט מתומחר במטבע שונה ממטבע המחיר", other, "לא נספרות מול המחיר המוסכם (R5).", "warn"));
    } else unavailable("receivables", "יתרות לפרויקט");
  } else { unavailable("finance.dated", "תנועות"); unavailable("receivables", "יתרות לפרויקט"); }

  if (raw.orphanFinanceKeyCount !== null && raw.orphanFinanceKeyCount > 0) {
    dq.push(dqi("finance.orphan_keys", "שורות finance_* של פרויקט שלא קיים", raw.orphanFinanceKeyCount, "לא נכללות בשום חישוב (החיפוש הוא תמיד פרויקט → finance_<id>)."));
  }

  // ── releases ───────────────────────────────────────────────────────────────
  let releases: ReleasesFact | null = null;
  if (raw.releases) {
    const rows: ReleaseFact[] = raw.releases.rows
      .filter((r) => r.stage !== "יצא" && r.stage !== "בהשהייה")
      .map((r) => {
        const t = parseYmd(r.targetDate);
        return { projectId: r.projectId, name: r.name, projectStatus: r.projectStatus, stage: r.stage, targetYmd: t, daysTo: t ? diffDays(today, t) : null, daysInStage: daysSinceIso(r.stageEnteredAt, now), blocker: r.blocker, nextAction: r.nextAction, responsible: r.responsible };
      });
    releases = { labelProjectsTotal: raw.releases.labelProjectsTotal, withReleaseRow: raw.releases.rows.length, rows };
    coverage.push(cov("releases", "פרויקטי לייבל עם שורת release", raw.releases.labelProjectsTotal, raw.releases.rows.length,
      "מוכנות ריליס ידועה רק לפרויקטים עם שורת release. אין מידע על קליפ/הפצה/קבצים."));
  } else unavailable("releases", "ריליסים");

  // ── existing agent_alerts (secondary source; allowlisted + recent only) ────
  let alerts: AlertsFact | null = null;
  if (raw.alerts) {
    const shown: AlertFact[] = [];
    let ignored = 0;
    for (const a of raw.alerts) {
      const age = daysSinceIso(a.createdAt, now);
      if (cfg.alerts.allowTypes.includes(a.type) && age !== null && age <= cfg.alerts.maxAgeDays) {
        shown.push({ id: a.id, type: a.type, severity: a.severity, title: a.title, message: a.message, createdAt: a.createdAt, ageDays: age, relatedProjectId: a.relatedProjectId });
      } else ignored++;
    }
    alerts = { shown, ignoredCount: ignored };
    if (ignored) dq.push(dqi("alerts.ignored", "התראות agent_alerts פתוחות שלא מוצגות", ignored, "סוג שלא ב-allowlist או ישנות מדי. ה-COO לא סומך עליהן ולא משנה אותן."));
    coverage.push(cov("alerts", "התראות קיימות (מקור משני)", raw.alerts.length, shown.length, "מוצגות רק סוגים ידועים ורק מהימים האחרונים. אינן מחליפות עובדה שה-COO יודע מהמקור."));
  } else unavailable("alerts", "התראות קיימות");

  return {
    meta: { asOf: now.toISOString(), todayIL: today, timezone: COO_TZ, weekday: weekdayHe(today), schemaVersion: SCHEMA_VERSION, configVersion: cfg.version },
    sources: raw.sources, coverage, projects, tasks, team: { steven, victor }, proposals, shows, sessions, finance, receivables, releases, alerts, dataQuality: dq,
  };
}

// keep addDays referenced for window helpers used by callers/tests
export { addDays };
