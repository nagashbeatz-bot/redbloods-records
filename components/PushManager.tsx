"use client";

/**
 * PushManager — mounts once in AppShell.
 * 1. Registers the service worker
 * 2. Requests notification permission (once, on first visit)
 * 3. Subscribes to Web Push and saves the subscription to the server
 *
 * Owner + shalev only. Push is SENT server-side (cron / agent / availability) —
 * this component NEVER sends a push, never calls /api/push/check, and never fires
 * a test push on load. It only registers + subscribes.
 *
 * For the shalev artist, a registration failure is surfaced in the UI (owner stays
 * console-only) with a clear reason: unsupported/PWA-not-installed, permission not
 * granted, or the server failed to save the subscription.
 * Localhost is silenced unless NEXT_PUBLIC_ALLOW_LOCAL_PUSH=true.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRole } from "@/lib/use-role";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const ALLOW_LOCAL_PUSH = process.env.NEXT_PUBLIC_ALLOW_LOCAL_PUSH === "true";

// Distinct failure reasons → a clear Hebrew message (shalev sees these in-UI).
const PUSH_ERR = {
  unsupported: "לא הצלחנו להפעיל התראות במכשיר הזה — פתח/י את האפליקציה מהמסך הבית (PWA) כדי לקבל התראות.",
  permission:  "לא הצלחנו להפעיל התראות במכשיר הזה — יש לאשר התראות עבור האתר.",
  server:      "לא הצלחנו להפעיל התראות במכשיר הזה — שמירת ההרשמה נכשלה, נסה/י שוב מאוחר יותר.",
} as const;

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
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Owner + the shalev artist only. Victor / Steven / unknown never register a
    // service worker, see a permission prompt, or create a subscription.
    if (role !== "owner" && role !== "shalev") return;
    if (typeof window === "undefined") return;

    // A failure is logged for everyone but only shown in the UI to the artist
    // (owner keeps the prior console-only behavior → no owner regression).
    const fail = (reason: keyof typeof PUSH_ERR) => {
      console.warn(`[push] setup failed for role=${role}: ${reason}`);
      if (role === "shalev") setErr(PUSH_ERR[reason]);
    };

    // Web Push unsupported here (e.g. an iOS Safari tab — needs an installed PWA).
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      fail("unsupported");
      return;
    }

    // Silence registration on localhost/dev unless explicitly allowed (no UI error).
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isLocal && !ALLOW_LOCAL_PUSH) return;

    (async () => {
      try {
        // 1. Register SW
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

        // 2. Ask permission (only shown once by the browser)
        const permission = await Notification.requestPermission();
        if (permission !== "granted") { fail("permission"); return; }

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
        //    tagged with the right audience ("owner" vs "shalev"). A non-ok
        //    response means the server did NOT persist it (surfaced to the artist).
        const subscribeUrl = role === "shalev" ? "/api/red-artists/push-subscribe" : "/api/push/subscribe";
        const res = await fetch(subscribeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        if (!res.ok) { fail("server"); return; }

        setErr(null); // registered + persisted OK
        // Push is sent only via cron / agent / availability — NEVER on page load.
      } catch (e) {
        console.warn("Push setup failed:", e);
        fail("server");
      }
    })();
  }, [role]);

  if (!err || typeof document === "undefined") return null;
  return createPortal(
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 100050,
      maxWidth: "92vw", display: "flex", alignItems: "center", gap: 12,
      background: "#1A1214", border: "1px solid rgba(248,113,113,0.4)", color: "#FCA5A5",
      fontSize: 13, fontWeight: 700, lineHeight: 1.5, padding: "12px 16px", borderRadius: 12,
      boxShadow: "0 8px 30px rgba(0,0,0,0.6)", fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
    }}>
      <span>{err}</span>
      <button onClick={() => setErr(null)} aria-label="סגור" style={{
        background: "none", border: "none", color: "#FCA5A5", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 2, flexShrink: 0,
      }}>✕</button>
    </div>,
    document.body,
  );
}
