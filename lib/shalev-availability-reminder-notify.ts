import "server-only";
import { supabase } from "@/lib/supabase";
import { sendPushToRoles } from "@/lib/push";
import { getAvailability } from "@/lib/red-artists/availability";
import { SHALEV_SLUG } from "@/lib/red-artists/portal-registry";
import {
  REMINDER_SLOTS,
  processAvailabilityReminderSlot,
  decideClaimAction,
  type ClaimValue,
  type ClaimResult,
  type AvailabilityReminderDeps,
  type MinimalAvailability,
} from "@/lib/shalev-availability-reminder-pure";

export {
  TZ,
  activeCycle,
  activeCycleThursday,
  isSlotDue,
  reminderClaimKey,
  hasValidSubmissionForCycle,
  countValidDays,
  REMINDER_SLOTS,
} from "@/lib/shalev-availability-reminder-pure";

/**
 * Weekly availability-reminder cycle for Shalev — up to 3 conditional pushes
 * (Thu 12:00 / Thu 18:00 / Fri 09:00, Asia/Jerusalem), server-side cron only
 * (see instrumentation.ts). Never triggered by page load/refresh/client code,
 * never calls this on a GET, never runs outside production.
 *
 * "Already submitted" source: lib/red-artists/availability.ts's EXISTING
 * single-record settings store (shalev_weekly_availability) — no schema
 * change. A submission counts for the active cycle iff its `sentAt` is at/
 * after that cycle's own Thursday-08:00 instant AND it has ≥2 distinct valid
 * days (lib/shalev-availability-reminder-pure.ts's
 * hasValidSubmissionForCycle) — checked BEFORE any claim/DB write, so a
 * cycle that's already satisfied never touches the claim row for its
 * remaining slots at all.
 *
 * Idempotency + retry: the existing `settings` key/value table, key =
 * availability_reminder:{slug}:{cycleWeekStart}:{slotId} — the EXACT same
 * INSERT-first-claim + CAS-retry-claim protocol as
 * lib/shalev-session-reminder-notify.ts / lib/shalev-weekly-notify.ts
 * (verified against this project's real Postgres/PostgREST setup — 8/8
 * concurrent-race rounds each produced exactly one winner).
 *
 * Recipient: Shalev only (role "shalev"). Per the explicit scope for this
 * feature, NO owner push is sent here (no ack, no fail notice) — the
 * existing owner-confirmation-on-send push in availability.ts's
 * notifyAvailability() is untouched and unrelated to this reminder cycle.
 */

const DEEP_LINK = "/red-artists?tab=schedule&focus=availability";

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

async function fetchStoredReal(): Promise<MinimalAvailability | null> {
  const stored = await getAvailability(SHALEV_SLUG);
  if (!stored) return null;
  return { days: stored.days.map((d) => ({ available: d.available, from: d.from })), sentAt: stored.sentAt };
}

// ── Claim / retry state machine (real Supabase wiring — identical shape to
//    the two sibling jobs' claimReal). ──────────────────────────────────────
async function claimReal(key: string, now: Date): Promise<ClaimResult> {
  const nowIso = now.toISOString();

  const first: ClaimValue = { status: "processing", attempt_count: 1, lastAttemptAt: nowIso };
  const { error: insertErr } = await supabase.from("settings").insert({ key, value: first });
  if (!insertErr) return { claimed: true, attempt: 1 };
  if (insertErr.code !== "23505") {
    console.error(`[shalev-availability-reminder] claim insert failed: ${insertErr.message}`);
    return { claimed: false, attempt: 0 };
  }

  const { data: row, error: readErr } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  if (readErr || !row) {
    console.error(`[shalev-availability-reminder] claim read failed: ${readErr?.message ?? "row missing"}`);
    return { claimed: false, attempt: 0 };
  }
  const existing = row.value as ClaimValue;
  const decision = decideClaimAction(existing, now);
  if (decision.action !== "cas_update") return { claimed: false, attempt: 0 };

  const nextValue: ClaimValue = { status: "processing", attempt_count: decision.nextAttempt, lastAttemptAt: nowIso };
  const { data: updated, error: updateErr } = await supabase
    .from("settings")
    .update({ value: nextValue })
    .eq("key", key)
    .eq("value", JSON.stringify(existing))
    .select();

  if (updateErr) {
    console.error(`[shalev-availability-reminder] claim retry-update failed: ${updateErr.message}`);
    return { claimed: false, attempt: 0 };
  }
  if (!updated || updated.length === 0) return { claimed: false, attempt: 0 };
  return { claimed: true, attempt: decision.nextAttempt };
}

async function markDoneReal(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("settings").update({ value }).eq("key", key);
  if (error) console.error(`[shalev-availability-reminder] settings update failed: ${error.message}`);
}

const realDeps: AvailabilityReminderDeps = {
  fetchStored: fetchStoredReal,
  claim: claimReal,
  markDone: markDoneReal,
  sendToShalev: async (payload) =>
    (await sendPushToRoles(["shalev"], { ...payload, url: DEEP_LINK })) as unknown as { status: string }[],
  log: (m) => console.log(`[shalev-availability-reminder] ${m}`),
  logError: (m, err) => console.error(`[shalev-availability-reminder] ${m}`, err ?? ""),
};

/** Production entrypoint — called every minute from instrumentation.ts. Checks
 *  all 3 slots (only the one whose window is currently open, if any, does
 *  real work). Skipped entirely (no DB writes, no push) outside production. */
export async function runShalevAvailabilityReminderTick(now: Date = new Date()): Promise<void> {
  if (!pushAllowed()) return;
  for (const slot of REMINDER_SLOTS) {
    await processAvailabilityReminderSlot(now, SHALEV_SLUG, slot, realDeps).catch((e) =>
      console.error(`[shalev-availability-reminder] slot ${slot.id} processing threw:`, e),
    );
  }
}
