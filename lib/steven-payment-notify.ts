import "server-only";

import { sendPushToRoles } from "@/lib/push";
import { settingsClaimStore, pushAllowed } from "@/lib/push-claims";
import { classify, deliverOnce } from "@/lib/push-claims-pure";

/**
 * "Payment confirmed" push — sent to Steven (+ an Owner copy) the moment a Steven work first becomes Paid. Called
 * ONLY from updateSoundEngineerWork on a real !wasPaid && nowPaid transition (never on refresh / page load / re-save).
 *
 * Best-effort: must NEVER throw into the payment update path. Localhost is silenced by pushAllowed().
 * Marker (settings key steven_payment_pushed_{workId}) is a delivery claim (lib/push-claims-pure.ts) whose version is
 * the payment date: claimed atomically before the send (two concurrent saves send once), "sent" ONLY after Steven's
 * push was actually delivered; a failure is a durable "failed" record (never "sent"). The same confirmation (same
 * workId + paymentDate) is never re-sent once sent. Legacy markers ({ paymentDate }) still dedupe their date.
 */

const key = (workId: string) => `steven_payment_pushed_${workId}`;

export async function notifyStevenPaymentPaid(work: {
  id: string;
  displayName: string; // the name Steven SEES (workTitle || projectName), not the raw project name
  currency: string;
  agreedPrice: number;
  paymentDate: string | null;
}): Promise<void> {
  if (!pushAllowed() || !work.id) return;
  try {
    const stamp = work.paymentDate ?? "paid";
    const name = (work.displayName ?? "").trim() || "a project";
    const payload = {
      title: "Payment sent",
      body: work.agreedPrice > 0
        ? `${name} · ${work.currency}${work.agreedPrice} paid. Thank you for the work!`
        : `${name} · Paid. Thank you for the work!`,
      url: `/team/steven?work=${work.id}`, // deep-link → opens this work's modal
      // Shared tag → the browser/iOS collapses any rare duplicate into one.
      tag: `steven-payment-${work.id}`,
    };
    const { outcome } = await deliverOnce(settingsClaimStore, key(work.id), stamp, Date.now(), async () => {
      const stevenCls = classify(await sendPushToRoles(["steven"], payload));
      try { await sendPushToRoles(["owner"], payload); } catch (e) { console.error("[steven-payment-notify] owner copy failed:", e); }
      return stevenCls;
    }, { extra: { paymentDate: stamp }, legacyVersionOf: (l) => (typeof l.paymentDate === "string" ? l.paymentDate : null) });
    if (outcome !== "sent" && outcome !== "already_sent") console.error(`[steven-payment-notify] not delivered (${outcome}) for work ${work.id}`);
  } catch (e) {
    console.error("[steven-payment-notify] failed:", e);
  }
}
