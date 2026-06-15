"use client";

import { useEffect, useState, useCallback } from "react";
import type { Project, AlbumTrack, AlbumTrackStatus, FileLink, ProjectStatus } from "@/lib/types";
import { ALL_STATUSES } from "@/lib/types";
import { usePlayerSafe } from "@/components/PlayerProvider";
import UploadButton from "@/components/ui/UploadButton";

interface Transaction {
  id: string;
  type: "income" | "expense";
  amount: number;
  description: string;
  date: string;
  payment_status: string;
}

interface ProjectAction {
  id: string;
  action_type: string;
  content_type: string | null;
  version_label: string | null;
  recipient_name: string | null;
  action_date: string;
  status: string;
  notes: string | null;
}

interface TxData {
  transactions: Transaction[];
  settings: { agreedPrice: number; currency: string; financialNotes: string };
}

interface Props {
  project:      Project;
  accentColor:  string;
  onAddTrack:   () => void;
  onGoToTrack:  (trackId: string) => void;
  onAddPayment: () => void;
}

const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aiff", ".aif"];
function isAudio(name: string): boolean {
  return AUDIO_EXTS.some((ext) => name.toLowerCase().endsWith(ext));
}

const TRACK_PCT: Record<AlbumTrackStatus, number> = {
  "הושלם": 100, "מחכה למיקס": 80, "במיקס": 60, "בעבודה": 35, "בהשהייה": 10, "לא התחיל": 0,
};

const STATUS_COLOR: Record<AlbumTrackStatus, { color: string; bg: string; border: string }> = {
  "בעבודה":     { color: "#60A5FA", bg: "rgba(59,130,246,0.15)",  border: "rgba(59,130,246,0.3)"  },
  "מחכה למיקס": { color: "#FBBF24", bg: "rgba(245,158,11,0.15)",  border: "rgba(245,158,11,0.3)"  },
  "במיקס":      { color: "#C084FC", bg: "rgba(168,85,247,0.15)",  border: "rgba(168,85,247,0.3)"  },
  "הושלם":      { color: "#34D399", bg: "rgba(16,185,129,0.15)",  border: "rgba(16,185,129,0.3)"  },
  "בהשהייה":    { color: "#9CA3AF", bg: "rgba(107,114,128,0.15)", border: "rgba(107,114,128,0.3)" },
  "לא התחיל":   { color: "#6B7280", bg: "rgba(75,85,99,0.15)",    border: "rgba(75,85,99,0.3)"    },
};

function formatDDMM(dateStr: string): string {
  if (!dateStr) return "";
  const d = dateStr.split("T")[0].split("-");
  return d.length >= 3 ? `${d[2]}.${d[1]}` : dateStr;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function actionSummary(a: ProjectAction): string {
  switch (a.action_type) {
    case "sent":              return `נשלח${a.recipient_name ? " ל" + a.recipient_name : ""}${a.content_type ? " — " + a.content_type : ""}`;
    case "received_feedback": return `התקבל פידבק${a.recipient_name ? " מ" + a.recipient_name : ""}`;
    case "got_notes":         return `התקבלו הערות${a.recipient_name ? " מ" + a.recipient_name : ""}`;
    default:                  return a.notes ?? "פעולה";
  }
}

function actionDotColor(status: string): string {
  if (["sent", "pending_feedback"].includes(status)) return "#3B82F6";
  if (["done", "closed", "approved"].includes(status)) return "#22c55e";
  if (status === "got_notes") return "#F59E0B";
  return "#555";
}

function CtrlBtn({ onClick, title, children }: { onClick?: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 28, height: 28, borderRadius: 7,
      border: "1px solid #2A2A2A", background: "transparent",
      color: "#666", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {children}
    </button>
  );
}

export default function AlbumOverviewTab({ project, accentColor, onAddTrack, onGoToTrack, onAddPayment }: Props) {
  const player = usePlayerSafe();
  const [txData,         setTxData]         = useState<TxData | null>(null);
  const [actions,        setActions]        = useState<ProjectAction[]>([]);
  const [tracks,         setTracks]         = useState<AlbumTrack[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [localFiles,     setLocalFiles]     = useState<FileLink[]>(project.files ?? []);
  const [confirmResolve, setConfirmResolve] = useState<((v: boolean) => void) | null>(null);

  const makeConfirm = (): (() => Promise<boolean>) => () => {
    if (!player?.playing) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setConfirmResolve(() => resolve);
    });
  };

  const handleConfirmStop = () => {
    player?.pause();
    confirmResolve?.(true);
    setConfirmResolve(null);
  };

  const handleConfirmCancel = () => {
    confirmResolve?.(false);
    setConfirmResolve(null);
  };

  // ── Drag & Drop ─────────────────────────────────────────────────────────────
  const [dragIdx,         setDragIdx]         = useState<number | null>(null);
  const [dragOver,        setDragOver]        = useState<number | null>(null);

  const handleReorder = async (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const reordered = [...tracks];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const withNumbers = reordered.map((t, i) => ({ ...t, track_number: i + 1 }));
    setTracks(withNumbers);
    try {
      await fetch("/api/album-tracks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks: withNumbers.map((t) => ({ id: t.id, track_number: t.track_number })) }),
      });
    } catch {
      setTracks(tracks); // revert on error
    }
  };

  // ── Delete track ─────────────────────────────────────────────────────────────
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting,        setDeleting]        = useState(false);

  const handleDeleteTrack = async () => {
    if (!deleteConfirmId) return;
    setDeleting(true);
    try {
      // 1. Delete each Dropbox file linked to this track
      const trackFiles = localFiles.filter((f) => f.trackId === deleteConfirmId);
      for (const f of trackFiles) {
        if (f.dropboxPath) {
          await fetch("/api/dropbox/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dropboxPath: f.dropboxPath, projectId: project.id }),
          });
        }
      }
      // 2. Delete the track row
      await fetch(`/api/album-tracks/${deleteConfirmId}`, { method: "DELETE" });
      // 3. Update local state
      setTracks((prev) => prev.filter((t) => t.id !== deleteConfirmId).map((t, i) => ({ ...t, track_number: i + 1 })));
      setLocalFiles((prev) => prev.filter((f) => f.trackId !== deleteConfirmId));
    } finally {
      setDeleting(false);
      setDeleteConfirmId(null);
    }
  };

  // ── Status inline edit ────────────────────────────────────────────────────────
  const [statusOpenId,    setStatusOpenId]    = useState<string | null>(null);
  const [updatingStatus,  setUpdatingStatus]  = useState<string | null>(null);

  const handleStatusChange = async (trackId: string, newStatus: ProjectStatus) => {
    setStatusOpenId(null);
    setUpdatingStatus(trackId);
    try {
      await fetch(`/api/album-tracks/${trackId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, status: newStatus } : t));
    } finally {
      setUpdatingStatus(null);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/transactions?projectId=${project.id}`).then((r) => r.json()),
      fetch(`/api/project-actions?projectId=${project.id}`).then((r) => r.json()),
      fetch(`/api/album-tracks?projectId=${project.id}`).then((r) => r.json()),
    ])
      .then(([tx, acts, trks]) => {
        setTxData(tx as TxData);
        setActions(((acts as { actions?: ProjectAction[] }).actions) ?? []);
        setTracks(Array.isArray(trks) ? (trks as AlbumTrack[]) : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  // ── Progress ────────────────────────────────────────────────────────────────
  const pct = tracks.length === 0
    ? 0
    : Math.round(tracks.reduce((s, t) => s + (TRACK_PCT[t.status] ?? 0), 0) / tracks.length);
  const CIRC = 2 * Math.PI * 48;

  // ── Finance ─────────────────────────────────────────────────────────────────
  const transactions = txData?.transactions ?? [];
  const agreedPrice  = txData?.settings?.agreedPrice ?? 0;
  const currency     = txData?.settings?.currency ?? "₪";
  const received = transactions.filter((t) => t.type === "income" && ["שולם", "התקבל"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const expenses = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const balance  = received - expenses;
  const pendingCount = transactions.filter((t) => t.type === "income" && t.payment_status === "צפוי").length;
  const fmt = (n: number) => `${currency}${n.toLocaleString("he-IL")}`;

  // ── Files per track ─────────────────────────────────────────────────────────
  const filesForTrack    = (id: string): FileLink[] => localFiles.filter((f) => f.trackId === id);
  const lastFileForTrack = (id: string): FileLink | null => {
    const fs = filesForTrack(id);
    return fs.length > 0 ? fs[fs.length - 1] : null;
  };

  // ── Player ──────────────────────────────────────────────────────────────────
  const nowPlaying = player?.track?.projectId === project.id ? player.track : null;
  const nowFile    = nowPlaying ? localFiles.find((f) => f.name === nowPlaying.fileName) ?? null : null;

  // ── Recent actions ──────────────────────────────────────────────────────────
  const recentActions = [...actions]
    .sort((a, b) => b.action_date.localeCompare(a.action_date))
    .slice(0, 5);

  // ── Shared card styles ──────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: "#1A1A1A", border: "1px solid #252525",
    borderRadius: 12, overflow: "hidden", marginBottom: 14,
  };
  const cardHead = (extra?: React.CSSProperties): React.CSSProperties => ({
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 14px", borderBottom: "1px solid #1E1E1E",
    fontSize: 11, fontWeight: 700, color: "#888", ...extra,
  });

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 13 }}>
        טוען...
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", overflow: "hidden", direction: "rtl" }}>

      {/* ── Confirm overlay (pause-before-upload) ────────────────────────────── */}
      {confirmResolve && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.65)", backdropFilter: "blur(2px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
          onClick={handleConfirmCancel}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1C1C1C", border: "1px solid #303030", borderRadius: 14,
              padding: "22px 24px", width: 300, direction: "rtl",
              boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0", marginBottom: 8 }}>
              🎵 שיר מתנגן כרגע
            </div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 18, lineHeight: 1.6 }}>
              לעצור את הנגן ולהעלות גרסה חדשה?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleConfirmStop}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
                  background: "#EC4899", color: "#fff",
                  fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                עצור והעלה
              </button>
              <button
                onClick={handleConfirmCancel}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8,
                  border: "1px solid #303030", background: "transparent",
                  color: "#888", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm overlay ───────────────────────────────────────────── */}
      {deleteConfirmId && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.65)", backdropFilter: "blur(2px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
          onClick={() => !deleting && setDeleteConfirmId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1C1C1C", border: "1px solid #303030", borderRadius: 14,
              padding: "22px 24px", width: 320, direction: "rtl",
              boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0", marginBottom: 8 }}>
              🗑 מחיקת שיר
            </div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 18, lineHeight: 1.6 }}>
              למחוק את השיר וכל הקבצים שלו? הפעולה תמחק גם את הגרסאות בדרופבוקס ולא ניתן לשחזר.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleDeleteTrack}
                disabled={deleting}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
                  background: deleting ? "#555" : "#EF4444", color: "#fff",
                  fontSize: 12, fontWeight: 700, cursor: deleting ? "not-allowed" : "pointer", fontFamily: "inherit",
                }}
              >
                {deleting ? "מוחק..." : "מחק שיר וקבצים"}
              </button>
              <button
                onClick={() => setDeleteConfirmId(null)}
                disabled={deleting}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8,
                  border: "1px solid #303030", background: "transparent",
                  color: "#888", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ RIGHT SIDEBAR (260px) ══════════════════════════════════════════════ */}
      <div style={{
        width: 260, flexShrink: 0, overflowY: "auto",
        padding: "18px 14px 18px 10px",
        borderLeft: "1px solid #1E1E1E", boxSizing: "border-box",
      }}>

        {/* A. Progress donut */}
        <div style={{ ...card, padding: "18px 14px", textAlign: "center" }}>
          {/* SVG donut */}
          <div style={{ position: "relative", display: "inline-block", marginBottom: 10 }}>
            <svg width="110" height="110" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="55" cy="55" r="44" fill="none" stroke="#1E1E1E" strokeWidth="7" />
              <circle
                cx="55" cy="55" r="44" fill="none"
                stroke={accentColor} strokeWidth="7"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct / 100)}
                strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 0.5s ease" }}
              />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#F0F0F0" }}>{pct}%</div>
              <div style={{ fontSize: 9, color: "#555" }}>התקדמות</div>
            </div>
          </div>

          {/* Stat rows */}
          {[
            { icon: "🎵", label: "סה״כ שירים",   value: tracks.length,                                          color: "#D0D0D0" },
            { icon: "✅", label: "הושלמו",        value: tracks.filter((t) => t.status === "הושלם").length,       color: "#34D399" },
            { icon: "🎚", label: "במיקס",         value: tracks.filter((t) => t.status === "במיקס").length,       color: "#C084FC" },
            { icon: "🎤", label: "בעבודה",        value: tracks.filter((t) => t.status === "בעבודה").length,      color: "#60A5FA" },
            { icon: "📁", label: "קבצים כלליים",  value: localFiles.filter((f) => !f.trackId).length,          color: "#6B7280" },
          ].map((s) => (
            <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 2px", borderBottom: "1px solid #141414" }}>
              <span style={{ fontSize: 11, color: "#555" }}>{s.icon} {s.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* B. Shortcuts */}
        <div style={card}>
          <div style={cardHead()}>קיצורי דרך</div>
          <div style={{ padding: "10px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
            {[
              { icon: "↑",  label: "העלאת קבצים", title: "השתמש בכפתור 'הוסף שיר' בכותרת" },
              { icon: "🔖", label: "ציוני דרך",    title: "בקרוב" },
              { icon: "$",  label: "דוח כספי",     title: "בקרוב" },
              { icon: "📝", label: "הערות",         title: "עבור לטאב 'משימות'" },
            ].map((s) => (
              <button key={s.label} disabled title={s.title} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 10px", borderRadius: 7,
                border: "1px solid #222", background: "transparent",
                color: "#383838", fontSize: 11, fontFamily: "inherit",
                cursor: "not-allowed", textAlign: "right", width: "100%",
              }}>
                <span style={{ fontSize: 12, opacity: 0.5 }}>{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* C. Distribution placeholder */}
        <div style={{ ...card, opacity: 0.35, marginBottom: 0 }}>
          <div style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 3 }}>📤 הפצה</div>
            <div style={{ fontSize: 10, color: "#555" }}>לא מחובר עדיין</div>
          </div>
        </div>
      </div>

      {/* ══ MAIN CONTENT ═══════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px 18px 18px", boxSizing: "border-box" }}>

        {/* A. Track list ────────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={cardHead()}>
            <span>🎵 רשימת שירים</span>
            <button onClick={onAddTrack} style={{
              fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 6,
              border: `1px solid ${accentColor}44`, background: `${accentColor}11`,
              color: accentColor, cursor: "pointer", fontFamily: "inherit",
            }}>
              + הוסף שיר
            </button>
          </div>

          {tracks.length === 0 ? (
            <div style={{ padding: "36px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 26, opacity: 0.1, marginBottom: 10 }}>🎵</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#333", marginBottom: 6 }}>עדיין אין שירים באלבום</div>
              <div style={{ fontSize: 12, color: "#2A2A2A", marginBottom: 14 }}>הוסף שיר ראשון כדי להתחיל לבנות טרקליסט</div>
              <button onClick={onAddTrack} style={{
                padding: "8px 20px", borderRadius: 9, border: "none",
                background: accentColor, color: "#fff",
                fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
              }}>
                הוסף שיר
              </button>
            </div>
          ) : (
            <>
              {/* Table header: drag | # | ▶ | ↑ | שם | סטטוס | 🗑 */}
              <div style={{
                display: "grid", gridTemplateColumns: "20px 26px 26px 26px 1fr 105px 26px",
                gap: 6, padding: "6px 14px",
                background: "#141414", borderBottom: "1px solid #1E1E1E",
              }}>
                {["", "#", "▶", "↑", "שם השיר", "סטטוס", ""].map((h, i) => (
                  <div key={i} style={{ fontSize: 9, fontWeight: 700, color: "#444" }}>{h}</div>
                ))}
              </div>

              {tracks.map((track, idx) => {
                const lastFile  = lastFileForTrack(track.id);
                const canPlay   = !!lastFile && isAudio(lastFile.name);
                const sc        = STATUS_COLOR[track.status] ?? STATUS_COLOR["לא התחיל"];
                const isPlaying = player?.playing &&
                  player.track?.projectId === project.id &&
                  player.track?.fileName === lastFile?.name;
                const rowBg = idx % 2 === 0 ? "#1A1A1A" : "#171717";
                const isDragTarget = dragOver === idx && dragIdx !== null && dragIdx !== idx;

                return (
                  <div
                    key={track.id}
                    onClick={() => onGoToTrack(track.id)}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(idx); }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) { handleReorder(dragIdx, idx); } setDragIdx(null); setDragOver(null); }}
                    style={{
                      display: "grid", gridTemplateColumns: "20px 26px 26px 26px 1fr 105px 26px",
                      gap: 6, padding: "10px 14px",
                      background: rowBg,
                      borderTop: isDragTarget ? `2px solid ${accentColor}` : "2px solid transparent",
                      borderBottom: "1px solid #141414",
                      cursor: "pointer", alignItems: "center", transition: "background 0.1s, border-top 0.1s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#1E1E1E"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = rowBg; }}
                  >
                    {/* Drag handle */}
                    <div
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); setDragIdx(idx); }}
                      onDragEnd={() => { setDragIdx(null); setDragOver(null); }}
                      onClick={(e) => e.stopPropagation()}
                      title="גרור לסידור מחדש"
                      style={{
                        fontSize: 12, color: "#333", cursor: "grab", userSelect: "none",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      ⠿
                    </div>

                    <div style={{ fontSize: 11, color: "#444", fontWeight: 700, textAlign: "center" }}>
                      {track.track_number}
                    </div>

                    {/* Play */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!player || !canPlay || !lastFile) return;
                        if (isPlaying) player.pause();
                        else player.play({ projectId: project.id, projectName: project.name, artist: project.artist, fileName: lastFile.name, url: lastFile.url });
                      }}
                      disabled={!canPlay}
                      title={canPlay ? (isPlaying ? "השהה" : "נגן") : "אין גרסה לניגון"}
                      style={{
                        width: 24, height: 24, borderRadius: "50%",
                        border: canPlay ? `1px solid ${accentColor}55` : "1px solid #252525",
                        background: isPlaying ? `${accentColor}22` : "transparent",
                        color: canPlay ? (isPlaying ? accentColor : "#666") : "#2A2A2A",
                        cursor: canPlay ? "pointer" : "not-allowed",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 8, fontFamily: "inherit", flexShrink: 0,
                      }}
                    >
                      {isPlaying ? "⏸" : "▶"}
                    </button>

                    {/* Upload */}
                    <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
                      <UploadButton
                        size="sm"
                        projectId={project.id}
                        projectName={project.name}
                        artist={project.artist}
                        existingFiles={filesForTrack(track.id)}
                        trackId={track.id}
                        trackName={track.title}
                        confirmBeforeUpload={makeConfirm()}
                        onSuccess={(file) => setLocalFiles((prev) => [...prev, file])}
                      />
                    </div>

                    {/* Title */}
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#D0D0D0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {track.title}
                    </div>

                    {/* Status — clickable badge → inline select */}
                    <div onClick={(e) => e.stopPropagation()} style={{ position: "relative" }}>
                      {statusOpenId === track.id ? (
                        <select
                          autoFocus
                          value={track.status}
                          onChange={(e) => handleStatusChange(track.id, e.target.value as ProjectStatus)}
                          onBlur={() => setStatusOpenId(null)}
                          style={{
                            background: "#111", border: `1px solid ${accentColor}44`, borderRadius: 6,
                            color: "#D0D0D0", fontSize: 10, padding: "2px 4px", fontFamily: "inherit",
                            width: "100%", cursor: "pointer",
                          }}
                        >
                          {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span
                          onClick={() => setStatusOpenId(track.id)}
                          title="לחץ לשינוי סטטוס"
                          style={{
                            fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                            background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                            whiteSpace: "nowrap", cursor: "pointer",
                            opacity: updatingStatus === track.id ? 0.5 : 1,
                            display: "inline-block",
                          }}
                        >
                          {track.status}
                        </span>
                      )}
                    </div>

                    {/* Delete */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(track.id); }}
                      title="מחק שיר"
                      style={{
                        width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                        border: "1px solid #333", background: "transparent",
                        color: "#555", fontSize: 11, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; e.currentTarget.style.color = "#EF4444"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2A2A2A"; e.currentTarget.style.color = "#3A3A3A"; }}
                    >
                      🗑
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* B. Quick player ─────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={cardHead()}>🎧 נגן מהיר</div>
          {nowPlaying ? (
            <div style={{ padding: "14px 16px" }}>
              {/* Track info */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 7, background: `${accentColor}18`, border: `1px solid ${accentColor}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                  🎵
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#D0D0D0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {nowPlaying.fileName}
                  </div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
                    {nowFile?.versionLabel ? `${nowFile.versionLabel} • ` : ""}{nowPlaying.projectName}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#555", flexShrink: 0 }}>
                  {formatTime(player?.currentTime ?? 0)} / {formatTime(player?.duration ?? 0)}
                </div>
              </div>

              {/* Progress bar */}
              <div
                style={{ height: 4, background: "#252525", borderRadius: 2, marginBottom: 10, cursor: "pointer" }}
                onClick={(e) => {
                  if (!player) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  player.seek(((e.clientX - rect.left) / rect.width) * (player.duration ?? 0));
                }}
              >
                <div style={{
                  height: "100%", borderRadius: 2, background: accentColor,
                  width: `${player && player.duration ? Math.min(100, (player.currentTime / player.duration) * 100) : 0}%`,
                  transition: "width 0.25s linear", pointerEvents: "none",
                }} />
              </div>

              {/* Controls */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <CtrlBtn onClick={() => player?.skip(-30)} title="חזור 30 שניות">⏮</CtrlBtn>
                  <button
                    onClick={() => player?.playing ? player.pause() : player?.resume()}
                    style={{
                      width: 34, height: 34, borderRadius: "50%", border: "none",
                      background: accentColor, color: "#fff", fontSize: 12,
                      cursor: "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {player?.playing ? "⏸" : "▶"}
                  </button>
                  <CtrlBtn onClick={() => player?.skip(30)} title="קדימה 30 שניות">⏭</CtrlBtn>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 11, color: "#555" }}>🔊</span>
                  <input
                    type="range" min={0} max={100} value={player?.volume ?? 80}
                    onChange={(e) => player?.setVolume(Number(e.target.value))}
                    style={{ width: 72, accentColor }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: "18px 16px", color: "#333", fontSize: 12, textAlign: "center" }}>
              בחר שיר מהרשימה כדי לנגן גרסה
            </div>
          )}
        </div>

        {/* C. Finance summary ──────────────────────────────────────────────── */}
        <div style={card}>
          <div style={cardHead()}>
            <span>💰 כספים</span>
            <button onClick={onAddPayment} style={{
              fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 6,
              border: "1px solid #F59E0B44", background: "rgba(245,158,11,0.08)",
              color: "#F59E0B", cursor: "pointer", fontFamily: "inherit",
            }}>
              + הוסף תשלום
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)" }}>
            {[
              { label: "סוכם",   value: fmt(agreedPrice), color: "#D0D0D0" },
              { label: "התקבל",  value: fmt(received),    color: "#22c55e" },
              { label: "הוצאות", value: fmt(expenses),    color: "#EF4444" },
              { label: "יתרה",   value: fmt(balance),     color: balance >= 0 ? "#22c55e" : "#EF4444" },
            ].map((s, i) => (
              <div key={s.label} style={{ padding: "12px 10px", borderLeft: i > 0 ? "1px solid #1E1E1E" : "none", textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 9, color: "#555", marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {pendingCount > 0 && (
            <div style={{ padding: "7px 14px", borderTop: "1px solid #1E1E1E", fontSize: 11, color: "#F59E0B" }}>
              {pendingCount} תשלום{pendingCount > 1 ? "ים" : ""} פתוח{pendingCount > 1 ? "ים" : ""}
            </div>
          )}
        </div>

        {/* D. Recent actions ───────────────────────────────────────────────── */}
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={cardHead()}>⚡ פעולות אחרונות</div>
          {recentActions.length === 0 ? (
            <div style={{ padding: "16px 14px", color: "#2A2A2A", fontSize: 12 }}>אין פעולות אחרונות</div>
          ) : (
            recentActions.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid #141414" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: actionDotColor(a.status), flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "#C0C0C0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {actionSummary(a)}
                </div>
                <div style={{ fontSize: 10, color: "#555", flexShrink: 0 }}>{formatDDMM(a.action_date)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
