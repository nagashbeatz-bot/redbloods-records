/**
 * Pure logic for Shalev's weekly availability-reminder cycle — no
 * "server-only"/Supabase/push imports, mirrors lib/shalev-weekly-pure.ts and
 * lib/shalev-session-reminder-pure.ts's split so it's testable from a plain
 * tsx script AND safely importable from a client component (the "is my
 * current submission still valid for the active cycle" indicator reuses the
 * exact same hasValidSubmissionForCycle() the server job uses — one
 * definition, never two that could drift).
 *
 * Written artist-parameterized (slug) throughout so it's ready to extend to
 * another artist later — but every REAL invocation today (the cron wiring in
 * instrumentation.ts, the deep-link route) is hardcoded to Shalev only. See
 * lib/shalev-availability-reminder-notify.ts.
 */
import {
  MAX_ATTEMPTS,
  STUCK_PROCESSING_TIMEOUT_MS,
  classifyPushResult,
} from "@/lib/shalev-weekly-pure";

export { MAX_ATTEMPTS, STUCK_PROCESSING_TIMEOUT_MS, classifyPushResult };

export const TZ = "Asia/Jerusalem";

// ── Pure Israel-timezone date helpers (Date.UTC-anchored, DST-safe via Intl —
//    never a fixed UTC offset). Self-contained (not imported from
//    lib/red-artists/week.ts) because every function here must accept an
//    injectable `now` for unit testing, matching computeWeekRange(now, tz) in
//    lib/shalev-weekly-pure.ts — the client-facing week.ts helpers always use
//    the real wall clock and intentionally aren't `now`-parameterized. ──────

function ymdInTZ(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDaysYMD(ymd: string, n: number): string {
  const [y, m, day] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function dayOfWeek(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
}
function hmInTZ(d: Date, tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

// ── The availability-reminder CYCLE — resets Thursday 08:00 Israel time ────
//
// Deliberately SEPARATE from lib/red-artists/week.ts's availabilityWeekStart()
// (which drives the already-deployed "הזמינות שלי לשבוע הבא" form and flips on
// a different day — see the diagnosis in conversation). Reminders only ever
// fire Thu/Fri, a window where the two calculations agree anyway, so this
// never disagrees with what the form is showing at reminder-check time.

export interface Cycle { thursday: string; weekStart: string; weekEnd: string; }

/** The most recent Thursday whose 08:00 Israel-time cycle has already opened
 *  as of `now`. If `now` IS Thursday but before 08:00, the PREVIOUS
 *  Thursday's cycle (7 days earlier) is still the active one. */
export function activeCycleThursday(now: Date, tz: string = TZ): string {
  const today = ymdInTZ(now, tz);
  const dow = dayOfWeek(today);
  const daysSinceThu = (dow - 4 + 7) % 7; // Thu=4
  let thursday = addDaysYMD(today, -daysSinceThu);
  if (daysSinceThu === 0) {
    const { hour } = hmInTZ(now, tz);
    if (hour < 8) thursday = addDaysYMD(thursday, -7);
  }
  return thursday;
}

/** The active cycle's target week — Thursday + 3 days = the following Sunday,
 *  through the Saturday after it. */
export function activeCycle(now: Date, tz: string = TZ): Cycle {
  const thursday = activeCycleThursday(now, tz);
  const weekStart = addDaysYMD(thursday, 3);
  const weekEnd = addDaysYMD(weekStart, 6);
  return { thursday, weekStart, weekEnd };
}

/** The UTC instant the active cycle opened (that Thursday, 08:00 Israel). */
export function cycleStartInstant(now: Date, tz: string = TZ): Date {
  const thursday = activeCycleThursday(now, tz);
  return zonedTimeToUtc(thursday, "08:00", tz);
}

// ── Wall-clock (Israel) → UTC instant, DST-safe ─────────────────────────────
function tzOffsetMinutesAt(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - instant.getTime()) / 60000;
}
export function zonedTimeToUtc(date: string, hm: string, tz: string = TZ): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const offsetMin = tzOffsetMinutesAt(guess, tz);
  return new Date(guess.getTime() - offsetMin * 60000);
}

// ── The mandatory-availability-modal window: Thursday 20:00 → Saturday 21:00 ──
// (Israel time). Deliberately a FIXED clock hour, not an astronomical/Hebcal
// havdalah calculation — no such helper or library exists in this codebase,
// and the user explicitly approved 21:00 as the fixed "מוצאי שבת" cutoff for
// this specific modal rather than inventing one. Separate concept from the
// reminder-push cycle above (which stops at Friday 09:00) and from
// activeCycleThursday (whose "already opened" adjustment is cycle-specific,
// not relevant here) — this always anchors to THIS calendar week's Thursday.

/** [start, end) of the mandatory-availability-modal window containing `now`'s week. */
export function mandatoryAvailabilityWindow(now: Date, tz: string = TZ): { start: Date; end: Date } {
  const today = ymdInTZ(now, tz);
  const dow = dayOfWeek(today);
  const daysSinceThu = (dow - 4 + 7) % 7; // Thu=4; 0 if today IS Thursday
  const thursday = addDaysYMD(today, -daysSinceThu);
  const start = zonedTimeToUtc(thursday, "20:00", tz);
  const end = zonedTimeToUtc(addDaysYMD(thursday, 2), "21:00", tz); // Saturday, same week
  return { start, end };
}

/** True while `now` (Israel time) is inside the mandatory-availability window. */
export function isMandatoryAvailabilityWindowOpen(now: Date, tz: string = TZ): boolean {
  const { start, end } = mandatoryAvailabilityWindow(now, tz);
  const t = now.getTime();
  return t >= start.getTime() && t < end.getTime();
}

// ── The three reminder slots ────────────────────────────────────────────────

export type SlotId = "thu-1200" | "thu-1800" | "fri-0900";
export interface ReminderSlot { id: SlotId; dow: number; hour: number; }
// dow: Thu=4, Fri=5 — same 0=Sun..6=Sat convention used throughout this file.
export const REMINDER_SLOTS: ReminderSlot[] = [
  { id: "thu-1200", dow: 4, hour: 12 },
  { id: "thu-1800", dow: 4, hour: 18 },
  { id: "fri-0900", dow: 5, hour: 9 },
];
// A 15-minute window (not a single minute) — same resilience margin as
// shalev-weekly-pure.ts's Sunday 10:00–10:15 window, so a missed exact-minute
// tick (redeploy/crash) can still fire later in the same window. The DB claim
// (not this window check) is what prevents an actual duplicate send.
const WINDOW_MIN = 15;

/** True while `now` (Israel time) is inside `slot`'s window. */
export function isSlotDue(now: Date, slot: ReminderSlot, tz: string = TZ): boolean {
  const today = ymdInTZ(now, tz);
  if (dayOfWeek(today) !== slot.dow) return false;
  const { hour, minute } = hmInTZ(now, tz);
  return hour === slot.hour && minute >= 0 && minute <= WINDOW_MIN;
}

// ── "Has Shalev already sent a VALID submission for the active cycle?" ─────

export interface MinimalAvailabilityDay { available: boolean; from: string; }
export interface MinimalAvailability { days: MinimalAvailabilityDay[]; sentAt: string; }

/** A day counts iff marked available with a chosen start time — one entry per
 *  weekday in the stored array, so two different `from` times on the SAME day
 *  can never happen in this data shape (there is exactly one `from` field per
 *  day) — "two hours on one day" is structurally impossible here, not just
 *  disallowed by convention. */
export function countValidDays(days: MinimalAvailabilityDay[]): number {
  return days.filter((d) => d.available && d.from.trim() !== "").length;
}

/** True iff `sentAt` is at/after the active cycle's own open instant (Thursday
 *  08:00 Israel) — i.e. the stored record was actually submitted DURING this
 *  cycle, not carried over from a prior one. This is the SAME check the form
 *  uses to decide "show the stored days" vs "start blank" (a stale/prior-
 *  cycle record is never displayed as if it belongs to the new cycle) and
 *  that hasValidSubmissionForCycle below builds on — one definition, used by
 *  the form's load, the ≥2-day/valid check, and the reminder job alike. */
export function belongsToActiveCycle(sentAt: string | null | undefined, cycleStart: Date): boolean {
  if (!sentAt) return false;
  const sentAtMs = Date.parse(sentAt);
  return !Number.isNaN(sentAtMs) && sentAtMs >= cycleStart.getTime();
}

/** ≥2 distinct valid days, submitted at/after the active cycle's own start
 *  instant (Thursday 08:00 Israel) — a submission from a PRIOR cycle (stale
 *  `sentAt`) never counts, even if it happened to have ≥2 valid days. */
export function hasValidSubmissionForCycle(stored: MinimalAvailability | null, cycleStart: Date): boolean {
  if (!stored) return false;
  if (!belongsToActiveCycle(stored.sentAt, cycleStart)) return false;
  return countValidDays(stored.days) >= 2;
}

// ── Idempotency key — exact format requested ────────────────────────────────
// availability_reminder:{artistSlug}:{cycleWeekStart}:{slotId}
export function reminderClaimKey(artistSlug: string, cycleWeekStart: string, slotId: SlotId): string {
  return `availability_reminder:${artistSlug}:${cycleWeekStart}:${slotId}`;
}

// ── Message text (exact copy requested per slot) ────────────────────────────

export function buildReminderPush(slotId: SlotId): { title: string; body: string } {
  const body = "יש לבחור לפחות יומיים זמינים לשבוע הבא";
  if (slotId === "thu-1200") return { title: "שליו, הגיע הזמן לשלוח זמינות", body };
  if (slotId === "thu-1800") return { title: "עדיין לא שלחת זמינות", body };
  return { title: "תזכורת אחרונה לשליחת זמינות", body };
}

// ── Claim/retry decision (mirrors shalev-session-reminder-pure.ts's
//    decideClaimAction 1:1 — same shape, kept local so this module has no
//    cross-feature coupling beyond the shared MAX_ATTEMPTS/STUCK constants). ──

export interface ClaimValue {
  status: "processing" | "sent" | "failed";
  attempt_count: number;
  lastAttemptAt: string;
  [k: string]: unknown;
}
export interface ClaimResult { claimed: boolean; attempt: number; }
export type ClaimDecision =
  | { action: "insert" }
  | { action: "cas_update"; nextAttempt: number }
  | { action: "skip" };

export function decideClaimAction(
  existing: ClaimValue | null,
  now: Date,
  maxAttempts: number = MAX_ATTEMPTS,
  stuckTimeoutMs: number = STUCK_PROCESSING_TIMEOUT_MS,
): ClaimDecision {
  if (!existing) return { action: "insert" };
  if (existing.status === "sent") return { action: "skip" };

  if (existing.status === "processing") {
    const age = now.getTime() - new Date(existing.lastAttemptAt).getTime();
    if (!(age > stuckTimeoutMs)) return { action: "skip" };
    if (existing.attempt_count >= maxAttempts) return { action: "skip" };
    return { action: "cas_update", nextAttempt: existing.attempt_count + 1 };
  }
  if (existing.status === "failed") {
    if (existing.attempt_count >= maxAttempts) return { action: "skip" };
    return { action: "cas_update", nextAttempt: existing.attempt_count + 1 };
  }
  return { action: "skip" };
}

// ── Orchestration for ONE slot — injectable deps so branches are testable
//    without a real DB/webpush call. ─────────────────────────────────────────

export type SlotOutcome =
  | { kind: "not_due" }
  | { kind: "already_submitted" }
  | { kind: "skipped_duplicate" }
  | { kind: "sent" }
  | { kind: "no_subscription" | "send_failed"; final: boolean };

export interface PushLikePayload { title: string; body: string; url?: string; tag?: string; eventId?: string; }

export interface AvailabilityReminderDeps {
  fetchStored: () => Promise<MinimalAvailability | null>;
  claim: (key: string, now: Date) => Promise<ClaimResult>;
  markDone: (key: string, value: Record<string, unknown>) => Promise<void>;
  sendToShalev: (payload: PushLikePayload) => Promise<{ status: string }[]>;
  log: (msg: string) => void;
  logError: (msg: string, err?: unknown) => void;
}

/** Testable core for ONE slot (the caller decides `now`/`slot`/`artistSlug`).
 *  Checks the slot's window, then whether a valid submission already exists
 *  for the active cycle (skips with NO claim/DB write at all if so — the
 *  claim row is only ever touched when a push might actually be sent), then
 *  claims → sends → marks done. */
export async function processAvailabilityReminderSlot(
  now: Date,
  artistSlug: string,
  slot: ReminderSlot,
  deps: AvailabilityReminderDeps,
): Promise<SlotOutcome> {
  if (!isSlotDue(now, slot)) return { kind: "not_due" };

  const cycle = activeCycle(now);
  const cycleStart = cycleStartInstant(now);
  const stored = await deps.fetchStored();
  if (hasValidSubmissionForCycle(stored, cycleStart)) {
    deps.log(`${slot.id}: valid submission already exists for cycle ${cycle.weekStart} — no claim, no push`);
    return { kind: "already_submitted" };
  }

  const key = reminderClaimKey(artistSlug, cycle.weekStart, slot.id);
  const claim = await deps.claim(key, now);
  if (!claim.claimed) {
    deps.log(`${key} not claimed (already sent, or a concurrent run/attempt holds it) — skipping`);
    return { kind: "skipped_duplicate" };
  }
  const isFinalAttempt = claim.attempt >= MAX_ATTEMPTS;
  const nowIso = now.toISOString();
  const push = buildReminderPush(slot.id);

  try {
    const results = await deps.sendToShalev({ ...push, tag: `availability-reminder-${slot.id}`, eventId: key });
    const cls = classifyPushResult(results);

    if (cls === "sent") {
      await deps.markDone(key, {
        status: "sent", artistSlug, weekStart: cycle.weekStart, slot: slot.id,
        attempt_count: claim.attempt, lastAttemptAt: nowIso,
      });
      deps.log(`sent ${slot.id} reminder to Shalev for cycle ${cycle.weekStart}, attempt ${claim.attempt}`);
      return { kind: "sent" };
    }

    await deps.markDone(key, {
      status: "failed", artistSlug, weekStart: cycle.weekStart, slot: slot.id,
      reason: cls, attempt_count: claim.attempt, lastAttemptAt: nowIso,
    });
    deps.logError(
      `attempt ${claim.attempt}/${MAX_ATTEMPTS} FAILED to reach Shalev (${cls}) for ${slot.id}, cycle ${cycle.weekStart}` +
      (isFinalAttempt ? " — attempts exhausted" : " — will retry within the window"),
    );
    return { kind: cls, final: isFinalAttempt };
  } catch (err) {
    deps.logError(`availability-reminder job crashed (attempt ${claim.attempt}/${MAX_ATTEMPTS}) for ${slot.id}`, err);
    await deps.markDone(key, {
      status: "failed", artistSlug, weekStart: cycle.weekStart, slot: slot.id,
      reason: "crashed", attempt_count: claim.attempt, lastAttemptAt: nowIso,
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
    throw err;
  }
}
