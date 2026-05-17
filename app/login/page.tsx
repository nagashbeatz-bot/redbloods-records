"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const from         = searchParams.get("from") || "/dashboard";

  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  // Auto-focus
  useEffect(() => {
    document.getElementById("rb-password")?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push(from);
      router.refresh();
    } else {
      setError("סיסמה שגויה");
      setPassword("");
      setLoading(false);
    }
  };

  return (
    <div dir="rtl" style={{
      minHeight: "100vh", background: "#0E0E0E",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        background: "#141414", border: "1px solid #252525",
        borderRadius: 20, padding: "40px 32px",
        width: "100%", maxWidth: 360,
        boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, margin: "0 auto 12px",
            background: "linear-gradient(135deg, #EC4899, #3B82F6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800, color: "#fff",
          }}>RB</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#E8E8E8" }}>Redbloods Records</div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>כניסה למערכת</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: "#555", fontWeight: 700, display: "block", marginBottom: 6 }}>
              סיסמה
            </label>
            <input
              id="rb-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="הכנס סיסמה..."
              style={{
                width: "100%", background: "#1A1A1A",
                border: `1px solid ${error ? "#EF4444" : "#2A2A2A"}`,
                borderRadius: 10, color: "#E8E8E8",
                fontSize: 14, padding: "10px 14px",
                outline: "none", fontFamily: "inherit",
                boxSizing: "border-box", direction: "ltr",
              }}
              onFocus={(e) => { if (!error) e.currentTarget.style.borderColor = "#3B82F6"; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = error ? "#EF4444" : "#2A2A2A"; }}
            />
            {error && (
              <div style={{ fontSize: 12, color: "#EF4444", marginTop: 6 }}>{error}</div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              padding: "11px", borderRadius: 10, border: "none",
              background: loading || !password
                ? "#1A2A3A"
                : "linear-gradient(135deg, #EC4899, #3B82F6)",
              color: loading || !password ? "#445" : "#fff",
              fontSize: 14, fontWeight: 700, cursor: loading || !password ? "not-allowed" : "pointer",
              fontFamily: "inherit", transition: "all 0.15s",
            }}
          >
            {loading ? "נכנס..." : "כניסה"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
