import "server-only";
import { supabase } from "@/lib/supabase";

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
 *   • Deleting a promotion never deletes its transaction.
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
  actual_amount: number; // derived from the linked transaction (0 when unlinked)
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

  // Derive actual spend from the linked transactions (source of truth).
  const txIds = rows.map(r => r.linked_transaction_id).filter((x): x is string => !!x);
  const amountById: Record<string, number> = {};
  if (txIds.length > 0) {
    const { data: txs } = await supabase
      .from("transactions")
      .select("id, amount")
      .in("id", txIds);
    for (const t of (txs ?? []) as { id: string; amount: number }[]) {
      amountById[t.id] = Number(t.amount) || 0;
    }
  }

  return rows.map(r => ({
    ...r,
    actual_amount: r.linked_transaction_id ? (amountById[r.linked_transaction_id] ?? 0) : 0,
  }));
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

export async function deletePromotion(id: string): Promise<void> {
  // Removes ONLY the planning row — a linked transaction stays in Finance.
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
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
    const { error } = await supabase
      .from("transactions")
      .update({ amount, description: expenseDescription(promo) })
      .eq("id", promo.linked_transaction_id);
    if (error) throw error;
    return;
  }

  // Nothing spent yet and nothing to link.
  if (amount <= 0) return;

  // Derive project attribution SERVER-SIDE from the campaign (never trust client).
  const { data: camp } = await supabase
    .from("social_campaigns").select("project_id").eq("id", promo.campaign_id).maybeSingle();
  const projectId = ((camp?.project_id as string | null) ?? null) || null;

  // Create the transaction (source of truth for the spend).
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({
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
    await supabase.from("transactions").delete().eq("id", tx.id); // roll back the orphan
    throw casErr;
  }
  if (!casRows || casRows.length === 0) {
    // Lost the race — drop our duplicate tx and update the winner instead.
    await supabase.from("transactions").delete().eq("id", tx.id);
    const { data: fresh } = await supabase
      .from(TABLE).select("linked_transaction_id").eq("id", promotionId).single();
    const winnerTx = (fresh?.linked_transaction_id as string | null) ?? null;
    if (winnerTx) {
      await supabase.from("transactions")
        .update({ amount, description: expenseDescription(promo) })
        .eq("id", winnerTx);
    }
  }
}
