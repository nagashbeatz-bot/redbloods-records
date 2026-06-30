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
  { name: "My Story - Mix v2",      kind: "מיקס",  status: "ממתין לאישור", date: "28.05.2025" },
  { name: "Heart of Time - Demo",   kind: "סקיצה", status: "בבדיקה",       date: "27.05.2025" },
  { name: "Closer Part 2 - Master", kind: "מאסטר", status: "מאושר",        date: "26.05.2025" },
  { name: "Another Life - Sketch",  kind: "סקיצה", status: "סקיצה",        date: "25.05.2025" },
];

const UPDATES: string[] = [
  "נוסף ביט חדש של Nagash בשם Focus",
  "המיקס של My Story מוכן לאישור",
  "נקבע סשן אולפן חדש",
  "עודכן מאזן החודש",
];

// ── Artist calendar (יומן האמן) — demo timeline ──────────────────────────────────
type CalType   = "סשן" | "סושיאל" | "הופעה" | "צילום" | "דדליין";
type CalStatus = "מתוכנן" | "ממתין לאישור" | "בוצע" | "מתוזמן";
const CAL_TYPE_COLOR: Record<CalType, string> = {
  "סשן":   "#60A5FA",
  "סושיאל": "#EC4899",
  "צילום":  "#F59E0B",
  "הופעה":  "#FB7185",
  "דדליין": "#EF4444",
};
const CAL_STATUS_COLOR: Record<CalStatus, string> = {
  "מתוכנן":      "#9CA3AF",
  "ממתין לאישור": "#F59E0B",
  "בוצע":        "#34D399",
  "מתוזמן":      "#60A5FA",
};
const CALENDAR: { day: string; month: string; time: string; type: CalType; title: string; desc: string; status: CalStatus }[] = [
  { day: "01", month: "יולי", time: "16:00", type: "סשן",    title: "סשן אולפן",          desc: "הקלטת ווקאל ל-Heart of Time",     status: "מתוכנן" },
  { day: "03", month: "יולי", time: "18:00", type: "סשן",    title: "פגישה עם Nagash",    desc: "תיאום שחרורים ולו״ז הוצאות",       status: "מתוכנן" },
  { day: "05", month: "יולי", time: "12:00", type: "צילום",  title: "צילום תוכן",         desc: "סשן צילום לקאבר ולרילסים",         status: "מתוזמן" },
  { day: "07", month: "יולי", time: "20:00", type: "סושיאל", title: "העלאת ריל",          desc: "ריל טיזר ל-My Story",             status: "מתוזמן" },
  { day: "10", month: "יולי", time: "—",     type: "סושיאל", title: "קמפיין סושיאל",       desc: "קמפיין שחרור ל-Closer Part 2",     status: "מתוכנן" },
  { day: "12", month: "יולי", time: "21:00", type: "הופעה",  title: "הופעה / אירוע",       desc: "הופעה במועדון · סט 40 דקות",        status: "מתוכנן" },
  { day: "14", month: "יולי", time: "—",     type: "דדליין", title: "דדליין לאישור תוכן",  desc: "אישור סופי למאסטר של My Story",     status: "ממתין לאישור" },
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

function Cover({ size = 44 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 10, flexShrink: 0,
      background: `linear-gradient(140deg, ${BRAND}66 0%, #2A0E0E 70%)`,
      border: `1px solid ${BDR2}`,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 12px rgba(0,0,0,0.4)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.4, color: "#fff", opacity: 0.96,
    }}>♪</div>
  );
}

function rowHover(e: React.MouseEvent<HTMLElement>, on: boolean) {
  e.currentTarget.style.background = on ? "rgba(220,38,38,0.06)" : "transparent";
  e.currentTarget.style.borderColor = on ? "rgba(220,38,38,0.28)" : "transparent";
}

// ── Page ─────────────────────────────────────────────────────────────────────────
export default function ArtistPortalPage() {
  const [tab, setTab] = useState<Tab>("בית");

  return (
    <div dir="rtl" style={{ minHeight: "100%", background: "#0A0A0B", color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", padding: "30px 24px 100px" }}>
      {/* Centered premium island — intentionally NOT full-width (black breathing room around) */}
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* Responsive grids: "המוזיקה שלי" gets priority width; everything stacks on small screens. */}
        <style>{`
          .rap-grid-a, .rap-grid-b { display: grid; gap: 18px; align-items: start; }
          .rap-grid-a { grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); }
          .rap-grid-b { grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); }
          @media (max-width: 1040px) {
            .rap-grid-a, .rap-grid-b { grid-template-columns: 1fr; }
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

        {tab === "בית" ? <HomeDashboard /> : <ComingSoon tab={tab} />}
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 17 }}>
          <ActionCard icon="↑" title="להעלות סקיצה" body="שתף רעיון חדש ללייבל" cta="העלאה" primary />
          <ActionCard icon="📅" title="סשן קרוב" body="פגישה עם Nagash" sub="03.07.2025 · 18:00" cta="פרטים" />
        </div>
      </div>

      {/* ── 3. Main grid (row A) — music-forward in RTL: המוזיקה שלי (right) → ביטים → מאזן ── */}
      <div className="rap-grid-a">

        {/* המוזיקה שלי */}
        <SectionCard title="המוזיקה שלי" link="לכל המוזיקה שלי →">
          <div style={{ padding: "10px 12px" }}>
            {SONGS.map(s => (
              <div key={s.name} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 14px", borderRadius: 13, border: "1px solid transparent", transition: "all .14s" }}>
                <Cover size={48} />
                <button style={playBtn} aria-label="play">▶</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>{s.kind}</div>
                </div>
                <StatusBadge status={s.status} />
                <span style={{ fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>{s.date}</span>
                <button style={dotsBtn} aria-label="more">⋮</button>
              </div>
            ))}
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

      {/* ── 3. Main grid (row B) ── */}
      <div className="rap-grid-b">

        {/* יומן האמן — prominent timeline */}
        <SectionCard title="יומן האמן" link="לכל הפעילויות →">
          <div style={{ padding: "8px 14px 12px" }}>
            {CALENDAR.map((ev, i) => {
              const tc = CAL_TYPE_COLOR[ev.type];
              const sc = CAL_STATUS_COLOR[ev.status];
              return (
                <div key={ev.title} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                  style={{ display: "flex", alignItems: "stretch", gap: 13, padding: "13px 10px", borderRadius: 13, border: "1px solid transparent", borderBottom: i === CALENDAR.length - 1 ? "1px solid transparent" : `1px solid ${BDR}`, transition: "all .14s" }}>
                  {/* date block */}
                  <div style={{ textAlign: "center", width: 52, flexShrink: 0, padding: "7px 0", borderRadius: 11, background: "rgba(220,38,38,0.08)", border: `1px solid ${BRAND}33`, alignSelf: "center" }}>
                    <div style={{ fontSize: 19, fontWeight: 900, color: "#FF6B6B", lineHeight: 1 }}>{ev.day}</div>
                    <div style={{ fontSize: 10, color: TEXT2, marginTop: 2 }}>{ev.month}</div>
                  </div>
                  {/* colored type accent line */}
                  <div style={{ width: 3, borderRadius: 3, background: tc, flexShrink: 0, boxShadow: `0 0 8px ${tc}66` }} />
                  {/* content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{ev.title}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: tc, background: `${tc}1A`, border: `1px solid ${tc}45`, borderRadius: 6, padding: "2px 8px" }}>{ev.type}</span>
                    </div>
                    <div style={{ fontSize: 12, color: TEXT2, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.desc}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: sc, background: `${sc}18`, border: `1px solid ${sc}40`, borderRadius: 6, padding: "2px 9px" }}>{ev.status}</span>
                      <span style={{ fontSize: 11.5, color: MUTED, direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace" }}>{ev.time}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        {/* עדכונים מהלייבל */}
        <SectionCard title="עדכונים מהלייבל" link="לכל העדכונים →">
          <div style={{ padding: "10px 16px" }}>
            {UPDATES.map((u, i) => (
              <div key={u} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 4px", borderBottom: i === UPDATES.length - 1 ? "none" : `1px solid ${BDR}` }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: BRAND, marginTop: 6, flexShrink: 0, boxShadow: `0 0 7px ${BRAND}` }} />
                <span style={{ fontSize: 12.5, color: "#C4C4C8", lineHeight: 1.55 }}>{u}</span>
              </div>
            ))}
          </div>
        </SectionCard>

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

const playBtn: React.CSSProperties = {
  width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
  background: "linear-gradient(180deg, rgba(220,38,38,0.28), rgba(220,38,38,0.14))",
  border: `1px solid ${BRAND}66`, color: "#fff",
  fontSize: 11, cursor: "pointer", fontFamily: "inherit",
  boxShadow: `0 2px 10px rgba(220,38,38,0.25)`,
};
const dotsBtn: React.CSSProperties = {
  background: "none", border: "none", color: MUTED, fontSize: 16, cursor: "pointer", flexShrink: 0, padding: "0 2px",
};
