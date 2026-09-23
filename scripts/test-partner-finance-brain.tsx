/**
 * Tests — Redbloods Partner Finance Brain V1 (F2.1–F2.4): read-only financial control tower.
 *
 * Run with:   npx tsx scripts/test-partner-finance-brain.tsx
 *
 * NEVER touches production: the pure core / collections / brief run on in-memory fixtures; the reader
 * core runs against a fake select-only client; the REAL GET route runs in-process with requireOwner()
 * and the server binding faked; the brief is rendered with react-dom/server; boundaries are static.
 * The "production mirror" fixture reproduces the 2026-09-23 production shape and must yield the exact
 * brief the read-only production shadow printed.
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { NextResponse } from "next/server";
import { buildFinanceBrain, legacyOf, monthWindow, FINANCE_FLOOR_ILS, FINANCE_PREFERRED_ILS, RECORDING_POLICY_START } from "../lib/partner/finance/core";
import { resolveCollection, importanceOf, HIGH_VALUE_THRESHOLD_ILS } from "../lib/partner/finance/collections";
import { buildFinanceBrief, fmtMoney, FAMILY_RANK, CALM_HE } from "../lib/partner/finance/brief";
import { parseFinanceBriefResponse, FINANCE_BRIEF_MAX_ITEMS, type FinanceBriefDto } from "../lib/partner/finance/dto";
import { readFinanceRaw, FinanceReadError, type FinanceReadClient, type FinanceSelect } from "../lib/partner/finance/readers";
import type { FinanceRaw, FinanceTxRow, FinanceProjectRow, EngineerWorkRow, SalaryMonthRow } from "../lib/partner/finance/types";
import { PartnerActionsView } from "../components/partner/PartnerActionCard";
import { isAviAllowedPath, isCleantoneAllowedPath, isShalevAllowedPath, isStevenAllowedPath, isVictorAllowedPath } from "../lib/roles";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

// ── fixture helpers ──
const NOW = new Date("2026-09-23T09:00:00Z"); // 12:00 Israel
let seq = 0;
const id = () => { seq++; return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`; };
const tx = (o: Partial<FinanceTxRow> = {}): FinanceTxRow => ({ id: id(), projectId: null, type: "income", date: "2026-09-10", amount: 100, currency: "₪", status: "שולם", category: null, scope: "general", expenseScope: "כללי", linkedSessionId: null, createdAt: "2026-09-01T00:00:00Z", ...o });
const project = (o: Partial<FinanceProjectRow> = {}): FinanceProjectRow => ({ id: id(), name: "פרויקט", status: "בעבודה", isHidden: false, businessType: "לקוח", artist: "אמן", updatedAt: "2026-09-01T00:00:00Z", ...o });
const work = (o: Partial<EngineerWorkRow> = {}): EngineerWorkRow => ({ id: id(), projectId: null, engineerName: "Steven", status: "אושר", agreedPrice: 200, amountPaid: 0, currency: "$", linkedTransactionId: null, ...o });
const empty = (o: Partial<FinanceRaw> = {}): FinanceRaw => ({ transactions: [], projects: [], financeSettings: [], engineerWorks: [], shows: [], proposals: [], clients: [], labelArtists: [], ledger: [], mediaIncome: [], redFilmsPayments: [], victorSalary: [], ...o });
const brain = (raw: FinanceRaw, now: Date = NOW) => buildFinanceBrain(raw, now);
const withPrice = (p: FinanceProjectRow, price: number, extra: Record<string, unknown> = {}) => ({ projectId: p.id, value: { agreedPrice: price, currency: "₪", ...extra } });

// ── production mirror (shape of production on 2026-09-23; anonymous) ──
function productionMirror(): FinanceRaw {
  const projects: FinanceProjectRow[] = [];
  const transactions: FinanceTxRow[] = [];
  const financeSettings: FinanceRaw["financeSettings"] = [];
  const engineerWorks: EngineerWorkRow[] = [];
  // clip project (song price unknown, clip price 3,500; ₪1,500 received, ₪2,000 expected on 30.09)
  const clipP = project({ status: "בעבודה", artist: "אמן א, אמן ב" }); projects.push(clipP);
  financeSettings.push({ projectId: clipP.id, value: { currency: "₪", clipAgreedPrice: 3500 } });
  transactions.push(tx({ projectId: clipP.id, scope: "project", expenseScope: "קליפ", amount: 1500, status: "התקבל", date: "2026-08-27", category: "מקדמה" }));
  transactions.push(tx({ projectId: clipP.id, scope: "project", expenseScope: "קליפ", amount: 2000, status: "צפוי", date: "2026-09-30", category: "תשלום סופי", createdAt: "2026-08-27T00:00:00Z" }));
  // priced projects
  const p3200 = project({ status: "הושלם", artist: "לקוח 1", updatedAt: "2026-08-10T00:00:00Z" }); projects.push(p3200); financeSettings.push(withPrice(p3200, 3200));
  transactions.push(tx({ projectId: p3200.id, scope: "project", amount: 1600, status: "התקבל", date: "2026-07-01" }));
  for (const [status, price] of [["הושלם", 3100], ["הושלם", 4250], ["מחכה למיקס", 3000]] as const) {
    const p = project({ status }); projects.push(p); financeSettings.push(withPrice(p, price));
    transactions.push(tx({ projectId: p.id, scope: "project", amount: price, status: "התקבל", date: "2026-06-15" }));
  }
  // 14 completed unpriced: 8 with a paid (engineer-linked, ₪) expense and no income; 2 of the rest carry undated $ rows
  const paid = [650, 650, 650, 650, 650, 650, 950, 1240];
  const completedPlain: FinanceProjectRow[] = [];
  for (let i = 0; i < 14; i++) {
    const p = project({ status: "הושלם", updatedAt: "2026-07-20T00:00:00Z" }); projects.push(p);
    if (i < 8) {
      const t = tx({ projectId: p.id, scope: "project", type: "expense", amount: paid[i], status: "שולם", date: "2026-07-05", category: "מיקס / מאסטר" });
      transactions.push(t);
      engineerWorks.push(work({ projectId: p.id, status: "אושר", agreedPrice: 200, amountPaid: 200, linkedTransactionId: t.id }));
    } else completedPlain.push(p);
  }
  for (const [i, amt] of [5, 50, 3, 30, 300].entries()) transactions.push(tx({ projectId: completedPlain[i % 2].id, scope: "project", type: "expense", amount: amt, currency: "$", status: "לא שולם", date: null, category: "מיקס / מאסטר", createdAt: "2026-06-29T00:00:00Z" }));
  // a 9th ambiguous settlement: a paid $ work settled by a ₪ transaction on a priced project
  const linked9 = tx({ projectId: p3200.id, scope: "project", type: "expense", amount: 650, status: "שולם", date: "2026-07-28", category: "מיקס / מאסטר" });
  transactions.push(linked9);
  engineerWorks.push(work({ projectId: p3200.id, status: "אושר", agreedPrice: 200, amountPaid: 200, linkedTransactionId: linked9.id }));
  // 19 more open unpriced projects (5 near delivery)
  const openStatuses = ["מחכה למיקס", "מחכה למיקס", "מחכה למיקס", "במיקס", "במיקס", ...Array(14).fill("בעבודה")];
  const openP = openStatuses.map((s) => project({ status: s }));
  projects.push(...openP);
  // Steven open obligations: 3 approved-unpaid ($150, $550, $200) + in progress $200 + sent $400
  engineerWorks.push(work({ projectId: openP[5].id, status: "אושר", agreedPrice: 150 }), work({ projectId: openP[6].id, status: "אושר", agreedPrice: 550 }), work({ projectId: openP[7].id, status: "אושר", agreedPrice: 200 }));
  engineerWorks.push(work({ projectId: openP[3].id, status: "בתהליך", agreedPrice: 200 }), work({ projectId: openP[4].id, status: "נשלח", agreedPrice: 400 }));
  // shows + payouts
  const inc = tx({ type: "income", amount: 2700, status: "התקבל", date: "2026-09-11", category: "הופעה", expenseScope: "הופעה" });
  const dj = tx({ type: "expense", amount: 500, status: "שולם", date: "2026-09-11", category: "שכר דיג'יי", expenseScope: "הופעה" });
  const artistSep = tx({ type: "expense", amount: 1100, status: "צפוי", date: "2026-09-11", category: "שכר אמן", expenseScope: "הופעה", createdAt: "2026-09-07T00:00:00Z" });
  const artistAug = tx({ type: "expense", amount: 1050, status: "צפוי", date: "2026-08-06", category: "שכר אמן", expenseScope: "הופעה", createdAt: "2026-07-30T00:00:00Z" });
  const djZero = tx({ type: "expense", amount: 0, status: "צפוי", date: "2026-09-03", category: "שכר דיג'יי", expenseScope: "הופעה", createdAt: "2026-08-26T00:00:00Z" });
  transactions.push(inc, dj, artistSep, artistAug, djZero);
  const shows = [
    { id: id(), date: "2026-09-11", status: "בוצע", paymentStatus: "שולם", price: 2700, incomeTxId: inc.id, artistTxId: artistSep.id, djTxId: dj.id },
    { id: id(), date: "2026-08-06", status: "בוצע", paymentStatus: "שולם", price: 2800, incomeTxId: null, artistTxId: artistAug.id, djTxId: null },
    { id: id(), date: "2026-09-03", status: "בוצע", paymentStatus: "צפוי", price: 0, incomeTxId: null, artistTxId: null, djTxId: djZero.id },
    { id: id(), date: "2026-09-16", status: "בוטל", paymentStatus: "בוטל", price: 1000, incomeTxId: null, artistTxId: null, djTxId: null },
  ];
  // duplicate-looking pair (₪100 YouTube, same date + project)
  for (let i = 0; i < 2; i++) transactions.push(tx({ projectId: openP[8].id, scope: "project", type: "expense", amount: 100, status: "שולם", date: "2026-08-01", category: "YouTube" }));
  // 9 orphan price settings (their projects no longer exist)
  for (let i = 0; i < 9; i++) financeSettings.push({ projectId: randomUUID(), value: { agreedPrice: 3000, currency: "₪" } });
  const victorSalary: SalaryMonthRow[] = [
    { workMonth: "2026-08", dueDate: "2026-09-10", amount: 550, currency: "$", status: "שולם", transactionId: null },
    { workMonth: "2026-09", dueDate: "2026-10-10", amount: 550, currency: "$", status: "צפוי", transactionId: null },
  ];
  const clients = [
    { id: id(), name: "אמן א", status: "חדש", type: "אמן" }, { id: id(), name: "אמן ב", status: "חדש", type: "אמן" }, { id: id(), name: "לקוח 1", status: "חדש", type: "לקוח" },
    ...Array.from({ length: 4 }, (_, i) => ({ id: id(), name: `VIP ${i}`, status: "VIP", type: "אמן" })),
  ];
  const proposals = [0, 1, 2].map(() => ({ id: id(), clientId: clients[2].id, status: "נסגר", amount: 3000, currency: "₪", followupDate: "2026-06-10", linkedProjectId: p3200.id }));
  const artistId = id();
  return {
    transactions, projects, financeSettings, engineerWorks, shows, proposals, clients,
    labelArtists: [{ id: artistId, name: "אמן לייבל" }],
    ledger: Array.from({ length: 16 }, (_, i) => ({ artistId, entryType: "הכנסות", amount: 100, sourceTxId: i < 3 ? inc.id : null })),
    mediaIncome: [{ labelArtistId: artistId, status: "התקבל", grossAmount: 765.5 }],
    redFilmsPayments: Array.from({ length: 9 }, () => ({ id: id(), amount: 400, paymentDate: "2026-07-01" })),
    victorSalary,
  };
}
const PRODUCTION_BRIEF: FinanceBriefDto = {
  v: 1, month: "2026-09", asOfDate: "2026-09-23", coverage: "PARTIAL",
  coverageNoteHe: "הנתונים עדיין חלקיים, אז הנטו כאן הוא לפי מה שרשום במערכת. ברוב הפרויקטים אין מחיר מוסכם במערכת, ולכן אי אפשר לחשב גבייה מלאה. יש נתוני מחיר ישנים שדורשים בירור.",
  summary: {
    basisHe: "לפי הנתונים הרשומים כרגע", recordedNetIls: 2200, floorIls: 20000, preferredIls: 30000, gapToFloor: 17800, gapToPreferred: 27800, daysRemaining: 7,
    lineHe: "נטו מתועד החודש: ₪2,200. חסרים ₪17,800 לרף המינימום ו־₪27,800 ליעד המועדף.",
    positionLineHe: "לפי מה שידוע עד סוף החודש: +₪2,000 נכנס, ₪1,100 יוצא → ₪3,100. נותרו 7 ימים בחודש.",
    otherCurrencyLineHe: null,
  },
  items: [
    { family: "FINANCIAL_DATA_BLOCKER", epistemic: "DERIVED", textHe: "יש 8 פרויקטים שהסתיימו עם הוצאה רשומה אבל בלי הכנסה רשומה. כדאי להתחיל מהם." },
    { family: "UPCOMING_COLLECTION", epistemic: "FACT", textHe: "₪2,000 אמורים להיכנס עד 30.09." },
    { family: "COLLECTION_NO_DATE", epistemic: "FACT", textHe: "יש יתרה של ₪1,600 בפרויקט שהסתיים ואין לה תאריך גבייה." },
    { family: "COMMITTED_EXPENSE", epistemic: "FACT", textHe: "יש הוצאות פתוחות של ₪2,150 (הישנה ביותר באיחור 48 ימים). בנפרד במטבע זר: $1,888." },
    { family: "MISSING_EXPECTED_RECORD", epistemic: "FACT", textHe: "משכורת Victor עבור אוגוסט 2026 מסומנת כשולמה, אבל אין לה רישום בכספים." },
  ],
  calmHe: null,
};

// ── REAL route with requireOwner + binding faked ──
const auth = { role: "owner" as "owner" | "none" | "victor" };
const bind = { calls: 0, result: null as unknown };
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const origLoad = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (/lib\/require-auth$/.test(request)) return { async requireOwner() { return auth.role === "owner" ? null : NextResponse.json({ error: auth.role === "none" ? "Unauthorized" : "Forbidden" }, { status: auth.role === "none" ? 401 : 403 }); } };
  if (/partner\/finance\/server$/.test(request)) return { async getFinanceBrief() { bind.calls++; if (bind.result instanceof Error) throw bind.result; return bind.result; } };
  return origLoad.call(this, request, parent, isMain);
};

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  console.log("Realized money (1-12)");
  {
    const s = brain(empty({ transactions: [
      tx({ amount: 1000, status: "שולם" }), tx({ amount: 500, status: "התקבל" }), tx({ amount: 700, status: "צפוי" }), tx({ amount: 800, status: "לא שולם" }), tx({ amount: 900, status: "בוטל" }),
      tx({ type: "expense", amount: 300, status: "שולם" }), tx({ type: "expense", amount: 200, status: "לא שולם" }), tx({ type: "expense", amount: 50, status: "צפוי" }), tx({ type: "expense", amount: 40, status: "בוטל" }),
      tx({ amount: 99, currency: "$", status: "שולם" }), tx({ type: "expense", amount: 11, currency: "$", status: "שולם" }),
    ] }));
    check("1-2. income שולם + התקבל count as realized cash in", s.realized.ils.cashIn, 1500);
    check("3-5. צפוי / לא שולם / בוטל never count as realized", s.realized.byCurrency["₪"].cashIn, 1500);
    check("6. paid expense counts as cash out", s.realized.ils.cashOut, 300);
    check("7. unpaid / expected / cancelled expenses are not realized cash out", s.realized.ils.cashOut, 300);
    check("8. ILS and USD never mixed", [s.realized.byCurrency["₪"], s.realized.byCurrency["$"]], [{ cashIn: 1500, cashOut: 300, net: 1200 }, { cashIn: 99, cashOut: 11, net: 88 }]);
    check("9. the target applies to ILS only (USD net not added)", [s.realized.ils.net, s.realized.distanceToFloor], [1200, 18800]);
    check("10. realized net = cash in − cash out", s.realized.ils.net, s.realized.ils.cashIn - s.realized.ils.cashOut);
    check("11-12. distance to ₪20K floor and ₪30K preferred", [s.realized.distanceToFloor, s.realized.distanceToPreferred, FINANCE_FLOOR_ILS, FINANCE_PREFERRED_ILS], [18800, 28800, 20000, 30000]);
    check("target position is factual (no good/bad)", [s.realized.targetPosition, brain(empty({ transactions: [tx({ amount: 25000 })] })).realized.targetPosition, brain(empty({ transactions: [tx({ amount: 31000 })] })).realized.targetPosition], ["BELOW_FLOOR", "IN_TARGET_RANGE", "ABOVE_PREFERRED"]);
    check("distance never negative above target", brain(empty({ transactions: [tx({ amount: 31000 })] })).realized.distanceToPreferred, 0);
  }

  console.log("Historical / recording discipline (13-14)");
  {
    const s = brain(empty({ transactions: [tx({ date: "2026-08-05", amount: 5100 }), tx({ amount: 2200 })] }));
    check("13. months before the recording policy are historical-partial (recorded, not complete truth)", [s.history.map((h) => [h.month, h.historicalPartial]), s.realized.historicalPartial, s.coverage.realizedIncome], [[["2026-08", true]], true, { state: "PARTIAL", reason: "MONTH_STARTED_BEFORE_RECORDING_POLICY" }]);
    ok("13. historical signal present (FACT)", s.signals.some((x) => x.code === "HISTORICAL_DATA_PARTIAL" && x.epistemic === "FACT" && x.count === 2));
    const oct = new Date("2026-10-05T09:00:00Z");
    const due = tx({ amount: 1000, status: "צפוי", date: "2026-10-03", createdAt: "2026-09-25T00:00:00Z" });
    const s2 = brain(empty({ transactions: [due] }), oct);
    check("14. after the policy date: an expected payment past due is 'expected but not confirmed' (DERIVED, no blame)", [s2.coverage.realizedIncome.state, s2.signals.find((x) => x.code === "EXPECTED_INCOME_NOT_RECORDED")?.epistemic, s2.signals.find((x) => x.code === "EXPECTED_INCOME_NOT_RECORDED")?.amounts], ["PARTIAL", "DERIVED", { "₪": 1000 }]);
    const clean = brain(empty({ transactions: [tx({ date: "2026-10-02", amount: 1000 })] }), oct);
    check("14. a post-policy month without discrepancies has RELIABLE recorded income", clean.coverage.realizedIncome, { state: "RELIABLE", reason: "RECORDING_POLICY_IN_EFFECT" });
    check("recording policy start is 2026-09-23", RECORDING_POLICY_START, "2026-09-23");
  }

  console.log("Receivables (15-22)");
  {
    const unpriced = project({ status: "הושלם" });
    const s = brain(empty({ projects: [unpriced], transactions: [tx({ projectId: unpriced.id, scope: "project", amount: 500 })] }));
    check("15/22. PRICE_UNKNOWN is not zero: no receivable invented", [s.receivables.length, s.signals.find((x) => x.code === "PRICE_MISSING")?.count], [0, 1]);
    const full = project({ status: "הושלם" });
    const s2 = brain(empty({ projects: [full], financeSettings: [withPrice(full, 3000)], transactions: [tx({ projectId: full.id, scope: "project", amount: 3000, status: "התקבל" })] }));
    check("16. paid ≥ agreed → no debt", s2.receivables.length, 0);
    const over = project({ status: "הושלם" });
    const s3 = brain(empty({ projects: [over], financeSettings: [withPrice(over, 3000)], transactions: [tx({ projectId: over.id, scope: "project", amount: 3500 })] }));
    check("17. overpayment → credit (not debt)", [s3.receivables.length, s3.credits.map((c) => [c.amount, c.currency, c.kind])], [0, [[500, "₪", "SONG"]]]);
    const part = project({ status: "בעבודה" });
    const exp = tx({ projectId: part.id, scope: "project", amount: 1000, status: "צפוי", date: "2026-10-15" });
    const s4 = brain(empty({ projects: [part], financeSettings: [withPrice(part, 4000)], transactions: [tx({ projectId: part.id, scope: "project", amount: 1000, status: "התקבל" }), exp] }));
    check("21. known price → open receivable split into the dated expected part + undated remainder", s4.receivables.map((r) => [r.source, r.amount, r.dueDate, r.priceKnown]), [["EXPECTED_TX", 1000, "2026-10-15", true], ["PROJECT_BALANCE", 2000, null, true]]);
    check("18. dated expected income is a separate class", s4.expected.map((e) => [e.class, e.amount, e.certainty]), [["DATED_EXPECTED", 1000, "CONTRACTUAL_RECORD"]]);
    check("19. forecast never added to realized", s4.realized.ils.cashIn, 1000);
    const prop = brain(empty({ proposals: [{ id: id(), clientId: null, status: "ממתין לתשובה", amount: 5000, currency: "₪", followupDate: "2026-09-30", linkedProjectId: null }] }));
    check("20. proposals never counted as received (pipeline only)", [prop.realized.ils.cashIn, prop.receivables.length, prop.proposalPipeline, prop.expected.map((e) => [e.class, e.certainty])], [0, 0, { state: "ACTIVE", openCount: 1, amounts: { "₪": 5000 } }, [["PROPOSAL_PIPELINE", "PROPOSAL_ONLY"]]]);
    check("20. an empty pipeline is reported as NO_ACTIVE_PIPELINE_DATA", brain(empty()).proposalPipeline.state, "NO_ACTIVE_PIPELINE_DATA");
    const cancelled = project({ status: "בוטל" });
    const s5 = brain(empty({ projects: [cancelled], financeSettings: [withPrice(cancelled, 3000)], transactions: [tx({ projectId: cancelled.id, scope: "project", amount: 3000, status: "בוטל" })] }));
    check("a cancelled project's written-off balance is NOT_COLLECTIBLE (canonical collectibleAmount)", s5.receivables.map((r) => r.collection.state), ["NOT_COLLECTIBLE"]);
    const clip = project({ status: "בעבודה" });
    const s6 = brain(empty({ projects: [clip], financeSettings: [{ projectId: clip.id, value: { clipAgreedPrice: 3500, currency: "₪" } }], transactions: [tx({ projectId: clip.id, scope: "project", expenseScope: "קליפ", amount: 1500 }), tx({ projectId: clip.id, scope: "project", expenseScope: "קליפ", amount: 2000, status: "צפוי", date: "2026-09-30" })] }));
    check("clip deal uses its own agreed price (canonical clip math) and never mixes with song income", s6.receivables.map((r) => [r.source, r.amount, r.dueDate, r.priceKnown]), [["EXPECTED_TX", 2000, "2026-09-30", true]]);
  }

  console.log("Collections — adaptive policy (23-31)");
  {
    const T = "2026-09-23";
    const small = (d: string | null) => resolveCollection({ amount: 1000, currency: "₪", dueDate: d, today: T, vip: false });
    const large = (d: string | null) => resolveCollection({ amount: 3000, currency: "₪", dueDate: d, today: T, vip: false });
    check("23. small: 3 days before → DUE_SOON 3D, 4 days → UPCOMING", [small("2026-09-26").state, small("2026-09-26").reminderStage, small("2026-09-26").remindToday, small("2026-09-27").state], ["DUE_SOON", "3D_BEFORE", true, "UPCOMING"]);
    check("24. large (≥ ₪3,000): 7 days before → 7D, 1 day → 1D, 8 days → UPCOMING", [large("2026-09-30").reminderStage, large("2026-09-30").remindToday, large("2026-09-24").reminderStage, large("2026-10-01").state, large("2026-09-30").importanceBasis], ["7D_BEFORE", true, "1D_BEFORE", "UPCOMING", "HIGH_VALUE"]);
    check("25. VIP → important regardless of amount", [resolveCollection({ amount: 200, currency: "₪", dueDate: "2026-09-29", today: T, vip: true }).state, importanceOf(200, "₪", true)], ["DUE_SOON", { important: true, basis: "VIP_CLIENT" }]);
    check("threshold is ₪3,000; USD has no threshold (VIP only)", [HIGH_VALUE_THRESHOLD_ILS, importanceOf(5000, "$", false)], [3000, { important: false, basis: "NON_ILS_NO_THRESHOLD" }]);
    check("26. due today", [small(T).state, small(T).reminderStage, small(T).remindToday], ["DUE_TODAY", "DUE_TODAY", true]);
    check("27. overdue", [small("2026-09-20").state, small("2026-09-20").daysOverdue], ["OVERDUE", 3]);
    check("28. weekly while overdue (remind on 7, 14… days overdue)", [small("2026-09-16").remindToday, small("2026-09-09").remindToday, small("2026-09-15").remindToday, small("2026-09-15").reminderStage], [true, true, false, "WEEKLY_OVERDUE"]);
    check("29. no due date → NO_DUE_DATE, weekly (Sunday)", [small(null).state, small(null).reminderStage, resolveCollection({ amount: 1, currency: "₪", dueDate: null, today: "2026-09-27", vip: false }).remindToday, small(null).remindToday], ["NO_DUE_DATE", "WEEKLY_NO_DATE", true, false]);
    check("30. settled → no collection need", resolveCollection({ amount: 0, currency: "₪", dueDate: "2026-09-20", today: T, vip: false }).state, "SETTLED");
    const p = project({ status: "הושלם", updatedAt: "2026-08-01T00:00:00Z" });
    const s = brain(empty({ projects: [p], financeSettings: [withPrice(p, 3200)], transactions: [tx({ projectId: p.id, scope: "project", amount: 1600, date: "2026-07-01" })] }));
    check("31. the late / missing reason stays UNKNOWN (no reason model)", s.receivables.map((r) => [r.reasonKnown, r.reason]), [[false, "UNKNOWN"]]);
  }

  console.log("Recurring expenses (32-35)");
  {
    const salary = (status: string, txId: string | null = null): SalaryMonthRow[] => [{ workMonth: "2026-08", dueDate: "2026-09-10", amount: 550, currency: "$", status, transactionId: txId }];
    const found = tx({ type: "expense", amount: 550, currency: "$", status: "שולם", date: "2026-09-10", linkedSessionId: "victor_salary_2026-08" });
    const s = brain(empty({ transactions: [found], victorSalary: salary("שולם", found.id) }));
    check("32. explicit known recurring (Victor salary) found in finance", [s.recurring.known.map((k) => k.state), s.recurring.classification[found.id]], [["FOUND_IN_FINANCE"], "KNOWN_RECURRING"]);
    check("35. known recurring expense with no record → EXPECTED_EXPENSE_NOT_FOUND (DERIVED)", [brain(empty({ victorSalary: salary("לא שולם") })).recurring.known[0].state, brain(empty({ victorSalary: salary("לא שולם") })).signals.find((x) => x.code === "EXPECTED_EXPENSE_NOT_FOUND")?.epistemic], ["EXPECTED_EXPENSE_NOT_FOUND", "DERIVED"]);
    check("marked paid outside Finance → EXPENSE_NOT_IN_FINANCE (not counted as cash out)", [brain(empty({ victorSalary: salary("שולם") })).recurring.known[0].state, brain(empty({ victorSalary: salary("שולם") })).realized.byCurrency], ["PAID_OUTSIDE_FINANCE", {}]);
    const rep = ["2026-06-03", "2026-07-03", "2026-08-03"].map((d) => tx({ type: "expense", amount: 120, status: "שולם", date: d, category: "תוכנה" }));
    const s2 = brain(empty({ transactions: rep, victorSalary: [] }));
    check("33. a repeated expense is a RECURRING_CANDIDATE (HYPOTHESIS), never KNOWN", [s2.recurring.candidates.map((c) => [c.category, c.amount, c.epistemic, c.months.length]), rep.map((t) => s2.recurring.classification[t.id])], [[["תוכנה", 120, "HYPOTHESIS", 3]], ["RECURRING_CANDIDATE", "RECURRING_CANDIDATE", "RECURRING_CANDIDATE"]]);
    check("34. a candidate is never a committed future outflow", [s2.pacing.knownOutgoingIls, s2.openExpenses.items.length], [0, 0]);
    check("unknown salary read → recurring coverage MISSING (never guessed)", brain(empty({ victorSalary: null })).coverage.recurringExpenses.state, "MISSING");
    check("upcoming salary this month is a committed outflow in its own currency", brain(empty({ victorSalary: [{ workMonth: "2026-08", dueDate: "2026-09-28", amount: 550, currency: "$", status: "צפוי", transactionId: null }] })).pacing.otherCurrencies.outgoing, { $: 550 });
  }

  console.log("Orphans / label / Red Films / USD safety (36-44)");
  {
    const s = brain(empty({ financeSettings: [{ projectId: randomUUID(), value: { agreedPrice: 5000, currency: "₪" } }, { projectId: randomUUID(), value: { agreedPrice: 3000, currency: "₪" } }] }));
    check("36. orphan price settings never count as money", [s.receivables.length, s.realized.ils.cashIn, s.pacing.knownIncomingIls, s.expected.length], [0, 0, 0, 0]);
    check("37. orphans grouped as one NEEDS_OWNER_REVIEW signal (no amounts)", s.signals.filter((x) => x.code === "ORPHAN_PRICE_SETTINGS").map((x) => [x.count, x.review, x.amounts]), [[2, "NEEDS_OWNER_REVIEW", {}]]);
    const show = tx({ type: "expense", amount: 1100, status: "צפוי", date: "2026-09-11", expenseScope: "הופעה" });
    const s2 = brain(empty({ transactions: [show], shows: [{ id: id(), date: "2026-09-11", status: "בוצע", paymentStatus: "שולם", price: 2700, incomeTxId: null, artistTxId: show.id, djTxId: null }], ledger: [{ artistId: "a", entryType: "הכנסות צפויות", amount: 1100, sourceTxId: show.id }], mediaIncome: [{ labelArtistId: "a", status: "התקבל", grossAmount: 700 }] }));
    check("38. label ledger without currency excluded from totals; show fee counted once (from the transaction)", [s2.openExpenses.totalsByCurrency, s2.signals.find((x) => x.code === "LABEL_LEDGER_NO_CURRENCY")?.evidence[0].reasonCode, s2.realized.byCurrency], [{ "₪": 1100 }, "LEDGER_ROW_MIRRORS_TRANSACTION", {}]);
    check("38. media income without currency excluded", [s2.signals.some((x) => x.code === "MEDIA_INCOME_NO_CURRENCY"), s2.realized.ils.cashIn], [true, 0]);
    const s3 = brain(empty({ redFilmsPayments: [{ id: id(), amount: 1800, paymentDate: "2026-09-05" }] }));
    check("39. Red Films payments without currency excluded (coverage gap only)", [s3.realized.ils.cashOut, s3.signals.find((x) => x.code === "RED_FILMS_OUTSIDE_FINANCE")?.count, s3.coverage.currencies.state], [0, 1, "PARTIAL"]);
    const settle = tx({ type: "expense", amount: 650, status: "שולם", date: "2026-07-05" });
    const s4 = brain(empty({ transactions: [settle], engineerWorks: [work({ agreedPrice: 200, amountPaid: 200, linkedTransactionId: settle.id }), work({ agreedPrice: 550 })] }));
    check("40. Steven obligations stay in USD", s4.openExpenses.totalsByCurrency, { $: 550 });
    check("41. USD work settled by an ILS transaction → CURRENCY_SETTLEMENT_AMBIGUOUS (no FX inferred)", [s4.signals.find((x) => x.code === "CURRENCY_SETTLEMENT_AMBIGUOUS")?.count, s4.coverage.currencies.state], [1, "AMBIGUOUS"]);
    const p = project();
    const wk = work({ projectId: p.id, agreedPrice: 300, linkedTransactionId: null });
    const linkedOpen = tx({ projectId: p.id, scope: "project", type: "expense", amount: 300, currency: "$", status: "לא שולם", date: null, category: "מיקס / מאסטר" });
    const wk2 = work({ projectId: p.id, agreedPrice: 400, linkedTransactionId: null });
    const s5 = brain(empty({ projects: [p], engineerWorks: [wk], transactions: [linkedOpen] }));
    check("42. the same obligation in a work row + an unlinked open tx is not double-counted (overlap held for review)", [s5.openExpenses.totalsByCurrency, s5.openExpenses.possibleOverlaps.length, s5.signals.find((x) => x.code === "POSSIBLE_OBLIGATION_OVERLAP")?.epistemic], [{ $: 300 }, 1, "HYPOTHESIS"]);
    const linkedTx = tx({ projectId: p.id, scope: "project", type: "expense", amount: 400, currency: "$", status: "לא שולם", category: "מיקס / מאסטר" });
    const s6 = brain(empty({ projects: [p], engineerWorks: [{ ...wk2, linkedTransactionId: linkedTx.id }], transactions: [linkedTx] }));
    check("42. a linked work transaction is represented once (by the work)", [s6.openExpenses.items.map((e) => e.source), s6.openExpenses.totalsByCurrency], [["ENGINEER_WORK"], { $: 400 }]);
    const s7 = brain(empty({ transactions: [tx({ scope: "project", projectId: null, amount: 100 })] }));
    check("43. project attribution uncertainty preserved", [s7.coverage.projectAttribution.state, s7.signals.some((x) => x.code === "TRANSACTION_PROJECT_LINK_MISSING")], ["PARTIAL", true]);
    const amb = project({ artist: "א, ב" });
    const s8 = brain(empty({ projects: [amb], financeSettings: [withPrice(amb, 3000)], clients: [{ id: id(), name: "א", status: "VIP", type: "אמן" }, { id: id(), name: "ב", status: "חדש", type: "אמן" }] }));
    check("44. client attribution uncertainty preserved (two name matches → AMBIGUOUS, no VIP assumed)", [s8.receivables[0].client, s8.coverage.clientAttribution.state], [{ attribution: "AMBIGUOUS", vip: false }, "AMBIGUOUS"]);
  }

  console.log("Brief prioritizer (45-50)");
  {
    const prod = buildFinanceBrief(brain(productionMirror()));
    check("45. at most 5 items", [prod.items.length <= FINANCE_BRIEF_MAX_ITEMS, FINANCE_BRIEF_MAX_ITEMS], [true, 5]);
    ok("46. one line per family (duplicates collapsed)", new Set(prod.items.map((i) => i.family)).size === prod.items.length);
    const many = brain(empty({ transactions: [tx({ amount: 500, status: "צפוי", date: "2026-09-10" }), tx({ amount: 700, status: "צפוי", date: "2026-09-15" })] }));
    const mb = buildFinanceBrief(many);
    check("46. two overdue collections → one collapsed line", mb.items.filter((i) => i.family === "OVERDUE_COLLECTION").map((i) => i.textHe), ["2 גביות עברו את המועד (₪1,200). הסיבה לא ידועה."]);
    const rich = buildFinanceBrief(brain(empty({
      projects: [project({ status: "במיקס" })], clients: [{ id: id(), name: "VIP", status: "VIP", type: "אמן" }],
      transactions: [tx({ amount: 500, status: "צפוי", date: "2026-09-10" }), ...["2026-06-03", "2026-07-03", "2026-08-03"].map((d) => tx({ type: "expense", amount: 120, status: "שולם", date: d, category: "תוכנה" }))],
    })));
    ok("47. overdue collection outranks a revenue idea / recurring hypothesis", rich.items[0].family === "OVERDUE_COLLECTION" && rich.items.findIndex((i) => i.family === "OVERDUE_COLLECTION") < rich.items.findIndex((i) => i.family === "REVENUE_OPPORTUNITY"));
    check("family rank is fixed", Object.entries(FAMILY_RANK).sort((a, b) => a[1] - b[1]).map(([f]) => f), ["FINANCIAL_DATA_BLOCKER", "OVERDUE_COLLECTION", "UPCOMING_COLLECTION", "COLLECTION_NO_DATE", "COMMITTED_EXPENSE", "MISSING_EXPECTED_RECORD", "REVENUE_OPPORTUNITY", "RECURRING_EXPENSE_REVIEW"]);
    ok("48. data coverage blocker surfaced first", prod.items[0].family === "FINANCIAL_DATA_BLOCKER" && !!prod.coverageNoteHe);
    ok("49. FACT / DERIVED / HYPOTHESIS labels preserved", rich.items.some((i) => i.epistemic === "HYPOTHESIS") && prod.items.some((i) => i.epistemic === "DERIVED") && prod.items.some((i) => i.epistemic === "FACT"));
    const ideaState = brain(empty({ clients: [{ id: id(), name: "V", status: "VIP", type: "אמן" }] }));
    check("50. ideas never counted as forecast / money", [ideaState.opportunities.filter((o) => o.kind === "IDEA").map((o) => o.amount), ideaState.pacing.knownIncomingIls, ideaState.expected.length], [[null, null], 0, 0]);
    ok("50. idea wording is labelled 'רעיון' and never promises money", buildFinanceBrief(ideaState).items.every((i) => i.family !== "REVENUE_OPPORTUNITY" || (i.textHe.startsWith("רעיון") && !/תרוויח|תכניס|ייכנסו/.test(i.textHe))));
    const calm = buildFinanceBrief(brain(empty({ transactions: [tx({ date: "2026-10-02", amount: 25000 })] }), new Date("2026-10-05T09:00:00Z")));
    check("nothing requires the Owner → calm line", [calm.items.length, calm.calmHe], [0, CALM_HE]);
    ok("no good/bad wording anywhere", !/טוב|רע|גרוע|מצוין|כישלון|failure|bad|good/i.test(JSON.stringify(prod) + JSON.stringify(rich)));
  }

  console.log("Fail closed on malformed data (51-52)");
  {
    const s = brain(empty({ transactions: [tx({ amount: "abc" }), tx({ type: "weird" }), tx({ date: "23/09/2026" }), tx({ amount: -5 }), tx({ amount: 100 })] }));
    check("51. malformed transactions never reach a total (flagged instead)", [s.realized.ils.cashIn, s.signals.find((x) => x.code === "MALFORMED_RECORDS")?.count], [100, 4]);
    const p = project();
    const s2 = brain(empty({ projects: [p], financeSettings: [{ projectId: p.id, value: { agreedPrice: "lots", currency: "₪" } }, { projectId: randomUUID(), value: "junk" }] }));
    check("52. malformed finance settings → PRICE_UNKNOWN + flagged (no receivable)", [s2.receivables.length, s2.priceCoverage.malformedSettings, s2.signals.find((x) => x.code === "MALFORMED_RECORDS")?.count], [0, 2, 2]);
    check("parser: numeric strings are accepted (Postgres numeric)", brain(empty({ transactions: [tx({ amount: "250.5" })] })).realized.ils.cashIn, 250.5);
  }

  console.log("Reader core: select-only, fail closed");
  {
    const touched: string[] = [];
    const client = (fail?: string): FinanceReadClient => ({
      from(table: string) {
        return {
          select(cols: string) {
            touched.push(`${table}:${cols.split(",").length}`);
            const q: FinanceSelect = { range() { return q; }, like() { return q; }, then(res, rej) { return Promise.resolve(table === fail ? { data: null, error: { message: "boom" } } : { data: table === "settings" ? [{ key: "finance_11111111-1111-4111-8111-111111111111", value: { agreedPrice: 1 } }, { key: "album_finance_x", value: {} }] : [], error: null }).then(res, rej); } };
            return q;
          },
        };
      },
    });
    const raw = await readFinanceRaw(client(), async () => []);
    check("reads only finance_<uuid> price settings (album finance ignored)", raw.financeSettings.map((f) => f.projectId), ["11111111-1111-4111-8111-111111111111"]);
    let threw = false;
    try { await readFinanceRaw(client("transactions"), async () => []); } catch (e) { threw = e instanceof FinanceReadError; }
    ok("a failed table read fails the whole read (never a silently partial brief)", threw);
    check("a failed salary read → victorSalary null (coverage MISSING, not fatal)", (await readFinanceRaw(client(), async () => { throw new Error("x"); })).victorSalary, null);
    const READERS = strip(rd("lib/partner/finance/readers.ts"));
    ok("reader never reads free text (notes / description) and has no write capability", !/notes|description|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(READERS));
  }

  console.log("Timezone / month boundaries (73-74)");
  {
    check("73. 2026-09-30 23:30 Israel is still September", monthWindow(new Date("2026-09-30T20:30:00Z")).key, "2026-09");
    check("73. 2026-10-01 00:30 Israel is already October (UTC would still say September)", [monthWindow(new Date("2026-09-30T21:30:00Z")).key, new Date("2026-09-30T21:30:00Z").toISOString().slice(0, 7)], ["2026-10", "2026-09"]);
    const late = brain(empty({ transactions: [tx({ amount: 1000, date: "2026-09-30" }), tx({ amount: 2000, status: "צפוי", date: "2026-09-30" })] }), new Date("2026-09-30T21:30:00Z"));
    check("73. after Israeli midnight the September income is no longer 'this month'", [late.month.key, late.realized.ils.cashIn], ["2026-10", 0]);
    const w = monthWindow(new Date("2026-09-30T20:30:00Z"));
    check("74. month end: last day, 0 days remaining", [w.start, w.end, w.daysRemaining, w.daysInMonth], ["2026-09-01", "2026-09-30", 0, 30]);
    const endDay = brain(empty({ transactions: [tx({ amount: 2000, status: "צפוי", date: "2026-09-30" })] }), new Date("2026-09-30T08:00:00Z"));
    check("74. on the last day the payment due today is DUE_TODAY and still a known incoming", [endDay.receivables[0].collection.state, endDay.pacing.knownIncomingIls, endDay.pacing.daysRemaining], ["DUE_TODAY", 2000, 0]);
    check("February length handled", monthWindow(new Date("2027-02-10T09:00:00Z")).end, "2027-02-28");
  }

  console.log("Pacing (no straight line)");
  {
    const s = brain(productionMirror());
    check("recorded net + known incoming − known outgoing = known month-end position (labelled, not a forecast)", [s.pacing.recordedRealizedNetIls, s.pacing.knownIncomingIls, s.pacing.knownOutgoingIls, s.pacing.knownMonthEndPositionIls, s.pacing.label, s.pacing.coverage], [2200, 2000, 1100, 3100, "KNOWN_MONTH_END_POSITION", "PARTIAL"]);
    ok("no straight-line pace wording in the brief", !/אמור להיות ב|לפי הקצב/.test(JSON.stringify(buildFinanceBrief(s))));
    check("legacy classification is evidence-based (old ≠ automatically historical)", [
      legacyOf({ dueDate: "2026-09-11", createdAt: null, amount: 1100, policyStart: RECORDING_POLICY_START }),
      legacyOf({ dueDate: "2026-08-06", createdAt: null, amount: 1050, policyStart: RECORDING_POLICY_START }),
      legacyOf({ dueDate: "2026-09-03", createdAt: null, amount: 0, policyStart: RECORDING_POLICY_START }),
      legacyOf({ dueDate: null, createdAt: "2026-06-29T00:00:00Z", amount: 300, policyStart: RECORDING_POLICY_START }),
      legacyOf({ dueDate: null, createdAt: null, amount: 300, policyStart: RECORDING_POLICY_START }),
    ], ["CONFIRMED_CURRENT", "NEEDS_REVIEW", "LIKELY_HISTORICAL", "NEEDS_REVIEW", "UNKNOWN"]);
  }

  console.log("75. production mirror → the exact production brief");
  {
    const s = brain(productionMirror());
    check("realized September ₪", s.realized.ils, { cashIn: 2700, cashOut: 500, net: 2200 });
    check("receivables: ₪2,000 upcoming 30.09 + ₪1,600 no date (NEEDS_REVIEW)", s.receivables.map((r) => [r.amount, r.dueDate, r.collection.state, r.legacy]), [[2000, "2026-09-30", "UPCOMING", "CONFIRMED_CURRENT"], [1600, null, "NO_DUE_DATE", "NEEDS_REVIEW"]]);
    check("open expenses: ₪2,150 (show payouts) + $1,888 ($1,500 Steven + $388 undated)", s.openExpenses.totalsByCurrency, { $: 1888, "₪": 2150 });
    check("Victor August salary marked paid outside Finance", s.recurring.known.map((k) => [k.workMonth, k.state]), [["2026-08", "PAID_OUTSIDE_FINANCE"]]);
    check("price coverage 4 of 38; 20 open + 14 completed unknown", [s.priceCoverage.priced, s.priceCoverage.liveProjects, s.priceCoverage.priceUnknownOpen, s.priceCoverage.priceUnknownCompleted], [4, 38, 20, 14]);
    check("signals (codes + counts)", s.signals.map((x) => [x.code, x.count]), [["HISTORICAL_DATA_PARTIAL", 4], ["EXPENSE_NOT_IN_FINANCE", 1], ["PRICE_MISSING", 34], ["COMPLETED_WORK_EXPENSE_NO_INCOME", 8], ["DUE_DATE_MISSING", 1], ["CURRENCY_SETTLEMENT_AMBIGUOUS", 9], ["ORPHAN_PRICE_SETTINGS", 9], ["SHOW_PRICE_MISSING", 1], ["DUPLICATE_LOOKING_RECORDS", 1], ["LABEL_LEDGER_NO_CURRENCY", 16], ["MEDIA_INCOME_NO_CURRENCY", 1], ["RED_FILMS_OUTSIDE_FINANCE", 9], ["UNDATED_RECORDS", 5]]);
    check("30/75. the brief equals the one the read-only production shadow printed", buildFinanceBrief(s), PRODUCTION_BRIEF);
    check("the client parser accepts it", parseFinanceBriefResponse(JSON.parse(JSON.stringify(PRODUCTION_BRIEF))).ok, true);
  }

  console.log("Strict DTO parser (72)");
  {
    const b = JSON.parse(JSON.stringify(PRODUCTION_BRIEF));
    check("72. forged / malformed payloads fail closed", [
      parseFinanceBriefResponse({ ...b, v: 2 }).ok,
      parseFinanceBriefResponse({ ...b, extra: 1 }).ok,
      parseFinanceBriefResponse({ ...b, items: [...b.items, { family: "REVENUE_OPPORTUNITY", epistemic: "HYPOTHESIS", textHe: "x" }] }).ok,
      parseFinanceBriefResponse({ ...b, items: [b.items[0], b.items[0]] }).ok,
      parseFinanceBriefResponse({ ...b, items: [{ ...b.items[0], epistemic: "CERTAIN" }] }).ok,
      parseFinanceBriefResponse({ ...b, coverageNoteHe: null }).ok,
      parseFinanceBriefResponse({ ...b, summary: { ...b.summary, recordedNetIls: "2200" } }).ok,
      parseFinanceBriefResponse({ ...b, calmHe: "x" }).ok,
      parseFinanceBriefResponse(null).ok,
    ], [false, false, false, false, false, false, false, false, false]);
  }

  console.log("Route: Owner-only GET (69-71)");
  {
    const route = require("../app/api/partner/finance/route") as { GET(): Promise<Response> }; // eslint-disable-line @typescript-eslint/no-require-imports
    const ROUTE = rd("app/api/partner/finance/route.ts");
    bind.result = { status: "OK", brief: PRODUCTION_BRIEF, state: {} };
    auth.role = "none"; bind.calls = 0;
    check("69. no session → 401, nothing computed", [(await route.GET()).status, bind.calls], [401, 0]);
    auth.role = "victor";
    check("70. non-owner → 403, nothing computed", [(await route.GET()).status, bind.calls], [403, 0]);
    check("70. no non-owner role may reach /api/partner/finance (proxy allowlists)", [isVictorAllowedPath, isStevenAllowedPath, isShalevAllowedPath, isCleantoneAllowedPath, isAviAllowedPath].map((f) => f("/api/partner/finance")), [false, false, false, false, false]);
    auth.role = "owner";
    const res = await route.GET();
    check("69. Owner → 200 brief, no-store", [res.status, res.headers.get("cache-control"), parseFinanceBriefResponse(await res.json()).ok], [200, "no-store", true]);
    bind.result = { status: "UNAVAILABLE", detail: "transactions read failed" };
    const warn = console.warn; console.warn = () => {};
    const u = await route.GET(); const ut = await u.text();
    console.warn = warn;
    check("68. unavailable → 503 generic (no internals)", [u.status, /transactions/.test(ut)], [503, false]);
    bind.result = new Error("relation projects SQLSTATE 42501");
    const err = console.error; console.error = () => {};
    const f = await route.GET(); const ft = await f.text();
    console.error = err;
    check("68. exception → 500 generic", [f.status, /SQLSTATE|projects/.test(ft)], [500, false]);
    ok("71. GET only", /export async function GET\(/.test(ROUTE) && !/export (async )?function (POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/.test(ROUTE));
    ok("69. requireOwner() before any read", /const denied = await requireOwner\(\);\s*if \(denied\) return denied;\s*try \{\s*const r = await getFinanceBrief\(\);/.test(ROUTE));
    check("route imports only next/server, require-auth and the finance binding", [...ROUTE.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort(), ["@/lib/partner/finance/server", "@/lib/require-auth", "next/server"]);
  }

  console.log("Boundaries (53-63)");
  {
    const FILES = ["lib/partner/finance/core.ts", "lib/partner/finance/collections.ts", "lib/partner/finance/brief.ts", "lib/partner/finance/dto.ts", "lib/partner/finance/readers.ts", "lib/partner/finance/server.ts", "lib/partner/finance/types.ts", "app/api/partner/finance/route.ts", "components/partner/PartnerFinanceBrief.tsx"];
    const src = FILES.map((f) => strip(rd(f)));
    ok("53/54. no DB / transaction write (no insert / update / upsert / delete)", src.every((s) => !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(s)));
    ok("55. no Action Event write", src.every((s) => !/partner_action_events|appendDecision|event-store|event-persistence/.test(s)));
    ok("56. no Owner Context write", src.every((s) => !/appendOwnerContext|context-store|context-persistence|partner_owner_context/.test(s)));
    ok("57. no Feedback write", src.every((s) => !/feedback\/|partner_feedback/.test(s)));
    ok("58. no baseline write", src.every((s) => !/savePartnerBaseline|baseline\/|partner_change_baseline/.test(s)));
    ok("59. no project mutation", src.every((s) => !/updateProject|\/api\/projects|projects-store/.test(s)));
    ok("60. no RPC execution", src.every((s) => !/\.rpc\(|executeApprovedAction|partner_execute_update_project_deadline/.test(s)));
    ok("61-63. no Push / Cron / Agent Alerts", src.every((s) => !/web-push|lib\/push|node-cron|cron|agent_alerts|alerts-store|lib\/agent\//i.test(s)));
    ok("no FX conversion anywhere (no rate / exchange)", src.every((s) => !/exchange ?rate|fxRate|convertCurrency|usdToIls/i.test(s)));
    ok("the core is pure: no supabase, no server-only, no clock", ["core", "collections", "brief", "dto", "types", "readers"].every((f) => !/lib\/supabase|server-only|new Date\(\)|Date\.now\(/.test(strip(rd(`lib/partner/finance/${f}.ts`)))));
    ok("the binding is server-only", /^import "server-only";/m.test(rd("lib/partner/finance/server.ts")));
    ok("canonical helpers are reused, not redefined", /from "..\/..\/finance\/classify"/.test(rd("lib/partner/finance/core.ts")) && /collectibleAmount, overpaymentAmount/.test(rd("lib/partner/finance/core.ts")) && /summarizeClipFinance/.test(rd("lib/partner/finance/core.ts")) && !/\["שולם", "התקבל"\]/.test(strip(rd("lib/partner/finance/core.ts"))));
    ok("Victor salary resolved by the canonical getVictorSalaryMonths", /getVictorSalaryMonths/.test(rd("lib/partner/finance/server.ts")));
    ok("no cron / instrumentation / agent module reaches the finance brain", !/partner\/finance/.test(rd("instrumentation.ts")) && fs.readdirSync(path.join(ROOT, "lib", "agent")).every((f) => !/partner\/finance/.test(fs.readFileSync(path.join(ROOT, "lib", "agent", f), "utf8"))));
  }

  console.log("UI (64-68)");
  {
    const d = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={PRODUCTION_BRIEF} />);
    const m = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={true} finance={PRODUCTION_BRIEF} />);
    ok("64-65. Hebrew RTL section with the 'כסף' region", /<section dir="rtl" lang="he"/.test(d) && d.includes(">כסף</h3>") && /aria-label="Partner — כסף"/.test(d));
    ok("partial coverage: net shown 'לפי הנתונים הרשומים כרגע' with the coverage note first", d.indexOf("data-finance-coverage=\"PARTIAL\"") < d.indexOf("data-finance-summary") && d.includes("לפי הנתונים הרשומים כרגע") && d.includes("הנתונים עדיין חלקיים"));
    check("at most 5 rendered items, no buttons / inputs", [(d.match(/data-finance-item=/g) ?? []).length, (d.match(/<button|<input|<a /g) ?? []).length], [5, 0]);
    ok("66. desktop: summary in a row", /data-finance-summary="true" style="display:flex;flex-direction:row/.test(d));
    ok("67. mobile: summary stacked", /data-finance-summary="true" style="display:flex;flex-direction:column/.test(m));
    const idea: FinanceBriefDto = { ...PRODUCTION_BRIEF, items: [{ family: "REVENUE_OPPORTUNITY", epistemic: "HYPOTHESIS", textHe: "רעיון: אפשר לשקול פנייה." }] };
    ok("hypotheses are visibly tagged", renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={idea} />).includes("רעיון / השערה"));
    const calm: FinanceBriefDto = { ...PRODUCTION_BRIEF, coverage: "RELIABLE", coverageNoteHe: null, items: [], calmHe: CALM_HE };
    ok("calm state renders the calm line", renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={calm} />).includes(CALM_HE));
    check("68. nothing rendered without data (loading / failure → null brief)", renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={null} />), "");
    const SECTION = rd("components/partner/PartnerActionsSection.tsx");
    ok("68. section: GET only, strict parse, failure → null (fail closed)", /fetch\("\/api\/partner\/finance", \{ cache: "no-store", signal \}\)/.test(SECTION) && /parseFinanceBriefResponse\(await res\.json\(\)\)/.test(SECTION) && /if \(!res\.ok\) \{ setFinance\(null\); return; \}/.test(SECTION) && !/\/api\/partner\/finance"[^)]*method/.test(SECTION));
    ok("the brief re-loads with the rest of Partner (one load for all three)", /Promise\.all\(\[loadActions\(signal\), loadOutcomes\(signal\), loadFinance\(signal\)\]\)/.test(SECTION));
    const CARD = rd("components/partner/PartnerActionCard.tsx");
    ok("placement: proposals → כסף → recent outcomes", CARD.indexOf("items.map((it) => <PartnerActionCard") < CARD.indexOf("<PartnerFinanceBrief") && CARD.indexOf("<PartnerFinanceBrief") < CARD.indexOf("<PartnerOutcomesList"));
    ok("finance card is read-only (no hooks / fetch / handlers)", !/useState|useEffect|fetch\(|onClick|<button/.test(strip(rd("components/partner/PartnerFinanceBrief.tsx"))));
    check("money formatting is deterministic", [fmtMoney(2200, "₪"), fmtMoney(1888, "$"), fmtMoney(-300, "₪"), fmtMoney(765.5, "₪")], ["₪2,200", "$1,888", "−₪300", "₪765.50"]);
  }

  const self = fs.readFileSync(__filename, "utf8");
  ok("this test never imports a production binding", !/from\s+["'][^"']*(lib\/supabase|finance\/server|require-auth|vendor-store)["']/.test(self));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
