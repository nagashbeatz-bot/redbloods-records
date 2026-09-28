/**
 * THE canonical Red Films payment ↔ Finance link writer (DB-1, Owner-approved and LIVE 2026-09-27:
 * red_films_budget_payments.linked_transaction_id uuid UNIQUE REFERENCES transactions(id) ON DELETE SET NULL).
 * Used by BOTH the Red Films routes (through lib/writes/redfilms insert / update / delete) and Sunny's typed primitives
 * (LINK_RF_PAYMENT_TO_FINANCE, LINK_RF_PAYMENTS_FOR_PRODUCTION).
 *
 * Owner rules:
 *   • a Red Films payment row = real money that left the company → exactly ONE Finance expense per payment, linked 1:1
 *     through linked_transaction_id; idempotent (an already-linked payment returns its link — never a second expense);
 *   • planning (production budget, budget lines, clip rows) is never money and never creates a Finance row;
 *   • a production whose production_type is not קליפ has no canonical expense scope → SCOPE_REQUIRED (never an invented
 *     "כללי"); a clip production without a project → PROJECT_REQUIRED (no project-less expense is invented);
 *   • no silent FX: the Finance row's currency = the payment's currency;
 *   • duplicate awareness: an UNLINKED Finance expense of the same project / amount / currency within ±14 days with a
 *     similar description (or the budget line's legacy Finance row) → POSSIBLE_DUPLICATE (the Boss decides; Sunny's
 *     duplicateAck flow; the screens leave the payment unlinked and report it).
 * Race safety: the expense is created, then the link is set by compare-and-swap (`.is("linked_transaction_id", null)`);
 * a lost race deletes the just-created expense and returns the existing link. The UNIQUE constraint is the final guard.
 * The linked expense is OWNED by its payment (lib/finance/ownership RF_PAYMENT): in Finance only its notes change;
 * amount / date / method follow the payment (propagateRfPaymentToFinance); deleting the payment deletes it.
 */
import { supabase } from "@/lib/supabase";
import { createTransactionRecord, deleteTransactionRecord, updateTransactionRecord } from "@/lib/writes/finance";
import { rfPaymentFinanceScope } from "@/lib/clip-rf-money-pure";
import { rfLinkCandidates, type DupCandidate, type DupRow } from "@/lib/partner/act/primitives/duplicates";
import type { RfLinkPlanView } from "@/lib/partner/act/primitives/redfilms";

/** Pinned to components/finance/FinancePage.tsx PROJECT_EXPENSE_CATEGORIES (a line category outside it is never invented into Finance). */
export const FINANCE_PROJECT_EXPENSE_CATEGORIES: readonly string[] = ["מיקס / מאסטר", "חדר חזרות", "צילום", "נסיעות", "ציוד", "אחר"];
export const RF_LINK_EXPENSE_SCOPE = "קליפ" as const;
export const rfPaymentNote = (paymentId: string) => `[Red Films payment ${paymentId}]`;

export interface RfLinkExpense {
  projectId: string; amount: number; currency: string; date: string | null; paymentMethod: string;
  category: string; description: string; notes: string; expenseScope: typeof RF_LINK_EXPENSE_SCOPE; paymentStatus: "שולם"; type: "expense";
}
export interface RfLinkContext {
  paymentId: string; productionId: string; productionTitle: string; productionType: string | null; projectId: string | null;
  lineId: string | null; lineTitle: string; lineCategory: string; amount: number; currency: string; paymentDate: string | null; paymentMethod: string;
}
export type RfLinkPlan =
  | { kind: "NOT_FOUND" }
  | { kind: "ALREADY_LINKED"; ctx: RfLinkContext; transactionId: string; tx: { amount: number; currency: string; status: string; expenseScope: string; projectId: string | null } | null }
  | { kind: "SCOPE_REQUIRED"; ctx: RfLinkContext; he: string }
  | { kind: "PROJECT_REQUIRED"; ctx: RfLinkContext; he: string }
  | { kind: "READY"; ctx: RfLinkContext; expense: RfLinkExpense; candidates: DupCandidate[] };

/** The exact Finance expense a payment becomes (pure). */
export function rfLinkExpenseOf(ctx: RfLinkContext): RfLinkExpense {
  const catOk = FINANCE_PROJECT_EXPENSE_CATEGORIES.includes(ctx.lineCategory);
  const base = `Red Films — ${ctx.productionTitle || "הפקה"} — ${ctx.lineTitle || ctx.lineCategory || "שורת תקציב"}`;
  return {
    projectId: ctx.projectId as string, amount: ctx.amount, currency: ctx.currency, date: ctx.paymentDate, paymentMethod: ctx.paymentMethod,
    category: catOk ? ctx.lineCategory : "", description: !catOk && ctx.lineCategory && ctx.lineCategory !== ctx.lineTitle ? `${base} (${ctx.lineCategory})` : base,
    notes: rfPaymentNote(ctx.paymentId), expenseScope: RF_LINK_EXPENSE_SCOPE, paymentStatus: "שולם", type: "expense",
  };
}
/** The link decision for one payment (pure over the rows read). */
export function rfLinkDecision(ctx: RfLinkContext, linkedTransactionId: string | null): "ALREADY_LINKED" | "SCOPE_REQUIRED" | "PROJECT_REQUIRED" | "READY" {
  if (linkedTransactionId) return "ALREADY_LINKED";
  if (!rfPaymentFinanceScope(ctx.productionType).scope) return "SCOPE_REQUIRED";
  if (!ctx.projectId) return "PROJECT_REQUIRED";
  return "READY";
}
export const PROJECT_REQUIRED_HE = "הפקת קליפ בלי פרויקט — לא נוצרת הוצאה בלי פרויקט (צריך לקשר את ההפקה לפרויקט קודם)";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (r.error) throw new Error(`${what}: ${r.error.message}`); // a read failure is never "not linked" / "no duplicates"
  return r.data;
}

/** READ-ONLY: everything the link needs (payment + line + production + linked tx + duplicate candidates). */
export async function readRfLinkPlan(paymentId: string): Promise<RfLinkPlan> {
  const pay = must(await supabase.from("red_films_budget_payments").select("id, production_id, budget_item_id, amount, currency, payment_date, payment_method, linked_transaction_id").eq("id", paymentId).maybeSingle(), "red_films_budget_payments") as Record<string, unknown> | null;
  if (!pay) return { kind: "NOT_FOUND" };
  const lineId = (pay.budget_item_id as string | null) ?? null;
  const line = lineId ? must(await supabase.from("red_films_budget_items").select("id, title, category, currency, linked_transaction_id").eq("id", lineId).maybeSingle(), "red_films_budget_items") as Record<string, unknown> | null : null;
  const prod = must(await supabase.from("red_films_productions").select("id, title, production_type, project_id").eq("id", String(pay.production_id)).maybeSingle(), "red_films_productions") as Record<string, unknown> | null;
  const ctx: RfLinkContext = {
    paymentId: String(pay.id), productionId: String(pay.production_id), productionTitle: String(prod?.title ?? ""), productionType: (prod?.production_type as string | null) ?? null,
    projectId: (prod?.project_id as string | null) ?? null, lineId, lineTitle: String(line?.title ?? ""), lineCategory: String(line?.category ?? ""),
    amount: Number(pay.amount) || 0, currency: String(pay.currency ?? line?.currency ?? "₪"), paymentDate: (pay.payment_date as string | null) ?? null, paymentMethod: String(pay.payment_method ?? ""),
  };
  const linked = (pay.linked_transaction_id as string | null) ?? null;
  const decision = rfLinkDecision(ctx, linked);
  if (decision === "ALREADY_LINKED") {
    const t = must(await supabase.from("transactions").select("id, amount, currency, payment_status, expense_scope, project_id").eq("id", linked!).maybeSingle(), "transactions") as Record<string, unknown> | null;
    return { kind: "ALREADY_LINKED", ctx, transactionId: linked!, tx: t ? { amount: Number(t.amount) || 0, currency: String(t.currency ?? ""), status: String(t.payment_status ?? ""), expenseScope: String(t.expense_scope ?? ""), projectId: (t.project_id as string | null) ?? null } : null };
  }
  if (decision === "SCOPE_REQUIRED") return { kind: "SCOPE_REQUIRED", ctx, he: (rfPaymentFinanceScope(ctx.productionType) as { he: string }).he };
  if (decision === "PROJECT_REQUIRED") return { kind: "PROJECT_REQUIRED", ctx, he: PROJECT_REQUIRED_HE };
  const expense = rfLinkExpenseOf(ctx);
  // same project + expense + amount + currency (focused, ≤ 20 rows) minus rows already owned by another Red Films payment
  const same = (must(await supabase.from("transactions").select("id, date, amount, currency, description, notes").eq("project_id", expense.projectId).eq("type", "expense").eq("amount", expense.amount).eq("currency", expense.currency).order("date", { ascending: false }).limit(20), "transactions") ?? []) as Array<Record<string, unknown>>;
  const ids = same.map((r) => String(r.id));
  const taken = ids.length ? new Set(((must(await supabase.from("red_films_budget_payments").select("linked_transaction_id").in("linked_transaction_id", ids), "red_films_budget_payments") ?? []) as Array<{ linked_transaction_id: string | null }>).map((r) => String(r.linked_transaction_id))) : new Set<string>();
  const rows: DupRow[] = same.filter((r) => !taken.has(String(r.id))).map((r) => ({ id: String(r.id), date: (r.date as string | null) ?? null, amount: Number(r.amount) || 0, currency: (r.currency as string | null) ?? null, text: [r.description, r.notes].map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ") }));
  const legacy = (line?.linked_transaction_id as string | null) ?? null;
  if (legacy && !taken.has(legacy) && !rows.some((r) => r.id === legacy)) {
    const t = must(await supabase.from("transactions").select("id, date, amount, currency, description").eq("id", legacy).maybeSingle(), "transactions") as Record<string, unknown> | null;
    if (t) rows.push({ id: String(t.id), date: (t.date as string | null) ?? null, amount: Number(t.amount) || 0, currency: (t.currency as string | null) ?? null, text: `שורת התקציב כבר מקושרת לרשומה הזאת בכספים · ${String(t.description ?? "")}`.trim(), forced: true });
  } else if (legacy) { const r = rows.find((x) => x.id === legacy); if (r) r.forced = true; }
  return { kind: "READY", ctx, expense, candidates: rfLinkCandidates(rows, { date: expense.date, text: `${expense.description} ${expense.notes}` }) };
}

export type RfLinkResult =
  | { kind: "LINKED"; transactionId: string; expense: RfLinkExpense }
  | { kind: "ALREADY_LINKED"; transactionId: string }
  | { kind: "NOT_FOUND" }
  | { kind: "SCOPE_REQUIRED"; he: string }
  | { kind: "PROJECT_REQUIRED"; he: string }
  | { kind: "POSSIBLE_DUPLICATE"; candidates: DupCandidate[] };

/** Link ONE payment: create its single Finance expense and set the link (CAS). `allowDuplicate` only after the Boss said
 *  "additional record" (Sunny's duplicateAck flow). Never creates a second expense for a linked payment. */
export async function linkRfPaymentToFinance(paymentId: string, opts: { allowDuplicate?: boolean } = {}): Promise<RfLinkResult> {
  const plan = await readRfLinkPlan(paymentId);
  if (plan.kind === "NOT_FOUND") return plan;
  if (plan.kind === "ALREADY_LINKED") return { kind: "ALREADY_LINKED", transactionId: plan.transactionId };
  if (plan.kind === "SCOPE_REQUIRED" || plan.kind === "PROJECT_REQUIRED") return { kind: plan.kind, he: plan.he };
  if (!opts.allowDuplicate && plan.candidates.some((c) => c.level === "LIKELY_SAME")) return { kind: "POSSIBLE_DUPLICATE", candidates: plan.candidates };
  const e = plan.expense;
  const tx = await createTransactionRecord({ unitWriter: "RF_PAYMENT", syncShare: false, projectId: e.projectId, scope: "project", type: "expense", date: e.date, description: e.description, amount: e.amount, currency: e.currency, paymentStatus: e.paymentStatus, paymentMethod: e.paymentMethod, notes: e.notes, category: e.category, expenseScope: e.expenseScope });
  const txId = String(tx.id);
  const { data: claimed, error } = await supabase.from("red_films_budget_payments").update({ linked_transaction_id: txId, updated_at: new Date().toISOString() }).eq("id", paymentId).is("linked_transaction_id", null).select("id");
  if (error || !claimed || claimed.length === 0) {
    // lost the race (or the UNIQUE guard fired): the just-created expense is removed — never two expenses for one payment
    await deleteTransactionRecord(txId);
    const again = await readRfLinkPlan(paymentId);
    if (again.kind === "ALREADY_LINKED") return { kind: "ALREADY_LINKED", transactionId: again.transactionId };
    throw new Error(`the Finance link was not set${error ? `: ${error.message}` : ""} — the new expense was removed`);
  }
  // the link is final → the artist's share of this Records clip cost follows (task 6; never for a removed duplicate)
  await (await import("@/lib/writes/artist-expense-share")).syncExpenseShareSafe(txId);
  return { kind: "LINKED", transactionId: txId, expense: e };
}

/** After a payment edit: its linked expense follows (amount / date / method / currency — the payment is the owner). */
export async function propagateRfPaymentToFinance(payment: Record<string, unknown>): Promise<string | null> {
  const txId = (payment.linked_transaction_id as string | null) ?? null;
  if (!txId) return null;
  await updateTransactionRecord(txId, { amount: Number(payment.amount) || 0, date: (payment.payment_date as string | null) ?? null, paymentMethod: String(payment.payment_method ?? ""), currency: String(payment.currency ?? "₪") });
  return txId;
}

/** Every payment of a production with its link decision (read-only; the bulk primitive's exact set). */
export async function readProductionRfLinkPlans(productionId: string): Promise<RfLinkPlan[] | null> {
  const prod = must(await supabase.from("red_films_productions").select("id").eq("id", productionId).maybeSingle(), "red_films_productions");
  if (!prod) return null;
  const pays = (must(await supabase.from("red_films_budget_payments").select("id, payment_date").eq("production_id", productionId).order("payment_date", { ascending: true }).order("id", { ascending: true }), "red_films_budget_payments") ?? []) as Array<{ id: string }>;
  const out: RfLinkPlan[] = [];
  for (const p of pays) out.push(await readRfLinkPlan(String(p.id)));
  return out;
}

/** One payment's link plan → the Sunny primitive's flat view (scalars + candidates; never a path). */
export function rfLinkPlanView(p: Exclude<RfLinkPlan, { kind: "NOT_FOUND" }>): RfLinkPlanView {
  const c = p.ctx;
  return {
    state: p.kind, paymentId: c.paymentId, productionId: c.productionId, productionTitle: c.productionTitle, productionType: c.productionType,
    projectId: c.projectId, lineTitle: c.lineTitle, amount: c.amount, currency: c.currency, date: c.paymentDate, method: c.paymentMethod,
    category: p.kind === "READY" ? p.expense.category : null, description: p.kind === "READY" ? p.expense.description : null,
    transactionId: p.kind === "ALREADY_LINKED" ? p.transactionId : null, tx: p.kind === "ALREADY_LINKED" ? p.tx : null,
    candidates: p.kind === "READY" ? p.candidates : [], reasonHe: p.kind === "SCOPE_REQUIRED" || p.kind === "PROJECT_REQUIRED" ? p.he : null,
  };
}
