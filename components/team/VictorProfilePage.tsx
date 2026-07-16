"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { signOutAndRedirect } from "@/lib/supabase-browser";
import type { VictorMonthStats, VendorWork, VictorSalaryMonth, FileLink, VictorReference, VersionReview, VersionReviewStatus, BriefSegment, BriefSegmentType } from "@/lib/types";
import { inMonth } from "@/lib/victor-segments";
import { useVictorLang, useVictorT, statusLabel, setVictorLang, allowedVictorLangs, rememberVictorRole, getCachedVictorRole, victorMonthYear, type VictorLang } from "@/lib/victor-i18n";
import {
  IconMusic, IconPlay, IconPause, IconSkipBack, IconSkipForward, IconVolume,
  IconArrowUpRight, IconChevronLeft, IconChevronRight, IconX, IconPencil, IconTrash,
  IconCheck, IconCheckCircle, IconLogOut, IconCalendar, IconRefresh, IconTarget,
  IconAlert, IconStar, IconPin, IconFile, IconArchive, IconPaperclip, IconLink,
  IconUpload, IconDownload, IconInbox, IconNote, IconClipboard, IconFolder, IconCamera,
} from "./victor-icons";

// Run before paint on the client (falls back to useEffect on the server) so
// cached role / skeletons settle without a visible flash.
const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

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

// Dark-premium shimmer bar (reuses the global skeleton-sweep keyframe) — keeps
// loading placeholders on-brand and layout-stable, matching the Steven page.
function VShimmer({ w, h = 12, r = 7, style }: { w: number | string; h?: number; r?: number; style?: React.CSSProperties }) {
  return (
    <div style={{ width: w, height: h, borderRadius: r, background: "rgba(255,255,255,0.05)", position: "relative", overflow: "hidden", flexShrink: 0, ...style }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)", animation: "skeleton-sweep 1.6s ease-in-out infinite" }} />
    </div>
  );
}

// Mobile breakpoint (< 768px) — used to switch the page to a stacked,
// touch-friendly layout. UI only; no behavior/data change.
function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const check = () => setM(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return m;
}

function fmt(n: number, curr = "$") {
  return `${curr}${n.toLocaleString()}`;
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
  } catch { return d; }
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

// Victor-facing work name: the separate work title if set, else the linked
// project's name (display only — never changes projects.name).
function victorWorkName(w: { title?: string | null; projectName: string }): string {
  return (w.title && w.title.trim()) ? w.title : w.projectName;
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

// Audio src for a Victor file. Prefer the scoped, ownership-checked streaming
// route (works for both owner and Victor — /api/dropbox/stream is owner-only via
// the gate, which is why Victor couldn't play). Falls back to an existing public
// share link, then the stored url.
function playbackSrc(file: FileLink, workId?: string): string {
  // Victor (path-free): opaque fileRef + workId → scoped stream route.
  if (file.fileRef && workId) return `/api/vendor/victor/stream?workId=${encodeURIComponent(workId)}&fileRef=${encodeURIComponent(file.fileRef)}`;
  if (file.dropboxPath) return `/api/vendor/victor/stream?path=${encodeURIComponent(file.dropboxPath)}`;
  if (file.dropboxShareUrl) return toDirectUrl(file.dropboxShareUrl);
  return toDirectUrl(file.url || "");
}

function fileExt(name: string): string {
  return (name.split(".").pop() ?? "").toUpperCase().slice(0, 4);
}

function downloadFile(file: FileLink, workId?: string) {
  // Victor (path-free): scoped download route via fileRef — no public link.
  if (file.fileRef && workId) {
    const a = document.createElement("a");
    a.href = `/api/vendor/victor/download?workId=${encodeURIComponent(workId)}&fileRef=${encodeURIComponent(file.fileRef)}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }
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

// ── Versions workflow helpers (Phase 1 — pure, derived client-side; no DB) ──────
type FileRole = "vocals" | "instrumental" | "stems" | "other";
const ROLE_COLOR: Record<FileRole, string> = {
  vocals: "#8B5CF6", instrumental: "#3B82F6", stems: "#F59E0B", other: "#6B7280",
};
// Per-version review status → accent color.
const REVIEW_STATUS_COLOR: Record<VersionReviewStatus, string> = {
  waiting: "#8B8B99", needs_revision: "#F59E0B", approved: "#10B981", replaced: "#6B7280",
};
// Detect a file's role from its intake category first, then filename/extension.
// "no vocals"/instrumental is checked BEFORE "vocals" so it can't be misread.
function detectRole(file: FileLink): FileRole {
  const cat = (file.category ?? "");
  if (cat.includes("אינסטרומנטל")) return "instrumental";
  if (cat.includes("אקפלה"))       return "vocals";
  if (cat.includes("ערוצים"))      return "stems";
  const n = file.name.toLowerCase();
  if (/\.(zip|rar|7z)$/i.test(file.name) || /\bstems?\b|multitrack|ערוצים/.test(n)) return "stems";
  if (/instrumental|\binst\b|no[\s._-]?vocals?|\bbeat\b|אינסטרומנטל/.test(n))        return "instrumental";
  if (/with[\s._-]?vocals?|\bvocals?\b|\bvox\b|acapella|אקפלה|ווקאל/.test(n))         return "vocals";
  return "other";
}
// Parse a version token from a filename (V3 / version 3 / מיקס 3 / final / fix).
// Returns a stable grouping key, or null when nothing matches.
function parseVersionKey(name: string): string | null {
  const n = name.toLowerCase();
  let m = n.match(/\bv[\s._-]?(\d{1,3})\b/) || n.match(/version[\s._-]?(\d{1,3})/) || n.match(/מיקס[\s._-]?(\d{1,3})/);
  if (m) return `V${Number(m[1])}`;
  if (/\bfinal\b|פיינל/.test(n)) return "FINAL";
  if (/\bfix\b/.test(n))         return "FIX";
  return null;
}
// The set of version GROUP keys currently present (mirrors buildVersionGroups):
// prefer the stored label, fall back to filename parse, else the "all"/untagged
// bucket. Used to prune reviews of versions that no longer have any files.
function versionKeysOf(files: FileLink[]): Set<string> {
  const keys = new Set<string>();
  if (files.length === 0) return keys;
  const vkeys = files.map(f => (f.versionLabel && /^V\d+$/i.test(f.versionLabel)) ? f.versionLabel.toUpperCase() : parseVersionKey(f.name));
  if (!vkeys.some(Boolean)) { keys.add("all"); return keys; }
  for (const k of vkeys) keys.add(k ?? "__untagged__");
  return keys;
}
// Stable per-file id for tracking the now-playing track across re-renders/deletes.
function fileId(f: FileLink): string {
  return f.fileRef || f.dropboxPath || f.dropboxShareUrl || f.url || f.name;
}
function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Single active Victor-drawer audio — playing one file pauses any other (each
// row's own "pause" event then resets its UI). Drawer-local; does NOT touch the
// app's global PlayerProvider.
let currentVictorAudio: HTMLAudioElement | null = null;

function AudioPlayer({
  file,
  workId,
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
  workId?: string;
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
  // src is fileRef-based for Victor (no path), share/url for owner. hasUrl drives
  // both play and download gating so it must count fileRef too.
  const src = playbackSrc(file, workId);
  const hasUrl = !!src;
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
    if (!src) return;
    const a = new Audio(src);
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
  }, [src]);

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
          {playing ? <IconPause size={13} /> : <IconPlay size={13} />}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 5 }}>
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
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 30, height: 30, borderRadius: 9,
            background: hasUrl ? "rgba(255,255,255,0.05)" : "transparent",
            border: `1px solid ${hasUrl ? BDR2 : "transparent"}`,
            cursor: hasUrl ? "pointer" : "not-allowed",
            color: hasUrl ? TEXT2 : `${MUTED}55`, padding: 0,
            flexShrink: 0, outline: "none", fontFamily: "inherit",
          }}
        ><IconDownload size={15} /></button>
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
         ><IconTrash size={11} style={{ marginInlineEnd: 4 }} />{t("file.deleteBtn")}</button>
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

// ── Brief structure segments — canonical types → preset colors + localized ─────
//    labels. This is BRIEF-ONLY: separate <audio>, never touches versions /
//    versionGroups / reviews. Owner edits; Victor is strictly read-only.
const SEG_ORDER: BriefSegmentType[] = ["intro", "verse1", "prechorus", "chorus1", "verse2", "chorus3", "cpart", "bridge", "finalChorus", "outro", "custom"];
// Colors are consistent by musical role so Victor reads structure at a glance:
// every verse shares one color, every chorus shares another.
const VERSE_C = "#8B5CF6";   // all verses
const CHORUS_C = "#F59E0B";  // all choruses
const SEG_COLOR: Record<BriefSegmentType, string> = {
  intro: "#3B82F6",
  verse1: VERSE_C,
  prechorus: "#06B6D4",
  chorus1: CHORUS_C,
  verse2: VERSE_C,
  chorus3: CHORUS_C,
  cpart: "#EC4899",
  bridge: "#F43F5E",
  finalChorus: CHORUS_C,
  outro: "#10B981",
  custom: "#6B7280",
};
// Decorative waveform heights — deterministic (no lib, no Math.random) so SSR
// and client render identically (no hydration mismatch).
const WAVE_BARS = Array.from({ length: 64 }, (_, i) =>
  0.34 + 0.62 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)));

function segLabel(seg: BriefSegment, t: (k: string) => string): string {
  if (seg.type === "custom") return (seg.label ?? "").trim() || t("seg.custom");
  return t(`seg.${seg.type}`);
}

// Abbreviated label for medium-width blocks (e.g. "פז׳ 1" / "Ch1"). Localized
// via i18n like segLabel, so Victor never gets Hebrew inside a narrow block.
function segShortLabel(seg: BriefSegment, t: (k: string) => string): string {
  if (seg.type === "custom") return (seg.label ?? "").trim() || t("seg.s.custom");
  return t(`seg.s.${seg.type}`);
}

const MIN_SEG = 4;      // seconds — smallest allowed block
const DEFAULT_LEN = 20; // seconds — default length of a freshly-added block

// Cascade-forward normalize with a hard guarantee that EVERY block stays inside
// [0, dur], ordered, non-overlapping, and ≥ MIN_SEG — so nothing overflows,
// piles up at the end, or vanishes.
//   • dur unknown yet → just order + de-overlap forward (no cap).
//   • not enough room even at MIN each → equal slices (still all visible).
//   • otherwise → forward pass that RESERVES MIN_SEG for every later block, so a
//     block (or a cascade push) can never consume the space the rest needs.
function normalizeSegs(list: BriefSegment[], dur: number): BriefSegment[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const n = sorted.length;
  if (n === 0) return [];
  if (dur <= 0) {
    let cursor = 0;
    return sorted.map(s => {
      const len = Math.max(MIN_SEG, s.end - s.start);
      const start = Math.max(s.start, cursor);
      cursor = start + len;
      return { ...s, start, end: start + len };
    });
  }
  if (n * MIN_SEG >= dur) {
    const slice = dur / n;
    return sorted.map((s, i) => ({ ...s, start: i * slice, end: (i + 1) * slice }));
  }
  const out: BriefSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const s = sorted[i];
    const reserveAfter = (n - 1 - i) * MIN_SEG;      // room later blocks need at min
    const maxStart = dur - MIN_SEG - reserveAfter;   // start early enough for all
    const start = Math.min(Math.max(s.start, cursor), maxStart);
    const maxLen = dur - reserveAfter - start;        // ≥ MIN_SEG (proven)
    const len = Math.min(Math.max(MIN_SEG, s.end - s.start), maxLen);
    const end = start + len;
    out.push({ ...s, start, end });
    cursor = end;
  }
  return out;
}

// The page used to declare its own IconPlay/Pause/Download/Trash/Music here.
// They now live in ./victor-icons together with the rest of the set, so every
// icon on the Victor pages comes from one place and shares one stroke language.

// Inline brief-audio player with colored structure segments over the timeline.
// Its own <audio>, guarded by the shared currentVictorAudio so it never plays
// alongside a version. Segments persist via onSaveSegments (owner-only route).
function BriefSegmentPlayer({
  file, workId, isOwner, onSaveSegments, onDownload, onDelete,
  deleteConfirm, onDeleteConfirm, onDeleteCancel, deleting, deleteError,
}: {
  file: FileLink;
  workId?: string;
  isOwner: boolean;
  onSaveSegments: (segments: BriefSegment[]) => Promise<boolean>;
  onDownload: () => void;
  onDelete: () => void;
  deleteConfirm: boolean;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  deleting: boolean;
  deleteError: boolean;
}) {
  const t = useVictorT();
  const [lang] = useVictorLang();
  const isMobile = useIsMobile();
  const { name } = file;
  // fileRef-based src for Victor (no path); share/url for owner.
  const src = playbackSrc(file, workId);
  const hasUrl = !!src;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);              // playhead seconds
  const [duration, setDuration] = useState(file.durationSeconds ?? 0);
  const [segs, setSegs] = useState<BriefSegment[]>(() => normalizeSegs(file.segments ?? [], file.durationSeconds ?? 0));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "error">("idle");
  const laneRef = useRef<HTMLDivElement | null>(null);
  const [laneW, setLaneW] = useState(0); // lane px width → decide label detail per block
  const dragRef = useRef<null | { id: string; mode: "move" | "l" | "r"; startX: number; s0: number; e0: number; moved: boolean }>(null);
  const segsRef = useRef(segs); segsRef.current = segs;
  const formDir: React.CSSProperties["direction"] = lang === "he" ? "rtl" : "ltr";

  // Re-seed when switching to a different brief file (fileRef for Victor, path for owner).
  useEffect(() => { setSegs(normalizeSegs(file.segments ?? [], file.durationSeconds ?? 0)); setActiveId(null); }, [file.fileRef, file.dropboxPath]);

  // Track the lane's pixel width so each block can pick full / short / dot label
  // by how much room it actually has (browser ResizeObserver — no library).
  useEffect(() => {
    const el = laneRef.current; if (!el) return;
    const update = () => setLaneW(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One stable <audio>; same single-active guard as the version player, so
  // brief audio and version audio can never play at the same time.
  useEffect(() => {
    if (!src) return;
    const a = new Audio(src);
    a.preload = "metadata";
    audioRef.current = a;
    const onTime = () => setCur(a.currentTime || 0);
    const onMeta = () => setDuration(a.duration && !isNaN(a.duration) ? a.duration : (file.durationSeconds ?? 0));
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setCur(0); };
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  function togglePlay(e: React.MouseEvent) {
    e.stopPropagation();
    const a = audioRef.current; if (!a) return;
    if (a.paused) {
      if (currentVictorAudio && currentVictorAudio !== a) currentVictorAudio.pause();
      currentVictorAudio = a;
      a.play().catch(() => {});
    } else a.pause();
  }
  function seekTo(sec: number) {
    const a = audioRef.current; if (!a) return;
    const d = a.duration && !isNaN(a.duration) ? a.duration : duration;
    if (!d) return;
    a.currentTime = Math.max(0, Math.min(d, sec));
    setCur(a.currentTime);
  }
  function seekToClientX(clientX: number) {
    const bar = barRef.current; const d = duration;
    if (!bar || !d) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekTo(frac * d);
  }
  function onBarPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    seekToClientX(e.clientX);
  }
  function onBarPointerMove(e: React.PointerEvent) {
    if (e.buttons !== 1) return;
    seekToClientX(e.clientX);
  }
  function fmt(s: number) {
    const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  // Timeline length: real duration once known, else the furthest segment end.
  const dur = duration || Math.max(1, ...segs.map(s => s.end));
  const progressPct = dur ? Math.min(100, (cur / dur) * 100) : 0;

  // ── Owner editing — direct manipulation (click-to-add · drag · resize) ──
  const activeSeg = segs.find(s => s.id === activeId) ?? null;

  function persist(next: BriefSegment[]) {
    setSegs(next);
    setSaving("saving");
    onSaveSegments(next).then(ok => setSaving(ok ? "idle" : "error"));
  }
  function flush() {
    setSaving("saving");
    onSaveSegments(segsRef.current).then(ok => setSaving(ok ? "idle" : "error"));
  }
  // Click a chip → new block right after the last one (default length, clamped
  // to the track). No numbers required — the block appears immediately.
  function addSegment(type: BriefSegmentType) {
    const d = duration; if (!d) return;
    const lastEnd = segs.reduce((m, s) => Math.max(m, s.end), 0);
    let start = Math.min(lastEnd, Math.max(0, d - MIN_SEG));
    let end = Math.min(d, start + DEFAULT_LEN);
    if (end - start < MIN_SEG) { start = Math.max(0, d - DEFAULT_LEN); end = d; }
    // No label stored for custom → segLabel() falls back to the per-viewer
    // localized "custom", so a Hebrew owner default never leaks to Victor. Only
    // an explicit custom name (typed in advanced) is stored verbatim.
    const seg: BriefSegment = {
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${start}-${end}-${segs.length}`,
      type, color: SEG_COLOR[type], start, end,
    };
    setActiveId(seg.id);
    persist(normalizeSegs([...segs, seg], d));
  }
  function removeSeg(id: string) {
    if (activeId === id) setActiveId(null);
    persist(segs.filter(s => s.id !== id));
  }
  // Advanced numeric / custom-name edits: update locally, save on blur (flush).
  function editActiveLocal(patch: Partial<BriefSegment>) {
    if (!activeId) return;
    setSegs(prev => normalizeSegs(prev.map(s => s.id === activeId ? { ...s, ...patch } : s), duration));
  }
  // Drag / resize via pointer events (no library). "move" = whole block; "l"/"r"
  // = resize that edge. Live free-move (clamped to bounds); cascade on release.
  function beginDrag(e: React.PointerEvent, id: string, mode: "move" | "l" | "r") {
    if (!isOwner) return;
    e.stopPropagation();
    const seg = segs.find(s => s.id === id); if (!seg) return;
    setActiveId(id);
    dragRef.current = { id, mode, startX: e.clientX, s0: seg.start, e0: seg.end, moved: false };
    try { laneRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function onLaneMove(e: React.PointerEvent) {
    const dr = dragRef.current, lane = laneRef.current, d = duration;
    if (!dr || !lane || !d) return;
    const w = lane.getBoundingClientRect().width; if (!w) return;
    if (Math.abs(e.clientX - dr.startX) > 4) dr.moved = true;
    const delta = ((e.clientX - dr.startX) / w) * d;
    setSegs(prev => prev.map(s => {
      if (s.id !== dr.id) return s;
      if (dr.mode === "move") {
        const len = dr.e0 - dr.s0;
        const start = Math.max(0, Math.min(dr.s0 + delta, d - len));
        return { ...s, start, end: start + len };
      }
      if (dr.mode === "l") return { ...s, start: Math.max(0, Math.min(dr.s0 + delta, s.end - MIN_SEG)) };
      return { ...s, end: Math.min(d, Math.max(dr.e0 + delta, s.start + MIN_SEG)) };
    }));
  }
  function onLaneUp(e: React.PointerEvent) {
    const dr = dragRef.current; dragRef.current = null;
    try { laneRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!dr) return;
    // A tap that didn't move → seek to the block's start (owner too).
    if (!dr.moved) { const seg = segsRef.current.find(s => s.id === dr.id); if (seg) seekTo(seg.start); return; }
    persist(normalizeSegs(segsRef.current, duration)); // cascade + save on release
  }

  const inputStyle: React.CSSProperties = {
    padding: "6px 8px", borderRadius: 8, fontSize: isMobile ? 16 : 12,
    background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`, color: TEXT,
    outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%",
  };

  return (
    <div style={{ borderRadius: 12, background: CARD2, border: `1px solid ${BDR}`, overflow: "hidden" }}>
      {/* Header: play · name · download · (owner) delete */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        <button onClick={togglePlay} disabled={!hasUrl} title={name} style={{
          width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
          background: playing ? PURPLE : `${PURPLE}22`, border: `1px solid ${PURPLE}55`,
          color: "#fff", cursor: hasUrl ? "pointer" : "not-allowed", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 13, fontFamily: "inherit", outline: "none",
        }}>{playing ? <IconPause size={15} /> : <IconPlay size={15} />}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div title={name} style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", unicodeBidi: "plaintext" } as React.CSSProperties}>{name}</div>
          <div style={{ fontSize: 9.5, color: MUTED, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}><IconMusic size={11} /> {t("seg.title")}</div>
        </div>
        <button onClick={e => { e.stopPropagation(); onDownload(); }} disabled={!hasUrl} title={t("file.download")}
          style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: hasUrl ? "rgba(255,255,255,0.05)" : "transparent", border: `1px solid ${hasUrl ? BDR2 : "transparent"}`, color: hasUrl ? TEXT2 : `${MUTED}55`, cursor: hasUrl ? "pointer" : "not-allowed", padding: 0, fontFamily: "inherit", outline: "none" }}><IconDownload size={15} /></button>
        {isOwner && (
          <button onClick={e => { e.stopPropagation(); onDeleteConfirm(); }} title={t("file.delete")}
            style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", borderRadius: 8, cursor: "pointer", color: "#F87171", padding: 0, flexShrink: 0, outline: "none", fontFamily: "inherit" }}><IconTrash size={13} /></button>
        )}
      </div>

      {/* Timeline block — forced LTR inside the RTL drawer so time flows L→R. */}
      <div style={{ padding: "2px 12px 12px", direction: "ltr" }}>
        {/* Structure segments — draggable/resizable blocks (owner); tap to seek */}
        <div ref={laneRef} onPointerMove={isOwner ? onLaneMove : undefined} onPointerUp={isOwner ? onLaneUp : undefined}
          style={{ position: "relative", height: 40, marginBottom: 6, borderRadius: 8, background: "rgba(255,255,255,0.025)", border: `1px solid ${BDR}`, touchAction: "none", overflow: "hidden" }}>
          {segs.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, color: MUTED }}>{isOwner ? t("seg.hint") : t("seg.empty")}</div>
          )}
          {segs.map(seg => {
            const left = dur ? Math.min(100, (seg.start / dur) * 100) : 0;
            const width = dur ? Math.max(4, ((seg.end - seg.start) / dur) * 100) : 0;
            const active = seg.id === activeId;
            // Fit the label to the block's real px width: full → short → dot.
            // No cut-off text: too narrow shows just a clean dot, and the full
            // name+time is always in the tooltip and the selected toolbar.
            const wPx = (width / 100) * laneW;
            const tier = wPx >= 62 ? "full" : wPx >= 34 ? "short" : "dot";
            const pad = tier === "full" ? "0 10px" : tier === "short" ? "0 5px" : "0";
            return (
              <div key={seg.id}
                onPointerDown={isOwner ? (e) => beginDrag(e, seg.id, "move") : undefined}
                onClick={isOwner ? undefined : () => { seekTo(seg.start); setActiveId(seg.id); }}
                title={`${segLabel(seg, t)} · ${fmt(seg.start)}–${fmt(seg.end)}`}
                style={{ position: "absolute", top: 4, bottom: 4, left: `${left}%`, width: `${width}%`, background: `${seg.color}${active ? "4D" : "2E"}`, border: `1px solid ${seg.color}`, boxShadow: active ? `0 0 0 2px ${seg.color}66, 0 2px 10px rgba(0,0,0,0.45)` : "none", borderRadius: 7, color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", whiteSpace: "nowrap", cursor: isOwner ? "grab" : "pointer", padding: pad, userSelect: "none", touchAction: "none", textShadow: "0 1px 2px rgba(0,0,0,0.6)" } as React.CSSProperties}>
                {isOwner && <span onPointerDown={(e) => beginDrag(e, seg.id, "l")} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 9, cursor: "ew-resize", borderRadius: "7px 0 0 7px", background: `${seg.color}55` }} />}
                {tier === "dot"
                  ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.92)", boxShadow: active ? `0 0 0 2px ${seg.color}` : "none", flexShrink: 0, pointerEvents: "none" }} />
                  : <span style={{ overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{tier === "full" ? segLabel(seg, t) : segShortLabel(seg, t)}</span>}
                {isOwner && <span onPointerDown={(e) => beginDrag(e, seg.id, "r")} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 9, cursor: "ew-resize", borderRadius: "0 7px 7px 0", background: `${seg.color}55` }} />}
              </div>
            );
          })}
        </div>

        {/* Decorative waveform + playhead — click / drag to seek */}
        <div ref={barRef} onPointerDown={onBarPointerDown} onPointerMove={onBarPointerMove}
          style={{ position: "relative", height: 42, cursor: "pointer", touchAction: "none", display: "flex", alignItems: "center", gap: 2, padding: "0 1px", borderRadius: 8, background: "rgba(255,255,255,0.03)", overflow: "hidden" }}>
          {WAVE_BARS.map((h, i) => {
            const barPct = ((i + 0.5) / WAVE_BARS.length) * 100;
            const played = barPct <= progressPct;
            return <div key={i} style={{ flex: 1, height: `${Math.round(h * 100)}%`, borderRadius: 1, background: played ? PURPLE : "rgba(255,255,255,0.14)" }} />;
          })}
          <div style={{ position: "absolute", left: `${progressPct}%`, top: 0, bottom: 0, width: 2, background: "#fff", opacity: 0.85, pointerEvents: "none" }} />
        </div>

        {/* Time labels */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: MUTED, marginTop: 3 }}>
          <span>{fmt(cur)}</span>
          <span>{duration > 0 ? fmt(duration) : "—"}</span>
        </div>

        {/* Owner: click a type → block appears instantly; then drag / resize it */}
        {isOwner && (
          <div style={{ marginTop: 11 }}>
            <div style={{ fontSize: 9.5, color: MUTED, marginBottom: 6, direction: formDir }}>{t("seg.addTitle")}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SEG_ORDER.map(type => (
                <button key={type} onClick={() => addSegment(type)} disabled={!duration} title={duration ? "" : t("seg.hint")}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 999, cursor: duration ? "pointer" : "not-allowed", fontFamily: "inherit", outline: "none", border: `1px solid ${SEG_COLOR[type]}66`, background: `${SEG_COLOR[type]}16`, color: "#fff", opacity: duration ? 1 : 0.45 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: SEG_COLOR[type], flexShrink: 0 }} />
                  {t(`seg.${type}`)}
                </button>
              ))}
            </div>
            {activeSeg && (
              <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", direction: formDir }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", padding: "3px 9px", borderRadius: 7, background: `${activeSeg.color}22`, border: `1px solid ${activeSeg.color}` }}>{segLabel(activeSeg, t)}</span>
                <span style={{ fontSize: 10, color: MUTED, direction: "ltr" }}>{fmt(activeSeg.start)}–{fmt(activeSeg.end)}</span>
                <button onClick={() => setAdvanced(a => !a)}
                  style={{ fontSize: 10, fontWeight: 700, padding: "4px 9px", borderRadius: 7, background: advanced ? `${PURPLE}18` : "rgba(255,255,255,0.05)", border: `1px solid ${advanced ? `${PURPLE}55` : BDR2}`, color: advanced ? PURPLE : TEXT2, cursor: "pointer", fontFamily: "inherit", outline: "none" }}>{t("seg.advanced")}</button>
                <button onClick={() => removeSeg(activeSeg.id)} title={t("file.delete")}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, padding: "4px 9px", borderRadius: 7, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", color: "#F87171", cursor: "pointer", fontFamily: "inherit", outline: "none" }}><IconTrash size={13} />{t("file.delete")}</button>
                {saving === "saving" && <span style={{ fontSize: 10, color: MUTED }}>…</span>}
                {saving === "error" && <span style={{ fontSize: 10, color: RED }}>{t("seg.saveFail")}</span>}
              </div>
            )}
            {activeSeg && advanced && (
              <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: CARD, border: `1px solid ${BDR2}`, direction: formDir, display: "flex", flexDirection: "column", gap: 8 }}>
                {activeSeg.type === "custom" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <input value={activeSeg.label ?? ""} onChange={e => editActiveLocal({ label: e.target.value })} onBlur={flush} placeholder={t("seg.name")} maxLength={40} style={{ ...inputStyle, direction: formDir }} />
                    <span style={{ fontSize: 9, color: MUTED }}>{t("seg.customNote")}</span>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  {(["start", "end"] as const).map(key => (
                    <label key={key} style={{ flex: 1 }}>
                      <div style={{ fontSize: 9.5, color: MUTED, marginBottom: 3 }}>{t(`seg.${key}`)} (s)</div>
                      <input type="number" min={0} value={Math.round(activeSeg[key])} onChange={e => editActiveLocal({ [key]: Math.max(0, Number(e.target.value) || 0) })} onBlur={flush} style={{ ...inputStyle, direction: "ltr" }} />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Victor read-only: tapping a block (no hover on mobile) surfaces its
            full localized name + time here — never edit controls. */}
        {!isOwner && activeSeg && (
          <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", padding: "3px 9px", borderRadius: 7, background: `${activeSeg.color}22`, border: `1px solid ${activeSeg.color}` }}>{segLabel(activeSeg, t)}</span>
            <span style={{ fontSize: 10, color: MUTED }}>{fmt(activeSeg.start)}–{fmt(activeSeg.end)}</span>
          </div>
        )}
      </div>

      {/* Inline delete confirm (owner) */}
      {deleteConfirm && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: `1px solid rgba(239,68,68,0.2)`, background: "rgba(239,68,68,0.06)" }}>
          <span style={{ fontSize: 11, color: RED, fontWeight: 700, flex: 1 }}>{t("file.deleteConfirm")}</span>
          {deleteError && <span style={{ fontSize: 10, color: RED }}>{t("file.retryError")}</span>}
          <button onClick={e => { e.stopPropagation(); onDelete(); }} disabled={deleting}
            style={{ padding: "3px 12px", borderRadius: 7, fontSize: 11, fontWeight: 800, background: deleting ? MUTED : RED, border: "none", color: "#fff", cursor: deleting ? "default" : "pointer", fontFamily: "inherit", outline: "none" }}>{deleting ? "…" : t("drawer.confirm")}</button>
          <button onClick={e => { e.stopPropagation(); onDeleteCancel(); }} disabled={deleting}
            style={{ padding: "3px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700, background: CARD, border: `1px solid ${BDR2}`, color: TEXT2, cursor: deleting ? "default" : "pointer", fontFamily: "inherit", outline: "none" }}>{t("drawer.cancel")}</button>
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
  workId?: string;   // accepted from the shared props spread; download goes via onDownload
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
  const hasUrl = !!(file.fileRef || file.dropboxShareUrl || file.url);
  const t = useVictorT();

  return (
    <div style={{ borderRadius: 10, background: CARD2, border: `1px solid ${BDR}`, overflow: "hidden" }}>
      <div
        onClick={() => { if (hasUrl) onDownload(); }}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: hasUrl ? "pointer" : "default" }}
      >
        <IconFile size={18} style={{ color: TEXT2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{fileExt(name)}</div>
        </div>
        {/* Download button */}
        <button
          onClick={e => { e.stopPropagation(); onDownload(); }}
          disabled={!hasUrl}
          title={hasUrl ? t("file.download") : t("file.noDownload")}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 30, height: 30, borderRadius: 9,
            background: hasUrl ? "rgba(255,255,255,0.05)" : "transparent",
            border: `1px solid ${hasUrl ? BDR2 : "transparent"}`,
            cursor: hasUrl ? "pointer" : "not-allowed",
            color: hasUrl ? TEXT2 : `${MUTED}55`, padding: 0,
            flexShrink: 0, outline: "none", fontFamily: "inherit",
          }}
        ><IconDownload size={15} /></button>
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
         ><IconTrash size={11} style={{ marginInlineEnd: 4 }} />{t("file.deleteBtn")}</button>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, borderRadius: 14, background: CARD2, border: `1px solid ${BDR}`, minWidth: 0 }}>
      {/* Thumbnail → plays in-app (does NOT leave the page). Full-width, stacked
          above the text so it never squeezes the note into a 1-word column. */}
      <button
        onClick={() => { if (vid) onPlay(vid); }}
        disabled={!vid}
        title={vid ? t("ref.playHere") : t("ref.noVideo")}
        style={{ position: "relative", width: "100%", maxWidth: 360, aspectRatio: "16 / 9", borderRadius: 10, overflow: "hidden", background: "#000", border: "none", padding: 0, cursor: vid ? "pointer" : "default", display: "block", alignSelf: "center" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {thumb ? (
          <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: MUTED }}><IconPlay size={26} /></div>
        )}
        {vid && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 42, height: 42, borderRadius: "50%", background: "rgba(220,38,38,0.92)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", paddingRight: 1 }}><IconPlay size={16} /></span>
          </div>
        )}
      </button>
      {/* Body */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 6, background: `${PURPLE}1F`, color: PURPLE }}>{t("ref.n", { n: index })}</span>
          <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: "rgba(239,68,68,0.12)", color: "#F87171" }}>YouTube</span>
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{refItem.title || t("ref.n", { n: index })}</div>
        <a href={refItem.url} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: 10.5, color: MUTED, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{refItem.url}</a>
        {refItem.note && <div style={{ fontSize: 14, color: "#CFCFD6", marginTop: 9, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word", textAlign: "start", unicodeBidi: "plaintext" }}>{refItem.note}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto", paddingTop: 9, flexWrap: "wrap" }}>
          {vid ? (
            <button onClick={() => onPlay(vid)} style={{ fontSize: 11, fontWeight: 800, color: "#fff", padding: "5px 14px", borderRadius: 8, background: PURPLE, border: "none", cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}><IconPlay size={11} />{t("ref.play")}</button>
          ) : (
            <a href={refItem.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: PURPLE, textDecoration: "none", padding: "5px 12px", borderRadius: 8, background: `${PURPLE}14`, border: `1px solid ${PURPLE}33`, display: "inline-flex", alignItems: "center", gap: 5 }}><IconArrowUpRight size={11} />{t("ref.openLink")}</a>
          )}
          {vid && <a href={refItem.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: MUTED, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}><IconArrowUpRight size={10} />{t("ref.openYoutube")}</a>}
          <div style={{ flex: 1 }} />
          {isOwner && (
            <>
              <button onClick={onEdit} title={t("file.editTitle")} style={{ display: "flex", alignItems: "center", padding: "5px 9px", borderRadius: 7, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", fontFamily: "inherit" }}><IconPencil size={13} /></button>
              <button onClick={onDelete} title={t("file.deleteTitle")} style={{ display: "flex", alignItems: "center", padding: "5px 9px", borderRadius: 7, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", color: "#F87171", cursor: "pointer", fontFamily: "inherit" }}><IconTrash size={13} /></button>
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
  const isMobile = useIsMobile();
  const [updating, setUpdating] = useState(false);
  const [notes, setNotes] = useState(work.notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);
  // Victor-facing work title — owner-only edit; local copy so the drawer updates
  // instantly. Blank falls back to the project name for display.
  const [effectiveTitle, setEffectiveTitle] = useState<string>(work.title ?? "");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [effectiveFolder, setEffectiveFolder] = useState<string | null>(work.dropboxFolder ?? null);
  const [effectiveShareLink, setEffectiveShareLink] = useState<string | null>(work.dropboxShareLink ?? null);
  const [effectiveFiles, setEffectiveFiles] = useState<FileLink[]>(work.filesSent ?? []);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Large-file (chunked) upload: true once the last chunk is committing → the
  // button shows "saving…" instead of a percentage. Cancels on unmount.
  const [savingDbx, setSavingDbx] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [openingDbx, setOpeningDbx] = useState(false);
  const [dbxFallback, setDbxFallback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteConfirmIdx, setDeleteConfirmIdx] = useState<number | null>(null);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // ── "שלח עבודה לויקטור" (owner-only manual push) ──
  const [sendConfirm, setSendConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendDone, setSendDone] = useState(false);
  const sendingRef = useRef(false); // double-click guard (state lags a fast 2nd click)
  // Brief ("קרא אותי קודם") — owner edits, Victor views.
  const [effectiveBrief, setEffectiveBrief] = useState<string>(work.briefText ?? "");
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefDraft, setBriefDraft] = useState("");
  const [savingBrief, setSavingBrief] = useState(false);
  // Brief files — owner uploads/deletes, Victor views/downloads. NOT versions.
  const [effectiveBriefFiles, setEffectiveBriefFiles] = useState<FileLink[]>(work.briefFiles ?? []);
  const [briefUploading, setBriefUploading] = useState(false);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  const [briefDelPath, setBriefDelPath] = useState<string | null>(null);
  const briefFileInputRef = useRef<HTMLInputElement | null>(null);
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

  // Cancel any in-flight chunked upload when the drawer unmounts (close / switch).
  useEffect(() => () => { uploadAbortRef.current?.abort(); }, []);

  // Manual "send work to Victor": pushes to Victor, then (only if he actually
  // got it) a confirmation push to the owner. Sends ONLY the workId — the server
  // reloads the row and builds both texts from vendor_project_work.title, so the
  // name can't be spoofed and never falls back to a project/artist name.
  // Changes no status/data; never runs automatically.
  async function sendWorkToVictor() {
    if (sendingRef.current) return; // double-click → exactly one request
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/vendor/victor/notify-work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId: work.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        setSendError(d.error || t("err.networkRetry")); // keeps the confirm open to retry
        return;
      }
      setSendConfirm(false);
      setSendDone(true);
    } catch {
      setSendError(t("err.networkRetry"));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

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

  // Owner-only: save the Victor-facing work title (blank → null → falls back to
  // the project name). Never touches projects.name / project_id.
  async function saveTitle() {
    if (savingTitle) return;
    setSavingTitle(true);
    const next = titleDraft.trim();
    try {
      await patchWork({ title: next || null });
      setEffectiveTitle(next);
      setEditingTitle(false);
    } finally {
      setSavingTitle(false);
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

  // Brief files (owner only — the route is requireOwner; Victor gets 403).
  async function uploadBriefFile(file: File | null) {
    if (!file || briefUploading) return;
    setBriefUploading(true); setBriefErr(null);
    try {
      // Brief files land in the work's own Dropbox folder (…/00_Brief). That base
      // folder is created lazily, so make sure it exists (and dropbox_folder is
      // persisted) before uploading — otherwise the server refuses (409).
      await ensureDropboxFolder();
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`/api/vendor/victor/work/${work.id}/brief`, { method: "POST", body: fd });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) { setEffectiveBriefFiles(d.briefFiles ?? []); onRefresh?.(); }
      else setBriefErr((d?.error as string) || t("brief.uploadFail"));
    } catch { setBriefErr(t("brief.uploadFail")); }
    finally { setBriefUploading(false); if (briefFileInputRef.current) briefFileInputRef.current.value = ""; }
  }
  async function deleteBriefFile(dropboxPath: string) {
    const prev = effectiveBriefFiles;
    setEffectiveBriefFiles(prev.filter((f) => f.dropboxPath !== dropboxPath)); // optimistic
    setBriefDelPath(null);
    try {
      const res = await fetch(`/api/vendor/victor/work/${work.id}/brief`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dropboxPath }),
      });
      if (!res.ok) setEffectiveBriefFiles(prev); else onRefresh?.();
    } catch { setEffectiveBriefFiles(prev); }
  }

  // Persist structure segments for ONE brief audio file (owner-only PATCH).
  // Returns success so the player can roll back its optimistic update on failure.
  async function saveBriefSegments(dropboxPath: string, segments: BriefSegment[]): Promise<boolean> {
    try {
      const res = await fetch(`/api/vendor/victor/work/${work.id}/brief`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropboxPath, segments }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) { setEffectiveBriefFiles(d.briefFiles ?? []); onRefresh?.(); return true; }
      return false;
    } catch { return false; }
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
      // When a version loses its LAST file, drop its review too — otherwise a
      // reused version number (e.g. a fresh V1) would inherit the old feedback.
      const remainingKeys = versionKeysOf(filtered);
      const prunedReviews = Object.fromEntries(
        Object.entries(effectiveReviews).filter(([k]) => remainingKeys.has(k)),
      ) as Record<string, VersionReview>;
      const reviewsChanged = Object.keys(prunedReviews).length !== Object.keys(effectiveReviews).length;
      await fetch(`/api/vendor/victor/work/${work.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviewsChanged ? { filesSent: filtered, versionReviews: prunedReviews } : { filesSent: filtered }),
      });
      setEffectiveFiles(filtered);
      if (reviewsChanged) setEffectiveReviews(prunedReviews);
      onRefresh?.();
    } catch {
      setDeleteError(true);
    } finally {
      setDeletingIdx(null);
    }
  }

  // Upload ONE file, tagged with the batch's version label. Progress reflects
  // the whole batch ((completed + this-file-fraction) / total).
  function uploadOne(file: File, folder: string, versionLabel: string | null, idx: number, total: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      // Prefix the stored filename with its version so same-named files across
      // versions don't collide (e.g. "V2 - beat.wav"). Original name + extension
      // kept; unlabeled (Older files) uploads keep their name. The server still
      // sanitizes the name into the Dropbox path.
      const uploadName = versionLabel ? `${versionLabel} - ${file.name}` : file.name;
      const named = uploadName === file.name ? file : new File([file], uploadName, { type: file.type });
      fd.append("file", named);
      fd.append("workId", work.id);
      fd.append("dropboxFolder", folder);
      fd.append("subFolder", "Production");
      if (versionLabel) fd.append("versionLabel", versionLabel); // omit → file lands under "Older files"
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/dropbox/vendor-upload");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round(((idx + e.loaded / e.total) / total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText) as { ok: boolean; file?: FileLink };
            if (data.ok && data.file) setEffectiveFiles(prev => [...prev, data.file!]);
          } catch { /* ignore parse error; server still saved it */ }
          resolve();
        } else reject(new Error(xhr.responseText));
      };
      xhr.onerror = () => reject(new Error(t("err.network")));
      xhr.send(fd);
    });
  }

  // Upload ONE large file (>140MB, up to 1GB) via the Dropbox upload-session —
  // 8MB chunks stream through the server one at a time (never the whole file in
  // memory or over the proxy). Same version label / naming as the single-shot
  // path; no public share link. Batch progress mirrors uploadOne. Aborts if the
  // drawer closes mid-upload (uploadAbortRef).
  async function chunkedUploadOne(file: File, versionLabel: string | null, idx: number, total: number): Promise<void> {
    const CHUNK = 8 * 1024 * 1024;
    const size = file.size;
    // Same stored name as single-shot: version-prefixed so same-named files across
    // versions don't collide. The server sanitizes it into the Dropbox path.
    const uploadName = versionLabel ? `${versionLabel} - ${file.name}` : file.name;
    const ac = new AbortController();
    uploadAbortRef.current = ac;
    const base = "/api/dropbox/vendor-upload/chunk";
    const post = (qs: string, body: Blob) => fetch(`${base}?${qs}`, { method: "POST", body, signal: ac.signal });
    const setPct = (sent: number) => setUploadProgress(Math.round(((idx + sent / size) / total) * 100));
    try {
      // start — the first chunk opens the session
      let offset = Math.min(CHUNK, size);
      let res = await post("action=start", file.slice(0, offset));
      let d = (await res.json().catch(() => ({}))) as { ok?: boolean; sessionId?: string; file?: FileLink };
      if (!res.ok || !d.ok || !d.sessionId) throw new Error(t("err.upload"));
      const sessionId = d.sessionId;
      setPct(offset);
      // append the middle chunks; the final chunk goes through finish (commit)
      while (offset < size) {
        const end = Math.min(offset + CHUNK, size);
        const isLast = end >= size;
        const qs = isLast
          ? `action=finish&workId=${encodeURIComponent(work.id)}&sessionId=${encodeURIComponent(sessionId)}&offset=${offset}&subFolder=Production&name=${encodeURIComponent(uploadName)}${versionLabel ? `&versionLabel=${encodeURIComponent(versionLabel)}` : ""}`
          : `action=append&sessionId=${encodeURIComponent(sessionId)}&offset=${offset}`;
        if (isLast) setSavingDbx(true); // last chunk commits server-side → "saving…"
        res = await post(qs, file.slice(offset, end));
        d = (await res.json().catch(() => ({}))) as { ok?: boolean; sessionId?: string; file?: FileLink };
        if (!res.ok || !d.ok) throw new Error(t("err.upload"));
        if (isLast && d.file) setEffectiveFiles(prev => [...prev, d.file as FileLink]);
        offset = end;
        setPct(offset);
      }
    } finally {
      if (uploadAbortRef.current === ac) uploadAbortRef.current = null;
      setSavingDbx(false);
    }
  }

  // One upload batch (a single file-picker selection or drop) = ONE new version.
  // All files in the batch share "V{next}". After it, the new (latest) version
  // opens and older ones collapse (openGroups reset → group defaults apply).
  async function handleUploadBatch(fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0 || uploading) return;
    // Dispatch by size: >1GB rejected; >140MB uses the chunked upload-session
    // (Dropbox single-shot maxes ~150MB); otherwise the existing single-shot path.
    const MAX_BYTES   = 1024 * 1024 * 1024;   // 1GB in-app hard limit
    const CHUNK_LIMIT = 140 * 1024 * 1024;    // switch to chunked above this
    if (files.some(f => f.size > MAX_BYTES)) {
      setUploadError(t("files.tooLarge"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    // Version rule (per-work, with a 10-minute rolling window):
    //  • latest version updated < 10 min ago → JOIN it (incl. audio) — a follow-up
    //    file is part of the same round, not a new version.
    //  • else has audio        → V{max+1} (new version; any ZIP/RAR picked with it joins it)
    //  • else has ZIP/RAR      → join latest V{max}, or V1 if no version exists yet
    //  • else (no audio/ZIP)   → join latest V{max}, or (none) leave unlabeled → "Older files"
    // Backward compatible: files with no uploadedAt (older data) fall through to the
    // classic "audio → new version" behavior.
    const VERSION_WINDOW_MS = 10 * 60 * 1000;
    const max = maxVersionNumber();
    const hasAudio = files.some(f => isAudioFile(f.name));
    const hasPackage = files.some(f => /\.(zip|rar|7z)$/i.test(f.name));

    // Version number a stored file belongs to (stored label, else parsed name); 0 if none.
    const fileVersionNum = (f: FileLink): number => {
      const src = (f.versionLabel && /^V\d+$/i.test(f.versionLabel)) ? f.versionLabel : (parseVersionKey(f.name) ?? "");
      const m = /^V(\d+)$/i.exec(src);
      return m ? Number(m[1]) : 0;
    };
    // Most-recent upload time within the LATEST version of THIS work (0 if unknown).
    const latestLastUpload = max > 0
      ? effectiveFiles.reduce((acc, f) => {
          if (fileVersionNum(f) !== max || !f.uploadedAt) return acc;
          const ts = new Date(f.uploadedAt).getTime();
          return Number.isFinite(ts) ? Math.max(acc, ts) : acc;
        }, 0)
      : 0;
    const withinWindow = latestLastUpload > 0 && (Date.now() - latestLastUpload < VERSION_WINDOW_MS);

    const versionLabel: string | null =
      withinWindow ? `V${max}`
      : hasAudio    ? `V${max + 1}`
      : hasPackage  ? (max > 0 ? `V${max}` : "V1")
      :               (max > 0 ? `V${max}` : null);
    try {
      // Owner resolves/creates the folder client-side (also feeds the owner-only
      // "Open in Dropbox" link). Victor never handles the path — the upload route
      // resolves & creates the folder server-side from the workId, so his client
      // sends no folder at all (nothing Artist/Project-revealing reaches him).
      const folder = (isOwner ? await ensureDropboxFolder() : "") ?? "";
      if (isOwner && !folder) { setUploading(false); return; }
      for (let i = 0; i < files.length; i++) {
        if (files[i].size > CHUNK_LIMIT) await chunkedUploadOne(files[i], versionLabel, i, files.length);
        else await uploadOne(files[i], folder, versionLabel, i, files.length);
      }
      // Reveal where the files landed: the version (latest) opens by default;
      // an unlabeled batch opens the "Older files" bucket instead.
      setOpenGroups(versionLabel ? {} : { __untagged__: true });
      onRefresh?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("err.upload");
      setUploadError(msg);
      console.error("upload failed", err);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setSavingDbx(false);
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
  const receivedFiles = (work.filesReceived ?? []);

  // ── Versions (Phase 1): group Victor's SENT files into rounds, newest on top.
  //    sentIdx = index in effectiveFiles (exactly what handleDeleteFile expects).
  //    Ordering uses append order (approved heuristic — no per-file timestamp). ──
  const sentEnriched = effectiveFiles.map((f, i) => ({
    file: f, sentIdx: i, role: detectRole(f),
    // Prefer the stored batch label ("V3"); fall back to filename parsing.
    vkey: (f.versionLabel && /^V\d+$/i.test(f.versionLabel)) ? f.versionLabel.toUpperCase() : parseVersionKey(f.name),
  }));
  const anyVKey = sentEnriched.some(e => e.vkey);
  const roleOrder: FileRole[] = ["vocals", "instrumental", "stems", "other"];
  const sortByRole = (arr: typeof sentEnriched) =>
    arr.slice().sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.sentIdx - b.sentIdx);
  const versionGroups: { key: string; label: string; files: typeof sentEnriched; rank: number }[] = (() => {
    if (sentEnriched.length === 0) return [];
    if (!anyVKey) return [{ key: "all", label: "", files: sortByRole(sentEnriched), rank: sentEnriched.length - 1 }];
    const map = new Map<string, typeof sentEnriched>();
    for (const e of sentEnriched) {
      const k = e.vkey ?? "__untagged__";
      const cur = map.get(k); if (cur) cur.push(e); else map.set(k, [e]);
    }
    return [...map.entries()]
      .map(([key, fs]) => ({
        key, label: key === "__untagged__" ? "" : key, files: sortByRole(fs),
        // Untagged legacy files always sink to the bottom ("Older files").
        rank: key === "__untagged__" ? -1 : Math.max(...fs.map(f => f.sentIdx)),
      }))
      .sort((a, b) => b.rank - a.rank); // newest round on top
  })();

  // Next version number for a NEW upload batch = max seen (stored label OR
  // parsed filename) + 1; starts at V1 when there are none.
  // Highest existing version number (stored label OR parsed filename); 0 if none.
  function maxVersionNumber(): number {
    let max = 0;
    for (const f of effectiveFiles) {
      const src = (f.versionLabel && /^V\d+$/i.test(f.versionLabel)) ? f.versionLabel : (parseVersionKey(f.name) ?? "");
      const m = /^V(\d+)$/i.exec(src);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  }

  // Flat audio playlist in display order (Latest group first) → prev/next.
  const playlist = versionGroups.flatMap(g =>
    g.files.filter(x => isAudioFile(x.file.name)).map(x => ({ file: x.file, role: x.role, versionLabel: g.label })));

  // ── Drawer-local fixed player: ONE <audio>, isolated from PlayerProvider ──
  const [npKey, setNpKey] = useState<string | null>(null); // now-playing file id (stable across re-renders)
  const [pPlaying, setPPlaying] = useState(false);
  const [pCur, setPCur] = useState(0);
  const [pDur, setPDur] = useState(0);
  const [pVol, setPVol] = useState(1);
  const playerAudioRef = useRef<HTMLAudioElement | null>(null);
  const pBarRef = useRef<HTMLDivElement | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({}); // per-group collapse override
  // ── Per-version review (Phase 1C) — owner writes, Victor reads. Keyed by group key (versionLabel).
  const [effectiveReviews, setEffectiveReviews] = useState<Record<string, VersionReview>>(work.versionReviews ?? {});
  const [editingReviewKey, setEditingReviewKey] = useState<string | null>(null);
  const [reviewDraftNotes, setReviewDraftNotes] = useState("");
  const [reviewDraftStatus, setReviewDraftStatus] = useState<VersionReviewStatus>("waiting");
  const [savingReview, setSavingReview] = useState(false);
  const npIdx = playlist.findIndex(p => fileId(p.file) === npKey);
  const npItem = npIdx >= 0 ? playlist[npIdx] : null;

  function playTrackByFile(file: FileLink) {
    const a = playerAudioRef.current; if (!a) return;
    const url = playbackSrc(file, work.id);
    if (!url) return;
    const id = fileId(file);
    if (npKey !== id) { a.src = url; setPCur(0); setPDur(0); }
    setNpKey(id);
    if (currentVictorAudio && currentVictorAudio !== a) currentVictorAudio.pause(); // single active
    currentVictorAudio = a;
    a.volume = pVol;
    a.play().catch(() => {});
  }
  function togglePlayer() {
    const a = playerAudioRef.current; if (!a || !npItem) return;
    if (a.paused) {
      if (currentVictorAudio && currentVictorAudio !== a) currentVictorAudio.pause();
      currentVictorAudio = a;
      a.play().catch(() => {});
    } else a.pause();
  }
  function playerStep(delta: number) {
    if (npIdx < 0) return;
    const next = npIdx + delta;
    if (next < 0 || next >= playlist.length) return;
    playTrackByFile(playlist[next].file);
  }
  function playerSeek(clientX: number) {
    const a = playerAudioRef.current, bar = pBarRef.current;
    if (!a || !bar || !a.duration || isNaN(a.duration)) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = frac * a.duration; setPCur(a.currentTime);
  }

  // Wire the single <audio> element's media events → UI state.
  useEffect(() => {
    const a = playerAudioRef.current; if (!a) return;
    const onTime = () => setPCur(a.currentTime || 0);
    const onMeta = () => setPDur(a.duration && !isNaN(a.duration) ? a.duration : 0);
    const onPlay = () => setPPlaying(true);
    const onPause = () => setPPlaying(false);
    const onEnded = () => { setPPlaying(false); setPCur(0); };
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
    };
  }, []);
  // Stop + tear down on unmount (drawer close / project change).
  useEffect(() => () => {
    const a = playerAudioRef.current;
    if (a) { a.pause(); if (currentVictorAudio === a) currentVictorAudio = null; a.src = ""; }
  }, []);
  // If the now-playing file was deleted, stop the player.
  useEffect(() => {
    if (npKey && !playlist.some(p => fileId(p.file) === npKey)) {
      playerAudioRef.current?.pause();
      setNpKey(null); setPPlaying(false);
    }
  }, [npKey, playlist]);
  // Volume changes apply live.
  useEffect(() => { const a = playerAudioRef.current; if (a) a.volume = pVol; }, [pVol]);

  // Shared file-row renderer for a version's files (big = Latest card, else compact).
  function renderFileRow(item: { file: FileLink; sentIdx: number; role: FileRole }, big: boolean) {
    const { file, sentIdx, role } = item;
    const rc = ROLE_COLOR[role];
    const audio = isAudioFile(file.name);
    const nowPlaying = npKey === fileId(file);
    const hasUrl = !!(file.fileRef || file.dropboxShareUrl || file.url);
    return (
      <div key={sentIdx} style={{ display: "flex", alignItems: "center", gap: big ? 12 : 9, padding: big ? "10px 12px" : "8px 10px", borderRadius: 10, background: nowPlaying ? `${PURPLE}1A` : "rgba(255,255,255,0.02)", border: `1px solid ${nowPlaying ? PURPLE + "66" : BDR}`, minWidth: 0 }}>
        {audio ? (
          <button onClick={() => (nowPlaying ? togglePlayer() : playTrackByFile(file))} title={nowPlaying && pPlaying ? t("player.pause") : t("player.play")}
            style={{ width: big ? 36 : 30, height: big ? 36 : 30, borderRadius: "50%", flexShrink: 0, background: nowPlaying && pPlaying ? PURPLE : `${PURPLE}22`, border: `1px solid ${PURPLE}55`, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: big ? 13 : 11, fontFamily: "inherit" }}>
            {nowPlaying && pPlaying ? <IconPause size={big ? 14 : 12} /> : <IconPlay size={big ? 14 : 12} />}
          </button>
        ) : (
          <span style={{ flexShrink: 0, width: big ? 36 : 30, color: TEXT2, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/\.(zip|rar|7z)$/i.test(file.name) ? <IconArchive size={big ? 19 : 16} /> : <IconFile size={big ? 19 : 16} />}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div title={file.name} style={{ fontSize: big ? 13.5 : 12.5, fontWeight: 600, color: TEXT, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere", lineHeight: 1.3 } as React.CSSProperties}>{file.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 8px", borderRadius: 5, background: `${rc}22`, color: rc, border: `1px solid ${rc}44`, whiteSpace: "nowrap" }}>{t(`role.${role}`)}</span>
            <span style={{ fontSize: 9.5, color: MUTED }}>{fileExt(file.name)}</span>
            {typeof file.durationSeconds === "number" && file.durationSeconds > 0 && <span style={{ fontSize: 9.5, color: MUTED }}>· {fmtDur(file.durationSeconds)}</span>}
          </div>
        </div>
        <button onClick={() => downloadFile(file, work.id)} disabled={!hasUrl} title={hasUrl ? t("file.download") : t("file.noDownload")}
          style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: hasUrl ? "rgba(255,255,255,0.05)" : "transparent", border: `1px solid ${hasUrl ? BDR2 : "transparent"}`, color: hasUrl ? TEXT2 : `${MUTED}55`, cursor: hasUrl ? "pointer" : "not-allowed", padding: 0, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" }}><IconDownload size={15} /></button>
        {isOwner && (
          deleteConfirmIdx === sentIdx ? (
            <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
              <button onClick={() => handleDeleteFile(file, sentIdx)} disabled={deletingIdx === sentIdx} style={{ padding: "4px 9px", borderRadius: 7, fontSize: 10, fontWeight: 800, background: deletingIdx === sentIdx ? MUTED : RED, border: "none", color: "#fff", cursor: deletingIdx === sentIdx ? "default" : "pointer", fontFamily: "inherit" }}>{deletingIdx === sentIdx ? "…" : t("drawer.confirm")}</button>
              <button onClick={() => { setDeleteConfirmIdx(null); setDeleteError(false); }} style={{ padding: "4px 9px", borderRadius: 7, fontSize: 10, fontWeight: 700, background: CARD, border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", fontFamily: "inherit" }}>{t("drawer.cancel")}</button>
            </div>
          ) : (
            <button onClick={() => { setDeleteConfirmIdx(sentIdx); setDeleteError(false); }} title={t("file.delete")}
              style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", borderRadius: 7, cursor: "pointer", color: "#F87171", fontSize: 12, padding: "4px 8px", flexShrink: 0, fontFamily: "inherit" }} ><IconTrash size={11} style={{ marginInlineEnd: 4 }} />{t("file.deleteBtn")}</button>
          )
        )}
      </div>
    );
  }

  // ── Version review handlers (owner-only write; Victor PATCH is 403 via route whitelist) ──
  function openReviewEditor(key: string) {
    const r = effectiveReviews[key];
    setReviewDraftNotes(r?.notes ?? "");
    setReviewDraftStatus(r?.status ?? "waiting");
    setEditingReviewKey(key);
  }
  async function saveReview(key: string) {
    setSavingReview(true);
    const next: VersionReview = { status: reviewDraftStatus, notes: reviewDraftNotes.trim(), reviewedAt: new Date().toISOString(), reviewedBy: "owner" };
    const prev = effectiveReviews;
    const nextMap = { ...effectiveReviews, [key]: next };
    setEffectiveReviews(nextMap);
    setEditingReviewKey(null);
    try {
      await patchWork({ versionReviews: nextMap });
    } catch {
      setEffectiveReviews(prev); // revert on failure
    } finally {
      setSavingReview(false);
    }
  }

  // Feedback block shown inside each Version card (Latest + Older). Owner writes
  // notes; Victor reads them. NO status is shown in the UI (any legacy status in
  // data is ignored). Hidden until there are notes or the owner is editing.
  function renderReview(key: string) {
    const r = effectiveReviews[key];
    const editing = editingReviewKey === key;
    const hasNotes = !!(r?.notes && r.notes.trim());

    // No feedback yet → owner sees a small "Add feedback" CTA; Victor sees nothing.
    if (!editing && !hasNotes) {
      if (!isOwner) return null;
      return (
        <button onClick={() => openReviewEditor(key)}
          style={{ marginTop: 4, alignSelf: "flex-start", fontSize: 10.5, fontWeight: 700, padding: "5px 12px", borderRadius: 8, background: `${PURPLE}12`, border: `1px dashed ${PURPLE}44`, color: PURPLE, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <IconNote size={12} /> {t("vreview.add")}
        </button>
      );
    }

    // Recessed, purple-bordered "box" so the feedback reads as its own unit —
    // consistent across every version, standing out against both the tinted
    // Latest card and the darker Older cards.
    return (
      <div style={{ marginTop: 8, padding: "11px 13px", borderRadius: 11, background: "rgba(0,0,0,0.22)", border: `1px solid ${PURPLE}3D`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: TEXT2, display: "inline-flex", alignItems: "center", gap: 5 }}><IconNote size={12} /> {t("vreview.title")}</span>
          <span style={{ flex: 1 }} />
          {isOwner && !editing && (
            <button onClick={() => openReviewEditor(key)} style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 7, background: `${PURPLE}20`, border: `1px solid ${PURPLE}55`, color: PURPLE, cursor: "pointer", fontFamily: "inherit" }}>{t("vreview.edit")}</button>
          )}
        </div>
        {editing ? (
          <div style={{ marginTop: 8 }}>
            <textarea value={reviewDraftNotes} onChange={e => setReviewDraftNotes(e.target.value)} rows={3} placeholder={t("vreview.placeholder")}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 9, fontSize: isMobile ? 16 : 12.5, background: CARD2, border: `1px solid ${BDR2}`, color: TEXT, outline: "none", fontFamily: "inherit", resize: "vertical", textAlign: "start", unicodeBidi: "plaintext", boxSizing: "border-box" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button onClick={() => setEditingReviewKey(null)} disabled={savingReview} style={{ fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", fontFamily: "inherit" }}>{t("drawer.cancel")}</button>
              <button onClick={() => saveReview(key)} disabled={savingReview} style={{ fontSize: 11, fontWeight: 800, padding: "5px 16px", borderRadius: 8, background: savingReview ? MUTED : PURPLE, border: "none", color: "#fff", cursor: savingReview ? "default" : "pointer", fontFamily: "inherit" }}>{savingReview ? t("drawer.saving") : t("vreview.save")}</button>
            </div>
          </div>
        ) : (
          hasNotes && (
            <div style={{ fontSize: 13, color: "#CFCFD6", marginTop: 7, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", textAlign: "start", unicodeBidi: "plaintext" }}>{r!.notes}</div>
          )
        )}
      </div>
    );
  }

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
          position: "fixed",
          // Mobile: full-screen vertical sheet. Desktop: centered modal.
          top: isMobile ? 0 : "50%",
          left: isMobile ? 0 : "50%",
          transform: isMobile ? "none" : "translate(-50%, -50%)",
          width: isMobile ? "100vw" : "min(1600px, 92vw)",
          height: isMobile ? "100dvh" : "calc(100vh - 72px)",
          maxHeight: isMobile ? "100dvh" : "calc(100vh - 72px)",
          zIndex: 1001,
          background: "#090910",
          border: isMobile ? "none" : `1px solid ${BDR2}`,
          borderRadius: isMobile ? 0 : 20,
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
              color: TEXT2, lineHeight: 1, fontFamily: "inherit",
              fontWeight: 700, display: "flex", alignItems: "center",
            }}><IconX size={14} /></button>
            {/* Project link is OWNER-only — Victor never gets a way into the
                original project, just the clean work name. */}
            {isOwner ? (
              work.projectId ? (
                <button
                  onClick={() => router.push(`/projects?open=${work.projectId}`)}
                  style={{
                    background: `${PURPLE}18`, border: `1px solid ${PURPLE}44`,
                    color: PURPLE, fontSize: 11, fontWeight: 800,
                    padding: "6px 14px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                    letterSpacing: "0.03em",
                  }}
                >
                  <IconArrowUpRight size={12} style={{ marginInlineEnd: 5 }} />{t("drawer.openInProjects")}
                </button>
              ) : (
                <span style={{ fontSize: 11, color: MUTED }}>{t("drawer.noLinkedProject")}</span>
              )
            ) : null}
          </div>

          {/* Row 2: music icon + project name */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, flexShrink: 0,
              background: `linear-gradient(135deg, ${PURPLE}30, ${PURPLE}10)`,
              border: `1px solid ${PURPLE}44`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: PURPLE,
            }}><IconMusic size={20} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editingTitle ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    placeholder={work.projectName}
                    onKeyDown={e => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
                    style={{ ...WT_INPUT, flex: 1, minWidth: 0, fontSize: isMobile ? 16 : 15, fontWeight: 700 }}
                  />
                  <button onClick={saveTitle} disabled={savingTitle} title={t("drawer.confirm")} style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: "none", background: savingTitle ? MUTED : GREEN, color: "#fff", cursor: savingTitle ? "default" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" }}><IconCheck size={15} /></button>
                  <button onClick={() => setEditingTitle(false)} disabled={savingTitle} title={t("drawer.cancel")} style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: `1px solid ${BDR2}`, background: "rgba(255,255,255,0.05)", color: TEXT2, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" }}><IconX size={14} /></button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <div style={{
                    fontSize: 20, fontWeight: 900, color: TEXT,
                    letterSpacing: "-0.02em", lineHeight: 1.2, minWidth: 0,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    overflow: "hidden", overflowWrap: "anywhere",
                  }}>
                    {effectiveTitle.trim() || work.projectName}
                  </div>
                  {isOwner && (
                    <button onClick={() => { setTitleDraft(effectiveTitle); setEditingTitle(true); }} title={t("drawer.editTitle")} style={{ flexShrink: 0, background: "none", border: "none", color: MUTED, cursor: "pointer", padding: 2, lineHeight: 1, display: "flex", alignItems: "center" }}><IconPencil size={13} /></button>
                  )}
                </div>
              )}
              {/* Owner sees the linked project explicitly; Victor does not. */}
              {isOwner && effectiveTitle.trim() && work.projectId && (
                <div style={{ fontSize: 11.5, color: TEXT2, marginBottom: 6 }}>{t("drawer.linkedProject")}: {work.projectName}</div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                {/* Artist/Client is owner-only — Victor never sees who the artist is. */}
                {isOwner && <span style={{ fontSize: 12, color: TEXT2, fontWeight: 500 }}>{work.artist || "—"}</span>}
                {isOwner && <span style={{ color: BDR2, fontSize: 10 }}>·</span>}
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
                  <span style={{ fontSize: 12, color: MUTED, display: "inline-flex", alignItems: "center", gap: 5 }}><IconCalendar size={12} />{t("drawer.deadlineLabel")}</span>
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
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px 14px calc(40px + env(safe-area-inset-bottom))" : "18px 20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(250px, 0.8fr) minmax(520px, 1.85fr) minmax(360px, 1fr)", gap: 20, alignItems: "start" }}>

            {/* ════ RIGHT column: brief + references (was MAIN). order maps it to
                 the rightmost desktop track; on mobile it stacks 2nd (after Versions). ════ */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0, order: isMobile ? 2 : 3 }}>

              {/* ── קרא אותי קודם ── */}
              <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${BDR}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <IconPin size={14} style={{ color: TEXT2 }} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{t("drawer.readme")}</span>
                  </div>
                  {isOwner && !editingBrief && (
                    <button
                      onClick={() => { setBriefDraft(effectiveBrief); setEditingBrief(true); }}
                      style={{ fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 8, background: `${PURPLE}18`, border: `1px solid ${PURPLE}44`, color: PURPLE, cursor: "pointer", fontFamily: "inherit" }}
                     ><IconPencil size={11} style={{ marginInlineEnd: 4 }} />{t("drawer.edit")}</button>
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
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 10, fontSize: isMobile ? 16 : 14, lineHeight: 1.6, background: CARD2, border: `1px solid ${BDR}`, color: TEXT, outline: "none", fontFamily: "inherit", resize: "vertical", textAlign: "start", unicodeBidi: "plaintext", boxSizing: "border-box" }}
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
                      <div style={{ fontSize: isMobile ? 14.5 : 15, lineHeight: 1.65, color: "#DCDCE2", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 360, overflowY: "auto", textAlign: "start", unicodeBidi: "plaintext" }}>{effectiveBrief}</div>
                    ) : (
                      <div style={{ fontSize: 12.5, color: MUTED, textAlign: "center", padding: "28px 0", lineHeight: 1.7 }}>{isOwner ? t("drawer.briefEmptyOwner") : t("drawer.briefEmptyViewer")}</div>
                    )
                  )}

                  {/* ── Brief files: owner uploads/deletes, Victor views/downloads.
                       NOT versions, never in the player, no V-prefix. ── */}
                  {(isOwner || effectiveBriefFiles.length > 0) && (
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BDR}` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: TEXT2, display: "inline-flex", alignItems: "center", gap: 6 }}><IconPaperclip size={13} /> {t("brief.filesTitle")}{effectiveBriefFiles.length > 0 ? ` (${effectiveBriefFiles.length})` : ""}</span>
                        {isOwner && (
                          <button onClick={() => briefFileInputRef.current?.click()} disabled={briefUploading}
                            style={{ fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 8, background: `${PURPLE}18`, border: `1px solid ${PURPLE}44`, color: PURPLE, cursor: briefUploading ? "default" : "pointer", fontFamily: "inherit", opacity: briefUploading ? 0.6 : 1 }}>
                            {briefUploading ? "…" : t("brief.addFile")}
                          </button>
                        )}
                      </div>
                      <input ref={briefFileInputRef} type="file" style={{ display: "none" }} onChange={(e) => uploadBriefFile(e.target.files?.[0] ?? null)} />
                      {briefErr && <div style={{ fontSize: 11, color: RED, marginBottom: 8, unicodeBidi: "plaintext" } as React.CSSProperties}>{briefErr}</div>}
                      {effectiveBriefFiles.length === 0 ? (
                        <div style={{ fontSize: 11.5, color: MUTED, padding: "2px 0" }}>{t("brief.empty")}</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                          {effectiveBriefFiles.map((f, i) => {
                            // Brief AUDIO → inline player with structure segments (owner edits,
                            // Victor read-only). Non-audio brief files stay as plain rows.
                            if (isAudioFile(f.name)) {
                              return (
                                <BriefSegmentPlayer
                                  key={f.fileRef ?? f.dropboxPath ?? i}
                                  file={f}
                                  workId={work.id}
                                  isOwner={isOwner}
                                  onSaveSegments={(segments) => f.dropboxPath ? saveBriefSegments(f.dropboxPath, segments) : Promise.resolve(false)}
                                  onDownload={() => downloadFile(f, work.id)}
                                  onDelete={() => f.dropboxPath && deleteBriefFile(f.dropboxPath)}
                                  deleteConfirm={briefDelPath === f.dropboxPath}
                                  onDeleteConfirm={() => setBriefDelPath(f.dropboxPath ?? null)}
                                  onDeleteCancel={() => setBriefDelPath(null)}
                                  deleting={false}
                                  deleteError={false}
                                />
                              );
                            }
                            const hasUrl = !!(f.fileRef || f.dropboxShareUrl || f.url);
                            const ext = (f.name.split(".").pop() ?? "").toUpperCase().slice(0, 4);
                            const sz = f.size ? (f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`) : "";
                            return (
                              <div key={f.fileRef ?? f.dropboxPath ?? i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, background: CARD2, border: `1px solid ${BDR}`, minWidth: 0 }}>
                                <IconFile size={15} style={{ color: TEXT2 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div title={f.name} style={{ fontSize: 12.5, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", unicodeBidi: "plaintext" } as React.CSSProperties}>{f.name}</div>
                                  <div style={{ fontSize: 9.5, color: MUTED, marginTop: 2 }}>{ext}{sz ? ` · ${sz}` : ""}</div>
                                </div>
                                <button onClick={() => downloadFile(f, work.id)} disabled={!hasUrl} title={t("file.download")}
                                  style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: hasUrl ? "rgba(255,255,255,0.05)" : "transparent", border: `1px solid ${hasUrl ? BDR2 : "transparent"}`, color: hasUrl ? TEXT2 : `${MUTED}55`, cursor: hasUrl ? "pointer" : "not-allowed", padding: 0, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" }}><IconDownload size={14} /></button>
                                {isOwner && (
                                  briefDelPath === f.dropboxPath ? (
                                    <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                                      <button onClick={() => f.dropboxPath && deleteBriefFile(f.dropboxPath)} style={{ padding: "3px 8px", borderRadius: 7, fontSize: 10, fontWeight: 800, background: RED, border: "none", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>{t("drawer.confirm")}</button>
                                      <button onClick={() => setBriefDelPath(null)} style={{ padding: "3px 8px", borderRadius: 7, fontSize: 10, fontWeight: 700, background: CARD, border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", fontFamily: "inherit" }}>{t("drawer.cancel")}</button>
                                    </div>
                                  ) : (
                                    <button onClick={() => setBriefDelPath(f.dropboxPath ?? null)} title={t("file.delete")}
                                      style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", borderRadius: 7, cursor: "pointer", color: "#F87171", padding: "4px 7px", flexShrink: 0, fontFamily: "inherit", display: "flex", alignItems: "center" }}><IconTrash size={12} /></button>
                                  )
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── רפרנסים ── */}
              <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${BDR}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <IconLink size={14} style={{ color: TEXT2 }} />
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
                      <input value={refForm.url} onChange={e => setRefForm(f => ({ ...f, url: e.target.value }))} placeholder={t("drawer.refUrlPlaceholder")} dir="ltr" style={{ width: "100%", padding: "8px 11px", borderRadius: 9, fontSize: isMobile ? 16 : 12, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`, color: TEXT, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                      <input value={refForm.title} onChange={e => setRefForm(f => ({ ...f, title: e.target.value }))} placeholder={t("drawer.refTitlePlaceholder")} style={{ width: "100%", padding: "8px 11px", borderRadius: 9, fontSize: isMobile ? 16 : 12, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`, color: TEXT, outline: "none", fontFamily: "inherit", direction: "rtl", boxSizing: "border-box" }} />
                      <textarea value={refForm.note} onChange={e => setRefForm(f => ({ ...f, note: e.target.value }))} placeholder={t("drawer.refNotePlaceholder")} rows={2} style={{ width: "100%", padding: "8px 11px", borderRadius: 9, fontSize: isMobile ? 16 : 12, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`, color: TEXT2, outline: "none", fontFamily: "inherit", direction: "rtl", resize: "vertical", boxSizing: "border-box" }} />
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

            {/* ════ CENTER column: Versions — the prominent main area. order 2 on
                 desktop (middle track), order 1 on mobile (stacks first). ════ */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0, order: isMobile ? 1 : 2 }}>

          {/* Versions card */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, overflow: "hidden", minWidth: 0 }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 8, flexWrap: "wrap",
              padding: "12px 16px",
              borderBottom: effectiveFiles.length > 0 ? `1px solid ${BDR}` : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <IconMusic size={14} style={{ color: TEXT2 }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("versions.title")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={e => handleUploadBatch(e.target.files)}
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
                  {uploading ? (savingDbx ? t("files.saving") : `${uploadProgress}%`) : <><IconUpload size={11} style={{ marginInlineEnd: 4 }} />{t("files.upload")}</>}
                </button>
                {/* Owner-only: never expose the Dropbox folder link or the total
                    file count to Victor — he only needs Upload. */}
                {isOwner && effectiveShareLink && (
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
                      <IconArrowUpRight size={11} style={{ marginInlineEnd: 4 }} />{t("files.openDropbox")}
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
                      {openingDbx ? t("files.opening") : <><IconArrowUpRight size={11} style={{ marginInlineEnd: 4 }} />{t("files.openDropbox")}</>}
                    </button>
                  )
                )}
                {isOwner && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                    background: effectiveFiles.length > 0 ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.06)",
                    color: effectiveFiles.length > 0 ? GREEN : MUTED, whiteSpace: "nowrap", flexShrink: 0,
                  }}>{effectiveFiles.length} {t("files.count")}</span>
                )}
              </div>
            </div>

            {uploadError && (
              <div style={{ fontSize: 11, color: "#EF4444", padding: "4px 16px 2px", fontWeight: 600 }}>{uploadError}</div>
            )}

            {effectiveFiles.length === 0 ? (
              <div style={{ padding: "44px 20px", textAlign: "center" }}>
                <div style={{ marginBottom: 12, opacity: 0.22, display: "flex", justifyContent: "center", color: TEXT2 }}><IconMusic size={40} /></div>
                <div style={{ fontSize: 14, fontWeight: 700, color: TEXT2, marginBottom: 4 }}>{t("files.empty")}</div>
                <div style={{ fontSize: 12, color: MUTED }}>{t("files.emptySub")}</div>
              </div>
            ) : (
              <div style={{ padding: isMobile ? "12px" : "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                {versionGroups.map((g, gi) => {
                  const isLatest = gi === 0;
                  const open = openGroups[g.key] ?? isLatest; // Latest open by default
                  const isOlder = g.key === "__untagged__";
                  const num = /^V\d/.test(g.label) ? g.label.slice(1) : null;
                  const title = num ? `${t("versions.round")} ${num}` : isOlder ? t("versions.olderFiles") : (g.label || t("versions.round"));
                  const badge: React.ReactNode = num ? `V${num}` : isOlder ? <IconFolder size={15} /> : <IconMusic size={14} />;
                  const errNode = deleteError && deletingIdx !== null && g.files.some(x => x.sentIdx === deletingIdx)
                    ? <div style={{ fontSize: 10, color: RED, padding: "0 4px" }}>{t("file.retryError")}</div> : null;
                  return isLatest ? (
                    /* ── Latest Version — large, prominent card ── */
                    <div key={g.key} style={{ borderRadius: 16, background: `linear-gradient(160deg, ${PURPLE}16 0%, ${PURPLE}05 100%)`, border: `1px solid ${PURPLE}55`, boxShadow: `0 8px 30px ${PURPLE}14`, overflow: "hidden" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: isMobile ? "13px 14px" : "16px 18px", borderBottom: open ? `1px solid ${PURPLE}22` : "none" }}>
                        <div style={{ width: 42, height: 42, borderRadius: 11, background: `${PURPLE}26`, border: `1px solid ${PURPLE}55`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: PURPLE, flexShrink: 0 }}>{badge}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 16, fontWeight: 900, color: TEXT }}>{title}</span>
                            <span style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: `${PURPLE}26`, color: PURPLE, border: `1px solid ${PURPLE}55`, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}><IconStar size={10} /> {t("versions.latest")}</span>
                          </div>
                          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{g.files.length} {t("files.count")}</div>
                        </div>
                        <button onClick={() => setOpenGroups(s => ({ ...s, [g.key]: !open }))} title={title}
                          style={{ background: "transparent", border: "none", color: MUTED, cursor: "pointer", fontSize: 15, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", fontFamily: "inherit", flexShrink: 0 }}>▾</button>
                      </div>
                      {open && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: isMobile ? "12px" : "12px 16px 16px" }}>
                          {g.files.map(f => renderFileRow(f, true))}
                          {errNode}
                          {g.key !== "__untagged__" && renderReview(g.key)}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* ── Older version — compact collapsible row ── */
                    <div key={g.key} style={{ borderRadius: 12, background: CARD2, border: `1px solid ${BDR}`, overflow: "hidden" }}>
                      <button onClick={() => setOpenGroups(s => ({ ...s, [g.key]: !open }))}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "start" }}>
                        <span style={{ width: 32, height: 32, borderRadius: 8, background: `${PURPLE}18`, color: PURPLE, fontWeight: 900, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{badge}</span>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>{title}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 10, color: MUTED }}>{g.files.length}</span>
                        <span style={{ fontSize: 12, color: MUTED, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
                      </button>
                      {open && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 12px 12px" }}>
                          {g.files.map(f => renderFileRow(f, false))}
                          {errNode}
                          {g.key !== "__untagged__" && renderReview(g.key)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>{/* versions card */}
          </div>{/* center column */}

          {/* ════ LEFT column: progress / tracking / deadline / source / end.
               order 1 desktop (leftmost track), order 3 mobile (stacks last). ════ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0, order: isMobile ? 3 : 1 }}>

          {/* Tasks card */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: `1px solid ${BDR}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <IconCheckCircle size={15} style={{ color: GREEN }} />
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
                    color: GREEN, fontWeight: 900,
                  }}>
                    {t.done ? <IconCheck size={12} strokeWidth={2.4} /> : null}
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

            {/* Notes — owner-internal only (never shown to Victor). */}
            {isOwner && (
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
                  width: "100%", padding: "9px 12px", borderRadius: 10, fontSize: isMobile ? 16 : 13,
                  background: CARD2, border: `1px solid ${BDR}`,
                  color: TEXT2, outline: "none", fontFamily: "inherit",
                  resize: "vertical", lineHeight: 1.5, boxSizing: "border-box",
                  textAlign: "start", unicodeBidi: "plaintext",
                }}
              />
            </div>
            )}
          </div>

          {/* Bottom 2 cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

            {/* Deadline card */}
            <div style={{
              background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "14px 16px",
              borderTop: `3px solid ${work.internalDeadline ? (days !== null && days < 0 ? RED : AMBER) : BDR}`,
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><IconCalendar size={12} />{t("drawer.deadlineCard")}</div>
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
              <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><IconRefresh size={12} />{t("drawer.tracking")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {work.sentDate ? (
                  <div>
                    <div style={{ fontSize: 10, color: MUTED, marginBottom: 2, display: "flex", alignItems: "center", gap: 5 }}><IconUpload size={11} />{t("drawer.sent")}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TEXT2 }}>{fmtDate(work.sentDate)}</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: MUTED }}>{t("drawer.notSentYet")}</div>
                )}
                {work.returnedDate && (
                  <div>
                    <div style={{ fontSize: 10, color: MUTED, marginBottom: 2, display: "flex", alignItems: "center", gap: 5 }}><IconInbox size={11} />{t("drawer.returned")}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{fmtDate(work.returnedDate)}</div>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Source files (received from owner) — small, separate, not part of Versions */}
          {receivedFiles.length > 0 && (
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BDR}`, display: "flex", alignItems: "center", gap: 8 }}>
                <IconInbox size={14} style={{ color: TEXT2 }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{t("versions.sourceTitle")}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: MUTED }}>{receivedFiles.length}</span>
              </div>
              <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
                {receivedFiles.map((f, i) => {
                  const props = {
                    file: f, workId: work.id, onDownload: () => downloadFile(f, work.id),
                    deleteConfirm: false, onDeleteConfirm: () => {}, onDeleteCancel: () => {}, onDelete: () => {},
                    deleting: false, deleteError: false, canDelete: false,
                  };
                  return isAudioFile(f.name) ? <AudioPlayer key={`r${i}`} {...props} /> : <FileRow key={`r${i}`} {...props} />;
                })}
              </div>
            </div>
          )}

          {/* ── Send work to Victor (owner only) — manual push, no data change ── */}
          {isOwner && (!sendConfirm ? (
            <div>
              <button
                type="button"
                onClick={() => {
                  setSendDone(false);
                  setSendError(null);
                  // Canonical Victor name only — never work.projectName / artist.
                  if (!effectiveTitle.trim()) { setSendError(t("drawer.sendWorkNoTitle")); return; }
                  setSendConfirm(true);
                }}
                style={{
                  width: "100%", padding: "11px 0", borderRadius: 12,
                  background: `${PURPLE}14`, border: `1px solid ${PURPLE}44`,
                  color: PURPLE, fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {t("drawer.sendWork")}
              </button>
              {sendDone && (
                <div style={{ marginTop: 8, fontSize: 12, color: GREEN, fontWeight: 700, textAlign: "center" }}>
                  {t("drawer.sendWorkSuccess")}
                </div>
              )}
              {sendError && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: "#FCA5A5", fontWeight: 600, textAlign: "center", unicodeBidi: "plaintext" } as React.CSSProperties}>
                  {sendError}
                </div>
              )}
            </div>
          ) : (
            <div style={{ borderRadius: 12, background: `${PURPLE}12`, border: `1px solid ${PURPLE}3A`, padding: "12px 16px" }}>
              <div style={{ fontSize: 12, color: TEXT2, fontWeight: 700, marginBottom: 10, textAlign: "center", lineHeight: 1.6 }}>
                {t("drawer.sendWorkConfirm", { title: effectiveTitle.trim() })}
              </div>
              {sendError && (
                <div style={{ fontSize: 11, color: "#FCA5A5", marginBottom: 8, textAlign: "center", unicodeBidi: "plaintext" } as React.CSSProperties}>
                  {sendError}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={sendWorkToVictor}
                  disabled={sending}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 9, border: "none",
                    background: sending ? "#52526A" : PURPLE,
                    color: "#fff", fontSize: 13, fontWeight: 800,
                    cursor: sending ? "default" : "pointer", fontFamily: "inherit",
                  }}
                >
                  {sending ? t("drawer.sendWorkSending") : t("drawer.confirm")}
                </button>
                <button
                  onClick={() => { setSendConfirm(false); setSendError(null); }}
                  disabled={sending}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 9,
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                    color: "#A0A0B0", fontSize: 13, fontWeight: 700,
                    cursor: sending ? "default" : "pointer", fontFamily: "inherit",
                  }}
                >
                  {t("drawer.cancel")}
                </button>
              </div>
            </div>
          ))}

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
              <IconTrash size={13} style={{ marginInlineEnd: 6 }} />{t("drawer.removeProject")}
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
        </div>{/* scrollable body */}

        {/* Always-mounted audio + drawer-local fixed player (isolated from the
            app's global PlayerProvider — its own <audio>, own currentVictorAudio). */}
        <audio ref={playerAudioRef} preload="metadata" style={{ display: "none" }} />
        {/* Fixed player — ALWAYS visible; shows an empty state until a track is picked. */}
        <div style={{ flexShrink: 0, minHeight: isMobile ? undefined : 80, display: "flex", alignItems: "center", borderTop: `1px solid ${PURPLE}33`, background: "linear-gradient(0deg, #0A0A12 0%, #12121C 100%)", padding: isMobile ? "10px 12px calc(12px + env(safe-area-inset-bottom))" : "14px 26px", boxShadow: "0 -6px 24px rgba(0,0,0,0.4)" }}>
          {npItem ? (
            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 18, minWidth: 0, width: "100%" }}>
              {/* cover + now-playing info */}
              <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0, flexShrink: 1, flexBasis: isMobile ? "44%" : 250, maxWidth: isMobile ? 168 : 320 }}>
                <div style={{ width: isMobile ? 40 : 46, height: isMobile ? 40 : 46, borderRadius: 11, flexShrink: 0, background: `linear-gradient(145deg, ${PURPLE}44, ${PURPLE}18)`, border: `1px solid ${PURPLE}55`, display: "flex", alignItems: "center", justifyContent: "center", color: PURPLE, boxShadow: `0 0 16px ${PURPLE}22` }}><IconMusic size={18} /></div>
                <div style={{ minWidth: 0 }}>
                  <div title={npItem.file.name} style={{ fontSize: isMobile ? 12.5 : 13.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", unicodeBidi: "plaintext", textAlign: "start" }}>{npItem.file.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    {npItem.versionLabel && /^V\d/.test(npItem.versionLabel) && <span style={{ fontSize: 9, fontWeight: 900, padding: "1px 7px", borderRadius: 5, background: `${PURPLE}26`, color: PURPLE, border: `1px solid ${PURPLE}55`, whiteSpace: "nowrap" }}>{npItem.versionLabel}</span>}
                    <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 7px", borderRadius: 5, background: `${ROLE_COLOR[npItem.role]}22`, color: ROLE_COLOR[npItem.role], whiteSpace: "nowrap" }}>{t(`role.${npItem.role}`)}</span>
                  </div>
                </div>
              </div>
              {/* transport */}
              <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, flexShrink: 0, direction: "ltr" }}>
                <button onClick={() => playerStep(-1)} disabled={npIdx <= 0} title={t("player.prev")} style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: npIdx <= 0 ? "default" : "pointer", opacity: npIdx <= 0 ? 0.35 : 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}><IconSkipBack size={15} /></button>
                <button onClick={togglePlayer} title={pPlaying ? t("player.pause") : t("player.play")} style={{ width: isMobile ? 44 : 50, height: isMobile ? 44 : 50, borderRadius: "50%", background: `linear-gradient(145deg, ${PURPLE}, #6D28D9)`, border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", flexShrink: 0, boxShadow: `0 4px 16px ${PURPLE}55` }}>{pPlaying ? <IconPause size={18} /> : <IconPlay size={18} />}</button>
                <button onClick={() => playerStep(1)} disabled={npIdx < 0 || npIdx >= playlist.length - 1} title={t("player.next")} style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: (npIdx < 0 || npIdx >= playlist.length - 1) ? "default" : "pointer", opacity: (npIdx < 0 || npIdx >= playlist.length - 1) ? 0.35 : 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}><IconSkipForward size={15} /></button>
              </div>
              {/* progress + time */}
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: isMobile ? 7 : 12, minWidth: 0, direction: "ltr" }}>
                <span style={{ fontSize: 10.5, color: TEXT2, fontVariantNumeric: "tabular-nums", flexShrink: 0, direction: "ltr" }}>{fmtDur(pCur)}</span>
                <div ref={pBarRef}
                  onPointerDown={e => { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ } playerSeek(e.clientX); }}
                  onPointerMove={e => { if (e.buttons === 1) playerSeek(e.clientX); }}
                  style={{ flex: 1, minWidth: 40, padding: "8px 0", cursor: "pointer", touchAction: "none" }}>
                  <div style={{ height: 7, background: "rgba(255,255,255,0.12)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pDur > 0 ? (pCur / pDur) * 100 : 0}%`, background: `linear-gradient(90deg, ${PURPLE}, #A855F7)`, borderRadius: 4 }} />
                  </div>
                </div>
                <span style={{ fontSize: 10.5, color: TEXT2, fontVariantNumeric: "tabular-nums", flexShrink: 0, direction: "ltr" }}>{pDur > 0 ? fmtDur(pDur) : "—"}</span>
              </div>
              {/* volume (desktop) + download */}
              {!isMobile && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, direction: "ltr" }}>
                  <IconVolume size={14} style={{ color: MUTED }} />
                  <input type="range" min={0} max={1} step={0.01} value={pVol} onChange={e => setPVol(Number(e.target.value))} title="Volume" style={{ width: 84, accentColor: PURPLE, cursor: "pointer" }} />
                </div>
              )}
              <button onClick={() => downloadFile(npItem.file, work.id)} title={t("file.download")} style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", flexShrink: 0 }}><IconDownload size={15} /></button>
            </div>
          ) : (
            /* ── Empty state — no track selected. Controls muted/disabled, no download. ── */
            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 18, minWidth: 0, width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0, flexShrink: 1, flexBasis: isMobile ? "52%" : 260 }}>
                <div style={{ width: isMobile ? 40 : 46, height: isMobile ? 40 : 46, borderRadius: 11, flexShrink: 0, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`, display: "flex", alignItems: "center", justifyContent: "center", color: MUTED }}><IconMusic size={17} /></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: isMobile ? 12.5 : 13.5, fontWeight: 700, color: TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("player.noFileSelected")}</div>
                  <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("player.chooseFileToPlay")}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, flexShrink: 0, direction: "ltr" }}>
                <button disabled title={t("player.prev")} style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, color: MUTED, cursor: "default", opacity: 0.4, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}><IconSkipBack size={15} /></button>
                <button disabled title={t("player.play")} style={{ width: isMobile ? 44 : 50, height: isMobile ? 44 : 50, borderRadius: "50%", background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: MUTED, cursor: "default", opacity: 0.5, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", flexShrink: 0 }}><IconPlay size={18} /></button>
                <button disabled title={t("player.next")} style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, color: MUTED, cursor: "default", opacity: 0.4, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}><IconSkipForward size={15} /></button>
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: isMobile ? 7 : 12, minWidth: 0, direction: "ltr" }}>
                <span style={{ fontSize: 10.5, color: MUTED, fontVariantNumeric: "tabular-nums", flexShrink: 0, direction: "ltr" }}>0:00</span>
                <div style={{ flex: 1, minWidth: 40, padding: "8px 0" }}>
                  <div style={{ height: 7, background: "rgba(255,255,255,0.07)", borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 10.5, color: MUTED, fontVariantNumeric: "tabular-nums", flexShrink: 0, direction: "ltr" }}>—</span>
              </div>
              {!isMobile && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, opacity: 0.4, direction: "ltr" }}>
                  <IconVolume size={14} style={{ color: MUTED }} />
                  <input type="range" min={0} max={1} step={0.01} value={pVol} disabled style={{ width: 84, accentColor: MUTED, cursor: "default" }} />
                </div>
              )}
            </div>
          )}
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
              style={{ position: "absolute", top: 8, left: 8, zIndex: 2, width: 32, height: 32, borderRadius: 8, background: "rgba(0,0,0,0.6)", border: `1px solid ${BDR2}`, color: "#fff", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" }}
            ><IconX size={15} /></button>
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
  const isMobile = useIsMobile();
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
  const [roleChecked, setRoleChecked] = useState(false); // /api/me settled (success or fail)
  const isOwner = myRole === "owner";

  // ── Profile avatar (owner + Victor can edit; global via settings/Dropbox) ──
  const [avatar, setAvatar] = useState<{ imageUrl: string | null; zoom: number; posX: number; posY: number }>({ imageUrl: null, zoom: 1, posX: 50, posY: 50 });
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarHover, setAvatarHover] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarErr, setAvatarErr] = useState(false);
  const [dImg, setDImg] = useState<string | null>(null);   // editor draft image url
  const [dZoom, setDZoom] = useState(1);
  const [dPosX, setDPosX] = useState(50);
  const [dPosY, setDPosY] = useState(50);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/vendor/victor/avatar")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setAvatar({ imageUrl: d.imageUrl ?? null, zoom: d.zoom ?? 1, posX: d.posX ?? 50, posY: d.posY ?? 50 }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  function openAvatarEditor() {
    setDImg(avatar.imageUrl); setDZoom(avatar.zoom); setDPosX(avatar.posX); setDPosY(avatar.posY);
    setAvatarErr(false); setAvatarOpen(true);
  }
  async function uploadAvatar(file: File | null) {
    if (!file || avatarUploading) return;
    setAvatarUploading(true); setAvatarErr(false);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/vendor/victor/avatar", { method: "POST", body: fd });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setDImg(d.imageUrl ?? null); setDZoom(d.zoom ?? 1); setDPosX(d.posX ?? 50); setDPosY(d.posY ?? 50);
        setAvatar({ imageUrl: d.imageUrl ?? null, zoom: d.zoom ?? 1, posX: d.posX ?? 50, posY: d.posY ?? 50 });
      } else setAvatarErr(true);
    } catch { setAvatarErr(true); }
    finally { setAvatarUploading(false); if (avatarFileRef.current) avatarFileRef.current.value = ""; }
  }
  async function saveAvatarCrop() {
    if (avatarSaving) return;
    setAvatarSaving(true);
    try {
      const res = await fetch("/api/vendor/victor/avatar", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoom: dZoom, posX: dPosX, posY: dPosY }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d) setAvatar({ imageUrl: d.imageUrl ?? avatar.imageUrl, zoom: d.zoom, posX: d.posX, posY: d.posY });
    } catch { /* keep prior */ }
    finally { setAvatarSaving(false); setAvatarOpen(false); }
  }
  // Drag-to-pan on the editor preview (background-position %).
  function avatarPan(dx: number, dy: number, size: number) {
    setDPosX((x) => Math.max(0, Math.min(100, x - (dx / size) * 100)));
    setDPosY((y) => Math.max(0, Math.min(100, y - (dy / size) * 100)));
  }
  const roleLoading = myRole === null; // true only until role is known (cache or /api/me)

  // Restore the last-known role from cache BEFORE paint so the owner shell (or
  // the Victor shell) is committed immediately — no owner-only areas flashing
  // in/out during the async /api/me round-trip. Each browser only ever caches
  // its own role, so this never leaks owner chrome to a Victor session.
  useIso(() => {
    const cached = getCachedVictorRole();
    if (cached) setMyRole(cached);
  }, []);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.role === "owner" || d?.role === "victor") {
          setMyRole(d.role);
          rememberVictorRole(d.role); // cache role + coerce Victor off Hebrew (→ en)
        }
      })
      .catch(() => {})
      .finally(() => setRoleChecked(true)); // lift the loader gate even if /api/me failed
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

  // ── Deep-link: /team/victor?workId=… (from the "new work" push) ──
  // Opens that work's drawer exactly once. Searches the FULL work list — not the
  // current tab/filter — which is safe because getVictorWork() ignores the month
  // and returns every row. UI only: opens the drawer, sends no push and changes
  // no data. The param is cleared right after so closing + refreshing (or a plain
  // reload) never reopens it. Read from window.location instead of
  // useSearchParams() to avoid a Suspense boundary requirement.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current || loading) return;
    const wid = new URLSearchParams(window.location.search).get("workId");
    if (!wid) return;
    deepLinkedRef.current = true; // once per mount, even if the id no longer exists
    const match = work.find((w) => w.id === wid);
    if (match) setSelectedWork(match); // not found (deleted / not his) → ignore silently
    router.replace("/team/victor", { scroll: false });
  }, [loading, work, router]);

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

  // Only work attributed to the selected month — same helper the KPIs/salary use
  // (inMonth: sent_date, else created_at), so the table stays consistent with them.
  // Victor-only items (project_id=null) carry a sent_date on creation, so they filter too.
  const monthWork   = work.filter((w) => inMonth(w, month));
  const displayWork = monthWork.slice(0, 12);

  // Monthly capacity = work actually handled in the selected month (active +
  // completed, excluding cancelled), taken from the SAME monthWork array the
  // table renders — so the gauge, the table and the KPIs can't disagree.
  // Previously the gauge counted `completed` only, so a month with active-but-
  // not-yet-completed work read 0/goal even though the table showed rows.
  const capacityUsed = monthWork.filter((w) => w.status !== "בוטל").length;
  const pct          = goal > 0 ? Math.min(100, Math.round((capacityUsed / goal) * 100)) : 0;

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

  // Until the role is known, render a neutral, LANGUAGE-AGNOSTIC loader (no
  // localized text) so Victor never sees a flash of Hebrew before it resolves to
  // English. A returning session commits the cached role before paint (useIso),
  // so this only shows on a first visit / cleared storage. By the time it clears,
  // rememberVictorRole has already coerced a Victor session to English.
  if (myRole === null && !roleChecked) {
    return (
      <div style={{ minHeight: "100%", background: BG, display: "flex", alignItems: "center", justifyContent: "center", direction: "ltr", padding: 40 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 38 }} aria-label="Loading">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ width: 6, height: "100%", borderRadius: 3, background: PURPLE, transformOrigin: "bottom", animation: `eq${i} 0.9s ease-in-out infinite` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
    <div style={{
      minHeight: "100%", background: BG, color: TEXT,
      fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      // Extra bottom padding on mobile so the last cards clear the bottom nav.
      padding: isMobile ? "16px 14px 120px" : "32px 28px 80px",
    }}>
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>

        {/* ── Top bar: breadcrumb + month switcher ── */}
        <div style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: isMobile ? 12 : 0,
          marginBottom: isMobile ? 16 : 28,
        }}>
          {/* Left cluster: back (owner) + Victor-page language switcher (content-area only) */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, order: isMobile ? 2 : 0 }}>
            {isOwner && (
              <button
                onClick={() => router.push("/team")}
                style={{ ...btnStyle, display: "flex", alignItems: "center", gap: 6, color: TEXT2, fontSize: 14, fontWeight: 700 }}
              >
                <IconChevronRight size={14} />{t("header.backToList")}
              </button>
            )}
            <select
              value={lang}
              onChange={e => setVictorLang(e.target.value as VictorLang)}
              title={t("lang.label")}
              style={{ background: CARD, color: TEXT2, border: `1px solid ${BDR2}`, borderRadius: 10, padding: isMobile ? "9px 12px" : "7px 10px", fontSize: isMobile ? 16 : 12, fontFamily: "inherit", cursor: "pointer", outline: "none", appearance: "none", WebkitAppearance: "none", MozAppearance: "none", boxSizing: "border-box", minHeight: isMobile ? 42 : undefined }}
            >
              {allowedVictorLangs(myRole).map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>

          {/* Title */}
          <div style={{ textAlign: "center", order: isMobile ? 1 : 0 }}>
            <div style={{ fontSize: isMobile ? 11 : 12, color: MUTED, letterSpacing: "0.06em", marginBottom: 3 }}>{t("header.breadcrumb")}</div>
            <h1 style={{ fontSize: isMobile ? 20 : 26, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>
              {t("header.supplierProfile")} <span style={{ color: PURPLE }}>Viktor</span>
            </h1>
          </div>

          {/* Month switcher */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            background: CARD, border: `1px solid ${BDR2}`, borderRadius: 14,
            padding: "9px 18px", order: isMobile ? 3 : 0,
          }}>
            <button onClick={() => setMonth(m => prevMonth(m))} style={{ ...btnStyle, color: TEXT2, lineHeight: 1, display: "flex", alignItems: "center" }}><IconChevronLeft size={18} /></button>
            <div style={{ minWidth: 150, textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{victorMonthYear(month, lang)}</div>
              {loading && <div style={{ fontSize: 9, color: MUTED }}>{t("common.loading")}</div>}
            </div>
            <button onClick={() => setMonth(m => nextMonth(m))} style={{ ...btnStyle, color: TEXT2, lineHeight: 1, display: "flex", alignItems: "center" }}><IconChevronRight size={18} /></button>
          </div>
        </div>

        {/* ── Victor Info Card ── */}
        <div style={{
          background: CARD, border: `1px solid ${BDR2}`, borderRadius: 18,
          padding: isMobile ? "16px 16px" : "22px 28px", display: "flex", alignItems: "center",
          gap: isMobile ? 14 : 24, marginBottom: 18, flexWrap: isMobile ? "wrap" : "nowrap",
        }}>
          {/* Avatar — click / hover to edit (owner or Victor). Shows the saved
              image with its crop, or the "V" placeholder. */}
          <div
            onClick={openAvatarEditor}
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
            title={t("avatar.edit")}
            style={{
              width: isMobile ? 54 : 76, height: isMobile ? 54 : 76, borderRadius: "50%", flexShrink: 0,
              background: `linear-gradient(135deg, ${PURPLE}44 0%, #1a1035 100%)`,
              border: `2px solid ${PURPLE}55`, position: "relative", overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: isMobile ? 22 : 28, fontWeight: 900, color: PURPLE,
              boxShadow: `0 0 24px ${PURPLE}22`, cursor: "pointer",
            }}
          >
            {avatar.imageUrl ? (
              <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${avatar.imageUrl})`, backgroundSize: "cover", backgroundRepeat: "no-repeat", backgroundPosition: `${avatar.posX}% ${avatar.posY}%`, transform: `scale(${avatar.zoom})` }} />
            ) : "V"}
            {/* Edit overlay — full on desktop hover, small badge on mobile. */}
            {(avatarHover && !isMobile) ? (
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, color: "#fff" }}>
                <IconCamera size={16} />
                <span style={{ fontSize: 8.5, fontWeight: 700, textAlign: "center", lineHeight: 1.15, padding: "0 4px" }}>{t("avatar.edit")}</span>
              </div>
            ) : isMobile ? (
              <div style={{ position: "absolute", bottom: 0, right: 0, width: 20, height: 20, borderRadius: "50%", background: PURPLE, border: "2px solid #0A0A0D", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><IconCamera size={11} /></div>
            ) : null}
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, color: TEXT }}>Viktor</span>
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
                cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                width: isMobile ? "100%" : "auto",
              }}>
              {t("header.newVictorWork")}
            </button>
          )}
        </div>

        {/* ── KPI Row ── */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(150px, 1fr))", gap: isMobile ? 10 : 12, marginBottom: 18 }}>
          {(loading || roleLoading) ? (
            // Skeleton until BOTH the month data and the role are known — never
            // flash 0/— values. Default to 5 cards (owner); known-Victor shows 4.
            Array.from({ length: myRole === "victor" ? 4 : 5 }).map((_, i) => (
              <div key={i} style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16, padding: isMobile ? "13px 14px" : "18px 20px", minWidth: 0, gridColumn: isMobile && myRole !== "victor" && i === 4 ? "1 / -1" : undefined }}>
                <VShimmer w="60%" h={9} r={5} style={{ marginBottom: isMobile ? 10 : 13 }} />
                <VShimmer w={64} h={isMobile ? 22 : 28} r={8} />
                <VShimmer w="45%" h={9} r={5} style={{ marginTop: isMobile ? 8 : 10 }} />
              </div>
            ))
          ) : [
            { id: "goal",      label: t("kpi.totalMonthly"), value: goal > 0 ? goal : "—", sub: t("kpi.inProgressSub"), color: TEXT,   icon: <IconTarget size={56} /> },
            { id: "completed", label: t("kpi.completed"),    value: completed,              sub: t("kpi.completedOf", { goal }), color: PURPLE, icon: <IconCheckCircle size={56} /> },
            { id: "active",    label: t("kpi.inProgress"),   value: active,                 sub: t("kpi.inProgressSub"), color: AMBER,  icon: <IconRefresh size={56} /> },
            { id: "stuck",     label: t("kpi.stuck"),        value: stuck,                  sub: t("kpi.stuckSub"),      color: stuck > 0 ? RED : MUTED, icon: <IconAlert size={56} /> },
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
              padding: isMobile ? "13px 14px" : "18px 20px", position: "relative", overflow: "hidden",
              minWidth: 0, gridColumn: isMobile && id === "salary" ? "1 / -1" : undefined,
            }}>
              <div style={{
                position: "absolute", bottom: -8, left: -4,
                fontSize: 56, opacity: 0.05, userSelect: "none", pointerEvents: "none", lineHeight: 1,
              }}>{icon}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: isMobile ? 7 : 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
              <div style={{ fontSize: isMobile ? 24 : 30, fontWeight: 900, color, letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</div>
              {sub && <div style={{ fontSize: 11, color: TEXT2, marginTop: isMobile ? 6 : 8 }}>{sub}</div>}
            </div>
          ))}
        </div>

        {/* ── Main 3-Column Layout ── */}
        <div style={{
          display: "grid",
          // Match track count to the visible columns: Victor has no Salary column,
          // so use 2 tracks (otherwise the 3rd track is wasted empty space and the
          // Files/Capacity column is squished). minmax(0,…) keeps the table track
          // shrink-safe; the side tracks get a sensible min width.
          gridTemplateColumns: isMobile
            ? "1fr"
            : isOwner
              ? "minmax(0, 2fr) minmax(300px, 1fr) minmax(300px, 1fr)"
              : "minmax(0, 2fr) minmax(340px, 1fr)",
          gap: isMobile ? 12 : 16, alignItems: "start",
        }}>

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
              <span style={{ fontSize: 12, color: MUTED }}>{t("projects.in")}{victorMonthYear(month, lang)}</span>
            </div>

            {loading ? (
              <div style={{ padding: "16px 16px" }}>
                {[1,2,3,4,5].map(i => (
                  <div key={i} style={{ height: 12, background: "rgba(255,255,255,0.05)", borderRadius: 5, marginBottom: 10 }} />
                ))}
              </div>
            ) : displayWork.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center" }}>
                <div style={{ opacity: 0.2, marginBottom: 8, display: "flex", justifyContent: "center", color: TEXT2 }}><IconClipboard size={32} /></div>
                <div style={{ fontSize: 13, color: MUTED }}>{t("projects.empty")}</div>
              </div>
            ) : isMobile ? (
              <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                {displayWork.map(w => (
                  <div key={w.id} style={{ background: CARD2, border: `1px solid ${BDR}`, borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <IconMusic size={13} style={{ marginLeft: 4, color: MUTED }} />{victorWorkName(w)}
                        </div>
                        {(isOwner || w.internalDeadline) && (
                          <div style={{ fontSize: 12, color: TEXT2, marginTop: 4 }}>
                            {isOwner
                              ? `${w.artist || "—"}${w.internalDeadline ? ` · ${fmtDate(w.internalDeadline)}` : ""}`
                              : fmtDate(w.internalDeadline)}
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0 }}>
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
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedWork(w)}
                      style={{
                        ...btnStyle, width: "100%", maxWidth: "100%", marginTop: 12,
                        fontSize: 14, fontWeight: 700, color: "#EDE9FE",
                        padding: "12px 0", borderRadius: 10, boxSizing: "border-box",
                        border: `1px solid ${PURPLE}66`, background: `${PURPLE}22`,
                        cursor: "pointer", appearance: "none", WebkitAppearance: "none",
                        WebkitTapHighlightColor: "transparent", transition: "background .14s",
                      }}>
                      <IconArrowUpRight size={13} style={{ marginInlineEnd: 6 }} />{t("projects.open")}
                    </button>
                  </div>
                ))}
                {monthWork.length > 12 && (
                  <div style={{ paddingTop: 4, textAlign: "center" }}>
                    <span style={{ fontSize: 11, color: MUTED }}>{t("projects.more", { n: monthWork.length - 12 })}</span>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 540, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: CARD2 }}>
                      {[t("projects.colName"), ...(isOwner ? [t("projects.colArtist")] : []), t("projects.colDeadline"), t("projects.colStatus"), t("projects.colAction")].map(h => (
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
                          <IconMusic size={13} style={{ marginLeft: 4, color: MUTED }} />{victorWorkName(w)}
                        </td>
                        {isOwner && (
                          <td style={{ padding: "11px 14px", fontSize: 12, color: TEXT2, whiteSpace: "nowrap" }}>
                            {w.artist || "—"}
                          </td>
                        )}
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
                            <IconArrowUpRight size={13} style={{ marginInlineEnd: 6 }} />{t("projects.open")}
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

              {loading ? (
                // Skeleton counter + bar — no fake 0/0 or 0% before the fetch.
                <>
                  <div style={{ marginBottom: 4 }}><VShimmer w={110} h={38} r={9} /></div>
                  <div style={{ marginBottom: 14 }}><VShimmer w={130} h={11} /></div>
                  <VShimmer w="100%" h={11} r={6} style={{ marginBottom: 7 }} />
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                    <VShimmer w={70} h={10} /><VShimmer w={54} h={10} />
                  </div>
                </>
              ) : (
                <>
                  {/* Big counter */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4, direction: "ltr" }}>
                    <span style={{ fontSize: 40, fontWeight: 900, color: PURPLE, letterSpacing: "-0.04em" }}>{capacityUsed}</span>
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
                      ? <span style={{ color: GREEN, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><IconCheck size={11} />{t("capacity.onTrack")}</span>
                      : pct > 0
                        ? <span style={{ color: AMBER, fontWeight: 700 }}>{t("capacity.behind")}</span>
                        : null
                    }
                  </div>
                </>
              )}

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

            {/* Files Card — owner-only overview; Victor still sees per-work files inside the drawer */}
            {isOwner && (
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
                      <span style={{ flexShrink: 0, color: TEXT2, display: "flex" }}>{f.dir === "in" ? <IconInbox size={13} /> : <IconUpload size={13} />}</span>
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
            )}
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
                  {t("salary.title")} {victorMonthYear(month, lang)}
                </div>
                <IconPencil size={12} style={{ color: MUTED }} />
              </div>

              {/* Salary amount */}
              {(loading || salaryLoading) ? (
                <div style={{ marginBottom: 4 }}><VShimmer w={130} h={34} r={9} /></div>
              ) : (
                <div style={{
                  fontSize: 36, fontWeight: 900, letterSpacing: "-0.04em",
                  color: currentSalaryRec ? GREEN : (salary > 0 ? GREEN : MUTED),
                  marginBottom: 4,
                }}>
                  {currentSalaryRec
                    ? fmt(currentSalaryRec.amount, currentSalaryRec.currency)
                    : salary > 0 ? fmt(salary, currency) : "—"}
                </div>
              )}
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 16 }}>{t("salary.totalMonthly")}</div>

              {/* Salary details */}
              {(loading || salaryLoading) ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${BDR}`, paddingTop: 14 }}>
                  <VShimmer w="100%" h={12} /><VShimmer w="65%" h={12} />
                </div>
              ) : currentSalaryRec ? (
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
                          <div style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{victorMonthYear(s.workMonth, lang)}</div>
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

        </div>{/* main grid */}

        {/* ── Victor on mobile — logout at the END of the page content, so it
             scrolls with the page instead of pinning a bottom bar (MobileNav
             renders nothing for him and AppShell reserves no nav height, leaving
             only the iPhone safe-area inset under this button). Mirrors shalev's
             page-end area in ArtistPortalPage. Owner never sees it; on desktop
             the Sidebar footer keeps its own logout. A work drawer is a fixed
             overlay above this, so it covers the button as required. ── */}
        {isMobile && myRole === "victor" && (
          <div style={{ marginTop: 16, paddingTop: 18, borderTop: `1px solid ${BDR}` }}>
            <button
              onClick={signOutAndRedirect}
              style={{
                width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "14px 0", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                fontSize: 14, fontWeight: 800, color: "#EF4444",
                background: "rgba(220,38,38,0.10)", border: "1px solid rgba(220,38,38,0.35)",
              }}
            >
              <IconLogOut size={15} /> {t("common.signOut")}
            </button>
          </div>
        )}
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
          position: "fixed",
          top: isMobile ? 10 : "50%", left: "50%",
          transform: isMobile ? "translateX(-50%)" : "translate(-50%,-50%)",
          zIndex: 999,
          width: isMobile ? "calc(100vw - 20px)" : 420, maxWidth: isMobile ? "100%" : "94vw",
          maxHeight: isMobile ? "calc(100dvh - 20px)" : "90vh", overflowY: "auto",
          background: CARD, border: `1px solid ${BDR2}`, borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,0.85)",
          padding: isMobile ? "20px 18px calc(24px + env(safe-area-inset-bottom))" : 24,
          direction: "rtl", boxSizing: "border-box",
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 4 }}>{t("newwork.title")}</div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 20 }}>{t("newwork.subtitle")}</div>

          {wtError && <div style={{ fontSize: 12, color: "#EF4444", marginBottom: 12, fontWeight: 600 }}>{wtError}</div>}

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>{t("newwork.nameLabel")}</div>
            <input value={wtTitle} onChange={e => setWtTitle(e.target.value)} autoFocus style={{ ...WT_INPUT, fontSize: isMobile ? 16 : 13 }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>{t("newwork.status")}</div>
            <select value={wtStatus} onChange={e => setWtStatus(e.target.value)} style={{ ...WT_INPUT, cursor: "pointer", fontSize: isMobile ? 16 : 13, appearance: "none", WebkitAppearance: "none", MozAppearance: "none" }}>
              {VICTOR_WORK_STATUSES.map(s => <option key={s} value={s}>{statusLabel(lang, s)}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginBottom: 6 }}>{t("newwork.notesLabel")}</div>
            <textarea value={wtNotes} onChange={e => setWtNotes(e.target.value)} rows={3} style={{ ...WT_INPUT, resize: "vertical", lineHeight: 1.5, fontSize: isMobile ? 16 : 13 }} />
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
    {/* Avatar editor — owner or Victor. Non-destructive: source in Dropbox, crop
        (zoom/position) saved as metadata; opens with the last state. */}
    {avatarOpen && (
      <div
        onClick={() => { if (!avatarUploading && !avatarSaving) setAvatarOpen(false); }}
        style={{ position: "fixed", inset: 0, zIndex: 100060, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          dir={lang === "he" ? "rtl" : "ltr"}
          style={{ width: "min(360px, 94vw)", background: CARD, border: `1px solid ${BDR2}`, borderRadius: 20, padding: "22px 22px 20px", boxShadow: "0 24px 80px rgba(0,0,0,0.9)", fontFamily: "'Heebo', Arial, sans-serif" }}
        >
          <div style={{ fontSize: 15, fontWeight: 900, color: TEXT, marginBottom: 16, textAlign: "center" }}>{t("avatar.title")}</div>

          {/* Circular editor preview — drag to pan */}
          <div
            onPointerDown={(e) => { if (!dImg) return; dragRef.current = { x: e.clientX, y: e.clientY }; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ } }}
            onPointerMove={(e) => { if (!dragRef.current || e.buttons !== 1) return; const dx = e.clientX - dragRef.current.x; const dy = e.clientY - dragRef.current.y; dragRef.current = { x: e.clientX, y: e.clientY }; avatarPan(dx, dy, 220); }}
            onPointerUp={() => { dragRef.current = null; }}
            style={{ width: 220, height: 220, margin: "0 auto", borderRadius: "50%", overflow: "hidden", position: "relative", border: `2px solid ${PURPLE}55`, background: `linear-gradient(135deg, ${PURPLE}33, #14101f)`, cursor: dImg ? "grab" : "default", touchAction: "none", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {dImg ? (
              <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${dImg})`, backgroundSize: "cover", backgroundRepeat: "no-repeat", backgroundPosition: `${dPosX}% ${dPosY}%`, transform: `scale(${dZoom})` }} />
            ) : (
              <div style={{ color: PURPLE, fontSize: 40, fontWeight: 900 }}>V</div>
            )}
            {avatarUploading && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>…</div>
            )}
          </div>

          {/* Zoom */}
          {dImg && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10.5, color: MUTED, fontWeight: 700, marginBottom: 5, display: "flex", justifyContent: "space-between" }}>
                <span>{t("avatar.zoom")}</span><span style={{ fontSize: 9, color: MUTED }}>{t("avatar.drag")}</span>
              </div>
              <input type="range" min={1} max={3} step={0.01} value={dZoom} onChange={(e) => setDZoom(Number(e.target.value))} style={{ width: "100%", accentColor: PURPLE, cursor: "pointer", direction: "ltr" }} />
            </div>
          )}

          <input ref={avatarFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: "none" }} onChange={(e) => uploadAvatar(e.target.files?.[0] ?? null)} />

          {avatarErr && <div style={{ fontSize: 11, color: RED, marginTop: 10, textAlign: "center" }}>{t("avatar.uploadFail")}</div>}

          <button
            onClick={() => avatarFileRef.current?.click()}
            disabled={avatarUploading}
            style={{ width: "100%", marginTop: 14, padding: "9px 0", borderRadius: 10, background: `${PURPLE}18`, border: `1px solid ${PURPLE}44`, color: PURPLE, fontSize: 12.5, fontWeight: 800, cursor: avatarUploading ? "default" : "pointer", fontFamily: "inherit" }}
          ><IconCamera size={13} /> {dImg ? t("avatar.replace") : t("avatar.choose")}</button>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={() => setAvatarOpen(false)} disabled={avatarUploading || avatarSaving} style={{ flex: 1, padding: "10px 0", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{t("drawer.cancel")}</button>
            <button onClick={saveAvatarCrop} disabled={avatarUploading || avatarSaving || !dImg} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: (avatarSaving || !dImg) ? "default" : "pointer", fontFamily: "inherit", background: (avatarSaving || !dImg) ? MUTED : PURPLE }}>{avatarSaving ? "…" : t("avatar.save")}</button>
          </div>
        </div>
      </div>
    )}

    {salaryModalOpen && (
      <>
        <div
          onClick={() => { if (!salarySaving) setSalaryModalOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 998 }}
        />
        <div style={{
          position: "fixed",
          top: isMobile ? 10 : "50%", left: "50%",
          transform: isMobile ? "translateX(-50%)" : "translate(-50%,-50%)",
          zIndex: 999,
          width: isMobile ? "calc(100vw - 20px)" : 380, maxWidth: isMobile ? "100%" : "92vw",
          maxHeight: isMobile ? "calc(100dvh - 20px)" : undefined, overflowY: isMobile ? "auto" : undefined,
          background: CARD, border: `1px solid ${BDR2}`, borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,0.85)",
          padding: isMobile ? "20px 18px calc(24px + env(safe-area-inset-bottom))" : 24,
          direction: "rtl", boxSizing: "border-box",
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 4 }}>{t("salaryModal.title")}</div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 20 }}>{victorMonthYear(month, lang)}</div>

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
                  background: CARD2, color: TEXT, fontSize: isMobile ? 16 : 14, fontFamily: "inherit",
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
