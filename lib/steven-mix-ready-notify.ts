import "server-only";

import { sendPushToRoles } from "@/lib/push";
import { settingsClaimStore, pushAllowed } from "@/lib/push-claims";
import { classify, deliverOnce, markerStateOf } from "@/lib/push-claims-pure";

/**
 * "New mix job" push — sent to Steven (+ an Owner copy) ONLY when the owner taps the green "Send to Steven" button
 * (manual). NEVER auto-fired: not on page load, refresh, upload, or work edit — the only callers are the owner-gated
 * notify-mix-ready route and Sunny's approved typed action.
 *
 * Marker (settings key steven_mix_ready_pushed_{workId}) is a delivery claim (lib/push-claims-pure.ts): claimed
 * atomically before the send (a double click sends once), and "sent" ONLY when Steven's push was actually delivered
 * (classifyPushResult === "sent"); otherwise it is a durable "failed" record and the button may send again.
 * A work already sent returns { alreadySent } (no push) so the UI can confirm "send again?"; a resend actually sends.
 * Legacy markers ({ at }, written before 2026-09-27 regardless of delivery) still count as "already sent".
 * Localhost silenced by pushAllowed().
 */

const key = (workId: string) => `steven_mix_ready_pushed_${workId}`;

export interface MixReadyResult { ok: boolean; alreadySent?: boolean; sent?: boolean; skipped?: boolean; inProgress?: boolean; result?: string; error?: string }

/** displayName is resolved SERVER-SIDE (never trusted from the client). */
export async function notifyStevenMixReady(
  work: { id: string; displayName: string },
  opts: { resend?: boolean } = {},
): Promise<MixReadyResult> {
  if (!work.id) return { ok: false };
  // Localhost / dev: no real push, and do NOT mark as sent.
  if (!pushAllowed()) return { ok: true, skipped: true };

  const k = key(work.id);
  const now = Date.now();
  const state = markerStateOf(await settingsClaimStore.read(k));
  if ((state === "SENT" || state === "RECORDED_UNVERIFIED") && !opts.resend) return { ok: true, alreadySent: true };

  const name = (work.displayName ?? "").trim();
  const payload = {
    title: "New mix job",
    body: name ? `${name} · Files and notes are ready for you.` : `Files and notes are ready for you.`,
    url: `/team/steven?work=${work.id}`, // deep-link → opens this work's modal
    tag: `steven-mix-ready-${work.id}`,
  };

  // A resend is a new event version; a first send is the "job" version (a sent job is never re-sent by a retry).
  const version = opts.resend ? `resend:${new Date(now).toISOString()}` : "job";
  const { outcome } = await deliverOnce(settingsClaimStore, k, version, now, async () => {
    const stevenCls = classify(await sendPushToRoles(["steven"], payload));
    try { await sendPushToRoles(["owner"], payload); } catch (e) { console.error("[steven-mix-ready] owner copy failed:", e); }
    return stevenCls;
  }, { extra: { at: new Date(now).toISOString() } });

  if (outcome === "sent") return { ok: true, sent: true };
  if (outcome === "already_sent") return { ok: true, alreadySent: true };
  if (outcome === "in_progress") return { ok: false, inProgress: true, error: "השליחה כבר מתבצעת" };
  return { ok: false, sent: false, result: outcome, error: outcome === "no_subscription" ? "לסטיבן אין מכשיר רשום לפוש — לא נמסר" : "הפוש לסטיבן לא נמסר" };
}
