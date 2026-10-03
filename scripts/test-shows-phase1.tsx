/**
 * Phase 1 — shows (Owner decision 2026-10-03): Shows → Close Show → Finance / DJ → the artist's ENTITLEMENT in the balance.
 *   • closing a show never pays the artist (no ledger "תשלומים", no Finance שכר אמן); the entitlement is realized as before;
 *   • closeShow.artistPaid / artistPaidDate (even false) and MARK_SHOW_FEE_PAID for the artist → ARTIST_PAYOUT_VIA_BALANCE, no write;
 *   • a PAID show moves to "בוצע" (created or updated) only through the close flow while money is open → 409 CLOSE_REQUIRED;
 *   • "שולם ל-DJ" still marks the DJ_FEE row; legacy ARTIST_FEE rows / the historical ledger are read, never changed;
 *   • the UI: the "תשלום לקוח" column, a finance warning / partial-failure message is shown, "בוצע" goes through the close dialog.
 * The REAL lib/writes/shows + lib/shows-finance-sync + lib/writes/artist-payments run on an in-memory database (no production,
 * no network, no push, no calendar). Run with:   npx tsx scripts/test-shows-phase1.tsx
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
  const W = await import("../lib/writes/shows");
  const AP = await import("../lib/writes/artist-payments");
  const getShow = (id: string) => t("shows").find((r) => r.id === id) as unknown as import("../lib/shows-types").Show;
  const newShow = async (o: Row = {}) => { const s = SHOW(o); t("shows").push(s); const id = String(s.id); await fin.syncShowFinance(getShow(id)); return id; };
  const snapshot = (id: string) => JSON.stringify({ s: getShow(id), tx: txOf(id), led: t("artist_balance_entries").filter((r) => r.source_show_id === id), pays: t("transactions").filter((r) => r.category === "שכר אמן").length });
  const ARTIST_PAY_TX = () => t("transactions").filter((r) => r.category === "שכר אמן");

  console.log("1. Close a show: the entitlement is realized, the artist is NOT paid");
  const a = await newShow();
  const c1 = await W.closeShowRecord(a, { markDone: true, incomeReceived: true, djPaid: true, note: "היה מעולה" });
  ok("1a. closing → status בוצע, the client remainder received (3,000), the DJ_FEE row שולם", c1.kind === "ok" && getShow(a).status === "בוצע" && receivedTotal(a) === 3000 && fee(a, "DJ_FEE")?.payment_status === "שולם", c1);
  ok("1b. the artist's entitlement is realized in the ledger as הכנסות 1,250 ((3,000 − 500) / 2)", earning(a)?.entry_type === "הכנסות" && Number(earning(a)?.amount) === 1250, earning(a));
  ok("1c. NO ledger 'תשלומים' row and NO Finance 'שכר אמן' expense were written by the close", ledgerPays(a).length === 0 && artistPayTx(a).length === 0 && ARTIST_PAY_TX().length === 0);
  ok("1d. the notes summary has the client and the DJ only (no 'אמן ✓/✗')", /סגירת הופעה .*התקבל ✓/.test(String(getShow(a).notes)) && !/אמן [✓✗]/.test(String(getShow(a).notes)), getShow(a).notes);
  const again = await W.closeShowRecord(a, { markDone: true, incomeReceived: true, djPaid: true });
  ok("1e. closing again is safe: still ONE entitlement row, still no artist payment", again.kind === "ok" && t("artist_balance_entries").filter((r) => r.source_show_id === a && r.entry_type === "הכנסות").length === 1 && ARTIST_PAY_TX().length === 0);

  console.log("\n2. A stale client / API sending artistPaid / artistPaidDate → ARTIST_PAYOUT_VIA_BALANCE, before any write");
  const b = await newShow();
  const before = snapshot(b);
  const s1 = await W.updateShowRecord(b, { status: "בוצע", closeShow: { incomeReceived: true, djPaid: true, artistPaid: false } });
  const s2 = await W.updateShowRecord(b, { status: "בוצע", closeShow: { incomeReceived: true, djPaid: true, artistPaid: true }, artistPaidDate: "2026-10-16" });
  const s3 = await W.updateShowRecord(b, { status: "בוצע", closeShow: { incomeReceived: true, djPaid: true, artistPaidDate: "2026-10-16" } });
  const s4 = await W.updateShowRecord(b, { notes: "x", artistPaidDate: "2026-10-16" });
  ok("2a. artistPaid=false, artistPaid=true + date, a date alone, a top-level date → all refused ARTIST_PAYOUT_VIA_BALANCE", [s1, s2, s3, s4].every((r) => r.kind === "refused" && r.code === "ARTIST_PAYOUT_VIA_BALANCE"), [s1, s2, s3, s4]);
  ok("2b. the message says the artist is paid only through the artist's balance", s1.kind === "refused" && /מאזן האמן/.test(s1.messageHe));
  ok("2c. NOTHING was written (the show, its Finance rows, the ledger, Finance artist payments)", snapshot(b) === before);

  console.log("\n3. setShowFeePaid: the artist is refused, the DJ stays");
  const c = await newShow();
  const beforeC = snapshot(c);
  const pa = await W.setShowFeePaid(c, "ARTIST_FEE", true, { date: "2026-10-16", method: "ביט" });
  const pu = await W.setShowFeePaid(c, "ARTIST_FEE", false, {});
  ok("3a. ARTIST_FEE paid / un-paid → refused ARTIST_PAYOUT_VIA_BALANCE", pa.kind === "refused" && pa.code === "ARTIST_PAYOUT_VIA_BALANCE" && pu.kind === "refused" && pu.code === "ARTIST_PAYOUT_VIA_BALANCE", [pa, pu]);
  ok("3b. …and nothing is written (no payment, no row, no ledger change)", snapshot(c) === beforeC);
  const dj = await W.setShowFeePaid(c, "DJ_FEE", true, { date: "2026-10-16", method: "ביט" });
  ok("3c. DJ_FEE paid still works: that row שולם with the date; the client money and the artist side untouched", dj.kind === "ok" && fee(c, "DJ_FEE")?.payment_status === "שולם" && receivedTotal(c) === 0 && ARTIST_PAY_TX().length === 0, dj);

  console.log("\n4. B5 — a PAID show moves to בוצע only through the close flow (409 CLOSE_REQUIRED)");
  const d = await newShow();
  const beforeD = snapshot(d);
  const plain = await W.updateShowRecord(d, { status: "בוצע" });
  ok("4a. status בוצע without closeShow, client money + DJ fee open → refused CLOSE_REQUIRED", plain.kind === "refused" && plain.code === "CLOSE_REQUIRED", plain);
  ok("4b. the message says what is open (client balance, DJ fee) and to close through the shows screen", plain.kind === "refused" && /תשלום הלקוח/.test(plain.messageHe) && /הדיג׳יי/.test(plain.messageHe) && /סגירת הופעה/.test(plain.messageHe), plain);
  ok("4c. …before any write (the show is still אושרה, nothing else changed)", snapshot(d) === beforeD && getShow(d).status === "אושרה");
  const withClose = await W.updateShowRecord(d, { status: "בוצע", closeShow: { incomeReceived: false, djPaid: false } });
  ok("4d. the same move WITH a valid closeShow (nothing ticked) → בוצע; the client / DJ rows stay צפוי; the entitlement is realized", withClose.kind === "ok" && getShow(d).status === "בוצע" && fee(d, "DJ_FEE")?.payment_status === "צפוי" && earning(d)?.entry_type === "הכנסות", withClose);
  const { recordShowPayment } = await import("../lib/writes/show-payments");
  const e = await newShow({ dj_fee: 0 });
  await recordShowPayment(e, { amount: 3000, date: "2026-10-16" });
  const settled = await W.updateShowRecord(e, { status: "בוצע" });
  ok("4e. nothing open (the client paid in full, no DJ fee) → a plain move to בוצע is allowed", settled.kind === "ok" && getShow(e).status === "בוצע", settled);
  const f = await newShow();
  await recordShowPayment(f, { amount: 3000, date: "2026-10-16" });
  const djOnly = await W.updateShowRecord(f, { status: "בוצע" });
  ok("4f. only the DJ fee open (the client paid) → still CLOSE_REQUIRED", djOnly.kind === "refused" && djOnly.code === "CLOSE_REQUIRED" && /הדיג׳יי/.test(djOnly.messageHe) && !/תשלום הלקוח/.test(djOnly.messageHe), djOnly);
  const edit = await W.updateShowRecord(a, { location: "תל אביב" });
  ok("4g. a show that is ALREADY בוצע is edited normally (the guard is on the transition only)", edit.kind === "ok" && getShow(a).location === "תל אביב", edit);
  const priceUp = await W.updateShowRecord(f, { status: "בוצע", show_price: 4000 });
  ok("4h. a price raised in the same request counts (client balance open again) → CLOSE_REQUIRED", priceUp.kind === "refused" && priceUp.code === "CLOSE_REQUIRED", priceUp);

  console.log("\n5. UNPAID_COLLAB is not blocked");
  const g = await newShow({ deal_type: "UNPAID_COLLAB", show_price: 0, dj_fee: 0, status: "אושרה" });
  const collab = await W.updateShowRecord(g, { status: "בוצע" });
  ok("5a. a collaboration moves to בוצע without a close flow (no money exists)", collab.kind === "ok" && getShow(g).status === "בוצע", collab);

  console.log("\n6. Create: no PAID show is created straight as בוצע");
  const nBefore = t("shows").length;
  type Thrown = { code?: string; message?: string; name?: string } | null;
  const attempt = async (fn: () => Promise<unknown>): Promise<Thrown> => { try { await fn(); return null; } catch (err) { return err as Thrown; } };
  const thrown = await attempt(() => W.createShowRecord({ name: "הופעה חדשה", artist: "שליו טסמה", status: "בוצע", show_price: 3000 }));
  ok("6a. create with status בוצע + price → ShowRefusedError CLOSE_REQUIRED", !!thrown && thrown.name === "ShowRefusedError" && thrown.code === "CLOSE_REQUIRED", thrown);
  ok("6b. …and no show was created", t("shows").length === nBefore);
  const thrown2 = await attempt(() => W.createShowRecord({ name: "רק DJ", artist: "שליו טסמה", status: "בוצע", show_price: 0 }));
  ok("6c. create בוצע with a price of 0 but the default DJ fee (500) → also refused", thrown2?.code === "CLOSE_REQUIRED");
  const c0 = await W.createShowRecord({ name: "ללא כסף", artist: "שליו טסמה", status: "בוצע", show_price: 0, dj_fee: 0 });
  ok("6d. create בוצע with no money at all → allowed", c0.show.status === "בוצע");
  const cc = await W.createShowRecord({ name: "שת״פ", artist: "שליו טסמה", status: "בוצע", deal_type: "UNPAID_COLLAB" });
  ok("6e. create an UNPAID_COLLAB as בוצע → allowed", cc.show.status === "בוצע" && cc.show.deal_type === "UNPAID_COLLAB");
  const cOk = await W.createShowRecord({ name: "נסגר", artist: "שליו טסמה", status: "נסגר", show_price: 3000 });
  ok("6f. create as נסגר → allowed (closed later through the close flow)", cOk.show.status === "נסגר");

  console.log("\n7. The payout is a payment in the artist's balance — one path, no double payment");
  const h = await newShow();
  await W.closeShowRecord(h, { markDone: true, incomeReceived: true, djPaid: false });
  const pay = await AP.recordArtistPayment({ artistId: SHALEV, amount: 1250, date: "2026-10-20", idempotencyKey: "modal-uuid-1" });
  ok("7a. a payment from the balance (the one writer) → Finance שכר אמן שולם + ONE ledger payment", pay.kind === "ok" && ARTIST_PAY_TX().length === 1 && t("artist_balance_entries").filter((r) => r.entry_type === "תשלומים").length === 1, pay);
  const closeAfter = await W.closeShowRecord(h, { markDone: true, incomeReceived: true, djPaid: false });
  const markAfter = await W.setShowFeePaid(h, "ARTIST_FEE", true, {});
  ok("7b. closing again / MARK_SHOW_FEE_PAID ARTIST after that payment → NO second payment", closeAfter.kind === "ok" && markAfter.kind === "refused" && ARTIST_PAY_TX().length === 1 && t("artist_balance_entries").filter((r) => r.entry_type === "תשלומים").length === 1);

  console.log("\n8. Legacy ARTIST_FEE rows and the historical ledger are read, never changed");
  const lg = await newShow({ status: "בוצע", payment_status: "שולם" });
  const legacyTx = { id: randomUUID(), show_id: lg, show_money_role: "ARTIST_FEE", type: "expense", category: "שכר אמן", amount: 1250, currency: "₪", payment_status: "שולם", date: "2026-08-07", notes: "legacy" };
  t("transactions").push(legacyTx);
  t("shows").find((r) => r.id === lg)!.linked_artist_expense_transaction_id = legacyTx.id;
  const legacyLedger = { id: randomUUID(), artist_id: SHALEV, entry_type: "הכנסות", amount: 1250, entry_date: "2026-08-07", description: "הופעה - legacy", note: "", source_tx_id: legacyTx.id, source_show_id: lg };
  t("artist_balance_entries").push(legacyLedger);
  const legacyBefore = JSON.stringify({ tx: legacyTx, led: legacyLedger });
  const lgEdit = await W.updateShowRecord(lg, { location: "חיפה (עודכן)", notes: "עריכה" });
  const lgMark = await W.setShowFeePaid(lg, "ARTIST_FEE", true, {});
  ok("8a. an edit of a show with a legacy paid ARTIST_FEE row + ledger income → ok; the legacy Finance row and the ledger row are byte-identical", lgEdit.kind === "ok" && JSON.stringify({ tx: legacyTx, led: legacyLedger }) === legacyBefore, lgEdit);
  ok("8b. MARK_SHOW_FEE_PAID on it → refused (no payout, no touch of the legacy row)", lgMark.kind === "refused" && JSON.stringify({ tx: legacyTx, led: legacyLedger }) === legacyBefore);

  console.log("\n9. Source checks (the contract + the UI)");
  const shows = read("lib/writes/shows.ts");
  ok("9a. lib/writes/shows.ts has no artist payout: no recordArtistPayment, no findShowPaymentEntry, no allowDuplicate: true, no paymentReversalNeeded", !/recordArtistPayment\(/.test(shows) && !/findShowPaymentEntry/.test(shows) && !/allowDuplicate:\s*true/.test(shows) && !/paymentReversalNeeded/.test(shows));
  ok("9b. the closeShow payload and the closeShowRecord signature have no artistPaid / artistPaidDate (only the refusal reads them)", !/artistPaid:\s*(!!|c\.|artRelevant)/.test(shows) && !/artistPaidDate\?:/.test(shows));
  const prim = read("lib/partner/act/primitives/shows.ts");
  ok("9c. Sunny: CLOSE_SHOW has no artistPaid arg and MARK_SHOW_FEE_PAID refuses the artist role", !/name: "artistPaid"/.test(prim) && /a\.role === "ARTIST_FEE"\) return refuse\("ARTIST_PAYOUT_VIA_BALANCE"/.test(prim));
  const hub = read("components/shows/ShowsHubPreview.tsx");
  ok("9d. the Hub column is 'תשלום לקוח' (not 'תשלום'), in the Hub and the legacy page / drawer", /"סטטוס","תשלום לקוח","יתרה"/.test(hub) && !/"סטטוס","תשלום","יתרה"/.test(hub) && /"תשלום לקוח", ""\]/.test(read("components/shows/ShowsPage.tsx")) && /תשלום לקוח<\/div>/.test(read("components/shows/ShowDrawer.tsx")));
  const closeModal = hub.slice(hub.indexOf("function CloseShowModal"), hub.indexOf("// ─── Main component"));
  ok("9e. CloseShowModal has no artist toggle / state / payload / reversal warning", !/artistPaid|setArtistPaid|artistPaidDate|paymentReversal|שולם לאמן/.test(closeModal.replace(/\/\/ Phase 1[^\n]*\n/g, "")), closeModal.match(/artistPaid|שולם לאמן|paymentReversal/g));
  ok("9f. the finance warning is shown in the close dialog, the list handlers and the legacy drawer (never hidden)", /if \(data\.financeWarning\) onWarning\?\.\(String\(data\.financeWarning\)\)/.test(closeModal) && (hub.match(/setFinanceAlert\(String\(data\.financeWarning\)\)/g) ?? []).length >= 2 && /FinanceWarningBanner message=\{financeAlert\}/.test(hub) && /finWarn/.test(read("components/shows/ShowDrawer.tsx")));
  ok("9g. a partial failure (the show saved, the money sync did not finish) refreshes the list, says so, and is not a success", /ההופעה נשמרה, אבל הסנכרון הכספי לא הושלם/.test(closeModal) && /onPartial\?\.\(msg, data\.show/.test(closeModal) && /partialFail \? "נסה שוב"/.test(closeModal) && /ההופעה \$\{isUpdate \? "נשמרה" : "נוצרה"\}, אבל הסנכרון הכספי לא הושלם/.test(hub) && /onPartial=\{\(msg\) => \{ loadShows\(\)/.test(hub) && /ShowFinanceSyncError/.test(read("app/api/shows/[id]/route.ts")) && /partial: true/.test(read("app/api/shows/[id]/route.ts")));
  ok("9h. choosing בוצע opens the close dialog (patchStatus) and CLOSE_REQUIRED from the server opens it too; the forms do not offer בוצע for a PAID show", /setCloseShow\(\{ show, trigger: field === "status" \? "done" : "paid" \}\)/.test(hub) && /data\.code === "CLOSE_REQUIRED"/.test(hub) && /FORM_STATUSES\.filter\(st => st !== "בוצע"\)/.test(hub) && /SHOW_STATUSES\.filter\(s => s !== "בוצע"/.test(read("components/shows/ShowsPage.tsx")) && /show\.status === "בוצע" \|\| show\.deal_type === "UNPAID_COLLAB"/.test(read("components/shows/ShowDrawer.tsx")));
  ok("9i. the routes map the refusals: PATCH → 409 (refused), POST → 409 for a ShowRefusedError", /ShowRefusedError/.test(read("app/api/shows/route.ts")) && /status: 409/.test(read("app/api/shows/route.ts")) && /r\.kind === "refused"\) return NextResponse\.json\(\{ error: r\.messageHe, code: r\.code \}, \{ status: 409 \}\)/.test(read("app/api/shows/[id]/route.ts")));
  ok("9j. the artist-balance payment writer is untouched by this phase (no overpay logic, the existing duplicate guard stays)", !/OVERPAY|overpayAck/.test(read("lib/writes/artist-payments.ts")) && /similarArtistPayment/.test(read("lib/writes/artist-payments.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
