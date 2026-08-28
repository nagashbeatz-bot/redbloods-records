import "server-only";
import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";
import { decideVisitClaim } from "@/lib/victor-presence-pure";
import { AVI_ARTIST_ID } from "@/lib/roles";

/**
 * Owner-only push for "Avi entered the app". A deliberate mirror of
 * lib/shalev-presence-notify.ts — same session model, same guard shape, same
 * wording — because Avi reads the very same ArtistPortalPage that Shalev does, so
 * anything else would make two portals of one component behave differently.
 *
 * The session boundary is decided client-side: ArtistPortalPage gates repeat pings
 * within the same browser tab via sessionStorage (its own key, never Shalev's),
 * which survives page reloads / in-app navigation but is empty again in a fresh tab
 * or after the app was fully closed and reopened — so a genuinely new session still
 * notifies even seconds after the last one.
 *
 * This server-side claim is only a short race-guard against two tabs opening at the
 * same instant, reusing the same insert/CAS claim shape via the shared
 * decideVisitClaim. It is what makes a refresh unable to spam even if the client
 * fires again.
 *
 * State lives in the existing settings key/value table under its OWN key — no
 * schema change, and Shalev's key is never read or written here.
 */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const ENTRY_LAST_KEY = "avi_entry_last";
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
    if (error.code !== "23505") { console.error("[avi-presence-notify] insert failed:", error.message); return false; }
    return false; // lost the race to insert-first — another concurrent entry just claimed it
  }

  // cas_update — claim only if nothing else has already moved the row since we read it.
  const { data: updated, error } = await supabase
    .from("settings")
    .update({ value: { at: nowIso } })
    .eq("key", ENTRY_LAST_KEY)
    .eq("value", JSON.stringify({ at: existingAt }))
    .select();
  if (error) { console.error("[avi-presence-notify] update failed:", error.message); return false; }
  return !!updated && updated.length > 0;
}

/** Best-effort; never throws. Sends AT MOST one push per short race-guard
 *  window, even under concurrent calls (e.g. two tabs opened at once).
 *
 *  The push goes to the OWNER only (sendPushToAll is owner-scoped), so this works
 *  whether or not Avi has ever registered a device. The deep link opens HIS portal,
 *  which is the owner-reachable page for him. */
export async function notifyAviEntry(): Promise<void> {
  if (!pushAllowed()) return;
  try {
    const now = Date.now();
    if (!(await tryClaimEntry(now))) return;
    const time = new Date(now).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
    await sendPushToAll({
      title: "אבי נכנס לאפליקציה",
      body: `התחבר בשעה ${time}`,
      url: `/label/artists/${AVI_ARTIST_ID}`,
      tag: "avi-entry",
      eventId: `avi_entry:${new Date(now).toISOString()}`,
    });
  } catch (e) {
    console.error("[avi-presence-notify] failed:", e);
  }
}
