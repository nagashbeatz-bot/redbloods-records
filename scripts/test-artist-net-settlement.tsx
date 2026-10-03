/**
 * The artist NET SETTLEMENT model + the unit balance (Owner decisions 2026-09-28).
 *   Finance = real money; the artist ledger = the settlement (entitlements − the artist's expense share − payments).
 *   An entitlement is never a Finance expense; a real payment = Finance שכר אמן שולם (RECORDS) + a ledger payment, linked.
 * The REAL lib/writes/artist-payments + lib/artist-entitlement-sync run on an in-memory database (no production, no
 * network, no push); lib/finance/unit-balance is pure and runs on production-shaped fixtures (the approved numbers).
 * Run with:   npx tsx scripts/test-artist-net-settlement.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Row = Record<string, unknown>;
const DB: Record<string, Row[]> = {};
const t = (name: string) => (DB[name] ??= []);
const failNext: Record<string, string | null> = {}; // table → error message for the next INSERT
function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let mode: "select" | "update" | "delete" | "insert" = "select", patch: Row | null = null, ins: Row | null = null, one: "single" | "maybe" | null = null, lim: number | null = null;
  const run = () => {
    if (mode === "insert") {
      if (failNext[table]) { const m = failNext[table]; failNext[table] = null; return { data: null, error: { message: m, code: "XX000" }, count: null }; }
      const r = { id: randomUUID(), created_at: new Date().toISOString(), ...ins }; t(table).push(r); return { data: one ? { ...r } : [{ ...r }], error: null, count: null };
    }
    let rows = t(table).filter((r) => filters.every((f) => f(r)));
    if (mode === "update") { for (const r of rows) Object.assign(r, patch); }
    if (mode === "delete") { DB[table] = t(table).filter((r) => !rows.includes(r)); }
    if (lim !== null) rows = rows.slice(0, lim);
    const data = rows.map((r) => ({ ...r }));
    return { data: one ? data[0] ?? null : data, error: null, count: data.length };
  };
  const c: Record<string, unknown> = {
    select() { return c; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return c; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return c; },
    is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return c; },
    limit(n: number) { lim = n; return c; },
    single() { one = "single"; return Promise.resolve(run()); },
    maybeSingle() { one = "maybe"; return Promise.resolve(run()); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return { select: () => c, insert(r: Row) { mode = "insert"; ins = r; return c; }, update(p: Row) { mode = "update"; patch = p; return c; }, delete() { mode = "delete"; return c; } };
}
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from } };
  return orig.call(this, request, parent, isMain);
};

const SHALEV = "8806fe5e-1238-4228-8078-b3db3ccc9b46";
const AVI = "a0a0a0a0-0000-4000-8000-000000000001";
t("label_artists").push({ id: SHALEV, name: "שליו טסמה" }, { id: AVI, name: "אבי מולה" });
const txs = () => t("transactions");
const led = () => t("artist_balance_entries");
const deletes: string[] = [];

(async () => {
  const AP = await import("../lib/writes/artist-payments");
  const ES = await import("../lib/artist-entitlement-sync");
  const UB = await import("../lib/finance/unit-balance");
  const { inferBusinessUnit } = await import("../lib/business-unit");
  const { financeOwnerOf, OWNED_ALLOWED_FIELDS } = await import("../lib/finance/ownership") as unknown as { financeOwnerOf?: unknown; OWNED_ALLOWED_FIELDS: Record<string, readonly string[]> };
  void financeOwnerOf;

  console.log("Artist model — entitlements (lib/artist-entitlement-sync)");
  const S1 = randomUUID();
  const e1 = await ES.syncShowEntitlement({ showId: S1, showName: "קליק", showDate: "2026-11-01", artistId: SHALEV, amount: 1250, stands: true });
  const ent = () => led().find((r) => r.source_show_id === S1 && (r.entry_type === "הכנסות צפויות" || r.entry_type === "הכנסות"))!;
  ok("1. a future show → ONE expected entitlement (הכנסות צפויות) in the ledger, linked by source_show_id", e1 === "CREATED" && ent().entry_type === "הכנסות צפויות" && ent().amount === 1250 && ent().artist_id === SHALEV);
  ok("2. no Finance artist-fee expected row is created by an entitlement", txs().length === 0);
  ok("3. a re-sync is idempotent (UNCHANGED, still one row)", (await ES.syncShowEntitlement({ showId: S1, showName: "קליק", showDate: "2026-11-01", artistId: SHALEV, amount: 1250, stands: true })) === "UNCHANGED" && led().filter((r) => r.source_show_id === S1).length === 1);
  await ES.syncShowEntitlement({ showId: S1, showName: "קליק", showDate: "2026-11-01", artistId: SHALEV, amount: 1500, stands: true });
  ok("4. a price change re-prices the SAME expected row", ent().amount === 1500 && led().filter((r) => r.source_show_id === S1).length === 1);
  const id1 = ent().id;
  ok("5. cancel → the expected row is marked NOT ACTIVE by its note — never deleted", (await ES.syncShowEntitlement({ showId: S1, showName: "קליק", showDate: "2026-11-01", artistId: SHALEV, amount: 1500, stands: false, inactiveReasonHe: "ההופעה בוטלה" })) === "MARKED_INACTIVE" && ent().id === id1 && ES.isInactiveEntitlementNote(ent().note as string));
  ok("5b. back to confirmed → the same row is active again", (await ES.syncShowEntitlement({ showId: S1, showName: "קליק", showDate: "2026-11-01", artistId: SHALEV, amount: 1500, stands: true })) === "UPDATED" && ent().id === id1 && !ES.isInactiveEntitlementNote(ent().note as string));
  Object.assign(ent(), { entry_type: "הכנסות" }); // the close sync realized it
  // A7 (Final Hardening 2026-09-29): a realized entitlement FOLLOWS the show — same row, never deleted, never a second row
  ok("6. a realized entitlement of a show still confirmed but not performed is left as it is (never demoted to expected)", (await ES.syncShowEntitlement({ showId: S1, showName: "x", showDate: null, artistId: SHALEV, amount: 1, stands: true })) === "REALIZED_UNTOUCHED" && ent().amount === 1500 && ent().entry_type === "הכנסות");
  ok("6a. A7: a price change after realization re-prices the SAME realized row", (await ES.syncShowEntitlement({ showId: S1, showName: "x", showDate: null, artistId: SHALEV, amount: 1250, stands: true, performed: true })) === "REALIZED_REPRICED" && ent().id === id1 && ent().amount === 1250 && ent().entry_type === "הכנסות");
  ok("6b. A7: cancelled after realization → the SAME row kept at 0 with the reason + what it was (never deleted)", (await ES.syncShowEntitlement({ showId: S1, showName: "x", showDate: null, artistId: SHALEV, amount: 1250, stands: false, inactiveReasonHe: "ההופעה בוטלה" })) === "REALIZED_ZEROED" && ent().id === id1 && ent().amount === 0 && ent().entry_type === "הכנסות" && ES.isInactiveEntitlementNote(ent().note as string) && /היה ₪1250/.test(String(ent().note)));
  ok("6c. …a second cancel sync changes nothing (idempotent)", (await ES.syncShowEntitlement({ showId: S1, showName: "x", showDate: null, artistId: SHALEV, amount: 1250, stands: false })) === "UNCHANGED" && ent().amount === 0);
  ok("6d. performed again → the SAME row restored (amount back, note cleared)", (await ES.syncShowEntitlement({ showId: S1, showName: "x", showDate: null, artistId: SHALEV, amount: 1250, stands: true, performed: true })) === "REALIZED_REPRICED" && ent().amount === 1250 && !ES.isInactiveEntitlementNote(ent().note as string));
  ok("6e. markShowEntitlementsInactive (revert / delete) keeps a realized row at 0 with the reason — never deleted", (await ES.markShowEntitlementsInactive(S1, "בדיקה")) === 1 && ent().entry_type === "הכנסות" && ent().amount === 0 && /היה ₪1250/.test(String(ent().note)));
  const SH9 = randomUUID();
  led().push({ id: "hist", artist_id: SHALEV, entry_type: "הכנסות", amount: 750, entry_date: "2026-08-01", description: "הופעה", note: "היסטוריה לפני המחזור הראשון", source_show_id: SH9 });
  await ES.syncShowEntitlement({ showId: SH9, showName: "x", showDate: null, artistId: SHALEV, amount: 750, stands: false, inactiveReasonHe: "ההופעה בוטלה" });
  const hist = led().find((r) => r.id === "hist")!;
  const zeroedNote = String(hist.note);
  await ES.syncShowEntitlement({ showId: SH9, showName: "x", showDate: null, artistId: SHALEV, amount: 750, stands: true, performed: true });
  ok("6h. the earlier note is kept while zeroed and restored after (history never lost)", /היה ₪750.* \|\| היסטוריה לפני המחזור הראשון$/.test(zeroedNote) && hist.note === "היסטוריה לפני המחזור הראשון" && hist.amount === 750, { zeroedNote, note: hist.note });
  const S9 = randomUUID();
  ok("6f. A7: a plain edit to בוצע (performed, no close dialog) realizes the entitlement — ONE row", (await ES.syncShowEntitlement({ showId: S9, showName: "חדשה", showDate: "2026-10-05", artistId: SHALEV, amount: 900, stands: true, performed: true })) === "REALIZED" && led().filter((r) => r.source_show_id === S9).length === 1 && led().find((r) => r.source_show_id === S9)!.entry_type === "הכנסות");
  const S10 = randomUUID();
  await ES.syncShowEntitlement({ showId: S10, showName: "מתוכננת", showDate: "2026-10-06", artistId: SHALEV, amount: 800, stands: true });
  const exp10 = led().find((r) => r.source_show_id === S10)!;
  ok("6g. an EXPECTED row becomes realized in place when the show is performed (same id — never expected + realized)", String(exp10.entry_type) === "הכנסות צפויות" && (await ES.syncShowEntitlement({ showId: S10, showName: "מתוכננת", showDate: "2026-10-06", artistId: SHALEV, amount: 800, stands: true, performed: true })) === "REALIZED" && led().filter((r) => r.source_show_id === S10).length === 1 && String(exp10.entry_type) === "הכנסות");
  // a legacy booking-time row (keyed by the old artist-fee transaction) is ADOPTED, not duplicated
  const S2 = randomUUID(), LEG = randomUUID();
  led().push({ id: randomUUID(), artist_id: SHALEV, entry_type: "הכנסות צפויות", amount: 1000, entry_date: "2026-10-01", description: "הופעה", note: "", source_tx_id: LEG, source_show_id: null });
  await ES.syncShowEntitlement({ showId: S2, showName: "פסטידאנס", showDate: "2026-10-01", artistId: SHALEV, amount: 1000, stands: true, legacyTxId: LEG });
  ok("7. a legacy row keyed by the old fee transaction is adopted (source_show_id set) — no second row", led().filter((r) => r.source_tx_id === LEG || r.source_show_id === S2).length === 1 && led().find((r) => r.source_tx_id === LEG)!.source_show_id === S2);

  console.log("\nArtist model — a REAL payment (lib/writes/artist-payments)");
  const p1 = await AP.recordArtistPayment({ artistId: SHALEV, amount: 1500, date: "2026-11-03", method: "ביט", showId: S1, idempotencyKey: `show:${S1}` });
  const f1 = txs().find((r) => r.id === (p1 as { transactionId: string }).transactionId)!;
  const l1 = led().find((r) => r.source_tx_id === f1?.id);
  ok("8. a real payment = Finance expense שכר אמן, שולם, ₪, RECORDS (RULE) + ONE ledger payment linked by source_tx_id", p1.kind === "ok" && f1.type === "expense" && f1.category === "שכר אמן" && f1.payment_status === "שולם" && f1.currency === "₪" && f1.business_unit === "RECORDS" && f1.business_unit_source === "RULE" && f1.amount === 1500 && !!l1 && l1.entry_type === "תשלומים" && l1.amount === 1500 && l1.source_show_id === S1, { p1, f1, l1 });
  ok("8b. the Finance row is not show-linked (show_id null) and carries the idempotency marker", f1.show_id === null && String(f1.linked_session_id).startsWith("artist_payment:"));
  const again = await AP.recordArtistPayment({ artistId: SHALEV, amount: 1500, date: "2026-11-03", method: "ביט", showId: S1, idempotencyKey: `show:${S1}` });
  ok("9. a retry with the same key → the SAME rows (reused), no duplicate Finance and no duplicate ledger", again.kind === "ok" && again.reused && txs().filter((r) => r.category === "שכר אמן").length === 1 && led().filter((r) => r.entry_type === "תשלומים").length === 1);
  const dup = await AP.recordArtistPayment({ artistId: SHALEV, amount: 1500, date: "2026-11-04", idempotencyKey: "other-key" });
  ok("10. a SIMILAR payment (same artist + amount within 3 days, another key) → refused DUPLICATE with the existing record, nothing written", dup.kind === "refused" && dup.code === "DUPLICATE" && !!dup.existing?.transactionId && txs().filter((r) => r.category === "שכר אמן").length === 1, dup);
  const sep = await AP.recordArtistPayment({ artistId: SHALEV, amount: 1500, date: "2026-11-04", idempotencyKey: "other-key", allowDuplicate: true });
  ok("11. the Owner confirmed a SEPARATE payment (allowDuplicate) → a second pair is written", sep.kind === "ok" && txs().filter((r) => r.category === "שכר אמן").length === 2 && led().filter((r) => r.entry_type === "תשלומים").length === 2);
  const before = txs().length;
  failNext.artist_balance_entries = "network down";
  const part = await AP.recordArtistPayment({ artistId: AVI, amount: 700, date: "2026-11-05", idempotencyKey: "avi-1" });
  ok("12. ledger step fails → PARTIAL with a clear Hebrew message; the Finance row STAYS (no automatic DELETE)", part.kind === "partial" && /נסה שוב/.test(part.messageHe) && txs().length === before + 1 && txs().some((r) => r.id === part.transactionId));
  const fix = await AP.recordArtistPayment({ artistId: AVI, amount: 700, date: "2026-11-05", idempotencyKey: "avi-1" });
  ok("13. the retry completes the ledger side on the SAME Finance row (no second Finance row)", fix.kind === "ok" && fix.transactionId === (part as { transactionId: string }).transactionId && txs().length === before + 1 && led().filter((r) => r.source_tx_id === fix.transactionId).length === 1);
  ok("13b. input guards: amount ≤ 0 / bad date / non-₪ / unknown artist → refused, nothing written", (await AP.recordArtistPayment({ artistId: AVI, amount: 0, date: "2026-11-05" })).kind === "refused" && (await AP.recordArtistPayment({ artistId: AVI, amount: 5, date: "05/11" })).kind === "refused" && (await AP.recordArtistPayment({ artistId: AVI, amount: 5, date: "2026-11-05", currency: "$" })).kind === "refused" && (await AP.recordArtistPayment({ artistId: randomUUID(), amount: 5, date: "2026-11-05" })).kind === "refused" && txs().length === before + 1);

  console.log("\nArtist model — ledger entry writer (balance tab + Sunny)");
  const viaTab = await AP.createLedgerEntryRecord(AVI, { entryType: "תשלומים", amount: 300, entryDate: "2026-12-01", description: "תשלום", note: "", idempotencyKey: "tab-1" });
  const tabTx = txs().find((r) => r.linked_session_id === "artist_payment:tab-1");
  ok("14. 'הוסף תשלום' in the balance tab = the SAME real payment path (Finance + ledger)", viaTab.kind === "ok" && !!tabTx && tabTx.payment_status === "שולם" && led().some((r) => r.source_tx_id === tabTx.id && r.entry_type === "תשלומים"));
  const exp = await AP.createLedgerEntryRecord(AVI, { entryType: "הוצאות", amount: 200, entryDate: "2026-12-01", description: "חצי קליפ", note: "" });
  ok("15. a non-payment ledger entry never touches Finance", exp.kind === "ok" && !txs().some((r) => r.amount === 200));
  const payEntry = led().find((r) => r.source_tx_id === tabTx!.id)!;
  const typeFlip = await AP.updateLedgerEntryRecord(String(payEntry.id), AVI, { entryType: "הוצאות", amount: 300, entryDate: "2026-12-01", description: "", note: "" });
  ok("16. a payment's type is fixed (PAYMENT_TYPE_FIXED 409) — real money is never re-labelled", typeFlip.kind === "refused" && typeFlip.code === "PAYMENT_TYPE_FIXED" && typeFlip.status === 409);
  const upd = await AP.updateLedgerEntryRecord(String(payEntry.id), AVI, { entryType: "תשלומים", amount: 350, entryDate: "2026-12-02", description: "תשלום", note: "" });
  ok("17. editing a linked payment keeps Finance in step (amount + date)", upd.kind === "ok" && txs().find((r) => r.id === tabTx!.id)!.amount === 350 && txs().find((r) => r.id === tabTx!.id)!.date === "2026-12-02");
  const nTx = txs().length;
  const del = await AP.deleteLedgerEntryRecord(String(payEntry.id), AVI);
  const cancelledTx = txs().find((r) => r.id === tabTx!.id);
  ok("18. deleting a payment in the ledger → its Finance row becomes בוטל with an audit note — the transaction is NEVER deleted", del.kind === "ok" && del.financeCancelled === tabTx!.id && txs().length === nTx && cancelledTx?.payment_status === "בוטל" && /בוטל במאזן האמן/.test(String(cancelledTx?.notes)));
  void deletes;

  console.log("\nWiring — one path for every writer");
  const ws = read("lib/writes/shows.ts"), srv = read("lib/partner/act/server.ts"), bal = read("app/api/label/artists/[id]/balance/route.ts"), balE = read("app/api/label/artists/[id]/balance/[entryId]/route.ts"), sync = read("lib/shows-finance-sync.ts");
  // Phase 1 (2026-10-03): the close and setShowFeePaid ARTIST no longer pay the artist — the show writer has no payment path; the artist is paid only through the balance (recordArtistPayment in lib/writes/artist-payments)
  ok("19. the close and setShowFeePaid ARTIST write no artist payment: lib/writes/shows.ts has no recordArtistPayment / findShowPaymentEntry and refuses ARTIST_PAYOUT_VIA_BALANCE", !/recordArtistPayment|findShowPaymentEntry|createShowArtistPayment/.test(ws) && /ARTIST_PAYOUT_VIA_BALANCE/.test(ws) && /export async function recordArtistPayment/.test(read("lib/writes/artist-payments.ts")));
  ok("20. the balance routes + Sunny's ledger writers go through lib/writes/artist-payments", /createLedgerEntryRecord/.test(bal) && /updateLedgerEntryRecord/.test(balE) && /deleteLedgerEntryRecord/.test(balE) && /createLedgerEntryRecord/.test(srv) && /deleteLedgerEntryRecord/.test(srv));
  ok("21. the show sync never creates an artist-fee Finance row any more (entitlement only)", !/show_money_role: SHOW_MONEY_ROLES\.ARTIST, currency/.test(sync) && /syncShowEntitlement\(/.test(sync) && !/removeSyncedArtistBalanceEntry/.test(sync));
  ok("22. no new automatic DELETE of transactions in the payment writer", !/from\("transactions"\)\.delete\(/.test(read("lib/writes/artist-payments.ts")) && !/\.delete\(\)/.test(read("lib/artist-entitlement-sync.ts")));
  ok("23. the unit rule: ARTIST_PAYMENT → RECORDS (RULE)", inferBusinessUnit({ writer: "ARTIST_PAYMENT", type: "expense" }).unit === "RECORDS");
  ok("24. an artist payment Finance row is owned (notes / method only) — its money is changed through the ledger", JSON.stringify(OWNED_ALLOWED_FIELDS.ARTIST_PAYMENT) === JSON.stringify(["notes", "paymentMethod"]));

  console.log("\nUnit balance — production-shaped fixtures (lib/finance/unit-balance)");
  const T = (id: string, unit: string | null, type: string, amount: number, st: string, o: Partial<import("../lib/finance/unit-balance").UnitTx> = {}) => ({ id, businessUnit: unit, type, amount, currency: "₪", paymentStatus: st, ...o });
  const F1 = "c3c77159-381b-4555-a33a-b9999d3306bc", F2 = "ea40b4ea-95d6-4308-a39a-7bf929b29db1", F3 = "f07cc2fc-71cc-4f01-a894-bcc7151dc5be";
  const SHOW_A = "a69c397f-ce77-4379-974b-522b9393ea2e", SHOW_C = "d7eae5a5-d66e-4587-a6bf-6419642878ed", SHOW_X = randomUUID();
  const fixtureTx = [
    T("r-in", "RECORDS", "income", 24915.5, "התקבל"), T("r-out", "RECORDS", "expense", 17270, "שולם"),
    T("r-pay-shalev", "RECORDS", "expense", 1000, "שולם", { category: "שכר אמן", showId: null }),
    T("r-exp-in", "RECORDS", "income", 2500, "צפוי"), T("r-exp-out", "RECORDS", "expense", 500, "צפוי"),
    T(F1, "RECORDS", "expense", 1050, "בוטל", { showMoneyRole: "ARTIST_FEE" }), T(F2, "RECORDS", "expense", 1100, "בוטל", { showMoneyRole: "ARTIST_FEE" }), T(F3, "RECORDS", "expense", 1000, "בוטל", { showMoneyRole: "ARTIST_FEE" }),
    T("s-in", "STUDIO", "income", 58050, "שולם"), T("s-out", "STUDIO", "expense", 6440, "שולם"), T("s-usd", "STUDIO", "expense", 4400, "שולם", { currency: "$" }),
    T("f-in", "FILMS", "income", 3500, "התקבל"), T("f-out", "FILMS", "expense", 1000, "שולם"),
    T("e012d6d4-8dcf-42c7-925d-364964af18c2", "RECORDS", "expense", 0, "שולם", { category: "שכר אמן" }), // the approved 1,000 + 810 exception (amounts inside r-out)
    T("937031f5-9e22-4fce-91f7-77a2596f3503", "RECORDS", "expense", 0, "שולם", { category: "שכר אמן" }),
  ];
  const L = (id: string, artistId: string, entryType: string, amount: number, o: Partial<import("../lib/finance/unit-balance").UnitLedgerRow> = {}) => ({ id, artistId, entryType, amount, sourceTxId: null, ...o });
  const fixtureLedger = [
    L("l-in", SHALEV, "הכנסות", 2213), L("l-pay", SHALEV, "תשלומים", 1000, { sourceTxId: "r-pay-shalev" }),
    L("l-avi-in", AVI, "הכנסות", 500), L("l-avi-exp", AVI, "הוצאות", 500),
    L("aef0ce37-3441-454c-bd95-a6e864bb4fad", SHALEV, "הכנסות צפויות", 1000, { sourceShowId: SHOW_A }),
    L("l-inactive", SHALEV, "הכנסות צפויות", 1250, { sourceShowId: randomUUID(), note: `${UB.INACTIVE_ENTITLEMENT_PREFIX} ההופעה בוטלה` }),
    L("l-cancelled-show", AVI, "הכנסות צפויות", 900, { sourceShowId: SHOW_X }),
  ];
  const roster = [{ id: SHALEV, name: "שליו טסמה" }, { id: AVI, name: "אבי מולה" }, { id: "nagash", name: "נגש ביטס" }];
  const shows = [{ id: SHOW_A, status: "אושרה" }, { id: SHOW_C, status: "בוצע" }, { id: SHOW_X, status: "בוטל" }];
  const B = UB.computeUnitBalance({ transactions: fixtureTx, ledger: fixtureLedger, roster, shows });
  const R = B.units.RECORDS, rec = B.records;
  ok("25. Records Cash = 6,645.5 (realized income 24,915.5 − realized expense 18,270; the real artist payment counted once)", R.cash["₪"] === 6645.5 && R.realizedIncome["₪"] === 24915.5 && R.realizedExpense["₪"] === 18270, R);
  ok("26. artist liabilities 1,213 (Shalev 1,213, Avi 0) — from the realized ledger balance, never a Finance expense", rec.artistLiabilities === 1213 && rec.byArtist.find((a) => a.artistId === SHALEV)!.balance === 1213 && rec.byArtist.find((a) => a.artistId === AVI)!.balance === 0, rec.byArtist);
  ok("27. available to invest = 6,645.5 − 1,213 − reserve 0 = 5,432.5", rec.availableToInvest["₪"] === 5432.5 && rec.reserve === 0);
  ok("28. three separate categories: expected income 2,500 · future Cash expense 500 (F1–F3 cancelled) · future artist entitlements 1,000 (active only)", R.expectedIncome["₪"] === 2500 && rec.futureCashExpenses["₪"] === 500 && rec.futureArtistEntitlements.total === 1000 && rec.futureArtistEntitlements.rows.length === 1 && rec.futureArtistEntitlements.rows[0].id === "aef0ce37-3441-454c-bd95-a6e864bb4fad", { e: R.expectedExpense, f: rec.futureArtistEntitlements });
  ok("29. F1–F3 (בוטל) are history, never money (cancelled 3,150, not expected)", R.cancelled.expense["₪"] === 3150);
  ok("30. an inactive entitlement / an entitlement of a cancelled show is never a future entitlement", !rec.futureArtistEntitlements.rows.some((r) => r.id === "l-inactive" || r.id === "l-cancelled-show"));
  ok("31. Studio income 58,050 (Lil Getty unchanged); $ kept apart (4,400), never added to ₪", B.units.STUDIO.realizedIncome["₪"] === 58050 && B.units.STUDIO.realizedExpense["$"] === 4400 && B.units.STUDIO.realizedExpense["₪"] === 6440);
  ok("32. Films 3,500 / 1,000; Corporate 0; unclassified 0", B.units.FILMS.cash["₪"] === 2500 && B.units.CORPORATE.rows === 0 && B.unclassified.rows === 0);
  ok("33. All Redbloods ₪: income 86,465.5 · expense 25,710 · Cash 60,755.5 · liabilities 1,213 · available 59,542.5; $ −4,400 separate", B.all.realizedIncome["₪"] === 86465.5 && B.all.realizedExpense["₪"] === 25710 && B.all.cash["₪"] === 60755.5 && B.all.artistLiabilities === 1213 && B.all.availableAfterLiabilities["₪"] === 59542.5 && B.all.cash["$"] === -4400, B.all);

  console.log("\nPayment reconciliation (Finance ↔ ledger)");
  const rc = UB.reconcileArtistPayments({ transactions: fixtureTx, ledger: fixtureLedger });
  ok("34. a linked payment is clean; the approved 1,000 + 810 exception is EXPLAINED, never a finding", rc.ledgerPaymentsWithoutFinance.length === 0 && rc.financePaymentsWithoutLedger.length === 0 && rc.explained.length === 2, rc);
  const rc2 = UB.reconcileArtistPayments({ transactions: [...fixtureTx, T("orphan-tx", "RECORDS", "expense", 400, "שולם", { category: "שכר אמן" })], ledger: [...fixtureLedger, L("orphan-led", AVI, "תשלומים", 250)] });
  ok("35. mismatches are detected both ways (a ledger payment with no Finance · a Finance artist payment with no ledger)", rc2.ledgerPaymentsWithoutFinance.some((x) => x.ledgerEntryId === "orphan-led") && rc2.financePaymentsWithoutLedger.some((x) => x.transactionId === "orphan-tx"));
  const rc3 = UB.reconcileArtistPayments({ transactions: [T("show-paid", "RECORDS", "expense", 1250, "שולם", { showMoneyRole: "ARTIST_FEE", showId: SHOW_C })], ledger: [L("L1", SHALEV, "תשלומים", 1250, { sourceShowId: SHOW_C })] });
  ok("36. a ledger payment linked by source_show_id to a paid legacy show artist row reconciles (L1–L3 after linking)", rc3.ledgerPaymentsWithoutFinance.length === 0 && rc3.financePaymentsWithoutLedger.length === 0);

  console.log("\nSurfaces");
  const fp = read("components/finance/FinancePage.tsx"), route = read("app/api/transactions/unit-balance/route.ts");
  ok("37. Finance + Sunny read the ONE module (no second computation)", /unit-balance/.test(fp) && /computeUnitBalance/.test(read("lib/partner/finance/unit-view.ts")) && /readUnitBalanceInputs|computeUnitBalance/.test(route));
  ok("38. the unit-balance route is Owner-only", /owner/i.test(route));
  const users: string[] = [];
  const walk = (dir: string) => { for (const e of fs.readdirSync(path.resolve(__dirname, "..", dir), { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && /unit-balance/.test(read(p))) users.push(p); } };
  for (const d of ["app", "components", "lib"]) walk(d);
  users.splice(0, users.length, ...users.filter((u) => !u.startsWith("lib/partner/system/"))); // contracts describe it, they do not read it
  // lib/shows-finance-sync.ts imports only EXPLAINED_ARTIST_PAYMENTS (the Pacha / Summer Time freeze, A7 2026-09-29)
  const allowed = ["app/api/transactions/unit-balance/route.ts", "components/finance/FinancePage.tsx", "lib/artist-entitlement-sync.ts", "lib/shows-finance-sync.ts", "lib/finance/unit-balance-reader.ts", "lib/partner/finance/core.ts", "lib/partner/finance/unit-view.ts", "lib/partner/knowledge/capabilities/finance.ts"];
  ok("39. only Finance + Sunny read the unit balance (Dashboard / Insights / Reports / weekly report / targets untouched)", users.every((u) => allowed.includes(u)), users);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
