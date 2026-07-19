import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  role: string | null;    // "owner" | "steven" — the device's audience
  user_id: string | null; // auth.users.id of the device owner (null = legacy row)
}

// PushSubscription.toJSON() shape sent from the client
interface PushSubJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Persist a subscription with the device's audience role ("owner" | "steven")
 *  and the authenticated user's id. Upsert on endpoint so a re-subscribe refreshes
 *  keys, role AND user_id — this is how legacy rows (user_id=null) get backfilled
 *  the next time the device re-registers. userId is REQUIRED: a device is never
 *  stored without an identified user (the route returns 401 before calling this). */
export async function saveSubscription(sub: PushSubJSON, role: string, userId: string) {
  const { endpoint, keys } = sub;
  if (!keys?.p256dh || !keys?.auth) throw new Error("Invalid subscription keys");
  if (!userId) throw new Error("saveSubscription: userId is required");

  // supabase-js does NOT throw on a DB error — it returns { error }. Check it and
  // throw, so a rejected insert can never look like a success (that silent swallow
  // is exactly why a shalev device was "saved" with 200 yet never persisted).
  const { error } = await supabase.from("push_subscriptions").upsert(
    { endpoint, p256dh: keys.p256dh, auth: keys.auth, role, user_id: userId },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(`push_subscriptions upsert failed: ${error.message}`);
}

/** All subscriptions, or only those whose role is in `roles` when provided. */
export async function getSubscriptions(roles?: string[]): Promise<PushSubscriptionRow[]> {
  let q = supabase.from("push_subscriptions").select("*");
  if (roles && roles.length) q = q.in("role", roles);
  const { data } = await q;
  return data ?? [];
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  // ── Server-side logging only — NEVER sent to the device. The SW contract stays
  //    {title, body, url, tag}; these feed the notifications history + navigation. ──
  eventId?: string;    // canonical send-event id (for cross-call idempotency; Phase F)
  projectId?: string;  // → open ProjectDrawer from the bell
  entityType?: string; // 'project' | 'victor_work' | 'sound_engineer_work' | ...
  entityId?: string;
  actorName?: string;  // sender label ("סטיבן" / "ויקטור" / …)
}

/** Deliver a payload to a concrete set of subscriptions, persist per-user history,
 *  and prune dead endpoints. */
async function deliver(subs: PushSubscriptionRow[], payload: PushPayload) {
  // Device contract is UNCHANGED — the SW only ever reads title/body/url/tag. The
  // entity/logging fields are stripped here so they never reach the device.
  const devicePayload = JSON.stringify({
    title: payload.title,
    body:  payload.body,
    url:   payload.url,
    tag:   payload.tag,
  });

  const results = await Promise.allSettled(
    subs.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        devicePayload,
      ),
    ),
  );

  // ── Clean up expired/invalid subscriptions (UNCHANGED behaviour) ──
  const expired: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const err = r.reason as { statusCode?: number };
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        expired.push(subs[i].endpoint);
      }
    }
  });
  if (expired.length) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .in("endpoint", expired);
  }

  // ── Persist per-user notification history (best-effort; NEVER breaks push) ──
  // Match results[i] ↔ subs[i], group by the subscription's user_id, and write ONE
  // row per user that had ≥1 successful delivery. Subs with user_id=null (legacy
  // devices) are unattributable → skipped. event_key = `${deliveryEventId}:${uid}`
  // so the same event to several users yields distinct keys (no unique-conflict).
  // NOTE: when the caller did not supply payload.eventId, deliveryEventId is unique
  // to THIS deliver run only — it does NOT dedupe a re-send of the same logical
  // event across separate deliver() calls (canonical eventId is Phase F).
  const deliveryEventId = payload.eventId ?? randomUUID();
  const perUser = new Map<string, { role: string | null; success: boolean }>();
  results.forEach((r, i) => {
    const uid = subs[i].user_id;
    if (!uid) return; // legacy device with no user_id → cannot attribute
    const cur = perUser.get(uid) ?? { role: subs[i].role, success: false };
    if (r.status === "fulfilled") cur.success = true;
    perUser.set(uid, cur);
  });

  for (const [uid, info] of perUser) {
    if (!info.success) continue; // all of this user's devices failed → no row
    const eventKey = `${deliveryEventId}:${uid}`;
    try {
      const { error } = await supabase.from("notifications").insert({
        recipient_user_id: uid,
        recipient_role:    info.role,
        title:             payload.title,
        body:              payload.body ?? null,
        url:               payload.url ?? null,
        tag:               payload.tag ?? null,
        project_id:        payload.projectId ?? null,
        entity_type:       payload.entityType ?? null,
        entity_id:         payload.entityId ?? null,
        actor_name:        payload.actorName ?? null,
        event_key:         eventKey,
      });
      if (error) {
        // 23505 = unique_violation on event_key → idempotent duplicate (info only).
        // Any OTHER DB error is surfaced, never silently swallowed. No auto-retry,
        // and the push result is unaffected either way. No secrets are logged.
        if (error.code === "23505") {
          console.info(`[push] notification skipped (idempotent duplicate) event_key=${eventKey}`);
        } else {
          console.error(`[push] notification insert failed event_key=${eventKey}: ${error.message}`);
        }
      }
    } catch (e) {
      console.error(`[push] notification insert threw event_key=${eventKey}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return results;
}

/** Send only to devices whose role is in `roles` (e.g. ["owner","steven"]). */
export async function sendPushToRoles(roles: string[], payload: PushPayload) {
  return deliver(await getSubscriptions(roles), payload);
}

/**
 * Owner devices only. Legacy name kept so existing callers (Steven activity,
 * Victor uploads, agent alerts, cron, push/check) stay owner-scoped without
 * edits — a Steven ("steven") device NEVER receives these internal notices.
 * For explicit multi-audience sends use sendPushToRoles.
 */
export async function sendPushToAll(payload: PushPayload) {
  return sendPushToRoles(["owner"], payload);
}
