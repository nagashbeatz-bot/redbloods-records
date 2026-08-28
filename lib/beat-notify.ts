import "server-only";

import { sendPushToRoles } from "@/lib/push";
import { classifyPushResult } from "@/lib/shalev-weekly-pure";
import { AVI_NAME, SHALEV_NAME } from "@/lib/red-artists/portal-registry";
import { AVI_ARTIST_ID } from "@/lib/roles";

/**
 * Free-beat notifications.
 *
 * THE ONLY "new beat" trigger for an ARTIST is a SUCCESSFUL, NEWLY-CREATED
 * assignment (POST /api/beats/[id]/assignments) — never an upload, never an
 * update, never a page load, refresh, play or list reload, and never from the
 * client. Uploading a beat to the repository tells the artists nothing, because an
 * unassigned beat is invisible to them; the moment it becomes theirs is the
 * assignment. That is what removed the old duplicate.
 *
 * The owner keeps a self-notice on his OWN upload/update (notifyBeatUploaded /
 * notifyBeatUpdated below) — a different event with a different meaning, and
 * owner-only since the artists were dropped from those two.
 *
 * No /api/push/check involved. Localhost/dev is silenced by pushAllowed().
 * Per-user notification history (the bell) + event_key dedup are handled inside
 * lib/push.ts `deliver`. No lib/push.ts / DB change.
 */

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

/** The owner's own beats surface — always valid for him, whichever artist it is about. */
const OWNER_BEATS_URL = "/beats";

/**
 * Per-artist notification target. An explicit map keyed by the assignment slug —
 * never derived generically, so a future portal artist cannot silently inherit
 * someone else's push audience or deep link.
 *
 * `url` MUST be a page that artist is actually allowed to open: Avi lives at
 * /label/artists/[his id] (the proxy sends him back there from anywhere else) and
 * Shalev lives at /red-artists (the proxy blocks him from /label/*). One shared
 * generic link would land one of them on a redirect that drops ?tab=beats.
 */
interface BeatNotifyTarget {
  /** push_subscriptions.role of the ARTIST (never the owner). */
  role: string;
  /** Display name — used in the OWNER's confirmation only. */
  name: string;
  /** Where the ARTIST'S OWN notification opens — his beats tab. */
  url: string;
}

const NOTIFY_TARGETS: Record<string, BeatNotifyTarget> = {
  "avi-molla": {
    role: "avi",
    name: AVI_NAME,
    url: `/label/artists/${AVI_ARTIST_ID}?tab=beats`,
  },
  "shalev-tasama": {
    role: "shalev",
    name: SHALEV_NAME,
    url: "/red-artists?tab=beats",
  },
};

/** True iff this assignment slug has a notification target (Avi / Shalev today). */
export function isNotifiableArtistSlug(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(NOTIFY_TARGETS, slug);
}

export type BeatAssignNotifyResult =
  /** The artist's push was accepted by the push service; the owner ack was sent. */
  | { status: "sent"; artistName: string }
  /** The artist has no registered device — nothing sent, and no owner ack. */
  | { status: "no_subscription"; artistName: string }
  /** Every one of the artist's devices rejected — nothing sent, and no owner ack. */
  | { status: "send_failed"; artistName: string }
  /** Push is silenced (localhost/dev), or the slug has no target. */
  | { status: "skipped"; artistName: string };

/**
 * A beat was just assigned to an artist → tell that artist, and ONLY that artist
 * (the send is scoped to his role alone, so assigning to Avi can never reach
 * Shalev or the other way round). Called exactly once per newly-created
 * assignment, AFTER the row is confirmed persisted. The wording is identical for
 * every artist by design.
 *
 * The OWNER confirmation is sent ONLY when the artist's push actually came back
 * successful (classifyPushResult === "sent" — at least one of his devices was
 * accepted by the push service). It is deliberately worded "נשלחה התראה" rather
 * than "קיבל": a resolved webpush call means the push SERVICE accepted the
 * message, which is not proof the device received it or that the artist saw it.
 * On no_subscription / send_failed the owner gets NO confirmation at all — the
 * claim that an artist was notified is never made without that basis. The caller
 * receives the status instead and surfaces it in the UI.
 */
export async function notifyBeatAssigned(
  beat: { id: string; name: string },
  artistSlug: string,
): Promise<BeatAssignNotifyResult> {
  const target = NOTIFY_TARGETS[artistSlug];
  const artistName = target?.name ?? artistSlug;
  if (!beat?.id || !target) return { status: "skipped", artistName };
  if (!pushAllowed()) return { status: "skipped", artistName };

  const beatName = (beat.name ?? "").trim();

  // ── The artist ──────────────────────────────────────────────────────────────
  // eventId carries a timestamp: removing an assignment and creating it again is
  // a genuinely new event (the beat left his list and came back), so it must not
  // collide with the earlier one on notifications.event_key. Sending twice for the
  // SAME standing assignment is prevented at the source — the route only calls
  // this when the assignment did not exist a moment ago.
  let artistResults: { status: string }[];
  try {
    artistResults = (await sendPushToRoles([target.role], {
      title: "ביט חדש מחכה לך 🔥",
      body:  `הביט "${beatName}" נוסף לביטים הפנויים שלך.`,
      url:   target.url,
      tag:   `beat-assign-${beat.id}-${artistSlug}`,
      eventId: `beat_assigned:${beat.id}:${artistSlug}:${Date.now()}`,
      entityType: "beat",
      entityId: beat.id,
    })) as unknown as { status: string }[];
  } catch (e) {
    // Best-effort: a push failure must never fail the assignment itself.
    console.error("[beat-notify] assigned →", artistSlug, e instanceof Error ? e.message : e);
    return { status: "send_failed", artistName };
  }

  const cls = classifyPushResult(artistResults);
  if (cls !== "sent") {
    console.warn(`[beat-notify] assigned → ${artistSlug} not sent (${cls}) — owner ack suppressed`);
    return { status: cls, artistName };
  }

  // ── The owner's confirmation — only now that the artist's send came back ok ──
  try {
    await sendPushToRoles(["owner"], {
      title: "התראת ביט נשלחה ✓",
      body:  `נשלחה התראה ל"${artistName}" על הביט "${beatName}".`,
      url:   OWNER_BEATS_URL,
      tag:   `beat-assign-ack-${beat.id}-${artistSlug}`,
      eventId: `beat_assigned_ack:${beat.id}:${artistSlug}:${Date.now()}`,
      entityType: "beat",
      entityId: beat.id,
    });
  } catch (e) {
    // The artist WAS notified — an owner-ack failure must not change that outcome.
    console.error("[beat-notify] owner ack", e instanceof Error ? e.message : e);
  }

  return { status: "sent", artistName };
}

/**
 * OWNER-ONLY self-notice that his upload landed. Sent ONLY after Dropbox + DB have
 * both succeeded (the /api/beats POST calls this on res.ok).
 *
 * The artists are deliberately NOT recipients any more: an uploaded-but-unassigned
 * beat does not exist for them, and their "new beat" notice now comes from the
 * assignment (notifyBeatAssigned). eventId is stable per beat id (one creation).
 */
export async function notifyBeatUploaded(beat: { id: string; name: string }): Promise<void> {
  if (!beat?.id || !pushAllowed()) return;
  const name = (beat.name ?? "").trim();
  try {
    await sendPushToRoles(["owner"], {
      title: "ביט חדש הועלה",
      body:  `הועלה ביט חדש: ${name}`,
      url:   OWNER_BEATS_URL,
      tag:   `beat-new-${beat.id}`,
      eventId: `beat_uploaded:${beat.id}`,
      entityType: "beat",
      entityId: beat.id,
    });
  } catch (e) {
    // Best-effort: a push failure must never fail the beat action.
    console.error("[beat-notify] uploaded", e instanceof Error ? e.message : e);
  }
}

/** OWNER-ONLY self-notice that a beat was updated. eventId carries a timestamp so
 *  each update is a distinct notice. The artists are not recipients (see above). */
export async function notifyBeatUpdated(beat: { id: string; name: string }): Promise<void> {
  if (!beat?.id || !pushAllowed()) return;
  const name = (beat.name ?? "").trim();
  try {
    await sendPushToRoles(["owner"], {
      title: "ביט עודכן",
      body:  `הביט ${name} עודכן`,
      url:   OWNER_BEATS_URL,
      tag:   `beat-upd-${beat.id}`,
      eventId: `beat_updated:${beat.id}:${Date.now()}`,
      entityType: "beat",
      entityId: beat.id,
    });
  } catch (e) {
    console.error("[beat-notify] updated", e instanceof Error ? e.message : e);
  }
}
