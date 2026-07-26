import "server-only";
import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";
import { decideVisitClaim } from "@/lib/victor-presence-pure";

/**
 * Owner-only push when Victor actually lands on his page (/team/victor).
 * Mirrors lib/steven-notify.ts's visit mechanism exactly (same existing
 * pattern this feature was asked to prefer over inventing a new one) — a
 * 30-minute rolling cooldown stored in the existing `settings` key/value
 * table (NO schema change), key = victor_visit_last, value = { at: iso }.
 *
 * Concurrency: unlike Steven's plain read-then-upsert, this uses an
 * INSERT-first-claim + CAS-retry-claim (same `.eq("value", JSON.stringify(old))`
 * pattern proven elsewhere in this codebase) so two tabs/requests landing at
 * the same instant can win the claim at most once between them — the
 * multi-tab spam case this feature was explicitly asked to guard against.
 *
 * The caller (POST /api/vendor/victor/ping) already verified the session is
 * really Victor (never Owner viewing the page) before calling this.
 */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const VISIT_LAST_KEY = "victor_visit_last";

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

async function tryClaimVisit(nowMs: number): Promise<boolean> {
  const nowIso = new Date(nowMs).toISOString();
  const { data } = await supabase.from("settings").select("value").eq("key", VISIT_LAST_KEY).maybeSingle();
  const existingAt = (data?.value as { at?: string } | null)?.at ?? null;
  const decision = decideVisitClaim(existingAt, nowMs);
  if (decision === "skip") return false;

  if (decision === "insert") {
    const { error } = await supabase.from("settings").insert({ key: VISIT_LAST_KEY, value: { at: nowIso } });
    if (!error) return true;
    if (error.code !== "23505") { console.error("[victor-presence-notify] insert failed:", error.message); return false; }
    return false; // lost the race to insert-first — another concurrent visit just claimed it
  }

  // cas_update — claim only if nothing else has already moved the row since we read it.
  const { data: updated, error } = await supabase
    .from("settings")
    .update({ value: { at: nowIso } })
    .eq("key", VISIT_LAST_KEY)
    .eq("value", JSON.stringify({ at: existingAt }))
    .select();
  if (error) { console.error("[victor-presence-notify] update failed:", error.message); return false; }
  return !!updated && updated.length > 0;
}

/** Best-effort; never throws. Sends AT MOST one push per cooldown window,
 *  even under concurrent calls (multiple tabs / rapid refresh + navigation). */
export async function notifyVictorPresence(): Promise<void> {
  if (!pushAllowed()) return;
  try {
    const now = Date.now();
    if (!(await tryClaimVisit(now))) return;
    await sendPushToAll({
      title: "Victor נכנס לעמוד שלו",
      body: "Victor נכנס עכשיו לפורטל העבודה שלו",
      url: "/team/victor",
      tag: "victor-visit",
      eventId: `victor_visit:${new Date(now).toISOString()}`,
    });
  } catch (e) {
    console.error("[victor-presence-notify] failed:", e);
  }
}
