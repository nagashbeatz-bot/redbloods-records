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
}

export async function saveSubscription(sub: PushSubscription) {
  const key  = sub.getKey("p256dh");
  const auth = sub.getKey("auth");
  if (!key || !auth) throw new Error("Invalid subscription keys");

  const p256dh = Buffer.from(key).toString("base64");
  const authB64 = Buffer.from(auth).toString("base64");

  await supabase.from("push_subscriptions").upsert(
    { endpoint: sub.endpoint, p256dh, auth: authB64 },
    { onConflict: "endpoint" },
  );
}

export async function getSubscriptions(): Promise<PushSubscriptionRow[]> {
  const { data } = await supabase.from("push_subscriptions").select("*");
  return data ?? [];
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export async function sendPushToAll(payload: PushPayload) {
  const subs = await getSubscriptions();
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
