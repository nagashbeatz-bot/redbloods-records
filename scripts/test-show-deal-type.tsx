/**
 * Show DEAL TYPE (Owner decision 2026-09-27): PAID / UNPAID_COLLAB ("שת״פ ללא תשלום") — a deal type, NOT a payment status.
 * An unpaid collaboration is operationally a completely normal show with ZERO automatic finance activity: the REAL
 * lib/shows-finance-sync + lib/writes/shows + lib/writes/show-payments + lib/writes/sessions run on an in-memory database
 * (no production, no network, no push, no calendar). Plus: PAID unchanged, the two guarded switches, the readers / signals
 * (show_view, Finance Brain, COO, label, portal, hub KPIs) and Sunny's primitives + contracts.
 * Run with:   npx tsx scripts/test-show-deal-type.tsx      Pure; never touches production.
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

// ── the same in-memory PostgREST-ish fake the A1 show-money test uses ─────────────────────────────────────────────
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
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return c; },
    is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return c; },
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
const closeLedger: string[] = [], calendar: string[] = [];
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from } };
  if (/artist-balance-show-close-sync$/.test(request)) return {
    async resolveShowArtistId() { return { status: "ok", artistId: "artist-1" }; }, logArtistResolutionSkip() { /* */ },
    async syncArtistIncomeFromClosedShow(x: { show: { id: string } }) { closeLedger.push(`income:${x.show.id}`); }, async createShowArtistPayment(x: { show: { id: string } }) { closeLedger.push(`payment:${x.show.id}`); }, async findShowPaymentEntry() { return null; },
  };
  if (/show-quote-followup$/.test(request)) return { async closeQuoteFollowupTask() { /* */ }, async ensureQuoteFollowupTask() { return { task: null, created: false }; } };
  if (/show-cancel-tasks$/.test(request)) return { async cancelOpenShowTasks() { /* */ } };
  // the calendar keeps working exactly as for any show (recorded, never a real Google call)
  if (/google-calendar$/.test(request)) return { async isConnected() { return true; }, async createCalendarEvent(summary: string, _s: string, _e: string, o?: { description?: string }) { calendar.push(`create:${summary}|${o?.description ?? ""}`); return { id: `evt-${calendar.length}` }; }, async updateCalendarEvent(id: string, p: { description?: string }) { calendar.push(`update:${id}|${p?.description ?? ""}`); return {}; }, async deleteCalendarEvent(id: string) { calendar.push(`delete:${id}`); } };
  if (/session-notify$/.test(request)) return { async notifySessionCreatedForShalev() { /* */ } };
  if (/projects-store$/.test(request)) return { async touchProject() { /* */ }, async ensureProjectStartDate() { /* */ } };
  return orig.call(this, request, parent, isMain);
};

const txOf = (showId: string) => t("transactions").filter((r) => r.show_id === showId || String(r.notes ?? "").includes(showId));
const show = (id: string) => t("shows").find((r) => r.id === id)!;
// net model (2026-09-28): the artist's show share is an entitlement in the ledger (never a Finance artist-fee row)
const earning = (showId: string) => t("artist_balance_entries").find((r) => r.source_show_id === showId && (r.entry_type === "הכנסות צפויות" || r.entry_type === "הכנסות")) as Row | undefined;
const inactive = (r: Row | undefined) => String(r?.note ?? "").startsWith("[זכאות לא פעילה]");
const BASE = { name: "הופעה בתל אביב", artist: "שליו טסמה", booker_name: "מזמין", date: "2099-10-15", start_time: "21:00", location: "תל אביב", contact_person: "", phone: "" };

(async () => {
  const W = await import("../lib/writes/shows");
  const fin = await import("../lib/shows-finance-sync");
  const { recordShowPayment } = await import("../lib/writes/show-payments");
  const S = await import("../lib/writes/sessions");
  const T = await import("../lib/shows-types");
  const store = await import("../lib/shows-store");

  console.log("A. Create an unpaid collaboration → a normal show, zero money");
  const c1 = (await W.createShowRecord({ ...BASE, status: "אושרה", deal_type: "UNPAID_COLLAB" })).show;
  ok("A1. created with deal_type UNPAID_COLLAB, price 0 and DJ fee 0 (never the implicit 500)", c1.deal_type === "UNPAID_COLLAB" && c1.show_price === 0 && c1.dj_fee === 0 && c1.artist_fee === 0, c1);
  ok("A2. NO transaction of any kind (expected income / payment / DJ / artist / rehearsal)", txOf(c1.id).length === 0 && t("transactions").length === 0, t("transactions"));
  ok("A3. no artist ledger activity (no entitlement row, no close sync)", !t("artist_balance_entries").length && closeLedger.length === 0, { closeLedger });
  ok("A4. payment status is never 'שת״פ' (the column keeps its neutral default, not read)", !String(c1.payment_status).includes("שת") && T.isUnpaidCollab(c1) && !T.showHasMoney(c1));
  const w = read("lib/writes/shows.ts"); const calBlock = w.slice(w.indexOf("// Google Calendar — only if explicitly requested"), w.indexOf("return { show: saved, calendarWarning, paymentWarning };"));
  ok("A5. the calendar works as for any show: the create / update calendar path has no deal-type condition (only its description text changes — G15)", calBlock.length > 100 && !/deal_type|isUnpaidCollab|UNPAID_COLLAB/.test(calBlock) && /"dj_fee", "deal_type",\s*\]\);/.test(w));
  let threw = "";
  try { await W.createShowRecord({ ...BASE, name: "x", status: "אושרה", deal_type: "UNPAID_COLLAB", show_price: 1500 }); } catch (e) { threw = (e as Error).message; }
  ok("A6. money on a collaboration create is REFUSED (never silently dropped): a price", threw.includes("שת״פ") && !t("shows").some((s) => s.name === "x"), threw);
  threw = ""; try { await W.createShowRecord({ ...BASE, name: "y", status: "אושרה", deal_type: "UNPAID_COLLAB", advance_payment: 300 }); } catch (e) { threw = (e as Error).message; }
  ok("A7. …a deposit is refused too (no payment row ever)", threw.includes("שת״פ") && t("transactions").length === 0, threw);
  threw = ""; try { await W.createShowRecord({ ...BASE, name: "z", deal_type: "FREE" }); } catch (e) { threw = (e as Error).message; }
  ok("A8. an unknown deal type is refused", threw.includes("סוג עסקה"), threw);

  console.log("\nB. The operational lifecycle is unchanged — and still zero money");
  const lead = (await W.createShowRecord({ ...BASE, name: "ליד שת״פ", status: "ליד חדש", deal_type: "UNPAID_COLLAB" })).show;
  ok("B1. a collaboration can be known already at the lead stage", lead.deal_type === "UNPAID_COLLAB" && lead.status === "ליד חדש");
  const conf = await W.updateShowRecord(lead.id, { status: "נסגר" });
  ok("B2. confirming (ליד → נסגר) → ok, still no transaction", conf.kind === "ok" && txOf(lead.id).length === 0);
  const conf2 = await W.updateShowRecord(lead.id, { status: "אושרה", payment_status: "צפוי" });
  ok("B3. an 'אושרה' save with the old automatic 'צפוי' → no money and no payment label stored", conf2.kind === "ok" && txOf(lead.id).length === 0 && show(lead.id).payment_status === "לא שולם");
  const edit = await W.updateShowRecord(lead.id, { location: "חיפה", date: "2099-10-20", notes: "חימום" });
  ok("B4. operational edits (place / date / notes) save normally, no money", edit.kind === "ok" && show(lead.id).location === "חיפה" && txOf(lead.id).length === 0);
  const close = await W.closeShowRecord(lead.id, { markDone: true, incomeReceived: false, djPaid: false, artistPaid: false, note: "היה מעולה" });
  ok("B5. closing (→ בוצע) works operationally: status בוצע + a notes line, no money, no ledger", close.kind === "ok" && show(lead.id).status === "בוצע" && String(show(lead.id).notes).includes("שת״פ ללא תשלום") && txOf(lead.id).length === 0 && closeLedger.length === 0);
  const closeMoney = await W.closeShowRecord(c1.id, { markDone: true, incomeReceived: true, djPaid: false, artistPaid: false });
  ok("B6. a close that claims money received is refused (no payment row)", closeMoney.kind === "refused" && (closeMoney as { code: string }).code === "UNPAID_COLLAB" && txOf(c1.id).length === 0);
  const dlgMoney = await W.updateShowRecord(c1.id, { status: "בוצע", closeShow: { incomeReceived: false, djPaid: true, artistPaid: false } });
  ok("B7. the close dialog with a 'DJ paid' flag is refused too", dlgMoney.kind === "refused" && show(c1.id).status === "אושרה");
  const cancel = await W.updateShowRecord(c1.id, { status: "בוטל" });
  const reopen = await W.updateShowRecord(c1.id, { status: "אושרה" });
  ok("B8. cancel + reopen work, still zero money", cancel.kind === "ok" && reopen.kind === "ok" && txOf(c1.id).length === 0);

  console.log("\nC. Every finance operation on a collaboration is refused clearly");
  const pay = await recordShowPayment(c1.id, { amount: 500, date: "2099-10-16" });
  ok("C1. recording a payment → refused UNPAID_COLLAB, no row", pay.kind === "refused" && (pay as { code: string }).code === "UNPAID_COLLAB" && txOf(c1.id).length === 0, pay);
  const feePaid = await W.setShowFeePaid(c1.id, "DJ_FEE", true, {});
  ok("C2. marking a DJ fee paid → refused UNPAID_COLLAB", feePaid.kind === "refused" && (feePaid as { code: string }).code === "UNPAID_COLLAB");
  const price = await W.updateShowRecord(c1.id, { show_price: 2000 });
  ok("C3. setting a price while it stays a collaboration → refused (the switch to PAID is its own step)", price.kind === "refused" && (price as { code: string }).code === "UNPAID_COLLAB" && show(c1.id).show_price === 0);
  const djFee = await W.updateShowRecord(c1.id, { dj_fee: 500, dj_name: "CLEANTONE" });
  ok("C4. a DJ fee on a collaboration → refused (the DJ itself is operational and allowed)", djFee.kind === "refused");
  const dj = await W.updateShowRecord(c1.id, { dj_name: "CLEANTONE", dj_fee: 0 });
  ok("C5. assigning a DJ with no fee works (DJ confirmation etc. stay operational), no DJ expense row", dj.kind === "ok" && show(c1.id).dj_name === "CLEANTONE" && txOf(c1.id).length === 0);
  let sessErr = "";
  try { await S.createSession({ title: "חזרה", date: "2099-10-10", startTime: "18:00", endTime: "20:00", sessionType: "חזרה להופעה", showId: c1.id, cost: 300 } as never); } catch (e) { sessErr = (e as Error).message; }
  ok("C6. a rehearsal with a cost → refused BEFORE any write (no session, no expense); an exceptional expense is recorded in Finance explicitly", sessErr.includes("שת״פ") && !t("sessions").some((x) => x.show_id === c1.id) && txOf(c1.id).length === 0, sessErr);
  await S.createSession({ title: "חזרה", date: "2099-10-10", startTime: "18:00", endTime: "20:00", sessionType: "חזרה להופעה", showId: c1.id, cost: 0 } as never);
  ok("C7. the same rehearsal without a cost is booked normally (operational), no expense", t("sessions").some((x) => x.show_id === c1.id) && txOf(c1.id).length === 0);
  const sid = String(t("sessions").find((x) => x.show_id === c1.id)!.id);
  sessErr = ""; try { await S.updateSession(sid, { cost: 250 }); } catch (e) { sessErr = (e as Error).message; }
  ok("C8. adding a cost to that rehearsal later → refused, the session keeps no cost", sessErr.includes("שת״פ") && !Number(t("sessions").find((x) => x.id === sid)!.cost));
  await fin.syncRehearsalFinance({ id: "r-x", date: "2099-10-10", cost: 400 }, show(c1.id) as never, "לא שולם");
  ok("C9. the rehearsal sync itself never writes for a collaboration (last guard)", txOf(c1.id).length === 0);

  console.log("\nD. PAID works exactly as before");
  const p1 = (await W.createShowRecord({ ...BASE, name: "הופעה בתשלום", status: "אושרה", show_price: 3000 })).show;
  const roles = () => txOf(p1.id).map((r) => `${r.show_money_role}:${r.amount}:${r.payment_status}`).sort().join(",");
  ok("D1. a PAID confirmed show (deal_type default) gets its rows: expected 3,000 + DJ 500 (the default); the artist's 1,250 is an expected ledger entitlement (no Finance artist row)", p1.deal_type === "PAID" && roles() === "DJ_FEE:500:צפוי,SHOW_BALANCE_EXPECTED:3000:צפוי" && earning(p1.id)?.entry_type === "הכנסות צפויות" && earning(p1.id)?.amount === 1250, roles());
  const pp = await recordShowPayment(p1.id, { amount: 1000, date: "2099-10-16" });
  ok("D2. a payment on a PAID show records as always (1,000 received, 2,000 expected, מקדמה)", pp.kind === "ok" && show(p1.id).payment_status === "מקדמה");

  console.log("\nE. PAID → UNPAID_COLLAB (guarded: real money is never deleted / hidden)");
  const sw1 = await W.updateShowRecord(p1.id, { deal_type: "UNPAID_COLLAB" });
  ok("E1. a received client payment → the switch is REFUSED (DEAL_SWITCH_BLOCKED) and nothing changed", sw1.kind === "refused" && (sw1 as { code: string }).code === "DEAL_SWITCH_BLOCKED" && /תשלומי לקוח/.test((sw1 as { messageHe: string }).messageHe) && show(p1.id).deal_type === "PAID" && txOf(p1.id).length === 3 && !inactive(earning(p1.id)), sw1);
  const p2 = (await W.createShowRecord({ ...BASE, name: "DJ שולם", status: "אושרה", show_price: 2000 })).show;
  await W.setShowFeePaid(p2.id, "DJ_FEE", true, {});
  const sw2 = await W.updateShowRecord(p2.id, { deal_type: "UNPAID_COLLAB" });
  ok("E2. a paid DJ fee → refused, the paid row stays", sw2.kind === "refused" && /שכר ששולם/.test((sw2 as { messageHe: string }).messageHe) && txOf(p2.id).some((r) => r.show_money_role === "DJ_FEE" && r.payment_status === "שולם"));
  const p3 = (await W.createShowRecord({ ...BASE, name: "חזרה עם עלות", status: "אושרה", show_price: 2000 })).show;
  await S.createSession({ title: "חזרה", date: "2099-10-09", startTime: "18:00", endTime: "20:00", sessionType: "חזרה להופעה", showId: p3.id, cost: 300 } as never);
  const sw3 = await W.updateShowRecord(p3.id, { deal_type: "UNPAID_COLLAB" });
  ok("E3. a recorded rehearsal expense → refused (never removed automatically)", sw3.kind === "refused" && /הוצאות חזרה/.test((sw3 as { messageHe: string }).messageHe) && txOf(p3.id).some((r) => r.show_money_role === "REHEARSAL"));
  const p4 = (await W.createShowRecord({ ...BASE, name: "מאזן ממומש", status: "אושרה", show_price: 2000 })).show;
  t("artist_balance_entries").push({ id: randomUUID(), artist_id: "artist-1", entry_type: "הכנסות", amount: 750, source_show_id: p4.id });
  const sw4 = await W.updateShowRecord(p4.id, { deal_type: "UNPAID_COLLAB" });
  ok("E4. a realized artist ledger entry → refused", sw4.kind === "refused" && /מאזן האמן/.test((sw4 as { messageHe: string }).messageHe) && show(p4.id).deal_type === "PAID");
  const p5 = (await W.createShowRecord({ ...BASE, name: "רק צפי", status: "אושרה", show_price: 2500 })).show;
  ok("E5a. (a clean PAID show with only still-expected rows + an expected entitlement — an entitlement is not money, it never blocks)", txOf(p5.id).length === 2 && earning(p5.id)?.entry_type === "הכנסות צפויות");
  const sw5 = await W.updateShowRecord(p5.id, { deal_type: "UNPAID_COLLAB" });
  const s5 = show(p5.id);
  ok("E5. only still-expected rows → the switch runs: deal UNPAID_COLLAB, price / DJ / artist 0, the expected rows removed, links cleared", sw5.kind === "ok" && s5.deal_type === "UNPAID_COLLAB" && s5.show_price === 0 && s5.dj_fee === 0 && txOf(p5.id).length === 0 && !s5.linked_income_transaction_id && !s5.linked_dj_expense_transaction_id, { sw5, rows: txOf(p5.id) });
  const ent5 = earning(p5.id)?.id;
  ok("E6. …the expected entitlement is marked NOT ACTIVE with them (kept — the ledger is never deleted by a switch)", inactive(earning(p5.id)) && !!ent5);

  console.log("\nF. UNPAID_COLLAB → PAID (the normal finance flow for the show's state)");
  const back0 = await W.updateShowRecord(p5.id, { deal_type: "PAID" });
  ok("F1. without a price → refused PRICE_REQUIRED, still a collaboration", back0.kind === "refused" && (back0 as { code: string }).code === "PRICE_REQUIRED" && show(p5.id).deal_type === "UNPAID_COLLAB");
  const back = await W.updateShowRecord(p5.id, { deal_type: "PAID", show_price: 1800 });
  const r5 = txOf(p5.id).map((r) => `${r.show_money_role}:${r.amount}`).sort().join(",");
  ok("F2. with a price → PAID, the normal rows are created for a confirmed show (expected 1,800; DJ 0 → no DJ row, never an implicit 500); the SAME entitlement row is active again at 900", back.kind === "ok" && show(p5.id).deal_type === "PAID" && show(p5.id).dj_fee === 0 && r5 === "SHOW_BALANCE_EXPECTED:1800" && earning(p5.id)?.id === ent5 && earning(p5.id)?.amount === 900 && !inactive(earning(p5.id)), { r5, e: earning(p5.id) });

  console.log("\nG. Readers + signals: counted as a show, never as money");
  const { buildFinanceBrain } = await import("../lib/partner/finance/core");
  const rawFin = (shows: Row[]) => ({ transactions: [], projects: [], financeSettings: [], engineerWorks: [], shows, proposals: [], clients: [], labelArtists: [], ledger: [], mediaIncome: [], redFilmsPayments: [], victorSalary: [] }) as never;
  const doneCollab = { id: "s-c", date: "2026-09-01", status: "בוצע", dealType: "UNPAID_COLLAB", paymentStatus: "לא שולם", price: 0, currency: "₪", incomeTxId: null, artistTxId: null, djTxId: null };
  const donePaid = { ...doneCollab, id: "s-p", dealType: "PAID" };
  const sig = (shows: Row[]) => buildFinanceBrain(rawFin(shows), new Date("2026-09-27T09:00:00Z")).signals.find((x) => x.code === "SHOW_PRICE_MISSING")?.count ?? 0;
  ok("G1. Finance Brain: a done collaboration with price 0 is NOT SHOW_PRICE_MISSING (a done PAID show at 0 still is)", sig([doneCollab]) === 0 && sig([donePaid]) === 1, [sig([doneCollab]), sig([donePaid])]);
  const { buildFinanceIntegrity } = await import("../lib/partner/finance/integrity");
  const integ = (shows: Row[]) => { const raw = rawFin(shows); const st = buildFinanceBrain(raw, new Date("2026-09-27T09:00:00Z")); return JSON.stringify(buildFinanceIntegrity(raw, st, new Date("2026-09-27T09:00:00Z"))); };
  ok("G2. Finance integrity: no SHOW_FINANCE_INCOMPLETE for a collaboration (still for a PAID show at 0)", !integ([doneCollab]).includes("SHOW_FINANCE_INCOMPLETE") && integ([donePaid]).includes("SHOW_FINANCE_INCOMPLETE"));
  // show_view — the real builder on the label detail source
  const { buildShowView, showPortfolio } = await import("../lib/partner/shows/view");
  const ds = (o: Row) => ({ id: "sv1", name: "שת״פ בחיפה", artistText: "שליו טסמה", date: "2099-10-15", startTime: "21:00", location: "חיפה", contactPerson: null, hasPhone: false, status: "אושרה", dealType: "UNPAID_COLLAB", paymentStatus: "לא שולם", price: 0, djFee: 0, artistFee: 0, advancePayment: 0, currency: "₪", notes: null, artistClientId: null, bookerClientId: null, bookerName: null, djClientId: null, djName: null, djConfirmationStatus: null, djConfirmedAt: null, hasCalendarEvent: true, incomeTxId: null, djExpenseTxId: null, artistExpenseTxId: null, createdAt: null, updatedAt: null, ...o });
  const src = (shows: Row[]) => ({ now: new Date("2026-09-27T09:00:00Z"), identities: { cleantone: null }, labelDetail: { status: "OK", value: { shows: { rows: shows, capped: false }, ledger: { rows: [], capped: false }, artists: { rows: [], capped: false } } } }) as never;
  const MONEY_CODES = ["PRICE_MISSING", "UPCOMING_UNPAID", "DONE_UNPAID", "DONE_WITHOUT_LEDGER", "ARTIST_ROW_UNPAID_AFTER_DONE", "SHOW_SPLIT_NOT_DEFINED", "DJ_FEE_WITHOUT_DJ", "PAID_FEE_ROW_MISMATCH"];
  const vUp = buildShowView(src([ds({})]), "sv1")!;
  const vDone = buildShowView(src([ds({ id: "sv2", status: "בוצע", date: "2026-09-01" })]), "sv2")!;
  const codes = [...vUp.signals, ...vDone.signals].map((x) => x.code);
  ok("G3. show_view: an upcoming / done collaboration raises NO money signal (PRICE_MISSING / UPCOMING_UNPAID / DONE_UNPAID / DONE_WITHOUT_LEDGER / split …)", !codes.some((c) => MONEY_CODES.includes(c)), codes);
  ok("G4. …and NO signal for being a collaboration (it is a normal business state)", !codes.some((c) => /COLLAB|DEAL/.test(c) && c !== "COLLABORATION"), codes);
  ok("G5. show_view reads the deal type canonically: identity.dealType + money.dealType UNPAID_COLLAB, moneyApplies false, no price / payment status", vUp.identity.dealType === "UNPAID_COLLAB" && vUp.money.dealType === "UNPAID_COLLAB" && vUp.money.moneyApplies === false && vUp.money.price === null && vUp.money.clientPayment === null && vUp.money.split.labelProfit === null);
  ok("G6. …a collaboration still is a real upcoming show (UPCOMING signal kept)", vUp.signals.some((x) => x.code === "UPCOMING"));
  const vPaid = buildShowView(src([ds({ id: "sv3", dealType: "PAID", status: "אושרה" })]), "sv3")!;
  ok("G7. a PAID confirmed show at price 0 still raises PRICE_MISSING (unchanged)", vPaid.signals.some((x) => x.code === "PRICE_MISSING") && vPaid.money.dealType === "PAID" && vPaid.money.moneyApplies === true);
  const port = showPortfolio(src([ds({}), ds({ id: "sv4", dealType: "PAID", price: 3000 })]));
  ok("G8. show_portfolio: both counted as shows; the collaboration carries dealType and no price / payment", port.length === 2 && port.find((x) => x.key === "show:sv1")?.dealType === "UNPAID_COLLAB" && port.find((x) => x.key === "show:sv1")?.price === null);
  // COO + label + label shows route + hub + portal: the one rule is applied at every money consumer
  const src2 = (p: string) => read(p);
  ok("G9. COO: collaborations never enter doneUnpaid / done_no_price / SHOW_UNPAID_UPCOMING", /moneyShow\(s\) && s\.paymentStatus !== "שולם" && s\.price > 0/.test(src2("lib/coo/facts.ts")) && /s\.dealType === "UNPAID_COLLAB" \|\| s\.paymentStatus === "שולם"/.test(src2("lib/coo/signals.ts")));
  ok("G10. label view: SHOW_DONE_UNPAID skips a collaboration; label page / shows route / recoup never count its money (but count the show)", /s\.dealType !== "UNPAID_COLLAB" && s\.status === "בוצע"/.test(src2("lib/partner/label/view.ts")) && /t\.count \+= 1;\s*\n\s*if \(unpaidCollab\) continue;/.test(src2("app/api/label/artists/[id]/shows/route.ts")) && /deal_type === "UNPAID_COLLAB"\) continue/.test(src2("app/api/label/artists/[id]/recoup/route.ts")) && /dealType !== "UNPAID_COLLAB" && s\.paymentStatus !== "שולם"/.test(src2("components/label/LabelPage.tsx")));
  const hub = src2("components/shows/ShowsHubPreview.tsx");
  ok("G11. Shows hub: total = every show; money KPIs exclude collaborations (isFinanciallyConfirmedShow), balance '—', badge 'שת״פ', unpaid tab excludes them", /total:\s+shows\.length/.test(hub) && /FINANCIALLY_CONFIRMED_STATUSES\.has\(s\.status\) && !isUnpaidCollab\(s\)/.test(hub) && /isUnpaidCollab\(s\)\s*\n?\s*\? <span style=\{\{ color: MUTED, fontWeight: 700 \}\}>—<\/span>/.test(hub) && /UNPAID_COLLAB_BADGE/.test(hub) && /"לא שולם" && !isUnpaidCollab\(s\)/.test(hub));
  ok("G12. the new-show form offers 'הופעה בתשלום' / 'שת״פ ללא תשלום' (default PAID) and hides price / DJ / artist fee / deposit / payment status for a collaboration", /deal_type: "PAID",\r?\n};/.test(hub) && /"הופעה בתשלום"/.test(hub) && /form\.deal_type !== "UNPAID_COLLAB" && <div>\s*\n\s*<label style=\{labelStyle\}>סטטוס תשלום/.test(hub) && /Row: prices — no spin buttons \(an unpaid collaboration has none\)/.test(hub));
  ok("G13. DJ portal: a collaboration shows 'שת״פ' and '—' instead of a fee / payment pill; the show still appears (never filtered)", /dealType: s\.deal_type === "UNPAID_COLLAB" \? "UNPAID_COLLAB" : "PAID"/.test(src2("app/api/red-artists/cleantone-summary/route.ts")) && /s\.dealType === "UNPAID_COLLAB" \? <CollabPill \/>/.test(src2("components/red-artists/ArtistPortalPage.tsx")) && !/deal_type/.test(src2("app/api/red-artists/shalev-summary/route.ts")));
  ok("G14. artist notifications are untouched by the deal type (the notify message / fingerprint never read money)", !/deal_type|dealType/.test(src2("lib/show-notify-pure.ts") + src2("lib/dj-show-notify.ts") + src2("lib/show-notify.ts")));
  ok("G15. the calendar description rule: collaboration → 'סוג עסקה: שת״פ ללא תשלום', PAID → the price line", store.showCalendarDescription({ ...BASE, show_price: 0, dj_name: "", notes: "", deal_type: "UNPAID_COLLAB" } as never).includes("שת״פ ללא תשלום") && store.showCalendarDescription({ ...BASE, show_price: 3000, dj_name: "", notes: "", deal_type: "PAID" } as never).includes("מחיר הופעה: ₪3,000"));

  console.log("\nI. No DJ is needed by default for a collaboration (Owner 2026-09-27) — PAID unchanged");
  const noDjCollab = buildShowView(src([ds({ id: "dj1", djClientId: null, djName: null })]), "dj1")!;
  ok("I1. a collaboration without a DJ → NO NO_DJ signal and no 'who is the DJ?' question", !noDjCollab.signals.some((x) => x.code === "NO_DJ") && !noDjCollab.questions.some((q) => q.kind === "DJ"));
  const noDjPaid = buildShowView(src([ds({ id: "dj2", dealType: "PAID", price: 3000, djClientId: null, djName: null })]), "dj2")!;
  ok("I2. a PAID show without a DJ still raises NO_DJ + the DJ question exactly as before", noDjPaid.signals.some((x) => x.code === "NO_DJ") && noDjPaid.questions.some((q) => q.kind === "DJ"));
  const djCollab = buildShowView(src([ds({ id: "dj3", djClientId: "client-dj-9", djName: "DJ אורח" })]), "dj3")!;
  ok("I3. a collaboration WITH an explicit DJ keeps the DJ information (the view names him), no NO_DJ, and still no money", !!djCollab.dj && JSON.stringify(djCollab.dj).includes("DJ אורח") && !djCollab.signals.some((x) => x.code === "NO_DJ") && djCollab.money.moneyApplies === false, djCollab.dj);
  ok("I4. the new-show form creates the 'לסגור דיג׳יי' task only for a PAID show without a DJ", /const noDj = form\.deal_type !== "UNPAID_COLLAB" && !form\.dj_client_id && !form\.dj_name\.trim\(\);/.test(hub) && /לסגור דיג׳יי להופעה/.test(hub));
  ok("I5. label view: SHOW_WITHOUT_DJ is not raised for a collaboration (PAID condition otherwise unchanged)", /s\.role === "ARTIST" && !s\.dj && s\.dealType !== "UNPAID_COLLAB" && s\.status !== "בוטל" && SHOW_ACTIVE\.has/.test(src2("lib/partner/label/view.ts")));
  const w2 = await W.createShowRecord({ ...BASE, name: "שת״פ עם DJ", status: "אושרה", deal_type: "UNPAID_COLLAB", dj_name: "DJ אורח" });
  ok("I6. a collaboration created WITH a DJ saves him (operational) — still no transaction", w2.show.dj_name === "DJ אורח" && txOf(w2.show.id).length === 0);

  console.log("\nH. Sunny: canonical deal type, typed actions, contracts");
  const SM = await import("../lib/partner/system/shows");
  ok("H1. the show contract: deal_type is a CANONICAL column, vocabulary PAID / UNPAID_COLLAB = the code, NOT a payment status", (SM.SHOW_SCHEMA_COLUMNS as readonly string[]).includes("deal_type") && SM.SHOW_FIELDS.find((f) => f.field === "deal_type")?.classification === "CANONICAL" && JSON.stringify(SM.SHOW_VOCABULARIES.dealTypes) === JSON.stringify(T.SHOW_DEAL_TYPES) && !(SM.SHOW_VOCABULARIES.paymentStatuses as readonly string[]).some((p) => /שת/.test(p)));
  ok("H2. the money model + lifecycle document the switch rules and 'zero automatic money'", /0 automatic income \+ 0 automatic expense/.test(SM.MONEY_MODEL.dealType) && SM.LIFECYCLE.some((x) => x.transition.startsWith("DEAL_TYPE")));
  const { SHOW_PRIMITIVES } = await import("../lib/partner/act/primitives/shows");
  const create = SHOW_PRIMITIVES.find((p) => p.actionId === "CREATE_SHOW")!;
  const cp = create.plan({ name: "שת״פ", status: "אושרה", dealType: "UNPAID_COLLAB" }, {});
  ok("H3. CREATE_SHOW with dealType UNPAID_COLLAB needs NO price (Sunny never asks it) → after: price 0, DJ 0, received 0", cp.ok === true && (cp as { after: Row }).after.dealType === "UNPAID_COLLAB" && (cp as { after: Row }).after.showPrice === 0);
  const cpBad = create.plan({ name: "שת״פ", status: "אושרה", dealType: "UNPAID_COLLAB", showPrice: 1000 }, {});
  ok("H4. …a price with it is refused (UNPAID_COLLAB); a PAID create still requires the price", cpBad.ok === false && (cpBad as { code: string }).code === "UNPAID_COLLAB" && create.plan({ name: "x", status: "אושרה" }, {}).ok === false);
  const cur = { dealType: "UNPAID_COLLAB", status: "אושרה", received: 0, remaining: 0, currency: "₪", paymentStatus: "לא שולם", djFeeStatus: null, artistFeeStatus: null } as Row;
  const refusedBy = (id: string, a: Row) => { const r = SHOW_PRIMITIVES.find((p) => p.actionId === id)!.plan(a, cur as never); return r.ok === false ? (r as { code: string }).code : "PLANNED"; };
  ok("H5. money actions on a collaboration are refused clearly (payment / fee paid / price / currency / close with money)", refusedBy("RECORD_SHOW_PAYMENT", { amount: 100, date: "2099-10-16" }) === "UNPAID_COLLAB" && refusedBy("MARK_SHOW_FEE_PAID", { role: "DJ_FEE", paid: true }) === "UNPAID_COLLAB" && refusedBy("SET_SHOW_MONEY", { showPrice: 100 }) === "UNPAID_COLLAB" && refusedBy("SET_SHOW_CURRENCY", { currency: "$" }) === "UNPAID_COLLAB" && refusedBy("CLOSE_SHOW", { incomeReceived: true, djPaid: false, artistPaid: false }) === "UNPAID_COLLAB");
  ok("H6. …an operational close (no money flags) is planned", refusedBy("CLOSE_SHOW", { incomeReceived: false, djPaid: false, artistPaid: false }) === "PLANNED");
  const deal = SHOW_PRIMITIVES.find((p) => p.actionId === "SET_SHOW_DEAL_TYPE")!;
  const paidCur = { dealType: "PAID", received: 0, currency: "₪", djFeeStatus: "צפוי", artistFeeStatus: "צפוי", showPrice: 3000, djFee: 500 } as Row;
  ok("H7. SET_SHOW_DEAL_TYPE: PAID → collaboration planned when no money moved; refused with a received payment / a paid fee", deal.plan({ dealType: "UNPAID_COLLAB" }, paidCur as never).ok === true && (deal.plan({ dealType: "UNPAID_COLLAB" }, { ...paidCur, received: 500 } as never) as { code?: string }).code === "DEAL_SWITCH_BLOCKED" && (deal.plan({ dealType: "UNPAID_COLLAB" }, { ...paidCur, djFeeStatus: "שולם", djFeeAmount: 500 } as never) as { code?: string }).code === "DEAL_SWITCH_BLOCKED");
  ok("H8. …collaboration → PAID needs a price (PRICE_REQUIRED), then it is planned", (deal.plan({ dealType: "PAID" }, cur as never) as { code?: string }).code === "PRICE_REQUIRED" && deal.plan({ dealType: "PAID", showPrice: 2000 }, cur as never).ok === true);
  ok("H9. SET_SHOW_DEAL_TYPE goes through the shared writer (updateShowRecord) and is a strong (C3) approval — it may remove still-expected rows", deal.meta.writer.includes("updateShowRecord") && deal.meta.riskClass === "DESTRUCTIVE" && deal.meta.effects.includes("DELETION"));
  const { NEW_SHOW } = await (async () => { const m = await import("../lib/partner/system/owner-model"); return { NEW_SHOW: m.WORKFLOW_MODELS.find((w) => w.event === "NEW_SHOW")! }; })();
  ok("H10. the Owner model: the deal type is asked; the price only for a paid show (never for שת״פ)", NEW_SHOW.required.some((r) => r.item.startsWith("deal type")) && NEW_SHOW.required.some((r) => r.item === "price + currency" && /never asked for שת״פ/.test(r.note ?? "")));
  const { CAPABILITY_CHANGES, SYSTEM_BASELINE_VERSION } = await import("../lib/partner/system");
  ok("H11. baseline bumped with SHOWS read + execute change entries", ((v) => v.date > "2026.09.27" || (v.date === "2026.09.27" && v.n >= 45))({ date: SYSTEM_BASELINE_VERSION.split("-")[0], n: Number(SYSTEM_BASELINE_VERSION.split("-")[1]) }) && CAPABILITY_CHANGES.filter((c) => c.version === "2026.09.27-45" && c.domain === "SHOWS").length === 2);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
