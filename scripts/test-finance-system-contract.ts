/**
 * Finance System Contract — semantic contract suite (F2.16–F2.18). ZERO runtime behaviour: tests only.
 *
 * Run with:   npx tsx scripts/test-finance-system-contract.ts
 *
 * Pins the canonical Redbloods finance semantics and fails on NEW drift:
 *   - transaction.type is "income" | "expense" (DB values); Hebrew labels are UI-only;
 *   - income received = "שולם" | "התקבל"; expense fully paid = "שולם" ONLY; "חלקי" is never fully paid;
 *     "צפוי" / "לא שולם" / "בוטל" are never realized; an expense marked "התקבל" is invalid data;
 *   - Finance stats, COO and Partner agree on the same rows;
 *   - Partner imports the canonical received helper (never a copy).
 *
 * KNOWN divergences found by the F2.16 audit are pinned EXACTLY below (file → occurrence count). They are
 * REAL BUGS / LEGACY paths awaiting separate Owner approval — this suite documents them and fails if any new
 * occurrence appears (or if a fix lands without updating the pin, so the pin always reflects reality).
 */
import fs from "node:fs";
import path from "node:path";
import { isReceivedStatus, isIncomeTx, isExpenseTx, isCancelledStatus } from "../lib/finance/classify";
import { calcStatsForRows, calcTotalsForRows, type StatsTx } from "../lib/finance/stats";
import { validateTx, EXPENSE_PAID_STATUS } from "../lib/partner/finance/core";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const ROOT = path.resolve(__dirname, "..");
const walk = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []) : [];
const SOURCES = ["app", "components", "lib"].flatMap((d) => walk(path.join(ROOT, d)));
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const countBy = (re: RegExp) => Object.fromEntries(SOURCES.map((f) => [rel(f), (fs.readFileSync(f, "utf8").match(re) ?? []).length] as const).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)));

// ── KNOWN divergences (F2.16 audit, 2026-09-24) — awaiting Owner approval; never "fixed" by this suite ──
/** BUG-A: DB `type` compared to the Hebrew UI label "הוצאה"/"הכנסה" (writers store "expense"/"income"). */
const KNOWN_LOCALIZED_TYPE_COMPARISONS: Record<string, number> = {
  "components/ui/StatusDropdown.tsx": 1,   // LEGACY: accepts both ("income" || "הכנסה") — harmless
  "lib/agent/context-builder.ts": 14,      // REAL (kill-switched: /api/ai/chat)
  "lib/agent/goals.ts": 1,                 // REAL (live via /api/agent/snapshot)
  "lib/agent/rules.ts": 2,                 // REAL (kill-switched: agent/check rules)
  "lib/agent/snapshot.ts": 3,              // REAL (live: /api/agent/snapshot)
  "lib/reports/data.ts": 1,                // LEGACY: accepts both ("הוצאה" || "expense") — harmless
  "lib/reports/weekly.ts": 3,              // REAL (manual /api/reports/weekly only)
};
/** BUG-B: "שולם חלקית" (a status that does not exist) listed as PAID. */
const KNOWN_PARTIAL_AS_PAID: Record<string, number> = {
  "app/api/agent/check/route.ts": 1,
  "lib/agent/goals.ts": 1,
  "lib/agent/rules.ts": 1,
  "lib/finance/classify.ts": 1,            // documentation comment only (classify gives it NO special behaviour)
  "lib/reports/data.ts": 1,
  "lib/reports/templates.ts": 1,
};

function main() {
  console.log("Canonical helpers");
  {
    check("income received = שולם | התקבל only", ["שולם", "התקבל", "חלקי", "שולם חלקית", "צפוי", "לא שולם", "בוטל", "לבדיקה", "", null].map((s) => isReceivedStatus(s as string)), [true, true, false, false, false, false, false, false, false, false]);
    check("cancelled = בוטל", [isCancelledStatus("בוטל"), isCancelledStatus("שולם")], [true, false]);
    check("type is strictly the DB value (Hebrew labels are not types)", [isIncomeTx({ type: "income" }), isIncomeTx({ type: "הכנסה" }), isExpenseTx({ type: "expense" }), isExpenseTx({ type: "הוצאה" })], [true, false, true, false]);
    check("Partner expense-paid status is exactly שולם", EXPENSE_PAID_STATUS, "שולם");
  }

  console.log("Per-row semantics (Partner validateTx)");
  {
    const row = (type: string, status: string) => ({ id: "x", projectId: null, type, date: "2026-09-10", amount: 100, currency: "₪", status, category: null, scope: "general", expenseScope: "כללי", linkedSessionId: null, createdAt: "2026-09-01T00:00:00Z" });
    const r = (type: string, status: string) => { const v = validateTx(row(type, status) as never); return v === null ? "INVALID" : v.received ? "REALIZED" : v.cancelled ? "CANCELLED" : "OPEN"; };
    check("income: שולם/התקבל realized; צפוי/לא שולם open; בוטל cancelled", ["שולם", "התקבל", "צפוי", "לא שולם", "בוטל"].map((s) => r("income", s)), ["REALIZED", "REALIZED", "OPEN", "OPEN", "CANCELLED"]);
    check("expense: שולם realized; חלקי / צפוי / לא שולם open; בוטל cancelled; התקבל INVALID", ["שולם", "חלקי", "צפוי", "לא שולם", "בוטל", "התקבל"].map((s) => r("expense", s)), ["REALIZED", "OPEN", "OPEN", "OPEN", "CANCELLED", "INVALID"]);
    check("a Hebrew type value is never a valid transaction", [r("הוצאה", "שולם"), r("הכנסה", "שולם")], ["INVALID", "INVALID"]);
  }

  console.log("Finance stats ↔ Partner agree on realized money");
  {
    const rows: StatsTx[] = [
      { type: "income", payment_status: "שולם", amount: 100, currency: "₪", scope: "project" } as StatsTx,
      { type: "income", payment_status: "התקבל", amount: 200, currency: "₪", scope: "project" } as StatsTx,
      { type: "income", payment_status: "צפוי", amount: 1000, currency: "₪", scope: "project" } as StatsTx,
      { type: "expense", payment_status: "שולם", amount: 10, currency: "₪", scope: "general" } as StatsTx,
      { type: "expense", payment_status: "חלקי", amount: 20, currency: "₪", scope: "general" } as StatsTx,
      { type: "expense", payment_status: "בוטל", amount: 50, currency: "₪", scope: "general" } as StatsTx,
    ];
    const s = calcStatsForRows(rows), t = calcTotalsForRows(rows);
    check("stats: received 300, expenses paid 10 (חלקי is NOT paid, בוטל never counted)", [s.incomeReceived, s.expensesPaid, t.incomeReceived, t.expensesPaid], [300, 10, 300, 10]);
    const partnerRealized = rows.map((x) => validateTx({ id: "x", projectId: null, type: x.type, date: "2026-09-10", amount: x.amount, currency: x.currency, status: x.payment_status, category: null, scope: x.scope ?? "project", expenseScope: "כללי", linkedSessionId: null, createdAt: "2026-09-01T00:00:00Z" } as never)).filter((v) => v && v.received);
    check("Partner realized: income 300 / expense 10 (same as Finance)", [partnerRealized.filter((v) => v!.type === "income").reduce((m, v) => m + v!.amount, 0), partnerRealized.filter((v) => v!.type === "expense").reduce((m, v) => m + v!.amount, 0)], [300, 10]);
  }

  console.log("Single source of truth (Partner / COO import the canonical helper, never a copy)");
  {
    const core = fs.readFileSync(path.join(ROOT, "lib/partner/finance/core.ts"), "utf8");
    const coo = fs.readFileSync(path.join(ROOT, "lib/coo/facts.ts"), "utf8");
    ok("Partner core imports isReceivedStatus from lib/finance/classify", /import \{[^}]*isReceivedStatus[^}]*\} from "\.\.\/\.\.\/finance\/classify"/.test(core));
    ok("COO imports isReceivedStatus from lib/finance (barrel → classify)", /import \{[^}]*isReceivedStatus[^}]*\} from "\.\.\/finance(\/classify)?"/.test(coo) && /export \* from "\.\/classify"/.test(fs.readFileSync(path.join(ROOT, "lib/finance/index.ts"), "utf8")));
    ok("no Partner finance module compares type to a Hebrew label", walk(path.join(ROOT, "lib/partner")).every((f) => !/"(הוצאה|הכנסה)"/.test(fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))));
  }

  console.log("Drift guards (known divergences pinned; NEW drift fails)");
  {
    const localized = countBy(/(type\s*[!=]==\s*"(הוצאה|הכנסה)"|"type"\s*,\s*"(הוצאה|הכנסה)"|"(הוצאה|הכנסה)"\s*[!=]==\s*[a-z.]*type)/g);
    check("BUG-A: localized `type` comparisons are exactly the known set (awaiting Owner-approved fix)", localized, KNOWN_LOCALIZED_TYPE_COMPARISONS);
    check("BUG-B: 'שולם חלקית' occurrences are exactly the known set (awaiting Owner-approved fix)", countBy(/שולם חלקית/g), KNOWN_PARTIAL_AS_PAID);
    const hebrewTypeWriters = SOURCES.filter((f) => /type:\s*"(הוצאה|הכנסה)"/.test(fs.readFileSync(f, "utf8"))).map(rel);
    check("no writer stores a Hebrew type value", hebrewTypeWriters, []);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
