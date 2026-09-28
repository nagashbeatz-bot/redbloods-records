import "server-only";
import { supabase } from "@/lib/supabase";
import { unitColumnsOrUnclassified } from "@/lib/writes/business-unit";

/**
 * Social "קידום ותקציב" (promotion/budget) store.
 *
 * MONEY MODEL — transactions stay the single source of truth for actual spend:
 *   • social_promotions holds ONLY the planning row (planned_amount, channel,
 *     type, status, …). There is NO actual_amount column here.
 *   • The actual expense is a real Finance `transactions` row, linked from the
 *     promotion via linked_transaction_id. actual = transaction.amount (0 when
 *     not linked).
 *   • Entering an actual spend > 0 the first time creates exactly ONE tx and
 *     links it (CAS-guarded against double-create / races). Later edits PATCH
 *     that same tx amount — never a second tx.
 *   • Deleting a promotion never deletes its transaction. SAFE DETACH (A5 2026-09-27): before the row goes, a
 *     provenance marker `[קידום נמחק YYYY-MM-DD: name · channel]` is APPENDED to the transaction's notes; if that
 *     write fails the delete is aborted. A campaign delete (DB cascade) detaches every promotion the same way first.
 *   • ACTUAL SPEND = the linked transaction's amount ONLY when its payment_status is שולם, in ITS currency — an
 *     unpaid / cancelled transaction is not spend, and currencies are never added.
 *
 * Mirrors the existing clip_items / shows linked-transaction pattern.
 */

const TABLE = "social_promotions";

export interface SocialPromotion {
  id: string;
  campaign_id: string;
  channel: string;
  promo_type: string;
  name: string;
  planned_amount: number;
  status: string;
  promo_date: string | null;
  notes: string;
  linked_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromotionWithActual extends SocialPromotion {
  actual_amount: number;            // PAID spend: the linked transaction's amount only when שולם (0 otherwise / unlinked)
  actual_currency: string;          // the linked transaction's currency (₪ when unlinked) — never added across currencies
  linked_amount: number;            // the linked transaction's raw amount, whatever its status (the edit value)
  linked_status: string | null;     // the linked transaction's payment_status (null when unlinked)
}

/** The one promotion-spend rule (pure): paid only, per currency. Shared by the social screen, lib/writes/social and tests. */
export const PROMO_SPEND_PAID_STATUS = "שולם";
export function promotionSpend(tx: { amount?: unknown; currency?: unknown; payment_status?: unknown } | null | undefined): { amount: number; currency: string; paid: boolean; linkedAmount: number; status: string | null } {
  if (!tx) return { amount: 0, currency: "₪", paid: false, linkedAmount: 0, status: null };
  const linkedAmount = Number(tx.amount) || 0;
  const paid = tx.payment_status === PROMO_SPEND_PAID_STATUS;
  return { amount: paid ? linkedAmount : 0, currency: typeof tx.currency === "string" && tx.currency ? tx.currency : "₪", paid, linkedAmount, status: typeof tx.payment_status === "string" ? tx.payment_status : null };
}
/** Σ paid spend per currency (never one mixed total). */
export function promotionSpendByCurrency(rows: ReadonlyArray<{ actual_amount: number; actual_currency: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.actual_amount) out[r.actual_currency] = (out[r.actual_currency] ?? 0) + r.actual_amount;
  return out;
}

// ── Read ─────────────────────────────────────────────────────────────────────
export async function listPromotions(campaignId: string): Promise<PromotionWithActual[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as SocialPromotion[];

  // Derive actual spend from the linked transactions (source of truth): PAID only, per currency.
  const txIds = rows.map(r => r.linked_transaction_id).filter((x): x is string => !!x);
  const txById: Record<string, { amount: unknown; currency: unknown; payment_status: unknown }> = {};
  if (txIds.length > 0) {
    const { data: txs, error: txErr } = await supabase
      .from("transactions")
      .select("id, amount, currency, payment_status")
      .in("id", txIds);
    if (txErr) throw txErr;
    for (const t of (txs ?? []) as { id: string; amount: unknown; currency: unknown; payment_status: unknown }[]) txById[t.id] = t;
  }

  return rows.map(r => {
    const sp = promotionSpend(r.linked_transaction_id ? txById[r.linked_transaction_id] : null);
    return { ...r, actual_amount: sp.amount, actual_currency: sp.currency, linked_amount: sp.linkedAmount, linked_status: sp.status };
  });
}

// Campaign-level total promotion budget (planning only — never a transaction).
export async function getCampaignPromotionBudget(campaignId: string): Promise<number> {
  const { data } = await supabase
    .from("social_campaigns")
    .select("promotion_budget")
    .eq("id", campaignId)
    .maybeSingle();
  return Number((data as { promotion_budget?: number } | null)?.promotion_budget ?? 0) || 0;
}

// ── Create / update planning fields ──────────────────────────────────────────
export async function createPromotion(input: {
  campaign_id: string; channel: string; promo_type: string; name: string;
  planned_amount: number; status: string; promo_date: string | null; notes: string;
}): Promise<SocialPromotion> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      campaign_id:    input.campaign_id,
      channel:        input.channel,
      promo_type:     input.promo_type,
      name:           input.name,
      planned_amount: input.planned_amount,
      status:         input.status,
      promo_date:     input.promo_date,
      notes:          input.notes,
    })
    .select()
    .single();
  if (error) throw error;
  return data as SocialPromotion;
}

export async function updatePromotionFields(id: string, patch: Partial<{
  channel: string; promo_type: string; name: string; planned_amount: number;
  status: string; promo_date: string | null; notes: string;
}>): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** The provenance marker appended to a kept transaction when its promotion is deleted (pure). */
export function promotionDeletedMarker(p: { name?: string | null; channel?: string | null }, ymd: string): string {
  const name = (p.name ?? "").trim() || "פעולת קידום";
  return `[קידום נמחק ${ymd}: ${name}${p.channel ? ` · ${p.channel}` : ""}]`;
}
const todayYmd = () => new Date().toISOString().slice(0, 10);

/** SAFE DETACH: append the provenance marker to the linked transaction's notes (never overwrite). Throws on any failure
 *  (including a 0-row update) so the caller aborts the delete. A transaction that no longer exists needs no marker. */
export async function markPromotionTransactionDetached(promo: Pick<SocialPromotion, "linked_transaction_id" | "name" | "channel">): Promise<"marked" | "no_tx"> {
  if (!promo.linked_transaction_id) return "no_tx";
  const { data: tx, error: rErr } = await supabase.from("transactions").select("id, notes").eq("id", promo.linked_transaction_id).maybeSingle();
  if (rErr) throw rErr;
  if (!tx) return "no_tx";
  const marker = promotionDeletedMarker(promo, todayYmd());
  const cur = String((tx as { notes?: string | null }).notes ?? "");
  if (cur.includes(marker)) return "marked";
  const notes = cur.trim() ? `${cur.trimEnd()}\n${marker}` : marker;
  const { data: upd, error: uErr } = await supabase.from("transactions").update({ notes, updated_at: new Date().toISOString() }).eq("id", promo.linked_transaction_id).select("id");
  if (uErr) throw uErr;
  if (!upd || upd.length !== 1) throw new Error("סימון המקור ברשומה הכספית נכשל — הקידום לא נמחק");
  return "marked";
}

export async function deletePromotion(id: string): Promise<void> {
  // Removes ONLY the planning row — a linked transaction stays in Finance, marked with where it came from.
  const { data: row, error: rErr } = await supabase.from(TABLE).select("id, linked_transaction_id, name, channel").eq("id", id).maybeSingle();
  if (rErr) throw rErr;
  if (!row) return;
  await markPromotionTransactionDetached(row as SocialPromotion); // aborts the delete on failure
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}

/** Before a campaign is deleted (its promotions cascade): mark every linked transaction; any failure aborts. */
export async function detachCampaignPromotions(campaignId: string): Promise<{ promotions: number; marked: number }> {
  const { data, error } = await supabase.from(TABLE).select("id, linked_transaction_id, name, channel").eq("campaign_id", campaignId);
  if (error) throw error;
  let marked = 0;
  for (const p of (data ?? []) as SocialPromotion[]) if ((await markPromotionTransactionDetached(p)) === "marked") marked++;
  return { promotions: (data ?? []).length, marked };
}

// ── Finance sync — actual spend ↔ a single real transaction ───────────────────
function expenseDescription(promo: SocialPromotion): string {
  const base = promo.name?.trim() || "פעולת קידום";
  return `קידום: ${base}${promo.channel ? ` · ${promo.channel}` : ""}`;
}

/**
 * Materialise the actual spend of a promotion as one real Finance transaction.
 * - already linked → PATCH that transaction's amount (never a second tx)
 * - not linked & amount > 0 → create a tx and CAS-link it (idempotent)
 * - not linked & amount <= 0 → nothing
 */
export async function syncActualExpense(promotionId: string, actualAmount: number): Promise<void> {
  const { data: promoRow, error: readErr } = await supabase
    .from(TABLE).select("*").eq("id", promotionId).single();
  if (readErr || !promoRow) throw readErr ?? new Error("promotion not found");
  const promo = promoRow as SocialPromotion;

  const amount = Math.max(0, Number(actualAmount) || 0);

  // Already linked → update the existing transaction only.
  if (promo.linked_transaction_id) {
    const { data: upd, error } = await supabase
      .from("transactions")
      .update({ amount, description: expenseDescription(promo) })
      .eq("id", promo.linked_transaction_id)
      .select("id");
    if (error) throw error;
    // 0 rows = the linked transaction is gone — never report a sync that did not happen
    if (!upd || upd.length !== 1) throw new Error("ההוצאה המקושרת בכספים לא נמצאה — הסכום לא עודכן");
    await (await import("@/lib/writes/artist-expense-share")).syncExpenseShareSafe(promo.linked_transaction_id);
    return;
  }

  // Nothing spent yet and nothing to link.
  if (amount <= 0) return;

  // Derive project attribution SERVER-SIDE from the campaign (never trust client).
  const { data: camp } = await supabase
    .from("social_campaigns").select("project_id").eq("id", promo.campaign_id).maybeSingle();
  const projectId = ((camp?.project_id as string | null) ?? null) || null;

  // business unit (task 4): a promotion of a Records (label) project → RECORDS; anything else stays "דורש סיווג"
  const unit = await unitColumnsOrUnclassified({ writer: "PROMOTION", type: "expense", category: promo.channel || "", expenseScope: "שיווק", projectId });
  // Create the transaction (source of truth for the spend).
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({
      ...unit,
      project_id:        projectId,
      scope:             projectId ? "project" : "general",
      type:              "expense",
      date:              promo.promo_date || null,
      description:       expenseDescription(promo),
      artist:            "",
      amount,
      currency:          "₪",
      payment_status:    "שולם",
      payment_method:    "",
      receipt_ref:       "",
      notes:             promo.notes || "",
      category:          promo.channel || "",
      linked_session_id: "",
      expense_scope:     "שיווק",
    })
    .select("id")
    .single();
  if (txErr || !tx) throw txErr ?? new Error("failed to create transaction");

  // CAS: link only if still unlinked — guards double-click / concurrent creates.
  const { data: casRows, error: casErr } = await supabase
    .from(TABLE)
    .update({ linked_transaction_id: tx.id, updated_at: new Date().toISOString() })
    .eq("id", promotionId)
    .is("linked_transaction_id", null)
    .select("id");

  if (casErr) {
    const { error: rbErr } = await supabase.from("transactions").delete().eq("id", tx.id); // roll back the orphan
    if (rbErr) throw new Error(`קישור ההוצאה נכשל (${casErr.message}) וגם ביטול ההוצאה שנוצרה נכשל (${rbErr.message}) — יש לבדוק בכספים את הרשומה ${tx.id}`);
    throw casErr;
  }
  if (!casRows || casRows.length === 0) {
    // Lost the race — drop our duplicate tx and update the winner instead.
    const { error: rbErr } = await supabase.from("transactions").delete().eq("id", tx.id);
    if (rbErr) throw new Error(`ביטול ההוצאה הכפולה נכשל (${rbErr.message}) — יש לבדוק בכספים את הרשומה ${tx.id}`);
    const { data: fresh, error: fErr } = await supabase
      .from(TABLE).select("linked_transaction_id").eq("id", promotionId).single();
    if (fErr) throw fErr;
    const winnerTx = (fresh?.linked_transaction_id as string | null) ?? null;
    if (winnerTx) {
      const { data: w, error: wErr } = await supabase.from("transactions")
        .update({ amount, description: expenseDescription(promo) })
        .eq("id", winnerTx)
        .select("id");
      if (wErr) throw wErr;
      if (!w || w.length !== 1) throw new Error("ההוצאה המקושרת בכספים לא נמצאה — הסכום לא עודכן");
      await (await import("@/lib/writes/artist-expense-share")).syncExpenseShareSafe(winnerTx);
    }
    return;
  }
  // linked (the CAS won) → the artist's share of this Records promotion follows (task 6)
  await (await import("@/lib/writes/artist-expense-share")).syncExpenseShareSafe(String(tx.id));
}
