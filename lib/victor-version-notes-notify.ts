import "server-only";

import { sendPushToRoles } from "@/lib/push";

/**
 * Manual "send version notes to Victor" notifier — fired ONLY by the owner-only
 * "שלח לויקטור" button on a single version's notes. NEVER automatic: not on page
 * load, refresh, draft save, work edit, or upload. The owner may resend, so there
 * is no dedup (the owner-only route gate is the only spam guard).
 *
 * Victor is notified in ENGLISH — his UI is en/ru, never Hebrew — mirroring
 * lib/victor-work-notify.ts. `title` is the Victor-facing work title, resolved
 * SERVER-SIDE from vendor_project_work.title by the route (never project / artist
 * / Dropbox-folder), so Victor's notification can never leak project identity and
 * the client can't spoof it. Deliberately NOT enriched with projectId/entity
 * fields: Victor's notification row must not carry project metadata.
 *
 * Localhost/dev sends nothing (pushAllowed) — same guard as the sibling notifiers.
 */

export type NotifyVersionNotesResult =
  | { ok: true;  victorSent: number }
  | { ok: false; reason: "push-disabled" | "no-victor-subscription" | "victor-send-failed" };

/** Never send real push from local/dev — mirrors lib/victor-work-notify.ts. */
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

function fulfilledCount(results: PromiseSettledResult<unknown>[]): number {
  return results.filter((r) => r.status === "fulfilled").length;
}

/** English phrase for the version, from its key ("V2" → "version 2"). Non-numeric
 *  keys ("FINAL"/"FIX"/"all") get a sensible phrase / are omitted. */
function versionPhrase(versionKey: string): string {
  const m = /^V(\d+)$/i.exec(versionKey);
  if (m) return `version ${Number(m[1])}`;
  if (versionKey.toUpperCase() === "FINAL") return "the final version";
  if (versionKey.toUpperCase() === "FIX")   return "the fix";
  return ""; // "all"/untagged → no version phrase
}

export async function notifyVictorVersionNotes(
  workId: string,
  title: string,
  versionKey: string,
): Promise<NotifyVersionNotesResult> {
  if (!pushAllowed()) return { ok: false, reason: "push-disabled" };

  // Same deep link as the "new work" push — opens the work's drawer on /team/victor.
  const url = `/team/victor?workId=${encodeURIComponent(workId)}`;
  const phrase = versionPhrase(versionKey);
  const body = phrase
    ? `New feedback on ${phrase} — ${title}`
    : `New feedback — ${title}`;

  const victorResults = await sendPushToRoles(["victor"], {
    title: "New notes from Redbloods",
    body,
    url,
    tag: `victor-version-notes-${workId}-${versionKey}`,
  });

  // deliver() returns one settled result per subscription row — empty array means
  // Victor has no registered device at all.
  if (victorResults.length === 0) return { ok: false, reason: "no-victor-subscription" };
  const victorSent = fulfilledCount(victorResults);
  if (victorSent === 0) return { ok: false, reason: "victor-send-failed" };

  return { ok: true, victorSent };
}
