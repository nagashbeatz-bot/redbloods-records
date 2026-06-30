"use client";

import { useState } from "react";

// ── Redbloods design tokens (black / dark-grey / red / white — NO purple) ─────────
const CARD2  = "#1A1A1A";
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

const BEATS: { name: string; bpm: string; key: string }[] = [
  { name: "Midnight City", bpm: "92 BPM",  key: "F#m" },
  { name: "No Sleep",      bpm: "120 BPM", key: "Cm" },
  { name: "Focus",         bpm: "140 BPM", key: "Dm" },
];

const SCHEDULE: { day: string; month: string; title: string; time: string }[] = [
  { day: "25", month: "יוני",  title: "פגישה עם Nagash", time: "18:00" },
  { day: "01", month: "יולי",  title: "סשן אולפן",       time: "16:00" },
  { day: "12", month: "יולי",  title: "הופעה / אירוע",   time: "21:00" },
];

const UPDATES: string[] = [
  "נוסף ביט חדש של Nagash בשם Focus",
  "המיקס של My Story מוכן לאישור",
  "נקבע סשן אולפן חדש",
  "עודכן מאזן החודש",
];

const QUICK_LINKS: { label: string; icon: string }[] = [
  { label: "העלאת קובץ",  icon: "↑" },
  { label: "יצירת הודעה", icon: "✉" },
  { label: "מרכז תמיכה",  icon: "🎧" },
  { label: "נהלי עבודה",  icon: "📋" },
];

const TABS = ["בית", "המוזיקה שלי", "ביטים פנויים", "מאזן", "לו״ז ועדכונים"] as const;
type Tab = (typeof TABS)[number];

// ── Small shared building blocks ─────────────────────────────────────────────────
function SectionCard({ title, link, children }: { title: string; link?: string; children: React.ReactNode }) {
  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${BDR}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>{title}</span>
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
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>

        {/* Responsive grids: "המוזיקה שלי" gets priority width; everything stacks on small screens. */}
        <style>{`
          .rap-grid-a, .rap-grid-b { display: grid; gap: 18px; align-items: start; }
          .rap-grid-a { grid-template-columns: minmax(0, 1.65fr) minmax(0, 1.05fr) minmax(0, 1fr); }
          .rap-grid-b { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          @media (max-width: 1040px) {
            .rap-grid-a, .rap-grid-b { grid-template-columns: 1fr; }
          }
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
          radial-gradient(140% 165% at 92% -18%, rgba(220,38,38,0.42) 0%, rgba(220,38,38,0.11) 36%, #120E0F 70%),
          radial-gradient(90% 130% at 48% 130%, rgba(220,38,38,0.12) 0%, transparent 58%),
          linear-gradient(180deg, #1A1314 0%, #0C0A0B 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 95px rgba(220,38,38,0.15), 0 30px 72px rgba(0,0,0,0.55)`,
      }}>
        {/* subtle vignette toward the greeting side */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(10,10,11,0) 30%, rgba(10,10,11,0.7) 100%)", pointerEvents: "none" }} />
        {/* fine red top hairline glow */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${BRAND}66, transparent)`, pointerEvents: "none" }} />

        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 28, padding: "46px 42px" }}>

          {/* Identity (start / right in RTL) */}
          <div style={{ display: "flex", alignItems: "center", gap: 18, minWidth: 260 }}>
            <div style={{
              padding: 3, borderRadius: "50%", flexShrink: 0,
              background: `conic-gradient(from 150deg, ${BRAND}, #7A1414, ${BRAND}, #7A1414, ${BRAND})`,
              boxShadow: `0 0 34px ${BRAND}45`,
            }}>
              <div style={{
                width: 74, height: 74, borderRadius: "50%",
                background: "linear-gradient(140deg, #2A0E0E, #140808)",
                border: "1px solid rgba(255,255,255,0.10)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 30, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em",
                boxShadow: "inset 0 2px 8px rgba(0,0,0,0.5)",
              }}>ש</div>
            </div>
            <div>
              <div style={{ fontSize: 25, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em" }}>שליו טסמה</div>
              <div style={{ fontSize: 13, color: TEXT2, marginTop: 4 }}>אמן • Redbloods Records</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 9, padding: "3px 11px 3px 9px", borderRadius: 99, background: "rgba(52,211,153,0.10)", border: "1px solid rgba(52,211,153,0.30)" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, boxShadow: `0 0 7px ${GREEN}` }} />
                <span style={{ fontSize: 11.5, color: GREEN, fontWeight: 700 }}>פעיל</span>
              </div>
            </div>
          </div>

          {/* Greeting + next step (grows, pushed to the left side) */}
          <div style={{ flex: 1, minWidth: 300, marginInlineStart: "auto", textAlign: "start" }}>
            <h1 style={{ fontSize: 36, fontWeight: 900, margin: 0, letterSpacing: "-0.03em", color: "#fff", textShadow: "0 2px 24px rgba(0,0,0,0.55)" }}>
              ברוך הבא, שליו <span style={{ WebkitTextFillColor: "initial" }}>👋</span>
            </h1>
            <p style={{ fontSize: 14, color: "#C8C8CC", lineHeight: 1.7, margin: "12px 0 0", maxWidth: 480 }}>
              זה המקום שלך ליצור, לשחרר ולהוביל. אנחנו כאן כדי לקחת את המוזיקה שלך רחוק.
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 18 }}>
              <button style={{
                padding: "10px 20px", borderRadius: 12, border: "none", color: "#fff",
                background: "linear-gradient(180deg, #E5322F, #C01C1C)",
                fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                boxShadow: `0 6px 20px rgba(220,38,38,0.4)`,
              }}>✎ עריכת פרופיל</button>

              <div style={{
                display: "inline-flex", alignItems: "center", gap: 12,
                background: "rgba(255,255,255,0.045)", border: `1px solid ${BDR2}`,
                borderRadius: 13, padding: "8px 8px 8px 15px",
                backdropFilter: "blur(6px)",
              }}>
                <span style={{ fontSize: 12.5, color: TEXT2 }}>
                  המשך במה שנשאר: <strong style={{ color: "#fff" }}>לאשר את המיקס My Story - Mix v2</strong>
                </span>
                <button style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 15px", borderRadius: 10,
                  background: "rgba(220,38,38,0.16)", border: `1px solid ${BRAND}66`, color: "#FF6B6B",
                  fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                }}>▶ לצפייה</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. "מה מחכה לך עכשיו" ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 9px ${BRAND}` }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>מה מחכה לך עכשיו</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(262px, 1fr))", gap: 16 }}>
          <ActionCard icon="✓" title="לאשר מיקס" body="My Story - Mix v2" tag="ממתין לאישור" cta="לצפייה" />
          <ActionCard icon="♫" title="לבחור ביט" body="יש ביטים חדשים שמחכים לך" cta="לצפייה בביטים" />
          <ActionCard icon="↑" title="להעלות סקיצה" body="שתף רעיון חדש ללייבל" cta="העלאה" primary />
          <ActionCard icon="📅" title="סשן קרוב" body="פגישה עם Nagash" sub="25.06.2025 · 18:00" cta="פרטים" />
        </div>
      </div>

      {/* ── 3. Main grid (row A) — music-forward in RTL: המוזיקה שלי (right) → ביטים → מאזן ── */}
      <div className="rap-grid-a">

        {/* המוזיקה שלי */}
        <SectionCard title="המוזיקה שלי" link="לכל המוזיקה שלי →">
          <div style={{ padding: "10px 12px" }}>
            {SONGS.map(s => (
              <div key={s.name} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 12px", borderRadius: 13, border: "1px solid transparent", transition: "all .14s" }}>
                <Cover />
                <button style={playBtn} aria-label="play">▶</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{s.kind}</div>
                </div>
                <StatusBadge status={s.status} />
                <span style={{ fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>{s.date}</span>
                <button style={dotsBtn} aria-label="more">⋮</button>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ביטים פנויים — Beat Room feel */}
        <SectionCard title="ביטים פנויים" link="לכל הביטים →">
          <div style={{ padding: "10px 12px" }}>
            {BEATS.map(b => (
              <div key={b.name} onMouseEnter={e => rowHover(e, true)} onMouseLeave={e => rowHover(e, false)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, border: "1px solid transparent", transition: "all .14s" }}>
                <div style={{ position: "relative" }}>
                  <Cover size={46} />
                  <Equalizer />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                  <span style={{ display: "inline-block", marginTop: 5, fontSize: 10.5, fontWeight: 700, color: TEXT2, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`, borderRadius: 7, padding: "2px 9px", direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace" }}>{b.bpm} · {b.key}</span>
                </div>
                <button style={ghostPill}>♥ אהבתי</button>
                <button style={ghostPill}>⌖ שמור</button>
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
              <span style={{ fontSize: 12.5, color: "#E8B7B7", fontWeight: 700 }}>מאזן נוכחי</span>
              <span style={{ fontSize: 20, fontWeight: 900, color: "#FF6B6B", direction: "ltr" }}>₪8,320</span>
            </div>
            <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.6, marginTop: 12, background: "rgba(255,255,255,0.02)", border: `1px solid ${BDR}`, borderRadius: 10, padding: "10px 12px" }}>
              כאן מוצגות רק הכנסות והוצאות שמשויכות אליך וגלויות לך.
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── 3. Main grid (row B) ── */}
      <div className="rap-grid-b">

        {/* לו״ז קרוב */}
        <SectionCard title="לו״ז קרוב" link="לכל הפגישות →">
          <div style={{ padding: "10px 16px" }}>
            {SCHEDULE.map((ev, i) => (
              <div key={ev.day + ev.title} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 4px", borderBottom: i === SCHEDULE.length - 1 ? "none" : `1px solid ${BDR}` }}>
                <div style={{ textAlign: "center", width: 50, flexShrink: 0, padding: "6px 0", borderRadius: 11, background: "rgba(220,38,38,0.08)", border: `1px solid ${BRAND}33` }}>
                  <div style={{ fontSize: 19, fontWeight: 900, color: "#FF6B6B", lineHeight: 1 }}>{ev.day}</div>
                  <div style={{ fontSize: 10, color: TEXT2, marginTop: 2 }}>{ev.month}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: TEXT }}>{ev.title}</div>
                <div style={{ fontSize: 12, color: TEXT2, direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace" }}>{ev.time}</div>
              </div>
            ))}
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

        {/* קישורים מהירים — 2×2 */}
        <SectionCard title="קישורים מהירים">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, padding: "15px 16px 17px" }}>
            {QUICK_LINKS.map(q => (
              <button key={q.label} onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(220,38,38,0.4)"; e.currentTarget.style.background = "#1C1516"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = BDR; e.currentTarget.style.background = CARD2; }}
                style={{
                  display: "flex", alignItems: "center", gap: 11, padding: "15px 14px", borderRadius: 13,
                  background: CARD2, border: `1px solid ${BDR}`, color: TEXT, fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit", textAlign: "start", transition: "all .14s",
                }}>
                <span style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, background: "rgba(220,38,38,0.13)", border: `1px solid ${BRAND}44`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{q.icon}</span>
                {q.label}
              </button>
            ))}
          </div>
        </SectionCard>
      </div>
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
      style={{ ...panel, padding: "22px 22px 20px", display: "flex", flexDirection: "column", gap: 13, minHeight: 190, transition: "transform .16s, border-color .16s, box-shadow .16s" }}>
      <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(180deg, rgba(220,38,38,0.18), rgba(220,38,38,0.08))", border: `1px solid ${BRAND}44`, color: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15.5, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>{title}</div>
        <div style={{ fontSize: 13, color: TEXT2, marginTop: 6, lineHeight: 1.55 }}>{body}</div>
        {sub && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4, direction: "ltr", textAlign: "right", fontFamily: "ui-monospace, Menlo, monospace" }}>{sub}</div>}
        {tag && <span style={{ display: "inline-block", marginTop: 9, fontSize: 10.5, fontWeight: 700, color: AMBER, background: `${AMBER}18`, border: `1px solid ${AMBER}40`, borderRadius: 7, padding: "3px 10px" }}>{tag}</span>}
      </div>
      <button style={primary ? {
        padding: "9px 0", borderRadius: 11, border: "none", color: "#fff",
        background: "linear-gradient(180deg, #E5322F, #C01C1C)",
        fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 4px 16px rgba(220,38,38,0.32)`,
      } : {
        padding: "9px 0", borderRadius: 11, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`,
        color: TEXT, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
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
        <span style={{ fontSize: 12.5, color: TEXT2 }}>{label}</span>
      </div>
      <span style={{ fontSize: 17, fontWeight: 800, color, direction: "ltr" }}>{value}</span>
    </div>
  );
}

// Tiny equalizer accent overlaid on a beat cover — gives the "Beat Room" feel.
function Equalizer() {
  const bars = [10, 16, 7, 13];
  return (
    <div style={{ position: "absolute", bottom: 5, insetInlineStart: 5, display: "flex", alignItems: "flex-end", gap: 2, height: 16, pointerEvents: "none" }}>
      {bars.map((h, i) => (
        <span key={i} style={{ width: 2.5, height: h, borderRadius: 2, background: "#fff", opacity: 0.85, boxShadow: "0 0 6px rgba(255,255,255,0.4)" }} />
      ))}
    </div>
  );
}

const playBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
  background: "linear-gradient(180deg, rgba(220,38,38,0.28), rgba(220,38,38,0.14))",
  border: `1px solid ${BRAND}66`, color: "#fff",
  fontSize: 11, cursor: "pointer", fontFamily: "inherit",
  boxShadow: `0 2px 10px rgba(220,38,38,0.25)`,
};
const dotsBtn: React.CSSProperties = {
  background: "none", border: "none", color: MUTED, fontSize: 16, cursor: "pointer", flexShrink: 0, padding: "0 2px",
};
const ghostPill: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 9, whiteSpace: "nowrap",
  background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", fontFamily: "inherit",
};
