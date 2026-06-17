"use client";

// ── Static design preview — /dashboard-preview ────────────────────────────
// Hardcoded dummy data. No DB, no hooks, no fetch. Preview only.

const BRAND = "#DC2626";
const SURFACE = "#141414";
const CARD = "#1A1A1A";
const CARD2 = "#1E1E1E";
const BORDER = "#252525";
const BORDER2 = "#2A2A2A";
const BG = "#0D0D0D";
const TEXT = "#F0F0F0";
const MUTED = "#888";
const DIM = "#555";
const SIDEBAR_W = 230;

// ── Nav items ─────────────────────────────────────────────────────────────

const NAV_MAIN = [
  { label: "דשבורד",    icon: "⬡", color: "#38BDF8", active: true  },
  { label: "פרויקטים",  icon: "♫", color: "#60A5FA", active: false },
  { label: "סושיאל",    icon: "📱", color: "#EC4899", active: false },
  { label: "לקוחות",    icon: "☆", color: "#C084FC", active: false },
  { label: "משימות",    icon: "✓", color: "#F59E0B", active: false },
  { label: "צוות",      icon: "👥", color: "#A855F7", active: false },
  { label: "הופעות",    icon: "🎤", color: "#F472B6", active: false },
  { label: "Red Films", icon: "🎬", color: "#EC4899", active: false },
  { label: "כספים",     icon: "₪",  color: "#34D399", active: false },
  { label: "תובנות",    icon: "◎", color: "#2DD4BF", active: false },
];
const NAV_SETTINGS = [
  { label: "יומן",     icon: "📅", color: undefined, active: false },
  { label: "Dropbox",  icon: "📦", color: undefined, active: false },
  { label: "דוחות",    icon: "📧", color: undefined, active: false },
];

// ── KPI data ──────────────────────────────────────────────────────────────

const KPI = [
  { label: "משימות",       count: 24, sub: "7 באיחור",       color: "#EF4444", icon: "☑" },
  { label: "תשלומים",      count: 9,  sub: "ממתינים",        color: "#10B981", icon: "$" },
  { label: "הצעות",        count: 5,  sub: "3 בהכנה",        color: "#A855F7", icon: "📋" },
  { label: "סשנים",        count: 12, sub: "3 היום",         color: "#EC4899", icon: "🎙" },
  { label: "פרויקטים",     count: 18, sub: "6 פעילים",       color: "#3B82F6", icon: "▶" },
  { label: "פעילים",       count: 3,  sub: "קרובים לדדליין", color: "#3B82F6", icon: "⏳" },
  { label: "עברו דדליין",  count: 9,  sub: "פרויקטים",      color: "#EF4444", icon: "⚠" },
  { label: "קרוב לדדליין", count: 3,  sub: "",               color: "#F97316", icon: "🕐" },
  { label: "בהשהייה",      count: 2,  sub: "פרויקטים",      color: "#6B7280", icon: "⏸" },
];

// ── Calendar events ────────────────────────────────────────────────────────

const CAL_TODAY = [
  { time: "11:00 – 14:00", title: "סשן הקלטות - אלבום ח׳ חדש", sub: "A אולפן",      avatar: "YN", dot: "#A855F7" },
  { time: "15:00 – 16:00", title: "פגישת הפקה - קליפ חדש",      sub: "Zoom",          avatar: "RB", dot: "#10B981" },
  { time: "כל היום",        title: "שחרור סינגל - כל הפלטפורמות", sub: "",             avatar: "MA", dot: "#EC4899" },
];
const CAL_TOMORROW = [
  { time: "10:00 – 11:00", title: "סשן אולפן - מיפוזיקם",    sub: "B אולפן",       avatar: "OM", dot: "#A855F7" },
  { time: "12:00 – 13:00", title: "פגישת צוות - הפקת EP",     sub: "חדר ישיבות",   avatar: "RB", dot: "#10B981" },
];

// ── Daily focus ───────────────────────────────────────────────────────────

const FOCUS = [
  { title: "אישור תשלום חסר",   sub: 'פרויקט "אלבום חדש" — מתן', ago: "לפני 20 דק׳", icon: "💰" },
  { title: "סשן הקלטות היום",    sub: "11:00 | A אולק",            ago: "לפני 45 דק׳", icon: "🎙" },
  { title: "הצעה מחכה לאישור",  sub: "הצעה #1042 — יוסי כהן",    ago: "לפני שעתיים", icon: "📋" },
];

// ── Agent alerts ──────────────────────────────────────────────────────────

const ALERTS = [
  { count: 9, label: "דדליינים", icon: "📅", color: "#EF4444" },
  { count: 4, label: "תשלומים",  icon: "💰", color: "#10B981" },
  { count: 3, label: "סשנים",    icon: "🎙", color: "#EC4899" },
  { count: 1, label: "ויקטור",   icon: "👤", color: "#A855F7" },
];

// ── Projects ──────────────────────────────────────────────────────────────

const PROJECTS = [
  { name: "אלבום חדש",           artist: "מתן",             status: "בעבודה",      sc: "#3B82F6", dept: "הקלטות",        owner: "יונתן", dl: "30/5/25", days: 13,  over: false },
  { name: "מיקסיסי קיץ...",      artist: "אורי",            status: "ממתין למיקס", sc: "#F59E0B", dept: "מיקס",          owner: "רועי",  dl: "15/6/25", days: 29,  over: false },
  { name: "קליפ חדש",            artist: "נועה",            status: "בעבודה",      sc: "#3B82F6", dept: "צילום",         owner: "מאיה",  dl: "22/5/25", days: 5,   over: false },
  { name: "פרויקט בינגלאומי...",  artist: "Various Artists", status: "במיקס",      sc: "#A855F7", dept: "מיקס",          owner: "עומר",  dl: "10/6/25", days: 24,  over: false },
  { name: "סינגל חדש",           artist: "יובל",            status: "במיקס",      sc: "#A855F7", dept: "פוסט-פרודקשן", owner: "יונתן", dl: "28/5/25", days: -11, over: true  },
  { name: "טעם הפקה",            artist: "רועי",            status: "לא התחיל",   sc: "#374151", dept: "הפקה",          owner: "רועי",  dl: "1/7/25",  days: 44,  over: false },
];

// ── Avatar ────────────────────────────────────────────────────────────────

function Av({ t }: { t: string }) {
  return (
    <div style={{
      width: 30, height: 30, borderRadius: "50%",
      background: "#252525", border: `1px solid ${BORDER2}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 10, fontWeight: 700, color: MUTED, flexShrink: 0,
    }}>{t}</div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────

function KpiCard({ label, count, sub, color, icon }: typeof KPI[0]) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18,
      padding: "20px 18px 16px", minHeight: 140,
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      boxShadow: `0 1px 8px rgba(0,0,0,0.4)`,
      transition: "border-color 150ms",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#666", lineHeight: 1.3 }}>{label}</span>
        <span style={{ fontSize: 16, opacity: 0.45 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color }}>
        {count}
      </div>
      <div style={{ fontSize: 11, color: sub ? "#4A4A4A" : "transparent", lineHeight: 1 }}>{sub || "—"}</div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────

function Sidebar() {
  return (
    <aside style={{
      width: SIDEBAR_W, flexShrink: 0,
      background: SURFACE, borderLeft: `1px solid ${BORDER2}`,
      height: "100vh", position: "sticky", top: 0,
      display: "flex", flexDirection: "column",
      overflowY: "auto",
    }}>
      {/* Logo */}
      <div style={{ padding: "24px 20px 20px", borderBottom: `1px solid ${BORDER2}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: `linear-gradient(135deg, ${BRAND}, #991B1B)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0,
          }}>RB</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, lineHeight: 1.2 }}>Redbloods</div>
            <div style={{ fontSize: 11, color: MUTED }}>Records</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 12px 8px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV_MAIN.map((n) => (
            <div key={n.label} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "9px 12px", borderRadius: 12,
              background: n.active ? `rgba(220,38,38,0.15)` : "transparent",
              border: `1px solid ${n.active ? "rgba(220,38,38,0.3)" : "transparent"}`,
              color: n.active ? BRAND : MUTED,
              fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
              <span style={{ fontSize: 15, ...(n.color && !n.active ? { color: n.color, opacity: 0.85 } : {}) }}>
                {n.icon}
              </span>
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.label === "תובנות" && (
                <span style={{ fontSize: 10, fontWeight: 800, background: "#EF4444", color: "#fff", borderRadius: 99, padding: "1px 6px" }}>3</span>
              )}
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: BORDER2, margin: "12px 0 8px" }} />
        <div style={{ fontSize: 10, fontWeight: 700, color: "#3A3A3A", letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 12px 6px" }}>ניהול</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV_SETTINGS.map((n) => (
            <div key={n.label} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "9px 12px", borderRadius: 12,
              color: MUTED, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
              <span style={{ fontSize: 15 }}>{n.icon}</span>
              <span>{n.label}</span>
            </div>
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div style={{ padding: "12px 16px", borderTop: `1px solid ${BORDER2}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#444" }}>גרסה 1.0</span>
        <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 8, border: `1px solid ${BRAND}`, background: `rgba(220,38,38,0.15)`, color: BRAND, fontWeight: 700 }}>PRO</span>
      </div>
    </aside>
  );
}

// ── Main export ───────────────────────────────────────────────────────────

export default function DashboardDesignPreview() {
  return (
    <div style={{
      background: BG, minHeight: "100vh", color: TEXT,
      fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      display: "flex",
    }}>
      {/* Sidebar (appears on the right in RTL) */}
      <Sidebar />

      {/* Content column */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

        {/* ── Top header bar ── */}
        <header style={{
          background: SURFACE, borderBottom: `1px solid ${BORDER2}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 28px", height: 58, position: "sticky", top: 0, zIndex: 40,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button style={{
              padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: BRAND, border: "none", color: "#fff", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}>+ פרויקט חדש</button>
            <button style={{
              padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: "transparent", border: `1px solid ${BORDER2}`, color: MUTED, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}>⊟ סינון תצוגה</button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 20,
              background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.3)",
              color: "#C084FC", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>✦ AI</button>
            <div style={{ position: "relative", cursor: "pointer" }}>
              <span style={{ fontSize: 20 }}>🔔</span>
              <span style={{
                position: "absolute", top: -4, right: -6,
                background: BRAND, color: "#fff", borderRadius: 99,
                fontSize: 9, fontWeight: 800, padding: "1px 5px",
              }}>3</span>
            </div>
            <span style={{ fontSize: 18, cursor: "pointer", color: MUTED }}>🔍</span>
          </div>
        </header>

        {/* ── Scrollable page content ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px 60px" }}>

          {/* ── Daily header ── */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32 }}>
            <div>
              <h1 style={{ fontSize: 36, fontWeight: 800, color: TEXT, margin: 0, lineHeight: 1.1 }}>
                ערב טוב ✦
              </h1>
              <p style={{ fontSize: 14, color: DIM, margin: "8px 0 14px" }}>שבת, 17 במאי | 20:36</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 99,
                  background: "rgba(239,68,68,0.09)", border: "1px solid rgba(239,68,68,0.28)", color: "#EF4444",
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#EF4444", display: "inline-block" }} />
                  9 פרויקטים עברו דדליין
                </span>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 99,
                  background: "rgba(59,130,246,0.09)", border: "1px solid rgba(59,130,246,0.22)", color: "#3B82F6",
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#3B82F6", display: "inline-block" }} />
                  18 פרויקטים בעבודה פעילה
                </span>
              </div>
            </div>
            <button style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "12px 24px", borderRadius: 12,
              background: `rgba(220,38,38,0.12)`, border: `1px solid rgba(220,38,38,0.35)`,
              color: BRAND, fontSize: 15, fontWeight: 700, cursor: "pointer",
              whiteSpace: "nowrap", marginTop: 4, letterSpacing: "0.01em",
            }}>
              ✦ סדר את היום
            </button>
          </div>

          {/* ── KPI row ── */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 12, marginBottom: 28,
          }}>
            {KPI.map((k) => <KpiCard key={k.label} {...k} />)}
          </div>

          {/* ── Middle 3 cards ── */}
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 1.6fr 1fr", gap: 18, marginBottom: 28,
          }}>

            {/* Calendar */}
            <div style={{
              background: SURFACE, border: `1px solid ${BORDER2}`, borderRadius: 18,
              padding: "22px 24px",
              boxShadow: "0 2px 16px rgba(0,0,0,0.35)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  📅 אירועים קרובים (48 שעות)
                </span>
                <span style={{ fontSize: 10, color: "#444", cursor: "pointer" }}>הצג יומן מלא ←</span>
              </div>

              <div style={{ fontSize: 10, fontWeight: 800, color: BRAND, marginBottom: 10, letterSpacing: "0.05em" }}>
                היום, 17 במאי
              </div>
              {CAL_TODAY.map((ev, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: ev.dot, flexShrink: 0, marginTop: 6 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: DIM, fontWeight: 600, marginBottom: 2 }}>{ev.time}</div>
                    <div style={{ fontSize: 13, color: "#D0D0D0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</div>
                    {ev.sub && <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{ev.sub}</div>}
                  </div>
                  <Av t={ev.avatar} />
                </div>
              ))}

              <div style={{ fontSize: 10, fontWeight: 800, color: "#444", margin: "14px 0 10px", letterSpacing: "0.05em" }}>
                מחר, 18 במאי
              </div>
              {CAL_TOMORROW.map((ev, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 0", borderBottom: i < CAL_TOMORROW.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: ev.dot, flexShrink: 0, marginTop: 6 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: DIM, fontWeight: 600, marginBottom: 2 }}>{ev.time}</div>
                    <div style={{ fontSize: 13, color: "#D0D0D0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</div>
                    {ev.sub && <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{ev.sub}</div>}
                  </div>
                  <Av t={ev.avatar} />
                </div>
              ))}
            </div>

            {/* Daily focus */}
            <div style={{
              background: SURFACE, border: `1px solid ${BORDER2}`, borderRadius: 18,
              padding: "22px 24px",
              boxShadow: "0 2px 16px rgba(0,0,0,0.35)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  ⚙ מוקד יומי
                </span>
                <span style={{ fontSize: 10, color: "#444", cursor: "pointer" }}>לכל המשימות והתראות ←</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {FOCUS.map((f, i) => (
                  <div key={i} style={{
                    background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 14,
                    padding: "14px 16px",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 17 }}>{f.icon}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#D8D8D8" }}>{f.title}</span>
                      </div>
                      <span style={{ fontSize: 10, color: "#444", whiteSpace: "nowrap", paddingRight: 8 }}>{f.ago}</span>
                    </div>
                    <div style={{ fontSize: 11, color: MUTED, paddingRight: 25 }}>{f.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Agent alerts */}
            <div style={{
              background: SURFACE, border: `1px solid ${BORDER2}`, borderRadius: 18,
              padding: "22px 24px", position: "relative", overflow: "hidden",
              boxShadow: "0 2px 16px rgba(0,0,0,0.35)",
            }}>
              <div style={{
                position: "absolute", top: 0, right: 0, bottom: 0, width: 3,
                background: "linear-gradient(180deg, #EF4444, #F59E0B)",
              }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  🔔 התראות סוכן
                </span>
                <span style={{
                  background: BRAND, color: "#fff", borderRadius: 99,
                  fontSize: 10, fontWeight: 800, padding: "2px 8px",
                }}>3</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {ALERTS.map((a, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "12px 0", borderBottom: i < ALERTS.length - 1 ? `1px solid ${BORDER}` : "none",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 19 }}>{a.icon}</span>
                      <span style={{ fontSize: 14, color: "#C0C0C0", fontWeight: 500 }}>{a.label}</span>
                    </div>
                    <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color: a.color }}>{a.count}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, textAlign: "left" }}>
                <span style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer" }}>הצג את כל ההתראות ←</span>
              </div>
            </div>

          </div>

          {/* ── Projects section ── */}
          <div style={{
            background: SURFACE, border: `1px solid ${BORDER2}`, borderRadius: 18,
            overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.3)",
          }}>
            <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>🎵</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>פרויקטים פעילים</span>
              <span style={{
                marginRight: "auto", fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 99,
                background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)", color: "#3B82F6",
              }}>18 פרויקטים</span>
            </div>

            {/* Column headers */}
            <div style={{
              display: "grid", gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1.2fr 90px",
              padding: "10px 24px", borderBottom: `1px solid ${BORDER}`,
              fontSize: 10, fontWeight: 700, color: "#3A3A3A", letterSpacing: "0.07em", textTransform: "uppercase",
            }}>
              <span>פרויקט</span>
              <span>סטטוס</span>
              <span>שלב</span>
              <span>אחראי</span>
              <span>דדליין</span>
              <span style={{ textAlign: "center" }}>ימים לסיום</span>
            </div>

            {PROJECTS.map((p, i) => (
              <div
                key={i}
                style={{
                  display: "grid", gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1.2fr 90px",
                  padding: "14px 24px", borderBottom: i < PROJECTS.length - 1 ? `1px solid ${BORDER}` : "none",
                  alignItems: "center", cursor: "pointer", transition: "background 120ms",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = CARD2; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#E0E0E0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{p.artist}</div>
                </div>

                <span style={{
                  display: "inline-flex", alignItems: "center",
                  fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 99,
                  background: p.sc + "1E", color: p.sc, border: `1px solid ${p.sc}40`,
                }}>
                  {p.status}
                </span>

                <span style={{ fontSize: 12, color: MUTED }}>{p.dept}</span>
                <span style={{ fontSize: 12, color: MUTED }}>{p.owner}</span>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: p.over ? "#EF4444" : MUTED }}>
                    📅 {p.dl}
                  </span>
                </div>

                <div style={{ textAlign: "center" }}>
                  <span style={{
                    fontSize: 15, fontWeight: 700,
                    color: p.over ? "#EF4444" : p.days <= 7 ? "#F97316" : "#C0C0C0",
                  }}>
                    {p.over ? `+ ${Math.abs(p.days)}` : p.days}
                  </span>
                </div>
              </div>
            ))}

            <div style={{ padding: "14px 24px", borderTop: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 12, color: "#3A3A3A", cursor: "pointer" }}>הצג את כל הפרויקטים ←</span>
            </div>
          </div>

          {/* ── Preview badge ── */}
          <div style={{
            marginTop: 28, padding: "10px 16px", borderRadius: 10,
            background: "rgba(220,38,38,0.05)", border: "1px solid rgba(220,38,38,0.15)",
            fontSize: 11, color: "#444", textAlign: "center",
          }}>
            🎨 preview עיצובי סטטי — /dashboard-preview — לא מחובר לדאטה אמיתי
          </div>

        </div>
      </div>
    </div>
  );
}
