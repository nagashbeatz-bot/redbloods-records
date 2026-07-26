import "server-only";

import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";
import {
  shouldSendImmediately,
  nextPendingBatchValue,
  isBatchDue,
  buildVictorUploadPush,
  type PendingBatch,
} from "@/lib/victor-upload-notify-pure";

/**
 * Owner-only push when Victor uploads files on /team/victor.
 *
 * Timing: the CLIENT already knows, at the moment it starts an upload run,
 * exactly how many files are in it (VictorProfilePage.tsx's runUpload(files)
 * loop) — that count is passed through as `runTotal` on EVERY file in the run
 * (single-shot FormData field / chunked-finish query param), all the way to
 * queueVictorUploadNotice below. Decision (see victor-upload-notify-pure.ts):
 *   - runTotal===1 AND no batch already open for this work → send RIGHT AWAY,
 *     no coalescing wait at all.
 *   - otherwise (a known multi-file run, or joining an already-open batch) →
 *     coalesce into ONE push over a 1-minute rolling window (extended on every
 *     new success), counting only files that actually saved successfully.
 *
 * Storage: the existing `settings` key/value table (NO schema change), one row
 * per pending work batch: key = victor_upload_pending_{workId}.
 *
 * Flush: the minute scheduler (instrumentation.ts) calls
 * flushDueVictorUploadNotices() → sends one push for each batch whose window
 * has elapsed, then deletes the row.
 *
 * Targeting: sendPushToAll only ever reaches owner devices — push_subscriptions
 * is written exclusively by the requireOwner-gated /api/push/subscribe, so
 * Victor / test / client devices are never stored.
 */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const KEY_PREFIX = "victor_upload_pending_";
const key = (workId: string) => `${KEY_PREFIX}${workId}`;

/** Never send real push from local/dev — only production (or an explicit opt-in). */
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

/**
 * Called AFTER a Victor upload is saved (single-shot or chunked-finish — both
 * paths funnel here). `runTotal` is the client's own upfront file count for
 * THIS upload run; see the module doc above. Best-effort: must never throw
 * into the upload path.
 */
export async function queueVictorUploadNotice(workId: string, projectName: string, runTotal: number): Promise<void> {
  if (!pushAllowed() || !workId) return;
  const k = key(workId);
  try {
    const { data } = await supabase.from("settings").select("value").eq("key", k).maybeSingle();
    const existing = (data?.value ?? null) as PendingBatch | null;

    if (shouldSendImmediately(existing, runTotal)) {
      try {
        await sendPushToAll(buildVictorUploadPush(1, projectName, workId));
      } catch (e) {
        console.error("[victor-upload-notify] immediate send failed:", e);
      }
      return;
    }

    const next = nextPendingBatchValue(existing, workId, projectName, new Date().toISOString());
    await supabase.from("settings").upsert({ key: k, value: next }, { onConflict: "key" });
  } catch (e) {
    console.error("[victor-upload-notify] queue failed:", e);
  }
}

/**
 * Called every minute by the scheduler. Sends one owner push per batch whose
 * window has elapsed, then clears that batch.
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
    if (!v.dueAt || !isBatchDue({ dueAt: v.dueAt }, now)) continue; // window still open

    const count = v.count ?? 1;
    try {
      await sendPushToAll(buildVictorUploadPush(count, v.projectName || "פרויקט", v.workId ?? null));
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
