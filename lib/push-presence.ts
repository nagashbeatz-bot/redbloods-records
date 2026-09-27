import "server-only";
import { settingsClaimStore, pushAllowed } from "./push-claims";
import { runPresencePing, type PresencePortal, type PresencePingResult } from "./push-presence-pure";
import type { DeliveryResult } from "./push-claims-pure";

/**
 * Server wiring of the ONE portal presence model (lib/push-presence-pure.ts) over the `settings` table. Each portal's
 * notifier (lib/shalev-presence-notify.ts, lib/avi-presence-notify.ts, lib/cleantone-presence-notify.ts,
 * lib/victor-presence-notify.ts, lib/steven-notify.ts) supplies only its own push (text + deep link) and sends it
 * itself; this module decides WHETHER that push may be sent (a claimed new visit) and records the truth.
 * Best-effort: never throws into the ping route.
 */
export async function recordPortalPresence(portal: PresencePortal, send: (ctx: { visitStartedAt: string }) => Promise<DeliveryResult>): Promise<PresencePingResult | null> {
  try {
    return await runPresencePing(settingsClaimStore, portal, Date.now(), { pushAllowed: pushAllowed(), send });
  } catch (e) {
    console.error(`[presence] ${portal} ping failed:`, e);
    return null;
  }
}
