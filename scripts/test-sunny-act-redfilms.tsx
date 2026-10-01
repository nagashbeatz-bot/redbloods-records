/**
 * Universal Action Layer — Red Films + clip family: every primitive through the REAL service on fakes (6 standard checks
 * each) + family rules (B3: no managed-budget lock, price ≠ budget, planning ≠ spend, promote keeps the linked row and never twice, clip deal seeded once, cancel via
 * its own action, D7 unchanged), pinned vocabularies, shared writers + hardening in the routes.
 * Run with:   npx tsx scripts/test-sunny-act-redfilms.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { RF_PRIMITIVES, RF_STATUSES, RF_TYPES, RF_BUDGET_CATEGORY, CLIP_ITEM_CATEGORY, RF_EQUIPMENT_CATEGORY } from "../lib/partner/act/primitives/redfilms";
import { RF_VOCABULARIES } from "../lib/partner/system/red-films";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Row = Record<string, unknown>;
interface W { txs: Record<string, Row>; finDup: Record<string, Array<{ level: "LIKELY_SAME" | "SIMILAR"; date: string | null; amount: number; currency: string | null; text: string; daysApart: number | null }>>; folders: Set<string>; prods: Record<string, Row>; managed: Set<string>; lines: Record<string, Row>; pays: Record<string, Row>; clips: Record<string, Row>; deals: Record<string, { managedProductionId: string | null }>; expenses: number; projects: Record<string, string>; equip: Record<string, Row>; docs: Record<string, Row>; refs: Record<string, Row> }
const world = (): W => ({
  txs: {}, finDup: {},
  folders: new Set<string>(),
  prods: { [U(3)]: { id: U(3), title: "הפקה ישנה", status: "בוטל" }, [U(1)]: { id: U(1), title: "קליפ שליו", status: "בתכנון", production_type: "קליפ", project_id: U(40), general_budget: 8000, client_price: 0, advance_required: 0, advance_received: 0, collection_status: "לא רלוונטי", edit_status: "לא התחיל" }, [U(2)]: { id: U(2), title: "צילום הופעה", status: "רעיון", production_type: "צילום הופעה", project_id: null, general_budget: 3000 }, [U(4)]: { id: U(4), title: "קליפ בלי פרויקט", status: "רעיון", production_type: "קליפ", project_id: null }, [U(5)]: { id: U(5), title: "יום צילום", status: "רעיון", production_type: "יום צילום", project_id: U(40) } },
  managed: new Set([U(1)]),
  lines: { [U(10)]: { id: U(10), production_id: U(2), title: "צלם", category: "צלם", planned_amount: 1500, actual_amount: 0, vendor_name: "", status: "מתוכנן", notes: "" }, [U(11)]: { id: U(11), production_id: U(1), title: "צלם קליפ", category: "צלם", planned_amount: 3000, status: "מתוכנן" }, [U(12)]: { id: U(12), production_id: U(4), title: "ציוד", category: "ציוד", planned_amount: 500, status: "מתוכנן" }, [U(13)]: { id: U(13), production_id: U(5), title: "לוקיישן", category: "לוקיישן", planned_amount: 500, status: "מתוכנן" } },
  pays: { [U(20)]: { id: U(20), amount: 500, payment_date: "2026-09-01", payment_method: "ביט", notes: "", receipt_dropbox_path: "" },
    // DB-1: two unlinked payments of the clip production U(1) (project U(40)); one of the non-clip U(2); one of the project-less clip U(4)
    [U(21)]: { id: U(21), production_id: U(1), budget_item_id: U(11), amount: 1000, currency: "₪", payment_date: "2026-09-10", payment_method: "העברה בנקאית", linked_transaction_id: null },
    [U(22)]: { id: U(22), production_id: U(1), budget_item_id: U(11), amount: 700, currency: "₪", payment_date: "2026-09-12", payment_method: "ביט", linked_transaction_id: null },
    [U(23)]: { id: U(23), production_id: U(5), budget_item_id: U(13), amount: 300, currency: "₪", payment_date: "2026-09-05", payment_method: "", linked_transaction_id: null },
    [U(24)]: { id: U(24), production_id: U(4), budget_item_id: U(12), amount: 200, currency: "₪", payment_date: "2026-09-06", payment_method: "", linked_transaction_id: null } },
  clips: { [U(30)]: { id: U(30), project_id: U(40), category: "לוקיישן", description: "גג", amount: 1200, currency: "₪", status: "תכנון בלבד", notes: "", linked_transaction_id: null } },
  deals: { [U(40)]: { managedProductionId: U(1) }, [U(41)]: { managedProductionId: null } },
  expenses: 0, projects: { [U(40)]: "קרוב אלייך", [U(41)]: "סינגל" },
  equip: { [U(50)]: { id: U(50), name: "Sony FX3", category: "מצלמות", quantity: 1, purchase_price: 15000, purchased_from: "", serial_number: "", notes: "", status: "קיים" } },
  docs: { [U(60)]: { id: U(60), file_name: "תסריט.pdf" } }, refs: { [U(70)]: { id: U(70), file_name: "ref.jpg", tag: "כללי" } },
});
/** The fake of lib/writes/rf-finance-link readRfLinkPlan → view (the real writer is proven on a fake database in test-rf-finance-link.tsx). */
function linkView(w: W, id: string) {
  const p = w.pays[id]; if (!p) return null;
  const prod = w.prods[String(p.production_id)] ?? {}; const line = w.lines[String(p.budget_item_id)] ?? {};
  const linked = (p.linked_transaction_id as string | null) ?? null;
  const state = linked ? "ALREADY_LINKED" as const : prod.production_type !== "קליפ" ? "SCOPE_REQUIRED" as const : !prod.project_id ? "PROJECT_REQUIRED" as const : "READY" as const;
  const tx = linked ? w.txs[linked] : null;
  return { state, paymentId: id, productionId: String(p.production_id), productionTitle: String(prod.title ?? ""), productionType: (prod.production_type as string) ?? null, projectId: (prod.project_id as string) ?? null, lineTitle: String(line.title ?? ""), amount: Number(p.amount), currency: String(p.currency ?? "₪"), date: (p.payment_date as string) ?? null, method: String(p.payment_method ?? ""),
    category: state === "READY" ? (line.category === "ציוד" ? "ציוד" : "") : null, description: state === "READY" ? `Red Films — ${prod.title} — ${line.title}` : null,
    transactionId: linked, tx: tx ? { amount: Number(tx.amount), currency: String(tx.currency), status: String(tx.payment_status), expenseScope: String(tx.expense_scope), projectId: (tx.project_id as string) ?? null } : null,
    candidates: state === "READY" ? w.finDup[id] ?? [] : [], reasonHe: state === "SCOPE_REQUIRED" ? "הפקה מסוג אחר — אין שיוך קנוני" : state === "PROJECT_REQUIRED" ? "הפקת קליפ בלי פרויקט" : null };
}
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const writers = {
    async rfPaymentLinkPlan(id: string) { return linkView(w, id); },
    async rfProductionLinkPlans(pid: string) { if (!w.prods[pid]) return null; return Object.values(w.pays).filter((p) => p.production_id === pid).sort((a, b) => String(a.payment_date).localeCompare(String(b.payment_date))).map((p) => linkView(w, String(p.id))!); },
    async linkRfPaymentRecord(id: string, allowDuplicate: boolean) {
      calls.push(`linkRfPaymentRecord${allowDuplicate ? "(allowDuplicate)" : ""}`); const v = linkView(w, id); if (!v) return { kind: "NOT_FOUND" };
      if (v.state !== "READY") return { kind: v.state, ...(v.transactionId ? { transactionId: v.transactionId } : {}) };
      if (!allowDuplicate && v.candidates.some((c) => c.level === "LIKELY_SAME")) return { kind: "POSSIBLE_DUPLICATE" };
      const tx = `tx-${Object.keys(w.txs).length + 1}`; w.txs[tx] = { id: tx, type: "expense", amount: v.amount, currency: v.currency, payment_status: "שולם", expense_scope: "קליפ", project_id: v.projectId, date: v.date, description: v.description };
      w.pays[id].linked_transaction_id = tx; return { kind: "LINKED", transactionId: tx };
    },
    async similarRecords() { return []; }, // duplicate awareness is proven in test-sunny-polish-1.tsx
    async productionFolderState(id: string) { return w.prods[id] ? { hasFolder: w.folders.has(id) } : null; },
    async createProductionFolder(id: string) { calls.push("createProductionFolder"); w.folders.add(id); },
    async readProjectMeta(id: string) { return w.projects[id] ? { name: w.projects[id], artist: "", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
    async readProductionRow(id: string) { return w.prods[id] ? { ...w.prods[id] } : null; },
    async countProductionsTitled(t: string) { return Object.values(w.prods).filter((p) => p.title === t).length; },
    async isManagedProduction(id: string) { return w.managed.has(id); },
    async createProductionRecord(b: Row) { calls.push("createProductionRecord"); const id = U(++n); w.prods[id] = { id, ...b, status: "רעיון" }; return id; },
    async updateProductionRecord(id: string, b: Row) { calls.push("updateProductionRecord"); if (!w.prods[id]) return "not_found" as const; Object.assign(w.prods[id], b); return "ok" as const; },
    async readBudgetLineRow(id: string) { return w.lines[id] ? { ...w.lines[id] } : null; },
    async countBudgetLinePayments(id: string) { return Object.values(w.pays).filter((p) => p.budget_item_id === id).length; },
    async createBudgetLineRecord(pid: string, b: Row) { calls.push("createBudgetLineRecord"); const id = U(++n); w.lines[id] = { id, production_id: pid, ...b }; return id; },
    async updateBudgetLineRecord(id: string, b: Row) { calls.push("updateBudgetLineRecord"); Object.assign(w.lines[id], b); },
    async deleteBudgetLineRecord(id: string) { calls.push("deleteBudgetLineRecord"); delete w.lines[id]; },
    async readBudgetPaymentRow(id: string) { return w.pays[id] ? { ...w.pays[id] } : null; },
    async insertBudgetPaymentRecord(_i: string, p: { amount: number; paymentDate: string }) { calls.push("insertBudgetPaymentRecord"); const id = U(++n); w.pays[id] = { id, amount: p.amount, payment_date: p.paymentDate }; return id; },
    async updateBudgetPaymentRecord(id: string, b: Row) { calls.push("updateBudgetPaymentRecord"); Object.assign(w.pays[id], b); },
    async deleteBudgetPaymentRecord(id: string) { calls.push("deleteBudgetPaymentRecord"); delete w.pays[id]; },
    async readClipItemRow(id: string) { return w.clips[id] ? { ...w.clips[id] } : null; },
    async createClipItemRecord(b: Row) { calls.push("createClipItemRecord"); const id = U(++n); w.clips[id] = { id, project_id: b.projectId, ...b, status: "תכנון בלבד", linked_transaction_id: null }; return id; },
    async updateClipItemRecord(id: string, b: Row) { calls.push("updateClipItemRecord"); Object.assign(w.clips[id], b); },
    async deleteClipItemRecord(id: string) { calls.push("deleteClipItemRecord"); delete w.clips[id]; },
    // B3: the planning row is kept, marked הועבר לכספים and linked to the new expense
    async promoteClipItemRecord(id: string) { calls.push("promoteClipItemRecord"); if (!w.clips[id]) return "not_found" as const; w.expenses++; w.clips[id].linked_transaction_id = `tx-${w.expenses}`; w.clips[id].status = "הועבר לכספים"; return "ok" as const; },
    async readEquipmentRow(id: string) { return w.equip[id] ? { ...w.equip[id] } : null; },
    async countEquipmentNamed(nm: string) { return Object.values(w.equip).filter((e) => e.name === nm).length; },
    async createEquipmentRecord(b: Row) { calls.push("createEquipmentRecord"); const id = U(++n); w.equip[id] = { id, ...b, status: "קיים" }; return id; },
    async updateEquipmentRecord(id: string, b: Row) { calls.push("updateEquipmentRecord"); Object.assign(w.equip[id], b); return "ok" as const; },
    async readDocumentRow(id: string) { return w.docs[id] ? { ...w.docs[id] } : null; },
    async deleteRfDocumentRecord(id: string) { calls.push("deleteRfDocumentRecord"); delete w.docs[id]; return "ok" as const; },
    async readReferenceRow(id: string) { return w.refs[id] ? { ...w.refs[id] } : null; },
    async setRfReferenceTagRecord(id: string, tag: string) { calls.push("setRfReferenceTagRecord"); w.refs[id].tag = tag; },
    async deleteRfReferenceRecord(id: string) { calls.push("deleteRfReferenceRecord"); delete w.refs[id]; return "ok" as const; },
    async productionsByIds(ids: string[]) { return ids.filter((i) => w.prods[i]).map((i) => ({ id: i, title: String(w.prods[i].title), status: String(w.prods[i].status) })); },
    async deleteCancelledProductionsRecord(ids: string[]) { calls.push("deleteCancelledProductionsRecord"); for (const i of ids) delete w.prods[i]; return { kind: "ok" as const, deleted: ids.length }; },
    async rfDeletePreflight(ids: string[]) { const ps = Object.values(w.pays).filter((p) => ids.includes(String(p.production_id))); const byCur: Record<string, number> = {}; for (const p of ps) byCur[String(p.currency ?? "₪")] = (byCur[String(p.currency ?? "₪")] ?? 0) + Number(p.amount); return { payments: ps.length, paymentsByCurrency: byCur, productionsWithPayments: [...new Set(ps.map((p) => String(p.production_id)))], budgetLines: 0, budgetLinesWithTransaction: 0, documents: Object.values(w.docs).filter((d) => ids.includes(String(d.production_id))).length, referenceImages: 0, referenceLinks: 0, scenes: 0, crew: 0, tasks: 0, googleTasks: 0, storageFiles: 0, foldersKept: 0, clipMarkers: 0 }; },
    async managedClipProductionOf(pid: string) { return w.deals[pid]?.managedProductionId ?? null; },
    async sendClipToRedFilms(pid: string) { calls.push("sendClipToRedFilms"); w.deals[pid].managedProductionId = "new-prod"; return "ok" as const; },
  };
  return { w, calls, writers };
}
const P1 = `rf-production:${U(1)}`, P2 = `rf-production:${U(2)}`, L10 = `rf-budget-line:${U(10)}`, Y20 = `rf-payment:${U(20)}`, C30 = `clip-row:${U(30)}`, J40 = `project:${U(40)}`, J41 = `project:${U(41)}`;
const CASES: FamilyCase<W>[] = [
  { id: "SET_RF_CURRENCY", args: { target: L10, currency: "$" }, confirm: "כן בוס, $", bad: { target: L10, currency: "GBP" }, missing: { target: `rf-budget-line:${U(9)}`, currency: "$" }, wrongKind: { target: J40, currency: "$" }, stale: (w) => { w.lines[U(10)].currency = "€"; }, check: (w) => w.lines[U(10)].currency === "$" },
  { id: "CREATE_PRODUCTION_FOLDER", args: { production: P2 }, confirm: "כן בוס, קישור ציבורי", bad: { production: "rf-production:1" }, missing: { production: `rf-production:${U(9)}` }, wrongKind: { production: `project:${U(1)}` }, stale: (w) => { w.folders.add(U(2)); }, check: (w) => w.folders.has(U(2)) },
  { id: "CREATE_PRODUCTION", args: { title: "ויזואלייזר", productionType: "ויזואלייזר" }, bad: { title: "" }, stale: (w) => { w.prods[U(77)] = { id: U(77), title: "ויזואלייזר", status: "רעיון" }; }, check: (w) => Object.values(w.prods).some((p) => p.title === "ויזואלייזר" && p.status === "רעיון") },
  { id: "UPDATE_PRODUCTION_DETAILS", args: { production: P2, status: "יום צילום נקבע", shootDate: "2026-10-12", directorName: "דני" }, confirm: "כן בוס, יום צילום נקבע 2026-10-12", bad: { production: P2, status: "בוטל" }, missing: { production: `rf-production:${U(9)}`, notes: "x" }, wrongKind: { production: J40, notes: "x" }, stale: (w) => { w.prods[U(2)].status = "בתכנון"; }, check: (w) => w.prods[U(2)].status === "יום צילום נקבע" && w.prods[U(2)].shoot_date === "2026-10-12" && w.prods[U(2)].director_name === "דני" },
  { id: "SET_PRODUCTION_MONEY", args: { production: P2, clientPrice: 5000, collectionStatus: "צפוי" }, confirm: "כן בוס, ₪5,000 צפוי", bad: { production: P2, clientPrice: -1 }, missing: { production: `rf-production:${U(9)}`, clientPrice: 1 }, stale: (w) => { w.prods[U(2)].client_price = 4000; }, check: (w) => w.prods[U(2)].client_price === 5000 && w.prods[U(2)].collection_status === "צפוי" },
  { id: "CANCEL_PRODUCTION", args: { production: P2 }, confirm: "כן בוס, ביטול", bad: { production: "rf-production:1" }, missing: { production: `rf-production:${U(9)}` }, stale: (w) => { w.prods[U(2)].status = "צולם"; }, check: (w) => w.prods[U(2)].status === "בוטל" },
  { id: "ADD_RF_BUDGET_LINE", args: { production: P2, title: "תאורה", category: "ציוד", plannedAmount: 900 }, confirm: "כן בוס, ₪900", bad: { production: P2, title: "", plannedAmount: 1 }, missing: { production: `rf-production:${U(9)}`, title: "x" }, stale: (w) => { w.prods[U(2)].title = "שונה"; }, check: (w) => Object.values(w.lines).some((l) => l.title === "תאורה" && l.planned_amount === 900) },
  { id: "UPDATE_RF_BUDGET_LINE", args: { budgetLine: L10, actualAmount: 1400, status: "שולם" }, confirm: "כן בוס, ₪1,400", bad: { budgetLine: L10, actualAmount: -1 }, missing: { budgetLine: `rf-budget-line:${U(9)}`, notes: "x" }, stale: (w) => { w.lines[U(10)].notes = "q"; }, check: (w) => w.lines[U(10)].actual_amount === 1400 && w.lines[U(10)].status === "שולם" },
  { id: "DELETE_RF_BUDGET_LINE", args: { budgetLine: L10 }, confirm: "כן בוס, מחיקה", bad: { budgetLine: "x" }, missing: { budgetLine: `rf-budget-line:${U(9)}` }, stale: (w) => { w.lines[U(10)].planned_amount = 1; }, check: (w) => !w.lines[U(10)] },
  { id: "RECORD_RF_BUDGET_PAYMENT", args: { budgetLine: L10, amount: 700, paymentDate: "2026-09-25" }, confirm: "כן בוס, ₪700 2026-09-25", bad: { budgetLine: L10, amount: 0, paymentDate: "2026-09-25" }, missing: { budgetLine: `rf-budget-line:${U(9)}`, amount: 1, paymentDate: "2026-09-25" }, stale: (w) => { w.lines[U(10)].title = "אחר"; }, check: (w) => Object.values(w.pays).some((p) => p.amount === 700) },
  { id: "UPDATE_RF_BUDGET_PAYMENT", args: { payment: Y20, amount: 550 }, confirm: "כן בוס, ₪550", bad: { payment: Y20, paymentDate: "1/9" }, missing: { payment: `rf-payment:${U(9)}`, amount: 1 }, stale: (w) => { w.pays[U(20)].notes = "q"; }, check: (w) => w.pays[U(20)].amount === 550 },
  { id: "DELETE_RF_BUDGET_PAYMENT", args: { payment: Y20 }, confirm: "כן בוס, מחיקה", bad: { payment: "x" }, missing: { payment: `rf-payment:${U(9)}` }, stale: (w) => { w.pays[U(20)].amount = 1; }, check: (w) => !w.pays[U(20)] },
  { id: "ADD_CLIP_ROW", args: { project: J40, category: "תאורה", amount: 600, currency: "₪" }, confirm: "כן בוס, ₪600", bad: { project: J40, category: "תאורה", amount: -2, currency: "₪" }, missing: { project: `project:${U(99)}`, category: "תאורה", amount: 1, currency: "₪" }, stale: (w) => { w.projects[U(40)] = "שם אחר"; }, check: (w) => Object.values(w.clips).some((c) => c.category === "תאורה" && c.amount === 600) },
  { id: "UPDATE_CLIP_ROW", args: { clipRow: C30, amount: 1300 }, confirm: "כן בוס, 1,300", bad: { clipRow: C30, amount: -1 }, missing: { clipRow: `clip-row:${U(9)}`, notes: "x" }, stale: (w) => { w.clips[U(30)].notes = "q"; }, check: (w) => w.clips[U(30)].amount === 1300 && w.clips[U(30)].currency === "₪" },
  { id: "DELETE_CLIP_ROW", args: { clipRow: C30 }, confirm: "כן בוס, מחיקה", bad: { clipRow: "x" }, missing: { clipRow: `clip-row:${U(9)}` }, stale: (w) => { w.clips[U(30)].amount = 1; }, check: (w) => !w.clips[U(30)] },
  { id: "PROMOTE_CLIP_ROW", args: { clipRow: C30, date: "2026-09-26" }, confirm: "כן בוס, 2026-09-26", bad: { clipRow: C30, date: "מחר" }, missing: { clipRow: `clip-row:${U(9)}`, date: "2026-09-26" }, stale: (w) => { w.clips[U(30)].amount = 999; }, check: (w) => !!w.clips[U(30)] && !!w.clips[U(30)].linked_transaction_id && w.clips[U(30)].status === "הועבר לכספים" && w.expenses === 1 },
  { id: "SEND_CLIP_TO_RED_FILMS", args: { project: J41 }, bad: { project: J40 }, missing: { project: `project:${U(99)}` }, stale: (w) => { w.deals[U(41)].managedProductionId = "other-prod"; }, check: (w) => w.deals[U(41)].managedProductionId === "new-prod" },
  { id: "ADD_EQUIPMENT", args: { name: "Aputure 300d", category: "תאורה", quantity: 2 }, bad: { name: "x", category: "תאורה", quantity: 0 }, stale: (w) => { w.equip[U(77)] = { id: U(77), name: "Aputure 300d" }; }, check: (w) => Object.values(w.equip).some((e) => e.name === "Aputure 300d" && e.quantity === 2) },
  { id: "UPDATE_EQUIPMENT", args: { equipment: `rf-equipment:${U(50)}`, status: "הוסר מהמלאי" }, confirm: "כן בוס, הוסר מהמלאי", bad: { equipment: `rf-equipment:${U(50)}`, quantity: 0 }, missing: { equipment: `rf-equipment:${U(9)}`, notes: "x" }, stale: (w) => { w.equip[U(50)].notes = "q"; }, check: (w) => w.equip[U(50)].status === "הוסר מהמלאי" },
  { id: "DELETE_RF_DOCUMENT", args: { document: `rf-document:${U(60)}` }, confirm: "כן בוס, מחיקה", bad: { document: "x" }, missing: { document: `rf-document:${U(9)}` }, stale: (w) => { delete w.docs[U(60)]; w.docs[U(61)] = {}; }, check: (w) => !w.docs[U(60)] },
  { id: "SET_RF_REFERENCE_TAG", args: { reference: `rf-reference:${U(70)}`, tag: "תאורה" }, bad: { reference: `rf-reference:${U(70)}`, tag: "" }, missing: { reference: `rf-reference:${U(9)}`, tag: "x" }, stale: (w) => { w.refs[U(70)].tag = "לוקיישן"; }, check: (w) => w.refs[U(70)].tag === "תאורה" },
  { id: "DELETE_RF_REFERENCE", args: { reference: `rf-reference:${U(70)}` }, confirm: "כן בוס, מחיקה", bad: { reference: "x" }, missing: { reference: `rf-reference:${U(9)}` }, stale: (w) => { delete w.refs[U(70)]; }, check: (w) => !w.refs[U(70)] },
  { id: "LINK_RF_PAYMENT_TO_FINANCE", args: { rfPayment: `rf-payment:${U(21)}` }, bad: { rfPayment: "x" }, missing: { rfPayment: `rf-payment:${U(9)}` }, wrongKind: { rfPayment: P1 }, stale: (w) => { w.pays[U(21)].amount = 999; }, check: (w) => { const t = w.txs[String(w.pays[U(21)].linked_transaction_id)]; return !!t && Object.keys(w.txs).length === 1 && t.amount === 1000 && t.currency === "₪" && t.payment_status === "שולם" && t.expense_scope === "קליפ" && t.project_id === U(40) && !w.pays[U(22)].linked_transaction_id; } },
  { id: "LINK_RF_PAYMENTS_FOR_PRODUCTION", args: { production: P1 }, bad: { production: "rf-production:1" }, missing: { production: `rf-production:${U(9)}` }, wrongKind: { production: J40 }, stale: (w) => { w.pays[U(25)] = { id: U(25), production_id: U(1), budget_item_id: U(11), amount: 50, currency: "₪", payment_date: "2026-09-20", linked_transaction_id: null }; }, check: (w) => Object.keys(w.txs).length === 2 && !!w.pays[U(21)].linked_transaction_id && !!w.pays[U(22)].linked_transaction_id && w.pays[U(21)].linked_transaction_id !== w.pays[U(22)].linked_transaction_id },
  { id: "DELETE_CANCELLED_PRODUCTIONS", args: { productions: `rf-production:${U(3)}` }, confirm: "כן בוס, 1 מחיקה", bad: { productions: "nope" }, missing: { productions: `rf-production:${U(9)}` }, stale: (w) => { w.prods[U(3)].title = "שונה"; }, check: (w) => !w.prods[U(3)] },
];

(async () => {
  console.log("Red Films family — standard checks");
  ok("the case table covers every Red Films primitive", CASES.map((c) => c.id).sort().join() === RF_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nRed Films rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  // B3 (Owner canon 2026-09-27): no budget lock — a production created by 'שלח קליפ' owns its planning budget + currency
  { const mp = await q("SET_PRODUCTION_MONEY", { production: P1, generalBudget: 9000 });
    ok("B3: a 'שלח קליפ' production's budget is plannable (no BUDGET_LOCKED) and the preview says the project's price does not change", mp.status === "PREVIEW" && /המחיר המוסכם של הפרויקט לא משתנה/.test(JSON.stringify(mp)), mp); }
  ok("B3: a 'שלח קליפ' production's currency is its own (no MANAGED_BY_PROJECT refusal)", (await q("SET_RF_CURRENCY", { target: P1, currency: "$" })).status === "PREVIEW");
  ok("one clip model (2026-10-01): no clip price / clip deal / clip payment action exists — a clip project's price is SET_AGREED_PRICE", ["SET_CLIP_PRICE", "OPEN_CLIP_DEAL", "ADD_CLIP_PAYMENT"].every((id) => !ACTION_REGISTRY.has(id)) && ACTION_REGISTRY.get("SET_AGREED_PRICE")?.availabilityDetail === "EXECUTABLE");
  ok("B3: SEND_CLIP discloses budget 0 (planning) — never the project's price", /תקציב תכנון 0/.test(JSON.stringify(await q("SEND_CLIP_TO_RED_FILMS", { project: J41 }))));
  ok("cancel is its own action (details refuse בוטל)", (await q("UPDATE_PRODUCTION_DETAILS", { production: P2, status: "בוטל" })).status !== "PREVIEW");
  const pr = mk(); pr.w.clips[U(30)].linked_transaction_id = "tx";
  ok("a promoted clip row is never promoted twice", (await q("PROMOTE_CLIP_ROW", { clipRow: C30, date: "2026-09-26" }, pr)).status === "NO_CHANGE_NEEDED");
  ok("a project with a managed production is not sent again", (await q("SEND_CLIP_TO_RED_FILMS", { project: J40 })).status === "NO_CHANGE_NEEDED");
  const pv = await q("SET_PRODUCTION_MONEY", { production: P2, clientPrice: 5000 });
  ok("planning ≠ spend is disclosed", pv.status === "PREVIEW" && JSON.stringify(pv).includes("תכנון ≠ הוצאה בפועל"));
  ok("status מאושר = D7 stage approval: plannable through the status primitive, and 'mark approved' is executable through it", (await q("UPDATE_PRODUCTION_DETAILS", { production: P2, status: "מאושר" })).status === "PREVIEW" && ACTION_REGISTRY.get("RF.MARK_PRODUCTION_APPROVED")?.availabilityDetail === "EXECUTABLE");
  { const hp = mk(); hp.w.pays[U(88)] = { id: U(88), production_id: U(3), amount: 1200, currency: "$" }; const r = await q("DELETE_CANCELLED_PRODUCTIONS", { productions: `rf-production:${U(3)}` }, hp);
    ok("A5: a cancelled production WITH Red Films payments is refused (HAS_PAYMENTS, per currency, nothing written)", r.status === "HAS_PAYMENTS" && JSON.stringify(r).includes("$1,200") && hp.calls.length === 0, r); }
  { const pv = await q("DELETE_CANCELLED_PRODUCTIONS", { productions: `rf-production:${U(3)}` });
    ok("A5: the preview lists exactly what is deleted (documents / references / scenes / crew / lines / tasks) and that Finance rows stay", pv.status === "PREVIEW" && /מסמכים/.test(JSON.stringify(pv)) && /סצנות/.test(JSON.stringify(pv)) && /כסף אמיתי לא נמחק|תשלומי Red Films/.test(JSON.stringify(pv)), pv); }
  ok("only cancelled productions are deleted permanently", (await q("DELETE_CANCELLED_PRODUCTIONS", { productions: `rf-production:${U(3)}, rf-production:${U(2)}` })).status === "NOT_CANCELLED");
  ok("no primitive writes a link / URL field", !RF_PRIMITIVES.some((p) => p.meta.args.some((a) => /link|url/i.test(a.name))));
  ok("money primitives are FINANCIAL (promote creates an expense and deletes nothing since B3); deletes are C3", ["SET_PRODUCTION_MONEY", "RECORD_RF_BUDGET_PAYMENT", "LINK_RF_PAYMENT_TO_FINANCE", "PROMOTE_CLIP_ROW"].every((id) => ACTION_REGISTRY.get(id)!.riskClass === "FINANCIAL") && !ACTION_REGISTRY.get("PROMOTE_CLIP_ROW")!.effects.includes("DELETION" as never) && ["DELETE_RF_BUDGET_LINE", "DELETE_RF_BUDGET_PAYMENT", "DELETE_CLIP_ROW"].every((id) => ACTION_REGISTRY.get(id)!.confirmation === "C3_STRONG_APPROVAL"));

  // ── DB-1: Red Films payment → exactly ONE linked Finance expense ──
  console.log("\nDB-1 link rules (primitive level; the writer is proven in test-rf-finance-link.tsx)");
  { const r = await q("LINK_RF_PAYMENT_TO_FINANCE", { rfPayment: `rf-payment:${U(23)}` }); ok("a non-clip production's payment → SCOPE_REQUIRED (never an invented scope), nothing written", r.status === "SCOPE_REQUIRED", r); }
  { const r = await q("LINK_RF_PAYMENT_TO_FINANCE", { rfPayment: `rf-payment:${U(24)}` }); ok("a clip production without a project → PROJECT_REQUIRED", r.status === "PROJECT_REQUIRED", r); }
  { const h = mk(); h.w.txs["tx-old"] = { id: "tx-old", amount: 1000, currency: "₪", payment_status: "שולם", expense_scope: "קליפ", project_id: U(40) }; h.w.pays[U(21)].linked_transaction_id = "tx-old";
    const r = await q("LINK_RF_PAYMENT_TO_FINANCE", { rfPayment: `rf-payment:${U(21)}` }, h); ok("an already-linked payment → ALREADY_LINKED with its transaction (never a second expense)", r.status === "ALREADY_LINKED" && JSON.stringify(r).includes("tx-old") && h.calls.length === 0, r); }
  { const pv = await q("LINK_RF_PAYMENT_TO_FINANCE", { rfPayment: `rf-payment:${U(21)}` }); const t = JSON.stringify(pv);
    ok("the preview shows the exact expense: amount + currency, date, method, project, scope קליפ, שולם, description", pv.status === "PREVIEW" && t.includes("₪1,000") && t.includes("2026-09-10") && t.includes("העברה בנקאית") && t.includes("קרוב אלייך") && t.includes("שיוך קליפ") && t.includes("'שולם'") && t.includes("Red Films — קליפ שליו — צלם קליפ"), pv); }
  { const h = mk(); h.w.finDup[U(21)] = [{ level: "LIKELY_SAME", date: "2026-09-11", amount: 1000, currency: "₪", text: "צלם קליפ שליו", daysApart: 1 }];
    const d = mkDeps(h.writers).d;
    const r = await planAction({ intentHe: "x", actionId: "LINK_RF_PAYMENT_TO_FINANCE", args: { rfPayment: `rf-payment:${U(21)}` } }, OWNER, d);
    ok("a similar unlinked Finance expense → POSSIBLE_DUPLICATE with a server-issued duplicateAck (nothing written)", r.status === "POSSIBLE_DUPLICATE" && typeof (r as { duplicateAck?: unknown }).duplicateAck === "string" && h.calls.length === 0, r);
    const again = await fullFlow(d, "LINK_RF_PAYMENT_TO_FINANCE", { rfPayment: `rf-payment:${U(21)}`, separateFromSimilar: true, duplicateAck: (r as unknown as { duplicateAck: string }).duplicateAck }, "מאשר");
    ok("after the Boss says 'additional' (separateFromSimilar + the ack) → PREVIEW → executed with allowDuplicate", again.p.status === "PREVIEW" && again.e?.status === "APPLIED_AS_EXPECTED" && h.calls.includes("linkRfPaymentRecord(allowDuplicate)"), again); }
  { const h = mk(); h.w.pays[U(21)].linked_transaction_id = "tx-x"; h.w.txs["tx-x"] = { id: "tx-x", amount: 1000, currency: "₪", payment_status: "שולם", expense_scope: "קליפ", project_id: U(40) };
    const pv = await q("LINK_RF_PAYMENTS_FOR_PRODUCTION", { production: P1 }, h); const t = JSON.stringify(pv);
    ok("bulk: only the UNLINKED payments are in the set (1 of 2), listed payment → expense, 'עדכון גורף' highlighted, BULK risk", pv.status === "PREVIEW" && t.includes("1 תשלומים → 1 הוצאות") && t.includes("2026-09-12") && t.includes("עדכון גורף") && ACTION_REGISTRY.get("LINK_RF_PAYMENTS_FOR_PRODUCTION")!.riskClass === "BULK", pv); }
  ok("bulk: a non-clip production → SCOPE_REQUIRED (all-or-nothing)", (await q("LINK_RF_PAYMENTS_FOR_PRODUCTION", { production: `rf-production:${U(5)}` })).status === "SCOPE_REQUIRED");
  { const h = mk(); for (const id of [U(21), U(22)]) { h.w.pays[id].linked_transaction_id = `t${id}`; h.w.txs[`t${id}`] = { id: `t${id}` }; }
    ok("bulk: every payment already linked → NO_CHANGE_NEEDED", (await q("LINK_RF_PAYMENTS_FOR_PRODUCTION", { production: P1 }, h)).status === "NO_CHANGE_NEEDED"); }
  { const h = mk(); const r = await fullFlow(mkDeps(h.writers).d, "UPDATE_PRODUCTION_DETAILS", { production: P2, clientSource: "לקוח חיצוני" }, "מאשר");
    ok("clientSource: typed enum through updateProduction (client_source), preview shows before → after", r.p.status === "PREVIEW" && r.e?.status === "APPLIED_AS_EXPECTED" && h.w.prods[U(2)].client_source === "לקוח חיצוני" && /מקור לקוח: — → לקוח חיצוני/.test(JSON.stringify(r.p)), r); }
  ok("clientSource: a value outside the Red Films vocabulary is refused", (await q("UPDATE_PRODUCTION_DETAILS", { production: P2, clientSource: "חבר" })).status !== "PREVIEW");
  { const h = mk(); h.w.pays[U(20)].linked_transaction_id = "tx-9"; h.w.pays[U(20)].finance_linked = true; const r = await q("DELETE_RF_BUDGET_PAYMENT", { payment: Y20 }, h);
    ok("deleting a LINKED payment discloses that its Finance expense is deleted with it (amount shown)", r.status === "PREVIEW" && /ההוצאה המקושרת בכספים \(₪500\) נמחקת/.test(JSON.stringify(r)), r); }
  { const r = await q("RECORD_RF_BUDGET_PAYMENT", { budgetLine: `rf-budget-line:${U(11)}`, amount: 400, paymentDate: "2026-09-26" }); ok("a new payment on a clip production with a project: the preview says it links automatically to ONE Finance expense", r.status === "PREVIEW" && /יקושר אוטומטית להוצאה אחת בכספים/.test(JSON.stringify(r)), r); }
  { const r = await q("RECORD_RF_BUDGET_PAYMENT", { budgetLine: L10, amount: 400, paymentDate: "2026-09-26" }); ok("a new payment on a non-clip production: the preview says SCOPE_REQUIRED (recorded, not linked)", r.status === "PREVIEW" && /SCOPE_REQUIRED/.test(JSON.stringify(r)), r); }

  console.log("\nVocabularies pinned (to the red-films contract, which its own test pins to the code)");
  ok("production statuses / types / budget categories / clip categories", JSON.stringify(RF_STATUSES) === JSON.stringify(RF_VOCABULARIES.productionStatus) && JSON.stringify(RF_TYPES) === JSON.stringify(RF_VOCABULARIES.productionType) && JSON.stringify(RF_BUDGET_CATEGORY) === JSON.stringify(RF_VOCABULARIES.budgetItemCategory) && JSON.stringify(CLIP_ITEM_CATEGORY) === JSON.stringify(RF_VOCABULARIES.clipItemCategory) && JSON.stringify(RF_EQUIPMENT_CATEGORY) === JSON.stringify(RF_VOCABULARIES.equipmentCategory));

  console.log("\nShared writers + hardening");
  ok("RF / clip routes use lib/writes/redfilms + lib/writes/clip", /createProduction\(/.test(read("app/api/red-films/productions/route.ts")) && /updateProduction\(id, body\)/.test(read("app/api/red-films/productions/[id]/route.ts")) && /promoteClipItem\(id, date\)/.test(read("app/api/clip-items/[id]/promote/route.ts")) && /sendClipToRedFilms\(id\)/.test(read("app/api/projects/[id]/clip/send/route.ts")) && !/setClipPrice|addClipPayments/.test(read("app/api/projects/[id]/clip/route.ts")));
  const wr = read("lib/writes/redfilms.ts");
  ok("HARDENED: a production cancel saves first, then cleans its tasks", wr.indexOf('.from("red_films_productions").update(patch)') < wr.indexOf('if (body.status === "בוטל")'));
  const del = wr.slice(wr.indexOf("export async function deleteCancelledProductions"));
  ok("A5: RF permanent delete = preflight first → payments refuse → DB rows (each step checked) → productions → verify → storage / Google Tasks last", del.indexOf("redFilmsDeletePreflight(") < del.indexOf("HAS_PAYMENTS") && del.indexOf("HAS_PAYMENTS") < del.indexOf("await step(") && del.indexOf('await step("red_films_productions"') < del.indexOf("files/delete_v2") && del.indexOf('await step("red_films_productions"') < del.indexOf("deleteGoogleTask") && /clearClipMarkerIfEqual/.test(del) && !/catch \{ \/\* non-fatal/.test(del));
  ok("A5: the bulk-permanent-delete route checks the Owner in-route", /requireOwner\(\)/.test(read("app/api/red-films/productions/bulk-permanent-delete/route.ts")));
  { const pc = wr.slice(wr.indexOf("export async function promoteClipItem"));
    ok("HARDENED + B3: clip promote claims the row (status → הועבר לכספים while unlinked) before the expense, releases the claim on failure, then KEEPS + links the row (never deletes it)", pc.indexOf('.is("linked_transaction_id", null).eq("status", prevStatus).select("id")') > 0 && pc.indexOf('.is("linked_transaction_id", null).eq("status", prevStatus).select("id")') < pc.indexOf('.from("transactions").insert(') && /release the claim/.test(pc) && /linked_transaction_id: txId/.test(pc) && !/\.delete\(\)/.test(pc.slice(0, pc.indexOf("// ── narrow readers")))); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
