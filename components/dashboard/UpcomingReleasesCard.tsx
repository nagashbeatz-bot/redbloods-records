"use client";

// Dashboard card "ריליסים קרובים" — up to 3 releases, soonest first (a release whose
// date already passed but isn't "יצא" leads, in red). Display-only: data comes from
// GET /api/label/releases via the parent; a row click opens the existing
// EditReleaseModal from /label, and "+ הוסף ריליס" opens AddReleaseModal (the
// 2-step create flow, which reuses /label's own mutation). No writes of its own.

import { useState } from "react";
import Link from "next/link";
import type { LabelRelease } from "@/lib/types";
import {
  releaseDaysText, releaseShortDate,
  type ReleaseDisplayStatus, type ReleaseLineKind, type UpcomingReleaseRow,
} from "@/lib/dashboard-releases";
import AddReleaseModal from "@/components/dashboard/AddReleaseModal";
import ProjectCover from "@/components/ui/ProjectCover";
import { EditReleaseModal, BRAND, CARD, CARD2, BORDER, BORDER2, TEXT, SUB, MUTED } from "@/components/label/labelShared";

const MAX_ROWS = 3;
const RED = "#EF4444";
const AMBER = "#F59E0B";
const GREEN = "#34D399";

const STATUS_COLOR: Record<ReleaseDisplayStatus, string> = {
  "בעבודה": "#3B82F6",
  "בהכנה לריליס": AMBER,
  "מתוזמן": "#9CA3AF",
};

function lineColor(kind: ReleaseLineKind, urgent: boolean): string {
  if (kind === "ready") return GREEN;
  if (kind === "missing") return urgent ? "#F87171" : AMBER;
  return SUB;
}

export default function UpcomingReleasesCard({ rows, state, onReload }: {
  rows: UpcomingReleaseRow[];
  state: "loading" | "error" | "ok";
  onReload: () => void | Promise<void>;
}) {
  const [editItem, setEditItem] = useState<LabelRelease | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const shown = rows.slice(0, MAX_ROWS);

  return (
    <div className="rb-urc" style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18,
      overflow: "hidden",
      boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
        padding: "18px 22px 14px", borderBottom: `1px solid rgba(255,255,255,0.07)`,
        background: "rgba(255,255,255,0.015)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🎵</span>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: "#F0F0F0" }}>ריליסים קרובים</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" onClick={() => setAddOpen(true)} style={{
            fontSize: 11, fontWeight: 800, fontFamily: "inherit", cursor: "pointer",
            padding: "4px 11px", borderRadius: 99, color: "#F87171",
            background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)",
          }}>+ הוסף ריליס</button>
          <Link href="/label" style={{ fontSize: 11, color: "#3B82F6", textDecoration: "none" }}>הצג הכל ←</Link>
        </div>
      </div>

      <style>{`
        .rb-urc { container-type: inline-size; }
        /* wide: cover · text · status · date · calendar mark (RTL, one compact row) */
        .rb-urc-row { display: grid; align-items: center; column-gap: 14px; row-gap: 6px;
          grid-template-columns: auto minmax(0, 1fr) auto auto auto;
          grid-template-areas: "cover text pill date cal"; }
        .rb-urc-cal { display: inline-flex; }
        /* narrow card / phone: status drops under the text, calendar mark hidden */
        @container (max-width: 500px) {
          .rb-urc-row { grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 12px;
            grid-template-areas: "cover text date" "cover pill date"; }
          .rb-urc-cal { display: none; }
        }
      `}</style>
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        {state === "loading" ? (
          <div style={{ fontSize: 12, color: MUTED, textAlign: "center", paddingTop: 20 }}>טוען…</div>
        ) : state === "error" ? (
          <div style={{ fontSize: 12, color: MUTED, textAlign: "center", paddingTop: 20 }}>
            לא ניתן לטעון ריליסים.{" "}
            <button type="button" onClick={onReload} style={{ background: "none", border: "none", padding: 0, color: "#3B82F6", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>נסה שוב</button>
          </div>
        ) : shown.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: 16, paddingBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: SUB }}>אין ריליסים מתוזמנים כרגע</span>
            <span style={{ fontSize: 11.5, color: MUTED, marginTop: -6 }}>כשתקבע ריליס, הוא יופיע כאן</span>
            <button type="button" onClick={() => setAddOpen(true)} style={{
              width: "100%", maxWidth: 260, padding: "10px 0", borderRadius: 11, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 13, fontWeight: 800, color: "#fff", background: BRAND,
            }}>+ הוסף ריליס</button>
            <Link href="/label" style={{ fontSize: 11.5, fontWeight: 700, color: SUB, textDecoration: "none" }}>ניהול ריליסים</Link>
          </div>
        ) : shown.map((r) => {
          const statusColor = STATUS_COLOR[r.status];
          const daysColor = r.overdue ? RED : r.daysLeft <= 7 ? AMBER : SUB;
          const urgent = r.overdue || r.daysLeft <= 7;
          return (
            <button
              key={r.item.projectId}
              type="button"
              onClick={() => setEditItem(r.item)}
              title="לחץ לעריכת הריליס"
              className="rb-urc-row"
              style={{
                width: "100%", textAlign: "right", fontFamily: "inherit", cursor: "pointer",
                background: r.overdue ? "rgba(239,68,68,0.06)" : CARD2,
                border: `1px solid ${r.overdue ? "rgba(239,68,68,0.28)" : BORDER}`,
                borderRadius: 14, padding: "10px 14px",
                boxShadow: "0 1px 6px rgba(0,0,0,0.3)",
              }}
            >
              {/* RTL order: cover · name/artist/line · status · date/days · calendar mark.
                  The cover is the PROJECT's own (ProjectCover) — this card holds no artwork. */}
              <div style={{ gridArea: "cover", display: "flex" }}>
                <ProjectCover projectId={r.item.projectId} name={r.item.name} cover={r.item.cover} size={60} mobileSize={46} />
              </div>
              <div style={{ gridArea: "text", minWidth: 0 }}>
                <div dir="auto" style={{ fontSize: 15, fontWeight: 800, color: TEXT, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.item.name}</div>
                <div dir="auto" style={{ fontSize: 12.5, color: SUB, marginTop: 2, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.item.artist}</div>
                {r.line && (
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, fontSize: 11.5, fontWeight: 600, color: lineColor(r.line.kind, urgent), minWidth: 0 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: lineColor(r.line.kind, urgent), flexShrink: 0 }} />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.line.text}</span>
                  </div>
                )}
              </div>
              <span style={{
                gridArea: "pill", justifySelf: "start", alignSelf: "center",
                fontSize: 11, fontWeight: 800, padding: "4px 12px", borderRadius: 99, whiteSpace: "nowrap",
                color: statusColor, background: `${statusColor}1A`, border: `1px solid ${statusColor}33`,
              }}>{r.status}</span>
              <div style={{ gridArea: "date", alignSelf: "center", textAlign: "left", minWidth: 74 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>{releaseShortDate(r.item.release.releaseTargetDate!)}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: daysColor, marginTop: 2, whiteSpace: "nowrap" }}>{releaseDaysText(r.daysLeft)}</div>
              </div>
              <span className="rb-urc-cal" aria-hidden style={{
                gridArea: "cal", alignSelf: "center", width: 34, height: 34, borderRadius: 10,
                alignItems: "center", justifyContent: "center", color: SUB,
                background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16.5" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg>
              </span>
            </button>
          );
        })}
      </div>

      {editItem && (
        <EditReleaseModal item={editItem} onClose={() => setEditItem(null)} onSaved={onReload} />
      )}
      {addOpen && <AddReleaseModal onClose={() => setAddOpen(false)} onCreated={onReload} />}
    </div>
  );
}
