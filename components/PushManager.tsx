"use client";

/**
 * PushManager — mounts once in AppShell.
 * 1. Registers the service worker
 * 2. Requests notification permission (once, on first visit)
 * 3. Subscribes to Web Push and saves subscription to server
 * 4. Calls /api/push/check to fire any pending alerts (throttled server-side)
 */

import { useEffect } from "react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

export default function PushManager() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) return;

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

        // 4. Save subscription to server
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });

        // 5. Trigger check for pending alerts (throttled to 30 min server-side)
        fetch("/api/push/check", { method: "POST" }).catch(() => {});
      } catch (e) {
        // Non-fatal — push notifications are optional
        console.warn("Push setup failed:", e);
      }
    })();
  }, []);

  return null; // No UI
}
