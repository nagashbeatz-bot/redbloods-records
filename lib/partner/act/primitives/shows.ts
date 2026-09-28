/**
 * SUNNY UNIVERSAL ACTION LAYER — Shows + DJ family. Every write goes through lib/writes/shows (+ lib/writes/sessions
 * for rehearsals) — the same writers the Shows hub uses. Show money is the app's own rule (computeShowSplit /
 * rehearsalCountedAmount inside the shared sync). Each show has ONE currency (₪ / $ / €) — never converted, never added. The DJ is
 * exactly who the Boss names: CLEANTONE is never auto-assigned, and his 500₪ is an operating default the Boss confirms
 * or overrides, never applied silently. D5 (decided + migrated): actual show money = SHOW_PAYMENT rows in Finance (RECORD_SHOW_PAYMENT);
 * the show's payment status / received are derived from them. D6: only בוצע counts; the page-load auto-mark skips show rehearsals.
 * A1 (Owner canon 2026-09-27): client paid ≠ DJ paid ≠ artist paid — a fee row is paid only explicitly (CLOSE_SHOW flag /
 * MARK_SHOW_FEE_PAID); no save ever invents received money or undoes a payment (reversal = an explicit Finance correction).
 */
import type { ArgSpec } from "../types";
import { finishPlan, parseKey, realYmd, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";
import { dupCandidates, dupField, dupGate, dupWarnings, DUP_ARGS } from "./duplicates";

/** SENT = sent for the show's CURRENT version (name / date / time / location); SENT_PREVIOUS_VERSION = the writer would send again. */
export type NotifyState = { state: "SENT" | "SENT_PREVIOUS_VERSION" | "FAILED" | "PROCESSING" | "NOT_SENT"; sentAt: string | null };
export type ShowView = { name: string; artist: string; artistClientId: string | null; bookerName: string; bookerClientId: string | null; date: string | null; startTime: string | null; location: string; contactPerson: string; phone: string; status: string;
  /** Deal type (NOT a payment status): PAID / UNPAID_COLLAB — an unpaid collaboration has no money at all. */
  dealType: string; paymentStatus: string; showPrice: number; djFee: number; djClientId: string | null; djName: string; djConfirmation: string | null; advancePayment: number; notes: string; hasCalendarEvent: boolean; financeRows: number; rehearsals: number; currency: string; received: number; remaining: number; credit: number; payments: string;
  /** A1: the DJ / artist fee rows in Finance (null = no row) — their own obligations, never the client payment. */
  djFeeStatus: string | null; djFeeAmount: number | null; artistFeeStatus: string | null; artistFeeAmount: number | null };
type UpdateResult = { kind: "ok" | "not_found" | "balance_sync_failed" | "refused"; warning?: string | null };
export interface ShowFamilyWriters {
  readShow(id: string): Promise<ShowView | null>;
  createShow(body: Record<string, unknown>): Promise<{ id: string; calendarWarning: string | null; paymentWarning?: string | null }>;
  updateShow(id: string, body: Record<string, unknown>): Promise<UpdateResult>;
  closeShow(id: string, c: { markDone: boolean; incomeReceived: boolean; djPaid: boolean; artistPaid: boolean; artistPaidDate?: string; djName?: string; note?: string }): Promise<UpdateResult>;
  deleteShowCompletely(id: string): Promise<{ kind: "ok" | "has_rehearsals" | "has_payments" | "has_paid_fees" | "not_found" }>;
  recordShowPayment(id: string, p: { amount: number; date: string; currency: string; method: string; note: string }): Promise<{ kind: "ok" | "not_found" | "refused"; messageHe?: string; transactionId?: string }>;
  markShowQuoteSent(id: string): Promise<"ok" | "skipped" | "not_found">;
  notifyShowArtist(id: string): Promise<{ ok: boolean; reason?: string }>;
  notifyShowDj(id: string): Promise<{ ok: boolean; reason?: string }>;
  /** A1: the explicit "DJ / artist fee paid" (or back to צפוי) on the show's existing fee row (setShowFeePaid). */
  setShowFeePaid(id: string, role: string, paid: boolean, o: { date?: string; method?: string }): Promise<{ kind: "ok" | "not_found" | "refused"; messageHe?: string }>;
  /** READ-ONLY: the canonical send state (the claim rows the senders mark "sent" only after a successful push). */
  showNotifyStates(id: string): Promise<{ artist: NotifyState; dj: NotifyState } | null>;
}

/** Pinned to lib/shows-types.ts SHOW_STATUSES / PAYMENT_STATUSES and lib/red-artists/cleantone.ts by the family test. */
export const SHOW_STATUSES: readonly string[] = ["ליד חדש", "ממתין לתשובה", "צריך פולואפ", "נסגר", "אושרה", "בוצע", "בוטל"];
export const SHOW_PAYMENT_STATUSES: readonly string[] = ["שולם", "לא שולם", "צפוי", "מקדמה", "בוטל"];
/** A1: the only client-payment value SET_SHOW_MONEY accepts — "שולם" = INTENT (the client paid the rest → the remainder
 *  is recorded once). Other values would be an undo / a typed truth: refused, pointing to Finance / RECORD_SHOW_PAYMENT. */
export const SHOW_MONEY_PAYMENT_INTENTS: readonly string[] = ["שולם"];
/** A1: the show fee roles (transactions.show_money_role) MARK_SHOW_FEE_PAID may mark. Pinned to lib/shows-types SHOW_MONEY_ROLES. */
export const SHOW_FEE_ROLES: readonly string[] = ["DJ_FEE", "ARTIST_FEE"];
export const CLEANTONE_ID = "a249d610-a0b5-443f-a329-5ef969e0d94c";
export const CLEANTONE_DEFAULT_FEE = 500;
/** Pinned to components/shows/RehearsalModal.tsx OP_STATUSES. */
export const REHEARSAL_STATUSES: readonly string[] = ["מתוכנן", "בוצע", "בוטל"];
const PIPELINE = ["ליד חדש", "ממתין לתשובה", "צריך פולואפ"];
const CONFIRMED = ["נסגר", "אושרה"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ils = (n: number) => `₪${Number(n).toLocaleString("en-US")}`;
/** An amount with ITS currency (never assumed ₪). */
const cm = (n: unknown, c: unknown) => `${typeof c === "string" && c ? c : "₪"}${Number(n).toLocaleString("en-US")}`;
/** Pinned to lib/shows-types.ts MONEY_CURRENCIES. */
export const SHOW_CURRENCIES: readonly string[] = ["₪", "$", "€"];
/** Pinned to lib/shows-types.ts SHOW_DEAL_TYPES. The deal type is NOT a payment status (Owner decision 2026-09-27). */
export const SHOW_DEAL_TYPES: readonly string[] = ["PAID", "UNPAID_COLLAB"];
const COLLAB_HE = "שת״פ ללא תשלום";
/** Any money operation on an unpaid collaboration is refused clearly (switch the deal type to PAID first). */
function collabMoneyGate(cur: Fields): PlanRefusal | null {
  return cur.dealType === "UNPAID_COLLAB" ? refuse("UNPAID_COLLAB", "בוס, זו הופעת שת״פ ללא תשלום — אין לה מחיר, תשלום, מקדמה או שכר (אין פעילות כספית אוטומטית). הוצאה חריגה נרשמת פרטנית בכספים; אם ההופעה הפכה לבתשלום — קודם SET_SHOW_DEAL_TYPE") : null;
}
/** Pinned to lib/writes/show-payments.ts PAYMENT_METHODS. */
export const SHOW_PAYMENT_METHODS: readonly string[] = ["", "העברה בנקאית", "מזומן", "ביט", "פייבוקס", "צ'ק", "כרטיס אשראי", "PayPal", "אחר"];
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "SHOW", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });
const NO_CURRENCY = "כל סכום מוצג במטבע של ההופעה — בלי המרה ובלי חיבור בין מטבעות";
const D5 = "כסף שהתקבל בפועל = שורות תשלום בפיננסים (שולם / התקבל); סטטוס התשלום וה'התקבל' של ההופעה נגזרים מהן";
const A1_FEES = "סטטוס התשלום של שכר ה-DJ ושל שכר האמן לא משתנה (התחייבויות נפרדות מתשלום הלקוח); שכר שעוד לא שולם מחושב מחדש, ושכר ששולם לא נדרס — פער מוצג לך";
const A1_RECEIVED = "תשלומים שהתקבלו לא משתנים ולא מבוטלים לעולם (ביטול תשלום = תיקון מפורש בפיננסים)";

/** A paid DJ / artist fee = money that went out: a revert / delete (which removes the show's finance rows) is refused. */
function paidFeesGate(cur: Fields): PlanRefusal | null {
  const paid = [cur.djFeeStatus === "שולם" ? `DJ ${cm(cur.djFeeAmount, cur.currency)}` : null, cur.artistFeeStatus === "שולם" ? `אמן ${cm(cur.artistFeeAmount, cur.currency)}` : null].filter(Boolean);
  return paid.length ? refuse("HAS_PAID_FEES", `שכר DJ/אמן כבר סומן כשולם (${paid.join(" · ")}) — לא מוחקים כסף שיצא; תקן בכספים קודם (או בטל את ההופעה)`) : null;
}
const showFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const s = await d.readShow(id); return s ? { ...s } : null; };
async function onShow(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.show, ["show"]);
  if (!k) return refuse("BAD_ENTITY", "צריך הופעה (show:…)");
  const f = await showFields(d, k.id);
  if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההופעה");
  return { key: `show:${k.id}`, id: k.id, label: `${f.name}${f.date ? ` (${f.date})` : ""}`, fields: f };
}
/** Duplicate awareness (POLISH FIX #1): the show's own payments with the same amount (from the live read — no extra query). */
function showPayDupFields(a: Readonly<Record<string, unknown>>, cur: Fields): Fields {
  const rows = String(cur.payments ?? "").split(";").filter(Boolean).map((x) => { const [amt, date] = x.split("@"); return { amount: Number(amt), date: date || null, currency: String(cur.currency), text: "" }; }).filter((r) => r.amount === a.amount);
  return { similarRecords: dupField(dupCandidates(rows, { date: realYmd(a.date) ? String(a.date) : null, text: "" }), String(cur.currency)) };
}
/** The show + one recipient's real send state (read-only; a read failure throws — never "not sent"). */
async function notifyFields(d: WriterDeps, id: string, who: "artist" | "dj"): Promise<Fields | null> {
  const f = await showFields(d, id);
  if (!f) return null;
  const st = await d.showNotifyStates(id);
  if (!st) return null;
  const n = st[who];
  return who === "artist"
    ? { ...f, artistNotified: n.state === "SENT", artistNotifyState: n.state, artistSentAt: n.sentAt }
    : { ...f, djNotified: n.state === "SENT", djNotifyState: n.state, djSentAt: n.sentAt };
}
async function onNotifyShow(d: WriterDeps, a: Readonly<Record<string, unknown>>, who: "artist" | "dj"): Promise<ResolvedTarget | PlanRefusal> {
  const r = await onShow(d, a);
  if (!("key" in r)) return r;
  const f = await notifyFields(d, r.id, who);
  return f ? { ...r, fields: f } : refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההופעה");
}
/** Never offer a second send of a version that was already sent (the writer would refuse it anyway: already_sent). */
function notifyGate(cur: Fields, who: "artist" | "dj"): PlanRefusal | null {
  const state = String(cur[who === "artist" ? "artistNotifyState" : "djNotifyState"]);
  const at = cur[who === "artist" ? "artistSentAt" : "djSentAt"];
  const whom = who === "artist" ? "לשליו" : "ל-DJ";
  if (state === "SENT") return refuse("ALREADY_SENT", `בוס, ההופעה הזאת כבר נשלחה ${whom}${at ? ` (${String(at).slice(0, 16).replace("T", " ")} UTC)` : ""} — אותה גרסה לא נשלחת שוב. אם שם / תאריך / שעה / מקום ישתנו, אפשר לשלוח מחדש`);
  if (state === "PROCESSING") return refuse("SEND_IN_PROGRESS", `שליחה ${whom} כבר בתהליך — לא שולחת שוב`);
  return null;
}
const ok = (r: UpdateResult) => { if (r.kind === "not_found") throw new Error("show not found"); if (r.kind === "refused") throw new Error(`refused: ${r.warning ?? ""}`); if (r.kind === "balance_sync_failed") throw new Error("the show was saved but the artist balance close-sync failed — re-running the same close is safe"); };
/** Resolve a client key to its name (artist / booker / DJ). */
async function clientName(d: WriterDeps, v: unknown): Promise<{ id: string; name: string } | PlanRefusal | null> {
  if (v === undefined) return null;
  const k = parseKey(v, ["client"]);
  if (!k) return refuse("BAD_ENTITY", "צריך לקוח (client:…)");
  const c = await d.readClient(k.id);
  return c ? { id: k.id, name: c.name } : refuse("ENTITY_NOT_FOUND", "לא מצאתי את הלקוח");
}
const isRef = (x: unknown): x is PlanRefusal => !!x && typeof x === "object" && (x as { ok?: unknown }).ok === false;

async function showCreateContext(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<Fields> {
  const art = await clientName(d, a.artistClient), bk = await clientName(d, a.bookerClient), dj = await clientName(d, a.djClient);
  return { artist: art && !isRef(art) ? art.name : null, booker: bk && !isRef(bk) ? bk.name : null, dj: dj && !isRef(dj) ? dj.name : null, connected: a.addToCalendar === true ? await d.calendarConnected() : null };
}

export const SHOW_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "CREATE_SHOW", kinds: ["show"],
    meta: meta("יצירת הופעה / הצעת מחיר", "Create a show or a quote (confirmed statuses create the show's finance rows; optional calendar event)", [T("name", true), K("artistClient", false), K("bookerClient", false), T("bookerName"), { name: "date", kind: "ymd", required: false }, { name: "startTime", kind: "time", required: false }, T("location"), T("contactPerson"), T("phone"), { name: "status", kind: "enum", required: true, values: SHOW_STATUSES.filter((s) => s !== "בוצע") }, { name: "dealType", kind: "enum", required: false, values: SHOW_DEAL_TYPES }, { name: "showPrice", kind: "money", required: false }, K("djClient", false), { name: "djFee", kind: "money", required: false }, T("notes"), { name: "addToCalendar", kind: "boolean", required: false }, { name: "currency", kind: "enum", required: false, values: SHOW_CURRENCIES }, { name: "depositReceived", kind: "money", required: false }, { name: "depositDate", kind: "ymd", required: false }], ["name", "status", "dealType", "showPrice", "djFee", "date", "currency", "received"], "createShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "CALENDAR"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "delete the show (separate approved action)" }),
    createContext: showCreateContext,
    async resolve(d, a) {
      for (const k of ["artistClient", "bookerClient", "djClient"]) { const r = await clientName(d, a[k]); if (isRef(r)) return r; }
      const n = text(a.name, 200); if (n === null) return refuse("BAD_TEXT", "שם ההופעה חובה");
      return { key: "show:new", id: "new", label: n.trim(), fields: await showCreateContext(d, a) };
    },
    read: showFields,
    plan(a, cur) {
      const n = text(a.name, 200); if (n === null) return refuse("BAD_TEXT", "שם ההופעה חובה");
      const status = String(a.status);
      if (!SHOW_STATUSES.includes(status) || status === "בוצע") return refuse("BAD_ENUM", "סטטוס לא תקין (סגירת הופעה היא פעולה נפרדת)");
      const dealType = String(a.dealType ?? "PAID");
      if (!SHOW_DEAL_TYPES.includes(dealType)) return refuse("BAD_ENUM", "סוג עסקה: PAID (בתשלום) / UNPAID_COLLAB (שת״פ ללא תשלום)");
      const collab = dealType === "UNPAID_COLLAB";
      // an unpaid collaboration: no price is asked and none is accepted (no price / DJ fee / deposit — zero money)
      if (collab && ((typeof a.showPrice === "number" && a.showPrice > 0) || (typeof a.djFee === "number" && a.djFee > 0) || a.depositReceived !== undefined)) return refuse("UNPAID_COLLAB", "בוס, שת״פ ללא תשלום לא מקבל מחיר, שכר DJ או מקדמה — אין לו שום פעילות כספית. אם יש הוצאה חריגה, נרשום אותה פרטנית בכספים");
      if (!collab && (typeof a.showPrice !== "number" || a.showPrice < 0)) return refuse("BAD_MONEY", "מחיר לא תקין (להופעה בתשלום צריך מחיר; לשת״פ ללא תשלום: dealType UNPAID_COLLAB)");
      if (a.date !== undefined && !realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין");
      if (a.startTime !== undefined && !TIME.test(String(a.startTime))) return refuse("BAD_TIME", "שעה לא תקינה");
      if (!collab && a.djClient !== undefined && (typeof a.djFee !== "number" || a.djFee < 0)) return refuse("DJ_FEE_REQUIRED", `צריך לציין את שכר ה-DJ במפורש (לקלינטון ברירת המחדל התפעולית היא ${ils(CLEANTONE_DEFAULT_FEE)} — אשר או שנה)`);
      if (a.djClient === undefined && a.djFee !== undefined && a.djFee !== 0) return refuse("DJ_REQUIRED", "שכר DJ בלי DJ — בחר DJ או השמט את השכר");
      if (a.addToCalendar === true && (!a.date || !a.startTime)) return refuse("MISSING_DATE", "ליומן צריך תאריך ושעה");
      if (cur.connected === false) return refuse("NOT_CONNECTED", "Google Calendar לא מחובר");
      if (a.currency !== undefined && !SHOW_CURRENCIES.includes(String(a.currency))) return refuse("BAD_CURRENCY", "₪ / $ / €");
      if (a.depositReceived !== undefined) {
        if (typeof a.depositReceived !== "number" || a.depositReceived <= 0) return refuse("BAD_MONEY", "מקדמה לא תקינה");
        if (PIPELINE.includes(status)) return refuse("NOT_CONFIRMED", "מקדמה נרשמת רק להופעה מאושרת (נסגר / אושרה)");
        if (a.depositDate !== undefined && !realYmd(a.depositDate)) return refuse("BAD_DATE", "תאריך המקדמה לא תקין");
      }
      if (collab) return { ok: true, after: { name: n.trim(), status, dealType, showPrice: 0, djFee: 0, date: (a.date as string | undefined) ?? null, currency: String(a.currency ?? "₪"), received: 0 } };
      return { ok: true, after: { name: n.trim(), status, dealType, showPrice: Number(a.showPrice), djFee: a.djClient !== undefined ? Number(a.djFee) : 0, date: (a.date as string | undefined) ?? null, currency: String(a.currency ?? "₪"), received: typeof a.depositReceived === "number" ? a.depositReceived : 0 } };
    },
    async apply(d, _id, after, a) {
      const art = parseKey(a.artistClient, ["client"]), bk = parseKey(a.bookerClient, ["client"]), dj = parseKey(a.djClient, ["client"]);
      const names = { artist: art ? (await d.readClient(art.id))?.name ?? "" : "", booker: bk ? (await d.readClient(bk.id))?.name ?? "" : str(a.bookerName) ?? "", dj: dj ? (await d.readClient(dj.id))?.name ?? "" : "" };
      const r = await d.createShow({
        name: after.name, artist: names.artist, artist_client_id: art?.id ?? null, booker_client_id: bk?.id ?? null, booker_name: names.booker,
        date: after.date, start_time: str(a.startTime) ?? null, location: str(a.location) ?? "", contact_person: str(a.contactPerson) ?? "", phone: str(a.phone) ?? "",
        status: after.status, deal_type: after.dealType, payment_status: "לא שולם", show_price: after.showPrice, dj_fee: after.djFee, dj_client_id: dj?.id ?? null, dj_name: names.dj,
        artist_fee: 0, advance_payment: Number(after.received) || 0, advance_date: str(a.depositDate), currency: after.currency, notes: str(a.notes) ?? "", addToCalendar: a.addToCalendar === true,
      });
      if (r.paymentWarning) throw new Error(r.paymentWarning);
      return { createdId: r.id, receipt: r.calendarWarning };
    },
    async verify(d, id, after) { const s = await d.readShow(id); return !!s && s.name === after.name && s.status === after.status && s.dealType === after.dealType && s.showPrice === after.showPrice && s.djFee === after.djFee && s.currency === after.currency && s.received === after.received; },
    requiredValues: (_a, after) => [after.dealType === "UNPAID_COLLAB" ? COLLAB_HE : cm(after.showPrice, after.currency), ...(Number(after.djFee) > 0 ? [cm(after.djFee, after.currency)] : []), ...(after.date ? [String(after.date)] : []), ...(Number(after.received) > 0 ? [`התקבל ${cm(after.received, after.currency)}`] : [])],
    warnings: (c) => (c.dj ? [`DJ: ${c.dj} — הוא מקבל בקשת אישור בפורטל (אם זה קלינטון)`] : []),
    disclosuresHe: ["שת״פ ללא תשלום (dealType UNPAID_COLLAB): הופעה רגילה לכל דבר (אמן, פורטל, יומן, התראות, סגירה) — בלי מחיר ובלי שום רשומה כספית אוטומטית; סוג עסקה, לא סטטוס תשלום", "הופעה בתשלום: סטטוס מאושר (נסגר / אושרה) יוצר את רשומות הכספים של ההופעה (יתרה צפויה, DJ, שכר אמן 50/50 אחרי DJ וחזרות) ושורת מאזן צפויה לשליו — כמו באפליקציה", "מקדמה שציינת נרשמת כתשלום שהתקבל בפיננסים, והיתרה הצפויה = מחיר פחות מה שהתקבל", NO_CURRENCY, "DJ נקבע רק כפי שציינת — לעולם לא אוטומטית", "לא יישלח Push לאמן / ל-DJ (שליחה היא פעולה נפרדת)"],
  },
  {
    actionId: "UPDATE_SHOW_DETAILS", kinds: ["show"],
    meta: meta("עדכון פרטי הופעה (שם / תאריך / שעה / מקום / איש קשר / טלפון / מזמין / הערות)", "Update a show's details (the calendar event follows; a date change re-syncs the show's finance dates)", [K("show"), T("name"), { name: "date", kind: "ymd", required: false }, { name: "startTime", kind: "time", required: false }, T("location"), T("contactPerson"), T("phone"), T("bookerName"), T("notes")], ["name", "date", "startTime", "location", "contactPerson", "phone", "bookerName", "notes"], "updateShowRecord (lib/writes/shows)", { effects: ["CALENDAR", "FINANCE"], riskClass: "EXTERNAL_SYSTEM_WRITE" }),
    resolve: onShow, read: showFields,
    plan(a, cur) {
      const after: Fields = {};
      for (const k of ["name", "location", "contactPerson", "phone", "bookerName", "notes"] as const) if (a[k] !== undefined) { const t = text(a[k], k === "notes" ? 2000 : 200); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      if (a.date !== undefined) { if (!realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין"); after.date = String(a.date); }
      if (a.startTime !== undefined) { if (!TIME.test(String(a.startTime))) return refuse("BAD_TIME", "שעה לא תקינה"); after.startTime = String(a.startTime); }
      return finishPlan(cur, after);
    },
    async apply(d, id, a) {
      const map: Record<string, string> = { name: "name", date: "date", startTime: "start_time", location: "location", contactPerson: "contact_person", phone: "phone", bookerName: "booker_name", notes: "notes" };
      ok(await d.updateShow(id, Object.fromEntries(Object.entries(a).map(([k, v]) => [map[k], v]))));
    },
    requiredValues: (_a, after) => [after.date, after.startTime].filter((x) => x !== undefined && x !== null).map(String),
    disclosuresHe: ["אם להופעה יש אירוע ביומן — הוא מתעדכן (שם / תאריך / שעה / מקום / מזמין / איש קשר / טלפון)", "שינוי תאריך מעדכן את תאריכי רשומות הכספים הצפויות של ההופעה (כמו באפליקציה)", A1_RECEIVED, A1_FEES, "אישור ה-DJ לא מתאפס; לא יישלח Push"],
  },
  {
    actionId: "SET_SHOW_MONEY", kinds: ["show"],
    meta: meta("כסף של הופעה: מחיר / סימון שהלקוח שילם את כל היתרה", "Set a show's agreed price, or mark that the client paid the whole remaining balance (a payment row for the remainder) — received money itself is RECORD_SHOW_PAYMENT", [K("show"), { name: "showPrice", kind: "money", required: false }, { name: "paymentStatus", kind: "enum", required: false, values: SHOW_MONEY_PAYMENT_INTENTS }], ["showPrice", "paymentStatus", "advancePayment"], "updateShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "CALENDAR"], riskClass: "FINANCIAL", reversible: "PARTIAL" }),
    resolve: onShow, read: showFields,
    plan(a, cur) {
      const collab = collabMoneyGate(cur); if (collab) return collab;
      const after: Fields = {};
      if (a.showPrice !== undefined) { if (typeof a.showPrice !== "number" || a.showPrice < 0) return refuse("BAD_MONEY", "מחיר לא תקין"); after.showPrice = a.showPrice; }
      if (a.paymentStatus !== undefined) {
        const ps = String(a.paymentStatus);
        if (ps === "מקדמה") return refuse("USE_RECORD_PAYMENT", "מקדמה = תשלום שהתקבל — RECORD_SHOW_PAYMENT רושם אותו בפיננסים (הסטטוס נגזר מהתשלומים)");
        if (SHOW_PAYMENT_STATUSES.includes(ps) && !SHOW_MONEY_PAYMENT_INTENTS.includes(ps)) return refuse("USE_FINANCE", "סטטוס התשלום של ההופעה נגזר מהפיננסים — הוא לא נכתב ידנית. ביטול / תיקון תשלום שהתקבל = תיקון מפורש של שורת התשלום בפיננסים; תשלום חדש = RECORD_SHOW_PAYMENT");
        if (!SHOW_MONEY_PAYMENT_INTENTS.includes(ps)) return refuse("BAD_ENUM", "סטטוס תשלום לא מוכר");
        if (cur.status !== "בוצע") return refuse("USE_CLOSE", "תשלום מלא נרשם בסגירת הופעה (סגירה מגדירה מי קיבל ומי שולם) — השתמש ב-CLOSE_SHOW, או ב-RECORD_SHOW_PAYMENT");
        const remainingAfter = a.showPrice !== undefined ? Math.max(0, Number(a.showPrice) - Number(cur.received)) : Number(cur.remaining);
        if (!(remainingAfter > 0)) return refuse("NOTHING_TO_RECORD", "אין יתרה פתוחה — אין מה לסמן כשולם");
        if (cur.paymentStatus === "שולם") return refuse("USE_RECORD_PAYMENT", `ההופעה כבר מסומנת שולם אבל נשארה יתרה של ${cm(remainingAfter, cur.currency)} — רישום התשלום שהתקבל: RECORD_SHOW_PAYMENT`);
        after.paymentStatus = ps;
      }
      return finishPlan(cur, after);
    },
    async apply(d, id, a) { ok(await d.updateShow(id, { ...(a.showPrice !== undefined ? { show_price: a.showPrice } : {}), ...(a.paymentStatus !== undefined ? { payment_status: a.paymentStatus } : {}) })); },
    async verify(d, id, after) { const s = await d.readShow(id); return !!s && (after.showPrice === undefined || s.showPrice === after.showPrice) && (after.paymentStatus !== "שולם" || s.remaining === 0); },
    requiredValues: (_a, after) => [...(after.showPrice !== undefined ? [String(after.showPrice)] : []), ...(after.paymentStatus !== undefined ? [String(after.paymentStatus)] : [])],
    warnings: (c) => [`היום: מחיר ${cm(c.showPrice, c.currency)}, התקבל ${cm(c.received, c.currency)}, יתרה ${cm(c.remaining, c.currency)}${Number(c.credit) > 0 ? `, עודף ${cm(c.credit, c.currency)}` : ""}, סטטוס '${c.status}'`],
    disclosuresHe: ["'שולם' = הלקוח שילם את כל היתרה → נרשם תשלום אחד על היתרה (לא על המחיר המלא — בלי כפל הכנסה); זה הערך היחיד שמתקבל — ביטול תשלום הוא תיקון מפורש בפיננסים", "שינוי מחיר מעדכן רק את היתרה הצפויה — שינוי מחיר לעולם לא רושם הכנסה; עודף נשאר גלוי", A1_RECEIVED, A1_FEES, "יומן: אם להופעה יש אירוע ביומן — שינוי מחיר מעדכן אותו (המחיר מופיע בתיאור האירוע); סימון 'שולם' לבד לא נוגע ביומן", "מאזן האמן: שורת 'הכנסות צפויות' מתעדכנת לפי החלוקה החדשה; הכנסה שכבר מומשה בסגירת ההופעה לא מסונכרנת מחדש אחרי הסגירה", D5, NO_CURRENCY, "לא יישלח Push"],
  },
  {
    actionId: "SET_SHOW_DEAL_TYPE", kinds: ["show"],
    meta: meta("שינוי סוג עסקה של הופעה (בתשלום ↔ שת״פ ללא תשלום)", "Switch a show's DEAL TYPE (not a payment status). PAID → UNPAID_COLLAB only when no real money exists (a client payment, a paid fee, a realized ledger entry, a rehearsal expense → refused, nothing is deleted); its still-expected rows are removed through the same safe removal a revert uses. UNPAID_COLLAB → PAID needs the price and starts the normal finance flow for the show's state", [K("show"), { name: "dealType", kind: "enum", required: true, values: SHOW_DEAL_TYPES }, { name: "showPrice", kind: "money", required: false }, { name: "djFee", kind: "money", required: false }, { name: "currency", kind: "enum", required: false, values: SHOW_CURRENCIES }], ["dealType", "showPrice", "djFee", "currency"], "updateShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "CALENDAR", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "PARTIAL", compensation: "the opposite switch (a new approved plan) — removed still-expected rows are re-created by the normal flow" }),
    resolve: onShow, read: showFields,
    plan(a, cur) {
      const to = String(a.dealType);
      if (!SHOW_DEAL_TYPES.includes(to)) return refuse("BAD_ENUM", "PAID (בתשלום) / UNPAID_COLLAB (שת״פ ללא תשלום)");
      if (to === cur.dealType) return refuse("NO_CHANGE_NEEDED", `ההופעה כבר ${to === "PAID" ? "בתשלום" : COLLAB_HE}`);
      if (to === "UNPAID_COLLAB") {
        if (a.showPrice !== undefined || a.djFee !== undefined || a.currency !== undefined) return refuse("UNPAID_COLLAB", "שת״פ ללא תשלום לא מקבל מחיר / שכר / מטבע");
        // real money is never deleted / cancelled / hidden to make a show a collaboration (the writer re-checks everything, ledger + rehearsal expenses included)
        if (Number(cur.received) > 0) return refuse("DEAL_SWITCH_BLOCKED", `בוס, כבר התקבלו ${cm(cur.received, cur.currency)} על ההופעה — לא הופכים אותה לשת״פ ולא מוחקים כסף אמיתי; מטפלים בזה פרטנית בכספים קודם`);
        const paid = paidFeesGate(cur); if (paid) return refuse("DEAL_SWITCH_BLOCKED", `${paid.messageHe} — לא הופכים את ההופעה לשת״פ`);
        return finishPlan(cur, { dealType: to, showPrice: 0, djFee: 0 });
      }
      if (typeof a.showPrice !== "number" || !(a.showPrice > 0)) return refuse("PRICE_REQUIRED", "מעבר להופעה בתשלום דורש מחיר (גדול מ-0)");
      if (a.djFee !== undefined && (typeof a.djFee !== "number" || a.djFee < 0)) return refuse("BAD_MONEY", "שכר DJ לא תקין");
      if (a.currency !== undefined && !SHOW_CURRENCIES.includes(String(a.currency))) return refuse("BAD_CURRENCY", "₪ / $ / €");
      return finishPlan(cur, { dealType: to, showPrice: a.showPrice, djFee: typeof a.djFee === "number" ? a.djFee : 0, ...(a.currency !== undefined ? { currency: String(a.currency) } : {}) });
    },
    async apply(d, id, a) { ok(await d.updateShow(id, { deal_type: a.dealType, ...(a.dealType === "PAID" ? { show_price: a.showPrice, dj_fee: a.djFee, ...(a.currency !== undefined ? { currency: a.currency } : {}) } : {}) })); },
    async verify(d, id, after) { const s = await d.readShow(id); return !!s && s.dealType === after.dealType && (after.dealType !== "PAID" || s.showPrice === after.showPrice); },
    requiredValues: (_a, after) => [after.dealType === "PAID" ? `בתשלום ${cm(after.showPrice, after.currency ?? "₪")}` : COLLAB_HE, ...(after.dealType === "UNPAID_COLLAB" ? ["מחיקה"] : [])],
    warnings: (c) => [c.dealType === "UNPAID_COLLAB" ? "היום: שת״פ ללא תשלום — המעבר יפעיל את תהליך הכספים הרגיל לפי מצב ההופעה (מאושרת → יתרה צפויה / DJ / שכר אמן)" : `היום: בתשלום, מחיר ${cm(c.showPrice, c.currency)}, התקבל ${cm(c.received, c.currency)} — רשומות הצפי שעוד לא מומשו יוסרו`],
    disclosuresHe: ["סוג עסקה — לא סטטוס תשלום", "בתשלום → שת״פ: רק אם אין כסף אמיתי (תשלום לקוח, שכר ששולם, הכנסה ממומשת במאזן, הוצאת חזרה) — אחרת נדחה ושום דבר לא נמחק; רשומות צפי שלא מומשו מוסרות כמו בהחזרה לליד", "שת״פ → בתשלום: המחיר נקבע ותהליך הכספים הרגיל רץ לפי מצב ההופעה; הופעה שבוצעה — הסגירה (CLOSE_SHOW) רושמת מה שולם", "התפעול לא משתנה: אמן, פורטל, יומן, התראות, סטטוס", "לא יישלח Push"],
  },
  {
    actionId: "ASSIGN_SHOW_DJ", kinds: ["show"],
    meta: meta("בחירת / החלפת / הסרת DJ להופעה", "Choose, change or remove a show's DJ with an explicit fee (CLEANTONE's 500₪ is an operating default the Boss confirms)", [K("show"), K("djClient", false), { name: "remove", kind: "boolean", required: false }, { name: "djFee", kind: "money", required: false }], ["djClientId", "djName", "djFee"], "updateShowRecord (lib/writes/shows)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "PARTIAL" }),
    async resolve(d, a) {
      const r = await clientName(d, a.djClient); if (isRef(r)) return r;
      const s = await onShow(d, a); if ("ok" in s) return s;
      return { ...s, fields: { ...s.fields, newDjName: r ? r.name : null } };
    },
    async read(d, id, a) { const f = await showFields(d, id); if (!f) return null; const r = a ? await clientName(d, a.djClient) : null; return { ...f, newDjName: r && !isRef(r) ? r.name : null }; },
    plan(a, cur) {
      if (a.remove === true) return finishPlan(cur, { djClientId: null, djName: "", djFee: 0 });
      const k = parseKey(a.djClient, ["client"]); if (!k) return refuse("BAD_ENTITY", "איזה DJ? (client:…) או remove");
      if (cur.dealType === "UNPAID_COLLAB") { if (typeof a.djFee === "number" && a.djFee > 0) return collabMoneyGate(cur)!; return finishPlan(cur, { djClientId: k.id, djName: String(cur.newDjName ?? ""), djFee: 0 }); }
      if (typeof a.djFee !== "number" || a.djFee < 0) return refuse("DJ_FEE_REQUIRED", `צריך לציין את שכר ה-DJ במפורש${k.id === CLEANTONE_ID ? ` (ברירת המחדל התפעולית לקלינטון: ${ils(CLEANTONE_DEFAULT_FEE)})` : ""}`);
      return finishPlan(cur, { djClientId: k.id, djName: String(cur.newDjName ?? ""), djFee: a.djFee });
    },
    async apply(d, id, a) { ok(await d.updateShow(id, { dj_client_id: a.djClientId, dj_name: a.djName, dj_fee: a.djFee })); },
    async verify(d, id, after) { const s = await d.readShow(id); return !!s && s.djClientId === after.djClientId && s.djFee === after.djFee; },
    requiredValues: (_a, after) => [String(after.djName || "ללא DJ"), ils(Number(after.djFee))],
    warnings: (c) => (c.djName ? [`היום: ${c.djName} (${ils(Number(c.djFee))})`] : []),
    disclosuresHe: ["שורת ההוצאה של ה-DJ (אם עוד לא שולמה) וחלוקת 50/50 מחושבות מחדש; שכר DJ או אמן ששולם לא נדרס ולא משנה סטטוס — פער מוצג לך", "DJ חדש (קלינטון) מקבל בקשת אישור בפורטל — בלי Push אוטומטי", "הסרת DJ מבטלת את שורת ההוצאה שלו (לא מוחקת) — אלא אם כבר שולמה (אז היא נשארת שולם)", "אם להופעה יש אירוע ביומן — הוא מתעדכן (שם ה-DJ בתיאור)"],
  },
  {
    actionId: "CONFIRM_SHOW", kinds: ["show"],
    meta: meta("אישור הופעה (נסגר / אושרה)", "Confirm a show (נסגר / אושרה): its finance rows are created or re-activated; the quote follow-up task closes", [K("show"), { name: "status", kind: "enum", required: true, values: CONFIRMED }], ["status"], "updateShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "GOOGLE_TASKS"], riskClass: "FINANCIAL", reversible: "PARTIAL" }),
    resolve: onShow, read: showFields,
    plan(a, cur) { if (!CONFIRMED.includes(String(a.status))) return refuse("BAD_ENUM", "נסגר או אושרה"); if (cur.status === "בוצע") return refuse("ALREADY_DONE", "ההופעה כבר בוצעה"); return finishPlan(cur, { status: String(a.status) }); },
    async apply(d, id, a) { ok(await d.updateShow(id, { status: a.status })); },
    requiredValues: (_a, after) => [String(after.status)],
    warnings: (c) => [c.dealType === "UNPAID_COLLAB" ? "שת״פ ללא תשלום — לא נוצרת שום רשומה כספית (רק האישור התפעולי)" : `מחיר ${ils(Number(c.showPrice))}${Number(c.djFee) > 0 ? `, DJ ${ils(Number(c.djFee))}` : ""} — ייווצרו / יופעלו רשומות הכספים`],
    disclosuresHe: ["נוצרות / מופעלות רשומות הכנסה, DJ ושכר אמן; שורת מאזן צפויה לשליו", "משימת הפולואפ להצעה נסגרת", "לא יישלח Push (שליחה לאמן / DJ היא פעולה נפרדת)"],
  },
  {
    actionId: "MOVE_SHOW_TO_PIPELINE", kinds: ["show"],
    meta: meta("החזרת הופעה לשלב ליד / הצעה", "Move a show back to a pipeline status — HARD-deletes its still-expected finance rows (balance / unpaid DJ / unpaid artist); refused while money moved (HAS_PAYMENTS: received; HAS_PAID_FEES: a DJ / artist fee already paid)", [K("show"), { name: "status", kind: "enum", required: true, values: PIPELINE }], ["status"], "updateShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    resolve: onShow, read: showFields,
    plan(a, cur) { if (!PIPELINE.includes(String(a.status))) return refuse("BAD_ENUM", "ליד חדש / ממתין לתשובה / צריך פולואפ"); if (Number(cur.received) > 0) return refuse("HAS_PAYMENTS", `כבר התקבלו ${cm(cur.received, cur.currency)} — הופעה עם תשלומים לא חוזרת לליד (אפשר לבטל אותה)`); return paidFeesGate(cur) ?? finishPlan(cur, { status: String(a.status) }); },
    async apply(d, id, a) { ok(await d.updateShow(id, { status: a.status })); },
    requiredValues: (_a, after) => [String(after.status), "מחיקה"],
    warnings: (c) => (Number(c.financeRows) > 0 ? [`רשומות הכספים הצפויות של ההופעה (יתרה / DJ / אמן שעוד לא שולמו) יימחקו לצמיתות — כסף שהתקבל לא נמחק לעולם, וגם שכר DJ / אמן ששולם`] : []),
    disclosuresHe: ["נמחקות רק רשומות צפויות: יתרה צפויה, שכר DJ / אמן שעוד לא שולם", "אם כבר התקבל תשלום (HAS_PAYMENTS) או ששכר DJ / אמן סומן כשולם (HAS_PAID_FEES) — הפעולה נדחית ושום דבר לא נכתב", "שורת המאזן הצפויה מוסרת; הכנסה שמומשה במאזן נשארת", "לא יישלח Push"],
  },
  {
    actionId: "CANCEL_SHOW", kinds: ["show"],
    meta: meta("ביטול הופעה", "Cancel a show: finance rows → בוטל (kept), open show tasks → בוטל, expected ledger row removed; optionally remove the calendar event", [K("show"), { name: "removeFromCalendar", kind: "boolean", required: false }], ["status"], "updateShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "GOOGLE_TASKS", "CALENDAR"], riskClass: "FINANCIAL", reversible: "PARTIAL" }),
    resolve: onShow, read: showFields,
    plan: (_a, cur) => finishPlan(cur, { status: "בוטל" }),
    async apply(d, id, _a, args) { ok(await d.updateShow(id, { status: "בוטל" })); if (args.removeFromCalendar === true) ok(await d.updateShow(id, { removeFromCalendar: true })); },
    requiredValues: () => ["ביטול"],
    warnings: (c) => [`${c.name}${c.date ? ` · ${c.date}` : ""} · ${ils(Number(c.showPrice))}`],
    disclosuresHe: ["רשומות הכספים הצפויות (יתרה / שכר שעוד לא שולם) עוברות ל'בוטל' (לא נמחקות); תשלומים שהתקבלו ושכר DJ / אמן ששולם נשארים כמו שהם; הכנסה ותשלומים שמומשו במאזן נשארים", "משימות פתוחות של ההופעה עוברות ל'בוטל'", "האירוע ביומן נמחק רק אם ביקשת", "לא יישלח Push"],
  },
  {
    actionId: "CLOSE_SHOW", kinds: ["show"],
    meta: meta("סגירת הופעה (בוצע + מי קיבל / שולם)", "Close a show exactly like the close dialog: client payment, DJ paid, artist paid (+ date) → finance statuses + the artist ledger income / payment", [K("show"), { name: "incomeReceived", kind: "boolean", required: true }, { name: "djPaid", kind: "boolean", required: true }, { name: "artistPaid", kind: "boolean", required: true }, { name: "artistPaidDate", kind: "ymd", required: false }, T("note")], ["status", "paymentStatus"], "closeShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER"], riskClass: "FINANCIAL", reversible: "PARTIAL" }),
    resolve: onShow, read: showFields,
    plan(a, cur) {
      for (const k of ["incomeReceived", "djPaid", "artistPaid"]) if (typeof a[k] !== "boolean") return refuse("BAD_ARGS", `${k}: כן / לא`);
      if (a.artistPaidDate !== undefined && !realYmd(a.artistPaidDate)) return refuse("BAD_DATE", "תאריך תשלום לאמן לא תקין");
      if (!CONFIRMED.includes(String(cur.status)) && cur.status !== "בוצע") return refuse("NOT_CONFIRMED", "רק הופעה מאושרת נסגרת");
      // an unpaid collaboration closes operationally only (בוצע) — no client payment / DJ / artist money exists
      if (cur.dealType === "UNPAID_COLLAB") { if (a.incomeReceived === true || a.djPaid === true || a.artistPaid === true) return collabMoneyGate(cur)!; return { ok: true, after: { status: "בוצע", paymentStatus: String(cur.paymentStatus) } }; }
      return { ok: true, after: { status: "בוצע", paymentStatus: a.incomeReceived === true ? "שולם" : String(cur.paymentStatus) } };
    },
    async apply(d, id, _a, args) { ok(await d.closeShow(id, { markDone: true, incomeReceived: args.incomeReceived === true, djPaid: args.djPaid === true, artistPaid: args.artistPaid === true, artistPaidDate: str(args.artistPaidDate), note: str(args.note) })); },
    requiredValues: (a) => [`התקבל ${a.incomeReceived ? "✓" : "✗"}`, `DJ ${a.djPaid ? "✓" : "✗"}`, `אמן ${a.artistPaid ? "✓" : "✗"}`],
    async verify(d, id, after) { const s = await d.readShow(id); return !!s && s.status === "בוצע" && (after.paymentStatus !== "שולם" || s.remaining === 0); },
    warnings: (c) => [`${c.name}: מחיר ${ils(Number(c.showPrice))}${Number(c.djFee) > 0 ? `, DJ ${ils(Number(c.djFee))}` : ""} — שכר האמן לפי הכלל (50/50 אחרי DJ וחזרות)`],
    disclosuresHe: ["כמו דיאלוג הסגירה: סטטוס בוצע, סטטוסים לרשומות הכספים, ושורת סיכום בהערות", "'התקבל' = היתרה שנשארה נרשמת כתשלום אחד (מקדמה שכבר נרשמה לא נספרת שוב); 'לא התקבל' לא מוריד שום תשלום שנרשם", "'DJ שולם' / 'אמן שולם' מסמנים את שורת השכר שלו בפיננסים כשולם; סימון 'לא' לא משנה את השורה — שכר ששולם כבר נשאר שולם (ביטול סימון = MARK_SHOW_FEE_PAID, פעולה מפורשת)", "תשלום הלקוח לא משנה את סטטוס שכר ה-DJ / האמן, והפוך", "במאזן האמן (אמן לייבל יחיד): הכנסה אחת להופעה, ותשלום רק אם סימנת 'אמן שולם' — הפעלה חוזרת בטוחה, בלי כפילויות", "ביטול סימון 'אמן שולם' לא מוחק תשלום קיים (רק מזהיר)", "לא יישלח Push"],
  },
  {
    actionId: "SET_SHOW_CALENDAR", kinds: ["show"],
    meta: meta("הוספה / הסרה של הופעה ביומן", "Add a show to the main calendar, or remove its event", [K("show"), { name: "mode", kind: "enum", required: true, values: ["ADD", "REMOVE"] }], ["hasCalendarEvent"], "updateShowRecord (lib/writes/shows)", { effects: ["CALENDAR"], riskClass: "EXTERNAL_SYSTEM_WRITE" }),
    resolve: onShow, read: showFields,
    plan(a, cur) {
      if (a.mode === "ADD") { if (!cur.date || !cur.startTime) return refuse("MISSING_DATE", "להופעה אין תאריך ושעה"); return finishPlan(cur, { hasCalendarEvent: true }); }
      return finishPlan(cur, { hasCalendarEvent: false });
    },
    async apply(d, id, a) { ok(await d.updateShow(id, a.hasCalendarEvent ? { addToCalendar: true } : { removeFromCalendar: true })); },
    requiredValues: (_a, after) => [after.hasCalendarEvent ? "הוספה ליומן" : "הסרה מהיומן"],
    disclosuresHe: ["רק היומן הראשי שלך — בלי מוזמנים", "שום רשומה כספית לא משתנה; לא יישלח Push"],
  },
  {
    actionId: "MARK_SHOW_QUOTE_SENT", kinds: ["show"],
    meta: meta("סימון 'הצעת מחיר נשלחה' (משימת פולואפ)", "Mark a quote sent: the show's single follow-up task is created / refreshed", [K("show")], ["quoteFollowup"], "markQuoteSent (lib/writes/shows)", { effects: ["GOOGLE_TASKS"], riskClass: "EXTERNAL_SYSTEM_WRITE", reversible: "PARTIAL" }),
    async resolve(d, a) { const r = await onShow(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, quoteFollowup: false } }; },
    async read(d, id) { const f = await showFields(d, id); return f ? { ...f, quoteFollowup: false } : null; },
    plan: (_a, cur) => (PIPELINE.includes(String(cur.status)) ? { ok: true, after: { quoteFollowup: true } } : refuse("NOT_A_QUOTE", "רק הופעה בשלב ליד / הצעה מקבלת משימת פולואפ")),
    async apply(d, id) { const r = await d.markShowQuoteSent(id); if (r !== "ok") throw new Error(`quote follow-up: ${r}`); return { receipt: "ok" }; },
    verify: async (_d, _id, _a, out) => out.receipt === "ok",
    requiredValues: () => ["פולואפ"],
    disclosuresHe: ["נוצרת / מתעדכנת משימת 'פולואפ להצעת מחיר' אחת להופעה (בלי כפילות)", "לא נשלח כלום ללקוח; לא יישלח Push"],
  },
  {
    actionId: "NOTIFY_SHOW_ARTIST", kinds: ["show"],
    meta: meta("שליחת ההופעה לאמן (Push לשליו)", "Send an upcoming show to the artist (Shalev) — the app builds the push itself; one send per show version", [K("show")], ["artistNotified"], "notifyShalevAboutShow (lib/writes/shows)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    resolve: (d, a) => onNotifyShow(d, a, "artist"),
    read: (d, id) => notifyFields(d, id, "artist"),
    plan(_a, cur) {
      if (!String(cur.artist).split(/[,،;]/).map((x) => x.trim()).includes("שליו טסמה")) return refuse("NOT_SHALEV", "שליחה לאמן קיימת היום רק לשליו");
      if (!cur.date || String(cur.date) < new Date().toISOString().slice(0, 10)) return refuse("NOT_UPCOMING", "אפשר לשלוח רק הופעה עתידית");
      return notifyGate(cur, "artist") ?? { ok: true, after: { artistNotified: true } };
    },
    async apply(d, id) { const r = await d.notifyShowArtist(id); if (!r.ok) throw new Error(`not sent: ${r.reason}`); return { receipt: "sent" }; },
    // the writer marks the claim row "sent" only after a successful push -> the fresh read must say so
    async verify(d, id, _a, out) { const f = await notifyFields(d, id, "artist"); return out.receipt === "sent" && f?.artistNotified === true; },
    requiredValues: () => ["שליו"],
    disclosuresHe: ["נשלח Push לשליו (ועותק אליך) עם תאריך, שעה ומקום — התוכן נבנה בשרת", "גרסה שכבר נשלחה לא נשלחת שוב", "שום רשומה לא משתנה"],
  },
  {
    actionId: "NOTIFY_SHOW_DJ", kinds: ["show"],
    meta: meta("שליחת ההופעה ל-DJ (Push לקלינטון)", "Send an upcoming show to DJ CLEANTONE — the app builds the push itself; one send per show version", [K("show")], ["djNotified"], "notifyDjAboutShow (lib/writes/shows)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    resolve: (d, a) => onNotifyShow(d, a, "dj"),
    read: (d, id) => notifyFields(d, id, "dj"),
    plan(_a, cur) {
      if (cur.djClientId !== CLEANTONE_ID) return refuse("NOT_CLEANTONE", "שליחה ל-DJ קיימת היום רק לקלינטון");
      if (!cur.date || String(cur.date) < new Date().toISOString().slice(0, 10)) return refuse("NOT_UPCOMING", "אפשר לשלוח רק הופעה עתידית");
      return notifyGate(cur, "dj") ?? { ok: true, after: { djNotified: true } };
    },
    async apply(d, id) { const r = await d.notifyShowDj(id); if (!r.ok) throw new Error(`not sent: ${r.reason}`); return { receipt: "sent" }; },
    async verify(d, id, _a, out) { const f = await notifyFields(d, id, "dj"); return out.receipt === "sent" && f?.djNotified === true; },
    requiredValues: () => ["קלינטון"],
    disclosuresHe: ["נשלח Push ל-DJ CLEANTONE (ועותק אליך) — התוכן נבנה בשרת", "גרסה שכבר נשלחה לא נשלחת שוב", "שום רשומה לא משתנה"],
  },
  {
    actionId: "DELETE_SHOW", kinds: ["show"],
    meta: meta("מחיקת הופעה", "Delete a show like the hub: its calendar event, its linked tasks, its still-expected finance rows, then the show (refused BEFORE any write while rehearsals exist, money was received (HAS_PAYMENTS) or a DJ / artist fee is already paid (HAS_PAID_FEES))", [K("show")], ["exists"], "deleteShowCompletely (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "CALENDAR", "GOOGLE_TASKS", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onShow(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const f = await showFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: (_a, cur) => (Number(cur.rehearsals) > 0 ? refuse("HAS_REHEARSALS", `להופעה יש ${cur.rehearsals} חזרות — מטפלים בהן קודם`) : Number(cur.received) > 0 ? refuse("HAS_PAYMENTS", `כבר התקבלו ${cm(cur.received, cur.currency)} — כסף שהתקבל לא נמחק; אפשר לבטל את ההופעה`) : paidFeesGate(cur) ?? { ok: true, after: { exists: false } }),
    async apply(d, id) { const r = await d.deleteShowCompletely(id); if (r.kind !== "ok") throw new Error(`delete refused: ${r.kind}`); },
    async verify(d, id) { return (await d.readShow(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [`${c.name}${c.date ? ` · ${c.date}` : ""}: ${c.financeRows} רשומות כספים יימחקו${c.hasCalendarEvent ? ", האירוע ביומן יימחק" : ""}, משימות ההופעה יימחקו`],
    disclosuresHe: ["כמו מחיקה מהמרכז: היומן, המשימות, רשומות הכספים הצפויות ואז ההופעה", "תשלום שהתקבל או שכר DJ / אמן ששולם — המחיקה נדחית לפני כל כתיבה (כסף שזז לא נמחק)", "הכנסה ותשלומים שמומשו במאזן האמן נשארים", "לא יישלח Push"],
  },
  {
    actionId: "RECORD_SHOW_PAYMENT", kinds: ["show"],
    meta: meta("רישום תשלום שהתקבל על הופעה (מקדמה / תשלום חלקי / תשלום מלא / עודף)", "Record money actually received for a show: ONE income row in Finance (התקבל, linked to the show, in the show's currency); the expected balance and the derived payment status follow; the DJ / artist fee statuses never follow the client payment (A1). Never double-counts: received = Σ payments", [K("show"), { name: "amount", kind: "money", required: true }, { name: "date", kind: "ymd", required: true }, { name: "currency", kind: "enum", required: false, values: SHOW_CURRENCIES }, { name: "paymentMethod", kind: "enum", required: false, values: SHOW_PAYMENT_METHODS }, T("note"), ...DUP_ARGS], ["received", "remaining", "credit"], "recordShowPayment (lib/writes/show-payments)", { effects: ["FINANCE", "LEDGER"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "a transaction correction in Finance (a new approved plan) — a payment row is never deleted silently" }),
    resolve: onShow, read: showFields,
    plan(a, cur) {
      const collab = collabMoneyGate(cur); if (collab) return collab;
      if (typeof a.amount !== "number" || !(a.amount > 0)) return refuse("BAD_MONEY", "סכום לא תקין");
      if (!realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין");
      if (a.currency !== undefined && a.currency !== cur.currency) return refuse("CURRENCY_MISMATCH", `ההופעה מתומחרת ב-${cur.currency} — תשלום במטבע אחר לא נרשם עליה (אין המרה)`);
      if (a.paymentMethod !== undefined && !SHOW_PAYMENT_METHODS.includes(String(a.paymentMethod))) return refuse("BAD_ENUM", "אמצעי תשלום לא מוכר");
      if (a.note !== undefined && text(a.note, 300) === null) return refuse("BAD_TEXT", "הערה לא תקינה");
      if (PIPELINE.includes(String(cur.status))) return refuse("NOT_CONFIRMED", "ההופעה עוד ליד — קודם לאשר אותה (CONFIRM_SHOW), ואז לרשום תשלום");
      // same amount on the same day = hold for the Boss (the same payment, or an additional one?) — never a silent block
      const g = dupGate(a, showPayDupFields(a, cur), "רשומת תשלום"); if (g) return g;
      const received = Math.round((Number(cur.received) + a.amount) * 100) / 100;
      const agreed = Number(cur.showPrice);
      return { ok: true, after: { received, remaining: Math.max(0, Math.round((agreed - received) * 100) / 100), credit: Math.max(0, Math.round((received - agreed) * 100) / 100) } };
    },
    async apply(d, id, _after, a) {
      const r = await d.recordShowPayment(id, { amount: Number(a.amount), date: String(a.date), currency: String(a.currency ?? ""), method: String(a.paymentMethod ?? ""), note: String(a.note ?? "") });
      if (r.kind !== "ok") throw new Error(r.messageHe ?? r.kind);
      return { receipt: "recorded" };
    },
    async verify(d, id, after) { const s = await d.readShow(id); return !!s && s.received === after.received && s.remaining === after.remaining && s.credit === after.credit; },
    requiredValues: (a, _after) => [`${a.amount}`, String(a.date)],
    warnings: (c, a) => [`מחיר ${cm(c.showPrice, c.currency)} · התקבל עד היום ${cm(c.received, c.currency)} · יתרה ${cm(c.remaining, c.currency)}${Number(c.credit) > 0 ? ` · עודף ${cm(c.credit, c.currency)}` : ""}`, ...(a ? dupWarnings(showPayDupFields(a, c), a) : [])],
    disclosuresHe: ["נרשמת שורת הכנסה אחת בפיננסים (התקבל) — מקושרת להופעה, במטבע שלה", "היתרה הצפויה = מחיר פחות כל מה שהתקבל; תשלום שמכסה את כל היתרה סוגר אותה, ועודף נשאר גלוי (לא נעלם)", "סטטוס התשלום של ההופעה נגזר מהתשלומים (מקדמה / שולם); סטטוס שכר ה-DJ והאמן לא משתנה מתשלום הלקוח (סימון שכר ששולם = MARK_SHOW_FEE_PAID / סגירת הופעה)", "אותו סכום באותו תאריך לא נרשם פעמיים", "לא יישלח Push"],
  },
  {
    actionId: "MARK_SHOW_FEE_PAID", kinds: ["show"],
    meta: meta("סימון שכר DJ / שכר אמן של הופעה כשולם (או ביטול הסימון)", "Mark a show's DJ fee or artist fee row in Finance paid (with the payment date / method), or explicitly back to expected — its own obligation, independent of the client payment (A1)", [K("show"), { name: "role", kind: "enum", required: true, values: SHOW_FEE_ROLES }, { name: "paid", kind: "boolean", required: true }, { name: "date", kind: "ymd", required: false }, { name: "paymentMethod", kind: "enum", required: false, values: SHOW_PAYMENT_METHODS }], ["djFeeStatus", "artistFeeStatus"], "setShowFeePaid (lib/writes/shows)", { effects: ["FINANCE", "LEDGER"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "DJ: the same action with paid = false; artist: cancel the payment in the artist's balance (a new approved plan)" }),
    resolve: onShow, read: showFields,
    plan(a, cur) {
      const collab = collabMoneyGate(cur); if (collab) return collab;
      if (!SHOW_FEE_ROLES.includes(String(a.role))) return refuse("BAD_ENUM", "DJ_FEE / ARTIST_FEE");
      if (typeof a.paid !== "boolean") return refuse("BAD_ARGS", "paid: כן / לא");
      if (a.date !== undefined && !realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין");
      if (a.paymentMethod !== undefined && !SHOW_PAYMENT_METHODS.includes(String(a.paymentMethod))) return refuse("BAD_ENUM", "אמצעי תשלום לא מוכר");
      if (!a.paid && (a.date !== undefined || a.paymentMethod !== undefined)) return refuse("BAD_ARGS", "תאריך / אמצעי תשלום רק בסימון שולם");
      const field = a.role === "DJ_FEE" ? "djFeeStatus" : "artistFeeStatus";
      const who = a.role === "DJ_FEE" ? "ה-DJ" : "האמן";
      const st = cur[field];
      // net model (2026-09-28): the artist is paid by a REAL payment (Finance + ledger) of the show share — there is no
      // artist-fee row to mark; un-paying is cancelling that payment in the artist's balance
      if (a.role === "ARTIST_FEE") {
        if (!a.paid) return refuse("UNPAY_VIA_LEDGER", "ביטול תשלום לאמן: בעמוד האמן → מאזן → מחיקת התשלום (שורת הכספים תסומן 'בוטל')");
        if (st === "שולם") return refuse("ALREADY_PAID", "כבר רשום תשלום לאמן על ההופעה הזו");
        if (cur.status === "בוטל") return refuse("FEE_CANCELLED", "ההופעה בוטלה — אין זכאות לאמן; אם שולם בכל זאת, רושמים תשלום במאזן האמן");
        if (!(Number(cur.artistFeeAmount) > 0)) return refuse("NO_FEE_ROW", "אין לאמן זכאות בהופעה הזו (הופעה לא מאושרת / אין הסכם / חלק 0)");
        return { ok: true, after: { artistFeeStatus: "שולם" } };
      }
      if (st === null || st === undefined) return refuse("NO_FEE_ROW", `להופעה אין שורת שכר ${who} בפיננסים (הופעה לא מאושרת / שכר 0)`);
      if (a.paid && st === "שולם") return refuse("ALREADY_PAID", `שכר ${who} כבר מסומן שולם`);
      if (a.paid && st === "בוטל") return refuse("FEE_CANCELLED", `שורת שכר ${who} מבוטלת — אם שולם בכל זאת, מתקנים את השורה בפיננסים`);
      if (!a.paid && st !== "שולם") return refuse("NOT_PAID", `שכר ${who} לא מסומן שולם`);
      return { ok: true, after: { [field]: a.paid ? "שולם" : "צפוי" } };
    },
    async apply(d, id, _after, a) { const r = await d.setShowFeePaid(id, String(a.role), a.paid === true, { date: str(a.date), method: str(a.paymentMethod) }); if (r.kind !== "ok") throw new Error(r.messageHe ?? r.kind); },
    requiredValues: (a) => [`${a.role === "DJ_FEE" ? "DJ" : "אמן"} ${a.paid ? "שולם" : "צפוי"}`, ...(a.date !== undefined ? [String(a.date)] : [])],
    warnings: (c, a) => { const dj = a?.role === "DJ_FEE"; const amt = dj ? c.djFeeAmount : c.artistFeeAmount; const st = dj ? c.djFeeStatus : c.artistFeeStatus; return [`שורת שכר ${dj ? `DJ${c.djName ? ` (${c.djName})` : ""}` : `אמן${c.artist ? ` (${c.artist})` : ""}`}: ${amt === null || amt === undefined ? "—" : cm(amt, c.currency)} · היום '${st ?? "אין שורה"}' → '${a?.paid ? "שולם" : "צפוי"}'`, `תשלום הלקוח (לא משתנה): התקבל ${cm(c.received, c.currency)}, יתרה ${cm(c.remaining, c.currency)}`]; },
    disclosuresHe: ["DJ: רק שורת שכר ה-DJ בכספים משתנה (סטטוס, ותאריך + אמצעי בסימון שולם); ביטול הסימון מחזיר ל'צפוי'", "אמן (מודל נטו 28.9): נרשם תשלום אמיתי בגובה חלק האמן בהופעה — הוצאה ששולמה בכספים (Records) + תשלום במאזן האמן, מקושרים; זכאות האמן כבר במאזן ולא משתנה", "תשלום הלקוח לא משתנה", "לא יישלח Push"],
  },
  {
    actionId: "SET_SHOW_CURRENCY", kinds: ["show"],
    meta: meta("מטבע של הופעה (₪ / $ / €)", "Set the currency a show is priced in (price, DJ fee and its Finance rows carry it). Refused once money was received — no conversion, ever", [K("show"), { name: "currency", kind: "enum", required: true, values: SHOW_CURRENCIES }], ["currency"], "updateShowRecord (lib/writes/shows)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "YES" }),
    resolve: onShow, read: showFields,
    plan(a, cur) {
      const collab = collabMoneyGate(cur); if (collab) return collab;
      if (!SHOW_CURRENCIES.includes(String(a.currency))) return refuse("BAD_CURRENCY", "₪ / $ / €");
      if (Number(cur.received) > 0 && a.currency !== cur.currency) return refuse("CURRENCY_HAS_PAYMENTS", `כבר התקבלו ${cm(cur.received, cur.currency)} — אי אפשר לשנות את המטבע (אין המרה)`);
      return finishPlan(cur, { currency: String(a.currency) });
    },
    async apply(d, id, a) { ok(await d.updateShow(id, { currency: a.currency })); },
    requiredValues: (_a, after) => [String(after.currency)],
    warnings: (c) => [`היום: ${cm(c.showPrice, c.currency)} (DJ ${cm(c.djFee, c.currency)}) — המספרים לא מומרים, רק המטבע משתנה`],
    disclosuresHe: ["המספרים נשארים כמו שהם — רק המטבע שלהם משתנה (אין המרה)", "רשומות הכספים הצפויות של ההופעה (יתרה / DJ / אמן / חזרות) עוברות לאותו מטבע", "הופעה שאינה ב-₪ לא נכנסת אוטומטית למאזן האמן (למאזן אין מטבע) — היא מסומנת לך", "לא יישלח Push"],
  },
  // ── show rehearsals (D6, Owner decision: מתוכנן / בוצע / בוטל; only בוצע counts toward the split — per
  //    rehearsalCountedAmount; a legacy auto-marked התקיים keeps the pre-D6 rule until the Boss confirms it) ──
  {
    actionId: "BOOK_SHOW_REHEARSAL", kinds: ["session"],
    meta: meta("קביעת חזרה להופעה", "Book a rehearsal for a show exactly like the rehearsal dialog (cost → one rehearsal expense; the show split re-derives)", [K("show"), { name: "date", kind: "ymd", required: true }, { name: "startTime", kind: "time", required: true }, { name: "endTime", kind: "time", required: true }, { name: "status", kind: "enum", required: false, values: REHEARSAL_STATUSES }, { name: "cost", kind: "money", required: false }, { name: "paymentStatus", kind: "enum", required: false, values: ["שולם", "לא שולם"] }, T("location"), T("notes"), { name: "addToCalendar", kind: "boolean", required: false }], ["date", "startTime", "endTime", "status", "cost"], "createSession (lib/writes/sessions) — rehearsal path", { effects: ["FINANCE", "CALENDAR"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "delete the rehearsal (separate approved action)" }),
    createContext: rehearsalContext,
    async resolve(d, a) {
      const k = parseKey(a.show, ["show"]); if (!k) return refuse("BAD_ENTITY", "צריך הופעה (show:…)");
      const c = await rehearsalContext(d, a); if (c.showName === null) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההופעה");
      return { key: "session:new", id: "new", label: `חזרה — ${c.showName}`, fields: c };
    },
    read: async (d, id) => { const s = await d.readSession(id); return s ? { ...s } : null; },
    plan(a, cur) {
      if (!realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין");
      for (const k of ["startTime", "endTime"]) if (!TIME.test(String(a[k]))) return refuse("BAD_TIME", "שעה לא תקינה");
      const st = String(a.status ?? "מתוכנן"); if (!REHEARSAL_STATUSES.includes(st)) return refuse("BAD_ENUM", "מתוכנן / בוצע / בוטל");
      if (a.cost !== undefined && (typeof a.cost !== "number" || a.cost < 0)) return refuse("BAD_MONEY", "עלות לא תקינה");
      if (cur.showDealType === "UNPAID_COLLAB" && typeof a.cost === "number" && a.cost > 0) return refuse("UNPAID_COLLAB", "בוס, זו חזרה להופעת שת״פ ללא תשלום — לא נוצרת הוצאה אוטומטית. נקבע את החזרה בלי עלות; הוצאה חריגה נרשמת פרטנית בכספים");
      if (cur.connected === false) return refuse("NOT_CONNECTED", "Google Calendar לא מחובר");
      return { ok: true, after: { date: String(a.date), startTime: String(a.startTime), endTime: String(a.endTime), status: st, cost: typeof a.cost === "number" ? a.cost : null } };
    },
    async apply(d, _id, after, a) {
      const k = parseKey(a.show, ["show"])!; const s = await d.readShow(k.id); if (!s) throw new Error("show not found");
      const ref = `חזרה עבור הופעה: ${s.name}${s.artist ? ` | אמן: ${s.artist}` : ""}`;
      const userNotes = str(a.notes)?.trim();
      const r = await d.createSession({ projectId: null, title: s.name, date: String(after.date), startTime: String(after.startTime), endTime: String(after.endTime), status: String(after.status), sessionType: "חזרה להופעה", notes: userNotes ? `${ref}\n${userNotes}` : ref, location: str(a.location)?.trim() || "גרוב הוד השרון", photographer: "", addToCalendar: a.addToCalendar === true, invite: null, showId: k.id, cost: (after.cost as number | null) ?? null, paymentStatus: str(a.paymentStatus) ?? "לא שולם" });
      return { createdId: r.id };
    },
    async verify(d, id, after) { const s = await d.readSession(id); return !!s && s.date === after.date && s.startTime === after.startTime && s.sessionType === "חזרה להופעה"; },
    requiredValues: (a, after) => [String(after.date), String(after.startTime), ...(typeof after.cost === "number" && after.cost > 0 ? [ils(after.cost), String(a.paymentStatus ?? "לא שולם")] : [])],
    disclosuresHe: ["עלות > 0 יוצרת הוצאת חזרה אחת (קטגוריה חזרה, שיוך הופעה) וחלוקת ההופעה מחושבת מחדש: חזרה שבוצעה, או ששולמה, נספרת", "סטטוס 'התקיים' (סימון אוטומטי) לא נספר — החלטת אוצר המילים (D6) לא שונתה", "לא יישלח Push"],
  },
  {
    actionId: "UPDATE_SHOW_REHEARSAL", kinds: ["session"],
    meta: meta("עדכון חזרה להופעה (מועד / סטטוס / עלות / תשלום)", "Edit a show rehearsal like the rehearsal dialog (the event follows; its expense + the show split re-derive)", [K("session"), { name: "date", kind: "ymd", required: false }, { name: "startTime", kind: "time", required: false }, { name: "endTime", kind: "time", required: false }, { name: "status", kind: "enum", required: false, values: REHEARSAL_STATUSES }, { name: "cost", kind: "money", required: false }, { name: "paymentStatus", kind: "enum", required: false, values: ["שולם", "לא שולם"] }, T("location"), T("notes")], ["date", "startTime", "endTime", "status", "cost", "location", "notes", "paymentStatus"], "updateSession (lib/writes/sessions) — rehearsal path", { effects: ["FINANCE", "CALENDAR"], riskClass: "FINANCIAL", reversible: "PARTIAL" }),
    resolve: onRehearsal,
    read: async (d, id) => { const s = await d.readSession(id); return s ? { ...s } : null; },
    plan(a, cur) {
      const after: Fields = {};
      if (a.date !== undefined) { if (!realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין"); after.date = String(a.date); }
      for (const k of ["startTime", "endTime"] as const) if (a[k] !== undefined) { if (!TIME.test(String(a[k]))) return refuse("BAD_TIME", "שעה לא תקינה"); after[k] = String(a[k]); }
      if (a.status !== undefined) { if (!REHEARSAL_STATUSES.includes(String(a.status))) return refuse("BAD_ENUM", "מתוכנן / בוצע / בוטל"); after.status = String(a.status); }
      if (a.cost !== undefined) { if (typeof a.cost !== "number" || a.cost < 0) return refuse("BAD_MONEY", "עלות לא תקינה"); after.cost = a.cost; }
      for (const k of ["location", "notes"] as const) if (a[k] !== undefined) { const t = text(a[k]); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      if (a.paymentStatus !== undefined) after.paymentStatus = String(a.paymentStatus);
      return Object.keys(after).length ? { ok: true, after } : refuse("NOTHING_TO_CHANGE", "לא ציינת מה לשנות");
    },
    async apply(d, id, after) { await d.updateSession(id, { ...after }); },
    async verify(d, id, after) { const s = await d.readSession(id); return !!s && Object.entries(after).every(([k, v]) => k === "cost" || k === "paymentStatus" || (s as unknown as Record<string, unknown>)[k] === v); },
    requiredValues: (_a, after) => [...[after.date, after.startTime].filter((x) => x !== undefined).map(String), ...(typeof after.cost === "number" ? [ils(after.cost)] : []), ...(after.paymentStatus !== undefined ? [String(after.paymentStatus)] : [])],
    disclosuresHe: ["הוצאת החזרה וחלוקת ההופעה מחושבות מחדש (כמו בדיאלוג); האירוע ביומן זז", "D6: רק 'בוצע' נספר בחלוקה; 'מתוכנן' ו'בוטל' לא נספרים (גם אם שולמו)", "לא יישלח Push"],
  },
  {
    actionId: "DELETE_SHOW_REHEARSAL", kinds: ["session"],
    meta: meta("מחיקת חזרה להופעה", "Delete a show rehearsal (its event is removed; the show split re-derives; its expense row is kept)", [K("session")], ["exists"], "deleteSession (lib/writes/sessions) — rehearsal path", { effects: ["FINANCE", "CALENDAR", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onRehearsal(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true, linkedTransactions: await d.countSessionTransactions(r.id) } }; },
    async read(d, id) { const s = await d.readSession(id); return s ? { ...s, exists: true, linkedTransactions: await d.countSessionTransactions(id) } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { await d.deleteSession(id); },
    async verify(d, id) { return (await d.readSession(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => (Number(c.linkedTransactions) > 0 ? ["הוצאת החזרה נשארת ברשומות הכספים (אין מחיקה אוטומטית) — אם צריך, מוחקים אותה בנפרד"] : []),
    disclosuresHe: ["החזרה נמחקת, והאירוע שלה ביומן", "חלוקת ההופעה מחושבת מחדש בלי החזרה", "לא יישלח Push"],
  },
];

async function rehearsalContext(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<Fields> {
  const k = parseKey(a.show, ["show"]); const s = k ? await d.readShow(k.id) : null;
  return { showName: s ? s.name : null, showDealType: s ? s.dealType : null, connected: a.addToCalendar === true ? await d.calendarConnected() : null };
}
async function onRehearsal(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.session, ["session"]); if (!k) return refuse("BAD_ENTITY", "צריך חזרה (session:…)");
  const s = await d.readSession(k.id); if (!s) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את החזרה");
  if (s.sessionType !== "חזרה להופעה") return refuse("WRONG_ENTITY_TYPE", "זה לא חזרה להופעה (סשן רגיל — פעולות הסשנים)");
  return { key: `session:${k.id}`, id: k.id, label: `חזרה ${s.date ?? ""} ${s.startTime ?? ""}`.trim(), fields: { ...s } };
}
