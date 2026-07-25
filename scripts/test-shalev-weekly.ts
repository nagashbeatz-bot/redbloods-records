/**
 * Standalone smoke test for lib/shalev-weekly-pure.ts (the pure decision logic
 * behind lib/shalev-weekly-notify.ts).
 *
 * Run with:   npx tsx scripts/test-shalev-weekly.ts
 *
 * Imports ONLY from shalev-weekly-pure.ts, which has no "server-only"/Supabase/
 * push dependency (server-only throws unconditionally outside Next's bundler,
 * so the real lib/shalev-weekly-notify.ts cannot be loaded from a plain script
 * at all — that's exactly why the pure logic lives in its own file). No real
 * Supabase writes, no real push — the whole point of the dependency injection
 * in runShalevWeeklySessionsJobCore.
 */
import {
  computeWeekRange,
  buildShalevBody,
  mapSessionRows,
  classifyPushResult,
  runShalevWeeklySessionsJobCore,
  type ShalevSessionInfo,
  type JobDeps,
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

function fakeRow(id: string, date: string, startTime: string | null, title: string, status: string | null = null) {
  return { id, project_id: "p1", title, date, start_time: startTime, end_time: null, session_type: "סשן", status };
}

function noopDeps(overrides: Partial<JobDeps>): JobDeps {
  return {
    fetchSessions: async () => [],
    claimWeek: async () => true,
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
  console.log("\n[1] computeWeekRange — Asia/Jerusalem, DST-safe (Intl-based, never a fixed UTC offset)");
  {
    const now = new Date();
    const { weekStart, weekEnd } = computeWeekRange(now);
    check("weekStart is a Sunday", new Date(weekStart + "T00:00:00Z").getUTCDay() === 0, weekStart);
    check("weekEnd is exactly 6 days after weekStart (Saturday)", weekEnd === ymdOffset(weekStart, 6), `${weekStart}..${weekEnd}`);

    // Midday UTC on weekStart's date is, at worst, ~14:00-15:00 Israel time the
    // SAME calendar day (never rolls to Monday) — proves the mapping is stable
    // for any moment inside the Sunday, regardless of which DST offset applies.
    const [y, m, d] = weekStart.split("-").map(Number);
    const middayOnWeekStart = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    check("a moment at midday UTC on weekStart resolves to the same week",
      computeWeekRange(middayOnWeekStart).weekStart === weekStart);

    // A fixed date across Israel's October DST boundary must still resolve to an
    // actual Sunday — proves real timezone conversion, not a fixed UTC offset.
    const acrossDst = computeWeekRange(new Date("2026-10-27T09:00:00Z"));
    check("a date across the Oct DST boundary still resolves to a Sunday",
      new Date(acrossDst.weekStart + "T00:00:00Z").getUTCDay() === 0, acrossDst.weekStart);
  }

  // Derive Monday/Thursday from a self-computed Sunday so the day-name assertions
  // below are correct regardless of which real calendar date the test runs on.
  const { weekStart: sunday } = computeWeekRange(new Date());
  const monday = ymdOffset(sunday, 1);
  const thursday = ymdOffset(sunday, 4);

  console.log("\n[2] buildShalevBody — multiple sessions");
  {
    const sessions: ShalevSessionInfo[] = [
      { id: "1", date: monday, startTime: "18:00", endTime: null, title: "פרנציפ" },
      { id: "2", date: thursday, startTime: "20:00", endTime: null, title: "סשן כתיבה" },
    ];
    const body = buildShalevBody(sessions);
    check("intro uses plural + count", body.startsWith("השבוע מחכים לך 2 סשנים:"), body);
    check("first line matches spec format (יום שני ב־18:00 — פרנציפ)", body.includes("יום שני ב־18:00 — פרנציפ"), body);
    check("second line matches spec format (יום חמישי ב־20:00 — סשן כתיבה)", body.includes("יום חמישי ב־20:00 — סשן כתיבה"), body);
  }

  console.log("\n[3] buildShalevBody — single session (singular form)");
  {
    const sessions: ShalevSessionInfo[] = [
      { id: "1", date: monday, startTime: "18:00", endTime: null, title: "פרנציפ" },
    ];
    const body = buildShalevBody(sessions);
    const expected = "השבוע מחכה לך סשן אחד:\nיום שני ב־18:00 — פרנציפ";
    check("exact match with the spec example", body === expected, body);
  }

  console.log("\n[4] no sessions → job never calls sendToShalev, no push at all");
  {
    let sendToShalevCalled = false, ownerAckCalled = false;
    const deps = noopDeps({
      fetchSessions: async () => [],
      sendToShalev: async () => { sendToShalevCalled = true; return [{ status: "fulfilled" }]; },
      sendOwnerAck: async () => { ownerAckCalled = true; },
    });
    const outcome = await runShalevWeeklySessionsJobCore(new Date(), deps);
    check("outcome is no_sessions", outcome.kind === "no_sessions", JSON.stringify(outcome));
    check("sendToShalev never called", !sendToShalevCalled);
    check("owner ack never called", !ownerAckCalled);
  }

  console.log("\n[5] cancelled sessions are excluded (mapSessionRows)");
  {
    const rows = [
      fakeRow("1", monday, "18:00", "פרנציפ", null),
      fakeRow("2", thursday, "12:00", "מבוטל", "בוטל"),
    ];
    const mapped = mapSessionRows(rows, new Map());
    check("only the non-cancelled session survives", mapped.length === 1 && mapped[0].id === "1", JSON.stringify(mapped));
  }

  console.log("\n[6] sessions are sorted chronologically (mapSessionRows)");
  {
    const rows = [
      fakeRow("late", thursday, "20:00", "מאוחר"),
      fakeRow("early", monday, "10:00", "מוקדם"),
      fakeRow("sameday-late", monday, "18:00", "אותו-יום-מאוחר"),
    ];
    const mapped = mapSessionRows(rows, new Map());
    check("order is early, sameday-late, late", mapped.map((s) => s.id).join(",") === "early,sameday-late,late",
      mapped.map((s) => s.id).join(","));
  }

  console.log("\n[7] duplicate run in the same week is skipped (claimWeek returns false)");
  {
    let sendCalled = false;
    const deps = noopDeps({
      fetchSessions: async () => [{ id: "1", date: monday, startTime: "18:00", endTime: null, title: "X" }],
      claimWeek: async () => false, // simulates: another run already claimed this week
      sendToShalev: async () => { sendCalled = true; return [{ status: "fulfilled" }]; },
    });
    const outcome = await runShalevWeeklySessionsJobCore(new Date(), deps);
    check("outcome is skipped_duplicate", outcome.kind === "skipped_duplicate", JSON.stringify(outcome));
    check("sendToShalev never called on a duplicate run", !sendCalled);
  }

  console.log("\n[8] owner ack fires only AFTER a real Shalev success");
  {
    const order: string[] = [];
    const deps = noopDeps({
      fetchSessions: async () => [{ id: "1", date: monday, startTime: "18:00", endTime: null, title: "X" }],
      sendToShalev: async () => { order.push("sendToShalev"); return [{ status: "fulfilled" }]; },
      sendOwnerAck: async () => { order.push("sendOwnerAck"); },
      sendOwnerFail: async () => { order.push("sendOwnerFail"); },
    });
    const outcome = await runShalevWeeklySessionsJobCore(new Date(), deps);
    check("outcome is sent", outcome.kind === "sent", JSON.stringify(outcome));
    check("sendOwnerAck called, sendOwnerFail never called", order.includes("sendOwnerAck") && !order.includes("sendOwnerFail"), order.join(","));
    check("sendToShalev happened BEFORE sendOwnerAck", order.indexOf("sendToShalev") < order.indexOf("sendOwnerAck"), order.join(","));
  }

  console.log("\n[9] no active Shalev subscription → owner gets the no_subscription failure (not a generic one)");
  {
    let failReason: string | null = null;
    const deps = noopDeps({
      fetchSessions: async () => [{ id: "1", date: monday, startTime: "18:00", endTime: null, title: "X" }],
      sendToShalev: async () => [], // empty subs array = no active subscription
      sendOwnerFail: async (reason) => { failReason = reason; },
    });
    const outcome = await runShalevWeeklySessionsJobCore(new Date(), deps);
    check("outcome is no_subscription", outcome.kind === "no_subscription", JSON.stringify(outcome));
    check("owner failure reason is no_subscription", (failReason as string | null) === "no_subscription", String(failReason));
  }

  console.log("\n[9b] classifyPushResult — a real webpush failure (subs existed, all rejected)");
  check("classified as send_failed, not no_subscription",
    classifyPushResult([{ status: "rejected" }, { status: "rejected" }]) === "send_failed");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
