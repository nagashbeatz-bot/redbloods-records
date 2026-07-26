/**
 * Pure logic for Shalev's per-session pre-session reminder (T-3h) — no
 * "server-only"/Supabase/push imports, mirrors lib/shalev-weekly-pure.ts's
 * split so it's testable from a plain tsx script. The real Supabase/push
 * wiring lives in lib/shalev-session-reminder-notify.ts.
 */
import {
  MAX_ATTEMPTS,
  STUCK_PROCESSING_TIMEOUT_MS,
  classifyPushResult,
} from "@/lib/shalev-weekly-pure";

export { MAX_ATTEMPTS, STUCK_PROCESSING_TIMEOUT_MS, classifyPushResult };

export const TZ = "Asia/Jerusalem";
export const REMINDER_HOURS_BEFORE = 3;

// ── Sessions (canonical read shape) ──────────────────────────────────────────

export interface RawSessionRow {
  id: string;
  date: string | null;
  start_time: string | null;
  status: string | null;
}

export interface ShalevReminderSession {
  id: string;
  date: string;
  startTime: string; // "HH:mm"
}

/** Pure: exclude cancelled/dateless/timeless sessions — a reminder needs both
 *  a concrete date AND start_time to compute a fire instant. */
export function mapReminderSessionRows(rows: RawSessionRow[]): ShalevReminderSession[] {
  return rows
    .filter((r) => r.status !== "בוטל" && !!r.date && !!r.start_time)
    .map((r) => ({
      id: r.id,
      date: r.date as string,
      startTime: (r.start_time as string).slice(0, 5),
    }));
}

// ── Timezone math (DST-safe via Intl — never a fixed UTC offset) ────────────

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

/** IANA-zone wall-clock (date + "HH:mm") → the UTC instant it represents. */
export function zonedTimeToUtc(date: string, hm: string, tz: string = TZ): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const offsetMin = tzOffsetMinutesAt(guess, tz);
  return new Date(guess.getTime() - offsetMin * 60000);
}

/** Pure: true iff `now` falls within [sessionStart - Nh, sessionStart) — the
 *  live send window. Never fires at/after the session's own start time, no
 *  matter how long a catch-up gap (e.g. a server outage) there was. */
export function isReminderDue(now: Date, sessionStartUtc: Date, hoursBefore: number = REMINDER_HOURS_BEFORE): boolean {
  const reminderAt = new Date(sessionStartUtc.getTime() - hoursBefore * 3600000);
  return now.getTime() >= reminderAt.getTime() && now.getTime() < sessionStartUtc.getTime();
}

// ── Idempotency key ──────────────────────────────────────────────────────────

/** Includes date+startTime so a rescheduled session naturally opens a FRESH
 *  key — a "sent" reminder for the OLD time never blocks (or duplicates) the
 *  reminder for the NEW time, and a stale key for a no-longer-current time is
 *  simply never revisited again. */
export function reminderClaimKey(sessionId: string, date: string, startTime: string): string {
  return `shalev_session_reminder:${sessionId}:${date}:${startTime}`;
}

// ── Claim/retry decision (mirrors shalev-weekly-notify.ts's claimWeekReal 1:1) ──

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

/** Pure decision: given the EXISTING claim row's value (or null if no row
 *  exists yet), what should happen next? Separated out so the branch logic is
 *  directly unit-testable without a database; the real INSERT/CAS-UPDATE
 *  wiring lives in lib/shalev-session-reminder-notify.ts. */
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
    if (!(age > stuckTimeoutMs)) return { action: "skip" }; // fresh — may genuinely be in flight
    if (existing.attempt_count >= maxAttempts) return { action: "skip" }; // stuck AND exhausted
    return { action: "cas_update", nextAttempt: existing.attempt_count + 1 };
  }
  if (existing.status === "failed") {
    if (existing.attempt_count >= maxAttempts) return { action: "skip" };
    return { action: "cas_update", nextAttempt: existing.attempt_count + 1 };
  }
  return { action: "skip" }; // unknown/unexpected value — fail safe, no retry
}

// ── Message text (exact copy requested) ──────────────────────────────────────

/** Never includes project/song/notes — startTime is the only variable. */
export function buildShalevReminderPush(startTime: string): { title: string; body: string } {
  return { title: "תזכורת לסשן 🎙️", body: `היום יש לך סשן בשעה ${startTime} 🔥` };
}

/** Confirms the SEND succeeded — not that Shalev opened/read it. */
export function buildOwnerAckPush(startTime: string): { title: string; body: string } {
  return { title: "התזכורת נשלחה לשליו ✅", body: `תזכורת לסשן היום בשעה ${startTime} נשלחה בהצלחה.` };
}

// ── Orchestration for ONE session — injectable deps so branches are testable
//    without a real DB/webpush call; lib/shalev-session-reminder-notify.ts
//    supplies real deps. ──

export type ReminderOutcome =
  | { kind: "skipped_duplicate" }
  | { kind: "sent" }
  | { kind: "no_subscription" | "send_failed"; final: boolean };

export interface PushLikePayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  eventId?: string;
}

export interface ReminderDeps {
  claim: (key: string, now: Date) => Promise<ClaimResult>;
  markDone: (key: string, value: Record<string, unknown>) => Promise<void>;
  sendToShalev: (payload: PushLikePayload) => Promise<{ status: string }[]>;
  sendOwnerAck: (startTime: string, key: string) => Promise<void>;
  log: (msg: string) => void;
  logError: (msg: string, err?: unknown) => void;
}

/** Testable core for ONE eligible (already window-checked) session: claim →
 *  send → owner-ack → mark done. */
export async function processSessionReminderCore(
  session: ShalevReminderSession,
  now: Date,
  deps: ReminderDeps,
): Promise<ReminderOutcome> {
  const key = reminderClaimKey(session.id, session.date, session.startTime);
  const claim = await deps.claim(key, now);
  if (!claim.claimed) {
    deps.log(`${key} not claimed (already sent, or a concurrent run/attempt holds it) — skipping`);
    return { kind: "skipped_duplicate" };
  }
  const isFinalAttempt = claim.attempt >= MAX_ATTEMPTS;
  const nowIso = now.toISOString();
  const push = buildShalevReminderPush(session.startTime);

  try {
    const results = await deps.sendToShalev({ ...push, tag: `session-reminder-${session.id}`, eventId: key });
    const cls = classifyPushResult(results);

    if (cls === "sent") {
      await deps.sendOwnerAck(session.startTime, key);
      await deps.markDone(key, {
        status: "sent", sessionId: session.id, date: session.date, startTime: session.startTime,
        attempt_count: claim.attempt, lastAttemptAt: nowIso,
      });
      deps.log(`sent reminder to Shalev for session ${session.id} @ ${session.startTime}, attempt ${claim.attempt}`);
      return { kind: "sent" };
    }

    await deps.markDone(key, {
      status: "failed", sessionId: session.id, date: session.date, startTime: session.startTime,
      reason: cls, attempt_count: claim.attempt, lastAttemptAt: nowIso,
    });
    deps.logError(
      `attempt ${claim.attempt}/${MAX_ATTEMPTS} FAILED to reach Shalev (${cls}) for session ${session.id}` +
      (isFinalAttempt ? " — attempts exhausted" : " — will retry next tick"),
    );
    return { kind: cls, final: isFinalAttempt };
  } catch (err) {
    deps.logError(`reminder job crashed (attempt ${claim.attempt}/${MAX_ATTEMPTS}) for session ${session.id}`, err);
    await deps.markDone(key, {
      status: "failed", sessionId: session.id, date: session.date, startTime: session.startTime,
      reason: "crashed", attempt_count: claim.attempt, lastAttemptAt: nowIso,
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
    throw err;
  }
}
