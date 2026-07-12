"use client";

/**
 * Maintenance screen — what every non-owner sees while the global lock is on.
 * Standalone (no AppShell, no data fetch): renders ONLY this card. The proxy
 * redirects non-owner page requests here; it stays reachable at all times.
 */
export default function MaintenancePage() {
  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100vh", width: "100%", background: "#0A0A0D", color: "#F2F2F2",
        fontFamily: "'Heebo', Arial, sans-serif", display: "flex", alignItems: "center",
        justifyContent: "center", padding: 24, boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "min(460px, 100%)", background: "#111318", border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 22, padding: "40px 32px", textAlign: "center",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            width: 64, height: 64, borderRadius: "50%", margin: "0 auto 22px",
            background: "linear-gradient(145deg, rgba(220,38,38,0.28), rgba(220,38,38,0.10))",
            border: "1px solid rgba(220,38,38,0.4)", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 30, boxShadow: "0 0 26px rgba(220,38,38,0.18)",
          }}
        >
          🔒
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 900, margin: "0 0 14px", letterSpacing: "-0.01em" }}>
          המערכת כרגע בתחזוקה
        </h1>

        <p style={{ fontSize: 14.5, lineHeight: 1.75, color: "#A0A0B0", margin: "0 0 26px" }}>
          אנחנו עושים כמה שיפורים קטנים מאחורי הקלעים 🎛️
          <br />
          המערכת תחזור ממש בקרוב. תודה על הסבלנות.
        </p>

        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "11px 30px", borderRadius: 12, background: "#DC2626", border: "none",
            color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
            boxShadow: "0 4px 18px rgba(220,38,38,0.35)",
          }}
        >
          רענן
        </button>

        {/* Owner sign-in — the only way to bypass maintenance is a real login (server
            verifies the owner role from the session); no URL/secret shortcut. */}
        <div style={{ marginTop: 20 }}>
          <a
            href="/login"
            style={{
              display: "inline-block", fontSize: 12.5, fontWeight: 700, color: "#8A8A98",
              textDecoration: "none", padding: "8px 16px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            כניסת מנהל
          </a>
        </div>
      </div>
    </div>
  );
}
