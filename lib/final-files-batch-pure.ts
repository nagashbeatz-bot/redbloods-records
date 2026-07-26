/**
 * Pure decision logic behind lib/final-files-batch-notify.ts — no
 * "server-only"/Supabase/push imports, mirrors the shalev-*-pure.ts split so
 * it's testable from a plain tsx script (scripts/test-final-files-batch.ts).
 */

export interface BatchValue {
  status: "open" | "sent";
  workId: string;
  workName: string;
  successCount: number;
  lastUpdateAt: string;
}

/** Pure: the value a successful-file CAS/insert should write. `existing` is
 *  null on the very first success in a batch. Returns null when the batch is
 *  no longer "open" (a straggling finalize arriving after the batch was
 *  already claimed+sent) — the real caller must NOT write in that case. */
export function nextBatchValueOnSuccess(
  existing: BatchValue | null,
  workId: string,
  workName: string,
  nowIso: string,
): BatchValue | null {
  if (!existing) return { status: "open", workId, workName, successCount: 1, lastUpdateAt: nowIso };
  if (existing.status !== "open") return null;
  return { ...existing, successCount: existing.successCount + 1, lastUpdateAt: nowIso };
}

/** Pure: should an explicit complete/stale-flush call attempt to claim+send?
 *  False when there's no batch (every file failed — no success was ever
 *  recorded) or it's already claimed (sent, or a concurrent claim won first). */
export function shouldClaimBatch(existing: BatchValue | null): boolean {
  return !!existing && existing.status === "open";
}

/** Pure: true once a still-"open" batch has gone quiet longer than
 *  `staleMs` — the fallback-flush trigger for an abandoned (tab
 *  closed/crashed) batch that never got an explicit complete call. */
export function isBatchStale(existing: BatchValue, nowMs: number, staleMs: number): boolean {
  if (existing.status !== "open") return false;
  return nowMs - new Date(existing.lastUpdateAt).getTime() >= staleMs;
}

export interface FinalFilesPush { title: string; body: string; url: string }

/** Exact copy requested — singular/plural, workId/workName are the only
 *  variables, never a filename/notes. */
export function buildFinalFilesBatchPush(workId: string, workName: string, successCount: number): FinalFilesPush {
  const body = successCount === 1
    ? `Steven העלה קובץ סופי ל-${workName}`
    : `Steven העלה ${successCount} קבצים סופיים ל-${workName}`;
  return {
    title: "Steven העלה קבצים סופיים",
    body,
    url: `/team/steven?work=${encodeURIComponent(workId)}`,
  };
}
