"use client";

// ── ניהול הלייבל (/label) — owner-only label management dashboard ─────────────
// Artists come ONLY from the label_artists roster (GET /api/label/artists).
// Releases (GET /api/label/releases) are grouped under each artist by
// release.labelArtistId — NEVER by projects.artist. Money is an honest
// "not connected" placeholder (finance attribution deferred).

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import type { LabelArtist, LabelRelease, ProjectReleaseDetails, LabelShowLine, ArtistShowsSummary, LabelClipLine, ArtistClipsSummary, LabelMediaRecord, ArtistMediaSummary, ArtistRecoupSummary } from "@/lib/types";
import { MediaModal, MediaCancelModal, type MediaRec } from "./MediaModals";
import {
  BRAND, CARD, CARD2, BORDER, BORDER2, TEXT, SUB, MUTED, DIM, GREEN,
  STAGE_COLOR, ARTIST_STATUS_COLOR, todayYmd, fmtDate, daysUntil, daysBetween, ACTIVE_STAGES_SET,
  StageBadge, SectionHeader, Card, ArtistAvatar,
  ModalShell, PrimaryBtn, GhostBtn, fieldStyle, labelStyle,
  CreateReleaseModal, EditReleaseModal, AddArtistModal,
} from "./labelShared";

type WithRelease = LabelRelease & { release: ProjectReleaseDetails };

// ── Mark an existing song project as a label release (pick project + artist) ──
interface SlimProject { id: string; name: string; artist: string; projectType: string; businessType: string; }
function MarkExistingModal({ artists, onClose, onSaved }: { artists: LabelArtist[]; onClose: () => void; onSaved: () => void }) {
  const [projects, setProjects] = useState<SlimProject[] | null>(null);
  const [artistId, setArtistId] = useState<string>(artists[0]?.id ?? "");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then((rows: SlimProject[]) => {
      setProjects(Array.isArray(rows) ? rows.filter((p) => p.businessType !== "לייבל" && p.projectType === "שיר") : []);
    }).catch(() => setProjects([]));
  }, []);

  async function convert(p: SlimProject) {
    if (!artistId) { setErr("יש לבחור אמן"); return; }
    setBusyId(p.id); setErr(null);
    try {
      const res = await fetch("/api/label/releases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: p.id, labelArtistId: artistId, releaseStage: "רעיון" }) });
      if (!res.ok) { const d = await res.json().catch(() => null); setErr(d?.error || "הסימון נכשל"); setBusyId(null); return; }
      onSaved(); onClose();
    } catch { setErr("שגיאת רשת"); setBusyId(null); }
  }

  return (
    <ModalShell title="סמן פרויקט קיים כלייבל" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.6, marginBottom: 14 }}>בחר אמן לייבל, ואז את פרויקט השיר שברצונך לקשר אליו.</div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>אמן</label>
        {artists.length === 0 ? (
          <div style={{ fontSize: 13, color: MUTED }}>אין עדיין אמני לייבל — הוסף אמן קודם.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {artists.map((a) => { const active = a.id === artistId; return <button key={a.id} type="button" onClick={() => setArtistId(a.id)} style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 100, padding: "6px 13px", cursor: "pointer", fontFamily: "inherit", color: active ? "#fff" : SUB, background: active ? BRAND : "rgba(255,255,255,0.04)", border: `1px solid ${active ? BRAND : BORDER}` }}>{a.name}</button>; })}
          </div>
        )}
      </div>
      {err && <div style={{ color: "#F87171", fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{err}</div>}
      <label style={labelStyle}>פרויקט שיר לקישור</label>
      {projects === null ? (
        <div style={{ color: MUTED, fontSize: 13, padding: "20px 0", textAlign: "center" }}>טוען…</div>
      ) : projects.length === 0 ? (
        <div style={{ color: MUTED, fontSize: 13, padding: "20px 0", textAlign: "center" }}>אין פרויקטי שיר זמינים לסימון.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "44vh", overflowY: "auto" }}>
          {projects.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: MUTED }}>{p.artist || "—"}</div>
              </div>
              <button onClick={() => convert(p)} disabled={busyId === p.id || !artistId} style={{ fontSize: 12.5, fontWeight: 800, borderRadius: 9, padding: "7px 14px", border: "none", background: busyId === p.id || !artistId ? "#4A2020" : BRAND, color: "#fff", cursor: busyId === p.id || !artistId ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0 }}>{busyId === p.id ? "…" : "קשר"}</button>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

export default function LabelPage() {
  const [artists, setArtists] = useState<LabelArtist[] | null>(null);
  const [releases, setReleases] = useState<LabelRelease[] | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [createOpen, setCreateOpen] = useState(false);
  const [addArtistOpen, setAddArtistOpen] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const [editItem, setEditItem] = useState<LabelRelease | null>(null);

  type ShowLine = LabelShowLine & { artistName: string };
  const [shows, setShows] = useState<{ totals: ArtistShowsSummary["totals"]; lines: ShowLine[] } | null>(null);

  const reload = useCallback(() => {
    Promise.all([
      fetch("/api/label/artists").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch("/api/label/releases").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
    ]).then(([a, r]: [LabelArtist[], LabelRelease[]]) => {
      setArtists(Array.isArray(a) ? a : []);
      setReleases(Array.isArray(r) ? r : []);
      setState("ready");
    }).catch(() => setState("error"));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  type ClipLine = LabelClipLine & { artistName: string };
  const [clips, setClips] = useState<{ totals: ArtistClipsSummary["totals"]; lines: ClipLine[] } | null>(null);

  const [media, setMedia] = useState<{
    totals: ArtistMediaSummary["totals"]; recoupTarget: number; recoupBalance: number; artistCredit: number; records: MediaRec[];
  } | null>(null);
  const [mediaCreate, setMediaCreate] = useState(false);
  const [mediaEdit, setMediaEdit] = useState<MediaRec | null>(null);
  const [mediaCancel, setMediaCancel] = useState<MediaRec | null>(null);

  // Unified artist recoup (clips=target; media+shows reduce it). Every cap is applied
  // per-artist server-side; we sum the already-capped fields — never raw inputs.
  const [recoup, setRecoup] = useState<ArtistRecoupSummary | null>(null);

  // Shows-only label finance: fetch per roster artist and aggregate. Money is
  // derived server-side via computeShowSplit only — transactions are never summed.
  useEffect(() => {
    const roster = artists ?? [];
    const empty = { labelReceived: 0, labelExpected: 0, artistPaid: 0, artistExpected: 0, djPaid: 0, djExpected: 0, count: 0, needsAttribution: 0 };
    if (roster.length === 0) { setShows({ totals: empty, lines: [] }); return; }
    let alive = true;
    Promise.all(roster.map((a) => fetch(`/api/label/artists/${a.id}/shows`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((results: (ArtistShowsSummary | null)[]) => {
        if (!alive) return;
        const t = { ...empty };
        const lines: ShowLine[] = [];
        results.forEach((res, i) => {
          if (!res) return;
          (Object.keys(t) as (keyof typeof t)[]).forEach((k) => { t[k] += res.totals[k]; });
          for (const s of res.shows) lines.push({ ...s, artistName: roster[i].name });
        });
        lines.sort((a, b) => (a.date && b.date ? (a.date > b.date ? -1 : 1) : a.date ? -1 : 1));
        setShows({ totals: t, lines });
      });
    return () => { alive = false; };
  }, [artists]);

  // Clip investment: fetch per roster artist and aggregate. Single source =
  // red_films_productions.general_budget (live, no-store). labelInvestment = budget/2.
  useEffect(() => {
    const roster = artists ?? [];
    const empty = { fullBudget: 0, labelInvestment: 0, artistRecoupBalance: 0, count: 0 };
    if (roster.length === 0) { setClips({ totals: empty, lines: [] }); return; }
    let alive = true;
    Promise.all(roster.map((a) => fetch(`/api/label/artists/${a.id}/clips`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((results: (ArtistClipsSummary | null)[]) => {
        if (!alive) return;
        const t = { ...empty };
        const lines: ClipLine[] = [];
        results.forEach((res, i) => {
          if (!res) return;
          (Object.keys(t) as (keyof typeof t)[]).forEach((k) => { t[k] += res.totals[k]; });
          for (const c of res.clips) lines.push({ ...c, artistName: roster[i].name });
        });
        setClips({ totals: t, lines });
      });
    return () => { alive = false; };
  }, [artists]);

  // Media income: fetch per roster artist and aggregate (signed totals from the API).
  const reloadMedia = useCallback(() => {
    const roster = artists ?? [];
    const emptyT = { mediaGross: 0, labelShareReceived: 0, artistShareGross: 0, recoupedTotal: 0, artistPayableTotal: 0, labelShareExpected: 0, artistShareExpected: 0 };
    if (roster.length === 0) { setMedia({ totals: emptyT, recoupTarget: 0, recoupBalance: 0, artistCredit: 0, records: [] }); return; }
    Promise.all(roster.map((a) => fetch(`/api/label/artists/${a.id}/media`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((results: (ArtistMediaSummary | null)[]) => {
        const t = { ...emptyT }; let rt = 0, rb = 0, ac = 0; const recs: MediaRec[] = [];
        results.forEach((res, i) => {
          if (!res) return;
          (Object.keys(t) as (keyof typeof t)[]).forEach((k) => { t[k] += res.totals[k]; });
          rt += res.recoupTarget; rb += res.recoupBalance; ac += res.artistCredit;
          for (const rec of res.records) recs.push({ ...rec, artistId: roster[i].id, artistName: roster[i].name });
        });
        setMedia({ totals: t, recoupTarget: rt, recoupBalance: rb, artistCredit: ac, records: recs });
      });
  }, [artists]);
  useEffect(() => { reloadMedia(); }, [reloadMedia]);

  // Unified recoup: fetch per roster artist, sum the already-capped per-artist fields.
  const reloadRecoup = useCallback(() => {
    const roster = artists ?? [];
    const zero: ArtistRecoupSummary = {
      clipRecoupTarget: 0, mediaArtistShareReceived: 0, showsArtistPaid: 0,
      mediaExpectedArtistShare: 0, showsArtistExpected: 0, actualRecouped: 0,
      expectedArtistIncome: 0, actualRecoupBalance: 0, projectedRecoup: 0,
      projectedRecoupBalance: 0, artistCredit: 0, actualArtistIncome: 0, artistActualBalance: 0,
    };
    if (roster.length === 0) { setRecoup(zero); return; }
    Promise.all(roster.map((a) => fetch(`/api/label/artists/${a.id}/recoup`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((results: (ArtistRecoupSummary | null)[]) => {
        const t = { ...zero };
        results.forEach((res) => {
          if (!res) return;
          (Object.keys(t) as (keyof ArtistRecoupSummary)[]).forEach((k) => { t[k] += res[k]; });
        });
        setRecoup(t);
      });
  }, [artists]);
  useEffect(() => { reloadRecoup(); }, [reloadRecoup]);

  // Media writes change recoup too — refresh both after any media save.
  const onMediaSaved = useCallback(() => { reloadMedia(); reloadRecoup(); }, [reloadMedia, reloadRecoup]);

  const d = useMemo(() => {
    const roster = artists ?? [];
    const rels = releases ?? [];
    const withRel = rels.filter((r): r is WithRelease => !!r.release);
    const active = withRel.filter((r) => ACTIVE_STAGES_SET.has(r.release.releaseStage));

    const byArtist = new Map<string, WithRelease[]>();
    for (const r of withRel) {
      const key = r.release.labelArtistId ?? "";
      if (!byArtist.has(key)) byArtist.set(key, []);
      byArtist.get(key)!.push(r);
    }

    const upcoming = active.filter((r) => r.release.releaseTargetDate)
      .sort((a, b) => (a.release.releaseTargetDate! < b.release.releaseTargetDate! ? -1 : 1));
    const upcomingSoon = upcoming.filter((r) => (daysUntil(r.release.releaseTargetDate) ?? -1) >= 0);

    const released = withRel.filter((r) => r.release.releasedAt)
      .sort((a, b) => (a.release.releasedAt! > b.release.releasedAt! ? -1 : 1));
    const daysSinceLast = released[0] ? Math.max(0, daysBetween(released[0].release.releasedAt!.slice(0, 10), todayYmd())) : null;

    const priority = active
      .filter((r) => r.release.nextAction.trim() || r.release.blocker.trim() || (daysUntil(r.release.releaseTargetDate) ?? 99) < 0)
      .sort((a, b) => {
        const ab = a.release.blocker.trim() ? 0 : 1, bb = b.release.blocker.trim() ? 0 : 1;
        if (ab !== bb) return ab - bb;
        return (a.release.stageEnteredAt < b.release.stageEnteredAt ? -1 : 1);
      });

    return { roster, byArtist, active, upcoming, upcomingSoon, daysSinceLast, priority };
  }, [artists, releases]);

  const busy = state === "loading";

  // Top financial KPIs — LABEL P&L only (never artist share / recoup). Balance =
  // actual income − actual clip investment; projected adds only expected income.
  const finReady = shows != null && clips != null && media != null;
  const investActual = clips?.totals.labelInvestment ?? 0;   // clip label investment (budget/2)
  const incomeActual = (shows?.totals.labelReceived ?? 0) + (media?.totals.labelShareReceived ?? 0);
  const incomeExpected = (shows?.totals.labelExpected ?? 0) + (media?.totals.labelShareExpected ?? 0);
  const balanceActual = incomeActual - investActual;         // label balance (distinct from artistActualBalance)
  const labelProjectedBalance = Math.round((balanceActual + incomeExpected + Number.EPSILON) * 100) / 100;
  const openShows = shows ? shows.lines.filter((s) => s.included && s.paymentStatus !== "שולם").length : null;  // unpaid, non-collab
  const money = (n: number) => {
    const hasFrac = Math.abs(n % 1) > 0.001;
    return `₪${n.toLocaleString("en-US", { minimumFractionDigits: hasFrac ? 2 : 0, maximumFractionDigits: 2 })}`;
  };
  const signedMoney = (n: number) => (n < -0.001 ? "−" : "") + money(Math.abs(n));
  const signColor = (n: number) => (n < -0.001 ? "#F87171" : n > 0.001 ? GREEN : SUB);

  return (
    <div dir="rtl" style={{ fontFamily: "'Heebo', Arial, sans-serif", color: TEXT, padding: "26px 32px 72px", width: "100%", maxWidth: 1600, margin: "0 auto" }}>
      <style>{`
        .rb-lab-fin { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
        .rb-lab-ops { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
        .rb-lab-artists { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px; }
        .rb-lab-money { display:grid; grid-template-columns:1fr 1fr 1.2fr; gap:14px; }
        .rb-lab-shows-kpis { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; }
        .rb-lab-bottom { display:grid; grid-template-columns:1fr 1.25fr; gap:18px; }
        @media (max-width:1180px){ .rb-lab-shows-kpis{ grid-template-columns:repeat(3,1fr);} }
        @media (max-width:1000px){ .rb-lab-money{ grid-template-columns:1fr;} .rb-lab-bottom{ grid-template-columns:1fr;} }
        @media (max-width:820px){ .rb-lab-fin{ grid-template-columns:1fr;} }
        @media (max-width:620px){ .rb-lab-shows-kpis{ grid-template-columns:repeat(2,1fr);} .rb-lab-ops{ grid-template-columns:repeat(2,1fr);} .rb-lab-artists{ grid-template-columns:1fr;} }
      `}</style>

      {/* Hero */}
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 24, border: `1px solid ${BORDER}`, background: "radial-gradient(120% 140% at 50% -20%, rgba(220,38,38,0.28) 0%, rgba(220,38,38,0.06) 38%, rgba(13,13,13,0) 70%), linear-gradient(180deg,#171012,#121212)", padding: "28px 28px 24px", textAlign: "center", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 8 }}>
          <h1 style={{ fontSize: 32, fontWeight: 900, color: "#fff", margin: 0, letterSpacing: "-0.02em", textShadow: "0 1px 12px rgba(0,0,0,0.5)" }}>ניהול הלייבל</h1>
          <span style={{ fontSize: 26, filter: "drop-shadow(0 0 12px rgba(220,38,38,0.7))" }}>🎯</span>
        </div>
        <div style={{ fontSize: 14.5, color: "#C9C9C9" }}>סקירה כוללת של אמני הלייבל, הריליסים והפעולות שדורשות טיפול</div>
      </div>

      {state === "error" && <Card style={{ marginBottom: 20 }}><div style={{ color: "#F87171", textAlign: "center", padding: "10px 0", fontSize: 14 }}>שגיאה בטעינת נתוני הלייבל.</div></Card>}

      {/* Financial KPIs — LABEL P&L only. Primary = actual label balance (the headline). */}
      <div className="rb-lab-fin" style={{ marginBottom: 12 }}>
        {/* 1 · Primary — actual label balance (emphasized: sign-colored border + largest number) */}
        <div style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0))", border: `1px solid ${!finReady ? BORDER : balanceActual < -0.001 ? "rgba(248,113,113,0.4)" : balanceActual > 0.001 ? "rgba(52,211,153,0.4)" : BORDER}`, borderRadius: 18, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: SUB }}>מאזן הלייבל בפועל</span>
          <span style={{ fontSize: 38, fontWeight: 900, color: finReady ? signColor(balanceActual) : TEXT, letterSpacing: "-0.02em", lineHeight: 1.05, direction: "ltr", textAlign: "right" }}>{finReady ? signedMoney(balanceActual) : "…"}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: finReady ? signColor(balanceActual) : MUTED }}>הכנסות שהתקבלו פחות השקעות הלייבל</span>
        </div>
        {/* 2 · Expected income */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: SUB }}>צפוי להיכנס ללייבל</span>
          <span style={{ fontSize: 30, fontWeight: 900, color: "#F59E0B", letterSpacing: "-0.02em", lineHeight: 1.05, direction: "ltr", textAlign: "right" }}>{finReady ? money(incomeExpected) : "…"}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: MUTED }}>הכנסות שעדיין לא התקבלו</span>
        </div>
        {/* 3 · Projected balance */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: SUB }}>מאזן לייבל צפוי</span>
          <span style={{ fontSize: 30, fontWeight: 900, color: finReady ? signColor(labelProjectedBalance) : TEXT, letterSpacing: "-0.02em", lineHeight: 1.05, direction: "ltr", textAlign: "right" }}>{finReady ? signedMoney(labelProjectedBalance) : "…"}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: MUTED }}>המצב אם כל ההכנסות הצפויות יתקבלו</span>
        </div>
      </div>

      {/* Operational KPIs — smaller, secondary */}
      <div className="rb-lab-ops" style={{ marginBottom: 20 }}>
        {[
          { l: "אמני לייבל", v: busy ? "…" : d.roster.length },
          { l: "הופעות פתוחות", v: openShows == null ? "…" : openShows },
          { l: "קליפים פעילים", v: clips == null ? "…" : clips.totals.count },
          { l: "ריליסים קרובים", v: busy ? "…" : d.upcomingSoon.length },
        ].map((t) => (
          <div key={t.l} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.l}</span>
            <span style={{ fontSize: 24, fontWeight: 900, color: TEXT, lineHeight: 1.1 }}>{t.v}</span>
          </div>
        ))}
      </div>

      {/* Compact artist nav + actions (replaces the large artists grid) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
          {busy ? (
            <span style={{ fontSize: 13, color: MUTED }}>טוען…</span>
          ) : d.roster.length === 0 ? (
            <span style={{ fontSize: 13, color: MUTED }}>אין עדיין אמני לייבל — הוסף אמן כדי להתחיל.</span>
          ) : d.roster.map((artist) => {
            const activeRels = (d.byArtist.get(artist.id) ?? []).filter((r) => ACTIVE_STAGES_SET.has(r.release.releaseStage));
            const sc = ARTIST_STATUS_COLOR[artist.status];
            return (
              <Link key={artist.id} href={`/label/artists/${artist.id}`} title="פתח עמוד אמן" style={{ display: "flex", alignItems: "center", gap: 10, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 100, padding: "6px 14px 6px 7px", textDecoration: "none" }}>
                <ArtistAvatar artist={artist} size={32} />
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>{artist.name}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: sc }}>● {artist.status} · {activeRels.length} בצינור</span>
                </div>
                <span style={{ fontSize: 13, color: BRAND, fontWeight: 900, marginRight: 2 }}>←</span>
              </Link>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setAddArtistOpen(true)} style={{ fontSize: 12.5, fontWeight: 700, color: SUB, background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`, borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" }}>+ אמן לייבל</button>
          <button onClick={() => setMarkOpen(true)} style={{ fontSize: 12.5, fontWeight: 700, color: SUB, background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`, borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" }}>סמן פרויקט כלייבל</button>
          <button onClick={() => setCreateOpen(true)} style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: BRAND, border: "none", borderRadius: 9, padding: "8px 16px", cursor: "pointer", fontFamily: "inherit" }}>+ ריליס חדש</button>
        </div>
      </div>

      {/* Shows — real label finance (computeShowSplit only; no double count) */}
      <div style={{ marginBottom: 20 }}>
        <SectionHeader title="הופעות הלייבל" />
        <Card>
          {!shows ? (
            <div style={{ color: MUTED, textAlign: "center", padding: "18px 0" }}>טוען…</div>
          ) : (
            <>
              <div className="rb-lab-shows-kpis">
                {[
                  { l: "רווח לייבל — התקבל", v: shows.totals.labelReceived, c: GREEN, money: true },
                  { l: "רווח לייבל — צפוי", v: shows.totals.labelExpected, c: "#F59E0B", money: true },
                  { l: "רווח אמן — שולם", v: shows.totals.artistPaid, c: SUB, money: true },
                  { l: "רווח אמן — צפוי", v: shows.totals.artistExpected, c: SUB, money: true },
                  { l: "מספר הופעות", v: shows.totals.count, c: TEXT, money: false },
                ].map((t) => (
                  <div key={t.l} style={{ background: CARD2, border: `1px solid ${BORDER2}`, borderRadius: 14, padding: "14px 15px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.l}</div>
                    <div style={{ fontSize: 21, fontWeight: 900, color: t.c, marginTop: 6 }}>{t.money ? `₪${Math.round(t.v).toLocaleString()}` : t.v}</div>
                  </div>
                ))}
              </div>

              {shows.totals.needsAttribution > 0 && (
                <div style={{ marginTop: 14, fontSize: 12, color: "#F59E0B", fontWeight: 700 }}>⚠ {shows.totals.needsAttribution} הופעות קולאב דורשות שיוך ואינן נכללות בסכומים</div>
              )}

              {shows.lines.length === 0 ? (
                <div style={{ marginTop: 16, color: MUTED, textAlign: "center", padding: "10px 0", fontSize: 13.5 }}>אין הופעות משויכות לאמני הלייבל.</div>
              ) : (
                <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                  {shows.lines.map((s) => {
                    const paid = s.paymentStatus === "שולם";
                    return (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, background: CARD2, border: `1px solid ${BORDER2}`, borderRadius: 12, padding: "11px 14px", flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>{s.name}</div>
                          <div style={{ fontSize: 11.5, color: MUTED }}>{s.artistName} · {fmtDate(s.date)}</div>
                        </div>
                        {s.included ? (
                          <>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: paid ? GREEN : "#F59E0B", background: paid ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.12)", border: `1px solid ${paid ? "rgba(52,211,153,0.3)" : "rgba(245,158,11,0.3)"}`, borderRadius: 100, padding: "3px 10px" }}>{s.paymentStatus}</span>
                            <div style={{ display: "flex", gap: 18, textAlign: "left" }}>
                              <div style={{ minWidth: 84 }}>
                                <div style={{ fontSize: 10, color: DIM }}>רווח לייבל</div>
                                <div style={{ fontSize: 15, fontWeight: 900, color: paid ? GREEN : SUB }}>₪{Math.round(s.labelProfit).toLocaleString()}</div>
                              </div>
                              <div style={{ minWidth: 84 }}>
                                <div style={{ fontSize: 10, color: DIM }}>רווח אמן</div>
                                <div style={{ fontSize: 15, fontWeight: 900, color: SUB }}>₪{Math.round(s.artistFee).toLocaleString()}</div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#F59E0B", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 100, padding: "3px 10px" }}>דורש שיוך (קולאב)</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Clips — real label investment (Red Films general_budget; 50/50) */}
      <div style={{ marginBottom: 20 }}>
        <SectionHeader title="קליפים (השקעת לייבל)" />
        <Card>
          {!clips ? (
            <div style={{ color: MUTED, textAlign: "center", padding: "18px 0" }}>טוען…</div>
          ) : clips.lines.length === 0 ? (
            <div style={{ color: MUTED, textAlign: "center", padding: "22px 0", fontSize: 13.5, lineHeight: 1.7 }}>אין הפקות קליפ פעילות משויכות לאמני הלייבל.<br />תקציב קליפ מנוהל בעמוד Red Films.</div>
          ) : (
            <>
              <div className="rb-lab-money">
                {[
                  { t: "תקציב מלא (שולם)", v: clips.totals.fullBudget, c: SUB },
                  { t: "השקעת לייבל (50%)", v: clips.totals.labelInvestment, c: "#F87171" },
                  { t: "יעד קיזוז אמן (50%)", v: clips.totals.artistRecoupBalance, c: "#F59E0B" },
                ].map((b) => (
                  <div key={b.t} style={{ background: CARD2, border: `1px solid ${BORDER2}`, borderRadius: 16, padding: "18px 18px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: b.c }}>{b.t}</div>
                    <div style={{ fontSize: 26, fontWeight: 900, color: TEXT, marginTop: 8 }}>{money(b.v)}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {clips.lines.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, background: CARD2, border: `1px solid ${BORDER2}`, borderRadius: 12, padding: "11px 14px", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>{c.title}</div>
                      <div style={{ fontSize: 11.5, color: MUTED }}>{c.artistName} · {c.status}</div>
                    </div>
                    <div style={{ display: "flex", gap: 16, textAlign: "left", flexWrap: "wrap" }}>
                      <div style={{ minWidth: 78 }}><div style={{ fontSize: 10, color: DIM }}>תקציב</div><div style={{ fontSize: 14, fontWeight: 800, color: SUB }}>{money(c.fullBudget)}</div></div>
                      <div style={{ minWidth: 78 }}><div style={{ fontSize: 10, color: DIM }}>לייבל 50%</div><div style={{ fontSize: 14, fontWeight: 900, color: "#F87171" }}>{money(c.labelInvestment)}</div></div>
                      <div style={{ minWidth: 78 }}><div style={{ fontSize: 10, color: DIM }}>קיזוז אמן</div><div style={{ fontSize: 14, fontWeight: 800, color: "#F59E0B" }}>{money(c.artistRecoupBalance)}</div></div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>יעד הקיזוז = חצי האמן מתקציבי הקליפים. הקיזוז בפועל מול הכנסות האמן מוצג בסקשן "חוב האמן ללייבל" למטה. התקציב נקרא חי מ-Red Films.</div>
            </>
          )}
        </Card>
      </div>

      {/* Media income + recoup */}
      <div style={{ marginBottom: 20 }}>
        <SectionHeader title="הכנסות מדיה" action={
          <button onClick={() => setMediaCreate(true)} disabled={d.roster.length === 0} style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: d.roster.length === 0 ? "#4A2020" : BRAND, border: "none", borderRadius: 9, padding: "8px 16px", cursor: d.roster.length === 0 ? "default" : "pointer", fontFamily: "inherit" }}>+ הזנת מדיה</button>
        } />
        <Card>
          {!media ? (
            <div style={{ color: MUTED, textAlign: "center", padding: "18px 0" }}>טוען…</div>
          ) : (
            <>
              <div className="rb-lab-shows-kpis">
                {[
                  { l: "סך מדיה (התקבל)", v: media.totals.mediaGross, c: SUB },
                  { l: "חלק לייבל", v: media.totals.labelShareReceived, c: GREEN },
                  { l: "חלק אמן ברוטו", v: media.totals.artistShareGross, c: SUB },
                  { l: "שקוזז", v: media.totals.recoupedTotal, c: "#F59E0B" },
                  { l: "לתשלום לאמן", v: media.totals.artistPayableTotal, c: SUB },
                ].map((t) => (
                  <div key={t.l} style={{ background: CARD2, border: `1px solid ${BORDER2}`, borderRadius: 14, padding: "14px 15px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: t.c, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.l}</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: TEXT, marginTop: 6 }}>{money(t.v)}</div>
                  </div>
                ))}
              </div>

              {media.records.length === 0 ? (
                <div style={{ marginTop: 16, color: MUTED, textAlign: "center", padding: "10px 0", fontSize: 13.5 }}>אין הזנות מדיה. השתמש ב"הזנת מדיה" כדי להוסיף.</div>
              ) : (
                <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                  {media.records.map((r) => {
                    const isRev = r.recordType === "reversal";
                    const sc = r.status === "התקבל" ? GREEN : r.status === "צפוי" ? "#F59E0B" : MUTED;
                    const canAct = r.recordType === "income" && r.status !== "בוטל" && !r.isReversed;
                    const sgn = isRev ? "−" : "";
                    return (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, background: CARD2, border: `1px solid ${isRev ? "rgba(245,158,11,0.25)" : BORDER2}`, borderRadius: 12, padding: "11px 14px", flexWrap: "wrap", opacity: r.status === "בוטל" || r.isReversed ? 0.6 : 1 }}>
                        <div style={{ flex: 1, minWidth: 150 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            {r.source || "מדיה"}
                            {isRev && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#F59E0B", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 100, padding: "1px 8px" }}>היפוך</span>}
                            {r.isReversed && <span style={{ fontSize: 10.5, fontWeight: 800, color: MUTED, background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}`, borderRadius: 100, padding: "1px 8px" }}>הופך</span>}
                          </div>
                          <div style={{ fontSize: 11.5, color: MUTED }}>{r.artistName} · {r.reportPeriod || "—"} · {fmtDate(r.receivedDate)} · <span style={{ color: sc, fontWeight: 700 }}>{r.status}</span></div>
                        </div>
                        <div style={{ display: "flex", gap: 14, textAlign: "left", flexWrap: "wrap" }}>
                          <div style={{ minWidth: 70 }}><div style={{ fontSize: 10, color: DIM }}>ברוטו</div><div style={{ fontSize: 13, fontWeight: 800, color: SUB }}>{sgn}{money(r.grossAmount)}</div></div>
                          <div style={{ minWidth: 70 }}><div style={{ fontSize: 10, color: DIM }}>לייבל</div><div style={{ fontSize: 13, fontWeight: 900, color: GREEN }}>{sgn}{money(r.labelShare)}</div></div>
                          <div style={{ minWidth: 70 }}><div style={{ fontSize: 10, color: DIM }}>קוזז</div><div style={{ fontSize: 13, fontWeight: 800, color: "#F59E0B" }}>{sgn}{money(r.recouped)}</div></div>
                          <div style={{ minWidth: 70 }}><div style={{ fontSize: 10, color: DIM }}>לאמן</div><div style={{ fontSize: 13, fontWeight: 800, color: SUB }}>{sgn}{money(r.artistPayable)}</div></div>
                        </div>
                        {canAct && (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => setMediaEdit(r)} style={{ fontSize: 11.5, fontWeight: 700, color: SUB, background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontFamily: "inherit" }}>עריכה</button>
                            <button onClick={() => setMediaCancel(r)} style={{ fontSize: 11.5, fontWeight: 700, color: "#F87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.28)", borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Artist debt to label — initial debt = clip artist-half; the artist's FULL received
          share (paid shows + received media) flows through it first, only the excess is credit.
          Expected income projects the debt but never reduces it. All caps per-artist (server). */}
      <div style={{ marginBottom: 20 }}>
        <SectionHeader title="חוב האמן ללייבל" />
        <Card>
          {!recoup ? (
            <div style={{ color: MUTED, textAlign: "center", padding: "18px 0" }}>טוען…</div>
          ) : (() => {
            const debt = recoup.actualRecoupBalance, credit = recoup.artistCredit;
            const inDebt = debt > 0.001, inCredit = !inDebt && credit > 0.001;
            const hlTitle = inDebt ? "חוב האמן ללייבל" : inCredit ? "יתרה לזכות האמן" : "החוב נסגר";
            const hlValue = inDebt ? debt : inCredit ? credit : 0;
            const hlColor = inDebt ? "#F87171" : inCredit ? GREEN : SUB;
            const hlNote = inDebt ? "חלק האמן מהכנסות מתקזז תחילה מול החוב" : inCredit ? "החוב נסגר והיתרה מיועדת לאמן" : "כל חלק האמן שהתקבל קיזז את החוב";
            return (
            <>
              {/* Headline: current artist debt (or credit once the debt is closed) */}
              <div style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0))", border: `1px solid ${inDebt ? "rgba(248,113,113,0.35)" : inCredit ? "rgba(52,211,153,0.35)" : BORDER2}`, borderRadius: 18, padding: "22px 24px", marginBottom: 16, textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: SUB, letterSpacing: "0.02em" }}>{hlTitle}</div>
                <div style={{ fontSize: 40, fontWeight: 900, color: hlColor, marginTop: 8, letterSpacing: "-0.02em", direction: "ltr" }}>{money(hlValue)}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: hlColor, marginTop: 8 }}>{hlNote}</div>
              </div>

              {/* Secondary detail */}
              <div className="rb-lab-shows-kpis">
                {[
                  { l: "חוב התחלתי", v: recoup.clipRecoupTarget, c: SUB },
                  { l: "קוזז בפועל", v: recoup.actualRecouped, c: GREEN },
                  { l: "צפוי להתקזז", v: recoup.projectedRecoup, c: "#F59E0B" },
                  { l: "חוב צפוי", v: recoup.projectedRecoupBalance, c: "#F59E0B" },
                ].map((t) => (
                  <div key={t.l} style={{ background: CARD2, border: `1px solid ${BORDER2}`, borderRadius: 14, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: t.c, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.l}</div>
                    <div style={{ fontSize: 17, fontWeight: 900, color: TEXT, marginTop: 5 }}>{money(t.v)}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 11.5, color: MUTED, lineHeight: 1.7 }}>
                החוב מתחיל מחצי האמן בתקציבי הקליפים. חלק האמן שהתקבל בפועל (הופעות ששולמו + מדיה שהתקבלה) מקזז אותו תחילה, ורק מה שמעבר הופך ליתרה לזכות האמן. "צפוי להתקזז" מבוסס על הופעות ומדיה שטרם התקבלו — לתצוגה בלבד, אינו מקטין את החוב בפועל.
              </div>
            </>
            );
          })()}
        </Card>
      </div>

      {/* Bottom */}
      <div className="rb-lab-bottom">
        <div>
          <SectionHeader title="עדיפות הלייבל היום" />
          <Card style={{ padding: 16 }}>
            {busy ? <div style={{ color: MUTED, textAlign: "center", padding: "16px 0" }}>טוען…</div>
            : d.priority.length === 0 ? <div style={{ color: MUTED, textAlign: "center", padding: "22px 0", fontSize: 13.5, lineHeight: 1.7 }}>אין פעולות פתוחות שהוגדרו.<br />הגדר "פעולה הבאה" בריליס כדי שיופיע כאן.</div>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {d.priority.map((r) => {
                  const overdue = (daysUntil(r.release.releaseTargetDate) ?? 99) < 0;
                  return (
                    <button key={r.projectId} onClick={() => setEditItem(r)} style={{ textAlign: "right", background: CARD2, border: `1px solid ${r.release.blocker.trim() ? "rgba(248,113,113,0.3)" : BORDER}`, borderRadius: 13, padding: "12px 14px", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 7 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <StageBadge stage={r.release.releaseStage} small />
                        <span style={{ fontSize: 14, fontWeight: 800, color: TEXT, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                        <span style={{ fontSize: 11.5, color: MUTED }}>{r.artist}</span>
                      </div>
                      {r.release.nextAction.trim() && <div style={{ fontSize: 13.5, color: "#E5E5E5", fontWeight: 600 }}>▸ {r.release.nextAction}</div>}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        {r.release.blocker.trim() && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#F87171" }}>⛔ {r.release.blocker}</span>}
                        {overdue && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#F59E0B" }}>איחור בתאריך היעד</span>}
                        {r.release.responsible.trim() && <span style={{ fontSize: 11.5, color: MUTED }}>אחראי: {r.release.responsible}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div>
          <SectionHeader title="ריליסים קרובים" />
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {busy ? <div style={{ color: MUTED, textAlign: "center", padding: "20px 0" }}>טוען…</div>
            : d.upcoming.length === 0 ? <div style={{ color: MUTED, textAlign: "center", padding: "26px 0", fontSize: 13.5, lineHeight: 1.7 }}>אין ריליסים עם תאריך יציאה.<br />הגדר תאריך יעד בריליס כדי שיופיע כאן.</div>
            : (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 0.9fr", gap: 8, padding: "12px 18px", borderBottom: `1px solid ${BORDER2}` }}>
                  {["שם / אמן", "שלב", "תאריך יעד", "בעוד"].map((h) => <span key={h} style={{ fontSize: 10.5, fontWeight: 800, color: DIM, letterSpacing: "0.05em" }}>{h}</span>)}
                </div>
                {d.upcoming.map((r, i) => {
                  const du = daysUntil(r.release.releaseTargetDate);
                  return (
                    <button key={r.projectId} onClick={() => setEditItem(r)} style={{ width: "100%", textAlign: "right", display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 0.9fr", gap: 8, alignItems: "center", padding: "13px 18px", background: i % 2 ? "rgba(255,255,255,0.012)" : "transparent", border: "none", borderBottom: i === d.upcoming.length - 1 ? "none" : `1px solid ${BORDER2}`, cursor: "pointer", fontFamily: "inherit" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                        <div style={{ fontSize: 11.5, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.artist}</div>
                      </div>
                      <div><StageBadge stage={r.release.releaseStage} small /></div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: SUB }}>{fmtDate(r.release.releaseTargetDate)}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: du != null && du < 0 ? "#F59E0B" : du != null && du <= 7 ? GREEN : SUB }}>{du == null ? "—" : du < 0 ? `${Math.abs(du)} ימים באיחור` : du === 0 ? "היום" : `${du} ימים`}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      {createOpen && <CreateReleaseModal artists={d.roster} onClose={() => setCreateOpen(false)} onSaved={reload} onNeedArtist={() => setAddArtistOpen(true)} />}
      {addArtistOpen && <AddArtistModal onClose={() => setAddArtistOpen(false)} onSaved={() => reload()} />}
      {markOpen && <MarkExistingModal artists={d.roster} onClose={() => setMarkOpen(false)} onSaved={reload} />}
      {editItem && editItem.release && <EditReleaseModal item={editItem} onClose={() => setEditItem(null)} onSaved={reload} />}

      {mediaCreate && <MediaModal artists={d.roster} mode="create" onClose={() => setMediaCreate(false)} onSaved={onMediaSaved} />}
      {mediaEdit && <MediaModal artists={d.roster} mode="edit" record={mediaEdit} onClose={() => setMediaEdit(null)} onSaved={onMediaSaved} />}
      {mediaCancel && <MediaCancelModal record={mediaCancel} onClose={() => setMediaCancel(null)} onSaved={onMediaSaved} />}
    </div>
  );
}
