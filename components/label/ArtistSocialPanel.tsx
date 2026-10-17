"use client";

/**
 * Artist social — stage 0 (Owner approval 2026-10-17). OWNER-ONLY, READ-ONLY: the SAME `artist_social` answer Sunny gets
 * (GET /api/partner/knowledge, requireOwner). Writes nothing on load, sends nothing, browses nothing. Linking an account /
 * an inspiration to an artist happens only through Sunny's preview + the Owner's approval (partner_propose_knowledge).
 */
import { useEffect, useState } from "react";

const BDR2 = "rgba(255,255,255,0.10)";
const TEXT = "#F2F2F2";
const TEXT2 = "#A0A0A0";
const MUTED = "#606060";
const GREEN = "#34D399";
const AMBER = "#F59E0B";
const RED = "#F87171";
const panel: React.CSSProperties = {
  background: "linear-gradient(180deg, #161617 0%, #111112 100%)", border: `1px solid ${BDR2}`, borderRadius: 18,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 14px 34px rgba(0,0,0,0.4)", padding: "18px 18px 16px",
};

type GText = { text: string };
type Metric = { type: string; value: number | string | boolean | null; unit: string | null; checkedOn: string; ageDays: number; freshness: "TODAY" | "EARLIER"; freshnessHe: string; previous: { value: unknown; checkedOn: string } | null; change: { kind: string; delta?: number; deltaPct?: number | null; changed?: boolean } | null };
type Item = { id: string; label: GText; fields: Record<string, unknown> };
type Fact = { code: string; value: unknown };
export type ArtistSocialResp = Resp;
type Resp = { status: string; items: Item[]; summary: Fact[]; coverage: GText[]; completeness: string | null };

const METRIC_HE: Record<string, string> = {
  FOLLOWERS: "עוקבים", FOLLOWING: "נעקבים", POSTS: "פוסטים", SUBSCRIBERS: "מנויים", VIEWS: "צפיות", TOTAL_VIEWS: "צפיות מצטברות",
  VIDEOS: "סרטונים", LIKES: "לייקים", COMMENTS: "תגובות", SHARES: "שיתופים", REELS: "רילס", ENGAGEMENT_RATE: "מעורבות",
};
export const PLATFORM_HE: Record<string, string> = { instagram: "אינסטגרם", youtube: "יוטיוב", tiktok: "טיקטוק", spotify: "ספוטיפיי", facebook: "פייסבוק", x: "X", web: "אתר" };
export const nameOf = (label: string, platform: string) => (label.startsWith(`${platform} `) ? label.slice(platform.length + 1) : label);
export const metricName = (t: string) => { const m = t.split(".")[1] ?? t; return METRIC_HE[m] ?? m.toLowerCase().replace(/_/g, " "); };
export const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("he-IL") : v === true ? "כן" : v === false ? "לא" : v == null ? "—" : String(v));
export const heDate = (ymd: string | null | undefined) => (ymd ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}` : "—");

function Change({ m }: { m: Metric }) {
  if (!m.previous || !m.change) return <span style={{ color: MUTED, fontSize: 11 }}>בדיקה ראשונה</span>;
  if (m.change.kind === "NUMBER" && typeof m.change.delta === "number") {
    const d = m.change.delta;
    const c = d > 0 ? GREEN : d < 0 ? RED : TEXT2;
    return <span style={{ color: c, fontSize: 11.5, fontWeight: 700 }}><bdi dir="ltr">{d > 0 ? "+" : ""}{d.toLocaleString("he-IL")}{typeof m.change.deltaPct === "number" ? ` (${m.change.deltaPct}%)` : ""}</bdi> <span style={{ color: MUTED, fontWeight: 500 }}>מאז {heDate(m.previous.checkedOn)}</span></span>;
  }
  if (m.change.kind === "CHANGED") return <span style={{ color: TEXT2, fontSize: 11 }}>{m.change.changed ? "השתנה" : "לא השתנה"} מאז {heDate(m.previous.checkedOn)}</span>;
  return <span style={{ color: MUTED, fontSize: 11 }}>לא ניתן להשוות</span>;
}

function Metrics({ metrics }: { metrics: Metric[] }) {
  if (!metrics.length) return <div style={{ color: MUTED, fontSize: 12 }}>אין עדיין מדידה שמורה לחשבון הזה.</div>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {metrics.map((m) => (
        <div key={m.type} style={{ flex: "0 1 210px", minWidth: 140, border: `1px solid ${BDR2}`, borderRadius: 12, padding: "9px 11px", background: "rgba(255,255,255,0.02)" }}>
          <div style={{ color: TEXT2, fontSize: 11.5 }}>{metricName(m.type)}</div>
          <div style={{ color: TEXT, fontSize: 18, fontWeight: 800, margin: "2px 0" }}>{fmt(m.value)}{m.unit && m.unit !== "count" ? ` ${m.unit}` : ""}</div>
          <Change m={m} />
          <div style={{ color: m.freshness === "TODAY" ? GREEN : AMBER, fontSize: 10.5, marginTop: 4 }}>{m.freshnessHe}</div>
        </div>
      ))}
    </div>
  );
}

function AccountCard({ it, kind }: { it: Item; kind: "ACCOUNT" | "INSPIRATION" | "LABEL_CHANNEL" }) {
  const f = it.fields as { platform: string; ownership: { channelPurposeHe: string | null; approvedOn: string } | null; lastCheckFreshnessHe: string | null; metrics: Metric[]; content: { tracked: number; items: Array<{ resourceId: string; label: GText; contentKind: string | null; metrics: Metric[]; lastCheckedOn: string | null }> }; learnHe?: GText | null; approvedOn?: string };
  return (
    <div style={{ border: `1px solid ${BDR2}`, borderRadius: 14, padding: "12px 13px", background: "rgba(0,0,0,0.18)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ color: TEXT, fontWeight: 800, fontSize: 14.5, overflowWrap: "anywhere" }}>{nameOf(it.label.text, f.platform)}</span>
        <span style={{ color: TEXT2, fontSize: 11.5 }}>{PLATFORM_HE[f.platform] ?? f.platform}</span>
        {kind === "ACCOUNT" && f.ownership?.channelPurposeHe && <span style={{ color: "#FF6B6B", fontSize: 11, border: "1px solid rgba(220,38,38,0.35)", borderRadius: 999, padding: "1px 8px" }}>{f.ownership.channelPurposeHe}</span>}
        {kind === "LABEL_CHANNEL" && <span style={{ color: AMBER, fontSize: 11, border: "1px solid rgba(245,158,11,0.35)", borderRadius: 999, padding: "1px 8px" }}>משותף — לא נספר כביצועים אישיים</span>}
      </div>
      {kind === "INSPIRATION" && <div style={{ color: TEXT2, fontSize: 12.5, marginBottom: 8 }}>{f.learnHe?.text ? `מה לומדים: ${f.learnHe.text}` : "עוד לא נרשם מה לומדים מהחשבון הזה."}</div>}
      <Metrics metrics={f.metrics} />
      {f.content.tracked > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: TEXT2, fontSize: 11.5, marginBottom: 5 }}>תוכן במעקב ({f.content.tracked})</div>
          <div style={{ display: "grid", gap: 5 }}>
            {f.content.items.map((c) => (
              <div key={c.resourceId} style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, color: TEXT, borderTop: `1px solid ${BDR2}`, paddingTop: 5 }}>
                <span style={{ flex: "1 1 160px", minWidth: 0, overflowWrap: "anywhere" }}>{c.label.text}</span>
                {c.metrics.slice(0, 3).map((m) => <span key={m.type} style={{ color: TEXT2 }}>{metricName(m.type)}: <b style={{ color: TEXT }}>{fmt(m.value)}</b></span>)}
                <span style={{ color: MUTED }}>{c.lastCheckedOn ? heDate(c.lastCheckedOn) : "לא נבדק"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ color: MUTED, fontSize: 10.5, marginTop: 8 }}>
        {f.lastCheckFreshnessHe}{kind === "ACCOUNT" && f.ownership ? ` · שויך באישורך ב-${heDate(f.ownership.approvedOn)}` : ""}{kind === "INSPIRATION" && f.approvedOn ? ` · נוסף באישורך ב-${heDate(f.approvedOn)}` : ""}
      </div>
    </div>
  );
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section style={{ ...panel, marginBottom: 14 }}>
      <h3 style={{ margin: "0 0 4px", color: TEXT, fontSize: 15.5, fontWeight: 800 }}>{title}</h3>
      {note && <div style={{ color: MUTED, fontSize: 11.5, marginBottom: 10 }}>{note}</div>}
      <div style={{ display: "grid", gap: 10, marginTop: note ? 0 : 10 }}>{children}</div>
    </section>
  );
}

export default function ArtistSocialPanel({ artistId, artistName }: { artistId: string; artistName?: string }) {
  const [data, setData] = useState<Resp | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/partner/knowledge?capability=artist_social&mode=artist&limit=40&p.entity=${encodeURIComponent(`label-artist:${artistId}`)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Resp) => { if (!alive) return; setData(j); setState(j && j.status === "OK" ? "ready" : "error"); })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [artistId]);

  if (state === "loading") return <div style={{ ...panel, color: TEXT2, fontSize: 13 }}>טוען את מערך הסושיאל…</div>;
  if (state === "error" || !data) return <div style={{ ...panel, color: AMBER, fontSize: 13 }}>לא הצלחתי לקרוא את נתוני הסושיאל כרגע — זה לא אומר שאין נתונים.</div>;
  return <ArtistSocialView data={data} artistName={artistName} />;
}

/** The presentational part (pure over the capability answer). */
export function ArtistSocialView({ data, artistName }: { data: Resp; artistName?: string }) {
  if (data.completeness === "UNKNOWN") return <div style={{ ...panel, color: AMBER, fontSize: 13 }}>{data.coverage[0]?.text ?? "מקורות הסושיאל לא נקראו — זה לא אומר שאין נתונים."}</div>;

  const by = (k: string) => data.items.filter((i) => i.fields.kind === k);
  const accounts = by("ACCOUNT"), insp = by("INSPIRATION"), channels = by("LABEL_CHANNEL");
  const records = data.items.filter((i) => i.fields.recordType);
  const fact = (c: string) => data.summary.find((s) => s.code === c)?.value;
  const recheck = fact("RECHECK_PROPOSAL") as { textHe?: string } | null | undefined;
  const unassigned = (fact("UNASSIGNED_ACCOUNTS") as Array<{ resourceId: string; platform: string; label: string }> | undefined) ?? [];
  const name = artistName ?? "האמן";

  return (
    <div dir="rtl">
      <Section title={`החשבונות של ${name}`} note="רק חשבונות שאישרת כשלו. כל מספר מוצג עם תאריך הבדיקה שלו — בדיקה ישנה היא לא מצב של עכשיו.">
        {accounts.length ? accounts.map((a) => <AccountCard key={a.id} it={a} kind="ACCOUNT" />)
          : <div style={{ color: TEXT2, fontSize: 13 }}>עוד לא אושר אף חשבון כשל {name}. שיוך חשבון נעשה דרך סאני — היא מציגה לך את השיוך המדויק, ונשמר רק אחרי האישור שלך.</div>}
      </Section>

      <Section title="השראות" note="חשבונות שהאמן לומד מהם — לא חשבונות שלנו.">
        {insp.length ? insp.map((a) => <AccountCard key={a.id} it={a} kind="INSPIRATION" />)
          : <div style={{ color: TEXT2, fontSize: 13 }}>עוד לא נרשמו השראות ל{name}.</div>}
      </Section>

      <Section title="תובנות והמלצות של סאני" note="השערות של סאני, לא עובדות. כל אחת עם התאריך שבו נוצרה והתאריך של הבדיקה שהיא נשענת עליה.">
        {records.length ? records.map((r) => {
          const f = r.fields as { recordType: string; statusHe: string | null; createdOn: string; evidenceCheckedOn: string | null; tie: string; alsoSharedChannel: boolean };
          return (
            <div key={r.id} style={{ borderTop: `1px solid ${BDR2}`, paddingTop: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <span style={{ color: f.recordType === "INSIGHT" ? "#60A5FA" : GREEN, fontSize: 11, fontWeight: 800 }}>{f.recordType === "INSIGHT" ? "תובנה" : "המלצה"}</span>
                <span style={{ color: TEXT, fontSize: 13.5, overflowWrap: "anywhere" }}>{r.label.text}</span>
              </div>
              <div style={{ color: MUTED, fontSize: 11, marginTop: 3 }}>
                {f.statusHe ? `${f.statusHe} · ` : ""}נוצרה ב-{heDate(f.createdOn)}{f.evidenceCheckedOn ? ` · על סמך בדיקה מ-${heDate(f.evidenceCheckedOn)}` : ""}{f.tie === "DERIVED" ? " · דרך החשבונות שלו" : ""}{f.alsoSharedChannel ? " · נוגעת גם בערוץ הלייבל" : ""}
              </div>
            </div>
          );
        }) : <div style={{ color: TEXT2, fontSize: 13 }}>אין תובנות או המלצות פתוחות שקשורות ל{name}.</div>}
      </Section>

      {channels.length > 0 && (
        <Section title="ערוצי הלייבל המשותפים" note="ערוצים של Redbloods. מוצגים כהקשר בלבד — לא נספרים כביצועים האישיים של האמן.">
          {channels.map((a) => <AccountCard key={a.id} it={a} kind="LABEL_CHANNEL" />)}
        </Section>
      )}

      {(recheck?.textHe || unassigned.length > 0) && (
        <section style={{ ...panel, marginBottom: 14 }}>
          {recheck?.textHe && <div style={{ color: TEXT, fontSize: 13, marginBottom: unassigned.length ? 8 : 0 }}>💡 {recheck.textHe}</div>}
          {unassigned.length > 0 && <div style={{ color: TEXT2, fontSize: 12 }}>חשבונות במעקב שעוד לא שויכו לאף אחד: {unassigned.map((u) => `${nameOf(u.label, u.platform)} (${PLATFORM_HE[u.platform] ?? u.platform})`).join(" · ")}</div>}
        </section>
      )}
      <div style={{ color: MUTED, fontSize: 11, textAlign: "center", padding: "4px 0 10px" }}>המדידות נשמרות רק מבדיקות שביקשת מסאני — אין חיבור API ואין מעקב ברקע.</div>
    </div>
  );
}
