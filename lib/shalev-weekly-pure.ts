/**
 * Pure logic for the Shalev weekly sessions summary — deliberately has NO
 * "server-only" / Supabase / push imports, so it can be imported both from the
 * real server module (lib/shalev-weekly-notify.ts) AND from a plain tsx test
 * script (scripts/test-shalev-weekly.ts), which cannot load "server-only" at
 * all outside Next's bundler.
 */

export const TZ = "Asia/Jerusalem";
const HEB_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
export const SHALEV_SCHEDULE_URL = "/red-artists?tab=schedule"; // same deep-link lib/session-notify.ts uses

// A week's job may retry up to this many total attempts (explicit failures AND
// crash/stuck recoveries count uniformly toward this cap — see JobDeps.claimWeek).
export const MAX_ATTEMPTS = 3;
// A "processing" claim older than this is presumed crashed (never reached
// markWeekDone) and becomes eligible for atomic recovery — short enough to allow
// several recovery attempts inside the 15-minute run window, long enough that a
// normal run (a few DB/push round-trips) is never mistaken for stuck.
export const STUCK_PROCESSING_TIMEOUT_MS = 3 * 60 * 1000;

// ── Pure date helpers (Asia/Jerusalem, DST-safe via Intl — never a fixed UTC offset) ──

function ymdInTZ(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function addDaysYMD(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function dayOfWeek(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sunday .. 6=Saturday
}
function dayName(ymd: string): string {
  return HEB_DAYS[dayOfWeek(ymd)] ?? "";
}
function hm(t: string | null): string {
  return (t ?? "").slice(0, 5); // "18:00:00" / "18:00" → "18:00"
}

export interface WeekRange { weekStart: string; weekEnd: string; }

/** The Sunday–Saturday week containing `now`, computed in Asia/Jerusalem.
 *  Pure function of `now` — directly unit-testable, no wall-clock dependency. */
export function computeWeekRange(now: Date, tz: string = TZ): WeekRange {
  const today = ymdInTZ(now, tz);
  const weekStart = addDaysYMD(today, -dayOfWeek(today));
  const weekEnd = addDaysYMD(weekStart, 6);
  return { weekStart, weekEnd };
}

/** True during the Sunday 10:00–10:15 (inclusive) Asia/Jerusalem window — the
 *  cron tick calls this every minute and only proceeds while it's true. A
 *  window (not a single minute) gives a missed-10:00 tick (redeploy, crash,
 *  restart) a chance to still fire via a later minute in the same window;
 *  the DB claim (not this window check) is what prevents a duplicate SEND. */
export function isShalevWeeklyWindowOpen(now: Date, tz: string = TZ): boolean {
  const dow = now.toLocaleString("en-US", { timeZone: tz, weekday: "short" }); // "Sun".."Sat"
  const hm2 = now.toLocaleString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = hm2.split(":").map(Number);
  return dow === "Sun" && h === 10 && m >= 0 && m <= 15;
}

// ── Sessions (canonical read, mirrors shalev-summary's ownership + status rule) ──
//
// IMPORTANT: the connection to `projects` is used ONLY to determine which
// sessions belong to Shalev (project_id membership, per the ownership rule
// /api/red-artists/shalev-summary already uses). It must NEVER be used to
// build the notification TEXT — the title comes exclusively from the
// session's own `session_type` / `title` fields, never `projects.name`,
// never an artist/song name. This was a real bug found in production data:
// a session with `title=null, session_type="סשן"` was resolving its display
// text to the LINKED PROJECT's name ("חלהס אמפיאנו") because the old title
// fallback chain included `projectNameById.get(project_id)`. Fixed by
// removing project data from ShalevSessionInfo/mapSessionRows entirely —
// there is no `projectNameById` parameter anymore, so it's structurally
// impossible for a project name to leak into the title again.

export interface ShalevSessionInfo {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string; // ALWAYS derived from session_type/title only — see note above
}

export interface RawSessionRow {
  id: string;
  title: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  session_type: string | null;
  status: string | null;
}

/** Pure: exclude cancelled sessions, resolve display title from SESSION fields
 *  ONLY (session_type first, then title, else the literal word "סשן" — never
 *  a project/artist/song name), sort chronologically. Exported so "cancelled
 *  excluded" / "sorted soonest-first" / "no project name" are directly
 *  unit-testable without a database. */
export function mapSessionRows(rows: RawSessionRow[]): ShalevSessionInfo[] {
  return rows
    .filter((r) => r.status !== "בוטל" && !!r.date)
    .map((r) => ({
      id: r.id,
      date: r.date as string,
      startTime: r.start_time,
      endTime: r.end_time,
      title: (r.session_type || "").trim() || (r.title || "").trim() || "סשן",
    }))
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : (a.startTime ?? "").localeCompare(b.startTime ?? "")));
}

// ── Message text (exact copy requested) ──────────────────────────────────────

const MAX_LINES = 4; // cap so the push body never grows unbounded

function formatSessionLine(s: ShalevSessionInfo): string {
  const day = dayName(s.date);
  const time = hm(s.startTime);
  const head = time ? `יום ${day} ב־${time}` : `יום ${day}`;
  return `${head} — ${s.title}`;
}

/** Pure: builds the exact Shalev-facing push body (singular/plural + line cap). */
export function buildShalevBody(sessions: ShalevSessionInfo[]): string {
  const intro = sessions.length === 1 ? "השבוע מחכה לך סשן אחד:" : `השבוע מחכים לך ${sessions.length} סשנים:`;
  const shown = sessions.slice(0, MAX_LINES).map(formatSessionLine);
  const extra = sessions.length - shown.length;
  const tail = extra <= 0 ? [] : extra === 1 ? ["ועוד סשן אחד"] : [`ועוד ${extra} נוספים`];
  return [intro, ...shown, ...tail].join("\n");
}

/** Owner ack body — singular/plural Hebrew (count=1 gets its own sentence, not "1 סשנים"). */
export function buildOwnerAckBody(count: number): string {
  return count === 1 ? "נשלח לשליו סשן אחד לשבוע הקרוב." : `נשלחו לשליו ${count} סשנים לשבוע הקרוב.`;
}

// ── Push-result classification (pure) ────────────────────────────────────────

/** Distinguishes "no active subscription" (empty results) from "webpush actually
 *  failed" (results exist, none fulfilled) — used to pick the right owner message. */
export function classifyPushResult(results: { status: string }[]): "sent" | "no_subscription" | "send_failed" {
  if (results.length === 0) return "no_subscription";
  return results.some((r) => r.status === "fulfilled") ? "sent" : "send_failed";
}

export type FailReason = "no_subscription" | "send_failed";

export type WeeklyOutcome =
  | { kind: "skipped_duplicate" }
  | { kind: "no_sessions" }
  | { kind: "sent"; count: number }
  | { kind: "no_subscription"; count: number; final: boolean }
  | { kind: "send_failed"; count: number; final: boolean };

// ── Orchestration — injectable deps so the branches are testable without a
//    real DB/webpush call; lib/shalev-weekly-notify.ts supplies real deps. ──

export interface ClaimResult {
  claimed: boolean;
  attempt: number; // meaningful only when claimed=true; 1-based
}

export interface PushLikePayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  eventId?: string;
}

export interface JobDeps {
  fetchSessions: (weekStart: string, weekEnd: string) => Promise<ShalevSessionInfo[]>;
  /** Atomic claim/retry-claim for this week. See lib/shalev-weekly-notify.ts's
   *  claimWeekReal for the real (Postgres CAS-based) implementation and the
   *  exact state machine this must implement. */
  claimWeek: (key: string, now: Date) => Promise<ClaimResult>;
  markWeekDone: (key: string, value: Record<string, unknown>) => Promise<void>;
  sendToShalev: (payload: PushLikePayload) => Promise<{ status: string }[]>;
  sendOwnerAck: (count: number, weekStart: string) => Promise<void>;
  /** Called ONLY when attempts are exhausted (or this is otherwise the final
   *  attempt) — never once per failed attempt, so the owner is never spammed. */
  sendOwnerFail: (reason: FailReason, count: number, weekStart: string) => Promise<void>;
  log: (msg: string) => void;
  logError: (msg: string, err?: unknown) => void;
}

/** Testable core: given `now` + deps, runs the full decision tree. Pass fake
 *  deps in tests to exercise every branch with zero real DB/push calls. */
export async function runShalevWeeklySessionsJobCore(now: Date, deps: JobDeps): Promise<WeeklyOutcome> {
  const { weekStart, weekEnd } = computeWeekRange(now);
  const claimKey = `shalev_weekly_sessions:${weekStart}`;

  const claim = await deps.claimWeek(claimKey, now);
  if (!claim.claimed) {
    deps.log(`${claimKey} not claimed (already sent/no_sessions/exhausted, or a concurrent run holds it) — skipping`);
    return { kind: "skipped_duplicate" };
  }
  const isFinalAttempt = claim.attempt >= MAX_ATTEMPTS;
  const nowIso = now.toISOString();

  try {
    const sessions = await deps.fetchSessions(weekStart, weekEnd);
    if (sessions.length === 0) {
      deps.log(`no sessions for week ${weekStart}..${weekEnd} — no push sent (attempt ${claim.attempt})`);
      await deps.markWeekDone(claimKey, { status: "no_sessions", weekStart, weekEnd, attempt_count: claim.attempt, lastAttemptAt: nowIso });
      return { kind: "no_sessions" };
    }

    const body = buildShalevBody(sessions);
    const results = await deps.sendToShalev({
      title: "שבוע טוב שליו 🎶",
      body,
      url: SHALEV_SCHEDULE_URL,
      tag: `shalev-weekly-${weekStart}`,
      eventId: claimKey,
    });
    const cls = classifyPushResult(results);

    if (cls === "sent") {
      await deps.sendOwnerAck(sessions.length, weekStart);
      await deps.markWeekDone(claimKey, { status: "sent", weekStart, weekEnd, count: sessions.length, attempt_count: claim.attempt, lastAttemptAt: nowIso });
      deps.log(`sent to Shalev: ${sessions.length} session(s), week ${weekStart}, attempt ${claim.attempt}`);
      return { kind: "sent", count: sessions.length };
    } else {
      if (isFinalAttempt) await deps.sendOwnerFail(cls, sessions.length, weekStart);
      await deps.markWeekDone(claimKey, {
        status: "failed", weekStart, weekEnd, reason: cls, count: sessions.length, attempt_count: claim.attempt, lastAttemptAt: nowIso,
      });
      deps.logError(
        `attempt ${claim.attempt}/${MAX_ATTEMPTS} FAILED to reach Shalev (${cls}) for week ${weekStart}` +
        (isFinalAttempt ? " — attempts exhausted, owner notified" : " — will retry within the window"),
      );
      return { kind: cls, count: sessions.length, final: isFinalAttempt };
    }
  } catch (err) {
    deps.logError(`job crashed (attempt ${claim.attempt}/${MAX_ATTEMPTS}) for week ${weekStart}`, err);
    if (isFinalAttempt) await deps.sendOwnerFail("send_failed", 0, weekStart).catch(() => {});
    await deps.markWeekDone(claimKey, {
      status: "failed", weekStart, weekEnd, reason: "crashed", attempt_count: claim.attempt, lastAttemptAt: nowIso,
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
    throw err;
  }
}
