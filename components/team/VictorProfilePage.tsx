"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useProjects } from "@/components/ProjectsProvider";
import type { VictorMonthStats, VendorWork, VictorSalaryMonth, FileLink } from "@/lib/types";

const BRAND   = "#DC2626";
const CARD    = "#111318";
const CARD2   = "#0D0D12";
const BDR     = "rgba(255,255,255,0.07)";
const BDR2    = "rgba(255,255,255,0.11)";
const TEXT    = "#F2F2F2";
const TEXT2   = "#A0A0B0";
const MUTED   = "#52526A";
const GREEN   = "#10B981";
const PURPLE  = "#8B5CF6";
const AMBER   = "#F59E0B";
const RED     = "#EF4444";
const BG      = "#0A0A0D";

const npInputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 10, border: `1px solid ${BDR2}`,
  background: CARD2, color: TEXT, fontSize: 13, fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};

function fmt(n: number, curr = "$") {
  return `${curr}${n.toLocaleString()}`;
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
  } catch { return d; }
}
function monthLabel(ym: string) {
  try {
    const [y, m] = ym.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" });
  } catch { return ym; }
}
function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "פעיל":         { bg: "rgba(245,158,11,0.12)",  color: AMBER  },
  "הושלם":        { bg: "rgba(139,92,246,0.12)",  color: PURPLE },
  "בוטל":         { bg: "rgba(239,68,68,0.12)",   color: RED    },
  "ממתין":        { bg: "rgba(82,82,106,0.12)",   color: MUTED  },
  "נשלח":         { bg: "rgba(59,130,246,0.12)",  color: "#60A5FA" },
  "הושלם ✓":      { bg: "rgba(16,185,129,0.12)",  color: GREEN  },
};
const SALARY_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "שולם":         { bg: "rgba(16,185,129,0.12)", color: GREEN  },
  "נשלח לכספים": { bg: "rgba(139,92,246,0.12)", color: PURPLE },
  "צפוי":         { bg: "rgba(245,158,11,0.12)", color: AMBER  },
  "לא שולם":      { bg: "rgba(239,68,68,0.12)",  color: RED    },
  "חלקי":         { bg: "rgba(245,158,11,0.12)", color: AMBER  },
  "בוטל":         { bg: "rgba(82,82,106,0.12)",  color: MUTED  },
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? { bg: "rgba(255,255,255,0.06)", color: TEXT2 };
  return (
    <span style={{
      padding: "2px 9px", borderRadius: 7,
      background: s.bg, color: s.color,
      fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
    }}>{status}</span>
  );
}

function SalaryChip({ status }: { status: string }) {
  const s = SALARY_STATUS_COLORS[status] ?? { bg: "rgba(255,255,255,0.06)", color: TEXT2 };
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 6,
      background: s.bg, color: s.color,
      fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
    }}>{status}</span>
  );
}

const VICTOR_WORK_STATUSES = ["פעיל", "הושלם", "בוטל"] as const;

function WorkStatusDropdown({
  workId,
  status,
  workProjectId,
  workProjectName,
  onUpdated,
}: {
  workId: string;
  status: string;
  workProjectId?: string;
  workProjectName?: string;
  onUpdated?: (newStatus: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState(status);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);

  const hasLinkedProject = !!(workProjectId && workProjectName && workProjectName !== "פרויקט לא ידוע");

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      // Menu is portaled outside `ref`, so check both the button wrapper and the menu.
      const inBtn  = ref.current?.contains(t);
      const inMenu = menuRef.current?.contains(t);
      if (!inBtn && !inMenu) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const col = STATUS_COLORS[localStatus] ?? { bg: "rgba(255,255,255,0.06)", color: TEXT2 };

  async function doUpdateWork(projectToo: boolean) {
    setShowConfirm(false);
    const prev = localStatus;
    setLocalStatus("הושלם");
    setSaving(true);
    try {
      const res = await fetch(`/api/vendor/victor/work/${workId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "הושלם" }),
      });
      if (!res.ok) throw new Error(`PATCH work ${res.status}`);

      if (projectToo && workProjectId) {
        const projRes = await fetch(`/api/projects/${workProjectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field: "status", value: "הושלם" }),
        });
        if (!projRes.ok) {
          console.warn(`[WorkStatusDropdown] עדכון פרויקט נכשל: PATCH /api/projects/${workProjectId} → ${projRes.status}`);
        }
      }

      onUpdated?.("הושלם");
    } catch (err) {
      console.warn("[WorkStatusDropdown] שגיאה בעדכון סטטוס:", err);
      setLocalStatus(prev);
    } finally {
      setSaving(false);
    }
  }

  async function handleSelect(next: string) {
    if (next === localStatus || saving) return;
    setOpen(false);

    if (next === "הושלם" && hasLinkedProject) {
      setShowConfirm(true);
      return;
    }

    const prev = localStatus;
    setLocalStatus(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/vendor/victor/work/${workId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      onUpdated?.(next);
    } catch (err) {
      console.warn("[WorkStatusDropdown] שגיאה בעדכון סטטוס:", err);
      setLocalStatus(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={btnRef}
        onClick={e => {
          e.stopPropagation();
          if (saving) return;
          if (!open) setMenuRect(btnRef.current?.getBoundingClientRect() ?? null);
          setOpen(o => !o);
        }}
        style={{
          padding: "2px 9px", borderRadius: 7,
          background: col.bg, color: col.color,
          fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
          border: `1px solid ${col.color}44`,
          cursor: saving ? "default" : "pointer",
          opacity: saving ? 0.6 : 1,
          outline: "none", fontFamily: "inherit",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}
      >
        {localStatus}
        <span style={{ fontSize: 8, opacity: 0.5 }}>{saving ? "…" : "▾"}</span>
      </button>

      {open && menuRect && createPortal(
        <div ref={menuRef} style={{
          position: "fixed", top: menuRect.bottom + 4, left: menuRect.left, zIndex: 9999,
          background: "#141414", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.8)",
          padding: "4px 0", minWidth: 90, direction: "rtl",
        }}>
          {VICTOR_WORK_STATUSES.map(opt => {
            const oc = STATUS_COLORS[opt] ?? { bg: "rgba(255,255,255,0.06)", color: TEXT2 };
            const isActive = localStatus === opt;
            return (
              <button
                key={opt}
                onClick={() => handleSelect(opt)}
                style={{
                  display: "block", width: "100%", textAlign: "right",
                  padding: "7px 12px",
                  background: isActive ? oc.bg : "transparent",
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                  fontSize: 12, fontWeight: isActive ? 700 : 500,
                  color: oc.color, direction: "rtl",
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                {opt}
              </button>
            );
          })}
        </div>,
        document.body
      )}

      {showConfirm && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: "fixed", inset: 0, zIndex: 99998,
            background: "rgba(0,0,0,0.65)", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{
            background: "#111318",
            border: "1px solid rgba(220,38,38,0.3)",
            borderRadius: 16,
            padding: "24px 28px",
            maxWidth: 380,
            width: "90%",
            direction: "rtl",
            boxShadow: "0 16px 48px rgba(0,0,0,0.8)",
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#F2F2F2", marginBottom: 8 }}>
              סמן פרויקט כהושלם?
            </div>
            <div style={{ fontSize: 13, color: "#A0A0B0", marginBottom: 22, lineHeight: 1.5 }}>
              העבודה מקושרת לפרויקט{workProjectName ? ` "${workProjectName}"` : ""}.
              לסמן גם את הפרויקט כהושלם?
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-start" }}>
              <button
                onClick={() => doUpdateWork(true)}
                disabled={saving}
                style={{
                  padding: "9px 18px", borderRadius: 10, border: "none",
                  background: saving ? "#52526A" : "#10B981",
                  color: "#fff", fontSize: 13, fontWeight: 800,
                  cursor: saving ? "default" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {saving ? "…" : "כן, סמן הכול כהושלם"}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                disabled={saving}
                style={{
                  padding: "9px 16px", borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "transparent",
                  color: "#A0A0B0", fontSize: 13, fontWeight: 700,
                  cursor: saving ? "default" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                בטל
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function daysFromNow(d: string | null): number | null {
  if (!d) return null;
  try {
    const diff = new Date(d).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  } catch { return null; }
}

function isAudioFile(name: string): boolean {
  return /\.(wav|mp3|m4a|aiff|flac|ogg|aac|opus)$/i.test(name);
}

function toDirectUrl(url: string): string {
  return url
    .replace("www.dropbox.com", "dl.dropboxusercontent.com")
    .replace("?dl=0", "").replace("&dl=0", "");
}

function fileExt(name: string): string {
  return (name.split(".").pop() ?? "").toUpperCase().slice(0, 4);
}

function downloadFile(file: FileLink) {
  const rawUrl = file.dropboxShareUrl || file.url || "";
  if (!rawUrl) return;
  // Force direct download via ?dl=1
  const dlUrl = rawUrl
    .replace("www.dropbox.com", "www.dropbox.com")
    .replace(/[?&]dl=\d/, "")
    .replace(/\?$/, "") + (rawUrl.includes("dropbox.com") ? (rawUrl.includes("?") ? "&dl=1" : "?dl=1") : "");
  const a = document.createElement("a");
  a.href = dlUrl;
  a.download = file.name;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function AudioPlayer({
  file,
  onDownload,
  onDelete,
  deleteConfirm,
  onDeleteConfirm,
  onDeleteCancel,
  deleting,
  deleteError,
}: {
  file: FileLink;
  onDownload: () => void;
  onDelete: () => void;
  deleteConfirm: boolean;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  deleting: boolean;
  deleteError: boolean;
}) {
  const { name } = file;
  const url = file.dropboxShareUrl || file.url || "";
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useState<HTMLAudioElement | null>(null);
  const ref = audioRef;

  function getOrCreateAudio(): HTMLAudioElement {
    if (!ref[0]) {
      const a = new Audio(toDirectUrl(url));
      a.preload = "metadata";
      a.onended = () => setPlaying(false);
      a.ontimeupdate = () => {
        if (a.duration) setProgress((a.currentTime / a.duration) * 100);
      };
      a.ondurationchange = () => setDuration(a.duration || 0);
      ref[0] = a;
    }
    return ref[0];
  }

  function togglePlay(e: React.MouseEvent) {
    e.stopPropagation();
    const a = getOrCreateAudio();
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => {}); setPlaying(true); }
  }

  function fmtTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  const hasUrl = !!url;
  const hasPath = !!file.dropboxPath;

  return (
    <div style={{ borderRadius: 10, background: CARD2, border: `1px solid ${BDR}`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px" }}>
        <button onClick={togglePlay} style={{
          width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
          background: playing ? PURPLE : `${PURPLE}22`, border: `1px solid ${PURPLE}55`,
          color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontFamily: "inherit", outline: "none",
        }}>
          {playing ? "⏸" : "▶"}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 5 }}>
            {name}
          </div>
          {/* Progress bar with padding for larger hit area */}
          <div
            style={{ padding: "3px 0", cursor: "pointer", position: "relative" }}
            onClick={e => {
              e.stopPropagation();
              const a = getOrCreateAudio();
              if (!a.duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration;
            }}
          >
            <div style={{ height: 8, background: "rgba(255,255,255,0.1)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progress}%`, background: PURPLE, borderRadius: 4 }} />
            </div>
          </div>
        </div>
        <span style={{ fontSize: 10, color: MUTED, flexShrink: 0 }}>
          {duration > 0 ? fmtTime(duration) : "—"}
        </span>
        {/* Download button */}
        <button
          onClick={e => { e.stopPropagation(); onDownload(); }}
          disabled={!hasUrl}
          title={hasUrl ? "הורדה" : "אין קישור להורדה"}
          style={{
            background: "none", border: "none", cursor: hasUrl ? "pointer" : "not-allowed",
            color: hasUrl ? MUTED : `${MUTED}55`, fontSize: 14, padding: "2px 4px",
            flexShrink: 0, outline: "none",
          }}
        >⬇</button>
        {/* Delete button */}
        <button
          onClick={e => { e.stopPropagation(); onDeleteConfirm(); }}
          disabled={!hasPath}
          title={hasPath ? "מחק קובץ" : "אין מסלול Dropbox"}
          style={{
            background: "none", border: "none", cursor: hasPath ? "pointer" : "not-allowed",
            color: hasPath ? MUTED : `${MUTED}55`, fontSize: 14, padding: "2px 4px",
            flexShrink: 0, outline: "none",
          }}
        >🗑</button>
      </div>
      {/* Inline delete confirm */}
      {deleteConfirm && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: `1px solid rgba(239,68,68,0.2)`, background: "rgba(239,68,68,0.06)" }}>
          <span style={{ fontSize: 11, color: RED, fontWeight: 700, flex: 1 }}>למחוק?</span>
          {deleteError && <span style={{ fontSize: 10, color: RED }}>שגיאה — נסה שוב</span>}
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            disabled={deleting}
            style={{ padding: "3px 12px", borderRadius: 7, fontSize: 11, fontWeight: 800, background: deleting ? MUTED : RED, border: "none", color: "#fff", cursor: deleting ? "default" : "pointer", fontFamily: "inherit", outline: "none" }}
          >{deleting ? "…" : "אישור"}</button>
          <button
            onClick={e => { e.stopPropagation(); onDeleteCancel(); }}
            disabled={deleting}
            style={{ padding: "3px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700, background: CARD, border: `1px solid ${BDR2}`, color: TEXT2, cursor: deleting ? "default" : "pointer", fontFamily: "inherit", outline: "none" }}
          >בטל</button>
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  onDownload,
  onDelete,
  deleteConfirm,
  onDeleteConfirm,
  onDeleteCancel,
  deleting,
  deleteError,
}: {
  file: FileLink;
  onDownload: () => void;
  onDelete: () => void;
  deleteConfirm: boolean;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  deleting: boolean;
  deleteError: boolean;
}) {
  const { name } = file;
  const hasUrl = !!(file.dropboxShareUrl || file.url);
  const hasPath = !!file.dropboxPath;

  return (
    <div style={{ borderRadius: 10, background: CARD2, border: `1px solid ${BDR}`, overflow: "hidden" }}>
      <div
        onClick={() => { if (hasUrl) onDownload(); }}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: hasUrl ? "pointer" : "default" }}
      >
        <span style={{ fontSize: 18, flexShrink: 0 }}>📄</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{fileExt(name)}</div>
        </div>
        {/* Download button */}
        <button
          onClick={e => { e.stopPropagation(); onDownload(); }}
          disabled={!hasUrl}
          title={hasUrl ? "הורדה" : "אין קישור להורדה"}
          style={{
            background: "none", border: "none", cursor: hasUrl ? "pointer" : "not-allowed",
            color: hasUrl ? MUTED : `${MUTED}55`, fontSize: 14, padding: "2px 4px",
            flexShrink: 0, outline: "none",
          }}
        >⬇</button>
        {/* Delete button */}
        <button
          onClick={e => { e.stopPropagation(); onDeleteConfirm(); }}
          disabled={!hasPath}
          title={hasPath ? "מחק קובץ" : "אין מסלול Dropbox"}
          style={{
            background: "none", border: "none", cursor: hasPath ? "pointer" : "not-allowed",
            color: hasPath ? MUTED : `${MUTED}55`, fontSize: 14, padding: "2px 4px",
            flexShrink: 0, outline: "none",
          }}
        >🗑</button>
      </div>
      {/* Inline delete confirm */}
      {deleteConfirm && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: `1px solid rgba(239,68,68,0.2)`, background: "rgba(239,68,68,0.06)" }}>
          <span style={{ fontSize: 11, color: RED, fontWeight: 700, flex: 1 }}>למחוק?</span>
          {deleteError && <span style={{ fontSize: 10, color: RED }}>שגיאה — נסה שוב</span>}
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            disabled={deleting}
            style={{ padding: "3px 12px", borderRadius: 7, fontSize: 11, fontWeight: 800, background: deleting ? MUTED : RED, border: "none", color: "#fff", cursor: deleting ? "default" : "pointer", fontFamily: "inherit", outline: "none" }}
          >{deleting ? "…" : "אישור"}</button>
          <button
            onClick={e => { e.stopPropagation(); onDeleteCancel(); }}
            disabled={deleting}
            style={{ padding: "3px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700, background: CARD, border: `1px solid ${BDR2}`, color: TEXT2, cursor: deleting ? "default" : "pointer", fontFamily: "inherit", outline: "none" }}
          >בטל</button>
        </div>
      )}
    </div>
  );
}

function VictorProjectDrawer({
  work,
  onClose,
  onRefresh,
}: {
  work: VendorWork;
  onClose: () => void;
  onRefresh?: () => void;
}) {
  const router = useRouter();
  const [updating, setUpdating] = useState(false);
  const [notes, setNotes] = useState(work.notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [effectiveFolder, setEffectiveFolder] = useState<string | null>(work.dropboxFolder ?? null);
  const [effectiveShareLink, setEffectiveShareLink] = useState<string | null>(work.dropboxShareLink ?? null);
  const [effectiveFiles, setEffectiveFiles] = useState<FileLink[]>(work.filesSent ?? []);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteConfirmIdx, setDeleteConfirmIdx] = useState<number | null>(null);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function patchWork(fields: Partial<VendorWork>) {
    setUpdating(true);
    try {
      await fetch(`/api/vendor/victor/work/${work.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      onRefresh?.();
    } finally {
      setUpdating(false);
    }
  }

  async function handleDeleteFile(file: FileLink, idx: number) {
    setDeleteConfirmIdx(null);
    setDeletingIdx(idx);
    setDeleteError(false);
    try {
      const delRes = await fetch("/api/dropbox/vendor-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropboxPath: file.dropboxPath }),
      });
      if (!delRes.ok) {
        setDeleteError(true);
        setDeletingIdx(null);
        return;
      }
      const filtered = effectiveFiles.filter((_, i) => i !== idx);
      await fetch(`/api/vendor/victor/work/${work.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filesSent: filtered }),
      });
      setEffectiveFiles(filtered);
      onRefresh?.();
    } catch {
      setDeleteError(true);
    } finally {
      setDeletingIdx(null);
    }
  }

  async function handleUpload(file: File) {
    if (!effectiveFolder) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("workId", work.id);
      fd.append("dropboxFolder", effectiveFolder);
      fd.append("subFolder", "Production");
      const responseText = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/dropbox/vendor-upload");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100));
        };
        xhr.onload = () => xhr.status === 200 ? resolve(xhr.responseText) : reject(new Error(xhr.responseText));
        xhr.onerror = () => reject(new Error("שגיאת רשת"));
        xhr.send(fd);
      });
      try {
        const data = JSON.parse(responseText) as { ok: boolean; file?: FileLink };
        if (data.ok && data.file) {
          setEffectiveFiles(prev => [...prev, data.file!]);
        }
      } catch {}
      onRefresh?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה בהעלאת הקובץ";
      setUploadError(msg);
      console.error("upload failed", err);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleCreateFolder() {
    setCreatingFolder(true);
    setFolderError(null);
    try {
      const res = await fetch("/api/dropbox/vendor-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName: "Victor",
          artistName: work.artist || "Unknown",
          projectName: work.projectName || "Unknown",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "שגיאה ביצירת התיקייה");
      const res2 = await fetch(`/api/vendor/victor/work/${work.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropboxFolder: data.folderPath, dropboxShareLink: data.shareLink }),
      });
      if (!res2.ok) throw new Error("שגיאה בשמירת הנתונים");
      setEffectiveFolder(data.folderPath);
      setEffectiveShareLink(data.shareLink);
      onRefresh?.();
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "שגיאה ביצירת התיקייה");
    } finally {
      setCreatingFolder(false);
    }
  }

  async function saveNotes() {
    if (!notesDirty) return;
    setNotesDirty(false);
    await patchWork({ notes });
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  const files = [
    ...(work.filesReceived ?? []).map(f => ({ ...f, dir: "in" as const })),
    ...(effectiveFiles).map(f => ({ ...f, dir: "out" as const })),
  ];

  const days = daysFromNow(work.internalDeadline);

  const tasks: {
    label: string;
    done: boolean;
    date: string | null;
    action?: () => void;
  }[] = [
    {
      label: "נשלח לויקטור",
      done: !!work.sentDate,
      date: work.sentDate,
      action: !work.sentDate ? () => patchWork({ sentDate: todayISO(), workState: "נשלח לויקטור" }) : undefined,
    },
    {
      label: "חזר מויקטור",
      done: !!work.returnedDate,
      date: work.returnedDate,
      action: !work.returnedDate ? () => patchWork({ returnedDate: todayISO(), workState: "חזר מויקטור" }) : undefined,
    },
    {
      label: "בדיקה ואישור",
      done: work.outcome === "אושר" || work.outcome === "נכנס לפרויקט בפועל",
      date: null,
      action: work.outcome !== "אושר" && work.outcome !== "נכנס לפרויקט בפועל"
        ? () => patchWork({ outcome: "אושר" })
        : undefined,
    },
    {
      label: "פרויקט הושלם",
      done: work.status === "הושלם",
      date: null,
      action: work.status !== "הושלם" ? () => patchWork({ status: "הושלם" }) : undefined,
    },
  ];

  const doneCount = tasks.filter(t => t.done).length;

  const timingColor = days === null ? MUTED : days < 0 ? RED : days <= 3 ? AMBER : GREEN;
  const timingLabel = days === null ? null : days < 0 ? `${Math.abs(days)} ימים באיחור` : days === 0 ? "היום!" : `${days} ימים נותרו`;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", top: 60, bottom: 0, left: 0, right: 248,
          background: "rgba(0,0,0,0.60)", backdropFilter: "blur(2px)",
          zIndex: 1000,
        }}
      />

      {/* Panel */}
      <div style={{
        position: "fixed", top: 60, bottom: 0, left: 0,
        width: 490, zIndex: 1001,
        background: "#090910",
        borderRight: `1px solid ${BDR2}`,
        boxShadow: "6px 0 48px rgba(0,0,0,0.75)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        direction: "rtl",
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: "18px 22px 16px",
          borderBottom: `1px solid ${BDR}`,
          background: "linear-gradient(160deg, #0F0F18 0%, #0B0B12 100%)",
          flexShrink: 0,
        }}>

          {/* Row 1: close + open-in-projects */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <button onClick={onClose} style={{
              background: "rgba(255,255,255,0.06)", border: `1px solid ${BDR2}`,
              borderRadius: 8, cursor: "pointer", padding: "4px 10px",
              color: TEXT2, fontSize: 13, lineHeight: 1, fontFamily: "inherit",
              fontWeight: 700,
            }}>✕</button>
            {work.projectId ? (
              <button
                onClick={() => router.push(`/projects?open=${work.projectId}`)}
                style={{
                  background: `${PURPLE}18`, border: `1px solid ${PURPLE}44`,
                  color: PURPLE, fontSize: 11, fontWeight: 800,
                  padding: "6px 14px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                  letterSpacing: "0.03em",
                }}
              >
                פתח בפרויקטים ↗
              </button>
            ) : (
              <span style={{ fontSize: 11, color: MUTED }}>אין פרויקט מקושר</span>
            )}
          </div>

          {/* Row 2: music icon + project name */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, flexShrink: 0,
              background: `linear-gradient(135deg, ${PURPLE}30, ${PURPLE}10)`,
              border: `1px solid ${PURPLE}44`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20,
            }}>🎵</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 20, fontWeight: 900, color: TEXT,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                letterSpacing: "-0.02em", lineHeight: 1.15, marginBottom: 4,
              }}>
                {work.projectName}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: TEXT2, fontWeight: 500 }}>{work.artist || "—"}</span>
                <span style={{ color: BDR2, fontSize: 10 }}>·</span>
                <span style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 6,
                  background: `${PURPLE}20`, color: PURPLE, fontWeight: 800, letterSpacing: "0.04em",
                }}>VICTOR</span>
                <WorkStatusDropdown
                  workId={work.id}
                  status={work.status}
                  workProjectId={work.projectId}
                  workProjectName={work.projectName}
                  onUpdated={() => { onRefresh?.(); }}
                />
                {work.workState && <StatusChip status={work.workState} />}
              </div>
            </div>
          </div>

          {/* Row 3: deadline + timing chip */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {work.internalDeadline ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 12, color: MUTED }}>📅 דד-ליין:</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: TEXT2 }}>{fmtDate(work.internalDeadline)}</span>
                </div>
                {timingLabel && (
                  <span style={{
                    fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 8,
                    background: `${timingColor}18`,
                    border: `1px solid ${timingColor}44`,
                    color: timingColor,
                  }}>
                    {timingLabel}
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: 12, color: MUTED }}>אין דד-ליין מוגדר</span>
            )}
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Files card */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: files.length > 0 ? `1px solid ${BDR}` : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>📁</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>קבצים</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
                />
                {!effectiveFolder ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <button
                      onClick={handleCreateFolder}
                      disabled={creatingFolder}
                      style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 7,
                        background: creatingFolder ? "rgba(255,255,255,0.05)" : "rgba(0,98,238,0.12)",
                        border: "1px solid rgba(0,98,238,0.3)",
                        color: creatingFolder ? "#52526A" : "#4A9EFF",
                        cursor: creatingFolder ? "not-allowed" : "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {creatingFolder ? "יוצר..." : "צור תיקיית Dropbox"}
                    </button>
                    {folderError && (
                      <span style={{ fontSize: 10, color: "#EF4444" }}>{folderError}</span>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title="העלאת קובץ"
                    style={{
                      fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 7,
                      background: uploading ? "rgba(255,255,255,0.05)" : "rgba(16,185,129,0.12)",
                      border: "1px solid rgba(16,185,129,0.3)",
                      color: uploading ? "#52526A" : "#10B981",
                      cursor: uploading ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {uploading ? `${uploadProgress}%` : "↑ העלאה"}
                  </button>
                )}
                {effectiveShareLink && (
                  <a
                    href={effectiveShareLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 7,
                      background: "rgba(0,98,238,0.12)", border: "1px solid rgba(0,98,238,0.3)",
                      color: "#4A9EFF", textDecoration: "none",
                    }}
                  >
                    פתח ב-Dropbox ↗
                  </a>
                )}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                  background: files.length > 0 ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.06)",
                  color: files.length > 0 ? GREEN : MUTED,
                }}>{files.length} קבצים</span>
              </div>
            </div>

            {uploadError && (
              <div style={{ fontSize: 11, color: "#EF4444", padding: "4px 16px 2px", fontWeight: 600 }}>{uploadError}</div>
            )}

            {files.length === 0 ? (
              <div style={{ padding: "28px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.25 }}>📂</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT2, marginBottom: 4 }}>אין קבצים לפרויקט זה</div>
                <div style={{ fontSize: 11, color: MUTED }}>קבצים שייושלחו ויתקבלו יופיעו כאן</div>
              </div>
            ) : (
              <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
                {(() => {
                  let outIdx = -1;
                  return files.map((f, i) => {
                    const isSent = f.dir === "out";
                    if (isSent) outIdx++;
                    const idx = outIdx;
                    const props = {
                      file: f,
                      onDownload: () => downloadFile(f),
                      deleteConfirm: isSent && deleteConfirmIdx === idx,
                      onDeleteConfirm: isSent ? () => { setDeleteConfirmIdx(idx); setDeleteError(false); } : () => {},
                      onDeleteCancel: () => { setDeleteConfirmIdx(null); setDeleteError(false); },
                      onDelete: isSent ? () => handleDeleteFile(f, idx) : () => {},
                      deleting: isSent && deletingIdx === idx,
                      deleteError: deleteError && deletingIdx === idx,
                    };
                    return isAudioFile(f.name) ? (
                      <AudioPlayer key={i} {...props} />
                    ) : (
                      <FileRow key={i} {...props} />
                    );
                  });
                })()}
              </div>
            )}
          </div>

          {/* Tasks card */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: `1px solid ${BDR}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>✅</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>התקדמות</span>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                background: doneCount === tasks.length ? "rgba(16,185,129,0.12)" : "rgba(139,92,246,0.12)",
                color: doneCount === tasks.length ? GREEN : PURPLE,
              }}>{doneCount} / {tasks.length}</span>
            </div>

            {/* Progress bar */}
            <div style={{ height: 3, background: BDR, margin: "0" }}>
              <div style={{
                height: "100%",
                width: `${(doneCount / tasks.length) * 100}%`,
                background: `linear-gradient(90deg, ${PURPLE}, ${GREEN})`,
                transition: "width 0.4s ease",
              }} />
            </div>

            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {tasks.map((t, i) => (
                <div
                  key={i}
                  onClick={t.action && !updating ? t.action : undefined}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 12px", borderRadius: 10,
                    background: t.done ? `${GREEN}08` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${t.done ? GREEN + "28" : BDR}`,
                    cursor: t.action && !updating ? "pointer" : "default",
                    opacity: updating ? 0.6 : 1,
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                    border: `2px solid ${t.done ? GREEN : BDR2}`,
                    background: t.done ? `${GREEN}25` : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, color: GREEN, fontWeight: 900,
                  }}>
                    {t.done ? "✓" : ""}
                  </div>
                  <span style={{
                    flex: 1, fontSize: 13, fontWeight: t.done ? 700 : 500,
                    color: t.done ? TEXT : TEXT2,
                  }}>
                    {t.label}
                  </span>
                  {t.date ? (
                    <span style={{
                      fontSize: 10, color: MUTED, flexShrink: 0,
                      background: "rgba(255,255,255,0.04)", padding: "2px 7px", borderRadius: 5,
                    }}>{fmtDate(t.date)}</span>
                  ) : t.action && !t.done ? (
                    <span style={{ fontSize: 10, color: PURPLE, fontWeight: 700 }}>סמן ✓</span>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Notes */}
            <div style={{ margin: "0 16px 14px" }}>
              {work.outcome && (
                <div style={{ fontSize: 11, color: PURPLE, fontWeight: 800, marginBottom: 6 }}>
                  תוצאה: {work.outcome}
                </div>
              )}
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); setNotesDirty(true); }}
                onBlur={saveNotes}
                placeholder="הוסף הערות..."
                rows={2}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 10, fontSize: 12,
                  background: CARD2, border: `1px solid ${BDR}`,
                  color: TEXT2, outline: "none", fontFamily: "inherit",
                  resize: "vertical", lineHeight: 1.5, boxSizing: "border-box",
                  direction: "rtl",
                }}
              />
            </div>
          </div>

          {/* Bottom 2 cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

            {/* Deadline card */}
            <div style={{
              background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "14px 16px",
              borderTop: `3px solid ${work.internalDeadline ? (days !== null && days < 0 ? RED : AMBER) : BDR}`,
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>📅 דד-ליין</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: days !== null && days < 0 ? RED : TEXT, letterSpacing: "-0.02em", marginBottom: 4 }}>
                {work.internalDeadline ? fmtDate(work.internalDeadline) : "—"}
              </div>
              {days !== null && (
                <div style={{ fontSize: 11, color: timingColor, fontWeight: 700 }}>
                  {days < 0 ? `${Math.abs(days)} ימים אחרי` : days === 0 ? "היום!" : `${days} ימים נותרו`}
                </div>
              )}
            </div>

            {/* Sent/returned dates card */}
            <div style={{
              background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "14px 16px",
              borderTop: `3px solid ${PURPLE}`,
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>🔄 מעקב</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {work.sentDate ? (
                  <div>
                    <div style={{ fontSize: 10, color: MUTED, marginBottom: 2 }}>📤 נשלח</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TEXT2 }}>{fmtDate(work.sentDate)}</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: MUTED }}>טרם נשלח</div>
                )}
                {work.returnedDate && (
                  <div>
                    <div style={{ fontSize: 10, color: MUTED, marginBottom: 2 }}>📥 חזר</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{fmtDate(work.returnedDate)}</div>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ── Remove from Victor board ── */}
          {!confirmRemove ? (
            <button
              onClick={() => { setConfirmRemove(true); setRemoveError(null); }}
              style={{
                width: "100%", padding: "11px 0", borderRadius: 12,
                background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)",
                color: "#FCA5A5", fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              מחק פרויקט 🗑
            </button>
          ) : (
            <div style={{
              borderRadius: 12, background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              padding: "12px 16px",
            }}>
              <div style={{ fontSize: 12, color: "#FCA5A5", fontWeight: 700, marginBottom: 10, textAlign: "center" }}>
                למחוק מעמוד ויקטור?
              </div>
              {removeError && (
                <div style={{ fontSize: 11, color: "#FCA5A5", marginBottom: 8, textAlign: "center" }}>
                  {removeError}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={async () => {
                    setRemoving(true);
                    setRemoveError(null);
                    try {
                      // Step 1: delete linked task (if exists)
                      if (work.linkedTaskId) {
                        const taskRes = await fetch(`/api/tasks/${work.linkedTaskId}`, { method: "DELETE" });
                        if (!taskRes.ok) {
                          const taskData = await taskRes.json().catch(() => ({}));
                          setRemoveError(taskData.error ?? "מחיקת משימת המעקב נכשלה");
                          setRemoving(false);
                          return;
                        }
                      }
                      // Step 2: delete vendor_project_work record
                      const workRes = await fetch(`/api/vendor/victor/work/${work.id}`, { method: "DELETE" });
                      if (!workRes.ok) {
                        setRemoveError("מחיקת הפרויקט מויקטור נכשלה");
                        setRemoving(false);
                        return;
                      }
                      onRefresh?.();
                      onClose();
                    } catch {
                      setRemoveError("שגיאת רשת — נסה שוב");
                      setRemoving(false);
                    }
                  }}
                  disabled={removing}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 9, border: "none",
                    background: removing ? "#52526A" : "#EF4444",
                    color: "#fff", fontSize: 13, fontWeight: 800,
                    cursor: removing ? "default" : "pointer", fontFamily: "inherit",
                  }}
                >
                  {removing ? "מוחק..." : "אישור"}
                </button>
                <button
                  onClick={() => { setConfirmRemove(false); setRemoveError(null); }}
                  disabled={removing}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 9,
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                    color: "#A0A0B0", fontSize: 13, fontWeight: 700,
                    cursor: removing ? "default" : "pointer", fontFamily: "inherit",
                  }}
                >
                  בטל
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

export default function VictorProfilePage() {
  const router = useRouter();
  const { createProject } = useProjects();

  // ── New-project modal (simplified: Victor beat/idea — no artist/type fields) ──
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [npName,     setNpName]     = useState("");
  // Victor work status (not the general project status) — defaults to "פעיל".
  const [npStatus,   setNpStatus]   = useState<string>("פעיל");
  const [npDeadline, setNpDeadline] = useState("");
  const [npNotes,    setNpNotes]    = useState("");
  const [npSaving,   setNpSaving]   = useState(false);
  const [npError,    setNpError]    = useState("");
  const [toast,      setToast]      = useState<string | null>(null);

  function openNewProject() {
    setNpName(""); setNpStatus("פעיל");
    setNpDeadline(""); setNpNotes(""); setNpError("");
    setNewProjectOpen(true);
  }

  async function saveNewProject() {
    if (!npName.trim()) { setNpError("שם הביט / פרויקט חובה"); return; }
    setNpSaving(true); setNpError("");
    try {
      const newId = await createProject({
        name:        npName.trim(),
        artist:      "",
        projectType: "רידים",
        status:      "בעבודה",   // general project status — never the Victor work status
        deadline:    npDeadline,
        notes:       npNotes,
      });
      if (newId) {
        // Link the new project to Victor — quiet insert only (no Tasks / no
        // Google Tasks / no finance). Pass the chosen Victor work status.
        try {
          await fetch("/api/vendor/victor/work", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: newId, status: npStatus }),
          });
        } catch { /* link is best-effort — project was still created */ }
        await fetchMonth(month);
      }
      setNewProjectOpen(false);
      setToast("הפרויקט נוצר ושויך ל-Victor ✓");
      setTimeout(() => setToast(null), 3000);
    } catch {
      setNpError("שגיאה ביצירת הפרויקט");
    } finally {
      setNpSaving(false);
    }
  }

  const [month, setMonth] = useState(currentMonth);
  const [stats, setStats] = useState<VictorMonthStats | null>(null);
  const [work, setWork] = useState<VendorWork[]>([]);
  const [salaryMonths, setSalaryMonths] = useState<VictorSalaryMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [salaryLoading, setSalaryLoading] = useState(true);
  const [selectedWork, setSelectedWork] = useState<VendorWork | null>(null);
  // Phase 2A: Victor (supplier) must not see salary. Owner sees it as before.
  const [myRole, setMyRole] = useState<"owner" | "victor" | null>(null);
  const isOwner = myRole === "owner";

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.role === "owner" || d?.role === "victor") setMyRole(d.role); })
      .catch(() => {});
  }, []);

  const fetchMonth = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendor/victor?month=${m}`);
      const data = await res.json();
      if (data.ok) {
        setStats(data.stats ?? null);
        setWork(data.work ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  const fetchSalary = useCallback(async (year: number) => {
    setSalaryLoading(true);
    try {
      const res = await fetch(`/api/vendor/victor/salary?year=${year}`);
      const data = await res.json();
      if (data.ok) setSalaryMonths(data.months ?? []);
    } catch { /* silent */ }
    finally { setSalaryLoading(false); }
  }, []);

  useEffect(() => { fetchMonth(month); }, [month, fetchMonth]);
  useEffect(() => {
    if (!isOwner) return; // salary is owner-only (endpoint is 403 for Victor)
    const year = Number(month.split("-")[0]);
    fetchSalary(year);
  }, [month, fetchSalary, isOwner]);

  const currency     = stats?.salaryCurrency ?? "$";
  const salary       = stats?.monthlySalary ?? 0;
  const goal         = stats?.goal ?? 0;
  const completed    = stats?.completed ?? 0;
  const active       = stats?.active ?? 0;
  const stuck        = stats?.stuck ?? 0;
  const pct          = goal > 0 ? Math.min(100, Math.round((completed / goal) * 100)) : 0;

  const displayWork = work.slice(0, 12);

  const allFiles = work.flatMap(w => [
    ...(w.filesReceived ?? []).map(f => ({ ...f, dir: "in",  project: w.projectName })),
    ...(w.filesSent    ?? []).map(f => ({ ...f, dir: "out", project: w.projectName })),
  ]);

  const currentSalaryRec = salaryMonths.find(s => s.workMonth === month);
  // History = view-only, past months only (exclude current and any future month).
  const historyMonths    = [...salaryMonths].reverse().filter(s => s.workMonth < month);

  // ── Salary edit modal (internal — never touches Finance) ──
  const [salaryModalOpen,   setSalaryModalOpen]   = useState(false);
  const [salaryDraftAmount, setSalaryDraftAmount] = useState("");
  const [salaryDraftStatus, setSalaryDraftStatus] = useState<"צפוי" | "שולם">("צפוי");
  const [salarySaving,      setSalarySaving]      = useState(false);

  function openSalaryModal() {
    const amt = currentSalaryRec ? currentSalaryRec.amount : (salary || 0);
    setSalaryDraftAmount(String(amt));
    setSalaryDraftStatus(currentSalaryRec?.status === "שולם" ? "שולם" : "צפוי");
    setSalaryModalOpen(true);
  }

  async function saveSalary() {
    setSalarySaving(true);
    try {
      await fetch("/api/vendor/victor/salary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workMonth: month,
          amount: Number(salaryDraftAmount) || 0,
          status: salaryDraftStatus,
        }),
      });
      await fetchSalary(Number(month.split("-")[0]));
      setSalaryModalOpen(false);
    } finally {
      setSalarySaving(false);
    }
  }

  const btnStyle: React.CSSProperties = {
    background: "none", border: "none", outline: "none",
    fontFamily: "inherit", cursor: "pointer", padding: 0,
  };

  return (
    <>
    <div style={{
      minHeight: "100%", background: BG, color: TEXT,
      fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      padding: "32px 28px 80px",
    }}>
      <div style={{ maxWidth: 1380, margin: "0 auto" }}>

        {/* ── Top bar: breadcrumb + month switcher ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          {/* Back */}
          <button
            onClick={() => router.push("/team")}
            style={{ ...btnStyle, display: "flex", alignItems: "center", gap: 6, color: TEXT2, fontSize: 14, fontWeight: 700 }}
          >
            → חזרה לרשימה
          </button>

          {/* Title */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: MUTED, letterSpacing: "0.06em", marginBottom: 3 }}>צוות / ספקים</div>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>
              פרופיל ספק — <span style={{ color: PURPLE }}>Victor</span>
            </h1>
          </div>

          {/* Month switcher */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            background: CARD, border: `1px solid ${BDR2}`, borderRadius: 14,
            padding: "9px 18px",
          }}>
            <button onClick={() => setMonth(m => prevMonth(m))} style={{ ...btnStyle, fontSize: 20, color: TEXT2, lineHeight: 1 }}>‹</button>
            <div style={{ minWidth: 150, textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{monthLabel(month)}</div>
              {loading && <div style={{ fontSize: 9, color: MUTED }}>טוען...</div>}
            </div>
            <button onClick={() => setMonth(m => nextMonth(m))} style={{ ...btnStyle, fontSize: 20, color: TEXT2, lineHeight: 1 }}>›</button>
          </div>
        </div>

        {/* ── Victor Info Card ── */}
        <div style={{
          background: CARD, border: `1px solid ${BDR2}`, borderRadius: 18,
          padding: "22px 28px", display: "flex", alignItems: "center",
          gap: 24, marginBottom: 18,
        }}>
          {/* Avatar */}
          <div style={{
            width: 76, height: 76, borderRadius: "50%", flexShrink: 0,
            background: `linear-gradient(135deg, ${PURPLE}44 0%, #1a1035 100%)`,
            border: `2px solid ${PURPLE}55`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28, fontWeight: 900, color: PURPLE,
            boxShadow: `0 0 24px ${PURPLE}22`,
          }}>V</div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: TEXT }}>Victor</span>
              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 7, background: `${PURPLE}18`, border: `1px solid ${PURPLE}33`, color: PURPLE, fontWeight: 700 }}>מפיק ביטים</span>
            </div>
            <div style={{ fontSize: 13, color: TEXT2, marginTop: 5 }}>הפקה · סאונד עיצוב · ביטים</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: GREEN, fontWeight: 700 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, display: "inline-block", boxShadow: `0 0 6px ${GREEN}88` }} />
                פעיל
              </span>
              <span style={{ fontSize: 12, color: MUTED }}>·</span>
              <span style={{ fontSize: 12, color: MUTED }}>תאריך התחלה: 12.03.2024</span>
              <span style={{ fontSize: 12, color: MUTED }}>·</span>
              <span style={{ fontSize: 12, color: MUTED }}>תחום עיסוק: הפקה · ביטים</span>
            </div>
          </div>

          {/* Action */}
          <button
            onClick={openNewProject}
            style={{
              padding: "10px 22px", borderRadius: 12, flexShrink: 0,
              background: `${PURPLE}14`, border: `1px solid ${PURPLE}33`,
              color: PURPLE, fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 7,
            }}>
            + פתח פרויקט חדש
          </button>
        </div>

        {/* ── KPI Row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 18 }}>
          {[
            { label: "יעד חודשי כולל", value: goal > 0 ? goal : "—", sub: "פרויקטים", color: TEXT,   icon: "🎯" },
            { label: "הושלמו",          value: completed,              sub: `מתוך ${goal}`,   color: PURPLE, icon: "✅" },
            { label: "בתהליך",          value: active,                 sub: "פרויקטים",       color: AMBER,  icon: "🔄" },
            { label: "באיחור",          value: stuck,                  sub: "תקועים",         color: stuck > 0 ? RED : MUTED, icon: "⚠️" },
            {
              label: "שכר חודשי",
              value: currentSalaryRec ? fmt(currentSalaryRec.amount, currentSalaryRec.currency) : (salary > 0 ? fmt(salary, currency) : "—"),
              sub: currentSalaryRec?.status ?? (stats?.paymentStatus ?? ""),
              color: GREEN,
              icon: "₪",
            },
          ].filter((kpi) => isOwner || kpi.label !== "שכר חודשי").map(({ label, value, sub, color, icon }) => (
            <div key={label} style={{
              background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16,
              padding: "18px 20px", position: "relative", overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", bottom: -8, left: -4,
                fontSize: 56, opacity: 0.05, userSelect: "none", pointerEvents: "none", lineHeight: 1,
              }}>{icon}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
              <div style={{ fontSize: 30, fontWeight: 900, color, letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</div>
              {sub && <div style={{ fontSize: 11, color: TEXT2, marginTop: 8 }}>{sub}</div>}
            </div>
          ))}
        </div>

        {/* ── Main 3-Column Layout ── */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16, alignItems: "start" }}>

          {/* ── Col 1: Projects Table ── */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, overflow: "hidden" }}>
            <div style={{
              padding: "14px 20px", borderBottom: `1px solid ${BDR}`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>פרויקטים</span>
                <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 7, background: `${PURPLE}18`, color: PURPLE, fontWeight: 700 }}>{work.length}</span>
              </div>
              <span style={{ fontSize: 12, color: MUTED }}>ב{monthLabel(month)}</span>
            </div>

            {loading ? (
              <div style={{ padding: "16px 16px" }}>
                {[1,2,3,4,5].map(i => (
                  <div key={i} style={{ height: 12, background: "rgba(255,255,255,0.05)", borderRadius: 5, marginBottom: 10 }} />
                ))}
              </div>
            ) : displayWork.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 32, opacity: 0.2, marginBottom: 8 }}>📋</div>
                <div style={{ fontSize: 13, color: MUTED }}>אין פרויקטים לחודש זה</div>
              </div>
            ) : (
              <>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: CARD2 }}>
                      {["שם פרויקט", "אמן / לקוח", "דד ליין", "סטטוס", "פעולה"].map(h => (
                        <th key={h} style={{
                          padding: "10px 14px", textAlign: "right",
                          fontSize: 10, fontWeight: 700, color: MUTED,
                          letterSpacing: "0.06em", textTransform: "uppercase",
                          whiteSpace: "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayWork.map((w, idx) => (
                      <tr key={w.id} style={{
                        borderTop: `1px solid ${BDR}`,
                        background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                      }}>
                        <td style={{
                          padding: "11px 14px", fontSize: 13, fontWeight: 600, color: TEXT,
                          maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          <span style={{ marginLeft: 4 }}>🎵</span>{w.projectName}
                        </td>
                        <td style={{ padding: "11px 14px", fontSize: 12, color: TEXT2, whiteSpace: "nowrap" }}>
                          {w.artist || "—"}
                        </td>
                        <td style={{ padding: "11px 14px", fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>
                          {fmtDate(w.internalDeadline)}
                        </td>
                        <td style={{ padding: "11px 14px" }}>
                          <WorkStatusDropdown
                            workId={w.id}
                            status={w.status}
                            workProjectId={w.projectId}
                            workProjectName={w.projectName}
                            onUpdated={newStatus => setWork(prev => prev.map(item => item.id === w.id ? { ...item, status: newStatus as import("@/lib/types").VictorStatus } : item))}
                          />
                        </td>
                        <td style={{ padding: "11px 14px" }}>
                          <button
                            onClick={() => setSelectedWork(w)}
                            style={{
                              ...btnStyle, fontSize: 11, fontWeight: 700, color: MUTED,
                              padding: "4px 10px", borderRadius: 7,
                              border: `1px solid ${BDR}`, background: CARD2,
                              cursor: "pointer",
                            }}>
                            פתח פרויקט
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {work.length > 12 && (
                  <div style={{ padding: "10px 16px", borderTop: `1px solid ${BDR}`, textAlign: "center" }}>
                    <span style={{ fontSize: 11, color: MUTED }}>+ {work.length - 12} פרויקטים נוספים</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Col 2: Capacity + Files ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Capacity Card */}
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "18px 22px" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 16 }}>קיבולת חודשית</div>

              {/* Big counter */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4, direction: "ltr" }}>
                <span style={{ fontSize: 40, fontWeight: 900, color: PURPLE, letterSpacing: "-0.04em" }}>{completed}</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: MUTED }}>/ {goal}</span>
              </div>
              <div style={{ fontSize: 12, color: TEXT2, marginBottom: 14 }}>פרויקטים הושלמו</div>

              {/* Progress bar */}
              <div style={{ height: 11, background: CARD2, borderRadius: 6, overflow: "hidden", marginBottom: 7 }}>
                <div style={{
                  height: "100%", borderRadius: 6,
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${PURPLE} 0%, #A855F7 100%)`,
                  transition: "width 0.4s ease",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: MUTED, marginBottom: 16 }}>
                <span>{pct}% מהיעד החודשי</span>
                {pct >= 60
                  ? <span style={{ color: GREEN, fontWeight: 700 }}>במסלול ✓</span>
                  : pct > 0
                    ? <span style={{ color: AMBER, fontWeight: 700 }}>מאחור</span>
                    : null
                }
              </div>

              {/* Stats */}
              {stats && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${BDR}`, paddingTop: 14 }}>
                  {[
                    { label: "בתהליך",        value: active,             color: AMBER  },
                    { label: "דורשים בדיקה",   value: stats.needsReview,  color: AMBER  },
                    { label: "דורשים תיקון",   value: stats.needsFix,     color: RED    },
                    { label: "תקועים",         value: stats.stuck,        color: stuck > 0 ? RED : MUTED },
                    { label: "קצב נוכחי",      value: stats.paceValue,    color: TEXT2  },
                    { label: "יעד לעכשיו",     value: stats.expectedByNow,color: TEXT2  },
                  ].filter(r => r.value !== 0 && r.value !== null && r.value !== undefined).map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: MUTED }}>{r.label}</span>
                      <span style={{ fontWeight: 800, color: r.color }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Files Card */}
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "18px 22px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>קבצים</span>
                <button style={{
                  ...btnStyle, fontSize: 11, fontWeight: 700, color: PURPLE,
                  padding: "4px 12px", borderRadius: 8,
                  border: `1px solid ${PURPLE}33`, background: `${PURPLE}10`,
                }}>
                  + העלאה
                </button>
              </div>

              {allFiles.length === 0 ? (
                <div style={{ fontSize: 13, color: MUTED, textAlign: "center", padding: "14px 0" }}>
                  אין קבצים לחודש זה
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 240, overflowY: "auto" }}>
                  {allFiles.slice(0, 14).map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 10px", borderRadius: 9, background: CARD2 }}>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{f.dir === "in" ? "📥" : "📤"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {f.dropboxShareUrl ? (
                            <a href={f.dropboxShareUrl} target="_blank" rel="noopener noreferrer" style={{ color: TEXT, textDecoration: "none" }}>{f.name}</a>
                          ) : f.name}
                        </div>
                        <div style={{ fontSize: 10, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.project}</div>
                      </div>
                      {f.versionLabel && <span style={{ fontSize: 9, color: MUTED, flexShrink: 0 }}>{f.versionLabel}</span>}
                    </div>
                  ))}
                  {allFiles.length > 14 && (
                    <div style={{ fontSize: 10, color: MUTED, textAlign: "center", paddingTop: 4 }}>
                      + {allFiles.length - 14} קבצים נוספים
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Col 3: Salary (owner only — hidden from Victor in Phase 2A) ── */}
          {isOwner && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Current month salary — click anywhere to edit (internal, no Finance) */}
            <div
              onClick={openSalaryModal}
              title="לחץ לעריכת המשכורת"
              style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 18, padding: "18px 22px", cursor: "pointer" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>
                  משכורות — {monthLabel(month)}
                </div>
                <span style={{ fontSize: 12, color: MUTED }}>✎</span>
              </div>

              {/* Salary amount */}
              <div style={{
                fontSize: 36, fontWeight: 900, letterSpacing: "-0.04em",
                color: currentSalaryRec ? GREEN : (salary > 0 ? GREEN : MUTED),
                marginBottom: 4,
              }}>
                {currentSalaryRec
                  ? fmt(currentSalaryRec.amount, currentSalaryRec.currency)
                  : salary > 0 ? fmt(salary, currency) : "—"}
              </div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 16 }}>סה"כ שכר חודשי</div>

              {/* Salary details */}
              {currentSalaryRec ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 9, borderTop: `1px solid ${BDR}`, paddingTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: MUTED }}>סטטוס תשלום</span>
                    <SalaryChip status={currentSalaryRec.status} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: MUTED }}>תאריך תשלום</span>
                    <span style={{ fontSize: 12, color: TEXT2, fontWeight: 700 }}>{fmtDate(currentSalaryRec.dueDate)}</span>
                  </div>
                  {currentSalaryRec.transactionId && (
                    <div style={{ fontSize: 11, color: MUTED }}>TX: {currentSalaryRec.transactionId.slice(0, 8)}...</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: MUTED, borderTop: `1px solid ${BDR}`, paddingTop: 14 }}>
                  אין רשומת שכר לחודש זה
                </div>
              )}
            </div>

            {/* Salary history */}
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "18px 22px" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 14 }}>היסטוריית תשלומים</div>

              {salaryLoading ? (
                <div>
                  {[1,2,3].map(i => <div key={i} style={{ height: 13, background: "rgba(255,255,255,0.05)", borderRadius: 4, marginBottom: 9 }} />)}
                </div>
              ) : historyMonths.length === 0 ? (
                <div style={{ fontSize: 13, color: MUTED }}>אין היסטוריה</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto" }}>
                  {historyMonths.map((s, i) => {
                    const sc = SALARY_STATUS_COLORS[s.status] ?? { color: MUTED };
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 13px", borderRadius: 11,
                        background: CARD2, border: `1px solid ${BDR}`,
                      }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{monthLabel(s.workMonth)}</div>
                          <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{fmtDate(s.dueDate)}</div>
                        </div>
                        <div style={{ textAlign: "left" }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: GREEN, marginBottom: 3 }}>{fmt(s.amount, s.currency)}</div>
                          <SalaryChip status={s.status} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Show all link */}
              {salaryMonths.length > 5 && (
                <div style={{ marginTop: 10, textAlign: "center" }}>
                  <span style={{ fontSize: 11, color: MUTED, cursor: "default" }}>הצג הכל ←</span>
                </div>
              )}
            </div>
          </div>
          )}

        </div>
      </div>
    </div>

    {selectedWork && (
      <VictorProjectDrawer
        work={selectedWork}
        onClose={() => setSelectedWork(null)}
        onRefresh={() => fetchMonth(month)}
      />
    )}

    {/* ── Salary edit modal (centered, dark, Redbloods style) ── */}
    {salaryModalOpen && (
      <>
        <div
          onClick={() => { if (!salarySaving) setSalaryModalOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 998 }}
        />
        <div style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          zIndex: 999, width: 380, maxWidth: "92vw",
          background: CARD, border: `1px solid ${BDR2}`, borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,0.85)", padding: 24, direction: "rtl",
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 4 }}>עריכת משכורת</div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 20 }}>{monthLabel(month)}</div>

          {/* Amount */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>סכום</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, color: TEXT2, fontWeight: 700 }}>{currency}</span>
              <input
                type="number" min={0} value={salaryDraftAmount}
                onChange={e => setSalaryDraftAmount(e.target.value)}
                style={{
                  flex: 1, padding: "9px 12px", borderRadius: 10, border: `1px solid ${BDR2}`,
                  background: CARD2, color: TEXT, fontSize: 14, fontFamily: "inherit",
                  outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          {/* Status */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>סטטוס תשלום</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["צפוי", "שולם"] as const).map(opt => {
                const sc = SALARY_STATUS_COLORS[opt];
                const isActive = salaryDraftStatus === opt;
                return (
                  <button
                    key={opt}
                    onClick={() => setSalaryDraftStatus(opt)}
                    style={{
                      flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 13, fontWeight: 800,
                      background: isActive ? sc.bg : "transparent",
                      border: `1px solid ${isActive ? sc.color + "66" : BDR2}`,
                      color: isActive ? sc.color : MUTED,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >{opt}</button>
                );
              })}
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setSalaryModalOpen(false)} disabled={salarySaving}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
                background: CARD2, border: `1px solid ${BDR2}`, color: TEXT2,
                cursor: salarySaving ? "default" : "pointer", fontFamily: "inherit",
              }}
            >ביטול</button>
            <button
              onClick={saveSalary} disabled={salarySaving}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 800,
                background: salarySaving ? MUTED : BRAND, border: "none", color: "#fff",
                cursor: salarySaving ? "default" : "pointer", fontFamily: "inherit",
              }}
            >{salarySaving ? "שומר…" : "שמור"}</button>
          </div>
        </div>
      </>
    )}

    {/* ── New project modal (centered, dark, Redbloods style) ── */}
    {newProjectOpen && (
      <>
        <div
          onClick={() => { if (!npSaving) setNewProjectOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 998 }}
        />
        <div style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          zIndex: 999, width: 440, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto",
          background: CARD, border: `1px solid ${BDR2}`, borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,0.85)", padding: 24, direction: "rtl",
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 4 }}>פתיחת ביט / פרויקט חדש</div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 20 }}>נוצר כפרויקט רגיל ומשויך ל-Victor</div>

          {npError && (
            <div style={{ fontSize: 12, color: "#EF4444", marginBottom: 12, fontWeight: 600 }}>{npError}</div>
          )}

          {/* Name */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>שם ביט / פרויקט *</div>
            <input
              value={npName} onChange={e => setNpName(e.target.value)} autoFocus
              style={npInputStyle}
            />
          </div>

          {/* Victor work status */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>סטטוס אצל Victor</div>
            <select value={npStatus} onChange={e => setNpStatus(e.target.value)} style={{ ...npInputStyle, cursor: "pointer" }}>
              {VICTOR_WORK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Deadline */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>דדליין</div>
            <input
              type="date" value={npDeadline} onChange={e => setNpDeadline(e.target.value)}
              style={{ ...npInputStyle, colorScheme: "dark" as React.CSSProperties["colorScheme"] }}
            />
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>הערות</div>
            <textarea
              value={npNotes} onChange={e => setNpNotes(e.target.value)} rows={3}
              style={{ ...npInputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setNewProjectOpen(false)} disabled={npSaving}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
                background: CARD2, border: `1px solid ${BDR2}`, color: TEXT2,
                cursor: npSaving ? "default" : "pointer", fontFamily: "inherit",
              }}
            >ביטול</button>
            <button
              onClick={saveNewProject} disabled={npSaving}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 800,
                background: npSaving ? MUTED : PURPLE, border: "none", color: "#fff",
                cursor: npSaving ? "default" : "pointer", fontFamily: "inherit",
              }}
            >{npSaving ? "יוצר…" : "צור ושייך ל-Victor"}</button>
          </div>
        </div>
      </>
    )}

    {/* ── Success toast ── */}
    {toast && (
      <div style={{
        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
        zIndex: 1000, background: CARD, border: `1px solid ${PURPLE}55`,
        color: TEXT, fontSize: 13, fontWeight: 700, padding: "11px 20px",
        borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.6)", direction: "rtl",
      }}>
        {toast}
      </div>
    )}
    </>
  );
}
