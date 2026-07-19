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
 *
 * Sent as TWO separate role-scoped pushes (F2a): the OWNER send carries project
 * metadata (so the owner's bell opens the ProjectDrawer), while STEVEN's send is
 * byte-identical to before (title/body/url/tag only, NO projectId/entity/actor) —
 * a supplier's notification row must never inherit the owner's project link. The
 * device experience is unchanged: each person has a single role, so each device
 * receives exactly one of the two sends. No lib/push.ts change.
 */

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

export interface NotesNotifyResult { ok: boolean; sent?: boolean; skipped?: boolean }

/** displayName is resolved SERVER-SIDE (never trusted from the client). projectId
 *  is the canonical sound_engineer_work.project_id (null for standalone work). */
export async function notifyStevenMixNotes(
  work: { id: string; displayName: string; projectId: string | null },
): Promise<NotesNotifyResult> {
  if (!work.id) return { ok: false };
  // Localhost / dev: no real push.
  if (!pushAllowed()) return { ok: true, skipped: true };

  const name = (work.displayName ?? "").trim();
  // Same text + deep-link for both audiences; the deep-link stays the OWNER's
  // fallback too (used only if there is no projectId).
  const title = "New mix notes from Redbloods";
  const body  = `Notes were added for ${name}. Tap to review the feedback.`;
  const url   = `/team/steven?work=${work.id}&notes=1`;
  const tag   = `steven-mix-notes-${work.id}`;

  // ── Owner — enriched so the bell opens the ProjectDrawer directly ──
  // projectId only when the work is project-linked (null → left off, url fallback).
  await sendPushToRoles(["owner"], {
    title, body, url, tag,
    ...(work.projectId ? { projectId: work.projectId } : {}),
    entityType: "sound_engineer_work",
    entityId:   work.id,
    actorName:  "סטיבן",
  });

  // ── Steven — byte-identical to before: NO projectId / entity / actor ──
  await sendPushToRoles(["steven"], { title, body, url, tag });

  return { ok: true, sent: true };
}
