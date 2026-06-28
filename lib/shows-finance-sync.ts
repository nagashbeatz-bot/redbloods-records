import "server-only";
import { supabase } from "@/lib/supabase";
import type { Show } from "@/lib/shows-types";
import { computeShowSplit } from "@/lib/shows-types";

// Confirmed bookings only — leads (ליד חדש / ממתין לתשובה / צריך פולואפ) are
// pipeline and must NOT create Finance transactions.
const CONFIRMED_STATUSES = new Set(["נסגר", "אושרה", "בוצע"]);

/**
 * Phase 1: keep a show's canonical Finance transactions in sync with its state.
 *
 *  • payment_status "שולם"  → income "התקבל" (+ dj expense "שולם" if dj_fee > 0)
 *  • reverted to "לא שולם"/"חלקי" → linked income "צפוי", linked dj "לא שולם"
 *  • status "בוטל" (or delete) → linked transactions "בוטל"
 *
 * Exactly one income + one expense per show, keyed by the stored linked_* ids
 * on the show row, so re-running can never create duplicates. Never deletes a
 * transaction — only updates its payment_status. All errors are non-fatal so a
 * sync failure never breaks the show save.
 */

function displayName(s: Show): string {
  return s.artist ? `${s.name} (${s.artist})` : s.name;
}

function djDescription(s: Show): string {
  return s.dj_name ? `שכר דיג'יי — ${s.dj_name} (${s.name})` : `שכר דיג'יי (${s.name})`;
}

function artistDescription(s: Show): string {
  return s.artist ? `שכר אמן — ${s.artist} (${s.name})` : `שכר אמן (${s.name})`;
}

async function createTransaction(fields: {
  type: "income" | "expense";
  payment_status: string;
  amount: number;
  date: string | null;
  description: string;
  category: string;
  notes: string;
  artist?: string;
  expense_scope?: string;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      project_id:        null,
      scope:             "general",
      type:              fields.type,
      date:              fields.date || null,
      description:       fields.description,
      artist:            fields.artist ?? "",
      amount:            Number(fields.amount) || 0,
      currency:          "₪",
      payment_status:    fields.payment_status,
      payment_method:    "",
      receipt_ref:       "",
      notes:             fields.notes,
      category:          fields.category,
      linked_session_id: "",
      expense_scope:     fields.expense_scope ?? "כללי",
    })
    .select("id")
    .single();
  if (error) {
    console.error("[shows-finance-sync] create transaction failed:", error.message);
    return null;
  }
  return (data as { id: string }).id;
}

async function patchTransaction(id: string, patch: {
  amount?: number;
  date?: string | null;
  description?: string;
  artist?: string;
  payment_status?: string;
}): Promise<void> {
  const upd: Record<string, unknown> = {};
  if (patch.amount         !== undefined) upd.amount         = Number(patch.amount) || 0;
  if (patch.date           !== undefined) upd.date           = patch.date || null;
  if (patch.description    !== undefined) upd.description    = patch.description;
  if (patch.artist         !== undefined) upd.artist         = patch.artist;
  if (patch.payment_status !== undefined) upd.payment_status = patch.payment_status;
  if (Object.keys(upd).length === 0) return;
  const { error } = await supabase.from("transactions").update(upd).eq("id", id);
  if (error) console.error("[shows-finance-sync] patch transaction failed:", error.message);
}

export async function syncShowFinance(show: Show): Promise<void> {
  try {
    const isCancelled = show.status === "בוטל";
    const isPaid      = show.payment_status === "שולם";
    const isConfirmed = CONFIRMED_STATUSES.has(show.status);
    const date        = show.date || new Date().toISOString().slice(0, 10);
    const hasDj       = (show.dj_fee ?? 0) > 0;
    // Related-party name per transaction type: income is on the booking client
    // (booker), the dj expense is on the dj.
    const incomeParty = show.booker_name || show.artist || "לקוח";
    const djParty     = show.dj_name || "";

    // ── Income (show revenue) ──
    // Create for any confirmed booking with a price; "שולם" → התקבל, else צפוי.
    const incomeStatus  = isCancelled ? "בוטל" : (isPaid ? "התקבל" : "צפוי");
    const shouldHaveIncome = !isCancelled && isConfirmed && show.show_price > 0;
    if (show.linked_income_transaction_id) {
      // Update existing — never delete.
      await patchTransaction(show.linked_income_transaction_id, {
        amount:         show.show_price,
        date,
        artist:         incomeParty,
        description:    `הכנסה מהופעה — ${displayName(show)}`,
        payment_status: incomeStatus,
      });
    } else if (shouldHaveIncome) {
      const id = await createTransaction({
        type:        "income",
        payment_status: isPaid ? "התקבל" : "צפוי",
        amount:      show.show_price,
        date,
        artist:      incomeParty,
        description: `הכנסה מהופעה — ${displayName(show)}`,
        category:    "הופעה",
        expense_scope: "הופעה",
        notes:       `show_id:${show.id}`,
      });
      if (id) {
        await supabase.from("shows")
          .update({ linked_income_transaction_id: id, updated_at: new Date().toISOString() })
          .eq("id", show.id);
      }
    }

    // ── DJ expense ──
    // Create for any confirmed booking with a dj_fee; "שולם" → שולם, else לא שולם.
    const expenseStatus = (isCancelled || !hasDj) ? "בוטל" : (isPaid ? "שולם" : "לא שולם");
    const shouldHaveExpense = !isCancelled && isConfirmed && hasDj;
    if (show.linked_dj_expense_transaction_id) {
      await patchTransaction(show.linked_dj_expense_transaction_id, {
        amount:         show.dj_fee,
        date,
        artist:         djParty,
        description:    djDescription(show),
        payment_status: expenseStatus,
      });
    } else if (shouldHaveExpense) {
      const id = await createTransaction({
        type:          "expense",
        payment_status: isPaid ? "שולם" : "לא שולם",
        amount:        show.dj_fee,
        date,
        artist:        djParty,
        description:   djDescription(show),
        category:      "שכר דיג'יי",
        expense_scope: "הופעה",
        notes:         `show_id:${show.id}`,
      });
      if (id) {
        await supabase.from("shows")
          .update({ linked_dj_expense_transaction_id: id, updated_at: new Date().toISOString() })
          .eq("id", show.id);
      }
    }

    // ── Artist expense ──
    // Artist always takes half of the net after the dj (computeShowSplit). When
    // the dj fee changes, this re-splits the rest automatically so income stays
    // gross, the dj expense follows dj_fee, and the artist cut tracks (price-dj)/2.
    const effectiveArtistFee = computeShowSplit(show).artistFee;
    const hasArtistFee     = effectiveArtistFee > 0;
    const artistStatus     = (isCancelled || !hasArtistFee) ? "בוטל" : (isPaid ? "שולם" : "לא שולם");
    const shouldHaveArtist = !isCancelled && isConfirmed && hasArtistFee;
    if (show.linked_artist_expense_transaction_id) {
      await patchTransaction(show.linked_artist_expense_transaction_id, {
        amount:         effectiveArtistFee,
        date,
        artist:         show.artist,
        description:    artistDescription(show),
        payment_status: artistStatus,
      });
    } else if (shouldHaveArtist) {
      const id = await createTransaction({
        type:          "expense",
        payment_status: isPaid ? "שולם" : "לא שולם",
        amount:        effectiveArtistFee,
        date,
        artist:        show.artist,
        description:   artistDescription(show),
        category:      "שכר אמן",
        expense_scope: "הופעה",
        notes:         `show_id:${show.id}`,
      });
      if (id) {
        await supabase.from("shows")
          .update({ linked_artist_expense_transaction_id: id, updated_at: new Date().toISOString() })
          .eq("id", show.id);
      }
    }
  } catch (e) {
    console.error("[shows-finance-sync] syncShowFinance error:", e);
  }
}

/**
 * HARD-delete a show's canonical Finance transactions (used when the show
 * itself is deleted — not cancelled). Deletes ONLY transactions that certainly
 * belong to this show: first by the stored linked_* ids, then a precise
 * fallback by the internal `show_id:<uuid>` marker in notes. Never deletes by
 * category/scope/name. Missing transactions are skipped (non-fatal). Returns
 * how many rows were deleted.
 */
export async function deleteShowFinance(show: Show): Promise<number> {
  let deleted = 0;
  try {
    const ids = [
      show.linked_income_transaction_id,
      show.linked_dj_expense_transaction_id,
      show.linked_artist_expense_transaction_id,
    ].filter(Boolean) as string[];

    if (ids.length > 0) {
      const { data, error } = await supabase
        .from("transactions").delete().in("id", ids).select("id");
      if (error) console.error("[shows-finance-sync] delete by linked ids failed:", error.message);
      else deleted += data?.length ?? 0;
    }

    // Fallback: catch any leftover row carrying this exact show's marker
    // (the show_id is a unique UUID, so this can only match this show's rows).
    const { data: fb, error: fbErr } = await supabase
      .from("transactions").delete().ilike("notes", `%show_id:${show.id}%`).select("id");
    if (fbErr) console.error("[shows-finance-sync] delete by marker failed:", fbErr.message);
    else deleted += fb?.length ?? 0;
  } catch (e) {
    console.error("[shows-finance-sync] deleteShowFinance error:", e);
  }
  return deleted;
}

/** Mark a show's linked transactions as "בוטל" (used before deleting a show). Never deletes. */
export async function cancelShowFinance(show: Show): Promise<void> {
  try {
    if (show.linked_income_transaction_id) {
      await patchTransaction(show.linked_income_transaction_id, { payment_status: "בוטל" });
    }
    if (show.linked_dj_expense_transaction_id) {
      await patchTransaction(show.linked_dj_expense_transaction_id, { payment_status: "בוטל" });
    }
    if (show.linked_artist_expense_transaction_id) {
      await patchTransaction(show.linked_artist_expense_transaction_id, { payment_status: "בוטל" });
    }
  } catch (e) {
    console.error("[shows-finance-sync] cancelShowFinance error:", e);
  }
}
