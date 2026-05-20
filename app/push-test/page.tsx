"use client";

import { useState, useEffect } from "react";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

function b64(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

export default function PushTestPage() {
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const add = (msg: string) => setLog((p) => [...p, msg]);

  async function runTest() {
    setLog([]);
    setDone(false);

    // 1. Standalone mode?
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    add(`📱 PWA Standalone: ${standalone ? "✅ כן" : "❌ לא — פתח מהמסך הבית"}`);

    // 2. Service Worker support
    if (!("serviceWorker" in navigator)) {
      add("❌ Service Worker לא נתמך בדפדפן זה"); setDone(true); return;
    }
    add("✅ Service Worker נתמך");

    // 3. Push support
    if (!("PushManager" in window)) {
      add("❌ Push Notifications לא נתמך — iOS 16.4+ נדרש"); setDone(true); return;
    }
    add("✅ Push Manager נתמך");

    // 4. Notification permission
    add(`🔔 הרשאת התראות: ${Notification.permission}`);
    if (Notification.permission === "denied") {
      add("❌ ההרשאה נדחתה — כנס להגדרות iOS ואפשר התראות לאפליקציה"); setDone(true); return;
    }

    // 5. Register SW
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      add("✅ Service Worker נרשם");
    } catch (e) {
      add(`❌ שגיאה ברישום SW: ${e}`); setDone(true); return;
    }

    // 6. Request permission
    if (Notification.permission !== "granted") {
      add("⏳ מבקש הרשאה...");
      const perm = await Notification.requestPermission();
      add(`🔔 תשובה: ${perm}`);
      if (perm !== "granted") { add("❌ לא אושר"); setDone(true); return; }
    }
    add("✅ הרשאה אושרה");

    // 7. Subscribe
    try {
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        add("ℹ️ מנוי קיים — מעדכן...");
        await existing.unsubscribe();
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64(VAPID_KEY),
      });
      add("✅ מנוי נוצר");

      // 8. Save to server
      add("⏳ שומר בשרת...");
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      const data = await res.json();
      if (data.ok) {
        add("✅ נשמר בשרת בהצלחה!");
        add("🎉 הכל מוכן — תוכל לקבל התראות עכשיו");
      } else {
        add(`❌ שגיאה בשמירה: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      add(`❌ שגיאה במנוי: ${e}`);
    }

    setDone(true);
  }

  return (
    <div style={{
      background: "#0D0D0D", minHeight: "100dvh", padding: 24,
      fontFamily: "system-ui, sans-serif", direction: "rtl", color: "#F0F0F0",
    }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>🔔 בדיקת Push Notifications</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>
        פתח דף זה מהאפליקציה במסך הבית ולחץ "הפעל בדיקה"
      </p>

      <button
        onClick={runTest}
        style={{
          width: "100%", padding: "16px", borderRadius: 14,
          background: "linear-gradient(135deg, #3B82F6, #A855F7)",
          border: "none", color: "#fff", fontSize: 16, fontWeight: 700,
          cursor: "pointer", marginBottom: 24,
        }}
      >
        הפעל בדיקה
      </button>

      {log.length > 0 && (
        <div style={{
          background: "#141414", border: "1px solid #252525",
          borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 8,
        }}>
          {log.map((l, i) => (
            <div key={i} style={{ fontSize: 13, color: "#C0C0C0", lineHeight: 1.5 }}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
