/**
 * Golden tests for lib/finance/* — the currency-safe finance helpers.
 *
 * Run with:   npx tsx scripts/test-finance-currency.ts
 *
 * Pure modules only (no Supabase, no network) — nothing here touches production.
 *
 * What is proven:
 *   1. ₪-only input  -> the new per-currency calcs are IDENTICAL to the pre-change
 *      inline formulas (copied verbatim below as OLD_*), on a production-shaped
 *      fixture and on thousands of randomized rows.
 *   2. ₪ + $ input   -> currencies are never added together (the old formulas did).
 *   3. received / cancelled classification.
 *   4. R5: project money is compared only inside the project's own currency.
 */
import {
  calcPeriodStats, calcPeriodTotals, groupByCurrency, isCancelledStatus, isExpenseTx, isIncomeTx,
  isReceivedStatus, normalizeCurrency, otherAmountsFrom, otherCurrencyAmounts, otherCurrencyLines,
  formatOtherAmount, partitionByCurrency, sameCurrency, sumByCurrency, totalOf, addToTotals,
  orderCurrencies, RECEIVED_STATUSES,
} from "../lib/finance";
import { collectibleBalance } from "../lib/payment-status";
import { isSongIncome } from "../lib/clip-finance";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}

const cents = (n: number) => Math.round(n * 100) / 100; // fixture rows are averaged, so compare to the cent
type Tx = { type: string; payment_status: string; amount: number; currency?: string | null; scope?: string | null; expense_scope?: string | null };

// ── The pre-change inline formulas, verbatim (FinancePage.calcStats / InsightsPage) ──
function OLD_calcStats(txList: Tx[]) {
  const income          = txList.filter((t) => t.type === "income");
  const expenses        = txList.filter((t) => t.type === "expense");
  const projectExpenses = expenses.filter((t) => (t.scope ?? "project") === "project");
  const generalExpenses = expenses.filter((t) => t.scope === "general");
  const incomeReceived    = income.filter((t) => ["התקבל", "שולם"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const incomeExpected    = income.filter((t) => ["צפוי", "חלקי", "לבדיקה"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const projExpPaid       = projectExpenses.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const genExpPaid        = generalExpenses.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const expensesPaid      = projExpPaid + genExpPaid;
  const expensesExpected  = expenses.filter((t) => ["צפוי", "לא שולם", "חלקי"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const profitReal        = incomeReceived - expensesPaid;
  const profitEst         = incomeReceived + incomeExpected - expensesPaid - expensesExpected;
  return { incomeReceived, incomeExpected, projExpPaid, genExpPaid, expensesPaid, expensesExpected, profitReal, profitEst };
}
function OLD_insights(txList: Tx[]) {
  const periodIncome   = txList.filter((t) => t.type === "income");
  const periodExpenses = txList.filter((t) => t.type === "expense");
  const PAID = new Set(["שולם", "התקבל"]);
  const incomeReceived   = periodIncome.filter((t) => PAID.has(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const incomeExpected   = periodIncome.filter((t) => ["צפוי", "חלקי", "לבדיקה"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const expensesPaid     = periodExpenses.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const expensesExpected = periodExpenses.filter((t) => ["צפוי", "לא שולם", "חלקי"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  return { incomeReceived, incomeExpected, expensesPaid, expensesExpected, profitReal: incomeReceived - expensesPaid, profitEst: incomeReceived + incomeExpected - expensesPaid - expensesExpected };
}

// ── Production-shaped fixture (aggregates verified read-only on 2026-09-21) ──
// income:  ₪ התקבל 15 (27,850) · ₪ שולם 2 (1,000) · ₪ צפוי 1 (2,000) · ₪ בוטל 4 (6,800)
// expense: ₪ שולם 23 (13,180) · ₪ צפוי 3 (2,150) · ₪ בוטל 4 (2,100)
//          $ שולם 4 (2,200, general scope) · $ לא שולם 5 (388, undated legacy)
function rows(n: number, total: number, base: Omit<Tx, "amount">): Tx[] {
  const each = total / n;
  return Array.from({ length: n }, () => ({ ...base, amount: each }));
}
const ILS_ONLY: Tx[] = [
  ...rows(15, 27850, { type: "income", payment_status: "התקבל", currency: "₪", scope: "project" }),
  ...rows(2, 1000, { type: "income", payment_status: "שולם", currency: "₪", scope: "project" }),
  ...rows(1, 2000, { type: "income", payment_status: "צפוי", currency: "₪", scope: "project" }),
  ...rows(4, 6800, { type: "income", payment_status: "בוטל", currency: "₪", scope: "project" }),
  ...rows(20, 12000, { type: "expense", payment_status: "שולם", currency: "₪", scope: "project" }),
  ...rows(3, 1180, { type: "expense", payment_status: "שולם", currency: "₪", scope: "general" }),
  ...rows(3, 2150, { type: "expense", payment_status: "צפוי", currency: "₪", scope: "project" }),
  ...rows(4, 2100, { type: "expense", payment_status: "בוטל", currency: "₪", scope: "project" }),
];
const USD_ROWS: Tx[] = [
  ...rows(4, 2200, { type: "expense", payment_status: "שולם", currency: "$", scope: "general" }),
  ...rows(5, 388, { type: "expense", payment_status: "לא שולם", currency: "$", scope: "project" }),
];
const MIXED: Tx[] = [...ILS_ONLY, ...USD_ROWS];

console.log("1a. ₪-only: identical to the pre-change formulas (production-shaped)");
{
  const nu = calcPeriodStats(ILS_ONLY);
  const old = OLD_calcStats(ILS_ONLY);
  const { other, ...head } = nu;
  check("Finance calcStats identical", head, old);
  check("Finance: no other currency", Object.keys(other), []);
  const ni = calcPeriodTotals(ILS_ONLY);
  const oi = OLD_insights(ILS_ONLY);
  const { other: o2, ...h2 } = ni;
  check("Insights totals identical", h2, oi);
  check("Insights: no other currency", Object.keys(o2), []);
  check("headline values (to the cent)", [head.incomeReceived, head.expensesPaid, head.profitReal, head.incomeExpected].map(cents), [28850, 13180, 15670, 2000]);
}

console.log("1b. ₪-only: identical on randomized rows (incl. odd statuses/scopes, float amounts)");
{
  let seed = 20260921;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const STATUSES = ["שולם", "התקבל", "צפוי", "לא שולם", "בוטל", "חלקי", "לבדיקה", "שולם חלקית", "מקדמה"];
  let allEqual = true, checked = 0;
  for (let round = 0; round < 400; round++) {
    const n = Math.floor(rnd() * 40);
    const list: Tx[] = Array.from({ length: n }, () => ({
      type: pick(["income", "expense", "income", "expense", "weird"]),
      payment_status: pick(STATUSES),
      amount: Math.round(rnd() * 100000) / 100 * (rnd() < 0.05 ? -1 : 1),
      currency: pick(["₪", "₪", "₪", null, undefined, ""]), // blank currency means ₪
      scope: pick(["project", "general", null, undefined, "show"]),
    }));
    const { other, ...head } = calcPeriodStats(list);
    const { other: o2, ...h2 } = calcPeriodTotals(list);
    checked++;
    if (JSON.stringify(head) !== JSON.stringify(OLD_calcStats(list)) || JSON.stringify(h2) !== JSON.stringify(OLD_insights(list)) || Object.keys(other).length || Object.keys(o2).length) allEqual = false;
  }
  check(`${checked} random ₪-only lists: identical (Finance + Insights)`, allEqual, true);
}

console.log("2. ₪ + $: currencies are never added together");
{
  const old = OLD_calcStats(MIXED);
  check("OLD formulas mixed them (15,380 — the bug)", old.expensesPaid, 15380);
  const nu = calcPeriodStats(MIXED);
  check("₪ headline expensesPaid = 13,180", nu.expensesPaid, 13180);
  check("$ expensesPaid = 2,200 on its own", nu.other["$"].expensesPaid, 2200);
  check("$ expensesExpected = 388 on its own", nu.other["$"].expensesExpected, 388);
  check("₪ profitReal unaffected by $", cents(nu.profitReal), 28850 - 13180);
  check("$ profitReal = −2,200 (no ₪ income)", nu.other["$"].profitReal, -2200);
  check("$ profitEst = −2,588", nu.other["$"].profitEst, -2588);
  check("₪ headline equals the ₪-only result", { ...nu, other: undefined }, { ...calcPeriodStats(ILS_ONLY), other: undefined });
  const ni = calcPeriodTotals(MIXED);
  check("Insights: ₪ expensesPaid 13,180 / $ 2,200", [cents(ni.expensesPaid), cents(ni.other["$"].expensesPaid)], [13180, 2200]);
  check("only $ appears as another currency", Object.keys(nu.other), ["$"]);
  check("attention-card style: $388 stays $388 (not ₪388)", sumByCurrency(MIXED.filter((t) => isExpenseTx(t) && ["לא שולם", "חלקי"].includes(t.payment_status)), (t) => t.amount), { "$": 388 });
  const feb = MIXED.filter((t) => t.currency === "$" && t.payment_status === "שולם");
  check("a $-only period: ₪ headline is 0, $ shown separately", [calcPeriodStats(feb).expensesPaid, calcPeriodStats(feb).other["$"].expensesPaid], [0, 2200]);
}

console.log("3. received / cancelled / income / expense classification");
{
  check("received statuses", [...RECEIVED_STATUSES], ["שולם", "התקבל"]);
  for (const s of ["שולם", "התקבל"]) check(`${s} is received`, isReceivedStatus(s), true);
  for (const s of ["צפוי", "לא שולם", "בוטל", "חלקי", "שולם חלקית", "לבדיקה", "מקדמה", "", null, undefined]) check(`${String(s)} is NOT received`, isReceivedStatus(s as string), false);
  check("בוטל is cancelled", isCancelledStatus("בוטל"), true);
  for (const s of ["שולם", "התקבל", "צפוי", "לא שולם", "חלקי", null]) check(`${String(s)} is NOT cancelled`, isCancelledStatus(s as string), false);
  check("income/expense strict", [isIncomeTx({ type: "income" }), isExpenseTx({ type: "expense" }), isIncomeTx({ type: "expense" }), isExpenseTx({ type: "income" }), isExpenseTx({ type: "הוצאה" })], [true, true, false, false, false]);
}

console.log("4. currency helpers");
{
  check("blank -> ₪", [normalizeCurrency(""), normalizeCurrency(null), normalizeCurrency(undefined), normalizeCurrency("  ")], ["₪", "₪", "₪", "₪"]);
  check("$ kept", normalizeCurrency("$"), "$");
  check("sameCurrency treats blank as ₪", [sameCurrency("", "₪"), sameCurrency("$", "₪"), sameCurrency(null, undefined)], [true, false, true]);
  check("orderCurrencies ₪,$,€,then alpha", orderCurrencies(["£", "€", "$", "₪", "CHF"]), ["₪", "$", "€", "CHF", "£"]);
  const g = groupByCurrency([{ currency: "$", n: 1 }, { currency: "", n: 2 }, { currency: "₪", n: 3 }]);
  check("groupByCurrency merges blank with ₪ and keeps order", [...g].map(([c, l]) => [c, l.map((r) => r.n)]), [["$", [1]], ["₪", [2, 3]]]);
  check("sumByCurrency", sumByCurrency([{ currency: "₪", a: 1 }, { currency: "$", a: 2 }, { currency: "₪", a: 3 }], (r) => r.a), { "₪": 4, "$": 2 });
  const t = addToTotals({}, "$", 5); addToTotals(t, "$", 2); addToTotals(t, "", 1);
  check("addToTotals", t, { "$": 7, "₪": 1 });
  check("totalOf default ₪ / missing", [totalOf({ "₪": 9 }), totalOf({ "$": 1 }), totalOf(undefined)], [9, 0, 0]);
  check("otherCurrencyAmounts drops ₪ and zeros", otherCurrencyAmounts({ "₪": 100, "$": 0, "€": 0.001, "£": 5 }), [{ currency: "£", amount: 5 }]);
  check("otherAmountsFrom picks a figure", otherAmountsFrom({ "$": { a: 3, b: 0 }, "€": { a: 0, b: 9 } }, (s) => s.b), [{ currency: "€", amount: 9 }]);
  check("formatOtherAmount", [formatOtherAmount(2200, "$"), formatOtherAmount(-2200, "$"), formatOtherAmount(388, "$"), formatOtherAmount(1234.5, "€")], ["$2,200", "−$2,200", "$388", "€1,234.5"]);
  check("otherCurrencyLines", otherCurrencyLines({ "₪": 13180, "$": 2200 }), ["$2,200"]);
  check("no other currency -> no lines", otherCurrencyLines({ "₪": 13180 }), []);
  const p = partitionByCurrency([{ currency: "₪", n: 1 }, { currency: "$", n: 2 }, { n: 3 }], "₪");
  check("partitionByCurrency (blank is ₪)", [p.same.map((r) => r.n), p.other.map((r) => r.n)], [[1, 3], [2]]);
}

console.log("5. R5: project money is compared only in the project's own currency");
{
  const agreed = 3000, projCur = "₪";
  const projectTx: Tx[] = [
    { type: "income", payment_status: "התקבל", amount: 1000, currency: "₪" },
    { type: "income", payment_status: "שולם", amount: 500, currency: "₪" },
    { type: "income", payment_status: "בוטל", amount: 400, currency: "₪" },
    { type: "income", payment_status: "התקבל", amount: 999, currency: "$" },          // must NOT reduce a ₪ balance
    { type: "income", payment_status: "התקבל", amount: 700, currency: "₪", expense_scope: "קליפ" }, // clip deal, not the song
    { type: "expense", payment_status: "שולם", amount: 388, currency: "$" },
  ];
  const { same, other } = partitionByCurrency(projectTx, projCur);
  const song = same.filter(isSongIncome);
  const paid = song.filter((t) => isReceivedStatus(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const cancelled = song.filter((t) => isCancelledStatus(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  check("paid counts ₪ song income only", paid, 1500);
  check("balance = 3000 − 1500 − 400", collectibleBalance(agreed, paid, cancelled), 1100);
  check("$ rows kept aside, not dropped", other.map((t) => `${t.type}:${t.currency}:${t.amount}`), ["income:$:999", "expense:$:388"]);
  const before = projectTx.filter(isSongIncome).filter((t) => isReceivedStatus(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  check("(old behaviour would have counted the $ 999)", before, 2499);

  // The four real priced projects: all ₪ setting, all ₪ income -> R5 changes nothing.
  const real = [
    { agreed: 3000, income: [1500, 1500] },
    { agreed: 4250, income: [1000, 1000, 1000, 1250] },
    { agreed: 3200, income: [1600, 1600] },
    { agreed: 3100, income: [1500, 1600] },
  ];
  let unchanged = true;
  for (const r of real) {
    const list: Tx[] = r.income.map((a) => ({ type: "income", payment_status: "התקבל", amount: a, currency: "₪" }));
    const oldPaid = list.filter(isSongIncome).filter((t) => isReceivedStatus(t.payment_status)).reduce((s, t) => s + t.amount, 0);
    const newPaid = partitionByCurrency(list, "₪").same.filter(isSongIncome).filter((t) => isReceivedStatus(t.payment_status)).reduce((s, t) => s + t.amount, 0);
    if (oldPaid !== newPaid || partitionByCurrency(list, "₪").other.length !== 0) unchanged = false;
    if (collectibleBalance(r.agreed, oldPaid, 0) !== collectibleBalance(r.agreed, newPaid, 0)) unchanged = false;
  }
  check("4 priced ₪ projects: R5 leaves every paid/balance figure unchanged", unchanged, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
