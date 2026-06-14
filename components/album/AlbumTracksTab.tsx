"use client";

import { useEffect, useState, useCallback } from "react";
import type { Project, AlbumTrack, AlbumTrackStatus, MixMasterStatus, FileLink } from "@/lib/types";
import { ALBUM_TRACK_STATUSES, VERSION_LABELS } from "@/lib/types";
import { usePlayerSafe } from "@/components/PlayerProvider";
import UploadButton from "@/components/ui/UploadButton";

interface Props {
  project: Project;
  accentColor: string;
  initialSelectedTrackId?: string | null;
  onTrackSelected?: () => void;
}

const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aiff", ".aif"];
function isAudio(name: string): boolean {
  return AUDIO_EXTS.some((ext) => name.toLowerCase().endsWith(ext));
}

const STATUS_COLOR: Record<AlbumTrackStatus, { color: string; bg: string; border: string }> = {
  "טרום הקלטה": { color: "#6B7280", bg: "rgba(107,114,128,0.12)", border: "rgba(107,114,128,0.3)" },
  "בהקלטה":     { color: "#F59E0B", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.3)"  },
  "במיקס":      { color: "#3B82F6", bg: "rgba(59,130,246,0.12)",  border: "rgba(59,130,246,0.3)"  },
  "מוכן למאסטר":{ color: "#A855F7", bg: "rgba(168,85,247,0.12)", border: "rgba(168,85,247,0.3)"  },
  "הושלם":      { color: "#22c55e", bg: "rgba(34,197,94,0.12)",   border: "rgba(34,197,94,0.3)"   },
};

const MIX_MASTER_COLOR: Record<MixMasterStatus, string> = {
  "לא התחיל": "#3A3A3A",
  "בתהליך":   "#F59E0B",
  "הושלם":    "#22c55e",
};

function StatusBadge({ status }: { status: AlbumTrackStatus }) {
  const s = STATUS_COLOR[status] ?? STATUS_COLOR["טרום הקלטה"];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, whiteSpace: "nowrap",
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {status}
    </span>
  );
}

function MiniDot({ status }: { status: MixMasterStatus }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: MIX_MASTER_COLOR[status] ?? "#3A3A3A",
    }} />
  );
}

export default function AlbumTracksTab({ project, accentColor, initialSelectedTrackId, onTrackSelected }: Props) {
  const player = usePlayerSafe();
  const [tracks,    setTracks]    = useState<AlbumTrack[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [editing,   setEditing]   = useState<string | null>(null);
  const [editVals,  setEditVals]  = useState<Partial<AlbumTrack>>({});
  const [saving,    setSaving]    = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/album-tracks?projectId=${project.id}`)
      .then((r) => r.json())
      .then((data: AlbumTrack[]) => setTracks(Array.isArray(data) ? data : []))
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  // Auto-expand a track when navigated from Overview
  useEffect(() => {
    if (initialSelectedTrackId) {
      setExpanded(initialSelectedTrackId);
      onTrackSelected?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedTrackId]);

  const startEdit = (track: AlbumTrack) => {
    setEditing(track.id);
    setEditVals({ title: track.title, status: track.status, mix_status: track.mix_status, master_status: track.master_status, notes: track.notes });
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/album-tracks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editVals),
      });
      if (res.ok) { setEditing(null); load(); }
    } finally { setSaving(false); }
  };

  const deleteTrack = async (id: string) => {
    if (!confirm("למחוק את השיר הזה? הפעולה אינה הפיכה.")) return;
    await fetch(`/api/album-tracks/${id}`, { method: "DELETE" });
    if (expanded === id) setExpanded(null);
    load();
  };

  // Files linked to a specific track
  const filesForTrack = (trackId: string): FileLink[] =>
    project.files.filter((f) => f.trackId === trackId);

  // Files NOT linked to any track (legacy uploads)
  const unlinkedFiles = project.files.filter((f) => !f.trackId);

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 13 }}>
        טוען רשימת שירים...
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "20px 24px", boxSizing: "border-box", direction: "rtl" }}>

      {tracks.length === 0 && (
        <div style={{ textAlign: "center", paddingTop: 60, color: "#444" }}>
          <div style={{ fontSize: 32, opacity: 0.15, marginBottom: 12 }}>🎵</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>רשימת השירים ריקה</div>
          <div style={{ fontSize: 12, color: "#333" }}>לחץ "הוסף שיר" בכותרת כדי להוסיף שיר לאלבום</div>
        </div>
      )}

      {tracks.map((track) => {
        const isExpanded = expanded === track.id;
        const isEditing  = editing  === track.id;
        const trackFiles = filesForTrack(track.id);
        const sc = STATUS_COLOR[track.status] ?? STATUS_COLOR["טרום הקלטה"];

        return (
          <div
            key={track.id}
            style={{
              background: "#1A1A1A",
              border: `1px solid ${isExpanded ? accentColor + "44" : "#252525"}`,
              borderRadius: 12,
              marginBottom: 8,
              overflow: "hidden",
              transition: "border-color 0.15s",
            }}
          >
            {/* Track header row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                cursor: "pointer",
              }}
              onClick={() => setExpanded(isExpanded ? null : track.id)}
            >
              {/* Track number */}
              <div style={{ fontSize: 11, color: "#555", fontWeight: 700, minWidth: 22, textAlign: "center" }}>
                {track.track_number}
              </div>

              {/* Title */}
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#D0D0D0" }}>
                {track.title}
              </div>

              {/* Mix dot */}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <MiniDot status={track.mix_status} />
                <span style={{ fontSize: 9, color: "#555" }}>מיקס</span>
              </div>

              {/* Master dot */}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <MiniDot status={track.master_status} />
                <span style={{ fontSize: 9, color: "#555" }}>מאסטר</span>
              </div>

              {/* Status badge */}
              <StatusBadge status={track.status} />

              {/* File count */}
              <div style={{ fontSize: 10, color: "#555", minWidth: 28, textAlign: "center" }}>
                {trackFiles.length > 0 ? `${trackFiles.length} קב׳` : ""}
              </div>

              {/* Chevron */}
              <div style={{ fontSize: 10, color: "#444", transition: "transform 0.15s", transform: isExpanded ? "rotate(180deg)" : "none" }}>
                ▼
              </div>
            </div>

            {/* Expanded panel */}
            {isExpanded && (
              <div style={{ borderTop: "1px solid #252525", padding: "16px", background: "#141414" }}>

                {isEditing ? (
                  /* Edit form */
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 4 }}>שם השיר</label>
                        <input
                          value={editVals.title ?? ""}
                          onChange={(e) => setEditVals((v) => ({ ...v, title: e.target.value }))}
                          style={{
                            width: "100%", boxSizing: "border-box",
                            background: "#0E0E0E", border: "1px solid #333", borderRadius: 8,
                            color: "#E0E0E0", fontSize: 13, padding: "7px 10px", fontFamily: "inherit",
                          }}
                        />
                      </div>
                      <div style={{ minWidth: 120 }}>
                        <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 4 }}>סטטוס</label>
                        <select
                          value={editVals.status ?? ""}
                          onChange={(e) => setEditVals((v) => ({ ...v, status: e.target.value as AlbumTrackStatus }))}
                          style={{
                            background: "#0E0E0E", border: "1px solid #333", borderRadius: 8,
                            color: "#E0E0E0", fontSize: 12, padding: "7px 10px", fontFamily: "inherit",
                          }}
                        >
                          {ALBUM_TRACK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div style={{ minWidth: 100 }}>
                        <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 4 }}>מיקס</label>
                        <select
                          value={editVals.mix_status ?? ""}
                          onChange={(e) => setEditVals((v) => ({ ...v, mix_status: e.target.value as MixMasterStatus }))}
                          style={{
                            background: "#0E0E0E", border: "1px solid #333", borderRadius: 8,
                            color: "#E0E0E0", fontSize: 12, padding: "7px 10px", fontFamily: "inherit",
                          }}
                        >
                          {(["לא התחיל", "בתהליך", "הושלם"] as MixMasterStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div style={{ minWidth: 100 }}>
                        <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 4 }}>מאסטר</label>
                        <select
                          value={editVals.master_status ?? ""}
                          onChange={(e) => setEditVals((v) => ({ ...v, master_status: e.target.value as MixMasterStatus }))}
                          style={{
                            background: "#0E0E0E", border: "1px solid #333", borderRadius: 8,
                            color: "#E0E0E0", fontSize: 12, padding: "7px 10px", fontFamily: "inherit",
                          }}
                        >
                          {(["לא התחיל", "בתהליך", "הושלם"] as MixMasterStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 4 }}>הערות</label>
                      <textarea
                        value={editVals.notes ?? ""}
                        onChange={(e) => setEditVals((v) => ({ ...v, notes: e.target.value }))}
                        rows={2}
                        style={{
                          width: "100%", boxSizing: "border-box",
                          background: "#0E0E0E", border: "1px solid #333", borderRadius: 8,
                          color: "#E0E0E0", fontSize: 12, padding: "7px 10px", fontFamily: "inherit",
                          resize: "vertical",
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => saveEdit(track.id)}
                        disabled={saving}
                        style={{
                          padding: "6px 16px", borderRadius: 8, border: "none",
                          background: accentColor, color: "#fff",
                          fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                        }}
                      >
                        {saving ? "שומר..." : "שמור"}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        style={{
                          padding: "6px 14px", borderRadius: 8, border: "1px solid #333",
                          background: "transparent", color: "#666",
                          fontSize: 12, fontFamily: "inherit", cursor: "pointer",
                        }}
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Read view */
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                    <div style={{ flex: 1 }}>
                      {track.notes && (
                        <div style={{ fontSize: 12, color: "#666", lineHeight: 1.5 }}>{track.notes}</div>
                      )}
                      {!track.notes && (
                        <div style={{ fontSize: 12, color: "#333" }}>אין הערות</div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => startEdit(track)}
                        style={{
                          padding: "5px 12px", borderRadius: 7, border: "1px solid #2A2A2A",
                          background: "transparent", color: "#666",
                          fontSize: 11, fontFamily: "inherit", cursor: "pointer",
                        }}
                      >
                        ✏ ערוך
                      </button>
                      <button
                        onClick={() => deleteTrack(track.id)}
                        style={{
                          padding: "5px 10px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.2)",
                          background: "transparent", color: "#EF4444",
                          fontSize: 11, fontFamily: "inherit", cursor: "pointer",
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                )}

                {/* Versions / files linked to this track */}
                <div>
                  <div style={{ fontSize: 10, color: "#555", fontWeight: 700, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>גרסאות ({trackFiles.length})</span>
                    {/* Per-track upload — version label defaults to first available */}
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {VERSION_LABELS.slice(0, 4).map((label) => (
                        <VersionUploadChip
                          key={label}
                          label={label}
                          project={project}
                          trackId={track.id}
                          accentColor={accentColor}
                          onDone={load}
                        />
                      ))}
                    </div>
                  </div>

                  {trackFiles.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#2A2A2A", padding: "10px 0" }}>
                      עדיין לא הועלו קבצים לשיר הזה
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {trackFiles.map((f, fi) => (
                        <FileRow key={fi} file={f} project={project} player={player} accentColor={accentColor} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Unlinked files section — legacy uploads not tied to a track */}
      {unlinkedFiles.length > 0 && (
        <div style={{ marginTop: 24, padding: "16px", background: "#1A1A1A", border: "1px solid #252525", borderRadius: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 12 }}>
            קבצים כלליים ({unlinkedFiles.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {unlinkedFiles.map((f, fi) => (
              <FileRow key={fi} file={f} project={project} player={player} accentColor={accentColor} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function FileRow({
  file,
  project,
  player,
  accentColor,
}: {
  file: FileLink;
  project: Project;
  player: ReturnType<typeof usePlayerSafe>;
  accentColor: string;
}) {
  const canPlay = isAudio(file.name) && !!file.url;
  const isPlaying =
    player?.playing &&
    player.track?.projectId === project.id &&
    player.track?.fileName === file.name;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 10px", background: "#0E0E0E", borderRadius: 8,
      border: "1px solid #1E1E1E",
    }}>
      {/* Play */}
      <button
        onClick={() => {
          if (!player || !canPlay) return;
          if (isPlaying) player.pause();
          else player.play({ projectId: project.id, projectName: project.name, artist: project.artist, fileName: file.name, url: file.url });
        }}
        disabled={!canPlay}
        title={canPlay ? (isPlaying ? "השהה" : "נגן") : "לא ניתן לנגן"}
        style={{
          width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
          border: canPlay ? "1px solid #3B82F633" : "1px solid #1E1E1E",
          background: isPlaying ? "#3B82F622" : "transparent",
          color: canPlay ? (isPlaying ? "#3B82F6" : "#555") : "#2A2A2A",
          cursor: canPlay ? "pointer" : "not-allowed",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 8, fontFamily: "inherit",
        }}
      >
        {isPlaying ? "⏸" : "▶"}
      </button>

      {/* Version label */}
      {file.versionLabel && (
        <span style={{
          fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
          background: "rgba(59,130,246,0.12)", color: "#3B82F6",
          border: "1px solid rgba(59,130,246,0.2)", flexShrink: 0,
        }}>
          {file.versionLabel}
        </span>
      )}

      {/* Name */}
      <span style={{ flex: 1, fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {file.name}
      </span>

      {/* Open link */}
      {(file.dropboxShareUrl || file.url) && (
        <a
          href={file.dropboxShareUrl || file.url}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 11, color: "#3B82F6", textDecoration: "none", flexShrink: 0,
            padding: "2px 8px", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 5,
          }}
        >
          ↗
        </a>
      )}
    </div>
  );
}

function VersionUploadChip({
  label,
  project,
  trackId,
  accentColor,
  onDone,
}: {
  label: string;
  project: Project;
  trackId: string;
  accentColor: string;
  onDone: () => void;
}) {
  const [active, setActive] = useState(false);

  if (!active) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setActive(true); }}
        style={{
          fontSize: 9, padding: "2px 7px", borderRadius: 5,
          border: "1px solid #2A2A2A", background: "transparent", color: "#555",
          cursor: "pointer", fontFamily: "inherit",
        }}
      >
        + {label}
      </button>
    );
  }

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 9, color: accentColor }}>{label}:</span>
      <div style={{ transform: "scale(0.85)", transformOrigin: "right center" }}>
        <UploadButton
          projectId={project.id}
          projectName={project.name}
          artist={project.artist}
          existingFiles={project.files}
          size="sm"
          trackId={trackId}
          versionLabel={label}
        />
      </div>
    </div>
  );
}
