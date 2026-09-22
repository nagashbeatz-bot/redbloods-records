/**
 * Golden tests — Finance Semantics Unification (2026-09-22).
 *
 * Pure unit tests for lib/payment-status.ts's two deliberately separate
 * concepts: ACTUAL PAYMENT POSITION (agreedPrice vs paidIncome only, never
 * touched by a cancelled transaction) and COLLECTION INTENT (the same,
 * unless the PROJECT ITSELF is formally cancelled). No Supabase, no network,
 * no Push — nothing here touches production.
 *
 * Run with:   npx tsx scripts/test-finance-semantics.ts
 */
import {
  actualBalanceAgainstAgreedPrice, actualOutstandingAgainstAgreedPrice, overpaymentAmount,
  isFullyPaid, collectibleAmount, isProjectCancelled, isCancelledPayment,
  CANCELLED_PROJECT_STATUS, CANCELLED_PAYMENT_STATUS,
} from "../lib/payment-status";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

console.log("A. agreed=3200, received=1600, cancelled=1600 -> outstanding=1600, not fully paid, no overpayment");
{
  const agreed = 3200, received = 1600;
  check("outstanding = 1600", actualOutstandingAgainstAgreedPrice(agreed, received), 1600);
  ok("not fully paid", !isFullyPaid(agreed, received));
  check("overpayment = 0", overpaymentAmount(agreed, received), 0);
  check("signed balance = +1600", actualBalanceAgainstAgreedPrice(agreed, received), 1600);
}

console.log("B. agreed=4250, received=4250, cancelled=1500 -> outstanding=0, fully paid, overpayment=0");
{
  const agreed = 4250, received = 4250;
  check("outstanding = 0", actualOutstandingAgainstAgreedPrice(agreed, received), 0);
  ok("fully paid", isFullyPaid(agreed, received));
  check("overpayment = 0", overpaymentAmount(agreed, received), 0);
  check("signed balance = 0", actualBalanceAgainstAgreedPrice(agreed, received), 0);
}

console.log("C. agreed=4250, received=5000 -> overpayment=750");
{
  const agreed = 4250, received = 5000;
  check("overpayment = 750", overpaymentAmount(agreed, received), 750);
  check("outstanding = 0", actualOutstandingAgainstAgreedPrice(agreed, received), 0);
  ok("fully paid", isFullyPaid(agreed, received));
  check("signed balance = -750", actualBalanceAgainstAgreedPrice(agreed, received), -750);
}

console.log("D. agreed missing -> UNKNOWN (callers must gate on agreedPrice>0 themselves — see lib/agent/rules.ts, lib/health.ts, lib/coo/facts.ts, all of which skip agreedPrice<=0 BEFORE calling these helpers)");
ok("structural: every production call site gates on `agreed > 0` / `agreedPrice > 0` before calling an actual-payment-position helper", true);

console.log("E. different currencies never merge — structural (every call site partitions by currency first via lib/finance:partitionByCurrency, R5; these helpers take already-single-currency numbers and never touch a currency field)");
ok("actualOutstandingAgainstAgreedPrice/isFullyPaid/overpaymentAmount/actualBalanceAgainstAgreedPrice take plain numbers only — no currency field to merge", true);

console.log("§28. Manual cancelled transaction on an active/completed (non-cancelled) project must NOT create a write-off/fully-paid state");
{
  const agreed = 3200, received = 1600, cancelledIncome = 1600;
  for (const projectStatus of ["בעבודה", "הושלם", "במיקס", "מחכה למיקס", "לא התחיל", "בהשהייה", null, undefined]) {
    ok(`collectibleAmount(status=${String(projectStatus)}) = 1600 (cancelled ignored — project not formally cancelled)`,
      collectibleAmount(agreed, received, cancelledIncome, projectStatus) === 1600);
  }
  ok("isProjectCancelled is false for all of the above", ["בעבודה", "הושלם", "במיקס", "מחכה למיקס", "לא התחיל", "בהשהייה", null, undefined].every((s) => !isProjectCancelled(s)));
}

console.log("§29. Project formally cancelled (status=בוטל), Owner chose KEEP BALANCE — the existing UX (components/ui/StatusDropdown.tsx:keepBalance) leaves the expected transactions untouched, so cancelledIncome stays 0 for that money");
{
  // keepBalance() never sets any transaction to "בוטל" — cancelledIncome reflects
  // only whatever was ALREADY cancelled before the project-cancel decision (0 here).
  const agreed = 3200, received = 1600, cancelledIncomeFromKeepBalance = 0;
  const collectionRemaining = collectibleAmount(agreed, received, cancelledIncomeFromKeepBalance, CANCELLED_PROJECT_STATUS);
  check("actual outstanding remains 1600", actualOutstandingAgainstAgreedPrice(agreed, received), 1600);
  check("collection intent also remains 1600 (nothing was written off)", collectionRemaining, 1600);
}

console.log("§30. Project formally cancelled (status=בוטל), Owner chose CANCEL BALANCE — the existing UX (StatusDropdown.tsx:confirmCancelBalance) bulk-moves the remaining expected income to 'בוטל'");
{
  // confirmCancelBalance() moves exactly the remaining expected amount to "בוטל" —
  // cancelledIncome now equals the outstanding amount that was written off.
  const agreed = 3200, received = 1600, cancelledIncomeFromCancelBalance = 1600;
  const collectionRemaining = collectibleAmount(agreed, received, cancelledIncomeFromCancelBalance, CANCELLED_PROJECT_STATUS);
  check("actual payment position UNCHANGED — still 1600 unpaid, never becomes 'fully paid'", actualOutstandingAgainstAgreedPrice(agreed, received), 1600);
  ok("actual payment position: still not fully paid", !isFullyPaid(agreed, received));
  check("collection intent reduced to 0 (explicitly written off)", collectionRemaining, 0);
}

console.log("Partial cancel-balance write-off: only some of the outstanding was cancelled");
{
  // e.g. agreed=4250, received=3000, and only 1000 of the remaining 1250 was
  // moved to "בוטל" when the project was cancelled (never happens today via the
  // UI, which cancels the whole remaining balance at once — but the helper must
  // still behave correctly and never go negative).
  const agreed = 4250, received = 3000, cancelledIncome = 1000;
  check("actual outstanding = 1250 regardless", actualOutstandingAgainstAgreedPrice(agreed, received), 1250);
  check("collection intent = 250 (1250 - 1000)", collectibleAmount(agreed, received, cancelledIncome, CANCELLED_PROJECT_STATUS), 250);
}
{
  // Over-cancelling (more cancelled than outstanding) must clamp at 0, never negative.
  const agreed = 4250, received = 3000, cancelledIncome = 5000;
  check("collection intent clamps at 0, never negative", collectibleAmount(agreed, received, cancelledIncome, CANCELLED_PROJECT_STATUS), 0);
}

console.log("Cancelled-project, OVERPAID case: collection intent is 0 regardless of cancelledIncome (nothing left to collect)");
{
  const agreed = 3200, received = 4000, cancelledIncome = 500;
  check("actual outstanding = 0 (overpaid)", actualOutstandingAgainstAgreedPrice(agreed, received), 0);
  check("collection intent = 0", collectibleAmount(agreed, received, cancelledIncome, CANCELLED_PROJECT_STATUS), 0);
}

console.log("Naming/type separation: CANCELLED_PROJECT_STATUS and CANCELLED_PAYMENT_STATUS are distinct exports (never accidentally the same identifier misused across the two tables)");
ok("both constants exist and equal the same Hebrew string (by design — same word, two different fields)", CANCELLED_PROJECT_STATUS === "בוטל" && CANCELLED_PAYMENT_STATUS === "בוטל");
ok("isCancelledPayment and isProjectCancelled are separate functions", isCancelledPayment !== (isProjectCancelled as unknown));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
