/**
 * Universal Action Layer — Finance family: every primitive through the REAL service on fakes (6 standard checks each)
 * + finance rules (exact money + currency repeated in the approval, no currency default / conversion, status vocabulary
 * per type, sync-owned rows refused, split bounds, duplicate warning), vocabularies pinned, shared writer in the routes.
 * Run with:   npx tsx scripts/test-sunny-act-finance.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { EXPENSE_SCOPES, EXPENSE_STATUSES, FINANCE_PRIMITIVES, INCOME_STATUSES, PAYMENT_METHODS, TX_CURRENCIES } from "../lib/partner/act/primitives/finance";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Tx = { projectId: string | null; scope: string; type: string; date: string | null; description: string; artist: string; amount: number; currency: string; paymentStatus: string; paymentMethod: string; receiptRef: string; notes: string; category: string; expenseScope: string; linkedSessionId: string };
type Fs = { agreedPrice: number; currency: string; financialNotes: string; financeException: boolean; financeExceptionReason: string; financeExceptionDate: string };
interface W { tx: Record<string, Tx>; owner: Record<string, string>; projects: Record<string, string>; fs: Record<string, Fs> }
const base = (o: Partial<Tx>): Tx => ({ projectId: U(10), scope: "project", type: "income", date: "2026-09-01", description: "מקדמה", artist: "שליו", amount: 3000, currency: "₪", paymentStatus: "צפוי", paymentMethod: "", receiptRef: "", notes: "", category: "", expenseScope: "כללי", linkedSessionId: "", ...o });
const world = (): W => ({
  tx: { [U(1)]: base({}), [U(2)]: base({ type: "expense", amount: 500, paymentStatus: "צפוי", description: "DJ" }), [U(3)]: base({ type: "expense", amount: 200, currency: "$", paymentStatus: "לא שולם", description: "מיקס" }) },
  owner: { [U(2)]: "SHOW" }, projects: { [U(10)]: "קרוב אלייך", [U(11)]: "סינגל" },
  fs: { [U(10)]: { agreedPrice: 6000, currency: "₪", financialNotes: "", financeException: false, financeExceptionReason: "", financeExceptionDate: "" }, [U(11)]: { agreedPrice: 0, currency: "₪", financialNotes: "", financeException: false, financeExceptionReason: "", financeExceptionDate: "" } },
});
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const writers = {
    async readProjectMeta(id: string) { return w.projects[id] ? { name: w.projects[id], artist: "", status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
    async readTransaction(id: string) { return w.tx[id] ? { ...w.tx[id] } : null; },
    async financeOwnerOf(id: string) { return w.owner[id] ?? null; },
    async similarRecords(q: { kind: string; projectId?: string | null; type?: string; amount?: number; currency?: string }) { return q.kind !== "TRANSACTION" ? [] : Object.values(w.tx).filter((x) => x.projectId === q.projectId && x.type === q.type && x.amount === q.amount && x.currency === q.currency).map((x) => ({ date: x.date, amount: x.amount, currency: x.currency, text: [x.description, x.notes].filter(Boolean).join(" · ") })); },
    async createTransaction(t: Tx) { calls.push("createTransaction"); const id = U(++n); w.tx[id] = { ...t }; return id; },
    async updateTransaction(id: string, p: Record<string, unknown>) { calls.push("updateTransaction"); const t = w.tx[id]; for (const [k, v] of Object.entries(p)) { if (k === "project_id") t.projectId = v as string | null; else (t as unknown as Record<string, unknown>)[k] = v; } },
    async deleteTransaction(id: string) { calls.push("deleteTransaction"); delete w.tx[id]; },
    async splitIncome(id: string, paid: number) { calls.push("splitIncome"); const t = w.tx[id]; if (t.paymentStatus !== "צפוי") return "conflict"; const rest = t.amount - paid; t.amount = paid; t.paymentStatus = "התקבל"; if (rest > 0) w.tx[U(++n)] = { ...t, amount: rest, paymentStatus: "צפוי" }; return "ok"; },
    async readFinanceSettings(id: string) { return { ...w.fs[id] }; },
    async setFinanceSettings(id: string, p: Partial<Fs>) { calls.push("setFinanceSettings"); w.fs[id] = { ...w.fs[id], ...p }; },
    // B3 income-scope preview context (lib/writes/finance readProjectIncomeContext) — the clip price of U(10) is unknown
    async readProjectIncomeContext(pid: string) { return { clipAgreedPrice: null, clipCurrency: "₪", incomes: Object.entries(w.tx).filter(([, t]) => t.projectId === pid && t.type === "income").map(([id, t]) => ({ id, amount: t.amount, currency: t.currency, paymentStatus: t.paymentStatus, expenseScope: t.expenseScope })) }; },
  };
  return { w, calls, writers };
}
const T1 = `transaction:${U(1)}`, T2 = `transaction:${U(2)}`, T3 = `transaction:${U(3)}`, P10 = `project:${U(10)}`;
const CASES: FamilyCase<W>[] = [
  { id: "ADD_TRANSACTION", args: { project: P10, type: "income", amount: 1500, currency: "₪", paymentStatus: "התקבל", date: "2026-09-20", description: "תשלום שני" }, confirm: "כן בוס, ₪1,500 התקבל", bad: { project: P10, type: "income", amount: 1500, currency: "₪", paymentStatus: "שולם-ish", date: "2026-09-20" }, missing: { project: `project:${U(99)}`, type: "income", amount: 1, currency: "₪", paymentStatus: "צפוי", date: "2026-09-20" }, wrongKind: { project: T1, type: "income", amount: 1, currency: "₪", paymentStatus: "צפוי", date: "2026-09-20" }, stale: (w) => { w.tx[U(77)] = base({ amount: 1500, paymentStatus: "התקבל", date: "2026-09-20" }); }, check: (w, c) => Object.values(w.tx).some((t) => t.amount === 1500 && t.paymentStatus === "התקבל" && t.currency === "₪" && t.projectId === U(10)) && c.join() === "createTransaction" },
  { id: "UPDATE_TRANSACTION_DETAILS", args: { transaction: T1, description: "מקדמה ראשונה", paymentMethod: "ביט" }, bad: { transaction: T1, date: "2026-02-30" }, missing: { transaction: `transaction:${U(9)}`, description: "x" }, wrongKind: { transaction: P10, description: "x" }, stale: (w) => { w.tx[U(1)].description = "שונה"; }, check: (w) => w.tx[U(1)].description === "מקדמה ראשונה" && w.tx[U(1)].paymentMethod === "ביט" && w.tx[U(1)].amount === 3000 },
  { id: "SET_TRANSACTION_AMOUNT", args: { transaction: T1, amount: 3500 }, confirm: "כן בוס, ₪3,500", bad: { transaction: T1, amount: -3 }, missing: { transaction: `transaction:${U(9)}`, amount: 1 }, stale: (w) => { w.tx[U(1)].amount = 3200; }, check: (w) => w.tx[U(1)].amount === 3500 && w.tx[U(1)].currency === "₪" && w.tx[U(1)].paymentStatus === "צפוי" },
  { id: "SET_TRANSACTION_STATUS", args: { transaction: T3, paymentStatus: "שולם", date: "2026-09-21" }, confirm: "כן בוס, שולם", bad: { transaction: T3, paymentStatus: "התקבל" }, missing: { transaction: `transaction:${U(9)}`, paymentStatus: "שולם" }, stale: (w) => { w.tx[U(3)].paymentStatus = "חלקי"; }, check: (w) => w.tx[U(3)].paymentStatus === "שולם" && w.tx[U(3)].amount === 200 && w.tx[U(3)].currency === "$" },
  { id: "MOVE_TRANSACTION", args: { transaction: T1, toProject: `project:${U(11)}` }, confirm: `כן בוס, project:${U(11)}`, bad: { transaction: T1 }, missing: { transaction: `transaction:${U(9)}`, toGeneral: true }, stale: (w) => { w.tx[U(1)].amount = 1; }, check: (w) => w.tx[U(1)].projectId === U(11) && w.tx[U(1)].scope === "project" },
  { id: "DELETE_TRANSACTION", args: { transaction: T3 }, confirm: "כן בוס, מחיקה", bad: { transaction: "transaction:1" }, missing: { transaction: `transaction:${U(9)}` }, stale: (w) => { w.tx[U(3)].paymentStatus = "שולם"; }, check: (w) => !w.tx[U(3)] },
  { id: "SPLIT_INCOME", args: { transaction: T1, paidAmount: 1000, receivedDate: "2026-09-22" }, confirm: "כן בוס, ₪1,000 2026-09-22", bad: { transaction: T1, paidAmount: 5000, receivedDate: "2026-09-22" }, missing: { transaction: `transaction:${U(9)}`, paidAmount: 1, receivedDate: "2026-09-22" }, stale: (w) => { w.tx[U(1)].amount = 2800; }, check: (w) => w.tx[U(1)].amount === 1000 && w.tx[U(1)].paymentStatus === "התקבל" && Object.values(w.tx).some((t) => t.amount === 2000 && t.paymentStatus === "צפוי") },
  { id: "SET_AGREED_PRICE", args: { project: P10, agreedPrice: 7000, currency: "₪" }, confirm: "כן בוס, ₪7,000", bad: { project: P10, agreedPrice: 7000 }, missing: { project: `project:${U(99)}`, agreedPrice: 1, currency: "₪" }, wrongKind: { project: T1, agreedPrice: 1, currency: "₪" }, stale: (w) => { w.fs[U(10)].agreedPrice = 6500; }, check: (w) => w.fs[U(10)].agreedPrice === 7000 && w.fs[U(10)].currency === "₪" },
  { id: "SET_FINANCIAL_NOTES", args: { project: P10, financialNotes: "חצי מראש" }, bad: { project: P10, financialNotes: "" }, missing: { project: `project:${U(99)}`, financialNotes: "x" }, stale: (w) => { w.fs[U(10)].financialNotes = "משהו"; }, check: (w) => w.fs[U(10)].financialNotes === "חצי מראש" && w.fs[U(10)].agreedPrice === 6000 },
  { id: "SET_FINANCE_EXCEPTION", args: { project: P10, on: true, reason: "עסקת חבר", date: "2026-09-10" }, confirm: "כן בוס, חריגה", bad: { project: P10, on: true }, missing: { project: `project:${U(99)}`, on: false }, stale: (w) => { w.fs[U(10)].financeExceptionReason = "x"; }, check: (w) => w.fs[U(10)].financeException === true && w.fs[U(10)].financeExceptionReason === "עסקת חבר" },
];

(async () => {
  console.log("Finance family — standard checks");
  ok("the case table covers every Finance primitive", CASES.map((c) => c.id).sort().join() === FINANCE_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nFinance rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  ok("no currency default: a transaction without a currency is refused", (await q("ADD_TRANSACTION", { project: P10, type: "income", amount: 10, paymentStatus: "צפוי", date: "2026-09-20" })).status !== "PREVIEW");
  ok("the status vocabulary is per type (an expense cannot be 'התקבל')", (await q("ADD_TRANSACTION", { type: "expense", amount: 10, currency: "₪", paymentStatus: "התקבל", date: "2026-09-20" })).status === "BAD_ENUM");
  const m = mk(); const rm = await fullFlow(mkDeps(m.writers).d, "ADD_TRANSACTION", { type: "expense", amount: 400, currency: "$", paymentStatus: "שולם", date: "2026-09-20" }, "כן, מאשר");
  ok("money: the preview shows amount + currency; \"כן, מאשר\" is enough (no repeated values)", JSON.stringify(rm.p).includes('"$"') && rm.e?.status === "APPLIED_AS_EXPECTED", rm.e?.status);
  const cur = mk(); const rc = await fullFlow(mkDeps(cur.writers).d, "ADD_TRANSACTION", { type: "expense", amount: 400, currency: "$", paymentStatus: "שולם", date: "2026-09-20" }, "כן בוס, ₪400 שולם");
  ok("a different currency in the approval is a change, not an approval (no silent FX)", rc.a?.status === "APPROVAL_WITH_CHANGES" && cur.calls.length === 0, rc.a?.status);
  for (const id of ["UPDATE_TRANSACTION_DETAILS", "SET_TRANSACTION_AMOUNT", "SET_TRANSACTION_STATUS", "MOVE_TRANSACTION", "DELETE_TRANSACTION"]) {
    const args: Record<string, unknown> = { transaction: T2, ...(id === "UPDATE_TRANSACTION_DETAILS" ? { description: "x" } : id === "SET_TRANSACTION_AMOUNT" ? { amount: 9 } : id === "SET_TRANSACTION_STATUS" ? { paymentStatus: "שולם" } : id === "MOVE_TRANSACTION" ? { toGeneral: true } : {}) };
    ok(`${id} on a show-owned row is routed to the show's action (never silently overwritten)`, (await q(id, args)).status === "USE_OWNER_ACTION");
  }
  const lk = mk(); lk.w.tx[U(1)].linkedSessionId = U(40);
  ok("moving a session-linked row is refused (the link would dangle)", (await q("MOVE_TRANSACTION", { transaction: T1, toGeneral: true }, lk)).status === "LINKED_ROW");
  const sp = mk(); sp.w.tx[U(1)].paymentStatus = "התקבל";
  ok("only an expected income can be split", (await q("SPLIT_INCOME", { transaction: T1, paidAmount: 10, receivedDate: "2026-09-22" }, sp)).status === "NOT_SPLITTABLE");
  const pw = await q("SET_TRANSACTION_STATUS", { transaction: T1, paymentStatus: "חלקי" });
  ok("partial is disclosed as NOT received", pw.status === "PREVIEW" && JSON.stringify(pw).includes("חלקי, צפוי, לא שולם, בוטל — לא"));
  const dup = await q("ADD_TRANSACTION", { project: P10, type: "income", amount: 3000, currency: "₪", paymentStatus: "צפוי", date: "2026-09-01" });
  ok("a same-day same-amount row in the same project is surfaced BEFORE the plan (POSSIBLE_DUPLICATE, or at least a 'דומה' warning)", dup.status === "POSSIBLE_DUPLICATE" || (dup.status === "PREVIEW" && JSON.stringify(dup).includes("קיימת רשומה")), { s: dup.status, m: dup.messageHe });
  ok("every finance money primitive is FINANCIAL with FINANCE declared and at least C2", ["ADD_TRANSACTION", "SET_TRANSACTION_AMOUNT", "SET_TRANSACTION_STATUS", "MOVE_TRANSACTION", "SPLIT_INCOME", "SET_AGREED_PRICE"].every((id) => { const c = ACTION_REGISTRY.get(id)!; return c.riskClass === "FINANCIAL" && c.effects.includes("FINANCE" as never) && c.confirmation !== "C1_APPROVAL"; }));
  ok("DELETE_TRANSACTION is C3", ACTION_REGISTRY.get("DELETE_TRANSACTION")!.confirmation === "C3_STRONG_APPROVAL");

  console.log("\nB3 income scope (song money ↔ clip money)");
  { const h = mk(); h.w.tx[U(1)].paymentStatus = "התקבל"; const r = await fullFlow(mkDeps(h.writers).d, "UPDATE_TRANSACTION_DETAILS", { transaction: T1, expenseScope: "קליפ" }, "כן בוס, קליפ");
    const txt = JSON.stringify(r.p);
    ok("an unowned project INCOME can become clip money (קליפ): the preview shows song vs clip before / after + the clip price is unknown; executed + verified", r.p.status === "PREVIEW" && /היום: ₪: שיר התקבל ₪3000/.test(txt) && /אחרי: ₪: שיר התקבל ₪0 \(פתוח ₪0\) · קליפ התקבל ₪3000/.test(txt) && /מחיר עסקת הקליפ לא ידוע/.test(txt) && r.e?.status === "APPLIED_AS_EXPECTED" && h.w.tx[U(1)].expenseScope === "קליפ", r.e ?? r.p); }
  { const h = mk(); h.w.tx[U(3)] = { ...h.w.tx[U(3)], type: "income", paymentStatus: "צפוי" }; h.w.owner[U(3)] = "CLIP_ROW";
    ok("an OWNED income row is refused (lib/finance/ownership — the owner changes it)", (await q("UPDATE_TRANSACTION_DETAILS", { transaction: T3, expenseScope: "קליפ" }, h)).status === "USE_OWNER_ACTION"); }
  { const h = mk(); h.w.tx[U(1)].projectId = null; h.w.tx[U(1)].scope = "general";
    ok("an income without a project cannot be scoped (no song / clip deal)", (await q("UPDATE_TRANSACTION_DETAILS", { transaction: T1, expenseScope: "קליפ" }, h)).status === "NO_PROJECT"); }
  ok("an income scope other than קליפ / כללי is refused", (await q("UPDATE_TRANSACTION_DETAILS", { transaction: T1, expenseScope: "שיווק" })).status === "BAD_ARGS");
  { const h = mk(); h.w.tx[U(1)].expenseScope = "קליפ"; const r = await q("UPDATE_TRANSACTION_DETAILS", { transaction: T1, expenseScope: "כללי" }, h);
    ok("clip money back to song money (כללי) is previewed the other way", r.status === "PREVIEW" && /תצא מעסקת הקליפ/.test(JSON.stringify(r)), r); }
  { const r = await q("ADD_TRANSACTION", { project: P10, type: "income", amount: 3500, currency: "₪", paymentStatus: "התקבל", date: "2026-09-25", expenseScope: "קליפ", description: "קליפ יהלום" });
    ok("ADD_TRANSACTION: a project income may be created as clip money (קליפ)", r.status === "PREVIEW" && /עסקת הקליפ/.test(JSON.stringify(r)), r); }
  ok("ADD_TRANSACTION: a general (no project) income cannot be clip money", (await q("ADD_TRANSACTION", { type: "income", amount: 10, currency: "₪", paymentStatus: "צפוי", date: "2026-09-25", expenseScope: "קליפ" })).status === "BAD_ARGS");
  ok("the writer keeps an income's קליפ scope only on a project row (txScopeForCreate)", /export function txScopeForCreate/.test(read("lib/writes/finance.ts")) && /expense_scope: txScopeForCreate\(b\.type, b\.expenseScope, txScope === "project" && !!b\.projectId\)/.test(read("lib/writes/finance.ts")));

  console.log("\nA5 ownership (the SAME rule as the Finance route: lib/finance/ownership)");
  const own = (o: string) => { const h = mk(); h.w.owner[U(3)] = o; return h; };
  ok("a DJ fee row: status change allowed (fee-like)", (await q("SET_TRANSACTION_STATUS", { transaction: T3, paymentStatus: "שולם" }, own("DJ_FEE"))).status === "PREVIEW");
  { const r = await q("SET_TRANSACTION_AMOUNT", { transaction: T3, amount: 999 }, own("DJ_FEE")); ok("a DJ fee row: amount change refused with the owner named", r.status === "USE_OWNER_ACTION" && JSON.stringify(r).includes("DJ"), r); }
  ok("a DJ fee row: delete refused", (await q("DELETE_TRANSACTION", { transaction: T3 }, own("DJ_FEE"))).status === "USE_OWNER_ACTION");
  ok("a show PAYMENT row: status change refused (the show payments flow), notes allowed", (await q("SET_TRANSACTION_STATUS", { transaction: T3, paymentStatus: "שולם" }, own("SHOW_PAYMENT"))).status === "USE_OWNER_ACTION" && (await q("UPDATE_TRANSACTION_DETAILS", { transaction: T3, notes: "הערה" }, own("SHOW_PAYMENT"))).status === "PREVIEW");
  ok("Victor salary / promotion rows: status allowed, move refused", (await q("SET_TRANSACTION_STATUS", { transaction: T3, paymentStatus: "בוטל" }, own("VICTOR_SALARY"))).status === "PREVIEW" && (await q("MOVE_TRANSACTION", { transaction: T3, toGeneral: true }, own("PROMOTION"))).status === "USE_OWNER_ACTION");
  const fp = read("lib/partner/act/primitives/finance.ts"), fr = read("app/api/transactions/[id]/route.ts"), sv = read("lib/partner/act/server.ts");
  ok("ONE rule: Sunny's primitives and the route both use lib/finance/ownership (route via assertTransactionEditable; Sunny's writers call it again at execution)", /transactionEditVerdict/.test(fp) && /assertTransactionEditable\(id, body/.test(fr) && /assertTransactionEditable\(id, "delete"\)/.test(fr) && /status: 409/.test(fr) && /F\.assertTransactionEditable\(id, patch\)/.test(sv) && /F\.assertTransactionEditable\(id, "delete"\)/.test(sv));

  console.log("\nVocabularies pinned to the code");
  const qm = read("components/finance/QuickTxModal.tsx"), dr = read("components/ui/ProjectDrawer.tsx");
  const lit = (xs: readonly string[]) => `[${xs.map((x) => `"${x}"`).join(", ")}]`;
  ok("income statuses = QuickTxModal INCOME_STATUSES", qm.includes(`INCOME_STATUSES:  PaymentStatus[] = ${lit(INCOME_STATUSES)}`));
  ok("expense statuses = QuickTxModal EXPENSE_STATUSES", qm.includes(`EXPENSE_STATUSES: PaymentStatus[] = ${lit(EXPENSE_STATUSES)}`));
  ok("payment methods = QuickTxModal PAYMENT_METHODS", qm.includes(`PAYMENT_METHODS    = ${lit(PAYMENT_METHODS)}`));
  ok("expense scopes = ProjectDrawer EXPENSE_SCOPES", dr.includes(`EXPENSE_SCOPES    = ${lit(EXPENSE_SCOPES)}`));
  ok("currencies = ProjectDrawer CURRENCIES", dr.includes(`const CURRENCIES = ${lit(TX_CURRENCIES)}`));
  ok("received = the app's own rule (lib/finance/classify is the one set; clip-finance re-exports it)", /export const RECEIVED_STATUSES = \["שולם", "התקבל"\] as const;/.test(read("lib/finance/classify.ts")) && /CLIP_PAID_STATUSES = RECEIVED_STATUSES/.test(read("lib/clip-finance.ts")));

  console.log("\nShared writer (no divergence)");
  ok("transaction routes use the shared writer (create / settings / update / delete / split)", /createTransactionRecord\(/.test(read("app/api/transactions/route.ts")) && /setFinanceSettings\(/.test(read("app/api/transactions/route.ts")) && /updateTransactionRecord\(/.test(read("app/api/transactions/[id]/route.ts")) && /deleteTransactionRecord\(/.test(read("app/api/transactions/[id]/route.ts")) && /splitIncome\(/.test(read("app/api/transactions/[id]/split/route.ts")));
  ok("the split stays the atomic RPC", /rpc\("split_income_transaction"/.test(read("lib/writes/finance.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
