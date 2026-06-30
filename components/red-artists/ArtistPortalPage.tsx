"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

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
const PENDING_TRACKS: { name: string; kind: string; date: string }[] = [
  { name: "שבילי אור",     kind: "מיקס", date: "09.06.2025" },
  { name: "לילות ללא סוף", kind: "מיקס", date: "07.06.2025" },
  { name: "חלומות בגובה",  kind: "מיקס", date: "05.06.2025" },
];
const MUSIC_KPIS: { label: string; value: number; icon: string }[] = [
  { label: "סה״כ שירים",   value: 24, icon: "♫" },
  { label: "סקיצות",       value: 8,  icon: "✎" },
  { label: "ממתין לאישור", value: 3,  icon: "◷" },
  { label: "מאסטרים",      value: 6,  icon: "♬" },
];
// chip label → predicate over a track (null = match all)
const MUSIC_CHIPS: { label: string; match: ((t: LibTrack) => boolean) | null; dot?: string }[] = [
  { label: "הכל",          match: null },
  { label: "סקיצות",       match: t => t.kind === "סקיצה",        dot: "#9CA3AF" },
  { label: "מיקסים",       match: t => t.kind === "מיקס",         dot: "#60A5FA" },
  { label: "מאסטרים",      match: t => t.kind === "מאסטר",        dot: "#34D399" },
  { label: "ממתין לאישור", match: t => t.status === "ממתין לאישור", dot: "#F59E0B" },
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

  return (
    <div dir="rtl" style={{ minHeight: "100%", background: "#0A0A0B", color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", padding: "30px 24px 140px" }}>
      {/* Centered premium island — intentionally NOT full-width (black breathing room around) */}
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* Responsive grids: "המוזיקה שלי" gets priority width; everything stacks on small screens. */}
        <style>{`
          .rap-grid-a { display: grid; gap: 18px; align-items: start; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
          .rap-acts   { display: grid; gap: 17px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
          .rap-kpi    { display: grid; gap: 14px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
          .rap-music  { display: grid; gap: 18px; align-items: start; grid-template-columns: minmax(0, 2.4fr) minmax(0, 1fr); }
          @media (max-width: 1040px) {
            .rap-grid-a { grid-template-columns: 1fr; }
            .rap-music  { grid-template-columns: 1fr; }
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
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
          {TABS.map(tb => {
            const active = tb === tab;
            return (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                style={{
                  fontSize: 13.5, fontWeight: active ? 800 : 600, fontFamily: "inherit", cursor: "pointer",
                  padding: "10px 20px", borderRadius: 12, whiteSpace: "nowrap",
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

function Disc() {
  return (
    <span style={{
      width: 50, height: 50, borderRadius: "50%", flexShrink: 0,
      background: "radial-gradient(circle at 50% 50%, #2A2A30 0%, #141416 60%, #0C0C0E 100%)",
      border: `1px solid ${BDR2}`, display: "flex", alignItems: "center", justifyContent: "center",
      color: TEXT2, fontSize: 17,
    }}>♫</span>
  );
}

function MyMusicPage() {
  const [chip, setChip]   = useState("הכל");
  const [query, setQuery] = useState("");

  const active = MUSIC_CHIPS.find(c => c.label === chip) ?? MUSIC_CHIPS[0];
  const rows = LIBRARY.filter(t =>
    (active.match ? active.match(t) : true) &&
    (query.trim() === "" || t.name.includes(query.trim()))
  );

  // grid template shared EXACTLY by the library header + every row (RTL: play on the
  // right in its own fixed column, then name, then the technical columns).
  const cols = "52px minmax(0, 2.3fr) 0.9fr 1fr 1.1fr 0.7fr 0.5fr";
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
        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 28, padding: "48px 44px" }}>
          {/* identity (right) */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 240 }}>
            <div style={{ padding: 3, borderRadius: "50%", flexShrink: 0, background: `conic-gradient(from 150deg, ${BRAND}, #7A1414, ${BRAND})`, boxShadow: `0 0 32px ${BRAND}55` }}>
              <div style={{ width: 70, height: 70, borderRadius: "50%", background: "linear-gradient(140deg, #2A0E0E, #140808)", border: "1px solid rgba(255,255,255,0.10)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 900, color: "#fff" }}>ש</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>שלו טסמה</div>
              <div style={{ fontSize: 13, color: TEXT2, marginTop: 4 }}>אמן · Redbloods Records</div>
            </div>
          </div>
          {/* title (center / grows) */}
          <div style={{ flex: 1, minWidth: 280, textAlign: "center" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
              <h1 style={{ fontSize: 40, fontWeight: 900, margin: 0, letterSpacing: "-0.03em", color: "#fff", textShadow: "0 2px 22px rgba(0,0,0,0.5)" }}>המוזיקה שלי</h1>
              <span style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(220,38,38,0.16)", border: `1px solid ${BRAND}66`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 25, boxShadow: `0 0 24px rgba(220,38,38,0.35)` }}>♫</span>
            </div>
            <div style={{ fontSize: 14, color: TEXT2, marginTop: 11 }}>כל השירים, הסקיצות, המיקסים והמאסטרים במקום אחד</div>
          </div>
          <div style={{ minWidth: 240 }} />
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

      {/* ── filters / search ── */}
      <div style={{ ...panel, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "14px 18px" }}>
        {/* sort (right) */}
        <button style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 18px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>⇅ תאריך עדכון</button>
        {/* chips */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          {MUSIC_CHIPS.map(c => {
            const sel = c.label === chip;
            return (
              <button key={c.label} onClick={() => setChip(c.label)} style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 18px", borderRadius: 999,
                fontSize: 13.5, fontWeight: sel ? 800 : 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                background: sel ? "rgba(220,38,38,0.16)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${sel ? "rgba(220,38,38,0.5)" : BDR2}`,
                color: sel ? "#FF6B6B" : TEXT2, transition: "all .14s",
              }}>
                {c.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />}
                {c.label}
              </button>
            );
          })}
        </div>
        {/* search (pushed left) */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginInlineStart: "auto", background: "rgba(255,255,255,0.03)", border: `1px solid ${BDR2}`, borderRadius: 12, padding: "10px 14px", minWidth: 280 }}>
          <span style={{ color: MUTED, fontSize: 14 }}>⌕</span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="חיפוש שיר או גרסה..." style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: TEXT, fontSize: 13, fontFamily: "inherit" }} />
        </div>
      </div>

      {/* ── main: library table + pending side ── */}
      <div className="rap-music">

        {/* library */}
        <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "18px 24px", borderBottom: `1px solid ${BDR}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
              <span style={{ fontSize: 17.5, fontWeight: 800, color: TEXT }}>ספריית השירים שלי</span>
            </div>
            <span style={{ fontSize: 12.5, color: MUTED }}>24 תוצאות</span>
          </div>

          {/* column header — same grid + padding as rows */}
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "13px 24px", borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.015)" }}>
            {heads.map((h, i) => (
              <div key={i} style={{ fontSize: 12, fontWeight: 800, color: "#9A9AA6", letterSpacing: "0.05em", textTransform: "uppercase", textAlign: h.align }}>{h.label}</div>
            ))}
          </div>

          {/* rows — identical grid + padding so every column lines up under its header */}
          <div style={{ padding: "6px 0 8px" }}>
            {rows.length === 0 ? (
              <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13.5, color: MUTED }}>לא נמצאו שירים</div>
            ) : rows.map(t => (
              <div key={t.name} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", padding: "15px 24px", border: "1px solid transparent", transition: "all .14s" }}>
                {/* play (right column) */}
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <button style={playBtnLg} aria-label="play">▶</button>
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
                <div style={{ textAlign: "center" }}><button style={dotsBtn} aria-label="more">⋯</button></div>
              </div>
            ))}
            <button style={{ ...linkBtn, display: "block", width: "100%", textAlign: "center", padding: "14px 0 10px", fontWeight: 700 }}>הצג עוד ⌄</button>
          </div>
        </div>

        {/* pending approval side */}
        <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "18px 20px", borderBottom: `1px solid ${BDR}` }}>
            <span style={{ fontSize: 16.5, fontWeight: 800, color: TEXT }}>ממתין לאישור</span>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: "#FF6B6B", background: "rgba(220,38,38,0.14)", border: `1px solid ${BRAND}55`, borderRadius: 99, padding: "3px 10px" }}>{PENDING_TRACKS.length}</span>
          </div>
          <div style={{ padding: "8px 16px 14px" }}>
            {PENDING_TRACKS.map((p, i) => (
              <div key={p.name} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 10px", borderRadius: 14, border: "1px solid transparent", borderBottom: i === PENDING_TRACKS.length - 1 ? "1px solid transparent" : `1px solid ${BDR}`, transition: "all .14s" }}>
                <button style={playBtnLg} aria-label="play">▶</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#FFFFFF", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: TEXT2, marginTop: 4 }}>{p.kind} · עודכן {p.date}</div>
                  <span style={{ display: "inline-block", marginTop: 8, fontSize: 10.5, fontWeight: 800, color: "#F59E0B", background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.5)", borderRadius: 7, padding: "3px 10px" }}>ממתין לאישור</span>
                </div>
                <Disc />
              </div>
            ))}
            <button style={{ display: "block", width: "100%", textAlign: "center", marginTop: 10, padding: "13px 0", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`, color: TEXT, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>הצג הכל</button>
          </div>
        </div>
      </div>

      {/* ── bottom mock player bar (visual only — does NOT touch the global player) ── */}
      <div style={{ ...panel, display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", padding: "22px 28px", marginTop: 4, marginBottom: 12 }}>
        {/* now playing (right) */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 250 }}>
          {/* mini waveform */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2.5, height: 42 }}>
            {[14, 28, 18, 36, 22, 31, 15, 25, 34, 20, 30, 16].map((h, i) => (
              <span key={i} style={{ width: 3, height: h, borderRadius: 2, background: BRAND, opacity: 0.85 }} />
            ))}
          </div>
          <div style={{ width: 56, height: 56, borderRadius: 12, flexShrink: 0, background: `linear-gradient(140deg, ${BRAND}66, #2A0E0E)`, border: `1px solid ${BDR2}` }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, whiteSpace: "nowrap" }}>הסיפור שלי</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>מיקס · 03:42</div>
          </div>
          <span style={{ color: "#FF6B6B", fontSize: 17 }}>♥</span>
        </div>

        {/* transport (center) */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginInlineStart: "auto", marginInlineEnd: "auto" }}>
          <span style={{ color: TEXT2, fontSize: 17, cursor: "pointer" }}>⇄</span>
          <span style={{ color: TEXT, fontSize: 19, cursor: "pointer" }}>⏮</span>
          <button style={{ width: 58, height: 58, borderRadius: "50%", flexShrink: 0, background: "radial-gradient(circle at 50% 35%, rgba(220,38,38,0.4), #150809 78%)", border: `1px solid ${BRAND}`, color: "#fff", fontSize: 18, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 0 22px rgba(220,38,38,0.45)` }}>▶</button>
          <span style={{ color: TEXT, fontSize: 19, cursor: "pointer" }}>⏭</span>
          <span style={{ color: TEXT2, fontSize: 17, cursor: "pointer" }}>↻</span>
        </div>

        {/* volume + icons (left) */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 220, justifyContent: "flex-end" }}>
          <span style={{ color: TEXT2, fontSize: 16 }}>🔊</span>
          <div style={{ width: 150, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.10)", position: "relative" }}>
            <div style={{ position: "absolute", insetInlineStart: 0, top: 0, bottom: 0, width: "70%", background: BRAND, borderRadius: 3 }} />
          </div>
          <span style={{ color: MUTED, fontSize: 16 }}>🖥</span>
          <span style={{ color: MUTED, fontSize: 16 }}>☰</span>
        </div>
      </div>
    </div>
  );
}

// ── Home dashboard ───────────────────────────────────────────────────────────────
function HomeDashboard() {
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

        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 30, padding: "44px 44px" }}>

          {/* Identity (start / right in RTL) — name/avatar + "all updates" button */}
          <div style={{ display: "flex", flexDirection: "column", gap: 15, minWidth: 244 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <ArtistAvatar />
              <div style={{ textAlign: "start" }}>
                <div style={{ fontSize: 27, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em" }}>שליו טסמה</div>
                <div style={{ fontSize: 13.5, color: TEXT2, marginTop: 4 }}>אמן • Redbloods Records</div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 9, padding: "3px 11px 3px 9px", borderRadius: 99, background: "rgba(52,211,153,0.10)", border: "1px solid rgba(52,211,153,0.30)" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, boxShadow: `0 0 7px ${GREEN}` }} />
                  <span style={{ fontSize: 11.5, color: GREEN, fontWeight: 700 }}>פעיל</span>
                </div>
              </div>
            </div>
            <button style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "11px 18px", borderRadius: 12, border: "none", color: "#fff",
              background: "linear-gradient(180deg, #E5322F, #C01C1C)",
              fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
              boxShadow: `0 6px 20px rgba(220,38,38,0.4)`,
            }}>☰ לכל העדכונים</button>
          </div>

          {/* Greeting + live "latest updates" flash (grows, centered) */}
          <div style={{ flex: 1, minWidth: 320, textAlign: "center" }}>
            <h1 style={{ fontSize: 41, fontWeight: 900, margin: 0, letterSpacing: "-0.03em", color: "#fff", textShadow: "0 2px 24px rgba(0,0,0,0.55)" }}>
              ברוך הבא, שליו <span style={{ WebkitTextFillColor: "initial" }}>👋</span>
            </h1>
            <p style={{ fontSize: 14.5, color: "#C8C8CC", lineHeight: 1.7, margin: "13px auto 0", maxWidth: 520 }}>
              זה המקום שלך ליצור, לשחרר ולהוביל. אנחנו כאן כדי לקחת את המוזיקה שלך רחוק.
            </p>

            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 18, marginBottom: 10 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "#FF6B6B", letterSpacing: "0.02em" }}>עדכונים אחרונים</span>
            </div>

            <NewsFlash />
          </div>
        </div>
      </div>

      {/* ── 2. "מה מחכה לך עכשיו" ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>מה מחכה לך עכשיו</span>
        </div>
        <div className="rap-acts">
          <ActionCard icon="📅" title="סשן קרוב" body="פגישת אמן והפקה" sub="08.06.2025 · יום ראשון · 18:00" cta="פרטים" />
          <ActionCard icon="↑" title="להעלות סקיצה" body="שיתוף רעיון חדש להערות" cta="העלאה" primary />
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
                <button style={playBtn} aria-label="play">▶</button>
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
            <button style={{ ...linkBtn, display: "block", width: "100%", textAlign: "start", padding: "10px 4px 6px" }}>‹ לכל השירים והסקיצות</button>
          </div>
        </SectionCard>

        {/* מאזן (artist-only: income / expenses / balance — NO split, NO debt) */}
        <SectionCard title="מאזן" link="לכל הדוחות הפיננסיים →">
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
      <SectionCard title="עדכונים מהלייבל" link="לכל העדכונים →">
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

      {/* week row with side arrows (decorative); ראשון on the right in RTL */}
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
                  {/* day header */}
                  <div style={{ textAlign: "center", padding: "10px 6px 8px" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: sel || has ? "#fff" : TEXT2 }}>{d.day}</div>
                    <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2, direction: "ltr" }}>{d.date}</div>
                  </div>
                  {/* events / empty */}
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

  return (
    <div style={{
      position: "relative", overflow: "hidden", borderRadius: 16, maxWidth: 640, margin: "0 auto",
      background: "rgba(8,6,7,0.62)", border: `1px solid ${BDR2}`,
      boxShadow: `0 0 28px rgba(220,38,38,0.13), inset 0 1px 0 rgba(255,255,255,0.05)`,
      backdropFilter: "blur(6px)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 16px" }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: "rgba(220,38,38,0.14)", border: `1px solid ${BRAND}55`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, boxShadow: `0 0 14px rgba(220,38,38,0.25)` }}>📡</span>
        <div style={{ flex: 1, minWidth: 0, textAlign: "start", ...fade }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cur.text}</div>
        </div>
        <span style={{ fontSize: 12, color: MUTED, whiteSpace: "nowrap", flexShrink: 0, ...fade }}>{cur.time}</span>
        <button onClick={advance} aria-label="העדכון הבא" style={{ background: "none", border: "none", color: TEXT2, fontSize: 20, cursor: "pointer", flexShrink: 0, lineHeight: 1, padding: "0 2px" }}>‹</button>
      </div>
      {/* thin red progress bar (restarts each rotation) */}
      <div key={idx} style={{ position: "absolute", bottom: 0, insetInlineStart: 0, height: 2.5, background: BRAND, boxShadow: `0 0 8px ${BRAND}`, borderRadius: 2, animation: "rapProgress 4.6s linear" }} />
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────────
function ActionCard({ icon, title, body, sub, tag, cta, primary }: {
  icon: string; title: string; body: string; sub?: string; tag?: string; cta: string; primary?: boolean;
}) {
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
      <button style={primary ? {
        padding: "11px 0", borderRadius: 12, border: "none", color: "#fff",
        background: "linear-gradient(180deg, #E5322F, #C01C1C)",
        fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 4px 16px rgba(220,38,38,0.32)`,
      } : {
        padding: "11px 0", borderRadius: 12, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`,
        color: TEXT, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      }}>{cta}</button>
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

// Play button — dark circle with a subtle red border + glow (per reference).
const playBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
  background: "radial-gradient(circle at 50% 35%, rgba(220,38,38,0.22), #150809 75%)",
  border: `1px solid ${BRAND}55`, color: "#fff",
  fontSize: 10.5, cursor: "pointer", fontFamily: "inherit",
  boxShadow: `0 0 12px rgba(220,38,38,0.28)`,
  display: "flex", alignItems: "center", justifyContent: "center",
};
// Larger play button used across the "המוזיקה שלי" page (table + side card).
const playBtnLg: React.CSSProperties = {
  width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
  background: "radial-gradient(circle at 50% 35%, rgba(220,38,38,0.26), #150809 75%)",
  border: `1px solid ${BRAND}66`, color: "#fff",
  fontSize: 12, cursor: "pointer", fontFamily: "inherit",
  boxShadow: `0 0 14px rgba(220,38,38,0.3)`,
  display: "flex", alignItems: "center", justifyContent: "center",
};
const dotsBtn: React.CSSProperties = {
  background: "none", border: "none", color: MUTED, fontSize: 16, cursor: "pointer", flexShrink: 0, padding: "0 2px",
};
