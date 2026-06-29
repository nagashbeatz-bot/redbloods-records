"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { VictorMonthStats, VendorWork, VictorSalaryMonth, FileLink, VictorReference } from "@/lib/types";
import { inMonth } from "@/lib/victor-segments";
import { useVictorLang, useVictorT, statusLabel, setVictorLang, VICTOR_LANGS, type VictorLang } from "@/lib/victor-i18n";

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

const WT_INPUT: React.CSSProperties = {
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
  "הושלם":        { bg: "rgba(16,185,129,0.12)",  color: GREEN  },
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
  const [lang] = useVictorLang();
  const s = STATUS_COLORS[status] ?? { bg: "rgba(255,255,255,0.06)", color: TEXT2 };
  return (
    <span style={{
      padding: "2px 9px", borderRadius: 7,
      background: s.bg, color: s.color,
      fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
    }}>{statusLabel(lang, status)}</span>
  );
}

function SalaryChip({ status }: { status: string }) {
  const [lang] = useVictorLang();
  const s = SALARY_STATUS_COLORS[status] ?? { bg: "rgba(255,255,255,0.06)", color: TEXT2 };
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 6,
      background: s.bg, color: s.color,
      fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
    }}>{statusLabel(lang, status)}</span>
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
  workProjectId?: string | null;
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
  const [lang] = useVictorLang();
  const t = useVictorT();

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
        {statusLabel(lang, localStatus)}
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
                {statusLabel(lang, opt)}
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
              {t("confirm.markCompleted")}
            </div>
            <div style={{ fontSize: 13, color: "#A0A0B0", marginBottom: 22, lineHeight: 1.5 }}>
              {t("confirm.linkedTo")}{workProjectName ? ` "${workProjectName}"` : ""}.
              {" "}{t("confirm.alsoProject")}
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
                {saving ? "…" : t("confirm.yesAll")}
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
                {t("drawer.cancel")}
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

// Single active Victor-drawer audio — playing one file pauses any other (each
// row's own "pause" event then resets its UI). Drawer-local; does NOT touch the
// app's global PlayerProvider.
let currentVictorAudio: HTMLAudioElement | null = null;

function AudioPlayer({
  file,
  onDownload,
  onDelete,
  deleteConfirm,
  onDeleteConfirm,
  onDeleteCancel,
  deleting,
  deleteError,
  canDelete,
}: {
  file: FileLink;
  onDownload: () => void;
  onDelete: () => void;
  deleteConfirm: boolean;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  deleting: boolean;
  deleteError: boolean;
  canDelete: boolean;
}) {
  const { name } = file;
  const url = file.dropboxShareUrl || file.url || "";
  const hasUrl = !!url;
  const t = useVictorT();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..100
  const [duration, setDuration] = useState(0);

  // One stable <audio> per file URL. State is driven by the real media events,
  // so an external pause (another row taking over, drawer closing) updates the UI
  // too. Cleanup pauses + tears down on unmount → no audio left playing after the
  // drawer closes, the project changes, or the file is deleted.
  useEffect(() => {
    if (!url) return;
    const a = new Audio(toDirectUrl(url));
    a.preload = "metadata";
    audioRef.current = a;
    const onTime  = () => { if (a.duration && !isNaN(a.duration)) setProgress((a.currentTime / a.duration) * 100); };
    const onMeta  = () => setDuration(a.duration && !isNaN(a.duration) ? a.duration : 0);
    const onPlay  = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setProgress(0); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.pause();
      if (currentVictorAudio === a) currentVictorAudio = null;
      a.src = "";
      if (audioRef.current === a) audioRef.current = null;
    };
  }, [url]);

  function togglePlay(e: React.MouseEvent) {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      // Only one Victor audio at a time — pause whoever was playing.
      if (currentVictorAudio && currentVictorAudio !== a) currentVictorAudio.pause();
      currentVictorAudio = a;
      a.play().catch(() => {});
    } else {
      a.pause();
    }
  }

  function seekToClientX(clientX: number) {
    const a = audioRef.current, bar = barRef.current;
    if (!a || !bar || !a.duration || isNaN(a.duration)) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = frac * a.duration;
    setProgress(frac * 100);
  }
  function onBarPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    seekToClientX(e.clientX);
  }
  function onBarPointerMove(e: React.PointerEvent) {
    if (e.buttons !== 1) return; // only while dragging
    seekToClientX(e.clientX);
  }

  function fmtTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

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
          {/* Progress bar — click or drag to seek (larger hit area via padding) */}
          <div
            ref={barRef}
            style={{ padding: "5px 0", cursor: "pointer", position: "relative", touchAction: "none" }}
            onPointerDown={onBarPointerDown}
            onPointerMove={onBarPointerMove}
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
          title={hasUrl ? t("file.download") : t("file.noDownload")}
          style={{
            background: "none", border: "none", cursor: hasUrl ? "pointer" : "not-allowed",
            color: hasUrl ? MUTED : `${MUTED}55`, fontSize: 14, padding: "2px 4px",
            flexShrink: 0, outline: "none",
          }}
        >⬇</button>
        {/* Delete button (owner only) */}
        {canDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDeleteConfirm(); }}
          title={t("file.delete")}
          style={{
            background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)",
            borderRadius: 7, cursor: "pointer",
            color: "#F87171", fontSize: 13, padding: "3px 8px",
            flexShrink: 0, outline: "none", fontFamily: "inherit",
          }}
        >{t("file.deleteBtn")}</button>
        )}
      </div>
      {/* Inline delete confirm */}
      {deleteConfirm && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: `1px solid rgba(239,68,68,0.2)`, background: "rgba(239,68,68,0.06)" }}>
          <span style={{ fontSize: 11, color: RED, fontWeight: 700, flex: 1 }}>{t("file.deleteConfirm")}</span>
          {deleteError && <span style={{ fontSize: 10, color: RED }}>{t("file.retryError")}</span>}
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            disabled={deleting}
            style={{ padding: "3px 12px", borderRadius: 7, fontSize: 11, fontWeight: 800, background: deleting ? MUTED : RED, border: "none", color: "#fff", cursor: deleting ? "default" : "pointer", fontFamily: "inherit", outline: "none" }}
          >{deleting ? "…" : t("drawer.confirm")}</button>
          <button
            onClick={e => { e.stopPropagation(); onDeleteCancel(); }}
            disabled={deleting}
            style={{ padding: "3px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700, background: CARD, border: `1px solid ${BDR2}`, color: TEXT2, cursor: deleting ? "default" : "pointer", fontFamily: "inherit", outline: "none" }}
          >{t("drawer.cancel")}</button>
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
  canDelete,
}: {
  file: FileLink;
  onDownload: () => void;
  onDelete: () => void;
  deleteConfirm: boolean;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  deleting: boolean;
  deleteError: boolean;
  canDelete: boolean;
}) {
  const { name } = file;
  const hasUrl = !!(file.dropboxShareUrl || file.url);
  const t = useVictorT();

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
          title={hasUrl ? t("file.download") : t("file.noDownload")}
          style={{
            background: "none", border: "none", cursor: hasUrl ? "pointer" : "not-allowed",
            color: hasUrl ? MUTED : `${MUTED}55`, fontSize: 14, padding: "2px 4px",
            flexShrink: 0, outline: "none",
          }}
        >⬇</button>
        {/* Delete button (owner only) */}
        {canDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDeleteConfirm(); }}
          title={t("file.delete")}
          style={{
            background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)",
            borderRadius: 7, cursor: "pointer",
            color: "#F87171", fontSize: 13, padding: "3px 8px",
            flexShrink: 0, outline: "none", fontFamily: "inherit",
          }}
        >{t("file.deleteBtn")}</button>
        )}
      </div>
      {/* Inline delete confirm */}
      {deleteConfirm && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: `1px solid rgba(239,68,68,0.2)`, background: "rgba(239,68,68,0.06)" }}>
          <span style={{ fontSize: 11, color: RED, fontWeight: 700, flex: 1 }}>{t("file.deleteConfirm")}</span>
          {deleteError && <span style={{ fontSize: 10, color: RED }}>{t("file.retryError")}</span>}
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            disabled={deleting}
            style={{ padding: "3px 12px", borderRadius: 7, fontSize: 11, fontWeight: 800, background: deleting ? MUTED : RED, border: "none", color: "#fff", cursor: deleting ? "default" : "pointer", fontFamily: "inherit", outline: "none" }}
          >{deleting ? "…" : t("drawer.confirm")}</button>
          <button
            onClick={e => { e.stopPropagation(); onDeleteCancel(); }}
            disabled={deleting}
            style={{ padding: "3px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700, background: CARD, border: `1px solid ${BDR2}`, color: TEXT2, cursor: deleting ? "default" : "pointer", fontFamily: "inherit", outline: "none" }}
          >{t("drawer.cancel")}</button>
        </div>
      )}
    </div>
  );
}

/** Extract a YouTube video id from common URL shapes (no external library). */
function ytId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function ReferenceCard({
  refItem,
  index,
  isOwner,
  onPlay,
  onEdit,
  onDelete,
}: {
  refItem: VictorReference;
  index: number;
  isOwner: boolean;
  onPlay: (videoId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const vid = ytId(refItem.url);
  const thumb = vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : null;
  const t = useVictorT();
  return (
    <div style={{ display: "flex", gap: 16, padding: 15, borderRadius: 14, background: CARD2, border: `1px solid ${BDR}` }}>
      {/* Thumbnail → plays in-app (does NOT leave the page) */}
      <button
        onClick={() => { if (vid) onPlay(vid); }}
        disabled={!vid}
        title={vid ? t("ref.playHere") : t("ref.noVideo")}
        style={{ position: "relative", flexShrink: 0, width: 180, aspectRatio: "16 / 9", borderRadius: 10, overflow: "hidden", background: "#000", border: "none", padding: 0, cursor: vid ? "pointer" : "default", display: "block" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {thumb ? (
          <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontSize: 26 }}>▶</div>
        )}
        {vid && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 42, height: 42, borderRadius: "50%", background: "rgba(220,38,38,0.92)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, paddingRight: 2 }}>▶</span>
          </div>
        )}
      </button>
      {/* Body */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 6, background: `${PURPLE}1F`, color: PURPLE }}>{t("ref.n", { n: index })}</span>
          <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: "rgba(239,68,68,0.12)", color: "#F87171" }}>YouTube</span>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{refItem.title || t("ref.n", { n: index })}</div>
        <a href={refItem.url} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: 10.5, color: MUTED, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{refItem.url}</a>
        {refItem.note && <div style={{ fontSize: 12, color: TEXT2, marginTop: 9, lineHeight: 1.85, whiteSpace: "pre-wrap" }}>{refItem.note}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto", paddingTop: 9 }}>
          {vid ? (
            <button onClick={() => onPlay(vid)} style={{ fontSize: 11, fontWeight: 800, color: "#fff", padding: "5px 14px", borderRadius: 8, background: PURPLE, border: "none", cursor: "pointer", fontFamily: "inherit" }}>{t("ref.play")}</button>
          ) : (
            <a href={refItem.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: PURPLE, textDecoration: "none", padding: "5px 12px", borderRadius: 8, background: `${PURPLE}14`, border: `1px solid ${PURPLE}33` }}>{t("ref.openLink")}</a>
          )}
          {vid && <a href={refItem.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: MUTED, textDecoration: "none" }}>{t("ref.openYoutube")}</a>}
          <div style={{ flex: 1 }} />
          {isOwner && (
            <>
              <button onClick={onEdit} title={t("file.editTitle")} style={{ fontSize: 11, padding: "4px 9px", borderRadius: 7, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", fontFamily: "inherit" }}>✎</button>
              <button onClick={onDelete} title={t("file.deleteTitle")} style={{ fontSize: 11, padding: "4px 9px", borderRadius: 7, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", color: "#F87171", cursor: "pointer", fontFamily: "inherit" }}>🗑</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VictorProjectDrawer({
  work,
  onClose,
  onRefresh,
  isOwner,
}: {
  work: VendorWork;
  onClose: () => void;
  onRefresh?: () => void;
  isOwner: boolean;
}) {
  const router = useRouter();
  const t = useVictorT();
  const [lang] = useVictorLang();
  const [updating, setUpdating] = useState(false);
  const [notes, setNotes] = useState(work.notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [effectiveFolder, setEffectiveFolder] = useState<string | null>(work.dropboxFolder ?? null);
  const [effectiveShareLink, setEffectiveShareLink] = useState<string | null>(work.dropboxShareLink ?? null);
  const [effectiveFiles, setEffectiveFiles] = useState<FileLink[]>(work.filesSent ?? []);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [openingDbx, setOpeningDbx] = useState(false);
  const [dbxFallback, setDbxFallback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteConfirmIdx, setDeleteConfirmIdx] = useState<number | null>(null);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Brief ("קרא אותי קודם") — owner edits, Victor views.
  const [effectiveBrief, setEffectiveBrief] = useState<string>(work.briefText ?? "");
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefDraft, setBriefDraft] = useState("");
  const [savingBrief, setSavingBrief] = useState(false);
  // References (YouTube) — owner adds/edits/deletes, Victor views/opens.
  const [effectiveRefs, setEffectiveRefs] = useState<VictorReference[]>(work.references ?? []);
  const [refForm, setRefForm] = useState<{ open: boolean; editId: string | null; url: string; title: string; note: string }>(
    { open: false, editId: null, url: "", title: "", note: "" }
  );
  const [savingRef, setSavingRef] = useState(false);
  // In-app YouTube player — holds the video id while open (iframe mounts only then).
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Close on Escape — the player first (if open), otherwise the whole modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (playingId) setPlayingId(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, playingId]);

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

  // ── Brief ("קרא אותי קודם") ──────────────────────────────────────────────────
  async function saveBrief() {
    if (savingBrief) return;
    setSavingBrief(true);
    try {
      await patchWork({ briefText: briefDraft });
      setEffectiveBrief(briefDraft);
      setEditingBrief(false);
    } finally {
      setSavingBrief(false);
    }
  }

  // ── References (YouTube) ─────────────────────────────────────────────────────
  async function saveReference() {
    const url = refForm.url.trim();
    if (!url || savingRef) return;
    setSavingRef(true);
    try {
      let next: VictorReference[];
      if (refForm.editId) {
        next = effectiveRefs.map((r) =>
          r.id === refForm.editId ? { ...r, url, title: refForm.title.trim(), note: refForm.note.trim() } : r
        );
      } else {
        const ref: VictorReference = {
          id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          url,
          title: refForm.title.trim(),
          note: refForm.note.trim(),
          provider: "youtube",
          createdAt: new Date().toISOString(),
        };
        next = [...effectiveRefs, ref];
      }
      await patchWork({ references: next });
      setEffectiveRefs(next);
      setRefForm({ open: false, editId: null, url: "", title: "", note: "" });
    } finally {
      setSavingRef(false);
    }
  }

  async function deleteReference(id: string) {
    const next = effectiveRefs.filter((r) => r.id !== id);
    setEffectiveRefs(next); // optimistic — dead refs never get stuck
    await patchWork({ references: next });
  }

  async function handleDeleteFile(file: FileLink, idx: number) {
    setDeleteConfirmIdx(null);
    setDeletingIdx(idx);
    setDeleteError(false);
    try {
      // Try Dropbox delete only when we have a path. The route treats
      // not_found as success, so a file already gone in Dropbox (or with no
      // stored path) is still hard-deleted from the list. Only a real
      // permission/server error keeps the file so the user can retry.
      if (file.dropboxPath) {
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
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    try {
      // Auto-create the Dropbox folder on first upload (no manual button).
      const folder = await ensureDropboxFolder();
      if (!folder) { setUploading(false); return; }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("workId", work.id);
      fd.append("dropboxFolder", folder);
      fd.append("subFolder", "Production");
      const responseText = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/dropbox/vendor-upload");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100));
        };
        xhr.onload = () => xhr.status === 200 ? resolve(xhr.responseText) : reject(new Error(xhr.responseText));
        xhr.onerror = () => reject(new Error(t("err.network")));
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
      const msg = err instanceof Error ? err.message : t("err.upload");
      setUploadError(msg);
      console.error("upload failed", err);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Ensure a Dropbox folder exists for this work, creating it on demand.
  // Returns the folder path, or throws so the caller can surface the error.
  async function ensureDropboxFolder(): Promise<string | null> {
    if (effectiveFolder) return effectiveFolder;
    const res = await fetch("/api/dropbox/vendor-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorName: "Victor",
        // Organize under the existing /Projects convention (Victor-page only):
        //   linked (has projectId)  → /Projects/<artist>/<project>/Victor
        //   Victor-only (no project) → /Projects/Victor/<work title>
        useProjectsLayout: true,
        projectId: work.projectId,
        projectName: work.projectName,
        artistName: work.artist,
        workTitle: work.title,
        workId: work.id,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || t("err.folder"));
    // Persist folder + share link on the work record.
    await fetch(`/api/vendor/victor/work/${work.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dropboxFolder: data.folderPath, dropboxShareLink: data.shareLink }),
    });
    setEffectiveFolder(data.folderPath);
    setEffectiveShareLink(data.shareLink);
    return data.folderPath as string;
  }

  // "Open in Dropbox" → go straight to the Production subfolder (where all
  // Victor uploads land), not the parent folder with 01_From_Redbloods etc.
  // Uses the workId-based victor-safe route (owner + victor); on any error we
  // fall back to the stored parent link so the button never breaks.
  async function openInDropbox() {
    if (openingDbx) return;
    setOpeningDbx(true);
    setDbxFallback(null);
    try {
      let url = effectiveShareLink;
      try {
        const res = await fetch("/api/vendor/victor/production-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workId: work.id }),
        });
        const data = await res.json();
        if (res.ok && data.ok && data.shareLink) url = data.shareLink;
      } catch { /* keep fallback */ }
      if (url) {
        const w = window.open(url, "_blank", "noopener,noreferrer");
        if (!w) setDbxFallback(url); // popup blocked → render a clickable link
      }
    } finally {
      setOpeningDbx(false);
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
      label: t("drawer.stepSent"),
      done: !!work.sentDate,
      date: work.sentDate,
      action: isOwner && !work.sentDate ? () => patchWork({ sentDate: todayISO(), workState: "נשלח לויקטור" }) : undefined,
    },
    {
      label: t("drawer.stepCompleted"),
      done: work.status === "הושלם",
      date: work.returnedDate,   // completion date — kept in sync with status by updateVictorWork
      action: isOwner && work.status !== "הושלם" ? () => patchWork({ status: "הושלם" }) : undefined,
    },
  ];

  const doneCount = tasks.filter(t => t.done).length;

  const timingColor = days === null ? MUTED : days < 0 ? RED : days <= 3 ? AMBER : GREEN;
  const timingLabel = days === null ? null : days < 0 ? `${Math.abs(days)} ${t("drawer.daysLate")}` : days === 0 ? t("drawer.today") : `${days} ${t("drawer.daysLeft")}`;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)",
          zIndex: 1000,
        }}
      />

      {/* Centered modal */}
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: "min(1300px, 95vw)", maxHeight: "90vh", zIndex: 1001,
          background: "#090910",
          border: `1px solid ${BDR2}`,
          borderRadius: 20,
          boxShadow: "0 24px 80px rgba(0,0,0,0.85)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          direction: "rtl",
        }}
      >

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
                {t("drawer.openInProjects")}
              </button>
            ) : (
              <span style={{ fontSize: 11, color: MUTED }}>{t("drawer.noLinkedProject")}</span>
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
                {isOwner ? (
                  <WorkStatusDropdown
                    workId={work.id}
                    status={work.status}
                    workProjectId={work.projectId}
                    workProjectName={work.projectName}
                    onUpdated={() => { onRefresh?.(); }}
                  />
                ) : (
                  <StatusChip status={work.status} />
                )}
                {work.workState && <StatusChip status={work.workState} />}
              </div>
            </div>
          </div>

          {/* Row 3: deadline + timing chip */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {work.internalDeadline ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 12, color: MUTED }}>{t("drawer.deadlineLabel")}</span>
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
              <span style={{ fontSize: 12, color: MUTED }}>{t("drawer.noDeadline")}</span>
            )}
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.9fr)_minmax(310px,0.7fr)]" style={{ gap: 18, alignItems: "start" }}>

            {/* ════ MAIN column: brief + references (what Victor must do) ════ */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>

              {/* ── קרא אותי קודם ── */}
              <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${BDR}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>📌</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{t("drawer.readme")}</span>
                  </div>
                  {isOwner && !editingBrief && (
                    <button
                      onClick={() => { setBriefDraft(effectiveBrief); setEditingBrief(true); }}
                      style={{ fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 8, background: `${PURPLE}18`, border: `1px solid ${PURPLE}44`, color: PURPLE, cursor: "pointer", fontFamily: "inherit" }}
                    >{t("drawer.edit")}</button>
                  )}
                </div>
                <div style={{ padding: "18px 20px" }}>
                  {editingBrief ? (
                    <>
                      <textarea
                        value={briefDraft}
                        onChange={e => setBriefDraft(e.target.value)}
                        rows={10}
                        autoFocus
                        placeholder={t("drawer.briefPlaceholder")}
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.7, background: CARD2, border: `1px solid ${BDR}`, color: TEXT2, outline: "none", fontFamily: "inherit", resize: "vertical", direction: "rtl", boxSizing: "border-box" }}
                      />
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                        <span style={{ fontSize: 10, color: MUTED }}>{briefDraft.length} {t("drawer.chars")}</span>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => setEditingBrief(false)} disabled={savingBrief} style={{ fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: savingBrief ? "default" : "pointer", fontFamily: "inherit" }}>{t("drawer.cancel")}</button>
                          <button onClick={saveBrief} disabled={savingBrief} style={{ fontSize: 11, fontWeight: 800, padding: "5px 16px", borderRadius: 8, background: savingBrief ? MUTED : PURPLE, border: "none", color: "#fff", cursor: savingBrief ? "default" : "pointer", fontFamily: "inherit" }}>{savingBrief ? t("drawer.saving") : t("drawer.save")}</button>
                        </div>
                      </div>
                    </>
                  ) : (
                    effectiveBrief.trim() ? (
                      <div style={{ fontSize: 13, lineHeight: 1.9, color: TEXT2, whiteSpace: "pre-wrap", maxHeight: 360, overflowY: "auto", direction: "rtl" }}>{effectiveBrief}</div>
                    ) : (
                      <div style={{ fontSize: 12.5, color: MUTED, textAlign: "center", padding: "28px 0", lineHeight: 1.7 }}>{isOwner ? t("drawer.briefEmptyOwner") : t("drawer.briefEmptyViewer")}</div>
                    )
                  )}
                </div>
              </div>

              {/* ── רפרנסים ── */}
              <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${BDR}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>🔗</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{t("drawer.refs")}</span>
                    {effectiveRefs.length > 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: `${PURPLE}18`, color: PURPLE }}>{effectiveRefs.length}</span>}
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => setRefForm({ open: true, editId: null, url: "", title: "", note: "" })}
                      style={{ fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 8, background: `${PURPLE}18`, border: `1px solid ${PURPLE}44`, color: PURPLE, cursor: "pointer", fontFamily: "inherit" }}
                    >{t("drawer.addRef")}</button>
                  )}
                </div>
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 13 }}>
                  {isOwner && refForm.open && (
                    <div style={{ padding: 12, borderRadius: 12, background: CARD2, border: `1px solid ${PURPLE}33`, display: "flex", flexDirection: "column", gap: 8 }}>
                      <input value={refForm.url} onChange={e => setRefForm(f => ({ ...f, url: e.target.value }))} placeholder={t("drawer.refUrlPlaceholder")} dir="ltr" style={{ width: "100%", padding: "8px 11px", borderRadius: 9, fontSize: 12, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`, color: TEXT, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                      <input value={refForm.title} onChange={e => setRefForm(f => ({ ...f, title: e.target.value }))} placeholder={t("drawer.refTitlePlaceholder")} style={{ width: "100%", padding: "8px 11px", borderRadius: 9, fontSize: 12, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`, color: TEXT, outline: "none", fontFamily: "inherit", direction: "rtl", boxSizing: "border-box" }} />
                      <textarea value={refForm.note} onChange={e => setRefForm(f => ({ ...f, note: e.target.value }))} placeholder={t("drawer.refNotePlaceholder")} rows={2} style={{ width: "100%", padding: "8px 11px", borderRadius: 9, fontSize: 12, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`, color: TEXT2, outline: "none", fontFamily: "inherit", direction: "rtl", resize: "vertical", boxSizing: "border-box" }} />
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <button onClick={() => setRefForm({ open: false, editId: null, url: "", title: "", note: "" })} disabled={savingRef} style={{ fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: savingRef ? "default" : "pointer", fontFamily: "inherit" }}>{t("drawer.cancel")}</button>
                        <button onClick={saveReference} disabled={savingRef || !refForm.url.trim()} style={{ fontSize: 11, fontWeight: 800, padding: "5px 16px", borderRadius: 8, background: (savingRef || !refForm.url.trim()) ? MUTED : PURPLE, border: "none", color: "#fff", cursor: (savingRef || !refForm.url.trim()) ? "default" : "pointer", fontFamily: "inherit" }}>{savingRef ? t("drawer.saving") : refForm.editId ? t("drawer.refUpdate") : t("drawer.refAdd")}</button>
                      </div>
                    </div>
                  )}
                  {effectiveRefs.length === 0 && !refForm.open ? (
                    <div style={{ fontSize: 12, color: MUTED, textAlign: "center", padding: "16px 0" }}>{isOwner ? t("drawer.refsEmptyOwner") : t("drawer.refsEmptyViewer")}</div>
                  ) : (
                    effectiveRefs.map((ref, i) => (
                      <ReferenceCard
                        key={ref.id}
                        refItem={ref}
                        index={i + 1}
                        isOwner={isOwner}
                        onPlay={setPlayingId}
                        onEdit={() => setRefForm({ open: true, editId: ref.id, url: ref.url, title: ref.title, note: ref.note })}
                        onDelete={() => deleteReference(ref.id)}
                      />
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* ════ SIDE column: files + progress ════ */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>

          {/* Files card */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden", minWidth: 0 }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 8, flexWrap: "wrap",
              padding: "12px 16px",
              borderBottom: files.length > 0 ? `1px solid ${BDR}` : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>📁</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("files.title")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
                />
                {/* Single upload button — the Dropbox folder is created
                    automatically on first upload (no manual "create folder"). */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title={t("files.uploadTitle")}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 7,
                    background: uploading ? "rgba(255,255,255,0.05)" : "rgba(16,185,129,0.12)",
                    border: "1px solid rgba(16,185,129,0.3)",
                    color: uploading ? "#52526A" : "#10B981",
                    cursor: uploading ? "not-allowed" : "pointer",
                    fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  {uploading ? `${uploadProgress}%` : t("files.upload")}
                </button>
                {effectiveShareLink && (
                  dbxFallback ? (
                    <a
                      href={dbxFallback}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 7,
                        background: "rgba(0,98,238,0.12)", border: "1px solid rgba(0,98,238,0.3)",
                        color: "#4A9EFF", textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0,
                      }}
                    >
                      {t("files.openDropbox")}
                    </a>
                  ) : (
                    <button
                      onClick={openInDropbox}
                      disabled={openingDbx}
                      style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 7,
                        background: "rgba(0,98,238,0.12)", border: "1px solid rgba(0,98,238,0.3)",
                        color: "#4A9EFF", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0,
                        cursor: openingDbx ? "default" : "pointer", opacity: openingDbx ? 0.6 : 1,
                      }}
                    >
                      {openingDbx ? t("files.opening") : t("files.openDropbox")}
                    </button>
                  )
                )}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                  background: files.length > 0 ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.06)",
                  color: files.length > 0 ? GREEN : MUTED, whiteSpace: "nowrap", flexShrink: 0,
                }}>{files.length} {t("files.count")}</span>
              </div>
            </div>

            {uploadError && (
              <div style={{ fontSize: 11, color: "#EF4444", padding: "4px 16px 2px", fontWeight: 600 }}>{uploadError}</div>
            )}

            {files.length === 0 ? (
              <div style={{ padding: "28px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.25 }}>📂</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT2, marginBottom: 4 }}>{t("files.empty")}</div>
                <div style={{ fontSize: 11, color: MUTED }}>{t("files.emptySub")}</div>
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
                      canDelete: isOwner,
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
                <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{t("drawer.progress")}</span>
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
                  ) : null}
                </div>
              ))}
            </div>

            {/* Notes */}
            <div style={{ margin: "0 16px 14px" }}>
              {work.outcome && (
                <div style={{ fontSize: 11, color: PURPLE, fontWeight: 800, marginBottom: 6 }}>
                  {t("drawer.outcome")} {statusLabel(lang, work.outcome)}
                </div>
              )}
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); setNotesDirty(true); }}
                onBlur={saveNotes}
                placeholder={t("drawer.notesPlaceholder")}
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
              <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>{t("drawer.deadlineCard")}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: days !== null && days < 0 ? RED : TEXT, letterSpacing: "-0.02em", marginBottom: 4 }}>
                {work.internalDeadline ? fmtDate(work.internalDeadline) : "—"}
              </div>
              {days !== null && (
                <div style={{ fontSize: 11, color: timingColor, fontWeight: 700 }}>
                  {days < 0 ? `${Math.abs(days)} ${t("drawer.daysAfter")}` : days === 0 ? t("drawer.today") : `${days} ${t("drawer.daysLeft")}`}
                </div>
              )}
            </div>

            {/* Sent/returned dates card */}
            <div style={{
              background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "14px 16px",
              borderTop: `3px solid ${PURPLE}`,
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>{t("drawer.tracking")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {work.sentDate ? (
                  <div>
                    <div style={{ fontSize: 10, color: MUTED, marginBottom: 2 }}>{t("drawer.sent")}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TEXT2 }}>{fmtDate(work.sentDate)}</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: MUTED }}>{t("drawer.notSentYet")}</div>
                )}
                {work.returnedDate && (
                  <div>
                    <div style={{ fontSize: 10, color: MUTED, marginBottom: 2 }}>{t("drawer.returned")}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{fmtDate(work.returnedDate)}</div>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ── Remove from Victor board (owner only) ── */}
          {isOwner && (!confirmRemove ? (
            <button
              onClick={() => { setConfirmRemove(true); setRemoveError(null); }}
              style={{
                width: "100%", padding: "11px 0", borderRadius: 12,
                background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)",
                color: "#FCA5A5", fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {t("drawer.removeProject")}
            </button>
          ) : (
            <div style={{
              borderRadius: 12, background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              padding: "12px 16px",
            }}>
              <div style={{ fontSize: 12, color: "#FCA5A5", fontWeight: 700, marginBottom: 10, textAlign: "center" }}>
                {t("drawer.removeConfirm")}
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
                          setRemoveError(taskData.error ?? t("err.taskDelete"));
                          setRemoving(false);
                          return;
                        }
                      }
                      // Step 2: delete vendor_project_work record
                      const workRes = await fetch(`/api/vendor/victor/work/${work.id}`, { method: "DELETE" });
                      if (!workRes.ok) {
                        setRemoveError(t("err.workRemove"));
                        setRemoving(false);
                        return;
                      }
                      onRefresh?.();
                      onClose();
                    } catch {
                      setRemoveError(t("err.networkRetry"));
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
                  {removing ? t("drawer.removing") : t("drawer.confirm")}
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
                  {t("drawer.cancel")}
                </button>
              </div>
            </div>
          ))}

            </div>{/* side column */}
          </div>{/* grid */}
        </div>
      </div>

      {/* In-app YouTube player — iframe mounts only while open, so closing it
          unmounts the iframe and stops the video. No external library. */}
      {playingId && createPortal(
        <div
          onClick={() => setPlayingId(null)}
          style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.86)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ position: "relative", width: "min(960px, 94vw)", aspectRatio: "16 / 9", background: "#000", borderRadius: 14, overflow: "hidden", border: `1px solid ${BDR2}`, boxShadow: "0 24px 80px rgba(0,0,0,0.85)" }}>
            <button
              onClick={() => setPlayingId(null)}
              title={t("player.close")}
              style={{ position: "absolute", top: 8, left: 8, zIndex: 2, width: 32, height: 32, borderRadius: 8, background: "rgba(0,0,0,0.6)", border: `1px solid ${BDR2}`, color: "#fff", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}
            >✕</button>
            <iframe
              src={`https://www.youtube.com/embed/${playingId}?autoplay=1`}
              title="YouTube"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default function VictorProfilePage() {
  const router = useRouter();
  const [lang] = useVictorLang();
  const t = useVictorT();
  // Project creation was removed from the Victor page entirely: it must NEVER
  // create a row in `projects`. New projects are created only in the Projects
  // page and linked to Victor via vendor_project_work ("שלח לויקטור" flow).

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

  // ── New Victor-only work (owner only) — writes vendor_project_work ONLY.
  // NEVER calls createProject / POST /api/projects; project_id stays null. ──
  const [workModalOpen, setWorkModalOpen] = useState(false);
  const [wtTitle,  setWtTitle]  = useState("");
  const [wtStatus, setWtStatus] = useState<string>("פעיל");
  const [wtNotes,  setWtNotes]  = useState("");
  const [wtSaving, setWtSaving] = useState(false);
  const [wtError,  setWtError]  = useState("");

  function openWorkModal() {
    setWtTitle(""); setWtStatus("פעיל"); setWtNotes(""); setWtError("");
    setWorkModalOpen(true);
  }

  async function saveWork() {
    if (!wtTitle.trim()) { setWtError(t("err.workNameRequired")); return; }
    setWtSaving(true); setWtError("");
    try {
      const res = await fetch("/api/vendor/victor/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // title only — no projectId → vendor_project_work row with project_id=null.
        body: JSON.stringify({ title: wtTitle.trim(), status: wtStatus, notes: wtNotes.trim() || undefined }),
      });
      if (!res.ok) throw new Error("save failed");
      setWorkModalOpen(false);
      await fetchMonth(month);
    } catch {
      setWtError(t("err.workCreate"));
    } finally {
      setWtSaving(false);
    }
  }

  const currency     = stats?.salaryCurrency ?? "$";
  const salary       = stats?.monthlySalary ?? 0;
  const goal         = stats?.goal ?? 0;
  const completed    = stats?.completed ?? 0;
  const active       = stats?.active ?? 0;
  const stuck        = stats?.stuck ?? 0;
  const pct          = goal > 0 ? Math.min(100, Math.round((completed / goal) * 100)) : 0;

  // Only work attributed to the selected month — same helper the KPIs/salary use
  // (inMonth: sent_date, else created_at), so the table stays consistent with them.
  // Victor-only items (project_id=null) carry a sent_date on creation, so they filter too.
  const monthWork   = work.filter((w) => inMonth(w, month));
  const displayWork = monthWork.slice(0, 12);

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
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>

        {/* ── Top bar: breadcrumb + month switcher ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          {/* Left cluster: back (owner) + Victor-page language switcher (content-area only) */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {isOwner && (
              <button
                onClick={() => router.push("/team")}
                style={{ ...btnStyle, display: "flex", alignItems: "center", gap: 6, color: TEXT2, fontSize: 14, fontWeight: 700 }}
              >
                {t("header.backToList")}
              </button>
            )}
            <select
              value={lang}
              onChange={e => setVictorLang(e.target.value as VictorLang)}
              title={t("lang.label")}
              style={{ background: CARD, color: TEXT2, border: `1px solid ${BDR2}`, borderRadius: 10, padding: "7px 10px", fontSize: 12, fontFamily: "inherit", cursor: "pointer", outline: "none" }}
            >
              {VICTOR_LANGS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>

          {/* Title */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: MUTED, letterSpacing: "0.06em", marginBottom: 3 }}>{t("header.breadcrumb")}</div>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>
              {t("header.supplierProfile")} <span style={{ color: PURPLE }}>Victor</span>
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
              {loading && <div style={{ fontSize: 9, color: MUTED }}>{t("common.loading")}</div>}
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
              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 7, background: `${PURPLE}18`, border: `1px solid ${PURPLE}33`, color: PURPLE, fontWeight: 700 }}>{t("profile.role")}</span>
            </div>
            <div style={{ fontSize: 13, color: TEXT2, marginTop: 5 }}>{t("profile.subtitle")}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: GREEN, fontWeight: 700 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, display: "inline-block", boxShadow: `0 0 6px ${GREEN}88` }} />
                {statusLabel(lang, "פעיל")}
              </span>
              {/* Start-date / field-of-work line — owner-only chrome; hidden for Victor. */}
              {isOwner && (
                <>
                  <span style={{ fontSize: 12, color: MUTED }}>·</span>
                  <span style={{ fontSize: 12, color: MUTED }}>{t("profile.startDate")} 12.03.2024</span>
                  <span style={{ fontSize: 12, color: MUTED }}>·</span>
                  <span style={{ fontSize: 12, color: MUTED }}>{t("profile.field")}</span>
                </>
              )}
            </div>
          </div>

          {/* Owner only — creates a Victor-only work item (vendor_project_work),
              NOT a general project. Real projects are created in the Projects page. */}
          {isOwner && (
            <button
              onClick={openWorkModal}
              style={{
                padding: "10px 22px", borderRadius: 12, flexShrink: 0,
                background: `${PURPLE}14`, border: `1px solid ${PURPLE}33`,
                color: PURPLE, fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 7,
              }}>
              {t("header.newVictorWork")}
            </button>
          )}
        </div>

        {/* ── KPI Row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 18 }}>
          {[
            { id: "goal",      label: t("kpi.totalMonthly"), value: goal > 0 ? goal : "—", sub: t("kpi.inProgressSub"), color: TEXT,   icon: "🎯" },
            { id: "completed", label: t("kpi.completed"),    value: completed,              sub: t("kpi.completedOf", { goal }), color: PURPLE, icon: "✅" },
            { id: "active",    label: t("kpi.inProgress"),   value: active,                 sub: t("kpi.inProgressSub"), color: AMBER,  icon: "🔄" },
            { id: "stuck",     label: t("kpi.stuck"),        value: stuck,                  sub: t("kpi.stuckSub"),      color: stuck > 0 ? RED : MUTED, icon: "⚠️" },
            {
              id: "salary",
              label: t("kpi.monthlySalary"),
              value: currentSalaryRec ? fmt(currentSalaryRec.amount, currentSalaryRec.currency) : (salary > 0 ? fmt(salary, currency) : "—"),
              sub: currentSalaryRec?.status ? statusLabel(lang, currentSalaryRec.status) : (stats?.paymentStatus ? statusLabel(lang, stats.paymentStatus) : ""),
              color: GREEN,
              icon: "₪",
            },
          ].filter((kpi) => isOwner || kpi.id !== "salary").map(({ id, label, value, sub, color, icon }) => (
            <div key={id} style={{
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
                <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{t("projects.title")}</span>
                <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 7, background: `${PURPLE}18`, color: PURPLE, fontWeight: 700 }}>{work.length}</span>
              </div>
              <span style={{ fontSize: 12, color: MUTED }}>{t("projects.in")}{monthLabel(month)}</span>
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
                <div style={{ fontSize: 13, color: MUTED }}>{t("projects.empty")}</div>
              </div>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 540, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: CARD2 }}>
                      {[t("projects.colName"), t("projects.colArtist"), t("projects.colDeadline"), t("projects.colStatus"), t("projects.colAction")].map(h => (
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
                          {isOwner ? (
                          <WorkStatusDropdown
                            workId={w.id}
                            status={w.status}
                            workProjectId={w.projectId}
                            workProjectName={w.projectName}
                            onUpdated={newStatus => setWork(prev => prev.map(item => item.id === w.id ? { ...item, status: newStatus as import("@/lib/types").VictorStatus } : item))}
                          />
                          ) : (
                            <StatusChip status={w.status} />
                          )}
                        </td>
                        <td style={{ padding: "11px 14px" }}>
                          <button
                            onClick={() => setSelectedWork(w)}
                            onMouseEnter={e => { e.currentTarget.style.background = "#E4E4EA"; e.currentTarget.style.boxShadow = "0 0 8px rgba(255,255,255,0.16)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "#D7D7DD"; e.currentTarget.style.boxShadow = "none"; }}
                            style={{
                              ...btnStyle, fontSize: 11, fontWeight: 700,
                              color: "#1A1A20",
                              padding: "5px 13px", borderRadius: 10,
                              border: "1px solid rgba(255,255,255,0.18)",
                              background: "#D7D7DD",
                              cursor: "pointer",
                              transition: "background 0.15s, box-shadow 0.15s",
                            }}>
                            {t("projects.open")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                {monthWork.length > 12 && (
                  <div style={{ padding: "10px 16px", borderTop: `1px solid ${BDR}`, textAlign: "center" }}>
                    <span style={{ fontSize: 11, color: MUTED }}>{t("projects.more", { n: monthWork.length - 12 })}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Col 2: Capacity + Files ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Capacity Card */}
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "18px 22px" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 16 }}>{t("capacity.title")}</div>

              {/* Big counter */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4, direction: "ltr" }}>
                <span style={{ fontSize: 40, fontWeight: 900, color: PURPLE, letterSpacing: "-0.04em" }}>{completed}</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: MUTED }}>/ {goal}</span>
              </div>
              <div style={{ fontSize: 12, color: TEXT2, marginBottom: 14 }}>{t("capacity.completed")}</div>

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
                <span>{t("capacity.ofGoal", { pct })}</span>
                {pct >= 60
                  ? <span style={{ color: GREEN, fontWeight: 700 }}>{t("capacity.onTrack")}</span>
                  : pct > 0
                    ? <span style={{ color: AMBER, fontWeight: 700 }}>{t("capacity.behind")}</span>
                    : null
                }
              </div>

              {/* Stats */}
              {stats && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${BDR}`, paddingTop: 14 }}>
                  {[
                    { label: t("stat.inProgress"),  value: active,             color: AMBER  },
                    { label: t("stat.needsReview"), value: stats.needsReview,  color: AMBER  },
                    { label: t("stat.needsFix"),    value: stats.needsFix,     color: RED    },
                    { label: t("stat.stuck"),       value: stats.stuck,        color: stuck > 0 ? RED : MUTED },
                    { label: t("stat.pace"),        value: stats.paceValue,    color: TEXT2  },
                    { label: t("stat.goalNow"),     value: stats.expectedByNow,color: TEXT2  },
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
                <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{t("files.title")}</span>
                <button style={{
                  ...btnStyle, fontSize: 11, fontWeight: 700, color: PURPLE,
                  padding: "4px 12px", borderRadius: 8,
                  border: `1px solid ${PURPLE}33`, background: `${PURPLE}10`,
                }}>
                  {t("files.uploadBtn")}
                </button>
              </div>

              {allFiles.length === 0 ? (
                <div style={{ fontSize: 13, color: MUTED, textAlign: "center", padding: "14px 0" }}>
                  {t("files.emptyMonth")}
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
                      {t("files.more", { n: allFiles.length - 14 })}
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
              title={t("salary.editTitle")}
              style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 18, padding: "18px 22px", cursor: "pointer" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>
                  {t("salary.title")} {monthLabel(month)}
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
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 16 }}>{t("salary.totalMonthly")}</div>

              {/* Salary details */}
              {currentSalaryRec ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 9, borderTop: `1px solid ${BDR}`, paddingTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: MUTED }}>{t("salary.payStatus")}</span>
                    <SalaryChip status={currentSalaryRec.status} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: MUTED }}>{t("salary.payDate")}</span>
                    <span style={{ fontSize: 12, color: TEXT2, fontWeight: 700 }}>{fmtDate(currentSalaryRec.dueDate)}</span>
                  </div>
                  {currentSalaryRec.transactionId && (
                    <div style={{ fontSize: 11, color: MUTED }}>TX: {currentSalaryRec.transactionId.slice(0, 8)}...</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: MUTED, borderTop: `1px solid ${BDR}`, paddingTop: 14 }}>
                  {t("salary.noRecord")}
                </div>
              )}
            </div>

            {/* Salary history */}
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "18px 22px" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 14 }}>{t("payments.history")}</div>

              {salaryLoading ? (
                <div>
                  {[1,2,3].map(i => <div key={i} style={{ height: 13, background: "rgba(255,255,255,0.05)", borderRadius: 4, marginBottom: 9 }} />)}
                </div>
              ) : historyMonths.length === 0 ? (
                <div style={{ fontSize: 13, color: MUTED }}>{t("payments.empty")}</div>
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
                  <span style={{ fontSize: 11, color: MUTED, cursor: "default" }}>{t("payments.showAll")}</span>
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
        isOwner={isOwner}
        onClose={() => setSelectedWork(null)}
        onRefresh={() => fetchMonth(month)}
      />
    )}

    {/* ── New Victor-only work modal (owner only) — writes vendor_project_work only ── */}
    {isOwner && workModalOpen && (
      <>
        <div
          onClick={() => { if (!wtSaving) setWorkModalOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 998 }}
        />
        <div style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          zIndex: 999, width: 420, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto",
          background: CARD, border: `1px solid ${BDR2}`, borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,0.85)", padding: 24, direction: "rtl",
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 4 }}>{t("newwork.title")}</div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 20 }}>{t("newwork.subtitle")}</div>

          {wtError && <div style={{ fontSize: 12, color: "#EF4444", marginBottom: 12, fontWeight: 600 }}>{wtError}</div>}

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>{t("newwork.nameLabel")}</div>
            <input value={wtTitle} onChange={e => setWtTitle(e.target.value)} autoFocus style={WT_INPUT} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>{t("newwork.status")}</div>
            <select value={wtStatus} onChange={e => setWtStatus(e.target.value)} style={{ ...WT_INPUT, cursor: "pointer" }}>
              {VICTOR_WORK_STATUSES.map(s => <option key={s} value={s}>{statusLabel(lang, s)}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>{t("newwork.notesLabel")}</div>
            <textarea value={wtNotes} onChange={e => setWtNotes(e.target.value)} rows={3} style={{ ...WT_INPUT, resize: "vertical", lineHeight: 1.5 }} />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setWorkModalOpen(false)} disabled={wtSaving}
              style={{ flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, background: CARD2, border: `1px solid ${BDR2}`, color: TEXT2, cursor: wtSaving ? "default" : "pointer", fontFamily: "inherit" }}
            >{t("newwork.cancel")}</button>
            <button
              onClick={saveWork} disabled={wtSaving}
              style={{ flex: 2, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 800, background: wtSaving ? MUTED : PURPLE, border: "none", color: "#fff", cursor: wtSaving ? "default" : "pointer", fontFamily: "inherit" }}
            >{wtSaving ? t("newwork.creating") : t("newwork.create")}</button>
          </div>
        </div>
      </>
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
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 4 }}>{t("salaryModal.title")}</div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 20 }}>{monthLabel(month)}</div>

          {/* Amount */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>{t("salaryModal.amount")}</div>
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
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>{t("salaryModal.payStatus")}</div>
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
                  >{statusLabel(lang, opt)}</button>
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
            >{t("salaryModal.cancel")}</button>
            <button
              onClick={saveSalary} disabled={salarySaving}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 800,
                background: salarySaving ? MUTED : BRAND, border: "none", color: "#fff",
                cursor: salarySaving ? "default" : "pointer", fontFamily: "inherit",
              }}
            >{salarySaving ? t("drawer.saving") : t("drawer.save")}</button>
          </div>
        </div>
      </>
    )}

    </>
  );
}
