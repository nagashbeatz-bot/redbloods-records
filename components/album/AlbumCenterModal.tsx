"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Project, AlbumTrack, AlbumTrackStatus } from "@/lib/types";
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

const TABS = ["סקירה", "שירים", "כספים", "קבצים", "משימות"] as const;
type Tab = (typeof TABS)[number];

const TRACK_PCT: Record<string, number> = {
  "הושלם": 100, "מחכה למיקס": 80, "במיקס": 60, "בעבודה": 35, "בהשהייה": 10, "לא התחיל": 0,
};

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
  const [activeTab,       setActiveTab]       = useState<Tab>("סקירה");
  const [showAddTx,       setShowAddTx]       = useState(false);
  const [showAddTrack,    setShowAddTrack]    = useState(false);
  const [trackRefresh,    setTrackRefresh]    = useState(0);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [trackStats,      setTrackStats]      = useState<{ total: number; completed: number; pct: number } | null>(null);
  const accentColor = getAccentColor(project.projectType);

  // Fetch track stats for header progress display
  useEffect(() => {
    fetch(`/api/album-tracks?projectId=${project.id}`)
      .then((r) => r.json())
      .then((trks: AlbumTrack[]) => {
        if (!Array.isArray(trks)) return;
        const total     = trks.length;
        const completed = trks.filter((t) => t.status === "הושלם").length;
        const pct       = total === 0
          ? 0
          : Math.round(trks.reduce((s, t) => s + (TRACK_PCT[t.status] ?? 0), 0) / total);
        setTrackStats({ total, completed, pct });
      })
      .catch(() => {});
  }, [project.id, trackRefresh]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !showAddTx && !showAddTrack) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, showAddTx, showAddTrack]);

  const btnBase: React.CSSProperties = {
    height: 36, borderRadius: 10, fontSize: 12, fontWeight: 600,
    fontFamily: "inherit", display: "flex", alignItems: "center",
    gap: 6, padding: "0 14px", cursor: "pointer", border: "none",
  };

  const disabledBtn: React.CSSProperties = {
    ...btnBase, background: "#1A1A1A", border: "1px solid #3B82F622",
    color: "#888", cursor: "not-allowed", opacity: 0.5,
  };

  const openUrl  = getOpenUrl(project.files);
  const headerPct = trackStats?.pct ?? 0;

  const headerText = trackStats
    ? `${trackStats.total} שירים • ${trackStats.completed} הושלמו • ${headerPct}% התקדמות`
    : project.files.length === 0
      ? "אין קבצים עדיין"
      : `${project.files.length} קבצים הועלו`;

  const modal = (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200000,
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(12px)", background: "rgba(0,0,0,0.92)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "calc(100vw - 40px)", height: "calc(100vh - 40px)",
          background: "#0E0E0E", borderRadius: 18,
          border: `1px solid ${accentColor}3A`,
          display: "flex", flexDirection: "column",
          direction: "rtl", overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── HEADER ── */}
        <div style={{ flexShrink: 0, background: "#111", borderBottom: "1px solid #1E1E1E" }}>
          <div style={{ display: "flex", gap: 20, padding: "20px 28px 0", alignItems: "flex-start" }}>

            {/* Cover art */}
            <div style={{
              width: 80, height: 80, borderRadius: 12,
              background: "#1A1A1A", border: "1px solid #252525",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, flexShrink: 0,
            }}>
              🎵
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "#F2F2F2", lineHeight: 1.2 }}>
                {project.name}
              </h1>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {project.artist && <span style={{ color: "#888", fontSize: 13 }}>{project.artist}</span>}
                <span style={{ background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}44`, fontSize: 10, padding: "2px 8px", borderRadius: 5 }}>
                  {project.projectType}
                </span>
                <span style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)", fontSize: 10, padding: "2px 8px", borderRadius: 5 }}>
                  {project.status === "הושלם" ? "הושלם" : "פעיל"}
                </span>
                {project.deadline && (
                  <span style={{ fontSize: 11, color: "#666" }}>📅 {formatDate(project.deadline)}</span>
                )}
              </div>
              <div style={{ color: "#555", fontSize: 11, marginBottom: 6 }}>{headerText}</div>
              <div style={{ background: "#1E1E1E", borderRadius: 3, height: 4, width: "100%", maxWidth: 280 }}>
                <div style={{
                  background: accentColor, borderRadius: 3, height: "100%",
                  width: `${Math.min(100, Math.max(0, headerPct))}%`,
                  transition: "width 0.4s ease",
                }} />
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ flexShrink: 0, display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 340 }}>
              <button
                style={{ ...btnBase, background: "#1A1A1A", border: `1px solid ${accentColor}44`, color: accentColor }}
                onClick={() => setShowAddTrack(true)}
              >
                🎵 הוסף שיר
              </button>
              <button
                style={{ ...btnBase, background: "#1A1A1A", border: "1px solid #F59E0B44", color: "#F59E0B" }}
                onClick={() => setShowAddTx(true)}
              >
                💰 הוסף תשלום
              </button>
              {openUrl ? (
                <button
                  style={{ ...btnBase, background: "#1A1A1A", border: "1px solid #3B82F644", color: "#3B82F6" }}
                  onClick={() => window.open(openUrl, "_blank")}
                >
                  📁 פתח קבצים
                </button>
              ) : (
                <button style={disabledBtn} title="לא קיימת תיקיית קבצים לפרויקט הזה" disabled>
                  📁 פתח קבצים
                </button>
              )}
              <button
                style={{ width: 36, height: 36, borderRadius: 9, border: "1px solid #2A2A2A", background: "transparent", color: "#777", fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", flexShrink: 0 }}
                onClick={onClose}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ marginTop: 14, display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "none", padding: "0 28px" }}>
            {TABS.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "10px 18px", borderRadius: "9px 9px 0 0", border: "none",
                    fontSize: 13, fontWeight: isActive ? 700 : 400, fontFamily: "inherit",
                    cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s",
                    color: isActive ? accentColor : "#4A4A4A",
                    borderBottom: isActive ? `2px solid ${accentColor}` : "2px solid transparent",
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
            <AlbumOverviewTab
              project={project}
              accentColor={accentColor}
              onAddTrack={() => setShowAddTrack(true)}
              onGoToTrack={(id) => { setSelectedTrackId(id); setActiveTab("שירים"); }}
              onAddPayment={() => setShowAddTx(true)}
            />
          )}
          {activeTab === "שירים" && (
            <AlbumTracksTab
              key={trackRefresh}
              project={project}
              accentColor={accentColor}
              initialSelectedTrackId={selectedTrackId}
              onTrackSelected={() => setSelectedTrackId(null)}
            />
          )}
          {activeTab === "כספים" && (
            <AlbumFinanceTab project={project} accentColor={accentColor} />
          )}
          {activeTab === "קבצים" && (
            <div style={{ padding: "24px 28px", overflowY: "auto", height: "100%", boxSizing: "border-box" }}>
              {project.files.length === 0 ? (
                <div style={{ color: "#444", fontSize: 14, textAlign: "center", marginTop: 60 }}>
                  אין קבצים — השתמש בכפתור "הוסף שיר" להעלאה
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {project.files.map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#1A1A1A", borderRadius: 10, border: "1px solid #252525" }}>
                      <span style={{ fontSize: 12, color: "#888", flex: 1 }}>{f.name}</span>
                      {f.versionLabel && (
                        <span style={{ fontSize: 9, color: "#3B82F6", padding: "1px 6px", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 4 }}>{f.versionLabel}</span>
                      )}
                      {(f.dropboxShareUrl || f.url) ? (
                        <a href={f.dropboxShareUrl || f.url} target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, color: "#3B82F6", textDecoration: "none", padding: "3px 10px", border: "1px solid #3B82F622", borderRadius: 6 }}>
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
        </div>
      </div>

      {/* QuickTxModal */}
      {showAddTx && (
        <QuickTxModal
          projectId={project.id}
          projectName={project.name}
          artist={project.artist}
          initialType="income"
          onClose={() => setShowAddTx(false)}
        />
      )}

      {/* AddTrackModal */}
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
  const [status, setStatus] = useState<AlbumTrackStatus>("לא התחיל");
  const [notes,  setNotes]  = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) { setError("נדרש שם שיר"); return; }
    setSaving(true);
    setError(null);
    try {
      const listRes  = await fetch(`/api/album-tracks?projectId=${projectId}`);
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

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "#0E0E0E", border: "1px solid #2A2A2A", borderRadius: 8,
    color: "#E0E0E0", fontSize: 13, padding: "9px 12px", fontFamily: "inherit",
  };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 300000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#111", border: `1px solid ${accentColor}33`, borderRadius: 16, padding: "24px 28px", width: 360, direction: "rtl", display: "flex", flexDirection: "column", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0" }}>הוסף שיר לאלבום</div>

        <div>
          <label style={{ fontSize: 11, color: "#555", display: "block", marginBottom: 4 }}>שם השיר *</label>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
            placeholder="שם השיר" style={inp} />
        </div>

        <div>
          <label style={{ fontSize: 11, color: "#555", display: "block", marginBottom: 4 }}>סטטוס</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as AlbumTrackStatus)} style={inp}>
            {ALBUM_TRACK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 11, color: "#555", display: "block", marginBottom: 4 }}>הערות</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="הערות אופציונליות..." style={{ ...inp, resize: "vertical" }} />
        </div>

        {error && <div style={{ fontSize: 12, color: "#EF4444" }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #2A2A2A", background: "transparent", color: "#666", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
            ביטול
          </button>
          <button onClick={submit} disabled={saving}
            style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: accentColor, color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
            {saving ? "שומר..." : "הוסף שיר"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
