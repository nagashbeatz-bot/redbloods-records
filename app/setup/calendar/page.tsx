"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import WeekCalendar from "@/components/calendar/WeekCalendar";

export default function CalendarPage() {
  const params = useSearchParams();
  const router = useRouter();

  const [connected,    setConnected]    = useState<boolean | null>(null);
  const [showManage,   setShowManage]   = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [disconnecting,setDisconnecting]= useState(false);

  const justConnected = params.get("connected") === "1";
  const oauthError    = params.get("error");

  useEffect(() => {
    fetch("/api/calendar/status")
      .then((r) => r.json())
      .then((d) => setConnected(!!d.connected))
      .catch(() => setConnected(false));
  }, [justConnected]);

  async function startOAuth() {
    setLoading(true);
    try {
      const r = await fetch("/api/calendar/auth");
      const d = await r.json();
      if (d.url) window.location.href = d.url;
      else alert(d.error ?? "שגיאה");
    } catch { alert("שגיאת רשת"); }
    finally { setLoading(false); }
  }

  async function disconnect() {
    if (!confirm("לנתק את Google Calendar?")) return;
    setDisconnecting(true);
    await fetch("/api/calendar/status", { method: "DELETE" });
    setConnected(false);
    setShowManage(false);
    router.replace("/setup/calendar");
    setDisconnecting(false);
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (connected === null) {
    return (
      <AppShell>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#444", fontSize: 13 }}>
          בודק חיבור...
        </div>
      </AppShell>
    );
  }

  // ── Not connected ────────────────────────────────────────────────────────────
  if (!connected) {
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
            <div style={{ fontSize: 36, marginBottom: 8 }}>📅</div>
            <h1 style={{ color: "#F0F0F0", fontSize: 22, fontWeight: 700, margin: 0 }}>
              Google Calendar
            </h1>
            <p style={{ color: "#666", fontSize: 14, marginTop: 6, lineHeight: 1.6 }}>
              חבר את היומן שלך כדי לראות את השבוע הקרוב ישירות ב-Redbloods OS.
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
              <p style={{ color: "#888", fontSize: 13, lineHeight: 1.8, marginBottom: 16 }}>
                ודא שהמשתנים הבאים קיימים ב-<code style={{ color: "#3B82F6" }}>.env.local</code>:
              </p>
              <div style={{
                background: "#0D0D0D", border: "1px solid #252525", borderRadius: 8,
                padding: "12px 14px", fontFamily: "monospace", fontSize: 11,
                color: "#888", lineHeight: 2, direction: "ltr", textAlign: "left",
              }}>
                GOOGLE_CLIENT_ID=...<br />
                GOOGLE_CLIENT_SECRET=...<br />
                GOOGLE_REDIRECT_URI=http://localhost:3000/api/calendar/callback
              </div>

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
                {loading ? "מעביר לגוגל..." : "🔗 התחבר עם Google"}
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Connected — weekly calendar view ─────────────────────────────────────────
  return (
    <AppShell>
      {/* Manage connection drawer */}
      {showManage && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 99999,
          background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          direction: "rtl",
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowManage(false); }}
        >
          <div style={{
            background: "#141414", border: "1px solid #252525",
            borderRadius: 18, padding: "28px 32px", maxWidth: 360, width: "100%",
          }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#555", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 16 }}>
              📅  Google Calendar
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)",
              borderRadius: 10, padding: "10px 14px", marginBottom: 20,
            }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10B981", flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "#10B981", fontWeight: 600 }}>מחובר — קורא ויוצר אירועים</span>
            </div>
            <p style={{ color: "#555", fontSize: 12, lineHeight: 1.7, marginBottom: 20 }}>
              לחיבור מחדש עם הרשאות מעודכנות, נתק ולאחר מכן התחבר שוב.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={disconnect}
                disabled={disconnecting}
                style={{
                  flex: 1, padding: "10px 16px", borderRadius: 10,
                  border: "1px solid rgba(239,68,68,0.25)",
                  background: "rgba(239,68,68,0.07)", color: "#EF4444",
                  fontSize: 13, cursor: disconnecting ? "default" : "pointer",
                  opacity: disconnecting ? 0.6 : 1, fontFamily: "inherit",
                }}
              >
                {disconnecting ? "מנתק..." : "נתק"}
              </button>
              <button
                onClick={() => setShowManage(false)}
                style={{
                  flex: 1, padding: "10px 16px", borderRadius: 10,
                  border: "1px solid #2A2A2A", background: "#1A1A1A",
                  color: "#888", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                סגור
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Just connected banner */}
      {justConnected && (
        <div style={{
          background: "rgba(16,185,129,0.08)", borderBottom: "1px solid rgba(16,185,129,0.2)",
          padding: "10px 20px", direction: "rtl", fontSize: 13, color: "#10B981",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          ✓ Google Calendar חובר בהצלחה — אתה רואה את השבוע שלך
          <button
            onClick={() => router.replace("/setup/calendar")}
            style={{ background: "none", border: "none", color: "#10B981", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
          >
            סגור
          </button>
        </div>
      )}

      <WeekCalendar onManageConnection={() => setShowManage(true)} />
    </AppShell>
  );
}
