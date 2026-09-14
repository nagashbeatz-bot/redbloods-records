/**
 * Standalone smoke test for lib/steven-deadline-digest-pure.ts (the pure
 * decision logic behind lib/steven-deadline-digest-notify.ts).
 *
 * Run with:   npx tsx scripts/test-steven-deadline-digest.ts
 *
 * Imports ONLY from steven-deadline-digest-pure.ts (which has no "server-only"/
 * Supabase/push dependency). No real Supabase writes and no real push anywhere
 * in this file — claimDay/hasClaimForToday/sendToSteven/sendToOwner are all
 * mocked via a plain Map + arrays, exactly like scripts/test-steven-mix-reminder.ts
 * mocks its own DB/push deps.
 */
import {
  TZ,
  ymdInTZ,
  addDaysYMD,
  isDigestWindowOpen,
  digestClaimKey,
  groupWorksForDigest,
  isDigestEmpty,
  formatNameList,
  buildStevenDigestBody,
  buildOwnerConfirmationBody,
  digestUrl,
  runDigestTick,
  STEVEN_DIGEST_TITLE,
  OWNER_DIGEST_TITLE,
  type DigestWork,
  type DigestDeps,
  type PushPayload,
} from "../lib/steven-deadline-digest-pure";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const work = (over: Partial<DigestWork> & { id: string }): DigestWork => ({
  displayName: over.id,
  internalDeadline: null,
  status: "נשלח",
  ...over,
});

/** Mock world: a shared claim Map (plays the role of the persisted `settings`
 *  row, so it can be reused across "separate" deps objects to simulate a
 *  Railway restart) + push logs. claimDay/hasClaimForToday are deliberately
 *  synchronous-bodied (no internal await before check-and-set) so that two
 *  concurrent runDigestTick calls race exactly like the real INSERT-first
 *  Postgres claim does — same technique as test-steven-mix-reminder.ts. */
function makeWorld(works: DigestWork[], opts?: {
  claimStore?: Map<string, Record<string, unknown>>;
  sendResult?: { status: string }[];
}) {
  const claimStore = opts?.claimStore ?? new Map<string, Record<string, unknown>>();
  const stevenPushes: PushPayload[] = [];
  const ownerPushes: PushPayload[] = [];
  const sendResult = opts?.sendResult ?? [{ status: "fulfilled" }];

  const deps: DigestDeps = {
    hasClaimForToday: async (key) => claimStore.has(key),
    fetchStevenWorks: async () => works,
    claimDay: async (key) => {
      if (claimStore.has(key)) return false;
      claimStore.set(key, { status: "processing" });
      return true;
    },
    markDayResult: async (key, value) => { claimStore.set(key, value); },
    sendToSteven: async (push) => { stevenPushes.push(push); return sendResult; },
    sendToOwner:  async (push) => { ownerPushes.push(push); },
    log: () => {},
    logError: () => {},
  };

  return { deps, claimStore, stevenPushes, ownerPushes };
}

async function main() {
  console.log("\n—— 1. Timezone — DST-safe, America/New_York, never a fixed UTC offset ——");
  {
    // 09:00 New York in January is EST (UTC-5) → 14:00Z. In July it's EDT
    // (UTC-4) → 13:00Z. A fixed-offset implementation could not get both right.
    const winter0900 = new Date("2026-01-15T14:00:00.000Z");
    const summer0900 = new Date("2026-07-15T13:00:00.000Z");
    check("09:00 America/New_York in winter (EST, UTC-5) is in window", isDigestWindowOpen(winter0900));
    check("09:00 America/New_York in summer (EDT, UTC-4) is in window", isDigestWindowOpen(summer0900));
    // Same 14:00Z instant is 09:00 in January but 10:00 in July — proves DST awareness.
    const sameUtcHourInJuly = new Date("2026-07-15T14:00:00.000Z");
    check("the SAME UTC hour (14:00Z) is OUT of window in July (10:00 local)", !isDigestWindowOpen(sameUtcHourInJuly));
    check("09:15 is still in window (edge)", isDigestWindowOpen(new Date("2026-01-15T14:15:00.000Z")));
    check("09:16 is out of window", !isDigestWindowOpen(new Date("2026-01-15T14:16:00.000Z")));
    check("08:59 is out of window", !isDigestWindowOpen(new Date("2026-01-15T13:59:00.000Z")));
    check("TZ constant is America/New_York", TZ === "America/New_York");
  }

  console.log("\n—— 2. ymdInTZ / addDaysYMD ——");
  {
    check("ymdInTZ reads the New York calendar date, not UTC's",
      ymdInTZ(new Date("2026-01-01T02:00:00.000Z")) === "2025-12-31", // 21:00 EST on the 31st
      ymdInTZ(new Date("2026-01-01T02:00:00.000Z")));
    check("addDaysYMD(+1) crosses a month boundary", addDaysYMD("2026-01-31", 1) === "2026-02-01");
    check("addDaysYMD(+1) crosses a year boundary",  addDaysYMD("2025-12-31", 1) === "2026-01-01");
    check("digestClaimKey format", digestClaimKey("2026-03-05") === "steven_deadline_digest:2026-03-05");
  }

  console.log("\n—— 3. Grouping / status handling (QA #1,2,3,5,6,7,8) ——");
  {
    const today = "2026-01-10", tomorrow = "2026-01-11";
    const works: DigestWork[] = [
      work({ id: "overdue-1", internalDeadline: "2026-01-01", status: "נשלח" }),       // QA1: overdue, "פעיל"
      work({ id: "today-1",   internalDeadline: today,        status: "לא נשלח" }),    // QA2/6: due today, "לא התחיל"
      work({ id: "tomorrow-1",internalDeadline: tomorrow,     status: "בתהליך" }),     // QA3/7: due tomorrow, "פעיל"
      work({ id: "done-overdue", internalDeadline: "2026-01-01", status: "אושר" }),    // QA5: completed + overdue → excluded
      work({ id: "cancelled-today", internalDeadline: today, status: "בוטל" }),        // cancelled → excluded
      work({ id: "no-deadline", internalDeadline: null, status: "חזר" }),              // QA8: no deadline → excluded
      work({ id: "far-future", internalDeadline: "2026-06-01", status: "נשלח" }),      // out of range → excluded
    ];
    const g = groupWorksForDigest(works, today, tomorrow);
    check("QA1: overdue work included", g.overdue.some((w) => w.id === "overdue-1"));
    check("QA2/6: due-today 'לא נשלח' (UI \"לא התחיל\") included", g.dueToday.some((w) => w.id === "today-1"));
    check("QA3/7: due-tomorrow 'בתהליך' (UI \"פעיל\") included", g.dueTomorrow.some((w) => w.id === "tomorrow-1"));
    check("QA5: completed (\"אושר\") + overdue deadline → excluded entirely",
      !g.overdue.some((w) => w.id === "done-overdue") && !g.dueToday.some((w) => w.id === "done-overdue") && !g.dueTomorrow.some((w) => w.id === "done-overdue"));
    check("cancelled (\"בוטל\") → excluded entirely", !g.dueToday.some((w) => w.id === "cancelled-today"));
    check("QA8: no deadline → excluded entirely",
      !g.overdue.some((w) => w.id === "no-deadline") && !g.dueToday.some((w) => w.id === "no-deadline") && !g.dueTomorrow.some((w) => w.id === "no-deadline"));
    check("a deadline outside all 3 buckets is excluded", !g.overdue.concat(g.dueToday, g.dueTomorrow).some((w) => w.id === "far-future"));
    check("exactly 1 overdue, 1 today, 1 tomorrow", g.overdue.length === 1 && g.dueToday.length === 1 && g.dueTomorrow.length === 1);
  }

  console.log("\n—— 4. Multiple per category + safe truncation (QA #4) ——");
  {
    const names = ["Sexy Girl", "Mulla", "G Thang", "D", "E", "F", "H"];
    check("formatNameList ≤3 → plain join", formatNameList(["A", "B"]) === "A, B");
    check("formatNameList >3 → 'and N more'",
      formatNameList(names) === "Sexy Girl, Mulla, G Thang and 4 more", formatNameList(names));

    const g = {
      overdue: names.map((n, i) => work({ id: `o${i}`, displayName: n })),
      dueToday: [], dueTomorrow: [],
    };
    const body = buildStevenDigestBody(g);
    check("body shows truncated overdue line with emoji", body === "🔴 Overdue: Sexy Girl, Mulla, G Thang and 4 more", body);
    check("no blank lines for empty categories", !body.includes("Due today") && !body.includes("Due tomorrow"));
  }

  console.log("\n—— 5. Body / title exact copy ——");
  {
    check("Steven title", STEVEN_DIGEST_TITLE === "📅 Your deadline summary");
    check("Owner title", OWNER_DIGEST_TITLE === "✅ סיכום הדדליינים נשלח לסטיבן");
    const g = {
      overdue:     [work({ id: "1", displayName: "Sexy Girl" }), work({ id: "2", displayName: "Mulla" })],
      dueToday:    [work({ id: "3", displayName: "Dancehall School Riddim" })],
      dueTomorrow: [work({ id: "4", displayName: "G Thang" })],
    };
    check("Steven body — matches the worked example",
      buildStevenDigestBody(g) === "🔴 Overdue: Sexy Girl, Mulla\n🟠 Due today: Dancehall School Riddim\n🟡 Due tomorrow: G Thang",
      buildStevenDigestBody(g));
    check("Owner body — matches the worked example",
      buildOwnerConfirmationBody(g) === "נשלח לסטיבן סיכום: 2 באיחור · 1 להיום · 1 למחר",
      buildOwnerConfirmationBody(g));
  }

  console.log("\n—— 6. URL (QA #10, #11) ——");
  {
    const one = { overdue: [work({ id: "solo" })], dueToday: [], dueTomorrow: [] };
    const two = { overdue: [work({ id: "a" })], dueToday: [work({ id: "b" })], dueTomorrow: [] };
    check("QA10: exactly one relevant work → deep-link", digestUrl(one) === "/team/steven?work=solo");
    check("QA11: 2+ relevant works → plain page", digestUrl(two) === "/team/steven");
  }

  console.log("\n—— 7. Nothing relevant → no push, no claim (QA #9) ——");
  {
    const { deps, claimStore, stevenPushes, ownerPushes } = makeWorld([
      work({ id: "far", internalDeadline: "2099-01-01", status: "נשלח" }),
      work({ id: "done", internalDeadline: "2020-01-01", status: "אושר" }),
    ]);
    const out = await runDigestTick(new Date("2026-01-10T14:00:00.000Z"), deps);
    check("outcome is empty_no_claim", out.kind === "empty_no_claim", out.kind);
    check("no Steven push sent", stevenPushes.length === 0);
    check("no owner push sent", ownerPushes.length === 0);
    check("NO claim row was written", claimStore.size === 0);
  }

  console.log("\n—— 8. Happy path: Steven push succeeds → owner confirmed ——");
  {
    const { deps, stevenPushes, ownerPushes } = makeWorld([
      work({ id: "solo", displayName: "Sexy Girl", internalDeadline: "2026-01-01", status: "נשלח" }),
    ]);
    const out = await runDigestTick(new Date("2026-01-10T14:00:00.000Z"), deps);
    check("outcome is sent_both", out.kind === "sent_both", out.kind);
    check("exactly 1 Steven push", stevenPushes.length === 1);
    check("Steven push uses the single-work deep-link", stevenPushes[0].url === "/team/steven?work=solo");
    check("exactly 1 owner push, only AFTER Steven's succeeded", ownerPushes.length === 1);
    check("owner body reflects 1 overdue", ownerPushes[0].body === "נשלח לסטיבן סיכום: 1 באיחור");
  }

  console.log("\n—— 9. Owner NEVER confirmed if Steven's push did not truly deliver (QA #15) ——");
  {
    // 9a. classifyPushResult → "send_failed" (a subscription exists but rejected).
    const failed = makeWorld(
      [work({ id: "solo", internalDeadline: "2026-01-10", status: "נשלח" })],
      { sendResult: [{ status: "rejected" }] },
    );
    const out1 = await runDigestTick(new Date("2026-01-10T14:00:00.000Z"), failed.deps);
    check("outcome is steven_send_failed", out1.kind === "steven_send_failed", out1.kind);
    check("Steven push WAS attempted", failed.stevenPushes.length === 1);
    check("owner NOT confirmed on a failed send", failed.ownerPushes.length === 0);

    // 9b. classifyPushResult → "no_subscription" (Steven has zero devices registered).
    const noSub = makeWorld(
      [work({ id: "solo2", internalDeadline: "2026-01-10", status: "נשלח" })],
      { sendResult: [] },
    );
    const out2 = await runDigestTick(new Date("2026-01-10T14:00:00.000Z"), noSub.deps);
    check("outcome is steven_no_subscription", out2.kind === "steven_no_subscription", out2.kind);
    check("owner NOT confirmed when Steven has no subscription", noSub.ownerPushes.length === 0);
  }

  console.log("\n—— 10. Concurrent ticks (2 cron instances) → exactly one send (QA #12) ——");
  {
    const claimStore = new Map<string, Record<string, unknown>>();
    const works = [work({ id: "solo", internalDeadline: "2026-01-10", status: "נשלח" })];
    const a = makeWorld(works, { claimStore });
    const b = makeWorld(works, { claimStore }); // shares the SAME claim store — simulates 2 instances hitting the same DB row
    const now = new Date("2026-01-10T14:05:00.000Z");
    const [ra, rb] = await Promise.all([
      runDigestTick(now, a.deps),
      runDigestTick(now, b.deps),
    ]);
    const kinds = [ra.kind, rb.kind].sort().join("+");
    check("exactly one tick sends, the other loses the race", kinds === "lost_race+sent_both", kinds);
    const totalStevenPushes = a.stevenPushes.length + b.stevenPushes.length;
    check("exactly ONE Steven push across both instances", totalStevenPushes === 1, `got ${totalStevenPushes}`);
    const totalOwnerPushes = a.ownerPushes.length + b.ownerPushes.length;
    check("exactly ONE owner push across both instances", totalOwnerPushes === 1, `got ${totalOwnerPushes}`);
  }

  console.log("\n—— 11. Simulated Railway restart → still not sent twice (QA #13) ——");
  {
    // The claim Map plays the role of the persisted `settings` row: it survives
    // being handed to a BRAND NEW deps object (fresh push-log arrays), exactly
    // as a real settings row survives a process restart.
    const claimStore = new Map<string, Record<string, unknown>>();
    const works = [work({ id: "solo", internalDeadline: "2026-01-10", status: "נשלח" })];

    const before = makeWorld(works, { claimStore });
    const out1 = await runDigestTick(new Date("2026-01-10T14:00:00.000Z"), before.deps);
    check("first tick sends", out1.kind === "sent_both", out1.kind);
    check("1 Steven push before 'restart'", before.stevenPushes.length === 1);

    // "Restart": brand-new deps/closures/arrays, same persisted claim store.
    const after = makeWorld(works, { claimStore });
    const out2 = await runDigestTick(new Date("2026-01-10T14:10:00.000Z"), after.deps);
    check("post-restart tick sees the existing claim and backs off", out2.kind === "already_attempted_today", out2.kind);
    check("NO second Steven push after 'restart'", after.stevenPushes.length === 0);
    check("NO second owner push after 'restart'", after.ownerPushes.length === 0);
  }

  console.log("\n—— 12. Outside the 09:00 window → never touches claim/fetch/push ——");
  {
    const { deps, claimStore, stevenPushes } = makeWorld([
      work({ id: "solo", internalDeadline: "2026-01-10", status: "נשלח" }),
    ]);
    const out = await runDigestTick(new Date("2026-01-10T18:00:00.000Z"), deps); // 14:00 local, way outside window
    check("outcome is not_due", out.kind === "not_due", out.kind);
    check("no claim, no push", claimStore.size === 0 && stevenPushes.length === 0);
  }

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
