/**
 * Standalone smoke test for lib/final-files-batch-pure.ts (the pure decision
 * logic behind lib/final-files-batch-notify.ts).
 *
 * Run with:   npx tsx scripts/test-final-files-batch.ts
 *
 * Imports ONLY from final-files-batch-pure.ts, which has no
 * "server-only"/Supabase/push dependency. No real Supabase writes, no real
 * push anywhere in this file. The fake store below mirrors the real CAS
 * protocol in claimAndSend/recordFinalFileBatchSuccess (lib/final-files-batch-notify.ts)
 * closely enough to exercise the full success/failure/retry/idempotency
 * matrix the spec requires.
 */
import {
  nextBatchValueOnSuccess,
  shouldClaimBatch,
  isBatchStale,
  buildFinalFilesBatchPush,
  type BatchValue,
} from "../lib/final-files-batch-pure";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ── Fake batch store — one Map keyed by batchId, mirroring the real
//    settings-table CAS protocol using the actual pure decision functions. ──
function makeStore() {
  const store = new Map<string, BatchValue>();
  let pushes: { workId: string; workName: string; successCount: number }[] = [];

  function recordSuccess(batchId: string, workId: string, workName: string, nowIso: string) {
    const existing = store.get(batchId) ?? null;
    const next = nextBatchValueOnSuccess(existing, workId, workName, nowIso);
    if (next) store.set(batchId, next);
  }
  function complete(batchId: string, workId: string): "sent" | "no_batch" | "not_owned" | "already_claimed" {
    const existing = store.get(batchId) ?? null;
    if (!shouldClaimBatch(existing)) return existing ? "already_claimed" : "no_batch";
    if (existing!.workId !== workId) return "not_owned";
    store.set(batchId, { ...existing!, status: "sent" });
    if (existing!.successCount > 0) pushes.push({ workId: existing!.workId, workName: existing!.workName, successCount: existing!.successCount });
    store.delete(batchId);
    return "sent";
  }
  function flushStale(nowMs: number, staleMs: number) {
    for (const [batchId, v] of Array.from(store.entries())) {
      if (isBatchStale(v, nowMs, staleMs)) {
        store.set(batchId, { ...v, status: "sent" });
        if (v.successCount > 0) pushes.push({ workId: v.workId, workName: v.workName, successCount: v.successCount });
        store.delete(batchId);
      }
    }
  }
  return {
    recordSuccess, complete, flushStale,
    get pushes() { return pushes; },
    resetPushes() { pushes = []; },
    peek: (batchId: string) => store.get(batchId) ?? null,
  };
}

function main() {
  console.log("\n—— nextBatchValueOnSuccess ——");
  {
    const now = "2026-07-27T10:00:00.000Z";
    const first = nextBatchValueOnSuccess(null, "w1", "Give It Up To Me", now);
    check("first success creates status=open, count=1", first?.status === "open" && first?.successCount === 1);

    const second = nextBatchValueOnSuccess(first, "w1", "Give It Up To Me", now);
    check("second success increments to 2", second?.successCount === 2);

    const alreadySent: BatchValue = { status: "sent", workId: "w1", workName: "x", successCount: 3, lastUpdateAt: now };
    check("a success arriving after the batch was already sent is a no-op", nextBatchValueOnSuccess(alreadySent, "w1", "x", now) === null);
  }

  console.log("—— shouldClaimBatch / isBatchStale ——");
  {
    check("no batch at all → cannot claim", !shouldClaimBatch(null));
    const open: BatchValue = { status: "open", workId: "w1", workName: "x", successCount: 2, lastUpdateAt: "2026-07-27T10:00:00.000Z" };
    check("open batch → can claim", shouldClaimBatch(open));
    const sent: BatchValue = { ...open, status: "sent" };
    check("already-sent batch → cannot claim again", !shouldClaimBatch(sent));

    check("fresh open batch is not stale", !isBatchStale(open, new Date(open.lastUpdateAt).getTime() + 1000, 3 * 60 * 1000));
    check("open batch past the stale threshold IS stale", isBatchStale(open, new Date(open.lastUpdateAt).getTime() + 3 * 60 * 1000 + 1, 3 * 60 * 1000));
    check("a sent batch is never \"stale\" (nothing to flush)", !isBatchStale(sent, new Date(open.lastUpdateAt).getTime() + 999999, 3 * 60 * 1000));
  }

  console.log("—— buildFinalFilesBatchPush (exact copy) ——");
  {
    const one = buildFinalFilesBatchPush("w1", "Give It Up To Me", 1);
    check("title exact", one.title === "Steven העלה קבצים סופיים");
    check("singular body exact", one.body === "Steven העלה קובץ סופי ל-Give It Up To Me");
    check("url deep-links to the work", one.url === "/team/steven?work=w1");

    const four = buildFinalFilesBatchPush("w1", "Give It Up To Me", 4);
    check("plural body exact with count", four.body === "Steven העלה 4 קבצים סופיים ל-Give It Up To Me");
  }

  console.log("—— end-to-end batch scenarios (fake store, real pure logic) ——");
  {
    const s = makeStore();
    const now = "2026-07-27T10:00:00.000Z";

    // Scenario: single file succeeds.
    s.recordSuccess("batch-1", "w1", "Give It Up To Me", now);
    const r1 = s.complete("batch-1", "w1");
    check("single success: complete() sends", r1 === "sent");
    check("single success: exactly one push, count=1", s.pushes.length === 1 && s.pushes[0].successCount === 1);
    s.resetPushes();

    // Scenario: 4 files succeed.
    for (let i = 0; i < 4; i++) s.recordSuccess("batch-2", "w2", "Song B", now);
    s.complete("batch-2", "w2");
    check("4 successes: one push with count=4", s.pushes.length === 1 && s.pushes[0].successCount === 4);
    s.resetPushes();

    // Scenario: 3 succeed, 2 fail (failures never call recordSuccess at all).
    for (let i = 0; i < 3; i++) s.recordSuccess("batch-3", "w3", "Song C", now);
    s.complete("batch-3", "w3");
    check("3 of 5 succeed: push says count=3 (failures never counted)", s.pushes.length === 1 && s.pushes[0].successCount === 3);
    s.resetPushes();

    // Scenario: all files fail → recordSuccess never called → no batch exists.
    const r4 = s.complete("batch-4-never-recorded", "w4");
    check("all fail: no batch row exists → no_batch, no push", r4 === "no_batch" && s.pushes.length === 0);

    // Scenario: retry a failed file for an already-sent batch → NEW batchId,
    // independent of the old (already-deleted) one.
    s.recordSuccess("batch-5", "w5", "Song E", now);
    s.complete("batch-5", "w5"); // batch-5 sent + deleted
    s.resetPushes();
    s.recordSuccess("batch-5-retry", "w5", "Song E", now); // retry mints a fresh id
    s.complete("batch-5-retry", "w5");
    check("retry after a sent batch uses a fresh id and sends its own push", s.pushes.length === 1 && s.pushes[0].successCount === 1);

    // Scenario: double-click / StrictMode double-invoke of complete() for the
    // SAME batch → only the first call sends.
    s.resetPushes();
    s.recordSuccess("batch-6", "w6", "Song F", now);
    const firstCall = s.complete("batch-6", "w6");
    const secondCall = s.complete("batch-6", "w6"); // batch-6 was deleted after the first call
    check("first complete() call sends", firstCall === "sent");
    check("second complete() call on the same batch is a no-op (no row left)", secondCall === "no_batch");
    check("double-click produces exactly one push", s.pushes.length === 1);

    // Scenario: refresh/page-load must never call recordSuccess or complete on
    // its own — nothing here does, by construction (both require an explicit
    // upload/complete call); confirm the store stays empty absent any call.
    check("no push exists for a batchId nothing was ever recorded/completed for", s.peek("never-touched") === null);

    // Scenario: an abandoned batch (client never calls complete) is caught by
    // the stale-flush fallback, exactly once.
    s.resetPushes();
    s.recordSuccess("batch-7", "w7", "Song G", now);
    s.flushStale(new Date(now).getTime() + 1000, 3 * 60 * 1000); // not yet stale
    check("not-yet-stale batch is left alone by the flush", s.pushes.length === 0 && s.peek("batch-7") !== null);
    s.flushStale(new Date(now).getTime() + 3 * 60 * 1000 + 1, 3 * 60 * 1000); // now past the threshold
    check("stale-flush sends exactly one push for an abandoned batch", s.pushes.length === 1 && s.pushes[0].successCount === 1);
    check("stale-flush removes the batch so a later explicit complete() is a no-op", s.complete("batch-7", "w7") === "no_batch");

    // Scenario: a batch belonging to a different work is never completed by it.
    s.resetPushes();
    s.recordSuccess("batch-8", "w8", "Song H", now);
    const wrongWork = s.complete("batch-8", "not-w8");
    check("completing with the wrong workId is rejected", wrongWork === "not_owned" && s.pushes.length === 0);
    check("the real batch is untouched and can still be completed by its real work", s.complete("batch-8", "w8") === "sent");
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
