"use client";

/**
 * Sunny Social Intelligence (2026-10-17) — "חשיבה ואסטרטגיה" inside the artist's full view in the Social Hub. READ-ONLY:
 * the SAME `artist_social` mode strategy answer Sunny reads (lib/partner/label/social-intel). It shows the approved identity
 * (or the questions Sunny will ask), the real upcoming activity as content opportunities, the research by BASIS (the artist's
 * own performance / research on an inspiration / other research — never mixed), the results of published content and the
 * review of each recommendation. Writes nothing, sends nothing, browses nothing.
 */
import { useEffect, useState } from "react";

const CARD2 = "rgba(255,255,255,0.085)";
const BDR = "rgba(255,255,255,0.10)";
const TEXT = "#F2F2F2";
const TEXT2 = "#A0A0B0";
const MUTED = "#6E6E86";
const GREEN = "#10B981";
const AMBER = "#F59E0B";
const BLUE = "#60A5FA";
const RED = "#F87171";

type G = { text: string } | string | null | undefined;
const t = (g: G) => (g == null ? "" : typeof g === "string" ? g : g.text);
const dm = (ymd: string | null | undefined) => (ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : "—");

export type StrategyData = {
  identity: { known: Array<{ topic: string; he: string; decisionHe: string; decidedOn: string | null; reviewDue: boolean }>; missing: Array<{ topic: string; he: string; askHe: string }>; noteHe: string } | null;
  opportunities: { readable: boolean; horizonDays: number; items: Array<{ kind: string; date: string | null; titleHe: string; link: string; linkHe: string; anglesHe: string[]; noteHe: string | null }>; attention: Array<{ titleHe: string; noteHe: string | null }>; noteHe: string } | null;
  results: { rows: Array<{ contentKey: string; title: string; publishDate: string | null; match: string; checkedOn: string | null; metrics: { views: number | null; likes: number | null; comments: number | null }; baseline: { medianViews: number | null; posts: number }; verdict: string | null; cautionHe: string | null }> } | null;
  review: { reviews: Array<{ recordId: string; titleHe: string; verdict: string; verdictHe: string; optionsHe: string[] }>; historyRead: boolean } | null;
  records: Array<{ recordId: string; recordType: string; title: string; basis: string; basisHe: string; confidence: string; causalHe: string | null; claim: string; why: string; counter: string; expected: string; evidenceOn: string | null; sources: string[]; performanceOfArtist: boolean }>;
};

const BASIS_ORDER: Array<{ key: string; he: string; color: string }> = [
  { key: "OWN", he: "מהביצועים של האמן", color: GREEN },
  { key: "INSPIRATION", he: "מההשראות שלו (לא ביצועים שלו)", color: BLUE },
  { key: "OTHER_RESEARCH", he: "ממחקרים אחרים של הלייבל (רעיונות אפשריים)", color: AMBER },
];
const groupOf = (basis: string) => (basis === "ARTIST_NAMED" || basis === "ARTIST_ACCOUNTS" ? "OWN" : basis);
const VERDICT_HE: Record<string, { he: string; color: string }> = {
  ABOVE_BASELINE: { he: "מעל הרגיל בחשבון", color: GREEN }, NEAR_BASELINE: { he: "בערך הרגיל", color: TEXT2 }, BELOW_BASELINE: { he: "מתחת לרגיל", color: AMBER },
  BASELINE_TOO_SMALL: { he: "אין מספיק להשוואה", color: MUTED }, NO_VIEWS: { he: "אין צפיות שנמדדו", color: MUTED },
};

/** Map the served answer → the display shape (pure; used by the section and by the static visual check). */
export function strategyDataOf(resp: { summary?: Array<{ code: string; value: unknown }>; items?: Array<{ label: G; fields: Record<string, unknown> }> } | null): StrategyData | null {
  if (!resp || !Array.isArray(resp.summary)) return null;
  const v = (c: string) => resp.summary!.find((x) => x.code === c)?.value as never;
  const records = (resp.items ?? []).filter((i) => i.fields?.recordType && i.fields?.basis).map((i) => {
    const f = i.fields as Record<string, unknown>;
    return { recordId: String(f.recordId), recordType: String(f.recordType), title: t(i.label), basis: String(f.basis), basisHe: String(f.basisHe ?? ""), confidence: String(f.confidence ?? ""), causalHe: (f.causalHe as string | null) ?? null,
      claim: t(f.claimHe as G), why: t(f.whyHe as G), counter: t(f.counterHe as G), expected: t(f.expectedHe as G), evidenceOn: ((f.evidence as { latestCheckedOn?: string | null } | undefined)?.latestCheckedOn) ?? null,
      sources: ((f.sources as Array<{ label: string }> | undefined) ?? []).map((s) => s.label), performanceOfArtist: !!f.performanceOfArtist };
  });
  return { identity: v("IDENTITY") ?? null, opportunities: v("OPPORTUNITIES") ?? null, results: v("RESULTS") ?? null, review: v("REVIEW") ?? null, records };
}

const h4 = { margin: "14px 0 8px", fontSize: 13.5, fontWeight: 800, color: TEXT } as const;
const box = { background: CARD2, border: `1px solid ${BDR}`, borderRadius: 11, padding: "8px 11px", marginBottom: 6 } as const;

export function StrategyView({ d, artistName }: { d: StrategyData; artistName: string }) {
  const known = d.identity?.known ?? [];
  const missing = d.identity?.missing ?? [];
  const opp = d.opportunities;
  const results = d.results?.rows ?? [];
  const reviews = (d.review?.reviews ?? []).filter((r) => r.verdict !== "NOT_TRIED");
  const notTried = (d.review?.reviews ?? []).length - reviews.length;
  return (
    <>
      <h4 style={{ ...h4, marginTop: 0 }}>זהות ואסטרטגיה</h4>
      {known.length ? known.map((k) => (
        <div key={k.topic} style={box}><span style={{ fontSize: 11.5, color: TEXT2 }}>{k.he}{k.reviewDue ? <span style={{ color: AMBER }}> · הגיע זמן לבחון מחדש</span> : null}</span><div style={{ fontSize: 12.5, color: TEXT }}>{k.decisionHe}</div></div>
      )) : <div style={{ fontSize: 12, color: AMBER, marginBottom: 6 }}>עוד אין זהות ואסטרטגיה מאושרות ל{artistName}. עד שתאשר — כל התאמה לאמן היא השערה של סאני.</div>}
      {missing.length > 0 && (
        <details style={{ ...box, cursor: "pointer" }}>
          <summary style={{ fontSize: 12, color: TEXT2 }}>{missing.length} נושאים שסאני תשאל עליהם (שאלה אחת בכל פעם, ותציע ניסוח לאישורך)</summary>
          {missing.map((m) => <div key={m.topic} style={{ fontSize: 11.5, color: TEXT2, marginTop: 4 }}>• <b style={{ color: TEXT }}>{m.he}</b> — {m.askHe}</div>)}
        </details>
      )}

      <h4 style={h4}>הזדמנויות תוכן מהפעילות ({opp?.horizonDays ?? 14} יום קדימה)</h4>
      {!opp || !opp.readable ? <div style={{ fontSize: 12, color: AMBER }}>לא נקראה פעילות האמן כרגע — זה לא אומר שאין.</div>
        : opp.items.length === 0 ? <div style={{ fontSize: 12, color: MUTED }}>אין ברשומות סשן, הופעה, צילום או ריליס של {artistName} בשבועיים הקרובים.</div>
        : opp.items.map((o, i) => (
          <div key={i} style={box}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, color: TEXT, fontWeight: 700 }}>{o.date ? <><bdi dir="ltr">{dm(o.date)}</bdi> · </> : null}{o.titleHe}</span>
              <span style={{ fontSize: 10.5, color: o.link === "CANONICAL" ? GREEN : o.link === "AMBIGUOUS" ? AMBER : TEXT2 }}>{o.linkHe}</span>
            </div>
            <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 2 }}>נקודות פתיחה: {o.anglesHe.join(" · ")}</div>
            {o.noteHe && <div style={{ fontSize: 11, color: AMBER }}>{o.noteHe}</div>}
          </div>))}
      {opp?.attention.map((a, i) => <div key={i} style={{ fontSize: 11.5, color: AMBER }}>⚠ {a.titleHe}{a.noteHe ? ` — ${a.noteHe}` : ""}</div>)}

      <h4 style={h4}>מחקר ורעיונות של סאני (השערות)</h4>
      {BASIS_ORDER.map((g) => {
        const rs = d.records.filter((r) => groupOf(r.basis) === g.key);
        if (!rs.length) return null;
        return (
          <div key={g.key} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: g.color, marginBottom: 4 }}>{g.he} · {rs.length}</div>
            {rs.map((r) => (
              <details key={r.recordId} style={{ ...box, cursor: "pointer" }}>
                <summary style={{ fontSize: 12.5, color: TEXT }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: r.recordType === "INSIGHT" ? BLUE : GREEN, marginInlineEnd: 6 }}>{r.recordType === "INSIGHT" ? "תובנה" : "המלצה"}</span>{r.title}
                  <span style={{ fontSize: 10.5, color: MUTED }}> · ביטחון {r.confidence === "HIGH" ? "גבוה" : r.confidence === "MEDIUM" ? "בינוני" : "נמוך"}{r.causalHe ? ` · ${r.causalHe}` : ""}</span>
                </summary>
                {r.claim && <div style={{ fontSize: 12, color: TEXT, marginTop: 5 }}>{r.claim}</div>}
                {r.why && <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 3 }}><b>למה:</b> {r.why}</div>}
                {r.counter && <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 3 }}><b>ראיה נגדית:</b> {r.counter}</div>}
                {r.expected && <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 3 }}><b>מה רצינו להשיג:</b> {r.expected}</div>}
                <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>{r.basisHe}{r.sources.length ? ` · מקור: ${r.sources.slice(0, 3).join(", ")}` : ""}{r.evidenceOn ? ` · נבדק ${dm(r.evidenceOn)}` : ""}</div>
                {!r.performanceOfArtist && <div style={{ fontSize: 10.5, color: AMBER }}>המספרים כאן הם של חשבון אחר — לא ביצועים של {artistName}.</div>}
              </details>))}
          </div>);
      })}
      {d.records.length === 0 && <div style={{ fontSize: 12, color: MUTED }}>אין עדיין מחקר או רעיונות פתוחים שקשורים ל{artistName}.</div>}

      <h4 style={h4}>תוצאות התוכן שפורסם</h4>
      {d.results === null ? <div style={{ fontSize: 12, color: AMBER }}>לא נקרא התוכן כרגע.</div>
        : results.length === 0 ? <div style={{ fontSize: 12, color: MUTED }}>אין עדיין תוכן של {artistName} שסומן כפורסם ב-Redbloods — אין מה למדוד.</div>
        : results.map((r) => (
          <div key={r.contentKey} style={box}>
            <div style={{ fontSize: 12.5, color: TEXT }}>{r.title} <span style={{ color: MUTED, fontSize: 11 }}>· פורסם {dm(r.publishDate)}</span></div>
            {r.match === "MATCHED" ? (
              <div style={{ fontSize: 11.5, color: TEXT2 }}>
                {r.metrics.views !== null ? `${r.metrics.views.toLocaleString("he-IL")} צפיות` : "—"}{r.metrics.likes !== null ? ` · ${r.metrics.likes} לייקים` : ""}{r.metrics.comments !== null ? ` · ${r.metrics.comments} תגובות` : ""} (נבדק {dm(r.checkedOn)})
                {r.verdict && VERDICT_HE[r.verdict] ? <span style={{ color: VERDICT_HE[r.verdict].color }}> · {VERDICT_HE[r.verdict].he}{r.baseline.medianViews !== null ? ` (חציון ${Math.round(r.baseline.medianViews).toLocaleString("he-IL")} מ-${r.baseline.posts} פוסטים)` : ""}</span> : null}
              </div>) : null}
            {r.cautionHe && <div style={{ fontSize: 11, color: AMBER }}>{r.cautionHe}</div>}
          </div>))}

      <h4 style={h4}>בחינת המלצות מול ביצוע ותוצאות</h4>
      {reviews.length ? reviews.map((r) => (
        <div key={r.recordId} style={box}><div style={{ fontSize: 12.5, color: TEXT }}>{r.titleHe}</div><div style={{ fontSize: 11.5, color: r.verdict === "SUPPORTED" ? GREEN : r.verdict === "NOT_SUPPORTED" ? RED : TEXT2 }}>{r.verdictHe} · אפשרויות: {r.optionsHe.join(" / ")}</div></div>
      )) : <div style={{ fontSize: 12, color: MUTED }}>אף המלצה עוד לא בוצעה דרך סאני{notTried ? ` (${notTried} המלצות פתוחות מחכות להחלטה שלך)` : ""}.</div>}
      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 8 }}>תוצאה אחת היא לא מסקנה. השוואה רק לקישור הפוסט המדויק, מול פוסטים אחרים באותו חשבון. שום דבר כאן לא נשמר או מבוצע בלי אישורך.</div>
    </>
  );
}

export default function ArtistStrategySection({ labelArtistId, artistName }: { labelArtistId: string; artistName: string }) {
  const [d, setD] = useState<StrategyData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let alive = true;
    fetch(`/api/partner/knowledge?capability=artist_social&mode=strategy&limit=40&p.entity=${encodeURIComponent(`label-artist:${labelArtistId}`)}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => { if (!alive) return; const x = j?.status === "OK" ? strategyDataOf(j) : null; setD(x); setState(x ? "ready" : "error"); })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [labelArtistId]);
  return (
    <section style={{ background: "linear-gradient(180deg, #161617 0%, #111112 100%)", border: `1px solid ${BDR}`, borderRadius: 18, padding: "16px 18px", marginBottom: 14 }}>
      <h3 style={{ margin: 0, color: TEXT, fontSize: 15.5, fontWeight: 800 }}>חשיבה ואסטרטגיה</h3>
      <div style={{ color: MUTED, fontSize: 11.5, margin: "3px 0 12px" }}>מה סאני יודעת ומציעה ל{artistName} — עובדות, מדידות והשערות מופרדות. לבקשת רעיונות או תוכנית: לשאול את סאני.</div>
      {state === "loading" ? <div style={{ color: TEXT2, fontSize: 13 }}>טוען…</div>
        : state === "error" || !d ? <div style={{ color: AMBER, fontSize: 13 }}>לא הצלחתי לקרוא כרגע — זה לא אומר שאין מידע.</div>
        : <StrategyView d={d} artistName={artistName} />}
    </section>
  );
}
