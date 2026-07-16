"use client";

/**
 * PushManager — mounts once in AppShell. Registers the SW + Web Push subscription.
 * Push is SENT server-side only (cron / agent / availability / victor work);
 * this component NEVER sends a push, never calls /api/push/check, and never
 * fires a test push.
 *
 * Owner: unchanged auto flow (desktop — no gesture requirement).
 * Shalev + Victor: GESTURE-DRIVEN. iOS only honors Notification.requestPermission()
 *   from a real user tap, so on mount we NEVER auto-request — we only decide what
 *   to show (an "enable notifications" button, or a device-specific instruction).
 *   The actual permission request + subscribe + save happen on the button tap.
 *   Each role saves through its OWN role-gated endpoint, so a device is always
 *   stored with the role of the session that registered it.
 * Localhost is silenced unless NEXT_PUBLIC_ALLOW_LOCAL_PUSH=true.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

function localBlocked(): boolean {
  if (typeof window === "undefined") return false;
  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  return isLocal && !ALLOW_LOCAL_PUSH;
}

type Status = "idle" | "prompt" | "working" | "enabled" | "active" | "denied" | "unsupported" | "server";

/** Role-gated subscribe endpoint per gesture-driven role. Each one only accepts a
 *  session whose real role matches, so a device can never be stored under another
 *  role (e.g. an owner viewing Victor's page is rejected by the victor endpoint). */
const SUBSCRIBE_ENDPOINT: Record<string, string> = {
  shalev: "/api/red-artists/push-subscribe",
  victor: "/api/vendor/victor/push-subscribe",
};

export default function PushManager() {
  const role = useRole();
  const [status, setStatus] = useState<Status>("idle");
  const busyRef = useRef(false);
  // Roles that must ask for permission from a real user tap (iOS requirement).
  const gestureRole = role === "shalev" || role === "victor";
  const isEn = role === "victor"; // Victor's UI is en/ru — never Hebrew

  // Register the SW + ensure a SINGLE subscription (getSubscription reuses the
  // existing one → no duplicate) + persist it. No gesture needed here — only
  // requestPermission is gesture-gated, and the caller handles that first.
  const ensureSubscribed = useCallback(async () => {
    const endpoint = SUBSCRIBE_ENDPOINT[role ?? ""];
    if (!endpoint) throw Object.assign(new Error("no-endpoint"), { reason: "server" });
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
    if (!res.ok) throw Object.assign(new Error("save-failed"), { reason: "server" }); // mark active only on 200
  }, [role]);

  // ── OWNER — unchanged auto flow (desktop; no gesture constraint) ──
  useEffect(() => {
    if (role !== "owner") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (localBlocked()) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;
        const existing = await reg.pushManager.getSubscription();
        let sub = existing;
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
        await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      } catch (e) { console.warn("Push setup failed:", e); }
    })();
  }, [role]);

  // ── SHALEV + VICTOR — mount only DECIDES what to show; never auto-requests ──
  useEffect(() => {
    if (!gestureRole) return;
    if (typeof window === "undefined") return;
    if (localBlocked()) { setStatus("idle"); return; }
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) { setStatus("unsupported"); return; } // iOS Safari tab (not installed) / no Push
    if (Notification.permission === "denied") { setStatus("denied"); return; }
    if (Notification.permission === "default") { setStatus("prompt"); return; } // needs a user tap
    // Already granted → finish silently (subscribe/save need no gesture) so a
    // device that granted earlier but lost its DB row is recovered.
    let alive = true;
    (async () => {
      try { await ensureSubscribed(); if (alive) setStatus("active"); }
      catch { if (alive) setStatus("prompt"); } // couldn't persist → offer the button to retry
    })();
    return () => { alive = false; };
  }, [gestureRole, ensureSubscribed]);

  // Gesture handler — requestPermission MUST be the first call (user activation).
  const onEnable = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const permission = await Notification.requestPermission(); // gesture-gated
      if (permission === "denied") { setStatus("denied"); return; }
      if (permission !== "granted") { setStatus("prompt"); return; } // dismissed → still default
      setStatus("working");
      try { await ensureSubscribed(); setStatus("enabled"); }
      catch (e) { setStatus((e as { reason?: string })?.reason === "server" ? "server" : "prompt"); }
    } finally { busyRef.current = false; }
  }, [ensureSubscribed]);

  // Auto-fade the success message.
  useEffect(() => {
    if (status !== "enabled") return;
    const t = setTimeout(() => setStatus("active"), 4000);
    return () => clearTimeout(t);
  }, [status]);

  // ── UI (gesture-driven roles only: shalev + victor) ──
  if (!gestureRole || typeof document === "undefined") return null;
  if (status === "idle" || status === "active") return null;

  let msg = "";
  let action: string | null = null;
  let tone: "info" | "ok" | "err" = "info";
  if (status === "prompt") {
    msg    = isEn ? "Enable notifications to get updates from Redbloods." : "הפעל התראות כדי לקבל עדכונים מהלייבל.";
    action = isEn ? "Enable notifications" : "הפעל התראות";
  }
  else if (status === "working")      { msg = isEn ? "Enabling notifications…" : "מפעיל התראות…"; }
  else if (status === "enabled")      { msg = isEn ? "Notifications enabled" : "ההתראות הופעלו בהצלחה"; tone = "ok"; }
  else if (status === "denied")       { msg = isEn ? "Notifications are blocked in your device settings. Enable them in Settings and reopen the app." : "ההתראות חסומות בהגדרות האייפון. יש להפעיל אותן בהגדרות ולפתוח מחדש את האפליקציה."; tone = "err"; }
  else if (status === "unsupported")  { msg = isEn ? "To get notifications on iPhone, add this app to your Home Screen and open it from the icon." : "כדי לקבל התראות באייפון, יש להוסיף את האפליקציה למסך הבית ולפתוח אותה מהאייקון."; tone = "err"; }
  else if (status === "server")       { msg = isEn ? "We couldn't save your subscription, please try again." : "לא הצלחנו לשמור את ההרשמה, נסה/י שוב."; action = isEn ? "Try again" : "נסה שוב"; tone = "err"; }

  const border = tone === "err" ? "rgba(248,113,113,0.4)" : tone === "ok" ? "rgba(52,211,153,0.4)" : "rgba(220,38,38,0.4)";
  const color  = tone === "err" ? "#FCA5A5" : tone === "ok" ? "#6EE7B7" : "#EDEDF0";

  return createPortal(
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 100050,
      width: "min(420px, 92vw)", display: "flex", alignItems: "center", gap: 12,
      background: "#16121A", border: `1px solid ${border}`, color,
      fontSize: 13, fontWeight: 700, lineHeight: 1.5, padding: "13px 16px", borderRadius: 14,
      boxShadow: "0 8px 30px rgba(0,0,0,0.6)", fontFamily: "'Heebo', Arial, sans-serif", direction: isEn ? "ltr" : "rtl",
    }}>
      <span style={{ flex: 1 }}>{msg}</span>
      {action && (
        <button onClick={onEnable} disabled={status === "working"} style={{
          flexShrink: 0, padding: "9px 16px", borderRadius: 10, border: "none", color: "#fff",
          background: "linear-gradient(180deg, #E5322F, #C01C1C)", fontSize: 13, fontWeight: 800,
          fontFamily: "inherit", cursor: status === "working" ? "wait" : "pointer", opacity: status === "working" ? 0.7 : 1,
        }}>{action}</button>
      )}
      <button onClick={() => setStatus("idle")} aria-label={isEn ? "Close" : "סגור"} style={{
        flexShrink: 0, background: "none", border: "none", color, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 2,
      }}>✕</button>
    </div>,
    document.body,
  );
}
