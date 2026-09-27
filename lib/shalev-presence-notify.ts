import "server-only";
import { sendPushToAll } from "@/lib/push";
import { recordPortalPresence } from "@/lib/push-presence";
import { classify } from "@/lib/push-claims-pure";
import type { PresencePingResult } from "@/lib/push-presence-pure";

/**
 * Owner-only push "שליו נכנס לאפליקציה" — a REAL presence event only (Owner decision Q1, 2026-09-27). The decision
 * (last-seen, new visit after a 30-minute absence, atomic visit claim, "sent" only after delivery) is the ONE shared
 * presence model in lib/push-presence-pure.ts; this file supplies only Shalev's push text and deep link.
 * ArtistPortalPage's sessionStorage flag is a client nicety only — the server decides.
 */
const TZ = "Asia/Jerusalem";

/** Best-effort; never throws. */
export async function notifyShalevEntry(): Promise<PresencePingResult | null> {
  return recordPortalPresence("shalev", async ({ visitStartedAt }) => {
    const time = new Date(visitStartedAt).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
    return classify(await sendPushToAll({
      title: "שליו נכנס לאפליקציה",
      body: `התחבר בשעה ${time}`,
      url: "/red-artists",
      tag: "shalev-entry",
      eventId: `shalev_entry:${visitStartedAt}`,
    }));
  });
}
