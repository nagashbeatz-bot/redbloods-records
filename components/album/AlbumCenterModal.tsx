"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Project, AlbumTrackStatus } from "@/lib/types";
import { ALBUM_TRACK_STATUSES } from "@/lib/types";
import AlbumOverviewTab from "./AlbumOverviewTab";
import AlbumTracksTab from "./AlbumTracksTab";
import AlbumFinanceTab from "./AlbumFinanceTab";
import AlbumTasksTab from "./AlbumTasksTab";
import QuickTxModal from "@/components/finance/QuickTxModal";

interface Props {
  project: Project;
  onClose: () => void;
}

const TABS = ["סקירה", "שירים", "כספים", "קבצים", "משימות", "הפצה"] as const;
type Tab = (typeof TABS)[number];

function getAccentColor(projectType: string): string {
  if (projectType === "EP") return "#A855F7";
  if (projectType === "אלבום") return "#EC4899";
  return "#3B82F6";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y}`;
}

function getOpenUrl(files: Project["files"]): string | null {
  const withShare = files.find((f) => f.dropboxShareUrl);
  if (withShare) return withShare.dropboxShareUrl!;
  const withUrl = files.find((f) => f.url);
  if (withUrl) return withUrl.url;
  return null;
}

export default function AlbumCenterModal({ project, onClose }: Props) {
  const [activeTab,    setActiveTab]    = useState<Tab>("סקירה");
  const [showAddTx,    setShowAddTx]    = useState(false);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [trackRefresh, setTrackRefresh] = useState(0);
  const accentColor = getAccentColor(project.projectType);

  const completedFiles = project.files.length;
  const totalFiles = Math.max(project.files.length, 3);
  const progressPct =
    totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !showAddTx && !showAddTrack) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, showAddTx, showAddTrack]);

  const btnBase: React.CSSProperties = {
    height: 36,
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "0 14px",
    cursor: "pointer",
    border: "none",
  };

  const disabledBtn: React.CSSProperties = {
    ...btnBase,
    background: "#1A1A1A",
    border: "1px solid #3B82F622",
    color: "#888",
    cursor: "not-allowed",
    opacity: 0.5,
  };

  const openUrl = getOpenUrl(project.files);

  const modal = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(12px)",
        background: "rgba(0,0,0,0.92)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "calc(100vw - 40px)",
          height: "calc(100vh - 40px)",
          background: "#0E0E0E",
          borderRadius: 18,
          border: `1px solid ${accentColor}3A`,
          display: "flex",
          flexDirection: "column",
          direction: "rtl",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── HEADER ── */}
        <div
          style={{
            flexShrink: 0,
            background: "#111",
            borderBottom: "1px solid #1E1E1E",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 20,
              padding: "20px 28px 0",
              alignItems: "flex-start",
            }}
          >
            {/* Cover art */}
            <div
              style={{
                width: 90,
                height: 90,
                borderRadius: 12,
                background: "#1A1A1A",
                border: "1px solid #252525",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
                flexShrink: 0,
              }}
            >
              🎵
            </div>

            {/* Center info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1
                style={{
                  margin: "0 0 8px",
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#F2F2F2",
                  lineHeight: 1.2,
                }}
              >
                {project.name}
              </h1>

              {/* Badges */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  marginBottom: 10,
                }}
              >
                {project.artist && (
                  <span style={{ color: "#888", fontSize: 13 }}>
                    {project.artist}
                  </span>
                )}
                <span
                  style={{
                    background: `${accentColor}18`,
                    color: accentColor,
                    border: `1px solid ${accentColor}44`,
                    fontSize: 11,
                    padding: "2px 10px",
                    borderRadius: 6,
                  }}
                >
                  {project.projectType}
                </span>
                <span
                  style={{
                    background: "rgba(34,197,94,0.12)",
                    color: "#22c55e",
                    border: "1px solid rgba(34,197,94,0.3)",
                    fontSize: 11,
                    padding: "2px 10px",
                    borderRadius: 6,
                  }}
                >
                  {project.status === "הושלם" ? "הושלם" : "פעיל"}
                </span>
                {project.deadline && (
                  <span style={{ fontSize: 12, color: "#666" }}>
                    📅 {formatDate(project.deadline)}
                  </span>
                )}
              </div>

              {/* Progress text */}
              <div style={{ color: "#666", fontSize: 12, marginBottom: 8 }}>
                {project.files.length === 0
                  ? "אין קבצים עדיין"
                  : `${completedFiles} מתוך ${totalFiles} קבצים הועלו`}
              </div>

              {/* Progress bar */}
              <div
                style={{
                  background: "#1E1E1E",
                  borderRadius: 4,
                  height: 6,
                  width: "100%",
                  maxWidth: 320,
                }}
              >
                <div
                  style={{
                    background: accentColor,
                    borderRadius: 4,
                    height: "100%",
                    width: `${Math.min(100, Math.max(0, progressPct))}%`,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>

            {/* Right: action buttons */}
            <div
              style={{
                flexShrink: 0,
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                flexWrap: "wrap",
                justifyContent: "flex-end",
                maxWidth: 340,
              }}
            >
              {/* הוסף שיר — פותח טופס */}
              <button
                style={{
                  ...btnBase,
                  background: "#1A1A1A",
                  border: `1px solid ${accentColor}44`,
                  color: accentColor,
                }}
                onClick={() => setShowAddTrack(true)}
              >
                🎵 הוסף שיר
              </button>

              {/* הוסף תשלום */}
              <button
                style={{
                  ...btnBase,
                  background: "#1A1A1A",
                  border: "1px solid #F59E0B44",
                  color: "#F59E0B",
                }}
                onClick={() => setShowAddTx(true)}
              >
                💰 הוסף תשלום
              </button>

              {/* פתח קבצים */}
              {openUrl ? (
                <button
                  style={{
                    ...btnBase,
                    background: "#1A1A1A",
                    border: "1px solid #3B82F644",
                    color: "#3B82F6",
                  }}
                  onClick={() => window.open(openUrl, "_blank")}
                >
                  📁 פתח קבצים
                </button>
              ) : (
                <button
                  style={disabledBtn}
                  title="לא קיימת תיקיית קבצים לפרויקט הזה"
                  disabled
                >
                  📁 פתח קבצים
                </button>
              )}

              {/* הפצה — לא מחובר */}
              <button
                style={disabledBtn}
                title="מודול ההפצה עדיין לא מחובר"
                disabled
              >
                📤 הפצה
              </button>

              {/* סגור */}
              <button
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  border: "1px solid #2A2A2A",
                  background: "transparent",
                  color: "#777",
                  fontSize: 16,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
                onClick={onClose}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div
            style={{
              marginTop: 16,
              display: "flex",
              gap: 2,
              overflowX: "auto",
              scrollbarWidth: "none",
              padding: "0 28px",
            }}
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "10px 20px",
                    borderRadius: "10px 10px 0 0",
                    border: "none",
                    fontSize: 13,
                    fontWeight: isActive ? 700 : 400,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s",
                    color: isActive ? accentColor : "#4A4A4A",
                    borderBottom: isActive
                      ? `2px solid ${accentColor}`
                      : "2px solid transparent",
                    background: isActive ? "#141414" : "transparent",
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── CONTENT ── */}
        <div style={{ flex: 1, overflow: "hidden", background: "#141414" }}>
          {activeTab === "סקירה" && (
            <AlbumOverviewTab project={project} accentColor={accentColor} />
          )}
          {activeTab === "שירים" && (
            <AlbumTracksTab key={trackRefresh} project={project} accentColor={accentColor} />
          )}
          {activeTab === "כספים" && (
            <AlbumFinanceTab project={project} accentColor={accentColor} />
          )}
          {activeTab === "קבצים" && (
            <div
              style={{
                padding: "24px 28px",
                overflowY: "auto",
                height: "100%",
                boxSizing: "border-box",
              }}
            >
              {project.files.length === 0 ? (
                <div
                  style={{
                    color: "#444",
                    fontSize: 14,
                    textAlign: "center",
                    marginTop: 60,
                  }}
                >
                  אין קבצים — השתמש בכפתור "הוסף שיר" להעלאה
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {project.files.map((f, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 14px",
                        background: "#1A1A1A",
                        borderRadius: 10,
                        border: "1px solid #252525",
                      }}
                    >
                      <span style={{ fontSize: 12, color: "#888", flex: 1 }}>
                        {f.name}
                      </span>
                      {f.dropboxShareUrl ? (
                        <a
                          href={f.dropboxShareUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 11,
                            color: "#3B82F6",
                            textDecoration: "none",
                            padding: "3px 10px",
                            border: "1px solid #3B82F622",
                            borderRadius: 6,
                          }}
                        >
                          פתח ↗
                        </a>
                      ) : f.url ? (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 11,
                            color: "#3B82F6",
                            textDecoration: "none",
                            padding: "3px 10px",
                            border: "1px solid #3B82F622",
                            borderRadius: 6,
                          }}
                        >
                          פתח ↗
                        </a>
                      ) : (
                        <span style={{ fontSize: 11, color: "#444" }}>אין קישור</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {activeTab === "משימות" && (
            <AlbumTasksTab project={project} accentColor={accentColor} />
          )}
          {activeTab === "הפצה" && (
            <div
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                padding: 40,
              }}
            >
              <div style={{ fontSize: 40 }}>📤</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#444" }}>
                מודול ההפצה עדיין לא מחובר
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "#333",
                  textAlign: "center",
                  maxWidth: 480,
                  lineHeight: 1.7,
                }}
              >
                כדי להפעיל את טאב ההפצה נדרש: חיבור לפלטפורמת הפצה (DistroKid, TuneCore וכד׳), טבלת הפצות ב-DB, ו-API route ייעודי.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* QuickTxModal — הוסף תשלום */}
      {showAddTx && (
        <QuickTxModal
          projectId={project.id}
          projectName={project.name}
          artist={project.artist}
          initialType="income"
          onClose={() => setShowAddTx(false)}
        />
      )}

      {/* AddTrackModal — הוסף שיר */}
      {showAddTrack && (
        <AddTrackModal
          projectId={project.id}
          accentColor={accentColor}
          onClose={() => setShowAddTrack(false)}
          onCreated={() => {
            setShowAddTrack(false);
            setTrackRefresh((n) => n + 1);
            setActiveTab("שירים");
          }}
        />
      )}
    </div>
  );

  return createPortal(modal, document.body);
}

// ── AddTrackModal ──────────────────────────────────────────────────────────────

interface AddTrackProps {
  projectId:   string;
  accentColor: string;
  onClose:     () => void;
  onCreated:   () => void;
}

function AddTrackModal({ projectId, accentColor, onClose, onCreated }: AddTrackProps) {
  const [title,  setTitle]  = useState("");
  const [status, setStatus] = useState<AlbumTrackStatus>("טרום הקלטה");
  const [notes,  setNotes]  = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) { setError("נדרש שם שיר"); return; }
    setSaving(true);
    setError(null);
    try {
      // Determine next track_number from server (will count existing tracks)
      const listRes = await fetch(`/api/album-tracks?projectId=${projectId}`);
      const existing = listRes.ok ? await listRes.json() : [];
      const nextNum  = (Array.isArray(existing) ? existing.length : 0) + 1;

      const res = await fetch("/api/album-tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, track_number: nextNum, title: title.trim(), status, notes: notes.trim() || null }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "שגיאה"); return; }
      onCreated();
    } catch { setError("שגיאת רשת"); }
    finally { setSaving(false); }
  };

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 300000,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
  };

  const card: React.CSSProperties = {
    background: "#111", border: `1px solid ${accentColor}33`,
    borderRadius: 16, padding: "24px 28px", width: 360,
    direction: "rtl", display: "flex", flexDirection: "column", gap: 14,
  };

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "#0E0E0E", border: "1px solid #2A2A2A", borderRadius: 8,
    color: "#E0E0E0", fontSize: 13, padding: "9px 12px", fontFamily: "inherit",
  };

  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0" }}>הוסף שיר לאלבום</div>

        <div>
          <label style={{ fontSize: 11, color: "#555", display: "block", marginBottom: 4 }}>שם השיר *</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
            placeholder="שם השיר"
            style={inp}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, color: "#555", display: "block", marginBottom: 4 }}>סטטוס</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as AlbumTrackStatus)} style={inp}>
            {ALBUM_TRACK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 11, color: "#555", display: "block", marginBottom: 4 }}>הערות</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="הערות אופציונליות..."
            style={{ ...inp, resize: "vertical" }}
          />
        </div>

        {error && <div style={{ fontSize: 12, color: "#EF4444" }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid #2A2A2A",
              background: "transparent", color: "#666", fontSize: 13, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            ביטול
          </button>
          <button
            onClick={submit}
            disabled={saving}
            style={{
              padding: "8px 20px", borderRadius: 8, border: "none",
              background: accentColor, color: "#fff",
              fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {saving ? "שומר..." : "הוסף שיר"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
