"use client";

// ── דף אמן (/label/artists/[id]) — one label artist + all their releases ──────

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import type { LabelArtist, LabelRelease, ProjectReleaseDetails } from "@/lib/types";
import {
  BRAND, CARD, CARD2, BORDER, BORDER2, TEXT, SUB, MUTED, DIM,
  ARTIST_STATUS_COLOR, fmtDate, daysUntil, daysInStage, ACTIVE_STAGES_SET,
  StageBadge, SectionHeader, Card, ArtistAvatar,
  CreateReleaseModal, EditReleaseModal,
} from "./labelShared";

type WithRelease = LabelRelease & { release: ProjectReleaseDetails };

export default function ArtistPage({ artistId }: { artistId: string }) {
  const [artist, setArtist] = useState<LabelArtist | null>(null);
  const [releases, setReleases] = useState<LabelRelease[] | null>(null);
  const [state, setState] = useState<"loading" | "error" | "notfound" | "ready">("loading");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<LabelRelease | null>(null);

  const reload = useCallback(() => {
    fetch(`/api/label/artists/${artistId}`).then(async (r) => {
      if (r.status === 404) { setState("notfound"); return; }
      if (!r.ok) throw new Error();
      const d = await r.json();
      setArtist(d.artist); setReleases(Array.isArray(d.releases) ? d.releases : []); setState("ready");
    }).catch(() => setState("error"));
  }, [artistId]);
  useEffect(() => { reload(); }, [reload]);

  const d = useMemo(() => {
    const rels = (releases ?? []).filter((r): r is WithRelease => !!r.release);
    const active = rels.filter((r) => ACTIVE_STAGES_SET.has(r.release.releaseStage));
    const next = active.filter((r) => r.release.releaseTargetDate).sort((a, b) => (a.release.releaseTargetDate! < b.release.releaseTargetDate! ? -1 : 1))[0] ?? active[0] ?? null;
    const sorted = [...rels].sort((a, b) => {
      const ad = a.release.releaseTargetDate, bd = b.release.releaseTargetDate;
      if (ad && bd) return ad < bd ? -1 : 1;
      if (ad) return -1; if (bd) return 1;
      return a.release.stageEnteredAt < b.release.stageEnteredAt ? -1 : 1;
    });
    return { rels, active, next, sorted };
  }, [releases]);

  const wrap: React.CSSProperties = { fontFamily: "'Heebo', Arial, sans-serif", color: TEXT, padding: "26px 32px 72px", width: "100%", maxWidth: 1200, margin: "0 auto" };

  if (state === "loading") return <div dir="rtl" style={wrap}><div style={{ color: MUTED, textAlign: "center", padding: "40px 0" }}>טוען…</div></div>;
  if (state === "notfound") return <div dir="rtl" style={wrap}><Link href="/label" style={{ color: BRAND, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>← חזרה לניהול הלייבל</Link><Card style={{ marginTop: 18 }}><div style={{ color: MUTED, textAlign: "center", padding: "24px 0" }}>האמן לא נמצא.</div></Card></div>;
  if (state === "error" || !artist) return <div dir="rtl" style={wrap}><Link href="/label" style={{ color: BRAND, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>← חזרה לניהול הלייבל</Link><Card style={{ marginTop: 18 }}><div style={{ color: "#F87171", textAlign: "center", padding: "24px 0" }}>שגיאה בטעינת האמן.</div></Card></div>;

  const sc = ARTIST_STATUS_COLOR[artist.status];

  return (
    <div dir="rtl" style={wrap}>
      <style>{`
        .rb-art-rel { display:grid; grid-template-columns:1.4fr 0.9fr 0.9fr 1.4fr; gap:12px; align-items:center; }
        @media (max-width:760px){ .rb-art-rel { grid-template-columns:1fr; gap:6px; } }
      `}</style>

      <Link href="/label" style={{ color: BRAND, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>← חזרה לניהול הלייבל</Link>

      {/* Profile */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 16, marginBottom: 24, background: "radial-gradient(120% 180% at 15% -30%, rgba(220,38,38,0.22) 0%, rgba(13,13,13,0) 60%), linear-gradient(180deg,#171012,#121212)", border: `1px solid ${BORDER}`, borderRadius: 22, padding: "24px 26px" }}>
        <ArtistAvatar artist={artist} size={84} glow />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em" }}>{artist.name}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: sc, marginTop: 4 }}>● {artist.status}</div>
          <div style={{ fontSize: 12.5, color: SUB, marginTop: 6 }}>{d.active.length} ריליסים בצינור · {d.rels.length} סה״כ</div>
        </div>
        <button onClick={() => setCreateOpen(true)} style={{ fontSize: 13, fontWeight: 800, color: "#fff", background: BRAND, border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>+ ריליס חדש</button>
      </div>

      {/* Next release */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader title="הריליס הבא" />
        <Card>
          {d.next ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 900, color: TEXT, marginBottom: 8 }}>{d.next.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <StageBadge stage={d.next.release.releaseStage} />
                  <span style={{ fontSize: 12.5, color: SUB }}>תאריך יעד: <b style={{ color: TEXT }}>{fmtDate(d.next.release.releaseTargetDate)}</b></span>
                  <span style={{ fontSize: 12.5, color: SUB }}>{daysInStage(d.next.release.stageEnteredAt)} ימים בשלב</span>
                </div>
              </div>
              <button onClick={() => setEditItem(d.next!)} style={{ fontSize: 12.5, fontWeight: 700, color: SUB, background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`, borderRadius: 9, padding: "8px 15px", cursor: "pointer", fontFamily: "inherit" }}>עריכה</button>
            </div>
          ) : <div style={{ color: MUTED, textAlign: "center", padding: "10px 0" }}>אין ריליס פעיל כרגע.</div>}
        </Card>
      </div>

      {/* All releases */}
      <div>
        <SectionHeader title="כל הריליסים" />
        {d.sorted.length === 0 ? (
          <Card><div style={{ color: MUTED, textAlign: "center", padding: "24px 0", fontSize: 14, lineHeight: 1.7 }}>אין עדיין ריליסים לאמן זה.<br />צור ריליס חדש כדי להתחיל.</div></Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {d.sorted.map((r) => {
              const rel = r.release; const du = daysUntil(rel.releaseTargetDate);
              return (
                <button key={r.projectId} onClick={() => setEditItem(r)} style={{ textAlign: "right", background: CARD, border: `1px solid ${rel.blocker.trim() ? "rgba(248,113,113,0.28)" : BORDER}`, borderRadius: 16, padding: "16px 18px", cursor: "pointer", fontFamily: "inherit" }}>
                  <div className="rb-art-rel">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{daysInStage(rel.stageEnteredAt)} ימים בשלב</div>
                    </div>
                    <div><StageBadge stage={rel.releaseStage} small /></div>
                    <div style={{ fontSize: 12.5, color: SUB }}>
                      {fmtDate(rel.releaseTargetDate)}
                      {du != null && <span style={{ color: du < 0 ? "#F59E0B" : MUTED, fontWeight: 700 }}>{du < 0 ? ` · ${Math.abs(du)} באיחור` : du === 0 ? " · היום" : ` · בעוד ${du}`}</span>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                      {rel.nextAction.trim() && <span style={{ fontSize: 12.5, color: "#E5E5E5", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>▸ {rel.nextAction}</span>}
                      {rel.blocker.trim() && <span style={{ fontSize: 11.5, color: "#F87171", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>⛔ {rel.blocker}</span>}
                      {rel.responsible.trim() && <span style={{ fontSize: 11.5, color: MUTED }}>אחראי: {rel.responsible}</span>}
                      {!rel.nextAction.trim() && !rel.blocker.trim() && !rel.responsible.trim() && <span style={{ fontSize: 11.5, color: DIM }}>—</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {createOpen && <CreateReleaseModal artists={[artist]} lockedArtistId={artist.id} onClose={() => setCreateOpen(false)} onSaved={reload} />}
      {editItem && editItem.release && <EditReleaseModal item={editItem} onClose={() => setEditItem(null)} onSaved={reload} />}
    </div>
  );
}
