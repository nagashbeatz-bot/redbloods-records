"use client";

/**
 * Social stage 2 (Owner approval 2026-10-17) — "יעדים, סדרות ומעקב שבועי" for one label artist, inside the artist's full view.
 * Display = the SAME `artist_social` CADENCE answer Sunny reads (lib/social-cadence — the one computation); writes = the
 * Owner-only routes (/api/social/targets, /api/social/series, /api/social/content/[id]) behind the shared writers. Every write
 * shows its exact change and waits for the Owner's confirmation. Items and platform publications are never added together;
 * browser-checked measurements are shown apart and never counted. No push, no calendar, no publishing, no delete.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { SOCIAL_CONTENT_TYPES, SOCIAL_PLATFORMS } from "@/lib/types";
import { SCOPE_HE, SERIES_STATUS_HE, SOURCE_HE, type CadenceTargetRow, type SeriesRow, type WeekSummary } from "@/lib/social-cadence";

const CARD = "rgba(255,255,255,0.058)";
const CARD2 = "rgba(255,255,255,0.085)";
const BDR = "rgba(255,255,255,0.10)";
const TEXT = "#F2F2F2";
const TEXT2 = "#A0A0B0";
const MUTED = "#6E6E86";
const GREEN = "#10B981";
const AMBER = "#F59E0B";
const RED = "#F87171";
const BLUE = "#60A5FA";

export const PLATFORM_LABEL: Record<string, string> = { tiktok: "טיקטוק", instagram: "אינסטגרם", youtube: "יוטיוב", spotify: "ספוטיפיי", other: "אחר" };
const dm = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : ymd);
const weekLabel = (w: WeekSummary) => `${dm(w.weekStart)}–${dm(w.weekEnd)}`;
const todayIL = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export type Cadence = {
  week: WeekSummary; previousWeeks: WeekSummary[];
  targets: Array<{ current: CadenceTargetRow; history: CadenceTargetRow[] }>;
  series: SeriesRow[]; overdueItems: number;
  externalEvidence: Array<{ weekStart: string; publishedPosts: number; checks: Array<{ resourceId: string; label: string; publishedOn: string; checkedOn: string }> }>;
};
type Item = { id: string; title: string; status: string; series_id?: string | null; publish_date?: string | null };

const box = { background: CARD2, border: `1px solid ${BDR}`, borderRadius: 11, padding: "9px 11px" } as const;
const h4 = { margin: "0 0 8px", fontSize: 13.5, fontWeight: 800, color: TEXT } as const;
const input = { background: "#15151b", border: `1px solid ${BDR}`, borderRadius: 8, color: TEXT, fontSize: 12.5, padding: "6px 8px", minWidth: 0 } as const;
const btn = (primary = false) => ({ padding: "6px 12px", borderRadius: 8, border: primary ? "none" : `1px solid ${BDR}`, background: primary ? "#DC2626" : "transparent", color: primary ? "#fff" : TEXT2, fontSize: 12, fontWeight: 800, cursor: "pointer" }) as const;

const targetName = (t: CadenceTargetRow, series: readonly SeriesRow[]) =>
  t.scope === "OVERALL" ? "יעד כולל (פריטי תוכן)" : t.scope === "SERIES" ? `סדרה: ${series.find((s) => s.id === t.series_id)?.name ?? "—"}` : `פירוט: ${t.platform ? `${PLATFORM_LABEL[t.platform] ?? t.platform} (פרסומים)` : ""}${t.platform && t.content_type ? " · " : ""}${t.content_type ? `${t.content_type} (פריטים)` : ""}`;
const progressText = (p: { published: number; required: number; plannedRemaining: number; metric: string }, current: boolean) =>
  `${p.published} מתוך ${p.required} ${p.metric === "PUBLICATIONS" ? "פרסומים" : "פריטים"}${current && p.plannedRemaining ? ` · עוד ${p.plannedRemaining} מתוכננים` : ""}`;

/** Pure presentation of the week + 4 weeks back (used by the section and by the static visual check). */
export function CadenceWeekView({ c, isMobile }: { c: Cadence; isMobile: boolean }) {
  const w = c.week;
  const weeks = [w, ...c.previousWeeks];
  const plat = Object.entries(w.publications.byPlatform);
  return (
    <>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", marginBottom: 10 }}>
        <div style={box}><div style={{ fontSize: 11, color: TEXT2 }}>פריטים שפורסמו השבוע</div><div style={{ fontSize: 20, fontWeight: 900, color: TEXT }}>{w.items.published}{w.overall ? <span style={{ fontSize: 12, color: TEXT2 }}> / {w.overall.progress.required}</span> : null}</div></div>
        <div style={box}><div style={{ fontSize: 11, color: TEXT2 }}>פרסומים בפלטפורמות</div><div style={{ fontSize: 20, fontWeight: 900, color: TEXT }}>{w.publications.total}</div>
          <div style={{ fontSize: 10.5, color: MUTED }}>{plat.length ? plat.map(([p, n]) => `${PLATFORM_LABEL[p] ?? p} ${n}`).join(" · ") : "—"}</div></div>
        <div style={box}><div style={{ fontSize: 11, color: TEXT2 }}>מתוכננים השבוע (עוד לא פורסמו)</div><div style={{ fontSize: 20, fontWeight: 900, color: TEXT }}>{w.items.plannedRemaining}</div>
          {w.items.plannedNotPublished > 0 && <div style={{ fontSize: 10.5, color: AMBER }}>{w.items.plannedNotPublished} בתאריך שעבר — פורסם?</div>}</div>
        <div style={box}><div style={{ fontSize: 11, color: TEXT2 }}>יעד כולל</div>
          {w.overall ? <div style={{ fontSize: 13, fontWeight: 800, color: w.overall.progress.onTrack ? GREEN : AMBER, marginTop: 3 }}>{w.overall.progress.onTrack ? "בדרך ליעד" : `חסרים ${w.overall.progress.gap}`}</div>
            : <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>לא הוגדר יעד</div>}
          {c.overdueItems > 0 && <div style={{ fontSize: 10.5, color: RED }}>{c.overdueItems} פריטים עברו תאריך יעד</div>}</div>
      </div>
      <div style={{ fontSize: 10.5, color: MUTED, marginBottom: 8 }}>פריט אחד בשתי פלטפורמות = פריט אחד ושני פרסומים. פריטים ופרסומים לא מחוברים.</div>
      {(w.breakdown.length > 0 || w.series.length > 0) && (
        <div style={{ display: "grid", gap: 5, marginBottom: 10 }}>
          {w.breakdown.map((b) => <div key={b.target.id} style={{ fontSize: 12, color: TEXT2 }}>{targetName(b.target, c.series)}: <b style={{ color: b.progress.onTrack ? GREEN : AMBER }}>{progressText(b.progress, true)}</b></div>)}
          {w.series.map((s) => <div key={s.series.id} style={{ fontSize: 12, color: TEXT2 }}>סדרה {s.series.name} ({SERIES_STATUS_HE[s.series.status]}): {s.progress ? <b style={{ color: s.progress.onTrack ? GREEN : AMBER }}>{progressText(s.progress, true)}</b> : <span>{s.publishedItems} פורסמו · {s.plannedItems} מתוכננים · בלי יעד</span>}</div>)}
        </div>
      )}
      {w.signals.length > 0 && (
        <div style={{ ...box, borderColor: "rgba(245,158,11,0.35)", marginBottom: 10 }}>
          {w.signals.map((s, k) => <div key={k} style={{ fontSize: 12, color: s.code === "NO_TARGET" ? TEXT2 : AMBER }}>• {s.textHe}</div>)}
        </div>
      )}
      <div style={{ overflowX: "auto", marginBottom: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 420 }}>
          <thead><tr style={{ color: MUTED, textAlign: "start" }}>
            {["שבוע", "פריטים שפורסמו", "פריטים שתוכננו", "פרסומים", "יעד כולל", "פער"].map((h) => <th key={h} style={{ textAlign: "start", fontWeight: 700, padding: "4px 6px", borderBottom: `1px solid ${BDR}` }}>{h}</th>)}
          </tr></thead>
          <tbody>{weeks.map((x) => (
            <tr key={x.weekStart} style={{ color: x.isCurrent ? TEXT : TEXT2 }}>
              <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}><bdi dir="ltr">{weekLabel(x)}</bdi>{x.isCurrent ? " (השבוע)" : ""}</td>
              <td style={{ padding: "4px 6px" }}>{x.items.published}</td>
              <td style={{ padding: "4px 6px" }}>{x.items.planned}</td>
              <td style={{ padding: "4px 6px" }}>{x.publications.total}</td>
              <td style={{ padding: "4px 6px" }}>{x.overall ? x.overall.progress.required : "—"}</td>
              <td style={{ padding: "4px 6px", color: x.overall ? (x.overall.progress.gap ? AMBER : GREEN) : MUTED }}>{x.overall ? (x.overall.progress.gap ? `−${x.overall.progress.gap}` : "✓") : "—"}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <div style={{ fontSize: 10.5, color: MUTED, marginBottom: 12 }}>שבוע = ראשון–שבת (שעון ישראל). שבוע שעבר נמדד מול היעד שחל בו. "פורסם" = לפי הרישום ב-Redbloods.</div>
      <div style={{ ...box, marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: BLUE, marginBottom: 4 }}>מדידות חיצוניות (בדיקות דפדפן של סאני) — לא נספרות ביעד</div>
        {c.externalEvidence.some((e) => e.checks.length) ? c.externalEvidence.filter((e) => e.checks.length).map((e) => (
          <div key={e.weekStart} style={{ fontSize: 11.5, color: TEXT2 }}>שבוע <bdi dir="ltr">{dm(e.weekStart)}</bdi>: {e.publishedPosts} פוסטים נמצאו בבדיקה · {e.checks.map((x) => `${x.label} (פורסם ${dm(x.publishedOn)}, נבדק ${dm(x.checkedOn)})`).join(" · ")}</div>
        )) : <div style={{ fontSize: 11.5, color: MUTED }}>אין בדיקה חיצונית שמורה לשבועות האלה — זה לא אומר שלא פורסם.</div>}
      </div>
    </>
  );
}

export default function ArtistCadenceSection({ labelArtistId, artistName, isMobile, onChanged }: { labelArtistId: string; artistName: string; isMobile: boolean; onChanged?: () => void }) {
  const key = `label-artist:${labelArtistId}`;
  const [c, setC] = useState<Cadence | null>(null);
  const [allSeries, setAllSeries] = useState<SeriesRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [hist, setHist] = useState<string | null>(null);
  // forms
  const [tScope, setTScope] = useState<"OVERALL" | "BREAKDOWN" | "SERIES">("OVERALL");
  const [tPlat, setTPlat] = useState(""); const [tType, setTType] = useState(""); const [tSeries, setTSeries] = useState("");
  const [tN, setTN] = useState("3"); const [tFrom, setTFrom] = useState(todayIL()); const [tNote, setTNote] = useState("");
  const [sName, setSName] = useState(""); const [sOwner, setSOwner] = useState<"ARTIST" | "LABEL">("ARTIST"); const [sPlats, setSPlats] = useState<string[]>([]);
  const [aItem, setAItem] = useState(""); const [aSeries, setASeries] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [cad, ser, con] = await Promise.all([
        fetch(`/api/partner/knowledge?capability=artist_social&mode=artist&limit=5&p.entity=${encodeURIComponent(key)}`, { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/social/series", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("series")))),
        fetch(`/api/social/content?labelArtistId=${encodeURIComponent(labelArtistId)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("content")))),
      ]);
      const v = (cad?.summary as Array<{ code: string; value: unknown }> | undefined)?.find((s) => s.code === "CADENCE")?.value as Cadence | null | undefined;
      if (!v) throw new Error("cadence");
      setC(v); setAllSeries(ser.series ?? []); setItems(con.items ?? []); setState("ready");
    } catch { setState("error"); }
  }, [key, labelArtistId]);
  useEffect(() => { load(); }, [load, tick]);

  const mySeries = useMemo(() => allSeries.filter((s) => (s.owner_scope === "ARTIST" && s.label_artist_id === labelArtistId) || s.owner_scope === "LABEL"), [allSeries, labelArtistId]);
  const live = mySeries.filter((s) => s.status !== "ENDED");

  async function write(preview: string, url: string, method: "POST" | "PATCH", body: unknown) {
    if (!window.confirm(`${preview}\n\nלאשר?`)) return;
    setMsg(null);
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: d.error ?? "השמירה נכשלה" }); return; }
      setMsg({ ok: true, text: "נשמר ✓ (נקרא מחדש מהמערכת)" }); onChanged?.(); setTick((t) => t + 1);
    } catch { setMsg({ ok: false, text: "השמירה נכשלה — שום דבר לא השתנה" }); }
  }

  function slotHead(): CadenceTargetRow | null {
    if (!c) return null;
    return c.targets.map((t) => t.current).find((t) => t.scope === tScope && (tScope === "SERIES" ? t.series_id === tSeries : (t.platform ?? "") === (tScope === "BREAKDOWN" ? tPlat : "") && (t.content_type ?? "") === (tScope === "BREAKDOWN" ? tType : ""))) ?? null;
  }
  function submitTarget() {
    const n = Number(tN);
    if (!Number.isInteger(n) || n < 1 || n > 50) { setMsg({ ok: false, text: "יעד שבועי = מספר שלם בין 1 ל-50" }); return; }
    if (tScope === "BREAKDOWN" && !tPlat && !tType) { setMsg({ ok: false, text: "יעד פירוט צריך פלטפורמה או סוג תוכן" }); return; }
    if (tScope === "SERIES" && !tSeries) { setMsg({ ok: false, text: "בחר סדרה" }); return; }
    const head = slotHead();
    const what = tScope === "OVERALL" ? `יעד כולל של ${artistName}` : tScope === "SERIES" ? `יעד לסדרה ${mySeries.find((s) => s.id === tSeries)?.name}` : `יעד פירוט של ${artistName}: ${[tPlat && (PLATFORM_LABEL[tPlat] ?? tPlat), tType].filter(Boolean).join(" · ")}`;
    const preview = head ? `${what}\nלפני: ${head.per_week} בשבוע (מ-${dm(head.valid_from)})\nאחרי: ${n} בשבוע מ-${dm(tFrom)}\nהיעד הקודם נשאר בהיסטוריה.` : `${what}\nחדש: ${n} בשבוע מ-${dm(tFrom)}`;
    write(preview, "/api/social/targets", "POST", {
      scope: tScope, action: "SET", per_week: n, valid_from: tFrom, source: "OWNER_STATEMENT",
      ...(tScope === "SERIES" ? { series_id: tSeries } : { label_artist_id: labelArtistId }),
      ...(tScope === "BREAKDOWN" ? { platform: tPlat || null, content_type: tType || null } : {}),
      ...(head ? { supersedes_id: head.id } : {}), ...(tNote.trim() ? { note_he: tNote.trim() } : {}),
    });
  }
  function endTarget(t: CadenceTargetRow) {
    const from = todayIL();
    write(`סיום ${targetName(t, mySeries)} (${t.per_week} בשבוע)\nמ-${dm(from)} אין יעד ברמה הזו. ההיסטוריה נשמרת.`, "/api/social/targets", "POST",
      { scope: t.scope, action: "END", valid_from: from, supersedes_id: t.id, source: "OWNER_STATEMENT", ...(t.scope === "SERIES" ? { series_id: t.series_id } : { label_artist_id: t.label_artist_id, platform: t.platform, content_type: t.content_type }) });
  }
  function createSeries() {
    if (!sName.trim()) { setMsg({ ok: false, text: "שם הסדרה חסר" }); return; }
    write(`סדרה חדשה: ${sName.trim()}\nבעלים: ${sOwner === "ARTIST" ? artistName : "הלייבל"}\nפלטפורמות: ${sPlats.map((p) => PLATFORM_LABEL[p] ?? p).join(", ") || "—"}\nסטטוס: פעילה`, "/api/social/series", "POST",
      { name: sName.trim(), owner_scope: sOwner, ...(sOwner === "ARTIST" ? { label_artist_id: labelArtistId } : {}), platforms: sPlats });
  }
  function setSeriesStatus(s: SeriesRow, status: SeriesRow["status"]) {
    write(`סדרה ${s.name}\nלפני: ${SERIES_STATUS_HE[s.status]}\nאחרי: ${SERIES_STATUS_HE[status]}${status === "ENDED" ? "\nסדרה שהסתיימה לא נפתחת מחדש ולא מקבלת תוכן חדש." : ""}`, `/api/social/series/${s.id}`, "PATCH", { status });
  }
  function assign() {
    const it = items.find((x) => x.id === aItem); if (!it) { setMsg({ ok: false, text: "בחר פריט" }); return; }
    const to = aSeries ? mySeries.find((s) => s.id === aSeries)?.name : null;
    const from = it.series_id ? mySeries.find((s) => s.id === it.series_id)?.name ?? "סדרה" : "ללא סדרה";
    write(`${it.title}\nלפני: ${from}\nאחרי: ${to ?? "ללא סדרה"}`, `/api/social/content/${it.id}`, "PATCH", { series_id: aSeries || null });
  }

  return (
    <section style={{ background: "linear-gradient(180deg, #161617 0%, #111112 100%)", border: `1px solid ${BDR}`, borderRadius: 18, padding: "16px 18px", marginBottom: 14 }}>
      <h3 style={{ margin: 0, color: TEXT, fontSize: 15.5, fontWeight: 800 }}>יעדים, סדרות ומעקב שבועי</h3>
      <div style={{ color: MUTED, fontSize: 11.5, margin: "3px 0 12px" }}>עובדות = הרישום ב-Redbloods · יעדים = מה שקבעת · מדידות חיצוניות והמלצות סאני מוצגות בנפרד.</div>
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? GREEN : RED, marginBottom: 10 }}>{msg.text}</div>}
      {state === "loading" && !c ? <div style={{ color: TEXT2, fontSize: 13 }}>טוען…</div>
        : state === "error" || !c ? <div style={{ color: AMBER, fontSize: 13 }}>לא הצלחתי לקרוא יעדים וסדרות כרגע — זה לא אומר שאין. <button onClick={() => setTick((t) => t + 1)} style={{ background: "none", border: "none", color: BLUE, cursor: "pointer" }}>נסה שוב</button></div>
        : <>
          <CadenceWeekView c={c} isMobile={isMobile} />

          <div style={{ marginTop: 14 }}>
            <h4 style={h4}>יעדים שבועיים</h4>
            {c.targets.length === 0 ? <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>עוד לא הוגדר יעד. סאני לא קובעת יעד בעצמה — רק מציעה, ואתה מאשר.</div>
              : c.targets.map(({ current: t, history }) => (
                <div key={t.id} style={{ ...box, marginBottom: 6 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12.5, color: TEXT, fontWeight: 700 }}>{targetName(t, mySeries)}: {t.per_week} בשבוע</span>
                    <span style={{ fontSize: 11, color: TEXT2 }}>מ-<bdi dir="ltr">{dm(t.valid_from)}</bdi>{t.valid_until ? <> עד <bdi dir="ltr">{dm(t.valid_until)}</bdi></> : ""} · {SOURCE_HE[t.source]}</span>
                  </div>
                  {t.note_he && <div style={{ fontSize: 11, color: MUTED }}>{t.note_he}</div>}
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button style={btn()} onClick={() => setHist(hist === t.id ? null : t.id)}>היסטוריה ({history.length})</button>
                    <button style={btn()} onClick={() => endTarget(t)}>סיום יעד</button>
                  </div>
                  {hist === t.id && <div style={{ marginTop: 6 }}>{history.map((h) => <div key={h.id} style={{ fontSize: 11, color: TEXT2 }}>• {h.action === "END" ? "סיום" : `${h.per_week} בשבוע`} מ-<bdi dir="ltr">{dm(h.valid_from)}</bdi> · {SOURCE_HE[h.source]}</div>)}</div>}
                </div>))}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 6 }}>
              <select value={tScope} onChange={(e) => setTScope(e.target.value as typeof tScope)} style={input} aria-label="רמת היעד">
                {(["OVERALL", "BREAKDOWN", "SERIES"] as const).map((s) => <option key={s} value={s}>{SCOPE_HE[s]}</option>)}
              </select>
              {tScope === "BREAKDOWN" && <>
                <select value={tPlat} onChange={(e) => setTPlat(e.target.value)} style={input} aria-label="פלטפורמה"><option value="">כל פלטפורמה</option>{SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p] ?? p}</option>)}</select>
                <select value={tType} onChange={(e) => setTType(e.target.value)} style={input} aria-label="סוג תוכן"><option value="">כל סוג</option>{SOCIAL_CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
              </>}
              {tScope === "SERIES" && <select value={tSeries} onChange={(e) => setTSeries(e.target.value)} style={input} aria-label="סדרה"><option value="">בחר סדרה</option>{live.map((s) => <option key={s.id} value={s.id}>{s.name}{s.owner_scope === "LABEL" ? " (לייבל)" : ""}</option>)}</select>}
              <input type="number" min={1} max={50} value={tN} onChange={(e) => setTN(e.target.value)} style={{ ...input, width: 64 }} aria-label="כמות בשבוע" />
              <span style={{ fontSize: 12, color: TEXT2 }}>בשבוע, מ-</span>
              <input type="date" value={tFrom} min={todayIL()} onChange={(e) => setTFrom(e.target.value)} style={input} aria-label="מתאריך" />
              <input value={tNote} onChange={(e) => setTNote(e.target.value)} placeholder="הערה (לא חובה)" maxLength={300} style={{ ...input, flex: 1, minWidth: 120 }} />
              <button style={btn(true)} onClick={submitTarget}>{slotHead() ? "החלפת יעד" : "קביעת יעד"}</button>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <h4 style={h4}>סדרות תוכן</h4>
            {mySeries.length === 0 ? <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>אין עדיין סדרות.</div>
              : mySeries.map((s) => (
                <div key={s.id} style={{ ...box, marginBottom: 6, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12.5, color: TEXT, fontWeight: 700 }}>{s.name} <span style={{ color: TEXT2, fontWeight: 400 }}>· {s.owner_scope === "LABEL" ? "של הלייבל" : `של ${artistName}`} · {s.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ") || "—"}</span></span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: s.status === "ACTIVE" ? GREEN : s.status === "PAUSED" ? AMBER : MUTED }}>{SERIES_STATUS_HE[s.status]}</span>
                    {s.status === "ACTIVE" && <button style={btn()} onClick={() => setSeriesStatus(s, "PAUSED")}>השהיה</button>}
                    {s.status === "PAUSED" && <button style={btn()} onClick={() => setSeriesStatus(s, "ACTIVE")}>הפעלה</button>}
                    {s.status !== "ENDED" && <button style={btn()} onClick={() => setSeriesStatus(s, "ENDED")}>סיום</button>}
                  </span>
                </div>))}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 6 }}>
              <input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="שם סדרה חדשה" maxLength={80} style={{ ...input, minWidth: 140 }} />
              <select value={sOwner} onChange={(e) => setSOwner(e.target.value as typeof sOwner)} style={input} aria-label="בעלים"><option value="ARTIST">של {artistName}</option><option value="LABEL">של הלייבל</option></select>
              {SOCIAL_PLATFORMS.map((p) => (
                <label key={p} style={{ fontSize: 11.5, color: TEXT2, display: "flex", gap: 3, alignItems: "center" }}>
                  <input type="checkbox" checked={sPlats.includes(p)} onChange={(e) => setSPlats((x) => (e.target.checked ? [...x, p] : x.filter((y) => y !== p)))} />{PLATFORM_LABEL[p] ?? p}
                </label>))}
              <button style={btn(true)} onClick={createSeries}>פתיחת סדרה</button>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <h4 style={h4}>שיוך תוכן לסדרה</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <select value={aItem} onChange={(e) => setAItem(e.target.value)} style={{ ...input, flex: 1, minWidth: 160 }} aria-label="פריט תוכן"><option value="">בחר פריט של {artistName}</option>{items.filter((x) => x.status !== "cancelled").map((x) => <option key={x.id} value={x.id}>{x.title}{x.series_id ? ` · ${mySeries.find((s) => s.id === x.series_id)?.name ?? "בסדרה"}` : ""}</option>)}</select>
              <select value={aSeries} onChange={(e) => setASeries(e.target.value)} style={input} aria-label="סדרה"><option value="">ללא סדרה</option>{live.map((s) => <option key={s.id} value={s.id}>{s.name}{s.owner_scope === "LABEL" ? " (לייבל)" : ""}</option>)}</select>
              <button style={btn(true)} onClick={assign}>שמירה</button>
            </div>
            <div style={{ fontSize: 10.5, color: MUTED, marginTop: 4 }}>פריט בסדרה נספר גם ביעד הכולל וגם ביעד הסדרה — פעם אחת בכל סיכום. סדרת אמן מקבלת רק תוכן של אותו אמן.</div>
          </div>
        </>}
    </section>
  );
}
