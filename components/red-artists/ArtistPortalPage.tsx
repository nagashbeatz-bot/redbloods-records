"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

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
function PlayButton({ size = 40 }: { size?: number }) {
  return (
    <button aria-label="נגן" style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0, cursor: "pointer", fontFamily: "inherit",
      background: "radial-gradient(circle at 50% 35%, rgba(220,38,38,0.22), #150809 75%)",
      border: `1px solid ${BRAND}55`, boxShadow: `0 0 14px rgba(220,38,38,0.3)`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <IcPlay size={Math.round(size * 0.42)} />
    </button>
  );
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

// Upcoming shows — demo (UI only, hardcoded like the rest of this portal).
const SHOWS: { name: string; date: string; dow: string; doors: string }[] = [
  { name: "פאצה, תל אביב", date: "27.06.2025", dow: "מוצ״ש", doors: "22:30" },
  { name: "באנקר, חיפה",   date: "12.07.2025", dow: "שבת",   doors: "21:00" },
];

// ── "המוזיקה שלי" page (music tab) — demo library (UI only) ───────────────────────
const MUSIC_STATUS_COLOR: Record<string, string> = {
  "מוכן":         "#34D399",
  "ממתין לאישור":  "#F59E0B",
  "סקיצה":        "#9CA3AF",
  "בבחינה":       "#2DD4BF",
  "בבדיקה":       "#60A5FA",
};
type LibTrack = { name: string; kind: string; status: string; date: string; dur: string };
const LIBRARY: LibTrack[] = [
  { name: "הסיפור שלי",   kind: "מיקס",  status: "ממתין לאישור", date: "08.06.2025", dur: "03:42" },
  { name: "לב של זמן",    kind: "סקיצה", status: "סקיצה",        date: "27.05.2025", dur: "02:58" },
  { name: "קלוזר חלק 2",  kind: "מאסטר", status: "מוכן",         date: "26.05.2025", dur: "04:11" },
  { name: "חיים אחרים",   kind: "סקיצה", status: "ממתין לאישור", date: "23.05.2025", dur: "03:09" },
  { name: "תל אביב בלילה", kind: "דמו",   status: "בבחינה",       date: "20.05.2025", dur: "02:37" },
  { name: "עד שנפגש",     kind: "מיקס",  status: "ממתין לאישור", date: "18.05.2025", dur: "03:55" },
];
// File-type options for the upload modal (display-only labels; no new statuses).
const FILE_KINDS = ["סקיצה", "ווקאל", "מיקס", "מאסטר", "הערות", "אחר"] as const;
const MUSIC_KPIS: { label: string; value: number; icon: string }[] = [
  { label: "סה״כ שירים",   value: 24, icon: "♫" },
  { label: "סקיצות",       value: 8,  icon: "✎" },
  { label: "ממתין לאישור", value: 3,  icon: "◷" },
  { label: "מאסטרים",      value: 6,  icon: "♬" },
];

// Hero "latest updates" flash — hardcoded, rotates client-side.
const FLASH: { text: string; time: string }[] = [
  { text: "המיקס של My Story מוכן לאישור",          time: "לפני 4 דקות" },
  { text: "נוסף ביט חדש של Nagash בשם Focus",        time: "לפני שעה" },
  { text: "נקבע סשן אולפן ל־01.07 בשעה 16:00",       time: "לפני 3 שעות" },
  { text: "עודכן מאזן החודש",                        time: "אתמול" },
  { text: "הועלתה סקיצה חדשה לבדיקה",                 time: "לפני יומיים" },
  { text: "נשלחה הודעה חדשה מהלייבל",                 time: "לפני 5 דקות" },
];

const TABS = ["בית", "המוזיקה שלי", "ביטים פנויים", "מאזן", "לו״ז ועדכונים"] as const;
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

function rowHover(e: React.MouseEvent<HTMLElement>, on: boolean) {
  e.currentTarget.style.background = on ? "rgba(220,38,38,0.06)" : "transparent";
  e.currentTarget.style.borderColor = on ? "rgba(220,38,38,0.28)" : "transparent";
}

// ── Page ─────────────────────────────────────────────────────────────────────────
export default function ArtistPortalPage() {
  const [tab, setTab] = useState<Tab>("בית");
  const isMobile = useIsMobile();

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
        `}</style>

        {/* ── Internal portal nav (horizontal tabs — global sidebar stays the only sidebar) ── */}
        <div style={{ display: "flex", justifyContent: "center", gap: isMobile ? 8 : 10, flexWrap: "wrap", marginBottom: isMobile ? 18 : 24 }}>
          {TABS.map(tb => {
            const active = tb === tab;
            return (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                style={{
                  fontSize: isMobile ? 12.5 : 13.5, fontWeight: active ? 800 : 600, fontFamily: "inherit", cursor: "pointer",
                  padding: isMobile ? "8px 14px" : "10px 20px", borderRadius: 12, whiteSpace: "nowrap",
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

        {tab === "בית" ? <HomeDashboard />
          : tab === "המוזיקה שלי" ? <MyMusicPage />
          : <ComingSoon tab={tab} />}
      </div>
    </div>
  );
}

function ComingSoon({ tab }: { tab: Tab }) {
  return (
    <div style={{ ...panel, padding: "80px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 42, marginBottom: 14, opacity: 0.5 }}>🚧</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, marginBottom: 6 }}>{tab}</div>
      <div style={{ fontSize: 13, color: TEXT2 }}>האזור הזה יוצג בקרוב</div>
    </div>
  );
}

// ── "המוזיקה שלי" page ────────────────────────────────────────────────────────────
function MusicStatus({ status }: { status: string }) {
  const c = MUSIC_STATUS_COLOR[status] ?? "#9CA3AF";
  return <span style={{ fontSize: 11, fontWeight: 800, color: c, background: `${c}24`, border: `1px solid ${c}5A`, borderRadius: 8, padding: "4px 11px", whiteSpace: "nowrap" }}>{status}</span>;
}

function MyMusicPage() {
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

  const rows = LIBRARY;

  // grid template shared EXACTLY by the library header + every row (RTL: play on the
  // right in its own fixed column, then name, then the technical columns).
  // Play fixed · שם השיר wide (the focus) · type a touch narrower · status/date/
  // duration/options fixed & snug so columns sit tight under their headers.
  const cols = "52px minmax(0, 1.8fr) minmax(0, 0.8fr) 118px 116px 66px 46px";
  const heads: { label: string; align: "start" | "center" }[] = [
    { label: "",              align: "center" }, // play column (no header)
    { label: "שם השיר",       align: "start"  },
    { label: "סוג / גרסה",    align: "start"  },
    { label: "סטטוס",         align: "center" },
    { label: "עודכן לאחרונה", align: "center" },
    { label: "משך",           align: "center" },
    { label: "אפשרויות",      align: "center" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── Header ── */}
      <div style={{
        position: "relative", overflow: "hidden", borderRadius: 24, border: `1px solid rgba(220,38,38,0.34)`,
        background: `radial-gradient(120% 150% at 50% -22%, rgba(220,38,38,0.36) 0%, rgba(220,38,38,0.08) 40%, #110E0F 74%), radial-gradient(80% 120% at 50% 130%, rgba(220,38,38,0.10) 0%, transparent 60%), linear-gradient(180deg, #1A1314 0%, #0B0909 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 110px rgba(220,38,38,0.18), 0 28px 70px rgba(0,0,0,0.55)`,
      }}>
        {/* top hairline glow */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${BRAND}66, transparent)`, pointerEvents: "none" }} />
        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: isMobile ? 16 : 28, padding: isMobile ? "24px 18px" : "48px 44px" }}>
          {/* identity (right) */}
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 13 : 16, minWidth: isMobile ? 0 : 240 }}>
            <div style={{ padding: 3, borderRadius: "50%", flexShrink: 0, background: `conic-gradient(from 150deg, ${BRAND}, #7A1414, ${BRAND})`, boxShadow: `0 0 32px ${BRAND}55` }}>
              <div style={{ width: isMobile ? 52 : 70, height: isMobile ? 52 : 70, borderRadius: "50%", background: "linear-gradient(140deg, #2A0E0E, #140808)", border: "1px solid rgba(255,255,255,0.10)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isMobile ? 22 : 28, fontWeight: 900, color: "#fff" }}>ש</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, color: "#fff" }}>שלו טסמה</div>
              <div style={{ fontSize: isMobile ? 12 : 13, color: TEXT2, marginTop: 4 }}>אמן · Redbloods Records</div>
            </div>
          </div>
          {/* title (center / grows) */}
          <div style={{ flex: 1, minWidth: isMobile ? "100%" : 280, textAlign: isMobile ? "start" : "center" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: isMobile ? 10 : 14 }}>
              <h1 style={{ fontSize: isMobile ? 26 : 40, fontWeight: 900, margin: 0, letterSpacing: "-0.03em", color: "#fff", textShadow: "0 2px 22px rgba(0,0,0,0.5)" }}>המוזיקה שלי</h1>
              <span style={{ width: isMobile ? 42 : 56, height: isMobile ? 42 : 56, borderRadius: isMobile ? 13 : 16, flexShrink: 0, background: "rgba(220,38,38,0.16)", border: `1px solid ${BRAND}66`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isMobile ? 19 : 25, boxShadow: `0 0 24px rgba(220,38,38,0.35)` }}>♫</span>
            </div>
            <div style={{ fontSize: isMobile ? 12.5 : 14, color: TEXT2, marginTop: isMobile ? 8 : 11 }}>כל השירים, הסקיצות, המיקסים והמאסטרים במקום אחד</div>
          </div>
          {!isMobile && <div style={{ minWidth: 240 }} />}
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="rap-kpi">
        {MUSIC_KPIS.map(k => (
          <div key={k.label} style={{ ...panel, padding: "22px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12.5, color: TEXT2, fontWeight: 600 }}>{k.label}</div>
              <div style={{ fontSize: 34, fontWeight: 900, color: TEXT, marginTop: 5 }}>{k.value}</div>
            </div>
            <span style={{ width: 50, height: 50, borderRadius: 14, flexShrink: 0, background: "rgba(220,38,38,0.13)", border: `1px solid ${BRAND}44`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{k.icon}</span>
          </div>
        ))}
      </div>

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

          {/* column header — desktop only (mobile uses cards) */}
          {!isMobile && (
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "13px 24px", borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.015)" }}>
            {heads.map((h, i) => (
              <div key={i} style={{ fontSize: 12, fontWeight: 800, color: "#9A9AA6", letterSpacing: "0.05em", textTransform: "uppercase", textAlign: h.align }}>{h.label}</div>
            ))}
          </div>
          )}

          {/* rows — desktop: shared grid (aligned columns); mobile: stacked cards */}
          <div style={{ padding: isMobile ? "2px 0 6px" : "6px 0 8px" }}>
            {rows.length === 0 ? (
              <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13.5, color: MUTED }}>לא נמצאו שירים</div>
            ) : isMobile ? (
              rows.map(t => (
                <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: `1px solid ${BDR}` }}>
                  {/* play (rightmost in RTL) */}
                  <PlayButton size={42} />
                  {/* name + meta + status (truncating, never overlaps) */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl" }}>
                      {t.kind} · {t.date} · {t.dur}
                    </div>
                    <div style={{ marginTop: 7 }}><MusicStatus status={t.status} /></div>
                  </div>
                  {/* options (leftmost) */}
                  <RowMenu onUpdateFile={() => setModal({ mode: "update", target: t.name })} />
                </div>
              ))
            ) : (
              rows.map(t => (
                <div key={t.name} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                  style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "15px 24px", border: "1px solid transparent", transition: "all .14s" }}>
                  {/* play (right column) */}
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <PlayButton size={42} />
                  </div>
                  {/* name + version */}
                  <div style={{ minWidth: 0, textAlign: "start" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#FFFFFF", whiteSpace: "nowrap" }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: TEXT2, marginTop: 3 }}>{t.kind}</div>
                  </div>
                  {/* type / version */}
                  <div style={{ fontSize: 13, color: "#CFCFD6", textAlign: "start" }}>{t.kind}</div>
                  {/* status */}
                  <div style={{ textAlign: "center" }}><MusicStatus status={t.status} /></div>
                  {/* last updated */}
                  <div style={{ fontSize: 12.5, color: "#CFCFD6", direction: "ltr", textAlign: "center" }}>{t.date}</div>
                  {/* duration */}
                  <div style={{ fontSize: 12.5, color: "#CFCFD6", direction: "ltr", textAlign: "center", fontFamily: "ui-monospace, Menlo, monospace" }}>{t.dur}</div>
                  {/* options */}
                  <div style={{ display: "flex", justifyContent: "center" }}><RowMenu onUpdateFile={() => setModal({ mode: "update", target: t.name })} /></div>
                </div>
              ))
            )}
            <button style={{ ...linkBtn, display: "block", width: "100%", textAlign: "center", padding: "14px 0 10px", fontWeight: 700 }}>הצג עוד ⌄</button>
          </div>
      </div>

      {/* ── bottom mock player (visual only — does NOT touch the global player) ── */}
      {isMobile ? (
        /* Mobile: compact modern player — artwork+meta, wide progress, centered controls */
        <div style={{ ...panel, padding: "14px 16px 16px", marginTop: 4, marginBottom: 12 }}>
          {/* now playing */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, background: `linear-gradient(140deg, ${BRAND}66, #2A0E0E)`, border: `1px solid ${BDR2}` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>הסיפור שלי</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>מיקס · 03:42</div>
            </div>
            <button style={pbtn} aria-label="אהבתי"><IcHeart size={18} /></button>
          </div>
          {/* progress — LTR like any music player (elapsed left, total right) */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 13, direction: "ltr" }}>
            <span style={{ fontSize: 11, color: MUTED, fontFamily: "ui-monospace, Menlo, monospace", flexShrink: 0 }}>1:28</span>
            <div style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.12)", position: "relative" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "40%", background: BRAND, borderRadius: 3 }} />
              <div style={{ position: "absolute", left: "calc(40% - 6px)", top: "50%", transform: "translateY(-50%)", width: 12, height: 12, borderRadius: "50%", background: "#fff", boxShadow: `0 0 8px ${BRAND}` }} />
            </div>
            <span style={{ fontSize: 11, color: MUTED, fontFamily: "ui-monospace, Menlo, monospace", flexShrink: 0 }}>3:42</span>
          </div>
          {/* controls — forced LTR so prev/next never flip: shuffle · prev · play · next · repeat */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 26, marginTop: 15, direction: "ltr" }}>
            <button style={pbtn} aria-label="ערבוב"><IcShuffle size={18} /></button>
            <button style={pbtn} aria-label="הקודם"><IcSkipBack size={22} /></button>
            <button style={{ ...pbtn, width: 54, height: 54, borderRadius: "50%", background: "radial-gradient(circle at 50% 35%, rgba(220,38,38,0.42), #150809 78%)", border: `1px solid ${BRAND}`, boxShadow: `0 0 22px rgba(220,38,38,0.45)` }} aria-label="נגן"><IcPlay size={22} /></button>
            <button style={pbtn} aria-label="הבא"><IcSkipFwd size={22} /></button>
            <button style={pbtn} aria-label="חזרה"><IcRepeat size={18} /></button>
          </div>
        </div>
      ) : (
        /* Desktop: horizontal player */
        <div style={{ ...panel, display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", padding: "22px 28px", marginTop: 4, marginBottom: 12 }}>
          {/* now playing (right) */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: "0 1 auto" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2.5, height: 42, flexShrink: 0 }}>
              {[14, 28, 18, 36, 22, 31, 15, 25, 34, 20, 30, 16].map((h, i) => (
                <span key={i} style={{ width: 3, height: h, borderRadius: 2, background: BRAND, opacity: 0.85 }} />
              ))}
            </div>
            <div style={{ width: 56, height: 56, borderRadius: 12, flexShrink: 0, background: `linear-gradient(140deg, ${BRAND}66, #2A0E0E)`, border: `1px solid ${BDR2}` }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>הסיפור שלי</div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>מיקס · 03:42</div>
            </div>
            <button style={pbtn} aria-label="אהבתי"><IcHeart size={18} /></button>
          </div>
          {/* transport (center) — forced LTR so prev/next never flip */}
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginInlineStart: "auto", marginInlineEnd: "auto", direction: "ltr" }}>
            <button style={pbtn} aria-label="ערבוב"><IcShuffle size={18} /></button>
            <button style={pbtn} aria-label="הקודם"><IcSkipBack size={22} /></button>
            <button style={{ ...pbtn, width: 58, height: 58, borderRadius: "50%", background: "radial-gradient(circle at 50% 35%, rgba(220,38,38,0.4), #150809 78%)", border: `1px solid ${BRAND}`, boxShadow: `0 0 22px rgba(220,38,38,0.45)` }} aria-label="נגן"><IcPlay size={22} /></button>
            <button style={pbtn} aria-label="הבא"><IcSkipFwd size={22} /></button>
            <button style={pbtn} aria-label="חזרה"><IcRepeat size={18} /></button>
          </div>
          {/* volume + icons (left) */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: "0 1 auto", justifyContent: "flex-end" }}>
            <button style={pbtn} aria-label="עוצמה"><IcVolume size={18} /></button>
            <div style={{ width: 150, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.10)", position: "relative", flexShrink: 1, direction: "ltr" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "70%", background: BRAND, borderRadius: 3 }} />
            </div>
            <button style={pbtn} aria-label="מסך"><IcMonitor size={18} /></button>
            <button style={pbtn} aria-label="תור"><IcList size={18} /></button>
          </div>
        </div>
      )}

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
function HomeDashboard() {
  const isMobile = useIsMobile();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── 1. Hero ── */}
      <div style={{
        position: "relative", overflow: "hidden", borderRadius: 24,
        border: `1px solid rgba(220,38,38,0.34)`,
        background: `
          radial-gradient(70% 130% at 9% 22%, rgba(220,38,38,0.40) 0%, rgba(220,38,38,0.08) 40%, transparent 64%),
          radial-gradient(130% 160% at 94% -16%, rgba(220,38,38,0.30) 0%, rgba(220,38,38,0.08) 38%, #120E0F 72%),
          radial-gradient(90% 130% at 50% 132%, rgba(220,38,38,0.12) 0%, transparent 58%),
          linear-gradient(180deg, #1A1314 0%, #0B0909 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 100px rgba(220,38,38,0.16), 0 30px 72px rgba(0,0,0,0.55)`,
      }}>
        {/* soft inner vignette to seat the content over the glow */}
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(8,8,9,0.55) 100%)", pointerEvents: "none" }} />
        {/* fine red top hairline glow */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${BRAND}66, transparent)`, pointerEvents: "none" }} />

        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: isMobile ? 14 : 24, padding: isMobile ? "18px 16px" : "26px 36px" }}>

          {/* Identity (start / right in RTL) — name + avatar */}
          <div style={{ display: "flex", flexDirection: "column", minWidth: isMobile ? "100%" : 232 }}>
            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 13 : 16 }}>
              <ArtistAvatar />
              <div style={{ textAlign: "start", minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? 19 : 24, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em" }}>שליו טסמה</div>
                <div style={{ fontSize: isMobile ? 12 : 13, color: TEXT2, marginTop: 3 }}>אמן • Redbloods Records</div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 7, padding: "3px 11px 3px 9px", borderRadius: 99, background: "rgba(52,211,153,0.10)", border: "1px solid rgba(52,211,153,0.30)" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, boxShadow: `0 0 7px ${GREEN}` }} />
                  <span style={{ fontSize: 11.5, color: GREEN, fontWeight: 700 }}>פעיל</span>
                </div>
              </div>
            </div>
          </div>

          {/* Greeting + live "latest updates" flash (grows, centered) */}
          <div style={{ flex: 1, minWidth: isMobile ? "100%" : 320, textAlign: isMobile ? "start" : "center" }}>
            <h1 style={{ fontSize: isMobile ? 23 : 32, fontWeight: 900, margin: 0, letterSpacing: "-0.03em", color: "#fff", textShadow: "0 2px 24px rgba(0,0,0,0.55)" }}>
              ברוך הבא, שליו <span style={{ WebkitTextFillColor: "initial" }}>👋</span>
            </h1>
            <p style={{ fontSize: isMobile ? 12.5 : 13.5, color: "#C8C8CC", lineHeight: 1.6, margin: isMobile ? "6px 0 0" : "7px auto 0", maxWidth: 500 }}>
              זה המקום שלך ליצור, לשחרר ולהוביל. אנחנו כאן כדי לקחת את המוזיקה שלך רחוק.
            </p>

            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 11, marginBottom: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "#FF6B6B", letterSpacing: "0.02em" }}>עדכונים אחרונים</span>
            </div>

            <NewsFlash />
          </div>

          {/* Left spacer (desktop) — balances the right identity card so the
              greeting + latest-update sit on the Hero's true center axis. */}
          {!isMobile && <div style={{ minWidth: 232, flexShrink: 0 }} />}
        </div>
      </div>

      {/* ── 2. "מה מחכה לך עכשיו" ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>מה מחכה לך עכשיו</span>
        </div>
        <div className="rap-acts">
          <ActionCard icon="📅" title="סשן קרוב" body="פגישת אמן והפקה" sub="08.06.2025 · יום ראשון · 18:00" cta="פרטים" link="יומן מלא ←" />
          {SHOWS.length > 0 ? (
            <ActionCard icon="🎤" title="הופעות קרובות" body={SHOWS[0].name} sub={`${SHOWS[0].date} · ${SHOWS[0].dow} · ${SHOWS[0].doors}`} cta="פרטים" link={SHOWS.length > 1 ? "לכל ההופעות ←" : "יומן מלא ←"} />
          ) : (
            <ActionCard icon="🎤" title="הופעות קרובות" body="אין הופעות קרובות כרגע" cta="יומן מלא" />
          )}
        </div>
      </div>

      {/* ── 3. Main grid (row A) — music-forward in RTL: המוזיקה שלי (right) → ביטים → מאזן ── */}
      <div className="rap-grid-a">

        {/* המוזיקה שלי */}
        <SectionCard title="המוזיקה שלי">
          <div style={{ padding: "8px 12px 6px" }}>
            {SONGS.map(s => (
              <div key={s.name} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 12px", borderRadius: 13, border: "1px solid transparent", transition: "all .14s" }}>
                {/* play (rightmost in RTL) */}
                <PlayButton size={36} />
                {/* name + version */}
                <div style={{ textAlign: "start", minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT, whiteSpace: "nowrap" }}>{s.name}</div>
                  <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{s.kind}</div>
                </div>
                {/* metadata pushed to the left edge */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginInlineStart: "auto" }}>
                  <StatusBadge status={s.status} />
                  <span style={{ fontSize: 11, color: MUTED, whiteSpace: "nowrap", direction: "ltr" }}>{s.date}</span>
                  <button style={dotsBtn} aria-label="more">⋮</button>
                </div>
              </div>
            ))}
            <button style={{ ...linkBtn, display: "block", width: "100%", textAlign: "start", padding: "10px 4px 6px" }}>לכל השירים והסקיצות ←</button>
          </div>
        </SectionCard>

        {/* מאזן (artist-only: income / expenses / balance — NO split, NO debt) */}
        <SectionCard title="מאזן" link="לכל הדוחות הפיננסיים ←">
          <div style={{ padding: "14px 18px 18px" }}>
            <BalanceRow label="הכנסות שלי" value="₪10,450" color={GREEN} icon="↑" />
            <BalanceRow label="הוצאות שלי" value="₪2,130"  color={TEXT}  icon="↓" />
            {/* Net balance — highlighted */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 12,
              padding: "13px 14px", borderRadius: 13,
              background: "linear-gradient(180deg, rgba(220,38,38,0.12), rgba(220,38,38,0.04))",
              border: `1px solid ${BRAND}44`,
            }}>
              <span style={{ fontSize: 13, color: "#E8B7B7", fontWeight: 700 }}>מאזן נוכחי</span>
              <span style={{ fontSize: 22, fontWeight: 900, color: "#FF6B6B", direction: "ltr" }}>₪8,320</span>
            </div>
            <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.6, marginTop: 12, background: "rgba(255,255,255,0.02)", border: `1px solid ${BDR}`, borderRadius: 10, padding: "10px 12px" }}>
              כאן מוצגות רק הכנסות והוצאות שמשויכות אליך וגלויות לך.
            </div>
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

function ArtistAvatar() {
  const [path, setPath]   = useState<string | null>(null);
  const [ver, setVer]     = useState(0);          // cache-bust after re-upload (overwrites same path)
  const [hover, setHover] = useState(false);
  const [busy, setBusy]   = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try { const p = localStorage.getItem(AVATAR_KEY); if (p) setPath(p); } catch { /* ignore */ }
  }, []);

  function notify(m: string) { setToast(m); setTimeout(() => setToast(null), 2600); }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!AVATAR_MIME.includes(file.type)) { notify("סוג קובץ לא נתמך — jpg / png / webp בלבד"); return; }
    if (file.size > 5 * 1024 * 1024)      { notify("הקובץ גדול מדי (מקסימום 5MB)"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res  = await fetch("/api/red-artists/profile-image", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { notify(data.error ?? "ההעלאה נכשלה"); }
      else {
        const p = data.path as string;
        try { localStorage.setItem(AVATAR_KEY, p); } catch { /* ignore */ }
        setPath(p);
        setVer(Date.now());
        notify("תמונת הפרופיל עודכנה");
      }
    } catch { notify("ההעלאה נכשלה"); }
    finally { setBusy(false); }
  }

  const src = path ? `/api/dropbox/stream?path=${encodeURIComponent(path)}${ver ? `&t=${ver}` : ""}` : null;

  return (
    <div
      onClick={() => { if (!busy) inputRef.current?.click(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="עריכת תמונה"
      style={{
        padding: 3, borderRadius: "50%", flexShrink: 0, position: "relative", cursor: busy ? "wait" : "pointer",
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
          <img src={src} alt="תמונת פרופיל" onError={() => { setPath(null); try { localStorage.removeItem(AVATAR_KEY); } catch { /* ignore */ } }} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : "ש"}
        {/* hover / busy overlay */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 2, background: "rgba(0,0,0,0.62)", color: "#fff",
          opacity: hover || busy ? 1 : 0, transition: "opacity .15s", pointerEvents: "none",
        }}>
          <span style={{ fontSize: 16 }}>{busy ? "⏳" : "📷"}</span>
          <span style={{ fontSize: 9.5, fontWeight: 700 }}>{busy ? "מעלה…" : (path ? "עריכת תמונה" : "העלאת תמונה")}</span>
        </div>
      </div>
      {toast && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", zIndex: 100020,
          background: "#1A1C22", border: `1px solid ${BDR2}`, color: TEXT, fontSize: 13, fontWeight: 700,
          padding: "11px 20px", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.6)", fontFamily: "'Heebo', Arial, sans-serif",
        }}>{toast}</div>,
        document.body,
      )}
    </div>
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

// ── Row "⋯" menu — only action is "עדכן קובץ" (opens the upload modal with the
// track pre-selected). Rendered in a portal so the card's overflow doesn't clip it.
function RowMenu({ onUpdateFile }: { onUpdateFile: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 178;
    const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8));
    setPos({ top: r.bottom + 6, left });
    setOpen(true);
  };

  return (
    <>
      <button ref={btnRef} onClick={openMenu} style={dotsBtn} aria-label="אפשרויות">⋯</button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 100025 }} />
          <div style={{
            position: "fixed", top: pos.top, left: pos.left, width: 178, zIndex: 100026,
            background: "#161617", border: `1px solid ${BDR2}`, borderRadius: 12,
            boxShadow: "0 12px 34px rgba(0,0,0,0.6)", overflow: "hidden", padding: 5,
            fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
          }}>
            <button onClick={() => { setOpen(false); onUpdateFile(); }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(220,38,38,0.14)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              style={{
                display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "start",
                padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                background: "transparent", color: TEXT, fontSize: 13.5, fontWeight: 700, fontFamily: "inherit",
              }}><IcUpload size={15} color="#FF6B6B" /> עדכן קובץ</button>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

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
  const [song, setSong] = useState("");
  const [kind, setKind] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setSong(modal?.target ?? ""); setKind(""); setFile(null); setNote(""); setDrag(false); }
  }, [open, modal?.target, modal?.mode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  const locked    = modal!.mode === "update";
  const canSubmit = song.trim() !== "" && !!file;

  const submit = () => {
    if (!canSubmit) return;
    onClose();
    onToast("היעד והקובץ נקלטו (הדגמה) — חיבור העלאה אמיתי ממתין לאישור");
  };

  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: TEXT2, marginBottom: 8 };
  const field: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.03)",
    border: `1px solid ${BDR2}`, borderRadius: 11, color: TEXT, fontSize: 14,
    fontFamily: "inherit", padding: "13px 14px", outline: "none",
  };

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
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#fff" }}>{locked ? "עדכון קובץ לשיר" : "העלאת קובץ"}</div>
            {locked && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, fontSize: 13, fontWeight: 700, color: "#FF6B6B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 13 }}>♫</span>{song}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="סגור" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, flexShrink: 0, lineHeight: 0 }}><IcX size={20} /></button>
        </div>

        {/* 1 · target song / project */}
        <div style={{ marginBottom: 16 }}>
          <div style={label}>בחר שיר / פרויקט</div>
          {locked ? (
            <div style={{ ...field, display: "flex", alignItems: "center", gap: 8, opacity: 0.85 }}>
              <span style={{ color: "#FF6B6B", fontSize: 13 }}>♫</span>{song}
            </div>
          ) : (
            <select value={song} onChange={e => setSong(e.target.value)} style={{ ...field, cursor: "pointer", appearance: "none" }}>
              <option value="" disabled>בחר שיר / פרויקט…</option>
              {LIBRARY.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          )}
        </div>

        {/* 2 · file type */}
        <div style={{ marginBottom: 16 }}>
          <div style={label}>סוג קובץ</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {FILE_KINDS.map(k => {
              const sel = k === kind;
              return (
                <button key={k} onClick={() => setKind(sel ? "" : k)} style={{
                  padding: "9px 15px", borderRadius: 999, fontSize: 13, fontWeight: sel ? 800 : 600,
                  cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                  background: sel ? "rgba(220,38,38,0.18)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${sel ? "rgba(220,38,38,0.5)" : BDR2}`,
                  color: sel ? "#FF6B6B" : TEXT2, transition: "all .14s",
                }}>{k}</button>
              );
            })}
          </div>
        </div>

        {/* 3 · file picker (drag/drop on desktop, tap on mobile) */}
        <div style={{ marginBottom: 16 }}>
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
              <div style={{ fontSize: 13.5, color: TEXT2 }}>{isMobile ? "לחץ לבחירה" : "גרור קובץ לכאן או לחץ לבחירה"}</div>
            )}
          </div>
          <input ref={fileRef} type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ display: "none" }} />
        </div>

        {/* 4 · optional note */}
        <div style={{ marginBottom: 18 }}>
          <div style={label}>הערה (אופציונלי)</div>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="כתוב הערה קצרה על הקובץ…" rows={2}
            style={{ ...field, resize: "none", lineHeight: 1.5 }} />
        </div>

        {/* 5 · submit */}
        <button onClick={submit} disabled={!canSubmit} style={{
          width: "100%", boxSizing: "border-box", padding: "14px 0", borderRadius: 12, border: "none",
          color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: "inherit",
          cursor: canSubmit ? "pointer" : "not-allowed", opacity: canSubmit ? 1 : 0.5,
          background: "linear-gradient(180deg, #E5322F, #C01C1C)", boxShadow: canSubmit ? `0 4px 16px rgba(220,38,38,0.32)` : "none",
        }}>העלה קובץ</button>
        <div style={{ fontSize: 11, color: MUTED, textAlign: "center", marginTop: 10 }}>מצב הדגמה — הקובץ עדיין לא נשלח לשרת</div>
      </div>
    </div>,
    document.body,
  );
}
