/**
 * Standalone smoke test for lib/steven-mix-reminder-pure.ts (the pure decision
 * logic behind lib/steven-mix-reminder-notify.ts).
 *
 * Run with:   npx tsx scripts/test-steven-mix-reminder.ts
 *
 * Imports ONLY from steven-mix-reminder-pure.ts (and the already-tested
 * shalev-*-pure.ts constants it re-exports), which has no
 * "server-only"/Supabase/push dependency. No real Supabase writes and no real
 * push anywhere in this file. Role scoping (who actually receives the push) is
 * NOT this module's job — it happens one layer up, in sendReminderReal's
 * sendPushToRoles(["steven"], …) — so this file only exercises the decision
 * logic: WHETHER a reminder goes out, and what its text says.
 */
import {
  MAX_REMINDERS,
  MAX_ATTEMPTS,
  REMINDER_INTERVAL_MS,
  COMPLETED_STATUS,
  isCompletedStatus,
  hasReachedReminderCap,
  hasNewerVersion,
  isReminderDue,
  buildReminderPush,
  cycleStateKey,
  cycleClaimKey,
  decideClaimAction,
  processReminderCycle,
  type CycleState,
  type ClaimValue,
  type ClaimResult,
  type ReminderCycleDeps,
  type ReminderOutcome,
  type WorkReminderState,
} from "../lib/steven-mix-reminder-pure";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const HEBREW = /[֐-׿]/;
const T0 = "2026-08-18T09:00:00.000Z";
const WORK = "work-1";
const at = (msFromT0: number) => new Date(Date.parse(T0) + msFromT0);
const HOUR = 60 * 60 * 1000;

/**
 * One work's whole world: cycle row, claim rows, work state, versions — plus a
 * log of every push that would have gone out. Ticking mutates it exactly the
 * way the real Supabase-backed deps do, so a test can run tick-after-tick and
 * assert on the cumulative effect.
 */
function makeWorld(init: {
  remindersSent?: number;
  lastReminderAt?: string | null;
  work?: WorkReminderState;
  latestVersionCreatedAt?: string | null;
  sendResult?: { status: string }[];
}) {
  const claims = new Map<string, ClaimValue>();
  const world = {
    cycle: {
      workId: WORK,
      cycleStartAt: T0,
      remindersSent: init.remindersSent ?? 0,
      lastReminderAt: init.lastReminderAt ?? null,
    } as CycleState | null,
    work: init.work ?? { exists: true, completed: false },
    latestVersionCreatedAt: init.latestVersionCreatedAt ?? null,
    sendResult: init.sendResult ?? [{ status: "fulfilled" }],
    pushes: [] as string[],   // one entry per push actually sent
    stops: 0,
    claims,
  };

  const deps: ReminderCycleDeps = {
    getWorkState: async () => world.work,
    getLatestVersionCreatedAt: async () => world.latestVersionCreatedAt,
    claim: async (key: string, now: Date): Promise<ClaimResult> => {
      const existing = claims.get(key) ?? null;
      const decision = decideClaimAction(existing, now, MAX_ATTEMPTS);
      if (decision.action === "skip") return { claimed: false, attempt: 0 };
      const attempt = decision.action === "insert" ? 1 : decision.nextAttempt;
      claims.set(key, { status: "processing", attempt_count: attempt, lastAttemptAt: now.toISOString() });
      return { claimed: true, attempt };
    },
    markDone: async (key, value) => { claims.set(key, value as unknown as ClaimValue); },
    sendReminder: async (workId) => {
      // Mirrors sendReminderReal: a work that is gone yields NO push at all.
      if (!world.work.exists) return [];
      world.pushes.push(workId);
      return world.sendResult;
    },
    stopCycle: async () => { world.stops++; world.cycle = null; },
    updateCycleProgress: async (_id, patch) => {
      if (!world.cycle) return;
      world.cycle = { ...world.cycle, ...patch };
    },
    log: () => {},
    logError: () => {},
  };

  /** One cron tick. Throws if the cycle is already gone — a retired cycle is no
   *  longer listed by listActiveCycles, so the real job never ticks it again;
   *  tests assert that with `world.cycle === null`, not by ticking. */
  const tick = async (now: Date): Promise<ReminderOutcome> => {
    if (!world.cycle) throw new Error("tick() called on an already-stopped cycle");
    return processReminderCycle(now, world.cycle, deps);
  };

  return { world, deps, tick };
}

async function main() {
  console.log("\n—— 1. Steven's push text is English only ——");
  {
    const p = buildReminderPush("MORAD");
    check("title has no Hebrew", !HEBREW.test(p.title), p.title);
    check("body has no Hebrew", !HEBREW.test(p.body), p.body);
    check("title is the agreed copy", p.title === "Mix notes reminder", p.title);
    check("body names the work and asks for a new version",
      p.body === "You still have pending notes for MORAD. Please upload an updated version.", p.body);
    // The old Hebrew copy must be gone for good.
    check("no trace of the old Hebrew title", !p.title.includes("תזכורת"));
  }

  console.log("\n—— 2/3/4. Reminders 1–3 fire on the 5h interval, #4 never does ——");
  {
    const { world, tick } = makeWorld({});

    check("not due before +5h", (await tick(at(4 * HOUR + 59 * 60 * 1000))).kind === "not_due");
    check("no push yet", world.pushes.length === 0);

    check("reminder #1 sends at exactly +5h", (await tick(at(5 * HOUR))).kind === "sent");
    check("  → 1 push so far", world.pushes.length === 1);
    check("  → cycle advanced to remindersSent=1", world.cycle?.remindersSent === 1);

    // Cadence counts from the ACTUAL send instant, not a fixed grid.
    check("not due again 4h after reminder #1", (await tick(at(9 * HOUR))).kind === "not_due");
    check("reminder #2 sends 5h after #1", (await tick(at(10 * HOUR))).kind === "sent");
    check("  → 2 pushes", world.pushes.length === 2);

    check("reminder #3 sends 5h after #2", (await tick(at(15 * HOUR))).kind === "sent");
    check("  → 3 pushes", world.pushes.length === 3);
    check("  → cycle still alive right after #3", world.cycle !== null);
    check("  → but it is now at the cap", world.cycle !== null && hasReachedReminderCap(world.cycle));

    // The tick that would have produced #4 retires the cycle instead.
    const fourth = await tick(at(20 * HOUR));
    check("reminder #4 is never sent — cycle stops instead", fourth.kind === "cap_reached_stopped");
    check("  → still exactly 3 pushes", world.pushes.length === 3, `got ${world.pushes.length}`);
    check("  → stopCycle called once", world.stops === 1);
    check("  → the cycle row is gone, so no later tick ever sees it again", world.cycle === null);
    check("MAX_REMINDERS is 3", MAX_REMINDERS === 3);
  }

  console.log("\n—— 5. A cycle already past the cap in production retires on the next tick ——");
  {
    // Written by the previous build, which had no cap at all.
    const { world, tick } = makeWorld({ remindersSent: 7, lastReminderAt: at(35 * HOUR).toISOString() });
    const out = await tick(at(40 * HOUR)); // long past due — would have sent before
    check("stops on the very next tick", out.kind === "cap_reached_stopped");
    check("  → NO push sent", world.pushes.length === 0);
    check("  → the only write is stopCycle (its own settings row)", world.stops === 1);
  }
  {
    // …and it does not even wait for a due window.
    const { world, tick } = makeWorld({ remindersSent: 3, lastReminderAt: at(1 * HOUR).toISOString() });
    const out = await tick(at(2 * HOUR)); // nowhere near due
    check("capped cycle stops even when NOT due (no lingering)", out.kind === "cap_reached_stopped");
    check("  → no push", world.pushes.length === 0);
  }

  console.log("\n—— 6. The original stop condition — a newer mix version ——");
  {
    const { world, tick } = makeWorld({ latestVersionCreatedAt: at(1 * HOUR).toISOString() });
    const out = await tick(at(5 * HOUR));
    check("newer version stops the cycle", out.kind === "resolved_stopped");
    check("  → no push", world.pushes.length === 0);
    check("hasNewerVersion: strictly after cycleStartAt", hasNewerVersion(T0, at(1).toISOString()));
    check("hasNewerVersion: a version at exactly cycleStartAt does NOT count", !hasNewerVersion(T0, T0));
    check("hasNewerVersion: an older version does NOT count", !hasNewerVersion(T0, at(-1 * HOUR).toISOString()));
    check("hasNewerVersion: no versions at all", !hasNewerVersion(T0, null));
  }
  {
    // Mid-cycle upload: reminder #1 went out, then Steven delivered.
    const { world, tick } = makeWorld({});
    await tick(at(5 * HOUR));
    check("reminder #1 sent", world.pushes.length === 1);
    world.latestVersionCreatedAt = at(6 * HOUR).toISOString();
    const out = await tick(at(10 * HOUR));
    check("upload after #1 stops the cycle", out.kind === "resolved_stopped");
    check("  → no reminder #2", world.pushes.length === 1);
  }

  console.log("\n—— 7. Deleted work ——");
  {
    const { world, tick } = makeWorld({ work: { exists: false, completed: false } });
    const out = await tick(at(5 * HOUR)); // due — would have sent before
    check("missing work stops the cycle", out.kind === "work_missing_stopped");
    check("  → NO push", world.pushes.length === 0);
    check("  → the send path was never reached, so no placeholder name", world.pushes.length === 0);
    check("  → stopCycle called once, nothing else touched", world.stops === 1);
  }
  {
    // Deleted between two ticks, mid-cycle.
    const { world, tick } = makeWorld({});
    await tick(at(5 * HOUR));
    world.work = { exists: false, completed: false };
    const out = await tick(at(10 * HOUR));
    check("work deleted mid-cycle stops it on the next tick", out.kind === "work_missing_stopped");
    check("  → no further push", world.pushes.length === 1);
  }

  console.log("\n—— 8/9/10. Completed work — the DB value is \"אושר\", the UI label is \"הושלם\" ——");
  {
    check(`COMPLETED_STATUS is the DB value "${COMPLETED_STATUS}"`, COMPLETED_STATUS === "אושר");
    check('isCompletedStatus("אושר") → true', isCompletedStatus("אושר"));
    check('isCompletedStatus("הושלם") → false (UI label, never stored)', !isCompletedStatus("הושלם"));
    for (const s of ["לא נשלח", "נשלח", "בתהליך", "חזר", "בוטל"]) {
      check(`isCompletedStatus("${s}") → false`, !isCompletedStatus(s));
    }
    check("isCompletedStatus(null) → false", !isCompletedStatus(null));
  }
  {
    // 8. Active work flips to completed mid-cycle.
    const { world, tick } = makeWorld({});
    await tick(at(5 * HOUR));
    check("reminder #1 went out while active", world.pushes.length === 1);
    world.work = { exists: true, completed: true };
    const out = await tick(at(10 * HOUR));
    check("completion stops the cycle on the NEXT tick", out.kind === "work_completed_stopped");
    check("  → no reminder #2", world.pushes.length === 1);
    check("  → stopCycle called once", world.stops === 1);
  }
  {
    // 9. Already completed before the first reminder was ever due.
    const { world, tick } = makeWorld({ work: { exists: true, completed: true } });
    check("a not-yet-due tick already stops it", (await tick(at(1 * HOUR))).kind === "work_completed_stopped");
    check("  → NO push, ever", world.pushes.length === 0);
    check("  → stopped", world.cycle === null);
  }
  {
    // 10. Completed + pending notes + NO newer version — completion outranks both.
    const { world, tick } = makeWorld({ work: { exists: true, completed: true }, latestVersionCreatedAt: null });
    const out = await tick(at(5 * HOUR)); // past due, no version uploaded
    check("completed wins over 'notes pending, no new version'", out.kind === "work_completed_stopped");
    check("  → no push", world.pushes.length === 0);
  }

  console.log("\n—— 11. An ordinary active work is untouched by all of this ——");
  {
    const { world, tick } = makeWorld({ work: { exists: true, completed: false } });
    check("still not due at +4h", (await tick(at(4 * HOUR))).kind === "not_due");
    check("still sends at +5h", (await tick(at(5 * HOUR))).kind === "sent");
    check("  → push went out", world.pushes.length === 1);
    check("interval is still 5h", REMINDER_INTERVAL_MS === 5 * HOUR);
    check("isReminderDue: first reminder counts from cycleStartAt",
      isReminderDue(at(5 * HOUR), { workId: WORK, cycleStartAt: T0, remindersSent: 0, lastReminderAt: null }));
    check("isReminderDue: later reminders count from lastReminderAt, not a fixed grid",
      !isReminderDue(at(10 * HOUR), { workId: WORK, cycleStartAt: T0, remindersSent: 1, lastReminderAt: at(6 * HOUR).toISOString() }) &&
      isReminderDue(at(11 * HOUR), { workId: WORK, cycleStartAt: T0, remindersSent: 1, lastReminderAt: at(6 * HOUR).toISOString() }));
  }

  console.log("\n—— 12. The existing atomic claim / dedup is intact ——");
  {
    // Two overlapping ticks (two cron instances) at the same due instant.
    const { world, deps } = makeWorld({});
    const cycle = world.cycle as CycleState;
    const [a, b] = await Promise.all([
      processReminderCycle(at(5 * HOUR), cycle, deps),
      processReminderCycle(at(5 * HOUR), cycle, deps),
    ]);
    const kinds = [a.kind, b.kind].sort().join("+");
    check("exactly one tick sends, the other is deduped", kinds === "sent+skipped_duplicate", kinds);
    check("  → exactly ONE push", world.pushes.length === 1, `got ${world.pushes.length}`);

    check("claim key is per (work, cycle, attempt#)",
      cycleClaimKey(WORK, T0, 1) === `steven_mix_reminder_send:${WORK}:${T0}:1`);
    check("cycle key unchanged", cycleStateKey(WORK) === `steven_mix_reminder_cycle:${WORK}`);
    check("a 'sent' claim is never re-claimed",
      decideClaimAction({ status: "sent", attempt_count: 1, lastAttemptAt: T0 }, at(99 * HOUR)).action === "skip");
    check("a failed claim retries up to MAX_ATTEMPTS",
      decideClaimAction({ status: "failed", attempt_count: 1, lastAttemptAt: T0 }, at(1)).action === "cas_update" &&
      decideClaimAction({ status: "failed", attempt_count: MAX_ATTEMPTS, lastAttemptAt: T0 }, at(1)).action === "skip");
  }
  {
    // A failed send must not advance the cycle (so it can't skip a reminder).
    const { world, tick } = makeWorld({ sendResult: [{ status: "rejected" }] });
    const out = await tick(at(5 * HOUR));
    check("a failed send does not advance remindersSent", out.kind === "send_failed" && world.cycle?.remindersSent === 0);
  }

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
