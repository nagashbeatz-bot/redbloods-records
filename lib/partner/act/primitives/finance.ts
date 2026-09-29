/**
 * SUNNY UNIVERSAL ACTION LAYER — Finance family (project / general transactions, split, agreed price, financial
 * notes, finance exception). Every write goes through lib/writes/finance — the same writer the Finance screens use.
 *
 * Canonical rules are the app's own (never restated as a second rule): received = שולם / התקבל; an expense is paid
 * only when שולם; חלקי is not paid; צפוי / לא שולם / בוטל are not received; currencies are never added or converted.
 * Every money write repeats the exact amount + currency (and the status) in the Boss's approval. Rows OWNED by another
 * writer (lib/finance/ownership: show payment / balance / DJ / artist / rehearsal rows, a mix work's payment row, a clip
 * row, a Red Films budget line, a social promotion, Victor's salary) follow the SAME rule the Finance route enforces:
 * never deleted here; only status / date / method / notes on fee-like rows (notes / method / date on a show payment).
 * B3 (2026-09-27): an INCOME row of a project may be scoped קליפ (clip money) or כללי (song money) — only a free-standing
 * (unowned) row with a project; the preview shows song money vs clip money before / after (the clip price may be unknown).
 */
import type { ArgSpec } from "../types";
import { finishPlan, newProjectMeta, parseKey, realYmd, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";
import { dupContext, dupGate, dupWarnings, DUP_ARGS, type DupQuery } from "./duplicates";
import { FINANCE_OWNER_HE, transactionEditVerdict, type FinanceOwnerCode, type TxPatchField } from "@/lib/finance/ownership";
import { ACTIVE_INCOME_STATUSES } from "@/lib/finance/classify";
import { INCOME_SCOPES, songClipSplitBeforeAfter, songClipSplitText, type IncomeRowLike } from "@/lib/clip-rf-money-pure";
import { BUSINESS_UNITS, BUSINESS_UNIT_HE, BUSINESS_UNIT_SOURCE_HE, isBusinessUnit, isBusinessUnitSource } from "@/lib/business-unit";

type Tx = { projectId: string | null; scope: string; type: string; date: string | null; description: string; artist: string; amount: number; currency: string; paymentStatus: string; paymentMethod: string; receiptRef: string; notes: string; category: string; expenseScope: string; linkedSessionId: string; businessUnit?: string | null; businessUnitSource?: string | null };
type FinSettings = { agreedPrice: number; currency: string; financialNotes: string; financeException: boolean; financeExceptionReason: string; financeExceptionDate: string };
/** lib/finance/ownership FinanceOwnerCode — the SAME rule the Finance route enforces (assertTransactionEditable). */
export type FinanceOwner = FinanceOwnerCode | null;
export interface FinanceFamilyWriters {
  readTransaction(id: string): Promise<Tx | null>;
  financeOwnerOf(id: string): Promise<FinanceOwner>;
  createTransaction(t: { projectId: string | null; scope: string; type: string; date: string; description: string; artist: string; amount: number; currency: string; paymentStatus: string; paymentMethod: string; receiptRef: string; notes: string; category: string; expenseScope: string; linkedSessionId: string; businessUnit?: string | null }): Promise<string>;
  /** lib/business-unit (task 4): the unit the rule gives a NEW row (null = no certain unit — the Boss must choose). Read-only. */
  suggestBusinessUnit(f: { type: string; category: string | null; expenseScope: string | null; projectId: string | null }): Promise<{ unit: string | null; reasonHe: string }>;
  /** lib/writes/business-unit setTransactionUnit — the Owner's explicit unit (OWNER_DECISION). */
  setTransactionUnit(id: string, unit: string): Promise<boolean>;
  updateTransaction(id: string, patch: Record<string, unknown>): Promise<void>;
  deleteTransaction(id: string): Promise<void>;
  splitIncome(id: string, paid: number, receivedDate: string, method: string): Promise<"ok" | "not_found" | "conflict" | "invalid">;
  readFinanceSettings(projectId: string): Promise<FinSettings>;
  setFinanceSettings(projectId: string, patch: Partial<FinSettings>): Promise<void>;
  /** lib/writes/finance readProjectIncomeContext — the project's income rows + clip price (read-only, for the scope preview). */
  readProjectIncomeContext(projectId: string): Promise<{ clipAgreedPrice: number | null; clipCurrency: string; incomes: IncomeRowLike[] }>;
}

/**
 * Pinned to components/finance/QuickTxModal.tsx + components/ui/ProjectDrawer.tsx by scripts/test-sunny-act-finance.tsx.
 * The ACTIVE income vocabulary (lib/finance/classify ACTIVE_INCOME_STATUSES): "לבדיקה" is deprecated (Owner 2026-09-27).
 */
export const INCOME_STATUSES: readonly string[] = ACTIVE_INCOME_STATUSES;
export const EXPENSE_STATUSES: readonly string[] = ["שולם", "צפוי", "לא שולם", "חלקי", "בוטל"];
export const TX_CURRENCIES: readonly string[] = ["$", "₪", "€"];
export const EXPENSE_SCOPES: readonly string[] = ["כללי", "קליפ", "מיקס / מאסטר", "שיווק", "סשן", "נסיעות", "ציוד", "אחר"];
export const PAYMENT_METHODS: readonly string[] = ["ביט", "העברה בנקאית", "מזומן", "PayPal", "Payoneer", "אשראי", "אחר"];
/** Display words only (never compared against stored data — the type column is income / expense). */
const typeHe = (t: unknown) => (t === "income" ? "הכנסה " : "הוצאה ").trim();
const money = (n: number, c: string) => `${c}${Number(n).toLocaleString("en-US")}`;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const E = (name: string, values: readonly string[], required = false): ArgSpec => ({ name, kind: "enum", required, values });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "FINANCE", he, en, args, fields, effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "PARTIAL", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });
const statusesFor = (type: unknown) => (type === "income" ? INCOME_STATUSES : EXPENSE_STATUSES);

// ── resolvers ────────────────────────────────────────────────────────────────────────────────────────────────────────
const txFields = async (d: WriterDeps, id: string): Promise<Fields | null> => {
  const t = await d.readTransaction(id);
  return t ? { ...t, owner: await d.financeOwnerOf(id) } : null;
};
async function onTx(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.transaction, ["transaction"]);
  if (!k) return refuse("BAD_ENTITY", "צריך רשומה כספית (transaction:…)");
  const f = await txFields(d, k.id);
  if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הרשומה הכספית");
  return { key: `transaction:${k.id}`, id: k.id, label: `${typeHe(f.type)} ${money(Number(f.amount), String(f.currency))} — ${f.description || f.artist || ""}`.trim(), fields: f };
}
/** A5: the ONE ownership rule (lib/finance/ownership transactionEditVerdict) — the Finance route enforces the same one.
 *  `op` = "delete" or the plan's changed fields (after keys; projectId → project_id). */
const AFTER_TO_TX: Readonly<Record<string, TxPatchField>> = { projectId: "project_id" };
function ownedRefusal(cur: Fields, op: "delete" | Fields): PlanRefusal | null {
  const owner = cur.owner ? (String(cur.owner) as FinanceOwnerCode) : null;
  if (!owner || !FINANCE_OWNER_HE[owner]) return null;
  const v = transactionEditVerdict(owner, op === "delete" ? "delete" : Object.keys(op).filter((k) => op[k] !== cur[k]).map((k) => AFTER_TO_TX[k] ?? (k as TxPatchField)), op !== "delete" && typeof op.paymentStatus === "string" ? op.paymentStatus : null);
  return v.ok ? null : refuse("USE_OWNER_ACTION", v.messageHe);
}
/** Income scope (B3): the song ↔ clip split before / after moving THIS row — preview context, read the same way at plan and at the stale check. */
async function incomeScopeContext(d: WriterDeps, id: string, t: Fields, a: Readonly<Record<string, unknown>> | undefined): Promise<Fields> {
  if (!a || a.expenseScope === undefined || t.type !== "income" || !t.projectId || !INCOME_SCOPES.includes(String(a.expenseScope))) return {};
  const ctx = await d.readProjectIncomeContext(String(t.projectId));
  const s = songClipSplitBeforeAfter(ctx.incomes, id, String(a.expenseScope));
  return { splitBefore: songClipSplitText(s.before), splitAfter: songClipSplitText(s.after), clipPriceKnown: ctx.clipAgreedPrice !== null && ctx.clipAgreedPrice > 0, clipPrice: ctx.clipAgreedPrice ?? 0, clipCurrency: ctx.clipCurrency };
}
async function txFieldsScoped(d: WriterDeps, id: string, a?: Readonly<Record<string, unknown>>): Promise<Fields | null> {
  const f = await txFields(d, id);
  return f ? { ...f, ...(await incomeScopeContext(d, id, f, a)) } : null;
}
async function onProjectFinance(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.project, ["project"]);
  if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)");
  const p = await d.readProjectMeta(k.id);
  if (!p) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
  return { key: `project:${k.id}`, id: k.id, label: p.name, fields: { ...(await d.readFinanceSettings(k.id)) } };
}
const settingsRead = async (d: WriterDeps, id: string): Promise<Fields | null> => ((await d.readProjectMeta(id)) ? { ...(await d.readFinanceSettings(id)) } : null);
/** `$stepK.created` as the step's own project: a project the plan creates has NO finance settings row (creation writes
 *  none), so its view is exactly the reader's defaults (lib/writes/finance readFinanceSettings) — checked again on the
 *  real record at the step's turn. */
const NEW_PROJECT_SETTINGS_TARGET: NonNullable<PrimitiveSpec["refTarget"]> = {
  arg: "project", kinds: ["project"],
  view: (cb) => (newProjectMeta(cb) ? { agreedPrice: 0, currency: "₪", financialNotes: "", financeException: false, financeExceptionReason: "", financeExceptionDate: "" } : null),
};

async function addContext(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<Fields> {
  const k = parseKey(a.project, ["project"]);
  const p = k ? await d.readProjectMeta(k.id) : null;
  // duplicate awareness (POLISH FIX #1): the same project / general scope + type + currency + amount, near the date
  const q: DupQuery | null = typeof a.amount === "number" && typeof a.currency === "string" && (a.type === "income" || a.type === "expense") ? { kind: "TRANSACTION", projectId: k?.id ?? null, type: String(a.type), amount: a.amount, currency: a.currency } : null;
  // task 4: the business unit the rule gives this new row (null = no certain unit — the Boss chooses)
  const unit = a.type === "income" || a.type === "expense"
    ? await d.suggestBusinessUnit({ type: String(a.type), category: str(a.category) ?? null, expenseScope: str(a.expenseScope) ?? (a.type === "expense" ? "כללי" : null), projectId: p && k ? k.id : null })
    : { unit: null, reasonHe: "" };
  return { projectName: p ? p.name : null, unitSuggestion: unit.unit, unitReason: unit.reasonHe, ...(await dupContext(d, q, { date: realYmd(a.date) ? String(a.date) : null, text: [str(a.description), str(a.notes)].filter(Boolean).join(" "), currency: String(a.currency ?? "") })) };
}

export const FINANCE_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "ADD_TRANSACTION", kinds: ["transaction"],
    meta: meta("רישום הכנסה / הוצאה", "Record an income or expense (project or general); amount, currency and status are explicit", [K("project", false), E("type", ["income", "expense"], true), { name: "amount", kind: "money", required: true }, E("currency", TX_CURRENCIES, true), E("paymentStatus", [...new Set([...INCOME_STATUSES, ...EXPENSE_STATUSES])], true), { name: "date", kind: "ymd", required: true }, T("description"), T("artist"), E("paymentMethod", PAYMENT_METHODS), T("category"), T("notes"), E("expenseScope", EXPENSE_SCOPES), T("receiptRef"), K("session", false), E("businessUnit", BUSINESS_UNITS), ...DUP_ARGS], ["type", "amount", "currency", "paymentStatus", "date", "description", "expenseScope"], "createTransactionRecord (lib/writes/finance)", { reversible: "PARTIAL", compensation: "delete the new row (separate approved action)" }),
    createContext: addContext,
    async resolve(d, a) {
      if (a.project !== undefined && !parseKey(a.project, ["project"])) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)");
      const c = await addContext(d, a);
      if (a.project !== undefined && c.projectName === null) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
      return { key: "transaction:new", id: "new", label: c.projectName ? `רשומה כספית — ${c.projectName}` : "רשומה כספית כללית", fields: c };
    },
    read: async (d, id) => { const t = await d.readTransaction(id); return t ? { ...t } : null; },
    plan(a, cur) {
      const type = String(a.type);
      if (type !== "income" && type !== "expense") return refuse("BAD_ENUM", "סוג: הכנסה או הוצאה");
      if (typeof a.amount !== "number" || !Number.isFinite(a.amount) || a.amount <= 0) return refuse("BAD_MONEY", "סכום חייב להיות גדול מ-0");
      if (!TX_CURRENCIES.includes(String(a.currency))) return refuse("BAD_CURRENCY", "מטבע לא מוכר — אין המרה ואין ברירת מחדל");
      if (!statusesFor(type).includes(String(a.paymentStatus))) return refuse("BAD_ENUM", `סטטוס לא מתאים ל${typeHe(type)}: ${statusesFor(type).join(" / ")}`);
      if (!realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין");
      // B3: income may carry scope קליפ (clip money) or כללי (song money) — only on a project row
      if (a.expenseScope !== undefined && type === "income") {
        if (!INCOME_SCOPES.includes(String(a.expenseScope))) return refuse("BAD_ARGS", "שיוך הכנסה: קליפ או כללי בלבד");
        if (a.project === undefined) return refuse("BAD_ARGS", "שיוך קליפ להכנסה רק בהכנסה של פרויקט");
      }
      for (const k of ["description", "artist", "category", "notes", "receiptRef"]) if (a[k] !== undefined && text(a[k], 500) === null) return refuse("BAD_TEXT", `${k} לא תקין`);
      if (a.session !== undefined && !parseKey(a.session, ["session"])) return refuse("BAD_ENTITY", "סשן לא תקין");
      // task 4: the business unit — the rule's unit, or the Boss's explicit choice; never a guess, never a CORPORATE fallback
      if (a.businessUnit !== undefined && !isBusinessUnit(a.businessUnit)) return refuse("BAD_ENUM", `יחידה עסקית: ${BUSINESS_UNITS.join(" / ")}`);
      const unit = a.businessUnit !== undefined ? String(a.businessUnit) : isBusinessUnit(cur.unitSuggestion) ? String(cur.unitSuggestion) : null;
      if (!unit) return refuse("NEEDS_BUSINESS_UNIT", `אין סיווג יחידה ודאי לרשומה הזו (${String(cur.unitReason ?? "")}) — בוס, לאיזו יחידה היא שייכת: Studio / Records / Films / Corporate? (businessUnit)`);
      const g = dupGate(a, cur, typeHe(type)); if (g) return g;
      return { ok: true, after: { type, amount: a.amount, currency: String(a.currency), paymentStatus: String(a.paymentStatus), date: String(a.date), description: str(a.description)?.trim() ?? "", businessUnit: unit, ...(a.expenseScope !== undefined ? { expenseScope: String(a.expenseScope) } : {}) } };
    },
    async apply(d, _id, after, a) {
      const k = parseKey(a.project, ["project"]);
      return { createdId: await d.createTransaction({ projectId: k?.id ?? null, scope: k ? "project" : "general", type: String(after.type), date: String(after.date), description: str(a.description) ?? "", artist: str(a.artist) ?? "", amount: Number(after.amount), currency: String(after.currency), paymentStatus: String(after.paymentStatus), paymentMethod: str(a.paymentMethod) ?? "", receiptRef: str(a.receiptRef) ?? "", notes: str(a.notes) ?? "", category: str(a.category) ?? "", expenseScope: str(a.expenseScope) ?? "כללי", linkedSessionId: parseKey(a.session, ["session"])?.id ?? "", businessUnit: String(after.businessUnit) }) };
    },
    async verify(d, id, after) { const t = await d.readTransaction(id); return !!t && t.amount === after.amount && t.currency === after.currency && t.paymentStatus === after.paymentStatus && t.type === after.type && (t.businessUnit === undefined || t.businessUnit === after.businessUnit); },
    requiredValues: (_a, after) => [money(Number(after.amount), String(after.currency)), String(after.paymentStatus), ...(after.type === "income" && after.expenseScope === "קליפ" ? ["קליפ"] : []), ...(isBusinessUnit(after.businessUnit) ? [BUSINESS_UNIT_HE[after.businessUnit]] : [])],
    warnings: (c, a) => [...dupWarnings(c, a), ...(a && a.type === "income" && a.expenseScope === "קליפ" ? ["הכנסה עם שיוך קליפ = כסף של עסקת הקליפ — לא נספרת מול מחיר השיר"] : [])],
    disclosuresHe: ["נוצרת רשומה כספית אחת", "הוצאת Records של אמן Records ששולמה: חלק האמן נרשם / מתעדכן אוטומטית כהוצאה ביומן האמן (50/50, שליו+אבי 50/25/25, NagashBeatz 100% Records; מול גורם חיצוני — לא מוגדר, אין חיוב) — הכספים נשארים בסכום המלא", "מטבעות לא מחוברים ולא מומרים", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "UPDATE_TRANSACTION_DETAILS", kinds: ["transaction"],
    meta: meta("עדכון פרטי רשומה כספית (תיאור / תאריך / צד / קטגוריה / אמצעי / הערות)", "Update a transaction's descriptive fields (not amount / currency / status). expenseScope on an EXPENSE: any Finance scope; on a project INCOME (free-standing, not owned): קליפ (clip money) or כללי (song money) — the preview shows song vs clip money before / after", [K("transaction"), T("description"), { name: "date", kind: "ymd", required: false }, T("artist"), T("category"), T("notes"), E("paymentMethod", PAYMENT_METHODS), T("receiptRef"), E("expenseScope", EXPENSE_SCOPES)], ["description", "date", "artist", "category", "notes", "paymentMethod", "receiptRef", "expenseScope"], "updateTransactionRecord (lib/writes/finance)", { reversible: "YES" }),
    async resolve(d, a) { const r = await onTx(d, a); if (!("key" in r)) return r; return { ...r, fields: { ...r.fields, ...(await incomeScopeContext(d, r.id, r.fields, a)) } }; },
    read: txFieldsScoped,
    plan(a, cur) {
      const after: Fields = {};
      for (const k of ["description", "artist", "category", "notes", "receiptRef"] as const) if (a[k] !== undefined) { const t = text(a[k], 500); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      if (a.date !== undefined) { if (!realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין"); after.date = String(a.date); }
      if (a.paymentMethod !== undefined) after.paymentMethod = String(a.paymentMethod);
      if (a.expenseScope !== undefined) {
        if (cur.type === "income") {
          // B3: an income row is song money (כללי) or clip money (קליפ) — only on a project row, never an owned row
          if (!INCOME_SCOPES.includes(String(a.expenseScope))) return refuse("BAD_ARGS", "שיוך הכנסה: קליפ או כללי בלבד");
          if (!cur.projectId) return refuse("NO_PROJECT", "הכנסה בלי פרויקט — אין עסקת שיר / קליפ לשייך אליה");
        } else if (cur.type !== "expense") return refuse("BAD_ARGS", "שיוך רק להוצאה או להכנסה של פרויקט");
        after.expenseScope = String(a.expenseScope);
      }
      const own = ownedRefusal(cur, after); if (own) return own;
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.updateTransaction(id, { ...a }),
    requiredValues: (_a, after) => [...(after.date ? [String(after.date)] : []), ...(after.expenseScope !== undefined ? [String(after.expenseScope)] : [])],
    warnings: (c, a) => (a && a.expenseScope !== undefined && c.type === "income" && c.splitBefore !== undefined ? [
      `היום: ${c.splitBefore}`,
      `אחרי: ${c.splitAfter}`,
      c.clipPriceKnown ? `מחיר הקליפ שסוכם: ${money(Number(c.clipPrice), String(c.clipCurrency))}` : "מחיר עסקת הקליפ לא ידוע (לא נקבע בפרויקט) — הכסף יסומן ככסף קליפ, בלי מחיר להשוות מולו",
      a.expenseScope === "קליפ" ? "הרשומה תצא מחישוב החוב / היתרה של השיר ותיכנס לעסקת הקליפ" : "הרשומה תצא מעסקת הקליפ ותיכנס לחישוב מול מחיר השיר",
    ] : []),
    disclosuresHe: ["הסכום, המטבע והסטטוס לא משתנים", "שינוי תאריך משנה את החודש שבו הרשומה נספרת בדוחות", "שיוך קליפ להכנסה: רק רשומה חופשית (לא של הופעה / מיקס / ויקטור וכו') של פרויקט", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "SET_TRANSACTION_AMOUNT", kinds: ["transaction"],
    meta: meta("שינוי סכום / מטבע של רשומה כספית", "Change a transaction's amount and / or currency (no conversion)", [K("transaction"), { name: "amount", kind: "money", required: false }, E("currency", TX_CURRENCIES)], ["amount", "currency"], "updateTransactionRecord (lib/writes/finance)", {}),
    resolve: onTx, read: txFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.amount !== undefined) { if (typeof a.amount !== "number" || !(a.amount > 0)) return refuse("BAD_MONEY", "סכום חייב להיות גדול מ-0"); after.amount = a.amount; }
      if (a.currency !== undefined) { if (!TX_CURRENCIES.includes(String(a.currency))) return refuse("BAD_CURRENCY", "מטבע לא מוכר"); after.currency = String(a.currency); }
      if (!Object.keys(after).length) return refuse("NOTHING_TO_CHANGE", "לא ציינת מה לשנות");
      const own = ownedRefusal(cur, after); if (own) return own;
      // Both are always stated so the approval repeats the exact resulting money.
      return finishPlan(cur, { amount: after.amount ?? cur.amount, currency: after.currency ?? cur.currency });
    },
    apply: (d, id, a) => d.updateTransaction(id, { ...a }),
    requiredValues: (_a, after) => [money(Number(after.amount), String(after.currency))],
    warnings: (c) => [`היום: ${money(Number(c.amount), String(c.currency))} (${c.paymentStatus})`],
    disclosuresHe: ["שינוי מטבע לא ממיר את הסכום — הוא רק מתקן את המטבע הרשום", "הסטטוס לא משתנה", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "SET_TRANSACTION_STATUS", kinds: ["transaction"],
    meta: meta("שינוי סטטוס תשלום (התקבל / שולם / צפוי / …)", "Change a transaction's payment status (the app's own received / paid rules decide what counts)", [K("transaction"), E("paymentStatus", [...new Set([...INCOME_STATUSES, ...EXPENSE_STATUSES])], true), { name: "date", kind: "ymd", required: false }, E("paymentMethod", PAYMENT_METHODS)], ["paymentStatus", "date", "paymentMethod"], "updateTransactionRecord (lib/writes/finance)", {}),
    resolve: onTx, read: txFields,
    plan(a, cur) {
      const s = String(a.paymentStatus);
      if (!statusesFor(cur.type).includes(s)) return refuse("BAD_ENUM", `סטטוס לא מתאים ל${typeHe(cur.type)}: ${statusesFor(cur.type).join(" / ")}`);
      const after: Fields = { paymentStatus: s };
      if (a.date !== undefined) { if (!realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין"); after.date = String(a.date); }
      if (a.paymentMethod !== undefined) after.paymentMethod = String(a.paymentMethod);
      // owned fee-like rows (DJ / artist / rehearsal / Victor salary / mix / clip / promotion / Red Films) may change status;
      // a show payment / expected balance may not (the show payments flow)
      const own = ownedRefusal(cur, after); if (own) return own;
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.updateTransaction(id, { ...a }),
    requiredValues: (_a, after) => [String(after.paymentStatus)],
    warnings: (c) => [`הרשומה: ${typeHe(c.type)} ${money(Number(c.amount), String(c.currency))}, היום '${c.paymentStatus}'`, ...(c.owner === "CLIP_ROW" ? ["סטטוס ששולם מסמן גם את שורת הקליפ המקושרת כ'שולם' (כמו באפליקציה)"] : [])],
    disclosuresHe: ["רק הסטטוס (ותאריך / אמצעי אם ציינת) משתנה — הסכום והמטבע לא", "חלק האמן ביומן עוקב אחרי הסטטוס: שולם = פעיל; בוטל / צפוי = השורה נשמרת ב-0 (לא נמחקת)", "התקבל / שולם = כסף שעבר; חלקי, צפוי, לא שולם, בוטל — לא", "לא יישלח Push או הודעה"],
  },
  {
    // task 4 (2026-09-28): the Owner's unit for an existing row — a classification, allowed on rows owned by another writer
    // too (it never touches money, status, currency, project or the artist ledger)
    actionId: "SET_TRANSACTION_UNIT", kinds: ["transaction"],
    meta: meta("סיווג יחידה עסקית של רשומה כספית (Studio / Records / Films / Corporate)", "Set a transaction's business unit (STUDIO / RECORDS / FILMS / CORPORATE) as the Owner's decision — the money, status, currency, project and artist ledger never change", [K("transaction"), E("businessUnit", BUSINESS_UNITS, true)], ["businessUnit", "businessUnitSource"], "setTransactionUnit (lib/writes/business-unit)", {}),
    resolve: onTx, read: txFields,
    plan(a, cur) {
      if (!isBusinessUnit(a.businessUnit)) return refuse("BAD_ENUM", `יחידה עסקית: ${BUSINESS_UNITS.join(" / ")}`);
      return finishPlan(cur, { businessUnit: String(a.businessUnit), businessUnitSource: "OWNER_DECISION" });
    },
    apply: async (d, id, a) => { if (!(await d.setTransactionUnit(id, String(a.businessUnit)))) throw new Error("transaction not found"); },
    requiredValues: (_a, after) => [isBusinessUnit(after.businessUnit) ? BUSINESS_UNIT_HE[after.businessUnit] : String(after.businessUnit)],
    warnings: (c) => [
      `היום: ${isBusinessUnit(c.businessUnit) ? BUSINESS_UNIT_HE[c.businessUnit] : "דורש סיווג"}${isBusinessUnitSource(c.businessUnitSource) ? ` (${BUSINESS_UNIT_SOURCE_HE[c.businessUnitSource]})` : ""} — ${typeHe(c.type)} ${money(Number(c.amount), String(c.currency))}`,
      ...(c.businessUnitSource === "HISTORICAL_APPROVED" ? ["הסיווג הנוכחי הוא חלק מהיישור ההיסטורי שאישרת — השינוי מחליף אותו בהחלטה חדשה שלך"] : []),
    ],
    disclosuresHe: ["רק היחידה העסקית משתנה (החלטת בעלים) — הסכום, הסטטוס, המטבע והפרויקט לא", "היחידה קובעת אם זו הוצאת Records: חלק האמן ביומן מתעדכן בהתאם (נוצר / מתאפס ל-0, לא נמחק)", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "MOVE_TRANSACTION", kinds: ["transaction"],
    // toProject may be `$stepK.created` — a project an earlier step of the same plan creates (the row itself stays live-checked)
    refArgs: { toProject: ["project"] },
    meta: meta("העברת רשומה כספית לפרויקט אחר / לכללי", "Move a transaction to another project or to general (the target project must exist)", [K("transaction"), K("toProject", false), { name: "toGeneral", kind: "boolean", required: false }], ["projectId", "scope"], "updateTransactionRecord (lib/writes/finance)", {}),
    async resolve(d, a) {
      const k = parseKey(a.toProject, ["project"]);
      if (k && !(await d.readProjectMeta(k.id))) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את פרויקט היעד");
      return onTx(d, a);
    },
    read: txFields,
    plan(a, cur) {
      const own = ownedRefusal(cur, { projectId: "__moved__" }); if (own) return own;
      if (cur.linkedSessionId) return refuse("LINKED_ROW", "הרשומה מקושרת לסשן / לשכר — העברה תנתק את הקישור. אפשר למחוק ולרשום מחדש");
      if (a.toGeneral === true) return finishPlan(cur, { projectId: null, scope: "general" });
      const k = parseKey(a.toProject, ["project"]);
      if (!k) return refuse("BAD_ENTITY", "לאיזה פרויקט? (project:…) או toGeneral");
      return finishPlan(cur, { projectId: k.id, scope: "project" });
    },
    async apply(d, id, a) { if (a.projectId && !(await d.readProjectMeta(String(a.projectId)))) throw new Error("target project not found"); await d.updateTransaction(id, { project_id: a.projectId, scope: a.scope }); },
    requiredValues: (a) => [a.toGeneral === true ? "כללי" : String(a.toProject ?? "")].filter(Boolean),
    disclosuresHe: ["הסכום, המטבע והסטטוס לא משתנים — רק השיוך", "המחיר המוסכם / החוב של שני הפרויקטים ישתנו בהתאם", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "DELETE_TRANSACTION", kinds: ["transaction"],
    meta: meta("מחיקת רשומה כספית", "Delete a free-standing transaction (rows owned by a show / mix / Red Films sync are deleted through their action)", [K("transaction")], ["exists"], "deleteTransactionRecord (lib/writes/finance)", { effects: ["FINANCE", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onTx(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const f = await txFields(d, id); return f ? { ...f, exists: true } : null; },
    plan(_a, cur) { const own = ownedRefusal(cur, "delete"); if (own) return own; return { ok: true, after: { exists: false } }; },
    apply: (d, id) => d.deleteTransaction(id),
    async verify(d, id) { return (await d.readTransaction(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [`נמחקת: ${typeHe(c.type)} ${money(Number(c.amount), String(c.currency))} (${c.paymentStatus}) מתאריך ${c.date ?? "—"}`, ...(c.linkedSessionId ? ["הרשומה מקושרת לסשן / לשכר — הקישור ייעלם איתה"] : [])],
    disclosuresHe: ["הרשומה נמחקת לצמיתות", "אם נרשם ממנה חלק אמן ביומן — השורה נשמרת ב-0 עם הסיבה (לא נמחקת)", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "SPLIT_INCOME", kinds: ["transaction"],
    meta: meta("פיצול הכנסה צפויה: חלק שהתקבל + יתרה צפויה", "Split an expected income into the received part + the remaining expected balance (atomic, row-locked, no double split)", [K("transaction"), { name: "paidAmount", kind: "money", required: true }, { name: "receivedDate", kind: "ymd", required: true }, E("paymentMethod", PAYMENT_METHODS)], ["amount", "paymentStatus", "currency"], "splitIncome → split_income_transaction RPC (lib/writes/finance)", { reversible: "NO", compensation: null }),
    resolve: onTx, read: txFields,
    plan(a, cur) {
      const own = ownedRefusal(cur, { amount: "__split__" }); if (own) return own;
      if (cur.type !== "income" || cur.paymentStatus !== "צפוי") return refuse("NOT_SPLITTABLE", "אפשר לפצל רק הכנסה במצב 'צפוי'");
      const paid = a.paidAmount;
      if (typeof paid !== "number" || !(paid > 0) || paid > Number(cur.amount)) return refuse("BAD_MONEY", `הסכום שהתקבל חייב להיות בין 0 ל-${money(Number(cur.amount), String(cur.currency))}`);
      if (!realYmd(a.receivedDate)) return refuse("BAD_DATE", "תאריך קבלה לא תקין");
      return { ok: true, after: { amount: paid, paymentStatus: "התקבל", currency: String(cur.currency) } };
    },
    async apply(d, id, after, a) {
      const before = await d.readTransaction(id);
      if (!before) throw new Error("transaction not found");
      const r = await d.splitIncome(id, Number(after.amount), String(a.receivedDate), str(a.paymentMethod) ?? "");
      if (r !== "ok") throw new Error(`split refused: ${r}`);
      return { receipt: before.amount };
    },
    async verify(d, id, after, out) {
      // The RPC keeps this row as either the received part or the expected remainder — both are checked exactly.
      const t = await d.readTransaction(id); const orig = Number(out.receipt); const paid = Number(after.amount);
      if (!t || !Number.isFinite(orig)) return false;
      return (t.amount === paid && (t.paymentStatus === "התקבל" || t.paymentStatus === "שולם")) || (paid < orig && t.amount === orig - paid && t.paymentStatus === "צפוי");
    },
    requiredValues: (a, after) => [money(Number(after.amount), String(after.currency)), String(a.receivedDate)],
    warnings: (c) => [`היום: הכנסה צפויה ${money(Number(c.amount), String(c.currency))}`],
    disclosuresHe: ["פעולה אטומית בבסיס הנתונים: שורה אחת הופכת להתקבל בסכום שציינת, והיתרה נשארת צפויה", "אם כבר פוצלה במקביל — הפעולה נדחית", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "SET_AGREED_PRICE", kinds: ["project"],
    // chainable: one compare-and-swap merge into the project's finance settings (setFinanceSettings) — nothing else changes
    chain: { derived: () => [] },
    refTarget: NEW_PROJECT_SETTINGS_TARGET,
    meta: meta("קביעת מחיר מוסכם לפרויקט", "Set a project's agreed price + currency (drives debt / credit with received income)", [K("project"), { name: "agreedPrice", kind: "money", required: true }, E("currency", TX_CURRENCIES, true)], ["agreedPrice", "currency"], "setFinanceSettings (lib/writes/finance)", { effects: ["FINANCE", "SETTINGS"] }),
    resolve: onProjectFinance, read: settingsRead,
    plan(a, cur) {
      if (typeof a.agreedPrice !== "number" || !(a.agreedPrice >= 0)) return refuse("BAD_MONEY", "מחיר לא תקין");
      if (!TX_CURRENCIES.includes(String(a.currency))) return refuse("BAD_CURRENCY", "מטבע לא מוכר");
      return finishPlan(cur, { agreedPrice: a.agreedPrice, currency: String(a.currency) });
    },
    apply: (d, id, a) => d.setFinanceSettings(id, { agreedPrice: Number(a.agreedPrice), currency: String(a.currency) }),
    requiredValues: (_a, after) => [money(Number(after.agreedPrice), String(after.currency))],
    warnings: (c) => [`היום: ${money(Number(c.agreedPrice), String(c.currency))}`],
    disclosuresHe: ["חוב / זכות מחושבים מחדש לפי הכלל הקיים: התקבל ≥ מחיר = אין חוב, מעל = זכות (באותו מטבע בלבד)", "שום רשומה כספית לא נוצרת או משתנה", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "SET_FINANCIAL_NOTES", kinds: ["project"],
    chain: { derived: () => [] },
    refTarget: NEW_PROJECT_SETTINGS_TARGET,
    meta: meta("הערות כספיות לפרויקט", "Set a project's financial notes", [K("project"), T("financialNotes", true), E("mode", ["REPLACE", "APPEND"])], ["financialNotes"], "setFinanceSettings (lib/writes/finance)", { effects: ["SETTINGS"], riskClass: "SAFE_REVERSIBLE", reversible: "YES" }),
    resolve: onProjectFinance, read: settingsRead,
    plan(a, cur) {
      const t = text(a.financialNotes); if (t === null) return refuse("BAD_TEXT", "חסר טקסט");
      const next = a.mode === "APPEND" && String(cur.financialNotes).trim() ? `${String(cur.financialNotes).trimEnd()}\n${t.trim()}` : t.trim();
      return finishPlan(cur, { financialNotes: next });
    },
    apply: (d, id, a) => d.setFinanceSettings(id, { financialNotes: String(a.financialNotes) }),
    disclosuresHe: ["רק ההערה משתנה — מחיר, רשומות ומטבע לא משתנים", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "SET_FINANCE_EXCEPTION", kinds: ["project"],
    chain: { derived: () => [] },
    refTarget: NEW_PROJECT_SETTINGS_TARGET,
    meta: meta("חריגה כספית לפרויקט (הפעלה / ביטול)", "Turn a project's finance exception on (with reason + date) or off", [K("project"), { name: "on", kind: "boolean", required: true }, T("reason"), { name: "date", kind: "ymd", required: false }], ["financeException", "financeExceptionReason", "financeExceptionDate"], "setFinanceSettings (lib/writes/finance)", { effects: ["FINANCE", "SETTINGS"], reversible: "YES" }),
    resolve: onProjectFinance, read: settingsRead,
    plan(a, cur) {
      if (a.on === true) {
        const r = text(a.reason, 500); if (r === null) return refuse("BAD_TEXT", "חריגה צריכה סיבה");
        if (!realYmd(a.date)) return refuse("BAD_DATE", "חריגה צריכה תאריך");
        return finishPlan(cur, { financeException: true, financeExceptionReason: r.trim(), financeExceptionDate: String(a.date) });
      }
      return finishPlan(cur, { financeException: false });
    },
    apply: (d, id, a) => d.setFinanceSettings(id, { ...(a as Partial<FinSettings>) }),
    requiredValues: (_a, after) => [after.financeException ? "חריגה" : "ביטול חריגה"],
    disclosuresHe: ["חריגה מוציאה את הפרויקט מבדיקות החוב הרגילות (כמו באפליקציה)", "שום רשומה כספית לא משתנה", "לא יישלח Push או הודעה"],
  },
];
