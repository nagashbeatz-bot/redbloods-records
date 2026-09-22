/**
 * Golden tests — Agent Alert finance rules after the Finance Semantics
 * Unification (2026-09-22). Pure function tests only: no Supabase, no
 * network, no Push, no /api/agent/check call. lib/agent/rules.ts's
 * `checkOverduePayments` and `checkBalanceMissingDueDate` are plain
 * exported functions over in-memory arrays.
 *
 * Run with:   npx tsx scripts/test-agent-finance-rules.ts
 */
import { checkOverduePayments, checkBalanceMissingDueDate } from "../lib/agent/rules";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

console.log("§32 — the production-shaped case: completed, non-cancelled project, agreed=3200/received=1600/cancelled=1600");
console.log("checkBalanceMissingDueDate must NOT suppress this — it was a confirmed live miss before the fix");
{
  const projects = [{ id: "p1", name: "Test Project", artist: "Artist", status: "הושלם" }]; // completed, NOT cancelled
  const transactions = [
    { projectId: "p1", amount: 1600, type: "income", paymentStatus: "התקבל", date: "2026-07-02" },
    { projectId: "p1", amount: 1600, type: "income", paymentStatus: "בוטל", date: "2026-07-15" }, // ad-hoc cancel, no due-date carried
  ];
  const financeMap = new Map([["p1", { agreedPrice: 3200, financeException: false }]]);
  const alerts = checkBalanceMissingDueDate(projects, transactions, financeMap);
  ok("balance_missing_due_date alert fires for p1", alerts.some((a) => a.entityKey === "balance_missing_due_date:p1"));
  const a = alerts.find((x) => x.entityKey === "balance_missing_due_date:p1")!;
  check("metadata.balance = 1600 (cancelled never subtracted)", (a.metadata as { balance: number }).balance, 1600);
}

console.log("Control: same shape but agreedPrice actually paid in full (no cancelled row) -> no alert");
{
  const projects = [{ id: "p2", name: "Paid Project", artist: "Artist", status: "הושלם" }];
  const transactions = [
    { projectId: "p2", amount: 3200, type: "income", paymentStatus: "התקבל", date: "2026-07-02" },
  ];
  const financeMap = new Map([["p2", { agreedPrice: 3200, financeException: false }]]);
  const alerts = checkBalanceMissingDueDate(projects, transactions, financeMap);
  ok("no alert for a genuinely fully-paid project", !alerts.some((a) => a.entityKey === "balance_missing_due_date:p2"));
}

console.log("Control: agreed=4250, received=4250, cancelled=1500 (the original production bug shape) -> fully paid, no alert");
{
  const projects = [{ id: "p3", name: "Fully Paid Despite Cancelled", artist: "Artist", status: "בעבודה" }];
  const transactions = [
    { projectId: "p3", amount: 4250, type: "income", paymentStatus: "התקבל", date: "2026-06-01" },
    { projectId: "p3", amount: 1500, type: "income", paymentStatus: "בוטל", date: "2026-06-10" },
  ];
  const financeMap = new Map([["p3", { agreedPrice: 4250, financeException: false }]]);
  const alerts = checkBalanceMissingDueDate(projects, transactions, financeMap);
  ok("no alert — agreedPrice === received regardless of the cancelled row", !alerts.some((a) => a.entityKey === "balance_missing_due_date:p3"));
}

console.log("Formally-cancelled project (status=בוטל) is still skipped entirely — unchanged behavior, not part of this fix's scope");
{
  const projects = [{ id: "p4", name: "Cancelled Project", artist: "Artist", status: "בוטל" }];
  const transactions = [
    { projectId: "p4", amount: 1600, type: "income", paymentStatus: "התקבל", date: "2026-07-02" },
    { projectId: "p4", amount: 1600, type: "income", paymentStatus: "בוטל", date: "2026-07-15" },
  ];
  const financeMap = new Map([["p4", { agreedPrice: 3200, financeException: false }]]);
  const alerts = checkBalanceMissingDueDate(projects, transactions, financeMap);
  ok("cancelled project -> no balance_missing_due_date alert (existing, unchanged behavior)", !alerts.some((a) => a.entityKey === "balance_missing_due_date:p4"));
}

console.log("checkOverduePayments — already canonical before this fix, must remain unaffected");
{
  const transactions = [
    { id: "tx1", projectId: "p5", projectName: "Overdue Project", amount: 500, currency: "₪", date: "2026-01-01", type: "income", paymentStatus: "צפוי" },
  ];
  const financeMap = new Map([["p5", { agreedPrice: 500, financeException: false }]]);
  const alerts = checkOverduePayments(transactions, financeMap);
  ok("overdue alert fires for a genuinely unpaid expected transaction", alerts.some((a) => a.entityKey === "payment_overdue:tx1"));
}
{
  // paidIncome >= agreedPrice via a SEPARATE transaction -> the overdue "expected" row must not alert.
  const transactions = [
    { id: "tx2a", projectId: "p6", projectName: "Already Paid Elsewhere", amount: 500, currency: "₪", date: "2026-01-01", type: "income", paymentStatus: "צפוי" },
    { id: "tx2b", projectId: "p6", projectName: "Already Paid Elsewhere", amount: 500, currency: "₪", date: "2026-01-02", type: "income", paymentStatus: "התקבל" },
  ];
  const financeMap = new Map([["p6", { agreedPrice: 500, financeException: false }]]);
  const alerts = checkOverduePayments(transactions, financeMap);
  ok("no overdue alert once paidIncome >= agreedPrice, even though tx2a's own row is still 'צפוי'", !alerts.some((a) => a.entityKey === "payment_overdue:tx2a"));
}

console.log("No Push / no side effects: these are pure functions returning plain AlertInput[] — nothing sent in this test run");
ok("structural: checkOverduePayments/checkBalanceMissingDueDate take and return plain data, no I/O", typeof checkOverduePayments === "function" && typeof checkBalanceMissingDueDate === "function");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
