import "server-only";
import { supabase } from "@/lib/supabase";
import { sendPushToRoles } from "@/lib/push";
import { listMixVersions } from "@/lib/mix-versions-store";
import { getSoundEngineerWork, stevenDisplayName } from "@/lib/sound-engineer-store";
import {
  REMINDER_INTERVAL_MS,
  MAX_REMINDERS,
  isClosedStatus,
  cycleStateKey,
  cycleClaimKey,
  buildReminderPush,
  processReminderCycle,
  MAX_ATTEMPTS,
  STUCK_PROCESSING_TIMEOUT_MS,
  decideClaimAction,
  type CycleState,
  type ClaimValue,
  type ClaimResult,
  type ReminderCycleDeps,
  type WorkReminderState,
} from "@/lib/steven-mix-reminder-pure";

export { cycleStateKey, cycleClaimKey, REMINDER_INTERVAL_MS, MAX_REMINDERS };

/**
 * Steven mix-notes reminder — every 5h after the owner clicks "Send notes"
 * (lib/steven-notes-notify.ts, unchanged), for at most MAX_REMINDERS (3)
 * reminders, and only while the work still exists, is neither approved ("אושר")
 * nor cancelled ("בוטל"), and has no newer mix version. Server-side cron only
 * (see instrumentation.ts).
 * Never triggered by page load/refresh/client code, never runs outside
 * production. State lives entirely in the existing `settings` key/value
 * table — no schema change:
 *   steven_mix_reminder_cycle:{workId}                → CycleState (current cycle)
 *   steven_mix_reminder_send:{workId}:{cycleStartAt}:{n} → per-attempt send claim
 *
 * A fresh "Send notes" click always upserts a brand-new cycle (fresh
 * cycleStartAt, remindersSent=0) — this both starts tracking AND supersedes
 * any prior cycle for the same work (its old claim keys, keyed by the OLD
 * cycleStartAt, are simply abandoned).
 */

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

/** Start (or restart) the reminder cycle for a work. Called from
 *  notifyStevenMixNotes() right after its own immediate push — wrapped in
 *  try/catch there so a failure here can never break that send. */
export async function startOrResetReminderCycle(workId: string, cycleStartAt: Date = new Date()): Promise<void> {
  const key = cycleStateKey(workId);
  const value: CycleState = { workId, cycleStartAt: cycleStartAt.toISOString(), remindersSent: 0, lastReminderAt: null };
  const { error } = await supabase.from("settings").upsert({ key, value }, { onConflict: "key" });
  if (error) console.error(`[steven-mix-reminder] failed to start cycle for work ${workId}: ${error.message}`);
}

async function listActiveCycles(): Promise<CycleState[]> {
  const { data, error } = await supabase.from("settings").select("value").like("key", "steven_mix_reminder_cycle:%");
  if (error) {
    console.error(`[steven-mix-reminder] failed to list active cycles: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => r.value as CycleState);
}

/** Both work-level stop conditions in one read. A missing row is the deleted
 *  case — reported as exists:false rather than guessed at, so the caller stops
 *  the cycle instead of sending a push about a work nobody can open.
 *
 *  Deliberately NOT getSoundEngineerWork(): that also builds the whole project
 *  map to resolve a display name, and this runs once per active cycle on every
 *  one-minute tick. Only `status` is needed here — the name is looked up later,
 *  once, and only on a tick that actually sends. A NULL status behaves exactly
 *  as the store's own `?? "לא נשלח"` default would: not completed. */
async function getWorkStateReal(workId: string): Promise<WorkReminderState> {
  const { data, error } = await supabase
    .from("sound_engineer_work")
    .select("status")
    .eq("id", workId)
    .maybeSingle();
  // Fail CLOSED on a read error, exactly as getSoundEngineerWork does: throwing
  // aborts this tick before any send, so a transient failure can neither retire
  // a live cycle nor push a reminder for a work whose status we couldn't read.
  // runStevenMixReminderTick catches per cycle, leaving it intact for next time.
  if (error) throw new Error(`failed to read work ${workId}: ${error.message}`);
  if (!data) return { exists: false, closed: false };
  return { exists: true, closed: isClosedStatus(data.status as string | null) };
}

async function getLatestVersionCreatedAtReal(workId: string): Promise<string | null> {
  const versions = await listMixVersions(workId); // already ordered created_at DESC
  return versions[0]?.createdAt ?? null;
}

async function stopCycleReal(workId: string): Promise<void> {
  const { error } = await supabase.from("settings").delete().eq("key", cycleStateKey(workId));
  if (error) console.error(`[steven-mix-reminder] failed to stop cycle for work ${workId}: ${error.message}`);
}

/** Only ever called by the tick that just won a send claim for this cycle —
 *  a plain read-modify-write is safe (no CAS needed) for the same reason
 *  markDoneReal is a plain update in every sibling reminder job. */
async function updateCycleProgressReal(workId: string, patch: { remindersSent: number; lastReminderAt: string }): Promise<void> {
  const key = cycleStateKey(workId);
  const { data: row } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  if (!row) return; // cycle was stopped/deleted concurrently — nothing to advance
  const value: CycleState = { ...(row.value as CycleState), ...patch };
  const { error } = await supabase.from("settings").update({ value }).eq("key", key);
  if (error) console.error(`[steven-mix-reminder] failed to update cycle progress for work ${workId}: ${error.message}`);
}

async function sendReminderReal(workId: string): Promise<{ status: string }[]> {
  const work = await getSoundEngineerWork(workId);
  // Race guard: the work was deleted between this tick's stop-condition check
  // and now. Send NOTHING — never a push naming a placeholder. [] classifies as
  // "no_subscription", so the cycle does not advance, and the next tick sees
  // exists:false and stops it for good.
  if (!work) {
    console.warn(`[steven-mix-reminder] work ${workId} vanished mid-send — no push`);
    return [];
  }
  const push = buildReminderPush(stevenDisplayName(work));
  const results = await sendPushToRoles(["steven"], {
    ...push,
    url: `/team/steven?work=${workId}`,
    tag: `steven-mix-reminder-${workId}`,
  });
  return results as unknown as { status: string }[];
}

// ── Claim / retry (real Supabase wiring — identical shape to the sibling
//    reminder jobs' claimReal/markDoneReal). ────────────────────────────────
async function claimReal(key: string, now: Date): Promise<ClaimResult> {
  const nowIso = now.toISOString();

  const first: ClaimValue = { status: "processing", attempt_count: 1, lastAttemptAt: nowIso };
  const { error: insertErr } = await supabase.from("settings").insert({ key, value: first });
  if (!insertErr) return { claimed: true, attempt: 1 };
  if (insertErr.code !== "23505") {
    console.error(`[steven-mix-reminder] claim insert failed: ${insertErr.message}`);
    return { claimed: false, attempt: 0 };
  }

  const { data: row, error: readErr } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  if (readErr || !row) {
    console.error(`[steven-mix-reminder] claim read failed: ${readErr?.message ?? "row missing"}`);
    return { claimed: false, attempt: 0 };
  }
  const existing = row.value as ClaimValue;
  const decision = decideClaimAction(existing, now, MAX_ATTEMPTS, STUCK_PROCESSING_TIMEOUT_MS);
  if (decision.action !== "cas_update") return { claimed: false, attempt: 0 };

  const nextValue: ClaimValue = { status: "processing", attempt_count: decision.nextAttempt, lastAttemptAt: nowIso };
  const { data: updated, error: updateErr } = await supabase
    .from("settings")
    .update({ value: nextValue })
    .eq("key", key)
    .eq("value", JSON.stringify(existing))
    .select();

  if (updateErr) {
    console.error(`[steven-mix-reminder] claim retry-update failed: ${updateErr.message}`);
    return { claimed: false, attempt: 0 };
  }
  if (!updated || updated.length === 0) return { claimed: false, attempt: 0 };
  return { claimed: true, attempt: decision.nextAttempt };
}

async function markDoneReal(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("settings").update({ value }).eq("key", key);
  if (error) console.error(`[steven-mix-reminder] settings update failed: ${error.message}`);
}

const realDeps: ReminderCycleDeps = {
  getWorkState: getWorkStateReal,
  getLatestVersionCreatedAt: getLatestVersionCreatedAtReal,
  claim: claimReal,
  markDone: markDoneReal,
  sendReminder: sendReminderReal,
  stopCycle: stopCycleReal,
  updateCycleProgress: updateCycleProgressReal,
  log: (m) => console.log(`[steven-mix-reminder] ${m}`),
  logError: (m, err) => console.error(`[steven-mix-reminder] ${m}`, err ?? ""),
};

/** Production entrypoint — called every minute from instrumentation.ts. Skipped
 *  entirely (no DB writes, no push) outside production. Processes every work
 *  with an active cycle; one work's failure never blocks another's. */
export async function runStevenMixReminderTick(now: Date = new Date()): Promise<void> {
  if (!pushAllowed()) return;
  const cycles = await listActiveCycles();
  for (const cycle of cycles) {
    await processReminderCycle(now, cycle, realDeps).catch((e) =>
      console.error(`[steven-mix-reminder] work ${cycle.workId} processing threw:`, e),
    );
  }
}
