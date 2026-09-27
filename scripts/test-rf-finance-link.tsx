/**
 * DB-1 (Owner-approved, live 2026-09-27) — a Red Films payment = real money → exactly ONE linked Finance expense
 * (red_films_budget_payments.linked_transaction_id UNIQUE). Proves, with the REAL shared writers on an in-memory Supabase
 * (UNIQUE emulated) and the REAL pure rules / Sunny views / primitives:
 *   1. linkRfPaymentToFinance creates exactly one expense with the exact fields; a re-run is ALREADY_LINKED (idempotent);
 *      a lost compare-and-swap race removes the new expense and returns the existing link (one tx);
 *   2. non-clip → SCOPE_REQUIRED, clip without project → PROJECT_REQUIRED, zero writes; category only from Finance's list;
 *   3. duplicate awareness: a similar UNLINKED Finance expense (±14 days) or the line's legacy Finance row → POSSIBLE_DUPLICATE;
 *      a far date / an expense owned by another payment is never a candidate; allowDuplicate (the Boss's ack) links;
 *   4. insertBudgetPayment links a new payment automatically (non-clip: recorded, unlinked, SCOPE_REQUIRED reported);
 *      updateBudgetPayment propagates amount / date / method; deleteBudgetPayment deletes the linked expense;
 *   5. Finance ownership RF_PAYMENT: notes only, delete / amount refused (the Finance route's guard);
 *   6. readers: Finance Brain RED_FILMS_OUTSIDE_FINANCE counts only unlinked; the video view, the label clips (A/B/C) and the
 *      operations capability never add a linked payment beside its expense;
 *   7. LINK_RF_PAYMENT_TO_FINANCE / LINK_RF_PAYMENTS_FOR_PRODUCTION through the REAL service + REAL writer: happy + exact
 *      verification, stale, no approval, duplicate → ack → linked, bulk exact set.
 * Run with:   npx tsx scripts/test-rf-finance-link.tsx      Pure; never touches production.
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const section = (s: string) => console.log(`\n${s}`);

// ── in-memory Supabase (UNIQUE on red_films_budget_payments.linked_transaction_id) ──────────────────────────────────
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const log: string[] = [];
let seq = 0;
let beforeLinkCas: (() => void) | null = null; // simulate a concurrent linker right before the compare-and-swap
const T = (t: string) => (db[t] ??= []);
function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: "select" | "delete" | "update" | "insert" = "select";
  let patch: Row = {}; let rows: Row[] = []; let head = false; let returning = false; let single: "one" | "maybe" | null = null; let lim: number | null = null;
  const q = {
    select(_c?: string, o?: { count?: string; head?: boolean }) { if (op === "select") head = !!o?.head; else returning = true; return q; },
    eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
    in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q; },
    is(c: string, _v: null) { filters.push((r) => r[c] === null || r[c] === undefined); return q; },
    not(c: string, _o: string, _v: null) { filters.push((r) => r[c] !== null && r[c] !== undefined); return q; },
    like(c: string, p: string) { const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`); filters.push((r) => re.test(String(r[c] ?? ""))); return q; },
    order() { return q; }, limit(n: number) { lim = n; return q; },
    delete() { op = "delete"; return q; },
    update(p: Row) { op = "update"; patch = p; return q; },
    insert(r: Row | Row[]) { op = "insert"; rows = Array.isArray(r) ? r : [r]; return q; },
    maybeSingle() { single = "maybe"; return q; }, single() { single = "one"; return q; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve().then(run).then(res, rej); },
  };
  function run() {
    if (op === "update" && table === "red_films_budget_payments" && "linked_transaction_id" in patch && beforeLinkCas) { const f = beforeLinkCas; beforeLinkCas = null; f(); }
    let match = T(table).filter((r) => filters.every((f) => f(r)));
    if (lim !== null) match = match.slice(0, lim);
    if (op === "select") {
      if (head) return { data: null, error: null, count: match.length };
      const data = match.map((r) => ({ ...r }));
      return single ? { data: data[0] ?? null, error: single === "one" && !data.length ? { message: "no rows" } : null } : { data, error: null };
    }
    if (op === "delete") { log.push(`delete:${table}:${match.map((r) => r.id).join(",")}`); db[table] = T(table).filter((r) => !match.includes(r)); if (table === "transactions") for (const p of T("red_films_budget_payments")) if (match.some((m) => m.id === p.linked_transaction_id)) p.linked_transaction_id = null; return { data: null, error: null }; }
    if (op === "update") {
      if (table === "red_films_budget_payments" && patch.linked_transaction_id && T(table).some((r) => r.linked_transaction_id === patch.linked_transaction_id && !match.includes(r))) return { data: null, error: { code: "23505", message: "duplicate key (UNIQUE linked_transaction_id)" } };
      log.push(`update:${table}:${Object.keys(patch).filter((k) => k !== "updated_at").join("+")}`); for (const r of match) Object.assign(r, patch);
      const data = match.map((r) => ({ ...r })); return { data: returning ? (single ? data[0] ?? null : data) : null, error: null };
    }
    const made = rows.map((r) => ({ id: `${table === "transactions" ? "tx" : "row"}-${++seq}`, ...r }));
    for (const r of made) T(table).push(r);
    log.push(`insert:${table}`);
    return { data: returning ? (single ? { ...made[0] } : made.map((r) => ({ ...r }))) : null, error: null };
  }
  return q;
}
const fakeSupabase = { from: (t: string) => builder(t) };
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "@/lib/projects-store") return { touchProject: async () => {} };
  if (/(^|\/)supabase$/.test(request)) return { supabase: fakeSupabase };
  return orig.call(this, request, parent, isMain);
};

const P = { clip: "p-clip", noProj: "p-noproj", show: "p-show", other: "p-other" };
const seed = () => {
  for (const k of Object.keys(db)) delete db[k];
  log.length = 0; beforeLinkCas = null;
  Object.assign(db, {
    projects: [{ id: "proj-1", name: "קרוב אלייך" }],
    red_films_productions: [
      { id: P.clip, title: "קליפ שליו", production_type: "קליפ", project_id: "proj-1", artist_name: "שליו", status: "בתכנון", general_budget: 5000, currency: "₪" },
      { id: P.noProj, title: "קליפ יתום", production_type: "קליפ", project_id: null, status: "רעיון" },
      { id: P.show, title: "צילום הופעה", production_type: "צילום הופעה", project_id: "proj-1", status: "רעיון" },
    ],
    red_films_budget_items: [
      { id: "L-photo", production_id: P.clip, title: "צלם", category: "צלם", currency: "₪", linked_transaction_id: null },
      { id: "L-gear", production_id: P.clip, title: "מצלמה", category: "ציוד", currency: "$", linked_transaction_id: null },
      { id: "L-np", production_id: P.noProj, title: "צלם", category: "צלם", currency: "₪", linked_transaction_id: null },
      { id: "L-show", production_id: P.show, title: "צלם", category: "צלם", currency: "₪", linked_transaction_id: null },
    ],
    red_films_budget_payments: [
      { id: "pay-1", production_id: P.clip, budget_item_id: "L-photo", amount: 1000, currency: "₪", payment_date: "2026-09-10", payment_method: "העברה בנקאית", notes: "", linked_transaction_id: null },
      { id: "pay-2", production_id: P.clip, budget_item_id: "L-gear", amount: 300, currency: "$", payment_date: "2026-09-12", payment_method: "PayPal", notes: "", linked_transaction_id: null },
      { id: "pay-np", production_id: P.noProj, budget_item_id: "L-np", amount: 200, currency: "₪", payment_date: "2026-09-05", payment_method: "", notes: "", linked_transaction_id: null },
      { id: "pay-show", production_id: P.show, budget_item_id: "L-show", amount: 400, currency: "₪", payment_date: "2026-09-06", payment_method: "", notes: "", linked_transaction_id: null },
    ],
    transactions: [], shows: [], sound_engineer_work: [], clip_items: [], social_promotions: [], settings: [],
  });
};
const txs = () => T("transactions");
const pay = (id: string) => T("red_films_budget_payments").find((p) => p.id === id)!;
const mutations = () => log.filter((l) => !l.startsWith("select"));

(async () => {
  const L = await import("../lib/writes/rf-finance-link");
  const RF = await import("../lib/writes/redfilms");
  const FIN = await import("../lib/writes/finance");
  const OWN = await import("../lib/finance/ownership");
  const PURE = await import("../lib/clip-rf-money-pure");

  section("1. one payment → exactly ONE Finance expense (exact fields), idempotent, race-safe");
  seed();
  const r1 = await L.linkRfPaymentToFinance("pay-1");
  const t1 = txs()[0];
  ok("link creates exactly one expense: type expense, שולם, ₪1000 (payment currency), date + method, the production's project, scope קליפ, category empty (צלם is not a Finance category) + the line category in the description, notes [Red Films payment id]",
    r1.kind === "LINKED" && txs().length === 1 && t1.type === "expense" && t1.payment_status === "שולם" && t1.amount === 1000 && t1.currency === "₪" && t1.date === "2026-09-10" && t1.payment_method === "העברה בנקאית" && t1.project_id === "proj-1" && t1.scope === "project" && t1.expense_scope === "קליפ" && t1.category === "" && t1.description === "Red Films — קליפ שליו — צלם" && t1.notes === "[Red Films payment pay-1]", { r1, t1 });
  ok("the payment is linked to it (linked_transaction_id = the new expense)", pay("pay-1").linked_transaction_id === t1.id);
  log.length = 0;
  const r1b = await L.linkRfPaymentToFinance("pay-1");
  ok("re-run → ALREADY_LINKED with the same transaction, zero writes (idempotent)", r1b.kind === "ALREADY_LINKED" && r1b.transactionId === t1.id && txs().length === 1 && mutations().length === 0, { r1b, log });
  const r2 = await L.linkRfPaymentToFinance("pay-2");
  const t2 = txs().find((t) => t.id === (r2 as { transactionId: string }).transactionId)!;
  ok("a $ payment → a $ expense (no FX); a Finance category (ציוד) is kept", r2.kind === "LINKED" && t2.currency === "$" && t2.amount === 300 && t2.category === "ציוד" && t2.description === "Red Films — קליפ שליו — מצלמה", t2);
  // race: another linker sets the link between our insert and our compare-and-swap
  seed();
  beforeLinkCas = () => { T("transactions").push({ id: "tx-other", type: "expense", amount: 1000, currency: "₪", project_id: "proj-1" }); pay("pay-1").linked_transaction_id = "tx-other"; };
  const rr = await L.linkRfPaymentToFinance("pay-1");
  ok("race: the CAS finds the payment already linked → the just-created expense is deleted and the existing link returned (ONE expense)", rr.kind === "ALREADY_LINKED" && rr.transactionId === "tx-other" && txs().length === 1 && txs()[0].id === "tx-other" && pay("pay-1").linked_transaction_id === "tx-other", { rr, txs: txs() });
  // UNIQUE guard: the tx id is already used by another payment
  seed();
  const lw = read("lib/writes/rf-finance-link.ts");
  ok("the link is a compare-and-swap (.is(linked_transaction_id, null)) and a lost race deletes the new expense; the UNIQUE constraint is the final guard", /\.update\(\{ linked_transaction_id: txId[\s\S]{0,80}\.is\("linked_transaction_id", null\)/.test(lw) && /await deleteTransactionRecord\(txId\)/.test(lw));

  section("2. SCOPE_REQUIRED / PROJECT_REQUIRED — nothing is invented");
  seed();
  const rs = await L.linkRfPaymentToFinance("pay-show");
  ok("a non-clip production → SCOPE_REQUIRED, zero writes (never a silent כללי)", rs.kind === "SCOPE_REQUIRED" && txs().length === 0 && mutations().length === 0 && pay("pay-show").linked_transaction_id === null, { rs, log });
  const rp = await L.linkRfPaymentToFinance("pay-np");
  ok("a clip production without a project → PROJECT_REQUIRED, zero writes", rp.kind === "PROJECT_REQUIRED" && txs().length === 0);
  ok("NOT_FOUND for a missing payment", (await L.linkRfPaymentToFinance("nope")).kind === "NOT_FOUND");
  ok("the Finance category list is pinned to the Finance screen's project expense categories", read("components/finance/FinancePage.tsx").includes(`const PROJECT_EXPENSE_CATEGORIES = [${L.FINANCE_PROJECT_EXPENSE_CATEGORIES.map((c) => `"${c}"`).join(", ")}]`));

  section("3. duplicate awareness (same project / amount / currency, ±14 days, similar text)");
  seed();
  T("transactions").push({ id: "tx-manual", project_id: "proj-1", type: "expense", amount: 1000, currency: "₪", date: "2026-09-15", description: "צלם לקליפ של שליו", notes: "", payment_status: "שולם" });
  const rd = await L.linkRfPaymentToFinance("pay-1");
  ok("a similar unlinked expense 5 days away → POSSIBLE_DUPLICATE (candidate shown), nothing written", rd.kind === "POSSIBLE_DUPLICATE" && rd.candidates[0]?.level === "LIKELY_SAME" && rd.candidates[0].date === "2026-09-15" && txs().length === 1 && pay("pay-1").linked_transaction_id === null, rd);
  const ra = await L.linkRfPaymentToFinance("pay-1", { allowDuplicate: true });
  ok("after the Boss's 'additional' decision (allowDuplicate) → linked (a second, separate expense)", ra.kind === "LINKED" && txs().length === 2);
  seed();
  T("transactions").push({ id: "tx-far", project_id: "proj-1", type: "expense", amount: 1000, currency: "₪", date: "2026-10-20", description: "צלם", notes: "" });
  ok("the same text 40 days away is not a duplicate → linked", (await L.linkRfPaymentToFinance("pay-1")).kind === "LINKED");
  seed();
  T("transactions").push({ id: "tx-owned", project_id: "proj-1", type: "expense", amount: 1000, currency: "₪", date: "2026-09-10", description: "Red Films — קליפ שליו — צלם", notes: "" });
  T("red_films_budget_payments").push({ id: "pay-x", production_id: P.clip, budget_item_id: "L-photo", amount: 1000, currency: "₪", payment_date: "2026-09-10", linked_transaction_id: "tx-owned" });
  ok("an expense already owned by ANOTHER Red Films payment is never a candidate → linked (a separate payment)", (await L.linkRfPaymentToFinance("pay-1")).kind === "LINKED");
  seed();
  T("transactions").push({ id: "tx-line", project_id: "proj-1", type: "expense", amount: 3000, currency: "₪", date: "2026-08-01", description: "צלם (שורה)" });
  (T("red_films_budget_items").find((l) => l.id === "L-photo")!).linked_transaction_id = "tx-line";
  const rl = await L.linkRfPaymentToFinance("pay-1");
  ok("the budget line's legacy Finance row is ALWAYS a candidate (possible same money) → POSSIBLE_DUPLICATE", rl.kind === "POSSIBLE_DUPLICATE" && /שורת התקציב כבר מקושרת/.test(rl.candidates[0]?.text ?? ""), rl);

  section("4. the screens' payment writers: auto-link, propagate, delete together");
  seed();
  const ins = await RF.insertBudgetPayment("L-photo", { amount: 450, paymentDate: "2026-09-20", paymentMethod: "ביט", notes: "מקדמה" });
  const insTx = ins.kind === "ok" && ins.financeLink.state === "LINKED" ? txs().find((t) => t.id === (ins.financeLink as { transactionId: string }).transactionId) : null;
  ok("a new payment on a clip production with a project is linked automatically to ONE expense (₪450, שולם, קליפ)", ins.kind === "ok" && ins.financeLink.state === "LINKED" && !!insTx && insTx.amount === 450 && insTx.payment_status === "שולם" && insTx.expense_scope === "קליפ" && ins.payment.linked_transaction_id === insTx.id && txs().length === 1, ins);
  const insS = await RF.insertBudgetPayment("L-show", { amount: 90, paymentDate: "2026-09-20", paymentMethod: "", notes: "" });
  ok("a new payment on a non-clip production is recorded, stays unlinked, and SCOPE_REQUIRED is reported", insS.kind === "ok" && insS.financeLink.state === "SCOPE_REQUIRED" && !insS.payment.linked_transaction_id && txs().length === 1 && T("red_films_budget_payments").some((p) => p.amount === 90), insS);
  const newPayId = String((ins as { payment: Row }).payment.id);
  await RF.updateBudgetPayment(newPayId, { amount: 500, payment_date: "2026-09-21", payment_method: "מזומן" });
  ok("editing the payment propagates amount / date / method to its linked expense", insTx!.amount === 500 && insTx!.date === "2026-09-21" && insTx!.payment_method === "מזומן", insTx);
  const del = await RF.deleteBudgetPayment(newPayId);
  ok("deleting the payment deletes its linked expense (one money fact)", del.deletedTransactionId === insTx!.id && !txs().some((t) => t.id === insTx!.id) && !T("red_films_budget_payments").some((p) => p.id === newPayId));
  ok("the route returns the link outcome and uses the shared writers", /financeLink: ins\.financeLink/.test(read("app/api/red-films/budget-items/[itemId]/payments/route.ts")) && /deleteBudgetPayment\(paymentId\)/.test(read("app/api/red-films/budget-payments/[paymentId]/route.ts")) && /updateBudgetPayment\(paymentId, body\)/.test(read("app/api/red-films/budget-payments/[paymentId]/route.ts")));

  section("5. Finance ownership: the linked expense belongs to its payment (RF_PAYMENT)");
  seed();
  const lk = await L.linkRfPaymentToFinance("pay-1"); const lkId = (lk as { transactionId: string }).transactionId;
  ok("ownerFromLinks: a payment link → RF_PAYMENT", OWN.ownerFromLinks({ rfPayment: true }) === "RF_PAYMENT" && OWN.FINANCE_OWNER_CODES.includes("RF_PAYMENT"));
  ok("Finance: notes allowed; amount / date / status refused; delete refused", OWN.transactionEditVerdict("RF_PAYMENT", ["notes"]).ok && !OWN.transactionEditVerdict("RF_PAYMENT", ["amount"]).ok && !OWN.transactionEditVerdict("RF_PAYMENT", ["date"]).ok && !OWN.transactionEditVerdict("RF_PAYMENT", ["paymentStatus"]).ok && !OWN.transactionEditVerdict("RF_PAYMENT", "delete").ok);
  ok("the Finance route's guard finds the owner from the live link (readOwnerLinks)", (await FIN.financeOwnerOf(lkId)) === "RF_PAYMENT");
  let guarded: unknown = null; try { await FIN.assertTransactionEditable(lkId, { amount: 1 }); } catch (e) { guarded = e; }
  let notesOk = true; try { await FIN.assertTransactionEditable(lkId, { notes: "אסמכתא" }); } catch { notesOk = false; }
  let delGuard: unknown = null; try { await FIN.assertTransactionEditable(lkId, "delete"); } catch (e) { delGuard = e; }
  ok("assertTransactionEditable: amount → 409 OWNED_ROW_FIELD, delete → 409 OWNED_ROW_DELETE, notes → allowed", guarded instanceof FIN.TransactionOwnedError && delGuard instanceof FIN.TransactionOwnedError && notesOk);

  section("6. readers: a linked payment is counted ONCE (in Finance)");
  const { buildFinanceBrain } = await import("../lib/partner/finance/core");
  const raw = { transactions: [], projects: [], financeSettings: [], engineerWorks: [], shows: [], proposals: [], clients: [], labelArtists: [], ledger: [], mediaIncome: [], victorSalary: [],
    redFilmsPayments: [{ id: "a", amount: 1000, paymentDate: "2026-09-10", currency: "₪", linkedTransactionId: "tx-a" }, { id: "b", amount: 700, paymentDate: "2026-09-11", currency: "₪", linkedTransactionId: null }] };
  const brain = buildFinanceBrain(raw as never, new Date("2026-09-27T09:00:00Z"));
  const sig = brain.signals.find((s) => s.code === "RED_FILMS_OUTSIDE_FINANCE");
  ok("Finance Brain RED_FILMS_OUTSIDE_FINANCE counts only the UNLINKED payment (1 of 2)", sig?.count === 1 && sig.evidence.every((e) => e.sourceId === "b"), sig);
  ok("the Finance reader selects the link column", /red_films_budget_payments", "id,amount,payment_date,currency,linked_transaction_id"/.test(read("lib/partner/finance/readers.ts")) && /linked_transaction_id/.test(read("lib/partner/operations/readers.ts").split("red_films_budget_payments")[1].slice(0, 120)));
  ok("rfPaymentLinkage: LINKED / UNLINKED / SCOPE_REQUIRED / PROJECT_REQUIRED", PURE.rfPaymentLinkage({ linkedTransactionId: "t" }, { productionType: "צילום הופעה" }) === "LINKED" && PURE.rfPaymentLinkage({}, { productionType: "קליפ", projectId: "p" }) === "UNLINKED" && PURE.rfPaymentLinkage({}, { productionType: "יום צילום", projectId: "p" }) === "SCOPE_REQUIRED" && PURE.rfPaymentLinkage({ hasTransaction: false }, { productionType: "קליפ", projectId: null }) === "PROJECT_REQUIRED");
  // the video view: ledger 1700 = linked 1000 (inside the Finance clip expenses) + outside 700; Finance paid = 1000 only
  const VIEW = await import("../lib/partner/redfilms/view");
  const prodA = { id: "A", title: "קליפ", productionType: "קליפ", status: "בתכנון", projectId: "pA", clientId: null, artistName: "x", clientSource: "פנימי - לייבל", shootDate: null, publishDate: null, editStatus: null, collectionStatus: null, generalBudget: 3000, clientPrice: null, advanceRequired: null, advanceReceived: null, currency: "₪" };
  const dpay = (id: string, amount: number, linked: string | null) => ({ id, productionId: "A", budgetItemId: "L1", amount, date: "2026-09-01", method: null, notes: null, receiptFileName: null, receiptMime: null, receiptPath: null, hasReceiptLink: false, currency: "₪", createdAt: null, updatedAt: null, linkedTransactionId: linked });
  const src = {
    now: new Date("2026-09-27T09:00:00Z"), identities: {},
    operations: { status: "OK", value: { redFilms: { rows: [prodA] } } },
    projectDetail: { status: "OK", value: { budgetItems: { rows: [{ id: "L1", productionId: "A", title: "צלם", category: "צלם", vendorName: null, status: "מתוכנן", planned: 2000, actual: 0, notes: null, currency: "₪", linkedTransactionId: null, createdAt: null, updatedAt: null }] }, budgetPayments: { rows: [dpay("Y1", 1000, "tx-y1"), dpay("Y2", 700, null)] }, clipItems: { rows: [] }, sessions: { rows: [] }, tasks: { rows: [] }, productions: { rows: [] }, rfDocuments: { rows: [] }, rfRefImages: { rows: [] }, rfRefLinks: { rows: [] }, rfCrew: { rows: [] }, contentItems: { rows: [] } } },
    finance: { status: "OK", value: { raw: { transactions: [{ id: "tx-y1", projectId: "pA", type: "expense", date: "2026-09-01", amount: 1000, currency: "₪", status: "שולם", category: null, scope: "project", expenseScope: "קליפ", linkedSessionId: null, createdAt: null }], financeSettings: [] } } },
  } as never;
  const vA = VIEW.buildProduction(src, prodA as never);
  const pvA = VIEW.buildProjectVideo(src, "pA");
  const vv = VIEW.buildVideoView(src);
  ok("video view: ledger ₪1700 = linked ₪1000 (inside Finance) + outside ₪700; per payment LINKED / UNLINKED", vA.money.paidRedFilmsLedger["₪"] === 1700 && vA.money.paidLinkedInFinance["₪"] === 1000 && vA.money.paidOutsideFinance["₪"] === 700 && vA.money.payments.map((p) => p.financeLinkage).join() === "LINKED,UNLINKED" && vA.money.linkage.linked === 1 && vA.money.linkage.unlinked === 1, vA.money);
  ok("the project's actual clip cost (Finance) includes the linked payment ONCE (₪1000) — never ledger + Finance (₪2700)", pvA.expenses.paid["₪"] === 1000 && vv.money.actualClipExpenses.paid["₪"] === 1000 && vv.money.redFilms.paidOutsideFinance["₪"] === 700);
  ok("RF_LEDGER_NOT_IN_FINANCE names only the unlinked ₪700 (not ₪1700)", vv.signals.some((s) => s.code === "RF_LEDGER_NOT_IN_FINANCE" && s.he.includes("₪700") && !s.he.includes("1700")), vv.signals.filter((s) => s.code === "RF_LEDGER_NOT_IN_FINANCE"));
  { const all = { ...(src as unknown as Record<string, unknown>) };
    const linkedAll = { ...all, projectDetail: { status: "OK", value: { ...((all.projectDetail as { value: Row }).value), budgetPayments: { rows: [dpay("Y1", 1000, "tx-y1")] } } } } as never;
    const v2 = VIEW.buildVideoView(linkedAll);
    ok("every payment linked → ALL_LINKED and no RF_LEDGER_NOT_IN_FINANCE signal", VIEW.buildProduction(linkedAll, prodA as never).money.linkage.state === "ALL_LINKED" && !v2.signals.some((s) => s.code === "RF_LEDGER_NOT_IN_FINANCE")); }
  // label clips (A / B / C): C includes the linked expense, the Red Films ledger shows only unlinked
  seed();
  (T("red_films_productions").find((p) => p.id === P.clip)!).artist_name = "שליו";
  await L.linkRfPaymentToFinance("pay-1"); // ₪1000 → Finance (שולם)
  T("red_films_budget_payments").push({ id: "pay-3", production_id: P.clip, budget_item_id: "L-photo", amount: 250, currency: "₪", payment_date: "2026-09-13", linked_transaction_id: null });
  const { listArtistClips, artistClipMoney } = await import("../lib/label-clips");
  const clips = await listArtistClips("שליו");
  const money = artistClipMoney(clips);
  ok("label clips: actual cost C = ₪1000 (the linked expense), Red Films ledger = ₪250 + $300 (unlinked only) — never ₪1250 twice", clips.length === 1 && clips[0].actualCostPaid["₪"] === 1000 && clips[0].rfLedgerPaid["₪"] === 250 && clips[0].rfLedgerPaid["$"] === 300 && money["₪"].actualCostPaid === 1000 && money["₪"].rfLedgerPaid === 250, { clips, money });
  ok("label view + operations capability + company view exclude linked payments from the 'outside Finance' numbers", /!x\.hasTransaction && clipProds/.test(read("lib/partner/label/view.ts")) && /budgetPaidOutsideFinance: bp \? sumCur\(bp\.filter\(\(x\) => !x\.hasTransaction\)/.test(read("lib/partner/knowledge/capabilities/operations.ts")) && /redFilmsOutsideFinance: video\.money\.redFilms\.paidOutsideFinance/.test(read("lib/partner/company/view.ts")));

  section("7. Sunny primitives through the REAL service + the REAL writer");
  const H = await import("./fixtures/act-harness");
  const { planAction, approveAction, executeAction } = await import("../lib/partner/act/service");
  const U = H.U;
  // uuid ids for the typed keys
  const seedU = () => {
    seed();
    const ren = (t: string, m: Record<string, string>) => { for (const r of T(t)) for (const k of ["id", "production_id", "budget_item_id", "project_id"]) if (typeof r[k] === "string" && m[r[k] as string]) r[k] = m[r[k] as string]; };
    const m: Record<string, string> = { [P.clip]: U(1), [P.noProj]: U(2), [P.show]: U(3), "L-photo": U(11), "L-gear": U(12), "L-np": U(13), "L-show": U(14), "pay-1": U(21), "pay-2": U(22), "pay-np": U(23), "pay-show": U(24), "proj-1": U(40) };
    for (const t of ["red_films_productions", "red_films_budget_items", "red_films_budget_payments", "projects"]) ren(t, m);
  };
  const writers = () => {
    const calls: string[] = [];
    const w = {
      async similarRecords() { return []; },
      async readProjectMeta(id: string) { const p = T("projects").find((x) => x.id === id); return p ? { name: String(p.name), artist: "", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
      readProductionRow: (id: string) => RF.readProductionRow(id),
      async rfPaymentLinkPlan(id: string) { const p = await L.readRfLinkPlan(id); return p.kind === "NOT_FOUND" ? null : L.rfLinkPlanView(p); },
      async rfProductionLinkPlans(pid: string) { const ps = await L.readProductionRfLinkPlans(pid); return ps ? ps.flatMap((p) => (p.kind === "NOT_FOUND" ? [] : [L.rfLinkPlanView(p)])) : null; },
      async linkRfPaymentRecord(id: string, allowDuplicate: boolean) { calls.push("link"); const r = await L.linkRfPaymentToFinance(id, { allowDuplicate }); return { kind: r.kind, ...("transactionId" in r ? { transactionId: r.transactionId } : {}) }; },
    };
    return { w, calls };
  };
  const K1 = `rf-payment:${U(21)}`;
  seedU();
  { const { w, calls } = writers(); const { d } = H.mkDeps(w);
    const f = await H.fullFlow(d, "LINK_RF_PAYMENT_TO_FINANCE", { rfPayment: K1 }, "מאשר");
    const t = txs()[0];
    ok("LINK_RF_PAYMENT_TO_FINANCE: plan → preview (the exact expense) → מאשר → execute → verified (payment linked, ONE ₪1000 שולם קליפ expense on the project)", f.p.status === "PREVIEW" && f.e?.status === "APPLIED_AS_EXPECTED" && txs().length === 1 && pay(U(21)).linked_transaction_id === t.id && t.amount === 1000 && t.project_id === U(40) && calls.length === 1 && /קרוב אלייך/.test(JSON.stringify(f.p)), f);
    const again = await planAction({ intentHe: "x", actionId: "LINK_RF_PAYMENT_TO_FINANCE", args: { rfPayment: K1 } }, H.OWNER, d);
    ok("planning it again → ALREADY_LINKED (never a second expense)", again.status === "ALREADY_LINKED" && txs().length === 1, again); }
  seedU();
  { const { w, calls } = writers(); const { d } = H.mkDeps(w);
    const p = await planAction({ intentHe: "x", actionId: "LINK_RF_PAYMENT_TO_FINANCE", args: { rfPayment: K1 } }, H.OWNER, d);
    pay(U(21)).amount = 1100; // the payment changed after the preview
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, H.OWNER, d);
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, H.OWNER, d);
    ok("stale: the payment changed after the preview → STALE, no expense", e.status === "STALE" && txs().length === 0 && calls.length === 0, e.status); }
  seedU();
  { const { w, calls } = writers(); const { d } = H.mkDeps(w);
    const p = await planAction({ intentHe: "x", actionId: "LINK_RF_PAYMENT_TO_FINANCE", args: { rfPayment: K1 } }, H.OWNER, d);
    const e = await executeAction({ planId: p.planId, approvalToken: "", confirmationText: "" }, H.OWNER, d);
    ok("no approval → no expense", e.status === "REFUSED" && txs().length === 0 && calls.length === 0); }
  seedU();
  T("transactions").push({ id: "tx-manual", project_id: U(40), type: "expense", amount: 1000, currency: "₪", date: "2026-09-12", description: "צלם קליפ", notes: "" });
  { const { w } = writers(); const { d } = H.mkDeps(w);
    const p = await planAction({ intentHe: "x", actionId: "LINK_RF_PAYMENT_TO_FINANCE", args: { rfPayment: K1 } }, H.OWNER, d);
    ok("a similar unlinked Finance expense → POSSIBLE_DUPLICATE (the Boss decides), with a duplicateAck", p.status === "POSSIBLE_DUPLICATE" && typeof (p as { duplicateAck?: unknown }).duplicateAck === "string" && txs().length === 1, p);
    const f = await H.fullFlow(d, "LINK_RF_PAYMENT_TO_FINANCE", { rfPayment: K1, separateFromSimilar: true, duplicateAck: (p as unknown as { duplicateAck: string }).duplicateAck }, "מאשר");
    ok("the Boss said 'additional' → linked as a separate expense", f.e?.status === "APPLIED_AS_EXPECTED" && txs().length === 2 && !!pay(U(21)).linked_transaction_id && pay(U(21)).linked_transaction_id !== "tx-manual", f.e); }
  seedU();
  { const { w } = writers(); const { d } = H.mkDeps(w);
    ok("a non-clip payment → SCOPE_REQUIRED through Sunny too", (await planAction({ intentHe: "x", actionId: "LINK_RF_PAYMENT_TO_FINANCE", args: { rfPayment: `rf-payment:${U(24)}` } }, H.OWNER, d)).status === "SCOPE_REQUIRED" && txs().length === 0); }
  // bulk: the Principe case — every unlinked payment of one production, all-or-nothing preview, each → its own expense
  seedU();
  T("red_films_budget_payments").push({ id: U(25), production_id: U(1), budget_item_id: U(11), amount: 150, currency: "₪", payment_date: "2026-09-14", payment_method: "ביט", linked_transaction_id: null });
  await L.linkRfPaymentToFinance(U(21)); // already linked before the bulk
  { const { w, calls } = writers(); const { d } = H.mkDeps(w);
    const f = await H.fullFlow(d, "LINK_RF_PAYMENTS_FOR_PRODUCTION", { production: `rf-production:${U(1)}` }, "מאשר");
    const pv = JSON.stringify(f.p);
    ok("LINK_RF_PAYMENTS_FOR_PRODUCTION: the preview lists the exact unlinked set (2 of 3: $300 + ₪150), 'עדכון גורף'; executed → each its own expense; the linked one untouched", f.p.status === "PREVIEW" && pv.includes("2 תשלומים → 2 הוצאות") && pv.includes("$300") && pv.includes("₪150") && pv.includes("עדכון גורף") && f.e?.status === "APPLIED_AS_EXPECTED" && calls.length === 2 && txs().length === 3 && [U(21), U(22), U(25)].every((id) => !!pay(id).linked_transaction_id) && new Set([U(21), U(22), U(25)].map((id) => pay(id).linked_transaction_id)).size === 3, { p: f.p.status, e: f.e?.status, n: txs().length }); }
  seedU();
  { const { w, calls } = writers(); const { d } = H.mkDeps(w);
    const p = await planAction({ intentHe: "x", actionId: "LINK_RF_PAYMENTS_FOR_PRODUCTION", args: { production: `rf-production:${U(1)}` } }, H.OWNER, d);
    T("red_films_budget_payments").push({ id: U(26), production_id: U(1), budget_item_id: U(11), amount: 80, currency: "₪", payment_date: "2026-09-15", linked_transaction_id: null });
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, H.OWNER, d);
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, H.OWNER, d);
    ok("bulk stale: a new payment after the preview (the fingerprinted set changed) → STALE, nothing linked", e.status === "STALE" && calls.length === 0 && txs().length === 0, e.status); }
  seedU();
  { const { w } = writers(); const { d } = H.mkDeps(w);
    ok("bulk: a project-less clip production → PROJECT_REQUIRED (all-or-nothing)", (await planAction({ intentHe: "x", actionId: "LINK_RF_PAYMENTS_FOR_PRODUCTION", args: { production: `rf-production:${U(2)}` } }, H.OWNER, d)).status === "PROJECT_REQUIRED"); }
  const { MAX_WORKFLOW_STEPS } = await import("../lib/partner/act/mcp-tools");
  ok(`a compound plan holds ≤ ${MAX_WORKFLOW_STEPS} steps — a production with more payments than that needs the bulk primitive`, MAX_WORKFLOW_STEPS === 20);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
