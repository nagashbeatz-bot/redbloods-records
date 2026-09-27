/**
 * D6 — show rehearsals (Owner decision 2026-09-27, FINAL): בוצע counts toward the show split, מתוכנן and בוטל never
 * (whatever the payment); the page-load auto-mark (AppShell → /api/sessions/auto-mark) and the project drawer's local
 * auto-mark never touch a show rehearsal, so opening / reloading the app never changes a show's money. A legacy
 * auto-marked התקיים keeps the pre-D6 rule (counts only if paid) until the Owner confirms it.
 * The real auto-mark route runs on a stubbed database. Run with:   npx tsx scripts/test-sunny-d6-rehearsals.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import { NextRequest } from "next/server";
import { computeShowSplit, isRehearsalLegacyAutoMarked, rehearsalCountedAmount } from "../lib/shows-types";
import { stageCard } from "../lib/partner/act/next-step";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); } };

type Row = { id: string; date: string; end_time: string; status: string; session_type: string | null; show_id: string | null };
let rows: Row[] = [];
const updates: string[][] = [];
const fakeSupabase = {
  from(t: string) {
    if (t !== "sessions") throw new Error(`unexpected table ${t}`);
    const f: Array<(r: Row) => boolean> = [];
    const q = {
      select() { return q; },
      eq(c: keyof Row, v: unknown) { f.push((r) => r[c] === v); return q; },
      not(c: keyof Row, _op: string, _v: null) { f.push((r) => r[c] !== null && r[c] !== undefined); return q; },
      then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows.filter((r) => f.every((x) => x(r))).map((r) => ({ ...r })), error: null }).then(res); },
      update(patch: Partial<Row>) { return { in: async (_c: string, ids: string[]) => { updates.push(ids); for (const r of rows) if (ids.includes(r.id)) Object.assign(r, patch); return { error: null }; } }; },
    };
    return q;
  },
};
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/lib\/supabase$/.test(request)) return { supabase: fakeSupabase };
  return orig.call(this, request, parent, isMain);
};

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

  console.log("\nPage load never changes a show's money (the real auto-mark route)");
  const { POST } = await import("../app/api/sessions/auto-mark/route");
  rows = [
    { id: "studio-past", date: "2026-09-20", end_time: "14:00", status: "מתוכנן", session_type: "סשן הקלטה", show_id: null },
    { id: "rehearsal-past", date: "2026-09-20", end_time: "20:00", status: "מתוכנן", session_type: "חזרה להופעה", show_id: "show-1" },
    { id: "rehearsal-past-notype", date: "2026-09-20", end_time: "20:00", status: "מתוכנן", session_type: null, show_id: "show-2" },
    { id: "rehearsal-future", date: "2026-10-20", end_time: "20:00", status: "מתוכנן", session_type: "חזרה להופעה", show_id: "show-1" },
    { id: "rehearsal-done", date: "2026-09-10", end_time: "20:00", status: "בוצע", session_type: "חזרה להופעה", show_id: "show-1" },
    { id: "rehearsal-cancelled", date: "2026-09-11", end_time: "20:00", status: "בוטל", session_type: "חזרה להופעה", show_id: "show-1" },
  ];
  const call = () => POST(new NextRequest("https://app.test/api/sessions/auto-mark", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientNow: "2026-09-27T12:00:00" }) }));
  const r1 = await (await call()).json();
  ok("11. app load: the passed studio session is still auto-marked (studio semantics unchanged)", JSON.stringify(r1.ids) === '["studio-past"]' && rows[0].status === "התקיים", r1);
  ok("12. a passed planned show rehearsal (by type or by show link) stays מתוכנן", rows[1].status === "מתוכנן" && rows[2].status === "מתוכנן");
  ok("13. future / done / cancelled rehearsals untouched", rows[3].status === "מתוכנן" && rows[4].status === "בוצע" && rows[5].status === "בוטל");
  const r2 = await (await call()).json(); const r3 = await (await call()).json();
  ok("14. repeated reloads: nothing more is written, rehearsals never move", r2.updated === 0 && r3.updated === 0 && updates.length === 1 && rows[1].status === "מתוכנן");

  console.log("\nNo page-load path reaches show money");
  const route = fs.readFileSync("app/api/sessions/auto-mark/route.ts", "utf8");
  const drawer = fs.readFileSync("components/ui/ProjectDrawer.tsx", "utf8");
  const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
  ok("15. the auto-mark route never syncs finance / ledgers", !/shows-finance-sync|syncShowFinance|artist-balance/.test(route));
  ok("16. the project drawer's local auto-mark skips show rehearsals (its PATCH would re-sync the show)", /localAutoMark[\s\S]{0,900}חזרה להופעה/.test(drawer));
  ok("17. AppShell calls only the auto-mark on load (no show / finance sync)", !/syncShowFinance|\/api\/shows/.test(shell));
  const sync = fs.readFileSync("lib/shows-finance-sync.ts", "utf8");
  ok("18. the finance sync, the artist ledger and the DJ figure use the same rule (no second rule)", (sync.match(/rehearsalCountedAmount\(/g) ?? []).length >= 2 && /computeShowSplit\(/.test(sync));

  console.log("\nSunny knows the decision");
  const card = stageCard("REHEARSAL_OPERATIONAL", "התקיים");
  ok("19. Sunny's stage card flags a legacy התקיים for the Owner's confirmation", !!card && card.blockingUnknowns.some((x) => /Owner has not confirmed/.test(x)), card);
  const planned = stageCard("REHEARSAL_OPERATIONAL", "מתוכנן");
  ok("20. and explains that מתוכנן does not count", !!planned?.meaningEn?.includes("does not count"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
