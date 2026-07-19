import "server-only";

import { sendPushToRoles } from "@/lib/push";

/**
 * Manual "send work to Victor" notifier — fired ONLY by the owner-only button in
 * a work's drawer. Never automatic: not on page load, refresh, work creation,
 * status change or upload.
 *
 * Order matters. Victor is notified FIRST, and the owner's confirmation push is
 * sent ONLY after Victor's push was actually delivered to at least one device.
 * If Victor has no active subscription nothing at all is sent (no Victor push,
 * no owner push, no success) — the caller surfaces that as an error.
 *
 * `title` arrives already resolved from vendor_project_work.title by the route.
 * This module never derives a name and never falls back to a project / artist /
 * Dropbox-folder name: Victor is deliberately never shown those, so a fallback
 * would leak Artist/Project data into his notification.
 *
 * Deliberately separate from lib/victor-upload-notify.ts — no coalescing window,
 * no `settings` rows, no cron. Repeatable by design (the owner may resend).
 */

export type NotifyVictorWorkResult =
  | { ok: true;  victorSent: number; ownerSent: number }
  | { ok: false; reason: "push-disabled" | "no-victor-subscription" | "victor-send-failed" };

/** Never send real push from local/dev — mirrors lib/victor-upload-notify.ts. */
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

function fulfilledCount(results: PromiseSettledResult<unknown>[]): number {
  return results.filter((r) => r.status === "fulfilled").length;
}

export async function notifyVictorNewWork(workId: string, title: string, projectId: string | null): Promise<NotifyVictorWorkResult> {
  if (!pushAllowed()) return { ok: false, reason: "push-disabled" };

  // Same deep link for both audiences — opens the work's drawer on /team/victor.
  const url = `/team/victor?workId=${encodeURIComponent(workId)}`;

  // ── 1. Victor — English (his UI is en/ru, never Hebrew) ──
  // Deliberately NOT enriched with projectId/entity fields: Victor is never shown
  // project identity, and his notification row must not carry it either.
  const victorResults = await sendPushToRoles(["victor"], {
    title: "New work from Redbloods",
    body:  `A new project was sent to you: ${title}`,
    url,
    tag:   `victor-work-${workId}`,
  });

  // deliver() returns one settled result per subscription row, so an empty array
  // means Victor has no registered device at all.
  if (victorResults.length === 0) return { ok: false, reason: "no-victor-subscription" };
  const victorSent = fulfilledCount(victorResults);
  if (victorSent === 0) return { ok: false, reason: "victor-send-failed" };

  // ── 2. Owner confirmation — ONLY after Victor actually received it ──
  // Owner-only send → enrich so the owner's bell opens the project drawer directly.
  // projectId is attached only when the work is project-linked (null = standalone
  // → left off, url stays the fallback). entity fields describe the source row.
  const ownerResults = await sendPushToRoles(["owner"], {
    title: "העבודה נשלחה לויקטור",
    body:  `העבודה "${title}" נשלחה בהצלחה`,
    url,
    tag:   `victor-work-sent-${workId}`,
    ...(projectId ? { projectId } : {}),
    entityType: "vendor_project_work",
    entityId:   workId,
    actorName:  "ויקטור",
  });

  return { ok: true, victorSent, ownerSent: fulfilledCount(ownerResults) };
}
