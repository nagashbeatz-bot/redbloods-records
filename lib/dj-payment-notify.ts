import "server-only";
import { supabase } from "./supabase";
import { settingsClaimStore, pushAllowed } from "./push-claims";
import { classify, deliverOnce, type DeliverOnceOutcome } from "./push-claims-pure";
import { CLEANTONE_CLIENT_ID } from "./red-artists/cleantone";
import {
  DJ_PAYMENT_CLAIM_VERSION,
  buildDjPaymentOwnerAck,
  buildDjPaymentPush,
  djPaymentClaimKey,
  djPaymentEligibility,
  isDjFeeRealPaidTransition,
  type DjPaymentSkipReason,
} from "./dj-payment-notify-pure";

/**
 * "The DJ was paid" — ONE shared notification point for every writer that can move a show's DJ_FEE row to שולם
 * (Owner decision 2026-10-03):
 *   • the close dialog (applyShowClosureStatuses, lib/shows-finance-sync)  • setShowFeePaid / Sunny MARK_SHOW_FEE_PAID (DJ)
 *   • a Finance edit of the row (updateTransactionRecord, lib/writes/finance — the Finance page + Sunny's finance primitives).
 * Each writer calls it AFTER its own update succeeded, with the row's status BEFORE the update. It sends only on a real
 * not-paid → שולם transition, from the server (never a GET / page load / refresh / UI).
 *
 * Order (the money is already committed and is NEVER touched here):
 *   1. a real transition (before !== שולם) and the row is שולם now (fresh read);
 *   2. eligible: a DJ_FEE row (or the show's legacy-linked DJ row), the show's DJ is CLEANTONE, a fee > 0;
 *   3. pushAllowed() (production, or an explicit opt-in) — checked BEFORE any claim, so a dev run never leaves a stuck claim;
 *   4. ONE delivery claim per payment (settings `dj_payment_paid:<DJ_FEE transaction id>` — INSERT-first / compare-and-swap,
 *      no schema change): two writers / a double click / a retry race to one push; a "sent" claim never re-sends;
 *   5. the push to CLEANTONE; the claim says "sent" only after a classified delivery success, else a durable "failed";
 *   6. ONLY when step 5 was delivered (not on already_sent): the Owner's confirmation. Its failure is logged / reported and
 *      never re-sends the DJ's push and never undoes anything.
 * A push failure is a side effect: it never fails the payment and the DJ_FEE row stays שולם. Never throws.
 */

export type DjPaymentNotifyResult =
  | { kind: "skipped"; reason: DjPaymentSkipReason | "not_a_transition" | "push_not_allowed" | "row_not_found" | "show_not_found" }
  | { kind: "attempted"; dj: DeliverOnceOutcome; ownerAck: "sent" | "failed" | "not_attempted"; warning?: string };

type TxRow = { id: string; show_id: string | null; show_money_role: string | null; amount: number | string | null; currency: string | null; payment_status: string | null };
type ShowRow = { id: string; name: string | null; dj_client_id: string | null; dj_fee: number | string | null; currency: string | null };

export async function notifyDjFeePaid(input: { txId: string; before: string | null | undefined }): Promise<DjPaymentNotifyResult> {
  try {
    if (!input.txId || !isDjFeeRealPaidTransition(input.before, "שולם")) return { kind: "skipped", reason: "not_a_transition" };
    if (!pushAllowed()) return { kind: "skipped", reason: "push_not_allowed" }; // localhost / non-prod: never a real send, never a claim

    const { data: tx, error: txErr } = await supabase.from("transactions").select("id, show_id, show_money_role, amount, currency, payment_status").eq("id", input.txId).maybeSingle();
    if (txErr) throw new Error(txErr.message);
    if (!tx) return { kind: "skipped", reason: "row_not_found" };
    const row = tx as TxRow;

    // the show: the row's own show_id (DJ_FEE role), or — a legacy row — the show that links it as its DJ expense
    let role = row.show_money_role;
    let showId = row.show_id;
    if (role !== "DJ_FEE") {
      const { data: linked, error: lErr } = await supabase.from("shows").select("id").eq("linked_dj_expense_transaction_id", row.id).limit(1);
      if (lErr) throw new Error(lErr.message);
      const hit = (linked ?? [])[0] as { id: string } | undefined;
      if (!hit) return { kind: "skipped", reason: "not_dj_fee_row" };
      role = "DJ_FEE";
      showId = hit.id;
    }
    if (!showId) return { kind: "skipped", reason: "show_not_found" };
    const { data: show, error: sErr } = await supabase.from("shows").select("id, name, dj_client_id, dj_fee, currency").eq("id", showId).maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!show) return { kind: "skipped", reason: "show_not_found" };
    const s = show as ShowRow;

    const amount = Number(row.amount) || 0;
    const el = djPaymentEligibility({ tx: { role, status: row.payment_status, amount }, show: { djClientId: s.dj_client_id, djFee: Number(s.dj_fee) }, cleantoneId: CLEANTONE_CLIENT_ID });
    if (!el.ok) return { kind: "skipped", reason: el.reason };

    const currency = (row.currency ?? "").trim() || (s.currency ?? "").trim() || "₪";
    const djMsg = buildDjPaymentPush({ showName: s.name, amount, currency });
    const { sendPushToRoles } = await import("./push"); // loaded only when a real send is allowed and eligible
    const eventId = djPaymentClaimKey(row.id);

    const { outcome } = await deliverOnce(settingsClaimStore, eventId, DJ_PAYMENT_CLAIM_VERSION, Date.now(), async () =>
      classify(await sendPushToRoles(["cleantone"], {
        title: djMsg.title,
        body: djMsg.body,
        url: "/dj-cleantone?tab=shows",
        tag: `dj-payment-${row.id}`,
        eventId, // also dedupes the notification history row (notifications.event_key)
      })),
    );

    if (outcome === "already_sent" || outcome === "in_progress") return { kind: "attempted", dj: outcome, ownerAck: "not_attempted" };
    if (outcome !== "sent") {
      console.error(`[dj-payment-notify] the DJ was NOT notified (${outcome}) for DJ_FEE ${row.id} — the payment stays שולם, no confirmation sent to the Owner`);
      const warning = outcome === "no_subscription"
        ? "השכר סומן שולם, אבל ל-CLEANTONE אין מכשיר רשום להתראות — לא נשלח Push."
        : "השכר סומן שולם, אבל ה-Push ל-CLEANTONE לא נשלח (שגיאת שליחה). השכר לא בוטל.";
      return { kind: "attempted", dj: outcome, ownerAck: "not_attempted", warning };
    }

    // the DJ's push was delivered → the Owner's confirmation (best-effort; never re-sends to the DJ, never rolls back)
    const ack = buildDjPaymentOwnerAck({ showName: s.name, amount, currency });
    let ownerAck: "sent" | "failed" = "failed";
    try {
      const results = await sendPushToRoles(["owner"], { title: ack.title, body: ack.body, url: "/shows", tag: `dj-payment-owner-${row.id}`, eventId: `dj_payment_paid_owner:${row.id}` });
      ownerAck = classify(results) === "sent" ? "sent" : "failed";
    } catch (e) {
      console.error("[dj-payment-notify] owner confirmation push threw:", e instanceof Error ? e.message : e);
    }
    if (ownerAck === "failed") {
      console.error(`[dj-payment-notify] the DJ was notified for DJ_FEE ${row.id}, but the Owner confirmation push was not delivered (no retry, nothing undone)`);
      return { kind: "attempted", dj: "sent", ownerAck, warning: "CLEANTONE קיבל את ההתראה, אבל אישור השליחה אליך לא נשלח." };
    }
    return { kind: "attempted", dj: "sent", ownerAck };
  } catch (e) {
    // a notification problem is never a payment problem
    console.error("[dj-payment-notify] failed (the payment is unaffected):", e instanceof Error ? e.message : e);
    return { kind: "attempted", dj: "send_failed", ownerAck: "not_attempted", warning: "השכר סומן שולם, אבל שליחת ה-Push ל-CLEANTONE נכשלה. השכר לא בוטל." };
  }
}
