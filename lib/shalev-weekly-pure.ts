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

/** True only during the Sunday 10:00 Asia/Jerusalem minute — the cron tick calls
 *  this every minute and only proceeds when it returns true. */
export function isShalevWeeklyDue(now: Date, tz: string = TZ): boolean {
  const dow = now.toLocaleString("en-US", { timeZone: tz, weekday: "short" }); // "Sun".."Sat"
  const time = now.toLocaleString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  return dow === "Sun" && time === "10:00";
}

// ── Sessions (canonical read, mirrors shalev-summary's ownership + status rule) ──

export interface ShalevSessionInfo {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
}

export interface RawSessionRow {
  id: string;
  project_id: string | null;
  title: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  session_type: string | null;
  status: string | null;
}

/** Pure: exclude cancelled sessions, resolve display title, sort chronologically.
 *  Exported so "cancelled excluded" / "sorted soonest-first" are directly
 *  unit-testable without a database. */
export function mapSessionRows(rows: RawSessionRow[], projectNameById: Map<string, string>): ShalevSessionInfo[] {
  return rows
    .filter((r) => r.status !== "בוטל" && !!r.date)
    .map((r) => ({
      id: r.id,
      date: r.date as string,
      startTime: r.start_time,
      endTime: r.end_time,
      title: r.title || (r.project_id ? projectNameById.get(r.project_id) : null) || r.session_type || "סשן",
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

// ── Push-result classification (pure) ────────────────────────────────────────

/** Distinguishes "no active subscription" (empty results) from "webpush actually
 *  failed" (results exist, none fulfilled) — used to pick the right owner message. */
export function classifyPushResult(results: { status: string }[]): "sent" | "no_subscription" | "send_failed" {
  if (results.length === 0) return "no_subscription";
  return results.some((r) => r.status === "fulfilled") ? "sent" : "send_failed";
}

export type WeeklyOutcome =
  | { kind: "skipped_duplicate" }
  | { kind: "no_sessions" }
  | { kind: "sent"; count: number }
  | { kind: "no_subscription"; count: number }
  | { kind: "send_failed"; count: number };

// ── Orchestration — injectable deps so the branches are testable without a
//    real DB/webpush call; lib/shalev-weekly-notify.ts supplies real deps. ──

export interface PushLikePayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  eventId?: string;
}

export interface JobDeps {
  fetchSessions: (weekStart: string, weekEnd: string) => Promise<ShalevSessionInfo[]>;
  claimWeek: (key: string) => Promise<boolean>; // true = claimed now, proceed
  markWeekDone: (key: string, value: Record<string, unknown>) => Promise<void>;
  sendToShalev: (payload: PushLikePayload) => Promise<{ status: string }[]>;
  sendOwnerAck: (count: number, weekStart: string) => Promise<void>;
  sendOwnerFail: (reason: "no_subscription" | "send_failed", count: number, weekStart: string) => Promise<void>;
  log: (msg: string) => void;
  logError: (msg: string, err?: unknown) => void;
}

/** Testable core: given `now` + deps, runs the full decision tree. Pass fake
 *  deps in tests to exercise every branch with zero real DB/push calls. */
export async function runShalevWeeklySessionsJobCore(now: Date, deps: JobDeps): Promise<WeeklyOutcome> {
  const { weekStart, weekEnd } = computeWeekRange(now);
  const claimKey = `shalev_weekly_sessions:${weekStart}`;

  const claimed = await deps.claimWeek(claimKey);
  if (!claimed) {
    deps.log(`${claimKey} already claimed — skipping (no duplicate send)`);
    return { kind: "skipped_duplicate" };
  }

  try {
    const sessions = await deps.fetchSessions(weekStart, weekEnd);
    if (sessions.length === 0) {
      deps.log(`no sessions for week ${weekStart}..${weekEnd} — no push sent`);
      await deps.markWeekDone(claimKey, { status: "no_sessions", weekStart, weekEnd });
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
      await deps.markWeekDone(claimKey, { status: "sent", weekStart, weekEnd, count: sessions.length });
      deps.log(`sent to Shalev: ${sessions.length} session(s), week ${weekStart}`);
      return { kind: "sent", count: sessions.length };
    } else {
      await deps.sendOwnerFail(cls, sessions.length, weekStart);
      await deps.markWeekDone(claimKey, { status: "failed", weekStart, weekEnd, reason: cls, count: sessions.length });
      deps.logError(`FAILED to reach Shalev (${cls}) for week ${weekStart} — ${sessions.length} session(s) found`);
      return { kind: cls, count: sessions.length };
    }
  } catch (err) {
    deps.logError(`job crashed for week ${weekStart}`, err);
    await deps.markWeekDone(claimKey, {
      status: "error", weekStart, weekEnd, error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
    throw err;
  }
}
