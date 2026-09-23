/**
 * Tests — Finance expense-semantics fix (Owner GO after the F2.5 Phase 0 audit).
 *
 * Run with:   npx tsx scripts/test-partner-expense-semantics.ts
 *
 * Authoritative rule:
 *   INCOME received      = "שולם" | "התקבל"
 *   EXPENSE fully paid   = "שולם" ONLY
 *   an expense marked "התקבל" is never a paid expense and NEVER money received.
 * Pure: in-memory snapshots / state / finance fixtures. Never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { comparePartnerChangeSnapshots } from "../lib/partner/changes/compare";
import { CHANGE_SNAPSHOT_SCHEMA_VERSION, type PartnerChangeSnapshot, type PartnerChange, type TransactionSnapshotEntity } from "../lib/partner/changes/types";
import { detectChangeDerivedCases } from "../lib/partner/cases/detectors/changeDerived";
import type { PartnerCompanyState } from "../lib/partner/eyes/types";
import { buildFinanceBrain, EXPENSE_PAID_STATUS, isInvalidExpenseStatus } from "../lib/partner/finance/core";
import type { FinanceRaw, FinanceTxRow } from "../lib/partner/finance/types";
import { calcTotalsForRows } from "../lib/finance/stats";
import { isReceivedStatus } from "../lib/finance/classify";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

// ── change-engine fixtures ──
function blankSnapshot(capturedAt: string): PartnerChangeSnapshot {
  const empty = { status: "UNAVAILABLE" as const, coverage: "NONE" as const, scopeDescription: "x", entities: {} };
  return {
    schemaVersion: CHANGE_SNAPSHOT_SCHEMA_VERSION, capturedAt,
    projects: empty, clients: empty, proposals: empty, transactions: empty, tasks: empty, releases: empty,
    sessions: empty, shows: empty, victor: empty, steven: empty, clips: empty, labelArtists: empty,
    balanceLedger: empty, projectFinanceSettings: empty,
  };
}
const txEntity = (id: string, type: string, status: string): TransactionSnapshotEntity => ({ id, projectId: "p1", type, amount: 1100, currency: "₪", status, dateYmd: "2026-09-11", expenseScope: "הופעה", category: "" });
function transition(type: string, from: string, to: string, prevType = type): PartnerChange[] {
  const prev = blankSnapshot("2026-09-22T06:00:00Z");
  const curr = blankSnapshot("2026-09-24T06:00:00Z");
  prev.transactions = { status: "AVAILABLE", coverage: "FULL", scopeDescription: "all transactions", entities: { tx1: txEntity("tx1", prevType, from) } };
  curr.transactions = { status: "AVAILABLE", coverage: "FULL", scopeDescription: "all transactions", entities: { tx1: txEntity("tx1", type, to) } };
  return comparePartnerChangeSnapshots(prev, curr).changes;
}
const received = (changes: PartnerChange[]) => changes.filter((c) => c.field === "receivedSemantic");
const statusChanged = (changes: PartnerChange[]) => changes.some((c) => c.domain === "transactions" && c.field === "status");

// ── case-detector fixtures ──
const stateWith = (items: Array<{ id: string; type: string }>) => ({
  domains: {
    transactions: { data: { items: items.map((t) => ({ ...t, projectId: "p1", amount: 1100, currency: "₪", status: "שולם", dateYmd: "2026-09-11", expenseScope: null, category: "", createdAt: null })) } },
    shows: { data: { items: [] } }, proposalsFull: { data: { items: [] } }, releasesFull: { data: { items: [] } },
  },
}) as unknown as PartnerCompanyState;
const receivedFact = (entityId: string): PartnerChange => ({ id: `transactions:transaction:${entityId}:STATUS_CHANGED:receivedSemantic`, domain: "transactions", entityType: "transaction", entityId, kind: "STATUS_CHANGED", field: "receivedSemantic", before: "NOT_RECEIVED", after: "RECEIVED", observedBetween: { from: "2026-09-22T06:00:00Z", to: "2026-09-24T06:00:00Z" }, sourceOccurredAt: null, epistemicType: "DERIVED", evidence: [] });
const moneyReceived = (state: PartnerCompanyState, changes: PartnerChange[]) => detectChangeDerivedCases(state, changes, null).filter((c) => c.caseType === "MONEY_RECEIVED").map((c) => c.subjectId);

// ── finance fixtures ──
let n = 0;
const tx = (o: Partial<FinanceTxRow>): FinanceTxRow => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, projectId: null, type: "expense", date: "2026-09-10", amount: 100, currency: "₪", status: "שולם", category: null, scope: "general", expenseScope: "כללי", linkedSessionId: null, createdAt: "2026-09-01T00:00:00Z", ...o });
const raw = (transactions: FinanceTxRow[]): FinanceRaw => ({ transactions, projects: [], financeSettings: [], engineerWorks: [], shows: [], proposals: [], clients: [], labelArtists: [], ledger: [], mediaIncome: [], redFilmsPayments: [], victorSalary: [] });
const NOW = new Date("2026-09-24T09:00:00Z");

console.log("Change engine: receivedSemantic is income-only (1-4)");
{
  check("1. income צפוי → שולם produces receivedSemantic RECEIVED", received(transition("income", "צפוי", "שולם")).map((c) => [c.before, c.after, c.epistemicType]), [["NOT_RECEIVED", "RECEIVED", "DERIVED"]]);
  check("2. income צפוי → התקבל produces receivedSemantic RECEIVED", received(transition("income", "צפוי", "התקבל")).map((c) => c.after), ["RECEIVED"]);
  check("income התקבל → צפוי still produces the reverse (NOT_RECEIVED)", received(transition("income", "התקבל", "צפוי")).map((c) => c.after), ["NOT_RECEIVED"]);
  const e1 = transition("expense", "צפוי", "שולם");
  check("3. expense צפוי → שולם produces NO receivedSemantic (structural status change still reported)", [received(e1).length, statusChanged(e1)], [0, true]);
  const e2 = transition("expense", "לא שולם", "התקבל");
  check("4. expense לא שולם → התקבל produces NO receivedSemantic", [received(e2).length, statusChanged(e2)], [0, true]);
  check("4. expense שולם → התקבל / התקבל → צפוי: never receivedSemantic", [received(transition("expense", "שולם", "התקבל")).length, received(transition("expense", "התקבל", "צפוי")).length], [0, 0]);
  check("a type flip between snapshots (expense → income) never yields receivedSemantic on that crossing", received(transition("income", "צפוי", "שולם", "expense")).length, 0);
  check("…nor income → expense", received(transition("expense", "צפוי", "שולם", "income")).length, 0);
}

console.log("Case detector: MONEY_RECEIVED only for income (5-7) — defence in depth");
{
  check("5. an (overly broad) RECEIVED fact on an expense שולם creates NO MONEY_RECEIVED", moneyReceived(stateWith([{ id: "exp1", type: "expense" }]), [receivedFact("exp1")]), []);
  check("6. an expense התקבל fact creates NO MONEY_RECEIVED", moneyReceived(stateWith([{ id: "exp2", type: "expense" }]), [receivedFact("exp2")]), []);
  check("7. an income received transition still creates MONEY_RECEIVED", moneyReceived(stateWith([{ id: "inc1", type: "income" }]), [receivedFact("inc1")]), ["inc1"]);
  check("a transaction whose type cannot be confirmed (not in state) fails closed → no MONEY_RECEIVED", moneyReceived(stateWith([]), [receivedFact("ghost")]), []);
  check("end-to-end: expense paid → no fact → no case; income received → fact → case", [
    moneyReceived(stateWith([{ id: "tx1", type: "expense" }]), transition("expense", "צפוי", "שולם")),
    moneyReceived(stateWith([{ id: "tx1", type: "income" }]), transition("income", "צפוי", "התקבל")),
  ], [[], ["tx1"]]);
}

console.log("Finance Brain: expense paid = שולם only (8-14)");
{
  const s = buildFinanceBrain(raw([
    tx({ status: "שולם", amount: 300 }), tx({ status: "התקבל", amount: 7000 }), tx({ status: "חלקי", amount: 50 }),
    tx({ status: "צפוי", amount: 40 }), tx({ status: "לא שולם", amount: 30 }), tx({ status: "בוטל", amount: 20 }),
    tx({ type: "income", status: "שולם", amount: 1000 }), tx({ type: "income", status: "התקבל", amount: 500 }),
  ]), NOW);
  check("8. expense שולם counts as realized cash-out", s.realized.ils.cashOut, 300);
  ok("9. expense התקבל does NOT count as realized cash-out", s.realized.ils.cashOut === 300);
  check("9. …and is flagged through the existing data-quality mechanism (fails closed)", s.signals.find((x) => x.code === "MALFORMED_RECORDS")?.evidence.map((e) => [e.reasonCode, e.status]), [["EXPENSE_WITH_INCOME_ONLY_STATUS", "התקבל"]]);
  ok("9. …never an open expense and never income", !s.openExpenses.items.some((e) => e.amount === 7000) && s.realized.ils.cashIn === 1500 && !s.receivables.some((r) => r.amount === 7000));
  const open = s.openExpenses.items.map((e) => e.amount).sort((a, b) => a - b);
  check("10-12. expense חלקי / צפוי / לא שולם are not paid (open instead)", open, [30, 40, 50]);
  ok("13. expense בוטל is neither paid nor open", !open.includes(20) && s.realized.ils.cashOut === 300);
  check("income שולם + התקבל still count as received (income semantics unchanged)", s.realized.ils.cashIn, 1500);
  const bad = buildFinanceBrain(raw([tx({ status: "משהו", amount: 10 }), tx({ status: null, amount: 11 }), tx({ type: "expense", status: "התקבל", amount: 12 })]), NOW);
  check("14. unknown / null expense statuses are never paid (fail closed → open, no cash-out)", [bad.realized.byCurrency, bad.openExpenses.items.map((e) => e.amount).sort((a, b) => a - b)], [{}, [10, 11]]);
  check("the Finance Brain agrees with the canonical Insights formula on paid expenses (same rows)", buildFinanceBrain(raw([tx({ status: "שולם", amount: 300 }), tx({ status: "חלקי", amount: 50 })]), NOW).realized.ils.cashOut, calcTotalsForRows([{ type: "expense", payment_status: "שולם", amount: 300 }, { type: "expense", payment_status: "חלקי", amount: 50 }]).expensesPaid);
  check("canonical constants", [EXPENSE_PAID_STATUS, isInvalidExpenseStatus("expense", "התקבל"), isInvalidExpenseStatus("income", "התקבל"), isInvalidExpenseStatus("expense", "שולם")], ["שולם", true, false, false]);
  check("isReceivedStatus (canonical income helper) is unchanged", [isReceivedStatus("שולם"), isReceivedStatus("התקבל"), isReceivedStatus("צפוי"), isReceivedStatus("בוטל")], [true, true, false, false]);
}

console.log("Static boundaries");
{
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  ok("compare.ts gates receivedSemantic on income in BOTH snapshots", /if \(p\.type !== "income" \|\| c\.type !== "income"\) continue;/.test(rd("lib/partner/changes/compare.ts")));
  ok("changeDerived.ts gates MONEY_RECEIVED on a confirmed income transaction", /if \(txTypeById\.get\(c\.entityId\) !== "income"\) continue;/.test(rd("lib/partner/cases/detectors/changeDerived.ts")));
  ok("Finance Brain never applies isReceivedStatus to expenses", /const received = row\.type === "income" \? isReceivedStatus\(row\.status\) : row\.status === EXPENSE_PAID_STATUS;/.test(rd("lib/partner/finance/core.ts")));
  ok("lib/finance/classify.ts isReceivedStatus untouched (still שולם|התקבל via CLIP_PAID_STATUSES)", /export const RECEIVED_STATUSES: readonly string\[\] = CLIP_PAID_STATUSES;/.test(rd("lib/finance/classify.ts")) && /CLIP_PAID_STATUSES = \["שולם", "התקבל"\] as const;/.test(rd("lib/clip-finance.ts")));
  ok("no writes in the changed modules", ["lib/partner/changes/compare.ts", "lib/partner/cases/detectors/changeDerived.ts", "lib/partner/finance/core.ts"].every((f) => !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|lib\/supabase/.test(strip(rd(f)))));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
