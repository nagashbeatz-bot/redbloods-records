/**
 * Shared finance writers — used by BOTH the transaction routes and Sunny's typed primitives. The route semantics are
 * kept exactly (create defaults, field-level edit, clip-row sync on paid, delete, the atomic split RPC, the merged
 * finance settings upsert). Canonical rules are NOT restated here: received = שולם / התקבל (lib/finance/classify.ts),
 * an expense is paid only when שולם, currencies are never added.
 *
 * `financeOwnerOf` names the Redbloods writer that OWNS a transaction (a show's payment / expected balance / DJ /
 * artist / rehearsal rows, a mix work's payment row, a clip planning row, a Red Films budget line or payment (DB-1), a social promotion,
 * Victor's monthly salary). `assertTransactionEditable` is THE guard (lib/finance/ownership): the Finance route and
 * Sunny's finance writers both call it — an owned row is never deleted from Finance and only its allowed fields
 * (status / date / method / notes for fee-like rows; notes / method / date for a show payment) may change (409).
 */
import { supabase } from "@/lib/supabase";
import { touchProject } from "@/lib/projects-store";
import { isActualMoneyTx, isDeprecatedPaymentStatus } from "@/lib/finance/classify";
import { mergeSettingsKey } from "@/lib/writes/settings-merge";
import { INCOME_SCOPES } from "@/lib/clip-rf-money-pure";
import { copyUnitToSplitRows, recomputeUnitIfRule, setTransactionUnit, unitColumnsForNewTransaction } from "@/lib/writes/business-unit";
import { syncExpenseShareOrFail } from "@/lib/writes/artist-expense-share";
import type { UnitWriter } from "@/lib/business-unit";
import { validateTxPatch } from "@/lib/finance/tx-patch-validation";
import { changedTxFields, ownerFromLinks, transactionEditVerdict, type FinanceOwnerCode, type TxCurrent, type TxEditVerdict, type TxOwnerLinks, type TxPatchField } from "@/lib/finance/ownership";

export interface TransactionInput {
  projectId?: string | null; scope?: string | null; type: string; date?: string | null; description?: string | null; artist?: string | null;
  amount?: number | string | null; currency?: string | null; paymentStatus?: string | null; paymentMethod?: string | null; receiptRef?: string | null;
  notes?: string | null; category?: string | null; linkedSessionId?: string | null; expenseScope?: string | null;
  /** the Owner's explicit unit (STUDIO / RECORDS / FILMS / CORPORATE); omitted = the rule decides (lib/business-unit) */
  businessUnit?: string | null;
  /** who creates the row: a manual writer must end with a unit (NeedsBusinessUnitError), an automatic one may stay unclassified */
  unitWriter?: UnitWriter;
  /** false = the caller syncs the artist expense share itself once the row is final (e.g. after its own CAS link) */
  syncShare?: boolean;
}
export class FinanceInputError extends Error {}
/** A deprecated status (lib/finance/classify DEPRECATED_PAYMENT_STATUSES) is never written by a new write. */
export const DEPRECATED_STATUS_MESSAGE = "הסטטוס 'לבדיקה' הוסר (החלטת בעלים) — בחר צפוי / התקבל / חלקי / בוטל";

/**
 * The expense_scope a NEW row gets: an expense keeps its scope (default כללי); an INCOME row of a project may carry the
 * reporting tag קליפ — any other income scope stays כללי. The tag never changes the project's balance (one clip model).
 */
export function txScopeForCreate(type: string, scope: string | null | undefined, hasProject: boolean): string {
  if (type === "expense") return scope || "כללי";
  return hasProject && scope && INCOME_SCOPES.includes(scope) ? scope : "כללי";
}

/** POST /api/transactions semantics. */
export async function createTransactionRecord(b: TransactionInput): Promise<Record<string, unknown>> {
  const txScope = b.scope ?? "project";
  if (!b.type) throw new FinanceInputError("type required");
  if (txScope === "project" && !b.projectId) throw new FinanceInputError("projectId required for project-scoped transactions");
  if (isDeprecatedPaymentStatus(b.paymentStatus)) throw new FinanceInputError(DEPRECATED_STATUS_MESSAGE);
  const expenseScope = txScopeForCreate(b.type, b.expenseScope, txScope === "project" && !!b.projectId);
  // business unit (task 4): the rule, or the Owner's choice; a manual create without a certain unit is refused (422)
  const unit = await unitColumnsForNewTransaction({ writer: b.unitWriter ?? "FINANCE_MANUAL", type: b.type, category: b.category, expenseScope, projectId: txScope === "general" ? null : (b.projectId || null), ownerChoice: b.businessUnit ?? null });
  const { data, error } = await supabase.from("transactions").insert({
    project_id: txScope === "general" ? null : (b.projectId || null), scope: txScope, type: b.type, date: b.date || null,
    description: b.description || "", artist: b.artist || "", amount: Number(b.amount) || 0, currency: b.currency || "₪",
    payment_status: b.paymentStatus || "צפוי", payment_method: b.paymentMethod || "", receipt_ref: b.receiptRef || "", notes: b.notes || "",
    category: b.category || "", linked_session_id: b.linkedSessionId || "", expense_scope: expenseScope, ...unit,
  }).select().single();
  if (error) throw new Error(error.message);
  if (txScope === "project" && b.projectId) touchProject(b.projectId).catch(() => {});
  // the artist's share of a Records expense (task 6): the Finance row is saved first; the ledger share follows
  if (b.syncShare !== false) await syncExpenseShareOrFail(String((data as { id: unknown }).id));
  return data as Record<string, unknown>;
}

export interface TransactionPatch {
  date?: string | null; description?: string; artist?: string; amount?: number | string; currency?: string; paymentStatus?: string; paymentMethod?: string;
  receiptRef?: string; notes?: string; category?: string; type?: string; scope?: string; project_id?: string | null; linkedSessionId?: string; expenseScope?: string;
  /** the Owner's explicit unit for this row (OWNER_DECISION) — a classification, allowed on owned rows too */
  businessUnit?: string;
}
/** PATCH /api/transactions/[id] semantics (field-level; actual money — lib/finance/classify isActualMoneyTx — marks a linked clip row שולם). */
export async function updateTransactionRecord(id: string, body: TransactionPatch): Promise<Record<string, unknown>> {
  if (isDeprecatedPaymentStatus(body.paymentStatus)) throw new FinanceInputError(DEPRECATED_STATUS_MESSAGE);
  // A8 (Final Hardening 2026-09-29): a change to the row's FINANCIAL MEANING (type / status / scope / project / song vs
  // clip / currency / amount / owner marker) is validated against the row's final state — never written blind
  const { data: curRow, error: curErr } = await supabase.from("transactions").select("*").eq("id", id).maybeSingle();
  if (curErr) throw new Error(curErr.message);
  if (!curRow) throw new FinanceInputError("transaction not found");
  const invalid = validateTxPatch({
    type: String(curRow.type ?? ""), paymentStatus: String(curRow.payment_status ?? ""), scope: String(curRow.scope ?? "project"), projectId: (curRow.project_id as string | null) ?? null,
    expenseScope: String(curRow.expense_scope ?? ""), currency: String(curRow.currency ?? "₪"), amount: Number(curRow.amount) || 0, linkedSessionId: String(curRow.linked_session_id ?? ""),
  }, body);
  if (invalid) throw new FinanceInputError(invalid);
  if (body.project_id && body.project_id !== curRow.project_id) {
    const { data: proj, error: pErr } = await supabase.from("projects").select("id").eq("id", body.project_id).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!proj) throw new FinanceInputError("הפרויקט לא נמצא");
  }
  const patch: Record<string, unknown> = {};
  if (body.date !== undefined) patch.date = body.date || null;
  if (body.description !== undefined) patch.description = body.description;
  if (body.artist !== undefined) patch.artist = body.artist;
  if (body.amount !== undefined) patch.amount = Number(body.amount);
  if (body.currency !== undefined) patch.currency = body.currency;
  if (body.paymentStatus !== undefined) patch.payment_status = body.paymentStatus;
  if (body.paymentMethod !== undefined) patch.payment_method = body.paymentMethod;
  if (body.receiptRef !== undefined) patch.receipt_ref = body.receiptRef;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.category !== undefined) patch.category = body.category;
  if (body.type !== undefined) patch.type = body.type;
  if (body.scope !== undefined) patch.scope = body.scope;
  if (body.project_id !== undefined) patch.project_id = body.project_id;
  if (body.linkedSessionId !== undefined) patch.linked_session_id = body.linkedSessionId;
  if (body.expenseScope !== undefined) patch.expense_scope = body.expenseScope;
  const unitRelevant = ["type", "scope", "project_id", "expense_scope", "category"].some((k) => k in patch);
  let data: Record<string, unknown> | null = null;
  if (Object.keys(patch).length) {
    const r = await supabase.from("transactions").update(patch).eq("id", id).select().single();
    if (r.error) throw new Error(r.error.message);
    data = r.data as Record<string, unknown>;
    // Owner decision 2026-10-03: a Finance edit that moves an expense to שולם may be the DJ's payment (a show's DJ_FEE row) —
    // the ONE shared notification point decides (a real not-paid → שולם transition of a DJ_FEE row only; never throws,
    // never touches the money, a push problem is only logged).
    if (patch.payment_status === "שולם" && String(curRow.payment_status ?? "") !== "שולם" && String(curRow.type ?? "") === "expense") {
      try {
        const { notifyDjFeePaid } = await import("@/lib/dj-payment-notify");
        await notifyDjFeePaid({ txId: id, before: String(curRow.payment_status ?? "") });
      } catch (e) { console.error("[finance] DJ payment notification failed (the payment is unaffected):", e instanceof Error ? e.message : e); }
    }
  }
  // business unit (task 4): an explicit choice is the Owner's decision; otherwise only a RULE / unclassified unit is
  // re-derived after a relevant field change — OWNER_DECISION / HISTORICAL_APPROVED are never overwritten
  if (body.businessUnit !== undefined) {
    if (!(await setTransactionUnit(id, body.businessUnit))) throw new FinanceInputError("transaction not found");
  } else if (unitRelevant) await recomputeUnitIfRule(id);
  if (body.businessUnit !== undefined || unitRelevant || !data) {
    const r = await supabase.from("transactions").select().eq("id", id).single();
    if (r.error) throw new Error(r.error.message);
    data = r.data as Record<string, unknown>;
  }
  const pid = (data as { project_id?: string | null }).project_id;
  if (pid) touchProject(pid).catch(() => {});
  // A9 (2026-09-29): the linked clip row mirrors the transaction BOTH ways, awaited and checked — actual money (an expense
  // only when שולם) → "שולם"; back to not paid → "הועבר לכספים" (the promoted state). A cancelled clip row is never revived.
  if (patch.payment_status) await syncClipItemPaidMirror(id, data as { type?: string | null; payment_status?: string | null });
  // amount / status / unit / project changed → the artist's share follows (the SAME ledger row, never a second one)
  await syncExpenseShareOrFail(id);
  return data as Record<string, unknown>;
}

/** The clip planning row linked to a transaction follows its paid state (A9). A failure fails the edit (never silent). */
export async function syncClipItemPaidMirror(txId: string, tx: { type?: string | null; payment_status?: string | null }): Promise<void> {
  const paid = isActualMoneyTx(tx);
  const q = supabase.from("clip_items").update({ status: paid ? "שולם" : "הועבר לכספים", updated_at: new Date().toISOString() }).eq("linked_transaction_id", txId);
  const { error } = paid ? await q.eq("status", "הועבר לכספים") : await q.eq("status", "שולם");
  if (error) throw new Error(`התנועה עודכנה, אבל שורת תכנון הקליפ לא סונכרנה (${error.message}) — שמור שוב כדי להשלים`);
}

/** DELETE /api/transactions/[id] semantics. */
export async function deleteTransactionRecord(id: string): Promise<void> {
  const { data: tx } = await supabase.from("transactions").select("project_id").eq("id", id).single();
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  // a share row of the deleted expense stops counting (kept at 0 with the reason — never deleted)
  await syncExpenseShareOrFail(id);
  const delPid = (tx as { project_id?: string | null } | null)?.project_id;
  if (delPid) touchProject(delPid).catch(() => {});
}

/** POST /api/transactions/[id]/split — the atomic, row-locked split RPC (guards double split). */
export async function splitIncome(id: string, paid: number, receivedDate: string | null, paymentMethod: string): Promise<{ status: "ok"; result: Record<string, unknown> } | { status: "error"; code: string | undefined; message: string }> {
  const { data, error } = await supabase.rpc("split_income_transaction", { p_id: id, p_paid: paid, p_received_date: receivedDate, p_payment_method: paymentMethod });
  if (error) return { status: "error", code: error.code, message: error.message };
  // the RPC inserts the remainder without a unit — it inherits the original row's unit + source (never a guess)
  await copyUnitToSplitRows(id, data).catch((e) => console.warn("[finance] split: unit not copied —", e instanceof Error ? e.message : e));
  const { data: tx } = await supabase.from("transactions").select("project_id").eq("id", id).maybeSingle();
  const pid = (tx as { project_id?: string | null } | null)?.project_id;
  if (pid) touchProject(pid).catch(() => {});
  return { status: "ok", result: (data ?? {}) as Record<string, unknown> };
}

export interface FinanceSettingsPatch { agreedPrice?: number | string; currency?: string; financialNotes?: string; financeException?: boolean; financeExceptionReason?: string; financeExceptionDate?: string }
/** PATCH /api/transactions?type=settings semantics: compare-and-swap merge into finance_<project> (lib/writes/settings-merge). */
export async function setFinanceSettings(projectId: string, b: FinanceSettingsPatch): Promise<Record<string, unknown>> {
  const patch = {
    ...(b.agreedPrice !== undefined ? { agreedPrice: Number(b.agreedPrice) } : {}),
    ...(b.currency !== undefined ? { currency: b.currency } : {}),
    ...(b.financialNotes !== undefined ? { financialNotes: b.financialNotes } : {}),
    ...(b.financeException !== undefined ? { financeException: Boolean(b.financeException) } : {}),
    ...(b.financeExceptionReason !== undefined ? { financeExceptionReason: b.financeExceptionReason } : {}),
    ...(b.financeExceptionDate !== undefined ? { financeExceptionDate: b.financeExceptionDate } : {}),
  };
  // a concurrent writer of the same blob (the clip production marker, notes …) is never overwritten
  return mergeSettingsKey(`finance_${projectId}`, patch);
}

export async function readFinanceSettings(projectId: string): Promise<{ agreedPrice: number; currency: string; financialNotes: string; financeException: boolean; financeExceptionReason: string; financeExceptionDate: string }> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", `finance_${projectId}`).maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data?.value ?? {}) as Record<string, unknown>;
  return { agreedPrice: Number(v.agreedPrice ?? 0), currency: String(v.currency ?? "₪"), financialNotes: String(v.financialNotes ?? ""), financeException: v.financeException === true, financeExceptionReason: String(v.financeExceptionReason ?? ""), financeExceptionDate: String(v.financeExceptionDate ?? "") };
}

export interface TransactionView { projectId: string | null; scope: string; type: string; date: string | null; description: string; artist: string; amount: number; currency: string; paymentStatus: string; paymentMethod: string; receiptRef: string; notes: string; category: string; expenseScope: string; linkedSessionId: string; businessUnit: string | null; businessUnitSource: string | null }
export async function readTransaction(id: string): Promise<TransactionView | null> {
  const { data, error } = await supabase.from("transactions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { projectId: data.project_id ?? null, scope: data.scope ?? "project", type: data.type ?? "", date: data.date ?? null, description: data.description ?? "", artist: data.artist ?? "", amount: Number(data.amount) || 0, currency: data.currency ?? "₪", paymentStatus: data.payment_status ?? "", paymentMethod: data.payment_method ?? "", receiptRef: data.receipt_ref ?? "", notes: data.notes ?? "", category: data.category ?? "", expenseScope: data.expense_scope ?? "", linkedSessionId: data.linked_session_id ?? "", businessUnit: data.business_unit ?? null, businessUnitSource: data.business_unit_source ?? null };
}

/** Link facts for many transactions at once (batch — never one query per row). `ids` null = every transaction. */
export async function readOwnerLinks(txs: ReadonlyArray<{ id: string; show_id?: string | null; show_money_role?: string | null; linked_session_id?: string | null }>): Promise<Map<string, TxOwnerLinks>> {
  const out = new Map<string, TxOwnerLinks>();
  for (const t of txs) out.set(t.id, { showId: t.show_id ?? null, showMoneyRole: t.show_money_role ?? null, linkedSessionId: t.linked_session_id ?? null });
  if (!txs.length) return out;
  const few = txs.length <= 100 ? txs.map((t) => t.id) : null; // small sets filter by id; big ones read the (small) link tables whole
  const linked = async (table: string, col: string): Promise<string[]> => {
    let q = supabase.from(table).select(col).not(col, "is", null);
    if (few) q = q.in(col, few);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => String(r[col]));
  };
  const mark = (list: string[], set: (l: TxOwnerLinks) => void) => { for (const id of list) { const l = out.get(id); if (l) set(l); } };
  mark(await linked("shows", "linked_income_transaction_id"), (l) => { l.legacyShowRole = "SHOW_PAYMENT"; });
  mark(await linked("shows", "linked_dj_expense_transaction_id"), (l) => { l.legacyShowRole = "DJ_FEE"; });
  mark(await linked("shows", "linked_artist_expense_transaction_id"), (l) => { l.legacyShowRole = "ARTIST_FEE"; });
  mark(await linked("sound_engineer_work", "linked_transaction_id"), (l) => { l.mixWork = true; });
  mark(await linked("clip_items", "linked_transaction_id"), (l) => { l.clipRow = true; });
  mark(await linked("red_films_budget_items", "linked_transaction_id"), (l) => { l.rfBudget = true; });
  mark(await linked("red_films_budget_payments", "linked_transaction_id"), (l) => { l.rfPayment = true; }); // DB-1: a payment's ONE Finance expense
  mark(await linked("social_promotions", "linked_transaction_id"), (l) => { l.promotion = true; });
  return out;
}
/** Owners for many transaction rows (the Finance list GET) — one batch of link reads. */
export async function financeOwnersFor(txs: ReadonlyArray<{ id: string; show_id?: string | null; show_money_role?: string | null; linked_session_id?: string | null }>): Promise<Map<string, FinanceOwnerCode | null>> {
  const links = await readOwnerLinks(txs);
  return new Map([...links].map(([id, l]) => [id, ownerFromLinks(l)]));
}
/** Which Redbloods writer owns this transaction (its sync re-writes it), or null for a free-standing row. */
export async function financeOwnerOf(id: string): Promise<FinanceOwnerCode | null> {
  const { data, error } = await supabase.from("transactions").select("id, show_id, show_money_role, linked_session_id").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return (await financeOwnersFor([data as { id: string }])).get(id) ?? null;
}

export class TransactionOwnedError extends Error {
  readonly status = 409;
  constructor(readonly verdict: Extract<TxEditVerdict, { ok: false }>) { super(verdict.messageHe); }
}
/** THE server guard (Finance route AND Sunny's finance writers): an owned row is never deleted from Finance, and only
 *  its owner's allowed fields may really change (lib/finance/ownership). Throws TransactionOwnedError (→ 409). */
export async function assertTransactionEditable(id: string, op: "delete" | Readonly<Record<string, unknown>>): Promise<void> {
  const owner = await financeOwnerOf(id);
  if (!owner) return;
  let fields: TxPatchField[] | "delete" = "delete";
  if (op !== "delete") {
    const { data, error } = await supabase.from("transactions").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return; // the writer reports the missing row
    const cur: TxCurrent = { date: data.date ?? null, description: data.description ?? "", artist: data.artist ?? "", amount: Number(data.amount) || 0, currency: data.currency ?? "₪", paymentStatus: data.payment_status ?? "", paymentMethod: data.payment_method ?? "", receiptRef: data.receipt_ref ?? "", notes: data.notes ?? "", category: data.category ?? "", type: data.type ?? "", scope: data.scope ?? "project", project_id: data.project_id ?? null, linkedSessionId: data.linked_session_id ?? "", expenseScope: data.expense_scope ?? "" };
    fields = changedTxFields(cur, op);
  }
  const v = transactionEditVerdict(owner, fields, op !== "delete" && typeof op.paymentStatus === "string" ? op.paymentStatus : null);
  if (!v.ok) throw new TransactionOwnedError(v);
}

