/**
 * A1 — show money independence (Owner canon 2026-09-27): client paid ≠ DJ paid ≠ artist paid (independent obligations);
 * received money only from a real payment event; an undo of a payment is an explicit action; the closure flags write only
 * what the Owner chose; a paid fee row is never re-priced / re-dated / re-currencied by a sync (a mismatch is surfaced).
 * The REAL lib/shows-finance-sync + lib/writes/shows + lib/writes/show-payments run on an in-memory database (no
 * production, no network, no push, no calendar); plus the pure rules and Sunny's MARK_SHOW_FEE_PAID / SET_SHOW_MONEY on fakes.
 * Run with:   npx tsx scripts/test-show-money-independence.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

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
    return { data: one ? data[0] ?? null : data, error: null, count: data.length };
  };
  const c: Record<string, unknown> = {
    select(_cols?: string, o?: { count?: string; head?: boolean }) { if (o?.head) countHead = true; return c; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return c; },
    neq(k: string, v: unknown) { filters.push((r) => r[k] !== v && r[k] !== null && r[k] !== undefined); return c; },
    is(k: string, v: unknown) { filters.push((r) => (v === null ? r[k] === null || r[k] === undefined : r[k] === v)); return c; },
    // PostgREST .not(col, "in", '("a","b")') and .or("col.is.null,col.neq.X") with Postgres NULL semantics (Final Hardening 2026-09-29)
    not(k: string, op: string, val: string) { const list = String(val).replace(/^\(|\)$/g, "").split(",").map((x) => x.trim().replace(/^"|"$/g, "")); if (op !== "in") throw new Error(`fake: not.${op}`); filters.push((r) => r[k] !== null && r[k] !== undefined && !list.includes(String(r[k]))); return c; },
    or(expr: string) { const parts = expr.split(",").map((p) => { const [col, op, ...rest] = p.split("."); return { col, op, v: rest.join(".") }; }); filters.push((r) => parts.some(({ col, op, v }) => op === "is" && v === "null" ? r[col] === null || r[col] === undefined : op === "eq" ? String(r[col]) === v : op === "neq" ? r[col] !== null && r[col] !== undefined && String(r[col]) !== v : false)); return c; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return c; },
    order(k: string, o?: { ascending?: boolean }) { orderBy = [k, o?.ascending !== false]; return c; },
    limit(n: number) { lim = n; return c; },
    single() { one = "single"; return Promise.resolve(run()); },
    maybeSingle() { one = "maybe"; return Promise.resolve(run()); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return {
    select: (cols?: string, o?: { count?: string; head?: boolean }) => (c.select as (a?: string, b?: unknown) => unknown)(cols, o),
    insert(r: Row) { mode = "insert"; ins = { created_at: new Date().toISOString(), ...r }; return c; },
    update(p: Row) { mode = "update"; patch = p; return c; },
    delete() { mode = "delete"; return c; },
  };
}
const SHALEV = "8806fe5e-1238-4228-8078-b3db3ccc9b46";
t("label_artists").push({ id: SHALEV, name: "שליו טסמה", slug: "shalev" });
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from } };
  // the REAL close sync (ledger on the fake) — only the name → id resolution is fixed (the store is not faked here)
  if (/artist-balance-show-close-sync$/.test(request)) { const real = orig.call(this, request, parent, isMain) as Record<string, unknown>; return { ...real, async resolveShowArtistId() { return { status: "resolved", artistId: SHALEV }; } }; }
  if (/show-quote-followup$/.test(request)) return { async closeQuoteFollowupTask() { /* */ }, async ensureQuoteFollowupTask() { return { task: null, created: false }; } };
  if (/show-cancel-tasks$/.test(request)) return { async cancelOpenShowTasks() { /* */ } };
  if (/google-calendar$/.test(request)) return { async isConnected() { throw new Error("calendar must not be touched in this test"); } };
  return orig.call(this, request, parent, isMain);
};

const SHOW = (o: Row = {}): Row => ({ id: randomUUID(), name: "הופעה בחיפה", artist: "שליו טסמה", artist_client_id: null, booker_client_id: null, booker_name: "מזמין", date: "2026-10-15", start_time: "21:00", location: "חיפה", contact_person: "", phone: "",
  status: "אושרה", payment_status: "צפוי", show_price: 3000, dj_fee: 500, dj_client_id: null, dj_name: "קלין", dj_confirmation_status: null, dj_confirmed_at: null, artist_fee: 0, advance_payment: 0, currency: "₪", notes: "", calendar_event_id: null,
  linked_income_transaction_id: null, linked_dj_expense_transaction_id: null, linked_artist_expense_transaction_id: null, created_at: "", updated_at: "", ...o });
const txOf = (showId: string) => t("transactions").filter((r) => r.show_id === showId);
const income = (showId: string) => txOf(showId).filter((r) => r.type === "income");
const fee = (showId: string, role: "DJ_FEE" | "ARTIST_FEE") => txOf(showId).find((r) => r.show_money_role === role) as Row | undefined;
const receivedTotal = (showId: string) => income(showId).filter((r) => r.show_money_role === "SHOW_PAYMENT" && (r.payment_status === "התקבל" || r.payment_status === "שולם")).reduce((s, r) => s + Number(r.amount), 0);
const paymentRows = (showId: string) => income(showId).filter((r) => r.show_money_role === "SHOW_PAYMENT").length;
// net model (2026-09-28): the entitlement lives in the ledger; a real artist payment = Finance שכר אמן שולם + a ledger payment
const earning = (showId: string) => t("artist_balance_entries").find((r) => r.source_show_id === showId && (r.entry_type === "הכנסות צפויות" || r.entry_type === "הכנסות")) as Row | undefined;
const inactive = (r: Row | undefined) => String(r?.note ?? "").startsWith("[זכאות לא פעילה]");
const ledgerPays = (showId: string) => t("artist_balance_entries").filter((r) => r.source_show_id === showId && r.entry_type === "תשלומים");
const artistPayTx = (showId: string) => t("transactions").filter((r) => r.category === "שכר אמן" && String(r.notes ?? "").includes(`artist_payment_show:${showId}`));
const artistPaid = (showId: string) => ledgerPays(showId).length === 1 && artistPayTx(showId).length === 1 && artistPayTx(showId)[0].payment_status === "שולם" && ledgerPays(showId)[0].source_tx_id === artistPayTx(showId)[0].id;

(async () => {
  const fin = await import("../lib/shows-finance-sync");
  const { recordShowPayment } = await import("../lib/writes/show-payments");
  const W = await import("../lib/writes/shows");
  const P = await import("../lib/shows-types");
  const getShow = (id: string) => t("shows").find((r) => r.id === id) as unknown as import("../lib/shows-types").Show;
  const newShow = async (o: Row = {}) => { const s = SHOW(o); t("shows").push(s); const id = String(s.id); await fin.syncShowFinance(getShow(id)); return id; };

  console.log("Pure rules (lib/shows-types)");
  ok("P1. the remainder is recorded only on an explicit intent", P.shouldRecordRemainder({ markRemainderReceived: true }) && !P.shouldRecordRemainder({}) && !P.shouldRecordRemainder(undefined) && !P.shouldRecordRemainder(null));
  ok("P2. body 'שולם' is intent only when the stored mirror was not 'שולם'", P.paymentIntentFromBody("שולם", "מקדמה").markRemainderReceived === true && P.paymentIntentFromBody("שולם", "שולם").markRemainderReceived === false && P.paymentIntentFromBody("לא שולם", "שולם").markRemainderReceived === false);
  ok("P3. a paid fee row stays paid: cancelled / fee 0 never downgrade it", P.feeRowStatusAfterSync("שולם", { cancelled: true, feeZero: false }) === "שולם" && P.feeRowStatusAfterSync("שולם", { cancelled: false, feeZero: true }) === "שולם");
  ok("P4. an unpaid fee row → בוטל on cancel / fee 0, בוטל → צפוי when the fee stands again, otherwise unchanged", P.feeRowStatusAfterSync("צפוי", { cancelled: true, feeZero: false }) === "בוטל" && P.feeRowStatusAfterSync("לא שולם", { cancelled: false, feeZero: true }) === "בוטל" && P.feeRowStatusAfterSync("בוטל", { cancelled: false, feeZero: false }) === "צפוי" && P.feeRowStatusAfterSync("צפוי", { cancelled: false, feeZero: false }) === "צפוי" && P.feeRowStatusAfterSync("לא שולם", { cancelled: false, feeZero: false }) === "לא שולם");
  ok("P5. a new fee row is created צפוי; a paid row may never be re-priced", P.FEE_ROW_INITIAL_STATUS === "צפוי" && !P.feeRowMayReprice("שולם") && P.feeRowMayReprice("צפוי") && P.feeRowMayReprice("בוטל"));
  ok("P6. paid-row conflicts: amount / party / currency / cancelled are reported; an unpaid row never conflicts", P.feeRowPaidConflicts({ status: "שולם", amount: 500, party: "א", currency: "₪" }, { amount: 700, party: "ב", currency: "$", cancelled: true }).length === 4 && P.feeRowPaidConflicts({ status: "צפוי", amount: 500 }, { amount: 700 }).length === 0 && P.feeRowPaidConflicts({ status: "שולם", amount: 500, party: "א", currency: "₪" }, { amount: 500, party: "א", currency: "₪" }).length === 0);
  ok("P7. closure: a flag true → שולם; false leaves the row as it is (a paid DJ stays paid)", P.closureFeeStatus("צפוי", true) === "שולם" && P.closureFeeStatus("שולם", false) === "שולם" && P.closureFeeStatus("צפוי", false) === "צפוי");

  console.log("\nClient pays → DJ / artist unchanged");
  const a = await newShow();
  ok("1. confirmation: DJ 500 fee row צפוי; NO Finance artist-fee row; the artist's 1,250 is an expected ledger entitlement (by show)", fee(a, "DJ_FEE")?.payment_status === "צפוי" && fee(a, "DJ_FEE")?.amount === 500 && !fee(a, "ARTIST_FEE") && earning(a)?.entry_type === "הכנסות צפויות" && earning(a)?.amount === 1250 && earning(a)?.artist_id === SHALEV && !inactive(earning(a)), earning(a));
  await recordShowPayment(a, { amount: 3000, date: "2026-10-16" });
  ok("2. the client paid in full → received 3,000, show שולם; the DJ row STILL צפוי, the entitlement still expected, no artist payment", receivedTotal(a) === 3000 && getShow(a).payment_status === "שולם" && fee(a, "DJ_FEE")?.payment_status === "צפוי" && earning(a)?.entry_type === "הכנסות צפויות" && ledgerPays(a).length === 0);

  console.log("\nShow edits after the client paid → no fee status change, no new income");
  const before2 = paymentRows(a);
  const e1 = await W.updateShowRecord(a, { name: "הופעה בחיפה (עודכן)", location: "חיפה", payment_status: "שולם" });
  ok("3. an edit that re-sends the unchanged 'שולם' → no new payment row, fee statuses unchanged", e1.kind === "ok" && paymentRows(a) === before2 && receivedTotal(a) === 3000 && fee(a, "DJ_FEE")?.payment_status === "צפוי" && earning(a)?.amount === 1250);
  const f1 = await W.setShowFeePaid(a, "DJ_FEE", true, { date: "2026-10-17", method: "ביט" });
  ok("4. setShowFeePaid DJ → that row שולם with the payment date + method; the artist row + the client money untouched", f1.kind === "ok" && fee(a, "DJ_FEE")?.payment_status === "שולם" && fee(a, "DJ_FEE")?.date === "2026-10-17" && fee(a, "DJ_FEE")?.payment_method === "ביט" && ledgerPays(a).length === 0 && artistPayTx(a).length === 0 && receivedTotal(a) === 3000);
  const up = await W.updateShowRecord(a, { show_price: 4000, payment_status: "שולם" });
  const expA = income(a).find((r) => r.show_money_role === "SHOW_BALANCE_EXPECTED");
  ok("5. price increase after 'paid' → NO invented income: received stays 3,000, a 1,000 expected balance, the show becomes מקדמה", up.kind === "ok" && receivedTotal(a) === 3000 && paymentRows(a) === before2 && expA?.amount === 1000 && expA?.payment_status === "צפוי" && getShow(a).payment_status === "מקדמה", { rows: income(a), ps: getShow(a).payment_status });
  ok("6. …the paid DJ row keeps 500 / שולם; the expected entitlement re-prices to 1,750 (the app's split) — still no Finance artist row", fee(a, "DJ_FEE")?.amount === 500 && fee(a, "DJ_FEE")?.payment_status === "שולם" && earning(a)?.amount === 1750 && earning(a)?.entry_type === "הכנסות צפויות" && !fee(a, "ARTIST_FEE"));
  const down = await W.updateShowRecord(a, { show_price: 2000 });
  ok("7. price decrease → remaining 0, the credit (1,000) stays visible; payments never change; artist re-prices to 750", down.kind === "ok" && receivedTotal(a) === 3000 && (await fin.showMoneyForShow(getShow(a))).credit === 1000 && earning(a)?.amount === 750 && fee(a, "DJ_FEE")?.payment_status === "שולם");
  const djChange = await W.updateShowRecord(a, { dj_fee: 700 });
  ok("8. DJ fee change on a PAID DJ row → the row is not overwritten (500 / שולם) and a finance warning surfaces the mismatch", djChange.kind === "ok" && fee(a, "DJ_FEE")?.amount === 500 && fee(a, "DJ_FEE")?.payment_status === "שולם" && /500/.test(String((djChange as { financeWarning?: string }).financeWarning)) && /700/.test(String((djChange as { financeWarning?: string }).financeWarning)), djChange);
  const djName = await W.updateShowRecord(a, { dj_name: "DJ אחר" });
  ok("9. DJ change on a paid DJ row → the paid row keeps who was paid (קלין) + a warning; status unchanged", djName.kind === "ok" && fee(a, "DJ_FEE")?.artist === "קלין" && fee(a, "DJ_FEE")?.payment_status === "שולם" && /קלין/.test(String((djName as { financeWarning?: string }).financeWarning)));
  const undo = await W.updateShowRecord(a, { payment_status: "לא שולם" });
  ok("10. a 'לא שולם' picker value on a show with payments is NOT an undo: payments stay, the mirror stays derived", undo.kind === "ok" && receivedTotal(a) === 3000 && getShow(a).payment_status === "שולם" && fee(a, "DJ_FEE")?.payment_status === "שולם");

  console.log("\nRehearsal create / edit / delete → no fee status change");
  const b = await newShow({ show_price: 5000, dj_fee: 1000 });
  // Phase 1 (2026-10-03): setShowFeePaid ARTIST is ALWAYS refused (ARTIST_PAYOUT_VIA_BALANCE) — the artist is paid only through the balance
  // (recordArtistPayment). The REAL payment for the later scenarios is therefore created directly, exactly as the balance tab does.
  const pb = await W.setShowFeePaid(b, "ARTIST_FEE", true, { date: "2026-10-16", method: "ביט" });
  ok("10a. Phase 1 (2026-10-03): setShowFeePaid ARTIST paid=true → refused ARTIST_PAYOUT_VIA_BALANCE, nothing written (no Finance row, no ledger payment)", pb.kind === "refused" && pb.code === "ARTIST_PAYOUT_VIA_BALANCE" && artistPayTx(b).length === 0 && ledgerPays(b).length === 0, pb);
  const { recordArtistPayment } = await import("../lib/writes/artist-payments");
  const rp = await recordArtistPayment({ artistId: SHALEV, amount: 2000, date: "2026-10-16", method: "ביט", showId: b, idempotencyKey: `show:${b}`, description: "תשלום — הופעה בחיפה", allowDuplicate: true });
  const payTx = artistPayTx(b)[0];
  ok("10b. Phase 1 (2026-10-03): a REAL artist payment (recordArtistPayment, the balance path): Finance שכר אמן 2,000 שולם RECORDS (not show-linked) + ONE ledger payment linked by source_tx_id", rp.kind === "ok" && artistPaid(b) && payTx.amount === 2000 && payTx.business_unit === "RECORDS" && payTx.business_unit_source === "RULE" && payTx.type === "expense" && payTx.show_id === null && payTx.currency === "₪" && payTx.date === "2026-10-16" && payTx.payment_method === "ביט" && ledgerPays(b)[0].amount === 2000 && ledgerPays(b)[0].artist_id === SHALEV && earning(b)?.entry_type === "הכנסות צפויות", { rp, payTx, led: ledgerPays(b) });
  const again = await W.setShowFeePaid(b, "ARTIST_FEE", true, {});
  ok("10c. Phase 1 (2026-10-03): paying the artist again for the same show from the show → refused ARTIST_PAYOUT_VIA_BALANCE, still ONE Finance row + ONE ledger payment", again.kind === "refused" && again.code === "ARTIST_PAYOUT_VIA_BALANCE" && artistPaid(b), again);
  const unpayA = await W.setShowFeePaid(b, "ARTIST_FEE", false, {});
  ok("10d. Phase 1 (2026-10-03): un-paying the artist from the show → refused ARTIST_PAYOUT_VIA_BALANCE (the payment is cancelled only in the artist's balance), nothing changes", unpayA.kind === "refused" && unpayA.code === "ARTIST_PAYOUT_VIA_BALANCE" && artistPaid(b));
  const statusesB = () => `${fee(b, "DJ_FEE")?.payment_status}/${artistPaid(b) ? "שולם" : "—"}`;
  t("sessions").push({ id: "r1", show_id: b, session_type: "חזרה להופעה", status: "בוצע", cost: 400 });
  await fin.syncShowFinance(getShow(b)); // what lib/writes/sessions does after a rehearsal create / edit / delete
  ok("11. a counted rehearsal (create) → the unpaid DJ row untouched; the entitlement re-prices to 1,800 (the split), the REAL payment keeps 2,000 / שולם", statusesB() === "צפוי/שולם" && artistPayTx(b)[0].amount === 2000 && ledgerPays(b)[0].amount === 2000 && earning(b)?.amount === 1800, earning(b));
  Object.assign(t("sessions").find((r) => r.id === "r1")!, { status: "בוטל" });
  await fin.syncShowFinance(getShow(b));
  ok("12. rehearsal edit (→ בוטל) → statuses unchanged", statusesB() === "צפוי/שולם");
  DB.sessions = [];
  await fin.syncShowFinance(getShow(b));
  ok("13. rehearsal delete → statuses unchanged", statusesB() === "צפוי/שולם");
  ok("14. lib/writes/sessions re-syncs a show WITHOUT an intent (never records received money)", !/syncShowFinance\(show,/.test(read("lib/writes/sessions.ts")));

  console.log("\nStatus changes");
  const entB = earning(b)!.id;
  const cancel = await W.updateShowRecord(b, { status: "בוטל" });
  ok("15. cancel → the unpaid DJ row → בוטל; the REAL artist payment stays (Finance שולם + ledger); the expected entitlement is marked NOT ACTIVE, never deleted", cancel.kind === "ok" && fee(b, "DJ_FEE")?.payment_status === "בוטל" && artistPaid(b) && earning(b)?.id === entB && inactive(earning(b)) && earning(b)?.entry_type === "הכנסות צפויות", { cancel, e: earning(b) });
  await W.updateShowRecord(b, { status: "אושרה" });
  ok("16. back to אושרה → the cancelled DJ row → צפוי; the SAME entitlement row is active again; the payment unchanged", fee(b, "DJ_FEE")?.payment_status === "צפוי" && earning(b)?.id === entB && !inactive(earning(b)) && artistPaid(b));
  await W.updateShowRecord(b, { dj_fee: 0 });
  ok("17. DJ fee → 0 → the unpaid DJ row → בוטל", fee(b, "DJ_FEE")?.payment_status === "בוטל");

  console.log("\nClosure flags write only what the Owner chose");
  const c = await newShow();
  await W.setShowFeePaid(c, "DJ_FEE", true, {});
  const cl = await W.closeShowRecord(c, { markDone: true, incomeReceived: true, djPaid: false });
  ok("18. close with djPaid = false keeps an already-paid DJ שולם; the entitlement becomes REAL (הכנסות 1,250, the same row) with no payment; income = the remainder once", cl.kind === "ok" && getShow(c).status === "בוצע" && fee(c, "DJ_FEE")?.payment_status === "שולם" && earning(c)?.entry_type === "הכנסות" && earning(c)?.amount === 1250 && ledgerPays(c).length === 0 && artistPayTx(c).length === 0 && receivedTotal(c) === 3000 && paymentRows(c) === 1, { cl, e: earning(c) });
  // Phase 1 (2026-10-03): closing never pays the artist — a close writes NO Finance שכר אמן row and NO ledger payment (the entitlement is only realized)
  const cl2 = await W.closeShowRecord(c, { markDone: true, incomeReceived: true, djPaid: false });
  ok("19. Phase 1 (2026-10-03): closing again → NO artist payment is written (no Finance שכר אמן row, no ledger payment); no second income; the entitlement stays realized", cl2.kind === "ok" && artistPayTx(c).length === 0 && ledgerPays(c).length === 0 && earning(c)?.entry_type === "הכנסות" && earning(c)?.amount === 1250 && receivedTotal(c) === 3000 && paymentRows(c) === 1, { cl2, tx: artistPayTx(c), led: ledgerPays(c) });
  const snapC = JSON.stringify(DB);
  const clBad = await W.updateShowRecord(c, { closeShow: { markDone: true, incomeReceived: true, djPaid: false, artistPaid: true } } as never);
  ok("19b. Phase 1 (2026-10-03): artistPaid in the close body → refused ARTIST_PAYOUT_VIA_BALANCE before any write (even false is refused)", clBad.kind === "refused" && (clBad as { code: string }).code === "ARTIST_PAYOUT_VIA_BALANCE" && JSON.stringify(DB) === snapC && ((await W.updateShowRecord(c, { closeShow: { markDone: true, incomeReceived: true, djPaid: false, artistPaid: false } } as never)) as { code?: string }).code === "ARTIST_PAYOUT_VIA_BALANCE" && ((await W.updateShowRecord(c, { artistPaidDate: "2026-10-16" } as never)) as { code?: string }).code === "ARTIST_PAYOUT_VIA_BALANCE" && JSON.stringify(DB) === snapC, clBad);
  const d = await newShow();
  await W.closeShowRecord(d, { markDone: true, incomeReceived: false, djPaid: true });
  ok("20. close 'not received' + DJ paid → the DJ row שולם, no income recorded, no artist payment (the entitlement realized, owed)", fee(d, "DJ_FEE")?.payment_status === "שולם" && receivedTotal(d) === 0 && ledgerPays(d).length === 0 && earning(d)?.entry_type === "הכנסות");

  console.log("\nExplicit fee writer (setShowFeePaid)");
  ok("21. already paid → refused", (await W.setShowFeePaid(d, "DJ_FEE", true, {})).kind === "refused");
  const un = await W.setShowFeePaid(d, "DJ_FEE", false, {});
  ok("22. the explicit undo → צפוי, dated the show date again", un.kind === "ok" && fee(d, "DJ_FEE")?.payment_status === "צפוי" && fee(d, "DJ_FEE")?.date === getShow(d).date);
  const lead = SHOW({ status: "ליד חדש" }); t("shows").push(lead);
  const nr = await W.setShowFeePaid(String(lead.id), "ARTIST_FEE", true, {});
  ok("23. Phase 1 (2026-10-03): a lead (not confirmed) → the artist cannot be paid for it from the show: refused ARTIST_PAYOUT_VIA_BALANCE, nothing created", nr.kind === "refused" && nr.code === "ARTIST_PAYOUT_VIA_BALANCE" && txOf(String(lead.id)).length === 0 && artistPayTx(String(lead.id)).length === 0 && ledgerPays(String(lead.id)).length === 0);
  ok("24. a bad role / date / method → refused", (await W.setShowFeePaid(d, "HOST", true, {})).kind === "refused" && (await W.setShowFeePaid(d, "DJ_FEE", true, { date: "27/09" })).kind === "refused" && (await W.setShowFeePaid(d, "DJ_FEE", true, { method: "קריפטו" })).kind === "refused");
  ok("25. an unknown show → not_found", (await W.setShowFeePaid(randomUUID(), "DJ_FEE", true, {})).kind === "not_found");

  console.log("\nCurrency change never re-currencies a paid fee row");
  const e = await newShow();
  await W.setShowFeePaid(e, "DJ_FEE", true, {});
  const cur = await W.updateShowRecord(e, { currency: "$" });
  ok("26. → $: the expected rows carry $; the PAID DJ row stays ₪ (+ a warning); the ₪ entitlement is marked NOT ACTIVE (the ledger is ₪ only, never converted)", cur.kind === "ok" && fee(e, "DJ_FEE")?.currency === "₪" && !fee(e, "ARTIST_FEE") && income(e).every((r) => r.currency === "$") && /מטבע/.test(String((cur as { financeWarning?: string }).financeWarning)) && inactive(earning(e)), cur);

  console.log("\nCreate");
  const created = await W.createShowRecord({ name: "חדשה", artist: "שליו טסמה", status: "אושרה", show_price: 3000, dj_fee: 500, payment_status: "שולם", advance_payment: 1000, advance_date: "2026-09-27" });
  const cid = created.show.id;
  ok("27. created as 'שולם' with a 1,000 advance → received exactly 3,000 (advance + the remainder), two payment rows, the DJ row צפוי, the artist's 1,250 an expected entitlement", receivedTotal(cid) === 3000 && paymentRows(cid) === 2 && fee(cid, "DJ_FEE")?.payment_status === "צפוי" && !fee(cid, "ARTIST_FEE") && earning(cid)?.amount === 1250 && earning(cid)?.entry_type === "הכנסות צפויות" && getShow(cid).payment_status === "שולם", income(cid));
  // Owner decision 2026-09-27 (lib/label-agreements): the 50 / 50-of-net split is ONLY for שליו / אבי — another artist gets no artist fee row
  const other = await W.createShowRecord({ name: "אחר", artist: "אמן אחר", status: "אושרה", show_price: 3000, dj_fee: 500, payment_status: "צפוי" });
  ok("27b. a show of an artist WITHOUT an agreement → the DJ row only, no artist fee row and no entitlement (never the Shalev / Avi split)", !!fee(other.show.id, "DJ_FEE") && !fee(other.show.id, "ARTIST_FEE") && !earning(other.show.id), fee(other.show.id, "ARTIST_FEE"));
  const cLead = await W.createShowRecord({ name: "ליד", status: "ליד חדש", show_price: 3000, payment_status: "שולם" });
  ok("28. a lead created as 'שולם' → no money recorded and the mirror is not a lie (לא שולם)", receivedTotal(cLead.show.id) === 0 && getShow(cLead.show.id).payment_status === "לא שולם");

  console.log("\nUI forms send payment_status only as an explicit change");
  const hub = read("components/shows/ShowsHubPreview.tsx"), drawer = read("components/shows/ShowDrawer.tsx");
  ok("29. the hub edit form sends payment_status only when the user changed it", /form\.payment_status !== initForm\.payment_status/.test(hub));
  ok("30. the show drawer sends payment_status only when the user changed it", /draft\.payment_status !== show\.payment_status/.test(drawer));
  const ws = read("lib/writes/shows.ts");
  ok("31. updateShowRecord never copies body.payment_status straight into the show", !/patch\.payment_status\s*=\s*body\.payment_status as PaymentStatus;\n/.test(ws.replace(/if \(SHOW_NO_MONEY_LABELS[^\n]*\n/, "")));
  ok("32. the sync has no mirror-based 'isPaid' path and no implicit undo branch", !/isPaid\s*=\s*show\.payment_status/.test(read("lib/shows-finance-sync.ts")) && !/Undo of ONE/.test(read("lib/shows-finance-sync.ts")));

  console.log("\nSunny: MARK_SHOW_FEE_PAID + SET_SHOW_MONEY (the real service on fakes)");
  const { mkDeps, fullFlow, OWNER, U } = await import("./fixtures/act-harness");
  const { planAction, approveAction, executeAction } = await import("../lib/partner/act/service");
  type SV = import("../lib/partner/act/primitives/shows").ShowView;
  const mkSunny = () => {
    const calls: string[] = [];
    const s: SV = { name: "הופעה", artist: "שליו טסמה", artistClientId: null, bookerName: "", bookerClientId: null, date: "2099-05-01", startTime: "21:00", location: "חיפה", contactPerson: "", phone: "", status: "בוצע", dealType: "PAID", paymentStatus: "שולם", showPrice: 3000, djFee: 500, djClientId: null, djName: "קלין", djConfirmation: null, advancePayment: 3000, notes: "", hasCalendarEvent: true, financeRows: 3, rehearsals: 0, currency: "₪", received: 3000, remaining: 0, credit: 0, payments: "3000@2099-05-02", djFeeStatus: "צפוי", djFeeAmount: 500, artistFeeStatus: "צפוי", artistFeeAmount: 1250 };
    const writers = {
      async readShow(id: string) { return id === U(1) ? { ...s } : null; },
      async setShowFeePaid(_id: string, role: string, paid: boolean) { calls.push(`fee:${role}:${paid}`); if (role === "DJ_FEE") s.djFeeStatus = paid ? "שולם" : "צפוי"; else s.artistFeeStatus = paid ? "שולם" : "צפוי"; return { kind: "ok" as const }; },
      async updateShow(_id: string, b: Record<string, unknown>) { calls.push(`update:${Object.keys(b).join(",")}`); if (typeof b.show_price === "number") { s.showPrice = b.show_price; s.remaining = Math.max(0, s.showPrice - s.received); } return { kind: "ok" as const }; },
    };
    return { s, calls, writers };
  };
  const h1 = mkSunny();
  // Phase 1 (2026-10-03): MARK_SHOW_FEE_PAID for the ARTIST is refused at planning (ARTIST_PAYOUT_VIA_BALANCE); the DJ row keeps the original flow
  const p33 = await planAction({ intentHe: "x", actionId: "MARK_SHOW_FEE_PAID", args: { show: `show:${U(1)}`, role: "ARTIST_FEE", paid: true, date: "2099-05-03" } }, OWNER, mkDeps(h1.writers).d);
  ok("33a. Phase 1 (2026-10-03): MARK_SHOW_FEE_PAID ARTIST_FEE → refused ARTIST_PAYOUT_VIA_BALANCE at planning, ZERO writes", p33.status !== "PREVIEW" && JSON.stringify(p33).includes("ARTIST_PAYOUT_VIA_BALANCE") && h1.calls.length === 0 && h1.s.artistFeeStatus === "צפוי", p33.status);
  const r1 = await fullFlow(mkDeps(h1.writers).d, "MARK_SHOW_FEE_PAID", { show: `show:${U(1)}`, role: "DJ_FEE", paid: true, date: "2099-05-03" }, "מאשר");
  ok("33. MARK_SHOW_FEE_PAID happy path (DJ row) → only the DJ fee row is written; the client money and the artist row untouched", r1.e?.status === "APPLIED_AS_EXPECTED" && h1.s.djFeeStatus === "שולם" && h1.s.artistFeeStatus === "צפוי" && h1.s.received === 3000 && h1.calls.join() === "fee:DJ_FEE:true", { e: r1.e?.status, calls: h1.calls });
  const h2 = mkSunny(); const d2 = mkDeps(h2.writers).d;
  const p2 = await planAction({ intentHe: "x", actionId: "MARK_SHOW_FEE_PAID", args: { show: `show:${U(1)}`, role: "DJ_FEE", paid: true } }, OWNER, d2);
  h2.s.djFeeStatus = "שולם"; // paid in Finance meanwhile
  const a2 = await approveAction({ planId: p2.planId, planHash: p2.planHash, confirmationText: "מאשר" }, OWNER, d2);
  const e2 = await executeAction({ planId: p2.planId, approvalToken: a2.approvalToken, confirmationText: "מאשר" }, OWNER, d2);
  ok("34. MARK_SHOW_FEE_PAID stale (paid elsewhere after the preview) → STALE, no write", e2.status === "STALE" && h2.calls.length === 0, e2.status);
  const h3 = mkSunny(); const d3 = mkDeps(h3.writers).d;
  const p3 = await planAction({ intentHe: "x", actionId: "MARK_SHOW_FEE_PAID", args: { show: `show:${U(1)}`, role: "DJ_FEE", paid: true } }, OWNER, d3);
  const e3 = await executeAction({ planId: p3.planId, approvalToken: "", confirmationText: "" }, OWNER, d3);
  ok("35. MARK_SHOW_FEE_PAID without approval → no write", e3.status === "REFUSED" && h3.calls.length === 0);
  const h4 = mkSunny();
  const p4 = JSON.stringify(await planAction({ intentHe: "x", actionId: "SET_SHOW_MONEY", args: { show: `show:${U(1)}`, showPrice: 3500 } }, OWNER, mkDeps(h4.writers).d));
  ok("36. SET_SHOW_MONEY preview discloses the calendar event update and the artist ledger (realized income not re-synced after the close)", /יומן/.test(p4) && /שינוי מחיר מעדכן אותו/.test(p4) && /לא מסונכרנת מחדש אחרי הסגירה/.test(p4) && /לעולם לא רושם הכנסה/.test(p4));
  const h5 = mkSunny();
  const p5 = await planAction({ intentHe: "x", actionId: "SET_SHOW_MONEY", args: { show: `show:${U(1)}`, paymentStatus: "לא שולם" } }, OWNER, mkDeps(h5.writers).d);
  ok("37. SET_SHOW_MONEY 'לא שולם' (an implicit undo) is refused — never planned", p5.status !== "PREVIEW" && h5.calls.length === 0, p5.status);

  console.log("\nPaid DJ / artist fees are never deleted by a revert / delete (SHW_PAID_FEE_DELETED_ON_REVERT)");
  const snap = () => JSON.stringify(DB);
  const g = await newShow();
  await W.setShowFeePaid(g, "DJ_FEE", true, { date: "2026-10-16" });
  const s38 = snap();
  const rv = await W.updateShowRecord(g, { status: "ממתין לתשובה" });
  ok("38. revert to a lead with a PAID DJ fee (no client payment) → refused HAS_PAID_FEES with the Hebrew message, ZERO writes", rv.kind === "refused" && (rv as { code: string }).code === "HAS_PAID_FEES" && /כבר סומן כשולם/.test((rv as { messageHe: string }).messageHe) && /לא מוחקים כסף שיצא/.test((rv as { messageHe: string }).messageHe) && snap() === s38 && getShow(g).status === "אושרה", rv);
  const dl = await W.deleteShowRecord(g);
  ok("39. deleteShowRecord with a paid DJ fee → has_paid_fees, ZERO writes (the show + every row stay)", dl.kind === "has_paid_fees" && snap() === s38, dl);
  const dc = await W.deleteShowCompletely(g);
  ok("40. deleteShowCompletely (hub / Sunny) with a paid DJ fee → has_paid_fees before calendar / tasks / finance, ZERO writes", dc.kind === "has_paid_fees" && snap() === s38, dc);
  const gA = await newShow();
  // Phase 1 (2026-10-03): the paid artist fee exists only as a real balance payment (recordArtistPayment) — setShowFeePaid ARTIST is refused
  await recordArtistPayment({ artistId: SHALEV, amount: 2000, date: "2026-10-16", showId: gA, idempotencyKey: `show:${gA}`, description: "תשלום — הופעה", allowDuplicate: true });
  const sA = snap();
  const rvA = await W.updateShowRecord(gA, { status: "ליד חדש" });
  ok("41. a PAID artist fee (a real balance payment linked to the show) refuses the revert the same way (ZERO writes)", rvA.kind === "refused" && (rvA as { code: string }).code === "HAS_PAID_FEES" && /אמן/.test((rvA as { messageHe: string }).messageHe) && snap() === sA, rvA);
  const gL = await newShow();
  const djRow = fee(gL, "DJ_FEE")!;
  Object.assign(djRow, { payment_status: "שולם", show_id: null, show_money_role: null }); // a legacy row, linked only by the show's stored id
  const sL = snap();
  const rvL = await W.updateShowRecord(gL, { status: "ליד חדש" });
  ok("42. a legacy paid fee row linked only by linked_dj_expense_transaction_id → refused too, ZERO writes", rvL.kind === "refused" && (rvL as { code: string }).code === "HAS_PAID_FEES" && snap() === sL, rvL);
  const dfL = await fin.deleteShowFinance(getShow(gL));
  ok("43. last guard: deleteShowFinance itself never deletes a שולם row (the paid DJ row stays; the unpaid expected balance goes — no artist-fee row exists any more)", t("transactions").some((r) => r.id === djRow.id) && txOf(gL).length === 0 && dfL === 1, { dfL, rows: txOf(gL) });
  const u = await newShow();
  const ru = await W.updateShowRecord(u, { status: "ממתין לתשובה" });
  ok("44. unpaid fees → revert allowed as before: the expected balance + unpaid DJ row are removed, the links cleared; the entitlement is marked NOT ACTIVE (kept)", ru.kind === "ok" && getShow(u).status === "ממתין לתשובה" && txOf(u).length === 0 && !getShow(u).linked_dj_expense_transaction_id && !getShow(u).linked_artist_expense_transaction_id && inactive(earning(u)), earning(u));
  const u2 = await newShow();
  const du = await W.deleteShowRecord(u2);
  ok("45. unpaid fees → delete allowed as before: the show and its expected rows (balance + DJ) are gone; the entitlement is kept NOT ACTIVE (no ledger delete)", du.kind === "ok" && (du as { deletedTransactions: number }).deletedTransactions === 2 && !t("shows").some((r) => r.id === u2) && txOf(u2).length === 0 && inactive(earning(u2)), du);
  const route = read("app/api/shows/[id]/route.ts");
  ok("46. the DELETE route answers has_paid_fees with 409 + the writer's Hebrew message; PATCH refusals are 409", /has_paid_fees[\s\S]{0,120}status: 409/.test(route) && /r\.kind === "refused"[^\n]*409/.test(route));
  const mkUnpaidClient = (djFeeStatus: string, artistFeeStatus: string) => {
    const calls: string[] = [];
    const s: SV = { name: "הופעה", artist: "שליו טסמה", artistClientId: null, bookerName: "", bookerClientId: null, date: "2099-05-01", startTime: "21:00", location: "חיפה", contactPerson: "", phone: "", status: "אושרה", dealType: "PAID", paymentStatus: "צפוי", showPrice: 3000, djFee: 500, djClientId: null, djName: "קלין", djConfirmation: null, advancePayment: 0, notes: "", hasCalendarEvent: false, financeRows: 3, rehearsals: 0, currency: "₪", received: 0, remaining: 3000, credit: 0, payments: "", djFeeStatus, djFeeAmount: 500, artistFeeStatus, artistFeeAmount: 1250 };
    const writers = {
      async readShow(id: string) { return id === U(1) ? { ...s } : null; },
      async updateShow(_id: string, b: Record<string, unknown>) { calls.push(`update:${Object.keys(b).join(",")}`); return { kind: "ok" as const }; },
      async deleteShowCompletely() { calls.push("delete"); return { kind: "ok" as const }; },
    };
    return { calls, writers };
  };
  const hp = mkUnpaidClient("שולם", "צפוי");
  const pRev = await planAction({ intentHe: "x", actionId: "MOVE_SHOW_TO_PIPELINE", args: { show: `show:${U(1)}`, status: "ליד חדש" } }, OWNER, mkDeps(hp.writers).d);
  const pDel = await planAction({ intentHe: "x", actionId: "DELETE_SHOW", args: { show: `show:${U(1)}` } }, OWNER, mkDeps(hp.writers).d);
  ok("47. Sunny MOVE_SHOW_TO_PIPELINE / DELETE_SHOW with a paid DJ fee → refused HAS_PAID_FEES before any preview, no write", pRev.status !== "PREVIEW" && pDel.status !== "PREVIEW" && JSON.stringify(pRev).includes("HAS_PAID_FEES") && JSON.stringify(pDel).includes("HAS_PAID_FEES") && JSON.stringify(pDel).includes("לא מוחקים כסף שיצא") && hp.calls.length === 0, { pRev, pDel });
  const hu = mkUnpaidClient("צפוי", "צפוי");
  const pRevU = await planAction({ intentHe: "x", actionId: "MOVE_SHOW_TO_PIPELINE", args: { show: `show:${U(1)}`, status: "ליד חדש" } }, OWNER, mkDeps(hu.writers).d);
  const pDelU = await planAction({ intentHe: "x", actionId: "DELETE_SHOW", args: { show: `show:${U(1)}` } }, OWNER, mkDeps(hu.writers).d);
  ok("48. …with unpaid fees → both are previewed as before (the preview says a paid fee would refuse); nothing written at plan time", pRevU.status === "PREVIEW" && pDelU.status === "PREVIEW" && JSON.stringify(pRevU).includes("HAS_PAID_FEES") && hu.calls.length === 0, { pRevU: pRevU.status, pDelU: pDelU.status });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
