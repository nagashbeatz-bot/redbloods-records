"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase-browser";

export const dynamic = "force-dynamic";

function LoginForm() {
  const params = useSearchParams();
  const redirectTo = params.get("redirect") || "/dashboard";

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const supabase = createSupabaseBrowser();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        setError("אימייל או סיסמה שגויים");
        setLoading(false);
        return;
      }
      // Hard navigation (not router.push) so the root data providers remount and
      // refetch with the new session cookie — otherwise pages render empty until
      // a manual refresh, because client-side navigation keeps the providers
      // (already mounted on /login) with their stale anonymous (401) state.
      // Never bounce back to /login or /maintenance after a successful sign-in — the
      // owner should land in the app; the proxy re-checks the role on that navigation.
      const target = redirectTo.startsWith("/") && redirectTo !== "/login" && redirectTo !== "/maintenance" ? redirectTo : "/dashboard";
      window.location.assign(target);
    } catch {
      setError("שגיאה בהתחברות, נסה שוב");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label style={labelStyle}>אימייל</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="email" required dir="ltr"
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>סיסמה</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password" required dir="ltr"
          style={inputStyle}
        />
      </div>

      {error && <div style={{ fontSize: 13, color: "#EF4444", textAlign: "center" }}>{error}</div>}

      <button
        type="submit" disabled={loading || !email || !password}
        style={{
          marginTop: 4, padding: "12px 0", borderRadius: 12, border: "none",
          background: loading || !email || !password ? "#3A1010" : "#DC2626",
          color: "#fff", fontSize: 14, fontWeight: 800, fontFamily: "inherit",
          cursor: loading || !email || !password ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "מתחבר…" : "התחברות"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div dir="rtl" style={{
      // 100dvh (not 100vh) so the iOS Safari toolbar can't overshoot the height —
      // consistent with globals.css, which already uses dvh everywhere else.
      // min-height (not height) keeps the card scrollable if it ever exceeds the
      // viewport, so centering can never clip its top.
      minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0A0A0A", padding: 20, fontFamily: "inherit",
    }}>
      <div style={{
        width: "100%", maxWidth: 380, background: "#141414",
        border: "1px solid #262626", borderRadius: 22, padding: "32px 28px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.1em", color: "#DC2626" }}>REDBLOODS</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#F5F5F5", marginTop: 6 }}>כניסה למערכת</div>
          <div style={{ fontSize: 12, color: "#777", marginTop: 6 }}>גישה למשתמשים מורשים בלבד</div>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, color: "#888", fontWeight: 700,
  letterSpacing: "0.05em", marginBottom: 7,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 13px", borderRadius: 11,
  border: "1px solid #303030", background: "#0D0D0D", color: "#E8E8E8",
  // 16px is mandatory, not cosmetic: iOS Safari force-zooms the page on focus
  // whenever a focused input computes to < 16px. That zoom is what magnified the
  // whole card (and made the 380px card look full-bleed) while typing. There is
  // no accessible alternative — maximum-scale / user-scalable=no and a
  // transform:scale counter-hack are both off the table.
  fontSize: 16, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
