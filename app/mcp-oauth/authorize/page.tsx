/**
 * Redbloods Partner MCP connector — OAuth authorization endpoint (Owner consent page).
 * Cookie-authenticated as the Redbloods Owner (the proxy sends everyone else to login / their own home; this
 * page re-checks). The request is validated BEFORE anything is shown; an untrusted client / redirect is never
 * redirected to. The form carries a MAC bound to this Owner and this exact request (CSRF).
 */
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/require-auth";
import { roleForEmail } from "@/lib/roles";
import { consentToken, validateAuthorizeRequest } from "@/lib/integrations/partner-mcp/oauth";
import { getMcpRuntime } from "@/lib/integrations/partner-mcp/server";
import { MCP_SCOPE } from "@/lib/integrations/partner-mcp/config";

export const dynamic = "force-dynamic";

const box: React.CSSProperties = { maxWidth: 520, margin: "48px auto", padding: 24, borderRadius: 16, background: "#161616", color: "#f2f2f2", fontFamily: "Heebo, sans-serif", lineHeight: 1.6 };
const btn = (primary: boolean): React.CSSProperties => ({ flex: 1, padding: "12px 16px", borderRadius: 10, border: primary ? "none" : "1px solid #444", background: primary ? "#c62828" : "transparent", color: "#fff", fontSize: 16, cursor: "pointer" });

function Message({ title, text }: { title: string; text: string }) {
  return <div dir="rtl" style={box}><h1 style={{ fontSize: 20, margin: "0 0 12px" }}>{title}</h1><p style={{ margin: 0 }}>{text}</p></div>;
}

export default async function McpAuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const rt = await getMcpRuntime();
  if (!rt) notFound();
  const user = await getAuthUser();
  if (!user || roleForEmail(user.email) !== "owner") return <Message title="אין הרשאה" text="רק הבעלים של Redbloods יכול לאשר חיבור של Claude ל־Partner." />;
  const v = await validateAuthorizeRequest(await searchParams, rt.oauth);
  if (!v.ok && v.kind === "REDIRECT") redirect(v.location);
  if (!v.ok) return <Message title="בקשת חיבור לא תקינה" text={`לא ניתן להמשיך: ${v.error}. התחל מחדש מתוך Claude.`} />;
  const r = v.request;
  const csrf = consentToken(r, user.id, rt.oauth);
  const hidden: Record<string, string> = {
    response_type: "code", client_id: r.clientId, redirect_uri: r.redirectUri, code_challenge: r.codeChallenge, code_challenge_method: "S256",
    scope: r.scope, resource: r.resource, state: r.state, csrf,
  };
  return (
    <div dir="rtl" style={box}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>חיבור Claude ל־Redbloods Partner</h1>
      <p style={{ margin: "0 0 16px" }}>
        Claude מבקש גישת <b>קריאה בלבד</b> ל־Redbloods Partner.<br />
        <span dir="ltr" style={{ display: "inline-block" }}>Claude is requesting READ access to Redbloods Partner.</span>
      </p>
      <ul style={{ margin: "0 0 16px", paddingInlineStart: 20 }}>
        <li>הרשאה: <code dir="ltr">{MCP_SCOPE}</code> — קריאת התמונה של Partner (מה חשוב עכשיו, ישויות, זיכרון, תוצאות).</li>
        <li><b>אין גישת כתיבה</b>: Claude לא יכול לאשר, לבצע, לענות על שאלות או לשנות נתונים. <span dir="ltr">No write access.</span></li>
        <li>אפשר לנתק בכל רגע.</li>
        <li><b>אשר רק אם לחצת עכשיו בעצמך על Connect בחשבון Claude שלך.</b> אם קיבלת את הקישור הזה ממישהו אחר — דחה.</li>
      </ul>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "#aaa" }}>
        לקוח: <span dir="auto">{r.clientName || "ללא שם"}</span> · חזרה אל: <code dir="ltr">{new URL(r.redirectUri).host}</code>
      </p>
      <form method="post" action="/api/mcp-oauth/authorize" style={{ display: "flex", gap: 12 }}>
        {Object.entries(hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
        <button type="submit" name="decision" value="allow" style={btn(true)}>אשר גישת קריאה</button>
        <button type="submit" name="decision" value="deny" style={btn(false)}>דחה</button>
      </form>
    </div>
  );
}
