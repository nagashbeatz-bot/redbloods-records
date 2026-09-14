import "server-only";

import { createClient } from "@supabase/supabase-js";
import { sendPushToRoles } from "@/lib/push";
import { classifyPushResult } from "@/lib/shalev-weekly-pure";

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
 * writes projects.status/end_date, and never touches agent_alerts. The
 * existing owner-driven sync from a Victor work to its linked project's
 * status (WorkStatusDropdown.doUpdateWork's second fetch to
 * /api/projects/[id]) is a separate, pre-existing code path — this file does
 * not call it, extend it, or depend on it in any way.
 *
 * Trigger: caller (app/api/vendor/victor/work/[id]/route.ts) determines the
 * REAL before/after transition itself, from a DB row fetched immediately
 * before the update — this function is only ever invoked once that real
 * transition (not-"הושלם" → "הושלם") has already been established. Best-effort:
 * must NEVER throw into the work-update path. Localhost is silenced by
 * pushAllowed() (production / ALLOW_SERVER_PUSH only).
 *
 * Dedup: settings key/value table (NO schema change), key
 * victor_work_completed_pushed_{workId} = { fromUpdatedAt }, where
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

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

/** Never send real push from local/dev — only production (or an explicit opt-in). */
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

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
    const k = key(work.id);
    const stamp = work.fromUpdatedAt;

    // Dedup: skip if we already processed a completion transitioning FROM this
    // exact pre-update row state (duplicate submit / concurrent request).
    const { data } = await supabase.from("settings").select("value").eq("key", k).maybeSingle();
    const prev = (data?.value as { fromUpdatedAt?: string } | null)?.fromUpdatedAt ?? null;
    if (prev === stamp) return;

    const name = (work.displayName ?? "").trim() || "your project";
    const url  = `/team/victor?workId=${work.id}`;

    const results = await sendPushToRoles(["victor"], {
      title: "Project completed",
      body:  `"${name}" has been marked as completed. Great work! 👏`,
      url,
      tag: `victor-completed-${work.id}`,
    });

    // Record the attempt regardless of outcome — matches steven-payment-notify's
    // own convention (a failed attempt for THIS exact transition is not retried
    // automatically; a genuinely new transition later gets its own fresh stamp).
    await supabase.from("settings").upsert({ key: k, value: { fromUpdatedAt: stamp } }, { onConflict: "key" });

    // Owner confirmation fires ONLY on a REAL delivery signal (at least one
    // fulfilled webpush send to a "victor" subscription) — never on "the
    // function was called". No subscription at all and an outright send
    // failure both skip it the same way.
    const cls = classifyPushResult(results as unknown as { status: string }[]);
    if (cls !== "sent") {
      console.error(`[victor-completed-notify] push to victor not delivered (${cls}) for work ${work.id} — owner confirmation skipped`);
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
