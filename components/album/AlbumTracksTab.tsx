"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";

interface MockTrack {
  id: string;
  track_number: number;
  title: string;
  status: string;
  production_stage: string;
  due_date: string | null;
  internal_notes: string;
  client_notes: string;
  has_file: boolean;
  has_references: boolean;
}

const MOCK_TRACKS: MockTrack[] = [
  {
    id: "mock-1",
    track_number: 1,
    title: "ימים טובים",
    status: "מיקס",
    production_stage: "מיקס",
    due_date: "2026-06-20",
    internal_notes: "Mix 3 כמעט מוכן, לשלוח לאמן לאישור.",
    client_notes: "השיר נמצא בשלב מיקס ראשון. לאחר קבלת פידבק נתקדם לגרסה הבאה.",
    has_file: true,
    has_references: true,
  },
  {
    id: "mock-2",
    track_number: 2,
    title: "אבשה",
    status: "הקלטות",
    production_stage: "הקלטות",
    due_date: null,
    internal_notes: "",
    client_notes: "בשלב הקלטות ווקאל. נקבע סשן ל-15.06.",
    has_file: false,
    has_references: true,
  },
  {
    id: "mock-3",
    track_number: 3,
    title: "קמתי בבוקר",
    status: "ממתין",
    production_stage: "ביט",
    due_date: null,
    internal_notes: "האמן עדיין מחליט על הביט.",
    client_notes: "בשלב בחירת ביט.",
    has_file: false,
    has_references: false,
  },
];

const STATUS_COLORS: Record<string, string> = {
  "הושלם": "#22c55e",
  "מיקס": "#A855F7",
  "מאסטר": "#A855F7",
  "מוכן לאישור": "#A855F7",
  "הקלטות": "#F59E0B",
  "עריכה": "#F59E0B",
  "בהפקה": "#60A5FA",
  "בהמתנה לאמן": "#60A5FA",
  "ממתין": "#555",
  "בוטל": "#333",
};

function statusColor(s: string): string {
  return STATUS_COLORS[s] ?? "#777";
}

interface Props {
  project: Project;
  isArtistMode: boolean;
  accentColor: string;
}

export default function AlbumTracksTab({ project, isArtistMode, accentColor }: Props) {
  const tracks = MOCK_TRACKS;
  const [selectedId, setSelectedId] = useState<string>(tracks[0]?.id ?? "");
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const selected = tracks.find((t) => t.id === selectedId) ?? null;

  const showList = !isMobile || mobileView === "list";
  const showDetail = !isMobile || mobileView === "detail";

  return (
    <div style={{ height: "100%", display: "flex", overflow: "hidden" }}>

      {/* ── Track list ──────────────────────────────────────────────────────── */}
      {showList && (
        <div style={{
          width: isMobile ? "100%" : 220,
          flexShrink: 0,
          borderLeft: isMobile ? "none" : "1px solid #222",
          padding: "14px 10px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#444", marginBottom: 10, padding: "0 4px" }}>
            {tracks.length} שירים — נתונים לדוגמה
          </div>

          {tracks.map((track) => (
            <div
              key={track.id}
              onClick={() => {
                setSelectedId(track.id);
                setMobileView("detail");
              }}
              style={{
                padding: "9px 10px",
                borderRadius: 10,
                cursor: "pointer",
                background: selectedId === track.id ? `${accentColor}14` : "transparent",
                border: `1px solid ${selectedId === track.id ? accentColor + "44" : "transparent"}`,
                marginBottom: 3,
                transition: "all 0.1s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 10, color: "#3A3A3A", minWidth: 14, textAlign: "center", flexShrink: 0 }}>
                  {track.track_number}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#E0E0E0",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginBottom: 3,
                  }}>
                    {track.title}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: statusColor(track.status),
                      background: `${statusColor(track.status)}18`,
                      padding: "1px 5px",
                      borderRadius: 4,
                    }}>
                      {track.status}
                    </span>
                    {track.has_file && <span title="יש קובץ להשמעה" style={{ fontSize: 9 }}>🎵</span>}
                    {track.has_references && <span title="יש רפרנסים" style={{ fontSize: 9 }}>📎</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Add track button (disabled in Phase 1) */}
          <button
            disabled
            title="זמין בשלב 2"
            style={{
              marginTop: 8,
              width: "100%",
              padding: "7px 0",
              borderRadius: 10,
              border: `1px dashed ${accentColor}33`,
              background: "transparent",
              color: accentColor + "66",
              cursor: "not-allowed",
              fontSize: 11,
              fontFamily: "inherit",
            }}
          >
            + הוסף שיר
          </button>
        </div>
      )}

      {/* ── Track detail ────────────────────────────────────────────────────── */}
      {showDetail && selected && (
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>

          {/* Back button (mobile only) */}
          {isMobile && (
            <button
              onClick={() => setMobileView("list")}
              style={{
                marginBottom: 14,
                padding: "5px 12px",
                borderRadius: 8,
                border: "1px solid #2A2A2A",
                background: "transparent",
                color: "#666",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "inherit",
              }}
            >
              ← חזרה לרשימה
            </button>
          )}

          {/* Title + badges */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#F0F0F0", marginBottom: 8 }}>
              {selected.track_number}. {selected.title}
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: statusColor(selected.status),
                background: `${statusColor(selected.status)}18`,
                padding: "3px 10px",
                borderRadius: 6,
                border: `1px solid ${statusColor(selected.status)}33`,
              }}>
                {selected.status}
              </span>
              {selected.production_stage && (
                <span style={{
                  fontSize: 11, color: "#777",
                  background: "rgba(255,255,255,0.04)",
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: "1px solid #2A2A2A",
                }}>
                  שלב: {selected.production_stage}
                </span>
              )}
              {selected.due_date && (
                <span style={{
                  fontSize: 11, color: "#777",
                  background: "rgba(255,255,255,0.04)",
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: "1px solid #2A2A2A",
                }}>
                  יעד: {new Date(selected.due_date).toLocaleDateString("he-IL")}
                </span>
              )}
            </div>
          </div>

          {/* Audio area */}
          <div style={{
            padding: "13px 15px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.025)",
            border: "1px solid #2A2A2A",
            marginBottom: 14,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#555", marginBottom: 8 }}>גרסה נוכחית</div>
            {selected.has_file ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* Play — disabled in Phase 1 */}
                <div
                  title="נגן — יהיה זמין בשלב 3"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid #2A2A2A",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    cursor: "not-allowed",
                    flexShrink: 0,
                    color: "#444",
                  }}>
                  ▶
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#CCC", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Mix 2 — {selected.title}.wav
                  </div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
                    10.06 · מיקס · גרסה נוכחית · <span style={{ color: "#3A3A3A" }}>נגן — בקרוב</span>
                  </div>
                </div>
                <span style={{
                  fontSize: 10, color: "#3A3A3A",
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: "1px solid #222",
                  cursor: "not-allowed",
                  flexShrink: 0,
                }}>
                  Dropbox ↗
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#3A3A3A", textAlign: "center", padding: "6px 0" }}>
                אין קובץ — שלב 3 יאפשר העלאת קבצים לשירים
              </div>
            )}
          </div>

          {/* Client notes */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#555", marginBottom: 6 }}>הערה ללקוח</div>
            <div style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.025)",
              border: "1px solid #2A2A2A",
              color: "#999",
              fontSize: 12,
              lineHeight: 1.65,
              minHeight: 52,
            }}>
              {selected.client_notes || <span style={{ color: "#3A3A3A" }}>אין הערה ללקוח</span>}
            </div>
          </div>

          {/* Internal notes (hidden in artist mode) */}
          {!isArtistMode && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#555", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                הערה פנימית
                <span style={{ fontSize: 9, color: "#3A3A3A", padding: "1px 6px", borderRadius: 4, border: "1px solid #2A2A2A" }}>
                  מוסתר מהאמן
                </span>
              </div>
              <div style={{
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.015)",
                border: "1px solid #1E1E1E",
                color: "#666",
                fontSize: 12,
                lineHeight: 1.65,
                minHeight: 52,
              }}>
                {selected.internal_notes || <span style={{ color: "#333" }}>אין הערה פנימית</span>}
              </div>
            </div>
          )}

          {/* References teaser */}
          {selected.has_references && (
            <div style={{
              padding: "9px 12px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.015)",
              border: "1px dashed #2A2A2A",
              color: "#444",
              fontSize: 11,
              textAlign: "center",
            }}>
              📎 יש רפרנסים לשיר זה — יוצגו בטאב רפרנסים (שלב 2)
            </div>
          )}
        </div>
      )}

      {/* Empty state (no selection, desktop) */}
      {!isMobile && !selected && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 13 }}>
          בחר שיר מהרשימה
        </div>
      )}
    </div>
  );
}
