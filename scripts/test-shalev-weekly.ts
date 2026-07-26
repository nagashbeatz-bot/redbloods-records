/**
 * Standalone smoke test for lib/shalev-weekly-pure.ts (the pure decision logic
 * behind lib/shalev-weekly-notify.ts).
 *
 * Run with:   npx tsx scripts/test-shalev-weekly.ts
 *
 * Imports ONLY from shalev-weekly-pure.ts, which has no "server-only"/Supabase/
 * push dependency (server-only throws unconditionally outside Next's bundler).
 * No real Supabase writes, no real push anywhere in this file.
 *
 * NOTE on the CAS retry-claim's actual concurrency safety: the real
 * `.eq("value", JSON.stringify(old))` compare-and-swap used in
 * lib/shalev-weekly-notify.ts's claimWeekReal was separately verified against
 * this project's real Postgres/PostgREST instance with a throwaway settings key
 * (8/8 rounds of 3 truly-concurrent UPDATEs each produced exactly one winner)
 * before being relied on — that check needed a live DB round-trip so it isn't
 * part of this script. What IS tested here, with a fake in-memory claim store
 * that mirrors claimWeekReal's exact state machine, is the PROTOCOL: which
 * states allow a retry, how attempt_count and the "final attempt" decision
 * drive owner notifications, etc.
 */
import {
  computeWeekRange,
  isShalevWeeklyWindowOpen,
  buildShalevBody,
  buildOwnerAckBody,
  mapSessionRows,
  classifyPushResult,
  runShalevWeeklySessionsJobCore,
  MAX_ATTEMPTS,
  STUCK_PROCESSING_TIMEOUT_MS,
  type ShalevSessionInfo,
  type JobDeps,
  type ClaimResult,
} from "../lib/shalev-weekly-pure";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

function ymdOffset(base: string, n: number): string {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function fakeRow(id: string, date: string, startTime: string | null, sessionType: string | null, title: string | null, status: string | null = null) {
  return { id, title, date, start_time: startTime, end_time: null, session_type: sessionType, status };
}

/** Mirrors claimWeekReal's exact decision logic in-memory (no DB), so the
 *  orchestrator's use of the claim protocol can be exercised deterministically
 *  across a SEQUENCE of ticks (simulating several cron minutes in the window). */
function makeFakeClaimStore() {
  let stored: { status: string; attempt_count: number; lastAttemptAt: string } | null = null;
  return {
    claimWeek: async (_key: string, now: Date): Promise<ClaimResult> => {
      if (!stored) {
        stored = { status: "processing", attempt_count: 1, lastAttemptAt: now.toISOString() };
        return { claimed: true, attempt: 1 };
      }
      if (stored.status === "sent" || stored.status === "no_sessions") return { claimed: false, attempt: 0 };
      if (stored.status === "processing") {
        const age = now.getTime() - new Date(stored.lastAttemptAt).getTime();
        if (!(age > STUCK_PROCESSING_TIMEOUT_MS)) return { claimed: false, attempt: 0 };
        if (stored.attempt_count >= MAX_ATTEMPTS) return { claimed: false, attempt: 0 };
      } else if (stored.status === "failed") {
        if (stored.attempt_count >= MAX_ATTEMPTS) return { claimed: false, attempt: 0 };
      } else {
        return { claimed: false, attempt: 0 };
      }
      const next = stored.attempt_count + 1;
      stored = { status: "processing", attempt_count: next, lastAttemptAt: now.toISOString() };
      return { claimed: true, attempt: next };
    },
    markWeekDone: async (_key: string, value: Record<string, unknown>) => {
      stored = {
        status: value.status as string,
        attempt_count: (value.attempt_count as number) ?? stored?.attempt_count ?? 0,
        lastAttemptAt: (value.lastAttemptAt as string) ?? new Date().toISOString(),
      };
    },
    peek: () => stored,
    setRaw: (v: { status: string; attempt_count: number; lastAttemptAt: string }) => { stored = v; },
  };
}

function noopDeps(overrides: Partial<JobDeps>): JobDeps {
  return {
    fetchSessions: async () => [],
    claimWeek: async () => ({ claimed: true, attempt: 1 }),
    markWeekDone: async () => {},
    sendToShalev: async () => [{ status: "fulfilled" }],
    sendOwnerAck: async () => {},
    sendOwnerFail: async () => {},
    log: () => {},
    logError: () => {},
    ...overrides,
  };
}

async function main() {
  console.log("\n[1] computeWeekRange — Asia/Jerusalem, DST-safe");
  {
    const now = new Date();
    const { weekStart, weekEnd } = computeWeekRange(now);
    check("weekStart is a Sunday", new Date(weekStart + "T00:00:00Z").getUTCDay() === 0, weekStart);
    check("weekEnd is exactly 6 days after weekStart", weekEnd === ymdOffset(weekStart, 6), `${weekStart}..${weekEnd}`);
    const acrossDst = computeWeekRange(new Date("2026-10-27T09:00:00Z"));
    check("a date across the Oct DST boundary still resolves to a Sunday",
      new Date(acrossDst.weekStart + "T00:00:00Z").getUTCDay() === 0, acrossDst.weekStart);
  }

  const { weekStart: sunday } = computeWeekRange(new Date());
  const monday = ymdOffset(sunday, 1);
  const thursday = ymdOffset(sunday, 4);
  // The exact UTC instants for 09:59 / 10:00 / 10:05 / 10:15 / 10:16 Israel time
  // on THIS week's real Sunday — tries both DST offsets so the test is robust
  // year-round without hardcoding which offset is currently active.
  function israelTimeOn(ymd: string, hh: number, mm: number): Date | null {
    const [y, m, d] = ymd.split("-").map(Number);
    for (const utcOffsetHours of [2, 3]) {
      const candidate = new Date(Date.UTC(y, m - 1, d, hh - utcOffsetHours, mm));
      const localHM = candidate.toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false });
      if (localHM === `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`) return candidate;
    }
    return null;
  }

  console.log("\n[2] isShalevWeeklyWindowOpen — 10:00–10:15 window, not a single minute");
  {
    const t0959 = israelTimeOn(sunday, 9, 59)!;
    const t1000 = israelTimeOn(sunday, 10, 0)!;
    const t1005 = israelTimeOn(sunday, 10, 5)!;
    const t1015 = israelTimeOn(sunday, 10, 15)!;
    const t1016 = israelTimeOn(sunday, 10, 16)!;
    check("09:59 is NOT due", !isShalevWeeklyWindowOpen(t0959));
    check("10:00 IS due", isShalevWeeklyWindowOpen(t1000));
    check("10:05 IS due (a missed 10:00 tick can still fire)", isShalevWeeklyWindowOpen(t1005));
    check("10:15 IS due (inclusive end of window)", isShalevWeeklyWindowOpen(t1015));
    check("10:16 is NOT due (past the window)", !isShalevWeeklyWindowOpen(t1016));
    check("a weekday at 10:05 is NOT due (must be Sunday)", !isShalevWeeklyWindowOpen(israelTimeOn(monday, 10, 5)!));
  }

  console.log("\n[3] buildShalevBody — multiple sessions (session-only titles)");
  {
    const sessions: ShalevSessionInfo[] = [
      { id: "1", date: monday, startTime: "18:00", endTime: null, title: "הקלטת שיר" },
      { id: "2", date: thursday, startTime: "20:00", endTime: null, title: "סשן כתיבה" },
    ];
    const body = buildShalevBody(sessions);
    check("intro uses plural + count", body.startsWith("השבוע מחכים לך 2 סשנים:"), body);
    check("first line matches format", body.includes("יום שני ב־18:00 — הקלטת שיר"), body);
    check("second line matches format", body.includes("יום חמישי ב־20:00 — סשן כתיבה"), body);
  }

  console.log("\n[4] buildShalevBody — single session (singular form)");
  {
    const sessions: ShalevSessionInfo[] = [{ id: "1", date: monday, startTime: "18:00", endTime: null, title: "הקלטת שיר" }];
    const body = buildShalevBody(sessions);
    check("exact match", body === "השבוע מחכה לך סשן אחד:\nיום שני ב־18:00 — הקלטת שיר", body);
  }

  console.log("\n[5] mapSessionRows — session_type takes priority over title");
  {
    const mapped = mapSessionRows([fakeRow("1", monday, "18:00", "הקלטה", "כותרת שונה לגמרי")]);
    check("session_type wins when both are present", mapped[0].title === "הקלטה", mapped[0].title);
  }

  console.log("\n[6] mapSessionRows — falls back to title only when session_type is empty");
  {
    const mapped = mapSessionRows([fakeRow("1", monday, "18:00", null, "כותרת הסשן")]);
    check("title used when session_type is null", mapped[0].title === "כותרת הסשן", mapped[0].title);
    const mapped2 = mapSessionRows([fakeRow("2", monday, "18:00", "", "כותרת הסשן")]);
    check("title used when session_type is empty string", mapped2[0].title === "כותרת הסשן", mapped2[0].title);
  }

  console.log("\n[7] mapSessionRows — no session_type AND no title → literal \"סשן\"");
  {
    const mapped = mapSessionRows([fakeRow("1", monday, "18:00", null, null)]);
    check("falls back to the literal word סשן", mapped[0].title === "סשן", mapped[0].title);
  }

  console.log("\n[8] mapSessionRows — a project name can NEVER appear (structural: no project param exists)");
  {
    // mapSessionRows's signature takes ONLY session rows — there is no project
    // name parameter to pass one in even by mistake. This reproduces the exact
    // production row that leaked "חלהס אמפיאנו" (a project name) before the fix:
    // title=null, session_type="סשן" — must resolve to the session_type value,
    // never anything project-derived.
    const mapped = mapSessionRows([fakeRow("1", "2026-07-26", "17:00", "סשן", null, "מתוכנן")]);
    check("resolves to session_type (\"סשן\"), not any project text", mapped[0].title === "סשן", mapped[0].title);
    check("mapSessionRows has no way to receive a project name at all", mapSessionRows.length === 1); // arity check: (rows) only
  }

  console.log("\n[9] cancelled sessions are excluded");
  {
    const rows = [fakeRow("1", monday, "18:00", "הקלטה", null, null), fakeRow("2", thursday, "12:00", "הקלטה", null, "בוטל")];
    const mapped = mapSessionRows(rows);
    check("only the non-cancelled session survives", mapped.length === 1 && mapped[0].id === "1", JSON.stringify(mapped));
  }

  console.log("\n[10] sessions are sorted chronologically");
  {
    const rows = [
      fakeRow("late", thursday, "20:00", "מאוחר", null),
      fakeRow("early", monday, "10:00", "מוקדם", null),
      fakeRow("sameday-late", monday, "18:00", "אותו-יום-מאוחר", null),
    ];
    const mapped = mapSessionRows(rows);
    check("order is early, sameday-late, late", mapped.map((s) => s.id).join(",") === "early,sameday-late,late");
  }

  console.log("\n[11] no sessions → job never calls sendToShalev, no push at all");
  {
    let sendCalled = false, ackCalled = false;
    const deps = noopDeps({ fetchSessions: async () => [], sendToShalev: async () => { sendCalled = true; return [{ status: "fulfilled" }]; }, sendOwnerAck: async () => { ackCalled = true; } });
    const outcome = await runShalevWeeklySessionsJobCore(new Date(), deps);
    check("outcome is no_sessions", outcome.kind === "no_sessions", JSON.stringify(outcome));
    check("sendToShalev never called", !sendCalled);
    check("owner ack never called", !ackCalled);
  }

  console.log("\n[12] a run after success (status=sent) always skips, never sends again");
  {
    const store = makeFakeClaimStore();
    store.setRaw({ status: "sent", attempt_count: 1, lastAttemptAt: new Date().toISOString() });
    let sendCalled = false;
    const deps = noopDeps({ claimWeek: store.claimWeek, fetchSessions: async () => [{ id: "1", date: monday, startTime: "18:00", endTime: null, title: "X" }], sendToShalev: async () => { sendCalled = true; return [{ status: "fulfilled" }]; } });
    const outcome = await runShalevWeeklySessionsJobCore(new Date(), deps);
    check("outcome is skipped_duplicate", outcome.kind === "skipped_duplicate", JSON.stringify(outcome));
    check("sendToShalev never called", !sendCalled);
  }

  console.log("\n[13] a first failure allows a retry; success on the SECOND attempt sends exactly ONE owner ack");
  {
    const store = makeFakeClaimStore();
    let ackCount = 0, failCount = 0;
    let attemptSeen = 0;
    const deps = noopDeps({
      claimWeek: store.claimWeek,
      markWeekDone: store.markWeekDone,
      fetchSessions: async () => [{ id: "1", date: monday, startTime: "18:00", endTime: null, title: "X" }],
      sendToShalev: async () => { attemptSeen++; return attemptSeen === 1 ? [] /* no subscription -> fail */ : [{ status: "fulfilled" }]; },
      sendOwnerAck: async () => { ackCount++; },
      sendOwnerFail: async () => { failCount++; },
    });
    const o1 = await runShalevWeeklySessionsJobCore(new Date(), deps);
    check("attempt 1 outcome is no_subscription, not final", o1.kind === "no_subscription" && (o1 as { final?: boolean }).final === false, JSON.stringify(o1));
    check("no owner ack/fail yet after attempt 1", ackCount === 0 && failCount === 0);
    const o2 = await runShalevWeeklySessionsJobCore(new Date(Date.now() + 60_000), deps);
    check("attempt 2 outcome is sent", o2.kind === "sent", JSON.stringify(o2));
    check("exactly one owner ack, no fail message", ackCount === 1 && failCount === 0, `ack=${ackCount} fail=${failCount}`);
  }

  console.log("\n[14] three consecutive failures stop attempts and send exactly ONE final failure to owner");
  {
    const store = makeFakeClaimStore();
    let failCount = 0, ackCount = 0;
    const deps = noopDeps({
      claimWeek: store.claimWeek,
      markWeekDone: store.markWeekDone,
      fetchSessions: async () => [{ id: "1", date: monday, startTime: "18:00", endTime: null, title: "X" }],
      sendToShalev: async () => [{ status: "rejected" }], // always fails
      sendOwnerFail: async () => { failCount++; },
      sendOwnerAck: async () => { ackCount++; },
    });
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await runShalevWeeklySessionsJobCore(new Date(Date.now() + i * 60_000), deps);
      if (i < MAX_ATTEMPTS) check(`no owner-fail message yet after attempt ${i}/${MAX_ATTEMPTS}`, failCount === 0, `failCount=${failCount}`);
    }
    check(`exactly one owner-fail message after all ${MAX_ATTEMPTS} attempts (not one per attempt)`, failCount === 1, `failCount=${failCount}`);
    check("no owner ack ever sent", ackCount === 0);
    check("a 4th attempt in the same week is refused (attempts exhausted)",
      (await runShalevWeeklySessionsJobCore(new Date(Date.now() + 10 * 60_000), deps)).kind === "skipped_duplicate");
  }

  console.log("\n[15] a stale/stuck \"processing\" claim allows recovery after the timeout; a fresh one does not");
  {
    const store = makeFakeClaimStore();
    const t0 = new Date();
    store.setRaw({ status: "processing", attempt_count: 1, lastAttemptAt: t0.toISOString() });
    const freshAttempt = await store.claimWeek("k", new Date(t0.getTime() + 30_000)); // 30s later — still fresh
    check("a fresh (30s old) processing claim is NOT recoverable", !freshAttempt.claimed);
    const staleAttempt = await store.claimWeek("k", new Date(t0.getTime() + STUCK_PROCESSING_TIMEOUT_MS + 1000)); // just past the timeout
    check("a stale (past-timeout) processing claim IS recoverable", staleAttempt.claimed && staleAttempt.attempt === 2, JSON.stringify(staleAttempt));
  }

  console.log("\n[16] count=1 owner-ack text is grammatically singular");
  {
    check('buildOwnerAckBody(1) === "נשלח לשליו סשן אחד לשבוע הקרוב."', buildOwnerAckBody(1) === "נשלח לשליו סשן אחד לשבוע הקרוב.", buildOwnerAckBody(1));
    check('buildOwnerAckBody(2) uses the plural numeral form', buildOwnerAckBody(2) === "נשלחו לשליו 2 סשנים לשבוע הקרוב.", buildOwnerAckBody(2));
  }

  console.log("\n[17] classifyPushResult — no_subscription vs a real webpush failure");
  {
    check("empty results -> no_subscription", classifyPushResult([]) === "no_subscription");
    check("all rejected (subs existed) -> send_failed", classifyPushResult([{ status: "rejected" }]) === "send_failed");
    check("at least one fulfilled -> sent", classifyPushResult([{ status: "rejected" }, { status: "fulfilled" }]) === "sent");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
