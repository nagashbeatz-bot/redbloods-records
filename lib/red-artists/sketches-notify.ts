import "server-only";
import { sendPushToRoles, sendPushToAll } from "@/lib/push";
import { classifyPushResult } from "@/lib/shalev-weekly-pure";
import { getLabelArtistByName } from "@/lib/label-artists-store";
import {
  buildNewSketchPush,
  buildNewSketchOwnerAck,
  buildSketchUpdatedPush,
  buildSketchUpdatedOwnerAck,
} from "@/lib/red-artists/sketches-notify-pure";

/**
 * Push for Shalev's standalone "המוזיקה שלי" library (lib/red-artists/sketches-store.ts)
 * — completely separate from sessions/beats/Steven/Victor/Final-Files notify code.
 *
 * Two events, each with its OWN single choke point (see sketches-store.ts):
 *   - createSketch()  → a brand-new song/sketch was added (V1).
 *   - addVersion()    → an existing sketch got a new version (replaces the working file).
 *
 * Both are single atomic calls (upload THEN a rev-locked manifest write) with no
 * chunked/multi-stage upload and no shared code path between them — so calling
 * the matching notify function exactly once, right after each store call
 * returns successfully, is structurally exactly one real event = one push. No
 * settings-table batching/CAS is needed here (unlike Steven/Victor's multi-file
 * upload flows) because there is nothing to coalesce: one call = one file.
 *
 * The owner-ack is sent ONLY when sendPushToRoles(["shalev"], …) actually
 * delivered (classifyPushResult === "sent") — never on "no_subscription" or
 * "send_failed", so the owner is never told Shalev was notified when he
 * wasn't. It only claims the SEND succeeded, never that Shalev opened/read it.
 */

const SHALEV = "שליו טסמה";
const SHALEV_MUSIC_URL = "/red-artists?tab=music"; // existing stable tab deep-link (no per-song deep-link exists — none is built here)

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

/** Owner's deep-link mirrors the existing pattern in shalev-weekly-notify.ts /
 *  shalev-session-reminder-notify.ts: the owner's view of the same tab, else
 *  fall back to Shalev's own portal URL. */
async function ownerMusicDeepLink(): Promise<string> {
  const artist = await getLabelArtistByName(SHALEV).catch(() => null);
  return artist ? `/label/artists/${artist.id}?tab=music` : SHALEV_MUSIC_URL;
}

/** Called AFTER createSketch() has fully succeeded. eventId is stable per
 *  sketch id — one creation is structurally one real event. */
export async function notifyNewSketch(sketchId: string, workName: string): Promise<void> {
  if (!pushAllowed() || !sketchId) return;
  try {
    const push = buildNewSketchPush(workName);
    const results = await sendPushToRoles(["shalev"], {
      ...push,
      url: SHALEV_MUSIC_URL,
      tag: `sketch-new-${sketchId}`,
      eventId: `sketch_new:${sketchId}`,
    });
    if (classifyPushResult(results) !== "sent") return; // never a misleading owner ack

    const ack = buildNewSketchOwnerAck(workName);
    await sendPushToAll({
      ...ack,
      url: await ownerMusicDeepLink(),
      tag: `sketch-new-ack-${sketchId}`,
      eventId: `sketch_new_ack:${sketchId}`,
    });
  } catch (e) {
    console.error("[sketches-notify] new sketch", e instanceof Error ? e.message : e);
  }
}

/** Called AFTER addVersion() has fully succeeded. eventId is keyed by
 *  sketch+versionNumber — a rev-locked manifest write means two uploads for
 *  the same sketch always get DIFFERENT version numbers, so this can never
 *  collide with a prior real update's key. */
export async function notifySketchUpdated(sketchId: string, versionNumber: number, projectName: string): Promise<void> {
  if (!pushAllowed() || !sketchId) return;
  try {
    const push = buildSketchUpdatedPush(projectName);
    const results = await sendPushToRoles(["shalev"], {
      ...push,
      url: SHALEV_MUSIC_URL,
      tag: `sketch-upd-${sketchId}`,
      eventId: `sketch_updated:${sketchId}:${versionNumber}`,
    });
    if (classifyPushResult(results) !== "sent") return;

    const ack = buildSketchUpdatedOwnerAck(projectName);
    await sendPushToAll({
      ...ack,
      url: await ownerMusicDeepLink(),
      tag: `sketch-upd-ack-${sketchId}-${versionNumber}`,
      eventId: `sketch_updated_ack:${sketchId}:${versionNumber}`,
    });
  } catch (e) {
    console.error("[sketches-notify] sketch updated", e instanceof Error ? e.message : e);
  }
}
