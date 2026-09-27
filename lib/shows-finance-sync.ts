import "server-only";
import { supabase } from "@/lib/supabase";
import type { Show } from "@/lib/shows-types";
import { computeShowSplit, rehearsalCountedAmount, showMoneyOf, SHOW_MONEY_ROLES, type ShowMoney, type ShowMoneyRow } from "@/lib/shows-types";
import { syncArtistBalanceFromShow, removeSyncedArtistBalanceEntry } from "@/lib/artist-balance-show-sync";

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
 *
 * D5 (Owner decision 2026-09-27, migration 75bf144e…): ACTUAL show money lives in Finance. Every show row carries
 * transactions.show_id + show_money_role (SHOW_PAYMENT / SHOW_BALANCE_EXPECTED / DJ_FEE / ARTIST_FEE / REHEARSAL)
 * and the show's currency. Received = Σ SHOW_PAYMENT rows with status שולם / התקבל (showMoneyOf — the one rule);
 * the ONE expected-balance row holds price − received (צפוי), and becomes 0 / בוטל when nothing remains. A payment
 * row is never deleted, re-priced or cancelled by a sync. shows.payment_status / advance_payment are DERIVED mirrors.
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
  show_id?: string;
  show_money_role?: string;
  currency?: string;
  payment_method?: string;
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
      currency:          fields.currency || "₪",
      payment_status:    fields.payment_status,
      payment_method:    fields.payment_method ?? "",
      receipt_ref:       "",
      notes:             fields.notes,
      category:          fields.category,
      linked_session_id: fields.linked_session_id ?? "",
      expense_scope:     fields.expense_scope ?? "כללי",
      show_id:           fields.show_id ?? null,
      show_money_role:   fields.show_money_role ?? null,
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
  currency?: string;
  show_id?: string;
  show_money_role?: string;
  payment_method?: string;
}): Promise<void> {
  const upd: Record<string, unknown> = {};
  if (patch.currency        !== undefined) upd.currency        = patch.currency;
  if (patch.show_id         !== undefined) upd.show_id         = patch.show_id;
  if (patch.show_money_role !== undefined) upd.show_money_role = patch.show_money_role;
  if (patch.payment_method  !== undefined) upd.payment_method  = patch.payment_method;
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
  show: { id: string; name: string; artist: string; currency?: string | null },
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
        show_id: show.id, show_money_role: SHOW_MONEY_ROLES.REHEARSAL, currency: show.currency || "₪",
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
        show_id: show.id,
        show_money_role: SHOW_MONEY_ROLES.REHEARSAL,
        currency: show.currency || "₪",
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

    // ── Income (D5): payments + ONE expected-balance row, all linked by show_id, in the show's currency ──
    const currency = show.currency || "₪";
    let money = await showMoneyForShow(show);
    if (isCancelled) {
      // Cancelled: nothing is expected any more; payments already received stay exactly as they are.
      if (money.expected && money.expected.status !== "בוטל") await patchTransaction(money.expected.id, { payment_status: "בוטל" });
    } else if (isConfirmed && show.show_price > 0) {
      if (isPaid && money.remaining > 0) {
        // "fully paid" (payment status שולם / the close dialog): the REMAINDER was received — recorded once
        await recordRemainderReceived(show, money, date, incomeParty);
        money = await showMoneyForShow(show);
      } else if ((show.payment_status === "לא שולם" || show.payment_status === "צפוי") && !money.expected
        && money.payments.length === 1 && money.payments[0].id === show.linked_income_transaction_id && money.payments[0].amount === money.agreed) {
        // Undo of ONE "שולם" click (the single linked row was the whole price): back to expected, like before D5
        await patchTransaction(money.payments[0].id, { payment_status: "צפוי", show_money_role: SHOW_MONEY_ROLES.EXPECTED });
        money = await showMoneyForShow(show);
      }
      if (money.remaining > 0) {
        if (money.expected) {
          await patchTransaction(money.expected.id, { amount: money.remaining, date, artist: incomeParty, description: `יתרה לגבייה — ${displayName(show)}`, payment_status: "צפוי", currency });
        } else {
          const id = await createTransaction({
            type: "income", payment_status: "צפוי", amount: money.remaining, date, artist: incomeParty,
            description: `יתרה לגבייה — ${displayName(show)}`, category: "הופעה", expense_scope: "הופעה", notes: `show_id:${show.id}`,
            show_id: show.id, show_money_role: SHOW_MONEY_ROLES.EXPECTED, currency,
          });
          if (id && !show.linked_income_transaction_id) {
            await supabase.from("shows").update({ linked_income_transaction_id: id, updated_at: new Date().toISOString() }).eq("id", show.id);
          }
        }
      } else if (money.expected && (money.expected.status !== "בוטל" || money.expected.amount !== 0)) {
        // nothing left to collect (paid in full, or more — the credit stays visible on the payments)
        await patchTransaction(money.expected.id, { amount: 0, payment_status: "בוטל", description: `יתרה לגבייה — ${displayName(show)} (שולם במלואו)` });
      }
    } else if (money.expected && money.expected.status !== "בוטל") {
      await patchTransaction(money.expected.id, { payment_status: "בוטל" });
    }
    // The show's payment status + received mirror are DERIVED from Finance (never typed in)
    money = await showMoneyForShow(show);
    const derived = !isConfirmed || isCancelled || !(show.show_price > 0) ? show.payment_status
      : money.derivedPaymentStatus ?? (show.payment_status === "שולם" || show.payment_status === "מקדמה" || show.payment_status === "חלקי" ? "צפוי" : show.payment_status);
    if (derived !== show.payment_status || money.received !== (Number(show.advance_payment) || 0)) {
      await supabase.from("shows").update({ payment_status: derived, advance_payment: money.received, updated_at: new Date().toISOString() }).eq("id", show.id);
    }
    const paidInFull = derived === "שולם";

    // ── DJ expense ──
    // Confirmed booking with a dj_fee: "שולם" → paid, otherwise "צפוי" (expected
    // payment for an approved/open show — not "לא שולם"/overdue).
    const expenseStatus = (isCancelled || !hasDj) ? "בוטל" : (paidInFull ? "שולם" : "צפוי");
    const shouldHaveExpense = !isCancelled && isConfirmed && hasDj;
    if (show.linked_dj_expense_transaction_id) {
      await patchTransaction(show.linked_dj_expense_transaction_id, {
        amount:         show.dj_fee,
        date,
        artist:         djParty,
        description:    djDescription(show),
        payment_status: expenseStatus,
        show_id: show.id, show_money_role: SHOW_MONEY_ROLES.DJ, currency,
      });
    } else if (shouldHaveExpense) {
      const id = await createTransaction({
        type:          "expense",
        payment_status: paidInFull ? "שולם" : "צפוי",
        amount:        show.dj_fee,
        date,
        artist:        djParty,
        description:   djDescription(show),
        category:      "שכר דיג'יי",
        expense_scope: "הופעה",
        notes:         `show_id:${show.id}`,
        show_id: show.id, show_money_role: SHOW_MONEY_ROLES.DJ, currency,
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
    const artistStatus     = (isCancelled || !hasArtistFee) ? "בוטל" : (paidInFull ? "שולם" : "צפוי");
    const shouldHaveArtist = !isCancelled && isConfirmed && hasArtistFee;
    if (show.linked_artist_expense_transaction_id) {
      await patchTransaction(show.linked_artist_expense_transaction_id, {
        amount:         effectiveArtistFee,
        date,
        artist:         show.artist,
        description:    artistDescription(show),
        payment_status: artistStatus,
        show_id: show.id, show_money_role: SHOW_MONEY_ROLES.ARTIST, currency,
      });
      // Balance-ledger sync (Phase 1, Shalev only — see artist-balance-show-sync.ts).
      // "בוטל" means the fee no longer stands — remove a still-expected synced
      // entry (never touches one already marked הכנסות). Otherwise keep it in
      // sync as "הכנסות צפויות" — payment_status ("שולם" vs "צפוי") never
      // promotes it to "הכנסות" automatically; that's a manual-only action.
      if (artistStatus === "בוטל") {
        await removeSyncedArtistBalanceEntry(show.linked_artist_expense_transaction_id);
      } else {
        if (currency === "₪") await syncArtistBalanceFromShow({
          showArtist: show.artist,
          showId: show.id,
          showName: show.name,
          showDate: show.date,
          transactionId: show.linked_artist_expense_transaction_id,
          amount: effectiveArtistFee,
        });
      }
    } else if (shouldHaveArtist) {
      const id = await createTransaction({
        type:          "expense",
        payment_status: paidInFull ? "שולם" : "צפוי",
        amount:        effectiveArtistFee,
        date,
        artist:        show.artist,
        description:   artistDescription(show),
        category:      "שכר אמן",
        expense_scope: "הופעה",
        notes:         `show_id:${show.id}`,
        show_id: show.id, show_money_role: SHOW_MONEY_ROLES.ARTIST, currency,
      });
      if (id) {
        await supabase.from("shows")
          .update({ linked_artist_expense_transaction_id: id, updated_at: new Date().toISOString() })
          .eq("id", show.id);
        // Balance-ledger sync — brand-new artist-fee transaction, always as
        // "הכנסות צפויות" regardless of isPaid (never "בוטל" here — shouldHaveArtist
        // already excludes cancelled/no-fee shows).
        if (currency === "₪") await syncArtistBalanceFromShow({
          showArtist: show.artist,
          showId: show.id,
          showName: show.name,
          showDate: show.date,
          transactionId: id,
          amount: effectiveArtistFee,
        });
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
  // Captured BEFORE any deletion — source_tx_id lookup below needs the id even
  // after the transaction row itself is gone (no FK, so it stays a valid key).
  const artistTxId = show.linked_artist_expense_transaction_id;
  try {
    // D5: a SHOW_PAYMENT row is money actually received — it is NEVER deleted here (the writers refuse to delete /
    // revert a show that has payments). Only the expected balance / DJ / artist rows go; rehearsal rows stay too.
    const ids = [
      show.linked_income_transaction_id,
      show.linked_dj_expense_transaction_id,
      show.linked_artist_expense_transaction_id,
    ].filter(Boolean) as string[];
    const { data: linked } = ids.length ? await supabase.from("transactions").select("id, show_money_role").in("id", ids) : { data: [] };
    const removable = ((linked ?? []) as Array<{ id: string; show_money_role: string | null }>).filter((r) => r.show_money_role !== SHOW_MONEY_ROLES.PAYMENT).map((r) => r.id);
    if (removable.length > 0) {
      const { data, error } = await supabase.from("transactions").delete().in("id", removable).select("id");
      if (error) console.error("[shows-finance-sync] delete by linked ids failed:", error.message);
      else deleted += data?.length ?? 0;
    }
    // The canonical link: the show's remaining non-payment, non-rehearsal rows
    const { data: byLink, error: linkErr } = await supabase
      .from("transactions").delete().eq("show_id", show.id).in("show_money_role", [SHOW_MONEY_ROLES.EXPECTED, SHOW_MONEY_ROLES.DJ, SHOW_MONEY_ROLES.ARTIST]).select("id");
    if (linkErr) console.error("[shows-finance-sync] delete by show link failed:", linkErr.message);
    else deleted += byLink?.length ?? 0;
  } catch (e) {
    console.error("[shows-finance-sync] deleteShowFinance error:", e);
  }
  // Balance-ledger sync: the show is gone, so its artist-fee transaction is
  // gone too — remove a still-expected synced entry (never one already הכנסות).
  await removeSyncedArtistBalanceEntry(artistTxId);
  return deleted;
}

/** Mark a show's expected / DJ / artist rows as "בוטל" (used before deleting a show). Never deletes; never a payment. */
export async function cancelShowFinance(show: Show): Promise<void> {
  try {
    const rows = await showFinanceRows(show);
    for (const r of rows) if (r.role !== SHOW_MONEY_ROLES.PAYMENT && r.role !== SHOW_MONEY_ROLES.REHEARSAL && r.status !== "בוטל") await patchTransaction(r.id, { payment_status: "בוטל" });
  } catch (e) {
    console.error("[shows-finance-sync] cancelShowFinance error:", e);
  }
}

/**
 * Apply per-party closure statuses (after the normal sync). Income received → the REMAINING balance is recorded as
 * received (once — nothing is double-counted; payments already recorded stay); not received → the expected balance
 * stays צפוי and nothing received is ever downgraded. DJ / artist paid → "שולם", else "צפוי".
 */
export async function applyShowClosureStatuses(
  show: Show,
  t: { incomeReceived: boolean; djPaid: boolean; artistPaid: boolean },
): Promise<void> {
  try {
    if (t.incomeReceived) {
      const money = await showMoneyForShow(show);
      if (money.remaining > 0) await recordRemainderReceived(show, money, show.date || new Date().toISOString().slice(0, 10), show.booker_name || show.artist || "לקוח");
    }
    if (show.linked_dj_expense_transaction_id)
      await patchTransaction(show.linked_dj_expense_transaction_id, { payment_status: t.djPaid ? "שולם" : "צפוי" });
    if (show.linked_artist_expense_transaction_id)
      await patchTransaction(show.linked_artist_expense_transaction_id, { payment_status: t.artistPaid ? "שולם" : "צפוי" });
    if (t.incomeReceived) {
      const fresh = await showMoneyForShow(show);
      await supabase.from("shows").update({ payment_status: fresh.derivedPaymentStatus ?? show.payment_status, advance_payment: fresh.received, updated_at: new Date().toISOString() }).eq("id", show.id);
    }
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

// ── D5 helpers (the show's Finance rows through the canonical link) ─────────────────────────────────────────────────
/** A show's Finance rows (transactions.show_id). A linked row written before D5 is tagged on first sight. */
export async function showFinanceRows(show: Pick<Show, "id" | "linked_income_transaction_id">): Promise<ShowMoneyRow[]> {
  const { data, error } = await supabase.from("transactions").select("id, type, show_money_role, payment_status, amount, currency, date").eq("show_id", show.id);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Array<{ id: string; type: string; show_money_role: string | null; payment_status: string | null; amount: number; currency: string | null; date: string | null }>);
  const lid = show.linked_income_transaction_id;
  if (lid && !rows.some((r) => r.id === lid)) {
    const { data: legacy } = await supabase.from("transactions").select("id, type, show_money_role, payment_status, amount, currency, date").eq("id", lid).maybeSingle();
    const l = legacy as (typeof rows)[number] | null;
    if (l && l.type === "income" && !l.show_money_role) {
      const role = l.payment_status === "שולם" || l.payment_status === "התקבל" ? SHOW_MONEY_ROLES.PAYMENT : SHOW_MONEY_ROLES.EXPECTED;
      await patchTransaction(l.id, { show_id: show.id, show_money_role: role });
      rows.push({ ...l, show_money_role: role });
    }
  }
  return rows.filter((r) => r.type === "income").map((r) => ({ id: r.id, role: r.show_money_role, status: r.payment_status, amount: Number(r.amount) || 0, currency: r.currency, date: r.date }));
}
export async function showMoneyForShow(show: Pick<Show, "id" | "linked_income_transaction_id" | "show_price" | "currency">): Promise<ShowMoney> {
  return showMoneyOf(show, await showFinanceRows(show));
}
/** The remaining balance was received: the expected row BECOMES that payment (one row), or a payment row is created. */
async function recordRemainderReceived(show: Show, money: ShowMoney, date: string, party: string): Promise<void> {
  if (money.remaining <= 0) return;
  const currency = show.currency || "₪";
  if (money.expected) {
    await patchTransaction(money.expected.id, { amount: money.remaining, payment_status: "התקבל", show_money_role: SHOW_MONEY_ROLES.PAYMENT, date, artist: party, description: `תשלום הופעה — ${displayName(show)}`, currency });
  } else {
    await createTransaction({
      type: "income", payment_status: "התקבל", amount: money.remaining, date, artist: party, description: `תשלום הופעה — ${displayName(show)}`,
      category: "הופעה", expense_scope: "הופעה", notes: `show_id:${show.id}`, show_id: show.id, show_money_role: SHOW_MONEY_ROLES.PAYMENT, currency,
    });
  }
}
/** A new payment row (RECORD_SHOW_PAYMENT / the Shows hub). The caller validated amount / date / currency. */
export async function insertShowPayment(show: Show, p: { amount: number; date: string; method?: string; note?: string }): Promise<string> {
  const money = await showMoneyForShow(show);
  const currency = show.currency || "₪";
  const party = show.booker_name || show.artist || "לקוח";
  // Paying the whole remainder (or more): the expected row BECOMES the payment (never two rows for one payment)
  if (money.expected && money.remaining > 0 && p.amount >= money.remaining && money.expected.status !== "בוטל") {
    await patchTransaction(money.expected.id, { amount: p.amount, payment_status: "התקבל", show_money_role: SHOW_MONEY_ROLES.PAYMENT, date: p.date, artist: party, description: `תשלום הופעה — ${displayName(show)}`, currency, payment_method: p.method ?? "" });
    return money.expected.id;
  }
  const id = await createTransaction({
    type: "income", payment_status: "התקבל", amount: p.amount, date: p.date, artist: party, description: `תשלום הופעה — ${displayName(show)}`,
    category: "הופעה", expense_scope: "הופעה", notes: [`show_id:${show.id}`, p.note?.trim()].filter(Boolean).join(" · "),
    show_id: show.id, show_money_role: SHOW_MONEY_ROLES.PAYMENT, currency, payment_method: p.method ?? "",
  });
  if (!id) throw new Error("the payment row was not created");
  return id;
}
