"use client";

/**
 * PushManager — mounts once in AppShell.
 * 1. Registers the service worker
 * 2. Requests notification permission (once, on first visit)
 * 3. Subscribes to Web Push and saves subscription to server
 *
 * NOTE: Does NOT call /api/push/check on page load.
 * Push notifications are sent only via cron / agent (server-side).
 * Localhost is silenced unless NEXT_PUBLIC_ALLOW_LOCAL_PUSH=true.
 */

import { useEffect } from "react";
import { useRole } from "@/lib/use-role";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const ALLOW_LOCAL_PUSH = process.env.NEXT_PUBLIC_ALLOW_LOCAL_PUSH === "true";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

export default function PushManager() {
  const role = useRole();
  useEffect(() => {
    // Owner + the shalev artist (his portal needs availability push). Victor,
    // Steven and any other role must never register a service worker, see a
    // notification-permission prompt, or create a subscription.
    if (role !== "owner" && role !== "shalev") return;
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) return;

    // Silence push registration on localhost/development unless explicitly allowed.
    // This prevents local dev runs from sending real push notifications.
    const isLocal =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (isLocal && !ALLOW_LOCAL_PUSH) return;

    (async () => {
      try {
        // 1. Register SW
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

        // 2. Ask permission (only shown once by the browser)
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        // 3. Subscribe to push
        const existing = await reg.pushManager.getSubscription();
        let sub = existing;
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        }

        // 4. Save subscription to server — role-scoped endpoint so the device is
        //    tagged with the right audience ("owner" vs "shalev").
        const subscribeUrl = role === "shalev" ? "/api/red-artists/push-subscribe" : "/api/push/subscribe";
        await fetch(subscribeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });

        // Push notifications are sent only via cron / agent — NOT on page load.
      } catch (e) {
        // Non-fatal — push notifications are optional
        console.warn("Push setup failed:", e);
      }
    })();
  }, [role]);

  return null; // No UI
}
