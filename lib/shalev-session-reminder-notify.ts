import "server-only";
import { supabase } from "@/lib/supabase";
import { sendPushToRoles } from "@/lib/push";
import { getLabelArtistByName } from "@/lib/label-artists-store";
import {
  TZ,
  mapReminderSessionRows,
  zonedTimeToUtc,
  isReminderDue,
  decideClaimAction,
  buildOwnerAckPush,
  processSessionReminderCore,
  type RawSessionRow,
  type ClaimValue,
  type ClaimResult,
  type ReminderDeps,
  type ShalevReminderSession,
} from "@/lib/shalev-session-reminder-pure";

export {
  TZ,
  REMINDER_HOURS_BEFORE,
  zonedTimeToUtc,
  isReminderDue,
  reminderClaimKey,
  mapReminderSessionRows,
  type ShalevReminderSession,
} from "@/lib/shalev-session-reminder-pure";

/**
 * Per-session pre-session reminder to Shalev — fires ~3h before each of his
 * sessions (Asia/Jerusalem), server-side cron only (see instrumentation.ts).
 * Never triggered by page load/refresh/client code.
 *
 * Data source: the `sessions` table, scoped to Shalev's projects via the SAME
 * `projects.artist` token-match rule used by /api/red-artists/shalev-summary,
 * lib/session-notify.ts and lib/shalev-weekly-notify.ts — read-only, and used
 * ONLY to decide which sessions are his. The reminder text never includes a
 * project/artist/song name or notes — only the session's own start time.
 *
 * Idempotency + retry: the existing `settings` key/value table (no schema
 * change), key = shalev_session_reminder:{sessionId}:{date}:{startTime} — see
 * reminderClaimKey. Same INSERT-first-claim + CAS-retry-claim protocol as
 * lib/shalev-weekly-notify.ts's claimWeekReal (verified against this
 * project's real Postgres/PostgREST setup — 8/8 concurrent-race rounds each
 * produced exactly one winner). Because the key embeds date+startTime, a
 * rescheduled session automatically gets a fresh key: the old time's "sent"
 * state can never block or duplicate the reminder for the new time.
 */

const SHALEV = "שליו טסמה";
const SHALEV_SCHEDULE_URL = "/red-artists?tab=schedule"; // same deep-link every other Shalev push uses

function isShalevArtist(artist: string | null | undefined): boolean {
  return (artist ?? "").split(/[,،;]/).map((s) => s.trim()).includes(SHALEV);
}

// production OR ALLOW_SERVER_PUSH — mirrors every other notify wrapper
// (lib/session-notify.ts, lib/shalev-weekly-notify.ts) so a localhost/dev run
// never fires a real push.
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

async function ownerDeepLink(): Promise<string> {
  const artist = await getLabelArtistByName(SHALEV).catch(() => null);
  return artist ? `/label/artists/${artist.id}?tab=schedule` : SHALEV_SCHEDULE_URL;
}

/** Canonical source for Shalev's candidate sessions — [today, tomorrow] in
 *  Asia/Jerusalem so a session just after midnight is still caught by
 *  tonight's 3h-before window. Read-only: no writes. */
async function fetchCandidateSessions(now: Date): Promise<ShalevReminderSession[]> {
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const todayStr = fmt(now);
  const tomorrowStr = fmt(new Date(now.getTime() + 86400000));

  const { data: projRows } = await supabase.from("projects").select("id, artist, is_hidden");
  const shalevIds = (projRows ?? [])
    .filter((p) => !p.is_hidden && isShalevArtist(p.artist as string))
    .map((p) => p.id as string);
  if (shalevIds.length === 0) return [];

  const { data: sessRows } = await supabase
    .from("sessions")
    .select("id, date, start_time, status")
    .in("project_id", shalevIds)
    .in("date", [todayStr, tomorrowStr]);

  return mapReminderSessionRows((sessRows ?? []) as RawSessionRow[]);
}

// ── Claim / retry state machine (real Supabase wiring) ───────────────────────

async function claimReal(key: string, now: Date): Promise<ClaimResult> {
  const nowIso = now.toISOString();

  // 1) First-ever claim for this session+time — a genuine INSERT wins iff no
  // row exists yet.
  const first: ClaimValue = { status: "processing", attempt_count: 1, lastAttemptAt: nowIso };
  const { error: insertErr } = await supabase.from("settings").insert({ key, value: first });
  if (!insertErr) return { claimed: true, attempt: 1 };
  if (insertErr.code !== "23505") {
    console.error(`[shalev-session-reminder] claim insert failed: ${insertErr.message}`);
    return { claimed: false, attempt: 0 };
  }

  // 2) Row already exists — read it and apply the pure decision.
  const { data: row, error: readErr } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  if (readErr || !row) {
    console.error(`[shalev-session-reminder] claim read failed: ${readErr?.message ?? "row missing"}`);
    return { claimed: false, attempt: 0 };
  }
  const existing = row.value as ClaimValue;
  const decision = decideClaimAction(existing, now);
  if (decision.action !== "cas_update") return { claimed: false, attempt: 0 };

  // 3) Atomic re-claim: UPDATE ... WHERE value = <the exact value we just
  // read>. Postgres re-evaluates this WHERE clause under row-level locking
  // when a concurrent UPDATE on the same row unblocks, so if another process
  // already won the claim, our UPDATE (matching the now-stale old value)
  // affects 0 rows.
  const nextValue: ClaimValue = { status: "processing", attempt_count: decision.nextAttempt, lastAttemptAt: nowIso };
  const { data: updated, error: updateErr } = await supabase
    .from("settings")
    .update({ value: nextValue })
    .eq("key", key)
    .eq("value", JSON.stringify(existing))
    .select();

  if (updateErr) {
    console.error(`[shalev-session-reminder] claim retry-update failed: ${updateErr.message}`);
    return { claimed: false, attempt: 0 };
  }
  if (!updated || updated.length === 0) return { claimed: false, attempt: 0 }; // lost the race to a concurrent run
  return { claimed: true, attempt: decision.nextAttempt };
}

async function markDoneReal(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("settings").update({ value }).eq("key", key);
  if (error) console.error(`[shalev-session-reminder] settings update failed: ${error.message}`);
}

const realDeps: ReminderDeps = {
  claim: claimReal,
  markDone: markDoneReal,
  sendToShalev: async (payload) =>
    (await sendPushToRoles(["shalev"], { ...payload, url: SHALEV_SCHEDULE_URL })) as unknown as { status: string }[],
  sendOwnerAck: async (startTime, key) => {
    const ack = buildOwnerAckPush(startTime);
    await sendPushToRoles(["owner"], {
      ...ack,
      url: await ownerDeepLink(),
      tag: `session-reminder-ack-${key}`,
      eventId: `${key}:owner_ack`,
    });
  },
  log: (m) => console.log(`[shalev-session-reminder] ${m}`),
  logError: (m, err) => console.error(`[shalev-session-reminder] ${m}`, err ?? ""),
};

/** Production entrypoint — called every minute from instrumentation.ts. Scans
 *  Shalev's candidate sessions for [today, tomorrow], and for each one that's
 *  currently inside its own 3h-before window, processes its reminder claim.
 *  Skipped entirely (no DB writes, no push) outside production. */
export async function runShalevSessionReminderTick(now: Date = new Date()): Promise<void> {
  if (!pushAllowed()) return;
  const sessions = await fetchCandidateSessions(now);
  for (const s of sessions) {
    const startUtc = zonedTimeToUtc(s.date, s.startTime, TZ);
    if (!isReminderDue(now, startUtc)) continue;
    await processSessionReminderCore(s, now, realDeps).catch((e) =>
      console.error(`[shalev-session-reminder] session ${s.id} processing threw:`, e),
    );
  }
}
