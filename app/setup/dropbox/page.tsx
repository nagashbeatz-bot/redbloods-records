"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";

function DropboxSetupInner() {
  const params = useSearchParams();
  const router = useRouter();

  const [connected,     setConnected]     = useState<boolean | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const justConnected = params.get("connected") === "1";
  const oauthError    = params.get("error");

  useEffect(() => {
    fetch("/api/dropbox/status")
      .then((r) => r.json())
      .then((d) => setConnected(!!d.connected))
      .catch(() => setConnected(false));
  }, [justConnected]);

  async function startOAuth() {
    setLoading(true);
    try {
      const r = await fetch("/api/dropbox/auth");
      const d = await r.json();
      if (d.url) window.location.href = d.url;
      else alert(d.error ?? "שגיאה");
    } catch { alert("שגיאת רשת"); }
    finally { setLoading(false); }
  }

  async function disconnect() {
    if (!confirm("לנתק את Dropbox?")) return;
    setDisconnecting(true);
    await fetch("/api/dropbox/status", { method: "DELETE" });
    setConnected(false);
    router.replace("/setup/dropbox");
    setDisconnecting(false);
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (connected === null) {
    return (
      <AppShell>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#444", fontSize: 13 }}>
          בודק חיבור...
        </div>
      </AppShell>
    );
  }

  // ── Connected ────────────────────────────────────────────────────────────────
  if (connected) {
    return (
      <AppShell>
        {justConnected && (
          <div style={{
            background: "rgba(16,185,129,0.08)", borderBottom: "1px solid rgba(16,185,129,0.2)",
            padding: "10px 20px", direction: "rtl", fontSize: 13, color: "#10B981",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            ✓ Dropbox חובר בהצלחה — הטוקן מתחדש אוטומטית
            <button
              onClick={() => router.replace("/setup/dropbox")}
              style={{ background: "none", border: "none", color: "#10B981", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
            >
              סגור
            </button>
          </div>
        )}

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: "80vh", padding: 24,
          fontFamily: "Heebo, sans-serif", direction: "rtl",
        }}>
          <div style={{
            background: "#141414", border: "1px solid #252525",
            borderRadius: 20, padding: "40px 48px",
            maxWidth: 480, width: "100%", textAlign: "right",
          }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📦</div>
            <h1 style={{ color: "#F0F0F0", fontSize: 22, fontWeight: 700, margin: 0 }}>
              Dropbox
            </h1>

            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)",
              borderRadius: 10, padding: "10px 14px", marginTop: 20, marginBottom: 20,
            }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10B981", flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "#10B981", fontWeight: 600 }}>מחובר — הטוקן מתחדש אוטומטית</span>
            </div>

            <p style={{ color: "#555", fontSize: 13, lineHeight: 1.7, marginBottom: 24 }}>
              Dropbox מחובר ופועל. הטוקן מתחדש אוטומטית בכל פעם שהוא פג — אין צורך לחזור לכאן.
            </p>
            <p style={{ color: "#555", fontSize: 12, lineHeight: 1.7, marginBottom: 24 }}>
              לחיבור מחדש עם חשבון אחר, נתק ולאחר מכן התחבר שוב.
            </p>

            <button
              onClick={disconnect}
              disabled={disconnecting}
              style={{
                width: "100%", padding: "11px 16px", borderRadius: 10,
                border: "1px solid rgba(239,68,68,0.25)",
                background: "rgba(239,68,68,0.07)", color: "#EF4444",
                fontSize: 13, cursor: disconnecting ? "default" : "pointer",
                opacity: disconnecting ? 0.6 : 1, fontFamily: "inherit",
              }}
            >
              {disconnecting ? "מנתק..." : "נתק Dropbox"}
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Not connected ────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "80vh", padding: 24,
        fontFamily: "Heebo, sans-serif", direction: "rtl",
      }}>
        <div style={{
          background: "#141414", border: "1px solid #252525",
          borderRadius: 20, padding: "40px 48px",
          maxWidth: 480, width: "100%", textAlign: "right",
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📦</div>
          <h1 style={{ color: "#F0F0F0", fontSize: 22, fontWeight: 700, margin: 0 }}>
            Dropbox
          </h1>
          <p style={{ color: "#666", fontSize: 14, marginTop: 6, lineHeight: 1.6 }}>
            חבר את Dropbox כדי ליצור תיקיות דליברי ולשתף קבצים עם לקוחות.
          </p>

          {oauthError && (
            <div style={{
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 10, padding: "12px 16px", color: "#EF4444", fontSize: 13, marginTop: 20,
            }}>
              שגיאת התחברות: {decodeURIComponent(oauthError)}
            </div>
          )}

          <div style={{ marginTop: 28 }}>
            <p style={{ color: "#888", fontSize: 13, lineHeight: 1.8, marginBottom: 12 }}>
              ודא שהמשתנים הבאים קיימים ב-<code style={{ color: "#3B82F6" }}>.env.local</code>:
            </p>
            <div style={{
              background: "#0D0D0D", border: "1px solid #252525", borderRadius: 8,
              padding: "12px 14px", fontFamily: "monospace", fontSize: 11,
              color: "#888", lineHeight: 2, direction: "ltr", textAlign: "left",
            }}>
              DROPBOX_APP_KEY=your_app_key<br />
              DROPBOX_APP_SECRET=your_app_secret
            </div>

            <p style={{ color: "#555", fontSize: 11, lineHeight: 1.7, marginTop: 10, marginBottom: 0 }}>
              צור אפליקציה ב-<a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener" style={{ color: "#3B82F6" }}>Dropbox App Console</a>.
              <br />הוסף את ה-redirect URI: <code style={{ color: "#888" }}>[כתובת-האתר]/api/dropbox/callback</code>
            </p>

            <button
              onClick={startOAuth}
              disabled={loading}
              style={{
                marginTop: 24, width: "100%",
                padding: "13px 24px", borderRadius: 12,
                border: `1px solid ${loading ? "transparent" : "rgba(59,130,246,0.25)"}`,
                background: loading ? "#1A1A1A" : "rgba(59,130,246,0.15)",
                color: loading ? "#444" : "#3B82F6",
                fontSize: 15, fontWeight: 600, cursor: loading ? "default" : "pointer",
                fontFamily: "inherit",
              } as React.CSSProperties}
            >
              {loading ? "מעביר ל-Dropbox..." : "🔗 התחבר עם Dropbox"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default function DropboxSetupPage() {
  return (
    <Suspense fallback={
      <AppShell>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#444", fontSize: 13 }}>
          טוען...
        </div>
      </AppShell>
    }>
      <DropboxSetupInner />
    </Suspense>
  );
}
