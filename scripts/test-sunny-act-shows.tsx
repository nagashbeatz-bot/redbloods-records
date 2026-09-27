/**
 * Universal Action Layer — Shows + DJ family: every primitive through the REAL service on fakes (6 standard checks each)
 * + family rules (explicit DJ fee — CLEANTONE never auto-assigned, 500₪ only as a stated default; back-to-pipeline is
 * destructive C3; full payment only through the close; notify only Shalev / CLEANTONE upcoming shows; delete blocked by
 * rehearsals; rehearsal D6 vocabulary unchanged), vocabularies pinned, shared writers + hardening in the routes.
 * Run with:   npx tsx scripts/test-sunny-act-shows.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { approveAction, executeAction, planAction, previewAction } from "../lib/partner/act/service";
import { CLEANTONE_DEFAULT_FEE, CLEANTONE_ID, REHEARSAL_STATUSES, SHOW_FEE_ROLES, SHOW_PAYMENT_STATUSES, SHOW_PRIMITIVES, SHOW_STATUSES, type ShowView } from "../lib/partner/act/primitives/shows";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Sess = { projectId: string | null; showId: string | null; title: string; date: string | null; startTime: string | null; endTime: string | null; status: string; sessionType: string; notes: string; location: string; photographer: string; hasCalendarEvent: boolean };
type NS = { status: "sent" | "failed" | "processing"; version: string; sentAt?: string };
interface W { shows: Record<string, ShowView>; clients: Record<string, string>; sessions: Record<string, Sess>; connected: boolean; sent: string[]; quote: string[]; closed: string[]; notify: { artist: Record<string, NS>; dj: Record<string, NS> }; pushOk: boolean }
const FUT = "2099-05-01";
const sv = (o: Partial<ShowView>): ShowView => ({ name: "הופעה בחיפה", artist: "שליו טסמה", artistClientId: U(60), bookerName: "מזמין", bookerClientId: null, date: FUT, startTime: "21:00", location: "חיפה", contactPerson: "", phone: "", status: "אושרה", paymentStatus: "לא שולם", showPrice: 8000, djFee: 500, djClientId: CLEANTONE_ID, djName: "CLEANTONE", djConfirmation: "ממתין לאישור", advancePayment: 0, notes: "", hasCalendarEvent: true, financeRows: 3, rehearsals: 0, currency: "₪", received: 0, credit: 0, payments: "", djFeeStatus: "צפוי", djFeeAmount: 500, artistFeeStatus: "צפוי", artistFeeAmount: 3750, ...o, remaining: o.remaining ?? Math.max(0, (o.showPrice ?? 8000) - (o.received ?? 0)) });
const world = (): W => ({
  shows: { [U(1)]: sv({}), [U(2)]: sv({ name: "ליד", status: "ליד חדש", financeRows: 0, hasCalendarEvent: false, djClientId: null, djName: "", djFee: 0 }) },
  clients: { [U(60)]: "שליו טסמה", [CLEANTONE_ID]: "CLEANTONE", [U(61)]: "DJ אחר" },
  sessions: { [U(30)]: { projectId: null, showId: U(1), title: "הופעה בחיפה", date: "2099-04-28", startTime: "18:00", endTime: "20:00", status: "מתוכנן", sessionType: "חזרה להופעה", notes: "", location: "", photographer: "", hasCalendarEvent: false } },
  connected: true, sent: [], quote: [], closed: [], notify: { artist: {}, dj: {} }, pushOk: true,
});
/** The fake claim row = the real semantics: marked "sent" ONLY after a successful push, per show version (name / date / time / location). */
const versionOf = (s: ShowView) => JSON.stringify([s.name, s.date, s.startTime, s.location]);
const stateOf = (row: NS | undefined, v: string) => (!row ? { state: "NOT_SENT" as const, sentAt: null } : row.version !== v ? { state: row.sentAt ? "SENT_PREVIOUS_VERSION" as const : "NOT_SENT" as const, sentAt: row.sentAt ?? null } : row.status === "sent" ? { state: "SENT" as const, sentAt: row.sentAt ?? null } : row.status === "processing" ? { state: "PROCESSING" as const, sentAt: null } : { state: "FAILED" as const, sentAt: null });
function fakeSend(w: W, who: "artist" | "dj", id: string) {
  const s = w.shows[id]; if (!s) return { ok: false, reason: "not_found" };
  const v = versionOf(s); const row = w.notify[who][id];
  if (row && row.version === v && row.status === "sent") return { ok: false, reason: "already_sent" };
  if (!w.pushOk) { w.notify[who][id] = { status: "failed", version: v }; return { ok: false, reason: "send_failed" }; }
  w.sent.push(`${who}:${id}`); w.notify[who][id] = { status: "sent", version: v, sentAt: "2099-04-20T10:00:00.000Z" };
  return { ok: true };
}
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const map: Record<string, keyof ShowView> = { name: "name", date: "date", start_time: "startTime", location: "location", contact_person: "contactPerson", phone: "phone", booker_name: "bookerName", notes: "notes", show_price: "showPrice", payment_status: "paymentStatus", currency: "currency", advance_payment: "advancePayment", dj_client_id: "djClientId", dj_name: "djName", dj_fee: "djFee", status: "status" };
  const writers = {
    async readClient(id: string) { return w.clients[id] ? { name: w.clients[id], phone: "", email: "", type: "אמן", status: "פעיל", notes: "" } : null; },
    async calendarConnected() { return w.connected; },
    async readShow(id: string) { return w.shows[id] ? { ...w.shows[id], rehearsals: Object.values(w.sessions).filter((s) => s.showId === id).length } : null; },
    async createShow(b: Record<string, unknown>) { calls.push("createShow"); const id = U(++n); w.shows[id] = sv({ name: String(b.name), status: String(b.status), showPrice: Number(b.show_price), djFee: Number(b.dj_fee), djClientId: (b.dj_client_id as string) ?? null, djName: String(b.dj_name ?? ""), date: (b.date as string) ?? null, financeRows: 0, hasCalendarEvent: b.addToCalendar === true, currency: String(b.currency ?? "₪"), received: Number(b.advance_payment) || 0 }); return { id, calendarWarning: null }; },
    async updateShow(id: string, b: Record<string, unknown>) {
      calls.push("updateShow"); const s = w.shows[id]; if (!s) return { kind: "not_found" as const };
      if (b.removeFromCalendar) s.hasCalendarEvent = false; if (b.addToCalendar) s.hasCalendarEvent = true;
      for (const [k, v] of Object.entries(b)) if (map[k]) (s as unknown as Record<string, unknown>)[map[k]] = v;
      if (["ליד חדש", "ממתין לתשובה", "צריך פולואפ"].includes(s.status)) s.financeRows = 0;
      if (b.payment_status === "שולם") s.received = Math.max(s.received, s.showPrice); // the remainder was received (D5)
      s.remaining = Math.max(0, s.showPrice - s.received); s.credit = Math.max(0, s.received - s.showPrice);
      return { kind: "ok" as const };
    },
    async closeShow(id: string, c: { incomeReceived: boolean }) { calls.push("closeShow"); w.closed.push(id); w.shows[id].status = "בוצע"; if (c.incomeReceived) { w.shows[id].paymentStatus = "שולם"; w.shows[id].received = Math.max(w.shows[id].received, w.shows[id].showPrice); w.shows[id].remaining = 0; } return { kind: "ok" as const }; },
    async recordShowPayment(id: string, p: { amount: number; date: string }) { calls.push("recordShowPayment"); const s = w.shows[id]; if (!s) return { kind: "not_found" as const }; s.received += p.amount; s.remaining = Math.max(0, s.showPrice - s.received); s.credit = Math.max(0, s.received - s.showPrice); s.payments = [s.payments, `${p.amount}@${p.date}`].filter(Boolean).join(";"); s.paymentStatus = s.remaining === 0 ? "שולם" : "מקדמה"; return { kind: "ok" as const, transactionId: U(700) }; },
    async deleteShowCompletely(id: string) { calls.push("deleteShowCompletely"); if (Object.values(w.sessions).some((s) => s.showId === id)) return { kind: "has_rehearsals" as const }; delete w.shows[id]; return { kind: "ok" as const }; },
    async markShowQuoteSent(id: string) { calls.push("markShowQuoteSent"); w.quote.push(id); return "ok" as const; },
    async notifyShowArtist(id: string) { calls.push("notifyShowArtist"); return fakeSend(w, "artist", id); },
    async notifyShowDj(id: string) { calls.push("notifyShowDj"); return fakeSend(w, "dj", id); },
    async setShowFeePaid(id: string, role: string, paid: boolean) { calls.push("setShowFeePaid"); const s = w.shows[id]; if (!s) return { kind: "not_found" as const }; const k = role === "DJ_FEE" ? "djFeeStatus" : "artistFeeStatus"; s[k] = paid ? "שולם" : "צפוי"; return { kind: "ok" as const }; },
    async showNotifyStates(id: string) { const s = w.shows[id]; if (!s) return null; const v = versionOf(s); return { artist: stateOf(w.notify.artist[id], v), dj: stateOf(w.notify.dj[id], v) }; },
    async readSession(id: string) { return w.sessions[id] ? { ...w.sessions[id] } : null; },
    async countSessionTransactions() { return 1; },
    async createSession(s: Sess & { showId?: string | null }) { calls.push("createSession"); const id = U(++n); w.sessions[id] = { ...s, showId: s.showId ?? null, hasCalendarEvent: false }; return { id, calendarError: null }; },
    async updateSession(id: string, p: Record<string, unknown>) { calls.push("updateSession"); for (const [k, v] of Object.entries(p)) if (k in w.sessions[id]) (w.sessions[id] as unknown as Record<string, unknown>)[k] = v; return { calendarSynced: true }; },
    async deleteSession(id: string) { calls.push("deleteSession"); delete w.sessions[id]; return { calendarDeleted: true }; },
  };
  return { w, calls, writers };
}
const S1 = `show:${U(1)}`, S2 = `show:${U(2)}`, R30 = `session:${U(30)}`;
const CASES: FamilyCase<W>[] = [
  { id: "CREATE_SHOW", args: { name: "הופעה באילת", artistClient: `client:${U(60)}`, date: "2099-06-01", startTime: "22:00", status: "אושרה", showPrice: 9000, djClient: `client:${CLEANTONE_ID}`, djFee: 500 }, confirm: "כן בוס, ₪9,000 ₪500 2099-06-01", bad: { name: "x", status: "בוצע", showPrice: 1 }, missing: { name: "x", status: "אושרה", showPrice: 1, djClient: `client:${U(99)}`, djFee: 1 }, stale: (w) => { w.clients[U(60)] = "שם אחר"; }, check: (w, c) => Object.values(w.shows).some((s) => s.name === "הופעה באילת" && s.djFee === 500 && s.djClientId === CLEANTONE_ID && s.showPrice === 9000) && c.join() === "createShow" },
  { id: "UPDATE_SHOW_DETAILS", args: { show: S1, location: "חיפה — אודיטוריום", startTime: "20:30" }, confirm: "כן בוס, 20:30", bad: { show: S1, startTime: "8pm" }, missing: { show: `show:${U(9)}`, location: "x" }, wrongKind: { show: `client:${U(60)}`, location: "x" }, stale: (w) => { w.shows[U(1)].location = "טבריה"; }, check: (w) => w.shows[U(1)].location === "חיפה — אודיטוריום" && w.shows[U(1)].startTime === "20:30" },
  { id: "SET_SHOW_MONEY", args: { show: S1, showPrice: 8500 }, confirm: "כן בוס, 8500", bad: { show: S1, paymentStatus: "חלקי" }, missing: { show: `show:${U(9)}`, showPrice: 1 }, stale: (w) => { w.shows[U(1)].showPrice = 7000; }, check: (w) => w.shows[U(1)].showPrice === 8500 && w.shows[U(1)].remaining === 8500 },
  { id: "RECORD_SHOW_PAYMENT", args: { show: S1, amount: 3000, date: "2099-04-01", paymentMethod: "העברה בנקאית" }, confirm: "כן בוס, 3000 2099-04-01", bad: { show: S1, amount: -5, date: "2099-04-01" }, missing: { show: `show:${U(9)}`, amount: 1, date: "2099-04-01" }, wrongKind: { show: `client:${U(60)}`, amount: 1, date: "2099-04-01" }, stale: (w) => { w.shows[U(1)].received = 500; }, check: (w, c) => w.shows[U(1)].received === 3000 && w.shows[U(1)].remaining === 5000 && c.join() === "recordShowPayment" },
  { id: "MARK_SHOW_FEE_PAID", args: { show: S1, role: "DJ_FEE", paid: true, date: "2099-05-02", paymentMethod: "ביט" }, bad: { show: S1, role: "HOST_FEE", paid: true }, missing: { show: `show:${U(9)}`, role: "DJ_FEE", paid: true }, wrongKind: { show: `client:${U(60)}`, role: "DJ_FEE", paid: true }, stale: (w) => { w.shows[U(1)].djFeeStatus = "בוטל"; }, check: (w, c) => w.shows[U(1)].djFeeStatus === "שולם" && w.shows[U(1)].artistFeeStatus === "צפוי" && w.shows[U(1)].received === 0 && c.join() === "setShowFeePaid" },
  { id: "SET_SHOW_CURRENCY", args: { show: S1, currency: "$" }, confirm: "כן בוס, $", bad: { show: S1, currency: "GBP" }, missing: { show: `show:${U(9)}`, currency: "$" }, stale: (w) => { w.shows[U(1)].showPrice = 1; }, check: (w) => w.shows[U(1)].currency === "$" },
  { id: "ASSIGN_SHOW_DJ", args: { show: S1, djClient: `client:${U(61)}`, djFee: 700 }, confirm: "כן בוס, DJ אחר ₪700", bad: { show: S1, djClient: `client:${U(61)}` }, missing: { show: `show:${U(9)}`, remove: true }, stale: (w) => { w.shows[U(1)].djFee = 600; }, check: (w) => w.shows[U(1)].djClientId === U(61) && w.shows[U(1)].djName === "DJ אחר" && w.shows[U(1)].djFee === 700 },
  { id: "CONFIRM_SHOW", args: { show: S2, status: "אושרה" }, confirm: "כן בוס, אושרה", bad: { show: S2, status: "בוצע" }, missing: { show: `show:${U(9)}`, status: "אושרה" }, stale: (w) => { w.shows[U(2)].status = "צריך פולואפ"; }, check: (w) => w.shows[U(2)].status === "אושרה" },
  { id: "MOVE_SHOW_TO_PIPELINE", args: { show: S1, status: "ממתין לתשובה" }, confirm: "כן בוס, ממתין לתשובה מחיקה", bad: { show: S1, status: "בוטל" }, missing: { show: `show:${U(9)}`, status: "ליד חדש" }, stale: (w) => { w.shows[U(1)].financeRows = 2; }, check: (w) => w.shows[U(1)].status === "ממתין לתשובה" && w.shows[U(1)].financeRows === 0 },
  { id: "CANCEL_SHOW", args: { show: S1, removeFromCalendar: true }, confirm: "כן בוס, ביטול", bad: { show: "show:x" }, missing: { show: `show:${U(9)}` }, stale: (w) => { w.shows[U(1)].showPrice = 1; }, check: (w) => w.shows[U(1)].status === "בוטל" && !w.shows[U(1)].hasCalendarEvent },
  { id: "CLOSE_SHOW", args: { show: S1, incomeReceived: true, djPaid: true, artistPaid: false }, confirm: "כן בוס, התקבל ✓ DJ ✓ אמן ✗", bad: { show: S1, incomeReceived: "כן", djPaid: true, artistPaid: true }, missing: { show: `show:${U(9)}`, incomeReceived: true, djPaid: true, artistPaid: true }, stale: (w) => { w.shows[U(1)].djFee = 900; }, check: (w, c) => w.shows[U(1)].status === "בוצע" && w.shows[U(1)].paymentStatus === "שולם" && c.join() === "closeShow" },
  { id: "SET_SHOW_CALENDAR", args: { show: S1, mode: "REMOVE" }, confirm: "כן בוס, הסרה מהיומן", bad: { show: S1, mode: "TOGGLE" }, missing: { show: `show:${U(9)}`, mode: "ADD" }, stale: (w) => { w.shows[U(1)].name = "x"; }, check: (w) => !w.shows[U(1)].hasCalendarEvent },
  { id: "MARK_SHOW_QUOTE_SENT", args: { show: S2 }, confirm: "כן בוס, פולואפ", bad: { show: "show:1" }, missing: { show: `show:${U(9)}` }, stale: (w) => { w.shows[U(2)].showPrice = 1; }, check: (w) => w.quote.includes(U(2)) },
  { id: "NOTIFY_SHOW_ARTIST", args: { show: S1 }, confirm: "כן בוס, שליו", bad: { show: "show:1" }, missing: { show: `show:${U(9)}` }, stale: (w) => { w.shows[U(1)].location = "x"; }, check: (w) => w.sent.join() === `artist:${U(1)}` },
  { id: "NOTIFY_SHOW_DJ", args: { show: S1 }, confirm: "כן בוס, קלינטון", bad: { show: "show:1" }, missing: { show: `show:${U(9)}` }, stale: (w) => { w.shows[U(1)].startTime = "23:00"; }, check: (w) => w.sent.join() === `dj:${U(1)}` },
  { id: "DELETE_SHOW", args: { show: S2 }, confirm: "כן בוס, מחיקה", bad: { show: "show:x" }, missing: { show: `show:${U(9)}` }, stale: (w) => { w.shows[U(2)].name = "y"; }, check: (w) => !w.shows[U(2)] },
  { id: "BOOK_SHOW_REHEARSAL", args: { show: S1, date: "2099-04-29", startTime: "18:00", endTime: "20:00", cost: 180, paymentStatus: "לא שולם" }, confirm: "כן בוס, 2099-04-29 18:00 ₪180 לא שולם", bad: { show: S1, date: "2099-04-29", startTime: "18:00", endTime: "20:00", status: "התקיים" }, missing: { show: `show:${U(9)}`, date: "2099-04-29", startTime: "18:00", endTime: "20:00" }, stale: (w) => { w.shows[U(1)].name = "שם חדש"; }, check: (w) => Object.values(w.sessions).some((s) => s.date === "2099-04-29" && s.sessionType === "חזרה להופעה" && s.showId === U(1) && s.location === "גרוב הוד השרון") },
  { id: "UPDATE_SHOW_REHEARSAL", args: { session: R30, status: "בוצע" }, bad: { session: R30, status: "התקיים" }, missing: { session: `session:${U(9)}`, status: "בוצע" }, wrongKind: { session: S1, status: "בוצע" }, stale: (w) => { w.sessions[U(30)].startTime = "19:00"; }, check: (w) => w.sessions[U(30)].status === "בוצע" },
  { id: "DELETE_SHOW_REHEARSAL", args: { session: R30 }, confirm: "כן בוס, מחיקה", bad: { session: "session:1" }, missing: { session: `session:${U(9)}` }, stale: (w) => { w.sessions[U(30)].status = "בוצע"; }, check: (w) => !w.sessions[U(30)] },
];

(async () => {
  console.log("Shows family — standard checks");
  ok("the case table covers every Shows primitive", CASES.map((c) => c.id).sort().join() === SHOW_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nShow rules (Owner decisions preserved)");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  const noFee = await q("CREATE_SHOW", { name: "x", status: "אושרה", showPrice: 1, djClient: `client:${CLEANTONE_ID}` });
  ok("CLEANTONE's fee is never applied silently: without an explicit fee the plan is refused and names the 500₪ default", noFee.status === "DJ_FEE_REQUIRED" && JSON.stringify(noFee).includes(`₪${CLEANTONE_DEFAULT_FEE}`));
  const noDj = await q("CREATE_SHOW", { name: "x", status: "אושרה", showPrice: 1000 });
  ok("no DJ given → no DJ assigned and a DJ fee of 0 (never auto-CLEANTONE)", noDj.status === "PREVIEW" && JSON.stringify(noDj).includes('"djFee"') && !JSON.stringify(noDj).includes(CLEANTONE_ID));
  const h0 = mk(); await fullFlow(mkDeps(h0.writers).d, "CREATE_SHOW", { name: "בלי DJ", status: "אושרה", showPrice: 1000 }, "כן בוס, ₪1,000");
  ok("the created show has no DJ and fee 0", Object.values(h0.w.shows).some((s) => s.name === "בלי DJ" && s.djClientId === null && s.djFee === 0));
  ok("back to pipeline is DESTRUCTIVE (C3) and declares DELETION", ACTION_REGISTRY.get("MOVE_SHOW_TO_PIPELINE")!.confirmation === "C3_STRONG_APPROVAL" && ACTION_REGISTRY.get("MOVE_SHOW_TO_PIPELINE")!.effects.includes("DELETION" as never));
  const pp = await q("MOVE_SHOW_TO_PIPELINE", { show: S1, status: "ליד חדש" });
  ok("the pipeline preview says received money is never deleted (D5)", pp.status === "PREVIEW" && JSON.stringify(pp).includes("כסף שהתקבל לא נמחק לעולם"));
  ok("full payment only through the close (SET_SHOW_MONEY שולם on an open show is refused)", (await q("SET_SHOW_MONEY", { show: S1, paymentStatus: "שולם" })).status === "USE_CLOSE");

  console.log("\nA1 — show money independence (client paid ≠ DJ paid ≠ artist paid)");
  for (const ps of ["לא שולם", "צפוי", "בוטל"]) {
    const r = await q("SET_SHOW_MONEY", { show: S1, paymentStatus: ps });
    ok(`A1. SET_SHOW_MONEY '${ps}' (an implicit undo / typed truth) is refused and points to Finance`, r.status !== "PREVIEW" && (r.status === "USE_FINANCE" || /פיננסים|Finance/.test(JSON.stringify(r))), r.status);
  }
  ok("A1. SET_SHOW_MONEY accepts only 'שולם' as the payment value (intent)", JSON.stringify(ACTION_REGISTRY.get("SET_SHOW_MONEY")!.args.find((x) => x.name === "paymentStatus")?.values) === JSON.stringify(["שולם"]));
  { const h = mk(); h.w.shows[U(1)].status = "בוצע"; h.w.shows[U(1)].paymentStatus = "שולם"; h.w.shows[U(1)].received = 8000; h.w.shows[U(1)].remaining = 0;
    ok("A1. 'שולם' with nothing left to collect → refused (no invented income)", (await q("SET_SHOW_MONEY", { show: S1, paymentStatus: "שולם" }, h)).status === "NOTHING_TO_RECORD"); }
  { const h = mk(); h.w.shows[U(1)].status = "בוצע"; h.w.shows[U(1)].paymentStatus = "שולם"; h.w.shows[U(1)].received = 8000; h.w.shows[U(1)].remaining = 500;
    ok("A1. a stale 'שולם' mirror with a remainder → refused, pointing to RECORD_SHOW_PAYMENT (the writer would not record it)", (await q("SET_SHOW_MONEY", { show: S1, paymentStatus: "שולם" }, h)).status === "USE_RECORD_PAYMENT"); }
  { const h = mk(); h.w.shows[U(1)].status = "בוצע"; h.w.shows[U(1)].received = 3000; h.w.shows[U(1)].remaining = 5000; h.w.shows[U(1)].paymentStatus = "מקדמה";
    const r = await fullFlow(mkDeps(h.writers).d, "SET_SHOW_MONEY", { show: S1, paymentStatus: "שולם" }, "מאשר");
    ok("A1. SET_SHOW_MONEY 'שולם' on a done show with a remainder → the remainder is received; DJ / artist fee statuses untouched", r.e?.status === "APPLIED_AS_EXPECTED" && h.w.shows[U(1)].remaining === 0 && h.w.shows[U(1)].djFeeStatus === "צפוי" && h.w.shows[U(1)].artistFeeStatus === "צפוי", r.e?.status); }
  const sm = await q("SET_SHOW_MONEY", { show: S1, showPrice: 9000 });
  const smj = JSON.stringify(sm);
  ok("A1. SET_SHOW_MONEY preview discloses the calendar update (price in the event) and that realized ledger income is not re-synced after the close", sm.status === "PREVIEW" && smj.includes("שינוי מחיר מעדכן אותו") && smj.includes("לא מסונכרנת מחדש אחרי הסגירה"));
  ok("A1. SET_SHOW_MONEY preview says received payments never change and DJ / artist fee statuses never change", smj.includes("תשלומים שהתקבלו לא משתנים") && smj.includes("סטטוס התשלום של שכר ה-DJ ושל שכר האמן לא משתנה") && smj.includes("שינוי מחיר לעולם לא רושם הכנסה"));
  const cl = JSON.stringify(await q("CLOSE_SHOW", { show: S1, incomeReceived: true, djPaid: false, artistPaid: false }));
  ok("A1. CLOSE_SHOW preview: a flag left false never downgrades an already-paid fee", cl.includes("שכר ששולם כבר נשאר שולם"));
  { const h = mk(); h.w.shows[U(1)].djFeeStatus = "שולם";
    ok("A1. MARK_SHOW_FEE_PAID on an already-paid fee → ALREADY_PAID", (await q("MARK_SHOW_FEE_PAID", { show: S1, role: "DJ_FEE", paid: true }, h)).status === "ALREADY_PAID");
    const r = await fullFlow(mkDeps(h.writers).d, "MARK_SHOW_FEE_PAID", { show: S1, role: "DJ_FEE", paid: false }, "מאשר");
    ok("A1. MARK_SHOW_FEE_PAID paid=false = the explicit undo (שולם → צפוי); nothing else changes", r.e?.status === "APPLIED_AS_EXPECTED" && h.w.shows[U(1)].djFeeStatus === "צפוי" && h.calls.join() === "setShowFeePaid", r.e?.status); }
  { const h = mk(); h.w.shows[U(1)].artistFeeStatus = null;
    ok("A1. MARK_SHOW_FEE_PAID with no fee row → NO_FEE_ROW (never creates one)", (await q("MARK_SHOW_FEE_PAID", { show: S1, role: "ARTIST_FEE", paid: true }, h)).status === "NO_FEE_ROW"); }
  { const h = mk(); h.w.shows[U(1)].djFeeStatus = "בוטל";
    ok("A1. MARK_SHOW_FEE_PAID on a cancelled fee row → FEE_CANCELLED", (await q("MARK_SHOW_FEE_PAID", { show: S1, role: "DJ_FEE", paid: true }, h)).status === "FEE_CANCELLED"); }
  { const h = mk(); const p = await q("MARK_SHOW_FEE_PAID", { show: S1, role: "ARTIST_FEE", paid: true }, h);
    const pj = JSON.stringify(p);
    ok("A1. MARK_SHOW_FEE_PAID is FINANCIAL, declares FINANCE only, and the preview shows the fee row before → after", ACTION_REGISTRY.get("MARK_SHOW_FEE_PAID")!.riskClass === "FINANCIAL" && JSON.stringify(ACTION_REGISTRY.get("MARK_SHOW_FEE_PAID")!.effects) === JSON.stringify(["FINANCE"]) && pj.includes("'צפוי' → 'שולם'") && pj.includes("תשלום הלקוח (לא משתנה)"), pj.slice(0, 400)); }
  const past = mk(); past.w.shows[U(1)].date = "2020-01-01";
  ok("notify only an upcoming show", (await q("NOTIFY_SHOW_ARTIST", { show: S1 }, past)).status === "NOT_UPCOMING");
  const other = mk(); other.w.shows[U(1)].artist = "אבי"; other.w.shows[U(1)].djClientId = U(61);
  ok("artist notify exists only for Shalev; DJ notify only for CLEANTONE", (await q("NOTIFY_SHOW_ARTIST", { show: S1 }, other)).status === "NOT_SHALEV" && (await q("NOTIFY_SHOW_DJ", { show: S1 }, other)).status === "NOT_CLEANTONE");
  ok("notify is EXTERNAL_COMMUNICATION with PUSH declared", ["NOTIFY_SHOW_ARTIST", "NOTIFY_SHOW_DJ"].every((id) => ACTION_REGISTRY.get(id)!.effects.includes("PUSH" as never) && ACTION_REGISTRY.get(id)!.riskClass === "EXTERNAL_COMMUNICATION"));
  ok("a show with rehearsals cannot be deleted", (await q("DELETE_SHOW", { show: S1 })).status === "HAS_REHEARSALS");
  const c = mk(); const rc = await fullFlow(mkDeps(c.writers).d, "CLOSE_SHOW", { show: S1, incomeReceived: true, djPaid: true, artistPaid: true }, "מאשר");
  ok("closing: the preview lists the three party flags; a plain \"מאשר\" approves the exact plan (no repeated values)", JSON.stringify(rc.p).includes("requiredConfirmationValues") && rc.e?.status === "APPLIED_AS_EXPECTED" && c.calls.join() === "closeShow");
  ok("a regular studio session is not edited as a rehearsal", (await q("UPDATE_SHOW_REHEARSAL", { session: `session:${U(30)}`, status: "בוצע" }, (() => { const x = mk(); x.w.sessions[U(30)].sessionType = "סשן"; return x; })())).status === "WRONG_ENTITY_TYPE");
  ok("D5 is decided: recording show money is executable through RECORD_SHOW_PAYMENT", ACTION_REGISTRY.get("SHOW.RECORD_SHOW_ADVANCE")?.availabilityDetail === "EXECUTABLE");

  console.log("\nPOLISH FIX #1 — Push sent-state (fakes only: no real push)");
  { // A1 + A5: artist
    const h = mk(); const d = mkDeps(h.writers).d;
    const r = await fullFlow(d, "NOTIFY_SHOW_ARTIST", { show: S1 }, "מאשר");
    const fresh = (r.e?.freshState as { fields?: Record<string, { value: unknown }> } | null)?.fields;
    ok("A1. artist sent → the claim row is sent AND the fresh read says artistNotified = true", r.e?.status === "APPLIED_AS_EXPECTED" && h.w.notify.artist[U(1)]?.status === "sent" && fresh?.artistNotified?.value === true && fresh?.artistNotifyState?.value === "SENT", { e: r.e?.status, fresh });
    ok("A5. the fresh read carries when it was sent", fresh?.artistSentAt?.value === "2099-04-20T10:00:00.000Z");
    const again = await planAction({ intentHe: "x", actionId: "NOTIFY_SHOW_ARTIST", args: { show: S1 } }, OWNER, d);
    ok("A6. already sent → Sunny never offers a second send (ALREADY_SENT, no push)", again.status === "ALREADY_SENT" && h.w.sent.length === 1 && String(again.messageHe).includes("כבר נשלחה"), again.status);
  }
  { // A2: DJ, independent of the artist
    const h = mk(); const d = mkDeps(h.writers).d;
    const r = await fullFlow(d, "NOTIFY_SHOW_DJ", { show: S1 }, "מאשר");
    const fresh = (r.e?.freshState as { fields?: Record<string, { value: unknown }> } | null)?.fields;
    ok("A2. DJ sent → djNotified = true in the fresh read; the artist state is untouched", r.e?.status === "APPLIED_AS_EXPECTED" && fresh?.djNotified?.value === true && !h.w.notify.artist[U(1)], { e: r.e?.status, fresh });
    ok("A2b. the artist can still be sent after the DJ (separate claim rows)", (await planAction({ intentHe: "x", actionId: "NOTIFY_SHOW_ARTIST", args: { show: S1 } }, OWNER, d)).status === "PREVIEW");
    ok("A2c. DJ already sent → ALREADY_SENT", (await planAction({ intentHe: "x", actionId: "NOTIFY_SHOW_DJ", args: { show: S1 } }, OWNER, d)).status === "ALREADY_SENT");
  }
  { // A3: failed push
    const h = mk(); h.w.pushOk = false; const d = mkDeps(h.writers).d;
    const r = await fullFlow(d, "NOTIFY_SHOW_ARTIST", { show: S1 }, "מאשר");
    const st = await h.writers.showNotifyStates(U(1));
    ok("A3. a failed push is never marked sent: the outcome is not success and the state is FAILED (artistNotified false)", r.e?.status !== "APPLIED_AS_EXPECTED" && st?.artist.state === "FAILED" && h.w.sent.length === 0, r.e?.status);
    ok("A3b. after a failure a new send may be planned (a retry is allowed, never automatic)", (await planAction({ intentHe: "x", actionId: "NOTIFY_SHOW_ARTIST", args: { show: S1 } }, OWNER, d)).status === "PREVIEW" && h.w.sent.length === 0);
  }
  { // A4: refresh / re-read never sends
    const h = mk(); const d = mkDeps(h.writers).d;
    const p = await planAction({ intentHe: "x", actionId: "NOTIFY_SHOW_ARTIST", args: { show: S1 } }, OWNER, d);
    for (let i = 0; i < 3; i++) await previewAction({ planId: p.planId }, OWNER, d);
    await h.writers.showNotifyStates(U(1)); await h.writers.readShow(U(1));
    ok("A4. planning, re-previewing and re-reading never send a push", p.status === "PREVIEW" && h.w.sent.length === 0 && !h.calls.some((x) => x.startsWith("notify")));
    // a push sent through another channel (the portal button) after the preview → the plan is STALE → no second push
    fakeSend(h.w, "artist", U(1));
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, d);
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, d);
    ok("A6b. sent elsewhere after the preview → STALE, no duplicate push", e.status === "STALE" && h.w.sent.length === 1, e.status);
  }
  { // a changed show version re-opens the send (the writer's own rule)
    const h = mk(); const d = mkDeps(h.writers).d;
    await fullFlow(d, "NOTIFY_SHOW_ARTIST", { show: S1 }, "מאשר");
    h.w.shows[U(1)].startTime = "22:30";
    const st = await h.writers.showNotifyStates(U(1));
    ok("A7. a new show version (time changed) → SENT_PREVIOUS_VERSION and a new send may be planned", st?.artist.state === "SENT_PREVIOUS_VERSION" && (await planAction({ intentHe: "x", actionId: "NOTIFY_SHOW_ARTIST", args: { show: S1 } }, OWNER, d)).status === "PREVIEW");
  }
  const nsrc = read("lib/show-notify.ts") + read("lib/dj-show-notify.ts");
  ok("A8. the real senders still mark 'sent' only after classifyPushResult === sent, and the state readers only SELECT", /status: "sent", fingerprint/.test(nsrc) && /export async function readShalevShowNotifyState[\s\S]{0,600}\.select\("value"\)/.test(nsrc) && /export async function readDjShowNotifyState[\s\S]{0,600}\.select\("value"\)/.test(nsrc) && !/export async function read(Shalev|Dj)ShowNotifyState[\s\S]{0,700}\.(insert|update|upsert)\(/.test(nsrc));
  ok("A9. show_view / label view / operating model read the same claim rows by their status (a failed send is never 'sent')", /"\^show_notify:"/.test(read("lib/partner/system/settings.ts")) && /"\^dj_show_notify:"/.test(read("lib/partner/system/settings.ts")) && [read("lib/partner/label/view.ts"), read("lib/partner/sunny/operating.ts")].every((x) => /showNotifyStateOf\(/.test(x) && /computeShowNotifyFingerprint\(/.test(x) && !/status === "failed" \? "FAILED"/.test(x)) && /showNotifyStateOf\(v, currentFp\)/.test(read("lib/partner/shows/view.ts")) /* all three readers: the app's own read rule with the show's current version (failed → FAILED; older version → SENT_PREVIOUS_VERSION) */);

  console.log("\nVocabularies pinned to the code");
  const st = read("lib/shows-types.ts");
  ok("show statuses = lib/shows-types SHOW_STATUSES", st.includes(`SHOW_STATUSES = [${SHOW_STATUSES.map((x) => `"${x}"`).join(",")}]`));
  ok("show fee roles = lib/shows-types SHOW_MONEY_ROLES DJ / ARTIST", st.includes(`DJ: "${SHOW_FEE_ROLES[0]}", ARTIST: "${SHOW_FEE_ROLES[1]}"`));
  ok("show payment statuses = lib/shows-types PAYMENT_STATUSES", st.includes(`PAYMENT_STATUSES = [${SHOW_PAYMENT_STATUSES.map((x) => `"${x}"`).join(",")}]`));
  ok("rehearsal statuses = RehearsalModal OP_STATUSES", read("components/shows/RehearsalModal.tsx").includes(`OP_STATUSES = [${REHEARSAL_STATUSES.map((x) => `"${x}"`).join(", ")}]`));
  ok("CLEANTONE id = lib/red-artists/cleantone.ts", read("lib/red-artists/cleantone.ts").includes(`CLEANTONE_CLIENT_ID = "${CLEANTONE_ID}"`));

  console.log("\nShared writers + hardening");
  ok("show routes use the shared writer (create / update / delete / quote)", /createShowRecord\(/.test(read("app/api/shows/route.ts")) && /updateShowRecord\(/.test(read("app/api/shows/[id]/route.ts")) && /deleteShowRecord\(/.test(read("app/api/shows/[id]/route.ts")) && /markQuoteSent\(/.test(read("app/api/shows/[id]/quote-sent/route.ts")));
  const ws = read("lib/writes/shows.ts");
  ok("show money reuses the app's own split (the agreement split = computeShowSplit + counted rehearsals, שליו / אבי only)", /showAgreementSplit\(show, await getRehearsalCountedForShow\(id\)\)/.test(ws) && /syncShowFinance/.test(ws) && /computeShowSplit\(/.test(read("lib/label-agreements.ts")));
  ok("HARDENED: the booking ledger sync never adds an expected row next to a close-realized one", /if \(realized\) return;/.test(read("lib/artist-balance-show-sync.ts")) && (read("lib/shows-finance-sync.ts").match(/showId: show\.id,/g) ?? []).length === 2);
  ok("HARDENED: deleting a show rehearsal re-derives the show split", /rehearsal delete split re-sync/.test(read("lib/writes/sessions.ts")));
  ok("HARDENED: Sunny's show delete = the hub (calendar, tasks, finance, show) server-side", /removeFromCalendar: true/.test(ws) && /deleteTaskRecord\(t\)/.test(ws));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
