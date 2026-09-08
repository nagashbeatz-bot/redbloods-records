import "server-only";
import { supabase } from "./supabase";
import { sendPushToRoles } from "./push";
import type { Show } from "./shows-store";
import { CLEANTONE_CLIENT_ID, CLEANTONE_ARTIST_NAME } from "./red-artists/cleantone";
import { ilTodayYMD } from "./red-artists/week";
import {
  computeShowNotifyFingerprint,
  buildShowNotifyBody,
  decideShowNotifyClaim,
  isUpcomingShowStatus,
  classifyPushResult,
  type ShowNotifyClaimValue,
} from "./show-notify-pure";

/**
 * Manual "שלח" button for a DJ CLEANTONE show — owner-only, fired ONLY by a
 * click on a specific upcoming show in his portal management. A deliberate
 * mirror of lib/show-notify.ts (Shalev's "שלח"): same fingerprint (name / date /
 * time / location only — a money-only edit never re-opens the button), same
 * INSERT-first/23505-CAS `settings` claim, same "notify recipient first, confirm
 * to owner only after real success" shape, same push templates.
 *
 * The ONLY differences from Shalev's flow: the recipient check is
 * shows.dj_client_id === CLEANTONE_CLIENT_ID (never dj_name), the push audience
 * is "cleantone", and the claim key is prefixed "dj_show_notify:" so a show that
 * has BOTH a Shalev artist token AND DJ CLEANTONE as its dj never lets one
 * "שלח" suppress the other.
 *
 * Nothing here writes to the show row: no payment_status, no
 * dj_confirmation_status, no status, no transactions, no Finance sync. The only
 * write is the `settings` claim row (exactly like Shalev's).
 */

function djShowNotifyClaimKey(showId: string): string {
  return `dj_show_notify:${showId}`;
}

export type NotifyDjShowResult =
  | { ok: true; djSent: number; ownerSent: number }
  | { ok: false; status: 403 | 409 | 502; reason: "not_dj" | "not_upcoming" | "already_sent" | "in_progress" | "no_subscription" | "send_failed" };

async function claim(key: string, fingerprint: string, now: Date): Promise<{ claimed: true } | { claimed: false; reason: "already_sent" | "in_progress" }> {
  const nowIso = now.toISOString();
  const first: ShowNotifyClaimValue = { status: "processing", fingerprint, claimedAt: nowIso };
  const { error: insertErr } = await supabase.from("settings").insert({ key, value: first });
  if (!insertErr) return { claimed: true };
  if (insertErr.code !== "23505") {
    console.error(`[dj-show-notify] claim insert failed: ${insertErr.message}`);
    return { claimed: false, reason: "in_progress" }; // fail closed — never send on an unexpected DB error
  }

  const { data: row, error: readErr } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  if (readErr || !row) {
    console.error(`[dj-show-notify] claim read failed: ${readErr?.message ?? "row missing"}`);
    return { claimed: false, reason: "in_progress" };
  }
  const existing = row.value as ShowNotifyClaimValue;
  const decision = decideShowNotifyClaim(existing, fingerprint, now);
  if (decision.action === "already_sent") return { claimed: false, reason: "already_sent" };
  if (decision.action === "in_progress") return { claimed: false, reason: "in_progress" };

  const next: ShowNotifyClaimValue = { status: "processing", fingerprint, claimedAt: nowIso };
  const { data: updated, error: updateErr } = await supabase
    .from("settings").update({ value: next }).eq("key", key).eq("value", JSON.stringify(existing)).select();
  if (updateErr) {
    console.error(`[dj-show-notify] claim reclaim failed: ${updateErr.message}`);
    return { claimed: false, reason: "in_progress" };
  }
  if (!updated || updated.length === 0) return { claimed: false, reason: "in_progress" }; // lost a concurrent race
  return { claimed: true };
}

async function markDone(key: string, value: ShowNotifyClaimValue): Promise<void> {
  const { error } = await supabase.from("settings").update({ value }).eq("key", key);
  if (error) console.error(`[dj-show-notify] markDone failed: ${error.message}`);
}

function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

/**
 * The full flow for one show, given a FRESH server-read row (never client-
 * supplied fields). Deep link for both audiences: `/dj-cleantone?tab=shows`
 * (opens his shows tab — his portal has no per-show focus deep link).
 */
export async function notifyDjAboutShow(show: Show): Promise<NotifyDjShowResult> {
  if (show.dj_client_id !== CLEANTONE_CLIENT_ID) return { ok: false, status: 403, reason: "not_dj" };
  if (!isUpcomingShowStatus(show.status) || !show.date || show.date < ilTodayYMD()) {
    return { ok: false, status: 403, reason: "not_upcoming" };
  }

  const fingerprint = computeShowNotifyFingerprint({ name: show.name, date: show.date, startTime: show.start_time, location: show.location });
  const key = djShowNotifyClaimKey(show.id);
  const now = new Date();

  const claimResult = await claim(key, fingerprint, now);
  if (!claimResult.claimed) {
    return { ok: false, status: 409, reason: claimResult.reason };
  }

  if (!pushAllowed()) {
    // Local/dev — never a real send. Leave the claim "processing" so a retry in
    // an environment where push IS allowed can (re)claim it once the stuck
    // timeout passes; report a clear, honest failure now.
    return { ok: false, status: 502, reason: "send_failed" };
  }

  const url = `/dj-cleantone?tab=shows`;
  const body = buildShowNotifyBody({ name: show.name, date: show.date, startTime: show.start_time, location: show.location });

  let djResults: { status: string }[];
  try {
    djResults = (await sendPushToRoles(["cleantone"], {
      title: "נכנסה הופעה חדשה",
      body,
      url,
      tag: `dj-show-notify-${show.id}`,
      eventId: `${key}:${fingerprint}`,
    })) as unknown as { status: string }[];
  } catch (e) {
    console.error("[dj-show-notify] sendPushToRoles(cleantone) threw:", e);
    await markDone(key, { status: "failed", fingerprint, claimedAt: now.toISOString() });
    return { ok: false, status: 502, reason: "send_failed" };
  }

  const cls = classifyPushResult(djResults);
  if (cls !== "sent") {
    await markDone(key, { status: "failed", fingerprint, claimedAt: now.toISOString() });
    return { ok: false, status: cls === "no_subscription" ? 409 : 502, reason: cls };
  }

  await markDone(key, { status: "sent", fingerprint, claimedAt: now.toISOString(), sentAt: new Date().toISOString() });

  // Owner confirmation — ONLY after the DJ's push actually succeeded.
  let ownerSent = 0;
  try {
    const ownerResults = await sendPushToRoles(["owner"], {
      title: `${CLEANTONE_ARTIST_NAME} עודכן`,
      body: `נשלחה אליו התראה על "${show.name}"`,
      url,
      tag: `dj-show-notify-owner-${show.id}`,
    });
    ownerSent = ownerResults.filter((r) => r.status === "fulfilled").length;
  } catch (e) {
    // The DJ's push already succeeded and is already marked "sent" — the owner
    // ack failing is non-fatal and never un-sends or retries the DJ's push.
    console.error("[dj-show-notify] owner confirmation push threw:", e);
  }

  return { ok: true, djSent: djResults.filter((r) => r.status === "fulfilled").length, ownerSent };
}
