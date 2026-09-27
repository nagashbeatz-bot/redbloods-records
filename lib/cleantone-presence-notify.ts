import "server-only";
import { sendPushToAll } from "@/lib/push";
import { recordPortalPresence } from "@/lib/push-presence";
import { classify } from "@/lib/push-claims-pure";
import type { PresencePingResult } from "@/lib/push-presence-pure";

/**
 * Owner-only push "DJ CLEANTONE נכנס לאפליקציה" — a REAL presence event only (Owner decision Q1, 2026-09-27). The
 * same shared presence model as every portal (lib/push-presence-pure.ts); this file supplies only the DJ's push text
 * and deep link (the Owner is redirected to his label-artist page).
 */
const TZ = "Asia/Jerusalem";

/** Best-effort; never throws. */
export async function notifyCleantoneEntry(): Promise<PresencePingResult | null> {
  return recordPortalPresence("cleantone", async ({ visitStartedAt }) => {
    const time = new Date(visitStartedAt).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
    return classify(await sendPushToAll({
      title: "DJ CLEANTONE נכנס לאפליקציה",
      body: `התחבר בשעה ${time}`,
      url: "/dj-cleantone",
      tag: "cleantone-entry",
      eventId: `cleantone_entry:${visitStartedAt}`,
    }));
  });
}
