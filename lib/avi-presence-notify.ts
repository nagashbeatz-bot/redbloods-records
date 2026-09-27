import "server-only";
import { sendPushToAll } from "@/lib/push";
import { recordPortalPresence } from "@/lib/push-presence";
import { classify } from "@/lib/push-claims-pure";
import type { PresencePingResult } from "@/lib/push-presence-pure";
import { AVI_ARTIST_ID } from "@/lib/roles";

/**
 * Owner-only push "אבי נכנס לאפליקציה" — a REAL presence event only (Owner decision Q1, 2026-09-27). The same shared
 * presence model as every portal (lib/push-presence-pure.ts); this file supplies only Avi's push text and deep link
 * (his portal, the Owner-reachable page for him). The push goes to the OWNER only (sendPushToAll is owner-scoped).
 */
const TZ = "Asia/Jerusalem";

/** Best-effort; never throws. */
export async function notifyAviEntry(): Promise<PresencePingResult | null> {
  return recordPortalPresence("avi", async ({ visitStartedAt }) => {
    const time = new Date(visitStartedAt).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
    return classify(await sendPushToAll({
      title: "אבי נכנס לאפליקציה",
      body: `התחבר בשעה ${time}`,
      url: `/label/artists/${AVI_ARTIST_ID}`,
      tag: "avi-entry",
      eventId: `avi_entry:${visitStartedAt}`,
    }));
  });
}
