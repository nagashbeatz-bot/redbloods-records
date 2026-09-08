import "server-only";
import { sendPushToAll } from "./push";
import type { Show } from "./shows-store";
import { buildShowNotifyBody } from "./show-notify-pure";
import { CLEANTONE_ARTIST_NAME } from "./red-artists/cleantone";

/**
 * Owner-only push for "DJ CLEANTONE confirmed a show" — fired from
 * POST /api/red-artists/cleantone/shows/[id]/confirm ONLY on a real
 * 'ממתין לאישור' → 'אושר' transition (inside the `if (updated)` branch, never
 * on the idempotent alreadyConfirmed path), so a repeat confirm never produces
 * a second push.
 *
 * Reuses the existing push stack verbatim: sendPushToAll (role "owner" only),
 * buildShowNotifyBody (name · date · time · location — no money / fees /
 * payment / notes), and deliver()'s eventId de-dupe (notifications.event_key
 * unique). NO new push mechanism, NO subscription of its own.
 *
 * Best-effort: never throws. The confirm route awaits this but a push failure
 * must not roll back or fail the confirm — the caller ignores the result.
 */
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

export async function notifyDjShowConfirmed(show: Show): Promise<void> {
  if (!pushAllowed()) return; // never from localhost / non-prod
  try {
    await sendPushToAll({
      title: `${CLEANTONE_ARTIST_NAME} אישר הופעה`,
      body: buildShowNotifyBody({
        name: show.name,
        date: show.date,
        startTime: show.start_time,
        location: show.location,
      }),
      url: "/dj-cleantone?tab=shows",
      tag: `dj-show-confirmed-${show.id}`,
      // eventId keyed on the confirm timestamp → the same confirm firing twice
      // (double POST, retry) collapses to one owner notification via
      // notifications.event_key; a genuine re-confirm after an unconfirm carries
      // a fresh dj_confirmed_at and is a new event.
      eventId: `dj_show_confirmed:${show.id}:${show.dj_confirmed_at ?? ""}`,
    });
  } catch (e) {
    console.error("[dj-confirm-notify] failed:", e instanceof Error ? e.message : e);
  }
}
