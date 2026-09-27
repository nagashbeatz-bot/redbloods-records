/**
 * Universal Action Layer — Red Films + clip family: every primitive through the REAL service on fakes (6 standard checks
 * each) + family rules (managed budget locked, planning ≠ spend, promote never twice, clip deal seeded once, cancel via
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
interface W { folders: Set<string>; prods: Record<string, Row>; managed: Set<string>; lines: Record<string, Row>; pays: Record<string, Row>; clips: Record<string, Row>; deals: Record<string, { clipAgreedPrice: number; currency: string; paymentCount: number; managedProductionId: string | null }>; expenses: number; projects: Record<string, string>; equip: Record<string, Row>; docs: Record<string, Row>; refs: Record<string, Row> }
const world = (): W => ({
  folders: new Set<string>(),
  prods: { [U(3)]: { id: U(3), title: "הפקה ישנה", status: "בוטל" }, [U(1)]: { id: U(1), title: "קליפ שליו", status: "בתכנון", production_type: "קליפ", project_id: U(40), general_budget: 8000, client_price: 0, advance_required: 0, advance_received: 0, collection_status: "לא רלוונטי", edit_status: "לא התחיל" }, [U(2)]: { id: U(2), title: "צילום הופעה", status: "רעיון", production_type: "צילום הופעה", project_id: null, general_budget: 3000 } },
  managed: new Set([U(1)]),
  lines: { [U(10)]: { id: U(10), production_id: U(2), title: "צלם", category: "צלם", planned_amount: 1500, actual_amount: 0, vendor_name: "", status: "מתוכנן", notes: "" } },
  pays: { [U(20)]: { id: U(20), amount: 500, payment_date: "2026-09-01", payment_method: "ביט", notes: "", receipt_dropbox_path: "" } },
  clips: { [U(30)]: { id: U(30), project_id: U(40), category: "לוקיישן", description: "גג", amount: 1200, currency: "₪", status: "תכנון בלבד", notes: "", linked_transaction_id: null } },
  deals: { [U(40)]: { clipAgreedPrice: 8000, currency: "₪", paymentCount: 0, managedProductionId: U(1) }, [U(41)]: { clipAgreedPrice: 0, currency: "₪", paymentCount: 0, managedProductionId: null } },
  expenses: 0, projects: { [U(40)]: "קרוב אלייך", [U(41)]: "סינגל" },
  equip: { [U(50)]: { id: U(50), name: "Sony FX3", category: "מצלמות", quantity: 1, purchase_price: 15000, purchased_from: "", serial_number: "", notes: "", status: "קיים" } },
  docs: { [U(60)]: { id: U(60), file_name: "תסריט.pdf" } }, refs: { [U(70)]: { id: U(70), file_name: "ref.jpg", tag: "כללי" } },
});
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const writers = {
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
    async promoteClipItemRecord(id: string) { calls.push("promoteClipItemRecord"); if (!w.clips[id]) return "not_found" as const; delete w.clips[id]; w.expenses++; return "ok" as const; },
    async clipDealOf(pid: string) { return { ...w.deals[pid] }; },
    async setClipPrice(pid: string, price: number) { calls.push("setClipPrice"); w.deals[pid].clipAgreedPrice = price; },
    async addClipPayments(pid: string, b: Row) { calls.push("addClipPayments"); w.deals[pid].paymentCount += b.seed ? 2 : 1; return "ok" as const; },
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
  { id: "PROMOTE_CLIP_ROW", args: { clipRow: C30, date: "2026-09-26" }, confirm: "כן בוס, 2026-09-26", bad: { clipRow: C30, date: "מחר" }, missing: { clipRow: `clip-row:${U(9)}`, date: "2026-09-26" }, stale: (w) => { w.clips[U(30)].amount = 999; }, check: (w) => !w.clips[U(30)] && w.expenses === 1 },
  { id: "SET_CLIP_PRICE", args: { project: J40, clipAgreedPrice: 9000 }, confirm: "כן בוס, 9,000", bad: { project: J40, clipAgreedPrice: -5 }, missing: { project: `project:${U(99)}`, clipAgreedPrice: 1 }, stale: (w) => { w.deals[U(40)].clipAgreedPrice = 8500; }, check: (w) => w.deals[U(40)].clipAgreedPrice === 9000 },
  { id: "OPEN_CLIP_DEAL", args: { project: J40 }, confirm: "כן בוס, פתיחת עסקה", bad: { project: J41 }, missing: { project: `project:${U(99)}` }, stale: (w) => { w.deals[U(40)].clipAgreedPrice = 7000; }, check: (w) => w.deals[U(40)].paymentCount === 2 },
  { id: "ADD_CLIP_PAYMENT", args: { project: J40, amount: 2000, paymentStatus: "התקבל" }, confirm: "כן בוס, 2,000 התקבל", bad: { project: J40, amount: 0 }, missing: { project: `project:${U(99)}`, amount: 1 }, stale: (w) => { w.deals[U(40)].paymentCount = 1; }, check: (w) => w.deals[U(40)].paymentCount === 1 },
  { id: "SEND_CLIP_TO_RED_FILMS", args: { project: J41 }, bad: { project: J40 }, missing: { project: `project:${U(99)}` }, stale: (w) => { w.deals[U(41)].clipAgreedPrice = 100; }, check: (w) => w.deals[U(41)].managedProductionId === "new-prod" },
  { id: "ADD_EQUIPMENT", args: { name: "Aputure 300d", category: "תאורה", quantity: 2 }, bad: { name: "x", category: "תאורה", quantity: 0 }, stale: (w) => { w.equip[U(77)] = { id: U(77), name: "Aputure 300d" }; }, check: (w) => Object.values(w.equip).some((e) => e.name === "Aputure 300d" && e.quantity === 2) },
  { id: "UPDATE_EQUIPMENT", args: { equipment: `rf-equipment:${U(50)}`, status: "הוסר מהמלאי" }, confirm: "כן בוס, הוסר מהמלאי", bad: { equipment: `rf-equipment:${U(50)}`, quantity: 0 }, missing: { equipment: `rf-equipment:${U(9)}`, notes: "x" }, stale: (w) => { w.equip[U(50)].notes = "q"; }, check: (w) => w.equip[U(50)].status === "הוסר מהמלאי" },
  { id: "DELETE_RF_DOCUMENT", args: { document: `rf-document:${U(60)}` }, confirm: "כן בוס, מחיקה", bad: { document: "x" }, missing: { document: `rf-document:${U(9)}` }, stale: (w) => { delete w.docs[U(60)]; w.docs[U(61)] = {}; }, check: (w) => !w.docs[U(60)] },
  { id: "SET_RF_REFERENCE_TAG", args: { reference: `rf-reference:${U(70)}`, tag: "תאורה" }, bad: { reference: `rf-reference:${U(70)}`, tag: "" }, missing: { reference: `rf-reference:${U(9)}`, tag: "x" }, stale: (w) => { w.refs[U(70)].tag = "לוקיישן"; }, check: (w) => w.refs[U(70)].tag === "תאורה" },
  { id: "DELETE_RF_REFERENCE", args: { reference: `rf-reference:${U(70)}` }, confirm: "כן בוס, מחיקה", bad: { reference: "x" }, missing: { reference: `rf-reference:${U(9)}` }, stale: (w) => { delete w.refs[U(70)]; }, check: (w) => !w.refs[U(70)] },
  { id: "DELETE_CANCELLED_PRODUCTIONS", args: { productions: `rf-production:${U(3)}` }, confirm: "כן בוס, 1 מחיקה", bad: { productions: "nope" }, missing: { productions: `rf-production:${U(9)}` }, stale: (w) => { w.prods[U(3)].title = "שונה"; }, check: (w) => !w.prods[U(3)] },
];

(async () => {
  console.log("Red Films family — standard checks");
  ok("the case table covers every Red Films primitive", CASES.map((c) => c.id).sort().join() === RF_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nRed Films rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  ok("a managed production's budget is locked (the app's rule) — set the clip price instead", (await q("SET_PRODUCTION_MONEY", { production: P1, generalBudget: 9000 })).status === "BUDGET_LOCKED");
  ok("cancel is its own action (details refuse בוטל)", (await q("UPDATE_PRODUCTION_DETAILS", { production: P2, status: "בוטל" })).status !== "PREVIEW");
  const pr = mk(); pr.w.clips[U(30)].linked_transaction_id = "tx";
  ok("a promoted clip row is never promoted twice", (await q("PROMOTE_CLIP_ROW", { clipRow: C30, date: "2026-09-26" }, pr)).status === "NO_CHANGE_NEEDED");
  const dl = mk(); dl.w.deals[U(40)].paymentCount = 2;
  ok("a clip deal is opened once", (await q("OPEN_CLIP_DEAL", { project: J40 }, dl)).status === "NO_CHANGE_NEEDED");
  ok("a project with a managed production is not sent again", (await q("SEND_CLIP_TO_RED_FILMS", { project: J40 })).status === "NO_CHANGE_NEEDED");
  const pv = await q("SET_PRODUCTION_MONEY", { production: P2, clientPrice: 5000 });
  ok("planning ≠ spend is disclosed", pv.status === "PREVIEW" && JSON.stringify(pv).includes("תכנון ≠ הוצאה בפועל"));
  ok("status מאושר = D7 stage approval: plannable through the status primitive, and 'mark approved' is executable through it", (await q("UPDATE_PRODUCTION_DETAILS", { production: P2, status: "מאושר" })).status === "PREVIEW" && ACTION_REGISTRY.get("RF.MARK_PRODUCTION_APPROVED")?.availabilityDetail === "EXECUTABLE");
  ok("only cancelled productions are deleted permanently", (await q("DELETE_CANCELLED_PRODUCTIONS", { productions: `rf-production:${U(3)}, rf-production:${U(2)}` })).status === "NOT_CANCELLED");
  ok("no primitive writes a link / URL field", !RF_PRIMITIVES.some((p) => p.meta.args.some((a) => /link|url/i.test(a.name))));
  ok("money primitives are FINANCIAL; deletes are C3", ["SET_PRODUCTION_MONEY", "RECORD_RF_BUDGET_PAYMENT", "SET_CLIP_PRICE", "OPEN_CLIP_DEAL", "ADD_CLIP_PAYMENT"].every((id) => ACTION_REGISTRY.get(id)!.riskClass === "FINANCIAL") && ["DELETE_RF_BUDGET_LINE", "DELETE_RF_BUDGET_PAYMENT", "DELETE_CLIP_ROW", "PROMOTE_CLIP_ROW"].every((id) => ACTION_REGISTRY.get(id)!.confirmation === "C3_STRONG_APPROVAL"));

  console.log("\nVocabularies pinned (to the red-films contract, which its own test pins to the code)");
  ok("production statuses / types / budget categories / clip categories", JSON.stringify(RF_STATUSES) === JSON.stringify(RF_VOCABULARIES.productionStatus) && JSON.stringify(RF_TYPES) === JSON.stringify(RF_VOCABULARIES.productionType) && JSON.stringify(RF_BUDGET_CATEGORY) === JSON.stringify(RF_VOCABULARIES.budgetItemCategory) && JSON.stringify(CLIP_ITEM_CATEGORY) === JSON.stringify(RF_VOCABULARIES.clipItemCategory) && JSON.stringify(RF_EQUIPMENT_CATEGORY) === JSON.stringify(RF_VOCABULARIES.equipmentCategory));

  console.log("\nShared writers + hardening");
  ok("RF / clip routes use lib/writes/redfilms + lib/writes/clip", /createProduction\(/.test(read("app/api/red-films/productions/route.ts")) && /updateProduction\(id, body\)/.test(read("app/api/red-films/productions/[id]/route.ts")) && /promoteClipItem\(id, date\)/.test(read("app/api/clip-items/[id]/promote/route.ts")) && /setClipPrice\(id, price\)/.test(read("app/api/projects/[id]/clip/route.ts")) && /sendClipToRedFilms\(id\)/.test(read("app/api/projects/[id]/clip/send/route.ts")) && /addClipPayments\(id, body\)/.test(read("app/api/projects/[id]/clip/payments/route.ts")));
  const wr = read("lib/writes/redfilms.ts");
  ok("HARDENED: a production cancel saves first, then cleans its tasks", wr.indexOf('.from("red_films_productions").update(patch)') < wr.indexOf('if (body.status === "בוטל")'));
  ok("HARDENED: clip promote claims the row (delete while unpromoted) before the expense, restores it on failure", wr.indexOf('.is("linked_transaction_id", null).select("id")') < wr.indexOf('.from("transactions").insert(') && /restore the planning row/.test(wr));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
