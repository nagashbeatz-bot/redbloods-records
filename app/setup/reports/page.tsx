"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type SendState = "idle" | "sending" | "ok" | "error";

interface SendResult {
  ok: boolean;
  subject?: string;
  error?: string;
}

interface SmtpStatus {
  configured: boolean;
  smtpUser:  string | null;
  emailTo:   string | null;
  smtpHost:  string;
  smtpPort:  string;
}

export default function ReportsSetupPage() {
  const [status,  setStatus]  = useState<SmtpStatus | null>(null);
  const [morning, setMorning] = useState<SendState>("idle");
  const [evening, setEvening] = useState<SendState>("idle");
  const [morningResult, setMorningResult] = useState<SendResult | null>(null);
  const [eveningResult, setEveningResult] = useState<SendResult | null>(null);

  useEffect(() => {
    fetch("/api/reports/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, smtpUser: null, emailTo: null, smtpHost: "smtp.gmail.com", smtpPort: "587" }));
  }, []);

  async function send(type: "morning" | "evening") {
    const setState  = type === "morning" ? setMorning  : setEvening;
    const setResult = type === "morning" ? setMorningResult : setEveningResult;

    setState("sending");
    setResult(null);

    try {
      const res  = await fetch(`/api/reports/${type}`, { method: "POST" });
      const data: SendResult = await res.json();
      setResult(data);
      setState(data.ok ? "ok" : "error");
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "שגיאת רשת" });
      setState("error");
    }

    setTimeout(() => setState("idle"), 8000);
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#0D0D0D",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "40px 24px", fontFamily: "Heebo, sans-serif", direction: "rtl",
    }}>
      <div style={{ maxWidth: 560, width: "100%" }}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📧</div>
          <h1 style={{ color: "#F0F0F0", fontSize: 24, fontWeight: 800, margin: 0 }}>
            דוחות אימייל יומיים
          </h1>
          <p style={{ color: "#555", fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
            דוח בוקר ב-07:00 ודוח ערב ב-19:00 — Asia/Jerusalem.
          </p>
        </div>

        {/* ── SMTP Status ─────────────────────────────────────────────── */}
        <Card title="סטטוס SMTP" icon="📡">
          {status === null ? (
            <div style={{ color: "#444", fontSize: 13 }}>בודק...</div>
          ) : status.configured ? (
            <div>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)",
                borderRadius: 10, padding: "12px 16px", marginBottom: 14,
              }}>
                <span style={{ fontSize: 16 }}>✓</span>
                <span style={{ color: "#10B981", fontSize: 14, fontWeight: 600 }}>SMTP מוגדר</span>
              </div>
              <Row label="שולח"    value={status.smtpUser!} />
              <Row label="נמען"    value={status.emailTo!} />
              <Row label="שרת"     value={`${status.smtpHost}:${status.smtpPort}`} />
            </div>
          ) : (
            <div>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 10, padding: "12px 16px", marginBottom: 16,
              }}>
                <span style={{ fontSize: 16 }}>✗</span>
                <span style={{ color: "#EF4444", fontSize: 14, fontWeight: 600 }}>SMTP לא מוגדר</span>
              </div>
              <p style={{ color: "#666", fontSize: 13, lineHeight: 1.8, marginBottom: 12 }}>
                הוסף לקובץ <Code>.env.local</Code> (ב-root הפרויקט) והפעל מחדש את השרת:
              </p>
              <CodeBlock>{`SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=youremail@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
EMAIL_FROM=youremail@gmail.com
EMAIL_TO=youremail@gmail.com`}</CodeBlock>

              <div style={{
                background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.2)",
                borderRadius: 10, padding: "12px 16px", marginTop: 14,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#3B82F6", marginBottom: 6 }}>
                  SMTP_PASS = App Password מגוגל
                </div>
                <ol style={{ color: "#666", fontSize: 12, lineHeight: 2.1, margin: 0, paddingRight: 18 }}>
                  <li>כנס ל-Google Account → Security</li>
                  <li>ודא ש-2-Step Verification מופעל</li>
                  <li>
                    כנס ל-{" "}
                    <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{ color: "#3B82F6" }}>
                      myaccount.google.com/apppasswords
                    </a>
                  </li>
                  <li>צור App Password חדש → שם: Redbloods OS</li>
                  <li>העתק 16 התווים → הדבק ב-SMTP_PASS</li>
                </ol>
              </div>
            </div>
          )}
        </Card>

        {/* ── Scheduler ───────────────────────────────────────────────── */}
        <Card title="Scheduler מקומי" icon="⏰">
          <p style={{ color: "#666", fontSize: 13, lineHeight: 1.8, marginBottom: 12 }}>
            אחרי הגדרת ה-SMTP, פתח טרמינל נוסף והרץ:
          </p>
          <CodeBlock>npm run daily-reports</CodeBlock>
          <p style={{ color: "#555", fontSize: 12, lineHeight: 1.7, marginTop: 10 }}>
            השאר את הטרמינל פתוח — ישלח דוחות ב-07:00 וב-19:00 כל עוד הוא רץ.
          </p>
        </Card>

        {/* ── Test buttons ─────────────────────────────────────────────── */}
        <Card title="בדיקת שליחה" icon="🧪">
          <p style={{ color: "#555", fontSize: 13, marginBottom: 20 }}>
            שלח דוח אמיתי עכשיו — השרת חייב לרוץ ו-SMTP מוגדר.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <SendButton label="☀️  שלח דוח בוקר עכשיו" state={morning} onClick={() => send("morning")} />
            <SendButton label="🌙 שלח דוח ערב עכשיו"  state={evening} onClick={() => send("evening")} />
          </div>
          {morningResult && <ResultBox result={morningResult} />}
          {eveningResult && <ResultBox result={eveningResult} />}
        </Card>

        <Link href="/dashboard" style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          marginTop: 8, padding: "13px 24px", borderRadius: 14,
          border: "1px solid #2A2A2A", background: "#141414",
          color: "#D0D0D0", fontSize: 14, fontWeight: 600,
          textDecoration: "none", transition: "all 0.15s",
        }}>
          ← חזור לדשבורד
        </Link>

      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "#141414", border: "1px solid #252525", borderRadius: 18,
      padding: "24px 28px", marginBottom: 20,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#555", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 16 }}>
        {icon}  {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #1E1E1E", fontSize: 13 }}>
      <span style={{ color: "#555" }}>{label}</span>
      <span style={{ color: "#D0D0D0", direction: "ltr", textAlign: "left" }}>{value}</span>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ background: "#111", border: "1px solid #252525", borderRadius: 5, padding: "1px 6px", fontSize: 12, color: "#3B82F6" }}>
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "#0D0D0D", border: "1px solid #252525", borderRadius: 10,
      padding: "14px 16px", fontFamily: "monospace", fontSize: 12,
      color: "#888", lineHeight: 2, direction: "ltr", textAlign: "left", whiteSpace: "pre",
    }}>
      {children}
    </div>
  );
}

function SendButton({ label, state, onClick }: { label: string; state: SendState; onClick: () => void }) {
  const busy = state === "sending";
  const styles: Record<SendState, { bg: string; border: string; color: string; label: string }> = {
    idle:    { bg: "rgba(59,130,246,0.12)",  border: "rgba(59,130,246,0.3)",  color: "#3B82F6", label },
    sending: { bg: "rgba(168,85,247,0.10)", border: "rgba(168,85,247,0.3)", color: "#A855F7", label: "שולח..." },
    ok:      { bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.3)", color: "#10B981", label: "✓ נשלח!" },
    error:   { bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.3)",  color: "#EF4444", label: "✗ שגיאה" },
  };
  const s = styles[state];
  return (
    <button onClick={onClick} disabled={busy} style={{
      padding: "11px 20px", borderRadius: 12, cursor: busy ? "default" : "pointer",
      border: `1px solid ${s.border}`, background: s.bg, color: s.color,
      fontSize: 13, fontWeight: 600, fontFamily: "inherit", transition: "all 0.2s",
    }}>
      {s.label}
    </button>
  );
}

function ResultBox({ result }: { result: SendResult }) {
  return result.ok ? (
    <div style={{ marginTop: 16, background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 10, padding: "12px 16px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#10B981", marginBottom: 4 }}>✓ האימייל נשלח בהצלחה</div>
      {result.subject && <div style={{ fontSize: 12, color: "#555" }}>נושא: {result.subject}</div>}
    </div>
  ) : (
    <div style={{ marginTop: 16, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "12px 16px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#EF4444", marginBottom: 4 }}>✗ שגיאה בשליחה</div>
      <div style={{ fontSize: 12, color: "#888" }}>{result.error}</div>
    </div>
  );
}
