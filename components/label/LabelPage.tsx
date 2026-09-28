"use client";

// ── ניהול הלייבל (/label) — owner-only label management dashboard ─────────────
// Artists come ONLY from the label_artists roster (GET /api/label/artists).
// Releases (GET /api/label/releases) are grouped under each artist by
// release.labelArtistId — NEVER by projects.artist. Money is an honest
// "not connected" placeholder (finance attribution deferred).

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import ProjectCover from "@/components/ui/ProjectCover";
import { COVER_CHANGED_EVENT } from "@/lib/project-cover";
import type { LabelArtist, LabelRelease, ProjectReleaseDetails, LabelShowLine, ArtistShowsSummary, LabelClipLine, ArtistClipsSummary, LabelMediaRecord, ArtistMediaSummary, ArtistRecoupSummary } from "@/lib/types";
import { isReleasableType } from "@/lib/types";
import { creditsInclude } from "@/lib/release-candidates";
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
function MarkExistingModal({ artists, releasedProjectIds, onClose, onSaved }: { artists: LabelArtist[]; releasedProjectIds: ReadonlySet<string>; onClose: () => void; onSaved: () => void }) {
  const [projects, setProjects] = useState<SlimProject[] | null>(null);
  const [artistId, setArtistId] = useState<string>(artists[0]?.id ?? "");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then((rows: SlimProject[]) => {
      // Same type rule as the server guard and the dashboard's "הוסף ריליס" (isReleasableType). B2: filter on "no
      // release row yet" (the server's own guard), NOT on businessType — a project already classified לייבל (e.g. by
      // the Owner rule for שליו / אבי) that has no release must stay convertible. A dormant release on a לקוח
      // project is not in this list; the server answers "exists" for it.
      setProjects(Array.isArray(rows) ? rows.filter((p) => !releasedProjectIds.has(p.id) && isReleasableType(p.projectType)) : []);
    }).catch(() => setProjects([]));
  }, [releasedProjectIds]);

  // The server rejects linking an artist who isn't credited on the project, so list only the
  // selected artist's projects (same normalized exact-name match as the server guard).
  const artistName = artists.find((a) => a.id === artistId)?.name ?? "";
  const shown = projects === null ? null : projects.filter((p) => creditsInclude(p.artist, artistName));

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
      {shown === null ? (
        <div style={{ color: MUTED, fontSize: 13, padding: "20px 0", textAlign: "center" }}>טוען…</div>
      ) : shown.length === 0 ? (
        <div style={{ color: MUTED, fontSize: 13, padding: "20px 0", textAlign: "center" }}>אין פרויקטים של האמן הזה זמינים לסימון.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "44vh", overflowY: "auto" }}>
          {shown.map((p) => (
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
  // A1: `totals` are ₪ only; shows in another currency are listed (in their own currency) and flagged, never added.
  const [shows, setShows] = useState<{ totals: ArtistShowsSummary["totals"]; lines: ShowLine[]; otherCurrencies?: string[] } | null>(null);

  // B2: the convert-to-release list excludes projects that already HAVE a release row (not "already לייבל").
  const releasedProjectIds = useMemo(() => new Set((releases ?? []).filter((r) => r.release).map((r) => r.projectId)), [releases]);

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
  // A project's cover changed (drawer editor) → reload so the release thumbnails update.
  useEffect(() => {
    window.addEventListener(COVER_CHANGED_EVENT, reload);
    return () => window.removeEventListener(COVER_CHANGED_EVENT, reload);
  }, [reload]);

  type ClipLine = LabelClipLine & { artistName: string };
  const [clips, setClips] = useState<{ totals: ArtistClipsSummary["totals"]; lines: ClipLine[]; agreement: ArtistClipsSummary["agreement"] } | null>(null);

  const [media, setMedia] = useState<{
    totals: ArtistMediaSummary["totals"]; recoupTarget: number; recoupBalance: number; artistCredit: number; records: MediaRec[];
  } | null>(null);
  const [mediaCreate, setMediaCreate] = useState(false);
  const [mediaEdit, setMediaEdit] = useState<MediaRec | null>(null);
  const [mediaCancel, setMediaCancel] = useState<MediaRec | null>(null);

  // Per-artist income rows (source: /recoup). Kept per-artist — never mixed across artists.
  // Only the gross income fields are used here (no debt/recoup/investment displayed).
  type RecoupRow = { artistId: string; artistName: string; summary: ArtistRecoupSummary };
  const [recoupRows, setRecoupRows] = useState<RecoupRow[] | null>(null);
  const [bottomTab, setBottomTab] = useState<"actual" | "expected" | "debt">("actual");

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
        const other = new Set<string>();
        results.forEach((res, i) => {
          if (!res) return;
          (Object.keys(t) as (keyof typeof t)[]).forEach((k) => { t[k] += res.totals[k]; });
          for (const c of res.excludedCurrencies ?? []) other.add(c);
          for (const s of res.shows) lines.push({ ...s, artistName: roster[i].name });
        });
        lines.sort((a, b) => (a.date && b.date ? (a.date > b.date ? -1 : 1) : a.date ? -1 : 1));
        setShows({ totals: t, lines, otherCurrencies: [...other] });
      });
    return () => { alive = false; };
  }, [artists]);

  // Clips: fetch per roster artist and aggregate PER CURRENCY (B3, Owner canon 2026-09-27): A client clip price,
  // B planned budget, C actual cost (Finance, paid), Red Films ledger — four separate numbers, never added together.
  // The artist recoup of clips is NOT_DEFINED (no artist agreement rule) — never 50 % of the budget.
  // No double count (task 6, 2026-09-28): a production credited to two artists comes back from BOTH — it is kept once
  // (by production id); C and its Records / artist split are summed per Finance TRANSACTION (by txId), each once, with
  // every artist's own share added (lib/records-expense-share is the one rule; this page only adds up).
  useEffect(() => {
    const roster = artists ?? [];
    const empty = (): ArtistClipsSummary["totals"] => ({ count: 0, byCurrency: {} });
    if (roster.length === 0) { setClips({ totals: empty(), lines: [], agreement: { defined: {}, notDefined: {} } }); return; }
    let alive = true;
    Promise.all(roster.map((a) => fetch(`/api/label/artists/${a.id}/clips`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((results: (ArtistClipsSummary | null)[]) => {
        if (!alive) return;
        const t = empty();
        const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
        const byProd = new Map<string, ClipLine>();
        const byTx = new Map<string, { currency: string; cashOut: number; status: "DEFINED" | "NOT_DEFINED"; recordsShare: number; artistFunded: number; basisHe: string }>();
        results.forEach((res, i) => {
          if (!res) return;
          for (const c of res.clips) {
            const seen = byProd.get(c.id);
            if (seen) { if (!seen.artistName.includes(roster[i].name)) seen.artistName = `${seen.artistName}, ${roster[i].name}`; }
            else byProd.set(c.id, { ...c, artistName: roster[i].name });
          }
          for (const x of res.shareTransactions ?? []) {
            const cur = byTx.get(x.txId);
            if (cur) { cur.artistFunded = r2(cur.artistFunded + (x.artistShare ?? 0)); continue; }
            byTx.set(x.txId, { currency: x.currency, cashOut: x.cashOut, status: x.status, recordsShare: x.recordsShare ?? 0, artistFunded: x.artistShare ?? 0, basisHe: x.basisHe });
          }
        });
        const lines = [...byProd.values()];
        t.count = lines.length;
        for (const c of lines) {
          const add = (cur: string) => (t.byCurrency[cur] ??= { clientClipPrice: 0, plannedBudget: 0, actualCostPaid: 0, rfLedgerPaid: 0 });
          if (c.clientClipPrice != null && c.clientClipCurrency) add(c.clientClipCurrency).clientClipPrice = r2(add(c.clientClipCurrency).clientClipPrice + c.clientClipPrice);
          add(c.currency).plannedBudget = r2(add(c.currency).plannedBudget + c.plannedBudget);
          for (const [cur, v] of Object.entries(c.rfLedgerPaid ?? {})) add(cur).rfLedgerPaid = r2(add(cur).rfLedgerPaid + v);
        }
        // C + the split, each Finance transaction once
        const agreement: ArtistClipsSummary["agreement"] = { defined: {}, notDefined: {} };
        for (const x of byTx.values()) {
          const b = (t.byCurrency[x.currency] ??= { clientClipPrice: 0, plannedBudget: 0, actualCostPaid: 0, rfLedgerPaid: 0 });
          b.actualCostPaid = r2(b.actualCostPaid + x.cashOut);
          if (x.status === "DEFINED") {
            const d = (agreement.defined[x.currency] ??= { cashOut: 0, labelShare: 0, artistShare: 0, artistShareFundedByLabel: 0 });
            d.cashOut = r2(d.cashOut + x.cashOut); d.labelShare = r2(d.labelShare + x.recordsShare);
            d.artistShare = r2(d.artistShare + x.artistFunded); d.artistShareFundedByLabel = r2(d.artistShareFundedByLabel + x.artistFunded);
          } else {
            const n = (agreement.notDefined[x.currency] ??= { cashOut: 0, reasons: [] });
            n.cashOut = r2(n.cashOut + x.cashOut); if (!n.reasons.includes(x.basisHe)) n.reasons.push(x.basisHe);
          }
        }
        setClips({ totals: t, lines, agreement });
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
        // an allocation-model income appears on its owner AND on every allocated artist: the list shows it ONCE (by id),
        // under its owner; the per-artist totals never double count (gross + Records on the owner, each artist its own share)
        const seen = new Set<string>();
        results.forEach((res, i) => {
          if (!res) return;
          (Object.keys(t) as (keyof typeof t)[]).forEach((k) => { t[k] += res.totals[k]; });
          rt += res.recoupTarget; rb += res.recoupBalance; ac += res.artistCredit;
          for (const rec of res.records) {
            if (seen.has(rec.id)) continue;
            seen.add(rec.id);
            const owner = roster.find((a) => a.id === rec.primaryArtistId) ?? roster[i];
            recs.push({ ...rec, artistId: owner.id, artistName: owner.name });
          }
        });
        recs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        setMedia({ totals: t, recoupTarget: rt, recoupBalance: rb, artistCredit: ac, records: recs });
      });
  }, [artists]);
  useEffect(() => { reloadMedia(); }, [reloadMedia]);

  // Income rows: fetch /recoup per roster artist, keep each artist's result separately.
  const reloadRecoup = useCallback(() => {
    const roster = artists ?? [];
    if (roster.length === 0) { setRecoupRows([]); return; }
    Promise.all(roster.map((a) => fetch(`/api/label/artists/${a.id}/recoup`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((results: (ArtistRecoupSummary | null)[]) => {
        const rows: RecoupRow[] = [];
        results.forEach((res, i) => { if (res) rows.push({ artistId: roster[i].id, artistName: roster[i].name, summary: res }); });
        setRecoupRows(rows);
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

    // B5: released = the current stage יצא; released_at (first-release date) dates it where present.
    const released = withRel.filter((r) => r.release.releaseStage === "יצא" && r.release.releasedAt)
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

  // Top financial KPIs — LABEL P&L only. Three different numbers, never merged — the CASH Redbloods paid for clips (Finance
  // truth), the LABEL's economic share of it, and the ARTIST's share the label funded (it enters the accounting with the
  // artist — it is NOT label investment). The split is lib/records-expense-share (Owner decision 2026-09-28): one Records
  // artist 50 / 50, Shalev + Avi 50 / 25 / 25, NagashBeatz 100 % Records, a Records artist next to an external party undefined.
  // A paid clip cost with NO defined split is counted in full as a company cost and shown apart, never guessed as 50 / 50.
  // ₪ only (the P&L is ₪-only).
  const finReady = shows != null && clips != null && media != null;
  const clipCashOut = clips?.totals.byCurrency["₪"]?.actualCostPaid ?? 0;
  const clipLabelShare = clips?.agreement.defined["₪"]?.labelShare ?? 0;
  const clipArtistFunded = clips?.agreement.defined["₪"]?.artistShareFundedByLabel ?? 0;
  const clipNotAllocated = clips?.agreement.notDefined["₪"]?.cashOut ?? 0;
  const investActual = clipLabelShare + clipNotAllocated;  // the label's economic clip cost (+ unallocated cost, in full)
  const incomeActual = (shows?.totals.labelReceived ?? 0) + (media?.totals.labelShareReceived ?? 0);
  const incomeExpected = (shows?.totals.labelExpected ?? 0) + (media?.totals.labelShareExpected ?? 0);
  const balanceActual = incomeActual - investActual;         // label balance (distinct from artistActualBalance)
  const labelProjectedBalance = Math.round((balanceActual + incomeExpected + Number.EPSILON) * 100) / 100;
  const openShows = shows ? shows.lines.filter((s) => s.included && s.dealType !== "UNPAID_COLLAB" && s.paymentStatus !== "שולם").length : null;  // unpaid, non-collab
  const money = (n: number) => {
    const hasFrac = Math.abs(n % 1) > 0.001;
    return `₪${n.toLocaleString("en-US", { minimumFractionDigits: hasFrac ? 2 : 0, maximumFractionDigits: 2 })}`;
  };
  const signedMoney = (n: number) => (n < -0.001 ? "−" : "") + money(Math.abs(n));
  // per-currency display (B3): each currency on its own, never summed
  const curMoney = (n: number, c: string) => `${c}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const mapText = (m: Record<string, number>) => { const e = Object.entries(m ?? {}).filter(([, v]) => v); return e.length ? e.map(([c, v]) => curMoney(v, c)).join(" · ") : "—"; };
  const byCurText = (m: ArtistClipsSummary["totals"]["byCurrency"], k: "clientClipPrice" | "plannedBudget" | "actualCostPaid" | "rfLedgerPaid") => mapText(Object.fromEntries(Object.entries(m ?? {}).map(([c, b]) => [c, b[k]])));
  const signColor = (n: number) => (n < -0.001 ? "#F87171" : n > 0.001 ? GREEN : SUB);

  return (
    <div dir="rtl" style={{ fontFamily: "'Heebo', Arial, sans-serif", color: TEXT, padding: "26px 32px 72px", width: "100%", maxWidth: 1600, margin: "0 auto" }}>
      <style>{`
        .rb-lab-fin { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
        .rb-lab-ops { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
        .rb-lab-artists { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px; }
        .rb-lab-artist-strip { display:flex; flex-wrap:nowrap; gap:12px; overflow-x:auto; overflow-y:hidden; -webkit-overflow-scrolling:touch; padding-bottom:4px; scrollbar-width:thin; }
        .rb-lab-artist-card { flex:1 1 260px; max-width:340px; min-width:220px; scroll-snap-align:start; }
        @media (max-width:620px){ .rb-lab-artist-card{ flex:0 0 78vw; max-width:78vw; } }
        .rb-lab-money { display:grid; grid-template-columns:1fr 1fr 1.2fr; gap:14px; }
        .rb-lab-shows-kpis { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; }
        .rb-lab-bottom { display:grid; grid-template-columns:1fr 1.25fr; gap:18px; }
        .rb-lab-income-row { display:grid; grid-template-columns:1.5fr 1fr 1fr 1fr 1fr 1.2fr; gap:10px; align-items:center; min-width:680px; }
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

      {/* Artist strip — first thing after the hero: sets the context for everything below.
          Same data/links as before (roster, byArtist, ACTIVE_STAGES_SET, artist.status) —
          only the layout + visual weight changed. Horizontal-scroll flex row so it stays
          intact as the roster grows; no wrapping. */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <SectionHeader title="בחר אמן" />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setMarkOpen(true)} style={{ fontSize: 12.5, fontWeight: 700, color: SUB, background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`, borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" }}>סמן פרויקט כלייבל</button>
            <button onClick={() => setCreateOpen(true)} style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: BRAND, border: "none", borderRadius: 9, padding: "8px 16px", cursor: "pointer", fontFamily: "inherit" }}>+ ריליס חדש</button>
          </div>
        </div>
        <div className="rb-lab-artist-strip">
          {busy ? (
            <span style={{ fontSize: 13, color: MUTED, padding: "22px 4px" }}>טוען…</span>
          ) : (
            <>
              {d.roster.map((artist) => {
                const sc = ARTIST_STATUS_COLOR[artist.status];
                const isActive = artist.status === "פעיל";
                return (
                  <Link key={artist.id} href={`/label/artists/${artist.id}`} title="פתח עמוד אמן" className="rb-lab-artist-card" style={{
                    position: "relative", display: "flex", alignItems: "center", gap: 14, textDecoration: "none",
                    background: CARD, borderRadius: 20, padding: "18px 20px",
                    border: `1px solid ${isActive ? "rgba(220,38,38,0.55)" : BORDER}`,
                    boxShadow: isActive ? "0 0 0 1px rgba(220,38,38,0.28), 0 0 30px rgba(220,38,38,0.24)" : "none",
                  }}>
                    {isActive && (
                      <span style={{
                        position: "absolute", top: 10, insetInlineStart: 10, width: 20, height: 20, borderRadius: "50%",
                        background: BRAND, color: "#fff", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 0 10px rgba(220,38,38,0.6)",
                      }}>✓</span>
                    )}
                    <ArtistAvatar artist={artist} size={60} glow={isActive} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                      <span style={{ fontSize: 16, fontWeight: 900, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artist.name}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: sc, display: "flex", alignItems: "center", gap: 5 }}>● {artist.status}</span>
                    </div>
                  </Link>
                );
              })}
              <button onClick={() => setAddArtistOpen(true)} type="button" className="rb-lab-artist-card" style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                background: "rgba(255,255,255,0.02)", border: `1px dashed ${BORDER}`, borderRadius: 20, padding: "18px 20px",
                cursor: "pointer", fontFamily: "inherit", minHeight: 96,
              }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: BRAND, lineHeight: 1 }}>+</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: SUB }}>הוסף אמן ללייבל</span>
              </button>
            </>
          )}
        </div>
      </div>

      {state === "error" && <Card style={{ marginBottom: 20 }}><div style={{ color: "#F87171", textAlign: "center", padding: "10px 0", fontSize: 14 }}>שגיאה בטעינת נתוני הלייבל.</div></Card>}

      {/* Financial KPIs — LABEL P&L only. Primary = actual label balance (the headline). */}
      <div className="rb-lab-fin" style={{ marginBottom: 12 }}>
        {/* 1 · Primary — actual label balance (emphasized: sign-colored border + largest number) */}
        <div style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0))", border: `1px solid ${!finReady ? BORDER : balanceActual < -0.001 ? "rgba(248,113,113,0.4)" : balanceActual > 0.001 ? "rgba(52,211,153,0.4)" : BORDER}`, borderRadius: 18, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: SUB }}>מאזן הלייבל בפועל</span>
          <span style={{ fontSize: 38, fontWeight: 900, color: finReady ? signColor(balanceActual) : TEXT, letterSpacing: "-0.02em", lineHeight: 1.05, direction: "ltr", textAlign: "right" }}>{finReady ? signedMoney(balanceActual) : "…"}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: finReady ? signColor(balanceActual) : MUTED }}>הכנסות הלייבל שהתקבלו פחות חלק הלייבל בעלות הקליפים (₪)</span>
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

      {/* Clip money — cash out ≠ label share ≠ artist share funded by the label (Owner decision 2026-09-27) */}
      {finReady && (clipCashOut > 0 || clipNotAllocated > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: 12.5, fontWeight: 700, color: SUB, margin: "-2px 4px 14px" }}>
          <span>עלות קליפים ששולמה בפועל: <b style={{ color: TEXT }}>{money(clipCashOut)}</b></span>
          <span>חלק הלייבל: <b style={{ color: TEXT }}>{money(clipLabelShare)}</b></span>
          <span>חלק האמן שמומן ע״י הלייבל (בהתחשבנות מול האמן): <b style={{ color: "#F59E0B" }}>{money(clipArtistFunded)}</b></span>
          {clipNotAllocated > 0 && <span>ללא חלוקה מוגדרת — דורש החלטת בעלים (נספר במלואו כעלות חברה): <b style={{ color: "#F87171" }}>{money(clipNotAllocated)}</b></span>}
        </div>
      )}

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

              {(shows.otherCurrencies?.length ?? 0) > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#F59E0B", fontWeight: 700 }}>⚠ הסכומים למעלה ב-₪ בלבד — הופעות ב-{shows.otherCurrencies!.join(" / ")} מוצגות ברשימה במטבע שלהן ולא נוספות לסכום</div>
              )}

              {shows.lines.length === 0 ? (
                <div style={{ marginTop: 16, color: MUTED, textAlign: "center", padding: "10px 0", fontSize: 13.5 }}>אין הופעות משויכות לאמני הלייבל.</div>
              ) : (
                <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                  {shows.lines.map((s) => {
                    const paid = s.paymentStatus === "שולם";           // the CLIENT paid
                    const artistPaid = s.artistFeeStatus === "שולם";   // A1: the artist's own fee row
                    const cur = s.currency || "₪";
                    return (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, background: CARD2, border: `1px solid ${BORDER2}`, borderRadius: 12, padding: "11px 14px", flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>{s.name}</div>
                          <div style={{ fontSize: 11.5, color: MUTED }}>{s.artistName} · {fmtDate(s.date)}</div>
                        </div>
                        {s.dealType === "UNPAID_COLLAB" ? (
                          // deal type (NOT a payment status): no client payment, no label / artist money — "שת״פ" and "—"
                          <>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#F472B6", background: "rgba(236,72,153,0.12)", border: "1px solid rgba(236,72,153,0.3)", borderRadius: 100, padding: "3px 10px" }}>שת״פ</span>
                            <div style={{ fontSize: 15, fontWeight: 900, color: SUB, minWidth: 84, textAlign: "left" }}>—</div>
                          </>
                        ) : s.included ? (
                          <>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: paid ? GREEN : "#F59E0B", background: paid ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.12)", border: `1px solid ${paid ? "rgba(52,211,153,0.3)" : "rgba(245,158,11,0.3)"}`, borderRadius: 100, padding: "3px 10px" }}>לקוח: {s.paymentStatus}</span>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: artistPaid ? GREEN : SUB, background: artistPaid ? "rgba(52,211,153,0.12)" : "transparent", border: `1px solid ${artistPaid ? "rgba(52,211,153,0.3)" : BORDER2}`, borderRadius: 100, padding: "3px 10px" }}>אמן: {artistPaid ? "שולם" : (s.artistFeeStatus ?? "—")}</span>
                            <div style={{ display: "flex", gap: 18, textAlign: "left" }}>
                              <div style={{ minWidth: 84 }}>
                                <div style={{ fontSize: 10, color: DIM }}>רווח לייבל</div>
                                <div style={{ fontSize: 15, fontWeight: 900, color: paid ? GREEN : SUB }}>{cur}{Math.round(s.labelProfit).toLocaleString()}</div>
                              </div>
                              <div style={{ minWidth: 84 }}>
                                <div style={{ fontSize: 10, color: DIM }}>רווח אמן</div>
                                <div style={{ fontSize: 15, fontWeight: 900, color: artistPaid ? GREEN : SUB }}>{cur}{Math.round(s.artistFee).toLocaleString()}</div>
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

      {/* Clips — A / B / C per currency (B3); recoup NOT_DEFINED */}
      <div style={{ marginBottom: 20 }}>
        <SectionHeader title="קליפים" />
        <Card>
          {!clips ? (
            <div style={{ color: MUTED, textAlign: "center", padding: "18px 0" }}>טוען…</div>
          ) : clips.lines.length === 0 ? (
            <div style={{ color: MUTED, textAlign: "center", padding: "22px 0", fontSize: 13.5, lineHeight: 1.7 }}>אין הפקות קליפ פעילות משויכות לאמני הלייבל.<br />תקציב קליפ מנוהל בעמוד Red Films.</div>
          ) : (
            <>
              {/* Four separate layers per currency — never added together (B3). */}
              <div className="rb-lab-shows-kpis">
                {[
                  { t: "מחיר קליפ ללקוח", disp: byCurText(clips.totals.byCurrency, "clientClipPrice"), c: SUB },
                  { t: "תקציב מתוכנן", disp: byCurText(clips.totals.byCurrency, "plannedBudget"), c: "#60A5FA" },
                  { t: "עלות בפועל (כספים, שולם)", disp: byCurText(clips.totals.byCurrency, "actualCostPaid"), c: "#F87171" },
                  { t: "פנקס Red Films — עדיין לא בכספים", disp: byCurText(clips.totals.byCurrency, "rfLedgerPaid"), c: "#F59E0B" },
                  { t: "קיזוז מהאמן", disp: "לא נקבע", c: MUTED },
                ].map((b) => (
                  <div key={b.t} style={{ background: CARD2, border: `1px solid ${BORDER2}`, borderRadius: 16, padding: "16px 16px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: b.c, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.t}</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: TEXT, marginTop: 8 }}>{b.disp}</div>
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
                      <div style={{ minWidth: 78 }}><div style={{ fontSize: 10, color: DIM }}>מחיר ללקוח</div><div style={{ fontSize: 14, fontWeight: 800, color: SUB }}>{c.clientClipPrice != null ? curMoney(c.clientClipPrice, c.clientClipCurrency ?? "₪") : "—"}</div></div>
                      <div style={{ minWidth: 78 }}><div style={{ fontSize: 10, color: DIM }}>תקציב (תכנון)</div><div style={{ fontSize: 14, fontWeight: 800, color: "#60A5FA" }}>{curMoney(c.plannedBudget, c.currency)}</div></div>
                      <div style={{ minWidth: 78 }}><div style={{ fontSize: 10, color: DIM }}>עלות בפועל</div><div style={{ fontSize: 14, fontWeight: 900, color: "#F87171" }}>{mapText(c.actualCostPaid)}</div></div>
                      <div style={{ minWidth: 78 }}><div style={{ fontSize: 10, color: DIM }}>פנקס Red Films</div><div style={{ fontSize: 14, fontWeight: 800, color: "#F59E0B" }}>{mapText(c.rfLedgerPaid)}</div></div>
                      <div style={{ minWidth: 78 }}><div style={{ fontSize: 10, color: DIM }}>קיזוז מהאמן</div><div style={{ fontSize: 14, fontWeight: 800, color: MUTED }} title={c.recoupReasonHe}>לא נקבע</div></div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>מחיר ללקוח ≠ תקציב מתוכנן ≠ עלות בפועל ≠ קיזוז מהאמן — כל אחד לפי מטבע, בלי חיבור. קיזוז מהאמן: לא נקבע — חסר כלל חוזה: אילו הוצאות קליפ מתקזזות מול האמן. תשלום Red Films שמקושר לכספים כבר כלול ב"עלות בפועל"; כאן מוצגים רק תשלומים שעדיין לא קושרו — אף סכום לא נספר פעמיים.</div>
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
                  { l: "קוזז ברשומות ישנות (כלל שבוטל)", v: media.totals.recoupedTotal, c: "#F59E0B" },
                  { l: "לתשלום לאמן לפי הרשומות", v: media.totals.artistPayableTotal, c: SUB },
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
                          {r.allocationModel && r.recordType === "income" && (
                            <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>
                              {r.incomeKind === "YOUTUBE" ? "YouTube" : r.incomeKind === "ACUM" ? "אקו״ם" : "הפצה"} · כספים: {r.financeTransactionId ? "תנועה אחת" : "—"}
                              {r.allocations.filter((a) => a.status === "active").map((a) => <span key={a.id}> · {d.roster.find((x) => x.id === a.artistId)?.name ?? "אמן"} {a.pct}% = {money(a.amount)}</span>)}
                              {r.allocations.every((a) => a.status !== "active") && <span> · 100% Records</span>}
                            </div>
                          )}
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

      {/* Artist income + debt — three tabs. Generic column-spec renderer per tab so the
          three share one markup. All values already per-artist capped; totals just sum
          each column (no re-cap, no cross-artist mixing). */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {([
            { k: "actual", l: "מאזן אמן בפועל" },
            { k: "expected", l: "מאזן אמן צפוי" },
            { k: "debt", l: "חוב האמן ללייבל" },
          ] as const).map((t) => {
            const on = bottomTab === t.k;
            return (
              <button key={t.k} onClick={() => setBottomTab(t.k)} style={{ fontSize: 13.5, fontWeight: 800, borderRadius: 10, padding: "9px 18px", cursor: "pointer", fontFamily: "inherit", color: on ? "#fff" : SUB, background: on ? BRAND : "rgba(255,255,255,0.04)", border: `1px solid ${on ? BRAND : BORDER}` }}>{t.l}</button>
            );
          })}
        </div>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {!recoupRows ? (
            <div style={{ color: MUTED, textAlign: "center", padding: "22px 0" }}>טוען…</div>
          ) : recoupRows.length === 0 ? (
            <div style={{ color: MUTED, textAlign: "center", padding: "26px 0", fontSize: 13.5 }}>אין אמני לייבל להצגה.</div>
          ) : (() => {
            const NEU = SUB, ORANGE = "#F59E0B", RED = "#F87171";
            // B3: a debt figure is null while the clip recoup is NOT_DEFINED → "לא נקבע" (never a guessed 0).
            type Col = { header: string; get: (s: ArtistRecoupSummary) => number | null; color: (v: number) => string; fmt: (v: number) => string; strong?: boolean };
            const show = (c: Col, v: number | null) => (v === null ? "לא נקבע" : c.fmt(v));
            const tint = (c: Col, v: number | null) => (v === null ? MUTED : c.color(v));
            const colsByTab: Record<typeof bottomTab, Col[]> = {
              actual: [
                { header: "הופעות", get: (s) => s.showsArtistPaid, color: () => NEU, fmt: money },
                { header: "מדיה", get: (s) => s.mediaArtistShareReceived, color: () => NEU, fmt: money },
                { header: "סה״כ", get: (s) => s.actualArtistIncome, color: () => GREEN, fmt: money, strong: true },
                { header: "קיזוז בפועל", get: (s) => s.actualRecouped, color: () => ORANGE, fmt: money },
                { header: "יתרה אחרי קיזוז", get: (s) => s.artistActualBalance, color: signColor, fmt: signedMoney, strong: true },
              ],
              expected: [
                { header: "הופעות (צפוי)", get: (s) => s.showsArtistExpected, color: () => NEU, fmt: money },
                { header: "מדיה (צפוי)", get: (s) => s.mediaExpectedArtistShare, color: () => NEU, fmt: money },
                { header: "סה״כ", get: (s) => s.expectedArtistIncome, color: () => ORANGE, fmt: money, strong: true },
                { header: "קיזוז צפוי", get: (s) => s.projectedRecoup, color: () => ORANGE, fmt: money },
                // Signed balance derived from existing fields (NOT projectedRecoupBalance):
                { header: "יתרה צפויה אחרי קיזוז", get: (s) => (s.artistActualBalance === null ? null : s.artistActualBalance + s.expectedArtistIncome), color: signColor, fmt: signedMoney, strong: true },
              ],
              debt: [
                { header: "חוב התחלתי", get: (s) => s.clipRecoupTarget, color: () => NEU, fmt: money },
                { header: "קוזז בפועל", get: (s) => s.actualRecouped, color: () => ORANGE, fmt: money },
                { header: "חוב נוכחי", get: (s) => s.actualRecoupBalance, color: () => RED, fmt: money, strong: true },
                { header: "צפוי להתקזז", get: (s) => s.projectedRecoup, color: () => ORANGE, fmt: money },
                { header: "חוב צפוי", get: (s) => s.projectedRecoupBalance, color: (v) => (v > 0.001 ? RED : NEU), fmt: money, strong: true },
              ],
            };
            const cols = colsByTab[bottomTab];
            const totals = cols.map((c) => recoupRows.reduce<number | null>((a, r) => { const v = c.get(r.summary); return a === null || v === null ? null : a + v; }, 0));
            const cell: React.CSSProperties = { fontSize: 13, textAlign: "left", direction: "ltr" };
            const hdr: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, color: DIM, letterSpacing: "0.05em", textAlign: "left" };
            return (
              <div style={{ overflowX: "auto" }}>
                <div className="rb-lab-income-row" style={{ padding: "12px 18px", borderBottom: `1px solid ${BORDER2}` }}>
                  <span style={{ ...hdr, textAlign: "right" }}>אמן</span>
                  {cols.map((c) => <span key={c.header} style={hdr}>{c.header}</span>)}
                </div>
                {recoupRows.map((r, i) => (
                  <div key={r.artistId} className="rb-lab-income-row" style={{ padding: "13px 18px", background: i % 2 ? "rgba(255,255,255,0.012)" : "transparent", borderBottom: `1px solid ${BORDER2}` }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.artistName}</span>
                    {cols.map((c) => { const v = c.get(r.summary); return <span key={c.header} title={v === null ? r.summary.clipRecoupReasonHe ?? undefined : undefined} style={{ ...cell, fontWeight: c.strong ? 900 : 800, color: tint(c, v) }}>{show(c, v)}</span>; })}
                  </div>
                ))}
                <div className="rb-lab-income-row" style={{ padding: "13px 18px", background: "rgba(255,255,255,0.02)" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 900, color: TEXT }}>סה״כ כל האמנים</span>
                  {cols.map((c, ci) => { const v = totals[ci]; return <span key={c.header} style={{ ...cell, fontSize: c.strong ? 15 : 13, fontWeight: 900, color: tint(c, v) }}>{show(c, v)}</span>; })}
                </div>
              </div>
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
                    <button key={r.projectId} onClick={() => setEditItem(r)} style={{ textAlign: "right", background: CARD2, border: `1px solid ${r.release.blocker.trim() ? "rgba(248,113,113,0.3)" : BORDER}`, borderRadius: 13, padding: "12px 14px", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <ProjectCover projectId={r.projectId} name={r.name} cover={r.cover} size={46} mobileSize={40} />
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
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
                    <button key={r.projectId} onClick={() => setEditItem(r)} style={{ width: "100%", textAlign: "right", display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 0.9fr", gap: 8, alignItems: "center", padding: "10px 18px", background: i % 2 ? "rgba(255,255,255,0.012)" : "transparent", border: "none", borderBottom: i === d.upcoming.length - 1 ? "none" : `1px solid ${BORDER2}`, cursor: "pointer", fontFamily: "inherit" }}>
                      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 11 }}>
                        <ProjectCover projectId={r.projectId} name={r.name} cover={r.cover} size={44} mobileSize={38} />
                        <div style={{ minWidth: 0 }}>
                          <div dir="auto" style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                          <div dir="auto" style={{ fontSize: 11.5, color: MUTED, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.artist}</div>
                        </div>
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
      {markOpen && <MarkExistingModal artists={d.roster} releasedProjectIds={releasedProjectIds} onClose={() => setMarkOpen(false)} onSaved={reload} />}
      {editItem && editItem.release && <EditReleaseModal item={editItem} onClose={() => setEditItem(null)} onSaved={reload} />}

      {mediaCreate && <MediaModal artists={d.roster} mode="create" onClose={() => setMediaCreate(false)} onSaved={onMediaSaved} />}
      {mediaEdit && <MediaModal artists={d.roster} mode="edit" record={mediaEdit} onClose={() => setMediaEdit(null)} onSaved={onMediaSaved} />}
      {mediaCancel && <MediaCancelModal record={mediaCancel} onClose={() => setMediaCancel(null)} onSaved={onMediaSaved} />}
    </div>
  );
}
