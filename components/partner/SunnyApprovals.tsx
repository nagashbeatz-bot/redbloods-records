"use client";

/**
 * Sunny Brain — the Owner's approvals screen (/sunny-approvals). Owner-only, Hebrew, minimal.
 *
 * - Reads GET /api/partner/approvals when the Owner opens this screen (a read — nothing is written on load).
 * - Every decision is an explicit click → POST /api/partner/approvals with the request's exact payload hash
 *   (seenHash): the database approves exactly what was shown, or refuses (SEEN_HASH_MISMATCH → refresh).
 * - The RPC runs with the Owner's own session: the database proves him. No optimistic change: after every result the
 *   screen re-reads. While a request is in flight every control is disabled (a ref blocks double clicks).
 * - Not installed → says so (the Brain / approval queue migration is not applied); never shows "nothing pending" then.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Req = { id: string; kind: string; summaryHe: string; riskHe: string; payload: Record<string, unknown>; payloadHash: string; createdAt: string; expiresAt: string | null; state: string; decision: { decision: string; reasonHe: string | null; createdAt: string; decidedRole?: string } | null };
type Auth = { id: string; purposeHe: string; purposeKind: string; observationFamilies: string[]; sourceKinds: string[]; entityKeys: string[]; resourceIds: string[]; insightsAllowed: boolean; recommendationsAllowed: boolean; maxObservationsPerDay: number | null; validFrom: string; validUntil: string | null; state: string };
type Rec = { id: string; recordType: string; titleHe: string; body: Record<string, unknown>; area: string; confidence: string; status: string | null; createdAt: string };
type View = { status: "OK"; t2Installed: boolean; todayIL: string; pending: Req[]; decided: Req[]; authorizations: Auth[]; records: Rec[]; counts: { resources: number; observations: number } } | { status: "NOT_INSTALLED" } | { status: "ERROR" } | { status: "LOADING" };

const STATE_HE: Record<string, string> = { ACTIVE: "פעילה", REVOKED: "בוטלה", SUPERSEDED: "הוחלפה", EXPIRED: "פג תוקף", NOT_YET_VALID: "עוד לא בתוקף", APPROVED: "אושרה", REJECTED: "נדחתה", CANCELLED: "בוטלה ע״י סאני", PENDING: "מחכה", OPEN: "פתוחה", ENDORSED: "אישרת", ACCEPTED: "קיבלת" };
const card: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 12, background: "rgba(255,255,255,0.03)" };
const btn = (primary: boolean): React.CSSProperties => ({ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: primary ? "#b91c1c" : "transparent", color: "#fff", cursor: "pointer", fontSize: 14 });

export default function SunnyApprovals() {
  const [view, setView] = useState<View>({ status: "LOADING" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/partner/approvals", { cache: "no-store" });
      const b = (await r.json()) as View;
      setView(r.ok && (b.status === "OK" || b.status === "NOT_INSTALLED") ? b : { status: "ERROR" });
    } catch { setView({ status: "ERROR" }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const send = useCallback(async (body: Record<string, unknown>, confirmHe: string) => {
    if (inFlight.current) return;
    if (!window.confirm(confirmHe)) return;
    inFlight.current = true; setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/partner/approvals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const b = (await r.json().catch(() => ({}))) as { messageHe?: string; status?: string };
      setMsg(b.messageHe ?? (r.ok ? "בוצע." : "לא בוצע."));
    } catch { setMsg("לא הצלחתי לשלוח. שום דבר לא סומן כבוצע — רענן ובדוק."); }
    finally { inFlight.current = false; setBusy(false); await load(); }
  }, [load]);

  const reason = (q: string) => { const t = window.prompt(q); return t && t.trim() ? t.trim().slice(0, 300) : null; };

  if (view.status === "LOADING") return <p dir="rtl">טוען…</p>;
  if (view.status === "ERROR") return <p dir="rtl">לא הצלחתי לקרוא את האישורים כרגע. זה לא אומר שאין — נסה לרענן.</p>;
  if (view.status === "NOT_INSTALLED") return <div dir="rtl" style={card}><b>המוח של סאני עוד לא מותקן.</b> המיגרציות של המוח / תור האישורים עוד לא הוחלו במסד הנתונים — אין כאן מה לאשר עדיין.</div>;

  return (
    <div dir="rtl" style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>אישורים לסאני</h1>
      <p style={{ margin: "0 0 8px", opacity: 0.8, fontSize: 14 }}>סאני יכולה רק לבקש. רק אתה מאשר, ורק כאן. אישור מתייחס בדיוק למה שמוצג; אם הבקשה השתנתה — היא תידחה ותצטרך לרענן.</p>
      <div style={{ ...card, fontSize: 14 }} data-authorization-meaning>
        <b>מה הרשאת מעקב אומרת:</b> כשאבקש מסאני לבדוק, או כשאאשר הצעה שלה לבדוק מחדש, היא רשאית לשמור את הנתונים האלה כדי להשוות וללמוד מהם.
        <br /><b>מה היא לא אומרת:</b> סאני לא סורקת את החשבון באופן רציף. אין בדיקה אוטומטית ברקע, אין תזמון ואין חיבור לפלטפורמה — היא נכנסת לעמוד הציבורי דרך הדפדפן רק כשביקשת או אישרת. היא יכולה להציע &quot;רוצה שאבדוק שוב?&quot;, ומחכה לתשובה שלך.
      </div>
      {msg ? <div style={{ ...card, borderColor: "rgba(185,28,28,0.6)" }}>{msg}</div> : null}
      {!view.t2Installed ? <div style={card}>תור האישורים עוד לא מותקן — סאני לא יכולה לשלוח בקשות עדיין.</div> : null}

      <h2 style={{ fontSize: 18, margin: "18px 0 8px" }}>מחכה להחלטה שלך ({view.pending.length})</h2>
      {view.pending.length === 0 ? <p style={{ opacity: 0.7 }}>אין בקשות פתוחות.</p> : view.pending.map((q) => {
        const late = q.kind === "TRACKING_AUTHORIZATION" && typeof q.payload.validFrom === "string" && q.payload.validFrom < view.todayIL;
        return (
          <div key={q.id} style={card} data-approval-request={q.id}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{q.kind === "TRACKING_AUTHORIZATION" ? "בקשת הרשאת מעקב" : "ערכים שמסרת — לרישום"}</div>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "0 0 8px" }}>{q.summaryHe}</pre>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>{q.riskHe}</div>
            {late ? <div style={{ fontSize: 13, marginBottom: 8 }}>תאריך ההתחלה שביקשה כבר עבר — אם תאשר, ההרשאה תתחיל היום ({view.todayIL}).</div> : null}
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 10 }}>נשלחה {q.createdAt.slice(0, 16).replace("T", " ")}{q.expiresAt ? ` · בתוקף עד ${q.expiresAt.slice(0, 10)}` : ""}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button disabled={busy} style={btn(true)} onClick={() => send({ op: "decide", requestId: q.id, decision: "APPROVED", seenHash: q.payloadHash }, "לאשר בדיוק את מה שמוצג?")}>אשר</button>
              <button disabled={busy} style={btn(false)} onClick={() => { const r = reason("למה לדחות? (לא חובה)"); void send({ op: "decide", requestId: q.id, decision: "REJECTED", seenHash: q.payloadHash, ...(r ? { reasonHe: r } : {}) }, "לדחות את הבקשה?"); }}>דחה</button>
            </div>
          </div>
        );
      })}

      <h2 style={{ fontSize: 18, margin: "18px 0 8px" }}>הרשאות מעקב</h2>
      {view.authorizations.length === 0 ? <p style={{ opacity: 0.7 }}>אין הרשאות.</p> : view.authorizations.map((a) => (
        <div key={a.id} style={card}>
          <div style={{ fontWeight: 600 }}>{a.purposeHe} <span style={{ fontWeight: 400, opacity: 0.7 }}>· {STATE_HE[a.state] ?? a.state}</span></div>
          <div style={{ fontSize: 13, opacity: 0.85, margin: "6px 0" }}>מדידות: {a.observationFamilies.join(", ")} · מקורות: {a.sourceKinds.join(", ")} · תובנות: {a.insightsAllowed ? "כן" : "לא"} · המלצות: {a.recommendationsAllowed ? "כן" : "לא"} · תקרה ליום: {a.maxObservationsPerDay ?? "ללא"} · מ-{a.validFrom}{a.validUntil ? ` עד ${a.validUntil}` : ""}</div>
          {a.state === "ACTIVE" || a.state === "NOT_YET_VALID" ? (
            <button disabled={busy} style={btn(false)} onClick={() => { const r = reason("למה לבטל? (חובה)"); if (r) void send({ op: "revoke", authorizationId: a.id, reasonHe: r }, "לבטל את ההרשאה? סאני תפסיק לרשום תחתיה מיד."); }}>בטל הרשאה</button>
          ) : null}
        </div>
      ))}

      <h2 style={{ fontSize: 18, margin: "18px 0 8px" }}>תובנות והמלצות של סאני</h2>
      <p style={{ fontSize: 13, opacity: 0.75, margin: "0 0 8px" }}>תובנה היא השערה של סאני. אישור שלך נרשם כסטטוס — הוא לא הופך אותה ללקח שלך (לקח נשמר רק כשאתה אומר אותו לסאני ומאשר).</p>
      {view.records.length === 0 ? <p style={{ opacity: 0.7 }}>אין.</p> : view.records.map((x) => {
        const isRec = x.recordType === "RECOMMENDATION";
        const text = String((isRec ? x.body.presentedHe ?? x.body.recommendationHe : x.body.statementHe) ?? "");
        return (
          <div key={x.id} style={card}>
            <div style={{ fontWeight: 600 }}>{isRec ? "המלצה" : "תובנה"}: {x.titleHe} <span style={{ fontWeight: 400, opacity: 0.7 }}>· {STATE_HE[x.status ?? ""] ?? x.status} · ביטחון {x.confidence}</span></div>
            <div style={{ margin: "6px 0 10px" }}>{text}</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {x.status === "OPEN" ? <button disabled={busy} style={btn(true)} onClick={() => send({ op: "transition", targetKind: "RECORD", targetId: x.id, toStatus: isRec ? "ACCEPTED" : "ENDORSED" }, isRec ? "לקבל את ההמלצה? (זה לא מבצע שום דבר)" : "לסמן שאתה מסכים עם התובנה?")}>{isRec ? "קבל" : "מסכים"}</button> : null}
              {x.status === "OPEN" || x.status === "ENDORSED" || x.status === "ACCEPTED" ? <button disabled={busy} style={btn(false)} onClick={() => { const r = reason("למה לדחות? (חובה)"); if (r) void send({ op: "transition", targetKind: "RECORD", targetId: x.id, toStatus: "REJECTED", reasonHe: r }, "לדחות?"); }}>דחה</button> : null}
            </div>
          </div>
        );
      })}

      {view.decided.length ? <>
        <h2 style={{ fontSize: 18, margin: "18px 0 8px" }}>הוחלט לאחרונה</h2>
        {view.decided.map((q) => <div key={q.id} style={{ ...card, opacity: 0.75 }}>{q.summaryHe.split("\n")[0]} · {STATE_HE[q.state] ?? q.state}{q.decision?.decidedRole === "mcp_owner_token" ? " (מהצ'אט עם סאני)" : ""}{q.decision?.reasonHe ? ` — ${q.decision.reasonHe}` : ""}</div>)}
      </> : null}
      <p style={{ fontSize: 12, opacity: 0.6 }}>במעקב: {view.counts.resources} מקורות · {view.counts.observations} מדידות נוכחיות.</p>
    </div>
  );
}
