"use client";

// Dashboard card "ריליסים קרובים" — up to 3 releases, soonest first (a release whose
// date already passed but isn't "יצא" leads, in red). Display-only: data comes from
// GET /api/label/releases via the parent; a row click opens the existing
// EditReleaseModal from /label. No writes of its own.

import { useState } from "react";
import Link from "next/link";
import type { LabelRelease } from "@/lib/types";
import {
  releaseDaysText, releaseShortDate,
  type ReleaseDisplayStatus, type ReleaseLineKind, type UpcomingReleaseRow,
} from "@/lib/dashboard-releases";
import { EditReleaseModal, CARD, CARD2, BORDER, BORDER2, TEXT, SUB, MUTED } from "@/components/label/labelShared";

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
  onReload: () => void;
}) {
  const [editItem, setEditItem] = useState<LabelRelease | null>(null);
  const shown = rows.slice(0, MAX_ROWS);

  return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18,
      overflow: "hidden",
      boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "18px 22px 14px", borderBottom: `1px solid rgba(255,255,255,0.07)`,
        background: "rgba(255,255,255,0.015)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🎵</span>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: "#F0F0F0" }}>ריליסים קרובים</span>
        </div>
        <Link href="/label" style={{ fontSize: 11, color: "#3B82F6", textDecoration: "none" }}>הצג הכל ←</Link>
      </div>

      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        {state === "loading" ? (
          <div style={{ fontSize: 12, color: MUTED, textAlign: "center", paddingTop: 20 }}>טוען…</div>
        ) : state === "error" ? (
          <div style={{ fontSize: 12, color: MUTED, textAlign: "center", paddingTop: 20 }}>
            לא ניתן לטעון ריליסים.{" "}
            <button type="button" onClick={onReload} style={{ background: "none", border: "none", padding: 0, color: "#3B82F6", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>נסה שוב</button>
          </div>
        ) : shown.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: 20 }}>
            <span style={{ fontSize: 12.5, color: MUTED }}>אין ריליסים מתוזמנים כרגע</span>
            <Link href="/label" style={{
              fontSize: 12, fontWeight: 700, color: SUB, textDecoration: "none",
              padding: "6px 16px", borderRadius: 99, background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}`,
            }}>ניהול ריליסים</Link>
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
              style={{
                width: "100%", textAlign: "right", fontFamily: "inherit", cursor: "pointer",
                background: r.overdue ? "rgba(239,68,68,0.06)" : CARD2,
                border: `1px solid ${r.overdue ? "rgba(239,68,68,0.28)" : BORDER}`,
                borderRadius: 13, padding: "12px 14px",
                boxShadow: "0 1px 6px rgba(0,0,0,0.3)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.item.name}</div>
                  <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.item.artist}</div>
                </div>
                <span style={{
                  fontSize: 10.5, fontWeight: 800, padding: "3px 10px", borderRadius: 99, whiteSpace: "nowrap", flexShrink: 0,
                  color: statusColor, background: `${statusColor}1A`, border: `1px solid ${statusColor}33`,
                }}>{r.status}</span>
                <div style={{ flexShrink: 0, textAlign: "left", minWidth: 72 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: TEXT }}>{releaseShortDate(r.item.release.releaseTargetDate!)}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: daysColor, marginTop: 2 }}>{releaseDaysText(r.daysLeft)}</div>
                </div>
              </div>
              {r.line && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 7, marginTop: 9, paddingTop: 9,
                  borderTop: `1px solid ${BORDER2}`,
                  fontSize: 11.5, fontWeight: 600, color: lineColor(r.line.kind, urgent),
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: lineColor(r.line.kind, urgent), flexShrink: 0 }} />
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.line.text}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {editItem && (
        <EditReleaseModal item={editItem} onClose={() => setEditItem(null)} onSaved={onReload} />
      )}
    </div>
  );
}
