import "server-only";
import { supabase } from "@/lib/supabase";
import { emailList } from "@/lib/roles";

/**
 * Weekly reset of the Owner's notification-bell HISTORY (the `notifications`
 * table only) — every Friday the Owner should start with a clean "what
 * happened this week" feed. Same every-minute-tick + Intl toLocaleString
 * window pattern as the other Friday jobs in instrumentation.ts (DST-safe,
 * never a fixed UTC offset), scoped to 06:00–06:15 Asia/Jerusalem.
 *
 * Deliberately NOT the same shape as the other cron jobs' "atomic DB claim"
 * dedup: those guard against a duplicate PUSH send, which is a real problem.
 * A DELETE is naturally idempotent — a second tick inside the same window
 * just deletes 0 rows — so no claim/lock is needed here.
 *
 * Scope, by design:
 *  - Deletes ONLY rows in `notifications` whose recipient_user_id resolves to
 *    an Owner (via OWNER_EMAILS, the same allowlist roleForEmail() uses —
 *    NEVER the per-row `recipient_role` column, which is just a one-time
 *    echo of whichever device got a given push and is not an ownership
 *    guarantee for that row).
 *  - Deletes BOTH read and unread rows (the Owner starts each week fully
 *    clean, by explicit request).
 *  - Never reads or writes `agent_alerts` — that table's own resolve/
 *    dismiss/delete/entity_key lifecycle is completely untouched; this
 *    function doesn't import alerts-store.ts or query that table at all.
 *  - Never touches `push_subscriptions` and never sends a push — deleting
 *    notification HISTORY rows cannot trigger or replay a push (push is
 *    fire-and-forget at send time in lib/push.ts, never re-derived from
 *    this table).
 *  - Never touches any other recipient's rows (Steven/Victor/Shalev/Avi/…).
 */

const TZ = "Asia/Jerusalem";

export function isOwnerWeeklyCleanupWindowOpen(now: Date, tz: string = TZ): boolean {
  const dow = now.toLocaleString("en-US", { timeZone: tz, weekday: "short" }); // "Sun".."Sat"
  const hm  = now.toLocaleString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = hm.split(":").map(Number);
  return dow === "Fri" && h === 6 && m >= 0 && m <= 15;
}

/** OWNER_EMAILS → actual Supabase Auth user ids, via the admin API (the only
 *  supported way to look up a user by email with the service-role key — there
 *  is no getUserByEmail; listUsers() is paginated so every page is walked). */
async function resolveOwnerUserIds(): Promise<string[]> {
  const owners = new Set(emailList(process.env.OWNER_EMAILS));
  if (owners.size === 0) return [];

  const ids: string[] = [];
  const perPage = 200;
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`[owner-notifications-cleanup] listUsers failed: ${error.message}`);
    for (const u of data.users) {
      const email = (u.email ?? "").trim().toLowerCase();
      if (email && owners.has(email)) ids.push(u.id);
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  return ids;
}

export async function cleanupOwnerNotifications(): Promise<{ ownerCount: number; deleted: number }> {
  const ownerIds = await resolveOwnerUserIds();
  if (ownerIds.length === 0) return { ownerCount: 0, deleted: 0 };

  const { error, count } = await supabase
    .from("notifications")
    .delete({ count: "exact" })
    .in("recipient_user_id", ownerIds);
  if (error) throw new Error(`[owner-notifications-cleanup] delete failed: ${error.message}`);

  return { ownerCount: ownerIds.length, deleted: count ?? 0 };
}
