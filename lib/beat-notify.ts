import "server-only";

import { sendPushToRoles } from "@/lib/push";

/**
 * "Free beat" push — sent to the OWNER and SHALEV only, and ONLY after a beat
 * upload/update has fully succeeded (Dropbox + DB). The sole callers are the
 * owner-gated /api/beats POST (upload) and /api/beats/[id] PATCH (update) routes,
 * on res.ok — NEVER on page load, refresh, play, list reload, or from the client.
 * No /api/push/check involved. Localhost/dev is silenced by pushAllowed().
 *
 * Both recipients get identical content (a beat is not a project, so there is no
 * owner-only entity link). Per-user notification history + event_key dedup are
 * handled inside lib/push.ts `deliver`. No lib/push.ts / DB change.
 */

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

const BEATS_URL = "/red-artists?tab=beats"; // shalev-correct deep link (owner lands on the portal)

/** New beat uploaded. eventId is stable per beat id (one creation → idempotent). */
export async function notifyBeatUploaded(beat: { id: string; name: string }): Promise<void> {
  if (!beat?.id || !pushAllowed()) return;
  const name = (beat.name ?? "").trim();
  try {
    await sendPushToRoles(["owner", "shalev"], {
      title: "ביט חדש הועלה",
      body:  `הועלה ביט חדש: ${name}`,
      url:   BEATS_URL,
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

/** Beat updated. eventId carries a timestamp so each update is a distinct notice. */
export async function notifyBeatUpdated(beat: { id: string; name: string }): Promise<void> {
  if (!beat?.id || !pushAllowed()) return;
  const name = (beat.name ?? "").trim();
  try {
    await sendPushToRoles(["owner", "shalev"], {
      title: "ביט עודכן",
      body:  `הביט ${name} עודכן`,
      url:   BEATS_URL,
      tag:   `beat-upd-${beat.id}`,
      eventId: `beat_updated:${beat.id}:${Date.now()}`,
      entityType: "beat",
      entityId: beat.id,
    });
  } catch (e) {
    console.error("[beat-notify] updated", e instanceof Error ? e.message : e);
  }
}
