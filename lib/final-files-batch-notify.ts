import "server-only";
import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";
import {
  nextBatchValueOnSuccess,
  shouldClaimBatch,
  isBatchStale,
  buildFinalFilesBatchPush,
  type BatchValue,
} from "@/lib/final-files-batch-pure";

/**
 * Owner-only push summarizing a "Upload Final Files" BATCH — separate from,
 * and never touching, lib/steven-notify.ts's existing Mix-version upload
 * coalescing. One push per batch, sent only after every file in the batch has
 * reached a terminal state (success/failure/cancel), counting ONLY files that
 * actually landed in `final_files` (never a client-reported count). The
 * counting/claim DECISIONS live in lib/final-files-batch-pure.ts (no
 * Supabase/push import, directly unit-testable); this file supplies the real
 * Supabase/push wiring behind them.
 *
 * All state lives in the existing `settings` key/value table (NO schema
 * change). Key = `final_files_batch:{batchId}` — batchId is a client-generated
 * UUID minted ONCE per "Upload Final Files" run (never reused, and never just
 * workId — a work can have several batches over time). Two entry points:
 *
 *   - recordFinalFileBatchSuccess: called from the ONE upload choke point
 *     (lib/final-file-upload.ts's finalizeFinalFile) on every successful save.
 *     Best-effort read-modify-write with a CAS retry loop (same
 *     `.eq("value", JSON.stringify(old))` pattern already proven elsewhere in
 *     this codebase) so concurrent increments for the same batch can't clobber
 *     each other.
 *   - completeFinalFilesBatch: called EXPLICITLY by the client right after its
 *     sequential per-file upload loop finishes (all items terminal) — the
 *     primary, non-timeout signal that the batch is done. A CAS claim
 *     (open → sent) means a double-click / StrictMode double-invoke / retry
 *     can win the claim at most once, so at most one push is ever sent per
 *     batch. If no row exists (every file failed — recordFinalFileBatchSuccess
 *     was never reached), this is a silent no-op: no success push.
 *
 * flushStaleFinalFilesBatches is a fallback safety net (NOT the primary
 * mechanism) for the case where the client never calls completeFinalFilesBatch
 * (tab closed, crash, network drop) — called every minute from the same
 * scheduler tick as flushDueStevenUploadNotices.
 */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const BATCH_KEY_PREFIX = "final_files_batch:";
const batchKey = (batchId: string) => `${BATCH_KEY_PREFIX}${batchId}`;

// A batch the client never explicitly completed within this long is presumed
// abandoned (tab closed / crash) — the fallback tick finalizes it instead.
const STALE_BATCH_MS = 3 * 60 * 1000;

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

/** Best-effort: never throws into the upload path. */
export async function recordFinalFileBatchSuccess(batchId: string, workId: string, workName: string): Promise<void> {
  if (!pushAllowed() || !batchId) return;
  const key = batchKey(batchId);
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: row } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
      const existing = (row?.value ?? null) as BatchValue | null;
      const next = nextBatchValueOnSuccess(existing, workId, workName, new Date().toISOString());
      if (!next) return; // batch already claimed/sent — a straggling file finalize after completion; nothing to do

      if (!existing) {
        const { error } = await supabase.from("settings").insert({ key, value: next });
        if (!error) return;
        if (error.code !== "23505") { console.error("[final-files-batch] insert failed:", error.message); return; }
        continue; // lost the race to insert-first — retry as an update against whatever's there now
      }

      const { data: updated, error } = await supabase
        .from("settings")
        .update({ value: next })
        .eq("key", key)
        .eq("value", JSON.stringify(existing))
        .select();
      if (error) { console.error("[final-files-batch] update failed:", error.message); return; }
      if (updated && updated.length > 0) return; // won the CAS
      // lost the race to a concurrent increment — retry
    }
    console.error(`[final-files-batch] gave up incrementing ${key} after 5 CAS attempts`);
  } catch (e) {
    console.error("[final-files-batch] record failed:", e);
  }
}

/** Claims the batch (open → sent) and sends the summary push. Returns true iff
 *  THIS call won the claim (regardless of push send outcome) — used by both
 *  the explicit-complete and stale-flush callers so at most one send happens. */
async function claimAndSend(key: string, existing: BatchValue): Promise<boolean> {
  const sent: BatchValue = { ...existing, status: "sent" };
  const { data: updated, error } = await supabase
    .from("settings")
    .update({ value: sent })
    .eq("key", key)
    .eq("value", JSON.stringify(existing))
    .select();
  if (error) { console.error("[final-files-batch] claim failed:", error.message); return false; }
  if (!updated || updated.length === 0) return false; // lost the race — another caller already claimed it

  if (existing.successCount > 0) {
    try {
      await sendPushToAll(buildFinalFilesBatchPush(existing.workId, existing.workName, existing.successCount));
    } catch (e) {
      console.error("[final-files-batch] push send failed:", e);
    }
  }
  // Best-effort cleanup — a delete failure just leaves an inert "sent" row behind.
  await supabase.from("settings").delete().eq("key", key).then(null, () => {});
  return true;
}

/** Called by the client right after its upload loop finishes (all files
 *  terminal). Idempotent: a second call (double-click, retry, StrictMode) for
 *  the same batchId is a guaranteed no-op. If the batch has zero recorded
 *  successes (every file failed), no push is sent. */
export async function completeFinalFilesBatch(batchId: string, workId: string): Promise<void> {
  if (!pushAllowed() || !batchId) return;
  const key = batchKey(batchId);
  try {
    const { data: row } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
    const existing = (row?.value ?? null) as BatchValue | null;
    if (!shouldClaimBatch(existing)) return;
    if (existing!.workId !== workId) return; // defense in depth: batch doesn't belong to this work
    await claimAndSend(key, existing!);
  } catch (e) {
    console.error("[final-files-batch] complete failed:", e);
  }
}

/** Fallback safety net — called every minute from instrumentation.ts alongside
 *  flushDueStevenUploadNotices. Finalizes any batch the client never
 *  explicitly completed (abandoned tab/crash), so a real upload is never
 *  silently un-notified. NOT the primary mechanism — completeFinalFilesBatch
 *  (an explicit client signal) always wins the race when it fires. */
export async function flushStaleFinalFilesBatches(): Promise<void> {
  if (!pushAllowed()) return;
  let rows: { key: string; value: unknown }[] = [];
  try {
    const { data } = await supabase.from("settings").select("key, value").like("key", `${BATCH_KEY_PREFIX}%`);
    rows = data ?? [];
  } catch (e) {
    console.error("[final-files-batch] stale scan failed:", e);
    return;
  }

  const now = Date.now();
  for (const row of rows) {
    const v = (row.value ?? {}) as BatchValue;
    if (!isBatchStale(v, now, STALE_BATCH_MS)) continue;
    await claimAndSend(row.key, v).catch((e) => console.error("[final-files-batch] stale flush failed:", e));
  }
}
