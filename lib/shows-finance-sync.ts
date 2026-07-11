import "server-only";
import { supabase } from "@/lib/supabase";
import type { Show } from "@/lib/shows-types";
import { computeShowSplit, rehearsalCountedAmount } from "@/lib/shows-types";

const REHEARSAL_SESSION_TYPE = "חזרה להופעה";
const REHEARSAL_CATEGORY     = "חזרה";

// Confirmed bookings only — leads (ליד חדש / ממתין לתשובה / צריך פולואפ) are
// pipeline and must NOT create Finance transactions.
const CONFIRMED_STATUSES = new Set(["נסגר", "אושרה", "בוצע"]);

/** Whether a show status counts as a confirmed booking (has Finance transactions). */
export function isConfirmedShowStatus(status: string): boolean {
  return CONFIRMED_STATUSES.has(status);
}

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
  linked_session_id?: string;
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
      linked_session_id: fields.linked_session_id ?? "",
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

/**
 * Fin-2: sum of a show's rehearsal costs that currently count toward the
 * distributable-base deduction (see rehearsalCountedAmount). Reads the show's
 * rehearsal sessions + their linked transactions. Non-fatal on error (returns 0).
 */
export async function getRehearsalCountedForShow(showId: string): Promise<number> {
  try {
    const { data: rs } = await supabase
      .from("sessions")
      .select("id, status, cost")
      .eq("show_id", showId)
      .eq("session_type", REHEARSAL_SESSION_TYPE);
    if (!rs || rs.length === 0) return 0;
    const ids = rs.map((r) => (r as { id: string }).id);
    const { data: txs } = await supabase
      .from("transactions")
      .select("linked_session_id, payment_status")
      .in("linked_session_id", ids);
    const payBySession = new Map<string, string>();
    (txs ?? []).forEach((t) => {
      const lid = (t as { linked_session_id?: string }).linked_session_id;
      if (lid) payBySession.set(lid, (t as { payment_status?: string }).payment_status ?? "");
    });
    let sum = 0;
    for (const r of rs) {
      const rr = r as { id: string; status: string | null; cost: number | null };
      sum += rehearsalCountedAmount(rr.status, payBySession.get(rr.id) ?? null, rr.cost);
    }
    return sum;
  } catch (e) {
    console.error("[shows-finance-sync] getRehearsalCountedForShow error:", e);
    return 0;
  }
}

/**
 * Create or update the ONE canonical expense transaction for a rehearsal, keyed
 * by transactions.linked_session_id = session.id (idempotent — one tx per
 * rehearsal; re-runs patch, never create a second). No transaction when
 * cost <= 0; an existing tx is NEVER auto-deleted (left as-is) per the
 * no-auto-delete rule. category="חזרה", expense_scope="הופעה", show_id marker
 * in notes so it groups under the show in Finance.
 */
export async function syncRehearsalFinance(
  rehearsal: { id: string; date: string | null; cost: number | null },
  show: { id: string; name: string; artist: string },
  paymentStatus?: string,
): Promise<void> {
  try {
    const cost = Number(rehearsal.cost) || 0;
    const { data: existing } = await supabase
      .from("transactions")
      .select("id")
      .eq("linked_session_id", rehearsal.id)
      .maybeSingle();
    if (cost <= 0) return; // no tx for a zero/blank cost; never delete an existing one
    const desc = show.artist ? `חזרה — ${show.name} (${show.artist})` : `חזרה — ${show.name}`;
    if (existing?.id) {
      // Patch amount/date/description; payment_status only when explicitly given
      // (an edit that doesn't touch payment must preserve the existing status).
      await patchTransaction((existing as { id: string }).id, {
        amount: cost, date: rehearsal.date, description: desc, payment_status: paymentStatus,
      });
    } else {
      await createTransaction({
        type: "expense",
        payment_status: paymentStatus ?? "לא שולם",
        amount: cost,
        date: rehearsal.date,
        description: desc,
        category: REHEARSAL_CATEGORY,
        expense_scope: "הופעה",
        notes: `show_id:${show.id}`,
        linked_session_id: rehearsal.id,
      });
    }
  } catch (e) {
    console.error("[shows-finance-sync] syncRehearsalFinance error:", e);
  }
}

/**
 * Batched version of getRehearsalCountedForShow for a list of shows — one
 * sessions query + one transactions query. Returns { showId: countedCost }.
 */
export async function getRehearsalCountedMap(showIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    if (!showIds.length) return out;
    const { data: rs } = await supabase
      .from("sessions")
      .select("id, show_id, status, cost")
      .in("show_id", showIds)
      .eq("session_type", REHEARSAL_SESSION_TYPE);
    if (!rs || rs.length === 0) return out;
    const ids = rs.map((r) => (r as { id: string }).id);
    const { data: txs } = await supabase
      .from("transactions")
      .select("linked_session_id, payment_status")
      .in("linked_session_id", ids);
    const payBy = new Map<string, string>();
    (txs ?? []).forEach((t) => {
      const lid = (t as { linked_session_id?: string }).linked_session_id;
      if (lid) payBy.set(lid, (t as { payment_status?: string }).payment_status ?? "");
    });
    for (const r of rs) {
      const rr = r as { id: string; show_id: string; status: string | null; cost: number | null };
      out[rr.show_id] = (out[rr.show_id] ?? 0) + rehearsalCountedAmount(rr.status, payBy.get(rr.id) ?? null, rr.cost);
    }
  } catch (e) {
    console.error("[shows-finance-sync] getRehearsalCountedMap error:", e);
  }
  return out;
}

/** Count a show's rehearsal sessions (used to block show deletion when > 0). */
export async function countShowRehearsals(showId: string): Promise<number> {
  const { count } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("show_id", showId)
    .eq("session_type", REHEARSAL_SESSION_TYPE);
  return count ?? 0;
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
    // Confirmed booking with a dj_fee: "שולם" → paid, otherwise "צפוי" (expected
    // payment for an approved/open show — not "לא שולם"/overdue).
    const expenseStatus = (isCancelled || !hasDj) ? "בוטל" : (isPaid ? "שולם" : "צפוי");
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
        payment_status: isPaid ? "שולם" : "צפוי",
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
    // Fin-2: subtract counted rehearsal costs before the 50/50 split so the
    // artist's cut re-derives from (price − dj − rehearsals)/2.
    const rehearsalCounted   = await getRehearsalCountedForShow(show.id);
    const effectiveArtistFee = computeShowSplit(show, rehearsalCounted).artistFee;
    const hasArtistFee     = effectiveArtistFee > 0;
    const artistStatus     = (isCancelled || !hasArtistFee) ? "בוטל" : (isPaid ? "שולם" : "צפוי");
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
        payment_status: isPaid ? "שולם" : "צפוי",
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
    // GUARD: never sweep rehearsal expenses (category="חזרה") — they are managed
    // per-session and are protected from auto-deletion (no-auto-delete rule).
    const { data: fb, error: fbErr } = await supabase
      .from("transactions").delete().ilike("notes", `%show_id:${show.id}%`).neq("category", REHEARSAL_CATEGORY).select("id");
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

/**
 * Apply per-party closure statuses to a show's 3 linked transactions (after the
 * normal sync). Income received → "התקבל" (shown as "שולם"), else "צפוי";
 * dj/artist paid → "שולם", else "צפוי". Only touches the linked rows; missing
 * ones are skipped. NOTE: a later show edit re-runs syncShowFinance, which
 * re-derives all three from the single show.payment_status — so this per-party
 * granularity is not preserved across future edits (would need DB columns).
 */
export async function applyShowClosureStatuses(
  show: Show,
  t: { incomeReceived: boolean; djPaid: boolean; artistPaid: boolean },
): Promise<void> {
  try {
    if (show.linked_income_transaction_id)
      await patchTransaction(show.linked_income_transaction_id, { payment_status: t.incomeReceived ? "התקבל" : "צפוי" });
    if (show.linked_dj_expense_transaction_id)
      await patchTransaction(show.linked_dj_expense_transaction_id, { payment_status: t.djPaid ? "שולם" : "צפוי" });
    if (show.linked_artist_expense_transaction_id)
      await patchTransaction(show.linked_artist_expense_transaction_id, { payment_status: t.artistPaid ? "שולם" : "צפוי" });
  } catch (e) {
    console.error("[shows-finance-sync] applyShowClosureStatuses error:", e);
  }
}

/**
 * Remove a show's Finance transactions WITHOUT deleting the show — used when a
 * show is reverted to a pipeline status (e.g. "ממתין לתשובה"). Hard-deletes the
 * linked transactions (same safe logic as deleteShowFinance) and clears the
 * linked_* ids so a later re-approval recreates them fresh. Returns the count.
 */
export async function clearShowFinance(show: Show): Promise<number> {
  const deleted = await deleteShowFinance(show);
  try {
    await supabase.from("shows").update({
      linked_income_transaction_id: null,
      linked_dj_expense_transaction_id: null,
      linked_artist_expense_transaction_id: null,
      updated_at: new Date().toISOString(),
    }).eq("id", show.id);
  } catch (e) {
    console.error("[shows-finance-sync] clearShowFinance clear-ids error:", e);
  }
  return deleted;
}
