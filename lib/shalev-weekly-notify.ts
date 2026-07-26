import "server-only";
import { supabase } from "@/lib/supabase";
import { sendPushToRoles } from "@/lib/push";
import { getLabelArtistByName } from "@/lib/label-artists-store";
import {
  SHALEV_SCHEDULE_URL,
  MAX_ATTEMPTS,
  STUCK_PROCESSING_TIMEOUT_MS,
  mapSessionRows,
  buildOwnerAckBody,
  type ShalevSessionInfo,
  type RawSessionRow,
  type ClaimResult,
  type JobDeps,
  type WeeklyOutcome,
  runShalevWeeklySessionsJobCore,
} from "@/lib/shalev-weekly-pure";

export {
  computeWeekRange,
  isShalevWeeklyWindowOpen,
  buildShalevBody,
  classifyPushResult,
  mapSessionRows,
  MAX_ATTEMPTS,
  type ShalevSessionInfo,
  type WeeklyOutcome,
} from "@/lib/shalev-weekly-pure";

/**
 * Weekly Shalev sessions summary — Sunday 10:00–10:15 Asia/Jerusalem, server-side
 * cron only (see instrumentation.ts). Never triggered by page load/refresh/client
 * code.
 *
 * Data source: the `sessions` table, scoped to Shalev's projects via the SAME
 * `projects.artist` token-match rule /api/red-artists/shalev-summary already uses
 * — read-only, and used ONLY to decide which sessions are his, never for the
 * notification text (see the long comment in shalev-weekly-pure.ts's
 * mapSessionRows — a real bug had a project name leaking into the push before).
 *
 * Idempotency + retry: the existing `settings` key/value table (no schema
 * change), key = shalev_weekly_sessions:{weekStart}. Two operations:
 *  - First-ever claim: a genuine INSERT — a 23505 unique-violation means the row
 *    already exists (this week was already attempted at least once).
 *  - Retry/recovery claim: an UPDATE gated on `.eq("value", JSON.stringify(old))`
 *    — a full-value equality compare-and-swap. This was VERIFIED against this
 *    project's real Postgres/PostgREST setup (8/8 concurrent-race rounds each
 *    produced exactly one winner) before being relied on here — Postgres
 *    re-evaluates the UPDATE's WHERE clause under row-level locking when a
 *    second concurrent UPDATE unblocks, so a stale reader's CAS always loses
 *    once the row has moved on. No RPC/stored procedure, no schema change.
 *
 * All the branching logic itself lives in lib/shalev-weekly-pure.ts (no
 * "server-only"/Supabase/push import) so it stays testable from a plain script;
 * this file only supplies the REAL Supabase/push wiring behind that logic.
 */

const SHALEV = "שליו טסמה";

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}
function isShalevArtist(artist: string | null | undefined): boolean {
  return (artist ?? "").split(/[,،;]/).map((s) => s.trim()).includes(SHALEV);
}

/** Canonical source of Shalev's sessions for [weekStart, weekEnd] — same table +
 *  ownership rule (projects.artist token match) as /api/red-artists/shalev-summary.
 *  Read-only: no writes, no calendar_event_id access, no parallel data source.
 *  The `projects` query below is used ONLY to build the id list for the
 *  ownership filter — no project field is ever passed into mapSessionRows. */
export async function fetchShalevWeekSessions(weekStart: string, weekEnd: string): Promise<ShalevSessionInfo[]> {
  const { data: projRows } = await supabase.from("projects").select("id, artist, is_hidden");
  const shalevIds = (projRows ?? [])
    .filter((p) => !p.is_hidden && isShalevArtist(p.artist as string))
    .map((p) => p.id as string);
  if (shalevIds.length === 0) return [];

  const { data: sessRows } = await supabase
    .from("sessions")
    .select("id, title, date, start_time, end_time, session_type, status")
    .in("project_id", shalevIds)
    .gte("date", weekStart)
    .lte("date", weekEnd);

  return mapSessionRows((sessRows ?? []) as RawSessionRow[]);
}

// ── Claim / retry state machine (real Supabase wiring) ───────────────────────

interface ClaimValue {
  status: "processing" | "sent" | "no_sessions" | "failed";
  attempt_count: number;
  lastAttemptAt: string;
  [k: string]: unknown;
}

async function claimWeekReal(key: string, now: Date): Promise<ClaimResult> {
  const nowIso = now.toISOString();

  // 1) First-ever claim this week — a genuine INSERT wins iff no row exists yet.
  const first: ClaimValue = { status: "processing", attempt_count: 1, lastAttemptAt: nowIso };
  const { error: insertErr } = await supabase.from("settings").insert({ key, value: first });
  if (!insertErr) return { claimed: true, attempt: 1 };
  if (insertErr.code !== "23505") {
    console.error(`[shalev-weekly] claim insert failed: ${insertErr.message}`);
    return { claimed: false, attempt: 0 };
  }

  // 2) Row already exists — read it to decide whether a retry/recovery applies.
  const { data: row, error: readErr } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  if (readErr || !row) {
    console.error(`[shalev-weekly] claim read failed: ${readErr?.message ?? "row missing"}`);
    return { claimed: false, attempt: 0 };
  }
  const v = row.value as Partial<ClaimValue>;
  const status = v.status ?? "";
  const attemptCount = typeof v.attempt_count === "number" ? v.attempt_count : 0;
  const lastAttemptAt = v.lastAttemptAt ?? "";

  // Terminal states — always skip, no matter how many minutes remain in the window.
  if (status === "sent" || status === "no_sessions") return { claimed: false, attempt: 0 };

  if (status === "processing") {
    const age = now.getTime() - new Date(lastAttemptAt).getTime();
    if (!(age > STUCK_PROCESSING_TIMEOUT_MS)) return { claimed: false, attempt: 0 }; // fresh — may genuinely be in flight
    if (attemptCount >= MAX_ATTEMPTS) return { claimed: false, attempt: 0 }; // stuck AND already exhausted
  } else if (status === "failed") {
    if (attemptCount >= MAX_ATTEMPTS) return { claimed: false, attempt: 0 }; // attempts exhausted
  } else {
    return { claimed: false, attempt: 0 }; // unknown/unexpected value — fail safe, no retry
  }

  // 3) Atomic re-claim: UPDATE ... WHERE value = <the exact value we just read>.
  // Postgres re-evaluates this WHERE clause under row-level locking when a
  // concurrent UPDATE on the same row unblocks, so if another process already
  // won the claim, our UPDATE (matching the now-stale old value) affects 0 rows.
  const oldValue: ClaimValue = { status, attempt_count: attemptCount, lastAttemptAt };
  const nextAttempt = attemptCount + 1;
  const nextValue: ClaimValue = { status: "processing", attempt_count: nextAttempt, lastAttemptAt: nowIso };
  const { data: updated, error: updateErr } = await supabase
    .from("settings")
    .update({ value: nextValue })
    .eq("key", key)
    .eq("value", JSON.stringify(oldValue))
    .select();

  if (updateErr) {
    console.error(`[shalev-weekly] claim retry-update failed: ${updateErr.message}`);
    return { claimed: false, attempt: 0 };
  }
  if (!updated || updated.length === 0) return { claimed: false, attempt: 0 }; // lost the race to a concurrent run
  return { claimed: true, attempt: nextAttempt };
}

async function markWeekDoneReal(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("settings").update({ value }).eq("key", key);
  if (error) console.error(`[shalev-weekly] settings update failed: ${error.message}`);
}
async function ownerDeepLink(): Promise<string> {
  const artist = await getLabelArtistByName(SHALEV).catch(() => null);
  return artist ? `/label/artists/${artist.id}?tab=schedule` : SHALEV_SCHEDULE_URL;
}

const realDeps: JobDeps = {
  fetchSessions: fetchShalevWeekSessions,
  claimWeek: claimWeekReal,
  markWeekDone: markWeekDoneReal,
  sendToShalev: async (payload) => (await sendPushToRoles(["shalev"], payload)) as unknown as { status: string }[],
  sendOwnerAck: async (count, weekStart) => {
    await sendPushToRoles(["owner"], {
      title: "העדכון השבועי נשלח לשליו ✅",
      body: buildOwnerAckBody(count),
      url: await ownerDeepLink(),
      tag: `shalev-weekly-ack-${weekStart}`,
      eventId: `shalev_weekly_sessions_ack:${weekStart}`,
    });
  },
  sendOwnerFail: async (reason, _count, weekStart) => {
    await sendPushToRoles(["owner"], {
      title: "העדכון השבועי לשליו לא נשלח ⚠️",
      body: reason === "no_subscription"
        ? "נמצאו סשנים, אך לא נמצא מנוי Push פעיל לשליו."
        : "שליחת העדכון השבועי לשליו נכשלה.",
      url: await ownerDeepLink(),
      tag: `shalev-weekly-fail-${weekStart}`,
      eventId: `shalev_weekly_sessions_fail:${weekStart}`,
    });
  },
  log: (m) => console.log(`[shalev-weekly] ${m}`),
  logError: (m, err) => console.error(`[shalev-weekly] ${m}`, err ?? ""),
};

/** Production entrypoint — called ONLY from the Sunday-10:00–10:15 Asia/Jerusalem
 *  cron window in instrumentation.ts. Never fires on page load/refresh/client
 *  calls; skipped entirely (no DB writes, no push) outside production. */
export async function runShalevWeeklyJob(now: Date = new Date()): Promise<WeeklyOutcome | null> {
  if (!pushAllowed()) {
    console.log("[shalev-weekly] non-production — skipping entirely (no DB writes, no push)");
    return null;
  }
  return runShalevWeeklySessionsJobCore(now, realDeps);
}
