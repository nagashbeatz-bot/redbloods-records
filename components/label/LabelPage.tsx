"use client";

// ── ניהול הלייבל (/label) — owner-only label management dashboard ─────────────
// Artists come ONLY from the label_artists roster (GET /api/label/artists).
// Releases (GET /api/label/releases) are grouped under each artist by
// release.labelArtistId — NEVER by projects.artist. Money is an honest
// "not connected" placeholder (finance attribution deferred).

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import type { LabelArtist, LabelRelease, ProjectReleaseDetails, LabelShowLine, ArtistShowsSummary } from "@/lib/types";
import {
  BRAND, CARD, CARD2, BORDER, BORDER2, TEXT, SUB, MUTED, DIM, GREEN,
  STAGE_COLOR, ARTIST_STATUS_COLOR, todayYmd, fmtDate, daysUntil, daysBetween, ACTIVE_STAGES_SET,
  StatCard, StageBadge, SectionHeader, Card, ArtistAvatar,
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

  // Shows-only label finance: fetch per roster artist and aggregate. Money is
  // derived server-side via computeShowSplit only — transactions are never summed.
  useEffect(() => {
    const roster = artists ?? [];
    const empty = { labelReceived: 0, labelExpected: 0, artistPaid: 0, artistExpected: 0, djPaid: 0, djExpected: 0, count: 0, needsAttribution: 0 };
    if (roster.length === 0) { setShows({ totals: empty, lines: [] }); return; }
    let alive = true;
    Promise.all(roster.map((a) => fetch(`/api/label/artists/${a.id}/shows`).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
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

  return (
    <div dir="rtl" style={{ fontFamily: "'Heebo', Arial, sans-serif", color: TEXT, padding: "26px 32px 72px", width: "100%", maxWidth: 1600, margin: "0 auto" }}>
      <style>{`
        .rb-lab-kpis { display:grid; grid-template-columns:repeat(6,1fr); gap:14px; }
        .rb-lab-artists { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px; }
        .rb-lab-money { display:grid; grid-template-columns:1fr 1fr 1.2fr; gap:14px; }
        .rb-lab-shows-kpis { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; }
        .rb-lab-bottom { display:grid; grid-template-columns:1fr 1.25fr; gap:18px; }
        @media (max-width:1180px){ .rb-lab-kpis{ grid-template-columns:repeat(3,1fr);} .rb-lab-shows-kpis{ grid-template-columns:repeat(3,1fr);} }
        @media (max-width:1000px){ .rb-lab-money{ grid-template-columns:1fr;} .rb-lab-bottom{ grid-template-columns:1fr;} }
        @media (max-width:620px){ .rb-lab-shows-kpis{ grid-template-columns:repeat(2,1fr);} }
        @media (max-width:620px){ .rb-lab-kpis{ grid-template-columns:repeat(2,1fr);} .rb-lab-artists{ grid-template-columns:1fr;} }
      `}</style>

      {/* Hero */}
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 24, border: `1px solid ${BORDER}`, background: "radial-gradient(120% 140% at 50% -20%, rgba(220,38,38,0.28) 0%, rgba(220,38,38,0.06) 38%, rgba(13,13,13,0) 70%), linear-gradient(180deg,#171012,#121212)", padding: "34px 28px 30px", textAlign: "center", marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 8 }}>
          <h1 style={{ fontSize: 32, fontWeight: 900, color: "#fff", margin: 0, letterSpacing: "-0.02em", textShadow: "0 1px 12px rgba(0,0,0,0.5)" }}>ניהול הלייבל</h1>
          <span style={{ fontSize: 26, filter: "drop-shadow(0 0 12px rgba(220,38,38,0.7))" }}>🎯</span>
        </div>
        <div style={{ fontSize: 14.5, color: "#C9C9C9" }}>סקירה כוללת של אמני הלייבל, הריליסים והפעולות שדורשות טיפול</div>
      </div>

      {state === "error" && <Card style={{ marginBottom: 20 }}><div style={{ color: "#F87171", textAlign: "center", padding: "10px 0", fontSize: 14 }}>שגיאה בטעינת נתוני הלייבל.</div></Card>}

      {/* KPIs */}
      <div className="rb-lab-kpis" style={{ marginBottom: 26 }}>
        <StatCard label="אמני לייבל" value={busy ? "…" : d.roster.length} sub="ברשימת הלייבל" icon="🎤" />
        <StatCard label="ריליסים בצינור" value={busy ? "…" : d.active.length} sub={`${d.upcomingSoon.length} עם תאריך קרוב`} icon="💿" />
        <StatCard label="ריליסים קרובים" value={busy ? "…" : d.upcomingSoon.length} sub="עם תאריך יציאה" icon="🗓" />
        <StatCard label="השקעות החודש" value="—" sub="טרם חובר" subColor={DIM} icon="₪" />
        <StatCard label="הכנסות החודש" value="—" sub="טרם חובר" subColor={DIM} icon="₪" />
        <StatCard label="מאזן נטו" value="—" sub="טרם חובר" subColor={DIM} icon="⚖" />
      </div>

      {/* Artists */}
      <div style={{ marginBottom: 30 }}>
        <SectionHeader title="אמני הלייבל" action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setAddArtistOpen(true)} style={{ fontSize: 12.5, fontWeight: 700, color: SUB, background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`, borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" }}>+ אמן לייבל</button>
            <button onClick={() => setMarkOpen(true)} style={{ fontSize: 12.5, fontWeight: 700, color: SUB, background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`, borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" }}>סמן פרויקט כלייבל</button>
            <button onClick={() => setCreateOpen(true)} style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: BRAND, border: "none", borderRadius: 9, padding: "8px 16px", cursor: "pointer", fontFamily: "inherit" }}>+ ריליס חדש</button>
          </div>
        } />
        {busy ? (
          <Card><div style={{ color: MUTED, textAlign: "center", padding: "22px 0" }}>טוען…</div></Card>
        ) : d.roster.length === 0 ? (
          <Card><div style={{ color: MUTED, textAlign: "center", padding: "26px 0", fontSize: 14, lineHeight: 1.7 }}>אין עדיין אמני לייבל.<br />הוסף אמן לייבל כדי להתחיל לנהל את הריליסים שלו.</div></Card>
        ) : (
          <div className="rb-lab-artists">
            {d.roster.map((artist) => {
              const rels = d.byArtist.get(artist.id) ?? [];
              const activeRels = rels.filter((r) => ACTIVE_STAGES_SET.has(r.release.releaseStage));
              const next = activeRels.filter((r) => r.release.releaseTargetDate).sort((a, b) => (a.release.releaseTargetDate! < b.release.releaseTargetDate! ? -1 : 1))[0] ?? activeRels[0] ?? null;
              const sc = ARTIST_STATUS_COLOR[artist.status];
              return (
                <div key={artist.id} style={{ background: "linear-gradient(160deg,#1B1414 0%,#151515 60%)", border: `1px solid ${next ? "rgba(220,38,38,0.30)" : BORDER}`, borderRadius: 22, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <ArtistAvatar artist={artist} size={76} glow />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 19, fontWeight: 900, color: TEXT, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artist.name}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: sc, marginTop: 4 }}>● {artist.status}</div>
                      <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{activeRels.length} ריליסים בצינור</div>
                    </div>
                  </div>

                  <div style={{ background: CARD2, borderRadius: 14, padding: "13px 15px", border: `1px solid ${BORDER2}` }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: DIM, letterSpacing: "0.06em", marginBottom: 8 }}>הריליס הבא</div>
                    {next ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{next.name}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <StageBadge stage={next.release.releaseStage} small />
                          <span style={{ fontSize: 12, fontWeight: 700, color: SUB }}>{fmtDate(next.release.releaseTargetDate)}</span>
                        </div>
                      </div>
                    ) : <div style={{ fontSize: 13, color: MUTED }}>אין ריליס פעיל</div>}
                  </div>

                  <Link href={`/label/artists/${artist.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13.5, fontWeight: 800, color: "#fff", background: BRAND, borderRadius: 12, padding: "11px 0", textDecoration: "none" }}>פתח עמוד אמן ←</Link>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Shows — real label finance (computeShowSplit only; no double count) */}
      <div style={{ marginBottom: 30 }}>
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

      {/* Investments (production / clips / media) — not connected yet */}
      <div style={{ marginBottom: 30 }}>
        <SectionHeader title="השקעות (הפקה · קליפים · מדיה)" />
        <Card style={{ padding: "22px 24px" }}>
          <div style={{ fontSize: 13, color: MUTED, textAlign: "center", lineHeight: 1.7 }}>הפקה, קליפים ומדיה <b style={{ color: SUB }}>טרם חוברו למקור נתונים</b> — בשלב זה מחוברות רק הכנסות מהופעות.</div>
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
    </div>
  );
}
