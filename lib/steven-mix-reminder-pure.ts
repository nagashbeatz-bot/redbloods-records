/**
 * Pure logic for the "remind Steven every 5h until he uploads a new mix
 * version" reminder cycle — no "server-only"/Supabase/push imports, testable
 * from a plain tsx script. Mirrors the split used by
 * lib/shalev-availability-reminder-pure.ts / lib/shalev-weekly-pure.ts.
 *
 * A cycle starts when the owner clicks "Send notes" (lib/steven-notes-notify.ts,
 * unchanged — that immediate push is untouched). From then on, every 5 hours
 * (first reminder at cycleStartAt+5h, each next one at lastReminderAt+5h) a
 * reminder fires — but ONLY while every stop condition is still false. All four
 * are re-checked fresh on EVERY tick, before the due-time gate, so a cycle that
 * must die never waits for its next 5h window (and needs no hook in the upload
 * or delete path):
 *   1. remindersSent >= MAX_REMINDERS (3) — the cycle has said its piece.
 *   2. The sound_engineer_work no longer exists (deleted).
 *   3. Its status is COMPLETED_STATUS ("אושר", shown in the UI as "הושלם") —
 *      completion outranks everything: pending notes and a missing new version
 *      stop mattering the moment the work is approved.
 *   4. A mix_versions row for the same work has created_at strictly after
 *      cycleStartAt (the original condition, unchanged).
 * Every stop path deletes only this cycle's own settings row via stopCycle —
 * no other data is touched. A later "Send notes" click always starts a
 * brand-new cycle (fresh cycleStartAt, remindersSent reset to 0), which
 * naturally supersedes/replaces the old one — see startOrResetReminderCycle in
 * lib/steven-mix-reminder-notify.ts.
 *
 * `decideClaimAction`/`ClaimValue` are pure and feature-agnostic — imported
 * directly from lib/shalev-availability-reminder-pure.ts rather than
 * duplicated (same reasoning as that file's own re-export of
 * lib/shalev-weekly-pure.ts's MAX_ATTEMPTS/STUCK_PROCESSING_TIMEOUT_MS).
 */
import { MAX_ATTEMPTS, STUCK_PROCESSING_TIMEOUT_MS, classifyPushResult } from "@/lib/shalev-weekly-pure";
import { decideClaimAction, type ClaimValue, type ClaimResult, type ClaimDecision } from "@/lib/shalev-availability-reminder-pure";

export { MAX_ATTEMPTS, STUCK_PROCESSING_TIMEOUT_MS, classifyPushResult, decideClaimAction };
export type { ClaimValue, ClaimResult, ClaimDecision };

export const REMINDER_INTERVAL_MS = 5 * 60 * 60 * 1000;

/** Hard cap on reminders per cycle: #1, #2 and #3 may go out, #4 never does.
 *  Distinct from MAX_ATTEMPTS, which only bounds RETRIES of one failed send. */
export const MAX_REMINDERS = 3;

/** The value sound_engineer_work.status actually holds when a work is done.
 *  The DB enum is לא נשלח | נשלח | בתהליך | חזר | אושר | בוטל (lib/types.ts
 *  SoundEngineerStatus) — it never stores "הושלם"; that is purely the UI label
 *  dbStatusToUi() renders for "אושר" (components/team/StevenProfilePage.tsx). */
export const COMPLETED_STATUS = "אושר";

export function isCompletedStatus(status: string | null | undefined): boolean {
  return status === COMPLETED_STATUS;
}

/** One settings row per work with an active cycle — key = cycleStateKey(workId). */
export interface CycleState {
  workId: string;
  cycleStartAt: string;        // ISO — canonical T0 (the "Send notes" click instant)
  remindersSent: number;
  lastReminderAt: string | null;
}

export function cycleStateKey(workId: string): string {
  return `steven_mix_reminder_cycle:${workId}`;
}

/** Per-attempt send claim (INSERT-first + CAS-retry, identical protocol to
 *  lib/shalev-availability-reminder-notify.ts's claimReal). One key per
 *  (work, cycle, attempt#) — a cycle restart (new cycleStartAt) naturally
 *  yields fresh, unrelated claim keys, so the old cycle's claims are simply
 *  abandoned, never reused or double-fired. */
export function cycleClaimKey(workId: string, cycleStartAt: string, attemptNumber: number): string {
  return `steven_mix_reminder_send:${workId}:${cycleStartAt}:${attemptNumber}`;
}

/** True once a mix_versions row exists for the work with created_at strictly
 *  AFTER cycleStartAt — the sole stop condition (never shows.status/comment
 *  status; a Final Files upload never appears here — it's a fully separate
 *  table, see lib/final-file-upload.ts). */
export function hasNewerVersion(cycleStartAt: string, latestVersionCreatedAt: string | null): boolean {
  if (!latestVersionCreatedAt) return false;
  return Date.parse(latestVersionCreatedAt) > Date.parse(cycleStartAt);
}

/** True once the cycle has already sent its full quota. Pure and DB-free, so an
 *  over-quota cycle — including one left mid-flight in production by an earlier
 *  build that had no cap — is stopped on the very next tick without a push,
 *  without a query and without any manual settings cleanup. */
export function hasReachedReminderCap(cycle: Pick<CycleState, "remindersSent">): boolean {
  return cycle.remindersSent >= MAX_REMINDERS;
}

/** True once 5 real hours have elapsed since the last relevant instant — the
 *  cycle's own start for the FIRST reminder, or the previous reminder's ACTUAL
 *  send time for every one after that (not a rigid cycleStartAt+N*5h grid) —
 *  so a late-firing tick (e.g. after downtime) can never send a burst: once
 *  reminder #1 fires "late", lastReminderAt becomes ~now, and reminder #2's
 *  window only starts counting from THAT real instant. */
export function isReminderDue(now: Date, cycle: CycleState): boolean {
  const base = cycle.remindersSent === 0 ? cycle.cycleStartAt : cycle.lastReminderAt;
  if (!base) return false; // defensive — never happens by construction (writer always pairs remindersSent>0 with lastReminderAt)
  return now.getTime() >= Date.parse(base) + REMINDER_INTERVAL_MS;
}

/** Steven-facing text — ENGLISH, like every other push he receives (compare
 *  lib/steven-notes-notify.ts's "New mix notes from Redbloods"). workName is the
 *  work's own display name and is interpolated verbatim; it is data, not copy. */
export function buildReminderPush(workName: string): { title: string; body: string } {
  return {
    title: "Mix notes reminder",
    body: `You still have pending notes for ${workName}. Please upload an updated version.`,
  };
}

// ── Orchestration for ONE work's cycle — injectable deps so branches are
//    testable without a real DB/webpush call (mirrors
//    processAvailabilityReminderSlot's shape exactly). ──────────────────────

export type ReminderOutcome =
  | { kind: "resolved_stopped" }
  | { kind: "cap_reached_stopped" }
  | { kind: "work_missing_stopped" }
  | { kind: "work_completed_stopped" }
  | { kind: "not_due" }
  | { kind: "skipped_duplicate" }
  | { kind: "sent" }
  | { kind: "no_subscription" | "send_failed"; final: boolean };

/** The only two things about the work itself that can stop a cycle. Read in one
 *  shot so the orchestrator needs no sound_engineer_work coupling of its own. */
export interface WorkReminderState {
  exists: boolean;
  /** status === COMPLETED_STATUS. Meaningless (and always false) when !exists. */
  completed: boolean;
}

export interface ReminderCycleDeps {
  getWorkState: (workId: string) => Promise<WorkReminderState>;
  getLatestVersionCreatedAt: (workId: string) => Promise<string | null>;
  claim: (key: string, now: Date) => Promise<ClaimResult>;
  markDone: (key: string, value: Record<string, unknown>) => Promise<void>;
  /** Resolves the work's current display name + sends — internal to the real
   *  wiring; the pure orchestrator never needs to know about work names. */
  sendReminder: (workId: string) => Promise<{ status: string }[]>;
  stopCycle: (workId: string) => Promise<void>;
  updateCycleProgress: (workId: string, patch: { remindersSent: number; lastReminderAt: string }) => Promise<void>;
  log: (msg: string) => void;
  logError: (msg: string, err?: unknown) => void;
}

export async function processReminderCycle(
  now: Date,
  cycle: CycleState,
  deps: ReminderCycleDeps,
): Promise<ReminderOutcome> {
  // ── Stop conditions — ALL checked FIRST, every tick, BEFORE the due-time
  //    gate, so a cycle that must die never lingers until its next 5h window.
  //    Each one only calls stopCycle (deletes this cycle's own settings row);
  //    nothing else is ever written or removed. ──────────────────────────────

  // 1. Quota spent. Pure — no query — so an over-quota cycle costs one tick and
  //    zero pushes to retire, which is exactly how cycles already sitting at
  //    remindersSent >= MAX_REMINDERS in production clean themselves up.
  if (hasReachedReminderCap(cycle)) {
    await deps.stopCycle(cycle.workId);
    deps.log(`work ${cycle.workId}: ${cycle.remindersSent}/${MAX_REMINDERS} reminders already sent — cycle stopped`);
    return { kind: "cap_reached_stopped" };
  }

  // 2. The work itself. Deleted → stop silently; the send path must never fall
  //    back to a placeholder name for a work that is gone.
  const work = await deps.getWorkState(cycle.workId);
  if (!work.exists) {
    await deps.stopCycle(cycle.workId);
    deps.log(`work ${cycle.workId}: no longer exists — cycle stopped`);
    return { kind: "work_missing_stopped" };
  }
  // 3. Completed outranks every reason to remind: it does not matter that notes
  //    are still pending, nor that no newer version was ever uploaded.
  if (work.completed) {
    await deps.stopCycle(cycle.workId);
    deps.log(`work ${cycle.workId}: status is "${COMPLETED_STATUS}" (UI "הושלם") — cycle stopped`);
    return { kind: "work_completed_stopped" };
  }

  // 4. The original condition, unchanged — a version uploaded seconds after
  //    cycleStartAt stops the cycle on the very next tick regardless of whether
  //    a reminder was ever due yet.
  const latest = await deps.getLatestVersionCreatedAt(cycle.workId);
  if (hasNewerVersion(cycle.cycleStartAt, latest)) {
    await deps.stopCycle(cycle.workId);
    deps.log(`work ${cycle.workId}: newer version found since ${cycle.cycleStartAt} — cycle stopped`);
    return { kind: "resolved_stopped" };
  }

  if (!isReminderDue(now, cycle)) return { kind: "not_due" };

  const attemptNumber = cycle.remindersSent + 1;
  const key = cycleClaimKey(cycle.workId, cycle.cycleStartAt, attemptNumber);
  const claim = await deps.claim(key, now);
  if (!claim.claimed) {
    deps.log(`${key} not claimed (already sent, or a concurrent tick holds it) — skipping`);
    return { kind: "skipped_duplicate" };
  }
  const isFinalAttempt = claim.attempt >= MAX_ATTEMPTS;
  const nowIso = now.toISOString();

  try {
    const results = await deps.sendReminder(cycle.workId);
    const cls = classifyPushResult(results);

    if (cls === "sent") {
      await deps.markDone(key, {
        status: "sent", workId: cycle.workId, cycleStartAt: cycle.cycleStartAt, attemptNumber,
        attempt_count: claim.attempt, lastAttemptAt: nowIso,
      });
      // Only the claim-winning tick ever advances the cycle — a plain write
      // (no CAS) is safe here for the same reason markDoneReal's is elsewhere.
      await deps.updateCycleProgress(cycle.workId, { remindersSent: attemptNumber, lastReminderAt: nowIso });
      deps.log(`sent reminder #${attemptNumber} for work ${cycle.workId}`);
      return { kind: "sent" };
    }

    await deps.markDone(key, {
      status: "failed", workId: cycle.workId, cycleStartAt: cycle.cycleStartAt, attemptNumber,
      reason: cls, attempt_count: claim.attempt, lastAttemptAt: nowIso,
    });
    deps.logError(
      `attempt ${claim.attempt}/${MAX_ATTEMPTS} FAILED (${cls}) for work ${cycle.workId}, reminder #${attemptNumber}` +
      (isFinalAttempt ? " — attempts exhausted" : " — will retry"),
    );
    return { kind: cls, final: isFinalAttempt };
  } catch (err) {
    deps.logError(`reminder job crashed (attempt ${claim.attempt}/${MAX_ATTEMPTS}) for work ${cycle.workId}`, err);
    await deps.markDone(key, {
      status: "failed", workId: cycle.workId, cycleStartAt: cycle.cycleStartAt, attemptNumber,
      reason: "crashed", attempt_count: claim.attempt, lastAttemptAt: nowIso,
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
    throw err;
  }
}
