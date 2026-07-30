/**
 * Standalone smoke test for lib/shalev-availability-reminder-pure.ts (the
 * pure decision logic behind lib/shalev-availability-reminder-notify.ts).
 *
 * Run with:   npx tsx scripts/test-shalev-availability-reminder.ts
 *             TZ=UTC npx tsx scripts/test-shalev-availability-reminder.ts
 *
 * Imports ONLY from shalev-availability-reminder-pure.ts (and the
 * already-tested shalev-weekly-pure.ts constants it re-exports), which has
 * no "server-only"/Supabase/push dependency. No real Supabase writes, no
 * real push anywhere in this file. Artist-scoping (which artist's row is
 * read, RLS-equivalent isolation) is NOT this module's job — it happens one
 * layer up (resolveOwnerPortalAccess / SHALEV_SLUG-keyed settings row); this
 * file only exercises the pure decision logic given already-scoped data.
 */
import {
  TZ,
  activeCycleThursday,
  activeCycle,
  cycleStartInstant,
  belongsToActiveCycle,
  zonedTimeToUtc,
  isSlotDue,
  REMINDER_SLOTS,
  countValidDays,
  hasValidSubmissionForCycle,
  reminderClaimKey,
  buildReminderPush,
  decideClaimAction,
  processAvailabilityReminderSlot,
  isMandatoryAvailabilityWindowOpen,
  MAX_ATTEMPTS,
  STUCK_PROCESSING_TIMEOUT_MS,
  type ClaimValue,
  type ClaimResult,
  type AvailabilityReminderDeps,
  type MinimalAvailability,
} from "../lib/shalev-availability-reminder-pure";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

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
  console.log(`(host TZ offset=${new Date().getTimezoneOffset()} min)`);

  console.log("\n—— activeCycleThursday / activeCycle — Thursday 08:00 boundary ——");
  {
    // 2026-07-30 is a real Thursday (confirmed against Intl separately).
    const thu1200 = new Date(zonedTimeToUtc("2026-07-30", "12:00", TZ));
    check("Thursday 12:00: cycle thursday = today", activeCycleThursday(thu1200) === "2026-07-30");
    check("Thursday 12:00: cycle week = 02.08–08.08", JSON.stringify(activeCycle(thu1200)) === JSON.stringify({ thursday: "2026-07-30", weekStart: "2026-08-02", weekEnd: "2026-08-08" }), JSON.stringify(activeCycle(thu1200)));

    const thu0759 = zonedTimeToUtc("2026-07-30", "07:59", TZ);
    check("Thursday 07:59 (before cycle opens): PREVIOUS Thursday's cycle still active", activeCycleThursday(thu0759) === "2026-07-23");

    const thu0800 = zonedTimeToUtc("2026-07-30", "08:00", TZ);
    check("Thursday 08:00 exactly: NEW cycle already active", activeCycleThursday(thu0800) === "2026-07-30");

    // Every day Thu..next-Wed must resolve to the SAME cycle thursday.
    const days = ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];
    for (const d of days) {
      const at = zonedTimeToUtc(d, "10:00", TZ);
      check(`${d} 10:00 belongs to the 07-30 cycle`, activeCycleThursday(at) === "2026-07-30");
    }
    const nextThu = zonedTimeToUtc("2026-08-06", "10:00", TZ);
    check("the FOLLOWING Thursday opens a new cycle", activeCycleThursday(nextThu) === "2026-08-06");
    check("second example from the task: 06.08 → 09.08–15.08", JSON.stringify(activeCycle(nextThu)) === JSON.stringify({ thursday: "2026-08-06", weekStart: "2026-08-09", weekEnd: "2026-08-15" }));
  }

  console.log("—— month / year rollover ——");
  {
    // 2026-12-31 is a Thursday; cycle should roll cleanly into 2027.
    const dec31 = zonedTimeToUtc("2026-12-31", "12:00", TZ);
    const cyc = activeCycle(dec31);
    check("Dec 31 2026 (Thu) is a valid cycle-open day", cyc.thursday === "2026-12-31", JSON.stringify(cyc));
    check("cycle week rolls into January 2027", cyc.weekStart === "2027-01-03" && cyc.weekEnd === "2027-01-09", JSON.stringify(cyc));
  }

  console.log("—— DST — a winter Thursday vs a summer Thursday still resolve self-consistently ——");
  {
    // Israel is UTC+2 in winter (no DST), UTC+3 in summer (IDT). Don't hardcode
    // which offset applies on which real-world date (that's ICU's job) — just
    // assert the 08:00-Israel instant, round-tripped, still reads as 08:00 in
    // Israel on both a summer and a winter date.
    for (const [date, label] of [["2026-07-30", "summer"], ["2026-01-08", "winter"]] as const) {
      const instant = zonedTimeToUtc(date, "08:00", TZ);
      const hourBack = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(instant));
      check(`${label} (${date}) 08:00 Israel round-trips to hour=08`, hourBack === 8, `got hour=${hourBack}`);
    }
  }

  console.log("—— isSlotDue — the three slots + window resilience ——");
  {
    const [thu1200Slot, thu1800Slot, fri0900Slot] = REMINDER_SLOTS;
    check("slot ids exact", thu1200Slot.id === "thu-1200" && thu1800Slot.id === "thu-1800" && fri0900Slot.id === "fri-0900");

    const at1200 = zonedTimeToUtc("2026-07-30", "12:00", TZ);
    check("thu-1200 due at exactly 12:00", isSlotDue(at1200, thu1200Slot));
    check("thu-1200 NOT due for the 18:00 slot at the same instant", !isSlotDue(at1200, thu1800Slot));

    const at1207 = zonedTimeToUtc("2026-07-30", "12:07", TZ);
    check("thu-1200 still due at 12:07 (resilience window)", isSlotDue(at1207, thu1200Slot));

    const at1216 = zonedTimeToUtc("2026-07-30", "12:16", TZ);
    check("thu-1200 NOT due at 12:16 (window closed)", !isSlotDue(at1216, thu1200Slot));

    const at1159 = zonedTimeToUtc("2026-07-30", "11:59", TZ);
    check("thu-1200 NOT due at 11:59", !isSlotDue(at1159, thu1200Slot));

    const at1800 = zonedTimeToUtc("2026-07-30", "18:00", TZ);
    check("thu-1800 due at 18:00", isSlotDue(at1800, thu1800Slot));

    const friAt0900 = zonedTimeToUtc("2026-07-31", "09:00", TZ);
    check("fri-0900 due Friday 09:00", isSlotDue(friAt0900, fri0900Slot));
    const thuAt0900 = zonedTimeToUtc("2026-07-30", "09:00", TZ);
    check("fri-0900 NOT due on Thursday at 09:00 (wrong weekday)", !isSlotDue(thuAt0900, fri0900Slot));
  }

  console.log("—— validation: countValidDays / hasValidSubmissionForCycle ——");
  {
    check("0 days → count 0", countValidDays([]) === 0);
    check("0 days, all unavailable → count 0", countValidDays([
      { available: false, from: "" }, { available: false, from: "" },
    ]) === 0);
    check("1 valid day → count 1", countValidDays([
      { available: true, from: "16:00" }, { available: false, from: "" },
    ]) === 1);
    // "two hours on one day" is structurally impossible in this data shape
    // (one `from` field per day) — verified by construction: a day can only
    // ever contribute 0 or 1 to the count, never 2, no matter what `from`
    // holds — so this scenario from the task can't even be represented, let
    // alone miscounted.
    check("2 different days → count 2 (success case)", countValidDays([
      { available: true, from: "16:00" }, { available: false, from: "" },
      { available: true, from: "18:00" }, { available: false, from: "" },
    ]) === 2);
    check("available=true but empty from → not counted", countValidDays([
      { available: true, from: "" }, { available: true, from: "18:00" },
    ]) === 1);

    const cycleStart = zonedTimeToUtc("2026-07-30", "08:00", TZ);
    check("null stored → invalid", !hasValidSubmissionForCycle(null, cycleStart));

    const zeroValid: MinimalAvailability = { days: [{ available: false, from: "" }], sentAt: new Date(cycleStart.getTime() + 3600000).toISOString() };
    check("0 valid days, fresh sentAt → still invalid (blocked)", !hasValidSubmissionForCycle(zeroValid, cycleStart));

    const oneValid: MinimalAvailability = { days: [{ available: true, from: "16:00" }], sentAt: new Date(cycleStart.getTime() + 3600000).toISOString() };
    check("1 valid day, fresh sentAt → still invalid (blocked)", !hasValidSubmissionForCycle(oneValid, cycleStart));

    const twoValidButStale: MinimalAvailability = {
      days: [{ available: true, from: "16:00" }, { available: true, from: "18:00" }],
      sentAt: new Date(cycleStart.getTime() - 3600000).toISOString(), // BEFORE this cycle opened
    };
    check("2 valid days but sentAt from a PRIOR cycle → invalid", !hasValidSubmissionForCycle(twoValidButStale, cycleStart));

    const twoValidFresh: MinimalAvailability = {
      days: [{ available: true, from: "16:00" }, { available: true, from: "18:00" }],
      sentAt: new Date(cycleStart.getTime() + 3600000).toISOString(),
    };
    check("2 valid days, sentAt within the active cycle → VALID (success case)", hasValidSubmissionForCycle(twoValidFresh, cycleStart));

    const exactlyAtCycleStart: MinimalAvailability = {
      days: [{ available: true, from: "16:00" }, { available: true, from: "18:00" }],
      sentAt: cycleStart.toISOString(),
    };
    check("sentAt exactly AT cycle start → valid (inclusive boundary)", hasValidSubmissionForCycle(exactlyAtCycleStart, cycleStart));
  }

  console.log("—— UNIFIED cycle: the form's own load-decision, exactly as ArtistPortalPage.tsx computes it ——");
  {
    // A submission from the PREVIOUS cycle (Thursday 2026-07-23's cycle,
    // target week 26.07–01.08) — simulates what's sitting in `settings`
    // right before the new cycle opens.
    const priorCycleSubmission: MinimalAvailability = {
      days: [{ available: true, from: "16:00" }, { available: true, from: "18:00" }],
      sentAt: zonedTimeToUtc("2026-07-23", "12:00", TZ).toISOString(), // sent during the OLD cycle
    };

    // רביעי 23:00 (2026-07-29) — the 07-23 cycle is still active.
    const wed2300 = zonedTimeToUtc("2026-07-29", "23:00", TZ);
    check("רביעי 23:00: activeCycle is still the 07-23 cycle", activeCycle(wed2300).thursday === "2026-07-23");
    check("רביעי 23:00: the old submission STILL belongs to the active cycle (form would show it)", belongsToActiveCycle(priorCycleSubmission.sentAt, cycleStartInstant(wed2300)));

    // חמישי 07:59 (2026-07-30) — still the 07-23 cycle (opens at 08:00).
    const thu0759 = zonedTimeToUtc("2026-07-30", "07:59", TZ);
    check("חמישי 07:59: activeCycle is STILL the 07-23 cycle (previous cycle shown)", activeCycle(thu0759).thursday === "2026-07-23");
    check("חמישי 07:59: the old submission still belongs (form still shows it — correct, cycle hasn't flipped)", belongsToActiveCycle(priorCycleSubmission.sentAt, cycleStartInstant(thu0759)));

    // חמישי 08:00 (2026-07-30) — the NEW cycle (07-30) is now active.
    const thu0800 = zonedTimeToUtc("2026-07-30", "08:00", TZ);
    check("חמישי 08:00: activeCycle flips to the NEW 07-30 cycle", activeCycle(thu0800).thursday === "2026-07-30");
    check("חמישי 08:00: the OLD submission no longer belongs → form shows BLANK", !belongsToActiveCycle(priorCycleSubmission.sentAt, cycleStartInstant(thu0800)));
    check("חמישי 08:00: new cycle's target week is 02.08–08.08 (what the now-blank form displays)", JSON.stringify(activeCycle(thu0800)) === JSON.stringify({ thursday: "2026-07-30", weekStart: "2026-08-02", weekEnd: "2026-08-08" }));

    // חמישי 12:00 — the reminder job's cycle must be the EXACT SAME one the
    // form is showing at that same instant (same function, same input).
    const thu1200 = zonedTimeToUtc("2026-07-30", "12:00", TZ);
    const formCycle = activeCycle(thu1200);
    const jobClaimKey = reminderClaimKey("shalev-tasama", activeCycle(thu1200).weekStart, "thu-1200");
    check("חמישי 12:00: the Push job's claim key uses the form's own weekStart", jobClaimKey === `availability_reminder:shalev-tasama:${formCycle.weekStart}:thu-1200`);

    // A FRESH submission sent right after 08:00 for the NEW cycle — the form
    // must show IT (not the old one), and reminders must see it as valid.
    const newCycleSubmission: MinimalAvailability = {
      days: [{ available: true, from: "16:00" }, { available: true, from: "18:00" }],
      sentAt: zonedTimeToUtc("2026-07-30", "09:00", TZ).toISOString(),
    };
    check("new submission (sent 09:00) belongs to the new 07-30 cycle", belongsToActiveCycle(newCycleSubmission.sentAt, cycleStartInstant(thu1200)));
    check("new submission also satisfies hasValidSubmissionForCycle (≥2 days)", hasValidSubmissionForCycle(newCycleSubmission, cycleStartInstant(thu1200)));

    // מעבר לחמישי הבא (06.08) — the 07-30 cycle's submission must NOT bleed
    // into the following cycle; the form for 06.08 starts blank again.
    const nextThu0800 = zonedTimeToUtc("2026-08-06", "08:00", TZ);
    check("מעבר לחמישי הבא: activeCycle flips to 08-06", activeCycle(nextThu0800).thursday === "2026-08-06");
    check("מעבר לחמישי הבא: the 07-30 cycle's submission does NOT belong to the 08-06 cycle → blank again", !belongsToActiveCycle(newCycleSubmission.sentAt, cycleStartInstant(nextThu0800)));
    check("מעבר לחמישי הבא: new target week is 09.08–15.08", JSON.stringify(activeCycle(nextThu0800)) === JSON.stringify({ thursday: "2026-08-06", weekStart: "2026-08-09", weekEnd: "2026-08-15" }));
  }

  console.log("—— reminderClaimKey — exact format from the task ——");
  {
    check("thu-1200 key exact", reminderClaimKey("shalev-tasama", "2026-08-02", "thu-1200") === "availability_reminder:shalev-tasama:2026-08-02:thu-1200");
    check("thu-1800 key exact", reminderClaimKey("shalev-tasama", "2026-08-02", "thu-1800") === "availability_reminder:shalev-tasama:2026-08-02:thu-1800");
    check("fri-0900 key exact", reminderClaimKey("shalev-tasama", "2026-08-02", "fri-0900") === "availability_reminder:shalev-tasama:2026-08-02:fri-0900");
  }

  console.log("—— message text (all 3 slots) ——");
  {
    check("thu-1200 text", JSON.stringify(buildReminderPush("thu-1200")) === JSON.stringify({ title: "שליו, הגיע הזמן לשלוח זמינות", body: "יש לבחור לפחות יומיים זמינים לשבוע הבא" }));
    check("thu-1800 text", JSON.stringify(buildReminderPush("thu-1800")) === JSON.stringify({ title: "עדיין לא שלחת זמינות", body: "יש לבחור לפחות יומיים זמינים לשבוע הבא" }));
    check("fri-0900 text", JSON.stringify(buildReminderPush("fri-0900")) === JSON.stringify({ title: "תזכורת אחרונה לשליחת זמינות", body: "יש לבחור לפחות יומיים זמינים לשבוע הבא" }));
  }

  console.log("—— push scenarios: before submission, all 3 fire exactly once ——");
  {
    const store = makeFakeClaimStore();
    let sends = 0;
    const sentKeys: string[] = [];
    const deps: AvailabilityReminderDeps = {
      fetchStored: async () => null, // never submitted
      claim: store.claim, markDone: store.markDone,
      sendToShalev: async (p) => { sends++; sentKeys.push(p.eventId ?? ""); return [{ status: "fulfilled" }]; },
      log: () => {}, logError: () => {},
    };
    for (const slot of REMINDER_SLOTS) {
      const now = slot.id === "thu-1200" ? zonedTimeToUtc("2026-07-30", "12:05", TZ)
        : slot.id === "thu-1800" ? zonedTimeToUtc("2026-07-30", "18:05", TZ)
        : zonedTimeToUtc("2026-07-31", "09:05", TZ);
      const outcome = await processAvailabilityReminderSlot(now, "shalev-tasama", slot, deps);
      check(`${slot.id}: sent`, outcome.kind === "sent");
    }
    check("exactly 3 sends total", sends === 3);
    check("3 distinct event keys", new Set(sentKeys).size === 3);

    // Scheduler retry — same tick fires again for a slot already sent.
    const retryNow = zonedTimeToUtc("2026-07-30", "12:10", TZ);
    const retry = await processAvailabilityReminderSlot(retryNow, "shalev-tasama", REMINDER_SLOTS[0], deps);
    check("retry within the same window: skipped_duplicate", retry.kind === "skipped_duplicate");
    check("no extra send on retry", sends === 3);
  }

  console.log("—— push scenario: submission BEFORE 12:00 → no push at all ——");
  {
    const store = makeFakeClaimStore();
    let sends = 0;
    let stored: MinimalAvailability | null = {
      days: [{ available: true, from: "16:00" }, { available: true, from: "18:00" }],
      sentAt: zonedTimeToUtc("2026-07-30", "10:00", TZ).toISOString(), // after cycle open (08:00), before 12:00
    };
    const deps: AvailabilityReminderDeps = {
      fetchStored: async () => stored,
      claim: store.claim, markDone: store.markDone,
      sendToShalev: async () => { sends++; return [{ status: "fulfilled" }]; },
      log: () => {}, logError: () => {},
    };
    for (const slot of REMINDER_SLOTS) {
      const now = slot.id === "thu-1200" ? zonedTimeToUtc("2026-07-30", "12:05", TZ)
        : slot.id === "thu-1800" ? zonedTimeToUtc("2026-07-30", "18:05", TZ)
        : zonedTimeToUtc("2026-07-31", "09:05", TZ);
      const outcome = await processAvailabilityReminderSlot(now, "shalev-tasama", slot, deps);
      check(`${slot.id}: already_submitted (no claim, no send)`, outcome.kind === "already_submitted");
    }
    check("zero sends — submission before 12:00 blocks ALL reminders", sends === 0);
  }

  console.log("—— push scenario: submission BETWEEN 12:00 and 18:00 → only the first fires ——");
  {
    const store = makeFakeClaimStore();
    let sends = 0;
    let stored: MinimalAvailability | null = null;
    const deps: AvailabilityReminderDeps = {
      fetchStored: async () => stored,
      claim: store.claim, markDone: store.markDone,
      sendToShalev: async () => { sends++; return [{ status: "fulfilled" }]; },
      log: () => {}, logError: () => {},
    };
    const at1200 = zonedTimeToUtc("2026-07-30", "12:05", TZ);
    const first = await processAvailabilityReminderSlot(at1200, "shalev-tasama", REMINDER_SLOTS[0], deps);
    check("12:00 tick (not yet submitted): sent", first.kind === "sent" && sends === 1);

    // Shalev submits at 15:00 — between the two windows.
    stored = { days: [{ available: true, from: "16:00" }, { available: true, from: "18:00" }], sentAt: zonedTimeToUtc("2026-07-30", "15:00", TZ).toISOString() };

    const at1800 = zonedTimeToUtc("2026-07-30", "18:05", TZ);
    const second = await processAvailabilityReminderSlot(at1800, "shalev-tasama", REMINDER_SLOTS[1], deps);
    check("18:00 tick (already submitted at 15:00): already_submitted", second.kind === "already_submitted");

    const atFri = zonedTimeToUtc("2026-07-31", "09:05", TZ);
    const third = await processAvailabilityReminderSlot(atFri, "shalev-tasama", REMINDER_SLOTS[2], deps);
    check("fri 09:00 tick: already_submitted", third.kind === "already_submitted");

    check("exactly 1 send total (only the 12:00 one)", sends === 1);
  }

  console.log("—— push scenario: submission BETWEEN 18:00 and Fri 09:00 → first + second fire, third doesn't ——");
  {
    const store = makeFakeClaimStore();
    let sends = 0;
    let stored: MinimalAvailability | null = null;
    const deps: AvailabilityReminderDeps = {
      fetchStored: async () => stored,
      claim: store.claim, markDone: store.markDone,
      sendToShalev: async () => { sends++; return [{ status: "fulfilled" }]; },
      log: () => {}, logError: () => {},
    };
    const at1200 = zonedTimeToUtc("2026-07-30", "12:05", TZ);
    await processAvailabilityReminderSlot(at1200, "shalev-tasama", REMINDER_SLOTS[0], deps);
    const at1800 = zonedTimeToUtc("2026-07-30", "18:05", TZ);
    await processAvailabilityReminderSlot(at1800, "shalev-tasama", REMINDER_SLOTS[1], deps);
    check("both first and second fired before submission", sends === 2);

    // Shalev submits at 22:00 Thursday — after both, before Friday's slot.
    stored = { days: [{ available: true, from: "16:00" }, { available: true, from: "18:00" }], sentAt: zonedTimeToUtc("2026-07-30", "22:00", TZ).toISOString() };

    const atFri = zonedTimeToUtc("2026-07-31", "09:05", TZ);
    const third = await processAvailabilityReminderSlot(atFri, "shalev-tasama", REMINDER_SLOTS[2], deps);
    check("fri 09:00 tick: already_submitted (third does NOT fire)", third.kind === "already_submitted");
    check("exactly 2 sends total", sends === 2);
  }

  console.log("—— cross-cycle isolation: next week's cycle fires independently ——");
  {
    const store = makeFakeClaimStore();
    let sends = 0;
    const deps: AvailabilityReminderDeps = {
      fetchStored: async () => null,
      claim: store.claim, markDone: store.markDone,
      sendToShalev: async () => { sends++; return [{ status: "fulfilled" }]; },
      log: () => {}, logError: () => {},
    };
    const week1 = zonedTimeToUtc("2026-07-30", "12:05", TZ);
    const week2 = zonedTimeToUtc("2026-08-06", "12:05", TZ); // the FOLLOWING Thursday
    const r1 = await processAvailabilityReminderSlot(week1, "shalev-tasama", REMINDER_SLOTS[0], deps);
    const r2 = await processAvailabilityReminderSlot(week2, "shalev-tasama", REMINDER_SLOTS[0], deps);
    check("week 1 cycle: sent", r1.kind === "sent");
    check("week 2 cycle (different weekStart → fresh key): also sent, not blocked by week 1", r2.kind === "sent");
    check("2 independent sends across 2 cycles", sends === 2);
  }

  console.log("—— mandatory-availability-modal window: Thursday 20:00 → Saturday 21:00 (fixed 21:00, user-approved) ——");
  {
    // 2026-07-30 is a real Thursday (verified this session).
    check("Wed 19:59 (day before) → closed", !isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-07-29", "20:00", TZ)));
    check("Thu 19:59 → closed (before window opens)", !isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-07-30", "19:59", TZ)));
    check("Thu 20:00 → open (window opens)", isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-07-30", "20:00", TZ)));
    check("Thu 23:59 → open", isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-07-30", "23:59", TZ)));
    check("Fri 00:00 → open (all of Friday)", isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-07-31", "00:00", TZ)));
    check("Fri 12:00 → open", isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-07-31", "12:00", TZ)));
    check("Fri 23:59 → open", isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-07-31", "23:59", TZ)));
    check("Sat 00:00 → open", isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-08-01", "00:00", TZ)));
    check("Sat 20:59 → open (last minute before cutoff)", isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-08-01", "20:59", TZ)));
    check("Sat 21:00 → closed (מוצאי שבת cutoff)", !isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-08-01", "21:00", TZ)));
    check("Sat 23:00 → closed", !isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-08-01", "23:00", TZ)));
    check("Sun 00:00 (next day) → closed", !isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-08-02", "00:00", TZ)));
    check("Mon → closed", !isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-08-03", "12:00", TZ)));
    // Independent of the reminder cycle's own Thursday-08:00 "already opened"
    // adjustment — this window always anchors to THIS calendar week's Thursday,
    // so it must give the SAME answer regardless of activeCycleThursday's logic.
    check(
      "next week's Thursday window is independent of this week's",
      isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-08-06", "20:00", TZ)) &&
      !isMandatoryAvailabilityWindowOpen(zonedTimeToUtc("2026-08-04", "20:00", TZ)),
    );
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
