import "server-only";
import { supabase } from "./supabase";
import { sendPushToRoles } from "./push";
import type { Show } from "./shows-store";
import { SHALEV_NAME } from "./red-artists/portal-registry";
import { ilTodayYMD } from "./red-artists/week";
import {
  computeShowNotifyFingerprint,
  buildShowNotifyBody,
  showNotifyClaimKey,
  decideShowNotifyClaim,
  isUpcomingShowStatus,
  classifyPushResult,
  type ShowNotifyClaimValue,
} from "./show-notify-pure";

/**
 * Manual "שלח" button — owner-only, fired ONLY by a click on a specific
 * upcoming show in Shalev's portal "ההופעות שלי" tab. Never automatic (not on
 * show creation, not on load/refresh). Mirrors the "notify recipient first,
 * confirm to owner only after real success" shape of lib/victor-work-notify.ts,
 * but ADDS server-side idempotency (victor's is deliberately repeatable;
 * this one must not double-send the same show version) via the same
 * INSERT-first/23505-CAS `settings` claim pattern used by
 * lib/shalev-weekly-notify.ts / lib/shalev-availability-reminder-notify.ts.
 *
 * The claim's fingerprint covers ONLY name/date/startTime/location — a
 * money-only edit (price, dj fee, artist fee, payment_status) never changes
 * it, so the button stays locked; changing any of the four re-opens it.
 */

// A row belongs to Shalev if he's one of its (possibly collab) artist tokens —
// the SAME check the shows-summary routes already use to build the exact list
// this button renders next to (lib/red-artists/weekly-events.ts's isThisArtist).
function isShalevShow(artist: string): boolean {
  return (artist ?? "").split(/[,،;]/).map((s) => s.trim()).includes(SHALEV_NAME);
}

export type NotifyShowResult =
  | { ok: true; shalevSent: number; ownerSent: number }
  | { ok: false; status: 403 | 409 | 502; reason: "not_shalev" | "not_upcoming" | "already_sent" | "in_progress" | "no_subscription" | "send_failed" };

async function claim(key: string, fingerprint: string, now: Date): Promise<{ claimed: true } | { claimed: false; reason: "already_sent" | "in_progress" }> {
  const nowIso = now.toISOString();
  const first: ShowNotifyClaimValue = { status: "processing", fingerprint, claimedAt: nowIso };
  const { error: insertErr } = await supabase.from("settings").insert({ key, value: first });
  if (!insertErr) return { claimed: true };
  if (insertErr.code !== "23505") {
    console.error(`[show-notify] claim insert failed: ${insertErr.message}`);
    return { claimed: false, reason: "in_progress" }; // fail closed — never send on an unexpected DB error
  }

  const { data: row, error: readErr } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  if (readErr || !row) {
    console.error(`[show-notify] claim read failed: ${readErr?.message ?? "row missing"}`);
    return { claimed: false, reason: "in_progress" };
  }
  const existing = row.value as ShowNotifyClaimValue;
  const decision = decideShowNotifyClaim(existing, fingerprint, now);
  if (decision.action === "already_sent") return { claimed: false, reason: "already_sent" };
  if (decision.action === "in_progress") return { claimed: false, reason: "in_progress" };

  // "cas_update" — new version, a stuck processing claim, or a prior failure. Atomic
  // reclaim: the WHERE clause (old value, exact match) is the sole conflict authority.
  const next: ShowNotifyClaimValue = { status: "processing", fingerprint, claimedAt: nowIso };
  const { data: updated, error: updateErr } = await supabase
    .from("settings").update({ value: next }).eq("key", key).eq("value", JSON.stringify(existing)).select();
  if (updateErr) {
    console.error(`[show-notify] claim reclaim failed: ${updateErr.message}`);
    return { claimed: false, reason: "in_progress" };
  }
  if (!updated || updated.length === 0) return { claimed: false, reason: "in_progress" }; // lost a concurrent race
  return { claimed: true };
}

async function markDone(key: string, value: ShowNotifyClaimValue): Promise<void> {
  const { error } = await supabase.from("settings").update({ value }).eq("key", key);
  if (error) console.error(`[show-notify] markDone failed: ${error.message}`);
}

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

/**
 * The full flow for one show, given a FRESH server-read row (never client-
 * supplied fields). Deep link: `/red-artists?tab=shows&focus=show&showId=<id>`
 * for both audiences (opens the same portal shows tab either way).
 */
export async function notifyShalevAboutShow(show: Show): Promise<NotifyShowResult> {
  if (!isShalevShow(show.artist)) return { ok: false, status: 403, reason: "not_shalev" };
  if (!isUpcomingShowStatus(show.status) || !show.date || show.date < ilTodayYMD()) {
    return { ok: false, status: 403, reason: "not_upcoming" };
  }

  const fingerprint = computeShowNotifyFingerprint({ name: show.name, date: show.date, startTime: show.start_time, location: show.location });
  const key = showNotifyClaimKey(show.id);
  const now = new Date();

  const claimResult = await claim(key, fingerprint, now);
  if (!claimResult.claimed) {
    return { ok: false, status: 409, reason: claimResult.reason };
  }

  if (!pushAllowed()) {
    // Local/dev — never a real send. Leave the claim as "processing" so a
    // retry in an environment where push IS allowed can still (re)claim it
    // once the stuck-timeout passes; report a clear, honest failure now.
    return { ok: false, status: 502, reason: "send_failed" };
  }

  const url = `/red-artists?tab=shows&focus=show&showId=${encodeURIComponent(show.id)}`;
  const body = buildShowNotifyBody({ name: show.name, date: show.date, startTime: show.start_time, location: show.location });

  let shalevResults: { status: string }[];
  try {
    shalevResults = (await sendPushToRoles(["shalev"], {
      title: "נכנסה הופעה חדשה",
      body,
      url,
      tag: `show-notify-${show.id}`,
      eventId: `${key}:${fingerprint}`,
    })) as unknown as { status: string }[];
  } catch (e) {
    console.error("[show-notify] sendPushToRoles(shalev) threw:", e);
    await markDone(key, { status: "failed", fingerprint, claimedAt: now.toISOString() });
    return { ok: false, status: 502, reason: "send_failed" };
  }

  const cls = classifyPushResult(shalevResults);
  if (cls !== "sent") {
    await markDone(key, { status: "failed", fingerprint, claimedAt: now.toISOString() });
    return { ok: false, status: cls === "no_subscription" ? 409 : 502, reason: cls };
  }

  await markDone(key, { status: "sent", fingerprint, claimedAt: now.toISOString(), sentAt: new Date().toISOString() });

  // Owner confirmation — ONLY after Shalev's push actually succeeded.
  let ownerSent = 0;
  try {
    const ownerResults = await sendPushToRoles(["owner"], {
      title: "שליו עודכן",
      body: `נשלחה אליו התראה על "${show.name}"`,
      url,
      tag: `show-notify-owner-${show.id}`,
    });
    ownerSent = ownerResults.filter((r) => r.status === "fulfilled").length;
  } catch (e) {
    // Shalev's push already succeeded and is already marked "sent" — the owner
    // ack failing is non-fatal and never un-sends or retries Shalev's push.
    console.error("[show-notify] owner confirmation push threw:", e);
  }

  return { ok: true, shalevSent: shalevResults.filter((r) => r.status === "fulfilled").length, ownerSent };
}
