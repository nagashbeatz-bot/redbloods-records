import "server-only";
import { supabase } from "@/lib/supabase";
import { sendPushToRoles } from "@/lib/push";
import { listSoundEngineerWork, stevenDisplayName } from "@/lib/sound-engineer-store";
import { STEVEN_ENGINEER } from "@/lib/steven-scope";
import {
  runDigestTick,
  type DigestDeps,
  type DigestWork,
  type DigestOutcome,
  type PushPayload,
} from "@/lib/steven-deadline-digest-pure";

/**
 * Steven's daily deadline digest — once a day at 09:00 America/New_York (Steven
 * is in Maryland), summarizing his OPEN sound_engineer_work rows (overdue / due
 * today / due tomorrow) into ONE push to him, then — ONLY on a confirmed
 * successful delivery to Steven — a Hebrew confirmation push to the owner.
 *
 * Server-side cron only (see instrumentation.ts). Never triggered by page
 * load/refresh/client code. State lives entirely in the EXISTING `settings`
 * key/value table — no schema change:
 *   steven_deadline_digest:{YYYY-MM-DD}  → { status: "processing"|"sent"|"failed", ... }
 * (YYYY-MM-DD is always America/New_York — see lib/steven-deadline-digest-pure.ts)
 *
 * This is a DELIBERATE simplification vs. the sibling reminder jobs (steven-mix-
 * reminder / shalev-weekly): those need multi-attempt retry-with-backoff because
 * they must eventually get a message through. This feature only needs "at most
 * one push per calendar day" (explicit spec), so the claim is a single
 * INSERT-first attempt with no CAS-retry/recovery branch — if the process
 * crashes between claimDay and markDayResult (a sub-second window), that one
 * day's digest silently does not go out; no code invents a retry no one asked
 * for. The atomic-claim MECHANISM (INSERT-first, 23505 = already claimed) is
 * the same proven pattern as lib/shalev-weekly-notify.ts / lib/steven-mix-
 * reminder-notify.ts — verified on this project's real Postgres/PostgREST setup.
 */

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

async function hasClaimForTodayReal(key: string): Promise<boolean> {
  const { data, error } = await supabase.from("settings").select("key").eq("key", key).maybeSingle();
  if (error) {
    // Fail OPEN here (treat as "not yet claimed") is wrong — a transient read
    // error must never cause a duplicate send. Fail CLOSED: report as already
    // claimed so this tick backs off; the next tick (next minute, same window)
    // will retry the read.
    console.error(`[steven-deadline-digest] claim read failed: ${error.message}`);
    return true;
  }
  return !!data;
}

async function fetchStevenWorksReal(): Promise<DigestWork[]> {
  const works = await listSoundEngineerWork(STEVEN_ENGINEER);
  return works.map((w) => ({
    id:               w.id,
    displayName:      stevenDisplayName(w),
    internalDeadline: w.internalDeadline,
    status:           w.status,
  }));
}

async function claimDayReal(key: string, now: Date): Promise<boolean> {
  const { error } = await supabase
    .from("settings")
    .insert({ key, value: { status: "processing", claimedAt: now.toISOString() } });
  if (!error) return true;
  if (error.code !== "23505") {
    console.error(`[steven-deadline-digest] claim insert failed: ${error.message}`);
    return false;
  }
  return false; // 23505 — another tick/instance already claimed today (expected, not an error)
}

async function markDayResultReal(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("settings").update({ value }).eq("key", key);
  if (error) console.error(`[steven-deadline-digest] settings update failed: ${error.message}`);
}

async function sendToStevenReal(push: PushPayload): Promise<{ status: string }[]> {
  const results = await sendPushToRoles(["steven"], push);
  return results as unknown as { status: string }[];
}

async function sendToOwnerReal(push: PushPayload): Promise<void> {
  await sendPushToRoles(["owner"], push);
}

const realDeps: DigestDeps = {
  hasClaimForToday: hasClaimForTodayReal,
  fetchStevenWorks: fetchStevenWorksReal,
  claimDay:         claimDayReal,
  markDayResult:    markDayResultReal,
  sendToSteven:     sendToStevenReal,
  sendToOwner:      sendToOwnerReal,
  log:      (m) => console.log(`[steven-deadline-digest] ${m}`),
  logError: (m, err) => console.error(`[steven-deadline-digest] ${m}`, err ?? ""),
};

/** Production entrypoint — called every minute from instrumentation.ts.
 *  Skipped entirely (no DB writes, no push) outside production/local-opt-in. */
export async function runStevenDeadlineDigestTick(
  now: Date = new Date(),
): Promise<DigestOutcome | { kind: "push_not_allowed" }> {
  if (!pushAllowed()) return { kind: "push_not_allowed" };
  return runDigestTick(now, realDeps);
}
