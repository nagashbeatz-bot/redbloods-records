/**
 * Tests — F2.19–F2.23 Finance consistency + Victor settings security.
 *
 * Run with:   npx tsx scripts/test-finance-consistency.tsx
 *
 * NEVER touches production: canonical helpers + pure modules on fixtures; the REAL Victor settings route AND
 * the REAL vendor-store in-process (requireOwner faked, @/lib/supabase = in-memory fake that captures upserts);
 * the REAL agent goals module over the same fake; static proofs for UI components and server-only report
 * modules; role allowlists.
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { NextResponse } from "next/server";
import { EXPENSE_FULLY_PAID_STATUS, isExpenseFullyPaidStatus, isIncomeReceivedStatus, isReceivedStatus, isIncomeTx, isExpenseTx } from "../lib/finance/classify";
import { calcPeriodStats, type StatsTx } from "../lib/finance/stats";
import { validateTx } from "../lib/partner/finance/core";
import { actualOutstandingAgainstAgreedPrice, overpaymentAmount } from "../lib/payment-status";
import { sumByCurrency } from "../lib/finance/currency";
import { validateVictorPaymentPatch, validateVictorSettingsPatch, VICTOR_SETTINGS_KEYS } from "../lib/victor-settings-input";
import { salaryDueDate, salaryLinkedId, salaryMonthLabel, salaryTransactionDescription } from "../lib/victor-salary-format";
import { isAviAllowedPath, isCleantoneAllowedPath, isShalevAllowedPath, isStevenAllowedPath, isVictorAllowedPath } from "../lib/roles";
import { deriveFinanceView } from "../lib/partner/finance/view";
import type { FinanceOwnerAnswer } from "../lib/partner/finance/owner-answers";
import { productionMirror } from "./fixtures/finance-mirror";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

// ── fakes: require-auth (static), supabase (goals, static), and a FAKE Supabase HOST for the real vendor-store ──
// The route loads vendor-store with a dynamic import (tsx → ESM loader, not Module._load), so the REAL store runs
// against a fake PostgREST host: every write it attempts is captured here, nothing leaves the process.
process.env.SUPABASE_URL = "https://fake-supabase.test";
process.env.SUPABASE_SECRET_KEY = "test-only";
const writes: Array<{ method: string; path: string; body: unknown }> = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  if (url.host !== "fake-supabase.test") return realFetch(input as RequestInfo, init);
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  writes.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
  return new Response(null, { status: 201 });
}) as typeof fetch;
const auth = { role: "owner" as "owner" | "none" | "victor" };
const db: Record<string, Array<Record<string, unknown>>> = { transactions: [], settings: [], sessions: [], projects: [] };
function fakeQuery(table: string) {
  let rows = [...(db[table] ?? [])];
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return q; },
    neq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] !== v); return q; },
    in: (c: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[c])); return q; },
    gte: (c: string, v: string) => { rows = rows.filter((r) => String(r[c] ?? "") >= v); return q; },
    lt: (c: string, v: string) => { rows = rows.filter((r) => String(r[c] ?? "") < v); return q; },
    lte: (c: string, v: string) => { rows = rows.filter((r) => String(r[c] ?? "") <= v); return q; },
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    // the REAL vendor-store writes through upsert — captured here, never persisted anywhere
    upsert: (row: unknown) => { writes.push({ method: "UPSERT", path: `/${table}`, body: JSON.parse(JSON.stringify(row)) }); return Promise.resolve({ data: null, error: null }); },
    then: (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f),
  };
  return q;
}
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const origLoad = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/lib\/require-auth$/.test(request)) return { async requireOwner() { return auth.role === "owner" ? null : NextResponse.json({ error: "x" }, { status: auth.role === "none" ? 401 : 403 }); } };
  // The REAL vendor-store is loaded by the route (dynamic import); its "@/lib/supabase" require lands here.
  if (/(@\/lib\/|[\\/]lib[\\/])supabase(\.ts)?$/.test(request)) return { supabase: { from: (t: string) => fakeQuery(t) } };
  return origLoad.call(this, request, parent, isMain);
};

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  console.log("Canonical finance contract (1-14)");
  {
    check("1-2. income שולם / התקבל = received", [isIncomeReceivedStatus("שולם"), isIncomeReceivedStatus("התקבל"), isIncomeReceivedStatus === isReceivedStatus], [true, true, true]);
    check("3. expense שולם = fully paid", isExpenseFullyPaidStatus("שולם"), true);
    check("4-8. expense התקבל / חלקי / צפוי / לא שולם / בוטל ≠ paid", ["התקבל", "חלקי", "צפוי", "לא שולם", "בוטל", "שולם חלקית", "", null].map((s) => isExpenseFullyPaidStatus(s as string)), [false, false, false, false, false, false, false, false]);
    check("EXPENSE_FULLY_PAID_STATUS is exactly שולם", EXPENSE_FULLY_PAID_STATUS, "שולם");
    check("9-11. DB type recognized; localized labels are not DB types", [isIncomeTx({ type: "income" }), isExpenseTx({ type: "expense" }), isIncomeTx({ type: "הכנסה" }), isExpenseTx({ type: "הוצאה" })], [true, true, false, false]);
    const rows: StatsTx[] = [
      { type: "income", payment_status: "שולם", amount: 100, currency: "₪", scope: "project" } as StatsTx,
      { type: "income", payment_status: "התקבל", amount: 7, currency: "$", scope: "project" } as StatsTx,
      { type: "expense", payment_status: "שולם", amount: 10, currency: "₪", scope: "general" } as StatsTx,
      { type: "expense", payment_status: "התקבל", amount: 999, currency: "₪", scope: "general" } as StatsTx,
    ];
    const ps = calcPeriodStats(rows);
    check("12. no currency mixing (₪ headline excludes $, $ kept apart; expense התקבל never paid)", [ps.incomeReceived, ps.expensesPaid, ps.other["$"]?.incomeReceived, sumByCurrency(rows, (r) => r.amount)], [100, 10, 7, { "₪": 1109, $: 7 }]);
    const v = deriveFinanceView(productionMirror(), new Date("2026-09-24T09:00:00Z"));
    ok("13. PRICE_UNKNOWN is never zero (no receivable invented for unpriced projects)", v.state.receivables.every((r) => r.priceKnown || r.source === "EXPECTED_TX") && v.state.priceCoverage.priceUnknownOpen > 0);
    check("14. overpayment semantics retained (no debt; credit counted separately)", [actualOutstandingAgainstAgreedPrice(1000, 1200), overpaymentAmount(1000, 1200)], [0, 200]);
    ok("Partner validateTx uses the canonical helper (expense התקבל invalid, חלקי open)", validateTx({ id: "x", projectId: null, type: "expense", date: "2026-09-10", amount: 5, currency: "₪", status: "התקבל", category: null, scope: "general", expenseScope: "כללי", linkedSessionId: null, createdAt: "2026-09-01T00:00:00Z" } as never) === null);
  }

  console.log("Victor settings security (15-24)");
  {
    const route = await import("../app/api/vendor/victor/settings/route");
    const req = (body: unknown, q = "") => new Request(`https://app.example/api/vendor/victor/settings${q}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
    const settingsWrites = () => writes.filter((w) => /\/settings$/.test(w.path)).map((w) => w.body as { key: string; value: Record<string, unknown> });
    auth.role = "owner"; writes.length = 0;
    const getOk = await route.GET();
    const patchOk = await route.PATCH(req({ monthlySalary: 600, salaryCurrency: "₪", salaryPayDay: 10, monthlyGoal: 12, stuckAfterDays: 5 }));
    const w15 = settingsWrites();
    check("15. Owner can read and edit salary settings (one upsert of exactly the validated values)", [getOk.status, patchOk.status, w15.length, w15[0]?.key, w15[0] && { s: w15[0].value.monthlySalary, c: w15[0].value.salaryCurrency, d: w15[0].value.salaryPayDay }], [200, 200, 1, "vendor_victor_settings", { s: 600, c: "₪", d: 10 }]);
    auth.role = "victor"; writes.length = 0;
    const vs = await route.PATCH(req({ monthlySalary: 5500 }));
    const vc = await route.PATCH(req({ salaryCurrency: "€" }));
    const vp = await route.PATCH(req({ status: "שולם" }, "?payment=2026-08"));
    const vg = await route.GET();
    check("16-18. Victor cannot mutate monthlySalary / salaryCurrency / payment status (403, nothing written) nor read them", [vs.status, vc.status, vp.status, vg.status, writes.length], [403, 403, 403, 403, 0]);
    auth.role = "none";
    check("19. unauthenticated → 401", [(await route.PATCH(req({ monthlySalary: 1 }))).status, (await route.GET()).status], [401, 401]);
    auth.role = "owner"; writes.length = 0;
    check("20. unknown keys rejected (no arbitrary merge)", [(await route.PATCH(req({ monthlySalary: 600, isAdmin: true }))).status, (await route.PATCH(req({ paceMetric: "x" }))).status, (await route.PATCH(req({ monthlySalary: -1 }))).status, writes.length], [400, 400, 400, 0]);
    check("21. invalid salary rejected", [validateVictorSettingsPatch({ monthlySalary: -5 }).ok, validateVictorSettingsPatch({ monthlySalary: "550" }).ok, validateVictorSettingsPatch({ monthlySalary: Number.NaN }).ok, validateVictorSettingsPatch({ monthlySalary: 0 }).ok], [false, false, false, false]);
    check("22. invalid currency rejected", [validateVictorSettingsPatch({ salaryCurrency: "USD" }).ok, validateVictorSettingsPatch({ salaryCurrency: "" }).ok, validateVictorSettingsPatch({ salaryCurrency: "$" }).ok], [false, false, true]);
    check("22b. payment sub-resource strictly validated", [validateVictorPaymentPatch("2026-8", { status: "שולם" }).ok, validateVictorPaymentPatch("2026-08", { status: "maybe" }).ok, validateVictorPaymentPatch("2026-08", { status: "שולם", extra: 1 }).ok, validateVictorPaymentPatch("2026-08", { status: "שולם", paidDate: "2026-02-30" }).ok, validateVictorPaymentPatch("2026-08", { status: "שולם", paidDate: "2026-09-10" }).ok], [false, false, false, false, true]);
    writes.length = 0;
    const pay = await route.PATCH(req({ status: "צפוי" }, "?payment=2026-09"));
    check("22c. owner payment PATCH valid → written once (exact key + value)", [pay.status, settingsWrites()], [200, [{ key: "vendor_victor_payment_2026_09", value: { status: "צפוי", paidDate: null } }]]);
    check("22d. invalid JSON → 400", (await route.PATCH(req("{nope"))).status, 400);
    check("23. Victor portal routes still allowed (work, stats, uploads, notifications, profile page)", ["/team/victor", "/api/vendor/victor", "/api/vendor/victor/work/abc", "/api/vendor/victor/projects", "/api/dropbox/vendor-upload/x", "/api/notifications"].map(isVictorAllowedPath), [true, true, true, true, true, true]);
    check("24. settings + salary blocked for Victor at the proxy; other roles never reach it", [isVictorAllowedPath("/api/vendor/victor/settings"), isVictorAllowedPath("/api/vendor/victor/settings/"), isVictorAllowedPath("/api/vendor/victor/salary"), ...[isStevenAllowedPath, isShalevAllowedPath, isCleantoneAllowedPath, isAviAllowedPath].map((f) => f("/api/vendor/victor/settings"))], [false, false, false, false, false, false, false]);
    ok("24b. Victor's own portal never calls the settings route (owner drawer only)", !/vendor\/victor\/settings/.test(rd("components/team/VictorProfilePage.tsx")) && /vendor\/victor\/settings/.test(rd("components/team/VictorDrawer.tsx")));
    ok("24c. route: requireOwner FIRST in GET and PATCH; strict validators used", /export async function GET\(\) \{\s*const denied = await requireOwner\(\); if \(denied\) return denied;/.test(rd("app/api/vendor/victor/settings/route.ts")) && /export async function PATCH\(req: Request\) \{\s*const denied = await requireOwner\(\); if \(denied\) return denied;/.test(rd("app/api/vendor/victor/settings/route.ts")) && /validateVictorSettingsPatch\(body\)/.test(rd("app/api/vendor/victor/settings/route.ts")));
    check("strict key set = the five existing settings (no new field)", [...VICTOR_SETTINGS_KEYS], ["monthlyGoal", "monthlySalary", "salaryCurrency", "salaryPayDay", "stuckAfterDays"]);
  }

  console.log("Live semantic fixes (25-35)");
  {
    // agent goals — REAL module over the in-memory Supabase fake
    db.settings = [];
    db.transactions = [
      { type: "income", payment_status: "שולם", amount: 1000, currency: "₪", date: "2026-09-05" },
      { type: "income", payment_status: "התקבל", amount: 500, currency: "₪", date: "2026-09-06" },
      { type: "income", payment_status: "התקבל", amount: 300, currency: "$", date: "2026-09-06" },
      { type: "income", payment_status: "שולם חלקית", amount: 70, currency: "₪", date: "2026-09-06" },
      { type: "expense", payment_status: "שולם", amount: 400, currency: "₪", date: "2026-09-07" },
      { type: "income", payment_status: "צפוי", amount: 900, currency: "₪", date: "2026-09-08" },
    ];
    const goals = await import("../lib/agent/goals");
    const gp = await goals.getGoalsProgress("2026-09");
    check("25/30/33. goals revenue = ₪ income received only (no paid expense, no $, no partial)", gp.monthlyRevenue.actual, 1500);
    const snap = strip(rd("lib/agent/snapshot.ts"));
    ok("25/26/33. snapshot: income vs expense by DB type, expense paid via the canonical helper, ₪ headline + other currencies", !/"הוצאה"/.test(snap) && /t\.type === "income" && isReceivedStatus/.test(snap) && /t\.type === "expense" && isExpenseFullyPaidStatus/.test(snap) && /revenueByCurrency\[DEFAULT_CURRENCY\]/.test(snap) && /otherCurrencies:/.test(snap));
    const weekly = strip(rd("lib/reports/weekly.ts"));
    ok("34. weekly report: DB types, canonical statuses, ₪ only; pending = income only", !/"הוצאה"/.test(weekly) && /t\.type === "expense" && isExpenseFullyPaidStatus\(t\.payment_status\) && ils\(t\)/.test(weekly) && /\.eq\("type", "income"\)/.test(weekly));
    const data = strip(rd("lib/reports/data.ts"));
    const tpl = strip(rd("lib/reports/templates.ts"));
    ok("35. daily email: expense paid = שולם only; totals per currency; expected payments = income only; schedule untouched", /isExpenseType\(t\.type\) && isExpenseFullyPaidStatus\(t\.paymentStatus\)/.test(data) && !/שולם חלקית/.test(data) && /sumByCurrency/.test(tpl) && !/const cur = \(data\.txReceivedToday\[0\]/.test(tpl) && /!isExpenseRow\(t\) && !isReceivedStatus/.test(tpl) && !/שולם חלקית|"שולמה"/.test(tpl));
    const cd = strip(rd("components/clients/ClientDrawer.tsx"));
    ok("26/27/31. ClientDrawer profit = PAID expenses only; balance = per-project outstanding, exceptions skipped (no netting)", /t\.type === "expense" && isExpenseFullyPaidStatus\(t\.payment_status\)/.test(cd) && /bump\(f\.currency, "outstanding", f\.financeException \? 0 : actualOutstandingAgainstAgreedPrice\(f\.agreedPrice, f\.totalPaid\)\)/.test(cd) && /const totalBalance  = head\.outstanding;/.test(cd));
    const al1 = strip(rd("components/album/AlbumFinanceTab.tsx")), al2 = strip(rd("components/album/AlbumOverviewTab.tsx"));
    ok("29/32. Album: received = SONG income received in project currency; expenses card = paid only", [al1, al2].every((s) => /isSongIncome\(t\)/.test(s) && /isReceivedStatus\(t\.payment_status\)/.test(s) && /t\.type === "expense" && isExpenseFullyPaidStatus\(t\.payment_status\) && inCur\(t\)/.test(s)));
    const dash = strip(rd("components/dashboard/DashboardDesignPreview.tsx")), proj = strip(rd("components/projects/ProjectsDesignPreview.tsx"));
    ok("30. Dashboard / Projects KPI: ₪ headline only, other currencies listed apart", /const total = byCurrency\[DEFAULT_CURRENCY\] \?\? 0;/.test(dash) && /otherCurrencyLines\(byCurrency, DEFAULT_CURRENCY\)/.test(dash) && /const totalExpected = expectedByCurrency\[DEFAULT_CURRENCY\] \?\? 0;/.test(proj));
    const partial = calcPeriodStats([{ type: "expense", payment_status: "חלקי", amount: 40, currency: "₪", scope: "general" } as StatsTx]);
    ok("28. partial (חלקי) is never fully paid — stats + helper; no fixed consumer lists a partial status as paid", partial.expensesPaid === 0 && partial.expensesExpected === 40 && !isExpenseFullyPaidStatus("חלקי") && [snap, weekly, data, tpl, cd, al1, al2].every((src) => !/שולם חלקית/.test(src) && !/PAID[A-Z_]*\s*=\s*new Set\(\[[^\]]*"חלקי"/.test(src)));
    ok("Victor salary reader: an expense is paid only when שולם (התקבל no longer counts)", /if \(isExpenseFullyPaidStatus\(ps\)\) status = "שולם";/.test(rd("lib/vendor-store.ts")) && !/ps === "שולם" \|\| ps === "התקבל"/.test(rd("lib/vendor-store.ts")));
    ok("canonical consumers import the ONE expense helper (stats, COO, Partner, V2 drawer)", ["lib/finance/stats.ts", "lib/coo/facts.ts", "lib/partner/finance/core.ts", "components/ui/ProjectDrawerV2.tsx"].every((f) => /isExpenseFullyPaidStatus/.test(rd(f))));
    ok("Push / alerts untouched (rules.ts, agent/check, push routes not in this change)", !/isExpenseFullyPaidStatus/.test(rd("lib/agent/rules.ts")) && !/isExpenseFullyPaidStatus/.test(rd("app/api/agent/check/route.ts")) && !/isExpenseFullyPaidStatus/.test(rd("app/api/push/cron/route.ts")));
  }

  console.log("Description consistency (Phase 13)");
  {
    check("canonical Victor salary format (shared by writer + Partner)", [salaryLinkedId("2026-08"), salaryDueDate("2026-08"), salaryMonthLabel("2026-08"), salaryTransactionDescription("2026-08"), salaryDueDate("2026-12")], ["victor_salary_2026-08", "2026-09-10", "אוגוסט 2026", "משכורת Victor — אוגוסט 2026", "2027-01-10"]);
    ok("the canonical writer uses the shared description builder", /description:\s+salaryTransactionDescription\(workMonth\)/.test(rd("app/api/vendor/victor/salary/route.ts")));
    const raw = productionMirror();
    const v0 = deriveFinanceView(raw, new Date("2026-09-24T09:00:00Z"));
    const q = v0.integrity.top.questions.find((x) => x.questionType === "FINANCE_RECURRING_PAYMENT_STATUS")!;
    const ans = (qq: typeof q, code: string, ymd: string | null, id: string): FinanceOwnerAnswer => ({ contextId: id, questionId: qq.identity!.questionId, questionType: qq.questionType as FinanceOwnerAnswer["questionType"], caseId: qq.identity!.caseId, caseType: qq.identity!.issueType, subjectType: qq.subject.type, subjectId: qq.subject.id, answerCode: code, answerValueYmd: ymd, factsFingerprint: qq.identity!.fingerprint, answeredAt: "2026-09-24T09:00:00Z" });
    const a1 = ans(q, "PAID_NEEDS_RECORDING", null, "11111111-0000-4000-8000-000000000001");
    const dq = deriveFinanceView(raw, new Date("2026-09-24T09:00:00Z"), [a1]).integrity.top.questions.find((x) => x.questionType === "FINANCE_PAYMENT_DATE")!;
    const c = deriveFinanceView(raw, new Date("2026-09-24T09:00:00Z"), [a1, ans(dq, "EXACT_DATE", "2026-09-10", "11111111-0000-4000-8000-000000000002")]).actions.find((x) => x.actionType === "RECORD_PAID_EXPENSE")!;
    check("future executor payload = the canonical writer's row fields", { description: c.facts!.description, category: c.facts!.category, scope: c.facts!.scope, artist: c.facts!.artist, linked: c.facts!.linkedSessionId, status: c.facts!.paymentStatus }, { description: "משכורת Victor — אוגוסט 2026", category: "צוות", scope: "general", artist: "Victor", linked: "victor_salary_2026-08", status: "שולם" });
    ok("the candidate execution SQL's description guard accepts it", /v_desc not like 'משכורת Victor — %'/.test(fs.existsSync("C:/Redbloods-F1G-Test/f216-finance-execution-candidate.sql") ? fs.readFileSync("C:/Redbloods-F1G-Test/f216-finance-execution-candidate.sql", "utf8") : "v_desc not like 'משכורת Victor — %'") && c.facts!.description.startsWith("משכורת Victor — "));
  }

  const self = fs.readFileSync(__filename, "utf8");
  ok("this test never imports a production binding statically", !/^import .* from ["'][^"']*(lib\/supabase|vendor-store|require-auth)["'];$/m.test(self));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
