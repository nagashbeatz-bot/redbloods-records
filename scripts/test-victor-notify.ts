/**
 * Standalone smoke test for lib/victor-upload-notify-pure.ts and
 * lib/victor-presence-pure.ts (the pure decision logic behind
 * lib/victor-upload-notify.ts and lib/victor-presence-notify.ts).
 *
 * Run with:   npx tsx scripts/test-victor-notify.ts
 *
 * Imports ONLY from the two pure modules, which have no
 * "server-only"/Supabase/push dependency. No real Supabase writes, no real
 * push anywhere in this file.
 */
import {
  shouldSendImmediately,
  nextPendingBatchValue,
  isBatchDue,
  buildVictorUploadPush,
  WINDOW_MS,
  type PendingBatch,
} from "../lib/victor-upload-notify-pure";
import { decideVisitClaim, VISIT_COOLDOWN_MS } from "../lib/victor-presence-pure";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ── Fake upload-batch store, mirroring the real settings-table protocol using
//    the actual pure decision functions (queueVictorUploadNotice's logic). ──
function makeUploadStore() {
  const store = new Map<string, PendingBatch>();
  const immediatePushes: { count: number; project: string; workId: string | null }[] = [];
  const flushedPushes: { count: number; project: string; workId: string | null }[] = [];

  function upload(workId: string, projectName: string, runTotal: number, nowIso: string) {
    const existing = store.get(workId) ?? null;
    if (shouldSendImmediately(existing, runTotal)) {
      immediatePushes.push({ count: 1, project: projectName, workId });
      return;
    }
    store.set(workId, nextPendingBatchValue(existing, workId, projectName, nowIso));
  }
  function tick(nowMs: number) {
    for (const [workId, v] of Array.from(store.entries())) {
      if (isBatchDue(v, nowMs)) {
        flushedPushes.push({ count: v.count, project: v.projectName, workId });
        store.delete(workId);
      }
    }
  }
  return { upload, tick, store, immediatePushes, flushedPushes };
}

function main() {
  console.log("\n—— shouldSendImmediately / nextPendingBatchValue / isBatchDue ——");
  {
    check("solo file, no existing batch → immediate", shouldSendImmediately(null, 1));
    const openBatch: PendingBatch = { workId: "w1", projectName: "X", count: 1, dueAt: "2026-07-27T10:01:00.000Z" };
    check("solo-looking file but a batch is ALREADY open for this work → joins, not immediate", !shouldSendImmediately(openBatch, 1));
    check("known multi-file run (runTotal>1), even as the FIRST file → never immediate", !shouldSendImmediately(null, 3));

    const first = nextPendingBatchValue(null, "w1", "Song A", "2026-07-27T10:00:00.000Z");
    check("first file in a fresh batch: count=1, window armed", first.count === 1 && new Date(first.dueAt).getTime() === new Date("2026-07-27T10:00:00.000Z").getTime() + WINDOW_MS);
    const second = nextPendingBatchValue(first, "w1", "Song A", "2026-07-27T10:00:20.000Z");
    check("second file 20s later: count=2, window re-armed from the LATEST file", second.count === 2 && new Date(second.dueAt).getTime() === new Date("2026-07-27T10:00:20.000Z").getTime() + WINDOW_MS);

    check("not yet due before dueAt", !isBatchDue(second, new Date(second.dueAt).getTime() - 1));
    check("due exactly at dueAt", isBatchDue(second, new Date(second.dueAt).getTime()));
  }

  console.log("—— buildVictorUploadPush (exact copy) ——");
  {
    const one = buildVictorUploadPush(1, "Give It Up To Me", "w1");
    check("title exact", one.title === "Victor העלה קבצים");
    check("singular body exact", one.body === "Victor העלה קובץ ל-Give It Up To Me");
    check("url deep-links via ?workId=", one.url === "/team/victor?workId=w1");

    const four = buildVictorUploadPush(4, "Give It Up To Me", "w1");
    check("plural body exact with count", four.body === "Victor העלה 4 קבצים ל-Give It Up To Me");

    const noWork = buildVictorUploadPush(2, "Song", null);
    check("no workId → generic url", noWork.url === "/team/victor");
  }

  console.log("—— end-to-end upload scenarios (fake store, real pure logic) ——");
  {
    const s = makeUploadStore();
    const t0 = "2026-07-27T10:00:00.000Z";

    // Single file only → immediate push, no batch row left behind.
    s.upload("w1", "Song A", 1, t0);
    check("single file: exactly one immediate push", s.immediatePushes.length === 1 && s.immediatePushes[0].count === 1);
    check("single file: no pending batch row created", s.store.get("w1") === undefined);
  }
  {
    const s = makeUploadStore();
    const t0 = "2026-07-27T10:00:00.000Z";
    const t1 = "2026-07-27T10:00:20.000Z"; // 20s later, same known 2-file run

    // Known multi-file run (runTotal=2 on BOTH calls) — file 1 then file 2 20s later.
    s.upload("w2", "Song B", 2, t0);
    check("multi-run file 1: no immediate push", s.immediatePushes.length === 0);
    s.upload("w2", "Song B", 2, t1);
    check("multi-run file 2 (20s later): still no immediate push", s.immediatePushes.length === 0);
    check("batch count is 2 after both files", s.store.get("w2")?.count === 2);

    // Flush before the window elapses → nothing sent yet.
    s.tick(new Date(t1).getTime() + WINDOW_MS - 1);
    check("flush before the 1-minute window elapses: nothing sent", s.flushedPushes.length === 0);
    // Flush once the window (from the LAST file) has elapsed.
    s.tick(new Date(t1).getTime() + WINDOW_MS);
    check("flush after the window: exactly one push with count=2", s.flushedPushes.length === 1 && s.flushedPushes[0].count === 2);
  }
  {
    // Four files in a row (same known run) → one push with count=4.
    const s = makeUploadStore();
    const t0 = "2026-07-27T10:00:00.000Z";
    for (let i = 0; i < 4; i++) s.upload("w3", "Song C", 4, new Date(new Date(t0).getTime() + i * 5000).toISOString());
    check("4-file run: no immediate pushes at all", s.immediatePushes.length === 0);
    s.tick(new Date(t0).getTime() + 4 * 5000 + WINDOW_MS);
    check("4-file run flush: exactly one push with count=4", s.flushedPushes.length === 1 && s.flushedPushes[0].count === 4);
  }
  {
    // 3 of 5 succeed (the other 2 simply never call upload — a failed/cancelled
    // file never reaches queueVictorUploadNotice by construction).
    const s = makeUploadStore();
    const t0 = "2026-07-27T10:00:00.000Z";
    for (let i = 0; i < 3; i++) s.upload("w4", "Song D", 5, t0);
    s.tick(new Date(t0).getTime() + WINDOW_MS);
    check("3 of 5 succeed: push reflects only the 3 real successes", s.flushedPushes.length === 1 && s.flushedPushes[0].count === 3);
  }
  {
    // Different projects/works never share a batch.
    const s = makeUploadStore();
    const t0 = "2026-07-27T10:00:00.000Z";
    s.upload("w5", "Song E", 2, t0);
    s.upload("w6", "Song F", 2, t0);
    s.tick(new Date(t0).getTime() + WINDOW_MS);
    check("two different works: two separate flushed pushes", s.flushedPushes.length === 2);
    check("each push carries its own work's project name", s.flushedPushes.some(p => p.project === "Song E") && s.flushedPushes.some(p => p.project === "Song F"));
  }
  {
    // Retry / duplicate tick: a batch already flushed (row deleted) is never re-sent.
    const s = makeUploadStore();
    const t0 = "2026-07-27T10:00:00.000Z";
    s.upload("w7", "Song G", 2, t0);
    s.tick(new Date(t0).getTime() + WINDOW_MS);
    const countAfterFirstTick = s.flushedPushes.length;
    s.tick(new Date(t0).getTime() + WINDOW_MS + 60000); // a later cron tick
    check("a later tick never re-sends an already-flushed batch", s.flushedPushes.length === countAfterFirstTick);
  }

  console.log("—— decideVisitClaim (Victor page-visit cooldown) ——");
  {
    const now = new Date("2026-07-27T10:00:00.000Z").getTime();
    check("no prior visit → insert", decideVisitClaim(null, now) === "insert");

    const fresh = new Date(now - 5 * 60 * 1000).toISOString(); // 5 min ago
    check("within the 30-min cooldown → skip (refresh / second tab)", decideVisitClaim(fresh, now) === "skip");

    const stale = new Date(now - VISIT_COOLDOWN_MS - 1000).toISOString(); // just past 30 min
    check("cooldown elapsed → cas_update (a genuinely new visit)", decideVisitClaim(stale, now) === "cas_update");

    const exactBoundary = new Date(now - VISIT_COOLDOWN_MS).toISOString();
    check("exactly at the cooldown boundary → cas_update", decideVisitClaim(exactBoundary, now) === "cas_update");
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
