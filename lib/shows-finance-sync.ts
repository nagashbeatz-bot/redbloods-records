import "server-only";
import { supabase } from "@/lib/supabase";
import type { Show } from "@/lib/shows-types";
import { isUnpaidCollab, rehearsalCountedAmount, showMoneyOf, SHOW_MONEY_ROLES, type ShowMoney, type ShowMoneyRow } from "@/lib/shows-types";
import { closureFeeStatus, feeRowMayReprice, feeRowPaidConflicts, feeRowStatusAfterSync, FEE_ROW_INITIAL_STATUS, shouldRecordRemainder, type ShowSyncIntent } from "@/lib/shows-types";
import { syncArtistBalanceFromShow, removeSyncedArtistBalanceEntry } from "@/lib/artist-balance-show-sync";
import { showAgreementSplit } from "@/lib/label-agreements";
import { unitColumnsOrUnclassified } from "@/lib/writes/business-unit";

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
 *  • a real payment event (RECORD_SHOW_PAYMENT / the "שולם" intent / close 'received') → a SHOW_PAYMENT row
 *  • DJ / artist fee rows: created "צפוי"; paid only explicitly (close flag / setShowFeePaid / Finance) — A1
 *  • status "בוטל" → expected / unpaid fee rows "בוטל" (payments and paid fees stay); delete → hard-delete
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
  // business unit (task 4): a show of a Records roster artist → RECORDS; a collab / other artist stays "דורש סיווג"
  const unit = await unitColumnsOrUnclassified({ writer: "SHOW_SYNC", type: fields.type, category: fields.category, expenseScope: fields.expense_scope ?? "כללי", showId: fields.show_id ?? null });
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      ...unit,
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
  show: { id: string; name: string; artist: string; currency?: string | null; deal_type?: string | null },
  paymentStatus?: string,
): Promise<void> {
  // an unpaid collaboration never gets an automatic rehearsal expense (the writer refuses a cost first; last guard)
  if (isUnpaidCollab(show)) return;
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

/** What a sync left for the Owner: paid DJ / artist fee rows that no longer match the show (never overwritten). */
export interface ShowSyncReport { feeConflicts: string[] }

/** A DJ / artist fee row as the sync sees it (read by its stored linked id). */
async function readFeeRow(id: string): Promise<{ id: string; status: string | null; amount: number; party: string; currency: string } | null> {
  const { data, error } = await supabase.from("transactions").select("id, payment_status, amount, artist, currency").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const r = data as { id: string; payment_status: string | null; amount: number | null; artist: string | null; currency: string | null };
  return { id: r.id, status: r.payment_status, amount: Number(r.amount) || 0, party: r.artist ?? "", currency: r.currency || "₪" };
}

/**
 * A1 (Owner canon 2026-09-27) — client paid ≠ DJ paid ≠ artist paid:
 *  • money received is recorded ONLY from a real payment event: RECORD_SHOW_PAYMENT, or `intent.markRemainderReceived`
 *    (the request truly moved the client payment to "שולם", or the close dialog said 'received'). The stored
 *    payment_status mirror is never read as "received" — a price rise on a paid show never invents income.
 *  • there is NO implicit undo: a SHOW_PAYMENT row is never turned back into an expected row by a save. Reversing a
 *    payment is an explicit Finance correction (a transaction edit), never a side effect of a status picker.
 *  • DJ / artist fee rows are created "צפוי" and their payment status is NEVER derived from the client payment.
 *    Automatic status moves: → "בוטל" (show cancelled / fee 0) unless the row is "שולם", and "בוטל" → "צפוי" when the
 *    fee stands again. A "שולם" fee row is never re-priced / re-dated / re-described / re-currencied; a mismatch is
 *    returned in the report (and logged) for the Owner / Sunny integrity — never silently overwritten.
 *    Paying a fee = the close dialog flag, setShowFeePaid (lib/writes/shows) or a Finance edit of the row.
 */
export async function syncShowFinance(show: Show, intent?: ShowSyncIntent): Promise<ShowSyncReport> {
  const report: ShowSyncReport = { feeConflicts: [] };
  // Owner decision 2026-09-27: an unpaid collaboration (deal_type UNPAID_COLLAB) has ZERO automatic finance activity —
  // no expected income, payment mirror, DJ / artist row or artist ledger entry. Rows of an earlier PAID phase are
  // removed only by the guarded deal-type switch (lib/writes/shows.ts), never here.
  if (isUnpaidCollab(show)) return report;
  try {
    const isCancelled = show.status === "בוטל";
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
      if (shouldRecordRemainder(intent) && money.remaining > 0) {
        // the Owner said the client paid the rest (a real payment event): the REMAINDER is recorded once
        await recordRemainderReceived(show, money, date, incomeParty);
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

    // ── DJ expense ── (its own obligation: never follows the client payment)
    const shouldHaveExpense = !isCancelled && isConfirmed && hasDj;
    if (show.linked_dj_expense_transaction_id) {
      const row = await readFeeRow(show.linked_dj_expense_transaction_id);
      if (row) {
        const next = feeRowStatusAfterSync(row.status, { cancelled: isCancelled, feeZero: !hasDj });
        const patch: Parameters<typeof patchTransaction>[1] = { show_id: show.id, show_money_role: SHOW_MONEY_ROLES.DJ };
        if (feeRowMayReprice(row.status)) Object.assign(patch, { amount: show.dj_fee, date, artist: djParty, description: djDescription(show), currency });
        else noteFeeConflict(report, show, "DJ", feeRowPaidConflicts(row, { amount: show.dj_fee, party: djParty, currency, cancelled: isCancelled }));
        if (next !== null && next !== row.status) patch.payment_status = next;
        await patchTransaction(row.id, patch);
      }
    } else if (shouldHaveExpense) {
      const id = await createTransaction({
        type:          "expense",
        payment_status: FEE_ROW_INITIAL_STATUS,
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
    // Owner decision 2026-09-27 (lib/label-agreements showAgreementSplit — the ONE rule): for שליו טסמה / אבי מולה the
    // artist takes half of the NET show profit (price − DJ − counted rehearsals, the app's own computeShowSplit). When the
    // dj fee changes, this re-splits the rest automatically (while the row is not paid). Any other artist or a collab text
    // has NO agreement: no artist fee row is created or re-priced (an existing one is left untouched and reported).
    const rehearsalCounted   = await getRehearsalCountedForShow(show.id);
    const artistRule         = showAgreementSplit(show, rehearsalCounted);
    if (artistRule.status === "NOT_DEFINED") {
      if (show.linked_artist_expense_transaction_id) report.feeConflicts.push(`אמן: ${artistRule.reasonHe} — שורת שכר האמן הקיימת לא שונתה`);
      return report;
    }
    const effectiveArtistFee = artistRule.artistFee;
    const hasArtistFee     = effectiveArtistFee > 0;
    // The artist-ledger sync is keyed off "the fee no longer stands" (cancelled / no fee) — exactly as before A1,
    // independent of whether the Finance fee row was paid.
    const artistFeeStands  = !isCancelled && hasArtistFee;
    const shouldHaveArtist = !isCancelled && isConfirmed && hasArtistFee;
    if (show.linked_artist_expense_transaction_id) {
      const row = await readFeeRow(show.linked_artist_expense_transaction_id);
      if (row) {
        const next = feeRowStatusAfterSync(row.status, { cancelled: isCancelled, feeZero: !hasArtistFee });
        const patch: Parameters<typeof patchTransaction>[1] = { show_id: show.id, show_money_role: SHOW_MONEY_ROLES.ARTIST };
        if (feeRowMayReprice(row.status)) Object.assign(patch, { amount: effectiveArtistFee, date, artist: show.artist, description: artistDescription(show), currency });
        else noteFeeConflict(report, show, "אמן", feeRowPaidConflicts(row, { amount: effectiveArtistFee, party: show.artist, currency, cancelled: isCancelled }));
        if (next !== null && next !== row.status) patch.payment_status = next;
        await patchTransaction(row.id, patch);
      }
      // Balance-ledger sync (Phase 1, Shalev only — see artist-balance-show-sync.ts).
      // The fee no longer stands → remove a still-expected synced entry (never touches one already marked הכנסות).
      // Otherwise keep it in sync as "הכנסות צפויות" — a payment status never promotes it to "הכנסות"
      // automatically; that's a manual-only action.
      if (!artistFeeStands) {
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
        payment_status: FEE_ROW_INITIAL_STATUS,
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
        // "הכנסות צפויות" (never "בוטל" here — shouldHaveArtist already excludes cancelled/no-fee shows).
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
  return report;
}

/** A paid fee row that disagrees with the show: logged + reported, never overwritten (the Owner decides). */
function noteFeeConflict(report: ShowSyncReport, show: Show, who: string, reasons: string[]): void {
  if (!reasons.length) return;
  const line = `שכר ${who} שכבר שולם לא עודכן (${reasons.join(" · ")}) — תיקון, אם צריך, בפיננסים`;
  report.feeConflicts.push(line);
  console.warn(`[shows-finance-sync] show ${show.id}: ${line}`);
}

/** A show's DJ / artist fee rows already marked "שולם" — money that went OUT. Found through the canonical link
 *  (show_id + DJ_FEE / ARTIST_FEE) AND the stored linked ids (a legacy row written before D5). Read-only. Such a row is
 *  never deleted by a revert / delete (Owner canon: paid Finance evidence is never deleted by a sync or a delete). */
export interface PaidShowFeeRow { id: string; role: "DJ_FEE" | "ARTIST_FEE"; amount: number; currency: string }
export async function paidShowFeeRows(show: Pick<Show, "id"> & Partial<Pick<Show, "linked_dj_expense_transaction_id" | "linked_artist_expense_transaction_id">>): Promise<PaidShowFeeRow[]> {
  type R = { id: string; show_money_role: string | null; payment_status: string | null; amount: number | null; currency: string | null };
  const { data, error } = await supabase.from("transactions").select("id, show_money_role, payment_status, amount, currency").eq("show_id", show.id).in("show_money_role", [SHOW_MONEY_ROLES.DJ, SHOW_MONEY_ROLES.ARTIST]);
  if (error) throw new Error(error.message);
  const out = new Map<string, PaidShowFeeRow>();
  for (const r of (data ?? []) as R[]) if (r.payment_status === "שולם") out.set(r.id, { id: r.id, role: r.show_money_role === SHOW_MONEY_ROLES.DJ ? "DJ_FEE" : "ARTIST_FEE", amount: Number(r.amount) || 0, currency: r.currency || "₪" });
  const linked: Array<[string | null | undefined, "DJ_FEE" | "ARTIST_FEE"]> = [[show.linked_dj_expense_transaction_id, "DJ_FEE"], [show.linked_artist_expense_transaction_id, "ARTIST_FEE"]];
  const ids = linked.map(([id]) => id).filter((id): id is string => !!id && !out.has(id));
  if (ids.length) {
    const { data: l, error: lErr } = await supabase.from("transactions").select("id, show_money_role, payment_status, amount, currency").in("id", ids);
    if (lErr) throw new Error(lErr.message);
    for (const r of (l ?? []) as R[]) if (r.payment_status === "שולם") out.set(r.id, { id: r.id, role: linked.find(([id]) => id === r.id)![1], amount: Number(r.amount) || 0, currency: r.currency || "₪" });
  }
  return [...out.values()];
}
/** The one Hebrew refusal for a revert / delete while a DJ / artist fee is already paid (UI routes + Sunny). */
export function paidFeesRefusalHe(rows: ReadonlyArray<{ role: string; amount: number; currency: string }>): string {
  const parts = rows.map((r) => `${r.role === "DJ_FEE" ? "DJ" : "אמן"} ${r.currency}${Number(r.amount).toLocaleString("en-US")}`);
  return `שכר DJ/אמן כבר סומן כשולם (${parts.join(" · ")}) — לא מוחקים כסף שיצא; תקן בכספים קודם (או בטל את ההופעה)`;
}

/**
 * HARD-delete a show's canonical Finance transactions (used when the show
 * itself is deleted — not cancelled). Deletes ONLY transactions that certainly
 * belong to this show: first by the stored linked_* ids, then by the canonical
 * show_id link. Never deletes by category/scope/name. Missing transactions are
 * skipped (non-fatal). Returns how many rows were deleted.
 * NEVER deletes money that actually moved: a SHOW_PAYMENT row (received) or a fee / legacy row already "שולם" / "התקבל"
 * (paid out). The writers refuse the revert / delete first (HAS_PAYMENTS / HAS_PAID_FEES); this is the last guard.
 */
export async function deleteShowFinance(show: Show): Promise<number> {
  let deleted = 0;
  // Captured BEFORE any deletion — source_tx_id lookup below needs the id even
  // after the transaction row itself is gone (no FK, so it stays a valid key).
  const artistTxId = show.linked_artist_expense_transaction_id;
  let artistRowKept = false;
  const moved = (r: { show_money_role: string | null; payment_status: string | null }) => r.show_money_role === SHOW_MONEY_ROLES.PAYMENT || r.payment_status === "שולם" || r.payment_status === "התקבל";
  try {
    // D5: a SHOW_PAYMENT row is money actually received — it is NEVER deleted here (the writers refuse to delete /
    // revert a show that has payments). A paid DJ / artist fee row is money that went out — NEVER deleted either
    // (HAS_PAID_FEES). Only the still-expected balance / unpaid DJ / unpaid artist rows go; rehearsal rows stay too.
    const ids = [
      show.linked_income_transaction_id,
      show.linked_dj_expense_transaction_id,
      show.linked_artist_expense_transaction_id,
    ].filter(Boolean) as string[];
    type L = { id: string; show_money_role: string | null; payment_status: string | null };
    const { data: linked } = ids.length ? await supabase.from("transactions").select("id, show_money_role, payment_status").in("id", ids) : { data: [] };
    const { data: byShow, error: linkErr } = await supabase
      .from("transactions").select("id, show_money_role, payment_status").eq("show_id", show.id).in("show_money_role", [SHOW_MONEY_ROLES.EXPECTED, SHOW_MONEY_ROLES.DJ, SHOW_MONEY_ROLES.ARTIST]);
    if (linkErr) console.error("[shows-finance-sync] read by show link failed:", linkErr.message);
    const all = [...((linked ?? []) as L[]), ...((byShow ?? []) as L[])];
    artistRowKept = !!artistTxId && all.some((r) => r.id === artistTxId && moved(r));
    const removable = [...new Set(all.filter((r) => !moved(r)).map((r) => r.id))];
    if (removable.length > 0) {
      const { data, error } = await supabase.from("transactions").delete().in("id", removable).select("id");
      if (error) console.error("[shows-finance-sync] delete failed:", error.message);
      else deleted += data?.length ?? 0;
    }
  } catch (e) {
    console.error("[shows-finance-sync] deleteShowFinance error:", e);
  }
  // Balance-ledger sync: the show's artist-fee transaction is gone — remove a still-expected synced entry (never one
  // already הכנסות). A paid artist row that stayed keeps its ledger entry.
  if (!artistRowKept) await removeSyncedArtistBalanceEntry(artistTxId);
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
 * stays צפוי and nothing received is ever downgraded. A1: DJ / artist paid → that fee row "שולם"; a flag left false
 * leaves the row EXACTLY as it is (an already-paid DJ / artist is never downgraded by a close).
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
    for (const [id, flag] of [[show.linked_dj_expense_transaction_id, t.djPaid], [show.linked_artist_expense_transaction_id, t.artistPaid]] as const) {
      if (!id || !flag) continue;
      const row = await readFeeRow(id);
      const next = closureFeeStatus(row?.status, flag);
      if (row && next !== null && next !== row.status) await patchTransaction(id, { payment_status: next });
    }
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
    // Only links whose row is really gone are cleared — a row that stayed (money that moved) keeps its link.
    const ids = [show.linked_income_transaction_id, show.linked_dj_expense_transaction_id, show.linked_artist_expense_transaction_id].filter(Boolean) as string[];
    const { data: left } = ids.length ? await supabase.from("transactions").select("id").in("id", ids) : { data: [] };
    const stays = new Set(((left ?? []) as Array<{ id: string }>).map((r) => r.id));
    const keep = (id: string | null | undefined) => (id && stays.has(id) ? id : null);
    await supabase.from("shows").update({
      linked_income_transaction_id: keep(show.linked_income_transaction_id),
      linked_dj_expense_transaction_id: keep(show.linked_dj_expense_transaction_id),
      linked_artist_expense_transaction_id: keep(show.linked_artist_expense_transaction_id),
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

/** The Finance-derived money of many shows in ONE query (the Shows hub list) — the same rule (showMoneyOf). Read-only. */
export async function getShowMoneyMap(shows: ReadonlyArray<Pick<Show, "id" | "show_price" | "currency">>): Promise<Record<string, ShowMoney>> {
  const out: Record<string, ShowMoney> = {};
  if (!shows.length) return out;
  const { data, error } = await supabase.from("transactions").select("id, show_id, type, show_money_role, payment_status, amount, currency, date").in("show_id", shows.map((s) => s.id));
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; show_id: string; type: string; show_money_role: string | null; payment_status: string | null; amount: number; currency: string | null; date: string | null }>;
  for (const s of shows) out[s.id] = showMoneyOf(s, rows.filter((r) => r.show_id === s.id && r.type === "income").map((r) => ({ id: r.id, role: r.show_money_role, status: r.payment_status, amount: Number(r.amount) || 0, currency: r.currency, date: r.date })));
  return out;
}

/** A1: a show's DJ / artist fee row (transactions.show_id + show_money_role) — its OWN obligation. */
export interface ShowFeeRow { id: string; status: string | null; amount: number; currency: string; date: string | null; party: string }
/** READ-ONLY: the DJ_FEE / ARTIST_FEE rows of many shows in ONE query. The stored linked id wins when a role has more
 *  than one row (legacy); null = no row. Readers use this for "DJ paid" / "artist paid" — never the client payment. */
export async function getShowFeeRowsMap(shows: ReadonlyArray<Pick<Show, "id"> & Partial<Pick<Show, "linked_dj_expense_transaction_id" | "linked_artist_expense_transaction_id">>>): Promise<Record<string, { DJ_FEE: ShowFeeRow | null; ARTIST_FEE: ShowFeeRow | null }>> {
  const out: Record<string, { DJ_FEE: ShowFeeRow | null; ARTIST_FEE: ShowFeeRow | null }> = {};
  if (!shows.length) return out;
  const { data, error } = await supabase.from("transactions").select("id, show_id, show_money_role, payment_status, amount, currency, date, artist").in("show_id", shows.map((s) => s.id)).in("show_money_role", [SHOW_MONEY_ROLES.DJ, SHOW_MONEY_ROLES.ARTIST]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; show_id: string; show_money_role: string; payment_status: string | null; amount: number | null; currency: string | null; date: string | null; artist: string | null }>;
  const pick = (showId: string, role: string, linked: string | null | undefined): ShowFeeRow | null => {
    const rs = rows.filter((r) => r.show_id === showId && r.show_money_role === role);
    const r = rs.find((x) => x.id === linked) ?? (rs.length === 1 ? rs[0] : null);
    return r ? { id: r.id, status: r.payment_status, amount: Number(r.amount) || 0, currency: r.currency || "₪", date: r.date, party: r.artist ?? "" } : null;
  };
  for (const s of shows) out[s.id] = { DJ_FEE: pick(s.id, SHOW_MONEY_ROLES.DJ, s.linked_dj_expense_transaction_id), ARTIST_FEE: pick(s.id, SHOW_MONEY_ROLES.ARTIST, s.linked_artist_expense_transaction_id) };
  return out;
}

// ── Deal type switch PAID → UNPAID_COLLAB (Owner decision 2026-09-27) ────────────────────────────────────────────────
/** What makes a PAID show unsafe to turn into an unpaid collaboration: real money or records that the existing safe
 *  removal (clearShowFinance: only still-expected balance / unpaid DJ / unpaid artist rows) would not remove. Read-only.
 *  Empty = the switch may run (the still-expected rows are then removed by clearShowFinance). Real money is never
 *  deleted, cancelled or hidden to make a show a collaboration. */
export async function unpaidCollabSwitchBlockers(show: Show): Promise<string[]> {
  const out: string[] = [];
  // EVERY row of the show (income AND expense — showFinanceRows is income-only), through the canonical show_id link
  type R = { id: string; show_money_role: string | null; payment_status: string | null; amount: number | null; currency: string | null };
  const { data, error: rErr } = await supabase.from("transactions").select("id, show_money_role, payment_status, amount, currency").eq("show_id", show.id);
  if (rErr) throw new Error(rErr.message);
  const rows = (data ?? []) as R[];
  const amt = (r: R) => `${r.currency || "₪"}${Number(r.amount).toLocaleString("en-US")}`;
  const moved = (r: R) => r.payment_status === "שולם" || r.payment_status === "התקבל";
  const received = rows.filter((r) => r.show_money_role === SHOW_MONEY_ROLES.PAYMENT || (r.show_money_role === SHOW_MONEY_ROLES.EXPECTED && moved(r)));
  if (received.length) out.push(`תשלומי לקוח שהתקבלו (${received.map(amt).join(" · ")})`);
  const paidFees = await paidShowFeeRows(show);
  if (paidFees.length) out.push(`שכר ששולם (${paidFees.map((r) => `${r.role === "DJ_FEE" ? "DJ" : "אמן"} ${r.currency}${Number(r.amount).toLocaleString("en-US")}`).join(" · ")})`);
  const rehearsal = rows.filter((r) => r.show_money_role === SHOW_MONEY_ROLES.REHEARSAL);
  if (rehearsal.length) out.push(`הוצאות חזרה רשומות בכספים (${rehearsal.length})`);
  const known = [SHOW_MONEY_ROLES.PAYMENT, SHOW_MONEY_ROLES.EXPECTED, SHOW_MONEY_ROLES.DJ, SHOW_MONEY_ROLES.ARTIST, SHOW_MONEY_ROLES.REHEARSAL] as readonly string[];
  const other = rows.filter((r) => !known.includes(String(r.show_money_role)));
  if (other.length) out.push(`רשומות כספיות נוספות של ההופעה (${other.length})`);
  // the artist ledger: a realized income / payment written by the close flow (keyed by the show) is real accounting
  const { data: ledger, error } = await supabase.from("artist_balance_entries").select("id, entry_type").eq("source_show_id", show.id);
  if (error) throw new Error(error.message);
  if ((ledger ?? []).length) out.push(`רשומות במאזן האמן (${(ledger as Array<{ entry_type: string }>).map((x) => x.entry_type).join(" · ")})`);
  return out;
}
