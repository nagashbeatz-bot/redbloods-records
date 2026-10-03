/**
 * D5 + currency — show payments in Finance (Owner decision 2026-09-27; migration 75bf144e… applied). The REAL
 * lib/shows-finance-sync + lib/writes/show-payments + lib/writes/shows run on an in-memory database (no production).
 *   deposit → partial → full → overpayment · received / remaining / credit (showMoneyOf, the one rule) · never a fake
 *   second full-price income · close 'received' = the remainder only · 'not received' never downgrades a deposit ·
 *   cancel keeps payments · delete / revert-to-lead refused with payments · duplicate refused · no FX (currency
 *   mismatch refused, currency change refused after payments, non-₪ shows skip the currency-less ledger) · re-sync idempotent.
 * Run with:   npx tsx scripts/test-sunny-d5-show-payments.tsx
 */
import Module from "node:module";
import { randomUUID } from "node:crypto";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };

// ── an in-memory PostgREST-ish fake (only what these writers use) ────────────────────────────────────────────────
type Row = Record<string, unknown>;
const DB: Record<string, Row[]> = {};
const t = (name: string) => (DB[name] ??= []);
function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let mode: "select" | "update" | "delete" | "insert" = "select", patch: Row | null = null, ins: Row | null = null, countHead = false, one: "single" | "maybe" | null = null, orderBy: [string, boolean] | null = null, lim: number | null = null;
  const run = () => {
    if (mode === "insert") { const r = { id: randomUUID(), ...ins }; t(table).push(r); return { data: one ? { ...r } : [{ ...r }], error: null, count: null }; }
    let rows = t(table).filter((r) => filters.every((f) => f(r)));
    if (mode === "update") { for (const r of rows) Object.assign(r, patch); }
    if (mode === "delete") { DB[table] = t(table).filter((r) => !rows.includes(r)); }
    if (orderBy) rows = [...rows].sort((a, b) => (String(a[orderBy![0]]) < String(b[orderBy![0]]) ? -1 : 1) * (orderBy![1] ? 1 : -1));
    if (lim !== null) rows = rows.slice(0, lim);
    if (countHead) return { data: null, error: null, count: rows.length };
    const data = rows.map((r) => ({ ...r }));
    return { data: one === "single" ? data[0] ?? null : one === "maybe" ? data[0] ?? null : data, error: null, count: data.length };
  };
  const c: Record<string, unknown> = {
    select(_cols?: string, o?: { count?: string; head?: boolean }) { if (o?.head) countHead = true; if (mode === "select") mode = "select"; return c; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return c; },
    neq(k: string, v: unknown) { filters.push((r) => r[k] !== v); return c; },
    is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return c; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return c; },
    ilike(k: string, pat: string) { const re = new RegExp("^" + pat.replace(/%/g, ".*") + "$", "i"); filters.push((r) => re.test(String(r[k] ?? ""))); return c; },
    order(k: string, o?: { ascending?: boolean }) { orderBy = [k, o?.ascending !== false]; return c; },
    limit(n: number) { lim = n; return c; },
    single() { one = "single"; return Promise.resolve(run()); },
    maybeSingle() { one = "maybe"; return Promise.resolve(run()); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return {
    select: (cols?: string, o?: { count?: string; head?: boolean }) => (c.select as (a?: string, b?: unknown) => unknown)(cols, o),
    insert(r: Row) { mode = "insert"; ins = r; return c; },
    update(p: Row) { mode = "update"; patch = p; return c; },
    delete() { mode = "delete"; return c; },
  };
}
// net model (2026-09-28): the artist's show share is an entitlement in the (fake) ledger — never a Finance artist-fee row
const entitlement = (showId: string) => (DB.artist_balance_entries ?? []).find((r) => r.source_show_id === showId && r.entry_type === "הכנסות צפויות");
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/lib\/supabase$/.test(request)) return { supabase: { from } };
  return orig.call(this, request, parent, isMain);
};

const SHOW = (o: Row = {}): Row => ({ id: randomUUID(), name: "הופעה בחיפה", artist: "שליו טסמה", artist_client_id: null, booker_client_id: null, booker_name: "מזמין", date: "2026-10-15", start_time: "21:00", location: "חיפה", contact_person: "", phone: "",
  status: "אושרה", payment_status: "צפוי", show_price: 3000, dj_fee: 500, dj_client_id: null, dj_name: "קלין", dj_confirmation_status: null, dj_confirmed_at: null, artist_fee: 0, advance_payment: 0, currency: "₪", notes: "", calendar_event_id: null,
  linked_income_transaction_id: null, linked_dj_expense_transaction_id: null, linked_artist_expense_transaction_id: null, created_at: "", updated_at: "", ...o });
const txOf = (showId: string) => t("transactions").filter((r) => r.show_id === showId);
const income = (showId: string) => txOf(showId).filter((r) => r.type === "income");
const receivedTotal = (showId: string) => income(showId).filter((r) => r.show_money_role === "SHOW_PAYMENT" && (r.payment_status === "התקבל" || r.payment_status === "שולם")).reduce((s, r) => s + Number(r.amount), 0);

(async () => {
  const fin = await import("../lib/shows-finance-sync");
  const { recordShowPayment } = await import("../lib/writes/show-payments");
  const W = await import("../lib/writes/shows");
  const { showMoneyOf } = await import("../lib/shows-types");
  const getShow = (id: string) => t("shows").find((r) => r.id === id) as unknown as import("../lib/shows-types").Show;

  console.log("The one rule (showMoneyOf)");
  const m = showMoneyOf({ show_price: 3000, currency: "₪" }, [{ id: "a", role: "SHOW_PAYMENT", status: "התקבל", amount: 1000, currency: "₪" }, { id: "b", role: "SHOW_PAYMENT", status: "צפוי", amount: 999, currency: "₪" }, { id: "c", role: "SHOW_PAYMENT", status: "התקבל", amount: 50, currency: "$" }, { id: "d", role: "SHOW_BALANCE_EXPECTED", status: "צפוי", amount: 2000, currency: "₪" }]);
  ok("1. received counts only שולם / התקבל payments in the show's currency; another currency is never added", m.received === 1000 && m.remaining === 2000 && m.credit === 0 && m.otherCurrencyPayments.length === 1 && m.derivedPaymentStatus === "מקדמה");

  console.log("\nA confirmed show → deposit → partial → full → overpayment");
  const s1 = SHOW(); t("shows").push(s1); const id = String(s1.id);
  await fin.syncShowFinance(getShow(id));
  ok("2. confirmation: ONE expected-balance row = the price (צפוי), linked by show_id, in the show currency; the DJ row linked; the artist share an expected ledger entitlement (no Finance artist row)", income(id).length === 1 && income(id)[0].show_money_role === "SHOW_BALANCE_EXPECTED" && income(id)[0].amount === 3000 && income(id)[0].payment_status === "צפוי" && income(id)[0].currency === "₪" && txOf(id).some((r) => r.show_money_role === "DJ_FEE") && !txOf(id).some((r) => r.show_money_role === "ARTIST_FEE") && !!entitlement(id));
  const d1 = await recordShowPayment(id, { amount: 1000, date: "2026-09-27", method: "ביט" });
  ok("3. deposit 1,000: one payment row (התקבל) + the expected balance becomes 2,000; the show is מקדמה with received 1,000", d1.kind === "ok" && receivedTotal(id) === 1000 && income(id).find((r) => r.show_money_role === "SHOW_BALANCE_EXPECTED")?.amount === 2000 && getShow(id).payment_status === "מקדמה" && getShow(id).advance_payment === 1000, { d1, rows: income(id) });
  const dup = await recordShowPayment(id, { amount: 1000, date: "2026-09-27" });
  ok("4. the same amount on the same date again → refused (double-click / replay)", dup.kind === "refused" && dup.code === "DUPLICATE" && receivedTotal(id) === 1000);
  const fx = await recordShowPayment(id, { amount: 500, date: "2026-09-28", currency: "$" });
  ok("5. a payment in another currency → refused (no FX)", fx.kind === "refused" && fx.code === "CURRENCY_MISMATCH");
  await recordShowPayment(id, { amount: 500, date: "2026-10-01" });
  ok("6. partial 500: received 1,500, remaining 1,500", receivedTotal(id) === 1500 && income(id).find((r) => r.show_money_role === "SHOW_BALANCE_EXPECTED")?.amount === 1500);
  await recordShowPayment(id, { amount: 1500, date: "2026-10-15" });
  const exp = income(id).find((r) => r.show_money_role === "SHOW_BALANCE_EXPECTED");
  ok("7. the rest 1,500: the expected row BECOMES that payment → received 3,000, remaining 0, status שולם; A1: the DJ row stays צפוי and the artist entitlement stays expected (client paid ≠ DJ / artist paid)", receivedTotal(id) === 3000 && !exp && getShow(id).payment_status === "שולם" && txOf(id).find((r) => r.show_money_role === "DJ_FEE")?.payment_status === "צפוי" && !!entitlement(id), income(id));
  ok("8. NEVER 1,000 + 3,000 = 4,000 fake revenue: Σ received income = the price exactly", income(id).filter((r) => r.payment_status === "התקבל").reduce((s, r) => s + Number(r.amount), 0) === 3000);
  await recordShowPayment(id, { amount: 200, date: "2026-10-16", note: "טיפ" });
  const money = await fin.showMoneyForShow(getShow(id));
  ok("9. overpayment 200: stays visible as credit (received 3,200, remaining 0, credit 200) — not discarded", money.received === 3200 && money.remaining === 0 && money.credit === 200);
  const before = JSON.stringify(t("transactions"));
  await fin.syncShowFinance(getShow(id)); await fin.syncShowFinance(getShow(id));
  ok("10. re-sync is idempotent: no row added / changed", JSON.stringify(t("transactions")) === before);

  console.log("\nClose / 'שולם' = the REMAINDER once; 'not received' never downgrades");
  const s2 = SHOW(); t("shows").push(s2); const id2 = String(s2.id);
  await fin.syncShowFinance(getShow(id2));
  await recordShowPayment(id2, { amount: 1000, date: "2026-09-27" });
  await fin.applyShowClosureStatuses(getShow(id2), { incomeReceived: false, djPaid: false });
  ok("11. close 'not received': the deposit stays; nothing downgraded", receivedTotal(id2) === 1000 && getShow(id2).payment_status === "מקדמה");
  await fin.syncShowFinance(getShow(id2), { markRemainderReceived: true });
  ok("12. 'שולם' intent (the client paid the rest): ONE payment for the remaining 2,000 — total received 3,000, never 4,000", receivedTotal(id2) === 3000 && income(id2).filter((r) => r.show_money_role === "SHOW_PAYMENT").length === 2);
  const s3 = SHOW(); t("shows").push(s3); const id3 = String(s3.id);
  await fin.syncShowFinance(getShow(id3));
  await fin.applyShowClosureStatuses(getShow(id3), { incomeReceived: true, djPaid: true });
  ok("13. close 'received' with no deposit: the expected row becomes the full payment (one row)", receivedTotal(id3) === 3000 && income(id3).length === 1 && getShow(id3).payment_status === "שולם");
  Object.assign(getShow(id3), { payment_status: "לא שולם" });
  await fin.syncShowFinance(getShow(id3));
  ok("14. A1: no implicit undo — a 'לא שולם' mirror never turns a received payment back into expected (reversal = an explicit Finance correction)", receivedTotal(id3) === 3000 && income(id3)[0].show_money_role === "SHOW_PAYMENT" && getShow(id3).payment_status === "שולם");

  console.log("\nCancel / delete / revert / lead");
  Object.assign(getShow(id2), { status: "בוטל" });
  await fin.syncShowFinance(getShow(id2));
  ok("15. cancel: payments stay received; the expected balance / fees → בוטל", receivedTotal(id2) === 3000 && txOf(id2).filter((r) => r.show_money_role !== "SHOW_PAYMENT" && r.show_money_role !== "REHEARSAL").every((r) => r.payment_status === "בוטל" || r.show_money_role === "DJ_FEE" || r.show_money_role === "ARTIST_FEE"));
  const del = await W.deleteShowRecord(id);
  ok("16. deleting a show with received money → refused (money is never deleted)", del.kind === "has_payments" && receivedTotal(id) === 3200);
  const rev = await W.updateShowRecord(id, { status: "ליד חדש" });
  ok("17. reverting a paid show to a lead → refused", rev.kind === "refused" && (rev as { code: string }).code === "HAS_PAYMENTS" && getShow(id).status === "אושרה");
  const lead = SHOW({ status: "ליד חדש" }); t("shows").push(lead);
  const lp = await recordShowPayment(String(lead.id), { amount: 100, date: "2026-09-27" });
  ok("18. a payment on a lead → refused (confirm the show first)", lp.kind === "refused" && lp.code === "NOT_CONFIRMED");

  console.log("\nCurrency (no FX)");
  const cur = await W.updateShowRecord(id, { currency: "$" });
  ok("19. changing the currency of a show that has payments → refused", cur.kind === "refused" && (cur as { code: string }).code === "CURRENCY_HAS_PAYMENTS" && getShow(id).currency === "₪");
  const usd = SHOW({ currency: "$", show_price: 2000 }); t("shows").push(usd); const idU = String(usd.id);
  await fin.syncShowFinance(getShow(idU));
  ok("20. a $ show: every Finance row carries $; the currency-less artist ledger gets NO entitlement (never a silent FX)", txOf(idU).length >= 2 && txOf(idU).every((r) => r.currency === "$") && !entitlement(idU));
  await fin.syncShowFinance(getShow(id3));
  ok("21. a ₪ show still syncs the ledger (its expected entitlement)", !!entitlement(id3));
  const bad = await W.updateShowRecord(idU, { currency: "GBP" });
  ok("22. an unsupported currency → refused", bad.kind === "refused" && (bad as { code: string }).code === "CURRENCY");

  console.log("\nLegacy (pre-D5) linked income row");
  const legacyTx = { id: randomUUID(), type: "income", amount: 2400, currency: "₪", payment_status: "התקבל", show_id: null, show_money_role: null, notes: "" };
  t("transactions").push(legacyTx);
  const leg = SHOW({ show_price: 2400, payment_status: "שולם", linked_income_transaction_id: legacyTx.id }); t("shows").push(leg);
  await fin.syncShowFinance(getShow(String(leg.id)));
  ok("23. an untagged legacy full-payment row is tagged SHOW_PAYMENT on first sight (known money) — no second income", legacyTx.show_money_role === "SHOW_PAYMENT" && legacyTx.show_id === leg.id && income(String(leg.id)).length === 1 && receivedTotal(String(leg.id)) === 2400);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
