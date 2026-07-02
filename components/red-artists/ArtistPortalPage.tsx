"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { getLatestAudioFile, getFreshPlayUrl, usePlayerSafe } from "@/components/PlayerProvider";
import type { Project } from "@/lib/types";

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

const UPDATES: string[] = [
  "נוסף ביט חדש של Nagash בשם Focus",
  "המיקס של My Story מוכן לאישור",
  "נקבע סשן אולפן חדש",
  "עודכן מאזן החודש",
];

// ── Artist weekly calendar (יומן האמן) — demo week ───────────────────────────────
type CalType = "סשן" | "סושיאל" | "צילום" | "הופעה" | "דדליין" | "פגישה";
const CAL_TYPE_COLOR: Record<CalType, string> = {
  "סשן":   "#60A5FA",
  "סושיאל": "#EC4899",
  "צילום":  "#F59E0B",
  "הופעה":  "#FB7185",
  "דדליין": "#EF4444",
  "פגישה":  "#2DD4BF",
};
type WeekEvent = { time: string; title: string; type: CalType };
const WEEK: { day: string; date: string; selected?: boolean; events: WeekEvent[] }[] = [
  { day: "ראשון",  date: "08.06", events: [{ time: "18:00", title: "סשן אמן והפקה", type: "סשן" }] },
  { day: "שני",    date: "09.06", events: [{ time: "15:00", title: "סקירת סקיצות",  type: "סשן" }] },
  { day: "שלישי",  date: "10.06", events: [{ time: "12:00", title: "ישיבת צוות",    type: "פגישה" }] },
  { day: "רביעי",  date: "11.06", events: [{ time: "20:00", title: "שידור לייב",    type: "סושיאל" }] },
  { day: "חמישי",  date: "12.06", events: [{ time: "16:00", title: "גרירת מיקס",    type: "צילום" }] },
  { day: "שישי",   date: "13.06", events: [{ time: "11:00", title: "מעקב פרויקטים", type: "פגישה" }] },
  { day: "שבת",    date: "14.06", selected: true, events: [] },
];
const CAMPAIGN = { name: "קמפיין פרנציפ", total: "3 תכנים השבוע", pending: "1 ממתין לאישור", scheduled: "2 מתוזמנים" };


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

// Hero "latest updates" flash — hardcoded, rotates client-side.
const FLASH: { text: string; time: string }[] = [
  { text: "המיקס של My Story מוכן לאישור",          time: "לפני 4 דקות" },
  { text: "נוסף ביט חדש של Nagash בשם Focus",        time: "לפני שעה" },
  { text: "נקבע סשן אולפן ל־01.07 בשעה 16:00",       time: "לפני 3 שעות" },
  { text: "עודכן מאזן החודש",                        time: "אתמול" },
  { text: "הועלתה סקיצה חדשה לבדיקה",                 time: "לפני יומיים" },
  { text: "נשלחה הודעה חדשה מהלייבל",                 time: "לפני 5 דקות" },
];

const TABS = ["בית", "המוזיקה שלי", "ההופעות שלי", "מאזן", "ביטים פנויים", "לו״ז ועדכונים"] as const;
type Tab = (typeof TABS)[number];

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
export type ShalevSummary = {
  shows: { upcoming: PortalShow[]; done: PortalShow[] };
  balance: { paidTotal: number; expectedTotal: number; currency: string; payments: PortalPayment[]; hasData: boolean };
};
type LoadState = "loading" | "ready" | "error";
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
export default function ArtistPortalPage() {
  const [tab, setTab] = useState<Tab>("בית");
  const isMobile = useIsMobile();

  // Single source of truth for Shalev's library — used by BOTH the home card and
  // the "המוזיקה שלי" tab. Fetches the owner-only projects once; no demo data.
  const [libRows, setLibRows] = useState<LibRow[]>([]);
  const [libState, setLibState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let alive = true;
    fetch("/api/projects")
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((projects: Project[]) => {
        if (!alive) return;
        setLibRows(getShalevMusicProjects(projects));
        setLibState("ready");
      })
      .catch(() => { if (alive) setLibState("error"); });
    return () => { alive = false; };
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
        if (d?.ok) { setSummary({ shows: d.shows, balance: d.balance }); setSummaryState("ready"); }
        else setSummaryState("error");
      })
      .catch(() => { if (alive) setSummaryState("error"); });
    return () => { alive = false; };
  }, []);

  // Learn-and-save duration: ONLY for Shalev's rows, ONLY after the global player
  // has real duration for the currently-playing track, ONLY if that file has none
  // yet, and AT MOST once per file (durationLearned). Narrow POST → updates local
  // state on success. Does not touch the player, Dropbox, or other projects.
  const player = usePlayerSafe();
  const playingId = player?.track?.projectId;
  const playerDuration = player?.duration ?? 0;
  useEffect(() => {
    if (!playingId || playerDuration <= 0) return;
    const row = libRows.find(r => r.id === playingId);
    if (!row || row.durationSeconds != null || !row.audio?.dropboxPath) return;
    const seconds = Math.round(playerDuration);
    if (!(seconds > 0 && seconds < 86400)) return;
    const key = row.audio.dropboxPath;
    if (durationLearned.has(key)) return;
    durationLearned.add(key); // guard immediately against duplicate fires
    fetch("/api/red-artists/track-duration", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: row.id, dropboxPath: key, durationSeconds: seconds }),
    })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(() => {
        setLibRows(rows => rows.map(r => (r.id === row.id ? { ...r, durationSeconds: seconds } : r)));
      })
      .catch(() => { durationLearned.delete(key); }); // allow a later retry
  }, [playingId, playerDuration, libRows]);

  return (
    <div dir="rtl" style={{ minHeight: "100%", background: "#0A0A0B", color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", overflowX: "hidden", padding: isMobile ? "18px 12px 28px" : "30px 24px 140px" }}>
      {/* Centered premium island — intentionally NOT full-width (black breathing room around) */}
      <div style={{ maxWidth: 1400, margin: "0 auto", width: "100%" }}>

        {/* Responsive grids: "המוזיקה שלי" gets priority width; everything stacks on small screens. */}
        <style>{`
          .rap-grid-a { display: grid; gap: 18px; align-items: start; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
          .rap-acts   { display: grid; gap: 17px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
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
            <NewsFlash />
          </PortalHero>
        ) : tab === "המוזיקה שלי" ? (
          <PortalHero title="המוזיקה שלי" badge="♫" subtitle="כל השירים, הסקיצות, המיקסים והמאסטרים במקום אחד" />
        ) : tab === "לו״ז ועדכונים" ? (
          <PortalHero title="הזמינות שלי" subtitle="זמינות לשבוע הבא" />
        ) : tab === "ההופעות שלי" ? (
          <PortalHero title="ההופעות שלי" subtitle="כל ההופעות הקרובות וההופעות שבוצעו במקום אחד" />
        ) : tab === "מאזן" ? (
          <PortalHero title="מאזן" subtitle="הכנסות, הוצאות והיסטוריית תשלומים" />
        ) : (
          <PortalHero title={tab} subtitle="האזור הזה יוצג בקרוב" />
        )}

        <div style={{ marginTop: 20 }}>
          {tab === "בית" ? <HomeDashboard onOpenMusic={() => setTab("המוזיקה שלי")} musicRows={libRows} loadState={libState} summary={summary} summaryState={summaryState} />
            : tab === "המוזיקה שלי" ? <MyMusicPage rows={libRows} loadState={libState} />
            : tab === "ההופעות שלי" ? <ShowsPage summary={summary} loadState={summaryState} />
            : tab === "לו״ז ועדכונים" ? <AvailabilityPage />
            : tab === "מאזן" ? <BalancePage summary={summary} loadState={summaryState} />
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

// ── מאזן (balance tab) — REAL artist finance (Shalev's "שכר אמן" show fees only).
// No mock: numbers come from GET /api/red-artists/shalev-summary (server-scoped).
// Income = artist-fee transactions (שולם/צפוי). Expenses have NO trusted source
// yet → shown as "—", never invented. See [[redbloods-red-artists-boundary]].
const BAL_INCOME_RED = "#F87171";

function BalancePage({ summary, loadState }: { summary: ShalevSummary | null; loadState: LoadState }) {
  const isMobile = useIsMobile();

  if (loadState === "loading") {
    return <div style={{ ...panel, padding: "48px 24px", textAlign: "center", fontSize: 13.5, color: TEXT2 }}>טוען…</div>;
  }
  if (loadState === "error") {
    return <div style={{ ...panel, padding: "48px 24px", textAlign: "center", fontSize: 13.5, color: TEXT2 }}>לא ניתן לטעון נתונים כספיים כרגע</div>;
  }
  const bal = summary?.balance;
  if (!bal || !bal.hasData) {
    return (
      <div style={{ ...panel, padding: "52px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 30, opacity: 0.3, marginBottom: 10 }}>₪</div>
        <div style={{ fontSize: 14, color: TEXT2 }}>אין עדיין נתונים כספיים זמינים</div>
      </div>
    );
  }

  const curr     = bal.currency || "₪";
  const paid     = bal.paidTotal;
  const expected = bal.expectedTotal;
  const balColor = paid > 0 ? GREEN : paid < 0 ? BAL_INCOME_RED : "#E5E5EA";

  // Income cards are real; expense cards have no trusted source → "—" + note.
  const cards: { label: string; value: string; sub: string; color: string }[] = [
    { label: "שולם לי",       value: fmtMoney(paid, curr),     sub: "התקבל בפועל",             color: GREEN },
    { label: "צפוי לי",        value: fmtMoney(expected, curr), sub: "מאושר, טרם התקבל",        color: AMBER },
    { label: "הוצאות ששולמו", value: "—",                      sub: "עדיין לא חובר למקור אמת", color: TEXT2 },
    { label: "הוצאות צפויות",  value: "—",                      sub: "עדיין לא חובר למקור אמת", color: TEXT2 },
  ];

  const histCols = "120px minmax(0, 1.8fr) 120px";
  const histHeads = ["תאריך", "הופעה", "סכום"];
  const payments = bal.payments;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20 }}>

      {/* current balance = money actually paid to Shalev */}
      <div style={{
        ...panel, padding: isMobile ? "26px 18px" : "34px 24px", textAlign: "center",
        background: `radial-gradient(120% 140% at 50% -10%, rgba(220,38,38,0.20) 0%, rgba(220,38,38,0.05) 42%, #121012 74%), linear-gradient(180deg, #161617 0%, #111112 100%)`,
        border: `1px solid rgba(220,38,38,0.30)`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 60px rgba(220,38,38,0.12), 0 14px 34px rgba(0,0,0,0.4)`,
      }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT2 }}>מאזן נוכחי</div>
        <div style={{ fontSize: isMobile ? 40 : 52, fontWeight: 900, color: balColor, letterSpacing: "-0.03em", marginTop: 6, direction: "ltr", textShadow: "0 2px 22px rgba(0,0,0,0.5)" }}>{fmtMoney(paid, curr)}</div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>סה״כ שולם לך עד כה</div>
      </div>

      {/* 4 summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: isMobile ? 10 : 16 }}>
        {cards.map(c => (
          <div key={c.label} style={{ ...panel, padding: isMobile ? "16px 14px" : "20px 22px" }}>
            <div style={{ fontSize: isMobile ? 13 : 14.5, fontWeight: 800, color: TEXT }}>{c.label}</div>
            <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900, color: c.color, direction: "ltr", textAlign: "start", marginTop: 8 }}>{c.value}</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* payment history — real "שולם" transactions only */}
      <div style={panel}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: isMobile ? "16px 16px" : "18px 24px", borderBottom: `1px solid ${BDR}` }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
          <span style={{ fontSize: isMobile ? 15.5 : 17.5, fontWeight: 800, color: TEXT }}>היסטוריית תשלומים</span>
        </div>

        {payments.length === 0 ? (
          <div style={{ padding: "34px 24px", textAlign: "center", fontSize: 13.5, color: TEXT2 }}>אין עדיין תשלומים שהתקבלו</div>
        ) : isMobile ? (
          <div style={{ padding: "2px 0 6px" }}>
            {payments.map((h, i) => (
              <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderBottom: i < payments.length - 1 ? `1px solid ${BDR}` : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.description}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 3, direction: "ltr", textAlign: "start" }}>{fmtShowDate(h.date)}</div>
                </div>
                <div style={{ textAlign: "start", flexShrink: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 900, color: GREEN, direction: "ltr" }}>{fmtMoney(h.amount, h.currency)}</div>
                  <div style={{ fontSize: 10.5, color: GREEN, marginTop: 3 }}>התקבל</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: histCols, gap: 10, padding: "12px 24px", borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.015)" }}>
              {histHeads.map((h, i) => (
                <div key={i} style={{ fontSize: 12, fontWeight: 800, color: "#9A9AA6", letterSpacing: "0.04em", textTransform: "uppercase", textAlign: i === 2 ? "center" : "start" }}>{h}</div>
              ))}
            </div>
            {payments.map((h, i) => (
              <div key={h.id} style={{ display: "grid", gridTemplateColumns: histCols, gap: 10, alignItems: "center", padding: "14px 24px", borderBottom: i < payments.length - 1 ? `1px solid ${BDR}` : "none" }}>
                <div style={{ fontSize: 12.5, color: "#CFCFD6", direction: "ltr", textAlign: "start", fontFamily: "ui-monospace, Menlo, monospace" }}>{fmtShowDate(h.date)}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, textAlign: "start", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.description}</div>
                <div style={{ fontSize: 14, fontWeight: 900, color: GREEN, direction: "ltr", textAlign: "center" }}>{fmtMoney(h.amount, h.currency)}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
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

function AvailabilityPage() {
  const isMobile = useIsMobile();
  // Start with day names + blank dates (identical on server & client → no
  // hydration mismatch); fill the real dates after mount.
  const [days, setDays] = useState<AvailDay[]>(() => HEB_DAYS.map(day => ({ day, date: "", available: false, from: "" })));
  useEffect(() => { setDays(computeNextWeek()); }, []);
  const [sent, setSent] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null); // day being edited in the modal

  const saveDay = (i: number, patch: { available: boolean; from: string }) => {
    setDays(ds => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
    setEditIdx(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* section header */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
        <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>השבוע הבא</span>
        <span style={{ fontSize: 12, color: MUTED, marginInlineStart: 4 }}>לחצו על יום כדי לעדכן זמינות</span>
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
        <button onClick={() => setSent(true)} style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "14px 26px", borderRadius: 12, border: "none", color: "#fff", fontSize: 14.5, fontWeight: 800,
          fontFamily: "inherit", cursor: "pointer", boxShadow: `0 4px 16px rgba(220,38,38,0.32)`,
          background: "linear-gradient(180deg, #E5322F, #C01C1C)", width: isMobile ? "100%" : "auto",
        }}>שלח זמינות לשבוע הבא</button>
        {sent && <span style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>✓ הזמינות נשלחה (הדגמה)</span>}
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
function MusicStatus({ status }: { status: string }) {
  const c = MUSIC_STATUS_COLOR[status] ?? "#9CA3AF";
  return <span style={{ fontSize: 11, fontWeight: 800, color: c, background: `${c}24`, border: `1px solid ${c}5A`, borderRadius: 8, padding: "4px 11px", whiteSpace: "nowrap" }}>{status}</span>;
}

function MyMusicPage({ rows, loadState }: { rows: LibRow[]; loadState: "loading" | "ready" | "error" }) {
  const isMobile = useIsMobile();

  // Upload modal: {mode:"new"} = blank target (header button); {mode:"update"}
  // = row action, target pre-selected & locked. UI-only (no backend wired yet).
  const [modal, setModal] = useState<{ mode: "new" | "update"; target: string | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  // rows + loadState come from the page-level single source (getShalevMusicProjects).
  // Show 6 first; "הצג עוד" reveals more (6 → 10 → all).
  const [visibleCount, setVisibleCount] = useState(6);
  const displayRows = rows.slice(0, visibleCount);
  const hasMore = visibleCount < rows.length;
  const showMore = () => setVisibleCount(c => (c < 10 ? 10 : rows.length));

  const player = usePlayerSafe();

  // Real KPIs from the shared library — no demo numbers. "—" until loaded; only
  // metrics we can derive with confidence (count + audio + real ProjectStatus).
  const ready = loadState === "ready";
  const kpis: { label: string; value: string | number; icon: string }[] = [
    { label: "סה״כ שירים", value: ready ? rows.length : "—", icon: "♫" },
    { label: "עם אודיו",   value: ready ? rows.filter(r => r.hasAudio).length : "—", icon: "▶" },
    { label: "בעבודה",     value: ready ? rows.filter(r => r.status === "בעבודה").length : "—", icon: "✎" },
    { label: "הושלמו",     value: ready ? rows.filter(r => r.status === "הושלם").length : "—", icon: "✓" },
  ];

  // grid template shared EXACTLY by the library header + every row (RTL: play on the
  // right in its own fixed column, then name, then the technical columns).
  // Play fixed · שם השיר wide (the focus) · type a touch narrower · status/date/
  // duration/options fixed & snug so columns sit tight under their headers.
  // Play (fixed, no header) · שם השיר (wide) · אמן/משתתפים · סטטוס · משך.
  const cols = "52px minmax(0, 1.7fr) minmax(0, 1.1fr) 130px 72px";
  const heads: { label: string; align: "start" | "center" }[] = [
    { label: "",              align: "center" }, // play column (no header)
    { label: "שם השיר",       align: "start"  },
    { label: "אמן / משתתפים", align: "start"  },
    { label: "סטטוס",         align: "center" },
    { label: "משך",           align: "center" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── KPI row (desktop: cards · mobile: compact 4-up strip, no icons) ── */}
      {isMobile ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {kpis.map(k => (
            <div key={k.label} style={{
              background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, borderRadius: 12,
              padding: "10px 6px", textAlign: "center", minWidth: 0,
            }}>
              <div style={{ fontSize: 21, fontWeight: 900, color: TEXT, lineHeight: 1.1 }}>{k.value}</div>
              <div style={{ fontSize: 10.5, color: TEXT2, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{KPI_SHORT[k.label] ?? k.label}</div>
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
              <span style={{ width: 50, height: 50, borderRadius: 14, flexShrink: 0, background: "rgba(220,38,38,0.13)", border: `1px solid ${BRAND}44`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{k.icon}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── library (full width) ── */}
      <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: isMobile ? "16px 16px" : "18px 24px", borderBottom: `1px solid ${BDR}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
              <span style={{ fontSize: isMobile ? 15.5 : 17.5, fontWeight: 800, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>ספריית השירים שלי</span>
            </div>
            {/* upload — opens the upload modal (blank target). Compact header action. */}
            <button onClick={() => setModal({ mode: "new", target: null })} style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0,
              padding: isMobile ? "8px 12px" : "7px 13px", borderRadius: 9, border: "none", color: "#fff",
              background: "linear-gradient(180deg, #E5322F, #C01C1C)", fontSize: isMobile ? 12 : 12.5, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", boxShadow: `0 2px 9px rgba(220,38,38,0.26)`,
            }}><IcUpload size={14} /> העלאת קובץ</button>
          </div>

          {/* column header — desktop only (mobile uses cards). No inner scroll:
              the table renders inline and "הצג עוד" simply grows it in the page. */}
          {!isMobile && (
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "13px 24px", borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.015)" }}>
            {heads.map((h, i) => (
              <div key={i} style={{ fontSize: 12, fontWeight: 800, color: "#9A9AA6", letterSpacing: "0.05em", textTransform: "uppercase", textAlign: h.align }}>{h.label}</div>
            ))}
          </div>
          )}

          {/* rows — desktop: shared grid (aligned columns); mobile: stacked cards */}
          <div style={{ padding: isMobile ? "2px 0 6px" : "6px 0 8px" }}>
            {loadState === "loading" ? (
              <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13.5, color: MUTED }}>טוען…</div>
            ) : loadState === "error" ? (
              <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13.5, color: MUTED }}>לא ניתן לטעון את הספרייה כרגע</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: "48px 24px", textAlign: "center", fontSize: 13.5, color: MUTED }}>לא נמצאו פרויקטים שמקושרים לשליו טסמה</div>
            ) : isMobile ? (
              displayRows.map(t => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: `1px solid ${BDR}` }}>
                  {/* play (rightmost in RTL) — visual only for now */}
                  <LibRowPlay size={42} player={player} row={t} onError={setToast} />
                  {/* name + artist + status (no "שיר"/type subtitle) */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl" }}>{t.artist}</div>
                    <div style={{ marginTop: 7 }}><MusicStatus status={t.status} /></div>
                  </div>
                  {/* duration (leftmost) — none yet */}
                  <span style={{ fontSize: 12, color: "#CFCFD6", direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace", flexShrink: 0 }}>{t.durationSeconds != null ? mmss(t.durationSeconds) : "—"}</span>
                </div>
              ))
            ) : (
              displayRows.map(t => (
                <div key={t.id} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                  style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "15px 24px", border: "1px solid transparent", transition: "all .14s" }}>
                  {/* play (right column — no header) — visual only for now */}
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <LibRowPlay size={42} player={player} row={t} onError={setToast} />
                  </div>
                  {/* name only (no "שיר"/type subtitle in the music tab) */}
                  <div style={{ minWidth: 0, textAlign: "start" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#FFFFFF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                  </div>
                  {/* artist / participants */}
                  <div style={{ fontSize: 13, color: "#CFCFD6", textAlign: "start", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.artist}</div>
                  {/* status */}
                  <div style={{ textAlign: "center" }}><MusicStatus status={t.status} /></div>
                  {/* duration — none yet */}
                  <div style={{ fontSize: 12.5, color: "#CFCFD6", direction: "ltr", textAlign: "center", fontFamily: "ui-monospace, Menlo, monospace" }}>{t.durationSeconds != null ? mmss(t.durationSeconds) : "—"}</div>
                </div>
              ))
            )}
          </div>
          {loadState === "ready" && rows.length > 0 && (
            hasMore ? (
              <button onClick={showMore} style={{ ...linkBtn, display: "block", width: "100%", textAlign: "center", padding: "14px 0", fontWeight: 700, borderTop: `1px solid ${BDR}` }}>הצג עוד ⌄</button>
            ) : (
              <div style={{ textAlign: "center", padding: "14px 0", fontSize: 12.5, color: MUTED, borderTop: `1px solid ${BDR}` }}>הוצגו כל השירים</div>
            )
          )}
      </div>

      {/* Internal mock player removed. TODO: wire row Play buttons to the app's
          GLOBAL player (already synced across the system) instead of a portal-local
          one — no extra player inside Red Artists. */}

      {/* upload modal + demo toast */}
      <UploadModal modal={modal} onClose={() => setModal(null)} onToast={setToast} />
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

// ── Home dashboard ───────────────────────────────────────────────────────────────
function HomeDashboard({ onOpenMusic, musicRows, loadState, summary, summaryState }: { onOpenMusic: () => void; musicRows: LibRow[]; loadState: LoadState; summary: ShalevSummary | null; summaryState: LoadState }) {
  const isMobile = useIsMobile();
  const player = usePlayerSafe();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── "מה מחכה לך עכשיו" ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>מה מחכה לך עכשיו</span>
        </div>
        <div className="rap-acts">
          <ActionCard icon="📅" title="סשן קרוב" body="פגישת אמן והפקה" sub="08.06.2025 · יום ראשון · 18:00" cta="פרטים" link="יומן מלא ←" />
          {(() => {
            const next  = summary?.shows.upcoming?.[0];
            const total = summary?.shows.upcoming?.length ?? 0;
            return next ? (
              <ActionCard icon="🎤" title="הופעות קרובות" body={next.name} sub={[fmtShowDate(next.date), next.startTime, next.location].filter(Boolean).join(" · ")} cta="פרטים" link={total > 1 ? "לכל ההופעות ←" : "יומן מלא ←"} />
            ) : (
              <ActionCard icon="🎤" title="הופעות קרובות" body={summaryState === "loading" ? "טוען…" : "אין הופעות קרובות כרגע"} cta="יומן מלא" />
            );
          })()}
        </div>
      </div>

      {/* ── 3. Main grid (row A) — music-forward in RTL: המוזיקה שלי (right) → ביטים → מאזן ── */}
      <div className="rap-grid-a">

        {/* המוזיקה שלי — up to 4 real projects from the shared source (no demo) */}
        <SectionCard title="המוזיקה שלי">
          <div style={{ padding: "8px 12px 6px" }}>
            {loadState === "loading" ? (
              <div style={{ padding: "22px 8px", textAlign: "center", fontSize: 12.5, color: MUTED }}>טוען…</div>
            ) : musicRows.length === 0 ? (
              <div style={{ padding: "22px 8px", textAlign: "center", fontSize: 12.5, color: MUTED }}>עדיין אין שירים אמיתיים בספרייה</div>
            ) : (
              musicRows.slice(0, 4).map(t => (
                <div key={t.id} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 12px", borderRadius: 13, border: "1px solid transparent", transition: "all .14s" }}>
                  {/* play (rightmost in RTL) — visual only for now */}
                  <LibRowPlay size={36} player={player} row={t} />
                  {/* name + artist */}
                  <div style={{ textAlign: "start", minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.artist}</div>
                  </div>
                  {/* status pushed to the left edge */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginInlineStart: "auto" }}>
                    <MusicStatus status={t.status} />
                  </div>
                </div>
              ))
            )}
            <button onClick={onOpenMusic} style={{ ...linkBtn, display: "block", width: "100%", textAlign: "start", padding: "10px 4px 6px" }}>לכל השירים והסקיצות ←</button>
          </div>
        </SectionCard>

        {/* מאזן (artist-only, REAL: paid/expected show fees — NO split, NO expenses source) */}
        <SectionCard title="מאזן">
          <div style={{ padding: "14px 18px 18px" }}>
            {summaryState !== "ready" || !summary?.balance?.hasData ? (
              <div style={{ padding: "18px 4px", fontSize: 12.5, color: MUTED, textAlign: "center" }}>
                {summaryState === "loading" ? "טוען…" : "אין עדיין נתונים כספיים"}
              </div>
            ) : (
              <>
                <BalanceRow label="שולם לי" value={fmtMoney(summary.balance.paidTotal, summary.balance.currency)} color={GREEN} icon="↑" />
                <BalanceRow label="צפוי לי" value={fmtMoney(summary.balance.expectedTotal, summary.balance.currency)} color={TEXT} icon="↓" />
                {/* Net balance = money actually received — highlighted */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 12,
                  padding: "13px 14px", borderRadius: 13,
                  background: "linear-gradient(180deg, rgba(220,38,38,0.12), rgba(220,38,38,0.04))",
                  border: `1px solid ${BRAND}44`,
                }}>
                  <span style={{ fontSize: 13, color: "#E8B7B7", fontWeight: 700 }}>מאזן נוכחי</span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: "#FF6B6B", direction: "ltr" }}>{fmtMoney(summary.balance.paidTotal, summary.balance.currency)}</span>
                </div>
              </>
            )}
          </div>
        </SectionCard>
      </div>

      {/* ── 3. Weekly calendar (full width) ── */}
      <WeeklyCalendar />

      {/* ── 4. עדכונים מהלייבל (full width) ── */}
      <SectionCard title="עדכונים מהלייבל" link="לכל העדכונים ←">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "0 28px", padding: "8px 18px 12px" }}>
          {UPDATES.map(u => (
            <div key={u} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 4px", borderBottom: `1px solid ${BDR}` }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: BRAND, marginTop: 6, flexShrink: 0, boxShadow: `0 0 7px ${BRAND}` }} />
              <span style={{ fontSize: 12.5, color: "#C4C4C8", lineHeight: 1.55 }}>{u}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

// ── Weekly calendar (יומן האמן) — 7-day premium week view ─────────────────────────
function campChip(c: string): React.CSSProperties {
  return { fontSize: 11, fontWeight: 700, color: c, background: `${c}14`, border: `1px solid ${c}3D`, borderRadius: 8, padding: "5px 11px", whiteSpace: "nowrap" };
}

const weekArrow: React.CSSProperties = {
  width: 30, height: 30, alignSelf: "center", flexShrink: 0, borderRadius: "50%",
  background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`, color: TEXT2,
  fontSize: 16, cursor: "pointer", fontFamily: "inherit",
};

function WeeklyCalendar() {
  const isMobile = useIsMobile();
  return (
    <div style={panel}>
      {/* header + subtitle */}
      <div style={{ padding: "16px 22px", borderBottom: `1px solid ${BDR}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
          <span style={{ fontSize: 16, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>יומן השבוע</span>
        </div>
        <div style={{ fontSize: 12, color: TEXT2, marginTop: 5 }}>הצצה לפגישות, משימות ושידורים הקרובים שלך</div>
      </div>

      {isMobile ? (
        /* Mobile: clean vertical list — no horizontal scroll, nothing clipped */
        <div style={{ padding: "8px 16px 12px", display: "flex", flexDirection: "column" }}>
          {WEEK.map((d, i) => {
            const has = d.events.length > 0;
            const sel = d.selected;
            return (
              <div key={d.day} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 2px", borderBottom: i === WEEK.length - 1 ? "none" : `1px solid ${BDR}` }}>
                {/* date block (right) */}
                <div style={{ width: 58, flexShrink: 0, textAlign: "center", padding: "7px 0", borderRadius: 11, background: sel ? "rgba(220,38,38,0.10)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? BRAND + "55" : BDR}` }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: sel || has ? "#fff" : TEXT2 }}>{d.day}</div>
                  <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2, direction: "ltr" }}>{d.date}</div>
                </div>
                {/* content (grows) */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
                  {has ? d.events.map(ev => {
                    const c = CAL_TYPE_COLOR[ev.type];
                    return (
                      <div key={ev.title} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0, boxShadow: `0 0 6px ${c}` }} />
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</span>
                        <span style={{ marginInlineStart: "auto", fontSize: 11.5, color: TEXT2, direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace", flexShrink: 0 }}>{ev.time}</span>
                      </div>
                    );
                  }) : (
                    <span style={{ fontSize: 12.5, color: MUTED }}>אין אירועים</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Desktop: arrows + 7-day grid carousel */
        <div style={{ display: "flex", alignItems: "stretch", gap: 8, padding: "16px 14px 8px" }}>
          <button style={weekArrow} aria-label="שבוע קודם">›</button>
          <div style={{ flex: 1, overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 10, minWidth: 720 }}>
              {WEEK.map(d => {
                const has = d.events.length > 0;
                const sel = d.selected;
                return (
                  <div key={d.day} style={{
                    borderRadius: 14, minHeight: 128, display: "flex", flexDirection: "column",
                    border: `1px solid ${sel ? BRAND : (has ? "rgba(220,38,38,0.18)" : BDR)}`,
                    background: sel ? "rgba(220,38,38,0.07)" : "rgba(255,255,255,0.012)",
                    boxShadow: sel ? `0 0 16px rgba(220,38,38,0.18)` : "none",
                  }}>
                    <div style={{ textAlign: "center", padding: "10px 6px 8px" }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: sel || has ? "#fff" : TEXT2 }}>{d.day}</div>
                      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2, direction: "ltr" }}>{d.date}</div>
                    </div>
                    <div style={{ flex: 1, padding: "0 9px 12px", display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
                      {has ? d.events.map(ev => {
                        const c = CAL_TYPE_COLOR[ev.type];
                        return (
                          <div key={ev.title} style={{ textAlign: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0, boxShadow: `0 0 6px ${c}` }} />
                              <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{ev.title}</span>
                            </div>
                            <div style={{ fontSize: 11, color: TEXT2, marginTop: 3, direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace" }}>{ev.time}</div>
                          </div>
                        );
                      }) : (
                        <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: MUTED }}>---</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <button style={weekArrow} aria-label="שבוע הבא">‹</button>
        </div>
      )}

      {/* campaign-of-the-week strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "14px 20px", borderTop: `1px solid ${BDR}`, background: "rgba(220,38,38,0.035)" }}>
        <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: "rgba(220,38,38,0.14)", border: `1px solid ${BRAND}55`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>📣</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: "#FF6B6B", letterSpacing: "0.03em" }}>קמפיין השבוע</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginTop: 2 }}>{CAMPAIGN.name}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginInlineStart: "auto" }}>
          <span style={campChip(TEXT2)}>{CAMPAIGN.total}</span>
          <span style={campChip("#F59E0B")}>{CAMPAIGN.pending}</span>
          <span style={campChip("#60A5FA")}>{CAMPAIGN.scheduled}</span>
        </div>
      </div>
    </div>
  );
}

// ── Artist avatar — shows initial "ש" or an uploaded profile image ────────────────
//    Upload goes to an isolated Dropbox folder via /api/red-artists/profile-image.
//    The chosen path is remembered in localStorage (demo persistence — no DB).
const AVATAR_KEY  = "rb_artist_avatar_path_shalev";
const AVATAR_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
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
    if (!AVATAR_MIME.includes(file.type)) { notify("סוג קובץ לא נתמך — jpg / png / webp בלבד"); return; }
    if (file.size > 5 * 1024 * 1024)      { notify("הקובץ גדול מדי (מקסימום 5MB)"); return; }
    // New image → its own crop (defaults). The untouched original is uploaded to
    // Dropbox on save, so a later re-open (any device) edits the true source.
    clearAvatarEdit();
    setEditing({ file });
  }

  // Upload the cropped blob (from the editor's "שמירה") to the existing endpoint.
  // Returns true on success. Always resolves (30s abort timeout) so the editor
  // can never hang on "שומר…". Real errors are logged to the console.
  async function doUpload(blob: Blob, meta: SaveMeta): Promise<boolean> {
    setBusy(true);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 45000); // two uploads (avatar + maybe the original)
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
      const res  = await fetch("/api/red-artists/profile-image", { method: "POST", body: fd, signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        console.error("[red-artists/avatar] upload failed:", res.status, data);
        notify(data.error ?? "השמירה נכשלה, נסה שוב");
        return false;
      }
      const p = data.path as string;
      // Diagnostic: confirms the real path_display vs AVATAR_PATH (cross-device sync).
      console.info("[red-artists/avatar] saved path:", p, "| AVATAR_PATH:", AVATAR_PATH, "| match:", p === AVATAR_PATH);
      avatarPathCache = p;
      avatarVerCache  = Date.now();              // bump only on success → forces the overwritten image to reload
      try { localStorage.setItem(AVATAR_KEY, p); } catch { /* ignore */ }
      setPath(p);
      setVer(avatarVerCache);
      notify("תמונת הפרופיל עודכנה");
      return true;
    } catch (e) {
      console.error("[red-artists/avatar] upload error:", e);
      notify(ctrl.signal.aborted ? "השמירה נכשלה (timeout), נסה שוב" : "השמירה נכשלה, נסה שוב");
      return false;
    } finally {
      clearTimeout(to);
      setBusy(false);
    }
  }

  const src = path ? `/api/dropbox/stream?path=${encodeURIComponent(path)}${ver ? `&t=${ver}` : ""}` : null;

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
          onNotify={notify}
          onCancel={() => setEditing(null)}
          onSave={async (blob, meta) => { const ok = await doUpload(blob, meta); if (ok) setEditing(null); return ok; }}
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

function AvatarEditor({ initialFile, initialUrl, onNotify, onCancel, onSave }: {
  initialFile?: File; initialUrl?: string;
  onNotify: (m: string) => void; onCancel: () => void; onSave: (blob: Blob, meta: SaveMeta) => Promise<boolean>;
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
      imgRef.current = null; setLoaded(false); onNotify("טעינת התמונה נכשלה — נסה להעלות תמונה חדשה");
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

  // Esc = cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

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
    if (!AVATAR_MIME.includes(f.type)) { onNotify("סוג קובץ לא נתמך — jpg / png / webp בלבד"); return; }
    if (f.size > 5 * 1024 * 1024)      { onNotify("הקובץ גדול מדי (מקסימום 5MB)"); return; }
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
    if (saving) return;
    const img = imgRef.current;
    if (!img) { onNotify("אין תמונה לשמירה"); return; }
    setSaving(true);
    try {
      const blob = await renderBlob(img);
      // originalFile only for a freshly picked/replaced image → the server stores
      // it as the re-editing source; a plain re-crop keeps the existing original.
      const ok = await onSave(blob, { zoom, offset, originalFile: file, originalFileName: file?.name ?? null });
      if (ok) saveAvatarEdit(zoom, offset);   // refresh the localStorage cache (Dropbox is the source of truth)
      else onNotify("השמירה נכשלה, נסה שוב");
    } catch (e) {
      console.error("[avatar-editor] save failed:", e);
      onNotify("השמירה נכשלה, נסה שוב");
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
function NewsFlash() {
  const [idx, setIdx]   = useState(0);
  const [show, setShow] = useState(true);
  const isMobile = useIsMobile();

  function advance() {
    setShow(false);
    setTimeout(() => { setIdx(i => (i + 1) % FLASH.length); setShow(true); }, 300);
  }

  useEffect(() => {
    const t = setInterval(advance, 4600);
    return () => clearInterval(t);
  }, []);

  const cur = FLASH[idx];
  const fade: React.CSSProperties = { opacity: show ? 1 : 0, transition: "opacity .3s ease" };
  // Mobile: clamp to 2 lines (readable, full sentence) with a stable height so
  // the capsule doesn't jump between rotations. Desktop: single line + ellipsis.
  const textStyle: React.CSSProperties = isMobile
    ? { fontSize: 14, fontWeight: 700, color: "#fff", lineHeight: 1.35, minHeight: "2.7em", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as React.CSSProperties
    : { fontSize: 15.5, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

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
          <div style={textStyle}>{cur.text}</div>
          {isMobile && <div style={{ fontSize: 11, color: MUTED, marginTop: 4, ...fade }}>{cur.time}</div>}
        </div>
        {!isMobile && <span style={{ fontSize: 12, color: MUTED, whiteSpace: "nowrap", flexShrink: 0, ...fade }}>{cur.time}</span>}
        <button onClick={advance} aria-label="העדכון הבא" style={{ background: "none", border: "none", color: TEXT2, fontSize: 20, cursor: "pointer", flexShrink: 0, alignSelf: isMobile ? "flex-start" : "center", lineHeight: 1, padding: "0 2px" }}>‹</button>
      </div>
      {/* thin red progress bar (restarts each rotation) */}
      <div key={idx} style={{ position: "absolute", bottom: 0, insetInlineStart: 0, height: 2.5, background: BRAND, boxShadow: `0 0 8px ${BRAND}`, borderRadius: 2, animation: "rapProgress 4.6s linear" }} />
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────────
function ActionCard({ icon, title, body, sub, tag, cta, link, primary }: {
  icon: string; title: string; body: string; sub?: string; tag?: string; cta: string; link?: string; primary?: boolean;
}) {
  const ctaStyle: React.CSSProperties = primary ? {
    borderRadius: 12, border: "none", color: "#fff",
    background: "linear-gradient(180deg, #E5322F, #C01C1C)",
    fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 4px 16px rgba(220,38,38,0.32)`,
  } : {
    borderRadius: 12, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`,
    color: TEXT, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  };
  return (
    <div
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = "rgba(220,38,38,0.35)"; e.currentTarget.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.05), 0 18px 40px rgba(0,0,0,0.5)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = BDR2; e.currentTarget.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.04), 0 14px 34px rgba(0,0,0,0.4)"; }}
      style={{ ...panel, padding: "24px 24px 22px", display: "flex", flexDirection: "column", gap: 14, minHeight: 210, transition: "transform .16s, border-color .16s, box-shadow .16s" }}>
      <div style={{ width: 52, height: 52, borderRadius: 15, background: "linear-gradient(180deg, rgba(220,38,38,0.18), rgba(220,38,38,0.08))", border: `1px solid ${BRAND}44`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16.5, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>{title}</div>
        <div style={{ fontSize: 13.5, color: TEXT2, marginTop: 6, lineHeight: 1.55 }}>{body}</div>
        {sub && <div style={{ fontSize: 12, color: MUTED, marginTop: 5, direction: "ltr", textAlign: "right", fontFamily: "ui-monospace, Menlo, monospace" }}>{sub}</div>}
        {tag && <span style={{ display: "inline-block", marginTop: 10, fontSize: 11, fontWeight: 700, color: AMBER, background: `${AMBER}18`, border: `1px solid ${AMBER}40`, borderRadius: 7, padding: "3px 11px" }}>{tag}</span>}
      </div>
      {link ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <button style={{ ...ctaStyle, padding: "11px 22px" }}>{cta}</button>
          <button style={{ ...linkBtn, color: "#FF6B6B", fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap" }}>{link}</button>
        </div>
      ) : (
        <button style={{ ...ctaStyle, padding: "11px 0" }}>{cta}</button>
      )}
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
function UploadModal({ modal, onClose, onToast }: {
  modal: { mode: "new" | "update"; target: string | null } | null;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const isMobile = useIsMobile();
  const open = !!modal;
  // "new" = סקיצה חדשה (create a new draft) · "update" = עדכון קובץ לשיר קיים.
  const [tab, setTab]           = useState<"new" | "update">("new");
  const [song, setSong]         = useState("");
  const [songOpen, setSongOpen] = useState(false);
  const [file, setFile]         = useState<File | null>(null);
  const [note, setNote]         = useState("");
  const [skitchName, setSkitch] = useState("");
  const [lyrics, setLyrics]     = useState("");
  const [drag, setDrag]         = useState(false);
  const fileRef  = useRef<HTMLInputElement>(null);
  const songBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setTab(modal!.mode === "update" ? "update" : "new");
      setSong(modal?.target ?? ""); setSongOpen(false); setFile(null); setNote(""); setSkitch(""); setLyrics(""); setDrag(false);
    }
  }, [open, modal?.target, modal?.mode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Close the custom song dropdown on outside click (native <select> popups
  // render an OS-white list that breaks the dark theme — so we use our own).
  useEffect(() => {
    if (!songOpen) return;
    const onDown = (e: MouseEvent) => {
      if (songBoxRef.current && !songBoxRef.current.contains(e.target as Node)) setSongOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [songOpen]);

  if (!open || typeof document === "undefined") return null;
  // Song target is locked only when the modal was opened from a row's "עדכן קובץ".
  const lockedSong = modal!.mode === "update";
  const canSubmit  = tab === "new"
    ? (skitchName.trim() !== "" && !!file)
    : (song.trim() !== "" && !!file);

  const submit = () => {
    if (!canSubmit) return;
    onClose();
    onToast(tab === "new"
      ? "הסקיצה נקלטה (הדגמה) — חיבור העלאה אמיתי ממתין לאישור"
      : "היעד והקובץ נקלטו (הדגמה) — חיבור העלאה אמיתי ממתין לאישור");
  };

  // ── Shared "design system" so both modes render identically (esp. on mobile):
  // same label spacing, same section gap, same control/textarea/dropzone height. ──
  const sectionGap = isMobile ? 15 : 16;
  const ctrlH      = isMobile ? 46 : undefined;   // input / dropdown / locked field
  const taH        = isMobile ? 84 : undefined;   // every textarea
  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: TEXT2, marginBottom: isMobile ? 7 : 8 };
  const section: React.CSSProperties = { marginBottom: sectionGap };
  const field: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.03)",
    border: `1px solid ${BDR2}`, borderRadius: 11, color: TEXT, fontSize: 14,
    fontFamily: "inherit", padding: "13px 14px", outline: "none", colorScheme: "dark", minHeight: ctrlH,
  };
  const textareaStyle: React.CSSProperties = { ...field, minHeight: undefined, height: taH, resize: "none", lineHeight: 1.5 };

  // Shared blocks reused by both tabs.
  const filePicker = (
    <div style={section}>
      <div style={label}>בחר קובץ</div>
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); setFile(e.dataTransfer.files?.[0] ?? null); }}
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
          padding: isMobile ? "24px 14px" : "30px 14px", borderRadius: 13, cursor: "pointer", textAlign: "center",
          border: `1.5px dashed ${drag ? BRAND : BDR2}`, background: drag ? "rgba(220,38,38,0.08)" : "rgba(255,255,255,0.02)",
          transition: "all .14s",
        }}>
        <IcCloud size={26} color={drag ? "#FF6B6B" : TEXT2} />
        {file ? (
          <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
        ) : (
          <>
            <div style={{ fontSize: 13.5, color: TEXT2 }}>{isMobile ? "לחץ לבחירה" : "גרור קובץ לכאן או לחץ לבחירה"}</div>
            <div style={{ fontSize: 11, color: MUTED, direction: "ltr" }}>MP3, WAV, AIFF, M4A עד 500MB</div>
          </>
        )}
      </div>
      <input ref={fileRef} type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ display: "none" }} />
    </div>
  );

  const noteBlock = (labelText: string, ph: string) => (
    <div style={section}>
      <div style={label}>{labelText}</div>
      <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={ph} rows={2} style={textareaStyle} />
    </div>
  );

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100030, background: "rgba(0,0,0,0.66)",
        backdropFilter: "blur(3px)", display: "flex", justifyContent: "center",
        alignItems: isMobile ? "flex-end" : "center", padding: isMobile ? 0 : 20,
        fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      }}>
      <div style={{
        width: isMobile ? "100%" : 470, maxWidth: "100%", maxHeight: isMobile ? "92vh" : "88vh",
        overflowY: "auto", boxSizing: "border-box", direction: "rtl",
        background: "linear-gradient(180deg, #161617 0%, #111112 100%)",
        border: `1px solid ${BDR2}`, borderRadius: isMobile ? "20px 20px 0 0" : 20,
        boxShadow: "0 24px 70px rgba(0,0,0,0.6)", padding: isMobile ? "18px 16px 22px" : "22px 24px 24px",
      }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: "rgba(220,38,38,0.16)", border: `1px solid ${BRAND}55`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>♫</span>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#fff" }}>{tab === "new" ? "העלאת סקיצה" : "עדכון קובץ"}</div>
          </div>
          <button onClick={onClose} aria-label="סגור" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, flexShrink: 0, lineHeight: 0 }}><IcX size={20} /></button>
        </div>

        {/* mode toggle */}
        <div style={{ display: "flex", gap: 6, background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, borderRadius: 12, padding: 5, marginBottom: 18 }}>
          {([["new", "סקיצה חדשה"], ["update", "עדכון קובץ"]] as const).map(([val, lbl]) => {
            const sel = tab === val;
            return (
              <button key={val} onClick={() => setTab(val)} style={{
                flex: 1, padding: "11px 0", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit",
                fontSize: 13.5, fontWeight: sel ? 800 : 600, whiteSpace: "nowrap",
                background: sel ? "linear-gradient(180deg, #E5322F, #C01C1C)" : "transparent",
                color: sel ? "#fff" : TEXT2, boxShadow: sel ? "0 2px 10px rgba(220,38,38,0.3)" : "none", transition: "all .14s",
              }}>{lbl}</button>
            );
          })}
        </div>

        {tab === "new" ? (
          <>
            {/* שם סקיצה */}
            <div style={section}>
              <div style={label}>שם סקיצה</div>
              <input value={skitchName} onChange={e => setSkitch(e.target.value)} placeholder="כתוב שם לסקיצה" style={field} />
            </div>
            {/* מילים / טקסט */}
            <div style={section}>
              <div style={label}>מילים / טקסט</div>
              <textarea value={lyrics} onChange={e => setLyrics(e.target.value)} placeholder="כתוב כאן מילים, טקסט או רעיונות…" rows={3} style={textareaStyle} />
            </div>
            {noteBlock("הערות", "כתבו הערות, וייב, הפניות או הערות הפקה…")}
            {filePicker}
          </>
        ) : (
          <>
            {/* בחר שיר / פרויקט */}
            <div style={section}>
              <div style={label}>בחר שיר / פרויקט</div>
              {lockedSong ? (
                <div style={{ ...field, display: "flex", alignItems: "center", gap: 8, opacity: 0.85 }}>
                  <span style={{ color: "#FF6B6B", fontSize: 13 }}>♫</span>{song}
                </div>
              ) : (
                <div ref={songBoxRef} style={{ position: "relative" }}>
                  <button type="button" onClick={() => setSongOpen(o => !o)} style={{
                    ...field, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer", textAlign: "start",
                    borderColor: songOpen ? "rgba(220,38,38,0.5)" : BDR2,
                  }}>
                    <span style={{ color: song ? TEXT : MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{song || "בחר שיר / פרויקט…"}</span>
                    <span style={{ color: TEXT2, fontSize: 10, flexShrink: 0, transform: songOpen ? "rotate(180deg)" : "none", transition: "transform .14s" }}>▼</span>
                  </button>
                  {songOpen && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 6px)", insetInlineStart: 0, insetInlineEnd: 0, zIndex: 5,
                      background: "#161617", border: `1px solid ${BDR2}`, borderRadius: 11,
                      boxShadow: "0 12px 34px rgba(0,0,0,0.6)", overflow: "hidden", maxHeight: 210, overflowY: "auto", padding: 5,
                    }}>
                      {LIBRARY.map(t => {
                        const sel = t.name === song;
                        return (
                          <button key={t.name} type="button" onClick={() => { setSong(t.name); setSongOpen(false); }}
                            onMouseEnter={e => (e.currentTarget.style.background = sel ? "rgba(220,38,38,0.22)" : "rgba(255,255,255,0.05)")}
                            onMouseLeave={e => (e.currentTarget.style.background = sel ? "rgba(220,38,38,0.16)" : "transparent")}
                            style={{
                              display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "start",
                              padding: "11px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                              background: sel ? "rgba(220,38,38,0.16)" : "transparent",
                              color: sel ? "#FF6B6B" : TEXT, fontSize: 13.5, fontWeight: sel ? 800 : 600, fontFamily: "inherit",
                            }}><span style={{ fontSize: 12, color: "#FF6B6B" }}>♫</span>{t.name}</button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            {filePicker}
            {noteBlock("הערה (אופציונלי)", "כתוב הערה קצרה על הקובץ…")}
          </>
        )}

        {/* submit */}
        <button onClick={submit} disabled={!canSubmit} style={{
          width: "100%", boxSizing: "border-box", padding: "14px 0", borderRadius: 12, border: "none", marginTop: 2,
          color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: "inherit",
          cursor: canSubmit ? "pointer" : "not-allowed", opacity: canSubmit ? 1 : 0.5,
          background: "linear-gradient(180deg, #E5322F, #C01C1C)", boxShadow: canSubmit ? `0 4px 16px rgba(220,38,38,0.32)` : "none",
        }}>{tab === "new" ? "העלה סקיצה" : "העלה קובץ"}</button>
        <div style={{ fontSize: 11, color: MUTED, textAlign: "center", marginTop: 10 }}>מצב הדגמה — הקובץ עדיין לא נשלח לשרת</div>
      </div>
    </div>,
    document.body,
  );
}
