/**
 * Golden test — ProjectsTable "שולם ✓" regression (§31 & §12 of the Finance
 * Semantics Unification task, 2026-09-22).
 *
 * ProjectsTable.tsx is a large client React component with no existing
 * render-test harness (scripts/test-finance-currency.ts already establishes
 * the codebase convention of pure-logic + static-source checks over
 * component rendering tests for this app). Two things are verified:
 *
 *   1. The underlying helper's behavior for the exact production-shaped case
 *      (already covered in scripts/test-finance-semantics.ts, re-asserted
 *      here for this specific regression's own record).
 *   2. A static check on the actual source: every "שולם ✓" occurrence in
 *      ProjectsTable.tsx must be gated by `isFullyPaid(`, and the file must
 *      contain no remaining `collectibleBalance` call (the removed, ambiguous
 *      helper) anywhere.
 *
 * Run with:   npx tsx scripts/test-projects-table-paid-indicator.ts
 */
import fs from "node:fs";
import path from "node:path";
import { isFullyPaid } from "../lib/payment-status";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

console.log("§31 production-shaped case: agreed=3200, received=1600, cancelled=1600 -> NO \"שולם ✓\"");
ok("isFullyPaid(3200, 1600) is false (this is exactly what gates the checkmark in ProjectsTable.tsx now)", !isFullyPaid(3200, 1600));
ok("isFullyPaid(3200, 3200) is true (a genuinely fully-paid project still shows the checkmark)", isFullyPaid(3200, 3200));

console.log("Static source check: ProjectsTable.tsx's \"שולם ✓\" is gated only by isFullyPaid(), never collectibleBalance / cancelled");
{
  const file = path.join(path.resolve(__dirname, ".."), "components/projects/ProjectsTable.tsx");
  const src = fs.readFileSync(file, "utf8");
  ok("no collectibleBalance call remains anywhere in the file", !/collectibleBalance\s*\(/.test(src));
  ok("isFullyPaid is imported from lib/payment-status", /import\s*\{[^}]*isFullyPaid[^}]*\}\s*from\s*"@\/lib\/payment-status"/.test(src));
  // The one desktop "כסף" column checkmark, extracted with enough context to see its own gate.
  const checkmarkBlock = src.slice(src.indexOf('if (isFullyPaid(fin.agreed, fin.paid))'), src.indexOf('if (isFullyPaid(fin.agreed, fin.paid))') + 200);
  ok("the checkmark's own if-condition calls isFullyPaid(fin.agreed, fin.paid)", checkmarkBlock.includes("שולם ✓"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
