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
import { isMoneyCurrency, SHOW_MONEY_ROLES } from "@/lib/shows-types";

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
  "booker_name", "contact_person", "phone", "show_price", "dj_fee",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

/** POST /api/shows semantics (the caller validated the name). */
export async function createShowRecord(body: Body): Promise<{ show: Show; calendarWarning?: string; paymentWarning?: string }> {
    if (body.currency !== undefined && !isMoneyCurrency(body.currency)) throw new Error("מטבע לא נתמך (₪ / $ / €)");
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
      payment_status:   body.payment_status            ?? "לא שולם",
      show_price:       Number(body.show_price)        || 0,
      dj_fee:           body.dj_fee !== undefined ? Number(body.dj_fee) : 500,
      dj_client_id:     body.dj_client_id          ?? null,
      dj_name:          body.dj_name?.trim()        ?? "",
      artist_fee:       body.artist_fee !== undefined ? Number(body.artist_fee) : 0,
      advance_payment:  0, // D5: a mirror of the received money in Finance (an advance given here is RECORDED below)
      currency:         isMoneyCurrency(body.currency) ? body.currency : "₪",
      notes:            body.notes?.trim()             ?? "",
    });

    // Sync canonical Finance transactions (no-op unless created as "שולם").
    const { syncShowFinance } = await import("@/lib/shows-finance-sync");
    await syncShowFinance(show);
    // D5: an advance typed on creation is money received — it becomes a SHOW_PAYMENT row (never a number on the show)
    let paymentWarning: string | undefined;
    const advance = Number(body.advance_payment) || 0;
    if (advance > 0) {
      const { recordShowPayment } = await import("@/lib/writes/show-payments");
      const r = await recordShowPayment(show.id, { amount: advance, date: typeof body.advance_date === "string" ? body.advance_date : new Date().toISOString().slice(0, 10), method: typeof body.payment_method === "string" ? body.payment_method : "" });
      if (r.kind === "refused") paymentWarning = `ההופעה נשמרה, אבל המקדמה לא נרשמה: ${r.messageHe}`;
    }
    const saved = advance > 0 ? (await getShow(show.id)) ?? show : show;

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
  | { kind: "ok"; show: Show; calendarWarning?: string; paymentReversalNeeded?: { amount: number; entryDate: string } }
  | { kind: "balance_sync_failed"; show: Show; balanceSyncError: string }
  | { kind: "refused"; code: "CURRENCY" | "CURRENCY_HAS_PAYMENTS" | "HAS_PAYMENTS"; messageHe: string };

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
    if (body.payment_status   !== undefined) patch.payment_status   = body.payment_status as PaymentStatus;
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

    // ── Save to DB ──────────────────────────────────────────────────────────
    const show = await patchShow(id, patch);
    // A new currency (no payments yet): the show's expected / DJ / artist / rehearsal rows carry it too — no conversion
    if (patch.currency && patch.currency !== (existing.currency || "₪")) {
      await supabase.from("transactions").update({ currency: patch.currency }).eq("show_id", id).neq("show_money_role", SHOW_MONEY_ROLES.PAYMENT);
    }
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
    if (["payment_status", "show_price", "dj_fee", "dj_name", "artist_fee", "status", "date", "closeShow", "currency"].some((k) => k in body)) {
      const fin = await import("@/lib/shows-finance-sync");
      if (!fin.isConfirmedShowStatus(show.status) && show.status !== "בוטל") {
        // Reverted to a pipeline status (e.g. "ממתין לתשובה") → remove the show's
        // Finance transactions entirely (not "בוטל"); keep the show itself.
        await fin.clearShowFinance(show);
      } else {
        await fin.syncShowFinance(show);
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
                const { computeShowSplit } = await import("@/lib/shows-types");
                const { isValidYmd } = await import("@/lib/artist-balance-store");
                const {
                  resolveShowArtistId, logArtistResolutionSkip,
                  syncArtistIncomeFromClosedShow, createShowArtistPayment, findShowPaymentEntry,
                } = await import("@/lib/artist-balance-show-close-sync");

                const resolution = await resolveShowArtistId(fresh.artist);
                if (resolution.status === "skipped") {
                  logArtistResolutionSkip(fresh, resolution.reason);
                } else {
                  const artistId = resolution.artistId;
                  const rehearsalCounted = await fin.getRehearsalCountedForShow(fresh.id);
                  const artistFee = computeShowSplit(fresh, rehearsalCounted).artistFee;
                  if (artistFee > 0) {
                    // Income: realized the moment the show closes — one row per
                    // show, ever (never a duplicate expected+realized pair).
                    await syncArtistIncomeFromClosedShow({ artistId, show: fresh, amount: artistFee });

                    if (body.closeShow.artistPaid) {
                      // Payment: a separate, unconstrained event — only ever
                      // CREATED here, never edited/deleted by this flow again.
                      const paymentDate =
                        typeof body.artistPaidDate === "string" && isValidYmd(body.artistPaidDate)
                          ? body.artistPaidDate
                          : new Date().toISOString().slice(0, 10);
                      await createShowArtistPayment({ artistId, show: fresh, amount: artistFee, paymentDate });
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
    return { kind: "ok", show, calendarWarning, paymentReversalNeeded };
}

/** DELETE /api/shows/[id] semantics: blocked while rehearsals exist; the show's finance rows are hard-deleted first. */
export async function deleteShowRecord(id: string): Promise<{ kind: "ok"; deletedTransactions: number } | { kind: "has_rehearsals"; rehearsalCount: number } | { kind: "has_payments"; paymentCount: number }> {
    // Safety: block deletion when the show has linked rehearsals (they carry
    // their own sessions + Finance transactions). No auto-delete — the owner
    // must handle the rehearsals first. 409 with a clear message.
    const { countShowRehearsals } = await import("@/lib/shows-finance-sync");
    const rehearsalCount = await countShowRehearsals(id);
    if (rehearsalCount > 0) return { kind: "has_rehearsals", rehearsalCount };
    // D5: money actually received is never deleted with its show
    const paymentCount = await receivedPaymentsOf(id);
    if (paymentCount > 0) return { kind: "has_payments", paymentCount };
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
  const { computeShowSplit } = await import("@/lib/shows-types");
  const { getRehearsalCountedForShow } = await import("@/lib/shows-finance-sync");
  const split = computeShowSplit(show, await getRehearsalCountedForShow(id));
  const djRelevant = (show.dj_fee ?? 0) > 0;
  const artRelevant = split.artistFee > 0;
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
export async function deleteShowCompletely(id: string): Promise<{ kind: "ok"; deletedTransactions: number; deletedTasks: number } | { kind: "has_rehearsals"; rehearsalCount: number } | { kind: "has_payments"; paymentCount: number } | { kind: "not_found" }> {
  const show = await getShow(id);
  if (!show) return { kind: "not_found" };
  const { countShowRehearsals } = await import("@/lib/shows-finance-sync");
  const rehearsalCount = await countShowRehearsals(id);
  if (rehearsalCount > 0) return { kind: "has_rehearsals", rehearsalCount };
  const paymentCount = await receivedPaymentsOf(id);
  if (paymentCount > 0) return { kind: "has_payments", paymentCount };
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
