"use client";

import { useState } from "react";

// ── Redbloods design tokens (black / dark-grey / red / white — NO purple) ─────────
const CARD   = "#141414";
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
const card: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${BDR}`,
  borderRadius: 18,
  overflow: "hidden",
};

function SectionCard({ title, link, children }: { title: string; link?: string; children: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 20px", borderBottom: `1px solid ${BDR}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 8px ${BRAND}99` }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>{title}</span>
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

function Cover({ size = 42 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 9, flexShrink: 0,
      background: `linear-gradient(135deg, ${BRAND}55, #2A0E0E)`,
      border: `1px solid ${BDR2}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.42, color: "#fff", opacity: 0.95,
    }}>♪</div>
  );
}

function hoverCard(e: React.MouseEvent<HTMLElement>, on: boolean) {
  e.currentTarget.style.borderColor = on ? "rgba(220,38,38,0.35)" : BDR;
  e.currentTarget.style.background = on ? "#171717" : CARD;
}

// ── Page ─────────────────────────────────────────────────────────────────────────
export default function ArtistPortalPage() {
  const [tab, setTab] = useState<Tab>("בית");

  return (
    <div dir="rtl" style={{ minHeight: "100%", background: "#0D0D0D", color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", padding: "28px 28px 90px" }}>
      <div style={{ maxWidth: 1500, margin: "0 auto" }}>

        {/* ── Internal portal nav (horizontal tabs — global sidebar stays the only sidebar) ── */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
          {TABS.map(tb => {
            const active = tb === tab;
            return (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                style={{
                  fontSize: 13.5, fontWeight: active ? 800 : 600, fontFamily: "inherit", cursor: "pointer",
                  padding: "9px 18px", borderRadius: 11, whiteSpace: "nowrap",
                  background: active ? "rgba(220,38,38,0.14)" : CARD,
                  border: `1px solid ${active ? "rgba(220,38,38,0.45)" : BDR}`,
                  color: active ? BRAND : TEXT2, transition: "all .14s",
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
    <div style={{ ...card, padding: "70px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>🚧</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, marginBottom: 6 }}>{tab}</div>
      <div style={{ fontSize: 13, color: TEXT2 }}>האזור הזה יוצג בקרוב</div>
    </div>
  );
}

// ── Home dashboard ───────────────────────────────────────────────────────────────
function HomeDashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* ── 1. Hero ── */}
      <div style={{
        position: "relative", overflow: "hidden", borderRadius: 22,
        border: `1px solid ${BDR2}`,
        background: `radial-gradient(120% 140% at 88% 0%, rgba(220,38,38,0.28) 0%, rgba(220,38,38,0.05) 38%, #0F0F10 70%)`,
      }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(13,13,13,0.0) 35%, rgba(13,13,13,0.85) 100%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 24, padding: "30px 34px" }}>

          {/* Identity (start / right in RTL) */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 260 }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%", flexShrink: 0,
              background: `linear-gradient(135deg, ${BRAND}, #7A1414)`,
              border: `2px solid ${BRAND}66`, boxShadow: `0 0 26px ${BRAND}44`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, fontWeight: 900, color: "#fff",
            }}>ש</div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em" }}>שליו טסמה</div>
              <div style={{ fontSize: 13, color: TEXT2, marginTop: 3 }}>אמן • Redbloods Records</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, boxShadow: `0 0 6px ${GREEN}99` }} />
                <span style={{ fontSize: 12, color: GREEN, fontWeight: 700 }}>פעיל</span>
              </div>
            </div>
          </div>

          {/* Greeting + next step (grows, pushed to the left side) */}
          <div style={{ flex: 1, minWidth: 280, marginInlineStart: "auto", textAlign: "start" }}>
            <h1 style={{ fontSize: 30, fontWeight: 900, margin: 0, letterSpacing: "-0.02em", color: "#fff" }}>ברוך הבא, שליו 👋</h1>
            <p style={{ fontSize: 13.5, color: TEXT2, lineHeight: 1.7, margin: "10px 0 0", maxWidth: 460 }}>
              זה המקום שלך ליצור, לשחרר ולהוביל. אנחנו כאן כדי לקחת את המוזיקה שלך רחוק.
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
              <button style={{
                padding: "9px 18px", borderRadius: 11, background: BRAND, border: "none", color: "#fff",
                fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                boxShadow: `0 2px 16px ${BRAND}55`,
              }}>עריכת פרופיל ✎</button>

              <div style={{
                display: "inline-flex", alignItems: "center", gap: 12,
                background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`,
                borderRadius: 12, padding: "8px 8px 8px 14px",
              }}>
                <span style={{ fontSize: 12.5, color: TEXT2 }}>
                  המשך במה שנשאר: <strong style={{ color: TEXT }}>לאשר את המיקס My Story - Mix v2</strong>
                </span>
                <button style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 9,
                  background: "rgba(220,38,38,0.15)", border: `1px solid ${BRAND}55`, color: BRAND,
                  fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                }}>▶ לצפייה</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. "מה מחכה לך עכשיו" ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, boxShadow: `0 0 8px ${BRAND}99` }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>מה מחכה לך עכשיו</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          <ActionCard icon="✓" title="לאשר מיקס" body="My Story - Mix v2" tag="ממתין לאישור" cta="לצפייה" />
          <ActionCard icon="♫" title="לבחור ביט" body="יש ביטים חדשים שמחכים לך" cta="לצפייה בביטים" />
          <ActionCard icon="↑" title="להעלות סקיצה" body="שתף רעיון חדש ללייבל" cta="העלאה" primary />
          <ActionCard icon="📅" title="סשן קרוב" body="פגישה עם Nagash" sub="25.06.2025 · 18:00" cta="פרטים" />
        </div>
      </div>

      {/* ── 3. Main grid (row A) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 18, alignItems: "start" }}>

        {/* המוזיקה שלי */}
        <SectionCard title="המוזיקה שלי" link="לכל המוזיקה שלי →">
          <div style={{ padding: "8px 12px" }}>
            {SONGS.map(s => (
              <div key={s.name} onMouseEnter={e => hoverCard(e, true)} onMouseLeave={e => hoverCard(e, false)}
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 8px", borderRadius: 11, border: "1px solid transparent", transition: "all .14s" }}>
                <Cover />
                <button style={playBtn}>▶</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{s.kind}</div>
                </div>
                <StatusBadge status={s.status} />
                <span style={{ fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>{s.date}</span>
                <button style={dotsBtn}>⋮</button>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ביטים פנויים */}
        <SectionCard title="ביטים פנויים" link="לכל הביטים →">
          <div style={{ padding: "8px 12px" }}>
            {BEATS.map(b => (
              <div key={b.name} onMouseEnter={e => hoverCard(e, true)} onMouseLeave={e => hoverCard(e, false)}
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 8px", borderRadius: 11, border: "1px solid transparent", transition: "all .14s" }}>
                <Cover />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2, direction: "ltr", textAlign: "right" }}>{b.bpm} · {b.key}</div>
                </div>
                <button style={ghostPill}>♥ אהבתי</button>
                <button style={ghostPill}>⌖ שמור</button>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* מאזן (artist-only: income / expenses / balance — NO split, NO debt) */}
        <SectionCard title="מאזן" link="לכל הדוחות הפיננסיים →">
          <div style={{ padding: "12px 18px 16px" }}>
            <BalanceRow label="הכנסות שלי" value="₪10,450" color={GREEN} icon="↑" />
            <BalanceRow label="הוצאות שלי" value="₪2,130"  color={TEXT}  icon="↓" />
            <BalanceRow label="מאזן נוכחי" value="₪8,320"  color={BRAND} icon="≈" last />
            <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.6, marginTop: 12, background: "rgba(255,255,255,0.02)", border: `1px solid ${BDR}`, borderRadius: 10, padding: "9px 12px" }}>
              כאן מוצגות רק הכנסות והוצאות שמשויכות אליך וגלויות לך.
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── 3. Main grid (row B) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 18, alignItems: "start" }}>

        {/* לו״ז קרוב */}
        <SectionCard title="לו״ז קרוב" link="לכל הפגישות →">
          <div style={{ padding: "10px 14px" }}>
            {SCHEDULE.map(ev => (
              <div key={ev.day + ev.title} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 6px", borderBottom: `1px solid ${BDR}` }}>
                <div style={{ textAlign: "center", width: 46, flexShrink: 0 }}>
                  <div style={{ fontSize: 19, fontWeight: 900, color: BRAND, lineHeight: 1 }}>{ev.day}</div>
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{ev.month}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: TEXT }}>{ev.title}</div>
                <div style={{ fontSize: 12, color: TEXT2, direction: "ltr" }}>{ev.time}</div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* עדכונים מהלייבל */}
        <SectionCard title="עדכונים מהלייבל" link="לכל העדכונים →">
          <div style={{ padding: "10px 16px" }}>
            {UPDATES.map(u => (
              <div key={u} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 4px", borderBottom: `1px solid ${BDR}` }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: BRAND, marginTop: 6, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: TEXT2, lineHeight: 1.5 }}>{u}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* קישורים מהירים — 2×2 */}
        <SectionCard title="קישורים מהירים">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "14px 16px 16px" }}>
            {QUICK_LINKS.map(q => (
              <button key={q.label} onMouseEnter={e => hoverCard(e, true)} onMouseLeave={e => hoverCard(e, false)}
                style={{
                  display: "flex", alignItems: "center", gap: 11, padding: "14px 14px", borderRadius: 13,
                  background: CARD2, border: `1px solid ${BDR}`, color: TEXT, fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit", textAlign: "start", transition: "all .14s",
                }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: "rgba(220,38,38,0.14)", border: `1px solid ${BRAND}44`, color: BRAND, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{q.icon}</span>
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
    <div onMouseEnter={e => hoverCard(e, true)} onMouseLeave={e => hoverCard(e, false)}
      style={{ ...card, padding: "18px 18px 16px", display: "flex", flexDirection: "column", gap: 10, minHeight: 158, transition: "all .14s" }}>
      <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(220,38,38,0.13)", border: `1px solid ${BRAND}40`, color: BRAND, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: TEXT }}>{title}</div>
        <div style={{ fontSize: 12, color: TEXT2, marginTop: 4, lineHeight: 1.5 }}>{body}</div>
        {sub && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, direction: "ltr", textAlign: "right" }}>{sub}</div>}
        {tag && <span style={{ display: "inline-block", marginTop: 8, fontSize: 10.5, fontWeight: 700, color: AMBER, background: `${AMBER}18`, border: `1px solid ${AMBER}40`, borderRadius: 7, padding: "2px 9px" }}>{tag}</span>}
      </div>
      <button style={primary ? {
        padding: "8px 0", borderRadius: 10, background: BRAND, border: "none", color: "#fff",
        fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 2px 12px ${BRAND}44`,
      } : {
        padding: "8px 0", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`,
        color: TEXT, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
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

function BalanceRow({ label, value, color, icon, last }: { label: string; value: string; color: string; icon: string; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 0", borderBottom: last ? "none" : `1px solid ${BDR}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: `${color}1A`, border: `1px solid ${color}40`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{icon}</span>
        <span style={{ fontSize: 12.5, color: TEXT2 }}>{label}</span>
      </div>
      <span style={{ fontSize: 17, fontWeight: 900, color, direction: "ltr" }}>{value}</span>
    </div>
  );
}

const playBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
  background: "rgba(220,38,38,0.16)", border: `1px solid ${BRAND}55`, color: "#fff",
  fontSize: 11, cursor: "pointer", fontFamily: "inherit",
};
const dotsBtn: React.CSSProperties = {
  background: "none", border: "none", color: MUTED, fontSize: 16, cursor: "pointer", flexShrink: 0, padding: "0 2px",
};
const ghostPill: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: "6px 11px", borderRadius: 9, whiteSpace: "nowrap",
  background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", fontFamily: "inherit",
};
