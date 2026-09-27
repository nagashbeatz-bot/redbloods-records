/**
 * D6 — show rehearsals (Owner decision 2026-09-27, FINAL): בוצע counts toward the show split, מתוכנן and בוטל never
 * (whatever the payment). A3 (2026-09-27): the page-load auto-mark (AppShell → /api/sessions/auto-mark) and the project
 * drawer's local auto-mark are RETIRED — opening / reloading the app never writes any session status, so it never
 * changes a show's money. A legacy auto-marked התקיים keeps the pre-D6 rule (counts only if paid) until the Owner confirms it.
 * Run with:   npx tsx scripts/test-sunny-d6-rehearsals.tsx
 */
import fs from "node:fs";
import { computeShowSplit, isRehearsalLegacyAutoMarked, rehearsalCountedAmount } from "../lib/shows-types";
import { stageCard } from "../lib/partner/act/next-step";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); } };

(async () => {
  console.log("The rule (rehearsalCountedAmount)");
  const R = (st: string, pay: string | null) => rehearsalCountedAmount(st, pay, 400);
  ok("1. future planned (unpaid / paid) → 0", R("מתוכנן", null) === 0 && R("מתוכנן", "לא שולם") === 0 && R("מתוכנן", "שולם") === 0);
  ok("2. past planned — even paid — → 0 (the date never counts, only the Owner's בוצע)", R("מתוכנן", "שולם") === 0 && R("מתוכנן", "התקבל") === 0);
  ok("3. completed בוצע → full cost, paid / unpaid / partial", R("בוצע", "שולם") === 400 && R("בוצע", "לא שולם") === 400 && R("בוצע", null) === 400 && R("בוצע", "חלקי") === 400);
  ok("4. cancelled → 0 even if paid", R("בוטל", "שולם") === 0 && R("בוטל", null) === 0);
  ok("5. legacy auto-marked התקיים keeps the pre-D6 rule (paid counts, unpaid not) and is flagged", R("התקיים", "שולם") === 400 && R("התקיים", "לא שולם") === 0 && isRehearsalLegacyAutoMarked("התקיים") && !isRehearsalLegacyAutoMarked("בוצע"));
  ok("6. zero / missing cost never counts", rehearsalCountedAmount("בוצע", "שולם", 0) === 0 && rehearsalCountedAmount("בוצע", "שולם", null) === 0);

  console.log("\nThe show split (computeShowSplit, the app's own rule)");
  const split = (st: string, pay: string | null) => computeShowSplit({ show_price: 3000, dj_fee: 500 }, rehearsalCountedAmount(st, pay, 400));
  ok("7. price 3,000 · DJ 500 · rehearsal 400 בוצע → base 2,100 → artist 1,050 / label 1,050", split("בוצע", "לא שולם").artistFee === 1050 && split("בוצע", "לא שולם").labelProfit === 1050);
  ok("8. the same rehearsal מתוכנן (paid) → base 2,500 → 1,250 / 1,250", split("מתוכנן", "שולם").artistFee === 1250);
  ok("9. cancelled → 1,250 / 1,250", split("בוטל", "שולם").artistFee === 1250);
  const legacy = computeShowSplit({ show_price: 2200, dj_fee: 400 }, rehearsalCountedAmount("התקיים", "שולם", 180));
  ok("10. the production legacy row (2,200 · DJ 400 · 180 paid התקיים) is unchanged: artist 810 — no silent change", legacy.artistFee === 810, legacy);

  console.log("\nPage load never changes a show's money (A3: the auto-mark is retired)");
  const drawer = fs.readFileSync("components/ui/ProjectDrawer.tsx", "utf8");
  const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
  ok("11. the auto-mark route no longer exists", !fs.existsSync("app/api/sessions/auto-mark/route.ts") && !fs.existsSync("app/api/sessions/auto-mark"));
  ok("12. AppShell has no page-load session writer (no auto-mark call)", !/\/api\/sessions\/auto-mark/.test(shell) && !/clientNow/.test(shell));
  ok("13. the project drawer has no local auto-mark (no page-load status PATCH)", !/localAutoMark/.test(drawer) && !/JSON\.stringify\(\{ status: "התקיים" \}\)/.test(drawer));
  ok("14. the drawer no longer PATCHes the project start date on open (the session writer fills it on create)", !/body: JSON\.stringify\(\{ startDate: earliest \}\)/.test(drawer) && /ensureProjectStartDate\(projectId\)/.test(fs.readFileSync("lib/writes/sessions.ts", "utf8")));
  ok("15. no page-load path names the auto-mark any more", !/sessions\/auto-mark/.test(shell + drawer));
  ok("16. a show rehearsal's explicit confirmation from the drawer writes בוצע (its own vocabulary), never התקיים", /חזרה להופעה" \? "בוצע" : "התקיים"/.test(drawer));
  ok("17. AppShell never syncs show / finance on load", !/syncShowFinance|\/api\/shows/.test(shell));
  const sync = fs.readFileSync("lib/shows-finance-sync.ts", "utf8");
  ok("18. the finance sync, the artist ledger and the DJ figure use the same rule (no second rule)", (sync.match(/rehearsalCountedAmount\(/g) ?? []).length >= 2 && /showAgreementSplit\(show, rehearsalCounted\)/.test(sync) && /computeShowSplit\(/.test(fs.readFileSync("lib/label-agreements.ts", "utf8")));

  console.log("\nSunny knows the decision");
  const card = stageCard("REHEARSAL_OPERATIONAL", "התקיים");
  ok("19. Sunny's stage card flags a legacy התקיים for the Owner's confirmation", !!card && card.blockingUnknowns.some((x) => /Owner has not confirmed/.test(x)), card);
  const planned = stageCard("REHEARSAL_OPERATIONAL", "מתוכנן");
  ok("20. and explains that מתוכנן does not count", !!planned?.meaningEn?.includes("does not count"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
