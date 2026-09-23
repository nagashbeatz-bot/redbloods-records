/**
 * Redbloods Partner — Finance Brief prioritizer (Finance Brain V1). Pure, deterministic.
 *
 * Partner analyzes widely and speaks briefly: at most 5 items (usually 3), one line per family,
 * ordered by a fixed family priority. Facts, derived conclusions, hypotheses and ideas stay labelled;
 * an idea is never phrased as money that will arrive. Factual language only (no good / bad).
 */
import type { CurrencyTotals, FinanceSignal, PartnerFinanceState, Receivable } from "./types";
import { FINANCE_BRIEF_DTO_VERSION, FINANCE_BRIEF_MAX_ITEMS, type FinanceBriefDto, type FinanceBriefFamily, type FinanceBriefItemDto } from "./dto";

/** Fixed priority (lower = more important). */
export const FAMILY_RANK: Record<FinanceBriefFamily, number> = {
  FINANCIAL_DATA_BLOCKER: 1, OVERDUE_COLLECTION: 2, UPCOMING_COLLECTION: 3, COLLECTION_NO_DATE: 4,
  COMMITTED_EXPENSE: 5, MISSING_EXPECTED_RECORD: 6, REVENUE_OPPORTUNITY: 7, RECURRING_EXPENSE_REVIEW: 8,
};
/** Beyond the first 3 items, only families up to this rank may fill slots 4–5 (ideas never crowd out facts). */
const EXTRA_SLOT_MAX_RANK = FAMILY_RANK.MISSING_EXPECTED_RECORD;
const PREFERRED_ITEMS = 3;

export const CALM_HE = "הכספים כרגע בשליטה. אין משהו שדורש ממך פעולה מיידית.";
const PARTIAL_BASIS_HE = "לפי הנתונים הרשומים כרגע";
const ILS = "₪";

/** Deterministic money formatting (no locale dependence): ₪2,200 · $1,500 · −₪300. */
export function fmtMoney(amount: number, currency: string): string {
  const neg = amount < 0;
  const n = Math.round(Math.abs(amount) * 100) / 100;
  const [i, d] = n.toFixed(Number.isInteger(n) ? 0 : 2).split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}${currency}${grouped}${d ? `.${d}` : ""}`;
}
export function fmtTotals(t: CurrencyTotals): string {
  const order = (c: string) => (c === ILS ? 0 : c === "$" ? 1 : c === "€" ? 2 : 3);
  return Object.entries(t).filter(([, v]) => Math.round(v * 100) !== 0).sort(([a], [b]) => order(a) - order(b) || (a < b ? -1 : 1)).map(([c, v]) => fmtMoney(v, c)).join(" · ");
}
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const monthHe = (key: string) => `${HE_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const sumTotals = (list: { amount: number; currency: string }[]) => list.reduce((m, x) => { m[x.currency] = Math.round(((m[x.currency] ?? 0) + x.amount) * 100) / 100; return m; }, {} as CurrencyTotals);
const count = (n: number, one: string, many: (n: number) => string) => (n === 1 ? one : many(n));

export function buildFinanceBrief(state: PartnerFinanceState): FinanceBriefDto {
  const { realized, pacing, coverage, month } = state;
  const sig = (c: FinanceSignal["code"]) => state.signals.find((s) => s.code === c);
  const active = (r: Receivable) => r.collection.state !== "SETTLED" && r.collection.state !== "NOT_COLLECTIBLE" && r.collection.state !== "NEEDS_REVIEW";
  const candidates: FinanceBriefItemDto[] = [];

  // 1. data blocker — completed work with a recorded cost but no recorded income
  const noIncome = sig("COMPLETED_WORK_EXPENSE_NO_INCOME");
  if (noIncome) {
    candidates.push({ family: "FINANCIAL_DATA_BLOCKER", epistemic: "DERIVED", textHe: count(noIncome.count,
      "יש פרויקט אחד שהסתיים עם הוצאה רשומה אבל בלי הכנסה רשומה. כדאי להתחיל ממנו.",
      (n) => `יש ${n} פרויקטים שהסתיימו עם הוצאה רשומה אבל בלי הכנסה רשומה. כדאי להתחיל מהם.`) });
  }
  // 2. overdue collections (reason unknown)
  const overdue = state.receivables.filter((r) => active(r) && r.collection.state === "OVERDUE");
  if (overdue.length === 1) {
    const r = overdue[0];
    candidates.push({ family: "OVERDUE_COLLECTION", epistemic: "FACT", textHe: `${fmtMoney(r.amount, r.currency)} היו אמורים להיכנס עד ${ddmm(r.dueDate!)} ואני לא רואה אותם בכספים. הסיבה לא ידועה.` });
  } else if (overdue.length > 1) {
    candidates.push({ family: "OVERDUE_COLLECTION", epistemic: "FACT", textHe: `${overdue.length} גביות עברו את המועד (${fmtTotals(sumTotals(overdue))}). הסיבה לא ידועה.` });
  }
  // 3. upcoming collections this month
  const upcoming = state.receivables.filter((r) => active(r) && (r.collection.state === "DUE_TODAY" || r.collection.state === "DUE_SOON" || (r.collection.state === "UPCOMING" && r.dueDate! <= month.end)));
  if (upcoming.length === 1) {
    const r = upcoming[0];
    candidates.push({ family: "UPCOMING_COLLECTION", epistemic: "FACT", textHe: r.collection.state === "DUE_TODAY" ? `${fmtMoney(r.amount, r.currency)} אמורים להיכנס היום.` : `${fmtMoney(r.amount, r.currency)} אמורים להיכנס עד ${ddmm(r.dueDate!)}.` });
  } else if (upcoming.length > 1) {
    candidates.push({ family: "UPCOMING_COLLECTION", epistemic: "FACT", textHe: `${fmtTotals(sumTotals(upcoming))} אמורים להיכנס עד סוף החודש (${upcoming.length} תשלומים).` });
  }
  // 4. collections with no due date
  const noDate = state.receivables.filter((r) => active(r) && r.collection.state === "NO_DUE_DATE");
  if (noDate.length === 1) {
    const r = noDate[0];
    candidates.push({ family: "COLLECTION_NO_DATE", epistemic: "FACT", textHe: r.projectStatus === "הושלם"
      ? `יש יתרה של ${fmtMoney(r.amount, r.currency)} בפרויקט שהסתיים ואין לה תאריך גבייה.`
      : `יש ${fmtMoney(r.amount, r.currency)} לגבייה בלי תאריך. צריך לקבוע תאריך גבייה.` });
  } else if (noDate.length > 1) {
    candidates.push({ family: "COLLECTION_NO_DATE", epistemic: "FACT", textHe: `יש ${noDate.length} יתרות לגבייה בלי תאריך (${fmtTotals(sumTotals(noDate))}). צריך לקבוע תאריכי גבייה.` });
  }
  // 5. committed / open expenses (ILS first, other currencies separately — never converted)
  const open = state.openExpenses;
  if (open.items.length) {
    const ils = open.items.filter((e) => e.currency === ILS);
    const others = Object.fromEntries(Object.entries(open.totalsByCurrency).filter(([c]) => c !== ILS));
    const oldest = ils.reduce((m, e) => Math.max(m, e.overdueDays ?? 0), 0);
    const parts: string[] = [];
    if (ils.length) parts.push(`יש הוצאות פתוחות של ${fmtMoney(open.totalsByCurrency[ILS] ?? 0, ILS)}${oldest > 0 ? ` (הישנה ביותר באיחור ${oldest} ימים)` : ""}.`);
    const otherText = fmtTotals(others);
    if (otherText) parts.push(`${ils.length ? "בנפרד" : "יש התחייבויות פתוחות"} במטבע זר: ${otherText}.`);
    if (parts.length) candidates.push({ family: "COMMITTED_EXPENSE", epistemic: "FACT", textHe: parts.join(" ") });
  }
  // 6. expected records Partner cannot confirm (recording discipline)
  const salaryMissing = state.recurring.known.filter((k) => k.state === "EXPECTED_EXPENSE_NOT_FOUND");
  const salaryOutside = state.recurring.known.filter((k) => k.state === "PAID_OUTSIDE_FINANCE");
  if (salaryMissing.length) {
    candidates.push({ family: "MISSING_EXPECTED_RECORD", epistemic: "DERIVED", textHe: `משכורת Victor מוגדרת כחודשית, אבל אני לא רואה תשלום או הוצאה עבור ${monthHe(salaryMissing[0].workMonth)}.` });
  } else if (salaryOutside.length) {
    candidates.push({ family: "MISSING_EXPECTED_RECORD", epistemic: "FACT", textHe: `משכורת Victor עבור ${monthHe(salaryOutside[0].workMonth)} מסומנת כשולמה, אבל אין לה רישום בכספים.` });
  }
  // 7. revenue opportunity (derived or idea — never booked money)
  const near = state.opportunities.find((o) => o.code === "NEAR_DELIVERY_UNPRICED");
  const vip = state.opportunities.find((o) => o.code === "VIP_FOLLOW_UP");
  if (near) {
    candidates.push({ family: "REVENUE_OPPORTUNITY", epistemic: "DERIVED", textHe: count(near.count, "פרויקט אחד בשלב מיקס בלי מחיר מוסכם. בלי מחיר אי אפשר לתכנן את הגבייה שלו.", (n) => `${n} פרויקטים בשלב מיקס בלי מחיר מוסכם. בלי מחיר אי אפשר לתכנן את הגבייה שלהם.`) });
  } else if (vip) {
    candidates.push({ family: "REVENUE_OPPORTUNITY", epistemic: "HYPOTHESIS", textHe: `רעיון: אין הצעות מחיר פתוחות במערכת. אפשר לשקול פנייה ל־${vip.count} לקוחות VIP לעבודה חוזרת.` });
  }
  // 8. recurring-expense review (hypothesis)
  const cand = state.recurring.candidates[0];
  if (cand) candidates.push({ family: "RECURRING_EXPENSE_REVIEW", epistemic: "HYPOTHESIS", textHe: `ראיתי הוצאה של ${fmtMoney(cand.amount, cand.currency)}${cand.category ? ` (${cand.category})` : ""} כמה חודשים ברצף. ייתכן שזו הוצאה קבועה.` });

  // select: dedupe by family, rank, ≤3 preferred, ≤5 only for material families
  const byFamily = new Map<FinanceBriefFamily, FinanceBriefItemDto>();
  for (const c of candidates) if (!byFamily.has(c.family)) byFamily.set(c.family, c);
  const ranked = [...byFamily.values()].sort((a, b) => FAMILY_RANK[a.family] - FAMILY_RANK[b.family]);
  const items = ranked.filter((c, i) => i < PREFERRED_ITEMS || FAMILY_RANK[c.family] <= EXTRA_SLOT_MAX_RANK).slice(0, FINANCE_BRIEF_MAX_ITEMS);

  // coverage note + summary (the net is never shown as authoritative when coverage is partial)
  const partial = pacing.coverage !== "RELIABLE";
  const notes: string[] = [];
  if (partial) notes.push("הנתונים עדיין חלקיים, אז הנטו כאן הוא לפי מה שרשום במערכת.");
  if (coverage.agreedPrices.state !== "RELIABLE" && state.priceCoverage.priced * 2 < state.priceCoverage.liveProjects) notes.push("ברוב הפרויקטים אין מחיר מוסכם במערכת, ולכן אי אפשר לחשב גבייה מלאה.");
  if (sig("ORPHAN_PRICE_SETTINGS")) notes.push("יש נתוני מחיר ישנים שדורשים בירור.");
  const net = realized.ils.net;
  const lineHe = realized.targetPosition === "BELOW_FLOOR"
    ? `נטו מתועד החודש: ${fmtMoney(net, ILS)}. חסרים ${fmtMoney(realized.distanceToFloor, ILS)} לרף המינימום ו־${fmtMoney(realized.distanceToPreferred, ILS)} ליעד המועדף.`
    : realized.targetPosition === "IN_TARGET_RANGE"
      ? `נטו מתועד החודש: ${fmtMoney(net, ILS)}. מעל רף המינימום; חסרים ${fmtMoney(realized.distanceToPreferred, ILS)} ליעד המועדף.`
      : `נטו מתועד החודש: ${fmtMoney(net, ILS)}. מעל היעד המועדף ב־${fmtMoney(net - state.policy.preferredIls, ILS)}.`;
  const hasKnown = pacing.knownIncomingIls > 0 || pacing.knownOutgoingIls > 0;
  const positionLineHe = hasKnown
    ? `לפי מה שידוע עד סוף החודש: ${pacing.knownIncomingIls > 0 ? `+${fmtMoney(pacing.knownIncomingIls, ILS)} נכנס` : ""}${pacing.knownIncomingIls > 0 && pacing.knownOutgoingIls > 0 ? ", " : ""}${pacing.knownOutgoingIls > 0 ? `${fmtMoney(pacing.knownOutgoingIls, ILS)} יוצא` : ""} → ${fmtMoney(pacing.knownMonthEndPositionIls, ILS)}. נותרו ${pacing.daysRemaining} ימים בחודש.`
    : `נותרו ${pacing.daysRemaining} ימים בחודש.`;
  const otherNet = Object.fromEntries(Object.entries(realized.byCurrency).filter(([c]) => c !== ILS).map(([c, f]) => [c, f.net]));
  const otherText = fmtTotals(otherNet);
  return {
    v: FINANCE_BRIEF_DTO_VERSION,
    month: month.key,
    asOfDate: month.today,
    coverage: partial ? "PARTIAL" : "RELIABLE",
    coverageNoteHe: notes.length ? notes.join(" ") : null,
    summary: {
      basisHe: partial ? PARTIAL_BASIS_HE : "נטו החודש",
      recordedNetIls: net, floorIls: state.policy.floorIls, preferredIls: state.policy.preferredIls,
      gapToFloor: realized.distanceToFloor, gapToPreferred: realized.distanceToPreferred, daysRemaining: pacing.daysRemaining,
      lineHe, positionLineHe, otherCurrencyLineHe: otherText ? `בנפרד (לא נכלל ביעד): נטו ${otherText}.` : null,
    },
    items,
    calmHe: items.length ? null : CALM_HE,
  };
}
