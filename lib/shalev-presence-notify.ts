import "server-only";
import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";
import { decideVisitClaim } from "@/lib/victor-presence-pure";

/**
 * Owner-only push for "Shalev entered the app". Unlike Victor/Steven's
 * time-based visit cooldown, the session boundary here is decided client-side:
 * ArtistPortalPage gates repeat pings within the same browser tab via
 * sessionStorage, which survives page reloads/in-app navigation but is empty
 * again in a fresh tab or after the browser was actually closed and reopened —
 * so a genuinely new session still notifies even seconds after the last one.
 *
 * This server-side claim is only a short race-guard against two tabs opening
 * at the same instant, reusing the same insert/CAS claim shape as
 * lib/victor-presence-notify.ts (via the shared decideVisitClaim) with a much
 * shorter window than Victor's 30-minute cooldown.
 *
 * State lives in the existing settings key/value table — no schema change.
 */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const ENTRY_LAST_KEY = "shalev_entry_last";
const RACE_GUARD_MS = 60 * 1000; // guards only near-simultaneous multi-tab pings, not real sessions
const TZ = "Asia/Jerusalem";

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

async function tryClaimEntry(nowMs: number): Promise<boolean> {
  const nowIso = new Date(nowMs).toISOString();
  const { data } = await supabase.from("settings").select("value").eq("key", ENTRY_LAST_KEY).maybeSingle();
  const existingAt = (data?.value as { at?: string } | null)?.at ?? null;
  const decision = decideVisitClaim(existingAt, nowMs, RACE_GUARD_MS);
  if (decision === "skip") return false;

  if (decision === "insert") {
    const { error } = await supabase.from("settings").insert({ key: ENTRY_LAST_KEY, value: { at: nowIso } });
    if (!error) return true;
    if (error.code !== "23505") { console.error("[shalev-presence-notify] insert failed:", error.message); return false; }
    return false; // lost the race to insert-first — another concurrent entry just claimed it
  }

  // cas_update — claim only if nothing else has already moved the row since we read it.
  const { data: updated, error } = await supabase
    .from("settings")
    .update({ value: { at: nowIso } })
    .eq("key", ENTRY_LAST_KEY)
    .eq("value", JSON.stringify({ at: existingAt }))
    .select();
  if (error) { console.error("[shalev-presence-notify] update failed:", error.message); return false; }
  return !!updated && updated.length > 0;
}

/** Best-effort; never throws. Sends AT MOST one push per short race-guard
 *  window, even under concurrent calls (e.g. two tabs opened at once). */
export async function notifyShalevEntry(): Promise<void> {
  if (!pushAllowed()) return;
  try {
    const now = Date.now();
    if (!(await tryClaimEntry(now))) return;
    const time = new Date(now).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
    await sendPushToAll({
      title: "שליו נכנס לאפליקציה",
      body: `התחבר בשעה ${time}`,
      url: "/red-artists",
      tag: "shalev-entry",
      eventId: `shalev_entry:${new Date(now).toISOString()}`,
    });
  } catch (e) {
    console.error("[shalev-presence-notify] failed:", e);
  }
}
