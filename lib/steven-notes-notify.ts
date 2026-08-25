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

/** What a riddim send is about — see the `line` parameter below. */
export type NotesLine =
  | { kind: "version"; targetName: string; label: string; versionId: string }
  | { kind: "target";  targetName: string; targetId: string };

/** displayName is resolved SERVER-SIDE (never trusted from the client). projectId
 *  is the canonical sound_engineer_work.project_id (null for standalone work). */
export async function notifyStevenMixNotes(
  work: { id: string; displayName: string; projectId: string | null },
  /**
   * Riddim only — what the notes are about, already resolved from the DB by the
   * caller (never text from the client). One discriminator drives all three
   * things that differ, so they cannot drift apart:
   *
   *   kind "version"  notes on an uploaded mix   → "Tasama — Mix 1: New notes…"
   *   kind "target"   notes on a line with no mix yet → "Metro: New notes added"
   *
   * Left out entirely on every non-riddim work, where the wording, the tag and
   * the reminder cycle are all unchanged.
   */
  line?: NotesLine | null,
): Promise<NotesNotifyResult> {
  if (!work.id) return { ok: false };
  // Localhost / dev: no real push.
  if (!pushAllowed()) return { ok: true, skipped: true };

  const name = (work.displayName ?? "").trim();
  // Same text + deep-link for both audiences; the deep-link stays the OWNER's
  // fallback too (used only if there is no projectId).
  const title = !line ? "New mix notes from Redbloods"
    : line.kind === "version" ? `${line.targetName} — ${line.label}: New notes added`
    : `${line.targetName}: New notes added`;
  const body  = `Notes were added for ${name}. Tap to review the feedback.`;
  const url   = `/team/steven?work=${work.id}&notes=1`;
  // On a riddim the tag is scoped to the thing the notes are about, so notes for
  // Tasama, for Desto and for a line with no mix yet sit side by side on the
  // device instead of one silently replacing another. Re-sending for the same
  // thing still replaces its own earlier notice, exactly as the per-work tag
  // does everywhere else. The "target-" segment keeps the two namespaces from
  // ever colliding.
  const tag = !line ? `steven-mix-notes-${work.id}`
    : line.kind === "version" ? `steven-mix-notes-${work.id}-${line.versionId}`
    : `steven-mix-notes-${work.id}-target-${line.targetId}`;

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

  // ── Start (or restart) the "remind Steven every 5h until he uploads a new
  // version" cycle for this work — see lib/steven-mix-reminder-notify.ts.
  // Never breaks this function's own (already-sent) immediate push either way.
  //
  // Skipped for a PRE-MIX target note, and only for that. The cycle is a single
  // work-scoped settings row, so starting it here would reset whatever cycle a
  // real mix's notes had going: its 3-reminder budget would restart and its
  // "has a newer version landed since?" baseline would jump forward, so an
  // upload that already happened would stop counting. Sending Metro its stems
  // must not silence or restart Tasama's reminder. Both pushes above are
  // already out; this only decides whether a reminder cycle is touched at all.
  const startsReminderCycle = !line || line.kind === "version";
  if (startsReminderCycle) try {
    const { startOrResetReminderCycle } = await import("@/lib/steven-mix-reminder-notify");
    await startOrResetReminderCycle(work.id);
  } catch (err) {
    console.error(`[steven-mix-reminder] failed to start cycle for work ${work.id}:`, err);
  }

  return { ok: true, sent: true };
}
