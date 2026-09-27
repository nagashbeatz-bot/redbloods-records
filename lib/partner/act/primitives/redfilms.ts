/**
 * SUNNY UNIVERSAL ACTION LAYER — Red Films + clip-planning family: productions (create / details / money / cancel),
 * budget lines, the Red Films payments ledger, and the project's clip planning rows (incl. 'העבר לכספים'). Every write
 * goes through lib/writes/redfilms — the writer the Red Films screens and the clip panel use.
 *
 * App rules only: planned ≠ spent (production budget, budget lines and clip rows are planning; Red Films payments are
 * their own ledger; only a Finance expense with scope קליפ is actual spend, and only שולם is paid). Every Red Films money
 * row carries its currency (₪ / $ / €, SET_RF_CURRENCY); clip rows carry their own; nothing is ever converted. B3 (Owner
 * canon 2026-09-27): the client clip price (A) is never the planned budget (B) — no price → budget sync and no budget
 * lock; a production created by 'שלח קליפ' owns its planning budget like any other. D7 ("production
 * approved") is unchanged: status מאושר is today's status value, nothing more. Crew names are free text. Link / URL
 * fields are never written through Sunny (plans never persist URL values — a registered, reported limit).
 */
import type { ArgSpec } from "../types";
import { finishPlan, parseKey, realYmd, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";
import { dupContext, dupGate, dupWarnings, DUP_ARGS } from "./duplicates";
import { isClipItemPromoted } from "@/lib/clip-rf-money-pure";

type Row = Record<string, unknown>;
export interface RedFilmsFamilyWriters {
  productionFolderState(id: string): Promise<{ hasFolder: boolean } | null>;
  createProductionFolder(id: string): Promise<void>;
  readProductionRow(id: string): Promise<Row | null>;
  countProductionsTitled(title: string): Promise<number>;
  isManagedProduction(id: string, projectId: string | null): Promise<boolean>;
  createProductionRecord(body: Record<string, unknown>): Promise<string>;
  updateProductionRecord(id: string, body: Record<string, unknown>): Promise<"ok" | "empty" | "not_found">;
  readBudgetLineRow(id: string): Promise<Row | null>;
  createBudgetLineRecord(productionId: string, body: Record<string, unknown>): Promise<string>;
  updateBudgetLineRecord(id: string, body: Record<string, unknown>): Promise<void>;
  deleteBudgetLineRecord(id: string): Promise<void>;
  readBudgetPaymentRow(id: string): Promise<Row | null>;
  insertBudgetPaymentRecord(itemId: string, p: { amount: number; paymentDate: string; paymentMethod: string; notes: string }): Promise<string>;
  updateBudgetPaymentRecord(id: string, body: Record<string, unknown>): Promise<void>;
  deleteBudgetPaymentRecord(id: string): Promise<void>;
  readClipItemRow(id: string): Promise<Row | null>;
  createClipItemRecord(body: Record<string, unknown>): Promise<string>;
  updateClipItemRecord(id: string, body: Record<string, unknown>): Promise<void>;
  deleteClipItemRecord(id: string): Promise<void>;
  promoteClipItemRecord(id: string, date: string): Promise<"ok" | "not_found" | "already_promoted">;
  clipDealOf(projectId: string): Promise<{ clipAgreedPrice: number; currency: string; paymentCount: number; managedProductionId: string | null }>;
  setClipPrice(projectId: string, price: number): Promise<void>;
  addClipPayments(projectId: string, body: Record<string, unknown>): Promise<"ok" | "not_found">;
  sendClipToRedFilms(projectId: string): Promise<"ok" | "not_found">;
  readEquipmentRow(id: string): Promise<Row | null>;
  countEquipmentNamed(name: string): Promise<number>;
  createEquipmentRecord(body: Record<string, unknown>): Promise<string>;
  updateEquipmentRecord(id: string, body: Record<string, unknown>): Promise<"ok" | "bad" | "not_found">;
  readDocumentRow(id: string): Promise<Row | null>;
  deleteRfDocumentRecord(id: string): Promise<"ok" | "not_found">;
  readReferenceRow(id: string): Promise<Row | null>;
  setRfReferenceTagRecord(id: string, tag: string): Promise<void>;
  deleteRfReferenceRecord(id: string): Promise<"ok" | "not_found">;
  productionsByIds(ids: string[]): Promise<Array<{ id: string; title: string; status: string }>>;
  deleteCancelledProductionsRecord(ids: string[]): Promise<{ kind: "ok" | "bad"; deleted?: number; error?: string; code?: string; storageFailures?: number; googleTaskFailures?: number; warningHe?: string | null }>;
  /** lib/writes/redfilms redFilmsDeletePreflight — READ-ONLY counts of everything a permanent delete touches. */
  rfDeletePreflight(ids: string[]): Promise<RfDeletePreflightView>;
  countBudgetLinePayments(itemId: string): Promise<number>;
}

/** Pinned to lib/partner/system/red-films.ts RF_VOCABULARIES (which the red-films contract test pins to the code). */
export const RF_STATUSES: readonly string[] = ["רעיון", "הצעה נשלחה", "ממתין לאישור", "בתכנון", "יום צילום נקבע", "צולם", "חומרי גלם הועלו", "בעריכה", "נשלחה גרסה", "תיקונים", "מאושר", "פורסם", "בוטל"];
export const RF_TYPES: readonly string[] = ["קליפ", "יום צילום", "תוכן סושיאל", "צילום הופעה", "צילום סטודיו", "מאחורי הקלעים", "פרסומת", "ויזואלייזר", "צילום לייב", "אחר"];
export const RF_COLLECTION: readonly string[] = ["לא רלוונטי", "צפוי", "התקבל", "שולם", "לא שולם", "חלקי", "בוטל"];
export const RF_EDIT: readonly string[] = ["לא התחיל", "חומרי גלם הועלו", "בעריכה", "נשלחה גרסה 1", "תיקונים", "מאושר", "פורסם"];
export const RF_BUDGET_STATUS: readonly string[] = ["מתוכנן", "שולם", "בוטל"];
export const RF_BUDGET_CATEGORY: readonly string[] = ["צלם", "ציוד", "לוקיישן", "תלבושות / סטיילינג", "פוסט פרודקשן", "שחקנים / מודלים", "קייטרינג", "הובלה / לוגיסטיקה", "שיווק", "אחר"];
export const CLIP_ITEM_CATEGORY: readonly string[] = ["צילום קליפ", "עריכת קליפ", "ציוד צילום", "תאורה", "לוקיישן", "דוגמניות / משתתפים", "איפור / סטיילינג", "הסעות", "אוכל / הפקה", "אביזרים", "אחר"];
const CLIP_CURRENCIES: readonly string[] = ["₪", "$", "€"];
const ils = (n: number) => `₪${Number(n).toLocaleString("en-US")}`;
const money = (n: number, c: string) => `${c}${Number(n).toLocaleString("en-US")}`;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const E = (name: string, values: readonly string[], required = false): ArgSpec => ({ name, kind: "enum", required, values });
const M = (name: string, required = false): ArgSpec => ({ name, kind: "money", required });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "RF", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });
const NO_CUR = "כל סכום של Red Films במטבע של השורה שלו (₪ / $ / €) — בלי המרה ובלי חיבור בין מטבעות";
/** Pinned to lib/writes/redfilms.ts RF_CURRENCIES. */
export const RF_CURRENCIES: readonly string[] = ["₪", "$", "€"];
const CUR_KINDS = ["rf-production", "rf-budget-line", "rf-equipment"] as const;
async function currencyTarget(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<{ kind: string; id: string; row: Row } | PlanRefusal> {
  const k = parseKey(a.target, [...CUR_KINDS]);
  if (!k) return refuse("BAD_ENTITY", "צריך הפקה / שורת תקציב / פריט ציוד (rf-production:… / rf-budget-line:… / rf-equipment:…)");
  const row = k.kind === "rf-production" ? await d.readProductionRow(k.id) : k.kind === "rf-budget-line" ? await d.readBudgetLineRow(k.id) : await d.readEquipmentRow(k.id);
  return row ? { kind: k.kind, id: k.id, row } : refuse("ENTITY_NOT_FOUND", "לא מצאתי את הרשומה");
}
async function currencyFields(d: WriterDeps, t: { kind: string; id: string; row: Row }): Promise<Fields> {
  const r = t.row as Record<string, unknown>;
  return {
    currency: String(r.currency ?? "₪"), label: String(r.title ?? r.name ?? ""),
    payments: t.kind === "rf-budget-line" ? await d.countBudgetLinePayments(t.id) : 0,
    managed: t.kind === "rf-production" ? await d.isManagedProduction(t.id, (r.project_id as string | null) ?? null) : false,
    amounts: t.kind === "rf-production" ? `תקציב ${r.general_budget ?? 0} · ללקוח ${r.client_price ?? 0} · מקדמה נדרשת ${r.advance_required ?? 0} · התקבלה ${r.advance_received ?? 0}` : t.kind === "rf-budget-line" ? `מתוכנן ${r.planned_amount ?? 0} · בפועל ${r.actual_amount ?? 0}` : `מחיר קנייה ${r.purchase_price ?? "—"}`,
  };
}
const PLANNING = "תכנון ≠ הוצאה בפועל: רק הוצאה בכספים עם שיוך קליפ היא הוצאה, ורק 'שולם' משולם";

const DETAIL_TEXT = ["title", "photographer_name", "director_name", "editor_name", "locations", "concept_summary", "concept_vibe", "script_start", "script_middle", "script_end", "director_notes", "photographer_notes", "fix_notes", "published_where", "notes"] as const;
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

async function prodFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const r = await d.readProductionRow(id); if (!r) return null;
  const f: Fields = { status: String(r.status ?? ""), productionType: String(r.production_type ?? ""), shootDate: (r.shoot_date as string | null) ?? null, publishDate: (r.publish_date as string | null) ?? null, editStatus: String(r.edit_status ?? ""), collectionStatus: String(r.collection_status ?? ""), generalBudget: Number(r.general_budget) || 0, clientPrice: Number(r.client_price) || 0, advanceRequired: Number(r.advance_required) || 0, advanceReceived: Number(r.advance_received) || 0, managed: await d.isManagedProduction(id, (r.project_id as string | null) ?? null) };
  for (const k of DETAIL_TEXT) f[camel(k)] = String(r[k] ?? "");
  return f;
}
async function onProd(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.production, ["rf-production"]); if (!k) return refuse("BAD_ENTITY", "צריך הפקה (rf-production:…)");
  const f = await prodFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההפקה");
  return { key: `rf-production:${k.id}`, id: k.id, label: String(f.title), fields: f };
}
const lineFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const r = await d.readBudgetLineRow(id); return r ? { productionId: String(r.production_id), title: String(r.title ?? ""), category: String(r.category ?? ""), plannedAmount: Number(r.planned_amount) || 0, actualAmount: Number(r.actual_amount) || 0, vendorName: String(r.vendor_name ?? ""), status: String(r.status ?? ""), notes: String(r.notes ?? "") } : null; };
async function onLine(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.budgetLine, ["rf-budget-line"]); if (!k) return refuse("BAD_ENTITY", "צריך שורת תקציב (rf-budget-line:…)");
  const f = await lineFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את שורת התקציב");
  return { key: `rf-budget-line:${k.id}`, id: k.id, label: String(f.title || f.category), fields: f };
}
const payFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const r = await d.readBudgetPaymentRow(id); return r ? { amount: Number(r.amount) || 0, paymentDate: String(r.payment_date ?? ""), paymentMethod: String(r.payment_method ?? ""), notes: String(r.notes ?? ""), hasReceipt: r.has_receipt === true } : null; };
async function onPay(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.payment, ["rf-payment"]); if (!k) return refuse("BAD_ENTITY", "צריך תשלום (rf-payment:…)");
  const f = await payFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את התשלום");
  return { key: `rf-payment:${k.id}`, id: k.id, label: `${ils(Number(f.amount))} ${f.paymentDate}`, fields: f };
}
const clipFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const r = await d.readClipItemRow(id); return r ? { projectId: String(r.project_id), category: String(r.category ?? ""), description: String(r.description ?? ""), amount: Number(r.amount) || 0, currency: String(r.currency ?? "₪"), status: String(r.status ?? ""), notes: String(r.notes ?? ""), promoted: isClipItemPromoted(r as { status?: string | null; linked_transaction_id?: string | null }) } : null; };
async function onClip(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.clipRow, ["clip-row"]); if (!k) return refuse("BAD_ENTITY", "צריך שורת תכנון קליפ (clip-row:…)");
  const f = await clipFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את השורה");
  return { key: `clip-row:${k.id}`, id: k.id, label: `${f.category} ${money(Number(f.amount), String(f.currency))}`, fields: f };
}
const dealFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { if (!(await d.readProjectMeta(id))) return null; const c = await d.clipDealOf(id); return { clipAgreedPrice: c.clipAgreedPrice, currency: c.currency, paymentCount: c.paymentCount, managed: !!c.managedProductionId }; };
async function onDeal(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)");
  const p = await d.readProjectMeta(k.id); if (!p) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
  return { key: `project:${k.id}`, id: k.id, label: p.name, fields: (await dealFields(d, k.id))! };
}
/** Duplicate awareness (POLISH FIX #1): the same budget line / project clip income + amount, near the date, similar notes. */
const rfPayDup = (d: WriterDeps, a: Readonly<Record<string, unknown>>) => {
  const k = parseKey(a.budgetLine, ["rf-budget-line"]);
  return dupContext(d, k && typeof a.amount === "number" ? { kind: "RF_PAYMENT", budgetLineId: k.id, amount: a.amount } : null, { date: realYmd(a.paymentDate) ? String(a.paymentDate) : null, text: str(a.notes) ?? "", currency: "" });
};
const clipDup = (d: WriterDeps, id: string, a: Readonly<Record<string, unknown>>, currency: string) =>
  dupContext(d, typeof a.amount === "number" ? { kind: "CLIP_PAYMENT", projectId: id, amount: a.amount } : null, { date: realYmd(a.date) ? String(a.date) : null, text: [str(a.description), str(a.notes)].filter(Boolean).join(" "), currency });
export const RF_EQUIPMENT_CATEGORY: readonly string[] = ["מצלמות", "עדשות", "ייצוב", "תאורה", "סאונד", "אביזרים", "אחר"];
const equipFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const r = await d.readEquipmentRow(id); return r ? { name: String(r.name ?? ""), category: String(r.category ?? ""), quantity: Number(r.quantity) || 0, purchasePrice: r.purchase_price === null || r.purchase_price === undefined ? null : Number(r.purchase_price), purchasedFrom: String(r.purchased_from ?? ""), serialNumber: String(r.serial_number ?? ""), notes: String(r.notes ?? ""), status: String(r.status ?? "קיים") } : null; };
const bulkIds = (v: unknown): string[] | null => { if (typeof v !== "string") return null; const ids = v.split(/[,;\s]+/).filter(Boolean).map((x) => parseKey(x, ["rf-production"])?.id ?? ""); return ids.length && ids.length <= 50 && ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null; };
export interface RfDeletePreflightView {
  payments: number; paymentsByCurrency: Record<string, number>; productionsWithPayments: string[];
  budgetLines: number; budgetLinesWithTransaction: number; documents: number; referenceImages: number; referenceLinks: number; scenes: number; crew: number;
  tasks: number; googleTasks: number; storageFiles: number; foldersKept: number; clipMarkers: number;
}
const curText = (m: Record<string, number>) => Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([c, n]) => `${c}${Number(n).toLocaleString("en-US")}`).join(" + ");
/** The preflight counts become preview FIELDS, so any change between preview and execution is STALE. */
const rfDeleteFields = (p: RfDeletePreflightView): Fields => ({ payments: p.payments, paymentsText: curText(p.paymentsByCurrency), budgetLines: p.budgetLines, budgetLinesWithTransaction: p.budgetLinesWithTransaction, documents: p.documents, referenceImages: p.referenceImages, referenceLinks: p.referenceLinks, scenes: p.scenes, crew: p.crew, tasks: p.tasks, googleTasks: p.googleTasks, storageFiles: p.storageFiles, foldersKept: p.foldersKept, clipMarkers: p.clipMarkers });
const bulkFields = (found: Array<{ id: string; title: string; status: string }>): Fields => ({ count: found.length, notCancelled: found.filter((p) => p.status !== "בוטל").length, titles: found.map((p) => p.title).sort().join(", "), remaining: found.length });
const withExists = (r: ResolvedTarget | PlanRefusal) => ("ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } });
const snake = (o: Fields) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z0-9]/g, (c) => `_${c.toLowerCase()}`).replace(/_(\d)/g, "_$1"), v]));

export const RF_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "SET_RF_CURRENCY", kinds: ["rf-production", "rf-budget-line", "rf-equipment"],
    meta: meta("מטבע של רשומת Red Films (הפקה / שורת תקציב / ציוד)", "Set the currency (₪ / $ / €) of a production's money, a budget line (its payments follow it) or an equipment purchase price — the numbers are never converted", [K("target"), E("currency", RF_CURRENCIES, true)], ["currency"], "updateProduction / updateBudgetLine / updateEquipment (lib/writes/redfilms)", { effects: [], riskClass: "NORMAL_BUSINESS", reversible: "YES" }),
    async resolve(d, a) { const t = await currencyTarget(d, a); if ("ok" in t) return t; const f = await currencyFields(d, t); return { key: `${t.kind}:${t.id}`, id: t.id, label: `מטבע — ${f.label || t.kind}`, fields: f }; },
    async read(d, id, a) {
      const t = a ? await currencyTarget(d, a) : await (async () => { // verification reads by id only (uuids are unique across the three tables)
        for (const kind of CUR_KINDS) { const row = kind === "rf-production" ? await d.readProductionRow(id) : kind === "rf-budget-line" ? await d.readBudgetLineRow(id) : await d.readEquipmentRow(id); if (row) return { kind, id, row }; }
        return null;
      })();
      return t && !("ok" in t) ? currencyFields(d, t) : null;
    },
    plan(a, cur) {
      if (!RF_CURRENCIES.includes(String(a.currency))) return refuse("BAD_CURRENCY", "₪ / $ / €");
      if (Number(cur.payments) > 0 && a.currency !== cur.currency) return refuse("HAS_PAYMENTS", `לשורה יש ${cur.payments} תשלומים ב-${cur.currency} — אי אפשר לשנות את המטבע (אין המרה)`);
      return finishPlan(cur, { currency: String(a.currency) });
    },
    async apply(d, id, after, a) {
      const k = parseKey(a.target, [...CUR_KINDS])!;
      if (k.kind === "rf-production") { const r = await d.updateProductionRecord(id, { currency: after.currency }); if (r !== "ok") throw new Error(`not updated: ${r}`); }
      else if (k.kind === "rf-budget-line") await d.updateBudgetLineRecord(id, { currency: after.currency });
      else { const r = await d.updateEquipmentRecord(id, { currency: after.currency }); if (r !== "ok") throw new Error(`not updated: ${r}`); }
    },
    requiredValues: (_a, after) => [String(after.currency)],
    warnings: (c) => [`היום ${c.currency}: ${c.amounts} — המספרים לא מומרים, רק המטבע שלהם משתנה`],
    disclosuresHe: ["המספרים נשארים כמו שהם — רק המטבע שלהם משתנה (אין המרה)", "שורת תקציב עם תשלומים לא מחליפה מטבע; תשלום חדש תמיד במטבע של השורה שלו", "סיכומים מוצגים לפי מטבע — לעולם לא מחוברים"],
  },
  {
    actionId: "CREATE_PRODUCTION_FOLDER", kinds: ["rf-production"],
    meta: meta("הקמת תיקיית ההפקה (עם קישור ציבורי)", "Create the production's storage folder (+ references, documents) with a PUBLIC link, saved on the production — the production page's button", [K("production")], ["hasFolder"], "createProductionFolder (lib/writes/redfilms)", { effects: ["FILES", "EXTERNAL_LINK"], riskClass: "FILE_MUTATION", reversible: "PARTIAL", compensation: null }),
    async resolve(d, a) { const k = parseKey(a.production, ["rf-production"]); if (!k) return refuse("BAD_ENTITY", "צריך הפקה (rf-production:…)"); const s = await d.productionFolderState(k.id); if (!s) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההפקה"); return { key: `rf-production:${k.id}`, id: k.id, label: "תיקיית הפקה", fields: { hasFolder: s.hasFolder } }; },
    read: async (d, id) => { const s = await d.productionFolderState(id); return s ? { hasFolder: s.hasFolder } : null; },
    plan: (_a, cur) => (cur.hasFolder ? refuse("ALREADY_EXISTS", "להפקה כבר יש תיקייה") : { ok: true, after: { hasFolder: true } }),
    apply: (d, id) => d.createProductionFolder(id),
    requiredValues: () => ["קישור ציבורי"],
    disclosuresHe: ["נוצרות תיקיות באחסון ונוצר קישור ציבורי (נשמר בהפקה, לא מוצג לסאני)", "לא נשלח כלום"],
  },
  {
    actionId: "CREATE_PRODUCTION", kinds: ["rf-production"],
    meta: meta("פתיחת הפקה ב-Red Films", "Create a Red Films production (status רעיון; client source from the linked project's classification — לייבל → פנימי - לייבל, לקוח → לקוח חיצוני; no project → the screens' default פנימי - לייבל)", [T("title", true), E("productionType", RF_TYPES), K("project", false), T("artistName"), T("photographerName")], ["title", "productionType"], "createProduction (lib/writes/redfilms)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "cancel the production" }),
    createContext: async (d, a) => ({ sameTitle: typeof a.title === "string" ? await d.countProductionsTitled(a.title.trim()) : 0 }),
    async resolve(d, a) { const t = text(a.title, 200); if (t === null) return refuse("BAD_TEXT", "שם ההפקה חובה"); return { key: "rf-production:new", id: "new", label: t.trim(), fields: { sameTitle: await d.countProductionsTitled(t.trim()) } }; },
    read: prodFields,
    plan(a) { const t = text(a.title, 200); if (t === null) return refuse("BAD_TEXT", "שם ההפקה חובה"); if (a.project !== undefined && !parseKey(a.project, ["project"])) return refuse("BAD_ENTITY", "פרויקט לא תקין"); return { ok: true, after: { title: t.trim(), productionType: String(a.productionType ?? "קליפ") } }; },
    async apply(d, _id, after, a) { return { createdId: await d.createProductionRecord({ title: after.title, production_type: after.productionType, project_id: parseKey(a.project, ["project"])?.id ?? null, artist_name: str(a.artistName) ?? "", photographer_name: str(a.photographerName) ?? "" }) }; },
    async verify(d, id, after) { const f = await prodFields(d, id); return !!f && f.title === after.title && f.status === "רעיון"; },
    warnings: (c) => (Number(c.sameTitle) > 0 ? [`כבר יש ${c.sameTitle} הפקה באותו שם`] : []),
    disclosuresHe: ["הפקה חדשה בסטטוס רעיון; לא נוצר תקציב, תיקייה, משימה או רשומה כספית", "מקור הלקוח נגזר מסיווג הפרויקט (לייבל → פנימי - לייבל, לקוח → לקוח חיצוני)", "לפרויקט עם עסקת קליפ עדיף 'שלח קליפ' (מקשר את ההפקה לפרויקט)"],
  },
  {
    actionId: "UPDATE_PRODUCTION_DETAILS", kinds: ["rf-production"],
    meta: meta("עדכון הפקה (סטטוס / סוג / צוות / תאריכים / תסריט / הערות / סטטוס עריכה)", "Update a production's non-money details (status except בוטל — cancel is its own action; מאושר is today's status, D7 unchanged)", [K("production"), E("status", RF_STATUSES.filter((s) => s !== "בוטל")), E("productionType", RF_TYPES), E("editStatus", RF_EDIT), { name: "shootDate", kind: "ymd", required: false }, { name: "publishDate", kind: "ymd", required: false }, ...DETAIL_TEXT.map((k) => T(camel(k)))], ["status", "productionType", "editStatus", "shootDate", "publishDate", ...DETAIL_TEXT.map(camel)], "updateProduction (lib/writes/redfilms)", {}),
    resolve: onProd, read: prodFields,
    plan(a, cur) {
      const after: Fields = {};
      for (const k of ["status", "productionType", "editStatus"] as const) if (a[k] !== undefined) after[k] = String(a[k]);
      for (const k of ["shootDate", "publishDate"] as const) if (a[k] !== undefined) { if (!realYmd(a[k])) return refuse("BAD_DATE", "תאריך לא תקין"); after[k] = String(a[k]); }
      for (const k of DETAIL_TEXT.map(camel)) if (a[k] !== undefined) { const t = text(a[k], k === "title" ? 200 : 2000); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      return finishPlan(cur, after);
    },
    async apply(d, id, a) { const r = await d.updateProductionRecord(id, snake(a)); if (r !== "ok") throw new Error(`not updated: ${r}`); },
    requiredValues: (_a, after) => [after.status, after.shootDate].filter((x) => x !== undefined).map(String),
    disclosuresHe: ["תאריך צילום שעבר לא מוכיח שצולם", "'מאושר' (D7) = אישרת את השלב הנוכחי להמשיך לשלב הבא — לא אישור לקוח, לא תשלום, לא גרסה סופית, לא מסירה", "לא נשלח כלום לאף אחד"],
  },
  {
    actionId: "SET_PRODUCTION_MONEY", kinds: ["rf-production"],
    meta: meta("כסף של הפקה (תקציב / מחיר ללקוח / מקדמה נדרשת / התקבלה / סטטוס גבייה)", "Set a production's planning money (B3: the budget is planning — never the client clip price; no lock on productions created by 'שלח קליפ')", [K("production"), M("generalBudget"), M("clientPrice"), M("advanceRequired"), M("advanceReceived"), E("collectionStatus", RF_COLLECTION)], ["generalBudget", "clientPrice", "advanceRequired", "advanceReceived", "collectionStatus"], "updateProduction (lib/writes/redfilms)", { effects: ["FINANCE"], riskClass: "FINANCIAL" }),
    resolve: onProd, read: prodFields,
    plan(a, cur) {
      const after: Fields = {};
      for (const k of ["generalBudget", "clientPrice", "advanceRequired", "advanceReceived"] as const) if (a[k] !== undefined) { if (typeof a[k] !== "number" || (a[k] as number) < 0) return refuse("BAD_MONEY", "סכום לא תקין"); after[k] = a[k] as number; }
      if (a.collectionStatus !== undefined) after.collectionStatus = String(a.collectionStatus);
      return finishPlan(cur, after);
    },
    async apply(d, id, a) { const r = await d.updateProductionRecord(id, snake(a)); if (r !== "ok") throw new Error(`not updated: ${r}`); },
    requiredValues: (_a, after) => Object.entries(after).map(([k, v]) => (k === "collectionStatus" ? String(v) : ils(Number(v)))),
    warnings: (c) => (c.managed ? ["ההפקה נוצרה מהפרויקט ('שלח קליפ') — התקציב הוא תכנון שלה; מחיר הקליפ ללקוח בפרויקט לא משתנה"] : []),
    disclosuresHe: [PLANNING, NO_CUR, "תקציב ≠ מחיר הקליפ ללקוח ≠ עלות בפועל ≠ סכום לקיזוז מהאמן", "לא נוצרת רשומה כספית; לא נשלח כלום"],
  },
  {
    actionId: "CANCEL_PRODUCTION", kinds: ["rf-production"],
    meta: meta("ביטול הפקה", "Cancel a production: saved first, then its future / undated tasks are cancelled and their Google Tasks removed (hardened order)", [K("production")], ["status"], "updateProduction (lib/writes/redfilms)", { effects: ["GOOGLE_TASKS"], riskClass: "EXTERNAL_SYSTEM_WRITE", reversible: "PARTIAL" }),
    resolve: onProd, read: prodFields,
    plan: (_a, cur) => finishPlan(cur, { status: "בוטל" }),
    async apply(d, id) { const r = await d.updateProductionRecord(id, { status: "בוטל" }); if (r !== "ok") throw new Error(`not cancelled: ${r}`); },
    requiredValues: () => ["ביטול"],
    disclosuresHe: ["ההפקה נשמרת כ'בוטל' ורק אחרי זה: משימות עתידיות / בלי תאריך שלה עוברות ל'בוטל' ו-Google Tasks שלהן נמחקות; משימות עבר לא נוגעים", "תקציב, תשלומים וקבצים לא משתנים; מחיקה לצמיתות היא פעולה נפרדת"],
  },
  {
    actionId: "ADD_RF_BUDGET_LINE", kinds: ["rf-budget-line"],
    meta: meta("שורת תקציב להפקה", "Add a budget line to a production (planning)", [K("production"), T("title", true), E("category", RF_BUDGET_CATEGORY), M("plannedAmount"), M("actualAmount"), T("vendorName"), E("status", RF_BUDGET_STATUS), T("notes")], ["title", "plannedAmount"], "createBudgetLine (lib/writes/redfilms)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "delete the line" }),
    createContext: async (d, a) => { const k = parseKey(a.production, ["rf-production"]); return { productionTitle: k ? String((await d.readProductionRow(k.id))?.title ?? "") || null : null }; },
    async resolve(d, a) { const r = await onProd(d, a); if ("ok" in r) return r; return { key: "rf-budget-line:new", id: "new", label: `תקציב ${r.label}`, fields: { productionTitle: r.label } }; },
    read: lineFields,
    plan(a) { const t = text(a.title, 200); if (t === null) return refuse("BAD_TEXT", "שם השורה חסר"); for (const k of ["plannedAmount", "actualAmount"]) if (a[k] !== undefined && (typeof a[k] !== "number" || (a[k] as number) < 0)) return refuse("BAD_MONEY", "סכום לא תקין"); return { ok: true, after: { title: t.trim(), plannedAmount: Number(a.plannedAmount ?? 0) } }; },
    async apply(d, _id, after, a) { return { createdId: await d.createBudgetLineRecord(parseKey(a.production, ["rf-production"])!.id, { title: after.title, category: a.category, planned_amount: after.plannedAmount, actual_amount: a.actualAmount, vendor_name: a.vendorName, status: a.status, notes: a.notes }) }; },
    async verify(d, id, after) { const f = await lineFields(d, id); return !!f && f.title === after.title && f.plannedAmount === after.plannedAmount; },
    requiredValues: (_a, after) => [ils(Number(after.plannedAmount))],
    disclosuresHe: [PLANNING, NO_CUR],
  },
  {
    actionId: "UPDATE_RF_BUDGET_LINE", kinds: ["rf-budget-line"],
    meta: meta("עדכון שורת תקציב", "Edit a budget line", [K("budgetLine"), T("title"), E("category", RF_BUDGET_CATEGORY), M("plannedAmount"), M("actualAmount"), T("vendorName"), E("status", RF_BUDGET_STATUS), T("notes")], ["title", "category", "plannedAmount", "actualAmount", "vendorName", "status", "notes"], "updateBudgetLine (lib/writes/redfilms)", { effects: ["FINANCE"], riskClass: "FINANCIAL" }),
    resolve: onLine, read: lineFields,
    plan(a, cur) {
      const after: Fields = {};
      for (const k of ["title", "vendorName", "notes"] as const) if (a[k] !== undefined) { const t = text(a[k], 500); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      for (const k of ["category", "status"] as const) if (a[k] !== undefined) after[k] = String(a[k]);
      for (const k of ["plannedAmount", "actualAmount"] as const) if (a[k] !== undefined) { if (typeof a[k] !== "number" || (a[k] as number) < 0) return refuse("BAD_MONEY", "סכום לא תקין"); after[k] = a[k] as number; }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.updateBudgetLineRecord(id, snake(a)),
    requiredValues: (_a, after) => [after.plannedAmount, after.actualAmount].filter((x) => x !== undefined).map((v) => ils(Number(v))),
    disclosuresHe: [PLANNING, NO_CUR],
  },
  {
    actionId: "DELETE_RF_BUDGET_LINE", kinds: ["rf-budget-line"],
    meta: meta("מחיקת שורת תקציב", "Delete a budget line", [K("budgetLine")], ["exists"], "deleteBudgetLine (lib/writes/redfilms)", { effects: ["DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { return withExists(await onLine(d, a)); },
    async read(d, id) { const f = await lineFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deleteBudgetLineRecord(id),
    async verify(d, id) { return (await d.readBudgetLineRow(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["השורה נמחקת לצמיתות", "רשומות כספים לא משתנות"],
  },
  {
    actionId: "RECORD_RF_BUDGET_PAYMENT", kinds: ["rf-payment"],
    meta: meta("רישום תשלום על שורת תקציב (לדג'ר של Red Films)", "Record a payment on a budget line in the Red Films payments ledger (no receipt file — uploads are the file channel)", [K("budgetLine"), M("amount", true), { name: "paymentDate", kind: "ymd", required: true }, T("paymentMethod"), T("notes"), ...DUP_ARGS], ["amount", "paymentDate", "paymentMethod", "notes"], "insertBudgetPayment (lib/writes/redfilms)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "delete the payment" }),
    createContext: async (d, a) => { const k = parseKey(a.budgetLine, ["rf-budget-line"]); return { lineTitle: k ? String((await d.readBudgetLineRow(k.id))?.title ?? "") || null : null, ...(await rfPayDup(d, a)) }; },
    async resolve(d, a) { const r = await onLine(d, a); if ("ok" in r) return r; return { key: "rf-payment:new", id: "new", label: `תשלום ${r.label}`, fields: { lineTitle: String(r.fields.title) || null, ...(await rfPayDup(d, a)) } }; },
    read: payFields,
    plan(a, cur) {
      if (typeof a.amount !== "number" || !(a.amount > 0)) return refuse("BAD_MONEY", "סכום חייב להיות גדול מ-0"); if (!realYmd(a.paymentDate)) return refuse("BAD_DATE", "תאריך לא תקין");
      const g = dupGate(a, cur, "רשומת תשלום"); if (g) return g;
      return { ok: true, after: { amount: a.amount, paymentDate: String(a.paymentDate), paymentMethod: str(a.paymentMethod) ?? "", notes: str(a.notes) ?? "" } };
    },
    async apply(d, _id, after, a) { return { createdId: await d.insertBudgetPaymentRecord(parseKey(a.budgetLine, ["rf-budget-line"])!.id, { amount: Number(after.amount), paymentDate: String(after.paymentDate), paymentMethod: str(a.paymentMethod) ?? "", notes: str(a.notes) ?? "" }) }; },
    async verify(d, id, after) { const f = await payFields(d, id); return !!f && f.amount === after.amount; },
    requiredValues: (_a, after) => [ils(Number(after.amount)), String(after.paymentDate)],
    warnings: (c, a) => dupWarnings(c, a),
    disclosuresHe: ["תשלומי Red Films הם דג'ר נפרד — הם לא רשומת כספים של החברה", NO_CUR, "בלי אסמכתא (העלאת קובץ = ערוץ הקבצים)"],
  },
  {
    actionId: "UPDATE_RF_BUDGET_PAYMENT", kinds: ["rf-payment"],
    meta: meta("עדכון תשלום של Red Films", "Edit a Red Films payment (amount / date / method / notes; the receipt is untouched)", [K("payment"), M("amount"), { name: "paymentDate", kind: "ymd", required: false }, T("paymentMethod"), T("notes")], ["amount", "paymentDate", "paymentMethod", "notes"], "updateBudgetPayment (lib/writes/redfilms)", { effects: ["FINANCE"], riskClass: "FINANCIAL" }),
    resolve: onPay, read: payFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.amount !== undefined) { if (typeof a.amount !== "number" || !(a.amount > 0)) return refuse("BAD_MONEY", "סכום לא תקין"); after.amount = a.amount; }
      if (a.paymentDate !== undefined) { if (!realYmd(a.paymentDate)) return refuse("BAD_DATE", "תאריך לא תקין"); after.paymentDate = String(a.paymentDate); }
      for (const k of ["paymentMethod", "notes"] as const) if (a[k] !== undefined) { const t = text(a[k], 500); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.updateBudgetPaymentRecord(id, snake(a)),
    requiredValues: (_a, after) => (after.amount !== undefined ? [ils(Number(after.amount))] : []),
    disclosuresHe: ["דג'ר Red Films בלבד", NO_CUR],
  },
  {
    actionId: "DELETE_RF_BUDGET_PAYMENT", kinds: ["rf-payment"],
    meta: meta("מחיקת תשלום של Red Films", "Delete a Red Films payment", [K("payment")], ["exists"], "deleteBudgetPayment (lib/writes/redfilms)", { effects: ["FINANCE", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { return withExists(await onPay(d, a)); },
    async read(d, id) { const f = await payFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deleteBudgetPaymentRecord(id),
    async verify(d, id) { return (await d.readBudgetPaymentRow(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => (c.hasReceipt ? ["לתשלום יש אסמכתא — קובץ האסמכתא לא נמחק מהאחסון"] : []),
    disclosuresHe: ["התשלום נמחק לצמיתות מהדג'ר של Red Films", "רשומות כספים לא משתנות"],
  },
  {
    actionId: "ADD_CLIP_ROW", kinds: ["clip-row"],
    meta: meta("שורת תכנון קליפ לפרויקט", "Add a clip planning row to a project (planning — not an expense)", [K("project"), E("category", CLIP_ITEM_CATEGORY, true), T("description"), M("amount", true), E("currency", CLIP_CURRENCIES, true), T("notes")], ["category", "amount", "currency"], "createClipItem (lib/writes/redfilms)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "delete the row" }),
    createContext: async (d, a) => { const k = parseKey(a.project, ["project"]); return { projectName: k ? (await d.readProjectMeta(k.id))?.name ?? null : null }; },
    async resolve(d, a) { const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)"); const p = await d.readProjectMeta(k.id); if (!p) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט"); return { key: "clip-row:new", id: "new", label: `תכנון קליפ ${p.name}`, fields: { projectName: p.name } }; },
    read: clipFields,
    plan(a) { if (typeof a.amount !== "number" || a.amount < 0) return refuse("BAD_MONEY", "סכום לא תקין"); return { ok: true, after: { category: String(a.category), amount: a.amount, currency: String(a.currency) } }; },
    async apply(d, _id, after, a) { return { createdId: await d.createClipItemRecord({ projectId: parseKey(a.project, ["project"])!.id, category: after.category, description: str(a.description) ?? "", amount: after.amount, currency: after.currency, notes: str(a.notes) ?? "" }) }; },
    async verify(d, id, after) { const f = await clipFields(d, id); return !!f && f.amount === after.amount && f.currency === after.currency; },
    requiredValues: (_a, after) => [money(Number(after.amount), String(after.currency))],
    disclosuresHe: [PLANNING, "המטבע נשמר כמו שהוא — לא מומר"],
  },
  {
    actionId: "UPDATE_CLIP_ROW", kinds: ["clip-row"],
    meta: meta("עדכון שורת תכנון קליפ", "Edit a clip planning row", [K("clipRow"), E("category", CLIP_ITEM_CATEGORY), T("description"), M("amount"), E("currency", CLIP_CURRENCIES), T("notes")], ["category", "description", "amount", "currency", "notes"], "updateClipItem (lib/writes/redfilms)", { riskClass: "NORMAL_BUSINESS" }),
    resolve: onClip, read: clipFields,
    plan(a, cur) {
      if (cur.promoted) return refuse("PROMOTED", "השורה כבר הועברה לכספים");
      const after: Fields = {};
      for (const k of ["category", "currency"] as const) if (a[k] !== undefined) after[k] = String(a[k]);
      for (const k of ["description", "notes"] as const) if (a[k] !== undefined) { const t = text(a[k], 500); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      if (a.amount !== undefined) { if (typeof a.amount !== "number" || a.amount < 0) return refuse("BAD_MONEY", "סכום לא תקין"); after.amount = a.amount; }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.updateClipItemRecord(id, { ...a }),
    requiredValues: (_a, after) => (after.amount !== undefined ? [String(Number(after.amount).toLocaleString("en-US"))] : []),
    disclosuresHe: [PLANNING],
  },
  {
    actionId: "DELETE_CLIP_ROW", kinds: ["clip-row"],
    meta: meta("מחיקת שורת תכנון קליפ", "Delete a clip planning row", [K("clipRow")], ["exists"], "deleteClipItem (lib/writes/redfilms)", { effects: ["DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { return withExists(await onClip(d, a)); },
    async read(d, id) { const f = await clipFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deleteClipItemRecord(id),
    async verify(d, id) { return (await d.readClipItemRow(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["השורה נמחקת לצמיתות; רשומות כספים לא משתנות"],
  },
  {
    actionId: "PROMOTE_CLIP_ROW", kinds: ["clip-row"],
    meta: meta("'העבר לכספים' — שורת קליפ להוצאה", "Turn a clip planning row into ONE unpaid Finance expense (scope קליפ); the row is KEPT, marked הועבר לכספים and linked to the expense (plan → actual provenance; claimed — never twice)", [K("clipRow"), { name: "date", kind: "ymd", required: true }], ["promoted"], "promoteClipItem (lib/writes/redfilms)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: null }),
    resolve: onClip, read: clipFields,
    plan: (a, cur) => (cur.promoted ? refuse("NO_CHANGE_NEEDED", "כבר הועברה לכספים") : !realYmd(a.date) ? refuse("BAD_DATE", "תאריך לא תקין") : { ok: true, after: { promoted: true } }),
    async apply(d, id, _a, args) { const r = await d.promoteClipItemRecord(id, String(args.date)); if (r !== "ok") throw new Error(`not promoted: ${r}`); return { receipt: "ok" }; },
    async verify(d, id, _after, out) { const r = await d.readClipItemRow(id); return out.receipt === "ok" && !!r && !!r.linked_transaction_id && r.status === "הועבר לכספים"; },
    requiredValues: (a) => [String(a.date)],
    warnings: (c) => [`תיווצר הוצאה 'לא שולם' של ${money(Number(c.amount), String(c.currency))} (שיוך קליפ); שורת התכנון נשארת, מסומנת 'הועבר לכספים' ומקושרת להוצאה`],
    disclosuresHe: ["הוצאה אחת בכספים בסטטוס לא שולם — היא ההוצאה בפועל (שולם רק כשמסמנים שולם)", "שורת התכנון לא נמחקת: היא נשארת כהיסטוריית תכנון ולא נספרת יותר כ'מתוכנן'", "הגנה מכפילות: לחיצה כפולה לא יוצרת שתי הוצאות"],
  },
  // ── the project's clip deal ──
  {
    actionId: "SET_CLIP_PRICE", kinds: ["project"],
    meta: meta("מחיר הקליפ בפרויקט (העסקה עם האמן)", "Set the project's CLIENT clip price (kept apart from the song price; B3: it never changes a Red Films production's planned budget)", [K("project"), M("clipAgreedPrice", true)], ["clipAgreedPrice"], "setClipPrice (lib/writes/clip)", { effects: ["FINANCE", "SETTINGS"], riskClass: "FINANCIAL" }),
    resolve: onDeal, read: dealFields,
    plan: (a, cur) => (typeof a.clipAgreedPrice !== "number" || a.clipAgreedPrice < 0 ? refuse("BAD_MONEY", "מחיר לא תקין") : finishPlan(cur, { clipAgreedPrice: a.clipAgreedPrice })),
    apply: async (d, id, a) => { await d.setClipPrice(id, Number(a.clipAgreedPrice)); },
    requiredValues: (_a, after) => [String(Number(after.clipAgreedPrice).toLocaleString("en-US"))],
    warnings: (c) => [`היום: ${money(Number(c.clipAgreedPrice), String(c.currency))}`],
    disclosuresHe: ["מחיר הקליפ נפרד ממחיר השיר (לא מנפח אותו)", "מחיר הקליפ ללקוח ≠ תקציב ההפקה: תקציב ההפקה ב-Red Films לא משתנה", "תשלומי קליפ קיימים לא משתנים", "לא נשלח כלום"],
  },
  {
    actionId: "OPEN_CLIP_DEAL", kinds: ["project"],
    meta: meta("פתיחת עסקת קליפ (מקדמה + יתרה 50/50)", "Open the clip deal: two expected clip payments (advance today, balance in 30 days — the app's seed); a שיר becomes שיר + קליפ", [K("project"), M("clipAgreedPrice")], ["paymentCount"], "addClipPayments seed (lib/writes/clip)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "delete / cancel the two payments (Finance primitives)" }),
    resolve: onDeal, read: dealFields,
    plan(a, cur) {
      if (Number(cur.paymentCount) > 0) return refuse("NO_CHANGE_NEEDED", "לפרויקט כבר יש תשלומי קליפ");
      const price = a.clipAgreedPrice !== undefined ? Number(a.clipAgreedPrice) : Number(cur.clipAgreedPrice);
      if (!(price > 0)) return refuse("BAD_MONEY", "יש להזין מחיר שסוכם לקליפ");
      return { ok: true, after: { paymentCount: 2 } };
    },
    async apply(d, id, _after, a) { const r = await d.addClipPayments(id, { seed: true, ...(a.clipAgreedPrice !== undefined ? { clipAgreedPrice: a.clipAgreedPrice } : {}) }); if (r !== "ok") throw new Error(`not opened: ${r}`); },
    requiredValues: (a) => (a.clipAgreedPrice !== undefined ? [String(Number(a.clipAgreedPrice).toLocaleString("en-US"))] : ["פתיחת עסקה"]),
    warnings: (c) => [`מחיר הקליפ: ${money(Number(c.clipAgreedPrice), String(c.currency))} → שני תשלומים צפויים (מקדמה היום, יתרה בעוד 30 יום)`],
    disclosuresHe: ["תשלומי קליפ הם הכנסות צפויות (שיוך קליפ) — כסף שהתקבל רק כשמסמנים התקבל", "לחיצה כפולה לא מכפילה (כבר יש תשלומים → לא נוצר כלום)"],
  },
  {
    actionId: "ADD_CLIP_PAYMENT", kinds: ["project"],
    meta: meta("תשלום קליפ נוסף", "Add one clip payment (income with scope קליפ) to the project", [K("project"), M("amount", true), E("paymentStatus", ["התקבל", "שולם", "צפוי", "לא שולם", "בוטל"]), { name: "date", kind: "ymd", required: false }, T("category"), T("description"), T("notes"), ...DUP_ARGS], ["paymentCount"], "addClipPayments (lib/writes/clip)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "delete the payment (Finance primitives)" }),
    async resolve(d, a) { const r = await onDeal(d, a); if (!("key" in r)) return r; return { ...r, fields: { ...r.fields, ...(await clipDup(d, r.id, a, String(r.fields.currency))) } }; },
    async read(d, id, a) { const f = await dealFields(d, id); return f && a ? { ...f, ...(await clipDup(d, id, a, String(f.currency))) } : f; },
    plan(a, cur) {
      if (typeof a.amount !== "number" || !(a.amount > 0)) return refuse("BAD_MONEY", "סכום לא תקין"); if (a.date !== undefined && !realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין");
      const g = dupGate(a, cur, "רשומת תשלום קליפ"); if (g) return g;
      return { ok: true, after: { paymentCount: Number(cur.paymentCount) + 1 } };
    },
    async verify(d, id, after) { const f = await dealFields(d, id); return !!f && f.paymentCount === after.paymentCount; },
    async apply(d, id, _after, a) { const r = await d.addClipPayments(id, { amount: a.amount, paymentStatus: a.paymentStatus ?? "צפוי", date: a.date, category: a.category, description: a.description, notes: a.notes }); if (r !== "ok") throw new Error(`not added: ${r}`); },
    requiredValues: (a) => [String(Number(a.amount).toLocaleString("en-US")), String(a.paymentStatus ?? "צפוי")],
    warnings: (c, a) => [`מטבע הפרויקט: ${c.currency} (לא מומר)`, ...(a ? [`התשלום: ${c.currency}${Number(a.amount).toLocaleString("en-US")} · ${String(a.paymentStatus ?? "צפוי")}${str(a.date) ? ` · ${a.date}` : ""}${str(a.description) ? ` · ${a.description}` : ""}`] : []), ...dupWarnings(c, a)],
    disclosuresHe: ["רשומת הכנסה אחת (שיוך קליפ) במטבע של הפרויקט", "לא נשלח כלום"],
  },
  {
    actionId: "SEND_CLIP_TO_RED_FILMS", kinds: ["project"],
    meta: meta("'שלח קליפ' — הפקה מנוהלת ב-Red Films", "Create (or reuse) the project's Red Films production (created by 'שלח קליפ'): planning budget 0 in the clip deal currency (B3: never the clip price); client source from the project's classification", [K("project")], ["managed"], "sendClipToRedFilms (lib/writes/clip)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "cancel the production" }),
    resolve: onDeal, read: dealFields,
    plan: (_a, cur) => (cur.managed ? refuse("NO_CHANGE_NEEDED", "לפרויקט כבר יש הפקה מנוהלת") : { ok: true, after: { managed: true } }),
    async apply(d, id) { if ((await d.sendClipToRedFilms(id)) !== "ok") throw new Error("project not found"); },
    disclosuresHe: ["נוצרת הפקה 'רעיון' (שם ואמן מהפרויקט, לקוח לפי שם האמן — התאמת טקסט), תקציב תכנון 0 במטבע עסקת הקליפ — מחיר הקליפ הוא לא התקציב", "מקור הלקוח לפי סיווג הפרויקט (לייבל → פנימי - לייבל, לקוח → לקוח חיצוני)", "אם כבר קיימת הפקה מקושרת — היא נשמרת (לא נוצרת שנייה)", "לא נשלח כלום"],
  },
  // ── equipment, documents / references, cancelled-production cleanup ──
  {
    actionId: "ADD_EQUIPMENT", kinds: ["rf-equipment"],
    meta: meta("הוספת ציוד למלאי של Red Films", "Add an equipment item to the company inventory (validation verbatim)", [T("name", true), E("category", RF_EQUIPMENT_CATEGORY, true), { name: "quantity", kind: "number", required: false }, M("purchasePrice"), T("purchasedFrom"), T("serialNumber"), T("notes"), { name: "acquiredDate", kind: "ymd", required: false }], ["name", "category", "quantity"], "createEquipment (lib/writes/redfilms)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "mark it הוסר מהמלאי" }),
    createContext: async (d, a) => ({ sameName: typeof a.name === "string" ? await d.countEquipmentNamed(a.name.trim()) : 0 }),
    async resolve(d, a) { const n = text(a.name, 120); if (n === null) return refuse("BAD_TEXT", "שם הציוד חובה"); return { key: "rf-equipment:new", id: "new", label: n.trim(), fields: { sameName: await d.countEquipmentNamed(n.trim()) } }; },
    read: equipFields,
    plan(a) { const n = text(a.name, 120); if (n === null) return refuse("BAD_TEXT", "שם הציוד חובה"); const q = Number(a.quantity ?? 1); if (!(q > 0)) return refuse("BAD_NUMBER", "כמות > 0"); if (a.acquiredDate !== undefined && !realYmd(a.acquiredDate)) return refuse("BAD_DATE", "תאריך לא תקין"); return { ok: true, after: { name: n.trim(), category: String(a.category), quantity: q } }; },
    async apply(d, _id, after, a) { return { createdId: await d.createEquipmentRecord({ name: after.name, category: after.category, quantity: after.quantity, purchase_price: a.purchasePrice ?? null, purchased_from: a.purchasedFrom, serial_number: a.serialNumber, notes: a.notes, acquired_date: a.acquiredDate }) }; },
    async verify(d, id, after) { const f = await equipFields(d, id); return !!f && f.name === after.name; },
    warnings: (c) => (Number(c.sameName) > 0 ? [`כבר יש במלאי פריט בשם הזה (${c.sameName})`] : []),
    disclosuresHe: ["מלאי החברה (לא לפי הפקה)", NO_CUR, "לא נוצרת רשומה כספית"],
  },
  {
    actionId: "UPDATE_EQUIPMENT", kinds: ["rf-equipment"],
    meta: meta("עדכון ציוד / הסרה מהמלאי / החזרה", "Update an equipment item, or mark it removed from / back in the inventory (never a physical delete — the app's rule)", [K("equipment"), T("name"), E("category", RF_EQUIPMENT_CATEGORY), { name: "quantity", kind: "number", required: false }, M("purchasePrice"), T("purchasedFrom"), T("serialNumber"), T("notes"), E("status", ["קיים", "הוסר מהמלאי"])], ["name", "category", "quantity", "purchasePrice", "purchasedFrom", "serialNumber", "notes", "status"], "updateEquipment (lib/writes/redfilms)", {}),
    async resolve(d, a) { const k = parseKey(a.equipment, ["rf-equipment"]); if (!k) return refuse("BAD_ENTITY", "צריך פריט ציוד (rf-equipment:…)"); const f = await equipFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפריט"); return { key: `rf-equipment:${k.id}`, id: k.id, label: String(f.name), fields: f }; },
    read: equipFields,
    plan(a, cur) {
      const after: Fields = {};
      for (const k of ["name", "purchasedFrom", "serialNumber", "notes"] as const) if (a[k] !== undefined) { const t = text(a[k], 300); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      for (const k of ["category", "status"] as const) if (a[k] !== undefined) after[k] = String(a[k]);
      if (a.quantity !== undefined) { if (!(Number(a.quantity) > 0)) return refuse("BAD_NUMBER", "כמות > 0"); after.quantity = Number(a.quantity); }
      if (a.purchasePrice !== undefined) { if (typeof a.purchasePrice !== "number" || a.purchasePrice < 0) return refuse("BAD_MONEY", "מחיר לא תקין"); after.purchasePrice = a.purchasePrice; }
      return finishPlan(cur, after);
    },
    async apply(d, id, a) { const r = await d.updateEquipmentRecord(id, snake(a)); if (r !== "ok") throw new Error(`not updated: ${r}`); },
    requiredValues: (_a, after) => (after.status !== undefined ? [String(after.status)] : []),
    disclosuresHe: ["'הוסר מהמלאי' לא מוחק — הפריט נשמר עם תאריך הסרה (אין מחיקה פיזית באפליקציה)"],
  },
  {
    actionId: "DELETE_RF_DOCUMENT", kinds: ["rf-document"],
    meta: meta("מחיקת מסמך של הפקה", "Delete a production document (its stored file, then the row)", [K("document")], ["exists"], "deleteRfDocument (lib/writes/redfilms)", { effects: ["FILES", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const k = parseKey(a.document, ["rf-document"]); if (!k) return refuse("BAD_ENTITY", "צריך מסמך (rf-document:…)"); const r = await d.readDocumentRow(k.id); if (!r) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את המסמך"); return { key: `rf-document:${k.id}`, id: k.id, label: String(r.file_name ?? r.title ?? "מסמך"), fields: { exists: true } }; },
    async read(d, id) { return (await d.readDocumentRow(id)) ? { exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { if ((await d.deleteRfDocumentRecord(id)) !== "ok") throw new Error("document not found"); },
    async verify(d, id) { return (await d.readDocumentRow(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["המסמך נמחק לצמיתות, והקובץ שלו מהאחסון (לפי הנתיב השמור ברשומה)"],
  },
  {
    actionId: "SET_RF_REFERENCE_TAG", kinds: ["rf-reference"],
    meta: meta("תגית לתמונת רפרנס", "Set a reference image's tag (blank → כללי)", [K("reference"), T("tag", true)], ["tag"], "setRfReferenceTag (lib/writes/redfilms)", {}),
    async resolve(d, a) { const k = parseKey(a.reference, ["rf-reference"]); if (!k) return refuse("BAD_ENTITY", "צריך רפרנס (rf-reference:…)"); const r = await d.readReferenceRow(k.id); if (!r) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הרפרנס"); return { key: `rf-reference:${k.id}`, id: k.id, label: String(r.file_name ?? "רפרנס"), fields: { tag: String(r.tag ?? "") } }; },
    async read(d, id) { const r = await d.readReferenceRow(id); return r ? { tag: String(r.tag ?? "") } : null; },
    plan: (a, cur) => { const t = text(a.tag, 60); return t === null ? refuse("BAD_TEXT", "תגית חסרה") : finishPlan(cur, { tag: t.trim() }); },
    apply: async (d, id, a) => { await d.setRfReferenceTagRecord(id, String(a.tag)); },
    disclosuresHe: ["רק התגית משתנה"],
  },
  {
    actionId: "DELETE_RF_REFERENCE", kinds: ["rf-reference"],
    meta: meta("מחיקת תמונת רפרנס", "Delete a reference image (its stored file, then the row)", [K("reference")], ["exists"], "deleteRfReference (lib/writes/redfilms)", { effects: ["FILES", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const k = parseKey(a.reference, ["rf-reference"]); if (!k) return refuse("BAD_ENTITY", "צריך רפרנס (rf-reference:…)"); const r = await d.readReferenceRow(k.id); if (!r) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הרפרנס"); return { key: `rf-reference:${k.id}`, id: k.id, label: String(r.file_name ?? "רפרנס"), fields: { exists: true } }; },
    async read(d, id) { return (await d.readReferenceRow(id)) ? { exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { if ((await d.deleteRfReferenceRecord(id)) !== "ok") throw new Error("reference not found"); },
    async verify(d, id) { return (await d.readReferenceRow(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["הרפרנס נמחק לצמיתות, והקובץ שלו מהאחסון"],
  },
  {
    actionId: "DELETE_CANCELLED_PRODUCTIONS", kinds: ["system"],
    meta: meta("מחיקה לצמיתות של הפקות מבוטלות", "Permanently delete CANCELLED productions (bulk). Read-only preflight first: any Red Films payment refuses (HAS_PAYMENTS — real money is never deleted). Then reference images, documents, reference links, scenes, crew, budget lines, tasks, the clip markers that point at them (compare-and-swap) and the productions — every step checked, verified by a re-read; stored files + Google Tasks last, failures reported", [T("productions", true)], ["remaining"], "deleteCancelledProductions (lib/writes/redfilms, redFilmsDeletePreflight first)", { effects: ["FILES", "GOOGLE_TASKS", "DELETION", "SETTINGS"], riskClass: "BULK", reversible: "NO", compensation: null }),
    async resolve(d, a) {
      const ids = bulkIds(a.productions); if (!ids) return refuse("BAD_ENTITY", "רשימת הפקות: rf-production:…, rf-production:… (עד 50)");
      const found = await d.productionsByIds(ids);
      if (found.length !== ids.length) return refuse("ENTITY_NOT_FOUND", "חלק מההפקות לא נמצאו");
      const pre = await d.rfDeletePreflight(ids);
      if (pre.payments > 0) return refuse("HAS_PAYMENTS", `ל-${pre.productionsWithPayments.length} מההפקות יש ${pre.payments} תשלומי Red Films (${curText(pre.paymentsByCurrency)}) — כסף אמיתי לא נמחק. מחיקה לצמיתות נדחית`);
      return { key: "system:rf-cancelled", id: "rf-cancelled", label: `${ids.length} הפקות מבוטלות`, fields: { ...bulkFields(found), ...rfDeleteFields(pre) } };
    },
    async read(d, _id, a) { const ids = bulkIds(a?.productions) ?? []; return { ...bulkFields(await d.productionsByIds(ids)), ...rfDeleteFields(await d.rfDeletePreflight(ids)) }; },
    plan(_a, cur) {
      if (Number(cur.notCancelled) > 0) return refuse("NOT_CANCELLED", `${cur.notCancelled} מההפקות לא מבוטלות — מוחקים לצמיתות רק הפקות מבוטלות`);
      if (Number(cur.payments) > 0) return refuse("HAS_PAYMENTS", `יש תשלומי Red Films (${cur.paymentsText}) — כסף אמיתי לא נמחק`);
      return { ok: true, after: { remaining: 0 } };
    },
    async apply(d, _id, _after, a) {
      const ids = bulkIds(a.productions) ?? [];
      const r = await d.deleteCancelledProductionsRecord(ids); if (r.kind !== "ok") throw new Error(`not deleted: ${r.code ? `${r.code} ` : ""}${r.error ?? ""}`);
      // verify inside the step (the verifier has no args): re-read by the exact ids — none may remain
      const left = await d.productionsByIds(ids); if (left.length) throw new Error(`${left.length} productions still exist after the delete`);
      return { receipt: r.deleted ?? 0 };
    },
    async verify(_d, _id, _after, out) { return typeof out.receipt === "number" && out.receipt > 0; },
    requiredValues: (a) => [String((bulkIds(a.productions) ?? []).length), "מחיקה"],
    warnings: (c) => [
      `יימחקו לצמיתות: ${c.titles}`,
      `לכל ההפקות יחד נמחקים: ${c.referenceImages} תמונות רפרנס, ${c.documents} מסמכים (${c.storageFiles} קבצים באחסון), ${c.referenceLinks} קישורי רפרנס, ${c.scenes} סצנות, ${c.crew} אנשי צוות, ${c.budgetLines} שורות תקציב, ${c.tasks} משימות (${c.googleTasks} ב-Google Tasks)`,
      ...(Number(c.budgetLinesWithTransaction) > 0 ? [`${c.budgetLinesWithTransaction} שורות תקציב מקושרות לרשומה בכספים — הרשומה בכספים נשארת (לא נמחקת)`] : []),
      ...(Number(c.clipMarkers) > 0 ? [`${c.clipMarkers} סימוני 'הפקת הקליפ של הפרויקט' מתנקים (רק אם הם עדיין מצביעים על ההפקה)`] : []),
      ...(Number(c.foldersKept) > 0 ? [`${c.foldersKept} תיקיות הפקה באחסון נשארות`] : []),
    ],
    disclosuresHe: ["רק הפקות בסטטוס 'בוטל'; הפקה עם תשלומי Red Films לא נמחקת (כסף אמיתי)", "קודם כל השורות במסד הנתונים (כל שלב נבדק; כשל עוצר לפני מחיקת ההפקות), אחר כך קבצים ו-Google Tasks — כשל שם מדווח", "לא נשלח כלום"],
  },
];
