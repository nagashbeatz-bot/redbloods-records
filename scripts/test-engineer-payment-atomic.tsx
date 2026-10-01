/**
 * Engineer (Steven) payment — ONE ATOMIC write (Owner-approved 2026-10-01, F2 + G1).
 * The real writers (lib/sound-engineer-store updateSoundEngineerWork + lib/writes/mix reconcileEngineerExpense) run on an
 * in-memory database whose `rpc("apply_engineer_payment")` behaves like the production function proved by Stage 0
 * (31 / 31, rolled back): row lock semantics, STALE_WORK / STALE_LINK / TX_NOT_UPDATABLE, the unique link, all-or-nothing.
 * No production, no network, no push (the push module is a recorder).
 *   npx tsx scripts/test-engineer-payment-atomic.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const threw = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e) { return e as Error & { code?: string }; } };

type Row = Record<string, unknown>;
let DB: Record<string, Row[]> = {};
const t = (name: string) => (DB[name] ??= []);
const failNext: Record<string, string> = {};
/** rpc fault injection: "error" = the call fails before anything; "after-tx" = fails AFTER the tx write inside the function (must roll back); "stale:N" = N STALE_WORK answers first */
const rpcFault: { mode: "" | "error" | "after-tx" | "stale"; times: number } = { mode: "", times: 0 };
let rpcCalls: Row[] = [];
const pushes: Row[] = [];
const nPush = () => pushes.filter((p) => (p.roles as string[]).includes("steven")).length;
/** in-memory ClaimStore (what settingsClaimStore is over the settings table): read / insert / compare-and-swap */
const claimStore = new Map<string, unknown>();
const memClaimStore = {
  async read(key: string) { return claimStore.has(key) ? JSON.parse(JSON.stringify(claimStore.get(key))) : null; },
  async insert(key: string, value: unknown) { if (claimStore.has(key)) return "exists"; claimStore.set(key, JSON.parse(JSON.stringify(value))); return "ok"; },
  async cas(key: string, expected: unknown, next: unknown) { if (JSON.stringify(claimStore.get(key)) !== JSON.stringify(expected)) return false; claimStore.set(key, JSON.parse(JSON.stringify(next))); return true; },
};

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let mode: "select" | "update" | "insert" | "delete" = "select", patch: Row | null = null, ins: Row | Row[] | null = null, one = false, lim: number | null = null;
  const run = () => {
    const key = `${table}:${mode}`;
    if (failNext[key]) { const m = failNext[key]; delete failNext[key]; return { data: null, error: { message: m, code: "XX000" }, count: null }; }
    if (mode === "insert") {
      const rows: Row[] = (Array.isArray(ins) ? ins : [ins!]).map((r: Row) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
      t(table).push(...rows);
      return { data: one ? { ...rows[0] } : rows.map((r) => ({ ...r })), error: null, count: null };
    }
    let rows = t(table).filter((r) => filters.every((f) => f(r)));
    if (mode === "update") for (const r of rows) Object.assign(r, patch);
    if (mode === "delete") DB[table] = t(table).filter((r) => !rows.includes(r));
    if (lim !== null) rows = rows.slice(0, lim);
    const data = rows.map((r) => ({ ...r }));
    return { data: one ? data[0] ?? null : data, error: null, count: data.length };
  };
  const c: Record<string, unknown> = {
    select() { return c; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return c; },
    neq(k: string, v: unknown) { filters.push((r) => r[k] !== null && r[k] !== undefined && r[k] !== v); return c; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return c; },
    is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return c; },
    not(k: string, op: string, val: string) { if (op !== "in") throw new Error(`fake not.${op}`); const list = String(val).replace(/^\(|\)$/g, "").split(",").map((x) => x.trim().replace(/^"|"$/g, "")); filters.push((r) => r[k] !== null && r[k] !== undefined && !list.includes(String(r[k]))); return c; },
    like(k: string, pat: string) { const re = new RegExp("^" + pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "s"); filters.push((r) => re.test(String(r[k] ?? ""))); return c; },
    order() { return c; },
    limit(n: number) { lim = n; return c; },
    single() { one = true; const r = run() as { data: unknown; error: unknown }; return Promise.resolve(!r.error && r.data === null && mode === "select" ? { data: null, error: { message: "no row", code: "PGRST116" } } : r); },
    maybeSingle() { one = true; return Promise.resolve(run()); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return { select: () => c, insert(r: Row | Row[]) { mode = "insert"; ins = r; return c; }, update(p: Row) { mode = "update"; patch = p; return c; }, delete() { mode = "delete"; return c; } };
}

/** The production function, in memory: validations, the work row lock, STALE checks, the unique link, ALL-OR-NOTHING (snapshot + restore on any raise). */
function applyEngineerPayment(a: Row): { data: unknown; error: { message: string } | null } {
  const snap = JSON.stringify(DB);
  const raise = (m: string) => { DB = JSON.parse(snap); return { data: null, error: { message: m } }; };
  if (!["INSERT", "UPDATE"].includes(String(a.p_action))) return raise("BAD_ACTION");
  if (!["שולם", "חלקי", "לא שולם"].includes(String(a.p_payment_status))) return raise("BAD_STATUS");
  if (!["project", "general"].includes(String(a.p_scope))) return raise("BAD_SCOPE");
  if (a.p_amount == null || Number(a.p_amount) < 0 || !String(a.p_currency ?? "").trim()) return raise("BAD_AMOUNT");
  if (a.p_payment_status === "שולם" && (a.p_date == null || !a.p_set_date)) return raise("PAID_NEEDS_DATE");
  if (a.p_touch_payment && (a.p_amount_paid == null || Number(a.p_amount_paid) < 0)) return raise("BAD_PAID");
  const w = t("sound_engineer_work").find((x) => x.id === a.p_work_id);
  if (!w) return raise("WORK_NOT_FOUND");
  if (rpcFault.mode === "stale" && rpcFault.times > 0) { rpcFault.times--; return raise("STALE_WORK"); }
  if (a.p_expected_updated_at != null && w.updated_at !== a.p_expected_updated_at) return raise("STALE_WORK");
  if (String(w.linked_transaction_id ?? "") !== String(a.p_expected_linked ?? "")) return raise("STALE_LINK");
  let txId: string;
  if (a.p_action === "UPDATE") {
    if (!a.p_tx_id || a.p_tx_id !== w.linked_transaction_id) return raise("STALE_LINK");
    const tx = t("transactions").find((x) => x.id === a.p_tx_id && x.type === "expense" && x.category === "מיקס / מאסטר" && x.payment_status !== "שולם");
    if (!tx) return raise("TX_NOT_UPDATABLE");
    Object.assign(tx, { project_id: a.p_project_id, scope: a.p_scope, description: a.p_description, artist: a.p_artist, amount: a.p_amount, currency: a.p_currency, payment_status: a.p_payment_status, notes: a.p_notes });
    if (a.p_set_date) tx.date = a.p_date;
    txId = String(tx.id);
  } else {
    if (String(w.linked_transaction_id ?? "") !== "" && t("transactions").some((x) => x.id === w.linked_transaction_id)) return raise("STALE_LINK");
    txId = randomUUID();
    t("transactions").push({ id: txId, project_id: a.p_project_id, scope: a.p_scope, type: "expense", category: "מיקס / מאסטר", description: a.p_description, artist: a.p_artist, amount: a.p_amount, currency: a.p_currency, payment_status: a.p_payment_status, payment_method: "", receipt_ref: "", notes: a.p_notes, date: a.p_set_date ? a.p_date : null, linked_session_id: "", business_unit: a.p_business_unit, business_unit_source: a.p_business_unit_source, expense_scope: "כללי" });
  }
  if (rpcFault.mode === "after-tx") return raise("simulated failure after the expense write");
  if (t("sound_engineer_work").some((x) => x.id !== w.id && x.linked_transaction_id === txId)) return raise("duplicate key sound_engineer_work_linked_tx_uk");
  w.linked_transaction_id = txId;
  if (a.p_touch_payment) { w.amount_paid = a.p_amount_paid; w.payment_date = a.p_payment_date; w.updated_at = new Date().toISOString(); }
  return { data: { txId, action: a.p_action, updatedAt: w.updated_at }, error: null };
}
const rpc = async (fn: string, args: Row) => {
  rpcCalls.push({ fn, ...args });
  if (fn !== "apply_engineer_payment") return { data: null, error: { message: "unknown rpc" } };
  if (rpcFault.mode === "error") return { data: null, error: { message: "connection lost" } };
  return applyEngineerPayment(args);
};

const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|[\\/])supabase(\.[tj]sx?)?$/.test(request)) return { supabase: { from, rpc } };
  // the REAL payment-push module runs (steven-payment-notify + push-claims-pure deliverOnce); only its transport is replaced
  if (/(^|[\\/])push-claims(\.[tj]sx?)?$/.test(request)) return { settingsClaimStore: memClaimStore, pushAllowed: () => true };
  if (/(^|[\\/])push(\.[tj]sx?)?$/.test(request)) return { sendPushToRoles: async (roles: string[], payload: Row) => { pushes.push({ roles, payload }); return [{ status: "sent" }]; }, sendPushToAll: async () => { throw new Error("a test must never push to all"); } };
  return orig.call(this, request, parent, isMain);
};

const WID = "11111111-1111-4111-8111-111111111111";
const PID = "22222222-2222-4222-8222-222222222222";
const TXID = "33333333-3333-4333-8333-333333333333";
const baseWork = (o: Row = {}): Row => ({ id: WID, project_id: PID, engineer_name: "Steven", work_type: "מיקס", work_title: null, status: "אושר", agreed_price: 200, currency: "$", amount_paid: 0, payment_date: null, linked_transaction_id: TXID, sent_date: null, internal_deadline: null, files_link: null, notes: "", sort_order: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-18T17:03:55.930000+00:00", ...o });
const expectedTx = (o: Row = {}): Row => ({ id: TXID, project_id: PID, scope: "project", type: "expense", category: "מיקס / מאסטר", description: "Steven — מיקס · Song", artist: "A", amount: 200, currency: "$", payment_status: "לא שולם", payment_method: "bank", receipt_ref: "r1", notes: "owner-note", date: null, linked_session_id: "", business_unit: "STUDIO", business_unit_source: "RULE", expense_scope: "כללי", ...o });
const reset = (work: Row | null = baseWork(), tx: Row | null = expectedTx()) => {
  DB = { sound_engineer_work: work ? [work] : [], transactions: tx ? [tx] : [], projects: [{ id: PID, name: "Song", artist: "A", project_type: "שיר", project_business_type: "לקוח" }], mix_versions: [], final_files: [], settings: [] };
  for (const k of Object.keys(failNext)) delete failNext[k];
  rpcFault.mode = ""; rpcFault.times = 0; rpcCalls = []; pushes.splice(0); claimStore.clear();
};
const PAY = { amountPaid: 200, paymentDate: "2026-10-01", skipFinanceSync: true };

(async () => {
  const STORE = await import("../lib/sound-engineer-store");
  const MIX = await import("../lib/writes/mix");
  const PURE = await import("../lib/mix-payment-pure");
  const wk = () => t("sound_engineer_work")[0];
  const tx0 = () => t("transactions").find((x) => x.id === TXID) ?? t("transactions")[0];

  console.log("1 — the push rule (pure)");
  const P = PURE.shouldPushPaymentConfirmed;
  ok("push only: unpaid → paid + a COMMITTED INSERT / UPDATE + no conflict", P({ wasPaid: false, nowPaid: true, outcomeKind: "UPDATE", conflictHe: null }) && P({ wasPaid: false, nowPaid: true, outcomeKind: "INSERT", conflictHe: null }));
  ok("never on PROTECTED_PAID / NONE / REFUSED / REMOVE_UNPAID / no outcome / a conflict / already paid / not paid",
    !P({ wasPaid: false, nowPaid: true, outcomeKind: "PROTECTED_PAID", conflictHe: null }) && !P({ wasPaid: false, nowPaid: true, outcomeKind: "NONE", conflictHe: null }) && !P({ wasPaid: false, nowPaid: true, outcomeKind: "REFUSED", conflictHe: null })
    && !P({ wasPaid: false, nowPaid: true, outcomeKind: "REMOVE_UNPAID", conflictHe: null }) && !P({ wasPaid: false, nowPaid: true, outcomeKind: null, conflictHe: null }) && !P({ wasPaid: false, nowPaid: true, outcomeKind: "UPDATE", conflictHe: "x" })
    && !P({ wasPaid: true, nowPaid: true, outcomeKind: "UPDATE", conflictHe: null }) && !P({ wasPaid: false, nowPaid: false, outcomeKind: "UPDATE", conflictHe: null }));

  console.log("\n2 — Steven page 'שולם' on a completed work with its expected expense: ONE atomic write");
  reset();
  const r1 = await STORE.updateSoundEngineerWork(WID, PAY);
  ok("the work is paid with its date", r1.amountPaid === 200 && r1.paymentDate === "2026-10-01" && wk().amount_paid === 200 && wk().payment_date === "2026-10-01");
  ok("the SAME expense row became שולם (no second row), date set, amount + currency untouched", t("transactions").length === 1 && tx0().payment_status === "שולם" && tx0().date === "2026-10-01" && tx0().amount === 200 && tx0().currency === "$" && wk().linked_transaction_id === TXID);
  ok("payment_method / receipt_ref are NOT wiped; expense_scope is not written", tx0().payment_method === "bank" && tx0().receipt_ref === "r1" && tx0().expense_scope === "כללי" && tx0().category === "מיקס / מאסטר");
  ok("exactly ONE rpc call, and it carries the payment together with the expense", rpcCalls.length === 1 && rpcCalls[0].p_touch_payment === true && rpcCalls[0].p_amount_paid === 200 && rpcCalls[0].p_action === "UPDATE" && rpcCalls[0].p_tx_id === TXID);
  ok("ONE push, after the commit, with name / amount / currency / date", nPush() === 1 && (pushes[0].payload as Row).title === "Payment sent" && /Song · \$200 paid\. Thank you/.test(String((pushes[0].payload as Row).body)) && (pushes[0].roles as string[])[0] === "steven" && (pushes[1].roles as string[])[0] === "owner");

  console.log("\n3 — a repeated click: nothing written, no push");
  rpcCalls = []; pushes.splice(0); claimStore.clear();
  const snap3 = JSON.stringify(DB);
  await STORE.updateSoundEngineerWork(WID, PAY);
  ok("no push, no second expense, the expense row is unchanged", nPush() === 0 && t("transactions").length === 1 && JSON.stringify(t("transactions")) === JSON.stringify(JSON.parse(snap3).transactions));

  console.log("\n4 — the write fails: work AND expense stay untouched, NO push, the retry then succeeds once");
  for (const mode of ["error", "after-tx"] as const) {
    reset();
    rpcFault.mode = mode;
    const e = await threw(() => STORE.updateSoundEngineerWork(WID, PAY));
    ok(`[${mode}] the request fails (no silent success)`, e !== null, e?.message);
    ok(`[${mode}] work NOT paid, expense still לא שולם, no new expense, no push`, wk().amount_paid === 0 && wk().payment_date === null && tx0().payment_status === "לא שולם" && t("transactions").length === 1 && nPush() === 0);
    rpcFault.mode = "";
    await STORE.updateSoundEngineerWork(WID, PAY);
    ok(`[${mode}] retry: paid, expense שולם, exactly ONE push (the first failure did not consume the transition)`, wk().amount_paid === 200 && tx0().payment_status === "שולם" && nPush() === 1);
  }

  console.log("\n5 — a lost race: retried once, then a clear conflict — nothing written");
  reset();
  rpcFault.mode = "stale"; rpcFault.times = 1;
  await STORE.updateSoundEngineerWork(WID, PAY);
  ok("one STALE_WORK → the writer re-reads and succeeds (2 rpc calls), one push", rpcCalls.length === 2 && wk().amount_paid === 200 && nPush() === 1);
  reset();
  rpcFault.mode = "stale"; rpcFault.times = 5;
  const e5 = await threw(() => STORE.updateSoundEngineerWork(WID, PAY));
  ok("STALE twice → EngineerPaymentConflictError (code PAYMENT_CONFLICT), work + expense untouched, no push", e5 instanceof MIX.EngineerPaymentConflictError && e5.code === "PAYMENT_CONFLICT" && wk().amount_paid === 0 && tx0().payment_status === "לא שולם" && nPush() === 0, e5?.message);

  console.log("\n6 — a work without an expense row (paid in advance): INSERT, link, push once");
  reset(baseWork({ linked_transaction_id: null, status: "בתהליך" }), null);
  await STORE.updateSoundEngineerWork(WID, PAY);
  const created = t("transactions");
  ok("one new expense: expense / 'מיקס / מאסטר' / שולם / $200 / date / the project's unit, linked on the work", created.length === 1 && created[0].type === "expense" && created[0].category === "מיקס / מאסטר" && created[0].payment_status === "שולם" && created[0].amount === 200 && created[0].currency === "$" && created[0].date === "2026-10-01" && created[0].business_unit === "STUDIO" && wk().linked_transaction_id === created[0].id, created[0]);
  ok("ONE push", nPush() === 1);

  console.log("\n7 — a double click / two concurrent requests on an unlinked work: ONE expense, ONE push");
  reset(baseWork({ linked_transaction_id: null }), null);
  const results = await Promise.allSettled([STORE.updateSoundEngineerWork(WID, PAY), STORE.updateSoundEngineerWork(WID, PAY)]);
  ok("both requests answer (no error), exactly ONE expense row exists and the work is linked to it", results.every((r) => r.status === "fulfilled") && t("transactions").length === 1 && wk().linked_transaction_id === t("transactions")[0].id, results.map((r) => r.status));
  ok("ONE push in total (the loser finds the expense already paid → protected → no push)", nPush() === 1, nPush());

  console.log("\n8 — a paid expense is protected: no push, the payment still recorded, a conflict reported");
  reset(baseWork(), expectedTx({ payment_status: "שולם", date: "2026-10-01", payment_method: "paypal" }));
  const warn = console.warn; console.warn = () => {};
  await STORE.updateSoundEngineerWork(WID, PAY);
  console.warn = warn;
  ok("PROTECTED_PAID: the expense is untouched, the work payment is stored (one single UPDATE), NO rpc, NO push", tx0().payment_status === "שולם" && tx0().payment_method === "paypal" && wk().amount_paid === 200 && rpcCalls.length === 0 && nPush() === 0);

  console.log("\n9 — un-pay is still refused while the expense is שולם; and a payment-less price edit changes no payment");
  reset(baseWork({ amount_paid: 200, payment_date: "2026-10-01" }), expectedTx({ payment_status: "שולם", date: "2026-10-01" }));
  const e9 = await threw(() => STORE.updateSoundEngineerWork(WID, { amountPaid: 0, paymentDate: null, skipFinanceSync: true }));
  ok("un-pay → PaidExpenseProtectedError (409), work + expense unchanged, no rpc", e9?.code === "PAID_EXPENSE_PROTECTED" && wk().amount_paid === 200 && tx0().payment_status === "שולם" && rpcCalls.length === 0);
  reset();
  await STORE.updateSoundEngineerWork(WID, { notes: "x" });
  ok("a notes-only edit never touches payment or Finance (no rpc, no push)", wk().amount_paid === 0 && rpcCalls.length === 0 && nPush() === 0);

  console.log("\n10 — the completion / sync paths (no payment change) use the same atomic function, payment untouched");
  reset(baseWork({ linked_transaction_id: null }), null);
  const r10 = await MIX.reconcileEngineerExpense(WID, { reason: "work completed" });
  ok("expected row INSERT through the function with touch_payment=false; the work's payment fields + updated_at untouched; linked", r10.kind === "INSERT" && rpcCalls.length === 1 && rpcCalls[0].p_touch_payment === false && wk().amount_paid === 0 && wk().updated_at === "2026-09-18T17:03:55.930000+00:00" && wk().linked_transaction_id === r10.txId && t("transactions")[0].payment_status === "לא שולם");
  const r10b = await MIX.reconcileEngineerExpense(WID, { reason: "force sync", force: true });
  ok("a second sync updates the SAME row (no duplicate)", r10b.kind === "UPDATE" && t("transactions").length === 1);

  console.log("\n11 — the typed arguments (pure mapper) are narrow");
  const f = { project_id: PID, scope: "project" as const, type: "expense" as const, category: "מיקס / מאסטר", description: "d", artist: "a", amount: 200, currency: "$", payment_status: "שולם", payment_method: "", receipt_ref: "", notes: "n", date: "2026-10-01", linked_session_id: "" };
  const argsU = PURE.applyEngineerPaymentArgs({ workId: WID, expectedUpdatedAt: "ts", expectedLinked: TXID, action: "UPDATE", txId: TXID, fields: f, payment: { amountPaid: 200, paymentDate: "2026-10-01" }, unit: { business_unit: "STUDIO", business_unit_source: "RULE" } });
  ok("UPDATE args carry no payment_method / receipt_ref / expense_scope / category and no business unit", !("p_payment_method" in argsU) && !("p_receipt_ref" in argsU) && !("p_expense_scope" in argsU) && !("p_category" in argsU) && argsU.p_business_unit === null && argsU.p_business_unit_source === null);
  const { date: _d, ...unpaidFields } = { ...f, payment_status: "לא שולם" };
  ok("an unpaid re-price never sends a date (p_set_date=false); a paid write does", PURE.applyEngineerPaymentArgs({ workId: WID, expectedUpdatedAt: null, expectedLinked: TXID, action: "UPDATE", txId: TXID, fields: unpaidFields, payment: null, unit: { business_unit: null, business_unit_source: null } }).p_set_date === false && argsU.p_set_date === true);

  console.log("\n12 — source-level guarantees");
  const store = read("lib/sound-engineer-store.ts"), mixw = read("lib/writes/mix.ts"), sql = read("scripts/sql/2026-10-01-engineer-payment-rpc.sql"), route = read("app/api/sound-engineer/[id]/route.ts");
  const dbUpdateBlock = store.slice(store.indexOf("const dbUpdate: Record<string, unknown>"), store.indexOf("const { data: updated, error } = await supabase"));
  ok("the store no longer writes amount_paid / payment_date in its own UPDATE (they travel with the expense)", !/amount_paid|payment_date/.test(dbUpdateBlock));
  ok("the writer calls the atomic function and has no plain transactions INSERT / UPDATE left", /supabase\.rpc\("apply_engineer_payment"/.test(mixw) && !/from\("transactions"\)\.insert\(/.test(mixw) && !/from\("transactions"\)\.update\(/.test(mixw));
  ok("the push is gated by shouldPushPaymentConfirmed with the committed reconcile outcome", /shouldPushPaymentConfirmed\(\{ wasPaid, nowPaid, outcomeKind: payOutcome\?\.committed/.test(store) && !/if \(!wasPaid && nowPaid\)/.test(store));
  ok("the route maps PAYMENT_CONFLICT to a 409", /EngineerPaymentConflictError[\s\S]{0,200}status: 409/.test(route));
  ok("the SQL: typed parameters only (no jsonb parameter), SECURITY INVOKER, pinned search_path, row lock, INSERT / UPDATE only, execute for service_role only", !/p_\w+ jsonb/.test(sql) && /SECURITY INVOKER SET search_path = pg_catalog, public/.test(sql) && /FOR UPDATE/.test(sql) && /FROM PUBLIC, anon, authenticated/.test(sql) && /TO service_role/.test(sql) && /IN \('INSERT','UPDATE'\)/.test(sql));
  ok("the rollback file exists and drops the function + the unique index", /DROP FUNCTION IF EXISTS public\.apply_engineer_payment/.test(read("scripts/sql/2026-10-01-engineer-payment-rpc-rollback.sql")) && /DROP INDEX IF EXISTS public\.sound_engineer_work_linked_tx_uk/.test(read("scripts/sql/2026-10-01-engineer-payment-rpc-rollback.sql")));
  ok("the push module itself is unchanged (still claim-guarded, localhost-silenced, deliverOnce)", /pushAllowed\(\)/.test(read("lib/steven-payment-notify.ts")) && /deliverOnce\(/.test(read("lib/steven-payment-notify.ts")));
  ok("no page-load / refresh path calls the payment push (only updateSoundEngineerWork does)", !/notifyStevenPaymentPaid/.test(read("app/team/steven/page.tsx")) && !/notifyStevenPaymentPaid/.test(read("components/team/StevenProfilePage.tsx")) && (fs.readdirSync(path.resolve(__dirname, "../lib")).filter((n) => n.endsWith(".ts") && /notifyStevenPaymentPaid/.test(read(`lib/${n}`))).join() === "sound-engineer-store.ts,steven-payment-notify.ts"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
