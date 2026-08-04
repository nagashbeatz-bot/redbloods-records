/**
 * Shared CLIENT-side Web Push helpers — the SINGLE implementation of "register
 * the service worker, ensure ONE push subscription, and persist it to a role's
 * endpoint". Extracted so PushManager (owner/shalev/victor toast) and the Avi
 * portal's inline "enable notifications" button run the EXACT same flow instead
 * of duplicating it.
 *
 * NONE of these functions ever SEND a push — push is dispatched server-side only
 * (cron / agent / notify). subscribeAndSave only upserts the device row, so it
 * is safe to call on mount / refresh when permission is already granted.
 *
 * Browser-only: every function touches navigator/window and must run from a
 * client component (effect or event handler), never during SSR.
 */

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string;
const ALLOW_LOCAL_PUSH = process.env.NEXT_PUBLIC_ALLOW_LOCAL_PUSH === "true";

export function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

/** iOS Safari tab (not installed) / a browser without Push → the caller shows a
 *  device-specific instruction instead of an enable button. */
export function pushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

/** Localhost is silenced unless NEXT_PUBLIC_ALLOW_LOCAL_PUSH=true, so dev never
 *  registers a real subscription against production keys. */
export function localPushBlocked(): boolean {
  if (typeof window === "undefined") return false;
  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  return isLocal && !ALLOW_LOCAL_PUSH;
}

/**
 * Register /sw.js, reuse-or-create the single push subscription, and POST it to
 * `endpoint`. No permission request here — the caller must already have (or, for
 * a gesture-driven role, just obtained) Notification permission. Throws an Error
 * carrying a `reason` ("subscribe" | "server") so the caller can map UI state.
 * Never sends a push.
 */
export async function subscribeAndSave(endpoint: string): Promise<void> {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const check = await reg.pushManager.getSubscription(); // verify it exists
  if (!check) throw Object.assign(new Error("no-subscription"), { reason: "subscribe" });
  const res = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(check.toJSON()),
  });
  if (!res.ok) throw Object.assign(new Error("save-failed"), { reason: "server" }); // active only on 200
}
