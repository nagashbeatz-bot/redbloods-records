import "server-only";
import { supabase } from "@/lib/supabase";
import { sendPushToRoles } from "@/lib/push";
import { getLabelArtistByName } from "@/lib/label-artists-store";
import {
  SHALEV_SCHEDULE_URL,
  mapSessionRows,
  type ShalevSessionInfo,
  type RawSessionRow,
  type JobDeps,
  type WeeklyOutcome,
  runShalevWeeklySessionsJobCore,
} from "@/lib/shalev-weekly-pure";

export {
  computeWeekRange,
  isShalevWeeklyDue,
  buildShalevBody,
  classifyPushResult,
  mapSessionRows,
  type ShalevSessionInfo,
  type WeeklyOutcome,
} from "@/lib/shalev-weekly-pure";

/**
 * Weekly Shalev sessions summary — Sunday 10:00 Asia/Jerusalem, server-side cron
 * only (see instrumentation.ts). Never triggered by page load/refresh/client code.
 *
 * Data source: the `sessions` table, scoped to Shalev's projects via the SAME
 * `projects.artist` token-match rule /api/red-artists/shalev-summary already uses
 * (read-only — never writes sessions, never touches calendar_event_id).
 *
 * Idempotency: a genuine INSERT (not upsert) into the existing `settings`
 * key/value table (no schema change — same table used by lib/steven-notify.ts,
 * lib/red-artists/availability.ts, lib/reports/monday-config.ts). A unique-
 * violation (23505) proves another run already claimed this week, so a retry/
 * redeploy/double cron-tick can never send twice. Not reliant on process memory.
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
 *  Read-only: no writes, no calendar_event_id access, no parallel data source. */
export async function fetchShalevWeekSessions(weekStart: string, weekEnd: string): Promise<ShalevSessionInfo[]> {
  const { data: projRows } = await supabase.from("projects").select("id, name, artist, is_hidden");
  const shalevProjects = (projRows ?? []).filter((p) => !p.is_hidden && isShalevArtist(p.artist as string));
  const shalevIds = shalevProjects.map((p) => p.id as string);
  if (shalevIds.length === 0) return [];
  const projectNameById = new Map(shalevProjects.map((p) => [p.id as string, p.name as string]));

  const { data: sessRows } = await supabase
    .from("sessions")
    .select("id, project_id, title, date, start_time, end_time, session_type, status")
    .in("project_id", shalevIds)
    .gte("date", weekStart)
    .lte("date", weekEnd);

  return mapSessionRows((sessRows ?? []) as RawSessionRow[], projectNameById);
}

// ── Real dependencies (production) ───────────────────────────────────────────

async function claimWeekReal(key: string): Promise<boolean> {
  const { error } = await supabase.from("settings").insert({
    key, value: { status: "running", startedAt: new Date().toISOString() },
  });
  if (!error) return true;
  if (error.code === "23505") return false; // already claimed by a prior run
  console.error(`[shalev-weekly] claim insert failed: ${error.message}`);
  return false; // fail-safe: never proceed if we can't prove we hold the claim
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
      body: `נשלחו לשליו ${count} סשנים לשבוע הקרוב.`,
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

/** Production entrypoint — called ONLY from the Sunday-10:00 Asia/Jerusalem cron
 *  tick in instrumentation.ts. Never fires on page load/refresh/client calls;
 *  skipped entirely (no DB writes, no push) outside production. */
export async function runShalevWeeklyJob(now: Date = new Date()): Promise<WeeklyOutcome | null> {
  if (!pushAllowed()) {
    console.log("[shalev-weekly] non-production — skipping entirely (no DB writes, no push)");
    return null;
  }
  return runShalevWeeklySessionsJobCore(now, realDeps);
}
