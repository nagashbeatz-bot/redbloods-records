/**
 * Pure logic for Steven's daily deadline digest — no "server-only"/Supabase/push
 * imports, testable from a plain tsx script (mirrors the split used by
 * lib/steven-mix-reminder-pure.ts / lib/shalev-weekly-pure.ts).
 *
 * Once a day, at 09:00 America/New_York (Steven is in Maryland), summarize his
 * OPEN sound_engineer_work rows into three buckets — overdue / due today / due
 * tomorrow — and push it to him. On a CONFIRMED successful delivery to Steven,
 * push a Hebrew confirmation to the owner. If nothing is relevant that day,
 * nothing is sent to either of them and no daily claim is taken (see
 * runDigestTick's empty_no_claim outcome).
 *
 * "Open" reuses the EXISTING closed-status definition from
 * lib/steven-mix-reminder-pure.ts (isClosedStatus: DB "אושר" or "בוטל") — this
 * file must never diverge from that definition of "done".
 *
 * All calendar-day arithmetic is DST-safe: `ymdInTZ` reads wall-clock date via
 * Intl with an explicit timeZone (never a fixed UTC offset — see the bug found
 * in app/api/agent/check/route.ts's `(now.getUTCHours()+3)%24`, which this
 * deliberately does NOT copy), and `addDaysYMD` does pure UTC-anchored
 * calendar-day math on the resulting YYYY-MM-DD string (same pattern as
 * lib/shalev-weekly-pure.ts / lib/red-artists/week.ts).
 */
import { isClosedStatus, classifyPushResult } from "@/lib/steven-mix-reminder-pure";

export { isClosedStatus, classifyPushResult };

export const TZ = "America/New_York";

// ── Pure date helpers (DST-safe via Intl — never a fixed UTC offset) ──────────

/** `now`'s calendar date in `tz`, as YYYY-MM-DD. */
export function ymdInTZ(d: Date, tz: string = TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Add (or subtract) whole calendar days to a YYYY-MM-DD string — pure UTC-anchored
 *  arithmetic on the string, no timezone involved once we have the YMD. */
export function addDaysYMD(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** 09:00–09:15 America/New_York — a window (not a single minute), same shape as
 *  isWeekStrengthCheckWindowOpen / isShalevWeeklyWindowOpen, so a missed tick
 *  (redeploy/crash right at 09:00) can still fire later in the same window. The
 *  atomic daily claim (see runDigestTick) is what actually prevents more than
 *  one send per calendar day — this window only decides WHEN to attempt it. */
export function isDigestWindowOpen(now: Date, tz: string = TZ): boolean {
  const hm = now.toLocaleString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = hm.split(":").map(Number);
  return h === 9 && m >= 0 && m <= 15;
}

/** One settings key per calendar day (America/New_York) — the atomic claim that
 *  guarantees at most one Steven deadline push per day, persisted in the
 *  EXISTING settings key/value table (no schema change). */
export function digestClaimKey(todayYmd: string): string {
  return `steven_deadline_digest:${todayYmd}`;
}

// ── Grouping ───────────────────────────────────────────────────────────────────

export interface DigestWork {
  id: string;
  /** stevenDisplayName(work) from lib/sound-engineer-store.ts — the name Steven
   *  actually sees. Never re-derived here. */
  displayName: string;
  internalDeadline: string | null; // YYYY-MM-DD
  status: string; // raw sound_engineer_work.status (DB enum)
}

export interface GroupedDigest {
  overdue: DigestWork[];
  dueToday: DigestWork[];
  dueTomorrow: DigestWork[];
}

/** Open (not closed) works with a deadline, bucketed by internalDeadline vs.
 *  todayYmd/tomorrowYmd (both YYYY-MM-DD in the SAME timezone, i.e. always
 *  America/New_York for this feature). A work with no deadline is excluded, a
 *  closed work ("אושר"/"בוטל") is excluded regardless of its deadline. */
export function groupWorksForDigest(
  works: DigestWork[],
  todayYmd: string,
  tomorrowYmd: string,
): GroupedDigest {
  const open = works.filter((w) => !isClosedStatus(w.status) && !!w.internalDeadline);
  return {
    overdue:     open.filter((w) => w.internalDeadline! < todayYmd),
    dueToday:    open.filter((w) => w.internalDeadline === todayYmd),
    dueTomorrow: open.filter((w) => w.internalDeadline === tomorrowYmd),
  };
}

export function isDigestEmpty(g: GroupedDigest): boolean {
  return g.overdue.length === 0 && g.dueToday.length === 0 && g.dueTomorrow.length === 0;
}

export function totalDigestCount(g: GroupedDigest): number {
  return g.overdue.length + g.dueToday.length + g.dueTomorrow.length;
}

// ── Text building ──────────────────────────────────────────────────────────────

/** "A, B, C and N more" — same truncate-list idiom as the Hebrew
 *  "ועוד N" branch in lib/agent/rules.ts's checkOverdueProjects bulk builder,
 *  just in English for Steven's audience. */
export function formatNameList(names: string[], maxShown = 3): string {
  const clean = names.map((n) => (n ?? "").trim()).filter(Boolean);
  if (clean.length <= maxShown) return clean.join(", ");
  const shown = clean.slice(0, maxShown).join(", ");
  const rest = clean.length - maxShown;
  return `${shown} and ${rest} more`;
}

export const STEVEN_DIGEST_TITLE = "📅 Your deadline summary";
export const OWNER_DIGEST_TITLE  = "✅ סיכום הדדליינים נשלח לסטיבן";

/** Steven-facing body — English, one line per NON-empty category only. */
export function buildStevenDigestBody(g: GroupedDigest): string {
  const lines: string[] = [];
  if (g.overdue.length)     lines.push(`🔴 Overdue: ${formatNameList(g.overdue.map((w) => w.displayName))}`);
  if (g.dueToday.length)    lines.push(`🟠 Due today: ${formatNameList(g.dueToday.map((w) => w.displayName))}`);
  if (g.dueTomorrow.length) lines.push(`🟡 Due tomorrow: ${formatNameList(g.dueTomorrow.map((w) => w.displayName))}`);
  return lines.join("\n");
}

/** Owner-facing confirmation body — Hebrew, only non-zero counts shown. */
export function buildOwnerConfirmationBody(g: GroupedDigest): string {
  const parts: string[] = [];
  if (g.overdue.length)     parts.push(`${g.overdue.length} באיחור`);
  if (g.dueToday.length)    parts.push(`${g.dueToday.length} להיום`);
  if (g.dueTomorrow.length) parts.push(`${g.dueTomorrow.length} למחר`);
  return `נשלח לסטיבן סיכום: ${parts.join(" · ")}`;
}

/** Exactly one relevant work → deep-link straight to it (the EXISTING, already
 *  wired ?work= param — StevenProfilePage.tsx reads it). 2+ → the plain page;
 *  there is no existing multi-work deep-link and this deliberately does not
 *  invent one. */
export function digestUrl(g: GroupedDigest): string {
  const all = [...g.overdue, ...g.dueToday, ...g.dueTomorrow];
  return all.length === 1 ? `/team/steven?work=${all[0].id}` : "/team/steven";
}

// ── Orchestration — injectable deps so the whole flow (incl. the atomic claim
//    and the "confirm owner only after confirmed Steven delivery" rule) is
//    testable without a real DB/webpush call. Mirrors processReminderCycle's
//    shape in lib/steven-mix-reminder-pure.ts exactly. ──────────────────────────

export interface PushPayload { title: string; body: string; url: string; tag: string }

export interface DigestDeps {
  /** Cheap existence check for today's claim key — avoids re-fetching works on
   *  every one-minute tick for the rest of the 15-minute window once a claim
   *  already exists (whatever its outcome). NOT the source of atomicity —
   *  claimDay is. */
  hasClaimForToday: (key: string) => Promise<boolean>;
  fetchStevenWorks: () => Promise<DigestWork[]>;
  /** Atomic INSERT-first claim (true = won it, false = someone else already
   *  holds it for today — a concurrent tick/instance, or a genuine restart). */
  claimDay: (key: string, now: Date) => Promise<boolean>;
  markDayResult: (key: string, value: Record<string, unknown>) => Promise<void>;
  sendToSteven: (push: PushPayload) => Promise<{ status: string }[]>;
  sendToOwner: (push: PushPayload) => Promise<void>;
  log: (msg: string) => void;
  logError: (msg: string, err?: unknown) => void;
}

export type DigestOutcome =
  | { kind: "not_due" }
  | { kind: "already_attempted_today" }
  | { kind: "empty_no_claim" }
  | { kind: "lost_race" }
  | { kind: "steven_no_subscription" }
  | { kind: "steven_send_failed" }
  | { kind: "sent_both" };

export async function runDigestTick(now: Date, deps: DigestDeps): Promise<DigestOutcome> {
  if (!isDigestWindowOpen(now)) return { kind: "not_due" };

  const todayYmd    = ymdInTZ(now, TZ);
  const tomorrowYmd = addDaysYMD(todayYmd, 1);
  const key         = digestClaimKey(todayYmd);

  if (await deps.hasClaimForToday(key)) {
    deps.log(`already attempted for ${todayYmd} — skipping`);
    return { kind: "already_attempted_today" };
  }

  const works  = await deps.fetchStevenWorks();
  const groups = groupWorksForDigest(works, todayYmd, tomorrowYmd);

  if (isDigestEmpty(groups)) {
    deps.log(`nothing overdue/due-today/due-tomorrow for ${todayYmd} — no push, no claim taken`);
    return { kind: "empty_no_claim" };
  }

  const claimed = await deps.claimDay(key, now);
  if (!claimed) {
    deps.log(`${key} not claimed (already sent, or a concurrent tick holds it) — skipping`);
    return { kind: "lost_race" };
  }

  const stevenPush: PushPayload = {
    title: STEVEN_DIGEST_TITLE,
    body:  buildStevenDigestBody(groups),
    url:   digestUrl(groups),
    tag:   "steven-deadline-digest",
  };

  const results = await deps.sendToSteven(stevenPush);
  const cls = classifyPushResult(results);

  await deps.markDayResult(key, {
    status: cls === "sent" ? "sent" : "failed",
    reason: cls,
    counts: { overdue: groups.overdue.length, dueToday: groups.dueToday.length, dueTomorrow: groups.dueTomorrow.length },
    at: now.toISOString(),
  });

  // The owner confirmation is gated on a REAL delivery signal (at least one
  // fulfilled webpush.sendNotification to a "steven" subscription) — never on
  // "the function was called". No subscription at all and an outright send
  // failure are reported distinctly, but both skip the owner push the same way.
  if (cls !== "sent") {
    deps.logError(`Steven push not delivered (${cls}) for ${todayYmd} — owner confirmation skipped`);
    return { kind: cls === "no_subscription" ? "steven_no_subscription" : "steven_send_failed" };
  }

  try {
    await deps.sendToOwner({
      title: OWNER_DIGEST_TITLE,
      body:  buildOwnerConfirmationBody(groups),
      url:   "/team/steven",
      tag:   "steven-deadline-digest-owner",
    });
  } catch (err) {
    // Steven's digest already went out — an owner-confirmation failure must
    // never look like the whole feature failed.
    deps.logError("owner confirmation push failed (Steven digest already sent)", err);
  }

  return { kind: "sent_both" };
}
