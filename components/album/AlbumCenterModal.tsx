"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Project } from "@/lib/types";
import AlbumOverviewTab from "./AlbumOverviewTab";
import AlbumTracksTab from "./AlbumTracksTab";

type Tab = "overview" | "tracks" | "references" | "updates" | "files" | "reports";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview",    label: "סקירה" },
  { id: "tracks",      label: "שירים" },
  { id: "references",  label: "רפרנסים" },
  { id: "updates",     label: "סיכומי שיחה" },
  { id: "files",       label: "קבצים" },
  { id: "reports",     label: "דוחות" },
];

const COMING_SOON: Record<string, { icon: string; title: string; desc: string }> = {
  references:  { icon: "📎", title: "רפרנסים",        desc: "ניהול רפרנסים לכל שיר — YouTube, SoundCloud, Spotify — עם הערה על מה לקחת מכל אחד." },
  updates:     { icon: "📝", title: "סיכומי שיחה",    desc: "תיעוד פגישות ושיחות, סיכום פנימי לצוות וסיכום ללקוח, ומשימות להמשך." },
  files:       { icon: "🗂️", title: "קבצים",           desc: "ניהול גרסאות, העלאת קבצים לדרופבוקס, ניגון ישיר מכל שיר — סקיצה, מיקס, מאסטר ועוד." },
  reports:     { icon: "📄", title: "דוחות",           desc: "יצירת דוחות PDF מקצועיים ללקוח — רשימת שירים, סטטוסים, הערות ותשלומים." },
};

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
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Backdrop — opaque enough to bury the Drawer behind */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.92)",
          backdropFilter: "blur(12px)",
        }}
      />

      {/* Workspace box — near-fullscreen, no hard px cap */}
      <div style={{
        position: "relative",
        width: "calc(100vw - 40px)",
        height: "calc(100vh - 40px)",
        background: "#0E0E0E",
        borderRadius: 18,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: `1px solid ${accentColor}3A`,
        boxShadow: `0 0 0 1px #1A1A1A, 0 32px 80px rgba(0,0,0,0.8), 0 0 120px ${accentColor}14`,
      }}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={{
          padding: "20px 28px 0",
          borderBottom: "1px solid #1E1E1E",
          flexShrink: 0,
          background: "#111",
        }}>

          {/* Top row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>

            {/* Left: title + badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>🎵</span>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: "#F2F2F2",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  letterSpacing: "-0.2px",
                }}>
                  מרכז אלבום — {project.name}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 9px",
                    borderRadius: 6,
                    background: `${accentColor}18`,
                    color: accentColor,
                    border: `1px solid ${accentColor}44`,
                  }}>
                    {project.projectType}
                  </span>
                  <span style={{ fontSize: 12, color: "#555" }}>🎤 {project.artist}</span>
                </div>
              </div>
            </div>

            {/* Right: controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              {/* Artist mode */}
              <button
                onClick={() => setIsArtistMode((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "9px 16px",
                  borderRadius: 10,
                  border: `1px solid ${isArtistMode ? "#22c55e" : "#2A2A2A"}`,
                  background: isArtistMode ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)",
                  color: isArtistMode ? "#22c55e" : "#777",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                  whiteSpace: "nowrap",
                  height: 38,
                }}
              >
                <span style={{ fontSize: 15 }}>{isArtistMode ? "👁" : "👤"}</span>
                <span>{isArtistMode ? "מצב אמן פעיל" : "מצב תצוגה לאמן"}</span>
              </button>

              {/* Close */}
              <button
                onClick={onClose}
                title="סגור (ESC)"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  border: "1px solid #2A2A2A",
                  background: "rgba(255,255,255,0.04)",
                  color: "#777",
                  cursor: "pointer",
                  fontSize: 17,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Stats strip */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 12,
            paddingBottom: 12,
            borderBottom: "1px solid #1A1A1A",
            fontSize: 12,
            color: "#555",
            flexWrap: "wrap",
          }}>
            <span
              title="נתונים לדוגמה — יתעדכנו בשלב 2"
              style={{ cursor: "help", display: "flex", alignItems: "center", gap: 10 }}
            >
              <span>3 שירים</span>
              <span style={{ color: "#2A2A2A" }}>·</span>
              <span style={{ color: "#22c55e" }}>1 הושלם</span>
              <span style={{ color: "#2A2A2A" }}>·</span>
              <span style={{ color: "#F59E0B" }}>1 בתהליך</span>
              <span style={{ color: "#2A2A2A" }}>·</span>
              <span>1 ממתין</span>
            </span>
            <span style={{
              fontSize: 10,
              color: "#4A4A4A",
              padding: "2px 8px",
              borderRadius: 5,
              border: "1px solid #252525",
              background: "rgba(245,158,11,0.05)",
            }}>
              נתונים לדוגמה
            </span>

            {/* Artist mode banner inline */}
            {isArtistMode && (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#22c55e",
                padding: "2px 10px",
                borderRadius: 6,
                background: "rgba(34,197,94,0.08)",
                border: "1px solid rgba(34,197,94,0.2)",
              }}>
                👁 מצב תצוגה לאמן פעיל — מידע פנימי מוסתר
              </span>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "none" }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "10px 20px",
                  borderRadius: "10px 10px 0 0",
                  border: "none",
                  background: activeTab === tab.id ? "#141414" : "transparent",
                  color: activeTab === tab.id ? accentColor : "#4A4A4A",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: activeTab === tab.id ? 700 : 400,
                  fontFamily: "inherit",
                  borderBottom: activeTab === tab.id
                    ? `2px solid ${accentColor}`
                    : "2px solid transparent",
                  transition: "all 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: "hidden", background: "#141414" }}>
          {activeTab === "overview" && (
            <AlbumOverviewTab
              project={project}
              isArtistMode={isArtistMode}
              accentColor={accentColor}
            />
          )}
          {activeTab === "tracks" && (
            <AlbumTracksTab
              project={project}
              isArtistMode={isArtistMode}
              accentColor={accentColor}
            />
          )}
          {(activeTab === "references" || activeTab === "updates" || activeTab === "files" || activeTab === "reports") && (
            <ComingSoonTab
              spec={COMING_SOON[activeTab]}
              accentColor={accentColor}
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function ComingSoonTab({
  spec,
  accentColor,
}: {
  spec: { icon: string; title: string; desc: string };
  accentColor: string;
}) {
  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      padding: 40,
    }}>
      <div style={{ fontSize: 40 }}>{spec.icon}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#444" }}>{spec.title}</div>
      <div style={{
        fontSize: 14,
        color: "#333",
        textAlign: "center",
        maxWidth: 480,
        lineHeight: 1.7,
      }}>
        {spec.desc}
      </div>
      <div style={{
        marginTop: 8,
        padding: "8px 20px",
        borderRadius: 10,
        border: `1px dashed ${accentColor}33`,
        background: `${accentColor}07`,
        color: "#3A3A3A",
        fontSize: 12,
      }}>
        יתווסף בשלב הבא של הפיתוח
      </div>
    </div>
  );
}
