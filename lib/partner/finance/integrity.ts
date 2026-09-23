/**
 * Redbloods Partner — Finance Integrity + Data Rehabilitation Brain (F2.5–F2.7). Pure, deterministic,
 * no I/O, no clock (`now` injected).
 *
 * NOTICE → CLASSIFY → PRIORITIZE → ASK (read-only). Partner never repairs anything: no transaction,
 * setting, price, due date, recurring flag, Owner Context or Action Event is written anywhere here.
 *
 * Built on the Finance Brain V1 state (same canonical semantics — income received = שולם|התקבל,
 * expense paid = שולם only — via the exported validateTx, never a second copy). Historical gaps
 * (before 2026-09-23) are rehabilitation work; gaps after that date are stronger integrity signals.
 * Language is never blaming ("לא מצאתי", "אני לא מצליח לאשר", "צריך בירור").
 */
import { addDays, diffDays } from "../../coo/dates";
import { fmtMoney } from "./brief";
import { RECORDING_POLICY_START, validateTx, type ValidatedTx } from "./core";
import type { CurrencyTotals, Evidence, FinanceRaw, PartnerFinanceState, Receivable } from "./types";

export const INTEGRITY_SCHEMA_VERSION = "partner-finance-integrity-v1";
export const MAX_REHAB_ITEMS = 3;
export const MAX_SURFACED_QUESTIONS = 2;
/** A received income this close before the due date may be the replacement record of an expected one. */
export const REPLACEMENT_WINDOW_DAYS = 14;

export type IntegrityState = "RELIABLE" | "PARTIAL" | "MISSING" | "AMBIGUOUS" | "NEEDS_OWNER_REVIEW";
export type Epistemic = "FACT" | "DERIVED" | "HYPOTHESIS" | "UNKNOWN";
export type SeverityBand = "HIGH" | "MEDIUM" | "LOW";
export type Period = "HISTORICAL" | "POST_POLICY";

export const ISSUE_TYPES = [
  "PRICE_MISSING", "INCOME_EXPECTED_BUT_NOT_RECORDED", "COMPLETED_WORK_NO_INCOME", "EXPENSE_EXPECTED_BUT_NOT_FOUND",
  "EXPENSE_CLASSIFICATION_UNKNOWN", "RECURRING_EXPENSE_CANDIDATE", "RECURRING_EXPENSE_MISSING_THIS_PERIOD",
  "RECEIVABLE_DUE_DATE_MISSING", "OVERDUE_RECEIVABLE_REASON_UNKNOWN", "ORPHAN_FINANCE_SETTING", "CURRENCY_AMBIGUOUS",
  "UNLINKED_TRANSACTION", "POSSIBLE_DUPLICATE", "POSSIBLE_OBLIGATION_OVERLAP", "LABEL_LEDGER_CURRENCY_MISSING",
  "RED_FILMS_CURRENCY_MISSING", "SHOW_FINANCE_INCOMPLETE", "PROJECT_FINANCE_COVERAGE_INCOMPLETE", "MALFORMED_FINANCE_DATA",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export type QuestionType =
  | "COMPLETED_WORK_INCOME_STATUS" | "DUE_DATE_FOR_BALANCE" | "WHY_PAYMENT_OPEN" | "RECURRING_EXPENSE_RECORD"
  | "IS_RECURRING_EXPENSE" | "ORPHAN_PRICE_MEANING" | "EXPENSE_CLASSIFICATION" | "PROJECT_PRICE";
export interface QuestionOption { code: string; labelHe: string }
export interface OwnerQuestion {
  questionType: QuestionType;
  subject: { type: string; id: string; labelHe: string | null };
  textHe: string;
  whyItMattersHe: string;
  options: QuestionOption[];
  evidence: Evidence[];
  priority: number;
}

export interface RehabIssue {
  id: string;
  issueType: IssueType;
  severityBand: SeverityBand;
  epistemicStatus: Epistemic;
  subjectType: "project" | "transaction" | "finance_setting" | "receivable" | "recurring" | "engineer_work" | "show" | "label_artist" | "red_films" | "company";
  subjectId: string;
  subjectLabel: string | null;
  currency: string | null;
  amount: number | null;
  date: string | null;
  period: Period;
  reasonCodes: string[];
  evidence: Evidence[];
  recommendedOwnerQuestion: OwnerQuestion | null;
}

export type BusinessKind = "CLIENT" | "LABEL" | "UNKNOWN";
export interface ProjectFinanceProfile {
  projectId: string;
  name: string;
  status: string;
  business: BusinessKind;
  price: "PRICE_KNOWN" | "PRICE_UNKNOWN" | "NOT_APPLICABLE";
  income: "INCOME_VISIBLE" | "INCOME_NOT_VISIBLE";
  expenses: "EXPENSES_VISIBLE" | "EXPENSES_PARTIAL" | "EXPENSES_UNKNOWN";
  receivable: "RECEIVABLE_KNOWN" | "RECEIVABLE_UNKNOWN" | "NOT_APPLICABLE";
  dueDate: "DUE_DATE_KNOWN" | "DUE_DATE_MISSING" | "NOT_APPLICABLE";
}

export type ExpenseCategory = "PROJECT_COST" | "TEAM_COST" | "LABEL_COST" | "MARKETING" | "VIDEO_PHOTO" | "SOFTWARE" | "RENT" | "TAX" | "EQUIPMENT" | "GENERAL_BUSINESS" | "UNKNOWN";
export interface ExpenseClassification { txId: string; category: ExpenseCategory; basis: string }

export interface OrphanReviewEntry { projectId: string; amount: number | null; currency: string; txRowsForId: number; question: OwnerQuestion }

export interface RehabOwnerItem { issueType: IssueType; epistemic: Epistemic; textHe: string }

export interface PartnerFinanceIntegrityState {
  schemaVersion: typeof INTEGRITY_SCHEMA_VERSION;
  policyStartYmd: string;
  trust: Record<string, { state: IntegrityState; reason: string }>;
  coverageReasonsHe: string[];
  projects: ProjectFinanceProfile[];
  issues: RehabIssue[];
  orphanQueue: OrphanReviewEntry[];
  expenseClassification: ExpenseClassification[];
  dueDateQueue: Receivable[];
  overdueReasonGaps: { receivableId: string; reason: "OVERDUE_REASON_UNKNOWN" }[];
  questions: OwnerQuestion[];
  top: { items: RehabOwnerItem[]; questions: OwnerQuestion[] };
}

// ── constants ──
const COMPLETED = "הושלם";
const CANCELLED = "בוטל";
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const monthHe = (key: string) => `${HE_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
const periodOf = (ymd: string | null | undefined) => (ymd && ymd.slice(0, 10) >= RECORDING_POLICY_START ? "POST_POLICY" : "HISTORICAL") as Period;

/** Explicit, exact category → class (no fuzzy text; anything else is UNKNOWN). */
const EXPLICIT_CATEGORY: Record<string, ExpenseCategory> = {
  "צוות": "TEAM_COST", "שכר דיג'יי": "TEAM_COST", "שיווק": "MARKETING", "פרסום": "MARKETING",
  "צילום": "VIDEO_PHOTO", "וידאו": "VIDEO_PHOTO", "תוכנה": "SOFTWARE", "מנויים": "SOFTWARE", "שכירות": "RENT",
  "מס": "TAX", "מיסים": "TAX", "ציוד": "EQUIPMENT", "רואה חשבון": "GENERAL_BUSINESS",
};

export const QUESTION_OPTIONS: Record<QuestionType, QuestionOption[]> = {
  COMPLETED_WORK_INCOME_STATUS: [
    { code: "RECEIVED_NOT_RECORDED", labelHe: "ההכנסה התקבלה ולא נרשמה" }, { code: "NOT_YET_RECEIVED", labelHe: "עדיין לא התקבלה" },
    { code: "NOT_PAID_WORK", labelHe: "הפרויקט לא היה בתשלום" }, { code: "UNKNOWN", labelHe: "לא יודע" },
  ],
  DUE_DATE_FOR_BALANCE: [
    { code: "THIS_WEEK", labelHe: "השבוע" }, { code: "THIS_MONTH", labelHe: "עד סוף החודש" }, { code: "NEXT_MONTH", labelHe: "בחודש הבא" },
    { code: "NOT_EXPECTED", labelHe: "לא צפוי להתקבל" }, { code: "UNKNOWN", labelHe: "לא יודע" },
  ],
  WHY_PAYMENT_OPEN: [
    { code: "WAITING_ON_CLIENT", labelHe: "מחכה ללקוח" }, { code: "NEW_DATE_PROMISED", labelHe: "הבטיח תאריך חדש" }, { code: "DISPUTE", labelHe: "יש מחלוקת" },
    { code: "WAITING_ON_DELIVERY", labelHe: "מחכה למסירה" }, { code: "AGREED_TO_POSTPONE", labelHe: "סיכמנו לדחות" }, { code: "OTHER", labelHe: "אחר" }, { code: "UNKNOWN", labelHe: "לא יודע" },
  ],
  RECURRING_EXPENSE_RECORD: [
    { code: "PAID_NOT_RECORDED", labelHe: "שולם — צריך לרשום בכספים" }, { code: "NOT_PAID_YET", labelHe: "עדיין לא שולם" }, { code: "UNKNOWN", labelHe: "לא יודע" },
  ],
  IS_RECURRING_EXPENSE: [{ code: "RECURRING", labelHe: "כן, הוצאה קבועה" }, { code: "ONE_TIME", labelHe: "לא, חד-פעמית" }, { code: "UNKNOWN", labelHe: "לא יודע" }],
  ORPHAN_PRICE_MEANING: [
    { code: "HISTORICAL_ONLY", labelHe: "נתון היסטורי בלבד" }, { code: "REAL_DEAL", labelHe: "עסקה אמיתית שצריך לשחזר/לקשר" }, { code: "UNKNOWN", labelHe: "לא יודע כרגע" },
  ],
  EXPENSE_CLASSIFICATION: [
    { code: "PROJECT_COST", labelHe: "עלות פרויקט" }, { code: "TEAM_COST", labelHe: "צוות" }, { code: "LABEL_COST", labelHe: "לייבל" }, { code: "MARKETING", labelHe: "שיווק" },
    { code: "SOFTWARE", labelHe: "תוכנה / מנוי" }, { code: "GENERAL_BUSINESS", labelHe: "הוצאה כללית של העסק" }, { code: "UNKNOWN", labelHe: "לא יודע" },
  ],
  PROJECT_PRICE: [{ code: "SET_PRICE", labelHe: "יש מחיר — צריך לרשום" }, { code: "NO_CHARGE", labelHe: "לא בתשלום" }, { code: "UNKNOWN", labelHe: "לא יודע" }],
};

// ── the integrity brain ──

export function buildFinanceIntegrity(raw: FinanceRaw, state: PartnerFinanceState, now: Date): PartnerFinanceIntegrityState {
  void now; // the month window / today are already in `state` (same clock); kept for signature symmetry
  const today = state.month.today;
  const txs: ValidatedTx[] = raw.transactions.map(validateTx).filter((t): t is ValidatedTx => t !== null);
  const projectById = new Map(raw.projects.map((p) => [p.id, p]));
  const live = raw.projects.filter((p) => !p.isHidden);
  const settings = new Map(raw.financeSettings.map((s) => [s.projectId, s.value as Record<string, unknown> | null]));
  const priceOf = (id: string) => { const v = settings.get(id); const n = v && typeof v === "object" ? Number(v.agreedPrice) : NaN; return Number.isFinite(n) && n > 0 ? n : null; };
  const exceptionOf = (id: string) => { const v = settings.get(id); return !!(v && typeof v === "object" && v.financeException); };
  const engineerByProject = new Map<string, typeof raw.engineerWorks>();
  for (const w of raw.engineerWorks) if (w.projectId) engineerByProject.set(w.projectId, [...(engineerByProject.get(w.projectId) ?? []), w]);
  const txById = new Map(txs.map((t) => [t.row.id, t]));
  const issues: RehabIssue[] = [];
  const add = (i: Omit<RehabIssue, "id"> & { id?: string }) => issues.push({ ...i, id: i.id ?? `${i.issueType}:${i.subjectType}:${i.subjectId}` });
  const businessOf = (t: string | null): BusinessKind => (t === "לייבל" ? "LABEL" : t === "לקוח" ? "CLIENT" : "UNKNOWN");
  const pEv = (id: string, reasonCode: string, status?: string): Evidence => ({ sourceType: "project", sourceId: id, projectId: id, status: status ?? null, reasonCode });

  // ── project finance profiles ──
  const projects: ProjectFinanceProfile[] = live.map((p) => {
    const business = businessOf(p.businessType);
    const mine = txs.filter((t) => t.row.projectId === p.id && !t.cancelled);
    const price = exceptionOf(p.id) ? "NOT_APPLICABLE" : priceOf(p.id) ? "PRICE_KNOWN" : business === "LABEL" ? "NOT_APPLICABLE" : "PRICE_UNKNOWN";
    const works = engineerByProject.get(p.id) ?? [];
    const hasExpenseTx = mine.some((t) => t.type === "expense");
    const unlinkedPaidWork = works.some((w) => Number(w.amountPaid) > 0 && !w.linkedTransactionId);
    const expenses = hasExpenseTx || works.length ? (unlinkedPaidWork ? "EXPENSES_PARTIAL" : "EXPENSES_VISIBLE") : "EXPENSES_UNKNOWN";
    const recs = state.receivables.filter((r) => r.projectId === p.id && r.collection.state !== "SETTLED" && r.collection.state !== "NOT_COLLECTIBLE");
    const receivable = price === "PRICE_KNOWN" || recs.length ? "RECEIVABLE_KNOWN" : price === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "RECEIVABLE_UNKNOWN";
    const dueDate = recs.length === 0 ? "NOT_APPLICABLE" : recs.every((r) => r.dueDate) ? "DUE_DATE_KNOWN" : "DUE_DATE_MISSING";
    return { projectId: p.id, name: p.name, status: p.status, business, price, income: mine.some((t) => t.type === "income") ? "INCOME_VISIBLE" : "INCOME_NOT_VISIBLE", expenses, receivable, dueDate };
  });

  // ── PRICE_MISSING (client / unknown business only; label projects never need a client price) ──
  for (const pr of projects.filter((x) => x.price === "PRICE_UNKNOWN" && x.status !== CANCELLED)) {
    const p = projectById.get(pr.projectId)!;
    const open = pr.status !== COMPLETED;
    add({
      issueType: "PRICE_MISSING", severityBand: open ? "MEDIUM" : "LOW", epistemicStatus: "FACT", subjectType: "project", subjectId: pr.projectId, subjectLabel: pr.name,
      currency: null, amount: null, date: null, period: periodOf(p.updatedAt), reasonCodes: [open ? "OPEN_PROJECT_NO_AGREED_PRICE" : "COMPLETED_PROJECT_NO_AGREED_PRICE", `BUSINESS_${pr.business}`],
      evidence: [pEv(pr.projectId, "PRICE_UNKNOWN", pr.status)],
      recommendedOwnerQuestion: open ? question("PROJECT_PRICE", { type: "project", id: pr.projectId, labelHe: pr.name }, `לפרויקט '${pr.name}' אין מחיר מוסכם במערכת. יש מחיר?`, "בלי מחיר אי אפשר לחשב גבייה ויתרה לפרויקט.", [pEv(pr.projectId, "PRICE_UNKNOWN")], 60) : null,
    });
  }

  // ── COMPLETED_WORK_NO_INCOME (client / unknown; never "unpaid" without receivable evidence) ──
  for (const pr of projects.filter((x) => x.status === COMPLETED && x.business !== "LABEL" && x.income === "INCOME_NOT_VISIBLE")) {
    const p = projectById.get(pr.projectId)!;
    const mine = txs.filter((t) => t.row.projectId === pr.projectId && !t.cancelled);
    const paidExpense = mine.filter((t) => t.type === "expense" && t.received);
    const works = engineerByProject.get(pr.projectId) ?? [];
    if (!paidExpense.length && !works.length) continue; // no cost evidence → nothing to say (not every completed project must show money)
    const priceKnown = pr.price === "PRICE_KNOWN";
    const post = periodOf(p.updatedAt) === "POST_POLICY";
    const costs = paidExpense.reduce((m, t) => { m[t.currency] = (m[t.currency] ?? 0) + t.amount; return m; }, {} as CurrencyTotals);
    add({
      issueType: "COMPLETED_WORK_NO_INCOME", severityBand: post && priceKnown ? "HIGH" : post ? "MEDIUM" : "LOW", epistemicStatus: "FACT", subjectType: "project", subjectId: pr.projectId, subjectLabel: pr.name,
      currency: Object.keys(costs)[0] ?? null, amount: Object.values(costs)[0] ?? null, date: p.updatedAt ? p.updatedAt.slice(0, 10) : null, period: post ? "POST_POLICY" : "HISTORICAL",
      reasonCodes: ["COMPLETED", "NO_INCOME_TRANSACTION", paidExpense.length ? "PAID_EXPENSE_RECORDED" : "ENGINEER_WORK_ONLY", priceKnown ? "PRICE_KNOWN_RECEIVABLE_EXISTS" : "PRICE_UNKNOWN_CANNOT_CLAIM_UNPAID", `BUSINESS_${pr.business}`],
      evidence: [pEv(pr.projectId, "COMPLETED_NO_INCOME", pr.status), ...paidExpense.map((t) => ({ sourceType: "transaction" as const, sourceId: t.row.id, projectId: pr.projectId, currency: t.currency, date: t.date, status: t.row.status, reasonCode: "PAID_EXPENSE" })), ...works.map((w) => ({ sourceType: "engineer_work" as const, sourceId: w.id, projectId: pr.projectId, reasonCode: "ENGINEER_WORK" }))],
      recommendedOwnerQuestion: question("COMPLETED_WORK_INCOME_STATUS", { type: "project", id: pr.projectId, labelHe: pr.name }, `הפרויקט '${pr.name}' הושלם ויש בו הוצאה מתועדת, אבל אני לא רואה הכנסה בפרויקט. מה קרה?`, "כל עוד זה לא ברור, הנטו והגבייה של הפרויקט לא ידועים.", [pEv(pr.projectId, "COMPLETED_NO_INCOME")], 40),
    });
  }

  // ── receivables: expected-but-not-recorded, due-date gaps, overdue reason gaps ──
  const dueDateQueue: Receivable[] = [];
  const overdueReasonGaps: PartnerFinanceIntegrityState["overdueReasonGaps"] = [];
  for (const r of state.receivables) {
    if (r.collection.state === "SETTLED" || r.collection.state === "NOT_COLLECTIBLE") continue;
    const label = r.projectName ? `'${r.projectName}'` : "";
    const rEv = r.evidence;
    if (r.source === "EXPECTED_TX" && r.dueDate && r.dueDate <= today && (r.collection.state === "DUE_TODAY" || r.collection.state === "OVERDUE")) {
      const replacement = txs.some((t) => t.type === "income" && t.received && !t.cancelled && t.row.projectId === r.projectId && t.currency === r.currency && t.amount >= r.amount && !!t.date && t.date >= addDays(r.dueDate!, -REPLACEMENT_WINDOW_DAYS) && !r.evidence.some((e) => e.sourceId === t.row.id));
      if (!replacement) {
        const post = periodOf(r.dueDate) === "POST_POLICY";
        add({
          issueType: "INCOME_EXPECTED_BUT_NOT_RECORDED", severityBand: post ? "HIGH" : "MEDIUM", epistemicStatus: "DERIVED", subjectType: "receivable", subjectId: r.id, subjectLabel: r.projectName,
          currency: r.currency, amount: r.amount, date: r.dueDate, period: post ? "POST_POLICY" : "HISTORICAL", reasonCodes: ["EXPECTED_INCOME_DUE", "NO_RECEIVED_RECORD", "NO_REPLACEMENT_RECORD"], evidence: rEv, recommendedOwnerQuestion: null,
        });
      }
    }
    if (r.collection.state === "OVERDUE") {
      overdueReasonGaps.push({ receivableId: r.id, reason: "OVERDUE_REASON_UNKNOWN" });
      add({
        issueType: "OVERDUE_RECEIVABLE_REASON_UNKNOWN", severityBand: periodOf(r.dueDate) === "POST_POLICY" || r.collection.important ? "HIGH" : "MEDIUM", epistemicStatus: "UNKNOWN", subjectType: "receivable", subjectId: r.id, subjectLabel: r.projectName,
        currency: r.currency, amount: r.amount, date: r.dueDate, period: periodOf(r.dueDate), reasonCodes: ["OVERDUE", "OVERDUE_REASON_UNKNOWN"], evidence: rEv,
        recommendedOwnerQuestion: question("WHY_PAYMENT_OPEN", { type: "receivable", id: r.id, labelHe: r.projectName }, `התשלום של ${fmtMoney(r.amount, r.currency)}${label ? ` על ${label}` : ""} היה אמור להיכנס עד ${ddmm(r.dueDate!)}. למה הוא עדיין פתוח?`, "בלי סיבה ידועה Partner לא יכול לדעת אם לעקוב, לחכות או לשחרר.", rEv, 20),
      });
    }
    if (r.collection.state === "NO_DUE_DATE") {
      dueDateQueue.push(r);
      add({
        issueType: "RECEIVABLE_DUE_DATE_MISSING", severityBand: r.projectStatus === COMPLETED || r.collection.important ? "MEDIUM" : "LOW", epistemicStatus: "FACT", subjectType: "receivable", subjectId: r.id, subjectLabel: r.projectName,
        currency: r.currency, amount: r.amount, date: null, period: r.legacy === "CONFIRMED_CURRENT" ? "POST_POLICY" : "HISTORICAL", reasonCodes: ["BALANCE_KNOWN", "NO_DUE_DATE", r.projectStatus === COMPLETED ? "PROJECT_COMPLETED" : "PROJECT_OPEN"], evidence: rEv,
        recommendedOwnerQuestion: question("DUE_DATE_FOR_BALANCE", { type: "receivable", id: r.id, labelHe: r.projectName }, `יש יתרה של ${fmtMoney(r.amount, r.currency)}${label ? ` בפרויקט ${label}` : ""} בלי תאריך גבייה. מתי אמורים לגבות?`, "בלי תאריך אי אפשר לתזכר לפני המועד ולדעת מה צפוי להיכנס.", rEv, 30),
      });
    }
  }
  // neutral due-date queue order: completed project first, then amount, then importance, then id (never "urgent")
  dueDateQueue.sort((a, b) => Number(b.projectStatus === COMPLETED) - Number(a.projectStatus === COMPLETED) || b.amount - a.amount || Number(b.collection.important) - Number(a.collection.important) || (a.id < b.id ? -1 : 1));

  // ── recurring expenses (explicit first, then HYPOTHESIS candidates) ──
  for (const k of state.recurring.known) {
    if (k.state === "EXPECTED_EXPENSE_NOT_FOUND") {
      add({
        issueType: "RECURRING_EXPENSE_MISSING_THIS_PERIOD", severityBand: "HIGH", epistemicStatus: "DERIVED", subjectType: "recurring", subjectId: `VICTOR_SALARY:${k.workMonth}`, subjectLabel: `משכורת Victor עבור ${monthHe(k.workMonth)}`,
        currency: k.currency, amount: k.amount, date: k.dueDate, period: periodOf(k.dueDate), reasonCodes: ["KNOWN_RECURRING_CONFIGURED", "NO_FINANCE_RECORD_THIS_PERIOD"], evidence: k.evidence,
        recommendedOwnerQuestion: question("RECURRING_EXPENSE_RECORD", { type: "recurring", id: `VICTOR_SALARY:${k.workMonth}`, labelHe: "משכורת Victor" }, `משכורת Victor מוגדרת כחודשית, אבל לא מצאתי תשלום או הוצאה עבור ${monthHe(k.workMonth)}. מה המצב?`, "הוצאה קבועה שלא נרשמה משנה את הנטו של החודש.", k.evidence, 10),
      });
    } else if (k.state === "PAID_OUTSIDE_FINANCE") {
      add({
        issueType: "EXPENSE_EXPECTED_BUT_NOT_FOUND", severityBand: "HIGH", epistemicStatus: "FACT", subjectType: "recurring", subjectId: `VICTOR_SALARY:${k.workMonth}`, subjectLabel: `משכורת Victor עבור ${monthHe(k.workMonth)}`,
        currency: k.currency, amount: k.amount, date: k.dueDate, period: periodOf(k.dueDate), reasonCodes: ["MARKED_PAID_ON_SALARY_PAGE", "NO_FINANCE_EXPENSE_RECORD"], evidence: k.evidence,
        recommendedOwnerQuestion: question("RECURRING_EXPENSE_RECORD", { type: "recurring", id: `VICTOR_SALARY:${k.workMonth}`, labelHe: "משכורת Victor" }, `משכורת Victor עבור ${monthHe(k.workMonth)} מסומנת כשולמה, אבל לא מצאתי לה רישום בכספים. מה נכון?`, "כל עוד אין רישום, ההוצאה לא נכנסת לנטו.", k.evidence, 10),
      });
    }
  }
  for (const c of state.recurring.candidates) {
    add({
      issueType: "RECURRING_EXPENSE_CANDIDATE", severityBand: "LOW", epistemicStatus: "HYPOTHESIS", subjectType: "transaction", subjectId: c.key, subjectLabel: c.category,
      currency: c.currency, amount: c.amount, date: null, period: "HISTORICAL", reasonCodes: ["SAME_CATEGORY_SAME_CURRENCY_SIMILAR_AMOUNT", `MONTHS_${c.months.length}`], evidence: c.evidence,
      recommendedOwnerQuestion: question("IS_RECURRING_EXPENSE", { type: "expense_pattern", id: c.key, labelHe: c.category }, `ראיתי הוצאה דומה של כ־${fmtMoney(c.amount, c.currency)} (${c.category}) ב־${c.months.length} חודשים. זו הוצאה קבועה?`, "אם היא קבועה, Partner יצפה לה כל חודש ויוכל להתריע כשהיא חסרה.", c.evidence, 70),
    });
  }

  // ── expense classification (explicit evidence only; UNKNOWN is valid) ──
  const showPayout = new Map<string, "artist" | "dj">();
  for (const s of raw.shows) { if (s.artistTxId) showPayout.set(s.artistTxId, "artist"); if (s.djTxId) showPayout.set(s.djTxId, "dj"); }
  const engineerLinked = new Set(raw.engineerWorks.map((w) => w.linkedTransactionId).filter(Boolean) as string[]);
  const expenseClassification: ExpenseClassification[] = txs.filter((t) => t.type === "expense" && !t.cancelled).map((t) => {
    const sid = t.row.linkedSessionId ?? "";
    const cat = (t.row.category ?? "").trim();
    if (t.row.projectId) return { txId: t.row.id, category: "PROJECT_COST", basis: "LINKED_TO_PROJECT" };
    if (engineerLinked.has(t.row.id)) return { txId: t.row.id, category: "PROJECT_COST", basis: "ENGINEER_WORK" };
    if (sid.startsWith("victor_salary_")) return { txId: t.row.id, category: "TEAM_COST", basis: "VICTOR_SALARY" };
    if (showPayout.has(t.row.id)) return { txId: t.row.id, category: "TEAM_COST", basis: showPayout.get(t.row.id) === "dj" ? "SHOW_DJ_PAYOUT" : "SHOW_ARTIST_PAYOUT" };
    if ((t.row.expenseScope ?? "") === "קליפ") return { txId: t.row.id, category: "VIDEO_PHOTO", basis: "CLIP_SCOPE" };
    if ((t.row.expenseScope ?? "") === "שיווק") return { txId: t.row.id, category: "MARKETING", basis: "MARKETING_SCOPE" };
    if (EXPLICIT_CATEGORY[cat]) return { txId: t.row.id, category: EXPLICIT_CATEGORY[cat], basis: `EXPLICIT_CATEGORY:${cat}` };
    return { txId: t.row.id, category: "UNKNOWN", basis: cat ? `CATEGORY_NOT_EXPLICIT:${cat}` : "NO_CATEGORY" };
  });
  for (const e of expenseClassification.filter((x) => x.category === "UNKNOWN")) {
    const t = txById.get(e.txId)!;
    const current = !!t.date && t.date >= state.month.start;
    add({
      issueType: "EXPENSE_CLASSIFICATION_UNKNOWN", severityBand: current ? "MEDIUM" : "LOW", epistemicStatus: "UNKNOWN", subjectType: "transaction", subjectId: e.txId, subjectLabel: t.row.category,
      currency: t.currency, amount: t.amount, date: t.date, period: periodOf(t.date ?? t.row.createdAt), reasonCodes: [e.basis], evidence: [{ sourceType: "transaction", sourceId: e.txId, currency: t.currency, date: t.date, status: t.row.status, reasonCode: "CLASSIFICATION_UNKNOWN" }],
      recommendedOwnerQuestion: current ? question("EXPENSE_CLASSIFICATION", { type: "transaction", id: e.txId, labelHe: t.row.category }, `הוצאה של ${fmtMoney(t.amount, t.currency)}${t.row.category ? ` (${t.row.category})` : ""} לא משויכת לסוג ברור. איזה סוג הוצאה זו?`, "סיווג קובע אם היא חוזרת ואיך היא משפיעה על החודשים הבאים.", [], 80) : null,
    });
  }

  // ── grouped data-quality issues from the Finance Brain signals ──
  const sig = (code: string) => state.signals.find((s) => s.code === code);
  for (const e of sig("CURRENCY_SETTLEMENT_AMBIGUOUS")?.evidence ?? []) {
    add({ issueType: "CURRENCY_AMBIGUOUS", severityBand: "LOW", epistemicStatus: "FACT", subjectType: "engineer_work", subjectId: e.sourceId, subjectLabel: null, currency: e.currency ?? null, amount: null, date: null, period: "HISTORICAL", reasonCodes: [e.reasonCode, "NO_APPROVED_FX_POLICY"], evidence: [e], recommendedOwnerQuestion: null });
  }
  for (const e of sig("CURRENCY_AMBIGUOUS")?.evidence ?? []) {
    add({ issueType: "CURRENCY_AMBIGUOUS", severityBand: "MEDIUM", epistemicStatus: "FACT", subjectType: "transaction", subjectId: e.sourceId, subjectLabel: null, currency: e.currency ?? null, amount: null, date: e.date ?? null, period: periodOf(e.date), reasonCodes: [e.reasonCode], evidence: [e], recommendedOwnerQuestion: null });
  }
  const unlinked = [...(sig("TRANSACTION_PROJECT_LINK_MISSING")?.evidence ?? []), ...txs.filter((t) => t.row.projectId && !projectById.has(t.row.projectId)).map((t) => ({ sourceType: "transaction" as const, sourceId: t.row.id, projectId: t.row.projectId, reasonCode: "PROJECT_NO_LONGER_EXISTS" }))];
  for (const e of unlinked) add({ issueType: "UNLINKED_TRANSACTION", severityBand: "LOW", epistemicStatus: "FACT", subjectType: "transaction", subjectId: e.sourceId, subjectLabel: null, currency: null, amount: null, date: null, period: "HISTORICAL", reasonCodes: [e.reasonCode], evidence: [e], recommendedOwnerQuestion: null });
  const dup = sig("DUPLICATE_LOOKING_RECORDS");
  if (dup) add({ issueType: "POSSIBLE_DUPLICATE", severityBand: "LOW", epistemicStatus: "HYPOTHESIS", subjectType: "transaction", subjectId: dup.evidence.map((e) => e.sourceId).sort().join("+"), subjectLabel: null, currency: null, amount: null, date: null, period: "HISTORICAL", reasonCodes: ["SAME_TYPE_AMOUNT_DATE_PROJECT_CATEGORY", `GROUPS_${dup.count}`], evidence: dup.evidence, recommendedOwnerQuestion: null });
  for (const o of state.openExpenses.possibleOverlaps) add({ issueType: "POSSIBLE_OBLIGATION_OVERLAP", severityBand: "LOW", epistemicStatus: "HYPOTHESIS", subjectType: "transaction", subjectId: o.id, subjectLabel: o.category, currency: o.currency, amount: o.amount, date: o.dueDate, period: periodOf(o.dueDate), reasonCodes: ["OPEN_TX_AND_OPEN_ENGINEER_WORK_SAME_PROJECT", "COUNTED_ONCE"], evidence: o.evidence, recommendedOwnerQuestion: null });
  const ledgerArtists = [...new Set(raw.ledger.map((l) => l.artistId))];
  for (const a of ledgerArtists) {
    const name = raw.labelArtists.find((x) => x.id === a)?.name ?? null;
    add({ issueType: "LABEL_LEDGER_CURRENCY_MISSING", severityBand: "LOW", epistemicStatus: "FACT", subjectType: "label_artist", subjectId: a, subjectLabel: name, currency: null, amount: null, date: null, period: "HISTORICAL", reasonCodes: ["LEDGER_HAS_NO_CURRENCY", "EXCLUDED_FROM_TOTALS", `ROWS_${raw.ledger.filter((l) => l.artistId === a).length}`], evidence: (sig("LABEL_LEDGER_NO_CURRENCY")?.evidence ?? []).filter((e) => e.sourceId.startsWith(`${a}#`)), recommendedOwnerQuestion: null });
  }
  const rf = sig("RED_FILMS_OUTSIDE_FINANCE");
  if (rf) add({ issueType: "RED_FILMS_CURRENCY_MISSING", severityBand: "LOW", epistemicStatus: "FACT", subjectType: "red_films", subjectId: "red_films_budget_payments", subjectLabel: null, currency: null, amount: null, date: null, period: "HISTORICAL", reasonCodes: ["NO_CURRENCY", "NOT_IN_TRANSACTIONS", `PAYMENTS_${rf.count}`], evidence: rf.evidence, recommendedOwnerQuestion: null });
  for (const s of raw.shows) {
    if (s.status !== "בוצע") continue;
    const price = Number(s.price);
    const inc = s.incomeTxId ? txById.get(s.incomeTxId) : null;
    const reasons = [!(price > 0) ? "COMPLETED_SHOW_WITHOUT_PRICE" : null, s.paymentStatus === "שולם" && !s.incomeTxId ? "PAID_SHOW_WITHOUT_INCOME_RECORD" : null, s.incomeTxId && !inc ? "INCOME_RECORD_MISSING" : null].filter((x): x is string => !!x);
    if (reasons.length) add({ issueType: "SHOW_FINANCE_INCOMPLETE", severityBand: periodOf(s.date) === "POST_POLICY" ? "MEDIUM" : "LOW", epistemicStatus: "FACT", subjectType: "show", subjectId: s.id, subjectLabel: null, currency: "₪", amount: price > 0 ? price : null, date: s.date, period: periodOf(s.date), reasonCodes: reasons, evidence: [{ sourceType: "show", sourceId: s.id, date: s.date, status: s.status, reasonCode: reasons[0] }], recommendedOwnerQuestion: null });
  }
  const clientUnpriced = projects.filter((p) => p.price === "PRICE_UNKNOWN" && p.status !== CANCELLED);
  if (clientUnpriced.length) add({ issueType: "PROJECT_FINANCE_COVERAGE_INCOMPLETE", severityBand: "MEDIUM", epistemicStatus: "FACT", subjectType: "company", subjectId: "projects", subjectLabel: null, currency: null, amount: null, date: null, period: "HISTORICAL", reasonCodes: [`PRICED_${projects.filter((p) => p.price === "PRICE_KNOWN").length}`, `CLIENT_OR_UNKNOWN_UNPRICED_${clientUnpriced.length}`, `LABEL_NOT_APPLICABLE_${projects.filter((p) => p.business === "LABEL" && p.price === "NOT_APPLICABLE").length}`], evidence: clientUnpriced.map((p) => pEv(p.projectId, "PRICE_UNKNOWN", p.status)), recommendedOwnerQuestion: null });
  const mal = sig("MALFORMED_RECORDS");
  if (mal) for (const e of mal.evidence) add({ issueType: "MALFORMED_FINANCE_DATA", severityBand: "MEDIUM", epistemicStatus: "FACT", subjectType: e.sourceType === "finance_setting" ? "finance_setting" : "transaction", subjectId: e.sourceId, subjectLabel: null, currency: null, amount: null, date: null, period: "HISTORICAL", reasonCodes: [e.reasonCode, "EXCLUDED_FROM_TOTALS"], evidence: [e], recommendedOwnerQuestion: null });

  // ── orphan finance settings → review queue (never money) ──
  const orphans = raw.financeSettings.filter((s) => !projectById.has(s.projectId));
  const orphanQueue: OrphanReviewEntry[] = orphans.map((s) => {
    const v = s.value && typeof s.value === "object" ? (s.value as Record<string, unknown>) : {};
    const amt = Number(v.agreedPrice);
    const amount = Number.isFinite(amt) && amt > 0 ? amt : null;
    const currency = typeof v.currency === "string" && v.currency.trim() ? v.currency.trim() : "₪";
    const txRowsForId = raw.transactions.filter((t) => t.projectId === s.projectId).length;
    const ev: Evidence[] = [{ sourceType: "finance_setting", sourceId: s.projectId, currency, reasonCode: "ORPHAN_PRICE_SETTING" }];
    return { projectId: s.projectId, amount, currency, txRowsForId, question: question("ORPHAN_PRICE_MEANING", { type: "finance_setting", id: s.projectId, labelHe: null }, `מצאתי מחיר ישן${amount ? ` של ${fmtMoney(amount, currency)}` : ""} לפרויקט שכבר לא קיים. מה זה?`, "הוא לא נספר בכסף עד שיהיה ברור מה הוא מייצג.", ev, 90) };
  });
  // Deterministic, evidence-first ordering (linked records, then a known amount, then id) — larger is NOT "more urgent".
  orphanQueue.sort((a, b) => b.txRowsForId - a.txRowsForId || Number(b.amount !== null) - Number(a.amount !== null) || (a.projectId < b.projectId ? -1 : 1));
  for (const o of orphanQueue) {
    add({ issueType: "ORPHAN_FINANCE_SETTING", severityBand: "LOW", epistemicStatus: "UNKNOWN", subjectType: "finance_setting", subjectId: o.projectId, subjectLabel: null, currency: o.currency, amount: o.amount, date: null, period: "HISTORICAL", reasonCodes: ["PROJECT_NO_LONGER_EXISTS", "NEEDS_OWNER_REVIEW", "EXCLUDED_FROM_MONEY"], evidence: o.question.evidence, recommendedOwnerQuestion: o.question });
  }

  // ── trust map + coverage reasons ──
  const c = state.coverage;
  const trust: PartnerFinanceIntegrityState["trust"] = {
    realizedIncome: { state: c.realizedIncome.state, reason: c.realizedIncome.reason },
    realizedExpenses: { state: c.realizedExpenses.state, reason: c.realizedExpenses.reason },
    agreedPrices: { state: clientUnpriced.length === 0 ? "RELIABLE" : projects.some((p) => p.price === "PRICE_KNOWN") ? "PARTIAL" : "MISSING", reason: clientUnpriced.length ? `CLIENT_OR_UNKNOWN_UNPRICED_${clientUnpriced.length}` : "ALL_CLIENT_PROJECTS_PRICED" },
    completedWorkIncome: { state: issues.some((i) => i.issueType === "COMPLETED_WORK_NO_INCOME") ? "PARTIAL" : "RELIABLE", reason: `COMPLETED_NO_INCOME_${issues.filter((i) => i.issueType === "COMPLETED_WORK_NO_INCOME").length}` },
    receivableDueDates: { state: c.receivableDueDates.state, reason: c.receivableDueDates.reason },
    recurringExpenses: { state: c.recurringExpenses.state, reason: c.recurringExpenses.reason },
    expenseClassification: { state: expenseClassification.some((e) => e.category === "UNKNOWN") ? "PARTIAL" : "RELIABLE", reason: `UNKNOWN_${expenseClassification.filter((e) => e.category === "UNKNOWN").length}_OF_${expenseClassification.length}` },
    currencies: { state: c.currencies.state, reason: c.currencies.reason },
    orphanPriceData: { state: orphanQueue.length ? "NEEDS_OWNER_REVIEW" : "RELIABLE", reason: `ORPHANS_${orphanQueue.length}` },
    clientAttribution: { state: c.clientAttribution.state, reason: c.clientAttribution.reason },
  };
  const coverageReasonsHe: string[] = [];
  if (c.realizedIncome.state !== "RELIABLE") coverageReasonsHe.push("נתוני ההכנסות ההיסטוריים חלקיים");
  if (c.recurringExpenses.state !== "RELIABLE") coverageReasonsHe.push("ההוצאות הקבועות עדיין לא מיוצגות במלואן");
  if (trust.agreedPrices.state !== "RELIABLE") coverageReasonsHe.push("לרוב הפרויקטים אין מחיר מוסכם");
  if (trust.completedWorkIncome.state !== "RELIABLE") coverageReasonsHe.push("בחלק מהפרויקטים שהסתיימו לא רשומה הכנסה");
  if (orphanQueue.length) coverageReasonsHe.push("יש נתוני מחיר ישנים שדורשים בירור");

  const questions = issues.map((i) => i.recommendedOwnerQuestion).filter((q): q is OwnerQuestion => !!q).sort((a, b) => a.priority - b.priority || (a.subject.id < b.subject.id ? -1 : 1));
  const top = prioritize(issues);
  return {
    schemaVersion: INTEGRITY_SCHEMA_VERSION, policyStartYmd: RECORDING_POLICY_START, trust, coverageReasonsHe, projects, issues, orphanQueue,
    expenseClassification, dueDateQueue, overdueReasonGaps, questions, top,
  };
}

function question(questionType: QuestionType, subject: OwnerQuestion["subject"], textHe: string, whyItMattersHe: string, evidence: Evidence[], priority: number): OwnerQuestion {
  return { questionType, subject, textHe, whyItMattersHe, options: QUESTION_OPTIONS[questionType], evidence, priority };
}

// ── prioritizer: ≤ 3 Owner items (one line per family), ≤ 2 questions ──

/** Fixed family order (lower first). Post-policy / HIGH issues inside a family come first. */
export const REHAB_FAMILY_RANK: Record<IssueType, number> = {
  INCOME_EXPECTED_BUT_NOT_RECORDED: 1, RECURRING_EXPENSE_MISSING_THIS_PERIOD: 2, EXPENSE_EXPECTED_BUT_NOT_FOUND: 2, OVERDUE_RECEIVABLE_REASON_UNKNOWN: 3,
  RECEIVABLE_DUE_DATE_MISSING: 4, COMPLETED_WORK_NO_INCOME: 5, MALFORMED_FINANCE_DATA: 6, PRICE_MISSING: 7, PROJECT_FINANCE_COVERAGE_INCOMPLETE: 7,
  EXPENSE_CLASSIFICATION_UNKNOWN: 8, SHOW_FINANCE_INCOMPLETE: 9, RECURRING_EXPENSE_CANDIDATE: 10, CURRENCY_AMBIGUOUS: 11, POSSIBLE_OBLIGATION_OVERLAP: 12,
  POSSIBLE_DUPLICATE: 12, UNLINKED_TRANSACTION: 13, ORPHAN_FINANCE_SETTING: 14, LABEL_LEDGER_CURRENCY_MISSING: 15, RED_FILMS_CURRENCY_MISSING: 15,
};
const SEV = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
/** Families shown as one grouped line (never a list). */
const FAMILY_OF: Partial<Record<IssueType, string>> = { RECURRING_EXPENSE_MISSING_THIS_PERIOD: "RECURRING_RECORD", EXPENSE_EXPECTED_BUT_NOT_FOUND: "RECURRING_RECORD", PRICE_MISSING: "PRICING", PROJECT_FINANCE_COVERAGE_INCOMPLETE: "PRICING", POSSIBLE_DUPLICATE: "OVERLAP", POSSIBLE_OBLIGATION_OVERLAP: "OVERLAP", LABEL_LEDGER_CURRENCY_MISSING: "LEDGERS", RED_FILMS_CURRENCY_MISSING: "LEDGERS" };

export function prioritize(issues: RehabIssue[]): { items: RehabOwnerItem[]; questions: OwnerQuestion[] } {
  // Only issues that would help the Owner right now; LOW historical data hygiene does not crowd the list.
  const ordered = [...issues].sort((a, b) => REHAB_FAMILY_RANK[a.issueType] - REHAB_FAMILY_RANK[b.issueType] || SEV[a.severityBand] - SEV[b.severityBand] || (a.period === b.period ? 0 : a.period === "POST_POLICY" ? -1 : 1) || (a.id < b.id ? -1 : 1));
  const families = new Map<string, RehabIssue[]>();
  for (const i of ordered) {
    const f = FAMILY_OF[i.issueType] ?? i.issueType;
    families.set(f, [...(families.get(f) ?? []), i]);
  }
  const items: RehabOwnerItem[] = [];
  const questions: OwnerQuestion[] = [];
  for (const [, list] of families) {
    if (items.length >= MAX_REHAB_ITEMS) break;
    const head = list[0];
    const text = ownerLine(head, list);
    if (!text) continue;
    items.push({ issueType: head.issueType, epistemic: head.epistemicStatus, textHe: text });
    const q = list.map((x) => x.recommendedOwnerQuestion).find((x): x is OwnerQuestion => !!x);
    if (q && questions.length < MAX_SURFACED_QUESTIONS && !questions.some((x) => x.questionType === q.questionType)) questions.push(q);
  }
  return { items, questions };
}

/** Short, neutral Owner line for a family (null = not worth surfacing as a line). */
function ownerLine(head: RehabIssue, list: RehabIssue[]): string | null {
  const n = list.length;
  switch (head.issueType) {
    case "INCOME_EXPECTED_BUT_NOT_RECORDED":
      return n === 1 ? `ציפיתי לראות תשלום של ${fmtMoney(head.amount ?? 0, head.currency ?? "₪")} עד ${ddmm(head.date!)}, אבל אני לא מצליח לאשר שהוא נרשם.` : `ציפיתי לראות ${n} תשלומים שהגיע מועדם, אבל אני לא מצליח לאשר שהם נרשמו.`;
    case "RECURRING_EXPENSE_MISSING_THIS_PERIOD":
      return `${head.subjectLabel?.startsWith("משכורת Victor") ? "משכורת Victor" : "הוצאה קבועה"} מוגדרת כחודשית, אבל לא מצאתי רישום מתאים לתקופה הזו.`;
    case "EXPENSE_EXPECTED_BUT_NOT_FOUND":
      return `${head.subjectLabel ?? "הוצאה קבועה"} מסומנת כשולמה, אבל לא מצאתי לה רישום בכספים.`;
    case "OVERDUE_RECEIVABLE_REASON_UNKNOWN":
      return n === 1 ? `יש תשלום באיחור של ${fmtMoney(head.amount ?? 0, head.currency ?? "₪")} ואני לא יודע למה הוא עדיין פתוח.` : `יש ${n} תשלומים באיחור ואני לא יודע למה הם עדיין פתוחים.`;
    case "RECEIVABLE_DUE_DATE_MISSING":
      return n === 1 ? `יש יתרה של ${fmtMoney(head.amount ?? 0, head.currency ?? "₪")} בלי תאריך גבייה. צריך לקבוע תאריך גבייה.` : `יש ${n} יתרות בלי תאריך גבייה. צריך לקבוע תאריכי גבייה.`;
    case "COMPLETED_WORK_NO_INCOME":
      return n === 1 ? `פרויקט '${head.subjectLabel}' הושלם ויש בו הוצאה מתועדת, אבל אני לא רואה בו הכנסה.` : `${n} פרויקטים שהסתיימו עם הוצאה מתועדת, אבל אני לא רואה בהם הכנסה. צריך בירור.`;
    case "MALFORMED_FINANCE_DATA":
      return `יש ${n} רשומות כספים לא תקינות שלא נספרו. צריך בירור.`;
    case "PRICE_MISSING":
    case "PROJECT_FINANCE_COVERAGE_INCOMPLETE": {
      const open = list.filter((i) => i.issueType === "PRICE_MISSING" && i.severityBand === "MEDIUM").length;
      return open ? `ל־${open} פרויקטים פתוחים אין מחיר מוסכם במערכת, ולכן אני לא יכול לחשב להם גבייה.` : null;
    }
    case "EXPENSE_CLASSIFICATION_UNKNOWN":
      return head.severityBand === "MEDIUM" ? `יש הוצאות החודש שאני לא יודע לסווג. צריך בירור.` : null;
    case "SHOW_FINANCE_INCOMPLETE":
      return head.severityBand === "MEDIUM" ? `יש הופעה שהסתיימה בלי נתוני כסף מלאים.` : null;
    case "RECURRING_EXPENSE_CANDIDATE":
      return `ראיתי הוצאה דומה כמה חודשים ברצף. ייתכן שזו הוצאה קבועה.`;
    case "ORPHAN_FINANCE_SETTING":
      return `יש נתוני מחיר ישנים שדורשים בירור.`;
    default:
      return null; // currency / overlap / unlinked / ledger hygiene: kept in the state, not an Owner line by default
  }
}
