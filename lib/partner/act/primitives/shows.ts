/**
 * SUNNY UNIVERSAL ACTION LAYER — Shows + DJ family. Every write goes through lib/writes/shows (+ lib/writes/sessions
 * for rehearsals) — the same writers the Shows hub uses. Show money is the app's own rule (computeShowSplit /
 * rehearsalCountedAmount inside the shared sync); shows store no currency (₪ by convention — disclosed). The DJ is
 * exactly who the Boss names: CLEANTONE is never auto-assigned, and his 500₪ is an operating default the Boss confirms
 * or overrides, never applied silently. D5 (advance), D6 (rehearsal vocabulary), D7 are unchanged: today's semantics.
 */
import type { ArgSpec } from "../types";
import { finishPlan, parseKey, realYmd, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

export type ShowView = { name: string; artist: string; artistClientId: string | null; bookerName: string; bookerClientId: string | null; date: string | null; startTime: string | null; location: string; contactPerson: string; phone: string; status: string; paymentStatus: string; showPrice: number; djFee: number; djClientId: string | null; djName: string; djConfirmation: string | null; advancePayment: number; notes: string; hasCalendarEvent: boolean; financeRows: number; rehearsals: number };
type UpdateResult = { kind: "ok" | "not_found" | "balance_sync_failed"; warning?: string | null };
export interface ShowFamilyWriters {
  readShow(id: string): Promise<ShowView | null>;
  createShow(body: Record<string, unknown>): Promise<{ id: string; calendarWarning: string | null }>;
  updateShow(id: string, body: Record<string, unknown>): Promise<UpdateResult>;
  closeShow(id: string, c: { markDone: boolean; incomeReceived: boolean; djPaid: boolean; artistPaid: boolean; artistPaidDate?: string; djName?: string; note?: string }): Promise<UpdateResult>;
  deleteShowCompletely(id: string): Promise<{ kind: "ok" | "has_rehearsals" | "not_found" }>;
  markShowQuoteSent(id: string): Promise<"ok" | "skipped" | "not_found">;
  notifyShowArtist(id: string): Promise<{ ok: boolean; reason?: string }>;
  notifyShowDj(id: string): Promise<{ ok: boolean; reason?: string }>;
}

/** Pinned to lib/shows-types.ts SHOW_STATUSES / PAYMENT_STATUSES and lib/red-artists/cleantone.ts by the family test. */
export const SHOW_STATUSES: readonly string[] = ["ליד חדש", "ממתין לתשובה", "צריך פולואפ", "נסגר", "אושרה", "בוצע", "בוטל"];
export const SHOW_PAYMENT_STATUSES: readonly string[] = ["שולם", "לא שולם", "צפוי", "מקדמה", "בוטל"];
export const CLEANTONE_ID = "a249d610-a0b5-443f-a329-5ef969e0d94c";
export const CLEANTONE_DEFAULT_FEE = 500;
/** Pinned to components/shows/RehearsalModal.tsx OP_STATUSES. */
export const REHEARSAL_STATUSES: readonly string[] = ["מתוכנן", "בוצע", "בוטל"];
const PIPELINE = ["ליד חדש", "ממתין לתשובה", "צריך פולואפ"];
const CONFIRMED = ["נסגר", "אושרה"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ils = (n: number) => `₪${Number(n).toLocaleString("en-US")}`;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "SHOW", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });
const NO_CURRENCY = "להופעות אין עמודת מטבע — הסכומים נרשמים ב-₪ (מוסכמה של המערכת)";

const showFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const s = await d.readShow(id); return s ? { ...s } : null; };
async function onShow(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.show, ["show"]);
  if (!k) return refuse("BAD_ENTITY", "צריך הופעה (show:…)");
  const f = await showFields(d, k.id);
  if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההופעה");
  return { key: `show:${k.id}`, id: k.id, label: `${f.name}${f.date ? ` (${f.date})` : ""}`, fields: f };
}
const ok = (r: UpdateResult) => { if (r.kind === "not_found") throw new Error("show not found"); if (r.kind === "balance_sync_failed") throw new Error("the show was saved but the artist balance close-sync failed — re-running the same close is safe"); };
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
    meta: meta("יצירת הופעה / הצעת מחיר", "Create a show or a quote (confirmed statuses create the show's finance rows; optional calendar event)", [T("name", true), K("artistClient", false), K("bookerClient", false), T("bookerName"), { name: "date", kind: "ymd", required: false }, { name: "startTime", kind: "time", required: false }, T("location"), T("contactPerson"), T("phone"), { name: "status", kind: "enum", required: true, values: SHOW_STATUSES.filter((s) => s !== "בוצע") }, { name: "showPrice", kind: "money", required: true }, K("djClient", false), { name: "djFee", kind: "money", required: false }, T("notes"), { name: "addToCalendar", kind: "boolean", required: false }], ["name", "status", "showPrice", "djFee", "date"], "createShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "CALENDAR"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "delete the show (separate approved action)" }),
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
      if (typeof a.showPrice !== "number" || a.showPrice < 0) return refuse("BAD_MONEY", "מחיר לא תקין");
      if (a.date !== undefined && !realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין");
      if (a.startTime !== undefined && !TIME.test(String(a.startTime))) return refuse("BAD_TIME", "שעה לא תקינה");
      if (a.djClient !== undefined && (typeof a.djFee !== "number" || a.djFee < 0)) return refuse("DJ_FEE_REQUIRED", `צריך לציין את שכר ה-DJ במפורש (לקלינטון ברירת המחדל התפעולית היא ${ils(CLEANTONE_DEFAULT_FEE)} — אשר או שנה)`);
      if (a.djClient === undefined && a.djFee !== undefined && a.djFee !== 0) return refuse("DJ_REQUIRED", "שכר DJ בלי DJ — בחר DJ או השמט את השכר");
      if (a.addToCalendar === true && (!a.date || !a.startTime)) return refuse("MISSING_DATE", "ליומן צריך תאריך ושעה");
      if (cur.connected === false) return refuse("NOT_CONNECTED", "Google Calendar לא מחובר");
      return { ok: true, after: { name: n.trim(), status, showPrice: a.showPrice, djFee: a.djClient !== undefined ? Number(a.djFee) : 0, date: (a.date as string | undefined) ?? null } };
    },
    async apply(d, _id, after, a) {
      const art = parseKey(a.artistClient, ["client"]), bk = parseKey(a.bookerClient, ["client"]), dj = parseKey(a.djClient, ["client"]);
      const names = { artist: art ? (await d.readClient(art.id))?.name ?? "" : "", booker: bk ? (await d.readClient(bk.id))?.name ?? "" : str(a.bookerName) ?? "", dj: dj ? (await d.readClient(dj.id))?.name ?? "" : "" };
      const r = await d.createShow({
        name: after.name, artist: names.artist, artist_client_id: art?.id ?? null, booker_client_id: bk?.id ?? null, booker_name: names.booker,
        date: after.date, start_time: str(a.startTime) ?? null, location: str(a.location) ?? "", contact_person: str(a.contactPerson) ?? "", phone: str(a.phone) ?? "",
        status: after.status, payment_status: "לא שולם", show_price: after.showPrice, dj_fee: after.djFee, dj_client_id: dj?.id ?? null, dj_name: names.dj,
        artist_fee: 0, advance_payment: 0, notes: str(a.notes) ?? "", addToCalendar: a.addToCalendar === true,
      });
      return { createdId: r.id, receipt: r.calendarWarning };
    },
    async verify(d, id, after) { const s = await d.readShow(id); return !!s && s.name === after.name && s.status === after.status && s.showPrice === after.showPrice && s.djFee === after.djFee; },
    requiredValues: (_a, after) => [ils(Number(after.showPrice)), ...(Number(after.djFee) > 0 ? [ils(Number(after.djFee))] : []), ...(after.date ? [String(after.date)] : [])],
    warnings: (c) => (c.dj ? [`DJ: ${c.dj} — הוא מקבל בקשת אישור בפורטל (אם זה קלינטון)`] : []),
    disclosuresHe: ["סטטוס מאושר (נסגר / אושרה) יוצר את רשומות הכספים של ההופעה (הכנסה, DJ, שכר אמן 50/50 אחרי DJ וחזרות) ושורת מאזן צפויה לשליו — כמו באפליקציה", NO_CURRENCY, "DJ נקבע רק כפי שציינת — לעולם לא אוטומטית", "לא יישלח Push לאמן / ל-DJ (שליחה היא פעולה נפרדת)"],
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
    disclosuresHe: ["אם להופעה יש אירוע ביומן — הוא מתעדכן", "שינוי תאריך מעדכן את תאריכי רשומות הכספים של ההופעה (כמו באפליקציה)", "אישור ה-DJ לא מתאפס; לא יישלח Push"],
  },
  {
    actionId: "SET_SHOW_MONEY", kinds: ["show"],
    meta: meta("כסף של הופעה: מחיר / סטטוס תשלום הלקוח / מקדמה", "Set a show's price, client payment status (today's vocabulary incl. מקדמה) or advance amount — the show finance re-syncs", [K("show"), { name: "showPrice", kind: "money", required: false }, { name: "paymentStatus", kind: "enum", required: false, values: SHOW_PAYMENT_STATUSES }, { name: "advancePayment", kind: "money", required: false }], ["showPrice", "paymentStatus", "advancePayment"], "updateShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "CALENDAR"], riskClass: "FINANCIAL", reversible: "PARTIAL" }),
    resolve: onShow, read: showFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.showPrice !== undefined) { if (typeof a.showPrice !== "number" || a.showPrice < 0) return refuse("BAD_MONEY", "מחיר לא תקין"); after.showPrice = a.showPrice; }
      if (a.paymentStatus !== undefined) { if (!SHOW_PAYMENT_STATUSES.includes(String(a.paymentStatus))) return refuse("BAD_ENUM", "סטטוס תשלום לא מוכר"); after.paymentStatus = String(a.paymentStatus); }
      if (a.advancePayment !== undefined) { if (typeof a.advancePayment !== "number" || a.advancePayment < 0) return refuse("BAD_MONEY", "מקדמה לא תקינה"); after.advancePayment = a.advancePayment; }
      if (after.paymentStatus === "שולם" && cur.status !== "בוצע") return refuse("USE_CLOSE", "תשלום מלא נרשם בסגירת הופעה (סגירה מגדירה מי קיבל ומי שולם) — השתמש ב-CLOSE_SHOW, או בסטטוס אחר");
      return finishPlan(cur, after);
    },
    async apply(d, id, a) { ok(await d.updateShow(id, { ...(a.showPrice !== undefined ? { show_price: a.showPrice } : {}), ...(a.paymentStatus !== undefined ? { payment_status: a.paymentStatus } : {}), ...(a.advancePayment !== undefined ? { advance_payment: a.advancePayment } : {}) })); },
    requiredValues: (_a, after) => [...(after.showPrice !== undefined ? [ils(Number(after.showPrice))] : []), ...(after.paymentStatus !== undefined ? [String(after.paymentStatus)] : []), ...(after.advancePayment !== undefined ? [ils(Number(after.advancePayment))] : [])],
    warnings: (c) => [`היום: ${ils(Number(c.showPrice))}, תשלום '${c.paymentStatus}', סטטוס '${c.status}'`],
    disclosuresHe: ["רשומות הכספים של הופעה מאושרת מחושבות מחדש לפי הכלל של האפליקציה (50/50 אחרי DJ וחזרות)", "מקדמה נרשמת בסמנטיקה של היום (החלטה D5 לא שונתה)", NO_CURRENCY, "לא יישלח Push"],
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
      if (typeof a.djFee !== "number" || a.djFee < 0) return refuse("DJ_FEE_REQUIRED", `צריך לציין את שכר ה-DJ במפורש${k.id === CLEANTONE_ID ? ` (ברירת המחדל התפעולית לקלינטון: ${ils(CLEANTONE_DEFAULT_FEE)})` : ""}`);
      return finishPlan(cur, { djClientId: k.id, djName: String(cur.newDjName ?? ""), djFee: a.djFee });
    },
    async apply(d, id, a) { ok(await d.updateShow(id, { dj_client_id: a.djClientId, dj_name: a.djName, dj_fee: a.djFee })); },
    async verify(d, id, after) { const s = await d.readShow(id); return !!s && s.djClientId === after.djClientId && s.djFee === after.djFee; },
    requiredValues: (_a, after) => [String(after.djName || "ללא DJ"), ils(Number(after.djFee))],
    warnings: (c) => (c.djName ? [`היום: ${c.djName} (${ils(Number(c.djFee))})`] : []),
    disclosuresHe: ["שורת ההוצאה של ה-DJ וחלוקת 50/50 מחושבות מחדש", "DJ חדש (קלינטון) מקבל בקשת אישור בפורטל — בלי Push אוטומטי", "הסרת DJ מבטלת את שורת ההוצאה שלו (לא מוחקת)"],
  },
  {
    actionId: "CONFIRM_SHOW", kinds: ["show"],
    meta: meta("אישור הופעה (נסגר / אושרה)", "Confirm a show (נסגר / אושרה): its finance rows are created or re-activated; the quote follow-up task closes", [K("show"), { name: "status", kind: "enum", required: true, values: CONFIRMED }], ["status"], "updateShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "GOOGLE_TASKS"], riskClass: "FINANCIAL", reversible: "PARTIAL" }),
    resolve: onShow, read: showFields,
    plan(a, cur) { if (!CONFIRMED.includes(String(a.status))) return refuse("BAD_ENUM", "נסגר או אושרה"); if (cur.status === "בוצע") return refuse("ALREADY_DONE", "ההופעה כבר בוצעה"); return finishPlan(cur, { status: String(a.status) }); },
    async apply(d, id, a) { ok(await d.updateShow(id, { status: a.status })); },
    requiredValues: (_a, after) => [String(after.status)],
    warnings: (c) => [`מחיר ${ils(Number(c.showPrice))}${Number(c.djFee) > 0 ? `, DJ ${ils(Number(c.djFee))}` : ""} — ייווצרו / יופעלו רשומות הכספים`],
    disclosuresHe: ["נוצרות / מופעלות רשומות הכנסה, DJ ושכר אמן; שורת מאזן צפויה לשליו", "משימת הפולואפ להצעה נסגרת", "לא יישלח Push (שליחה לאמן / DJ היא פעולה נפרדת)"],
  },
  {
    actionId: "MOVE_SHOW_TO_PIPELINE", kinds: ["show"],
    meta: meta("החזרת הופעה לשלב ליד / הצעה", "Move a show back to a pipeline status — today this HARD-deletes its three finance rows (even received income)", [K("show"), { name: "status", kind: "enum", required: true, values: PIPELINE }], ["status"], "updateShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    resolve: onShow, read: showFields,
    plan(a, cur) { if (!PIPELINE.includes(String(a.status))) return refuse("BAD_ENUM", "ליד חדש / ממתין לתשובה / צריך פולואפ"); return finishPlan(cur, { status: String(a.status) }); },
    async apply(d, id, a) { ok(await d.updateShow(id, { status: a.status })); },
    requiredValues: (_a, after) => [String(after.status), "מחיקה"],
    warnings: (c) => (Number(c.financeRows) > 0 ? [`${c.financeRows} רשומות כספים של ההופעה יימחקו לצמיתות — גם הכנסה שכבר התקבלה (כמו באפליקציה היום)`] : []),
    disclosuresHe: ["שורת המאזן הצפויה מוסרת; הכנסה שמומשה במאזן נשארת", "לא יישלח Push"],
  },
  {
    actionId: "CANCEL_SHOW", kinds: ["show"],
    meta: meta("ביטול הופעה", "Cancel a show: finance rows → בוטל (kept), open show tasks → בוטל, expected ledger row removed; optionally remove the calendar event", [K("show"), { name: "removeFromCalendar", kind: "boolean", required: false }], ["status"], "updateShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "GOOGLE_TASKS", "CALENDAR"], riskClass: "FINANCIAL", reversible: "PARTIAL" }),
    resolve: onShow, read: showFields,
    plan: (_a, cur) => finishPlan(cur, { status: "בוטל" }),
    async apply(d, id, _a, args) { ok(await d.updateShow(id, { status: "בוטל" })); if (args.removeFromCalendar === true) ok(await d.updateShow(id, { removeFromCalendar: true })); },
    requiredValues: () => ["ביטול"],
    warnings: (c) => [`${c.name}${c.date ? ` · ${c.date}` : ""} · ${ils(Number(c.showPrice))}`],
    disclosuresHe: ["רשומות הכספים עוברות ל'בוטל' (לא נמחקות); הכנסה ותשלומים שמומשו במאזן נשארים", "משימות פתוחות של ההופעה עוברות ל'בוטל'", "האירוע ביומן נמחק רק אם ביקשת", "לא יישלח Push"],
  },
  {
    actionId: "CLOSE_SHOW", kinds: ["show"],
    meta: meta("סגירת הופעה (בוצע + מי קיבל / שולם)", "Close a show exactly like the close dialog: client payment, DJ paid, artist paid (+ date) → finance statuses + the artist ledger income / payment", [K("show"), { name: "incomeReceived", kind: "boolean", required: true }, { name: "djPaid", kind: "boolean", required: true }, { name: "artistPaid", kind: "boolean", required: true }, { name: "artistPaidDate", kind: "ymd", required: false }, T("note")], ["status", "paymentStatus"], "closeShowRecord (lib/writes/shows)", { effects: ["FINANCE", "LEDGER"], riskClass: "FINANCIAL", reversible: "PARTIAL" }),
    resolve: onShow, read: showFields,
    plan(a, cur) {
      for (const k of ["incomeReceived", "djPaid", "artistPaid"]) if (typeof a[k] !== "boolean") return refuse("BAD_ARGS", `${k}: כן / לא`);
      if (a.artistPaidDate !== undefined && !realYmd(a.artistPaidDate)) return refuse("BAD_DATE", "תאריך תשלום לאמן לא תקין");
      if (!CONFIRMED.includes(String(cur.status)) && cur.status !== "בוצע") return refuse("NOT_CONFIRMED", "רק הופעה מאושרת נסגרת");
      return { ok: true, after: { status: "בוצע", paymentStatus: a.incomeReceived === true ? "שולם" : cur.paymentStatus === "בוטל" ? "בוטל" : "צפוי" } };
    },
    async apply(d, id, _a, args) { ok(await d.closeShow(id, { markDone: true, incomeReceived: args.incomeReceived === true, djPaid: args.djPaid === true, artistPaid: args.artistPaid === true, artistPaidDate: str(args.artistPaidDate), note: str(args.note) })); },
    requiredValues: (a) => [`התקבל ${a.incomeReceived ? "✓" : "✗"}`, `DJ ${a.djPaid ? "✓" : "✗"}`, `אמן ${a.artistPaid ? "✓" : "✗"}`],
    warnings: (c) => [`${c.name}: מחיר ${ils(Number(c.showPrice))}${Number(c.djFee) > 0 ? `, DJ ${ils(Number(c.djFee))}` : ""} — שכר האמן לפי הכלל (50/50 אחרי DJ וחזרות)`],
    disclosuresHe: ["כמו דיאלוג הסגירה: סטטוס בוצע, סטטוס תשלום הלקוח, סטטוסים לשלוש רשומות הכספים, ושורת סיכום בהערות", "במאזן האמן (אמן לייבל יחיד): הכנסה אחת להופעה, ותשלום רק אם סימנת 'אמן שולם' — הפעלה חוזרת בטוחה, בלי כפילויות", "ביטול סימון 'אמן שולם' לא מוחק תשלום קיים (רק מזהיר)", "לא יישלח Push"],
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
    async resolve(d, a) { const r = await onShow(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, artistNotified: false } }; },
    async read(d, id) { const f = await showFields(d, id); return f ? { ...f, artistNotified: false } : null; },
    plan(_a, cur) {
      if (!String(cur.artist).split(/[,،;]/).map((x) => x.trim()).includes("שליו טסמה")) return refuse("NOT_SHALEV", "שליחה לאמן קיימת היום רק לשליו");
      if (!cur.date || String(cur.date) < new Date().toISOString().slice(0, 10)) return refuse("NOT_UPCOMING", "אפשר לשלוח רק הופעה עתידית");
      return { ok: true, after: { artistNotified: true } };
    },
    async apply(d, id) { const r = await d.notifyShowArtist(id); if (!r.ok) throw new Error(`not sent: ${r.reason}`); return { receipt: "sent" }; },
    verify: async (_d, _id, _a, out) => out.receipt === "sent",
    requiredValues: () => ["שליו"],
    disclosuresHe: ["נשלח Push לשליו (ועותק אליך) עם תאריך, שעה ומקום — התוכן נבנה בשרת", "גרסה שכבר נשלחה לא נשלחת שוב", "שום רשומה לא משתנה"],
  },
  {
    actionId: "NOTIFY_SHOW_DJ", kinds: ["show"],
    meta: meta("שליחת ההופעה ל-DJ (Push לקלינטון)", "Send an upcoming show to DJ CLEANTONE — the app builds the push itself; one send per show version", [K("show")], ["djNotified"], "notifyDjAboutShow (lib/writes/shows)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onShow(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, djNotified: false } }; },
    async read(d, id) { const f = await showFields(d, id); return f ? { ...f, djNotified: false } : null; },
    plan(_a, cur) {
      if (cur.djClientId !== CLEANTONE_ID) return refuse("NOT_CLEANTONE", "שליחה ל-DJ קיימת היום רק לקלינטון");
      if (!cur.date || String(cur.date) < new Date().toISOString().slice(0, 10)) return refuse("NOT_UPCOMING", "אפשר לשלוח רק הופעה עתידית");
      return { ok: true, after: { djNotified: true } };
    },
    async apply(d, id) { const r = await d.notifyShowDj(id); if (!r.ok) throw new Error(`not sent: ${r.reason}`); return { receipt: "sent" }; },
    verify: async (_d, _id, _a, out) => out.receipt === "sent",
    requiredValues: () => ["קלינטון"],
    disclosuresHe: ["נשלח Push ל-DJ CLEANTONE (ועותק אליך) — התוכן נבנה בשרת", "גרסה שכבר נשלחה לא נשלחת שוב", "שום רשומה לא משתנה"],
  },
  {
    actionId: "DELETE_SHOW", kinds: ["show"],
    meta: meta("מחיקת הופעה", "Delete a show like the hub: its calendar event, its linked tasks, its finance rows, then the show (blocked while rehearsals exist)", [K("show")], ["exists"], "deleteShowCompletely (lib/writes/shows)", { effects: ["FINANCE", "LEDGER", "CALENDAR", "GOOGLE_TASKS", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onShow(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const f = await showFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: (_a, cur) => (Number(cur.rehearsals) > 0 ? refuse("HAS_REHEARSALS", `להופעה יש ${cur.rehearsals} חזרות — מטפלים בהן קודם`) : { ok: true, after: { exists: false } }),
    async apply(d, id) { const r = await d.deleteShowCompletely(id); if (r.kind !== "ok") throw new Error(`delete refused: ${r.kind}`); },
    async verify(d, id) { return (await d.readShow(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [`${c.name}${c.date ? ` · ${c.date}` : ""}: ${c.financeRows} רשומות כספים יימחקו${c.hasCalendarEvent ? ", האירוע ביומן יימחק" : ""}, משימות ההופעה יימחקו`],
    disclosuresHe: ["כמו מחיקה מהמרכז: היומן, המשימות, רשומות הכספים ואז ההופעה", "הכנסה ותשלומים שמומשו במאזן האמן נשארים", "לא יישלח Push"],
  },
  // ── show rehearsals (today's D6 semantics: מתוכנן / בוצע / בוטל, cost + שולם / לא שולם; the split counts per
  //    rehearsalCountedAmount; an auto-marked התקיים is never counted — the vocabulary decision stays the Boss's) ──
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
    disclosuresHe: ["הוצאת החזרה וחלוקת ההופעה מחושבות מחדש (כמו בדיאלוג); האירוע ביומן זז", "D6 לא שונה: רק 'בוצע' או 'שולם' נספרים", "לא יישלח Push"],
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
  return { showName: s ? s.name : null, connected: a.addToCalendar === true ? await d.calendarConnected() : null };
}
async function onRehearsal(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.session, ["session"]); if (!k) return refuse("BAD_ENTITY", "צריך חזרה (session:…)");
  const s = await d.readSession(k.id); if (!s) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את החזרה");
  if (s.sessionType !== "חזרה להופעה") return refuse("WRONG_ENTITY_TYPE", "זה לא חזרה להופעה (סשן רגיל — פעולות הסשנים)");
  return { key: `session:${k.id}`, id: k.id, label: `חזרה ${s.date ?? ""} ${s.startTime ?? ""}`.trim(), fields: { ...s } };
}
