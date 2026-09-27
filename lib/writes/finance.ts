/**
 * Shared finance writers — used by BOTH the transaction routes and Sunny's typed primitives. The route semantics are
 * kept exactly (create defaults, field-level edit, clip-row sync on paid, delete, the atomic split RPC, the merged
 * finance settings upsert). Canonical rules are NOT restated here: received = שולם / התקבל (lib/finance/classify.ts),
 * an expense is paid only when שולם, currencies are never added.
 *
 * `financeOwnerOf` names the Redbloods writer that OWNS a transaction (a show's income / DJ / artist rows, a mix
 * work's payment row, a clip planning row, a Red Films budget line). Those rows are re-written by their owner's sync,
 * so Sunny edits / deletes them only through that family's action — never directly (they would be silently undone).
 */
import { supabase } from "@/lib/supabase";
import { touchProject } from "@/lib/projects-store";

export interface TransactionInput {
  projectId?: string | null; scope?: string | null; type: string; date?: string | null; description?: string | null; artist?: string | null;
  amount?: number | string | null; currency?: string | null; paymentStatus?: string | null; paymentMethod?: string | null; receiptRef?: string | null;
  notes?: string | null; category?: string | null; linkedSessionId?: string | null; expenseScope?: string | null;
}
export class FinanceInputError extends Error {}

/** POST /api/transactions semantics. */
export async function createTransactionRecord(b: TransactionInput): Promise<Record<string, unknown>> {
  const txScope = b.scope ?? "project";
  if (!b.type) throw new FinanceInputError("type required");
  if (txScope === "project" && !b.projectId) throw new FinanceInputError("projectId required for project-scoped transactions");
  const { data, error } = await supabase.from("transactions").insert({
    project_id: txScope === "general" ? null : (b.projectId || null), scope: txScope, type: b.type, date: b.date || null,
    description: b.description || "", artist: b.artist || "", amount: Number(b.amount) || 0, currency: b.currency || "₪",
    payment_status: b.paymentStatus || "צפוי", payment_method: b.paymentMethod || "", receipt_ref: b.receiptRef || "", notes: b.notes || "",
    category: b.category || "", linked_session_id: b.linkedSessionId || "", expense_scope: b.type === "expense" ? (b.expenseScope || "כללי") : "כללי",
  }).select().single();
  if (error) throw new Error(error.message);
  if (txScope === "project" && b.projectId) touchProject(b.projectId).catch(() => {});
  return data as Record<string, unknown>;
}

export interface TransactionPatch {
  date?: string | null; description?: string; artist?: string; amount?: number | string; currency?: string; paymentStatus?: string; paymentMethod?: string;
  receiptRef?: string; notes?: string; category?: string; type?: string; scope?: string; project_id?: string | null; linkedSessionId?: string; expenseScope?: string;
}
const PAID_STATUSES = new Set(["שולם", "התקבל"]);

/** PATCH /api/transactions/[id] semantics (field-level; a paid status marks a linked clip row שולם). */
export async function updateTransactionRecord(id: string, body: TransactionPatch): Promise<Record<string, unknown>> {
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
  const { data, error } = await supabase.from("transactions").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  const pid = (data as { project_id?: string | null }).project_id;
  if (pid) touchProject(pid).catch(() => {});
  if (patch.payment_status && PAID_STATUSES.has(patch.payment_status as string)) {
    supabase.from("clip_items").update({ status: "שולם", updated_at: new Date().toISOString() }).eq("linked_transaction_id", id).then(() => {}, () => {});
  }
  return data as Record<string, unknown>;
}

/** DELETE /api/transactions/[id] semantics. */
export async function deleteTransactionRecord(id: string): Promise<void> {
  const { data: tx } = await supabase.from("transactions").select("project_id").eq("id", id).single();
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  const delPid = (tx as { project_id?: string | null } | null)?.project_id;
  if (delPid) touchProject(delPid).catch(() => {});
}

/** POST /api/transactions/[id]/split — the atomic, row-locked split RPC (guards double split). */
export async function splitIncome(id: string, paid: number, receivedDate: string | null, paymentMethod: string): Promise<{ status: "ok"; result: Record<string, unknown> } | { status: "error"; code: string | undefined; message: string }> {
  const { data, error } = await supabase.rpc("split_income_transaction", { p_id: id, p_paid: paid, p_received_date: receivedDate, p_payment_method: paymentMethod });
  if (error) return { status: "error", code: error.code, message: error.message };
  const { data: tx } = await supabase.from("transactions").select("project_id").eq("id", id).maybeSingle();
  const pid = (tx as { project_id?: string | null } | null)?.project_id;
  if (pid) touchProject(pid).catch(() => {});
  return { status: "ok", result: (data ?? {}) as Record<string, unknown> };
}

export interface FinanceSettingsPatch { agreedPrice?: number | string; currency?: string; financialNotes?: string; financeException?: boolean; financeExceptionReason?: string; financeExceptionDate?: string }
/** PATCH /api/transactions?type=settings semantics: merge into finance_<project>. */
export async function setFinanceSettings(projectId: string, b: FinanceSettingsPatch): Promise<Record<string, unknown>> {
  const { data: existing } = await supabase.from("settings").select("value").eq("key", `finance_${projectId}`).maybeSingle();
  const cur = (existing?.value ?? {}) as Record<string, unknown>;
  const merged = {
    ...cur,
    ...(b.agreedPrice !== undefined ? { agreedPrice: Number(b.agreedPrice) } : {}),
    ...(b.currency !== undefined ? { currency: b.currency } : {}),
    ...(b.financialNotes !== undefined ? { financialNotes: b.financialNotes } : {}),
    ...(b.financeException !== undefined ? { financeException: Boolean(b.financeException) } : {}),
    ...(b.financeExceptionReason !== undefined ? { financeExceptionReason: b.financeExceptionReason } : {}),
    ...(b.financeExceptionDate !== undefined ? { financeExceptionDate: b.financeExceptionDate } : {}),
  };
  const { error } = await supabase.from("settings").upsert({ key: `finance_${projectId}`, value: merged }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return merged;
}
export async function readFinanceSettings(projectId: string): Promise<{ agreedPrice: number; currency: string; financialNotes: string; financeException: boolean; financeExceptionReason: string; financeExceptionDate: string }> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", `finance_${projectId}`).maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data?.value ?? {}) as Record<string, unknown>;
  return { agreedPrice: Number(v.agreedPrice ?? 0), currency: String(v.currency ?? "₪"), financialNotes: String(v.financialNotes ?? ""), financeException: v.financeException === true, financeExceptionReason: String(v.financeExceptionReason ?? ""), financeExceptionDate: String(v.financeExceptionDate ?? "") };
}

export interface TransactionView { projectId: string | null; scope: string; type: string; date: string | null; description: string; artist: string; amount: number; currency: string; paymentStatus: string; paymentMethod: string; receiptRef: string; notes: string; category: string; expenseScope: string; linkedSessionId: string }
export async function readTransaction(id: string): Promise<TransactionView | null> {
  const { data, error } = await supabase.from("transactions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { projectId: data.project_id ?? null, scope: data.scope ?? "project", type: data.type ?? "", date: data.date ?? null, description: data.description ?? "", artist: data.artist ?? "", amount: Number(data.amount) || 0, currency: data.currency ?? "₪", paymentStatus: data.payment_status ?? "", paymentMethod: data.payment_method ?? "", receiptRef: data.receipt_ref ?? "", notes: data.notes ?? "", category: data.category ?? "", expenseScope: data.expense_scope ?? "", linkedSessionId: data.linked_session_id ?? "" };
}

/** Which Redbloods writer owns this transaction (its sync re-writes it), or null for a free-standing row. */
export async function financeOwnerOf(id: string): Promise<"SHOW" | "MIX_WORK" | "CLIP_ROW" | "RF_BUDGET" | null> {
  const probes: Array<[string, string, "SHOW" | "MIX_WORK" | "CLIP_ROW" | "RF_BUDGET"]> = [
    ["shows", "linked_income_transaction_id", "SHOW"], ["shows", "linked_dj_expense_transaction_id", "SHOW"], ["shows", "linked_artist_expense_transaction_id", "SHOW"],
    ["sound_engineer_work", "linked_transaction_id", "MIX_WORK"], ["clip_items", "linked_transaction_id", "CLIP_ROW"], ["red_films_budget_items", "linked_transaction_id", "RF_BUDGET"],
  ];
  for (const [table, col, owner] of probes) {
    const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(col, id);
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) return owner;
  }
  return null;
}

/** Rows with the same project, type, amount, currency and date (duplicate warning before a create). */
export async function countSimilarTransactions(t: { projectId: string | null; type: string; amount: number; currency: string; date: string }): Promise<number> {
  let q = supabase.from("transactions").select("id", { count: "exact", head: true }).eq("type", t.type).eq("amount", t.amount).eq("currency", t.currency).eq("date", t.date);
  q = t.projectId ? q.eq("project_id", t.projectId) : q.is("project_id", null);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}
