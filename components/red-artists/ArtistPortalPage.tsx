"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { getLatestAudioFile, getFreshPlayUrl, usePlayerSafe } from "@/components/PlayerProvider";
import { useRole, type ClientRole } from "@/lib/use-role";
import { signOutAndRedirect } from "@/lib/supabase-browser";
import type { Project } from "@/lib/types";
import DatePickerInput from "@/components/ui/DatePickerInput";

// Mobile breakpoint (≤640px) — switches the portal to a stacked, card-based,
// touch-friendly layout. UI only; no data/logic change.
function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const check = () => setM(window.innerWidth <= 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return m;
}

// ── Redbloods design tokens (black / dark-grey / red / white — NO purple) ─────────
const BDR    = "rgba(255,255,255,0.06)";
const BDR2   = "rgba(255,255,255,0.10)";
const BRAND  = "#DC2626";
const TEXT   = "#F2F2F2";
const TEXT2  = "#A0A0A0";
const MUTED  = "#606060";
const GREEN  = "#34D399";
const AMBER  = "#F59E0B";
const BLUE   = "#60A5FA";

// Premium dark panel: faint top highlight + inner gradient + deep drop shadow.
const panel: React.CSSProperties = {
  background: "linear-gradient(180deg, #161617 0%, #111112 100%)",
  border: `1px solid ${BDR2}`,
  borderRadius: 18,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 14px 34px rgba(0,0,0,0.4)",
  overflow: "hidden",
};

// ── Player icons — clean monochrome SVG (Lucide-style, no emoji, no deps) ─────────
type IcoProps = { size?: number; color?: string };
function Svg({ size, color, fill, children }: { size: number; color: string; fill: string; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>{children}</svg>
  );
}
const IcPlay     = ({ size = 20, color = "#fff" }: IcoProps) => <Svg size={size} color={color} fill={color}><polygon points="6 4 20 12 6 20 6 4" /></Svg>;
const IcPause    = ({ size = 20, color = "#fff" }: IcoProps) => <Svg size={size} color={color} fill={color}><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></Svg>;
const IcSkipFwd  = ({ size = 20, color = TEXT }: IcoProps)  => <Svg size={size} color={color} fill="none"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></Svg>;
const IcSkipBack = ({ size = 20, color = TEXT }: IcoProps)  => <Svg size={size} color={color} fill="none"><polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" /></Svg>;
const IcShuffle  = ({ size = 18, color = TEXT2 }: IcoProps) => <Svg size={size} color={color} fill="none"><path d="M16 3h5v5" /><path d="M4 20 21 3" /><path d="M21 16v5h-5" /><path d="m15 15 6 6" /><path d="M4 4l5 5" /></Svg>;
const IcRepeat   = ({ size = 18, color = TEXT2 }: IcoProps) => <Svg size={size} color={color} fill="none"><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></Svg>;
const IcHeart    = ({ size = 18, color = "#FF6B6B" }: IcoProps) => <Svg size={size} color={color} fill={color}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" /></Svg>;
const IcVolume   = ({ size = 18, color = TEXT2 }: IcoProps) => <Svg size={size} color={color} fill="none"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></Svg>;
const IcList     = ({ size = 18, color = MUTED }: IcoProps) => <Svg size={size} color={color} fill="none"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3.5" y1="6" x2="3.5" y2="6" /><line x1="3.5" y1="12" x2="3.5" y2="12" /><line x1="3.5" y1="18" x2="3.5" y2="18" /></Svg>;
const IcMonitor  = ({ size = 18, color = MUTED }: IcoProps) => <Svg size={size} color={color} fill="none"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></Svg>;
const IcUpload   = ({ size = 18, color = "#fff" }: IcoProps) => <Svg size={size} color={color} fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></Svg>;
const IcX        = ({ size = 18, color = TEXT2 }: IcoProps) => <Svg size={size} color={color} fill="none"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>;
const IcCloud    = ({ size = 26, color = TEXT2 }: IcoProps) => <Svg size={size} color={color} fill="none"><path d="M12 13v8" /><path d="m8 17 4-4 4 4" /><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" /></Svg>;
const IcEdit     = ({ size = 18, color = TEXT2 }: IcoProps) => <Svg size={size} color={color} fill="none"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>;
const IcTrash    = ({ size = 18, color = "#F87171" }: IcoProps) => <Svg size={size} color={color} fill="none"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></Svg>;
const IcClock    = ({ size = 14, color = MUTED }: IcoProps) => <Svg size={size} color={color} fill="none"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></Svg>;
const IcMusicNote = ({ size = 26, color = TEXT2 }: IcoProps) => <Svg size={size} color={color} fill="none"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Svg>;
const IcChevron  = ({ size = 16, color = "#FF6B6B" }: IcoProps) => <Svg size={size} color={color} fill="none"><polyline points="15 18 9 12 15 6" /></Svg>;
// Drag handle — six dots (grip). Filled dots read clearly at small sizes.
const IcGrip = ({ size = 16, color = MUTED }: IcoProps) => <Svg size={size} color={color} fill={color}><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></Svg>;

// Single unified play button used in EVERY list across the portal (desktop +
// mobile): dark circle, subtle red border + glow, clean white SVG play icon.
// Reflects the GLOBAL player: `playing` = this row's track is currently playing
// → shows ❚❚. `disabled` = no playable audio file.
function PlayButton({ size = 40, disabled = false, playing = false, onClick }: { size?: number; disabled?: boolean; playing?: boolean; onClick?: () => void }) {
  return (
    <button aria-label={playing ? "השהה" : "נגן"} disabled={disabled} onClick={onClick} title={disabled ? "אין קובץ אודיו זמין" : undefined} style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
      background: "radial-gradient(circle at 50% 35%, rgba(220,38,38,0.22), #150809 75%)",
      border: `1px solid ${BRAND}55`, boxShadow: `0 0 14px rgba(220,38,38,0.3)`, opacity: disabled ? 0.35 : 1,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {playing ? <IcPause size={Math.round(size * 0.42)} /> : <IcPlay size={Math.round(size * 0.42)} />}
    </button>
  );
}

// Library row Play/Pause — driven by the global player (same in home + tab).
function LibRowPlay({ size, player, row, onError }: {
  size: number; player: ReturnType<typeof usePlayerSafe>; row: LibRow; onError?: (m: string) => void;
}) {
  const { isPlaying, onClick } = libRowPlay(player, row, onError);
  return <PlayButton size={size} disabled={!row.hasAudio} playing={isPlaying} onClick={onClick} />;
}

// ── Demo data (UI only — hardcoded, no DB) ───────────────────────────────────────
type SongStatus = "ממתין לאישור" | "בבדיקה" | "מאושר" | "סקיצה";
const STATUS_COLOR: Record<SongStatus, string> = {
  "ממתין לאישור": AMBER,
  "בבדיקה":       BLUE,
  "מאושר":        GREEN,
  "סקיצה":        MUTED,
};

const SONGS: { name: string; kind: string; status: SongStatus; date: string }[] = [
  { name: "הסיפור שלי",  kind: "מיקס",  status: "ממתין לאישור", date: "28.05.2025" },
  { name: "לב של זמן",   kind: "סקיצה", status: "בבדיקה",       date: "27.05.2025" },
  { name: "קלוזר חלק 2", kind: "מאסטר", status: "מאושר",        date: "26.05.2025" },
  { name: "חיים אחרים",  kind: "סקיצה", status: "סקיצה",        date: "25.05.2025" },
];


// ── "המוזיקה שלי" page (music tab) — demo library (UI only) ───────────────────────
const MUSIC_STATUS_COLOR: Record<string, string> = {
  // demo values (kept for the upload modal)
  "מוכן":         "#34D399",
  "ממתין לאישור":  "#F59E0B",
  "סקיצה":        "#9CA3AF",
  "בבחינה":       "#2DD4BF",
  "בבדיקה":       "#60A5FA",
  // real ProjectStatus values (no purple)
  "בעבודה":       "#60A5FA",
  "מחכה למיקס":    "#F59E0B",
  "במיקס":        "#2DD4BF",
  "הושלם":        "#34D399",
  "בהשהייה":      "#9CA3AF",
  "לא התחיל":     "#6B7280",
};
type LibTrack = { name: string; kind: string; status: string; date: string; dur: string; artists: string };
const LIBRARY: LibTrack[] = [
  { name: "הסיפור שלי",   kind: "מיקס",  status: "ממתין לאישור", date: "08.06.2025", dur: "03:42", artists: "שליו טסמה" },
  { name: "לב של זמן",    kind: "סקיצה", status: "סקיצה",        date: "27.05.2025", dur: "02:58", artists: "שליו טסמה" },
  { name: "קלוזר חלק 2",  kind: "מאסטר", status: "מוכן",         date: "26.05.2025", dur: "04:11", artists: "שליו טסמה, אבי מולה" },
  { name: "חיים אחרים",   kind: "סקיצה", status: "ממתין לאישור", date: "23.05.2025", dur: "03:09", artists: "שליו טסמה" },
  { name: "תל אביב בלילה", kind: "דמו",   status: "בבחינה",       date: "20.05.2025", dur: "02:37", artists: "שליו טסמה, נגאש" },
  { name: "עד שנפגש",     kind: "מיקס",  status: "ממתין לאישור", date: "18.05.2025", dur: "03:55", artists: "שליו טסמה" },
  { name: "אורות בלילה",   kind: "סקיצה", status: "סקיצה",        date: "15.05.2025", dur: "03:21", artists: "שליו טסמה" },
  { name: "רחוק מכאן",     kind: "מיקס",  status: "ממתין לאישור", date: "12.05.2025", dur: "02:49", artists: "שליו טסמה, ליאור נרקיס" },
  { name: "סימנים",        kind: "מאסטר", status: "מוכן",         date: "09.05.2025", dur: "04:02", artists: "שליו טסמה" },
  { name: "לא חוזר אחורה",  kind: "דמו",   status: "בבחינה",       date: "06.05.2025", dur: "03:12", artists: "שליו טסמה" },
  { name: "בין השורות",    kind: "סקיצה", status: "סקיצה",        date: "02.05.2025", dur: "02:58", artists: "שליו טסמה, נגאש" },
  { name: "עד הבוקר",      kind: "מיקס",  status: "ממתין לאישור", date: "28.04.2025", dur: "03:37", artists: "שליו טסמה" },
];
// Shorter labels for the compact mobile KPI strip.
const KPI_SHORT: Record<string, string> = { "סה״כ שירים": "שירים", "עם אודיו": "אודיו" };

const TABS = ["בית", "המוזיקה שלי", "ההופעות שלי", "מאזן", "ביטים פנויים", "לו״ז ועדכונים", "קבצי הופעות ויח״צ"] as const;
type Tab = (typeof TABS)[number];

const DEFAULT_TAB: Tab = "בית";
// Stable ASCII slugs for the `?tab=` URL param (the tab labels themselves are Hebrew).
const TAB_SLUGS: Record<Tab, string> = {
  "בית": "home",
  "המוזיקה שלי": "music",
  "ההופעות שלי": "shows",
  "מאזן": "balance",
  "ביטים פנויים": "beats",
  "לו״ז ועדכונים": "schedule",
  "קבצי הופעות ויח״צ": "files",
};
const SLUG_TO_TAB: Record<string, Tab> = Object.fromEntries(
  (Object.entries(TAB_SLUGS) as [Tab, string][]).map(([t, slug]) => [slug, t]),
) as Record<string, Tab>;
/** Read the active tab from the current URL's `?tab=` (client-only). */
function tabFromUrl(): Tab | null {
  if (typeof window === "undefined") return null;
  const slug = new URLSearchParams(window.location.search).get("tab");
  return slug && SLUG_TO_TAB[slug] ? SLUG_TO_TAB[slug] : null;
}

// ── Small shared building blocks ─────────────────────────────────────────────────
function SectionCard({ title, link, children }: { title: string; link?: string; children: React.ReactNode }) {
  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: `1px solid ${BDR}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
          <span style={{ fontSize: 16, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>{title}</span>
        </div>
        {link && <button style={linkBtn}>{link}</button>}
      </div>
      {children}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: BRAND, fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit", padding: 0,
};

// ── Shalev's real music library — SINGLE SOURCE OF TRUTH (home + music tab) ──────
// projects.artist is a multi-artist string split by /[,،;]/ across the whole app
// (see ClientDrawer/ProjectsTable/InsightsPage). A project belongs to Shalev when
// "שליו טסמה" is one of those tokens — this catches solo AND collaborations,
// while still requiring the FULL name (never a loose "שליו" substring).
const SHALEV_ARTIST = "שליו טסמה";
const normName = (s: string) => (s ?? "").trim().replace(/\s+/g, " ");
function artistTokens(artist: string): string[] {
  return (artist ?? "").split(/[,،;]/).map(normName).filter(Boolean);
}
type AudioFile = ReturnType<typeof getLatestAudioFile>; // { name; url; dropboxPath?; ... } | null
export type LibRow = { id: string; name: string; artist: string; status: string; projectType: string; hasAudio: boolean; audio: AudioFile; durationSeconds?: number };
function toLibRow(p: Project): LibRow {
  const audio = getLatestAudioFile(p.files ?? []); // existing helper — real audio only, no stems/delivery
  // Read the stored length (if any) off the real FileLink (typed → no cast).
  const durationSeconds = audio?.dropboxPath
    ? p.files?.find(f => f.dropboxPath === audio.dropboxPath)?.durationSeconds
    : undefined;
  return {
    id: p.id, name: p.name, artist: p.artist, status: p.status,
    projectType: p.projectType, hasAudio: !!audio, audio, durationSeconds,
  };
}
function mmss(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
// DB date "YYYY-MM-DD" → "DD.MM.YYYY" (or "—" when missing).
function fmtShowDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return (y && m && day) ? `${day}.${m}.${y}` : d;
}
function fmtMoney(n: number, curr = "₪"): string {
  return `${curr}${Math.round(n).toLocaleString("en-US")}`;
}

// ── Real Shalev summary (server-scoped, owner-only, READ-ONLY) ────────────────────
// From GET /api/red-artists/shalev-summary. Shows carry NO money; balance is only
// Shalev's artist-fee ("שכר אמן") transactions. Empty/"—" when no real source.
export type PortalShow = { id: string; name: string; date: string | null; startTime: string | null; location: string; status: string };
export type PortalPayment = { id: string; date: string | null; description: string; amount: number; currency: string };
export type WeeklyItem = { type: string; title: string; date: string | null; startTime: string | null; endTime?: string | null; location?: string | null };
export type PortalUpdate = { type: string; title: string; description: string; date: string | null };
export type ShalevSummary = {
  shows: { upcoming: PortalShow[]; done: PortalShow[] };
  balance: { paidTotal: number; expectedTotal: number; currency: string; payments: PortalPayment[]; hasData: boolean };
  weekly: WeeklyItem[];
  updates: PortalUpdate[];
};
type LoadState = "loading" | "ready" | "error";

// ── Owner-only artist balance ledger (GET /api/label/artists/[id]/balance) ────────
// Manual, independent ledger — NOT sourced from shalev-summary/transactions/Shows.
// The five canonical entry types + totals mirror lib/artist-balance-store.ts exactly.
export const BALANCE_TYPES = ["הכנסות", "הכנסות צפויות", "תשלומים", "הוצאות", "הוצאות צפויות"] as const;
export type BalanceType = (typeof BALANCE_TYPES)[number];
export type BalanceEntry = {
  id: string; artistId: string; entryType: BalanceType; amount: number;
  entryDate: string; description: string; note: string;
  sourceTxId: string | null; createdAt: string; updatedAt: string;
};
export type BalanceTotals = { income: number; expectedIncome: number; payments: number; expenses: number; expectedExpenses: number; currentBalance: number };
export type BalanceLedger = { entries: BalanceEntry[]; totals: BalanceTotals };

// ── Standalone sketches library (manifest-backed, NO Projects) ────────────────────
// Source of truth: GET /api/red-artists/sketches. Client never manages versions/paths.
export type SketchVersion = {
  versionNumber: number; fileName: string; filePath: string; extension: string;
  uploadedAt: string; sizeBytes?: number; durationSeconds?: number;
};
export type Sketch = {
  id: string; title: string; description: string; notes: string;
  createdAt: string; updatedAt: string;
  latestVersion: number; latestFilePath: string; latestFileName: string;
  durationSeconds?: number; versions: SketchVersion[]; archived: boolean; archivedAt?: string | null;
};
// Stream URL for a sketch's latest file — the version is a cache-buster so a new V{n}
// never plays the previous URL from cache.
function sketchStreamUrl(s: Sketch): string {
  return `/api/red-artists/stream?path=${encodeURIComponent(s.latestFilePath)}&v=${s.latestVersion}`;
}
// "YYYY-MM-DD..." or ISO → "DD.MM.YYYY".
function fmtSketchDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : iso;
}

// ── Next release — the portal's manifest-stored pointer (a sketch + a date). ──────
// Source of truth = /api/red-artists/next-release (manifest). NOT Projects / not
// project_release_details. `title` is the chosen sketch's live title.
export type PortalRelease = { sketchId: string; title: string; releaseDate: string };

// ── Next project to work on — OWNER-chosen, manifest-stored pointer (a sketch +
// an OPTIONAL deadline). Source = /api/red-artists/next-work. SEPARATE from
// nextRelease (never derived from it). deadline is the project's real, owner-set date.
export type PortalWork = { sketchId: string; title: string; deadline: string | null };

function getShalevMusicProjects(projects: Project[]): LibRow[] {
  const target = normName(SHALEV_ARTIST);
  return (Array.isArray(projects) ? projects : [])
    .filter(p => !p.isHidden && artistTokens(p.artist).includes(target))
    .map(toLibRow);
}

// Play a library row through the EXISTING global player (same call ProjectsTable
// uses). No new player, no new audio element — PlayerProvider handles LISTEN/Radio.
async function playLibRow(player: ReturnType<typeof usePlayerSafe>, t: LibRow, onError?: (m: string) => void) {
  if (!t.audio || !player) return;
  try {
    const url = await getFreshPlayUrl(t.audio);
    player.play({ projectId: t.id, projectName: t.name, artist: t.artist, fileName: t.audio.name, url });
  } catch {
    onError?.("לא ניתן להשמיע כרגע");
  }
}

// dropboxPaths whose duration we've already tried to persist this session — so
// the learn-and-save effect fires AT MOST once per file (survives re-renders /
// tab switches). Removed on failure so it can retry.
const durationLearned = new Set<string>();

// Derive a row's play button state ENTIRELY from the global player (no local
// state → home and the tab stay in sync automatically). A row is "playing" when
// the global track is this project AND the player is playing. Clicking toggles
// pause/resume for the current track, or starts this row otherwise.
function libRowPlay(player: ReturnType<typeof usePlayerSafe>, t: LibRow, onError?: (m: string) => void) {
  const isCurrent = !!player?.track && player.track.projectId === t.id;
  const isPlaying = isCurrent && !!player?.playing;
  const onClick = () => {
    if (!t.hasAudio || !player) return;
    if (isPlaying) player.pause();
    else if (isCurrent) player.resume();
    else void playLibRow(player, t, onError);
  };
  return { isPlaying, onClick };
}

function rowHover(e: React.MouseEvent<HTMLElement>, on: boolean) {
  e.currentTarget.style.background = on ? "rgba(220,38,38,0.06)" : "transparent";
  e.currentTarget.style.borderColor = on ? "rgba(220,38,38,0.28)" : "transparent";
}

// ── Page ─────────────────────────────────────────────────────────────────────────
export default function ArtistPortalPage({ initialRole, artistId }: { initialRole?: ClientRole; artistId?: string } = {}) {
  // The balance area (tab + home card) is OWNER-ONLY. `initialRole` comes from the
  // server (flash-free); useRole confirms it client-side. Shalev never sees balance
  // (also stripped server-side in shalev-summary).
  const liveRole = useRole();
  const role = liveRole ?? initialRole ?? null;
  const isShalev = role === "shalev";
  const isOwner = role === "owner";

  // Tab is mirrored in the URL (`?tab=<slug>`) so a refresh keeps the user on the
  // same tab and Back/Forward work. Initial state is the default (server + first
  // client render match → no hydration mismatch); the real URL is read on mount.
  const [tab, setTabState] = useState<Tab>(DEFAULT_TAB);
  useEffect(() => {
    const sync = () => {
      const t = tabFromUrl() ?? DEFAULT_TAB;
      // Shalev now sees every tab (מאזן + ביטים are read-only for him), so no tab
      // is forced back home; ?tab=balance / ?tab=beats open normally.
      setTabState(t);
    };
    sync(); // adopt the tab from the URL on load
    window.addEventListener("popstate", sync); // Back/Forward
    return () => window.removeEventListener("popstate", sync);
  }, [isShalev]);
  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (t === DEFAULT_TAB) url.searchParams.delete("tab");
    else url.searchParams.set("tab", TAB_SLUGS[t]); // only touch `tab` — other params kept
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
  }, []);
  const isMobile = useIsMobile();

  // Single source of truth for the music library — the standalone sketches manifest
  // (NOT /api/projects). Used by both the home card and the "המוזיקה שלי" tab.
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [libState, setLibState] = useState<"loading" | "ready" | "error">("loading");
  const reloadSketches = useCallback(async () => {
    try {
      const r = await fetch("/api/red-artists/sketches", { cache: "no-store" });
      const d = await r.json();
      if (r.ok && d?.ok && Array.isArray(d.sketches)) { setSketches(d.sketches); setLibState("ready"); }
      else setLibState("error");
    } catch { setLibState("error"); }
  }, []);
  useEffect(() => { void reloadSketches(); }, [reloadSketches]);

  // Persist a new library order. The client sends ids only; the server is the
  // source of truth. Returns true on success — on failure state is left unchanged
  // so the library visually reverts to its previous order.
  const reorderSketchesRemote = useCallback(async (orderedIds: string[]): Promise<boolean> => {
    try {
      const r = await fetch("/api/red-artists/sketches/reorder", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      if (!r.ok) return false;
      const d = await r.json();
      if (d?.ok && Array.isArray(d.sketches)) setSketches(d.sketches);
      return true;
    } catch { return false; }
  }, []);

  // Real shows + balance for Shalev — server-scoped endpoint (owner-only, READ-
  // ONLY, filtered server-side to "שליו טסמה"; no other artist / no label money).
  const [summary, setSummary] = useState<ShalevSummary | null>(null);
  const [summaryState, setSummaryState] = useState<LoadState>("loading");
  useEffect(() => {
    let alive = true;
    fetch("/api/red-artists/shalev-summary")
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        if (!alive) return;
        if (d?.ok) { setSummary({ shows: d.shows, balance: d.balance, weekly: d.weekly ?? [], updates: d.updates ?? [] }); setSummaryState("ready"); }
        else setSummaryState("error");
      })
      .catch(() => { if (alive) setSummaryState("error"); });
    return () => { alive = false; };
  }, []);

  // Owner-only balance ledger — the manual, independent per-artist ledger. Replaces
  // the old shalev-summary.balance for BOTH the tab and the home card. Fetched only
  // for the owner (the endpoint is owner-only; shalev never receives ledger data).
  const [ledger, setLedger] = useState<BalanceLedger | null>(null);
  const [ledgerState, setLedgerState] = useState<LoadState>("loading");
  const reloadLedger = useCallback(async () => {
    // Owner reads the label endpoint (needs the artist id); shalev reads his own
    // scoped, READ-ONLY endpoint (artist resolved server-side, no id needed).
    const url = isShalev ? "/api/red-artists/balance" : (isOwner && artistId ? `/api/label/artists/${artistId}/balance` : null);
    if (!url) return;
    try {
      const r = await fetch(url, { cache: "no-store" });
      const d = await r.json();
      if (r.ok && d?.ok) { setLedger({ entries: d.entries ?? [], totals: d.totals }); setLedgerState("ready"); }
      else setLedgerState("error");
    } catch { setLedgerState("error"); }
  }, [isOwner, isShalev, artistId]);
  useEffect(() => { void reloadLedger(); }, [reloadLedger]);

  // Next release — the portal's manifest pointer (a sketch + a date). NOT Projects,
  // NOT project_release_details. null when unset → the card shows a "set it" prompt.
  const [nextWork, setNextWork] = useState<PortalWork | null>(null);
  const reloadNextWork = useCallback(async () => {
    try {
      const r = await fetch("/api/red-artists/next-work", { cache: "no-store" });
      const d = await r.json();
      if (r.ok && d?.ok) setNextWork(d.work ?? null);
    } catch { /* leave as-is — the home page never breaks */ }
  }, []);
  useEffect(() => { void reloadNextWork(); }, [reloadNextWork]);

  const [nextRelease, setNextRelease] = useState<PortalRelease | null>(null);
  const reloadNextRelease = useCallback(async () => {
    try {
      const r = await fetch("/api/red-artists/next-release", { cache: "no-store" });
      const d = await r.json();
      if (r.ok && d?.ok) setNextRelease(d.release ?? null);
    } catch { /* leave as-is — the home page never breaks */ }
  }, []);
  useEffect(() => { void reloadNextRelease(); }, [reloadNextRelease]);

  // Learn-and-save duration into the SKETCH MANIFEST (never Projects): once the
  // global player has a real duration for the playing sketch's latest version and
  // it has none stored yet, persist it — at most once per file per session.
  const player = usePlayerSafe();
  const playingId = player?.track?.projectId;
  const playerDuration = player?.duration ?? 0;
  useEffect(() => {
    if (!playingId || playerDuration <= 0) return;
    const s = sketches.find(x => x.id === playingId);
    if (!s || s.durationSeconds != null || !s.latestFilePath) return;
    const seconds = Math.round(playerDuration);
    if (!(seconds > 0 && seconds < 86400)) return;
    const key = `${s.id}:${s.latestVersion}`;
    if (durationLearned.has(key)) return;
    durationLearned.add(key); // guard immediately against duplicate fires
    fetch(`/api/red-artists/sketches/${s.id}/duration`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionNumber: s.latestVersion, durationSeconds: seconds }),
    })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(() => {
        setSketches(rows => rows.map(x => (x.id === s.id ? { ...x, durationSeconds: seconds } : x)));
      })
      .catch(() => { durationLearned.delete(key); }); // allow a later retry
  }, [playingId, playerDuration, sketches]);

  return (
    <div dir="rtl" style={{ minHeight: "100%", background: "#0A0A0B", color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", overflowX: "hidden", padding: isMobile ? "18px 12px 28px" : "30px 24px 140px" }}>
      {/* Centered premium island — intentionally NOT full-width (black breathing room around) */}
      <div style={{ maxWidth: 1400, margin: "0 auto", width: "100%" }}>

        {/* Responsive grids: "המוזיקה שלי" gets priority width; everything stacks on small screens. */}
        <style>{`
          .rap-grid-a { display: grid; gap: 18px; align-items: stretch; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
          .rap-acts   { display: grid; gap: 17px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: stretch; }
          .rap-kpi    { display: grid; gap: 14px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
          @media (max-width: 1040px) {
            .rap-grid-a { grid-template-columns: 1fr; }
          }
          @media (max-width: 820px) {
            .rap-kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          }
          @media (max-width: 760px) {
            .rap-acts { grid-template-columns: 1fr; }
          }
          @keyframes rapProgress { from { width: 0%; } to { width: 100%; } }
          .rap-tabs { scrollbar-width: none; -ms-overflow-style: none; }
          .rap-tabs::-webkit-scrollbar { display: none; }
          /* Balance amount field — no native number spinner (clean, uniform). */
          .rap-num::-webkit-outer-spin-button, .rap-num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
          .rap-num { -moz-appearance: textfield; appearance: textfield; }
          /* Dark native <select> across the WHOLE portal (incl. modals portaled to
             <body> — that's why this is a global class rule, not a scoped one).
             color-scheme:dark makes the native popup dark; the option rules keep it
             readable on browsers that honour option colors. Never a white dropdown. */
          select.rap-select { color-scheme: dark; }
          select.rap-select option { background-color: #171314; color: #F2F2F2; }
          select.rap-select option:checked { background-color: rgba(220,38,38,0.32); color: #ffffff; }
        `}</style>

        {/* ── Internal portal nav (horizontal tabs — global sidebar stays the only sidebar) ── */}
        {/* Mobile: single-line, compact, horizontally scrollable so tabs never wrap to a 2nd row. */}
        <div className="rap-tabs" style={{
          display: "flex", gap: isMobile ? 7 : 10, marginBottom: isMobile ? 16 : 24,
          justifyContent: isMobile ? "flex-start" : "center",
          flexWrap: isMobile ? "nowrap" : "wrap",
          overflowX: isMobile ? "auto" : "visible", paddingBottom: isMobile ? 2 : 0,
        }}>
          {TABS.map(tb => {
            const active = tb === tab;
            return (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                style={{
                  fontSize: isMobile ? 12.5 : 13.5, fontWeight: active ? 800 : 600, fontFamily: "inherit", cursor: "pointer", flexShrink: 0,
                  padding: isMobile ? "7px 13px" : "10px 20px", borderRadius: isMobile ? 10 : 12, whiteSpace: "nowrap",
                  background: active ? "linear-gradient(180deg, rgba(220,38,38,0.22), rgba(220,38,38,0.10))" : "#141415",
                  border: `1px solid ${active ? "rgba(220,38,38,0.55)" : BDR}`,
                  color: active ? "#FF6B6B" : TEXT2,
                  boxShadow: active ? `0 4px 16px rgba(220,38,38,0.22)` : "none",
                  transition: "all .16s",
                }}
              >{tb}</button>
            );
          })}
        </div>

        {/* Persistent hero — the ternary always yields <PortalHero> at THIS same
            position, so React reuses the instance across tabs and the avatar
            never remounts/reloads (no "ש" flash on tab switch). Content varies. */}
        {tab === "בית" ? (
          <PortalHero title="ברוך הבא, שליו" emoji="👋" canEditAvatar subtitle="זה המקום שלך ליצור, לשחרר ולהוביל. אנחנו כאן כדי לקחת את המוזיקה שלך רחוק.">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 11, marginBottom: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "#FF6B6B", letterSpacing: "0.02em" }}>עדכונים אחרונים</span>
            </div>
            <NewsFlash items={summary?.updates ?? []} />
          </PortalHero>
        ) : tab === "המוזיקה שלי" ? (
          <PortalHero title="המוזיקה שלי" badge="♫" subtitle="כל השירים, הסקיצות, המיקסים והמאסטרים במקום אחד" />
        ) : tab === "לו״ז ועדכונים" ? (
          <PortalHero title="לו״ז ועדכונים" subtitle="הזמינות שלך, היומן השבועי ועדכוני הלייבל — במקום אחד" />
        ) : tab === "ההופעות שלי" ? (
          <PortalHero title="ההופעות שלי" subtitle="כל ההופעות הקרובות וההופעות שבוצעו במקום אחד" />
        ) : tab === "מאזן" ? (
          <PortalHero title="מאזן" subtitle="הכנסות, תשלומים, הוצאות והיסטוריית תנועות" />
        ) : tab === "ביטים פנויים" ? (
          <PortalHero title="ביטים פנויים" badge="♫" subtitle={isShalev ? "ביטים זמינים להאזנה" : "ניהול ביטים זמינים לעבודה"} />
        ) : tab === "קבצי הופעות ויח״צ" ? (
          <PortalHero title="קבצי הופעות ויח״צ" subtitle="כל חומרי ההופעות והיח״צ שלך במקום אחד" />
        ) : (
          <PortalHero title={tab} subtitle="האזור הזה יוצג בקרוב" />
        )}

        <div style={{ marginTop: 20 }}>
          {tab === "בית" ? <HomeDashboard onOpenMusic={() => setTab("המוזיקה שלי")} sketches={sketches} loadState={libState} summary={summary} summaryState={summaryState} nextRelease={nextRelease} onReloadNextRelease={reloadNextRelease} nextWork={nextWork} onReloadNextWork={reloadNextWork} hideBalance={isShalev} isShalev={isShalev} ledger={ledger} ledgerState={ledgerState} />
            : tab === "המוזיקה שלי" ? <MyMusicPage sketches={sketches} loadState={libState} onReload={reloadSketches} onReorder={reorderSketchesRemote} isShalev={isShalev} />
            : tab === "ההופעות שלי" ? <ShowsPage summary={summary} loadState={summaryState} />
            : tab === "לו״ז ועדכונים" ? <SchedulePage summary={summary} loadState={summaryState} />
            : tab === "מאזן" ? <BalancePage artistId={artistId} ledger={ledger} loadState={ledgerState} onReload={reloadLedger} readOnly={isShalev} />
            : tab === "ביטים פנויים" ? <BeatsPage readOnly={isShalev} />
            : tab === "קבצי הופעות ויח״צ" ? <PressAndShowsPage isShalev={isShalev} />
            : <ComingSoon tab={tab} />}
        </div>
      </div>
    </div>
  );
}

// ── Unified top Hero — SAME shell/size/padding/glow/avatar across every tab so
// switching tabs never makes the page jump. Only the title/subtitle/children
// change. `badge` = a red rounded icon next to the title (e.g. ♫); `emoji` is
// appended inside the title (e.g. 👋); `children` = extra content (home's news).
function PortalHero({ title, emoji, badge, subtitle, canEditAvatar, children }: {
  title: string; emoji?: string; badge?: string; subtitle?: string; canEditAvatar?: boolean; children?: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  return (
    <div style={{
      position: "relative", overflow: "hidden", borderRadius: 24, border: `1px solid rgba(220,38,38,0.34)`,
      background: `
        radial-gradient(70% 130% at 9% 22%, rgba(220,38,38,0.40) 0%, rgba(220,38,38,0.08) 40%, transparent 64%),
        radial-gradient(130% 160% at 94% -16%, rgba(220,38,38,0.30) 0%, rgba(220,38,38,0.08) 38%, #120E0F 72%),
        radial-gradient(90% 130% at 50% 132%, rgba(220,38,38,0.12) 0%, transparent 58%),
        linear-gradient(180deg, #1A1314 0%, #0B0909 100%)`,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 100px rgba(220,38,38,0.16), 0 30px 72px rgba(0,0,0,0.55)`,
    }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(8,8,9,0.55) 100%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${BRAND}66, transparent)`, pointerEvents: "none" }} />

      <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: isMobile ? 14 : 24, padding: isMobile ? "18px 16px" : "26px 36px" }}>
        {/* identity (right) — same avatar + name everywhere */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 13 : 16, minWidth: isMobile ? "100%" : 232 }}>
          <ArtistAvatar canEdit={!!canEditAvatar} />
          <div style={{ textAlign: "start", minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? 19 : 24, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em" }}>שליו טסמה</div>
            <div style={{ fontSize: isMobile ? 12 : 13, color: TEXT2, marginTop: 3 }}>אמן • Redbloods Records</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 7, padding: "3px 11px 3px 9px", borderRadius: 99, background: "rgba(52,211,153,0.10)", border: "1px solid rgba(52,211,153,0.30)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, boxShadow: `0 0 7px ${GREEN}` }} />
              <span style={{ fontSize: 11.5, color: GREEN, fontWeight: 700 }}>פעיל</span>
            </div>
          </div>
        </div>

        {/* title / subtitle / extra (center, grows) */}
        <div style={{ flex: 1, minWidth: isMobile ? "100%" : 320, textAlign: isMobile ? "start" : "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: isMobile ? 10 : 14 }}>
            <h1 style={{ fontSize: isMobile ? 23 : 31, fontWeight: 900, margin: 0, letterSpacing: "-0.03em", color: "#fff", textShadow: "0 2px 24px rgba(0,0,0,0.55)" }}>
              {title}{emoji ? <span style={{ WebkitTextFillColor: "initial" }}> {emoji}</span> : null}
            </h1>
            {badge ? (
              <span style={{ width: isMobile ? 40 : 50, height: isMobile ? 40 : 50, borderRadius: isMobile ? 12 : 15, flexShrink: 0, background: "rgba(220,38,38,0.16)", border: `1px solid ${BRAND}66`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isMobile ? 18 : 23, boxShadow: `0 0 24px rgba(220,38,38,0.35)` }}>{badge}</span>
            ) : null}
          </div>
          {subtitle ? (
            <p style={{ fontSize: isMobile ? 12.5 : 13.5, color: "#C8C8CC", lineHeight: 1.6, margin: isMobile ? "6px 0 0" : "7px auto 0", maxWidth: 500 }}>{subtitle}</p>
          ) : null}
          {children}
        </div>

        {/* left spacer (desktop) keeps the title on the true center axis */}
        {!isMobile && <div style={{ minWidth: 232, flexShrink: 0 }} />}
      </div>
    </div>
  );
}

function ComingSoon({ tab: _tab }: { tab: Tab }) {
  return (
    <div style={{ ...panel, padding: "56px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>🚧</div>
      <div style={{ fontSize: 14, color: TEXT2 }}>האזור הזה עדיין בבנייה — יעודכן בקרוב</div>
    </div>
  );
}

// ── ביטים פנויים (free beats) — OWNER-ONLY. Global pool from public.beats +
// Dropbox /nagashbeatz/beats. Same list/play language as "המוזיקה שלי"; playback
// through the GLOBAL player. Never rendered for the shalev role (the /api/beats
// endpoints are requireOwner too, so hiding the tab is not the only guard).
type BeatItem = { id: string; name: string; genre: string; musicalKey: string | null; durationSeconds: number | null; createdAt: string; url: string };

// Canonical genre value (DB) → display label (exactly as the product spec names them).
const BEAT_GENRE_OPTS: { value: string; label: string }[] = [
  { value: "dancehall", label: "Dancehall" },
  { value: "rnb",       label: "R&B" },
  { value: "hiphop",    label: "Hip Hop" },
  { value: "soul",      label: "Soul" },
];
const BEAT_GENRE_LABEL: Record<string, string> =
  Object.fromEntries(BEAT_GENRE_OPTS.map(o => [o.value, o.label]));

// Musical key: two selects (note + Major/Minor) combined to a canonical "<note> <type>".
const BEAT_KEY_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BEAT_KEY_TYPES = ["Major", "Minor"];
function splitMusicalKey(k: string | null): { note: string; type: string } {
  if (!k) return { note: "", type: "" };
  const i = k.lastIndexOf(" ");
  return i > 0 ? { note: k.slice(0, i), type: k.slice(i + 1) } : { note: "", type: "" };
}

// Two-select musical-key field (תו + Major/Minor) shared by upload + edit forms.
function KeyFields({ note, type, onNote, onType, disabled }: {
  note: string; type: string; onNote: (v: string) => void; onType: (v: string) => void; disabled?: boolean;
}) {
  const sel: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 11,
    background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, color: TEXT,
    fontSize: 14, fontFamily: "inherit", outline: "none", cursor: disabled ? "not-allowed" : "pointer",
  };
  return (
    <div>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: TEXT2, marginBottom: 7 }}>סולם</label>
      <div style={{ display: "flex", gap: 10 }}>
        <select className="rap-select" value={note} onChange={e => onNote(e.target.value)} disabled={disabled} style={sel}>
          {BEAT_KEY_NOTES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select className="rap-select" value={type} onChange={e => onType(e.target.value)} disabled={disabled} style={sel}>
          {BEAT_KEY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    </div>
  );
}

function BeatsPage({ readOnly = false }: { readOnly?: boolean }) {
  const isMobile = useIsMobile();
  const player = usePlayerSafe();
  const [beats, setBeats] = useState<BeatItem[]>([]);
  const [listState, setListState] = useState<LoadState>("loading");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manage, setManage] = useState<BeatItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  // After an update/delete of a beat that is currently in the global player, stop
  // it so no stale (old-file / removed) stream URL keeps playing.
  const stopIfPlaying = useCallback((id: string) => {
    if (player?.track && player.track.projectId === `beat:${id}`) player.stop();
  }, [player]);

  const load = useCallback(async () => {
    setListState("loading");
    try {
      const r = await fetch("/api/beats", { cache: "no-store" });
      const d = await r.json();
      if (r.ok && d?.ok && Array.isArray(d.beats)) { setBeats(d.beats); setListState("ready"); }
      else setListState("error");
    } catch { setListState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Play a beat through the GLOBAL player (no new audio element / no new player).
  function playState(b: BeatItem) {
    const cur = !!player?.track && player.track.projectId === `beat:${b.id}`;
    const playing = cur && !!player?.playing;
    const onClick = () => {
      if (!player) return;
      if (playing) player.pause();
      else if (cur) player.resume();
      else player.play({ projectId: `beat:${b.id}`, projectName: b.name, artist: "ביט פנוי", fileName: b.name, url: b.url });
    };
    return { playing, onClick };
  }

  // 4 columns, IDENTICAL for header + rows. Play sits inside the שם הביט column
  // (with the name). RTL order: שם הביט · ז׳אנר · סולם · נוצר בתאריך.
  const cols = "minmax(0, 1.9fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── top action bar — "העלה ביט" (OWNER only; shalev is listen-only) ── */}
      {!readOnly && (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setUploadOpen(true)} style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
          width: isMobile ? "100%" : "auto",
          padding: isMobile ? "12px 18px" : "12px 22px", borderRadius: 13, cursor: "pointer",
          fontFamily: "inherit", background: "linear-gradient(180deg, #E5322F, #C01C1C)",
          border: "1px solid rgba(220,38,38,0.55)", color: "#fff", fontSize: 14.5, fontWeight: 800,
          whiteSpace: "nowrap", boxShadow: "0 5px 20px rgba(220,38,38,0.36)",
        }}>
          <IcUpload size={18} /> העלה ביט
        </button>
      </div>
      )}

      {/* ── list ── */}
      <div style={panel}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: isMobile ? "16px 18px" : "18px 24px", borderBottom: `1px solid ${BDR}` }}>
          <span style={{ fontSize: 16, color: "#FF6B6B", lineHeight: 1 }}>♫</span>
          <span style={{ fontSize: isMobile ? 15.5 : 17.5, fontWeight: 800, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{readOnly ? "ביטים זמינים להאזנה" : "ביטים זמינים לעבודה"}</span>
        </div>

        {!isMobile && beats.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "12px 24px", borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.02)" }}>
            {[{ label: "שם הביט", align: "start" as const }, { label: "ז׳אנר", align: "center" as const }, { label: "סולם", align: "center" as const }, { label: "נוצר בתאריך", align: "center" as const }].map((h, i) => (
              <div key={i} style={{ fontSize: 13.5, fontWeight: 800, color: "#CBCBD4", letterSpacing: "0.06em", textTransform: "uppercase", textAlign: h.align }}>{h.label}</div>
            ))}
          </div>
        )}

        <div style={{ maxHeight: isMobile ? 400 : 500, overflowY: "auto", padding: "2px 0 28px", scrollPaddingBottom: 28 }}>
          {listState === "loading" ? (
            <div style={{ padding: "44px 0", textAlign: "center", fontSize: 13.5, color: MUTED }}>טוען…</div>
          ) : listState === "error" ? (
            <div style={{ padding: "44px 0", textAlign: "center", fontSize: 13.5, color: MUTED }}>לא ניתן לטעון את הביטים כרגע</div>
          ) : beats.length === 0 ? (
            <div style={{ padding: "40px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT2 }}>עדיין לא הועלו ביטים פנויים</div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 5 }}>העלה את הביט הראשון</div>
            </div>
          ) : (
            beats.map((b) => {
              const ps = playState(b);
              const genreLabel = BEAT_GENRE_LABEL[b.genre] ?? b.genre;
              const keyText = b.musicalKey ?? "לא הוגדר";
              const keyDefined = !!b.musicalKey;
              return isMobile ? (
                <div key={b.id} onClick={readOnly ? undefined : () => setManage(b)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${BDR}`, cursor: readOnly ? "default" : "pointer" }}>
                  <span onClick={e => e.stopPropagation()} style={{ display: "flex" }}>
                    <PlayButton size={38} playing={ps.playing} onClick={ps.onClick} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <GenreBadge label={genreLabel} />
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: keyDefined ? "#CFCFD6" : MUTED, direction: "ltr" }}>{keyText}</span>
                      <span style={{ fontSize: 12, color: MUTED }}>·</span>
                      <span style={{ fontSize: 12.5, color: MUTED, direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace" }}>{fmtSketchDate(b.createdAt)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={b.id} onClick={readOnly ? undefined : () => setManage(b)}
                  onMouseEnter={readOnly ? undefined : e => rowHover(e, true)} onMouseLeave={readOnly ? undefined : e => rowHover(e, false)}
                  style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "10px 24px", border: "1px solid transparent", transition: "all .14s", cursor: readOnly ? "default" : "pointer" }}>
                  {/* שם הביט — Play + name together (RTL: Play rightmost) */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <span onClick={e => e.stopPropagation()} style={{ display: "flex", flexShrink: 0 }}>
                      <PlayButton size={38} playing={ps.playing} onClick={ps.onClick} />
                    </span>
                    <div style={{ minWidth: 0, fontSize: 16.5, fontWeight: 800, color: "#FFFFFF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                  </div>
                  {/* ז׳אנר — centered */}
                  <div style={{ display: "flex", justifyContent: "center" }}><GenreBadge label={genreLabel} /></div>
                  {/* סולם — centered */}
                  <div style={{ textAlign: "center", fontSize: 14, fontWeight: 700, color: keyDefined ? "#CFCFD6" : MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{keyText}</div>
                  {/* נוצר בתאריך — centered */}
                  <div style={{ textAlign: "center", fontSize: 13.5, color: "#CFCFD6", fontFamily: "ui-monospace, Menlo, monospace" }}>{fmtSketchDate(b.createdAt)}</div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {!readOnly && uploadOpen && <BeatUploadModal onClose={() => setUploadOpen(false)} onUploaded={(msg) => { setUploadOpen(false); setToast(msg); void load(); }} />}

      {!readOnly && manage && (
        <BeatManageModal
          beat={manage}
          onClose={() => setManage(null)}
          onUpdated={(id, fileReplaced) => { setManage(null); if (fileReplaced) stopIfPlaying(id); setToast("הביט עודכן"); void load(); }}
          onDeleted={(id) => { setManage(null); stopIfPlaying(id); setToast("הביט הוסר"); void load(); }}
        />
      )}

      {toast && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", zIndex: 100040,
          background: "#1A1C22", border: `1px solid ${BDR2}`, color: TEXT, fontSize: 13, fontWeight: 700,
          padding: "11px 20px", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.6)", fontFamily: "'Heebo', Arial, sans-serif", maxWidth: "90vw", textAlign: "center",
        }}>{toast}</div>,
        document.body
      )}
    </div>
  );
}

function GenreBadge({ label }: { label: string }) {
  return (
    <span style={{
      display: "inline-block", fontSize: 12.5, fontWeight: 700, color: "#E8B7B7",
      padding: "3px 11px", borderRadius: 99, whiteSpace: "nowrap",
      background: "rgba(220,38,38,0.10)", border: `1px solid ${BRAND}44`,
    }}>{label}</span>
  );
}

// Beat upload — file (audio) + name + genre. Real progress + cancel (XHR). OWNER only
// (the /api/beats POST is requireOwner). One beat per submit.
function BeatUploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: (msg: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [note, setNote] = useState("C");     // valid default key → C Minor (no empty option)
  const [type, setType] = useState("Minor");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const canSubmit = !!file && !!name.trim() && !!genre && !!note && !!type && !busy;

  function submit() {
    if (!file || !name.trim() || !genre || !note || !type || busy) return;
    setBusy(true); setPct(0); setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name.trim());
    fd.append("genre", genre);
    fd.append("musicalKey", `${note} ${type}`);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/beats");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      xhrRef.current = null;
      let d: { ok?: boolean; error?: string } = {};
      try { d = JSON.parse(xhr.responseText); } catch { /* keep */ }
      if (xhr.status >= 200 && xhr.status < 300 && d?.ok) onUploaded("הביט עלה בהצלחה");
      else { setBusy(false); setErr(d?.error || "ההעלאה נכשלה"); }
    };
    xhr.onerror = () => { xhrRef.current = null; setBusy(false); setErr("ההעלאה נכשלה"); };
    xhr.onabort = () => { xhrRef.current = null; setBusy(false); setPct(0); };
    xhr.send(fd);
  }

  function cancel() {
    if (busy && xhrRef.current) { xhrRef.current.abort(); return; } // cancel the in-flight upload
    onClose();
  }

  if (typeof document === "undefined") return null;
  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 11,
    background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, color: TEXT,
    fontSize: 14, fontFamily: "inherit", outline: "none",
  };

  return createPortal(
    <div onClick={cancel} style={{ position: "fixed", inset: 0, zIndex: 100045, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} dir="rtl" style={{ width: "min(460px, 94vw)", background: "#141416", border: `1px solid ${BDR2}`, borderRadius: 18, overflow: "hidden", fontFamily: "'Heebo', Arial, sans-serif", boxShadow: "0 24px 80px rgba(0,0,0,0.85)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${BDR}` }}>
          <span style={{ fontSize: 17, fontWeight: 900, color: TEXT }}>העלה ביט</span>
          <button onClick={cancel} aria-label="סגור" style={{ background: "none", border: "none", cursor: "pointer", display: "inline-flex", padding: 2 }}><IcX size={18} /></button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* file */}
          <div>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: TEXT2, marginBottom: 7 }}>קובץ אודיו</label>
            <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.aif,.aiff,.m4a,.flac,.ogg" disabled={busy}
              onChange={e => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, "")); }}
              style={{ display: "none" }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box", textAlign: "start",
              padding: "12px 14px", borderRadius: 11, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit",
              background: "rgba(255,255,255,0.03)", border: `1px dashed ${file ? BRAND + "66" : BDR2}`, color: file ? TEXT : TEXT2, fontSize: 13.5,
            }}>
              <IcCloud size={20} color={file ? "#FF6B6B" : TEXT2} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file ? file.name : "בחר קובץ אודיו…"}</span>
            </button>
          </div>

          {/* name */}
          <div>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: TEXT2, marginBottom: 7 }}>שם הביט</label>
            <input value={name} onChange={e => setName(e.target.value)} disabled={busy} placeholder="לדוגמה: Midnight Ride" style={inputStyle} />
          </div>

          {/* genre */}
          <div>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: TEXT2, marginBottom: 7 }}>ז׳אנר</label>
            <select className="rap-select" value={genre} onChange={e => setGenre(e.target.value)} disabled={busy} style={{ ...inputStyle, cursor: busy ? "not-allowed" : "pointer" }}>
              <option value="" disabled>בחר ז׳אנר…</option>
              {BEAT_GENRE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* musical key */}
          <KeyFields note={note} type={type} onNote={setNote} onType={setType} disabled={busy} />

          {/* progress */}
          {busy && (
            <div>
              <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, #E5322F, #C01C1C)", transition: "width .2s" }} />
              </div>
              <div style={{ fontSize: 12, color: TEXT2, marginTop: 6, textAlign: "center" }}>מעלה… {pct}%</div>
            </div>
          )}

          {err && <div style={{ fontSize: 13, color: "#F87171", fontWeight: 600 }}>{err}</div>}

          {/* actions */}
          <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
            <button onClick={submit} disabled={!canSubmit} style={{
              flex: 1, padding: "12px 16px", borderRadius: 12, cursor: canSubmit ? "pointer" : "not-allowed", fontFamily: "inherit",
              background: canSubmit ? "linear-gradient(180deg, #E5322F, #C01C1C)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${canSubmit ? "rgba(220,38,38,0.55)" : BDR2}`, color: canSubmit ? "#fff" : MUTED,
              fontSize: 14.5, fontWeight: 800, opacity: busy ? 0.85 : 1,
            }}>{busy ? "מעלה…" : "העלה"}</button>
            <button onClick={cancel} style={{
              padding: "12px 18px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
              background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 14, fontWeight: 700,
            }}>{busy ? "בטל" : "סגור"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Manage an existing beat (OWNER-only). menu → "עדכן ביט" (replace file + name/genre,
// same id) / "הסר ביט" (confirm → delete file+row). All server ops are requireOwner.
function BeatManageModal({ beat, onClose, onUpdated, onDeleted }: {
  beat: BeatItem;
  onClose: () => void;
  onUpdated: (id: string, fileReplaced: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [mode, setMode] = useState<"menu" | "edit" | "confirm">("menu");

  // ── edit state (replace the file; same beat id) ──
  const initKey = splitMusicalKey(beat.musicalKey);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(beat.name);
  const [genre, setGenre] = useState(beat.genre);
  // Prefill from the beat's key; legacy beats with no key default to C Minor (only
  // persisted if the owner actually saves — opening the modal never writes to the DB).
  const [note, setNote] = useState(initKey.note || "C");
  const [type, setType] = useState(initKey.type || "Minor");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // A new file is OPTIONAL on update — the button is enabled on valid
  // name/genre/key. With no file it's a metadata-only save (server never touches
  // Dropbox); with a file the audio is replaced.
  const canSave = !!name.trim() && !!genre && !!note && !!type && !busy;

  function saveUpdate() {
    if (busy) return;
    if (!name.trim() || !genre || !note || !type) return;
    const fileReplaced = !!file;
    setBusy(true); setPct(0); setErr(null);
    const fd = new FormData();
    if (file) fd.append("file", file);       // omit → metadata-only update
    fd.append("name", name.trim());
    fd.append("genre", genre);
    fd.append("musicalKey", `${note} ${type}`);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PATCH", `/api/beats/${beat.id}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      xhrRef.current = null;
      let d: { ok?: boolean; error?: string } = {};
      try { d = JSON.parse(xhr.responseText); } catch { /* keep */ }
      if (xhr.status >= 200 && xhr.status < 300 && d?.ok) onUpdated(beat.id, fileReplaced);
      else { setBusy(false); setErr(d?.error || "העדכון נכשל"); }
    };
    xhr.onerror = () => { xhrRef.current = null; setBusy(false); setErr("העדכון נכשל"); };
    xhr.onabort = () => { xhrRef.current = null; setBusy(false); setPct(0); };
    xhr.send(fd);
  }

  // ── delete state ──
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  async function doDelete() {
    if (delBusy) return;
    setDelBusy(true); setDelErr(null);
    try {
      const r = await fetch(`/api/beats/${beat.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({} as { ok?: boolean; error?: string }));
      if (r.ok && d?.ok) onDeleted(beat.id);
      else { setDelBusy(false); setDelErr(d?.error || "ההסרה נכשלה"); }
    } catch { setDelBusy(false); setDelErr("ההסרה נכשלה"); }
  }

  // Block backdrop-close while any op is in flight (so we never orphan a request).
  const anyBusy = busy || delBusy;
  function backdrop() {
    if (anyBusy) { if (busy && xhrRef.current) xhrRef.current.abort(); return; }
    onClose();
  }

  if (typeof document === "undefined") return null;
  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 11,
    background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, color: TEXT,
    fontSize: 14, fontFamily: "inherit", outline: "none",
  };

  return createPortal(
    <div onClick={backdrop} style={{ position: "fixed", inset: 0, zIndex: 100045, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} dir="rtl" style={{ width: "min(460px, 94vw)", background: "#141416", border: `1px solid ${BDR2}`, borderRadius: 18, overflow: "hidden", fontFamily: "'Heebo', Arial, sans-serif", boxShadow: "0 24px 80px rgba(0,0,0,0.85)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${BDR}` }}>
          <span style={{ fontSize: 17, fontWeight: 900, color: TEXT }}>{mode === "edit" ? "עדכן ביט" : mode === "confirm" ? "להסיר את הביט?" : "ניהול ביט"}</span>
          <button onClick={backdrop} aria-label="סגור" disabled={anyBusy} style={{ background: "none", border: "none", cursor: anyBusy ? "not-allowed" : "pointer", display: "inline-flex", padding: 2, opacity: anyBusy ? 0.4 : 1 }}><IcX size={18} /></button>
        </div>

        {mode === "menu" && (
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{beat.name}</div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 }}>
                <GenreBadge label={BEAT_GENRE_LABEL[beat.genre] ?? beat.genre} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: beat.musicalKey ? "#CFCFD6" : MUTED, direction: "ltr" }}>{beat.musicalKey ?? "לא הוגדר"}</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => setMode("edit")} style={{
                display: "flex", alignItems: "center", gap: 10, textAlign: "start", padding: "13px 16px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, color: TEXT, fontSize: 14.5, fontWeight: 700,
              }}><IcEdit size={18} color="#FF6B6B" /> עדכן ביט</button>
              <button onClick={() => setMode("confirm")} style={{
                display: "flex", alignItems: "center", gap: 10, textAlign: "start", padding: "13px 16px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.35)", color: "#F87171", fontSize: 14.5, fontWeight: 700,
              }}><IcTrash size={18} /> הסר ביט</button>
            </div>
          </div>
        )}

        {mode === "edit" && (
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: TEXT2, marginBottom: 7 }}>קובץ אודיו חדש — אופציונלי <span style={{ fontWeight: 500, color: MUTED }}>(השאר ריק כדי לעדכן רק את פרטי הביט)</span></label>
              <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.aif,.aiff,.m4a,.flac,.ogg" disabled={busy}
                onChange={e => { setFile(e.target.files?.[0] ?? null); setErr(null); }} style={{ display: "none" }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box", textAlign: "start",
                padding: "12px 14px", borderRadius: 11, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit",
                background: "rgba(255,255,255,0.03)", border: `1px dashed ${file ? BRAND + "66" : BDR2}`, color: file ? TEXT : TEXT2, fontSize: 13.5,
              }}>
                <IcCloud size={20} color={file ? "#FF6B6B" : TEXT2} />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file ? file.name : "בחר קובץ אודיו חדש…"}</span>
              </button>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: TEXT2, marginBottom: 7 }}>שם הביט</label>
              <input value={name} onChange={e => setName(e.target.value)} disabled={busy} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: TEXT2, marginBottom: 7 }}>ז׳אנר</label>
              <select className="rap-select" value={genre} onChange={e => setGenre(e.target.value)} disabled={busy} style={{ ...inputStyle, cursor: busy ? "not-allowed" : "pointer" }}>
                {BEAT_GENRE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <KeyFields note={note} type={type} onNote={setNote} onType={setType} disabled={busy} />
            {busy && (
              <div>
                <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, #E5322F, #C01C1C)", transition: "width .2s" }} />
                </div>
                <div style={{ fontSize: 12, color: TEXT2, marginTop: 6, textAlign: "center" }}>מעדכן… {pct}%</div>
              </div>
            )}
            {err && <div style={{ fontSize: 13, color: "#F87171", fontWeight: 600 }}>{err}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
              <button onClick={saveUpdate} disabled={!canSave} style={{
                flex: 1, padding: "12px 16px", borderRadius: 12, cursor: canSave ? "pointer" : "not-allowed", fontFamily: "inherit",
                background: canSave ? "linear-gradient(180deg, #E5322F, #C01C1C)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${canSave ? "rgba(220,38,38,0.55)" : BDR2}`, color: canSave ? "#fff" : MUTED, fontSize: 14.5, fontWeight: 800, opacity: busy ? 0.85 : 1,
              }}>{busy ? "מעדכן…" : "עדכן"}</button>
              <button onClick={() => { if (busy && xhrRef.current) { xhrRef.current.abort(); return; } setMode("menu"); setErr(null); }} style={{
                padding: "12px 18px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 14, fontWeight: 700,
              }}>{busy ? "בטל" : "חזרה"}</button>
            </div>
          </div>
        )}

        {mode === "confirm" && (
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 13.5, color: "#C8C8CC", lineHeight: 1.6, margin: 0 }}>הביט יוסר מהמערכת והקובץ יימחק מ־Dropbox. לא ניתן לבטל את הפעולה.</p>
            {delErr && <div style={{ fontSize: 13, color: "#F87171", fontWeight: 600 }}>{delErr}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={doDelete} disabled={delBusy} style={{
                flex: 1, padding: "12px 16px", borderRadius: 12, cursor: delBusy ? "wait" : "pointer", fontFamily: "inherit",
                background: "linear-gradient(180deg, #E5322F, #C01C1C)", border: "1px solid rgba(220,38,38,0.55)", color: "#fff", fontSize: 14.5, fontWeight: 800, opacity: delBusy ? 0.8 : 1,
              }}>{delBusy ? "מסיר…" : "הסר ביט"}</button>
              <button onClick={() => { if (delBusy) return; setMode("menu"); setDelErr(null); }} disabled={delBusy} style={{
                padding: "12px 18px", borderRadius: 12, cursor: delBusy ? "not-allowed" : "pointer", fontFamily: "inherit",
                background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 14, fontWeight: 700, opacity: delBusy ? 0.5 : 1,
              }}>ביטול</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── קבצי הופעות ויח״צ (press & shows materials tab) — REAL Dropbox wiring, NO DB.
// "חומרים להופעות" lists audio from the server-owned performance-files folder; a
// single top "העלה קבצים" opens a choice modal (קובץ הופעה → performance-files ·
// חומרי יח״צ → press-kit); "פתח תיקייה" opens the press-kit folder. All paths are
// server-owned (client sends only an approved `kind`). Playback reuses the GLOBAL
// player. No metadata / share-token / /Projects / Push.
type PerfFile = { name: string; path: string; url: string };
type UploadKind = "performance" | "pressKit";
const trackTitle = (name: string) => name.replace(/\.[^.]+$/, "");

function PressAndShowsPage({ isShalev }: { isShalev?: boolean }) {
  const isMobile = useIsMobile();
  const player = usePlayerSafe();
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  // Performance-files list — real, from Dropbox (no DB).
  const [files, setFiles] = useState<PerfFile[]>([]);
  const [listState, setListState] = useState<LoadState>("loading");
  const loadFiles = useCallback(async () => {
    setListState("loading");
    try {
      const r = await fetch("/api/red-artists/performance-files");
      const d = await r.json();
      if (r.ok && d.ok) { setFiles(Array.isArray(d.files) ? d.files : []); setListState("ready"); }
      else setListState("error");
    } catch { setListState("error"); }
  }, []);
  useEffect(() => { void loadFiles(); }, [loadFiles]);

  // Upload — one general button → choice modal → native picker per kind.
  const [chooseOpen, setChooseOpen] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<UploadKind | null>(null);

  function pick(kind: UploadKind) {
    setChooseOpen(false);
    kindRef.current = kind;
    const inp = fileRef.current;
    if (!inp) return;
    inp.accept = kind === "performance" ? "audio/*" : "image/*,.pdf,.txt,.doc,.docx";
    inp.value = ""; // allow re-picking the same file
    inp.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const kind = kindRef.current;
    if (!file || !kind) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);
      const r = await fetch("/api/red-artists/upload", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({} as { ok?: boolean; error?: string }));
      if (!r.ok || !d.ok) { setToast(d.error || "ההעלאה נכשלה"); return; }
      if (kind === "performance") { await loadFiles(); setToast("הקובץ עלה לחומרים להופעות"); }
      else setToast("הקובץ עלה לתיקיית היח״צ");
    } catch { setToast("ההעלאה נכשלה"); }
    finally { setUploading(false); }
  }

  // "פתח תיקייה" → press-kit share link (folder created server-side if missing).
  // Pre-open a blank tab INSIDE the click gesture so the popup isn't blocked.
  const [opening, setOpening] = useState(false);
  async function openPressKit() {
    if (opening) return;
    setOpening(true);
    const w = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    try {
      const r = await fetch("/api/red-artists/press-kit-link", { method: "POST" });
      const d = await r.json().catch(() => ({} as { ok?: boolean; shareLink?: string; error?: string }));
      if (r.ok && d.ok && d.shareLink) { if (w) w.location.href = d.shareLink; else window.open(d.shareLink, "_blank"); }
      else { w?.close(); setToast(d.error || "לא ניתן לפתוח את התיקייה"); }
    } catch { w?.close(); setToast("לא ניתן לפתוח את התיקייה"); }
    finally { setOpening(false); }
  }

  // Play a performance file through the GLOBAL player (no local audio element).
  function playState(f: PerfFile) {
    const cur = !!player?.track && player.track.projectId === `perf:${f.path}`;
    const playing = cur && !!player?.playing;
    const onClick = () => {
      if (!player) return;
      if (playing) player.pause();
      else if (cur) player.resume();
      else player.play({ projectId: `perf:${f.path}`, projectName: trackTitle(f.name), artist: SHALEV_ARTIST, fileName: f.name, url: f.url });
    };
    return { playing, onClick };
  }

  // Playlist grid — SAME as "המוזיקה שלי" MINUS the status column: play (RTL →
  // rightmost, fixed) · שם השיר (wide) · אמן / משתתפים · משך (left).
  const cols = "52px minmax(0, 1.9fr) minmax(0, 1.2fr) 72px";
  const heads: { label: string; align: "start" | "center" }[] = [
    { label: "",              align: "center" }, // play column (no header)
    { label: "שם השיר",       align: "start"  },
    { label: "אמן / משתתפים", align: "start"  },
    { label: "משך",           align: "center" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── top action bar — one general upload entry (opens the choice modal) ── */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setChooseOpen(true)} disabled={uploading} style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
          width: isMobile ? "100%" : "auto",
          padding: isMobile ? "12px 18px" : "12px 22px", borderRadius: 13, cursor: uploading ? "wait" : "pointer",
          fontFamily: "inherit", background: "linear-gradient(180deg, #E5322F, #C01C1C)",
          border: "1px solid rgba(220,38,38,0.55)", color: "#fff", fontSize: 14.5, fontWeight: 800,
          whiteSpace: "nowrap", boxShadow: "0 5px 20px rgba(220,38,38,0.36)", opacity: uploading ? 0.75 : 1,
        }}>
          <IcUpload size={18} /> {uploading ? "מעלה…" : "העלה קבצים"}
        </button>
      </div>

      {/* hidden native picker — accept is set per chosen kind before .click() */}
      <input ref={fileRef} type="file" onChange={onFile} style={{ display: "none" }} />

      {/* ── חומרי יח״צ — simple card, one central "פתח תיקייה" action ── */}
      <div style={panel}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 18, padding: isMobile ? "20px 18px" : "26px 28px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
              <span style={{ fontSize: isMobile ? 16.5 : 18, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>חומרי יח״צ</span>
            </div>
            <p style={{ fontSize: 13.5, color: TEXT2, margin: "8px 0 0", lineHeight: 1.6, maxWidth: 460 }}>תמונות יח״צ, לוגו, ביוגרפיה וחומרים לשליחה</p>
          </div>
          {/* Public press-kit share — OWNER ONLY (creates a public Dropbox link).
              Hidden for the shalev role; the route is requireOwner regardless. */}
          {!isShalev && (
          <button onClick={openPressKit} disabled={opening} style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10, flexShrink: 0,
            width: isMobile ? "100%" : "auto", minWidth: isMobile ? undefined : 210,
            padding: isMobile ? "16px 22px" : "17px 36px", borderRadius: 14, cursor: opening ? "wait" : "pointer", fontFamily: "inherit",
            background: "linear-gradient(180deg, #E5322F, #C01C1C)", border: "1px solid rgba(220,38,38,0.55)", color: "#fff",
            fontSize: 15.5, fontWeight: 800, whiteSpace: "nowrap", boxShadow: `0 6px 22px rgba(220,38,38,0.40)`, opacity: opening ? 0.75 : 1,
          }}>
            <Svg size={21} color="#fff" fill="none"><path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-7.6a1 1 0 0 1-.7-.3l-1.4-1.4a1 1 0 0 0-.7-.3H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1Z" /></Svg>
            {opening ? "פותח…" : "פתח תיקייה"}
          </button>
          )}
        </div>
      </div>

      {/* ── חומרים להופעות — real list (music-tab feel, no status), inner-scroll ── */}
      <div style={panel}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: isMobile ? "16px 18px" : "18px 24px", borderBottom: `1px solid ${BDR}` }}>
          <span style={{ fontSize: 16, color: "#FF6B6B", lineHeight: 1 }}>♫</span>
          <span style={{ fontSize: isMobile ? 15.5 : 17.5, fontWeight: 800, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>חומרים להופעות</span>
        </div>

        {/* desktop column header (mobile uses cards) */}
        {!isMobile && files.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "12px 24px", borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.02)" }}>
            {heads.map((h, i) => (
              <div key={i} style={{ fontSize: 13.5, fontWeight: 800, color: "#CBCBD4", letterSpacing: "0.06em", textTransform: "uppercase", textAlign: h.align }}>{h.label}</div>
            ))}
          </div>
        )}

        {/* rows — INNER SCROLL; generous bottom padding (> panel radius) so the last
            row's play button clears the rounded corner and shows with air below. */}
        <div style={{ maxHeight: isMobile ? 400 : 500, overflowY: "auto", padding: "2px 0 28px", scrollPaddingBottom: 28 }}>
          {listState === "loading" ? (
            <div style={{ padding: "44px 0", textAlign: "center", fontSize: 13.5, color: MUTED }}>טוען…</div>
          ) : listState === "error" ? (
            <div style={{ padding: "44px 0", textAlign: "center", fontSize: 13.5, color: MUTED }}>לא ניתן לטעון את הקבצים כרגע</div>
          ) : files.length === 0 ? (
            <div style={{ padding: "40px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT2 }}>עדיין לא הועלו חומרים להופעות</div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 5 }}>לחץ על ״העלה קבצים״ ובחר ״קובץ הופעה״ כדי להוסיף</div>
            </div>
          ) : (
            files.map((f, i) => {
              const ps = playState(f);
              return isMobile ? (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${BDR}` }}>
                  <PlayButton size={38} playing={ps.playing} onClick={ps.onClick} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trackTitle(f.name)}</div>
                    <div style={{ fontSize: 12, color: TEXT2, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl" }}>{SHALEV_ARTIST}</div>
                  </div>
                  <span style={{ fontSize: 12.5, color: "#CFCFD6", direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace", flexShrink: 0 }}>—</span>
                </div>
              ) : (
                <div key={i} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                  style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "10px 24px", border: "1px solid transparent", transition: "all .14s" }}>
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <PlayButton size={38} playing={ps.playing} onClick={ps.onClick} />
                  </div>
                  <div style={{ minWidth: 0, textAlign: "start" }}>
                    <div style={{ fontSize: 16.5, fontWeight: 800, color: "#FFFFFF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trackTitle(f.name)}</div>
                  </div>
                  <div style={{ fontSize: 14, color: "#CFCFD6", textAlign: "start", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{SHALEV_ARTIST}</div>
                  <div style={{ fontSize: 13.5, color: "#CFCFD6", direction: "ltr", textAlign: "center", fontFamily: "ui-monospace, Menlo, monospace" }}>—</div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {chooseOpen && <UploadChoiceModal onChoose={pick} onClose={() => setChooseOpen(false)} />}

      {toast && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", zIndex: 100040,
          background: "#1A1C22", border: `1px solid ${BDR2}`, color: TEXT, fontSize: 13, fontWeight: 700,
          padding: "11px 20px", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.6)", fontFamily: "'Heebo', Arial, sans-serif", maxWidth: "90vw", textAlign: "center",
        }}>{toast}</div>,
        document.body
      )}
    </div>
  );
}

// Upload choice — "מה תרצה להעלות?" → performance (audio) or pressKit (images/docs).
function UploadChoiceModal({ onChoose, onClose }: { onChoose: (kind: UploadKind) => void; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  const opts: { kind: UploadKind; title: string; desc: string; icon: React.ReactNode }[] = [
    { kind: "performance", title: "קובץ הופעה", desc: "פלייבק, גרסת DJ, גרסה נקייה או אינטרו במה",
      icon: <Svg size={20} color="#FF6B6B" fill="none"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Svg> },
    { kind: "pressKit", title: "חומרי יח״צ", desc: "תמונת יח״צ, לוגו, ביוגרפיה, קאבר או קובץ לשליחה",
      icon: <Svg size={20} color="#FF6B6B" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.6-3.6L9 20" /></Svg> },
  ];
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100045, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} dir="rtl" style={{ width: "min(460px, 94vw)", background: "#141416", border: `1px solid ${BDR2}`, borderRadius: 18, overflow: "hidden", fontFamily: "'Heebo', Arial, sans-serif", boxShadow: "0 24px 80px rgba(0,0,0,0.85)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${BDR}` }}>
          <span style={{ fontSize: 17, fontWeight: 900, color: TEXT }}>מה תרצה להעלות?</span>
          <button onClick={onClose} aria-label="סגור" style={{ background: "none", border: "none", cursor: "pointer", display: "inline-flex", padding: 2 }}><IcX size={18} /></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {opts.map(o => (
            <button key={o.kind} onClick={() => onChoose(o.kind)}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(220,38,38,0.55)"; e.currentTarget.style.background = "rgba(220,38,38,0.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = BDR2; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
              style={{ display: "flex", alignItems: "center", gap: 14, textAlign: "start", padding: "16px 18px", borderRadius: 14, cursor: "pointer", fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, transition: "background .15s, border-color .15s" }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: "rgba(220,38,38,0.13)", border: `1px solid ${BRAND}44`, display: "flex", alignItems: "center", justifyContent: "center" }}>{o.icon}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 15.5, fontWeight: 800, color: TEXT }}>{o.title}</span>
                <span style={{ display: "block", fontSize: 12.5, color: TEXT2, marginTop: 3, lineHeight: 1.5 }}>{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── מאזן (balance tab) — OWNER-ONLY manual ledger (public.artist_balance_entries).
// Independent of shalev-summary / transactions / Shows / Finance (one-time backfill
// only; no sync afterwards). All figures + totals come from
// GET /api/label/artists/[id]/balance; the owner adds/edits/deletes entries here.
// See [[redbloods-red-artists-boundary]].
const BAL_EXP_RED = "#F87171";

// Per-type display metadata (color + short caption).
const BAL_TYPE_META: Record<BalanceType, { color: string; sub: string }> = {
  "הכנסות":        { color: GREEN,       sub: "נצבר לזכותך" },
  "הכנסות צפויות": { color: AMBER,       sub: "צפוי להיצבר" },
  "תשלומים":       { color: "#6BA3E8",   sub: "הועבר בפועל" },
  "הוצאות":        { color: BAL_EXP_RED, sub: "הוצא בפועל" },
  "הוצאות צפויות": { color: "#C99A4B",   sub: "טרם בוצע" },
};

const rowIconBtn: React.CSSProperties = {
  background: "none", border: "1px solid transparent", borderRadius: 8, cursor: "pointer",
  padding: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 0,
};

function BalancePage({ artistId, ledger, loadState, onReload, readOnly = false }: {
  artistId?: string; ledger: BalanceLedger | null; loadState: LoadState; onReload: () => Promise<void>; readOnly?: boolean;
}) {
  const isMobile = useIsMobile();
  const [modal, setModal] = useState<{ mode: "add" } | { mode: "addExpected" } | { mode: "addExpectedIncome" } | { mode: "edit"; entry: BalanceEntry } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BalanceEntry | null>(null);
  const [manageOpen, setManageOpen] = useState(false);                 // expected EXPENSES manager
  const [manageIncomeOpen, setManageIncomeOpen] = useState(false);     // expected INCOME manager
  const [markReceivedTarget, setMarkReceivedTarget] = useState<BalanceEntry | null>(null);

  if (loadState === "loading") {
    return <div style={{ ...panel, padding: "48px 24px", textAlign: "center", fontSize: 13.5, color: TEXT2 }}>טוען…</div>;
  }
  // Owner needs the artist id (for its endpoints); shalev's read comes from the
  // scoped endpoint with no id, so a missing id must NOT block his read-only view.
  if (loadState === "error" || (!readOnly && !artistId)) {
    return <div style={{ ...panel, padding: "48px 24px", textAlign: "center", fontSize: 13.5, color: TEXT2 }}>לא ניתן לטעון נתונים כספיים כרגע</div>;
  }

  const totals = ledger?.totals ?? { income: 0, expectedIncome: 0, payments: 0, expenses: 0, expectedExpenses: 0, currentBalance: 0 };
  const entries = ledger?.entries ?? [];
  // The main "היסטוריית תנועות" shows only REALIZED movements. Both expected categories
  // are managed via their own modals and EXCLUDED from that list (display-only — never
  // hidden/removed from the DB/API; their totals still feed the cards/strip).
  const expectedIncomeEntries  = entries.filter(e => e.entryType === "הכנסות צפויות");
  const expectedExpenseEntries = entries.filter(e => e.entryType === "הוצאות צפויות");
  const historyEntries = entries.filter(e => e.entryType === "הכנסות" || e.entryType === "תשלומים" || e.entryType === "הוצאות");
  const curr = "₪";
  const cb = totals.currentBalance;
  const balColor = cb > 0 ? GREEN : cb < 0 ? BAL_EXP_RED : "#E5E5EA";

  // 4 primary cards; "הוצאות צפויות" (5th category) shown as a slim summary strip below.
  const cards: { label: BalanceType; value: number }[] = [
    { label: "הכנסות",        value: totals.income },
    { label: "הכנסות צפויות", value: totals.expectedIncome },
    { label: "תשלומים",       value: totals.payments },
    { label: "הוצאות",        value: totals.expenses },
  ];

  // Owner has an action column (edit/delete); read-only (shalev) drops it so no
  // empty column is left behind.
  const histCols = readOnly ? "120px minmax(0, 1.6fr) 120px" : "120px minmax(0, 1.6fr) 120px 84px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20 }}>

      {/* current balance = income − payments − expenses (expected NOT counted) */}
      <div style={{
        ...panel, padding: isMobile ? "26px 18px" : "34px 24px", textAlign: "center",
        background: `radial-gradient(120% 140% at 50% -10%, rgba(220,38,38,0.20) 0%, rgba(220,38,38,0.05) 42%, #121012 74%), linear-gradient(180deg, #161617 0%, #111112 100%)`,
        border: `1px solid rgba(220,38,38,0.30)`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 60px rgba(220,38,38,0.12), 0 14px 34px rgba(0,0,0,0.4)`,
      }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT2 }}>יתרה נוכחית</div>
        <div style={{ fontSize: isMobile ? 40 : 52, fontWeight: 900, color: balColor, letterSpacing: "-0.03em", marginTop: 6, direction: "ltr", textShadow: "0 2px 22px rgba(0,0,0,0.5)" }}>{fmtMoney(cb, curr)}</div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>הכנסות פחות תשלומים והוצאות</div>
      </div>

      {/* 4 primary summary cards. "הכנסות צפויות" is clickable → its management modal
          (view / add / edit / delete / "סמן כהתקבל"). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: isMobile ? 10 : 16 }}>
        {cards.map(c => {
          const m = BAL_TYPE_META[c.label];
          const clickable = c.label === "הכנסות צפויות" && !readOnly; // shalev: view-only, no manage
          return (
            <div
              key={c.label}
              onClick={clickable ? () => setManageIncomeOpen(true) : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setManageIncomeOpen(true); } } : undefined}
              onMouseEnter={clickable ? (e) => { e.currentTarget.style.borderColor = `${m.color}55`; } : undefined}
              onMouseLeave={clickable ? (e) => { e.currentTarget.style.borderColor = BDR2; } : undefined}
              style={{ ...panel, padding: isMobile ? "16px 14px" : "20px 22px", cursor: clickable ? "pointer" : "default", transition: "border-color .14s" }}
            >
              <div style={{ fontSize: isMobile ? 13 : 14.5, fontWeight: 800, color: TEXT }}>{c.label}</div>
              <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900, color: m.color, direction: "ltr", textAlign: "start", marginTop: 8 }}>{fmtMoney(c.value, curr)}</div>
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>{m.sub}</div>
              {clickable && <div style={{ fontSize: 11, color: m.color, marginTop: 4, fontWeight: 700 }}>לחץ לצפייה וניהול ←</div>}
            </div>
          );
        })}
      </div>

      {/* 5th category — "הוצאות צפויות" as a slim, clear summary strip (visible, not a full
          card). Managed via a dedicated modal (they're hidden from the main history list). */}
      <div style={{ ...panel, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: isMobile ? "13px 16px" : "14px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: BAL_TYPE_META["הוצאות צפויות"].color, flexShrink: 0 }} />
          <span style={{ fontSize: isMobile ? 13.5 : 14.5, fontWeight: 800, color: TEXT }}>הוצאות צפויות</span>
          {!isMobile && <span style={{ fontSize: 11.5, color: MUTED }}>· {BAL_TYPE_META["הוצאות צפויות"].sub} (לא נכלל ביתרה)</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: isMobile ? 17 : 19, fontWeight: 900, color: BAL_TYPE_META["הוצאות צפויות"].color, direction: "ltr" }}>{fmtMoney(totals.expectedExpenses, curr)}</span>
          {!readOnly && (
          <button onClick={() => setManageOpen(true)} style={{
            padding: isMobile ? "6px 12px" : "7px 14px", borderRadius: 9, cursor: "pointer",
            background: "transparent", border: `1px solid ${BDR2}`, color: TEXT2,
            fontSize: isMobile ? 12 : 12.5, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
          }}>ניהול</button>
          )}
        </div>
      </div>

      {/* history — every ledger entry; owner add / edit / delete */}
      <div style={panel}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: isMobile ? "14px 16px" : "16px 24px", borderBottom: `1px solid ${BDR}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}`, flexShrink: 0 }} />
            <span style={{ fontSize: isMobile ? 15.5 : 17.5, fontWeight: 800, color: TEXT }}>היסטוריית תנועות</span>
          </div>
          {!readOnly && (
          <button onClick={() => setModal({ mode: "add" })} style={{
            display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
            padding: isMobile ? "8px 12px" : "9px 15px", borderRadius: 11, cursor: "pointer",
            background: "linear-gradient(180deg, #E5322F, #C01C1C)", border: "none",
            color: "#fff", fontSize: isMobile ? 12.5 : 13.5, fontWeight: 800, fontFamily: "inherit",
            boxShadow: "0 4px 14px rgba(220,38,38,0.30)",
          }}><span style={{ fontSize: 16, lineHeight: 1, marginTop: -1 }}>+</span>הוסף רשומה</button>
          )}
        </div>

        {historyEntries.length === 0 ? (
          <div style={{ padding: "34px 24px", textAlign: "center", fontSize: 13.5, color: TEXT2 }}>אין עדיין רשומות מאזן</div>
        ) : isMobile ? (
          <div style={{ padding: "2px 0 6px" }}>
            {historyEntries.map((h, i) => {
              const m = BAL_TYPE_META[h.entryType];
              return (
                <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: i < historyEntries.length - 1 ? `1px solid ${BDR}` : "none" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.description || h.entryType}</div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ direction: "ltr" }}>{fmtShowDate(h.entryDate)}</span>
                      <span style={{ color: m.color }}>· {h.entryType}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 900, color: m.color, direction: "ltr", flexShrink: 0 }}>{fmtMoney(h.amount, curr)}</div>
                  {!readOnly && (
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <button onClick={() => setModal({ mode: "edit", entry: h })} aria-label="עריכה" style={rowIconBtn}><IcEdit size={16} /></button>
                    <button onClick={() => setDeleteTarget(h)} aria-label="מחיקה" style={rowIconBtn}><IcTrash size={16} /></button>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: histCols, gap: 10, padding: "12px 24px", borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.015)" }}>
              {(readOnly ? ["תאריך", "פירוט", "סכום"] : ["תאריך", "פירוט", "סכום", ""]).map((h, i) => (
                <div key={i} style={{ fontSize: 12, fontWeight: 800, color: "#9A9AA6", letterSpacing: "0.04em", textTransform: "uppercase", textAlign: i === 2 ? "center" : "start" }}>{h}</div>
              ))}
            </div>
            {historyEntries.map((h, i) => {
              const m = BAL_TYPE_META[h.entryType];
              return (
                <div key={h.id} style={{ display: "grid", gridTemplateColumns: histCols, gap: 10, alignItems: "center", padding: "13px 24px", borderBottom: i < historyEntries.length - 1 ? `1px solid ${BDR}` : "none" }}>
                  <div style={{ fontSize: 12.5, color: "#CFCFD6", direction: "ltr", textAlign: "start", fontFamily: "ui-monospace, Menlo, monospace" }}>{fmtShowDate(h.entryDate)}</div>
                  <div style={{ minWidth: 0, textAlign: "start" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.description || h.entryType}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: m.color, marginTop: 2 }}>{h.entryType}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: m.color, direction: "ltr", textAlign: "center" }}>{fmtMoney(h.amount, curr)}</div>
                  {!readOnly && (
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <button onClick={() => setModal({ mode: "edit", entry: h })} aria-label="עריכה" style={rowIconBtn}><IcEdit size={16} /></button>
                    <button onClick={() => setDeleteTarget(h)} aria-label="מחיקה" style={rowIconBtn}><IcTrash size={16} /></button>
                  </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {manageOpen && (
        <BalanceExpectedManageModal
          title="ניהול הוצאות צפויות"
          addLabel="הוסף הוצאה צפויה"
          color={BAL_TYPE_META["הוצאות צפויות"].color}
          entries={expectedExpenseEntries}
          total={totals.expectedExpenses}
          onClose={() => setManageOpen(false)}
          onAdd={() => setModal({ mode: "addExpected" })}
          onEdit={(e) => setModal({ mode: "edit", entry: e })}
          onDelete={(e) => setDeleteTarget(e)}
        />
      )}
      {manageIncomeOpen && (
        <BalanceExpectedManageModal
          title="ניהול הכנסות צפויות"
          addLabel="הוסף הכנסה צפויה"
          color={BAL_TYPE_META["הכנסות צפויות"].color}
          entries={expectedIncomeEntries}
          total={totals.expectedIncome}
          onClose={() => setManageIncomeOpen(false)}
          onAdd={() => setModal({ mode: "addExpectedIncome" })}
          onEdit={(e) => setModal({ mode: "edit", entry: e })}
          onDelete={(e) => setDeleteTarget(e)}
          onMarkReceived={(e) => setMarkReceivedTarget(e)}
        />
      )}
      {markReceivedTarget && artistId && (
        <BalanceMarkReceivedModal
          artistId={artistId}
          entry={markReceivedTarget}
          onClose={() => setMarkReceivedTarget(null)}
          onDone={async () => { await onReload(); setMarkReceivedTarget(null); }}
        />
      )}
      {modal && artistId && (
        <BalanceEntryModal
          artistId={artistId}
          entry={modal.mode === "edit" ? modal.entry : null}
          defaultType={modal.mode === "addExpected" ? "הוצאות צפויות" : modal.mode === "addExpectedIncome" ? "הכנסות צפויות" : undefined}
          onClose={() => setModal(null)}
          onSaved={async () => { await onReload(); setModal(null); }}
        />
      )}
      {deleteTarget && artistId && (
        <BalanceDeleteModal
          artistId={artistId}
          entry={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={async () => { await onReload(); setDeleteTarget(null); }}
        />
      )}
    </div>
  );
}

// Local YYYY-MM-DD for "today" (used as the default receipt date). Runs only on user
// interaction (modal mount), never during SSR/hydration → no mismatch.
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Owner-only manager for an "expected" category that is hidden from the main history
// list (הכנסות צפויות / הוצאות צפויות). Lists rows with note + edit/delete + "add".
// Income also gets a "סמן כהתקבל" action (onMarkReceived). Reuses the entry/delete/mark
// modals (stacked). Reads the live ledger → refreshes after any change. Display-layer
// only — no API/DB/permission change.
function BalanceExpectedManageModal({ title, addLabel, color, entries, total, onClose, onAdd, onEdit, onDelete, onMarkReceived }: {
  title: string; addLabel: string; color: string; entries: BalanceEntry[]; total: number;
  onClose: () => void; onAdd: () => void; onEdit: (e: BalanceEntry) => void; onDelete: (e: BalanceEntry) => void;
  onMarkReceived?: (e: BalanceEntry) => void;
}) {
  return (
    <BalanceModalShell title={title} onClose={onClose} busy={false}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: TEXT2 }}>סה״כ: <b style={{ color: TEXT, direction: "ltr", display: "inline-block" }}>{fmtMoney(total, "₪")}</b></div>
        <button onClick={onAdd} style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 10, cursor: "pointer",
          background: "linear-gradient(180deg, #E5322F, #C01C1C)", border: "none", color: "#fff",
          fontSize: 12.5, fontWeight: 800, fontFamily: "inherit",
        }}><span style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>+</span>{addLabel}</button>
      </div>
      {entries.length === 0 ? (
        <div style={{ padding: "26px 8px", textAlign: "center", fontSize: 13.5, color: TEXT2 }}>אין עדיין רשומות</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.map(e => (
            <div key={e.id} style={{ padding: "12px 14px", borderRadius: 12, border: `1px solid ${BDR2}`, background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description || e.entryType}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 3, direction: "ltr", textAlign: "start" }}>{fmtShowDate(e.entryDate)}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 900, color, direction: "ltr", flexShrink: 0 }}>{fmtMoney(e.amount, "₪")}</div>
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  <button onClick={() => onEdit(e)} aria-label="עריכה" style={rowIconBtn}><IcEdit size={16} /></button>
                  <button onClick={() => onDelete(e)} aria-label="מחיקה" style={rowIconBtn}><IcTrash size={16} /></button>
                </div>
              </div>
              {e.note && <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 7, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{e.note}</div>}
              {onMarkReceived && (
                <div style={{ marginTop: 9 }}>
                  <button onClick={() => onMarkReceived(e)} style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, cursor: "pointer",
                    background: "rgba(52,211,153,0.12)", border: `1px solid ${GREEN}55`, color: GREEN,
                    fontSize: 12, fontWeight: 800, fontFamily: "inherit",
                  }}>✓ סמן כהתקבל</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 18 }}>
        <button onClick={onClose} style={{
          width: "100%", padding: "13px 0", borderRadius: 12, border: `1px solid ${BDR2}`, background: "transparent",
          color: TEXT2, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
        }}>סגור</button>
      </div>
    </BalanceModalShell>
  );
}

// "סמן כהתקבל" — converts ONE הכנסות צפויות row to הכנסות IN PLACE (no new row, no copy).
// Uses the existing owner-only PATCH: sends entryType=הכנסות + the chosen receipt date, and
// carries the row's amount/description/note unchanged (server never touches
// source_tx_id/artist_id/created_at). Button locked while saving; kept open on error.
function BalanceMarkReceivedModal({ artistId, entry, onClose, onDone }: {
  artistId: string; entry: BalanceEntry; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [date, setDate] = useState(todayYmd());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const confirm = async () => {
    if (!validDate || busy) return;                    // guard: never double-submit
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/label/artists/${artistId}/balance/${entry.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryType: "הכנסות", amount: entry.amount, entryDate: date, description: entry.description, note: entry.note }),
      });
      if (!res.ok) { setErr(await readErr(res, "עדכון הרשומה נכשל")); setBusy(false); return; }
      await onDone();                                   // reload + close; row is now "הכנסות"
    } catch { setErr("שגיאת רשת, נסה שוב"); setBusy(false); }
  };
  return (
    <BalanceModalShell title="סימון כהתקבל" onClose={onClose} busy={busy}>
      <SkErr msg={err} />
      <div style={{ fontSize: 13.5, color: TEXT2, lineHeight: 1.7, marginBottom: 16 }}>
        העברת <b style={{ color: TEXT }}>{entry.description || "הכנסה צפויה"}</b> על סך{" "}
        <b style={{ color: TEXT, direction: "ltr", display: "inline-block" }}>{fmtMoney(entry.amount, "₪")}</b> מ״הכנסות צפויות״ ל״הכנסות״. הסכום, התיאור וההערה נשמרים כפי שהם.
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={skLabel}>תאריך קבלה</label>
        <DatePickerInput value={date} onChange={setDate} disabled={busy} style={{ ...skField }} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={confirm} disabled={!validDate || busy} style={{ ...skPrimaryBtn(validDate && !busy), flex: "1 1 150px", width: "auto" }}>{busy ? "מעדכן…" : "אשר קבלה"}</button>
        <button onClick={onClose} disabled={busy} style={{
          flex: "1 1 110px", padding: "14px 0", borderRadius: 12, border: `1px solid ${BDR2}`, background: "transparent",
          color: TEXT2, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: busy ? "default" : "pointer",
        }}>ביטול</button>
      </div>
    </BalanceModalShell>
  );
}

// Reusable dark modal shell for the balance ledger (₪ icon; close blocked while busy).
function BalanceModalShell({ title, onClose, busy, children }: {
  title: string; onClose: () => void; busy: boolean; children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100030, background: "rgba(0,0,0,0.66)",
        backdropFilter: "blur(3px)", display: "flex", justifyContent: "center", alignItems: "center",
        padding: isMobile
          ? "calc(env(safe-area-inset-top) + 12px) 12px calc(env(safe-area-inset-bottom) + 12px)"
          : 20,
        fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      }}>
      <div style={{
        width: "100%", maxWidth: isMobile ? 440 : 480, maxHeight: isMobile ? "88dvh" : "88vh",
        display: "flex", flexDirection: "column", boxSizing: "border-box", direction: "rtl", overflow: "hidden",
        background: "linear-gradient(180deg, #161617 0%, #111112 100%)",
        border: `1px solid ${BDR2}`, borderRadius: 20, boxShadow: "0 24px 70px rgba(0,0,0,0.6)",
      }}>
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          padding: isMobile ? "15px 16px 13px" : "20px 24px 16px", borderBottom: `1px solid ${BDR}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: "rgba(220,38,38,0.16)", border: `1px solid ${BRAND}55`, display: "flex", alignItems: "center", justifyContent: "center", color: "#FF6B6B", fontSize: 15, fontWeight: 900 }}>₪</span>
            <div style={{ fontSize: isMobile ? 16.5 : 18, fontWeight: 900, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          </div>
          <button onClick={() => !busy && onClose()} aria-label="סגור" disabled={busy} style={{ background: "none", border: "none", cursor: busy ? "default" : "pointer", padding: 4, flexShrink: 0, lineHeight: 0, opacity: busy ? 0.4 : 1 }}><IcX size={20} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: isMobile ? "14px 16px 18px" : "18px 24px 24px" }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Add / edit a ledger entry. Server confirms before the modal closes (kept open on
// error), and the primary button is locked while busy → no double-submit.
function BalanceEntryModal({ artistId, entry, onClose, onSaved, defaultType }: {
  artistId: string; entry: BalanceEntry | null; onClose: () => void; onSaved: () => Promise<void>; defaultType?: BalanceType;
}) {
  const isEdit = !!entry;
  const [entryDate, setEntryDate] = useState(entry?.entryDate ?? "");
  const [entryType, setEntryType] = useState<BalanceType>(entry?.entryType ?? defaultType ?? "הכנסות");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const amountNum = Number(amount);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(entryDate);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const canSave = validDate && validAmount && (BALANCE_TYPES as readonly string[]).includes(entryType) && !busy;

  const save = async () => {
    if (!canSave || busy) return;              // guard: never double-submit
    setBusy(true); setErr(null);
    try {
      const url = isEdit
        ? `/api/label/artists/${artistId}/balance/${entry!.id}`
        : `/api/label/artists/${artistId}/balance`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryType, amount: amountNum, entryDate, description, note }),
      });
      if (!res.ok) { setErr(await readErr(res, "שמירת הרשומה נכשלה")); setBusy(false); return; }
      await onSaved();                          // reloads + closes; modal unmounts
    } catch { setErr("שגיאת רשת, נסה שוב"); setBusy(false); }
  };

  return (
    <BalanceModalShell title={isEdit ? "עריכת רשומה" : "הוסף רשומה"} onClose={onClose} busy={busy}>
      <SkErr msg={err} />
      <div style={{ marginBottom: 16 }}>
        <label style={skLabel}>תאריך</label>
        <DatePickerInput value={entryDate} onChange={setEntryDate} disabled={busy} style={{ ...skField }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={skLabel}>סוג רשומה</label>
        <select className="rap-select" value={entryType} onChange={e => setEntryType(e.target.value as BalanceType)} disabled={busy}
          style={{ ...skField, color: TEXT, cursor: "pointer", appearance: "auto", opacity: busy ? 0.6 : 1 }}>
          {BALANCE_TYPES.map(t => <option key={t} value={t} style={{ background: "#161617", color: TEXT }}>{t}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={skLabel}>סכום (₪)</label>
        <input type="number" inputMode="decimal" min="0" step="1" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy}
          placeholder="0" className="rap-num" style={{ ...skField, color: TEXT, direction: "ltr", textAlign: "right", opacity: busy ? 0.6 : 1 }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={skLabel}>תיאור</label>
        <input type="text" value={description} onChange={e => setDescription(e.target.value)} disabled={busy}
          placeholder="לדוגמה: הופעה בתל אביב" maxLength={200} style={{ ...skField, opacity: busy ? 0.6 : 1 }} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={skLabel}>הערה (אופציונלי)</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} disabled={busy} rows={2} maxLength={500}
          style={{ ...skField, resize: "vertical", minHeight: 60, opacity: busy ? 0.6 : 1 }} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={save} disabled={!canSave} style={{ ...skPrimaryBtn(canSave), flex: "1 1 150px", width: "auto" }}>{busy ? "שומר…" : isEdit ? "שמור שינויים" : "הוסף רשומה"}</button>
        <button onClick={onClose} disabled={busy} style={{
          flex: "1 1 110px", padding: "14px 0", borderRadius: 12, border: `1px solid ${BDR2}`, background: "transparent",
          color: TEXT2, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: busy ? "default" : "pointer",
        }}>ביטול</button>
      </div>
    </BalanceModalShell>
  );
}

// Delete confirmation — explicit confirm, button locked + loading while in-flight.
function BalanceDeleteModal({ artistId, entry, onClose, onDeleted }: {
  artistId: string; entry: BalanceEntry; onClose: () => void; onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const del = async () => {
    if (busy) return;                          // guard: never double-submit
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/label/artists/${artistId}/balance/${entry.id}`, { method: "DELETE" });
      if (!res.ok) { setErr(await readErr(res, "מחיקת הרשומה נכשלה")); setBusy(false); return; }
      await onDeleted();
    } catch { setErr("שגיאת רשת, נסה שוב"); setBusy(false); }
  };
  return (
    <BalanceModalShell title="מחיקת רשומה" onClose={onClose} busy={busy}>
      <SkErr msg={err} />
      <div style={{ fontSize: 14, color: TEXT2, lineHeight: 1.7, marginBottom: 18 }}>
        למחוק את הרשומה <b style={{ color: TEXT }}>{entry.description || entry.entryType}</b> על סך{" "}
        <b style={{ color: TEXT, direction: "ltr", display: "inline-block" }}>{fmtMoney(entry.amount, "₪")}</b>? פעולה זו אינה ניתנת לביטול.
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={del} disabled={busy} style={{
          flex: "1 1 150px", padding: "14px 0", borderRadius: 12, border: "none", color: "#fff",
          fontSize: 14.5, fontWeight: 800, fontFamily: "inherit", cursor: busy ? "default" : "pointer",
          background: "linear-gradient(180deg, #E5322F, #C01C1C)", opacity: busy ? 0.6 : 1,
        }}>{busy ? "מוחק…" : "מחק רשומה"}</button>
        <button onClick={onClose} disabled={busy} style={{
          flex: "1 1 110px", padding: "14px 0", borderRadius: 12, border: `1px solid ${BDR2}`, background: "transparent",
          color: TEXT2, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: busy ? "default" : "pointer",
        }}>ביטול</button>
      </div>
    </BalanceModalShell>
  );
}

// ── ההופעות שלי (shows tab) — REAL shows from the main shows module. ─────────────
// Data via GET /api/red-artists/shalev-summary (server-scoped to Shalev, only
// אושרה/נסגר/בוצע, money stripped server-side). STRICT: NO money on this page —
// financials live ONLY in the מאזן tab. Read-only view: Shalev never creates,
// edits or deletes a show here (Red Artists is view-only — see
// [[redbloods-red-artists-boundary]]).
type Show = { name: string; date: string; time: string; location: string; status: string };
// Real show statuses (no purple): אושרה=approved green, נסגר=booked blue, בוצע=done grey.
const SHOW_STATUS_COLOR: Record<string, string> = {
  "אושרה": GREEN,
  "נסגר":  BLUE,
  "בוצע":  "#9CA3AF",
};

function ShowStatusPill({ status }: { status: string }) {
  const col = SHOW_STATUS_COLOR[status] ?? TEXT2;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: col, background: `${col}18`, border: `1px solid ${col}44`, borderRadius: 999, padding: "5px 13px", whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: col, boxShadow: `0 0 7px ${col}` }} />
      {status}
    </span>
  );
}

// One shows section (הופעות קרובות / הופעות שבוצעו). Desktop = clean grid table,
// mobile = stacked cards (name / date · time / location / status). NO amounts.
function ShowsSection({ title, shows, isMobile, emptyText = "אין הופעות להצגה כרגע" }: { title: string; shows: Show[]; isMobile: boolean; emptyText?: string }) {
  const cols = "minmax(0, 1.5fr) 120px 100px minmax(0, 1.4fr) 120px";
  const heads = ["שם הופעה", "תאריך", "שעת הופעה", "מיקום", "סטטוס"];
  return (
    <div style={panel}>
      {/* section header — title (right, RTL) + red dot to its left */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: isMobile ? "16px 16px" : "18px 24px", borderBottom: `1px solid ${BDR}` }}>
        <span style={{ fontSize: isMobile ? 15.5 : 17.5, fontWeight: 800, color: TEXT }}>{title}</span>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
      </div>

      {shows.length === 0 ? (
        <div style={{ padding: "34px 24px", textAlign: "center", fontSize: 13.5, color: TEXT2 }}>{emptyText}</div>
      ) : isMobile ? (
        <div style={{ padding: "2px 0 6px" }}>
          {shows.map((s, i) => (
            <div key={i} style={{ padding: "14px 16px", borderBottom: i < shows.length - 1 ? `1px solid ${BDR}` : "none" }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: TEXT }}>{s.name}</div>
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4, direction: "ltr", textAlign: "start" }}>{s.date} · {s.time}</div>
              <div style={{ fontSize: 12.5, color: TEXT2, marginTop: 3 }}>{s.location}</div>
              <div style={{ marginTop: 9 }}><ShowStatusPill status={s.status} /></div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "12px 24px", borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.015)" }}>
            {heads.map((h, i) => (
              <div key={i} style={{ fontSize: 13, fontWeight: 800, color: "#9A9AA6", letterSpacing: "0.03em", textTransform: "uppercase", textAlign: i === 0 ? "start" : "center" }}>{h}</div>
            ))}
          </div>
          {shows.map((s, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "17px 24px", borderBottom: i < shows.length - 1 ? `1px solid ${BDR}` : "none" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, textAlign: "start", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
              <div style={{ fontSize: 14, color: "#CFCFD6", direction: "ltr", textAlign: "center", fontFamily: "ui-monospace, Menlo, monospace" }}>{s.date}</div>
              <div style={{ fontSize: 14, color: "#CFCFD6", direction: "ltr", textAlign: "center", fontFamily: "ui-monospace, Menlo, monospace" }}>{s.time}</div>
              <div style={{ fontSize: 14.5, color: TEXT2, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.location}</div>
              <div style={{ display: "flex", justifyContent: "center" }}><ShowStatusPill status={s.status} /></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// Map a server PortalShow (no money) → the display row. Date formatted, time/
// location fall back to "—".
function toShowRow(s: PortalShow): Show {
  return { name: s.name, date: fmtShowDate(s.date), time: s.startTime || "—", location: s.location || "—", status: s.status };
}

function ShowsPage({ summary, loadState }: { summary: ShalevSummary | null; loadState: LoadState }) {
  const isMobile = useIsMobile();

  if (loadState === "loading") {
    return <div style={{ ...panel, padding: "48px 24px", textAlign: "center", fontSize: 13.5, color: TEXT2 }}>טוען…</div>;
  }
  if (loadState === "error") {
    return <div style={{ ...panel, padding: "48px 24px", textAlign: "center", fontSize: 13.5, color: TEXT2 }}>לא ניתן לטעון הופעות כרגע</div>;
  }

  const upcoming = (summary?.shows.upcoming ?? []).map(toShowRow);
  const done     = (summary?.shows.done ?? []).map(toShowRow);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20 }}>
      <ShowsSection title="הופעות קרובות" shows={upcoming} isMobile={isMobile} emptyText="אין הופעות קרובות כרגע" />
      <ShowsSection title="הופעות שבוצעו" shows={done} isMobile={isMobile} emptyText="אין עדיין הופעות שבוצעו" />
    </div>
  );
}

// ── Availability (לו״ז ועדכונים tab) — simple next-week availability. UI ONLY,
// hardcoded demo + local toggle. Future step: artist updates it → owner sees it
// → schedules a session → it flows back. No DB/API/Calendar wired here yet. ──
type AvailDay = { day: string; date: string; available: boolean; from: string };
const HEB_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const AVAIL_TIMES = ["10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];

// Next Israeli week (ראשון→שבת): the Sunday AFTER the current week, + 6 days.
// Every day defaults to "לא פנוי". Computed on the client (in an effect) to keep
// the dates correct without risking an SSR/client hydration mismatch.
function computeNextWeek(): AvailDay[] {
  const today = new Date();
  const nextSunday = new Date(today);
  nextSunday.setDate(today.getDate() + (7 - today.getDay())); // day 0 = Sunday
  return HEB_DAYS.map((day, i) => {
    const d = new Date(nextSunday);
    d.setDate(nextSunday.getDate() + i);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return { day, date: `${dd}.${mm}`, available: false, from: "" };
  });
}

// ── לו״ז ועדכונים tab — three clearly separated sections (UI only, no writes):
//   1) הזמינות שלי — what Shalev SENDS us (existing local demo logic, unchanged)
//   2) היומן השבועי שלי — what's already SCHEDULED for him (empty until a source)
//   3) עדכונים מהלייבל — messages FROM the label (empty until a source)
// These are three DIFFERENT things and are never mixed. No DB / API / Calendar.
function SchedSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <div style={panel}>
      <div style={{ padding: isMobile ? "16px 16px" : "18px 24px", borderBottom: `1px solid ${BDR}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
          <span style={{ fontSize: isMobile ? 15.5 : 17.5, fontWeight: 800, color: TEXT }}>{title}</span>
        </div>
        {subtitle && <div style={{ fontSize: 12.5, color: TEXT2, marginTop: 5, marginInlineStart: 16 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function SchedEmpty({ text }: { text: string }) {
  return <div style={{ padding: "40px 24px", textAlign: "center", fontSize: 13.5, color: TEXT2 }}>{text}</div>;
}

// Event/update type colors (no purple): הופעה red · סשן blue · צילום קליפ amber · פגישה green.
const SCHED_TYPE_COLOR: Record<string, string> = {
  "הופעה":     "#FF6B6B",
  "סשן":       BLUE,
  "צילום קליפ": AMBER,
  "פגישה":     GREEN,
};

function SchedTypePill({ type }: { type: string }) {
  const col = SCHED_TYPE_COLOR[type] ?? TEXT2;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: col, background: `${col}18`, border: `1px solid ${col}44`, borderRadius: 999, padding: "3px 11px", whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: col, boxShadow: `0 0 6px ${col}` }} />
      {type}
    </span>
  );
}

// Weekly schedule list — real sessions + shows for the next 7 days (no money).
function WeeklyList({ items }: { items: WeeklyItem[] }) {
  return (
    <div style={{ padding: "4px 0 6px" }}>
      {items.map((ev, i) => {
        const time = ev.startTime ? (ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime) : null;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 20px", borderBottom: i < items.length - 1 ? `1px solid ${BDR}` : "none" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <SchedTypePill type={ev.type} />
                <span style={{ fontSize: 14.5, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</span>
              </div>
              {ev.location && <div style={{ fontSize: 12.5, color: TEXT2, marginTop: 5 }}>{ev.location}</div>}
            </div>
            <div style={{ textAlign: "start", flexShrink: 0 }}>
              <div style={{ fontSize: 13, color: "#CFCFD6", direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace" }}>{fmtShowDate(ev.date)}</div>
              {time && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, direction: "ltr" }}>{time}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Updates list — derived only from real approved shows + scheduled sessions.
function UpdatesList({ items }: { items: PortalUpdate[] }) {
  return (
    <div style={{ padding: "4px 0 6px" }}>
      {items.map((u, i) => {
        const col = SCHED_TYPE_COLOR[u.type] ?? BRAND;
        return (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "13px 20px", borderBottom: i < items.length - 1 ? `1px solid ${BDR}` : "none" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: col, marginTop: 6, flexShrink: 0, boxShadow: `0 0 7px ${col}` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{u.title}</div>
              {u.description && <div style={{ fontSize: 12.5, color: TEXT2, marginTop: 3 }}>{u.description}</div>}
            </div>
            <div style={{ fontSize: 12, color: MUTED, direction: "ltr", flexShrink: 0, fontFamily: "ui-monospace, Menlo, monospace" }}>{fmtShowDate(u.date)}</div>
          </div>
        );
      })}
    </div>
  );
}

function SchedulePage({ summary, loadState }: { summary: ShalevSummary | null; loadState: LoadState }) {
  const isMobile = useIsMobile();
  const weekly  = summary?.weekly  ?? [];
  const updates = summary?.updates ?? [];
  const loading = loadState === "loading";
  const error   = loadState === "error";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20 }}>
      {/* 1) availability — Shalev marks when he's free (existing logic, untouched) */}
      <SchedSection title="הזמינות שלי" subtitle="בחר מתי אתה פנוי לשבוע הקרוב">
        <AvailabilityBody />
      </SchedSection>
      {/* 2) weekly calendar — Shalev's REAL sessions + shows for the next 7 days */}
      <SchedSection title="היומן השבועי שלי" subtitle="כל מה שכבר נקבע לך השבוע">
        {loading ? <SchedEmpty text="טוען…" />
          : error ? <SchedEmpty text="לא ניתן לטעון כרגע" />
          : weekly.length === 0 ? <SchedEmpty text="אין אירועים מתוכננים השבוע" />
          : <WeeklyList items={weekly} />}
      </SchedSection>
      {/* 3) label updates — derived from real shows/sessions only */}
      <SchedSection title="עדכונים מהלייבל">
        {loading ? <SchedEmpty text="טוען…" />
          : error ? <SchedEmpty text="לא ניתן לטעון כרגע" />
          : updates.length === 0 ? <SchedEmpty text="עדיין אין עדכונים חדשים" />
          : <UpdatesList items={updates} />}
      </SchedSection>
    </div>
  );
}

// Format an ISO timestamp for the "last updated" line (client-only).
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Availability picker (7 days + send) — REAL persistence via
// /api/red-artists/availability (global settings store). Load marks the last
// saved days (NO push); "שלח" saves + triggers role-aware push server-side.
// Both owner and shalev may send; who sent drives the "last updated" text.
function AvailabilityBody() {
  const isMobile = useIsMobile();
  // Start with day names + blank dates (identical on server & client → no
  // hydration mismatch); replaced on mount by the last saved value (or next week).
  const [days, setDays] = useState<AvailDay[]>(() => HEB_DAYS.map(day => ({ day, date: "", available: false, from: "" })));
  const [lastUpdate, setLastUpdate] = useState<{ sentBy: "owner" | "shalev"; sentAt: string } | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null); // day being edited in the modal
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  // Load the last saved availability (GET — NEVER sends push). Fall back to a
  // blank next week when nothing was ever sent.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/red-artists/availability", { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        const av = d?.availability;
        if (r.ok && d?.ok && av && Array.isArray(av.days) && av.days.length === 7) {
          setDays(av.days as AvailDay[]);
          setLastUpdate({ sentBy: av.sentBy, sentAt: av.sentAt });
          return;
        }
      } catch { /* fall through to a blank week */ }
      if (alive) setDays(computeNextWeek());
    })();
    return () => { alive = false; };
  }, []);

  const saveDay = (i: number, patch: { available: boolean; from: string }) => {
    setDays(ds => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
    setEditIdx(null);
    setStatus(null); // editing invalidates the prior "sent" confirmation
  };

  const send = async () => {
    if (sending) return;
    setSending(true); setStatus(null);
    try {
      const r = await fetch("/api/red-artists/availability", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.ok) {
        if (d.availability) setLastUpdate({ sentBy: d.availability.sentBy, sentAt: d.availability.sentAt });
        // Save succeeded. Only a REAL push failure (not the non-production skip)
        // is surfaced — as a soft warning; the availability is stored regardless.
        const pushFailed = d.push && d.push.sent === false && d.push.error && d.push.error !== "push-disabled-non-production";
        setStatus(pushFailed
          ? { kind: "warn", text: "הזמינות נשמרה, אך שליחת ההתראה נכשלה" }
          : { kind: "ok", text: "✓ הזמינות נשלחה" });
      } else {
        setStatus({ kind: "err", text: (d?.error as string) || "השליחה נכשלה" });
      }
    } catch {
      setStatus({ kind: "err", text: "שגיאת רשת, נסה שוב" });
    } finally {
      setSending(false);
    }
  };

  const statusColor = status?.kind === "err" ? "#F87171" : status?.kind === "warn" ? "#F59E0B" : GREEN;

  return (
    <div style={{ padding: isMobile ? "14px 14px 16px" : "16px 22px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: MUTED }}>לחצו על יום כדי לעדכן זמינות</div>
        {lastUpdate && (
          <div style={{ fontSize: 11.5, color: MUTED }}>
            עודכן לאחרונה על ידי {lastUpdate.sentBy === "shalev" ? "שליו" : "הלייבל"} בתאריך {fmtWhen(lastUpdate.sentAt)}
          </div>
        )}
      </div>

      {/* 7-day grid — desktop 7 across, mobile 2 cols */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(7, 1fr)", gap: isMobile ? 10 : 12 }}>
        {days.map((d, i) => {
          const c = d.available ? GREEN : "#F87171";
          return (
            <button key={d.day} onClick={() => setEditIdx(i)} style={{
              ...panel, padding: isMobile ? "16px 10px" : "18px 12px", cursor: "pointer", fontFamily: "inherit",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center",
              border: `1px solid ${d.available ? "rgba(52,211,153,0.28)" : BDR2}`, transition: "border-color .14s",
            }}>
              <div>
                <div style={{ fontSize: isMobile ? 15 : 16, fontWeight: 800, color: TEXT }}>{d.day}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 3, direction: "ltr" }}>{d.date}</div>
              </div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: c, background: `${c}1A`, border: `1px solid ${c}55`, borderRadius: 999, padding: "4px 12px" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, boxShadow: `0 0 7px ${c}` }} />
                {d.available ? "פנוי" : "לא פנוי"}
              </span>
              <div style={{ fontSize: 12, color: TEXT2, minHeight: 16 }}>
                {d.available ? (d.from ? `פנוי מ-${d.from}` : "פנוי כל היום") : ""}
              </div>
            </button>
          );
        })}
      </div>

      {/* send */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 2 }}>
        <button onClick={send} disabled={sending} style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "14px 26px", borderRadius: 12, border: "none", color: "#fff", fontSize: 14.5, fontWeight: 800,
          fontFamily: "inherit", cursor: sending ? "wait" : "pointer", boxShadow: `0 4px 16px rgba(220,38,38,0.32)`,
          background: "linear-gradient(180deg, #E5322F, #C01C1C)", width: isMobile ? "100%" : "auto", opacity: sending ? 0.75 : 1,
        }}>{sending ? "שולח…" : "שלח זמינות לשבוע הבא"}</button>
        {status && <span style={{ fontSize: 13, fontWeight: 700, color: statusColor }}>{status.text}</span>}
      </div>

      {editIdx !== null && (
        <AvailDayModal
          day={days[editIdx]}
          onCancel={() => setEditIdx(null)}
          onSave={patch => saveDay(editIdx, patch)}
        />
      )}
    </div>
  );
}

// Per-day availability editor (portal modal). UI-only local draft; commits to
// the parent on "שמור". Times are in-flow chips (mobile 2-col / desktop 3-col)
// — no floating dropdown (it leaked out of the card / bottom sheet).
function AvailDayModal({ day, onCancel, onSave }: {
  day: AvailDay; onCancel: () => void; onSave: (patch: { available: boolean; from: string }) => void;
}) {
  const isMobile = useIsMobile();
  const [available, setAvailable] = useState(day.available);
  const [from, setFrom] = useState(day.from || "16:00");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  const btnBase: React.CSSProperties = {
    flex: 1, padding: "12px 0", borderRadius: 11, border: "none", cursor: "pointer",
    fontFamily: "inherit", fontSize: 14, fontWeight: 800, boxSizing: "border-box",
  };

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100035, background: "rgba(0,0,0,0.66)",
        backdropFilter: "blur(3px)", display: "flex", justifyContent: "center",
        alignItems: isMobile ? "flex-end" : "center", padding: isMobile ? 0 : 20,
        fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      }}>
      <div style={{
        width: isMobile ? "100%" : 460, maxWidth: "100%", boxSizing: "border-box", direction: "rtl",
        maxHeight: isMobile ? "85vh" : "88vh", overflowY: "auto",
        background: "linear-gradient(180deg, #161617 0%, #111112 100%)", border: `1px solid ${BDR2}`,
        borderRadius: isMobile ? "20px 20px 0 0" : 20, boxShadow: "0 24px 70px rgba(0,0,0,0.6)",
        padding: isMobile ? "18px 16px calc(22px + env(safe-area-inset-bottom))" : "22px 24px 24px",
      }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: "#fff" }}>{day.day} <span style={{ fontSize: 13, fontWeight: 700, color: TEXT2, direction: "ltr" }}>{day.date}</span></div>
          <button type="button" onClick={onCancel} aria-label="סגור" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, lineHeight: 0 }}><IcX size={20} /></button>
        </div>

        {/* status toggle */}
        <div style={{ display: "flex", gap: 6, background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, borderRadius: 12, padding: 5, marginBottom: 16 }}>
          {([[true, "פנוי", GREEN], [false, "לא פנוי", "#F87171"]] as const).map(([val, lbl, col]) => {
            const sel = available === val;
            return (
              <button key={lbl} type="button" onClick={() => setAvailable(val)} style={{
                flex: 1, padding: "11px 0", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit",
                fontSize: 13.5, fontWeight: sel ? 800 : 600, whiteSpace: "nowrap",
                background: sel ? `${col}22` : "transparent", color: sel ? col : TEXT2,
                boxShadow: sel ? `inset 0 0 0 1px ${col}66` : "none", transition: "all .14s",
              }}>{lbl}</button>
            );
          })}
        </div>

        {/* time (only when available) — in-flow chips, mobile 2-col / desktop 3-col.
            No floating dropdown, so nothing spills out of the card / bottom sheet. */}
        {available && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT2, marginBottom: 8 }}>פנוי מ־</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gap: 8 }}>
              {AVAIL_TIMES.map(t => {
                const sel = t === from;
                return (
                  <button key={t} type="button" onClick={() => setFrom(t)} style={{
                    padding: "13px 0", borderRadius: 11, cursor: "pointer", fontFamily: "inherit",
                    fontSize: 15, fontWeight: sel ? 800 : 600, direction: "ltr", boxSizing: "border-box",
                    background: sel ? "rgba(52,211,153,0.14)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${sel ? "rgba(52,211,153,0.6)" : BDR2}`,
                    color: sel ? GREEN : TEXT,
                    boxShadow: sel ? "0 0 12px rgba(52,211,153,0.25)" : "none", transition: "all .14s",
                  }}>{t}</button>
                );
              })}
            </div>
          </div>
        )}

        {/* cancel + save */}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onCancel} style={{ ...btnBase, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT, fontWeight: 700 }}>ביטול</button>
          <button type="button" onClick={() => onSave({ available, from: available ? from : "" })} style={{
            ...btnBase, color: "#fff", background: "linear-gradient(180deg, #E5322F, #C01C1C)", boxShadow: "0 4px 16px rgba(220,38,38,0.32)",
          }}>שמור</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── "המוזיקה שלי" page ────────────────────────────────────────────────────────────
// Adapt a Sketch → the LibRow shape the shared player helpers already understand.
// Audio URL carries the version so a new V{n} never plays the previous cached URL.
function sketchAsLibRow(s: Sketch): LibRow {
  return {
    id: s.id, name: s.title, artist: SHALEV_ARTIST, status: "", projectType: "sketch",
    hasAudio: !!s.latestFilePath,
    audio: s.latestFilePath ? { name: s.latestFileName, url: sketchStreamUrl(s) } : null,
    durationSeconds: s.durationSeconds,
  };
}
function SketchRowPlay({ size, player, sketch, onError }: {
  size: number; player: ReturnType<typeof usePlayerSafe>; sketch: Sketch; onError?: (m: string) => void;
}) {
  const { isPlaying, onClick } = libRowPlay(player, sketchAsLibRow(sketch), onError);
  return <PlayButton size={size} disabled={!sketch.latestFilePath} playing={isPlaying} onClick={onClick} />;
}
// Force the global player onto a sketch's latest version (used after a new upload).
function playSketchLatest(player: ReturnType<typeof usePlayerSafe>, s: Sketch, onError?: (m: string) => void) {
  if (!s.latestFilePath) return;
  void playLibRow(player, sketchAsLibRow(s), onError);
}

function MyMusicPage({ sketches, loadState, onReload, onReorder, isShalev }: {
  sketches: Sketch[]; loadState: "loading" | "ready" | "error";
  onReload: () => Promise<void>; onReorder: (orderedIds: string[]) => Promise<boolean>; isShalev?: boolean;
}) {
  const showHandle = !isShalev;  // shalev: no drag handle (reorder is owner-only)
  const showDate = !isShalev;    // shalev: no date under the sketch name
  const showVersion = !isShalev; // shalev: no version (V1/V2) badge
  const isMobile = useIsMobile();
  const player = usePlayerSafe();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Sketch | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  // Keep the edit modal bound to fresh data after a reload (e.g. a new version).
  useEffect(() => {
    if (!editing) return;
    const fresh = sketches.find(s => s.id === editing.id);
    if (fresh && fresh !== editing) setEditing(fresh);
    if (!fresh) setEditing(null);
  }, [sketches, editing]);

  // ── Drag-to-reorder ──
  // `rows` is the local view of the library so a drag can reorder rows live and
  // smoothly. It resyncs from the server-backed `sketches` prop whenever we are
  // not mid-drag / mid-save (so a failed save visually reverts).
  const [rows, setRows] = useState<Sketch[]>(sketches);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  useEffect(() => {
    if (!draggingId && !savingOrder) setRows(sketches);
  }, [sketches, draggingId, savingOrder]);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const setRowRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el); else rowRefs.current.delete(id);
  }, []);

  const [visibleCount, setVisibleCount] = useState(6);
  const displayRows = rows.slice(0, visibleCount);
  const hasMore = visibleCount < rows.length;
  const showMore = () => setVisibleCount(c => (c < 10 ? 10 : rows.length));

  // Move the dragged id to the insertion index computed from the pointer's Y
  // against the visible rows. Produces a new array only when the order changes.
  const moveDragging = useCallback((clientY: number, dragId: string) => {
    setRows(prev => {
      const visible = prev.slice(0, visibleCount);
      let insertAt = visible.findIndex(s => {
        const el = rowRefs.current.get(s.id);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return clientY < r.top + r.height / 2;
      });
      if (insertAt === -1) insertAt = visible.length; // past the last visible row
      const from = prev.findIndex(s => s.id === dragId);
      if (from === -1) return prev;
      let to = insertAt;
      if (from < to) to -= 1;
      to = Math.max(0, Math.min(to, prev.length - 1));
      if (to === from) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, [visibleCount]);

  const onHandleDown = (e: React.PointerEvent, id: string) => {
    if (isShalev || savingOrder) return; // reorder is owner-only (defense; handle isn't rendered for shalev)
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDraggingId(id);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!draggingId) return;
    e.preventDefault();
    moveDragging(e.clientY, draggingId);
  };
  const commitOrder = useCallback(async () => {
    const dragged = draggingId;
    setDraggingId(null);
    if (!dragged) return;
    const nextIds = rows.map(s => s.id);
    const origIds = sketches.map(s => s.id);
    if (nextIds.join("|") === origIds.join("|")) return; // no change → no request
    setSavingOrder(true);
    const ok = await onReorder(nextIds);
    setSavingOrder(false);
    setToast(ok ? "הסדר נשמר" : "לא ניתן לשמור את הסדר, הסדר שוחזר");
  }, [draggingId, rows, sketches, onReorder]);
  const onHandleUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    void commitOrder();
  };

  const ready = loadState === "ready";
  const thisMonth = new Date().toISOString().slice(0, 7);
  const totalVersions = sketches.reduce((n, s) => n + (s.versions?.length ?? 0), 0);
  const createdThisMonth = sketches.filter(s => (s.createdAt ?? "").slice(0, 7) === thisMonth).length;
  const updatedThisMonth = sketches.filter(s => (s.updatedAt ?? "").slice(0, 7) === thisMonth).length;
  const kpis: { label: string; short: string; value: string | number; icon: React.ReactNode }[] = [
    { label: "סה״כ סקיצות", short: "סקיצות", value: ready ? sketches.length : "—", icon: <IcMusicNote size={22} color="#FF6B6B" /> },
    { label: "סה״כ גרסאות", short: "גרסאות", value: ready ? totalVersions : "—", icon: <IcUpload size={20} color="#FF6B6B" /> },
    { label: "נוצרו החודש", short: "נוצרו", value: ready ? createdThisMonth : "—", icon: <IcEdit size={20} color="#FF6B6B" /> },
    { label: "עודכנו החודש", short: "עודכנו", value: ready ? updatedThisMonth : "—", icon: <IcClock size={20} color="#FF6B6B" /> },
  ];

  // The name column is ONE cell holding ONE inner flex — [grip][play][name] —
  // with a single tight, uniform gap so the three lock onto the same line and
  // read as one unit. LEAD_W is the exact grip+play+gaps width; the header reuses
  // it as a spacer so "שם הפרויקט" sits precisely over the project name.
  const GRIP_W = 20;   // fixed drag-handle box width (desktop)
  const PLAY_W = 40;   // SketchRowPlay button size
  const UNIT_GAP = 10; // tight, uniform gap between grip · play · name
  // Header spacer = the exact leading width of the name unit (no grip for shalev).
  const LEAD_W = (showHandle ? GRIP_W + UNIT_GAP : 0) + PLAY_W + UNIT_GAP;
  // שם הפרויקט (unit) · [גרסה] · [עודכן] · משך. Shalev drops both גרסה and עודכן.
  const cols = [
    "minmax(0, 1.9fr)",
    ...(showVersion ? ["84px"] : []),
    ...(showDate ? ["120px"] : []),
    "72px",
  ].join(" ");
  const heads: { label: string; align: "start" | "center" }[] = [
    { label: "שם הפרויקט", align: "start" },
    ...(showVersion ? [{ label: "גרסה", align: "center" as const }] : []),
    ...(showDate ? [{ label: "עודכן", align: "center" as const }] : []),
    { label: "משך", align: "center" },
  ];

  const openEdit = (s: Sketch) => setEditing(s);

  // Drag handle — the ONLY drag affordance (so page scroll and row-tap stay
  // intact on touch). Never opens the edit modal; `touchAction:none` lets it own
  // the gesture without the browser scrolling the page mid-drag.
  const dragHandle = (s: Sketch) => (
    <div role="button" tabIndex={-1} aria-label="גרור לשינוי סדר השירים"
      onClick={e => e.stopPropagation()}
      onPointerDown={e => onHandleDown(e, s.id)}
      onPointerMove={onHandleMove}
      onPointerUp={onHandleUp}
      onPointerCancel={onHandleUp}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "stretch", flexShrink: 0,
        width: isMobile ? 30 : GRIP_W, minWidth: isMobile ? 30 : GRIP_W,
        touchAction: "none", padding: 0,
        cursor: savingOrder ? "default" : (draggingId === s.id ? "grabbing" : "grab"),
        opacity: savingOrder && draggingId !== s.id ? 0.4 : 1,
      }}>
      <IcGrip size={isMobile ? 18 : 16} color={draggingId === s.id ? "#FF6B6B" : MUTED} />
    </div>
  );
  // Visual state for the row currently being dragged.
  const dragRowStyle = (s: Sketch): React.CSSProperties => draggingId === s.id
    ? { background: "rgba(220,38,38,0.10)", borderColor: "rgba(220,38,38,0.45)", boxShadow: "0 6px 18px rgba(0,0,0,0.35)" }
    : {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── KPI row ── */}
      {isMobile ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {kpis.map(k => (
            <div key={k.label} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, borderRadius: 12, padding: "10px 6px", textAlign: "center", minWidth: 0 }}>
              <div style={{ fontSize: 21, fontWeight: 900, color: TEXT, lineHeight: 1.1 }}>{k.value}</div>
              <div style={{ fontSize: 10.5, color: TEXT2, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.short}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rap-kpi">
          {kpis.map(k => (
            <div key={k.label} style={{ ...panel, padding: "22px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12.5, color: TEXT2, fontWeight: 600 }}>{k.label}</div>
                <div style={{ fontSize: 34, fontWeight: 900, color: TEXT, marginTop: 5 }}>{k.value}</div>
              </div>
              <span style={{ width: 50, height: 50, borderRadius: 14, flexShrink: 0, background: "rgba(220,38,38,0.13)", border: `1px solid ${BRAND}44`, display: "flex", alignItems: "center", justifyContent: "center" }}>{k.icon}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── library ── */}
      <div style={panel}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: isMobile ? "16px 16px" : "18px 24px", borderBottom: `1px solid ${BDR}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
            <span style={{ fontSize: isMobile ? 15.5 : 17.5, fontWeight: 800, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>הספרייה שלי</span>
            {savingOrder && <span style={{ fontSize: 11.5, color: MUTED, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>שומר…</span>}
          </div>
          <button onClick={() => setCreateOpen(true)} style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0,
            padding: isMobile ? "8px 12px" : "8px 15px", borderRadius: 9, border: "none", color: "#fff",
            background: "linear-gradient(180deg, #E5322F, #C01C1C)", fontSize: isMobile ? 12 : 12.5, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", boxShadow: `0 2px 9px rgba(220,38,38,0.26)`,
          }}><IcUpload size={14} /> העלאת קובץ</button>
        </div>

        {!isMobile && loadState === "ready" && sketches.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "13px 24px", borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.015)" }}>
            {heads.map((h, i) => {
              const label = <span style={{ fontSize: 12, fontWeight: 800, color: "#9A9AA6", letterSpacing: "0.05em", textTransform: "uppercase" }}>{h.label}</span>;
              // The name header carries the same grip+play offset as the row so
              // "שם הפרויקט" lands exactly above the project name (not the grip).
              if (i === 0) return (
                <div key={i} style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                  <span aria-hidden style={{ width: LEAD_W, flexShrink: 0 }} />
                  {label}
                </div>
              );
              return <div key={i} style={{ textAlign: h.align }}>{label}</div>;
            })}
          </div>
        )}

        <div style={{ padding: isMobile ? "2px 0 6px" : "6px 0 8px" }}>
          {loadState === "loading" ? (
            <div style={{ padding: "10px 0" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 24px" }}>
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
                  <div style={{ flex: 1, height: 14, borderRadius: 7, background: "rgba(255,255,255,0.05)" }} />
                </div>
              ))}
            </div>
          ) : loadState === "error" ? (
            <div style={{ padding: "44px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 13.5, color: MUTED, marginBottom: 14 }}>לא ניתן לטעון את הספרייה כרגע</div>
              <button onClick={() => void onReload()} style={{ ...linkBtn, fontSize: 13, fontWeight: 800, border: `1px solid ${BDR2}`, borderRadius: 10, padding: "8px 18px" }}>נסה שוב</button>
            </div>
          ) : sketches.length === 0 ? (
            <div style={{ padding: isMobile ? "40px 20px" : "56px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <span style={{ width: 66, height: 66, borderRadius: 20, background: "rgba(220,38,38,0.10)", border: `1px solid ${BRAND}33`, display: "flex", alignItems: "center", justifyContent: "center" }}><IcMusicNote size={30} color="#FF6B6B" /></span>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>אין עדיין סקיצות בספרייה</div>
                <div style={{ fontSize: 13, color: TEXT2, marginTop: 6, lineHeight: 1.6, maxWidth: 340 }}>העלה את הסקיצה הראשונה שלך — קובץ אודיו, שם וכמה מילים, והיא תופיע כאן עם כל הגרסאות.</div>
              </div>
              <button onClick={() => setCreateOpen(true)} style={{
                display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 22px", borderRadius: 12, border: "none",
                color: "#fff", background: "linear-gradient(180deg, #E5322F, #C01C1C)", fontSize: 14, fontWeight: 800,
                cursor: "pointer", fontFamily: "inherit", boxShadow: `0 5px 18px rgba(220,38,38,0.32)`,
              }}><IcUpload size={16} /> העלאת קובץ ראשון</button>
            </div>
          ) : isMobile ? (
            displayRows.map(s => (
              <div key={s.id} ref={el => setRowRef(s.id, el)} role="button" tabIndex={0} aria-label={`עריכת הסקיצה ${s.title}`}
                onClick={() => openEdit(s)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEdit(s); } }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", border: "1px solid transparent", borderBottomColor: BDR, cursor: "pointer", outline: "none", transition: "background .14s", ...dragRowStyle(s) }}>
                {showHandle && dragHandle(s)}
                <div onClick={e => e.stopPropagation()} style={{ display: "flex" }}>
                  <SketchRowPlay size={42} player={player} sketch={s} onError={setToast} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                  {(showVersion || showDate) && (
                    <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                      {showVersion && <span style={{ direction: "ltr" }}>V{s.latestVersion}</span>}
                      {showVersion && showDate && <span>·</span>}
                      {showDate && <span>{fmtSketchDate(s.updatedAt)}</span>}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 12, color: "#CFCFD6", direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace", flexShrink: 0 }}>{s.durationSeconds != null ? mmss(s.durationSeconds) : "—"}</span>
              </div>
            ))
          ) : (
            displayRows.map(s => (
              <div key={s.id} ref={el => setRowRef(s.id, el)} role="button" tabIndex={0} aria-label={`עריכת הסקיצה ${s.title}`}
                onClick={() => openEdit(s)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEdit(s); } }}
                onMouseEnter={e => draggingId ? undefined : rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "15px 24px", border: "1px solid transparent", cursor: "pointer", outline: "none", transition: "all .14s", ...dragRowStyle(s) }}>
                {/* ONE cell → ONE inner flex: [grip][play][name] locked to one line
                    (grip hidden for shalev — reorder is owner-only) */}
                <div style={{ display: "flex", alignItems: "center", gap: UNIT_GAP, minWidth: 0 }}>
                  {showHandle && dragHandle(s)}
                  <div onClick={e => e.stopPropagation()} style={{ display: "flex", flexShrink: 0 }}>
                    <SketchRowPlay size={PLAY_W} player={player} sketch={s} onError={setToast} />
                  </div>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: "#FFFFFF", lineHeight: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                </div>
                {showVersion && <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 800, color: "#FF6B6B", direction: "ltr" }}>V{s.latestVersion}</div>}
                {showDate && <div style={{ textAlign: "center", fontSize: 12.5, color: "#CFCFD6" }}>{fmtSketchDate(s.updatedAt)}</div>}
                <div style={{ fontSize: 12.5, color: "#CFCFD6", direction: "ltr", textAlign: "center", fontFamily: "ui-monospace, Menlo, monospace" }}>{s.durationSeconds != null ? mmss(s.durationSeconds) : "—"}</div>
              </div>
            ))
          )}
        </div>
        {loadState === "ready" && sketches.length > 0 && (
          hasMore ? (
            <button onClick={showMore} style={{ ...linkBtn, display: "block", width: "100%", textAlign: "center", padding: "14px 0", fontWeight: 700, borderTop: `1px solid ${BDR}` }}>הצג עוד</button>
          ) : sketches.length > 6 ? (
            <div style={{ textAlign: "center", padding: "14px 0", fontSize: 12.5, color: MUTED, borderTop: `1px solid ${BDR}` }}>הוצגו כל הסקיצות</div>
          ) : null
        )}
      </div>

      {createOpen && <SketchCreateModal
        onClose={() => setCreateOpen(false)}
        onCreated={async (s) => { await onReload(); setToast(`הסקיצה "${s.title}" נוצרה`); }}
      />}
      {editing && <SketchEditModal
        sketch={editing} player={player}
        onClose={() => setEditing(null)}
        onReload={onReload} onToast={setToast}
      />}

      {toast && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", zIndex: 100040,
          background: "#1A1C22", border: `1px solid ${BDR2}`, color: TEXT, fontSize: 13, fontWeight: 700,
          padding: "11px 20px", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.6)", fontFamily: "'Heebo', Arial, sans-serif", maxWidth: "90vw", textAlign: "center",
        }}>{toast}</div>,
        document.body,
      )}
    </div>
  );
}

// Plain icon-button style for the player controls.
const pbtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", padding: 4,
  display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", flexShrink: 0,
};

// ── Next-release card (real data) ────────────────────────────────────────────────
// Countdown returns null until mounted → server + first client render match (no
// hydration mismatch); the interval only runs on the client and is cleared on unmount.
type Countdown = { days: number; hours: number; minutes: number; seconds: number; done: boolean };
function useCountdown(targetMs: number): Countdown | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  if (now === null) return null;
  const diff = Math.max(0, targetMs - now);
  const s = Math.floor(diff / 1000);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    done: diff <= 0,
  };
}
// Release date has no time in the data → count down to LOCAL midnight of that day.
function releaseTargetMs(ymd: string): number {
  const t = new Date(`${ymd.slice(0, 10)}T00:00:00`).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

// Square cover placeholder (no cover field in the model) with a disc peeking out
// behind it toward the card centre. Premium Redbloods look; never a broken image.
function ReleaseArtwork({ title, size }: { title: string; size: number }) {
  const disc = Math.round(size * 0.92);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }} role="img" aria-label={`עטיפת הריליס ${title}`}>
      {/* disc — behind, peeking out on the physical-right (toward the card centre in RTL) */}
      <div style={{
        position: "absolute", top: "50%", right: -Math.round(size * 0.30), transform: "translateY(-50%)",
        width: disc, height: disc, borderRadius: "50%", zIndex: 0,
        background: "radial-gradient(circle at 50% 50%, #E5322F 0%, #7c1a1a 5%, #1a1a1e 13%, #0c0c0f 58%, #050506 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: "0 12px 30px rgba(0,0,0,0.6), inset 0 0 22px rgba(0,0,0,0.55)",
      }}>
        <div style={{ position: "absolute", inset: "34%", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.06)" }} />
        <div style={{ position: "absolute", top: "50%", left: "50%", width: 7, height: 7, borderRadius: "50%", transform: "translate(-50%,-50%)", background: "#E5322F", boxShadow: "0 0 10px rgba(220,38,38,0.8)" }} />
      </div>
      {/* cover — in front */}
      <div style={{
        position: "relative", zIndex: 1, width: size, height: size, borderRadius: 14, overflow: "hidden",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 10, boxSizing: "border-box",
        background: "radial-gradient(120% 120% at 28% 18%, rgba(220,38,38,0.38) 0%, rgba(220,38,38,0.06) 44%, #100c0d 74%), linear-gradient(160deg, #1c1416 0%, #0b0a0b 100%)",
        border: "1px solid rgba(220,38,38,0.4)", boxShadow: "0 14px 34px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}>
        <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.18em", color: "rgba(255,107,107,0.85)" }}>REDBLOODS</div>
        <div style={{ fontSize: size >= 110 ? 17 : 14, fontWeight: 900, color: "#fff", textAlign: "center", lineHeight: 1.15, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{title}</div>
      </div>
    </div>
  );
}

function TimerBox({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, borderRadius: 12, padding: "10px 4px", textAlign: "center", minWidth: 0 }}>
      <div style={{ fontSize: 24, fontWeight: 900, color: "#fff", lineHeight: 1.05, direction: "ltr", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 10.5, color: TEXT2, marginTop: 4, whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

const releaseCardShell: React.CSSProperties = {
  position: "relative", overflow: "hidden", borderRadius: 22,
  border: "1px solid rgba(220,38,38,0.45)",
  background: "radial-gradient(90% 150% at 12% 18%, rgba(220,38,38,0.30) 0%, rgba(220,38,38,0.05) 42%, transparent 68%), linear-gradient(160deg, #1a1314 0%, #0c0a0b 100%)",
  boxShadow: "0 0 60px rgba(220,38,38,0.12), 0 22px 52px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
};
function ReleaseHeading() {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
      <span style={{ fontSize: 12.5, fontWeight: 800, color: "#FF6B6B", letterSpacing: "0.02em" }}>הריליס הבא</span>
    </div>
  );
}
function releaseBtnStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, flexShrink: 0,
    padding: isMobile ? "13px 20px" : "12px 20px", width: isMobile ? "100%" : "auto",
    borderRadius: 13, cursor: "pointer", fontFamily: "inherit", fontSize: 13.5, fontWeight: 800, whiteSpace: "nowrap",
    color: "#FF8A8A", background: "rgba(220,38,38,0.10)", border: "1px solid rgba(220,38,38,0.45)", transition: "all .15s",
  };
}

function NextReleaseCard({ release, sketches, onReload, canEdit = true }: {
  release: PortalRelease | null; sketches: Sketch[]; onReload: () => Promise<void>; canEdit?: boolean;
}) {
  const isMobile = useIsMobile();
  const [modalOpen, setModalOpen] = useState(false);
  const cd = useCountdown(release ? releaseTargetMs(release.releaseDate) : 0);
  const pad = (n: number) => String(n).padStart(2, "0");

  // Editing the release is OWNER-ONLY (route POST is requireOwner). For the shalev
  // role the button is not rendered AND the modal is never mounted, so there is no
  // handler/DOM path to open or update it — the card stays read-only.
  const DetailsBtn = ({ label }: { label: string }) => canEdit ? (
    <button
      onClick={() => setModalOpen(true)} style={releaseBtnStyle(isMobile)}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(220,38,38,0.18)"; e.currentTarget.style.borderColor = "rgba(220,38,38,0.7)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.10)"; e.currentTarget.style.borderColor = "rgba(220,38,38,0.45)"; }}
      onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
      onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
    >{label} <IcChevron size={15} /></button>
  ) : null;

  const modal = canEdit && modalOpen && (
    <NextReleaseModal current={release} sketches={sketches} onClose={() => setModalOpen(false)} onSaved={onReload} />
  );

  // Unset → compact prompt so the release can still be set from the home page.
  if (!release) {
    return (
      <>
        <div style={{ ...releaseCardShell, padding: isMobile ? "18px 18px" : "20px 26px", display: "flex", flexDirection: isMobile ? "column" : "row", gap: 14, alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <ReleaseHeading />
            <div style={{ fontSize: isMobile ? 17 : 19, fontWeight: 800, color: "#fff" }}>עדיין לא הוגדר ריליס הבא</div>
            <div style={{ fontSize: 12.5, color: TEXT2, marginTop: 5 }}>בחר סקיצה וקבע תאריך הוצאה</div>
          </div>
          <DetailsBtn label="הגדרת ריליס" />
        </div>
        {modal}
      </>
    );
  }

  const units: { value: string; label: string }[] = cd
    ? [
        { value: pad(cd.days), label: "ימים" }, { value: pad(cd.hours), label: "שעות" },
        { value: pad(cd.minutes), label: "דקות" }, { value: pad(cd.seconds), label: "שניות" },
      ]
    : [
        { value: "—", label: "ימים" }, { value: "—", label: "שעות" },
        { value: "—", label: "דקות" }, { value: "—", label: "שניות" },
      ];

  return (
    <>
      <div style={{
        ...releaseCardShell, padding: isMobile ? "20px 18px" : "24px 26px",
        display: "flex", gap: isMobile ? 18 : 26, flexDirection: isMobile ? "column" : "row-reverse", alignItems: "center",
      }}>
        {/* left (RTL row-reverse): artwork + disc · mobile: top */}
        <ReleaseArtwork title={release.title} size={isMobile ? 116 : 124} />

        {/* centre: label · title · date · timer */}
        <div style={{ flex: 1, minWidth: 0, textAlign: isMobile ? "center" : "start", width: isMobile ? "100%" : undefined }}>
          <ReleaseHeading />
          <div style={{ fontSize: isMobile ? 26 : 30, fontWeight: 900, color: "#fff", lineHeight: 1.1, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{release.title}</div>
          <div style={{ fontSize: 13, color: TEXT2, marginTop: 7, marginBottom: 14 }}>יוצא ב־{fmtSketchDate(release.releaseDate)}</div>

          {cd?.done ? (
            // The release day arrived. NOT "released" — the date passing just means "today".
            <div style={{ display: "inline-block", fontSize: 15, fontWeight: 800, color: "#FF6B6B", background: "rgba(220,38,38,0.10)", border: "1px solid rgba(220,38,38,0.4)", borderRadius: 12, padding: "12px 20px" }}>הריליס יוצא היום</div>
          ) : (
            // direction:ltr → days→hours→minutes→seconds read left→right (days on the
            // left, seconds on the right) inside the RTL card; Hebrew labels unaffected.
            <div style={{ direction: "ltr", display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, maxWidth: isMobile ? "100%" : 420 }}>
              {units.map(u => <TimerBox key={u.label} value={u.value} label={u.label} />)}
            </div>
          )}
        </div>

        {/* right (RTL row-reverse): details button · mobile: full-width bottom */}
        <DetailsBtn label="לפרטי הריליס" />
      </div>
      {modal}
    </>
  );
}

// Modal: choose one of the artist's OWN sketches (manifest, not Projects) + a
// release date → POST /api/red-artists/next-release. Saves to the manifest.
function NextReleaseModal({ current, sketches, onClose, onSaved }: {
  current: PortalRelease | null; sketches: Sketch[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [sketchId, setSketchId] = useState(current?.sketchId ?? sketches[0]?.id ?? "");
  const [date, setDate] = useState(current?.releaseDate ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const canSave = !!sketchId && validDate && !saving && sketches.length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/red-artists/next-release", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sketchId, releaseDate: date }),
      });
      if (!res.ok) { setErr(await readErr(res, "שמירת הריליס נכשלה")); setSaving(false); return; }
      await onSaved();
      onClose();
    } catch { setErr("שגיאת רשת, נסה שוב"); setSaving(false); }
  };

  return (
    <SketchModalShell title="פרטי הריליס הבא" onClose={onClose} busy={saving}>
      <SkErr msg={err} />
      {sketches.length === 0 ? (
        <div style={{ fontSize: 13.5, color: TEXT2, lineHeight: 1.7, textAlign: "center", padding: "18px 8px" }}>
          אין עדיין סקיצות בספרייה.<br />הוסף סקיצה ב״המוזיקה שלי״ ואז ניתן להגדיר ריליס.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={skLabel}>בחר סקיצה</label>
            <select className="rap-select" value={sketchId} onChange={e => setSketchId(e.target.value)} disabled={saving}
              style={{ ...skField, cursor: "pointer", appearance: "auto", opacity: saving ? 0.6 : 1 }}>
              {sketches.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={skLabel}>תאריך הוצאה</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={saving}
              style={{ ...skField, colorScheme: "dark", opacity: saving ? 0.6 : 1 }} />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={save} disabled={!canSave} style={{ ...skPrimaryBtn(canSave), flex: "1 1 150px", width: "auto" }}>{saving ? "שומר…" : "שמור ריליס"}</button>
            <button onClick={onClose} disabled={saving} style={{
              flex: "1 1 110px", padding: "14px 0", borderRadius: 12, border: `1px solid ${BDR2}`, background: "transparent",
              color: TEXT2, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: saving ? "default" : "pointer",
            }}>ביטול</button>
          </div>
        </>
      )}
    </SketchModalShell>
  );
}

// ── Home dashboard ───────────────────────────────────────────────────────────────
function HomeDashboard({ onOpenMusic, sketches, loadState, summary, summaryState, nextRelease, onReloadNextRelease, nextWork, onReloadNextWork, hideBalance, isShalev, ledger, ledgerState }: { onOpenMusic: () => void; sketches: Sketch[]; loadState: LoadState; summary: ShalevSummary | null; summaryState: LoadState; nextRelease: PortalRelease | null; onReloadNextRelease: () => Promise<void>; nextWork: PortalWork | null; onReloadNextWork: () => Promise<void>; hideBalance?: boolean; isShalev?: boolean; ledger: BalanceLedger | null; ledgerState: LoadState }) {
  const [workPickerOpen, setWorkPickerOpen] = useState(false);
  const isMobile = useIsMobile();
  const player = usePlayerSafe();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── הריליס הבא — manifest pointer; full card when set, "set it" prompt when not ── */}
      <NextReleaseCard release={nextRelease} sketches={sketches} onReload={onReloadNextRelease} canEdit={!isShalev} />

      {/* ── "מה מחכה לך עכשיו" ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>מה מחכה לך עכשיו</span>
        </div>
        <div className="rap-acts">
          {/* סשן קרוב — the artist's next real session (weekly, excluding shows). */}
          {(() => {
            const sess = (summary?.weekly ?? []).find(w => w.type !== "הופעה");
            return sess ? (
              <ActionCard icon="📅" title="סשן קרוב" body={sess.title} sub={[fmtShowDate(sess.date), sess.startTime].filter(Boolean).join(" · ")} />
            ) : (
              <ActionCard icon="📅" title="סשן קרוב" body={summaryState === "loading" ? "טוען…" : "אין סשן קרוב כרגע"} />
            );
          })()}
          {/* הפרויקט הבא לעבודה — OWNER-chosen (manifest), NEVER derived from nextRelease. */}
          <NextWorkCard
            sketch={nextWork ? sketches.find(s => s.id === nextWork.sketchId) ?? null : null}
            hasSelection={!!nextWork}
            deadline={nextWork?.deadline ?? null}
            player={player}
            onOpenMusic={onOpenMusic}
            canEdit={!isShalev}
            onEdit={() => setWorkPickerOpen(true)}
            loading={loadState === "loading"}
          />
        </div>
      </div>

      {workPickerOpen && !isShalev && (
        <NextWorkModal
          sketches={sketches}
          current={nextWork}
          onClose={() => setWorkPickerOpen(false)}
          onSaved={async () => { await onReloadNextWork(); setWorkPickerOpen(false); }}
        />
      )}

      {/* ── 3. Main grid (row A) — music-forward in RTL: המוזיקה שלי (right) → ביטים → מאזן ── */}
      <div className="rap-grid-a">

        {/* המוזיקה שלי — up to 4 of the artist's own sketches (manifest source) */}
        <SectionCard title="המוזיקה שלי">
          <div style={{ padding: "8px 12px 6px" }}>
            {loadState === "loading" ? (
              <div style={{ padding: "22px 8px", textAlign: "center", fontSize: 12.5, color: MUTED }}>טוען…</div>
            ) : sketches.length === 0 ? (
              <div style={{ padding: "22px 8px", textAlign: "center", fontSize: 12.5, color: MUTED }}>עדיין אין סקיצות בספרייה</div>
            ) : (
              sketches.slice(0, 4).map(s => (
                <div key={s.id} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 12px", borderRadius: 13, border: "1px solid transparent", transition: "all .14s" }}>
                  <SketchRowPlay size={36} player={player} sketch={s} />
                  <div style={{ textAlign: "start", minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                    {/* version + date — hidden for shalev (no leftover separators) */}
                    {!isShalev && (
                    <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ direction: "ltr" }}>V{s.latestVersion}</span><span>·</span><span>{fmtSketchDate(s.updatedAt)}</span>
                    </div>
                    )}
                  </div>
                  <div style={{ marginInlineStart: "auto", fontSize: 11.5, color: MUTED, direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace" }}>{s.durationSeconds != null ? mmss(s.durationSeconds) : ""}</div>
                </div>
              ))
            )}
            <button onClick={onOpenMusic} style={{ ...linkBtn, display: "block", width: "100%", textAlign: "start", padding: "10px 4px 6px" }}>לכל הסקיצות ←</button>
          </div>
        </SectionCard>

        {/* מאזן — OWNER-ONLY mini summary from the manual ledger (same source as the
            balance tab). Hidden for the shalev role; the ledger is never fetched for him. */}
        {!hideBalance && (
        <SectionCard title="מאזן">
          <div style={{ padding: "14px 18px 18px" }}>
            {ledgerState !== "ready" || !ledger ? (
              <div style={{ padding: "18px 4px", fontSize: 12.5, color: MUTED, textAlign: "center" }}>
                {ledgerState === "loading" ? "טוען…" : ledgerState === "error" ? "לא ניתן לטעון כרגע" : "אין עדיין נתונים כספיים"}
              </div>
            ) : (
              <>
                <BalanceRow label="הכנסות" value={fmtMoney(ledger.totals.income, "₪")} color={GREEN} icon="↑" />
                <BalanceRow label="תשלומים" value={fmtMoney(ledger.totals.payments, "₪")} color={TEXT} icon="↓" />
                {/* Net balance = paid − expenses-paid — highlighted */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 12,
                  padding: "13px 14px", borderRadius: 13,
                  background: "linear-gradient(180deg, rgba(220,38,38,0.12), rgba(220,38,38,0.04))",
                  border: `1px solid ${BRAND}44`,
                }}>
                  <span style={{ fontSize: 13, color: "#E8B7B7", fontWeight: 700 }}>מאזן נוכחי</span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: "#FF6B6B", direction: "ltr" }}>{fmtMoney(ledger.totals.currentBalance, "₪")}</span>
                </div>
              </>
            )}
          </div>
        </SectionCard>
        )}
      </div>

      {/* ── 3. Weekly calendar — REAL data, SAME source as the לו״ז tab (summary.weekly) ── */}
      <SchedSection title="יומן השבוע" subtitle="כל מה שכבר נקבע לך השבוע">
        {summaryState === "loading" ? <SchedEmpty text="טוען…" />
          : summaryState === "error" ? <SchedEmpty text="לא ניתן לטעון כרגע" />
          : (summary?.weekly?.length ?? 0) === 0 ? <SchedEmpty text="אין אירועים מתוכננים השבוע" />
          : <WeeklyList items={summary!.weekly} />}
      </SchedSection>

      {/* ── 4. עדכונים מהלייבל — REAL data (summary.updates) ── */}
      <SchedSection title="עדכונים מהלייבל">
        {summaryState === "loading" ? <SchedEmpty text="טוען…" />
          : summaryState === "error" ? <SchedEmpty text="לא ניתן לטעון כרגע" />
          : (summary?.updates?.length ?? 0) === 0 ? <SchedEmpty text="עדיין אין עדכונים חדשים" />
          : <UpdatesList items={summary!.updates} />}
      </SchedSection>

      {/* ── shalev on mobile — his "האזור שלי" + "יציאה" live here (a tidy page-end
          area) instead of a fixed bottom bar. Owner/desktop keep their own nav. ── */}
      {isMobile && isShalev && (
        <div style={{ display: "flex", gap: 12, marginTop: 6, paddingTop: 18, borderTop: `1px solid ${BDR}` }}>
          <a href="/red-artists" style={{
            flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "14px 0", borderRadius: 12, textDecoration: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 800,
            color: TEXT, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`,
          }}><span style={{ color: "#FF6B6B", fontSize: 16, lineHeight: 1 }}>♫</span> האזור שלי</a>
          <button onClick={signOutAndRedirect} style={{
            flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "14px 0", borderRadius: 12, border: "1px solid rgba(220,38,38,0.35)", cursor: "pointer",
            fontFamily: "inherit", fontSize: 14, fontWeight: 800, color: "#EF4444", background: "rgba(220,38,38,0.10)",
          }}><span style={{ fontSize: 15, lineHeight: 1 }}>🚪</span> יציאה</button>
        </div>
      )}
    </div>
  );
}

// ── Artist avatar — shows initial "ש" or an uploaded profile image ────────────────
//    Upload goes to an isolated Dropbox folder via /api/red-artists/profile-image.
//    The chosen path is remembered in localStorage (demo persistence — no DB).
const AVATAR_KEY  = "rb_artist_avatar_path_shalev";
const AVATAR_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
// Real ceiling = Dropbox single-request upload (150MB), matching the route. The
// old 5MB cap was an arbitrary UI block that rejected ordinary phone photos.
const AVATAR_MAX_BYTES = 150 * 1024 * 1024;
const AVATAR_MAX_LABEL = "150MB";

type XhrResult = { ok: boolean; status: number; reason?: "network" | "timeout" | "abort"; data: { ok?: boolean; error?: string; path?: string } };
// XMLHttpRequest (not fetch) so we get REAL upload progress in the browser. No
// dependency added. Always resolves — never rejects — so the caller can't hang.
function xhrUploadAvatar(fd: FormData, onProgress: (pct: number) => void): Promise<XhrResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/red-artists/profile-image");
    xhr.timeout = 300000; // 5 min — a large original on a slow link
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100))); };
    xhr.onload = () => {
      let data: XhrResult["data"] = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON body */ }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300 && data?.ok !== false, status: xhr.status, data });
    };
    xhr.onerror   = () => resolve({ ok: false, status: 0, reason: "network", data: {} });
    xhr.ontimeout = () => resolve({ ok: false, status: 0, reason: "timeout", data: {} });
    xhr.onabort   = () => resolve({ ok: false, status: 0, reason: "abort", data: {} });
    xhr.send(fd);
  });
}
// Map an upload result → a safe Hebrew message (never a raw 500 body — it can
// contain a Dropbox path). Known 4xx messages from the route are safe to show.
function avatarUploadError(r: XhrResult): string {
  if (r.reason === "timeout" || r.reason === "abort" || r.reason === "network" || r.status === 0) return "החיבור נקטע במהלך ההעלאה";
  if (r.status === 415) return r.data.error || "הקובץ אינו תמונה תקינה";
  if (r.status === 413) return r.data.error || `הקובץ גדול מהמגבלה שהשרת מאפשר (מקסימום ${AVATAR_MAX_LABEL})`;
  if (r.status === 400) return r.data.error || "העלאת התמונה נכשלה. נסה שוב";
  return "העלאת התמונה נכשלה. נסה שוב"; // 500 etc. — generic, no internals
}
// Deterministic path the endpoint writes the cropped avatar to (editor exports
// JPEG). Used as a cross-device fallback so ANY browser loads the same image
// even without a localStorage entry; a 404 just falls back to the "ש" initial.
const AVATAR_PATH = "/app/red-artists/shalev-tasama/profile-image/avatar.jpg";
// Session-level cache so the avatar survives remounts / tab-switches without
// flashing back to "ש" or refetching. Seeded with the deterministic path so the
// FIRST render already has a src (no null→"ש" flash). Updated on upload / 404.
let avatarPathCache: string | null = AVATAR_PATH;
let avatarVerCache = 0;                            // 0 = stable URL; only bumped after a successful upload

// Last crop-editor state (zoom + pan) for the avatar — remembered so reopening
// the editor on the SAME image starts where the user left off, not from scratch.
// This is METADATA ONLY (localStorage, no DB); it never replaces the image itself.
const AVATAR_EDIT_KEY = "red-artists:shalev-tasama:profile-image-editor";
type AvatarEdit = { zoom: number; position: { x: number; y: number } };
function loadAvatarEdit(): AvatarEdit | null {
  try {
    const raw = localStorage.getItem(AVATAR_EDIT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as AvatarEdit;
    if (typeof v?.zoom === "number" && typeof v?.position?.x === "number" && typeof v?.position?.y === "number") return v;
  } catch { /* ignore */ }
  return null;
}
function saveAvatarEdit(zoom: number, offset: { x: number; y: number }) {
  try { localStorage.setItem(AVATAR_EDIT_KEY, JSON.stringify({ zoom, position: offset })); } catch { /* ignore */ }
}
function clearAvatarEdit() {
  try { localStorage.removeItem(AVATAR_EDIT_KEY); } catch { /* ignore */ }
}

// What the editor hands back on save: the crop params for the exported avatar,
// plus (only for a freshly picked image) the untouched original File to store in
// Dropbox as the re-editing source. Re-crop of an existing image → originalFile null.
type SaveMeta = { zoom: number; offset: { x: number; y: number }; originalFile: File | null; originalFileName: string | null };

function ArtistAvatar({ canEdit = false }: { canEdit?: boolean }) {
  const [path, setPath]   = useState<string | null>(avatarPathCache);
  const [ver, setVer]     = useState(avatarVerCache); // cache-bust after re-upload (overwrites same path)
  const [hover, setHover] = useState(false);
  const [busy, setBusy]   = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Crop editor is opened BEFORE anything is uploaded. { url } = edit the existing
  // image · { file } = a freshly picked file to crop. null = closed.
  const [editing, setEditing] = useState<{ file?: File; url?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Pick up a stored path once (client only) and keep the module cache in sync.
    // NO cache-bust here — the URL stays stable across mounts so the browser can
    // reuse the image and we never flash back to "ש" on a tab switch / refresh.
    try {
      const p = localStorage.getItem(AVATAR_KEY);
      if (p && p !== avatarPathCache) { avatarPathCache = p; setPath(p); }
    } catch { /* ignore */ }
  }, []);

  // Editing is only allowed from the home tab. If the tab changes while the
  // editor is open (canEdit → false), close it so it can't linger elsewhere.
  useEffect(() => { if (!canEdit) setEditing(null); }, [canEdit]);

  function notify(m: string) { setToast(m); setTimeout(() => setToast(null), 2600); }

  // Picking a file no longer uploads immediately — it opens the crop editor.
  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!AVATAR_MIME.includes(file.type)) { notify("הקובץ אינו תמונה תקינה"); return; }
    if (file.size > AVATAR_MAX_BYTES)     { notify(`הקובץ גדול מהמגבלה שהשרת מאפשר (מקסימום ${AVATAR_MAX_LABEL})`); return; }
    // New image → its own crop (defaults). The untouched original is uploaded to
    // Dropbox on save, so a later re-open (any device) edits the true source.
    clearAvatarEdit();
    setEditing({ file });
  }

  // Upload the cropped blob (from the editor's "שמירה") via XHR so the editor can
  // show REAL upload progress. Returns { ok, error? } — a failure never throws and
  // never mutates the current avatar; the editor keeps the crop/file for a retry.
  async function doUpload(blob: Blob, meta: SaveMeta, onProgress: (pct: number) => void): Promise<{ ok: boolean; error?: string }> {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("avatar", blob, "avatar.jpg");
      fd.append("zoom", String(meta.zoom));
      fd.append("posX", String(meta.offset.x));
      fd.append("posY", String(meta.offset.y));
      // Only a freshly picked/replaced image ships the original (server keeps the
      // existing original on a plain re-crop).
      if (meta.originalFile) {
        fd.append("original", meta.originalFile, meta.originalFileName ?? meta.originalFile.name);
        if (meta.originalFileName) fd.append("originalFileName", meta.originalFileName);
      }
      const res = await xhrUploadAvatar(fd, onProgress);
      if (!res.ok) return { ok: false, error: avatarUploadError(res) };
      const p = res.data.path as string;
      avatarPathCache = p;
      avatarVerCache  = Date.now();              // bump only on success → forces the overwritten image to reload
      try { localStorage.setItem(AVATAR_KEY, p); } catch { /* ignore */ }
      setPath(p);
      setVer(avatarVerCache);
      notify("תמונת הפרופיל עודכנה בהצלחה");
      return { ok: true };
    } finally {
      setBusy(false);
    }
  }

  const src = path ? `/api/red-artists/stream?path=${encodeURIComponent(path)}${ver ? `&t=${ver}` : ""}` : null;

  // NOTE: the editor + toast are portaled AND rendered as SIBLINGS of the
  // clickable avatar (not children) — otherwise their clicks bubble through the
  // React tree to the avatar's onClick and immediately re-open the editor,
  // which made X / ביטול / שמירה appear dead.
  return (
    <>
      <div
        onClick={canEdit ? () => { if (busy) return; if (path && src) setEditing({ url: src }); else inputRef.current?.click(); } : undefined}
        onMouseEnter={canEdit ? () => setHover(true) : undefined}
        onMouseLeave={canEdit ? () => setHover(false) : undefined}
        title={canEdit ? "עריכת תמונה" : undefined}
        style={{
          padding: 3, borderRadius: "50%", flexShrink: 0, position: "relative", cursor: canEdit ? (busy ? "wait" : "pointer") : "default",
          background: `conic-gradient(from 150deg, ${BRAND}, #7A1414, ${BRAND}, #7A1414, ${BRAND})`,
          boxShadow: `0 0 38px ${BRAND}55`,
        }}
      >
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={onPick} />
        <div style={{
          width: 86, height: 86, borderRadius: "50%", overflow: "hidden", position: "relative",
          background: "linear-gradient(140deg, #2A0E0E, #140808)", border: "1px solid rgba(255,255,255,0.10)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 34, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em",
          boxShadow: "inset 0 2px 8px rgba(0,0,0,0.5)",
        }}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="תמונת פרופיל" onError={() => { avatarPathCache = null; setPath(null); try { localStorage.removeItem(AVATAR_KEY); } catch { /* ignore */ } }} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : "ש"}
          {/* hover / busy overlay */}
          <div style={{
            position: "absolute", inset: 0, borderRadius: "50%", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 2, background: "rgba(0,0,0,0.62)", color: "#fff",
            opacity: canEdit && (hover || busy) ? 1 : 0, transition: "opacity .15s", pointerEvents: "none",
          }}>
            <span style={{ fontSize: 16 }}>{busy ? "⏳" : "📷"}</span>
            <span style={{ fontSize: 9.5, fontWeight: 700 }}>{busy ? "מעלה…" : (path ? "עריכת תמונה" : "העלאת תמונה")}</span>
          </div>
        </div>
      </div>
      {editing && (
        <AvatarEditor
          initialFile={editing.file}
          initialUrl={editing.url}
          onCancel={() => setEditing(null)}
          onSave={async (blob, meta, onProgress) => { const res = await doUpload(blob, meta, onProgress); if (res.ok) setEditing(null); return res; }}
        />
      )}
      {toast && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", zIndex: 100020,
          background: "#1A1C22", border: `1px solid ${BDR2}`, color: TEXT, fontSize: 13, fontWeight: 700,
          padding: "11px 20px", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.6)", fontFamily: "'Heebo', Arial, sans-serif",
        }}>{toast}</div>,
        document.body,
      )}
    </>
  );
}

// ── Circular crop editor — pure client-side canvas (no external lib). Drag to
// move, slider to zoom; exports a 512×512 JPEG blob only when the user saves. ──
function clampAvatarOffset(o: { x: number; y: number }, img: HTMLImageElement, D: number, zoom: number) {
  const eff = (D / Math.min(img.naturalWidth, img.naturalHeight)) * zoom;
  const dw = img.naturalWidth * eff, dh = img.naturalHeight * eff;
  const maxX = Math.max(0, (dw - D) / 2), maxY = Math.max(0, (dh - D) / 2);
  return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) };
}
function drawAvatar(ctx: CanvasRenderingContext2D, img: HTMLImageElement, size: number, D: number, zoom: number, offset: { x: number; y: number }) {
  // "cover" the square at zoom=1, then apply zoom + the (display-space) offset scaled to `size`.
  const eff = (size / Math.min(img.naturalWidth, img.naturalHeight)) * zoom;
  const dw = img.naturalWidth * eff, dh = img.naturalHeight * eff;
  const f = size / D;
  const x = size / 2 - dw / 2 + offset.x * f;
  const y = size / 2 - dh / 2 + offset.y * f;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, x, y, dw, dh);
}

function AvatarEditor({ initialFile, initialUrl, onCancel, onSave }: {
  initialFile?: File; initialUrl?: string;
  onCancel: () => void;
  onSave: (blob: Blob, meta: SaveMeta, onProgress: (pct: number) => void) => Promise<{ ok: boolean; error?: string }>;
}) {
  const isMobile = useIsMobile();
  const D = isMobile ? 236 : 260;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef    = useRef<HTMLImageElement | null>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const dragRef   = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  // The crop to apply when the NEXT image finishes loading (null = defaults).
  // Seeded from the localStorage cache for an instant open; the Dropbox GET below
  // then overrides it with the source-of-truth crop + the true original image, so
  // re-editing works from ANY device (localStorage is only a cache).
  const cropToApplyRef = useRef<{ zoom: number; position: { x: number; y: number } } | null>(
    initialFile ? null : loadAvatarEdit()
  );
  // Instant fallback source = the current avatar (always fresh). The Dropbox GET
  // below swaps in the true ORIGINAL for editing (source of truth, any device).
  const initialSrc = initialFile ? null : (initialUrl ?? null);
  const [file, setFile]           = useState<File | null>(initialFile ?? null);
  const [displaySrc, setDisplay]  = useState<string | null>(initialSrc);
  const [loaded, setLoaded]       = useState(false);
  const [saving, setSaving]       = useState(false);
  const [progress, setProgress]   = useState(0);            // real upload % (0–100)
  const [error, setError]         = useState<string | null>(null); // shown INSIDE the modal
  const [zoom, setZoom]           = useState(1);
  const [offset, setOffset]       = useState({ x: 0, y: 0 });

  // A picked/replaced file → object URL (revoked on change/unmount).
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setDisplay(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Load the current source into an <img> for the canvas. crossOrigin="anonymous"
  // keeps the canvas UN-tainted when the source is the cross-origin Dropbox CDN
  // (the stream endpoint 302-redirects there) so canvas.toBlob() won't throw.
  // Blob object-URLs (freshly picked files) are same-origin, so this is a no-op.
  useEffect(() => {
    if (!displaySrc) return;
    setLoaded(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => {
      imgRef.current = img;
      // Apply the pending crop (localStorage cache or the Dropbox truth); else defaults.
      const crop = cropToApplyRef.current;
      cropToApplyRef.current = null; // consume once
      if (crop) { setZoom(crop.zoom); setOffset(clampAvatarOffset(crop.position, img, D, crop.zoom)); }
      else      { setZoom(1); setOffset({ x: 0, y: 0 }); }
      setLoaded(true);
    };
    img.onerror = () => {
      // A stored original that no longer exists → fall back to the avatar image once.
      if (initialUrl && displaySrc !== initialUrl) { cropToApplyRef.current = null; setDisplay(initialUrl); return; }
      imgRef.current = null; setLoaded(false); setError("טעינת התמונה נכשלה — נסה להעלות תמונה חדשה");
    };
    img.src = displaySrc;
    return () => { img.onload = null; img.onerror = null; };
    // onNotify intentionally omitted (identity changes each parent render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySrc]);

  // Source of truth = Dropbox (works from any device). For an existing-image
  // edit, load the real ORIGINAL + last crop from the server and apply them —
  // overriding the instant localStorage cache. READ-ONLY GET; no writes.
  useEffect(() => {
    if (initialFile) return; // a freshly picked file has no remote source
    let alive = true;
    fetch("/api/red-artists/profile-image")
      .then(r => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.ok) return;
        const crop = (d.editor && typeof d.editor.zoom === "number" && d.editor.position)
          ? { zoom: d.editor.zoom as number, position: d.editor.position as { x: number; y: number } }
          : null;
        if (crop) { try { saveAvatarEdit(crop.zoom, crop.position); } catch { /* ignore */ } } // refresh cache
        if (d.original?.url) {
          // Switch to the true original → the load effect re-applies the crop on load.
          cropToApplyRef.current = crop;
          setDisplay(d.original.url as string);
        } else if (crop) {
          // No stored original (legacy) but we have a crop → apply to the current image.
          const img = imgRef.current;
          if (img) { setZoom(crop.zoom); setOffset(clampAvatarOffset(crop.position, img, D, crop.zoom)); }
          else cropToApplyRef.current = crop;
        }
      })
      .catch(() => { /* keep the instant local/avatar fallback */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw the live preview.
  useEffect(() => {
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img || !loaded) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== D * dpr) { c.width = D * dpr; c.height = D * dpr; }
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAvatar(ctx, img, D, D, zoom, offset);
  }, [zoom, offset, loaded, D]);

  // Esc = cancel — but NOT while uploading (don't interrupt the upload).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  // While uploading, warn before a browser/tab close that would abort the upload.
  useEffect(() => {
    if (!saving) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving]);

  const onDown = (e: React.PointerEvent) => {
    if (!loaded) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current, img = imgRef.current; if (!d || !img) return;
    setOffset(clampAvatarOffset({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) }, img, D, zoom));
  };
  const onUp = () => { dragRef.current = null; };

  const pickReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    if (!AVATAR_MIME.includes(f.type)) { setError("הקובץ אינו תמונה תקינה"); return; }
    if (f.size > AVATAR_MAX_BYTES)     { setError(`הקובץ גדול מהמגבלה שהשרת מאפשר (מקסימום ${AVATAR_MAX_LABEL})`); return; }
    setError(null);
    cropToApplyRef.current = null; // a new/replaced image opens at defaults, not the old crop
    clearAvatarEdit();
    setFile(f);
  };

  // Render the crop to a 512×512 JPEG blob. Rejects (rather than throwing
  // synchronously) on a null blob or a tainted-canvas SecurityError from toBlob.
  const renderBlob = (img: HTMLImageElement): Promise<Blob> =>
    new Promise((resolve, reject) => {
      try {
        const out = document.createElement("canvas");
        out.width = 512; out.height = 512;
        const ctx = out.getContext("2d");
        if (!ctx) { reject(new Error("no 2d context")); return; }
        drawAvatar(ctx, img, 512, D, zoom, offset);
        out.toBlob(b => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/jpeg", 0.9);
      } catch (e) { reject(e); } // e.g. SecurityError on a tainted canvas
    });

  // Bulletproof save: whatever happens, `saving` is always released in finally,
  // so the button can never get stuck on "שומר…".
  const doSave = async () => {
    if (saving) return; // prevents a double submit
    const img = imgRef.current;
    if (!img) { setError("אין תמונה לשמירה"); return; }
    setSaving(true); setError(null); setProgress(0);
    try {
      const blob = await renderBlob(img);
      // originalFile only for a freshly picked/replaced image → the server stores
      // it as the re-editing source; a plain re-crop keeps the existing original.
      const res = await onSave(blob, { zoom, offset, originalFile: file, originalFileName: file?.name ?? null }, setProgress);
      if (res.ok) {
        saveAvatarEdit(zoom, offset);          // refresh the localStorage cache (Dropbox is the source of truth)
        // parent closes the modal on success (setEditing(null)).
      } else {
        // Failure → keep the modal open, the crop + picked file intact, and show
        // the error IN the modal so a retry is one click away.
        setError(res.error || "העלאת התמונה נכשלה. נסה שוב");
      }
    } catch (e) {
      console.error("[avatar-editor] save failed:", e);
      setError("העלאת התמונה נכשלה. נסה שוב");
    } finally {
      setSaving(false);                        // no-op if already unmounted on success
    }
  };

  if (typeof document === "undefined") return null;

  const btnBase: React.CSSProperties = {
    padding: "12px 0", borderRadius: 11, border: "none", cursor: "pointer",
    fontFamily: "inherit", fontSize: 14, fontWeight: 800, boxSizing: "border-box",
  };

  return createPortal(
    <div
      onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget && !saving) onCancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100035, background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      }}>
      <div style={{
        width: isMobile ? "100%" : 360, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box",
        background: "linear-gradient(180deg, #161617 0%, #111112 100%)", border: `1px solid ${BDR2}`,
        borderRadius: 20, boxShadow: "0 24px 70px rgba(0,0,0,0.6)", padding: isMobile ? "18px 16px 20px" : "20px 22px 22px",
      }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: "#fff" }}>עריכת תמונת פרופיל</div>
          <button type="button" onClick={onCancel} disabled={saving} aria-label="סגור" style={{ background: "none", border: "none", cursor: saving ? "default" : "pointer", padding: 4, lineHeight: 0, opacity: saving ? 0.5 : 1 }}><IcX size={20} /></button>
        </div>

        {/* circular preview */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <div
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            style={{
              width: D, height: D, borderRadius: "50%", overflow: "hidden", position: "relative",
              border: `2px solid ${BRAND}66`, boxShadow: `0 0 30px ${BRAND}40, inset 0 0 0 1px rgba(255,255,255,0.06)`,
              cursor: loaded ? "grab" : "default", touchAction: "none", background: "#0C0A0B", flexShrink: 0,
            }}>
            <canvas ref={canvasRef} style={{ width: D, height: D, display: "block" }} />
            {!loaded && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: TEXT2, fontSize: 13 }}>טוען…</div>}
          </div>
        </div>

        {/* zoom slider */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <span style={{ color: TEXT2, fontSize: 12, flexShrink: 0 }}>הגדלה</span>
          <input type="range" min={1} max={3} step={0.01} value={zoom} disabled={!loaded}
            onChange={e => { const z = +e.target.value; setZoom(z); const img = imgRef.current; if (img) setOffset(o => clampAvatarOffset(o, img, D, z)); }}
            style={{ flex: 1, accentColor: BRAND, cursor: loaded ? "pointer" : "default" }} />
        </div>

        {/* replace image */}
        <button type="button" onClick={() => fileRef.current?.click()} disabled={saving} style={{
          ...btnBase, width: "100%", marginBottom: 10, fontWeight: 700, opacity: saving ? 0.5 : 1,
          background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT, cursor: saving ? "default" : "pointer",
        }}>החלף תמונה</button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={pickReplace} />

        {/* error — INSIDE the modal (above the buttons), never a toast behind the overlay */}
        {error && (
          <div style={{
            marginBottom: 12, fontSize: 12.5, fontWeight: 700, color: "#FCA5A5", lineHeight: 1.5,
            background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.32)", borderRadius: 10, padding: "10px 12px",
          }}>{error}</div>
        )}

        {/* real upload progress (from XHR upload.onprogress) */}
        {saving && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: TEXT2, marginBottom: 6 }}>
              {progress < 100 ? `מעלה תמונה... ${progress}%` : "מסיים…"}
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #E5322F, #FF6B6B)", borderRadius: 999, transition: "width .15s" }} />
            </div>
          </div>
        )}

        {/* cancel + save */}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onCancel} disabled={saving} style={{ ...btnBase, flex: 1, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT, fontWeight: 700, opacity: saving ? 0.5 : 1, cursor: saving ? "default" : "pointer" }}>ביטול</button>
          <button type="button" onClick={doSave} disabled={!loaded || saving} style={{
            ...btnBase, flex: 1, color: "#fff", opacity: (loaded && !saving) ? 1 : 0.6, cursor: (loaded && !saving) ? "pointer" : "not-allowed",
            background: "linear-gradient(180deg, #E5322F, #C01C1C)", boxShadow: (loaded && !saving) ? "0 4px 16px rgba(220,38,38,0.32)" : "none",
          }}>{saving ? "שומר…" : "שמירה"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Hero "latest updates" flash — premium news capsule, auto-rotating ─────────────
// Hero ticker — rotates through the REAL summary.updates (same source as the
// home "עדכונים מהלייבל" section + the לו״ז tab). No mock. Empty → a neutral
// capsule "אין עדכונים חדשים כרגע" so the area never looks broken.
function NewsFlash({ items }: { items: PortalUpdate[] }) {
  const [idx, setIdx]   = useState(0);
  const [show, setShow] = useState(true);
  const isMobile = useIsMobile();
  const count = items.length;

  function advance() {
    if (count <= 1) return;
    setShow(false);
    setTimeout(() => { setIdx(i => (i + 1) % count); setShow(true); }, 300);
  }

  // Auto-rotate only when there's more than one update. Depends on `count` only,
  // so it isn't reset on every render.
  useEffect(() => {
    if (count <= 1) return;
    const t = setInterval(() => {
      setShow(false);
      setTimeout(() => { setIdx(i => (i + 1) % count); setShow(true); }, 300);
    }, 4600);
    return () => clearInterval(t);
  }, [count]);

  const cur      = count ? items[idx % count] : null;
  const mainText = cur ? cur.title : "אין עדכונים חדשים כרגע";
  const subText  = cur ? (cur.description || fmtShowDate(cur.date)) : "";

  const fade: React.CSSProperties = { opacity: show ? 1 : 0, transition: "opacity .3s ease" };
  // Mobile: clamp to 2 lines (readable) with a stable height so the capsule
  // doesn't jump between rotations. Desktop: single line + ellipsis.
  const textStyle: React.CSSProperties = isMobile
    ? { fontSize: 14, fontWeight: 700, color: cur ? "#fff" : TEXT2, lineHeight: 1.35, minHeight: "2.7em", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as React.CSSProperties
    : { fontSize: 15.5, fontWeight: 700, color: cur ? "#fff" : TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <div style={{
      position: "relative", overflow: "hidden", borderRadius: 16, maxWidth: 640, margin: "0 auto",
      background: "rgba(8,6,7,0.62)", border: `1px solid ${BDR2}`,
      boxShadow: `0 0 28px rgba(220,38,38,0.13), inset 0 1px 0 rgba(255,255,255,0.05)`,
      backdropFilter: "blur(6px)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 11 : 14, padding: "15px 16px" }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, alignSelf: isMobile ? "flex-start" : "center", background: "rgba(220,38,38,0.14)", border: `1px solid ${BRAND}55`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, boxShadow: `0 0 14px rgba(220,38,38,0.25)` }}>📡</span>
        <div style={{ flex: 1, minWidth: 0, textAlign: "start", ...fade }}>
          <div style={textStyle}>{mainText}</div>
          {isMobile && subText && <div style={{ fontSize: 11, color: MUTED, marginTop: 4, ...fade }}>{subText}</div>}
        </div>
        {!isMobile && subText && <span style={{ fontSize: 12, color: MUTED, whiteSpace: "nowrap", flexShrink: 0, ...fade }}>{subText}</span>}
        {count > 1 && <button onClick={advance} aria-label="העדכון הבא" style={{ background: "none", border: "none", color: TEXT2, fontSize: 20, cursor: "pointer", flexShrink: 0, alignSelf: isMobile ? "flex-start" : "center", lineHeight: 1, padding: "0 2px" }}>‹</button>}
      </div>
      {/* thin red progress bar (restarts each rotation) — only while rotating */}
      {count > 1 && <div key={idx} style={{ position: "absolute", bottom: 0, insetInlineStart: 0, height: 2.5, background: BRAND, boxShadow: `0 0 8px ${BRAND}`, borderRadius: 2, animation: "rapProgress 4.6s linear" }} />}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────────
// Whole days from today until a YYYY-MM-DD (null if unparseable). Client-only (runs
// after the manifest fetch, post-hydration) → no SSR mismatch.
function daysUntilYmd(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  target.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

// "הפרויקט הבא לעבודה" — the sketch Shalev should work on now (real data from
// "המוזיקה שלי"): one file, its latest version, the existing player, an optional
// deadline (the next-release date), and a shortcut into the music library. Distinct
// from "הריליס הבא" (the next song to RELEASE) — never merged.
function NextWorkCard({ sketch, hasSelection, deadline, player, onOpenMusic, canEdit, onEdit, loading }: {
  sketch: Sketch | null; hasSelection: boolean; deadline: string | null;
  player: ReturnType<typeof usePlayerSafe>; onOpenMusic: () => void;
  canEdit: boolean; onEdit: () => void; loading: boolean;
}) {
  const days = deadline ? daysUntilYmd(deadline) : null;
  const hasFile = !!sketch && !!sketch.latestFilePath;
  return (
    <div style={{ ...panel, padding: "18px 24px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* header: icon (right) + OWNER pick/replace button (left) — shalev sees no button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ width: 50, height: 50, borderRadius: 14, background: "linear-gradient(180deg, rgba(220,38,38,0.18), rgba(220,38,38,0.08))", border: `1px solid ${BRAND}44`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>♫</div>
        {canEdit && (
          <button onClick={onEdit} style={{ ...linkBtn, color: "#FF6B6B", fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap" }}>{hasSelection ? "החלף פרויקט" : "בחר פרויקט"}</button>
        )}
      </div>
      <div style={{ fontSize: 16.5, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>הפרויקט הבא לעבודה</div>

      {/* body: the chosen project — file name + Play only (NO version/date/duration) */}
      {sketch ? (
        hasFile ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <SketchRowPlay size={40} player={player} sketch={sketch} />
            <div style={{ minWidth: 0, flex: 1, fontSize: 15, fontWeight: 700, color: TEXT, lineHeight: 1.35, wordBreak: "break-word" }}>{sketch.title}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{sketch.title}</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 5 }}>אין עדיין קובץ מוזיקה לפרויקט הזה</div>
          </div>
        )
      ) : (
        <div style={{ fontSize: 13.5, color: TEXT2, lineHeight: 1.55 }}>
          {loading ? "טוען…" : hasSelection ? "הפרויקט שנבחר לא נמצא בספרייה" : canEdit ? "לא נבחר פרויקט — לחץ ״בחר פרויקט״" : "אין עדיין פרויקט לעבודה"}
        </div>
      )}

      {/* footer: real (owner-set) deadline + days-left + open-library button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {deadline ? (
            <>
              <span style={{ fontSize: 12, color: MUTED }}>דדליין: <span style={{ direction: "ltr", color: TEXT2, fontWeight: 700 }}>{fmtSketchDate(deadline)}</span></span>
              {days != null && days >= 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 800, color: "#FF6B6B", background: "rgba(220,38,38,0.12)", border: `1px solid ${BRAND}44`, borderRadius: 7, padding: "3px 10px", whiteSpace: "nowrap" }}>נותרו {days} ימים</span>
              )}
            </>
          ) : sketch ? <span style={{ fontSize: 11.5, color: MUTED }}>לא הוגדר דדליין</span> : <span />}
        </div>
        <button onClick={onOpenMusic} style={{ ...linkBtn, color: "#FF6B6B", fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap", flexShrink: 0 }}>פתח במוזיקה שלי ←</button>
      </div>
    </div>
  );
}

// OWNER-only picker for "הפרויקט הבא לעבודה" — choose an active sketch from
// "המוזיקה שלי" + an OPTIONAL deadline. Persists to the manifest (POST /next-work).
function NextWorkModal({ sketches, current, onClose, onSaved }: {
  sketches: Sketch[]; current: PortalWork | null; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [sketchId, setSketchId] = useState(current?.sketchId ?? sketches[0]?.id ?? "");
  const [deadline, setDeadline] = useState(current?.deadline ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const validDate = deadline === "" || /^\d{4}-\d{2}-\d{2}$/.test(deadline);
  const canSave = !!sketchId && validDate && !saving && sketches.length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/red-artists/next-work", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sketchId, deadline: deadline || null }),
      });
      if (!res.ok) { setErr(await readErr(res, "שמירת הפרויקט נכשלה")); setSaving(false); return; }
      await onSaved();
    } catch { setErr("שגיאת רשת, נסה שוב"); setSaving(false); }
  };

  return (
    <SketchModalShell title="הפרויקט הבא לעבודה" onClose={onClose} busy={saving}>
      <SkErr msg={err} />
      {sketches.length === 0 ? (
        <div style={{ fontSize: 13.5, color: TEXT2, lineHeight: 1.7, textAlign: "center", padding: "18px 8px" }}>
          אין עדיין פרויקטים בספרייה.<br />הוסף פרויקט ב״המוזיקה שלי״ ואז ניתן לבחור.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={skLabel}>בחר פרויקט</label>
            <select className="rap-select" value={sketchId} onChange={e => setSketchId(e.target.value)} disabled={saving}
              style={{ ...skField, cursor: "pointer", appearance: "auto", opacity: saving ? 0.6 : 1 }}>
              {sketches.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={skLabel}>דדליין (אופציונלי)</label>
            <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} disabled={saving}
              style={{ ...skField, colorScheme: "dark", opacity: saving ? 0.6 : 1 }} />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={save} disabled={!canSave} style={{ ...skPrimaryBtn(canSave), flex: "1 1 150px", width: "auto" }}>{saving ? "שומר…" : "שמור"}</button>
            <button onClick={onClose} disabled={saving} style={{
              flex: "1 1 110px", padding: "14px 0", borderRadius: 12, border: `1px solid ${BDR2}`, background: "transparent",
              color: TEXT2, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: saving ? "default" : "pointer",
            }}>ביטול</button>
          </div>
        </>
      )}
    </SketchModalShell>
  );
}

function ActionCard({ icon, title, body, sub, link, onLink }: {
  icon: string; title: string; body: string; sub?: string; link?: string; onLink?: () => void;
}) {
  return (
    <div
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = "rgba(220,38,38,0.35)"; e.currentTarget.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.05), 0 18px 40px rgba(0,0,0,0.5)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = BDR2; e.currentTarget.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.04), 0 14px 34px rgba(0,0,0,0.4)"; }}
      style={{ ...panel, padding: "18px 24px 20px", display: "flex", flexDirection: "column", gap: 12, transition: "transform .16s, border-color .16s, box-shadow .16s" }}>
      {/* top row: icon (right, RTL) + optional link (left) — keeps the link from
          adding height below the content, so cards stay compact and even. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ width: 50, height: 50, borderRadius: 14, background: "linear-gradient(180deg, rgba(220,38,38,0.18), rgba(220,38,38,0.08))", border: `1px solid ${BRAND}44`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{icon}</div>
        {link && (
          <button
            onClick={onLink}
            style={{ ...linkBtn, color: "#FF6B6B", fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap", cursor: onLink ? "pointer" : "default" }}
          >{link}</button>
        )}
      </div>
      <div>
        <div style={{ fontSize: 16.5, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>{title}</div>
        <div style={{ fontSize: 13.5, color: TEXT2, marginTop: 6, lineHeight: 1.55 }}>{body}</div>
        {sub && <div style={{ fontSize: 12, color: MUTED, marginTop: 5, direction: "ltr", textAlign: "right", fontFamily: "ui-monospace, Menlo, monospace" }}>{sub}</div>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: SongStatus }) {
  const c = STATUS_COLOR[status];
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: c, background: `${c}1A`, border: `1px solid ${c}40`, borderRadius: 7, padding: "3px 10px", whiteSpace: "nowrap" }}>{status}</span>
  );
}

function BalanceRow({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 2px", borderBottom: `1px solid ${BDR}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, background: `${color}1A`, border: `1px solid ${color}40`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{icon}</span>
        <span style={{ fontSize: 13, color: TEXT2 }}>{label}</span>
      </div>
      <span style={{ fontSize: 18.5, fontWeight: 800, color, direction: "ltr" }}>{value}</span>
    </div>
  );
}

const dotsBtn: React.CSSProperties = {
  background: "none", border: "none", color: MUTED, fontSize: 16, cursor: "pointer", flexShrink: 0, padding: "0 2px",
};

// ── Upload modal (desktop: centered card · mobile: bottom sheet). UI ONLY —
// no backend is wired for music-file uploads yet, so submit shows a demo toast.
// A target song/project is REQUIRED; "update" mode locks it to the chosen track.
// ── Sketch modals — shared building blocks ────────────────────────────────────
const SKETCH_EXTS = ["mp3", "wav", "aiff", "aif", "m4a"];
const skField: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.03)",
  border: `1px solid ${BDR2}`, borderRadius: 11, color: TEXT, fontSize: 14,
  fontFamily: "inherit", padding: "13px 14px", outline: "none", colorScheme: "dark",
};
const skLabel: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: TEXT2, marginBottom: 8, display: "block" };
function fmtBytes(n?: number): string {
  if (!n || n <= 0) return "";
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
function validateSketchFileClient(f: File): string | null {
  const ext = (f.name.split(".").pop() ?? "").toLowerCase();
  if (!SKETCH_EXTS.includes(ext)) return "ניתן להעלות קובצי אודיו בלבד (MP3, WAV, AIFF, M4A)";
  if (f.size <= 0) return "הקובץ ריק";
  if (f.size > 500 * 1024 * 1024) return "הקובץ גדול מדי (מקסימום 500MB)";
  return null;
}

// Reusable dark modal shell (desktop centered · mobile bottom-sheet). Close is
// blocked while `busy` so an in-flight upload/save can't be interrupted mid-way.
function SketchModalShell({ title, onClose, busy, children }: {
  title: string; onClose: () => void; busy: boolean; children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100030, background: "rgba(0,0,0,0.66)",
        backdropFilter: "blur(3px)", display: "flex", justifyContent: "center", alignItems: "center",
        // Fixed side margins on mobile + iPhone safe-area top/bottom → never edge-to-edge.
        padding: isMobile
          ? "calc(env(safe-area-inset-top) + 12px) 12px calc(env(safe-area-inset-bottom) + 12px)"
          : 20,
        fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      }}>
      {/* Panel: flex column, capped height. Header is FIXED (flex-shrink:0); only
          the body scrolls (one scroll, never the page behind). Same tokens for
          BOTH sketch modals → identical width + max footprint on mobile. */}
      <div style={{
        width: "100%", maxWidth: isMobile ? 440 : 480, maxHeight: isMobile ? "88dvh" : "88vh",
        display: "flex", flexDirection: "column", boxSizing: "border-box", direction: "rtl", overflow: "hidden",
        background: "linear-gradient(180deg, #161617 0%, #111112 100%)",
        border: `1px solid ${BDR2}`, borderRadius: 20, boxShadow: "0 24px 70px rgba(0,0,0,0.6)",
      }}>
        {/* header — fixed, always visible */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          padding: isMobile ? "15px 16px 13px" : "20px 24px 16px", borderBottom: `1px solid ${BDR}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: "rgba(220,38,38,0.16)", border: `1px solid ${BRAND}55`, display: "flex", alignItems: "center", justifyContent: "center" }}><IcMusicNote size={16} color="#FF6B6B" /></span>
            <div style={{ fontSize: isMobile ? 16.5 : 18, fontWeight: 900, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          </div>
          <button onClick={() => !busy && onClose()} aria-label="סגור" disabled={busy} style={{ background: "none", border: "none", cursor: busy ? "default" : "pointer", padding: 4, flexShrink: 0, lineHeight: 0, opacity: busy ? 0.4 : 1 }}><IcX size={20} /></button>
        </div>
        {/* body — the ONLY scroll area */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: isMobile ? "14px 16px 18px" : "18px 24px 24px" }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SketchDropzone({ file, error, onFile, disabled }: {
  file: File | null; error: string | null; onFile: (f: File | null) => void; disabled?: boolean;
}) {
  const isMobile = useIsMobile();
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div
        onClick={() => !disabled && ref.current?.click()}
        onDragOver={e => { if (disabled) return; e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { if (disabled) return; e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0] ?? null); }}
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
          padding: isMobile ? "22px 14px" : "28px 14px", borderRadius: 13, cursor: disabled ? "default" : "pointer", textAlign: "center",
          border: `1.5px dashed ${error ? "#F87171" : drag ? BRAND : BDR2}`,
          background: drag ? "rgba(220,38,38,0.08)" : "rgba(255,255,255,0.02)", transition: "all .14s", opacity: disabled ? 0.6 : 1,
        }}>
        <IcCloud size={26} color={drag ? "#FF6B6B" : TEXT2} />
        {file ? (
          <>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr" }}>{file.name}</div>
            <div style={{ fontSize: 11.5, color: MUTED, direction: "ltr" }}>{fmtBytes(file.size)} · לחץ להחלפה</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13.5, color: TEXT2 }}>{isMobile ? "לחץ לבחירת קובץ" : "גרור קובץ לכאן או לחץ לבחירה"}</div>
            <div style={{ fontSize: 11, color: MUTED, direction: "ltr" }}>MP3, WAV, AIFF, M4A · עד 500MB</div>
          </>
        )}
      </div>
      <input ref={ref} type="file" accept=".mp3,.wav,.aiff,.aif,.m4a,audio/*" onChange={e => onFile(e.target.files?.[0] ?? null)} style={{ display: "none" }} />
      {error && <div style={{ fontSize: 12, color: "#F87171", marginTop: 8, fontWeight: 600 }}>{error}</div>}
    </div>
  );
}

const skPrimaryBtn = (enabled: boolean): React.CSSProperties => ({
  width: "100%", boxSizing: "border-box", padding: "14px 0", borderRadius: 12, border: "none",
  color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: "inherit",
  cursor: enabled ? "pointer" : "not-allowed", opacity: enabled ? 1 : 0.5,
  background: "linear-gradient(180deg, #E5322F, #C01C1C)", boxShadow: enabled ? `0 4px 16px rgba(220,38,38,0.32)` : "none",
});
function SkErr({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div style={{ fontSize: 12.5, color: "#F87171", background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.28)", borderRadius: 9, padding: "10px 12px", marginBottom: 14, lineHeight: 1.5 }}>{msg}</div>;
}
async function readErr(res: Response, fallback: string): Promise<string> {
  try { const d = await res.json(); return (d?.error as string) || fallback; } catch { return fallback; }
}

// ── Create ────────────────────────────────────────────────────────────────────
function SketchCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Sketch) => void | Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickFile = (f: File | null) => { setFile(f); setFileErr(f ? validateSketchFileClient(f) : null); };
  const canSubmit = title.trim() !== "" && !!file && !fileErr && !busy;

  const submit = async () => {
    if (!canSubmit || !file) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("description", description.trim());
      fd.append("notes", notes.trim());
      fd.append("file", file);
      const res = await fetch("/api/red-artists/sketches", { method: "POST", body: fd });
      if (!res.ok) { setErr(await readErr(res, "יצירת הסקיצה נכשלה")); setBusy(false); return; }
      const d = await res.json();
      await onCreated(d.sketch as Sketch);
      onClose(); // close ONLY after a full success
    } catch { setErr("שגיאת רשת, נסה שוב"); setBusy(false); }
  };

  return (
    <SketchModalShell title="העלאת קובץ חדש" onClose={onClose} busy={busy}>
      <SkErr msg={err} />
      <div style={{ marginBottom: 16 }}>
        <label style={skLabel}>שם הפרויקט</label>
        <input value={title} onChange={e => setTitle(e.target.value)} disabled={busy} placeholder="כתוב שם לסקיצה" style={{ ...skField, opacity: busy ? 0.6 : 1 }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={skLabel}>תיאור / טקסט <span style={{ color: MUTED, fontWeight: 500 }}>(אופציונלי)</span></label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={busy} placeholder="מילים, טקסט או רעיונות…" rows={3} style={{ ...skField, resize: "none", lineHeight: 1.5, opacity: busy ? 0.6 : 1 }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={skLabel}>הערות <span style={{ color: MUTED, fontWeight: 500 }}>(אופציונלי)</span></label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={busy} placeholder="וייב, הפניות או הערות הפקה…" rows={2} style={{ ...skField, resize: "none", lineHeight: 1.5, opacity: busy ? 0.6 : 1 }} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={skLabel}>קובץ אודיו</label>
        <SketchDropzone file={file} error={fileErr} onFile={pickFile} disabled={busy} />
      </div>
      <button onClick={submit} disabled={!canSubmit} style={skPrimaryBtn(canSubmit)}>{busy ? "מעלה קובץ…" : "העלה קובץ"}</button>
    </SketchModalShell>
  );
}

// ── Edit (details · new version · soft delete) ────────────────────────────────
function SketchEditModal({ sketch, player, onClose, onReload, onToast }: {
  sketch: Sketch; player: ReturnType<typeof usePlayerSafe>;
  onClose: () => void; onReload: () => Promise<void>; onToast: (m: string) => void;
}) {
  const [title, setTitle] = useState(sketch.title);
  const [description, setDescription] = useState(sketch.description ?? "");
  const [notes, setNotes] = useState(sketch.notes ?? "");
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsErr, setDetailsErr] = useState<string | null>(null);

  const [newFile, setNewFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [versionErr, setVersionErr] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const busy = savingDetails || uploading || deleting;
  const changed = title.trim() !== sketch.title || description.trim() !== (sketch.description ?? "") || notes.trim() !== (sketch.notes ?? "");
  const canSaveDetails = changed && title.trim() !== "" && !busy;

  const pickFile = (f: File | null) => { setNewFile(f); setFileErr(f ? validateSketchFileClient(f) : null); };

  const saveDetails = async () => {
    if (!canSaveDetails) return;
    setSavingDetails(true); setDetailsErr(null);
    try {
      const body: Record<string, string> = {};
      if (title.trim() !== sketch.title) body.title = title.trim();
      if (description.trim() !== (sketch.description ?? "")) body.description = description.trim();
      if (notes.trim() !== (sketch.notes ?? "")) body.notes = notes.trim();
      const res = await fetch(`/api/red-artists/sketches/${sketch.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { setDetailsErr(await readErr(res, "שמירת הפרטים נכשלה")); setSavingDetails(false); return; }
      await onReload();
      onToast("הפרטים נשמרו");
      setSavingDetails(false);
    } catch { setDetailsErr("שגיאת רשת, נסה שוב"); setSavingDetails(false); }
  };

  const uploadVersion = async () => {
    if (!newFile || fileErr || busy) return;
    setUploading(true); setVersionErr(null);
    try {
      const fd = new FormData();
      fd.append("file", newFile);
      const res = await fetch(`/api/red-artists/sketches/${sketch.id}/version`, { method: "POST", body: fd });
      if (!res.ok) { setVersionErr(await readErr(res, "עדכון הגרסה נכשל")); setUploading(false); return; }
      const d = await res.json();
      const fresh = d.sketch as Sketch;
      await onReload();
      playSketchLatest(player, fresh, onToast);   // the new version becomes what plays
      onToast(`עודכן לגרסה V${fresh.latestVersion}`);
      setNewFile(null); setUploading(false);
    } catch { setVersionErr("שגיאת רשת, נסה שוב"); setUploading(false); }
  };

  const doDelete = async () => {
    if (busy) return;
    setDeleting(true); setDeleteErr(null);
    try {
      const res = await fetch(`/api/red-artists/sketches/${sketch.id}`, { method: "DELETE" });
      if (!res.ok) { setDeleteErr(await readErr(res, "ההסרה נכשלה")); setDeleting(false); return; }
      await onReload();
      onToast(`הסקיצה "${sketch.title}" הוסרה מהפורטל`);
      onClose();
    } catch { setDeleteErr("שגיאת רשת, נסה שוב"); setDeleting(false); }
  };

  const isMobile = useIsMobile();
  // Tighter padding/gaps on mobile so the (content-heavy) edit modal stays compact.
  const sectionBox: React.CSSProperties = { background: "rgba(255,255,255,0.02)", border: `1px solid ${BDR}`, borderRadius: 14, padding: isMobile ? 13 : 16, marginBottom: isMobile ? 12 : 16 };
  const secTitle: React.CSSProperties = { fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: isMobile ? 9 : 12 };

  return (
    <SketchModalShell title="עריכת סקיצה" onClose={onClose} busy={busy}>
      {/* details */}
      <div style={sectionBox}>
        <div style={secTitle}>פרטי הסקיצה</div>
        <SkErr msg={detailsErr} />
        <div style={{ marginBottom: isMobile ? 10 : 13 }}>
          <label style={skLabel}>שם הפרויקט</label>
          <input value={title} onChange={e => setTitle(e.target.value)} disabled={busy} style={{ ...skField, opacity: busy ? 0.6 : 1 }} />
        </div>
        <div style={{ marginBottom: isMobile ? 10 : 13 }}>
          <label style={skLabel}>תיאור / טקסט</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={busy} rows={isMobile ? 2 : 3} style={{ ...skField, resize: "none", lineHeight: 1.5, opacity: busy ? 0.6 : 1 }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={skLabel}>הערות</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={busy} rows={2} style={{ ...skField, resize: "none", lineHeight: 1.5, opacity: busy ? 0.6 : 1 }} />
        </div>
        <button onClick={saveDetails} disabled={!canSaveDetails} style={{
          width: "100%", boxSizing: "border-box", padding: "12px 0", borderRadius: 11, border: `1px solid ${canSaveDetails ? BRAND : BDR2}`,
          color: canSaveDetails ? "#fff" : TEXT2, fontSize: 13.5, fontWeight: 800, fontFamily: "inherit",
          cursor: canSaveDetails ? "pointer" : "not-allowed", background: canSaveDetails ? "rgba(220,38,38,0.16)" : "transparent",
        }}>{savingDetails ? "שומר…" : "שמור פרטים"}</button>
      </div>

      {/* new version */}
      <div style={sectionBox}>
        <div style={secTitle}>העלאת גרסה חדשה</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, fontSize: 12.5, color: TEXT2, flexWrap: "wrap" }}>
          <span>גרסה נוכחית: <b style={{ color: "#FF6B6B", direction: "ltr" }}>V{sketch.latestVersion}</b></span>
          <span style={{ direction: "ltr", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{sketch.latestFileName}</span>
        </div>
        <SkErr msg={versionErr} />
        <div style={{ marginBottom: 12 }}>
          <SketchDropzone file={newFile} error={fileErr} onFile={pickFile} disabled={busy} />
        </div>
        <button onClick={uploadVersion} disabled={!newFile || !!fileErr || busy} style={{
          width: "100%", boxSizing: "border-box", padding: "12px 0", borderRadius: 11, border: "none",
          color: "#fff", fontSize: 13.5, fontWeight: 800, fontFamily: "inherit",
          cursor: !newFile || !!fileErr || busy ? "not-allowed" : "pointer", opacity: !newFile || !!fileErr || busy ? 0.5 : 1,
          background: "linear-gradient(180deg, #E5322F, #C01C1C)",
        }}>{uploading ? `מעלה V${sketch.latestVersion + 1}…` : `עדכן קובץ (V${sketch.latestVersion + 1})`}</button>
      </div>

      {/* danger zone */}
      <div style={{ background: "rgba(248,113,113,0.05)", border: "1px solid rgba(248,113,113,0.22)", borderRadius: 14, padding: 16 }}>
        <div style={{ ...secTitle, color: "#F87171", display: "flex", alignItems: "center", gap: 7 }}><IcTrash size={15} color="#F87171" /> הסרה מהפורטל</div>
        <SkErr msg={deleteErr} />
        {!confirmDelete ? (
          <>
            <div style={{ fontSize: 12.5, color: TEXT2, lineHeight: 1.6, marginBottom: 12 }}>
              הסקיצה תוסר מ״המוזיקה שלי״. כל קובצי הגרסאות יישארו שמורים ב-Dropbox, והפעולה לא תשפיע על עמוד הפרויקטים.
            </div>
            <button onClick={() => setConfirmDelete(true)} disabled={busy} style={{
              padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(248,113,113,0.4)", background: "transparent",
              color: "#F87171", fontSize: 13, fontWeight: 800, fontFamily: "inherit", cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1,
              display: "inline-flex", alignItems: "center", gap: 7,
            }}><IcTrash size={14} color="#F87171" /> הסר מהפורטל</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: TEXT, lineHeight: 1.6, marginBottom: 12, fontWeight: 600 }}>להסיר את הסקיצה מהפורטל? הקבצים יישמרו ב-Dropbox.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={doDelete} disabled={busy} style={{
                flex: "1 1 130px", padding: "11px 0", borderRadius: 10, border: "none", background: "#DC2626",
                color: "#fff", fontSize: 13, fontWeight: 800, fontFamily: "inherit", cursor: busy ? "default" : "pointer", opacity: deleting ? 0.7 : 1,
              }}>{deleting ? "מסיר…" : "כן, הסר"}</button>
              <button onClick={() => setConfirmDelete(false)} disabled={busy} style={{
                flex: "1 1 130px", padding: "11px 0", borderRadius: 10, border: `1px solid ${BDR2}`, background: "transparent",
                color: TEXT2, fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: busy ? "default" : "pointer",
              }}>ביטול</button>
            </div>
          </>
        )}
      </div>
    </SketchModalShell>
  );
}
