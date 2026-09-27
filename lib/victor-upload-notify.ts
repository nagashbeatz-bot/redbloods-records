import "server-only";

import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";
import { settingsBatchStore } from "@/lib/push-claims-batch";
import { classify, flushDueBatches, joinableBatch, type FlushableBatch } from "@/lib/push-claims-pure";
import {
  shouldSendImmediately,
  nextPendingBatchValue,
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
 * flushDueVictorUploadNotices() → for each batch whose window has elapsed it
 * CLAIMS the row (compare-and-swap open → processing, so two server processes can
 * never both send), sends one push, and removes the row only after a classified
 * delivery success; a failure stays as a durable "failed" row (never resent by a
 * tick). A new upload never joins a batch that is being sent or has failed.
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
    const existing = joinableBatch((data?.value ?? null) as (PendingBatch & FlushableBatch) | null);

    if (shouldSendImmediately(existing, runTotal)) {
      // A solo upload is its own real event (no marker, no retry) — the classified result is logged, never assumed.
      try {
        const cls = classify(await sendPushToAll(buildVictorUploadPush(1, projectName, workId)));
        if (cls !== "sent") console.error(`[victor-upload-notify] immediate push not delivered (${cls}) for work ${workId}`);
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
 * Called every minute by the scheduler: claim → send → classified close (see the module doc).
 */
export async function flushDueVictorUploadNotices(): Promise<void> {
  if (!pushAllowed()) return;
  await flushDueBatches(settingsBatchStore, KEY_PREFIX, Date.now(), async (v) => {
    const b = v as Partial<PendingBatch>;
    return classify(await sendPushToAll(buildVictorUploadPush(b.count ?? 1, b.projectName || "פרויקט", b.workId ?? null)));
  });
}
