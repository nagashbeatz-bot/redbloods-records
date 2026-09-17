import { NextRequest, NextResponse } from "next/server";
import {
  getShow, patchShow, deleteShow,
  showCalendarSummary, showCalendarTimes, showCalendarDescription,
} from "@/lib/shows-store";
import type { PatchShowInput, ShowStatus, PaymentStatus, Show } from "@/lib/shows-store";
import { supabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/require-auth";

/** If show.artist is empty but artist_client_id exists, resolve name from DB. */
async function resolveArtistName(show: Show): Promise<Show> {
  if (show.artist || !show.artist_client_id) return show;
  const { data } = await supabase
    .from("clients")
    .select("name")
    .eq("id", show.artist_client_id)
    .single();
  if (data?.name) return { ...show, artist: data.name };
  return show;
}

type Ctx = { params: Promise<{ id: string }> };

// Fields that, when changed, should sync to Google Calendar
const CALENDAR_SYNC_FIELDS = new Set([
  "name", "artist", "date", "start_time", "location",
  "booker_name", "contact_person", "phone", "show_price", "dj_fee",
]);

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();

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
    if (body.advance_payment  !== undefined) patch.advance_payment  = Number(body.advance_payment) || 0;
    if (body.notes            !== undefined) patch.notes            = body.notes                   ?? "";
    if (body.calendar_event_id !== undefined) patch.calendar_event_id = body.calendar_event_id    ?? null;

    // ── Fetch current show (needed for calendar logic) ──────────────────────
    const existing = await getShow(id);
    if (!existing) return NextResponse.json({ error: "הופעה לא נמצאה" }, { status: 404 });

    // ── Save to DB ──────────────────────────────────────────────────────────
    const show = await patchShow(id, patch);
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
    if (["payment_status", "show_price", "dj_fee", "dj_name", "artist_fee", "status", "date", "closeShow"].some((k) => k in body)) {
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
            if (fresh.status === "בוצע") {
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
      return NextResponse.json({ show: updated });
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
              return NextResponse.json({ show });
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
            return NextResponse.json({ show: updated });
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
              return NextResponse.json({ show: updated, calendarWarning });
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

    // A balance-sync failure means the request did NOT fully succeed, even
    // though the show row itself was saved — non-2xx so the client's own
    // `if (!res.ok) throw ...` treats this as a failure, never a silent
    // success. Retrying the same close action is always safe (see above).
    if (balanceSyncError) {
      return NextResponse.json({
        error: `ההופעה נשמרה, אך עדכון המאזן של האמן נכשל (${balanceSyncError}). ניתן לנסות לסגור את ההופעה שוב — הפעולה בטוחה לחזרה ולא תיצור כפילויות.`,
        show,
      }, { status: 502 });
    }

    return NextResponse.json({ show, ...(calendarWarning ? { calendarWarning } : {}), ...(paymentReversalNeeded ? { paymentReversalNeeded } : {}) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await ctx.params;
    // Safety: block deletion when the show has linked rehearsals (they carry
    // their own sessions + Finance transactions). No auto-delete — the owner
    // must handle the rehearsals first. 409 with a clear message.
    const { countShowRehearsals } = await import("@/lib/shows-finance-sync");
    const rehearsalCount = await countShowRehearsals(id);
    if (rehearsalCount > 0) {
      return NextResponse.json({
        error: `להופעה יש ${rehearsalCount} חזרות מקושרות עם הוצאות — יש לטפל בהן לפני מחיקת ההופעה`,
        rehearsalCount,
      }, { status: 409 });
    }
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
    return NextResponse.json({ ok: true, deletedTransactions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
