import "server-only";

import { sendPushToRoles } from "@/lib/push";
import { settingsClaimStore, pushAllowed } from "@/lib/push-claims";
import { classify, deliverOnce } from "@/lib/push-claims-pure";

/**
 * "Project completed" push — sent to Victor the moment one of HIS OWN
 * vendor_project_work rows transitions to status "הושלם" (any other status →
 * "הושלם"), followed by a Hebrew confirmation to the owner, but ONLY once
 * delivery to Victor is confirmed. Modeled directly on
 * lib/steven-payment-notify.ts (same shape: pushAllowed guard, settings-table
 * dedup, sendPushToRoles) — Steven's file is untouched, this is a separate,
 * Victor-only helper.
 *
 * Scope: this is about vendor_project_work.status ONLY. It never reads or
 * writes projects.status/end_date, and never touches agent_alerts. Whether the
 * linked project is closed too is decided by the client's own explicit choice in
 * the Victor page modal (a separate PATCH to /api/projects/[id]) — this file does
 * not call, extend or depend on it. Projects → Victor (StatusDropdown PATCHes an
 * OPEN "פעיל" work to "הושלם") also arrives here as an ordinary real transition.
 *
 * Trigger: caller (app/api/vendor/victor/work/[id]/route.ts) determines the
 * REAL before/after transition itself, from a DB row fetched immediately
 * before the update — this function is only ever invoked once that real
 * transition (not-"הושלם" → "הושלם") has already been established. Best-effort:
 * must NEVER throw into the work-update path. Localhost is silenced by
 * pushAllowed() (production / ALLOW_SERVER_PUSH only).
 *
 * Dedup: settings key/value table (NO schema change), key
 * victor_work_completed_pushed_{workId} — a delivery claim (lib/push-claims-pure.ts)
 * whose version is fromUpdatedAt: claimed atomically BEFORE the send, "sent" ONLY
 * when the push to Victor was actually delivered, otherwise a durable "failed"
 * record (never "sent"; a duplicate submit of the same transition may retry it). Here
 * fromUpdatedAt is the work row's OWN updated_at timestamp from
 * IMMEDIATELY BEFORE this transition's write. Two requests observing the
 * same not-yet-updated row (a genuine race/duplicate submit) compute the same
 * stamp and dedupe against each other. A later, GENUINE re-completion
 * (הושלם → פעיל → הושלם again) necessarily has a different "before" row
 * snapshot (the reopen itself changed updated_at), so it gets a fresh stamp
 * and a fresh push — deliberately NOT keyed by calendar date, unlike the
 * payment-notify reference, because a same-day reopen-and-recomplete must
 * still notify.
 */

const key = (workId: string) => `victor_work_completed_pushed_${workId}`;

export async function notifyVictorWorkCompleted(work: {
  id: string;
  /** victorWorkName(work) at the caller — (title || projectName), the exact
   *  name Victor sees on his own page. Never re-derived here. */
  displayName: string;
  /** existingWork.updatedAt — the row's updated_at BEFORE this transition's
   *  write (the dedup "before" snapshot, see file doc comment above). */
  fromUpdatedAt: string;
}): Promise<void> {
  if (!pushAllowed() || !work.id) return;
  try {
    const name = (work.displayName ?? "").trim() || "your project";
    const url  = `/team/victor?workId=${work.id}`;

    const { outcome } = await deliverOnce(settingsClaimStore, key(work.id), work.fromUpdatedAt, Date.now(), async () => classify(await sendPushToRoles(["victor"], {
      title: "Project completed",
      body:  `"${name}" has been marked as completed. Great work! 👏`,
      url,
      tag: `victor-completed-${work.id}`,
    })), { extra: { fromUpdatedAt: work.fromUpdatedAt }, legacyVersionOf: (l) => (typeof l.fromUpdatedAt === "string" ? l.fromUpdatedAt : null) });

    // Owner confirmation fires ONLY on a REAL delivery signal (at least one
    // fulfilled webpush send to a "victor" subscription) — never on "the
    // function was called". No subscription at all and an outright send
    // failure both skip it the same way (and the marker says "failed").
    if (outcome !== "sent") {
      if (outcome !== "already_sent") console.error(`[victor-completed-notify] push to victor not delivered (${outcome}) for work ${work.id} — owner confirmation skipped`);
      return;
    }

    await sendPushToRoles(["owner"], {
      title: "Viktor עודכן",
      body:  `נשלחה ל-Viktor התראה ש-"${name}" הושלם.`,
      url,
      tag: `victor-completed-owner-${work.id}`,
    });
  } catch (e) {
    console.error("[victor-completed-notify] failed:", e);
  }
}
