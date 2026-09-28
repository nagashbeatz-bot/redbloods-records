/**
 * Artist balance cycles — the settlement picture (Owner decision 2026-09-28, question 8 / 9).
 * A close is a settlement PICTURE, never a reset: opening (previous closing) + income − artist expense share − payments
 * = the cumulative closing balance; an unpaid balance carries forward; late entries count in the open cycle; a closed
 * snapshot never changes; a double close is refused. Pure rules + the real store on an in-memory database
 * (no production, no network, no push). Run with:   npx tsx scripts/test-balance-cycles.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const section = (s: string) => console.log(`\n${s}`);

// ── in-memory database: settings + artist_balance_cycles (unique artist_id + cycle_index); any other table is a failure ──
type Row = Record<string, unknown>;
const db: { settings: Row[]; artist_balance_cycles: Row[]; otherWrites: string[]; staleCycleReads: number } = { settings: [], artist_balance_cycles: [], otherWrites: [], staleCycleReads: 0 };
let clock = Date.parse("2026-10-11T09:00:00Z");
function table(name: string) {
  const filters: [string, unknown][] = [];
  let orderBy: { col: string; asc: boolean } | null = null;
  const rows = () => {
    // staleCycleReads: the next read of the cycles table returns nothing (a second click that read before the first close landed)
    const staleNow = name === "artist_balance_cycles" && db.staleCycleReads > 0 && (db.staleCycleReads--, true);
    const src = name === "settings" ? db.settings : name === "artist_balance_cycles" ? (staleNow ? [] : db.artist_balance_cycles) : [];
    let r = src.filter((x) => filters.every(([k, v]) => x[k] === v));
    if (orderBy) { const { col, asc } = orderBy; r = [...r].sort((a, b) => (Number(a[col]) - Number(b[col])) * (asc ? 1 : -1)); }
    return r;
  };
  const q = {
    select() { return q; },
    eq(k: string, v: unknown) { filters.push([k, v]); return q; },
    order(col: string, o?: { ascending?: boolean }) { orderBy = { col, asc: o?.ascending !== false }; return q; },
    async maybeSingle() { return { data: rows()[0] ?? null, error: null }; },
    then(res: (v: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: rows(), error: null }).then(res); },
    async insert(row: Row) {
      if (name === "artist_balance_cycles") {
        if (db.artist_balance_cycles.some((x) => x.artist_id === row.artist_id && x.cycle_index === row.cycle_index)) return { error: { code: "23505", message: "duplicate key" } };
        clock += 1000;
        db.artist_balance_cycles.push({ id: `cy-${db.artist_balance_cycles.length + 1}`, ...row, closed_at: new Date(clock).toISOString(), created_at: new Date(clock).toISOString() });
        return { error: null };
      }
      if (name === "settings") { db.settings.push(row); return { error: null }; }
      db.otherWrites.push(name); return { error: null };
    },
    update() { db.otherWrites.push(`${name}:update`); return q; },
    delete() { db.otherWrites.push(`${name}:delete`); return q; },
  };
  return q;
}
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from: (n: string) => table(n), rpc() { throw new Error("no rpc"); } } };
  return orig.call(this, request, parent, isMain);
};

const E = (id: string, entryType: string, amount: number, entryDate: string, createdAt = `${entryDate}T12:00:00Z`) => ({ id, entryType, amount, entryDate, createdAt });

async function main() {
  const P = await import("../lib/artist-balance-cycles-pure");
  const snap = (cycleIndex: number, startDate: string, endDate: string, income: number, payments: number, expenses: number, endingBalance: number, closedAt: string) => ({ cycleIndex, startDate, endDate, income, payments, expenses, endingBalance, closedAt });

  section("1. first cycle");
  const first = P.computeOpenCycle({ anchor: "2026-08-10", bootstrap: null, closed: [], entries: [], today: "2026-09-28" });
  ok("first cycle: 10.08 → 10.10, opening 0, closing 0, balanced", first.index === 0 && first.startDate === "2026-08-10" && first.endDate === "2026-10-10" && first.openingBalance === 0 && first.closingBalance === 0 && first.result === "BALANCED", first);
  const firstAct = P.computeOpenCycle({ anchor: "2026-08-10", bootstrap: null, closed: [], entries: [E("a", "הכנסות", 1000, "2026-08-20"), E("b", "הוצאות", 250, "2026-09-01"), E("c", "תשלומים", 300, "2026-09-05"), E("x", "הכנסות צפויות", 999, "2026-09-06")], today: "2026-09-28" });
  ok("closing = opening + income − expenses − payments (expected not counted); Records owes the artist", firstAct.closingBalance === 450 && firstAct.totals.expectedIncome === 999 && firstAct.result === "RECORDS_OWES_ARTIST", firstAct);

  section("2. Avi: Luna as history before the cycle (Q9)");
  const luna = [E("luna-in", "הכנסות", 750, "2026-08-01"), E("luna-pay", "תשלומים", 750, "2026-08-01")];
  const avi = P.computeOpenCycle({ anchor: "2026-08-10", bootstrap: null, closed: [], entries: luna, today: "2026-09-28" });
  ok("Avi cycle 10.08.2026 – 10.10.2026", avi.startDate === "2026-08-10" && avi.endDate === "2026-10-10" && avi.index === 0);
  ok("Luna (01.08) is pre-cycle history: not in the cycle activity", avi.totals.income === 0 && avi.totals.payments === 0 && avi.lateEntryIds.length === 0);
  ok("Luna balanced 750 vs 750 → opening 0, closing 0, BALANCED, no reconciliation gap", avi.openingBalance === 0 && avi.closingBalance === 0 && avi.result === "BALANCED" && avi.reconciliationDifference === 0 && avi.ledgerBalanceToEnd === 0, avi);

  section("3. carry-forward (positive) and a payment in the next cycle");
  const c0 = snap(0, "2026-08-10", "2026-10-10", 1500, 287, 0, 1213, "2026-10-10T08:00:00Z");
  const e0 = [E("i1", "הכנסות", 1500, "2026-08-20"), E("p1", "תשלומים", 287, "2026-09-01")];
  const pos = P.computeOpenCycle({ anchor: "2026-08-10", bootstrap: null, closed: [c0], entries: e0, today: "2026-10-12" });
  ok("next cycle opens with the previous closing balance (1,213) — never zero", pos.index === 1 && pos.openingBalance === 1213 && pos.closingBalance === 1213 && pos.result === "RECORDS_OWES_ARTIST", pos);
  const paid = P.computeOpenCycle({ anchor: "2026-08-10", bootstrap: null, closed: [c0], entries: [...e0, E("p2", "תשלומים", 1213, "2026-10-20", "2026-10-20T10:00:00Z")], today: "2026-10-21" });
  ok("a real payment in the next cycle settles it: closing 0, balanced", paid.totals.payments === 1213 && paid.closingBalance === 0 && paid.result === "BALANCED", paid);
  ok("the settlement came only from a recorded payment (no offset, no reset)", paid.openingBalance === 1213 && paid.reconciliationDifference === 0);

  section("4. carry-forward (negative)");
  const neg0 = snap(0, "2026-08-10", "2026-10-10", 0, 0, 500, -500, "2026-10-10T08:00:00Z");
  const neg = P.computeOpenCycle({ anchor: "2026-08-10", bootstrap: null, closed: [neg0], entries: [E("x1", "הוצאות", 500, "2026-09-01"), E("i2", "הכנסות", 300, "2026-11-01")], today: "2026-11-02" });
  ok("artist owes Records: −500 carried, +300 income → −200", neg.openingBalance === -500 && neg.closingBalance === -200 && neg.result === "ARTIST_OWES_RECORDS", neg);

  section("5. balance 0");
  ok("zero opening + zero activity → BALANCED; the result names who owes whom", P.settlementResultOf(0) === "BALANCED" && P.settlementResultOf(0.001) === "BALANCED" && P.settlementResultOf(5) === "RECORDS_OWES_ARTIST" && P.settlementResultOf(-5) === "ARTIST_OWES_RECORDS" && P.SETTLEMENT_RESULT_HE.BALANCED === "החשבון מאוזן");

  section("6. late entry (dated in a closed period, recorded after the close)");
  const late = P.computeOpenCycle({ anchor: "2026-08-10", bootstrap: null, closed: [c0], entries: [...e0, E("late", "הוצאות", 100, "2026-09-15", "2026-10-15T09:00:00Z")], today: "2026-10-16" });
  ok("counted in the OPEN cycle (1,213 − 100 = 1,113), flagged as late", late.lateEntryIds.join() === "late" && late.totals.expenses === 100 && late.closingBalance === 1113, late);
  ok("the closed snapshot is untouched and the ledger reconciles (difference 0)", c0.endingBalance === 1213 && late.reconciliationDifference === 0);
  const early = P.computeOpenCycle({ anchor: "2026-08-10", bootstrap: null, closed: [c0], entries: [...e0, E("old", "הכנסות", 50, "2026-09-15", "2026-09-15T09:00:00Z")], today: "2026-10-16" });
  ok("an entry recorded BEFORE the close (so already inside the snapshot) is not counted again — it shows as a reconciliation difference", early.lateEntryIds.length === 0 && early.closingBalance === 1213 && early.reconciliationDifference === 50, early);

  section("7. closed snapshot is immutable; opening derived from what it stored");
  ok("opening of a snapshot = closing − (income − payments − expenses)", P.openingOfSnapshot({ endingBalance: 1213, income: 1500, payments: 287, expenses: 0 }) === 0 && P.openingOfSnapshot({ endingBalance: 1113, income: 0, payments: 0, expenses: 100 }) === 1213);
  const edited = P.computeOpenCycle({ anchor: "2026-08-10", bootstrap: null, closed: [c0], entries: [E("i1", "הכנסות", 1400, "2026-08-20"), E("p1", "תשלומים", 287, "2026-09-01")], today: "2026-10-12" });
  ok("editing a closed-period entry never changes the snapshot — the difference is shown (−100)", edited.openingBalance === 1213 && edited.reconciliationDifference === -100, edited);

  section("8. Shalev: the first-cycle bootstrap and early close keep working");
  const sh = P.computeOpenCycle({ anchor: "2026-08-10", bootstrap: "2026-04-01", closed: [], entries: [E("s1", "הכנסות", 9518, "2026-05-01"), E("s2", "תשלומים", 5175, "2026-06-01"), E("s3", "הוצאות", 3130, "2026-07-01")], today: "2026-09-28" });
  ok("cycle 0 calculation window starts at the bootstrap; opening 0; closing = the ledger balance 1,213", sh.calcStartDate === "2026-04-01" && sh.startDate === "2026-08-10" && sh.openingBalance === 0 && sh.closingBalance === 1213 && sh.reconciliationDifference === 0, sh);
  ok("an early close advances the current cycle (index = max(calendar, closed))", P.currentCycleIndex("2026-08-10", "2026-09-28", 1) === 1 && P.currentCycleIndex("2026-08-10", "2026-12-11", 1) === 2);

  section("9. the store: close = snapshot of the settlement picture; double close refused; nothing else written");
  const S = await import("../lib/artist-balance-cycles-store");
  const ART = "artist-1";
  db.settings.push({ key: `balance_cycle_anchor:${ART}`, value: { anchorDate: "2026-08-10" } });
  const entries = [
    { id: "i1", artistId: ART, entryType: "הכנסות", amount: 1500, entryDate: "2026-08-20", description: "", note: "", sourceTxId: null, createdAt: "2026-08-20T12:00:00Z", updatedAt: "2026-08-20T12:00:00Z" },
    { id: "p1", artistId: ART, entryType: "תשלומים", amount: 287, entryDate: "2026-09-01", description: "", note: "", sourceTxId: null, createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z" },
  ] as unknown as Parameters<typeof S.getBalanceCycleState>[1];
  const st = await S.getBalanceCycleState(ART, entries);
  ok("store state = the pure computation (opening 0 → closing 1,213)", st.current?.openingBalance === 0 && st.current?.closingBalance === 1213 && st.current?.result === "RECORDS_OWES_ARTIST", st.current);
  let earlyRefused = false;
  if ((st.current?.daysUntilClose ?? 0) > 0) { try { await S.closeCurrentBalanceCycle(ART, entries, false); } catch { earlyRefused = true; } } else earlyRefused = true;
  ok("an early close without force is refused (or the cycle already ended)", earlyRefused && db.artist_balance_cycles.length === 0);
  const after = await S.closeCurrentBalanceCycle(ART, entries, true);
  const row = db.artist_balance_cycles[0];
  ok("the snapshot stores the activity + the CUMULATIVE closing balance", row?.income === 1500 && row?.payments === 287 && row?.ending_balance === 1213 && row?.cycle_index === 0, row);
  ok("the next cycle opens with 1,213 — no payment, offset or reset was recorded", after.current?.index === 1 && after.current?.openingBalance === 1213 && after.current?.closingBalance === 1213 && db.otherWrites.length === 0, { current: after.current, other: db.otherWrites });
  ok("history shows opening → activity → closing + result", after.closed[0]?.openingBalance === 0 && after.closed[0]?.endingBalance === 1213 && after.closed[0]?.result === "RECORDS_OWES_ARTIST");
  // a second close of the SAME cycle (a double click / race: it read the state before the first close landed)
  db.staleCycleReads = 1;
  let dup = "";
  try { await S.closeCurrentBalanceCycle(ART, entries, true); } catch (e) { dup = e instanceof Error ? e.message : String(e); }
  ok("double close of the same cycle is refused ('המחזור כבר נסגר'); still exactly one snapshot, unchanged", dup === "המחזור כבר נסגר" && db.artist_balance_cycles.length === 1 && db.artist_balance_cycles[0].ending_balance === 1213, { dup, n: db.artist_balance_cycles.length });
  const src = read("lib/artist-balance-cycles-store.ts");
  ok("the store maps a duplicate close to 'המחזור כבר נסגר'", /23505[\s\S]{0,80}המחזור כבר נסגר/.test(src));

  section("10. one rule everywhere; no push / reminder change");
  ok("the store, Sunny's label view and the balance_cycles capability use the ONE pure module", /artist-balance-cycles-pure/.test(src) && /computeOpenCycle/.test(read("lib/partner/label/view.ts")) && /openingOfSnapshot/.test(read("lib/partner/knowledge/capabilities/operations.ts")));
  ok("the pure module has no DB / push path", !/supabase|sendPush|fetch\(/.test(read("lib/artist-balance-cycles-pure.ts")));
  ok("the close dialog offers no payment / offset action", !/קיזוז|offset/i.test((read("components/red-artists/ArtistPortalPage.tsx").match(/function BalanceCycleCloseModal[\s\S]*?\n}\n/) ?? [""])[0].replace(/לא מקזזת/g, "")));
  ok("Avi's own session never gets the balance tab; the Owner preview does", /isAviPortal \? \(isAvi \? \(\["בית", "ההופעות שלי", "המוזיקה שלי", "ביטים פנויים"\]/.test(read("components/red-artists/ArtistPortalPage.tsx")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
