import "server-only";
import { sendPushToAll } from "@/lib/push";
import { recordPortalPresence } from "@/lib/push-presence";
import { classify } from "@/lib/push-claims-pure";
import type { PresencePingResult } from "@/lib/push-presence-pure";

/**
 * Owner-only push when Victor actually enters his page (/team/victor) — a REAL presence event only (Owner decision
 * Q1, 2026-09-27). The shared presence model (lib/push-presence-pure.ts) keeps Victor's existing 30-minute window,
 * now measured from his LAST-SEEN (heartbeat) instead of from the last push, and claims the visit atomically, so a
 * refresh, a second tab or in-page navigation never pushes and a failed delivery is never recorded as sent.
 * The caller (POST /api/vendor/victor/ping) already verified the session is really Victor.
 */

/** Best-effort; never throws. */
export async function notifyVictorPresence(): Promise<PresencePingResult | null> {
  return recordPortalPresence("victor", async ({ visitStartedAt }) => classify(await sendPushToAll({
    title: "Victor נכנס לעמוד שלו",
    body: "Victor נכנס עכשיו לפורטל העבודה שלו",
    url: "/team/victor",
    tag: "victor-visit",
    eventId: `victor_visit:${visitStartedAt}`,
  })));
}
