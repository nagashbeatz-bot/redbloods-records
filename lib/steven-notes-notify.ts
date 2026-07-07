import "server-only";

import { sendPushToRoles } from "@/lib/push";

/**
 * "New mix notes" push — sent to owner + Steven ONLY when the owner taps the
 * purple "Send notes" button in a work's modal (manual). NEVER auto-fired: not
 * on page load, refresh, comment-add, upload, or work edit — the only caller is
 * the owner-gated notify-notes route on an explicit click.
 *
 * Unlike the "new mix job" push, notes are repeatable by design — the owner adds
 * feedback over time and sends it whenever ready — so there is NO settings dedup
 * here. Spam is prevented purely by the owner-only route gate. The client can't
 * spoof the text: displayName is resolved SERVER-SIDE (workTitle || projectName,
 * the exact name Steven sees in the modal). Localhost silenced by pushAllowed().
 */

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

export interface NotesNotifyResult { ok: boolean; sent?: boolean; skipped?: boolean }

/** displayName is resolved SERVER-SIDE (never trusted from the client). */
export async function notifyStevenMixNotes(
  work: { id: string; displayName: string },
): Promise<NotesNotifyResult> {
  if (!work.id) return { ok: false };
  // Localhost / dev: no real push.
  if (!pushAllowed()) return { ok: true, skipped: true };

  const name = (work.displayName ?? "").trim();

  // IDENTICAL payload to both audiences — owner and Steven get the same text.
  await sendPushToRoles(["owner", "steven"], {
    title: "New mix notes from Redbloods",
    body: `Notes were added for ${name}. Tap to review the feedback.`,
    url: `/team/steven?work=${work.id}&notes=1`,
    tag: `steven-mix-notes-${work.id}`,
  });

  return { ok: true, sent: true };
}
