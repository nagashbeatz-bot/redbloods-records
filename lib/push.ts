import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

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
  role: string | null; // "owner" | "steven" — the device's audience
}

// PushSubscription.toJSON() shape sent from the client
interface PushSubJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Persist a subscription with the device's audience role ("owner" | "steven").
 *  Upsert on endpoint so a re-subscribe refreshes keys AND role. */
export async function saveSubscription(sub: PushSubJSON, role: string) {
  const { endpoint, keys } = sub;
  if (!keys?.p256dh || !keys?.auth) throw new Error("Invalid subscription keys");

  await supabase.from("push_subscriptions").upsert(
    { endpoint, p256dh: keys.p256dh, auth: keys.auth, role },
    { onConflict: "endpoint" },
  );
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
}

/** Deliver a payload to a concrete set of subscriptions + prune dead endpoints. */
async function deliver(subs: PushSubscriptionRow[], payload: PushPayload) {
  const results = await Promise.allSettled(
    subs.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
      ),
    ),
  );

  // Clean up expired/invalid subscriptions
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
