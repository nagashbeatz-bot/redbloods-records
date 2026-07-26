/**
 * Standalone smoke test for lib/shalev-session-reminder-pure.ts (the pure
 * decision logic behind lib/shalev-session-reminder-notify.ts).
 *
 * Run with:   npx tsx scripts/test-shalev-session-reminder.ts
 *
 * Imports ONLY from shalev-session-reminder-pure.ts (and the already-tested
 * shalev-weekly-pure.ts constants it re-exports), which has no
 * "server-only"/Supabase/push dependency. No real Supabase writes, no real
 * push anywhere in this file.
 */
import {
  mapReminderSessionRows,
  zonedTimeToUtc,
  isReminderDue,
  reminderClaimKey,
  decideClaimAction,
  buildShalevReminderPush,
  buildOwnerAckPush,
  processSessionReminderCore,
  MAX_ATTEMPTS,
  STUCK_PROCESSING_TIMEOUT_MS,
  REMINDER_HOURS_BEFORE,
  type ClaimValue,
  type ClaimResult,
  type ReminderDeps,
  type ShalevReminderSession,
} from "../lib/shalev-session-reminder-pure";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ── A fake claim store that literally calls the real pure decideClaimAction,
//    so this exercises the actual production decision logic end to end. ──
function makeFakeClaimStore() {
  const store = new Map<string, ClaimValue>();
  return {
    claim: async (key: string, now: Date): Promise<ClaimResult> => {
      const existing = store.get(key) ?? null;
      const decision = decideClaimAction(existing, now);
      if (decision.action === "skip") return { claimed: false, attempt: 0 };
      const attempt = decision.action === "insert" ? 1 : decision.nextAttempt;
      store.set(key, { status: "processing", attempt_count: attempt, lastAttemptAt: now.toISOString() });
      return { claimed: true, attempt };
    },
    markDone: async (key: string, value: Record<string, unknown>) => {
      store.set(key, value as unknown as ClaimValue);
    },
    peek: (key: string) => store.get(key) ?? null,
  };
}

async function main() {
  console.log("\n—— mapReminderSessionRows ——");
  {
    const rows = mapReminderSessionRows([
      { id: "a", date: "2026-07-27", start_time: "18:00:00", status: "מתוכנן" },
      { id: "b", date: "2026-07-27", start_time: "19:00:00", status: "בוטל" },
      { id: "c", date: null, start_time: "19:00:00", status: "מתוכנן" },
      { id: "d", date: "2026-07-27", start_time: null, status: "מתוכנן" },
    ]);
    check("cancelled session excluded", !rows.some((r) => r.id === "b"));
    check("dateless session excluded", !rows.some((r) => r.id === "c"));
    check("timeless session excluded", !rows.some((r) => r.id === "d"));
    check("valid session kept, time truncated to HH:mm", rows.length === 1 && rows[0].id === "a" && rows[0].startTime === "18:00");
  }

  console.log("—— zonedTimeToUtc + isReminderDue ——");
  {
    // Israel is UTC+3 in July (DST/IDT) — 18:00 Asia/Jerusalem == 15:00 UTC.
    const startUtc = zonedTimeToUtc("2026-07-27", "18:00", "Asia/Jerusalem");
    check("18:00 Asia/Jerusalem (summer) == 15:00 UTC", startUtc.toISOString() === "2026-07-27T15:00:00.000Z", startUtc.toISOString());

    check("REMINDER_HOURS_BEFORE is 3", REMINDER_HOURS_BEFORE === 3);

    const exactlyAtReminder = new Date(startUtc.getTime() - 3 * 3600000);
    check("due exactly at T-3h", isReminderDue(exactlyAtReminder, startUtc));

    const oneMinuteBeforeWindow = new Date(startUtc.getTime() - 3 * 3600000 - 60000);
    check("NOT due 1 minute before the T-3h window opens", !isReminderDue(oneMinuteBeforeWindow, startUtc));

    const midWindow = new Date(startUtc.getTime() - 90 * 60000);
    check("due mid-window (T-1.5h)", isReminderDue(midWindow, startUtc));

    const atStart = startUtc;
    check("NOT due at the session's own start time", !isReminderDue(atStart, startUtc));

    const afterStart = new Date(startUtc.getTime() + 60000);
    check("NOT due after the session has started (long catch-up gap)", !isReminderDue(afterStart, startUtc));
  }

  console.log("—— reminderClaimKey (reschedule handling) ——");
  {
    const k1 = reminderClaimKey("sess-1", "2026-07-27", "18:00");
    const k2 = reminderClaimKey("sess-1", "2026-07-27", "20:00");
    check("same session, different time → different key", k1 !== k2);
    check("key is stable for the same inputs", reminderClaimKey("sess-1", "2026-07-27", "18:00") === k1);
  }

  console.log("—— decideClaimAction state machine ——");
  {
    const now = new Date("2026-07-27T12:00:00.000Z");
    check("no existing row → insert", decideClaimAction(null, now).action === "insert");

    const sent: ClaimValue = { status: "sent", attempt_count: 1, lastAttemptAt: now.toISOString() };
    check("already sent → skip (terminal)", decideClaimAction(sent, now).action === "skip");

    const freshProcessing: ClaimValue = { status: "processing", attempt_count: 1, lastAttemptAt: now.toISOString() };
    check("fresh processing → skip (may be in flight)", decideClaimAction(freshProcessing, now).action === "skip");

    const stuckProcessing: ClaimValue = {
      status: "processing", attempt_count: 1,
      lastAttemptAt: new Date(now.getTime() - STUCK_PROCESSING_TIMEOUT_MS - 1000).toISOString(),
    };
    const stuckDecision = decideClaimAction(stuckProcessing, now);
    check("stuck processing (crashed) → cas_update retry", stuckDecision.action === "cas_update" && stuckDecision.action === "cas_update" && stuckDecision.nextAttempt === 2);

    const stuckExhausted: ClaimValue = {
      status: "processing", attempt_count: MAX_ATTEMPTS,
      lastAttemptAt: new Date(now.getTime() - STUCK_PROCESSING_TIMEOUT_MS - 1000).toISOString(),
    };
    check("stuck processing but attempts exhausted → skip", decideClaimAction(stuckExhausted, now).action === "skip");

    const failedRetryable: ClaimValue = { status: "failed", attempt_count: 1, lastAttemptAt: now.toISOString() };
    const failedDecision = decideClaimAction(failedRetryable, now);
    check("failed, attempts remain → cas_update retry", failedDecision.action === "cas_update");

    const failedExhausted: ClaimValue = { status: "failed", attempt_count: MAX_ATTEMPTS, lastAttemptAt: now.toISOString() };
    check("failed, attempts exhausted → skip", decideClaimAction(failedExhausted, now).action === "skip");
  }

  console.log("—— message text (no project/song/notes leak) ——");
  {
    const shalev = buildShalevReminderPush("18:00");
    check("Shalev title exact", shalev.title === "תזכורת לסשן 🎙️");
    check("Shalev body exact, only startTime varies", shalev.body === "היום יש לך סשן בשעה 18:00 🔥");

    const ack = buildOwnerAckPush("18:00");
    check("owner ack title exact", ack.title === "התזכורת נשלחה לשליו ✅");
    check("owner ack body exact", ack.body === "תזכורת לסשן היום בשעה 18:00 נשלחה בהצלחה.");
  }

  console.log("—— processSessionReminderCore orchestration ——");
  {
    const session: ShalevReminderSession = { id: "sess-1", date: "2026-07-27", startTime: "18:00" };
    const now = new Date("2026-07-27T13:00:00.000Z");
    const store = makeFakeClaimStore();
    let shalevSends = 0, ownerAcks = 0;
    const deps: ReminderDeps = {
      claim: store.claim,
      markDone: store.markDone,
      sendToShalev: async () => { shalevSends++; return [{ status: "fulfilled" }]; },
      sendOwnerAck: async () => { ownerAcks++; },
      log: () => {}, logError: () => {},
    };

    const first = await processSessionReminderCore(session, now, deps);
    check("first run: sent", first.kind === "sent");
    check("first run: sent exactly one push to Shalev", shalevSends === 1);
    check("first run: exactly one owner ack", ownerAcks === 1);

    // 2) Immediate second call (simulating the very next cron minute) → no duplicate.
    const second = await processSessionReminderCore(session, now, deps);
    check("second run (already sent): skipped_duplicate", second.kind === "skipped_duplicate");
    check("no additional push sent on duplicate tick", shalevSends === 1);
    check("no additional owner ack on duplicate tick", ownerAcks === 1);

    // 3) Rescheduled session (new start time) → fresh key, sends again.
    const rescheduled: ShalevReminderSession = { id: "sess-1", date: "2026-07-27", startTime: "20:00" };
    const third = await processSessionReminderCore(rescheduled, now, deps);
    check("rescheduled session: sends again under the new time", third.kind === "sent" && shalevSends === 2);
    check("rescheduled session: owner acked again", ownerAcks === 2);
  }

  {
    // 4) Retry-after-failure: a failed send is retried and eventually succeeds.
    const session: ShalevReminderSession = { id: "sess-2", date: "2026-07-27", startTime: "09:00" };
    const store = makeFakeClaimStore();
    let attempts = 0, shalevSends = 0, ownerAcks = 0;
    const deps: ReminderDeps = {
      claim: store.claim,
      markDone: store.markDone,
      sendToShalev: async () => {
        attempts++;
        shalevSends++;
        return attempts < 2 ? [] /* no_subscription → send_failed classification */ : [{ status: "fulfilled" }];
      },
      sendOwnerAck: async () => { ownerAcks++; },
      log: () => {}, logError: () => {},
    };

    const now1 = new Date("2026-07-27T05:00:00.000Z");
    const attempt1 = await processSessionReminderCore(session, now1, deps);
    check("attempt 1 fails (no_subscription)", attempt1.kind === "no_subscription" && !("final" in attempt1 && attempt1.final));

    // Next tick, well past the stuck-processing timeout for a "failed" retry to be eligible immediately.
    const now2 = new Date(now1.getTime() + 60000);
    const attempt2 = await processSessionReminderCore(session, now2, deps);
    check("attempt 2 (retry) succeeds", attempt2.kind === "sent");
    check("exactly 2 send attempts total, 1 owner ack", shalevSends === 2 && ownerAcks === 1);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
