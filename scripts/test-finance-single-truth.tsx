/**
 * Finance single truth + currencies (B1, Owner-approved integrity fix 2026-09-27).
 *
 * Pure tests — no Supabase, no network, no Push. The settings merge runs on an in-memory fake.
 *   - one status rule (lib/finance/classify.ts): income actual = שולם | התקבל; expense actual = שולם only;
 *     an expense "התקבל" is not paid; חלקי is never fully paid; צפוי / לא שולם / בוטל are not actual;
 *   - isFullyPaid / paymentPosition: agreed ≤ 0 → PRICE_UNKNOWN (never "שולם ✓"); paid ≥ agreed → no debt; > → credit;
 *   - financeException honoured; currencies separate — every aggregation returns per-currency buckets (no FX);
 *   - mergeSettingsKey compare-and-swap retry.
 *
 * Run with:   npx tsx scripts/test-finance-single-truth.tsx
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isFullyPaid, isPriceUnknown, paymentPosition } from "../lib/payment-status";
import { RECEIVED_STATUSES, EXPECTED_STATUSES, isReceivedStatus, isExpectedStatus, isExpenseFullyPaidStatus, isActualMoneyTx } from "../lib/finance/classify";
import { formatTotalsInline, sumByCurrency } from "../lib/finance/currency";
import { calcPeriodTotals } from "../lib/finance/stats";
import { summarizeClipFinance, CLIP_PAID_STATUSES, CLIP_EXPECTED_STATUSES } from "../lib/clip-finance";
import { buildProjectFinanceSummary, projectMoneyBadge, projectCollectible, collectionTotalsByCurrency } from "../lib/finance/project-summary";
import { showExpectedIncome, mergeCurrencyTotals } from "../lib/finance/expected-income";
import { checkOverduePayments, checkBalanceMissingDueDate } from "../lib/agent/rules";
import { RECEIVED_STATUSES as SHOW_RECEIVED_STATUSES, showMoneyOf, SHOW_MONEY_ROLES } from "../lib/shows-types";
import { clipIncomeByCurrency } from "../lib/partner/redfilms/view";
import { mergeSettingsKey, SettingsMergeConflictError, type SettingsMergeClient, type SettingsValue } from "../lib/writes/settings-merge";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const ROOT = path.resolve(__dirname, "..");
const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

async function main() {
  console.log("1. One status rule (lib/finance/classify.ts)");
  {
    const S = ["שולם", "התקבל", "צפוי", "לא שולם", "חלקי", "בוטל", "לבדיקה", "שולם חלקית", "", null];
    check("income received = שולם | התקבל only", S.map((s) => isReceivedStatus(s)), [true, true, false, false, false, false, false, false, false, false]);
    check("expense paid = שולם only (התקבל on an expense is NOT paid)", S.map((s) => isExpenseFullyPaidStatus(s)), [true, false, false, false, false, false, false, false, false, false]);
    check("expected = צפוי | לא שולם | חלקי", S.map((s) => isExpectedStatus(s)), [false, false, true, true, true, false, false, false, false, false]);
    check("isActualMoneyTx: received income / expected income / paid expense / expense התקבל / cancelled",
      [{ type: "income", payment_status: "התקבל" }, { type: "income", payment_status: "צפוי" }, { type: "expense", payment_status: "שולם" }, { type: "expense", payment_status: "התקבל" }, { type: "income", payment_status: "בוטל" }, { type: "expense", payment_status: "חלקי" }].map(isActualMoneyTx),
      [true, false, true, false, false, false]);
    ok("clip-finance / shows-types reuse the classify sets (no second literal)", CLIP_PAID_STATUSES === RECEIVED_STATUSES && CLIP_EXPECTED_STATUSES === EXPECTED_STATUSES && SHOW_RECEIVED_STATUSES === RECEIVED_STATUSES);
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const dupFree = ["lib/clip-finance.ts", "lib/shows-types.ts", "lib/partner/changes/compare.ts", "lib/health.ts", "lib/agent/rules.ts", "lib/agent/goals.ts", "lib/finance/stats.ts",
      "components/clients/ClientDrawer.tsx", "components/dashboard/DashboardDesignPreview.tsx", "components/projects/ProjectsDesignPreview.tsx", "components/projects/ProjectsTable.tsx",
      "components/insights/InsightsPage.tsx", "components/ui/ProjectDrawerV2.tsx", "components/album/AlbumOverviewTab.tsx"]
      .filter((f) => /\[\s*"(שולם|התקבל)"\s*,\s*"(שולם|התקבל)"\s*\]/.test(strip(rd(f))));
    check("no duplicate received literal set outside classify (in the files B1 owns)", dupFree, []);
    const drawer = strip(rd("components/ui/ProjectDrawer.tsx")).split("\n");
    const drawerDup = drawer.map((l, i) => ({ l, i: i + 1 })).filter(({ l, i }) => (i < 5100 || i > 5600) && /\[\s*"(שולם|התקבל)"\s*,\s*"(שולם|התקבל)"\s*\]/.test(l)).map(({ i }) => i);
    check("ProjectDrawer (outside the sound-engineer section): no received literal set", drawerDup, []);
  }

  console.log("2. Payment position: unknown price / unpaid / partial / paid / overpaid");
  {
    check("isFullyPaid(0, 0) / (0, 500) — no price is never paid", [isFullyPaid(0, 0), isFullyPaid(0, 500), isFullyPaid(-1, 5)], [false, false, false]);
    check("isFullyPaid partial / exact / over", [isFullyPaid(3200, 1600), isFullyPaid(3200, 3200), isFullyPaid(3200, 4000)], [false, true, true]);
    check("isPriceUnknown", [isPriceUnknown(0), isPriceUnknown(null), isPriceUnknown(undefined), isPriceUnknown(100)], [true, true, true, false]);
    check("paymentPosition", [paymentPosition(0, 0), paymentPosition(null, 700), paymentPosition(1000, 0), paymentPosition(1000, 400), paymentPosition(1000, 1000), paymentPosition(1000, 1200)],
      ["PRICE_UNKNOWN", "PRICE_UNKNOWN", "UNPAID", "PARTIAL", "PAID", "OVERPAID"]);
  }

  console.log("3. Project finance summary (Projects table / dashboards): song income, own currency, exception, PRICE_UNKNOWN");
  {
    const settings = [
      { project_id: "a", agreedPrice: 3000, currency: "₪" },
      { project_id: "b", agreedPrice: 1000, currency: "$" },
      { project_id: "c", agreedPrice: 0, currency: "₪" },
      { project_id: "d", agreedPrice: 2000, currency: "₪", financeException: true },
      { project_id: "e", agreedPrice: 500, currency: null },
    ];
    const txs = [
      { project_id: "a", type: "income", payment_status: "התקבל", amount: 1000, currency: "₪" },
      { project_id: "a", type: "income", payment_status: "שולם", amount: 500, currency: null },            // blank currency = ₪
      { project_id: "a", type: "income", payment_status: "חלקי", amount: 700, currency: "₪" },               // partial = not received
      { project_id: "a", type: "income", payment_status: "צפוי", amount: 800, currency: "₪" },
      { project_id: "a", type: "income", payment_status: "בוטל", amount: 300, currency: "₪" },
      { project_id: "a", type: "income", payment_status: "התקבל", amount: 999, currency: "$" },              // other currency: never compared
      { project_id: "a", type: "income", payment_status: "התקבל", amount: 400, currency: "₪", expense_scope: "קליפ" }, // clip: its own deal
      { project_id: "a", type: "expense", payment_status: "שולם", amount: 50, currency: "₪" },
      { project_id: "b", type: "income", payment_status: "התקבל", amount: 1200, currency: "$" },             // overpaid
      { project_id: "c", type: "income", payment_status: "התקבל", amount: 700, currency: "₪" },              // no price
      { project_id: "d", type: "income", payment_status: "צפוי", amount: 2000, currency: "₪" },
      { project_id: "e", type: "income", payment_status: "התקבל", amount: 500, currency: "" },
    ];
    const m = buildProjectFinanceSummary(settings, txs);
    check("a: paid 1500 ₪ (received only, own currency, no clip), cancelled 300", [m.a.paid, m.a.cancelled, m.a.currency], [1500, 300, "₪"]);
    check("badges: a balance / b overpaid / c price unknown / d exception / e paid (blank currency = ₪)",
      ["a", "b", "c", "d", "e"].map((k) => projectMoneyBadge(m[k])),
      [{ kind: "BALANCE", balance: 1500, currency: "₪" }, { kind: "OVERPAID", credit: 200, currency: "$" }, { kind: "PRICE_UNKNOWN", received: 700, currency: "₪" }, { kind: "EXCEPTION" }, { kind: "PAID", currency: "₪" }]);
    ok("PRICE_UNKNOWN is never 'paid'", projectMoneyBadge(m.c).kind !== "PAID" && !isFullyPaid(m.c.agreed, m.c.paid));
    check("collectible: exception / unknown price → 0", [projectCollectible(m.d, "בעבודה"), projectCollectible(m.c, "בעבודה"), projectCollectible(m.a, "בעבודה")], [0, 0, 1500]);
    const status = new Map<string, string>([["a", "בעבודה"], ["b", "בעבודה"], ["c", "בעבודה"], ["d", "בעבודה"], ["e", "הושלם"]]);
    check("collection totals are per currency, exception excluded, overpaid never offsets", collectionTotalsByCurrency(m, status), { "₪": 1500 });
    const m2 = buildProjectFinanceSummary([{ project_id: "x", agreedPrice: 1000, currency: "$" }, { project_id: "y", agreedPrice: 3000, currency: "₪" }], []);
    check("mixed currencies → separate buckets, never summed", collectionTotalsByCurrency(m2, new Map([["x", "בעבודה"], ["y", "בעבודה"]])), { "$": 1000, "₪": 3000 });
    check("formatTotalsInline shows each currency apart (₪ first)", formatTotalsInline({ "$": 1000, "₪": 3000, "€": 0 }, (a, c) => `${c}${a}`), "₪3000 · $1000");
    check("formatTotalsInline on an empty map", formatTotalsInline({}, (a, c) => `${c}${a}`), "₪0");
  }

  console.log("4. Clip deal: deal currency is required; other currencies reported apart");
  {
    const rows = [
      { type: "income", amount: 1500, payment_status: "התקבל", expense_scope: "קליפ", currency: "₪" },
      { type: "income", amount: 2000, payment_status: "צפוי", expense_scope: "קליפ", currency: null },
      { type: "income", amount: 300, payment_status: "חלקי", expense_scope: "קליפ", currency: "₪" },
      { type: "income", amount: 400, payment_status: "התקבל", expense_scope: "קליפ", currency: "$" },
      { type: "income", amount: 100, payment_status: "צפוי", expense_scope: "קליפ", currency: "$" },
      { type: "income", amount: 9999, payment_status: "התקבל", expense_scope: null, currency: "₪" },   // song income, not clip
    ];
    const s = summarizeClipFinance(rows, 3500, "₪");
    check("₪ deal: paid / expected / remaining / status", [s.currency, s.paid, s.expected, s.remaining, s.credit, s.status, s.count, s.paidCount], ["₪", 1500, 2300, 2000, 0, "חלקי", 3, 1]);
    check("$ rows never added into the ₪ deal", s.otherCurrency, { "$": { paid: 400, expected: 100, count: 2 } });
    const sd = summarizeClipFinance(rows, 400, "$");
    check("$ deal: only $ rows count; paid in full", [sd.paid, sd.expected, sd.remaining, sd.status, Object.keys(sd.otherCurrency)], [400, 100, 0, "שולם", ["₪"]]);
    const over = summarizeClipFinance([{ type: "income", amount: 600, payment_status: "שולם", expense_scope: "קליפ", currency: "₪" }], 500, null);
    check("overpaid clip → credit (null deal currency = ₪)", [over.currency, over.credit, over.remaining, over.status], ["₪", 100, 0, "יתרת זכות"]);
    check("Sunny clipIncome per currency (deal + stray rows)", clipIncomeByCurrency([{ clipDeal: { ...s, price: 3500 } }, { clipDeal: { ...over, price: 500 } }, { clipDeal: { ...summarizeClipFinance([{ type: "income", amount: 250, payment_status: "התקבל", expense_scope: "קליפ", currency: "$" }], 400, "$"), price: 400 } }]), { "₪": { price: 4000, received: 2100, expected: 2300 }, "$": { price: 400, received: 650, expected: 100 } });
  }

  console.log("5. Dashboard expected income: shows (Finance rows) per currency + project balances merged per currency");
  {
    const txs = [
      { id: "1", type: "income", payment_status: "צפוי", category: "הופעה", amount: 2000, currency: "₪", description: "הופעה א" },
      { id: "2", type: "income", payment_status: "צפוי", show_id: "s2", amount: 500, currency: "$" },
      { id: "3", type: "income", payment_status: "התקבל", show_id: "s3", amount: 900, currency: "₪" },   // received: not expected
      { id: "4", type: "income", payment_status: "בוטל", category: "הופעה", amount: 900, currency: "₪" },  // cancelled
      { id: "5", type: "expense", payment_status: "צפוי", show_id: "s2", amount: 300, currency: "₪" },     // DJ fee expense: never income
      { id: "6", type: "income", payment_status: "צפוי", amount: 700, currency: "₪" },                     // not a show row
    ];
    const r = showExpectedIncome(txs);
    check("show items (id, currency)", r.items.map((i) => [i.id, i.currency, i.amount]), [["1", "₪", 2000], ["2", "$", 500]]);
    check("show totals per currency", r.totals, { "₪": 2000, "$": 500 });
    check("merge with project balances — per bucket, never across", mergeCurrencyTotals({ "₪": 1500 }, r.totals, null), { "₪": 3500, "$": 500 });
  }

  console.log("6. Period stats: $ never added into ₪; expense התקבל is not a paid expense");
  {
    const t = calcPeriodTotals([
      { type: "income", payment_status: "התקבל", amount: 1000, currency: "₪" },
      { type: "income", payment_status: "שולם", amount: 300, currency: "$" },
      { type: "expense", payment_status: "שולם", amount: 200, currency: "₪" },
      { type: "expense", payment_status: "התקבל", amount: 999, currency: "₪" },
    ]);
    check("₪ headline", [t.incomeReceived, t.expensesPaid], [1000, 200]);
    check("$ apart", [t.other["$"]?.incomeReceived], [300]);
    check("sumByCurrency never mixes", sumByCurrency([{ currency: "₪", a: 1 }, { currency: "$", a: 2 }, { currency: null, a: 3 }], (x) => x.a), { "₪": 4, "$": 2 });
  }

  console.log("7. Agent rules (disabled — read parity): per currency, real currency in the text, unknown price never 'paid'");
  {
    const fm = new Map([["p1", { agreedPrice: 1000, currency: "$" }], ["p2", { agreedPrice: 0 }], ["p3", { agreedPrice: 500, financeException: true }]]);
    const overdue = checkOverduePayments([
      { id: "t1", projectId: "p1", projectName: "A", amount: 300, currency: "$", date: "2026-01-01", type: "income", paymentStatus: "צפוי" },
      { id: "t2", projectId: "p2", projectName: "B", amount: 200, currency: "₪", date: "2026-01-01", type: "income", paymentStatus: "צפוי" },
      { id: "t3", projectId: "p1", projectName: "A", amount: 5000, currency: "₪", date: "2026-01-01", type: "income", paymentStatus: "התקבל" }, // ₪ income never pays a $ price
      { id: "t4", projectId: "p3", projectName: "C", amount: 100, currency: "₪", date: "2026-01-01", type: "income", paymentStatus: "צפוי" },  // exception
      { id: "t5", projectId: "p1", projectName: "A", amount: 70, currency: "₪", date: "2026-01-01", type: "expense", paymentStatus: "צפוי" },  // expense is never overdue income
    ], fm);
    check("overdue: 2 rows, totals per currency, text shows both", [overdue.length, (overdue[0]?.metadata as { totalsByCurrency?: unknown })?.totalsByCurrency, /300\$/.test(overdue[0]?.message ?? "") && /200₪/.test(overdue[0]?.message ?? "")], [1, { "$": 300, "₪": 200 }, true]);
    const bal = checkBalanceMissingDueDate([{ id: "p1", name: "A", artist: "", status: "בעבודה" }], [{ projectId: "p1", amount: 400, type: "income", paymentStatus: "התקבל", date: null, currency: "$" }], fm);
    check("balance alert in the project currency", [bal.length, (bal[0]?.metadata as { balance?: number })?.balance, /600\$/.test(bal[0]?.message ?? "")], [1, 600, true]);
  }

  console.log("8. Shows: showMoneyOf still uses the one received rule");
  {
    const m = showMoneyOf({ show_price: 1000, currency: "$" }, [
      { id: "a", role: SHOW_MONEY_ROLES.PAYMENT, status: "התקבל", amount: 600, currency: "$" },
      { id: "b", role: SHOW_MONEY_ROLES.PAYMENT, status: "חלקי", amount: 100, currency: "$" },
      { id: "c", role: SHOW_MONEY_ROLES.PAYMENT, status: "שולם", amount: 50, currency: "₪" },
    ]);
    check("received / remaining / other currency", [m.received, m.remaining, m.otherCurrencyPayments.map((r) => r.id)], [600, 400, ["c"]]);
  }

  console.log("9. Settings merge: compare-and-swap with retry");
  {
    type Row = { value: SettingsValue };
    const fake = (store: Map<string, Row>, hooks: { beforeUpdate?: (n: number) => void; beforeInsert?: (n: number) => void } = {}) => {
      let updates = 0, inserts = 0;
      const client: SettingsMergeClient = {
        from: () => ({
          select: () => ({ eq: (_c: string, k: string) => ({ maybeSingle: async () => ({ data: store.has(k) ? { value: JSON.parse(JSON.stringify(store.get(k)!.value)) } : null, error: null }) }) }),
          insert: async (row) => { hooks.beforeInsert?.(++inserts); if (store.has(row.key)) return { error: { code: "23505", message: "duplicate key" } }; store.set(row.key, { value: row.value }); return { error: null }; },
          update: (row) => ({ eq: (_c: string, k: string) => ({ eq: (_c2: string, expected: string) => ({ select: async () => {
            hooks.beforeUpdate?.(++updates);
            const cur = store.get(k);
            if (!cur || JSON.stringify(cur.value) !== expected) return { data: [], error: null };
            store.set(k, { value: row.value }); return { data: [{ key: k }], error: null };
          } }) }) }),
        }),
      };
      return { client, counts: () => ({ updates, inserts }) };
    };
    const s1 = new Map<string, Row>([["finance_p", { value: { agreedPrice: 3000, currency: "₪" } }]]);
    const f1 = fake(s1);
    await mergeSettingsKey("finance_p", { clipAgreedPrice: 1200 }, 3, f1.client);
    check("merge keeps the other fields", s1.get("finance_p")!.value, { agreedPrice: 3000, currency: "₪", clipAgreedPrice: 1200 });
    const s2 = new Map<string, Row>([["finance_p", { value: { agreedPrice: 3000 } }]]);
    const f2 = fake(s2, { beforeUpdate: (n) => { if (n === 1) s2.set("finance_p", { value: { agreedPrice: 3000, financialNotes: "concurrent" } }); } });
    await mergeSettingsKey("finance_p", { clipProductionId: "rf1" }, 3, f2.client);
    check("a concurrent write is detected and kept (retry on a fresh read)", [s2.get("finance_p")!.value, f2.counts().updates], [{ agreedPrice: 3000, financialNotes: "concurrent", clipProductionId: "rf1" }, 2]);
    const s3 = new Map<string, Row>();
    const f3 = fake(s3, { beforeInsert: (n) => { if (n === 1) s3.set("finance_q", { value: { agreedPrice: 10 } }); } });
    await mergeSettingsKey("finance_q", { clipAgreedPrice: 5 }, 3, f3.client);
    check("insert race (23505) → retry → merge into the row the other writer created", s3.get("finance_q")!.value, { agreedPrice: 10, clipAgreedPrice: 5 });
    const s4 = new Map<string, Row>([["finance_r", { value: { n: 0 } }]]);
    let bump = 0;
    const f4 = fake(s4, { beforeUpdate: () => { s4.set("finance_r", { value: { n: ++bump } }); } });
    let err: unknown = null;
    try { await mergeSettingsKey("finance_r", { x: 1 }, 3, f4.client); } catch (e) { err = e; }
    ok("gives up after the retries with a conflict error (nothing half-written)", err instanceof SettingsMergeConflictError && f4.counts().updates === 3 && !("x" in s4.get("finance_r")!.value));
    ok("clip writers use the merge (no blind read-modify-write upsert of finance_<id>)",
      /mergeSettingsKey\(`finance_\$\{projectId\}`, \{ clipAgreedPrice: price \}\)/.test(rd("lib/writes/clip.ts")) && /mergeSettingsKey\(`finance_\$\{projectId\}`, \{ clipProductionId: productionId \}\)/.test(rd("lib/clip-production.ts")));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
