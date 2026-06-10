"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Project } from "@/lib/types";
import AlbumOverviewTab from "./AlbumOverviewTab";
import AlbumTracksTab from "./AlbumTracksTab";

type Tab = "overview" | "tracks" | "references" | "updates" | "files" | "reports";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "סקירה" },
  { id: "tracks", label: "שירים" },
  { id: "references", label: "רפרנסים" },
  { id: "updates", label: "סיכומי שיחה" },
  { id: "files", label: "קבצים" },
  { id: "reports", label: "דוחות" },
];

interface Props {
  project: Project;
  onClose: () => void;
}

export default function AlbumCenterModal({ project, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [isArtistMode, setIsArtistMode] = useState(false);

  const isEP = project.projectType === "EP";
  const accentColor = isEP ? "#A855F7" : "#EC4899";

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const modal = (
    <div
      dir="rtl"
      style={{ position: "fixed", inset: 0, zIndex: 100001, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
      />

      {/* Modal box */}
      <div style={{
        position: "relative",
        width: "96vw",
        height: "94vh",
        maxWidth: 1400,
        maxHeight: 900,
        background: "#111",
        borderRadius: 20,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: `1px solid ${accentColor}33`,
        boxShadow: `0 0 80px ${accentColor}18`,
      }}>

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div style={{ padding: "16px 20px 0", borderBottom: "1px solid #222", flexShrink: 0 }}>

          {/* Top row: title + controls */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>🎵</span>
              <span style={{
                fontSize: 15,
                fontWeight: 700,
                color: "#F0F0F0",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                מרכז אלבום — {project.name}
              </span>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 6,
                background: `${accentColor}18`,
                color: accentColor,
                border: `1px solid ${accentColor}44`,
                flexShrink: 0,
              }}>
                {project.projectType}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {/* Artist mode toggle */}
              <button
                onClick={() => setIsArtistMode((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 11px",
                  borderRadius: 8,
                  border: `1px solid ${isArtistMode ? "#22c55e" : "#333"}`,
                  background: isArtistMode ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
                  color: isArtistMode ? "#22c55e" : "#666",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ fontSize: 13 }}>{isArtistMode ? "👁" : "👤"}</span>
                <span>
                  {isArtistMode ? "מצב אמן פעיל" : "מצב תצוגה לאמן"}
                </span>
              </button>

              {/* Close */}
              <button
                onClick={onClose}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "rgba(255,255,255,0.04)",
                  color: "#777",
                  cursor: "pointer",
                  fontSize: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "inherit",
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Sub-header: artist + quick stats (mock) */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, fontSize: 11, color: "#666", flexWrap: "wrap" }}>
            <span>🎤 {project.artist}</span>
            <span style={{ color: "#2A2A2A" }}>·</span>
            <span
              title="נתונים לדוגמה — יתעדכנו בשלב 2"
              style={{ borderBottom: "1px dashed #3A3A3A", cursor: "help" }}
            >
              3 שירים · <span style={{ color: "#22c55e" }}>1 הושלם</span> · <span style={{ color: "#F59E0B" }}>1 בתהליך</span> · 1 ממתין
            </span>
            <span style={{
              fontSize: 9,
              color: "#555",
              padding: "1px 6px",
              borderRadius: 4,
              border: "1px solid #2A2A2A",
              background: "rgba(245,158,11,0.06)",
            }}>
              נתונים לדוגמה
            </span>
          </div>

          {/* Artist mode banner */}
          {isArtistMode && (
            <div style={{
              marginBottom: 10,
              padding: "6px 12px",
              borderRadius: 8,
              background: "rgba(34,197,94,0.08)",
              border: "1px solid rgba(34,197,94,0.25)",
              color: "#22c55e",
              fontSize: 11,
              fontWeight: 600,
            }}>
              👁 מצב תצוגה לאמן פעיל — הערות פנימיות ומידע רגיש מוסתרים
            </div>
          )}

          {/* Tabs row */}
          <div style={{ display: "flex", gap: 1, overflowX: "auto", scrollbarWidth: "none" }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "7px 13px",
                  borderRadius: "8px 8px 0 0",
                  border: "none",
                  background: activeTab === tab.id ? "#1A1A1A" : "transparent",
                  color: activeTab === tab.id ? accentColor : "#555",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: activeTab === tab.id ? 700 : 400,
                  fontFamily: "inherit",
                  borderBottom: activeTab === tab.id ? `2px solid ${accentColor}` : "2px solid transparent",
                  transition: "all 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Content area ──────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: "hidden", background: "#1A1A1A" }}>
          {activeTab === "overview" && (
            <AlbumOverviewTab project={project} isArtistMode={isArtistMode} accentColor={accentColor} />
          )}
          {activeTab === "tracks" && (
            <AlbumTracksTab project={project} isArtistMode={isArtistMode} accentColor={accentColor} />
          )}
          {(activeTab === "references" || activeTab === "updates" || activeTab === "files" || activeTab === "reports") && (
            <ComingSoonTab label={TABS.find((t) => t.id === activeTab)!.label} accentColor={accentColor} />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function ComingSoonTab({ label, accentColor }: { label: string; accentColor: string }) {
  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    }}>
      <div style={{ fontSize: 32 }}>🔨</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#555" }}>{label}</div>
      <div style={{ fontSize: 12, color: "#3A3A3A" }}>בבנייה — יהיה זמין בשלב הבא</div>
    </div>
  );
}
