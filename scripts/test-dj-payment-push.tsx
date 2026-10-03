/**
 * "The DJ was paid" push (Owner decision 2026-10-03): when a show's DJ_FEE row moves not-paid → שולם (a REAL transition),
 * DJ CLEANTONE gets "התשלום הועבר 💸" and — only after that push was delivered — the Owner gets
 * "עדכון תשלום נשלח ל-CLEANTONE ✓". ONE shared notifier (lib/dj-payment-notify) behind the three payment writers (the close
 * dialog, setShowFeePaid / MARK_SHOW_FEE_PAID, a Finance edit); ONE delivery claim per payment (settings, no schema change);
 * a push failure never touches the money; localhost / non-production never sends; refresh / GET / page load never sends.
 * The REAL lib/writes/shows + lib/shows-finance-sync + lib/dj-payment-notify run on an in-memory database with the push and
 * the claim store doubled (no production, no network, no real push, no calendar).
 * Run with:   npx tsx scripts/test-dj-payment-push.tsx
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

// ── the push + claim doubles (no network, no real push, no production) ──────────────────────────────────────────────
// The REAL lib/push.ts runs (getSubscriptions → deliver → the notifications history) on the in-memory database; only the
// web-push transport, the supabase client factory and the claim store are doubled, so what is asserted is what the app sends.
import { memoryClaimStore } from "./fixtures/claim-store";
type Mode = "ok" | "fail" | "none" | "throw";
type PushCall = { endpoint: string; role: string; payload: { title: string; body: string; url?: string; tag?: string } };
const PUSH: { calls: PushCall[]; cleantone: Mode; owner: Mode; allowed: boolean } = { calls: [], cleantone: "ok", owner: "ok", allowed: true };
const CLAIMS = memoryClaimStore();
const webpushDouble = {
  setVapidDetails() { /* no keys in tests */ },
  sendNotification(sub: { endpoint: string }, payloadJson: string) {
    const row = t("push_subscriptions").find((r) => r.endpoint === sub.endpoint) as Row;
    const role = String(row.role);
    PUSH.calls.push({ endpoint: sub.endpoint, role, payload: JSON.parse(payloadJson) });
    const mode = role === "cleantone" ? PUSH.cleantone : PUSH.owner;
    if (mode === "throw") throw new Error("push down"); // synchronous: sendPushToRoles itself rejects
    return mode === "fail" ? Promise.reject({ statusCode: 500 }) : Promise.resolve({ statusCode: 201 });
  },
};
const loadPrev = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (/(^|[\\/])push-claims(\.[cm]?[jt]s)?$/.test(request)) return { settingsClaimStore: CLAIMS, pushAllowed: () => PUSH.allowed };
  if (request === "web-push") return webpushDouble;
  if (request === "@supabase/supabase-js") return { createClient: () => ({ from }) };
  return loadPrev.call(this, request, parent, isMain);
};
const toDj = () => PUSH.calls.filter((c) => c.role === "cleantone");
const toOwner = () => PUSH.calls.filter((c) => c.role === "owner");
const reset = (o: Partial<typeof PUSH> = {}) => {
  PUSH.calls = []; PUSH.cleantone = "ok"; PUSH.owner = "ok"; PUSH.allowed = true; Object.assign(PUSH, o);
  CLAIMS.data.clear(); CLAIMS.writes.length = 0;
  // devices: one per audience, unless the case is "no subscription" for that audience
  DB["push_subscriptions"] = [
    ...((PUSH.cleantone as Mode) === "none" ? [] : [{ id: "s1", endpoint: "ep-cleantone", p256dh: "k", auth: "a", role: "cleantone", user_id: "u-cleantone" }]),
    ...((PUSH.owner as Mode) === "none" ? [] : [{ id: "s2", endpoint: "ep-owner", p256dh: "k", auth: "a", role: "owner", user_id: "u-owner" }]),
  ];
  DB["notifications"] = [];
};
const eventKeys = () => t("notifications").map((r) => String(r.event_key));

(async () => {
  const fin = await import("../lib/shows-finance-sync");
  const W = await import("../lib/writes/shows");
  const N = await import("../lib/dj-payment-notify");
  const Pure = await import("../lib/dj-payment-notify-pure");
  const { CLEANTONE_CLIENT_ID } = await import("../lib/red-artists/cleantone");
  const getShow = (id: string) => t("shows").find((r) => r.id === id) as unknown as import("../lib/shows-types").Show;
  const newShow = async (o: Row = {}) => { const s = SHOW({ dj_client_id: CLEANTONE_CLIENT_ID, dj_name: "DJ CLEANTONE", name: 'פסטידאנס ת"א', dj_fee: 500, ...o }); t("shows").push(s); const id = String(s.id); await fin.syncShowFinance(getShow(id)); return id; };
  const djRow = (id: string) => fee(id, "DJ_FEE") as Row;
  const claimOf = (txId: string) => CLAIMS.data.get(`dj_payment_paid:${txId}`) as { status?: string; result?: string } | undefined;

  console.log("Pure rules (lib/dj-payment-notify-pure)");
  ok("P1. only a real not-paid → שולם is a transition (שולם → שולם, a retry, an un-pay are not)", Pure.isDjFeeRealPaidTransition("צפוי", "שולם") && Pure.isDjFeeRealPaidTransition(null, "שולם") && Pure.isDjFeeRealPaidTransition("בוטל", "שולם") && !Pure.isDjFeeRealPaidTransition("שולם", "שולם") && !Pure.isDjFeeRealPaidTransition("שולם", "צפוי") && !Pure.isDjFeeRealPaidTransition("צפוי", "צפוי"));
  const dm = Pure.buildDjPaymentPush({ showName: 'פסטידאנס ת"א', amount: 500, currency: "₪" });
  const om = Pure.buildDjPaymentOwnerAck({ showName: 'פסטידאנס ת"א', amount: 500, currency: "₪" });
  ok("P2. the DJ's text is exactly the Owner's wording (title + body)", dm.title === "התשלום הועבר 💸" && dm.body === 'שכר הדיג׳יי עבור פסטידאנס ת"א בסך 500₪ שולם.', dm);
  ok("P3. the Owner's confirmation text is exactly the Owner's wording", om.title === "עדכון תשלום נשלח ל-CLEANTONE ✓" && om.body === 'CLEANTONE עודכן שהתשלום עבור פסטידאנס ת"א בסך 500₪ שולם.', om);
  ok("P4. a missing show name is never invented (safe wording without a name), both texts", Pure.buildDjPaymentPush({ showName: "  ", amount: 500, currency: "₪" }).body === "שכר הדיג׳יי בסך 500₪ שולם." && Pure.buildDjPaymentOwnerAck({ showName: null, amount: 500, currency: "₪" }).body === "CLEANTONE עודכן שהתשלום בסך 500₪ שולם.");
  ok("P5. a non-₪ currency shows its own canonical currency", Pure.buildDjPaymentPush({ showName: "X", amount: 1500, currency: "$" }).body === "שכר הדיג׳יי עבור X בסך 1,500$ שולם." && Pure.fmtDjPaymentAmount(500, "") === "500₪");
  const E = (o: Partial<{ role: string; status: string; amount: number; dj: string | null; fee: number }> = {}) => Pure.djPaymentEligibility({ tx: { role: o.role ?? "DJ_FEE", status: o.status ?? "שולם", amount: o.amount ?? 500 }, show: { djClientId: o.dj === undefined ? CLEANTONE_CLIENT_ID : o.dj, djFee: o.fee ?? 500 }, cleantoneId: CLEANTONE_CLIENT_ID });
  ok("P6. eligible only: a DJ_FEE row, שולם, CLEANTONE linked, a fee > 0; every other case is skipped with its reason", E().ok && !E({ role: "SHOW_PAYMENT" }).ok && !E({ status: "בוטל" }).ok && !E({ status: "צפוי" }).ok && !E({ dj: null }).ok && !E({ dj: "someone-else" }).ok && !E({ fee: 0 }).ok && !E({ amount: 0 }).ok);

  console.log("\n1. צפוי → שולם: ONE push to CLEANTONE, then ONE confirmation to the Owner");
  reset();
  const a = await newShow();
  const setA = await W.setShowFeePaid(a, "DJ_FEE", true, { date: "2026-10-16" });
  ok("1a. the DJ_FEE row is שולם (the write succeeded)", setA.kind === "ok" && djRow(a).payment_status === "שולם", setA);
  ok("1b. exactly ONE push to CLEANTONE with the exact text, a deep link and a per-payment tag + notification event key", toDj().length === 1 && toDj()[0].payload.title === "התשלום הועבר 💸" && toDj()[0].payload.body === 'שכר הדיג׳יי עבור פסטידאנס ת"א בסך 500₪ שולם.' && toDj()[0].payload.url === "/dj-cleantone?tab=shows" && toDj()[0].payload.tag === `dj-payment-${djRow(a).id}` && eventKeys().includes(`dj_payment_paid:${djRow(a).id}:u-cleantone`), { calls: toDj(), keys: eventKeys() });
  ok("1c. exactly ONE confirmation to the Owner, AFTER the DJ's push, with the exact text", toOwner().length === 1 && PUSH.calls[0].role === "cleantone" && PUSH.calls[1].role === "owner" && eventKeys().includes(`dj_payment_paid_owner:${djRow(a).id}:u-owner`) && toOwner()[0].payload.title === "עדכון תשלום נשלח ל-CLEANTONE ✓" && toOwner()[0].payload.body === 'CLEANTONE עודכן שהתשלום עבור פסטידאנס ת"א בסך 500₪ שולם.', toOwner());
  ok("1d. the claim for THIS payment says sent (settings dj_payment_paid:<DJ_FEE id>) — no schema change", claimOf(String(djRow(a).id))?.status === "sent");

  console.log("\n2. שולם → שולם: no new push");
  const callsBefore = PUSH.calls.length;
  const again = await W.setShowFeePaid(a, "DJ_FEE", true, {});
  const closeAgain = await W.closeShowRecord(a, { markDone: true, incomeReceived: false, djPaid: true });
  const financeNoop = await N.notifyDjFeePaid({ txId: String(djRow(a).id), before: "שולם" });
  ok("2a. paying an already-paid DJ_FEE (MARK again / a close with the DJ flag again / a notifier call with before = שולם) → no push to CLEANTONE or the Owner", again.kind === "refused" && closeAgain.kind === "ok" && financeNoop.kind === "skipped" && PUSH.calls.length === callsBefore, { again, closeAgain, financeNoop });

  console.log("\n3. double click / retry / two writers → one push");
  reset();
  const b = await newShow();
  const txB = String(djRow(b).id);
  (djRow(b) as Row).payment_status = "שולם";
  const race = await Promise.all([N.notifyDjFeePaid({ txId: txB, before: "צפוי" }), N.notifyDjFeePaid({ txId: txB, before: "צפוי" }), N.notifyDjFeePaid({ txId: txB, before: "צפוי" })]);
  ok("3a. three concurrent writers on the SAME DJ_FEE → exactly ONE push to CLEANTONE and ONE confirmation", toDj().length === 1 && toOwner().length === 1, { dj: toDj().length, owner: toOwner().length });
  ok("3b. the losers do not send and report no confirmation", race.filter((r) => r.kind === "attempted" && r.dj === "sent").length === 1);
  const retry = await N.notifyDjFeePaid({ txId: txB, before: "צפוי" });
  ok("3c. a later retry with the same payment is already_sent → nothing is re-sent", retry.kind === "attempted" && retry.dj === "already_sent" && toDj().length === 1 && toOwner().length === 1, retry);

  console.log("\n4. The close dialog with 'שולם ל-DJ'");
  reset();
  const c = await newShow();
  const cl = await W.closeShowRecord(c, { markDone: true, incomeReceived: true, djPaid: true });
  ok("4a. DJ_FEE = שולם, ONE push to CLEANTONE, then ONE to the Owner; no warning", cl.kind === "ok" && djRow(c).payment_status === "שולם" && toDj().length === 1 && toOwner().length === 1 && !(cl.kind === "ok" && cl.financeWarning), cl);
  const clNo = await newShow();
  reset();
  const cl2 = await W.closeShowRecord(clNo, { markDone: true, incomeReceived: true, djPaid: false });
  ok("4b. closing WITHOUT the DJ flag → DJ_FEE stays צפוי and NOTHING is pushed", cl2.kind === "ok" && djRow(clNo).payment_status === "צפוי" && PUSH.calls.length === 0);

  console.log("\n5. MARK_SHOW_FEE_PAID (DJ) and a Finance edit use the same flow");
  reset();
  const d = await newShow();
  const mk = await W.setShowFeePaid(d, "DJ_FEE", true, { date: "2026-10-17", method: "ביט" });
  ok("5a. setShowFeePaid DJ (the writer behind MARK_SHOW_FEE_PAID) → one push + one confirmation", mk.kind === "ok" && toDj().length === 1 && toOwner().length === 1);
  const serverSrc = read("lib/partner/act/server.ts");
  ok("5b. Sunny's MARK_SHOW_FEE_PAID is wired to that same writer (W.setShowFeePaid)", /W\.setShowFeePaid\(/.test(serverSrc));
  reset();
  const e = await newShow();
  let finOk = true; let finErr: unknown = null;
  try {
    const F = await import("../lib/writes/finance");
    await F.updateTransactionRecord(String(djRow(e).id), { paymentStatus: "שולם" } as never);
  } catch (err) { finOk = false; finErr = err; }
  // the in-memory fake has no `.like` (the artist-share sync that runs AFTER the notification point may throw on it) — the
  // payment write and the notification happen before that step, which is what is asserted here
  void finOk; void finErr;
  ok("5c. a Finance edit of the DJ_FEE row to שולם → the row is שולם, one push + one confirmation (the same notifier)", djRow(e).payment_status === "שולם" && toDj().length === 1 && toOwner().length === 1, { dj: toDj().length, owner: toOwner().length, finErr: String(finErr) });
  const callsF = PUSH.calls.length;
  try { const F2 = await import("../lib/writes/finance"); await F2.updateTransactionRecord(String(djRow(e).id), { paymentStatus: "שולם", notes: "x" } as never); } catch { /* the later share sync on the fake */ }
  ok("5d. saving the Finance row again (already שולם) → no push", PUSH.calls.length === callsF);
  const finSrc = read("lib/writes/finance.ts");
  ok("5e. source: the Finance writer calls the shared notifier only on a real not-paid → שולם transition of an expense", /notifyDjFeePaid\(\{ txId: id, before: String\(curRow\.payment_status/.test(finSrc) && /patch\.payment_status === "שולם" && String\(curRow\.payment_status \?\? ""\) !== "שולם"/.test(finSrc));

  console.log("\n6. The push to CLEANTONE fails → the payment stays, the Owner is NOT told it was sent");
  reset({ cleantone: "fail" });
  const f = await newShow();
  const clF = await W.closeShowRecord(f, { markDone: true, incomeReceived: true, djPaid: true });
  ok("6a. DJ_FEE is still שולם (no rollback)", djRow(f).payment_status === "שולם" && clF.kind === "ok");
  ok("6b. NO confirmation to the Owner", toDj().length === 1 && toOwner().length === 0, { dj: toDj().length, owner: toOwner().length });
  ok("6c. a clear warning is returned (shown in the UI) and the claim is a durable failed — never sent", clF.kind === "ok" && /Push ל-CLEANTONE לא נשלח/.test(String(clF.financeWarning)) && claimOf(String(djRow(f).id))?.status === "failed", clF);
  reset({ cleantone: "none" });
  const g = await newShow();
  const clG = await W.closeShowRecord(g, { markDone: true, incomeReceived: true, djPaid: true });
  ok("6d. no subscription → the payment succeeds, no confirmation, a warning says there is no device", clG.kind === "ok" && djRow(g).payment_status === "שולם" && toOwner().length === 0 && /אין מכשיר רשום/.test(String(clG.financeWarning)), clG);
  reset({ cleantone: "throw" });
  const h = await newShow();
  const clH = await W.closeShowRecord(h, { markDone: true, incomeReceived: true, djPaid: true });
  ok("6e. the push THROWS → the payment succeeds, no confirmation, the close does not fail", clH.kind === "ok" && djRow(h).payment_status === "שולם" && toOwner().length === 0, clH);

  console.log("\n7. CLEANTONE's push succeeds, the Owner's confirmation fails");
  reset({ owner: "fail" });
  const i = await newShow();
  const clI = await W.closeShowRecord(i, { markDone: true, incomeReceived: true, djPaid: true });
  ok("7a. one push to CLEANTONE, the Owner attempt failed, no rollback, the claim stays sent", clI.kind === "ok" && djRow(i).payment_status === "שולם" && toDj().length === 1 && toOwner().length === 1 && claimOf(String(djRow(i).id))?.status === "sent", clI);
  const reCall = await N.notifyDjFeePaid({ txId: String(djRow(i).id), before: "צפוי" });
  ok("7b. nothing re-sends to CLEANTONE because the confirmation failed (a later call is already_sent)", reCall.kind === "attempted" && reCall.dj === "already_sent" && toDj().length === 1 && toOwner().length === 1, reCall);
  reset({ owner: "throw" });
  const i2 = await newShow();
  const clI2 = await W.closeShowRecord(i2, { markDone: true, incomeReceived: true, djPaid: true });
  ok("7c. the Owner push THROWS → logged, a warning, the DJ's push was not repeated, the payment stays", clI2.kind === "ok" && toDj().length === 1 && djRow(i2).payment_status === "שולם" && /אישור השליחה אליך לא נשלח/.test(String(clI2.financeWarning)), clI2);

  console.log("\n8. No DJ / no fee / no DJ_FEE / another DJ → no push");
  reset();
  const noDj = await newShow({ dj_client_id: null, dj_name: "" });
  const r1 = await W.setShowFeePaid(noDj, "DJ_FEE", true, {});
  const otherDj = await newShow({ dj_client_id: "11111111-1111-1111-1111-111111111111", dj_name: "DJ אחר" });
  const r2 = await W.setShowFeePaid(otherDj, "DJ_FEE", true, {});
  const zeroFee = await newShow({ dj_fee: 0 });
  const r3 = await W.setShowFeePaid(zeroFee, "DJ_FEE", true, {});
  ok("8a. no linked DJ (a DJ_FEE row exists with the default fee) / a DJ without a push audience / dj_fee 0 (no DJ_FEE row, refused) → no push", r1.kind === "ok" && r2.kind === "ok" && r3.kind === "refused" && PUSH.calls.length === 0, { r1, r2, r3 });
  const clZero = await W.closeShowRecord(zeroFee, { markDone: true, incomeReceived: true, djPaid: true });
  ok("8b. closing a show with no DJ fee → no push", clZero.kind === "ok" && PUSH.calls.length === 0);
  const incomeTx = t("transactions").find((r) => r.show_money_role === "SHOW_PAYMENT") as Row | undefined;
  const hand = await N.notifyDjFeePaid({ txId: String(incomeTx?.id ?? randomUUID()), before: "צפוי" });
  ok("8c. a row that is not a DJ_FEE (a client payment / an unknown id) → skipped, no push", hand.kind === "skipped" && PUSH.calls.length === 0, hand);
  const cancelled = await newShow();
  (djRow(cancelled) as Row).payment_status = "בוטל";
  const cancelledRes = await N.notifyDjFeePaid({ txId: String(djRow(cancelled).id), before: "צפוי" });
  ok("8d. a cancelled transaction is never announced", cancelledRes.kind === "skipped" && PUSH.calls.length === 0, cancelledRes);

  console.log("\n9. pushAllowed = false (localhost / non-production) → no real push, no claim");
  reset({ allowed: false });
  const j = await newShow();
  const clJ = await W.closeShowRecord(j, { markDone: true, incomeReceived: true, djPaid: true });
  ok("9a. the payment succeeds, NO sendPushToRoles call and NO claim row was written", clJ.kind === "ok" && djRow(j).payment_status === "שולם" && PUSH.calls.length === 0 && CLAIMS.writes.length === 0 && !(clJ.kind === "ok" && clJ.financeWarning), { calls: PUSH.calls.length, writes: CLAIMS.writes });
  const notifySrc = read("lib/dj-payment-notify.ts");
  ok("9b. source: the guard is the shared pushAllowed() and it runs BEFORE any claim / read", /import \{ settingsClaimStore, pushAllowed \} from "\.\/push-claims"/.test(notifySrc) && notifySrc.indexOf("pushAllowed()") < notifySrc.indexOf("deliverOnce(") && notifySrc.indexOf("pushAllowed()") < notifySrc.indexOf('from("transactions")'));
  reset();
  const k = await newShow();
  const real = await W.setShowFeePaid(k, "DJ_FEE", true, {});
  ok("9c. (control) the same flow with push allowed does send — the guard is the only difference", real.kind === "ok" && toDj().length === 1);

  console.log("\n10. refresh / GET / page load never send — the notifier is called only from the three payment writers");
  const walk = (dir: string): string[] => fs.readdirSync(path.resolve(__dirname, "..", dir), { withFileTypes: true }).flatMap((d) => d.isDirectory() ? (d.name === "node_modules" || d.name === ".next" ? [] : walk(`${dir}/${d.name}`)) : /\.(ts|tsx)$/.test(d.name) ? [`${dir}/${d.name}`] : []);
  const callers = [...walk("lib"), ...walk("app"), ...walk("components")].filter((f) => /notifyDjFeePaid\(/.test(read(f)) && f !== "lib/dj-payment-notify.ts");
  ok("10a. notifyDjFeePaid( is called only from lib/shows-finance-sync.ts (close), lib/writes/shows.ts (MARK) and lib/writes/finance.ts (Finance edit)", callers.sort().join(",") === ["lib/shows-finance-sync.ts", "lib/writes/finance.ts", "lib/writes/shows.ts"].join(","), callers);
  const importers = [...walk("lib"), ...walk("app"), ...walk("components")].filter((f) => /dj-payment-notify["']/.test(read(f)) && f !== "lib/dj-payment-notify.ts");
  ok("10b. no page, component, GET route or the portal summary imports the notifier", importers.every((f) => f.startsWith("lib/")) && !importers.some((f) => /cleantone-summary|app\/api\/push|app\/.*page\.tsx/.test(f)), importers);
  ok("10c. no page / component calls /api/push/check; the notifier file has no timer, cron or polling", ![...walk("app"), ...walk("components")].some((f) => /fetch\(\s*[`"'][^`"']*api\/push\/check/.test(read(f))) && !/setInterval|setTimeout|cron/.test(notifySrc));
  ok("10d. the notifier only sends from the writers' success path (no GET handler imports it; the close dialog / Hub UI never import it)", !/dj-payment-notify/.test(read("components/shows/ShowsHubPreview.tsx")) && !/dj-payment-notify/.test(read("app/api/red-artists/cleantone-summary/route.ts")));

  console.log("\n11 + 12. The CLEANTONE portal pill reads the DJ_FEE row only (unchanged)");
  const p1 = await newShow();
  const p2 = await newShow();
  reset();
  await W.setShowFeePaid(p1, "DJ_FEE", true, {});
  await (await import("../lib/writes/show-payments")).recordShowPayment(p2, { amount: 3000, date: "2026-10-16" }); // the CLIENT paid p2 in full; its DJ_FEE stays צפוי
  const map = await fin.getShowFeeRowsMap([getShow(p1), getShow(p2)]);
  ok("11a. DJ_FEE שולם → the portal source row is שולם; DJ_FEE צפוי → צפוי (the pill is 'שולם' only for שולם)", map[p1]?.DJ_FEE?.status === "שולם" && map[p2]?.DJ_FEE?.status === "צפוי", map);
  ok("12a. the CLIENT paying in full does not change the DJ's status (p2: client שולם, DJ צפוי → 'לא שולם')", getShow(p2).payment_status === "שולם" && map[p2]?.DJ_FEE?.status === "צפוי");
  const route = read("app/api/red-artists/cleantone-summary/route.ts");
  const pill = read("components/red-artists/ArtistPortalPage.tsx");
  ok("11b. source: the route takes the status from the DJ_FEE row and never returns the client's payment_status; the pill is שולם only for שולם", /paymentStatus: fees\[s\.id\]\?\.DJ_FEE\?\.status \?\? "לא שולם"/.test(route) && !/payment_status/.test(route.replace(/\/\/.*$/gm, "")) && /status === "שולם"/.test(pill.slice(pill.indexOf("PaymentStatusPill"))));

  console.log("\n13. The contracts know about it");
  const people = read("lib/partner/system/people.ts");
  ok("13a. PUSH_CONTRACTS has P_DJ_PAYMENT_PAID (recipients cleantone + owner, the module, the per-payment claim)", /id: "P_DJ_PAYMENT_PAID"/.test(people) && /lib\/dj-payment-notify\.ts/.test(people) && /dj_payment_paid:/.test(people));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
