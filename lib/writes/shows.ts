/**
 * Shared show writers — used by BOTH the show routes and Sunny's typed primitives. The route logic is moved here
 * VERBATIM (create + finance sync + optional calendar; edit + finance re-sync / clear, close dialog statuses, the
 * artist-balance close sync, quote follow-up / show-task closing, calendar add / remove / follow; delete blocked while
 * rehearsals exist + show finance hard-delete). Show money always reuses the app's own computeShowSplit /
 * rehearsalCountedAmount; CLEANTONE is never auto-assigned here (the DJ is exactly what the caller sends).
 */
import { supabase } from "@/lib/supabase";
import { createShow, getShow, patchShow, deleteShow, showCalendarSummary, showCalendarTimes, showCalendarDescription } from "@/lib/shows-store";
import type { PatchShowInput, ShowStatus, PaymentStatus, Show } from "@/lib/shows-store";
import { isMoneyCurrency, isShowDealType, isUnpaidCollab, paymentIntentFromBody, SHOW_MONEY_ROLES, SHOW_NO_MONEY_LABELS, UNPAID_COLLAB_NO_MONEY_HE } from "@/lib/shows-types";

/** D5: a show whose Finance holds money actually received (SHOW_PAYMENT rows) is never deleted or reverted to a lead. */
async function receivedPaymentsOf(showId: string): Promise<number> {
  const { count, error } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("show_id", showId).eq("show_money_role", SHOW_MONEY_ROLES.PAYMENT);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** If show.artist is empty but artist_client_id exists, resolve name from DB. */
async function resolveArtistName(show: Show): Promise<Show> {
  if (show.artist || !show.artist_client_id) return show;
  const { data } = await supabase.from("clients").select("name").eq("id", show.artist_client_id).single();
  if (data?.name) return { ...show, artist: data.name };
  return show;
}

// Fields that, when changed, should sync to Google Calendar
const CALENDAR_SYNC_FIELDS = new Set([
  "name", "artist", "date", "start_time", "location",
  "booker_name", "contact_person", "phone", "show_price", "dj_fee", "deal_type",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

/** POST /api/shows semantics (the caller validated the name). */
export async function createShowRecord(body: Body): Promise<{ show: Show; calendarWarning?: string; paymentWarning?: string }> {
    if (body.currency !== undefined && !isMoneyCurrency(body.currency)) throw new Error("מטבע לא נתמך (₪ / $ / €)");
    if (body.deal_type !== undefined && !isShowDealType(body.deal_type)) throw new Error("סוג עסקה לא מוכר (PAID / UNPAID_COLLAB)");
    // Owner decision 2026-09-27: an unpaid collaboration carries NO money at all — any money in the request is refused
    // (never silently dropped); the show itself is created exactly like any other show.
    const collab = body.deal_type === "UNPAID_COLLAB";
    if (collab && (Number(body.show_price) > 0 || Number(body.dj_fee) > 0 || Number(body.artist_fee) > 0 || Number(body.advance_payment) > 0 || body.payment_status === "שולם")) throw new Error(UNPAID_COLLAB_NO_MONEY_HE);
    // Create show without calendar_event_id first
    const show = await createShow({
      name:             body.name.trim(),
      artist:           body.artist?.trim()            ?? "",
      artist_client_id: body.artist_client_id          ?? null,
      booker_client_id: body.booker_client_id          ?? null,
      booker_name:      body.booker_name?.trim()       ?? "",
      date:             body.date                      ?? null,
      start_time:       body.start_time                ?? null,
      location:         body.location?.trim()          ?? "",
      contact_person:   body.contact_person?.trim()    ?? "",
      phone:            body.phone?.trim()             ?? "",
      status:           body.status                    ?? "ליד חדש",
      deal_type:        collab ? "UNPAID_COLLAB" : "PAID",
      // A1: only a no-money label is stored as typed; "שולם" is INTENT (recorded below as a real payment), and
      // מקדמה / חלקי / בוטל are derived from Finance — never persisted from the form.
      // (an unpaid collaboration: the column keeps its neutral default — it is simply not relevant, never "שת״פ")
      payment_status:   !collab && SHOW_NO_MONEY_LABELS.includes(body.payment_status) ? body.payment_status : "לא שולם",
      show_price:       collab ? 0 : Number(body.show_price) || 0,
      dj_fee:           collab ? 0 : body.dj_fee !== undefined ? Number(body.dj_fee) : 500,
      dj_client_id:     body.dj_client_id          ?? null,
      dj_name:          body.dj_name?.trim()        ?? "",
      artist_fee:       collab ? 0 : body.artist_fee !== undefined ? Number(body.artist_fee) : 0,
      advance_payment:  0, // D5: a mirror of the received money in Finance (an advance given here is RECORDED below)
      currency:         isMoneyCurrency(body.currency) ? body.currency : "₪",
      notes:            body.notes?.trim()             ?? "",
    });

    // Sync canonical Finance transactions (confirmed shows: expected balance + DJ / artist rows "צפוי").
    const { syncShowFinance } = await import("@/lib/shows-finance-sync");
    await syncShowFinance(show);
    // D5: an advance typed on creation is money received — it becomes a SHOW_PAYMENT row (never a number on the show)
    let paymentWarning: string | undefined;
    const advance = collab ? 0 : Number(body.advance_payment) || 0;
    if (advance > 0) {
      const { recordShowPayment } = await import("@/lib/writes/show-payments");
      const r = await recordShowPayment(show.id, { amount: advance, date: typeof body.advance_date === "string" ? body.advance_date : new Date().toISOString().slice(0, 10), method: typeof body.payment_method === "string" ? body.payment_method : "" });
      if (r.kind === "refused") paymentWarning = `ההופעה נשמרה, אבל המקדמה לא נרשמה: ${r.messageHe}`;
    }
    // A1: created as "שולם" = the client paid → the REMAINDER (after an advance given here) is recorded once, as a
    // real payment row. DJ / artist fee rows stay "צפוי" (their own obligations).
    const paidIntent = !collab && body.payment_status === "שולם";
    if (paidIntent) {
      const fresh = await getShow(show.id);
      if (fresh) await syncShowFinance(fresh, { markRemainderReceived: true });
    }
    const saved = advance > 0 || paidIntent ? (await getShow(show.id)) ?? show : show;

    // Google Calendar — only if explicitly requested and date exists
    let calendarWarning: string | undefined;
    if (body.addToCalendar === true && show.date) {
      try {
        const times = showCalendarTimes(show);
        if (times) {
          const { isConnected, createCalendarEvent } = await import("@/lib/google-calendar");
          if (await isConnected()) {
            const { patchShow } = await import("@/lib/shows-store");
            const showForCal = await resolveArtistName(show);
            const event = await createCalendarEvent(
              showCalendarSummary(showForCal),
              times.startIso,
              times.endIso,
              { description: showCalendarDescription(showForCal) }
            );
            // Save event ID back to show
            const updated = await patchShow(show.id, { calendar_event_id: event.id });
            return { show: updated, paymentWarning };
          } else {
            calendarWarning = "ההופעה נשמרה, אבל Google Calendar לא מחובר";
          }
        }
      } catch (calErr) {
        calendarWarning = "ההופעה נשמרה, אבל לא נוצר אירוע ביומן Google";
        console.error("[shows POST] calendar error:", calErr);
      }
    }

    return { show: saved, calendarWarning, paymentWarning };
}

export type UpdateShowResult =
  | { kind: "not_found" }
  | { kind: "ok"; show: Show; calendarWarning?: string; paymentReversalNeeded?: { amount: number; entryDate: string }; financeWarning?: string }
  | { kind: "balance_sync_failed"; show: Show; balanceSyncError: string }
  | { kind: "refused"; code: "CURRENCY" | "CURRENCY_HAS_PAYMENTS" | "HAS_PAYMENTS" | "HAS_PAID_FEES" | "DEAL_TYPE" | "UNPAID_COLLAB" | "DEAL_SWITCH_BLOCKED" | "PRICE_REQUIRED"; messageHe: string };

/** PATCH /api/shows/[id] semantics. */
export async function updateShowRecord(id: string, body: Body): Promise<UpdateShowResult> {

    // ── Build DB patch ──────────────────────────────────────────────────────
    const patch: PatchShowInput = {};

    if (body.name             !== undefined) patch.name             = body.name?.trim()            ?? "";
    if (body.artist           !== undefined) patch.artist           = body.artist?.trim()          ?? "";
    if (body.artist_client_id !== undefined) patch.artist_client_id = body.artist_client_id        ?? null;
    if (body.booker_client_id !== undefined) patch.booker_client_id = body.booker_client_id        ?? null;
    if (body.booker_name      !== undefined) patch.booker_name      = body.booker_name?.trim()     ?? "";
    if (body.date             !== undefined) patch.date             = body.date                    || null;
    if (body.start_time       !== undefined) patch.start_time       = body.start_time              || null;
    if (body.location         !== undefined) patch.location         = body.location?.trim()        ?? "";
    if (body.contact_person   !== undefined) patch.contact_person   = body.contact_person?.trim()  ?? "";
    if (body.phone            !== undefined) patch.phone            = body.phone?.trim()           ?? "";
    if (body.status           !== undefined) patch.status           = body.status      as ShowStatus;
    if (body.show_price       !== undefined) patch.show_price       = Number(body.show_price)      || 0;
    if (body.dj_fee           !== undefined) patch.dj_fee           = Number(body.dj_fee);
    if (body.dj_client_id    !== undefined) patch.dj_client_id     = body.dj_client_id    ?? null;
    if (body.dj_name         !== undefined) patch.dj_name          = body.dj_name?.trim() ?? "";
    if (body.artist_fee      !== undefined) patch.artist_fee       = Number(body.artist_fee) || 0;
    // advance_payment is NOT writable (D5): it mirrors the money received in Finance — record a payment instead
    if (body.currency         !== undefined) {
      if (!isMoneyCurrency(body.currency)) return { kind: "refused", code: "CURRENCY", messageHe: "מטבע לא נתמך (₪ / $ / €)" };
      patch.currency = body.currency;
    }
    if (body.notes            !== undefined) patch.notes            = body.notes                   ?? "";
    if (body.calendar_event_id !== undefined) patch.calendar_event_id = body.calendar_event_id    ?? null;

    // ── Fetch current show (needed for calendar logic) ──────────────────────
    const existing = await getShow(id);
    if (!existing) return { kind: "not_found" };
    const received = await receivedPaymentsOf(id);
    if (patch.currency && patch.currency !== (existing.currency || "₪") && received > 0) {
      return { kind: "refused", code: "CURRENCY_HAS_PAYMENTS", messageHe: `כבר התקבלו תשלומים ב-${existing.currency || "₪"} — אי אפשר לשנות את מטבע ההופעה (אין המרה)` };
    }
    if (patch.status && received > 0) {
      const { isConfirmedShowStatus } = await import("@/lib/shows-finance-sync");
      if (!isConfirmedShowStatus(patch.status) && patch.status !== "בוטל") return { kind: "refused", code: "HAS_PAYMENTS", messageHe: "להופעה יש תשלומים שהתקבלו — אי אפשר להחזיר אותה לליד (התשלומים לא נמחקים). אפשר לבטל אותה" };
    }
    // A paid DJ / artist fee is money that went out: a revert to a lead (which removes the show's finance rows) is
    // refused BEFORE any write — same canon as received money (client paid ≠ DJ / artist paid; both are never deleted).
    if (patch.status) {
      const { isConfirmedShowStatus, paidShowFeeRows, paidFeesRefusalHe } = await import("@/lib/shows-finance-sync");
      if (!isConfirmedShowStatus(patch.status) && patch.status !== "בוטל") {
        const paidFees = await paidShowFeeRows(existing);
        if (paidFees.length) return { kind: "refused", code: "HAS_PAID_FEES", messageHe: paidFeesRefusalHe(paidFees) };
      }
    }

    // A1: payment_status in the body is INTENT, never truth. "שולם" moving from a stored non-"שולם" = the client paid
    // the rest → the sync records the REMAINDER once. A no-money label (לא שולם / צפוי) is kept only while Finance holds
    // no payment; everything else is derived from Finance by the sync. Undoing a payment is an explicit Finance
    // correction — never a picker value (a SHOW_PAYMENT row is never turned back into "expected" by a save).
    // ── Deal type (Owner decision 2026-09-27): PAID ↔ UNPAID_COLLAB — NOT a payment status ──────────────────────
    if (body.deal_type !== undefined && !isShowDealType(body.deal_type)) return { kind: "refused", code: "DEAL_TYPE", messageHe: "סוג עסקה לא מוכר (PAID / UNPAID_COLLAB)" };
    const wasCollab = isUnpaidCollab(existing);
    const toCollab = body.deal_type !== undefined ? body.deal_type === "UNPAID_COLLAB" : wasCollab;
    if (toCollab) {
      // an unpaid collaboration carries no money: money in the request is refused (never silently dropped)
      const cs = body.closeShow && typeof body.closeShow === "object" ? body.closeShow : null;
      if (Number(body.show_price) > 0 || Number(body.dj_fee) > 0 || Number(body.artist_fee) > 0 || body.payment_status === "שולם" || (cs && (cs.incomeReceived || cs.djPaid || cs.artistPaid))) {
        return { kind: "refused", code: "UNPAID_COLLAB", messageHe: UNPAID_COLLAB_NO_MONEY_HE };
      }
      delete patch.show_price; delete patch.dj_fee; delete patch.artist_fee;
    }
    if (!wasCollab && toCollab) {
      // PAID → UNPAID_COLLAB: only when nothing real would be lost. Real money (a client payment, a paid fee, a realized
      // artist ledger entry, a rehearsal expense, any other show row) is never deleted / cancelled / hidden → refused.
      const { unpaidCollabSwitchBlockers } = await import("@/lib/shows-finance-sync");
      const blockers = await unpaidCollabSwitchBlockers(existing);
      if (blockers.length) return { kind: "refused", code: "DEAL_SWITCH_BLOCKED", messageHe: `אי אפשר להפוך את ההופעה לשת״פ ללא תשלום — כבר יש לה פעילות כספית אמיתית: ${blockers.join(" · ")}. לא מוחקים ולא מבטלים כסף אמיתי; מטפלים בזה פרטנית בכספים קודם` };
      Object.assign(patch, { deal_type: "UNPAID_COLLAB", show_price: 0, dj_fee: 0, artist_fee: 0, payment_status: "לא שולם" as PaymentStatus });
    }
    if (wasCollab && !toCollab) {
      // UNPAID_COLLAB → PAID: needs the price; then the normal finance flow runs for the show's current state
      if (!(Number(body.show_price) > 0)) return { kind: "refused", code: "PRICE_REQUIRED", messageHe: "מעבר להופעה בתשלום דורש מחיר (גדול מ-0) — ואז נוצר תהליך הכספים הרגיל לפי מצב ההופעה" };
      patch.deal_type = "PAID";
      if (body.dj_fee === undefined) patch.dj_fee = 0; // never an implicit 500 DJ fee on a converted show
    }

    // an unpaid collaboration never records a payment intent and never stores a payment label
    const intent = toCollab ? {} : paymentIntentFromBody(body.payment_status, existing.payment_status);
    if (SHOW_NO_MONEY_LABELS.includes(body.payment_status) && received === 0 && !toCollab) patch.payment_status = body.payment_status as PaymentStatus;

    // ── Save to DB ──────────────────────────────────────────────────────────
    const show = await patchShow(id, patch);
    // A new currency (no payments yet): the show's expected / rehearsal rows and its UNPAID DJ / artist rows carry it
    // too — no conversion. A paid fee row keeps the currency it was paid in (A1: a paid row is never re-currencied).
    if (patch.currency && patch.currency !== (existing.currency || "₪")) {
      await supabase.from("transactions").update({ currency: patch.currency }).eq("show_id", id).in("show_money_role", [SHOW_MONEY_ROLES.EXPECTED, SHOW_MONEY_ROLES.REHEARSAL]);
      await supabase.from("transactions").update({ currency: patch.currency }).eq("show_id", id).in("show_money_role", [SHOW_MONEY_ROLES.DJ, SHOW_MONEY_ROLES.ARTIST]).neq("payment_status", "שולם");
    }
    let financeWarning: string | undefined;
    // Set when unchecking "שולם לאמן" would otherwise silently leave a stale
    // payment record — surfaced to the client instead of ever auto-deleting it.
    let paymentReversalNeeded: { amount: number; entryDate: string } | undefined;
    // Set when a balance-ledger write that SHOULD have happened (artist
    // resolved, fee > 0) actually failed. The whole request must then NOT be
    // reported as successful — see the final response below — even though the
    // show row itself was already saved as "בוצע" a few lines up. There's no
    // multi-table transaction here (no raw Postgres access, no RPC — matching
    // this codebase's existing show↔Finance sync architecture, which is
    // deliberately non-transactional and idempotent-retry-based instead, per
    // shows-finance-sync.ts's own doc comment); the safety net is that every
    // write in artist-balance-show-close-sync.ts is idempotent lookup-before-
    // write, so re-sending the exact same close request after this error
    // always converges to the correct single-row state — it can never create
    // a duplicate, only finish what didn't complete.
    let balanceSyncError: string | undefined;

    // ── Sync canonical Finance transactions when a finance-relevant field changed ──
    if (["payment_status", "show_price", "dj_fee", "dj_name", "artist_fee", "status", "date", "closeShow", "currency", "deal_type"].some((k) => k in body)) {
      const fin = await import("@/lib/shows-finance-sync");
      if (isUnpaidCollab(show)) {
        // zero automatic finance activity; a PAID → UNPAID_COLLAB switch (gated above) removes the still-expected rows
        // of the paid phase through the SAME safe removal a revert to a lead uses (only unpaid expected / DJ / artist)
        if (!wasCollab) await fin.clearShowFinance(show);
      } else if (!fin.isConfirmedShowStatus(show.status) && show.status !== "בוטל") {
        // Reverted to a pipeline status (e.g. "ממתין לתשובה") → remove the show's
        // Finance transactions entirely (not "בוטל"); keep the show itself.
        await fin.clearShowFinance(show);
      } else {
        const report = await fin.syncShowFinance(show, intent);
        if (report.feeConflicts.length) financeWarning = report.feeConflicts.join(" · ");
        // Close-show modal: apply per-party paid/expected statuses to the 3
        // linked transactions (after sync created/linked them).
        if (body.closeShow && typeof body.closeShow === "object") {
          const fresh = await getShow(id);
          if (fresh) {
            await fin.applyShowClosureStatuses(fresh, {
              incomeReceived: !!body.closeShow.incomeReceived,
              djPaid:         !!body.closeShow.djPaid,
              artistPaid:     !!body.closeShow.artistPaid,
            });

            // ── Artist balance ledger: realize income the moment the show is
            // actually performed and its split confirmed — independent of whether
            // the label has paid the artist yet (accrual, not cash). Generic: any
            // show whose artist name resolves to a real label_artists row, not
            // just Shalev. See lib/artist-balance-show-close-sync.ts for the full
            // reasoning (idempotency, and how this coexists with the OTHER,
            // booking-time "הכנסות צפויות" sync in shows-finance-sync.ts).
            // The artist ledger stores no currency: only a ₪ show is realized into it (never a silent FX)
            if (fresh.status === "בוצע" && (fresh.currency || "₪") === "₪") {
              try {
                const { showAgreementSplit } = await import("@/lib/label-agreements");
                const { isValidYmd } = await import("@/lib/artist-balance-store");
                const {
                  resolveShowArtistId, logArtistResolutionSkip,
                  syncArtistIncomeFromClosedShow, findShowPaymentEntry,
                } = await import("@/lib/artist-balance-show-close-sync");

                const resolution = await resolveShowArtistId(fresh.artist);
                if (resolution.status === "skipped") {
                  logArtistResolutionSkip(fresh, resolution.reason);
                } else {
                  const artistId = resolution.artistId;
                  const rehearsalCounted = await fin.getRehearsalCountedForShow(fresh.id);
                  // Owner decision 2026-09-27: only an agreement artist (שליו / אבי) has a defined split — 50 / 50 of the
                  // NET profit; any other roster artist is NOT_DEFINED → nothing is realized into the ledger.
                  const rule = showAgreementSplit(fresh, rehearsalCounted);
                  const artistFee = rule.status === "DEFINED" ? rule.artistFee : 0;
                  // the agreement artist is identified by the roster id (never by the name alone)
                  const payee = rule.status === "DEFINED" ? rule.artist.id : artistId;
                  if (rule.status === "NOT_DEFINED") console.warn(`[shows] close ${fresh.id}: ${rule.reasonHe} — no artist ledger income`);
                  if (artistFee > 0) {
                    // Income: realized the moment the show closes — one row per
                    // show, ever (never a duplicate expected+realized pair).
                    await syncArtistIncomeFromClosedShow({ artistId: payee, show: fresh, amount: artistFee });

                    if (body.closeShow.artistPaid) {
                      // Net model (Owner 2026-09-28): "אמן ✓" = a REAL payment to the artist — Finance (שכר אמן, שולם,
                      // RECORDS) + the ledger payment, ONE writer, idempotent per show (a re-save never pays twice).
                      const paymentDate =
                        typeof body.artistPaidDate === "string" && isValidYmd(body.artistPaidDate)
                          ? body.artistPaidDate
                          : new Date().toISOString().slice(0, 10);
                      const already = await findShowPaymentEntry(fresh.id);
                      if (!already) {
                        const { recordArtistPayment } = await import("@/lib/writes/artist-payments");
                        const paid = await recordArtistPayment({ artistId: payee, amount: artistFee, date: paymentDate, showId: fresh.id, idempotencyKey: `show:${fresh.id}`, description: `תשלום — ${fresh.name}`, allowDuplicate: true });
                        if (paid.kind !== "ok") balanceSyncError = paid.messageHe;
                      }
                    } else {
                      // Unchecked (or never checked) — if a payment was already
                      // recorded for this show, do NOT touch it silently. Tell
                      // the client so the owner can make an explicit correction
                      // in the artist's balance ledger instead.
                      const existingPayment = await findShowPaymentEntry(fresh.id);
                      if (existingPayment) {
                        paymentReversalNeeded = { amount: existingPayment.amount, entryDate: existingPayment.entryDate };
                      }
                    }
                  }
                }
              } catch (balErr) {
                console.error("[shows PATCH] artist balance close-sync FAILED:", balErr);
                balanceSyncError = balErr instanceof Error ? balErr.message : "עדכון המאזן של האמן נכשל";
              }
            }
          }
        }
      }
    }

    // ── Close the quote follow-up task on a real terminal status change ──────
    // Server-authoritative: fires ONLY on a saved status transition (never on the
    // client-side "הצעה אושרה" click). אושרה/נסגר/בוצע → task "בוצע"; בוטל → "בוטל".
    // Non-fatal, idempotent, no-op when the show has no quote follow-up task.
    if ("status" in body) {
      try {
        const { closeQuoteFollowupTask } = await import("@/lib/show-quote-followup");
        const { isConfirmedShowStatus } = await import("@/lib/shows-finance-sync");
        if (show.status === "בוטל") {
          await closeQuoteFollowupTask(id, "בוטל");
          // Show cancelled → its still-OPEN linked tasks are no longer relevant.
          // Linked strictly by tasks.show_id (never by title text, never by
          // related_type); only "פתוח" is moved, nothing is ever deleted.
          const { cancelOpenShowTasks } = await import("@/lib/show-cancel-tasks");
          await cancelOpenShowTasks(id);
        } else if (isConfirmedShowStatus(show.status)) {
          await closeQuoteFollowupTask(id, "בוצע");
        }
      } catch (taskErr) {
        console.error("[shows PATCH] follow-up close error:", taskErr);
      }
    }

    // ── Google Calendar ─────────────────────────────────────────────────────
    let calendarWarning: string | undefined;

    // Case R: user requests removal from calendar
    if (body.removeFromCalendar === true && existing.calendar_event_id) {
      try {
        const { isConnected, deleteCalendarEvent, calendarEventExists } = await import("@/lib/google-calendar");
        if (await isConnected()) {
          const stillExists = await calendarEventExists(existing.calendar_event_id);
          if (stillExists) await deleteCalendarEvent(existing.calendar_event_id);
        }
      } catch (calErr) {
        console.error("[shows PATCH] calendar delete error:", calErr);
      }
      const updated = await patchShow(id, { calendar_event_id: null });
      return { kind: "ok", show: updated };
    }

    // Case A: user explicitly requests "add to calendar"
    if (body.addToCalendar === true && show.date) {
      try {
        const times = showCalendarTimes(show);
        if (times) {
          const { isConnected, createCalendarEvent, calendarEventExists } = await import("@/lib/google-calendar");
          if (await isConnected()) {
            // Check if existing event was deleted from Google
            const existingId = show.calendar_event_id;
            if (existingId && await calendarEventExists(existingId)) {
              // Event still alive — nothing to do
              return { kind: "ok", show };
            }
            // Prefer artist info sent from the UI draft (may be newer than DB)
            let showForCal = { ...show };
            if (!showForCal.artist && body.artist?.trim()) {
              showForCal.artist = body.artist.trim();
            }
            if (!showForCal.artist_client_id && body.artist_client_id) {
              showForCal.artist_client_id = body.artist_client_id;
            }
            // If still empty, try to resolve from clients table
            showForCal = await resolveArtistName(showForCal);
            // Persist any resolved artist back to DB
            const dbPatch: PatchShowInput = { calendar_event_id: undefined };
            if (showForCal.artist && !show.artist) {
              dbPatch.artist = showForCal.artist;
            }
            if (showForCal.artist_client_id && !show.artist_client_id) {
              dbPatch.artist_client_id = showForCal.artist_client_id;
            }
            // Create fresh event
            const event = await createCalendarEvent(
              showCalendarSummary(showForCal),
              times.startIso,
              times.endIso,
              { description: showCalendarDescription(showForCal) }
            );
            dbPatch.calendar_event_id = event.id;
            const updated = await patchShow(id, dbPatch);
            return { kind: "ok", show: updated };
          } else {
            calendarWarning = "ההופעה עודכנה, אבל Google Calendar לא מחובר";
          }
        }
      } catch (calErr) {
        calendarWarning = "ההופעה עודכנה, אבל לא נוצר אירוע ביומן Google";
        console.error("[shows PATCH] calendar create error:", calErr);
      }
    }

    // Case B: event already exists — sync if any relevant field changed
    else if (show.calendar_event_id) {
      const calendarFieldChanged = Object.keys(body).some(k => CALENDAR_SYNC_FIELDS.has(k));
      if (calendarFieldChanged) {
        try {
          const times = showCalendarTimes(show);
          const { isConnected, updateCalendarEvent, calendarEventExists } = await import("@/lib/google-calendar");
          if (await isConnected()) {
            // If event was manually deleted, clear the stale ID and skip update
            const stillExists = await calendarEventExists(show.calendar_event_id);
            if (!stillExists) {
              const updated = await patchShow(id, { calendar_event_id: null });
              calendarWarning = "האירוע ביומן Google נמחק ידנית — ניתן להוסיף מחדש";
              return { kind: "ok", show: updated, calendarWarning };
            }
            const showForCal = await resolveArtistName(show);
            await updateCalendarEvent(show.calendar_event_id, {
              summary:     showCalendarSummary(showForCal),
              location:    show.location || undefined,
              description: showCalendarDescription(showForCal),
              ...(times ? { startIso: times.startIso, endIso: times.endIso } : {}),
            });
          } else {
            calendarWarning = "ההופעה עודכנה, אבל האירוע ביומן Google לא עודכן (לא מחובר)";
          }
        } catch (calErr) {
          calendarWarning = "ההופעה עודכנה, אבל האירוע ביומן Google לא עודכן";
          console.error("[shows PATCH] calendar update error:", calErr);
        }
      }
    }

    if (balanceSyncError) return { kind: "balance_sync_failed", show, balanceSyncError };
    return { kind: "ok", show, calendarWarning, paymentReversalNeeded, financeWarning };
}

/** DELETE /api/shows/[id] semantics: blocked while rehearsals exist; the show's finance rows are hard-deleted first. */
export type ShowDeleteRefusal = { kind: "has_rehearsals"; rehearsalCount: number } | { kind: "has_payments"; paymentCount: number } | { kind: "has_paid_fees"; messageHe: string };
/** The delete preconditions, read-only (rehearsals, received payments, paid DJ / artist fees) — checked BEFORE any write. */
async function showDeleteRefusal(id: string): Promise<ShowDeleteRefusal | null> {
  const { countShowRehearsals, paidShowFeeRows, paidFeesRefusalHe } = await import("@/lib/shows-finance-sync");
  const rehearsalCount = await countShowRehearsals(id);
  if (rehearsalCount > 0) return { kind: "has_rehearsals", rehearsalCount };
  // D5: money actually received is never deleted with its show
  const paymentCount = await receivedPaymentsOf(id);
  if (paymentCount > 0) return { kind: "has_payments", paymentCount };
  // Money paid out (a DJ / artist fee row "שולם") is never deleted with its show either
  const show = await getShow(id);
  const paidFees = show ? await paidShowFeeRows(show) : [];
  if (paidFees.length) return { kind: "has_paid_fees", messageHe: paidFeesRefusalHe(paidFees) };
  return null;
}

export async function deleteShowRecord(id: string): Promise<{ kind: "ok"; deletedTransactions: number } | ShowDeleteRefusal> {
    // Safety: block deletion when the show has linked rehearsals (they carry
    // their own sessions + Finance transactions). No auto-delete — the owner
    // must handle the rehearsals first. 409 with a clear message.
    // D5 + paid fees: money that actually moved (received or paid out) is never deleted with its show.
    const refusal = await showDeleteRefusal(id);
    if (refusal) return refusal;
    // Real delete: hard-delete the show's linked Finance transactions (NOT
    // cancel — don't leave them as "בוטל"), then remove the show. No
    // syncShowFinance here. (status="בוטל" cancellation is handled separately
    // via PATCH → syncShowFinance, and is unchanged.)
    const show = await getShow(id);
    let deletedTransactions = 0;
    if (show) {
      const { deleteShowFinance } = await import("@/lib/shows-finance-sync");
      deletedTransactions = await deleteShowFinance(show);
    }
    await deleteShow(id);
    return { kind: "ok", deletedTransactions };
}

/** The close-show dialog, server-side (ShowsHubPreview CloseShowModal semantics): client payment → payment_status,
 *  optional → בוצע, DJ name, per-party closure flags, the artist payment date, and the same summary line in the notes. */
export async function closeShowRecord(id: string, c: { markDone: boolean; incomeReceived: boolean; djPaid: boolean; artistPaid: boolean; artistPaidDate?: string; djName?: string; note?: string }): Promise<UpdateShowResult> {
  const show = await getShow(id);
  if (!show) return { kind: "not_found" };
  if (isUnpaidCollab(show)) {
    // an unpaid collaboration closes OPERATIONALLY only: no money flags, no payment, no ledger (Owner decision 2026-09-27)
    if (c.incomeReceived || c.djPaid || c.artistPaid) return { kind: "refused", code: "UNPAID_COLLAB", messageHe: UNPAID_COLLAB_NO_MONEY_HE };
    const stamp = new Date().toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
    const summary = `סגירת הופעה ${stamp}: שת״פ ללא תשלום${c.note?.trim() ? ` — ${c.note.trim()}` : ""}`;
    return updateShowRecord(id, { ...(c.markDone ? { status: "בוצע" } : {}), notes: [show.notes?.trim(), summary].filter(Boolean).join("\n") });
  }
  const { showAgreementSplit } = await import("@/lib/label-agreements");
  const { getRehearsalCountedForShow } = await import("@/lib/shows-finance-sync");
  const split = showAgreementSplit(show, await getRehearsalCountedForShow(id));
  const djRelevant = (show.dj_fee ?? 0) > 0;
  const artRelevant = split.status === "DEFINED" && split.artistFee > 0;
  const body: Body = {};
  // D5: "received" records the REMAINING balance as a payment; "not received" leaves Finance as it is (a recorded
  // deposit is never downgraded) — the show's payment status is derived from Finance by the sync.
  if (c.incomeReceived) body.payment_status = "שולם";
  if (c.markDone) body.status = "בוצע";
  const djName = (c.djName ?? show.dj_name ?? "").trim();
  if (djRelevant && djName && djName !== (show.dj_name ?? "")) body.dj_name = djName;
  body.closeShow = { incomeReceived: c.incomeReceived, djPaid: djRelevant && c.djPaid, artistPaid: artRelevant && c.artistPaid };
  if (artRelevant && c.artistPaid) body.artistPaidDate = c.artistPaidDate ?? new Date().toISOString().slice(0, 10);
  const stamp = new Date().toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
  const parts = [`התקבל ${c.incomeReceived ? "✓" : "✗"}`, djRelevant ? `דיג׳יי${djName ? ` (${djName})` : ""} ${c.djPaid ? "✓" : "✗"}` : null, artRelevant ? `אמן ${c.artistPaid ? "✓" : "✗"}` : null].filter(Boolean).join(" · ");
  const summary = `סגירת הופעה ${stamp}: ${parts}${c.note?.trim() ? ` — ${c.note.trim()}` : ""}`;
  body.notes = [show.notes?.trim(), summary].filter(Boolean).join("\n");
  return updateShowRecord(id, body);
}

/** Tasks linked to a show (tasks.show_id — never by title). */
export async function showTaskIds(showId: string): Promise<string[]> {
  const { data, error } = await supabase.from("tasks").select("id").eq("show_id", showId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string }>).map((t) => t.id);
}

/** The Shows hub delete, server-side: its calendar event first, then its linked tasks (and their Google Tasks), then the
 *  show (blocked while rehearsals exist; its finance rows hard-deleted by deleteShowRecord). */
export async function deleteShowCompletely(id: string): Promise<{ kind: "ok"; deletedTransactions: number; deletedTasks: number } | ShowDeleteRefusal | { kind: "not_found" }> {
  const show = await getShow(id);
  if (!show) return { kind: "not_found" };
  // Every refusal (rehearsals / received payments / paid DJ-artist fees) BEFORE the calendar / tasks / finance writes
  const refusal = await showDeleteRefusal(id);
  if (refusal) return refusal;
  if (show.calendar_event_id) {
    const r = await updateShowRecord(id, { removeFromCalendar: true });
    if (r.kind !== "ok") throw new Error("calendar removal failed");
  }
  const { deleteTaskRecord } = await import("@/lib/writes/tasks");
  let deletedTasks = 0;
  for (const t of await showTaskIds(id)) if ((await deleteTaskRecord(t)) === "ok") deletedTasks++;
  const d = await deleteShowRecord(id);
  if (d.kind !== "ok") return d;
  return { kind: "ok", deletedTransactions: d.deletedTransactions, deletedTasks };
}

/** POST /api/shows/[id]/quote-sent semantics: a pipeline show gets its single follow-up task (dedup by show + marker). */
export async function markQuoteSent(id: string): Promise<{ kind: "not_found" } | { kind: "skipped" } | { kind: "ok"; task: unknown; created: boolean }> {
  const raw = await getShow(id);
  if (!raw) return { kind: "not_found" };
  const { isConfirmedShowStatus } = await import("@/lib/shows-finance-sync");
  if (isConfirmedShowStatus(raw.status) || raw.status === "בוטל") return { kind: "skipped" };
  const show = await resolveArtistName(raw);
  const { ensureQuoteFollowupTask } = await import("@/lib/show-quote-followup");
  const { task, created } = await ensureQuoteFollowupTask({ showId: show.id, artist: show.artist, contact: show.contact_person || show.booker_name, amount: show.show_price, date: show.date, status: show.status });
  return { kind: "ok", task, created };
}

/** The Owner's 'שלח' buttons, server-side: the notifiers re-read the show and build the push themselves. */
export async function notifyShowArtist(id: string) {
  const show = await getShow(id);
  if (!show) return { ok: false as const, reason: "not_found" as const };
  const { notifyShalevAboutShow } = await import("@/lib/show-notify");
  return notifyShalevAboutShow(show);
}
/** READ-ONLY: the artist (Shalev) + DJ (CLEANTONE) send state of a show, from the canonical claim rows. null = no show. */
export async function showNotifyStates(id: string) {
  const show = await getShow(id);
  if (!show) return null;
  const [{ readShalevShowNotifyState }, { readDjShowNotifyState }] = await Promise.all([import("@/lib/show-notify"), import("@/lib/dj-show-notify")]);
  const [artist, dj] = await Promise.all([readShalevShowNotifyState(show), readDjShowNotifyState(show)]);
  return { artist, dj };
}
export async function notifyShowDj(id: string) {
  const show = await getShow(id);
  if (!show) return { ok: false as const, reason: "not_found" as const };
  const { notifyDjAboutShow } = await import("@/lib/dj-show-notify");
  return notifyDjAboutShow(show);
}

export async function readShow(id: string): Promise<Show | null> { return getShow(id); }
export async function showFinanceRowCount(show: Show): Promise<number> {
  return [show.linked_income_transaction_id, show.linked_dj_expense_transaction_id, show.linked_artist_expense_transaction_id].filter(Boolean).length;
}

// ── A1: DJ / artist fees are their own obligations (Owner canon 2026-09-27) ─────────────────────────────────────────
export type ShowFeeRole = typeof SHOW_MONEY_ROLES.DJ | typeof SHOW_MONEY_ROLES.ARTIST;
export type { ShowFeeRow } from "@/lib/shows-finance-sync";
/** READ-ONLY: a show's DJ / artist fee rows in Finance (the shared batched reader; null = no row). */
export async function showFeeRows(show: Pick<Show, "id" | "linked_dj_expense_transaction_id" | "linked_artist_expense_transaction_id">) {
  const { getShowFeeRowsMap } = await import("@/lib/shows-finance-sync");
  return (await getShowFeeRowsMap([show]))[show.id];
}

export type SetShowFeePaidResult =
  | { kind: "not_found" }
  | { kind: "refused"; code: "BAD_ROLE" | "BAD_ARGS" | "BAD_DATE" | "BAD_METHOD" | "NO_FEE_ROW" | "ALREADY_PAID" | "NOT_PAID" | "FEE_CANCELLED" | "UNPAID_COLLAB" | "NO_AGREEMENT" | "UNPAY_VIA_LEDGER" | "PAYMENT_INCOMPLETE" | "DUPLICATE" | "NOT_ILS"; messageHe: string }
  | { kind: "ok"; transactionId: string; before: string | null; after: string };

/**
 * The explicit "the DJ / the artist was paid" (or the explicit undo back to "צפוי") on the show's EXISTING fee row —
 * the one writer for it outside the close dialog (Sunny MARK_SHOW_FEE_PAID; the Finance page's own row edit stays a
 * valid path because the show sync never overwrites a fee status). Never creates a row, never touches the client
 * payment, the other fee, or the artist balance ledger.
 */
export async function setShowFeePaid(showId: string, role: unknown, paid: unknown, opts: { date?: unknown; method?: unknown } = {}): Promise<SetShowFeePaidResult> {
  if (role !== SHOW_MONEY_ROLES.DJ && role !== SHOW_MONEY_ROLES.ARTIST) return { kind: "refused", code: "BAD_ROLE", messageHe: "DJ_FEE או ARTIST_FEE" };
  if (typeof paid !== "boolean") return { kind: "refused", code: "BAD_ARGS", messageHe: "שולם: כן / לא" };
  const date = opts.date === undefined || opts.date === null || opts.date === "" ? null : opts.date;
  if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) return { kind: "refused", code: "BAD_DATE", messageHe: "תאריך לא תקין (YYYY-MM-DD)" };
  const method = opts.method === undefined || opts.method === null ? "" : opts.method;
  const { PAYMENT_METHODS } = await import("@/lib/writes/show-payments");
  if (typeof method !== "string" || !(PAYMENT_METHODS as readonly string[]).includes(method)) return { kind: "refused", code: "BAD_METHOD", messageHe: "אמצעי תשלום לא מוכר" };
  const show = await getShow(showId);
  if (!show) return { kind: "not_found" };
  if (isUnpaidCollab(show)) return { kind: "refused", code: "UNPAID_COLLAB", messageHe: UNPAID_COLLAB_NO_MONEY_HE };
  // Net model (Owner 2026-09-28): the ARTIST is paid by a REAL payment (Finance + ledger, lib/writes/artist-payments) —
  // never by marking an artist-fee row. The show share is the ONE rule (showAgreementSplit); a payment already recorded
  // for the show (ledger payment of the show, or a legacy paid artist-fee row) is ALREADY_PAID. Un-paying is cancelling
  // that payment in the artist's balance (its Finance row becomes בוטל) — never here.
  if (role === SHOW_MONEY_ROLES.ARTIST) {
    if (!paid) return { kind: "refused", code: "UNPAY_VIA_LEDGER", messageHe: "ביטול תשלום לאמן נעשה בעמוד האמן → מאזן → מחיקת התשלום (שורת הכספים תסומן 'בוטל', לא תימחק)" };
    const { showAgreementSplit } = await import("@/lib/label-agreements");
    const { getRehearsalCountedForShow, isConfirmedShowStatus } = await import("@/lib/shows-finance-sync");
    if (show.status === "בוטל") return { kind: "refused", code: "FEE_CANCELLED", messageHe: "ההופעה בוטלה — אין זכאות לאמן; אם שולם בכל זאת, רושמים תשלום במאזן האמן" };
    if (!isConfirmedShowStatus(show.status)) return { kind: "refused", code: "NO_FEE_ROW", messageHe: "ההופעה עדיין לא מאושרת — אין זכאות לאמן לשלם עליה" };
    const rule = showAgreementSplit(show, await getRehearsalCountedForShow(show.id));
    if (rule.status !== "DEFINED" || !(rule.artistFee > 0)) return { kind: "refused", code: "NO_AGREEMENT", messageHe: rule.status === "DEFINED" ? "אין שכר אמן בהופעה" : rule.reasonHe };
    const legacy = (await showFeeRows(show))[role];
    const { findShowPaymentEntry } = await import("@/lib/artist-balance-show-close-sync");
    if ((legacy && legacy.status === "שולם") || (await findShowPaymentEntry(show.id))) return { kind: "refused", code: "ALREADY_PAID", messageHe: "כבר רשום תשלום לאמן על ההופעה הזו" };
    const { recordArtistPayment } = await import("@/lib/writes/artist-payments");
    const r = await recordArtistPayment({ artistId: rule.artist.id, amount: rule.artistFee, date: (date as string | null) ?? new Date().toISOString().slice(0, 10), method: method as string, showId: show.id, idempotencyKey: `show:${show.id}`, description: `תשלום — ${show.name}`, currency: show.currency || "₪", allowDuplicate: true });
    if (r.kind === "partial") return { kind: "refused", code: "PAYMENT_INCOMPLETE", messageHe: r.messageHe };
    if (r.kind === "refused") return { kind: "refused", code: r.code === "NOT_ILS" ? "NOT_ILS" : r.code === "DUPLICATE" ? "DUPLICATE" : "BAD_ARGS", messageHe: r.messageHe };
    return { kind: "ok", transactionId: r.transactionId, before: null, after: "שולם" };
  }
  const row = (await showFeeRows(show))[role];
  const who = role === SHOW_MONEY_ROLES.DJ ? "ה-DJ" : "האמן";
  if (!row) return { kind: "refused", code: "NO_FEE_ROW", messageHe: `להופעה אין שורת שכר ${who} בפיננסים` };
  if (paid && row.status === "שולם") return { kind: "refused", code: "ALREADY_PAID", messageHe: `שכר ${who} כבר מסומן שולם` };
  if (paid && row.status === "בוטל") return { kind: "refused", code: "FEE_CANCELLED", messageHe: `שורת שכר ${who} מבוטלת (הופעה מבוטלת / שכר 0) — אם שולם בכל זאת, מתקנים בפיננסים` };
  if (!paid && row.status !== "שולם") return { kind: "refused", code: "NOT_PAID", messageHe: `שכר ${who} לא מסומן שולם` };
  const upd: Record<string, unknown> = paid
    ? { payment_status: "שולם", date: date ?? new Date().toISOString().slice(0, 10), ...(method ? { payment_method: method } : {}) }
    : { payment_status: "צפוי", date: show.date || row.date };
  const { error } = await supabase.from("transactions").update(upd).eq("id", row.id);
  if (error) throw new Error(error.message);
  // Back to "צפוי": the row is unpaid again, so the show's own rule re-prices it (the sync never touches a paid row)
  if (!paid) { const { syncShowFinance } = await import("@/lib/shows-finance-sync"); await syncShowFinance(show); }
  return { kind: "ok", transactionId: row.id, before: row.status, after: String(upd.payment_status) };
}
