/**
 * Pure decision logic behind lib/victor-upload-notify.ts — no
 * "server-only"/Supabase/push imports, mirrors the shalev-*-pure.ts /
 * final-files-batch-pure.ts split so it's testable from a plain tsx script
 * (scripts/test-victor-notify.ts).
 */

export interface PendingBatch {
  workId: string;
  projectName: string;
  count: number;
  dueAt: string; // ISO
}

// 1-minute coalescing window (shortened from the old 3-minute one) — only
// used for a batch the client already knows upfront is >1 file, or one that's
// already open for this work.
export const WINDOW_MS = 60 * 1000;

/**
 * Pure: should THIS upload be pushed immediately, bypassing the coalescing
 * table entirely? True only when the client's OWN upload run is known upfront
 * to be exactly one file (runTotal===1) AND no batch is already open for this
 * work. The second condition matters: if a multi-file run (or an earlier,
 * still-open batch) is already in flight for the same work, a solo-looking
 * upload must still JOIN it rather than fire its own separate push — an
 * overlapping in-flight batch always wins over "looks solo from here".
 *
 * What this deliberately does NOT solve: two genuinely SEPARATE user actions
 * (two distinct picker selections, each with runTotal===1) that happen to
 * land close together in time, with the first one's push already sent and
 * cleared before the second starts. The client cannot know in advance that a
 * second, independent pick is coming, and no server-side heuristic can either
 * without either delaying every solo upload (contradicts "immediately") or
 * risking a wrong guess. Each such pick is treated as exactly what it
 * genuinely is — its own real event.
 */
export function shouldSendImmediately(existing: PendingBatch | null, runTotal: number): boolean {
  return runTotal === 1 && existing === null;
}

/** Pure: the pending-batch value after a (non-immediate) successful upload —
 *  the first file in a fresh batch, or incrementing count + extending dueAt
 *  for one already open. The window is always re-armed from `nowIso`. */
export function nextPendingBatchValue(
  existing: PendingBatch | null,
  workId: string,
  projectName: string,
  nowIso: string,
  windowMs: number = WINDOW_MS,
): PendingBatch {
  return {
    workId,
    projectName: projectName || existing?.projectName || "פרויקט",
    count: (existing?.count ?? 0) + 1,
    dueAt: new Date(new Date(nowIso).getTime() + windowMs).toISOString(),
  };
}

/** Pure: true once a pending batch has gone quiet past its own dueAt — the
 *  scheduler-tick flush trigger. */
export function isBatchDue(existing: Pick<PendingBatch, "dueAt">, nowMs: number): boolean {
  return nowMs >= new Date(existing.dueAt).getTime();
}

export interface VictorUploadPush { title: string; body: string; url: string; tag: string }

/** Exact copy requested — singular/plural, projectName/workId are the only
 *  variables. Used for BOTH the immediate-solo send and the coalesced flush,
 *  so the two paths can never drift apart in wording. */
export function buildVictorUploadPush(count: number, projectName: string, workId: string | null): VictorUploadPush {
  const project = projectName || "פרויקט";
  const body = count === 1
    ? `Victor העלה קובץ ל-${project}`
    : `Victor העלה ${count} קבצים ל-${project}`;
  return {
    title: "Victor העלה קבצים",
    body,
    url: workId ? `/team/victor?workId=${workId}` : "/team/victor",
    tag: `victor-upload-${workId ?? "x"}`,
  };
}
