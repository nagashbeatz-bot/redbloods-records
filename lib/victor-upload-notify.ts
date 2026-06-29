import "server-only";

import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";

/**
 * Owner-only push when Victor uploads files on /team/victor — coalesced into ONE
 * notification per work over a 3-minute window (no per-file spam).
 *
 * Storage: the existing `settings` key/value table (NO schema change), one row
 * per pending work batch: key = victor_upload_pending_{workId}.
 *   value = { workId, projectName, count, dueAt }
 *
 * Flow: every successful Victor upload calls queueVictorUploadNotice() →
 * increments count and pushes dueAt to now+3min. The minute scheduler
 * (instrumentation.ts) calls flushDueVictorUploadNotices() → sends one push for
 * each batch whose dueAt has passed, then deletes the row.
 *
 * Targeting: sendPushToAll only ever reaches owner devices — push_subscriptions
 * is written exclusively by the requireOwner-gated /api/push/subscribe, so
 * Victor / test / client devices are never stored. (No role column to filter, so
 * the owner-only guarantee comes from the subscribe gate by construction.)
 */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const WINDOW_MS = 3 * 60 * 1000; // 3-minute coalescing window
const KEY_PREFIX = "victor_upload_pending_";
const key = (workId: string) => `${KEY_PREFIX}${workId}`;

interface PendingBatch {
  workId: string;
  projectName: string;
  count: number;
  dueAt: string; // ISO
}

/** Never send real push from local/dev — only production (or an explicit opt-in). */
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

/**
 * Called AFTER a Victor upload is saved. Adds the file to the work's pending
 * batch and (re)arms the 3-minute timer. Best-effort: must never throw into the
 * upload path.
 */
export async function queueVictorUploadNotice(workId: string, projectName: string): Promise<void> {
  if (!pushAllowed() || !workId) return;
  try {
    const k = key(workId);
    const { data } = await supabase.from("settings").select("value").eq("key", k).maybeSingle();
    const prev = (data?.value ?? null) as PendingBatch | null;
    const value: PendingBatch = {
      workId,
      projectName: projectName || prev?.projectName || "פרויקט",
      count: (prev?.count ?? 0) + 1,
      dueAt: new Date(Date.now() + WINDOW_MS).toISOString(),
    };
    await supabase.from("settings").upsert({ key: k, value }, { onConflict: "key" });
  } catch (e) {
    console.error("[victor-upload-notify] queue failed:", e);
  }
}

/**
 * Called every minute by the scheduler. Sends one owner push per batch whose
 * 3-minute window has elapsed, then clears that batch.
 */
export async function flushDueVictorUploadNotices(): Promise<void> {
  if (!pushAllowed()) return;
  let rows: { key: string; value: unknown }[] = [];
  try {
    const { data } = await supabase
      .from("settings")
      .select("key, value")
      .like("key", `${KEY_PREFIX}%`);
    rows = data ?? [];
  } catch (e) {
    console.error("[victor-upload-notify] flush read failed:", e);
    return;
  }

  const now = Date.now();
  for (const row of rows) {
    const v = (row.value ?? {}) as Partial<PendingBatch>;
    if (!v.dueAt || new Date(v.dueAt).getTime() > now) continue; // window still open

    const count = v.count ?? 1;
    const project = v.projectName || "פרויקט";
    const body = count === 1
      ? `ויקטור העלה קובץ אחד לפרויקט ${project}`
      : `ויקטור העלה ${count} קבצים לפרויקט ${project}`;

    try {
      await sendPushToAll({
        title: "ויקטור העלה קבצים",
        body,
        url: v.workId ? `/team/victor?workId=${v.workId}` : "/team/victor",
        tag: `victor-upload-${v.workId ?? "x"}`,
      });
    } catch (e) {
      console.error("[victor-upload-notify] send failed:", e);
      // Leave the row so a later tick can retry rather than silently dropping it.
      continue;
    }
    try {
      await supabase.from("settings").delete().eq("key", row.key);
    } catch (e) {
      console.error("[victor-upload-notify] clear failed:", e);
    }
  }
}
