"use client";

// ── Static design preview — /dashboard-preview ────────────────────────────
// Hardcoded dummy data only. No DB, no hooks, no fetch, no AppShell.
// Purpose: visual composition approval before wiring to real data.

const BRAND = "#DC2626";
const SURFACE = "#141414";
const CARD = "#1A1A1A";
const BORDER = "#252525";
const BORDER2 = "#2A2A2A";
const BG = "#0D0D0D";
const TEXT = "#F0F0F0";
const MUTED = "#888";
const DIM = "#555";

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
  { time: "11:00 – 14:00", title: "סשן הקלטות - אלבום ח׳ חדש", sub: "A אולפן", avatar: "YN", dot: "#A855F7" },
  { time: "15:00 – 16:00", title: "פגישת הפקה - קליפ חדש",      sub: "Zoom",    avatar: "RB", dot: "#10B981" },
  { time: "כל היום",        title: "שחרור סינגל - כל הפלטפורמות", sub: "",       avatar: "MA", dot: "#EC4899" },
];
const CAL_TOMORROW = [
  { time: "10:00 – 11:00", title: "סשן אולפן - מיפוזיקם",     sub: "B אולפן", avatar: "OM", dot: "#A855F7" },
  { time: "12:00 – 13:00", title: "פגישת צוות - הפקת EP",      sub: "חדר ישיבות", avatar: "RB", dot: "#10B981" },
];

// ── Daily focus ───────────────────────────────────────────────────────────

const FOCUS = [
  { title: "אישור תשלום חסר",      sub: 'פרויקט "אלבום חדש" — מתן', ago: "לפני 20 דק׳", icon: "💰", color: "#EF4444" },
  { title: "סשן הקלטות היום",       sub: "11:00 | A אולק",           ago: "לפני 45 דק׳", icon: "🎙", color: "#EC4899" },
  { title: "הצעה מחכה לאישור",     sub: "הצעה #1042 — יוסי כהן",   ago: "לפני שעתיים", icon: "📋", color: "#A855F7" },
];

// ── Agent alerts ──────────────────────────────────────────────────────────

const ALERTS = [
  { count: 9, label: "דדליינים",  icon: "📅", color: "#EF4444" },
  { count: 4, label: "תשלומים",   icon: "💰", color: "#10B981" },
  { count: 3, label: "סשנים",     icon: "🎙", color: "#EC4899" },
  { count: 1, label: "ויקטור",    icon: "👤", color: "#A855F7" },
];

// ── Projects ──────────────────────────────────────────────────────────────

const PROJECTS = [
  { name: "אלבום חדש",          artist: "מתן",            status: "בעבודה",      statusC: "#3B82F6", dept: "הקלטות",   owner: "יונתן", deadline: "30/5/25", days: 13,   over: false },
  { name: "מיקסיסי קיץ...",     artist: "אורי",           status: "ממתין למיקס", statusC: "#F59E0B", dept: "מיקס",     owner: "רועי",  deadline: "15/6/25", days: 29,   over: false },
  { name: "קליפ חדש",           artist: "נועה",           status: "בעבודה",      statusC: "#3B82F6", dept: "צילום",    owner: "מאיה",  deadline: "22/5/25", days: 5,    over: false },
  { name: "פרויקט בינגלאומי...", artist: "Various Artists", status: "במיקס",      statusC: "#A855F7", dept: "מיקס",     owner: "עומר",  deadline: "10/6/25", days: 24,   over: false },
  { name: "סינגל חדש",          artist: "יובל",           status: "במיקס",      statusC: "#A855F7", dept: "פוסט-פרודקשן", owner: "יונתן", deadline: "28/5/25", days: -11, over: true  },
  { name: "טעם הפקה",           artist: "רועי",           status: "לא התחיל",   statusC: "#374151", dept: "הפקה",     owner: "רועי",  deadline: "1/7/25",  days: 44,   over: false },
];

// ── Tiny avatar ───────────────────────────────────────────────────────────

function Avatar({ initials, bg = "#252525" }: { initials: string; bg?: string }) {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: bg, border: `1px solid ${BORDER}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 10, fontWeight: 700, color: MUTED, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────

function KpiCard({ label, count, sub, color, icon }: typeof KPI[0]) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16,
      padding: "18px 16px 14px", minHeight: 124,
      display: "flex", flexDirection: "column", justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: "#777", lineHeight: 1.3 }}>{label}</span>
        <span style={{ fontSize: 14, opacity: 0.5 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, color }}>
        {count}
      </div>
      <div style={{ fontSize: 10, color: sub ? "#4A4A4A" : "transparent" }}>{sub || "—"}</div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

export default function DashboardDesignPreview() {
  return (
    <div style={{ background: BG, minHeight: "100vh", color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl" }}>

      {/* ── Top header bar ── */}
      <header style={{
        background: SURFACE, borderBottom: `1px solid ${BORDER2}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 56, position: "sticky", top: 0, zIndex: 50,
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `linear-gradient(135deg, ${BRAND}, #991B1B)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 800, color: "#fff",
          }}>RB</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Redbloods Records</div>
          </div>
        </div>

        {/* Right actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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

      {/* ── Page body ── */}
      <main style={{ maxWidth: 1500, margin: "0 auto", padding: "28px 32px 60px" }}>

        {/* ── Daily header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800, color: TEXT, margin: 0, lineHeight: 1 }}>
              ערב טוב ✦
            </h1>
            <p style={{ fontSize: 13, color: DIM, margin: "6px 0 10px" }}>שבת, 17 במאי · 20:36</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 99,
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
                color: "#EF4444",
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#EF4444", display: "inline-block" }} />
                9 פרויקטים עברו דדליין
              </span>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 99,
                background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)",
                color: "#3B82F6",
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#3B82F6", display: "inline-block" }} />
                18 פרויקטים בעבודה פעילה
              </span>
            </div>
          </div>
          <button style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 20px", borderRadius: 12,
            background: `rgba(220,38,38,0.1)`, border: `1px solid rgba(220,38,38,0.3)`,
            color: BRAND, fontSize: 14, fontWeight: 700, cursor: "pointer",
            whiteSpace: "nowrap", marginTop: 4,
          }}>
            ✦ סדר את היום
          </button>
        </div>

        {/* ── KPI row ── */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 10, marginBottom: 24,
        }}>
          {KPI.map((k) => <KpiCard key={k.label} {...k} />)}
        </div>

        {/* ── Middle 3 cards ── */}
        <div style={{
          display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr", gap: 16, marginBottom: 28,
        }}>

          {/* Calendar */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER2}`, borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                📅 אירועים קרובים (48 שעות)
              </span>
              <span style={{ fontSize: 10, color: "#444" }}>הצג יומן מלא ←</span>
            </div>

            {/* Today */}
            <div style={{ fontSize: 10, fontWeight: 700, color: BRAND, marginBottom: 8, letterSpacing: "0.05em" }}>
              היום, 17 במאי
            </div>
            {CAL_TODAY.map((ev, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", borderBottom: i < CAL_TODAY.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: ev.dot, flexShrink: 0, marginTop: 5 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: DIM, fontWeight: 600, marginBottom: 1 }}>{ev.time}</div>
                  <div style={{ fontSize: 13, color: "#D0D0D0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</div>
                  {ev.sub && <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{ev.sub}</div>}
                </div>
                <Avatar initials={ev.avatar} />
              </div>
            ))}

            {/* Tomorrow */}
            <div style={{ fontSize: 10, fontWeight: 700, color: "#444", margin: "12px 0 8px", letterSpacing: "0.05em" }}>
              מחר, 18 במאי
            </div>
            {CAL_TOMORROW.map((ev, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", borderBottom: i < CAL_TOMORROW.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: ev.dot, flexShrink: 0, marginTop: 5 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: DIM, fontWeight: 600, marginBottom: 1 }}>{ev.time}</div>
                  <div style={{ fontSize: 13, color: "#D0D0D0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</div>
                  {ev.sub && <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{ev.sub}</div>}
                </div>
                <Avatar initials={ev.avatar} />
              </div>
            ))}
          </div>

          {/* Daily focus */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER2}`, borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                ⚙ מוקד יומי
              </span>
              <span style={{ fontSize: 10, color: "#444" }}>לכל המשימות ←</span>
            </div>
            {FOCUS.map((f, i) => (
              <div key={i} style={{
                background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12,
                padding: "12px 14px", marginBottom: i < FOCUS.length - 1 ? 10 : 0,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{f.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#D8D8D8" }}>{f.title}</span>
                  </div>
                  <span style={{ fontSize: 10, color: "#444", whiteSpace: "nowrap", marginRight: 8 }}>{f.ago}</span>
                </div>
                <div style={{ fontSize: 11, color: MUTED, paddingRight: 24 }}>{f.sub}</div>
              </div>
            ))}
          </div>

          {/* Agent alerts */}
          <div style={{
            background: SURFACE, border: `1px solid ${BORDER2}`, borderRadius: 16,
            padding: "18px 20px", position: "relative", overflow: "hidden",
          }}>
            {/* accent bar */}
            <div style={{
              position: "absolute", top: 0, right: 0, bottom: 0, width: 3,
              background: "linear-gradient(180deg, #EF4444, #F59E0B)", borderRadius: "0 16px 16px 0",
            }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                🔔 התראות סוכן
              </span>
              <span style={{
                background: BRAND, color: "#fff", borderRadius: 99,
                fontSize: 10, fontWeight: 800, padding: "2px 7px",
              }}>3</span>
            </div>
            {ALERTS.map((a, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0", borderBottom: i < ALERTS.length - 1 ? `1px solid ${BORDER}` : "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>{a.icon}</span>
                  <span style={{ fontSize: 13, color: "#C0C0C0", fontWeight: 500 }}>{a.label}</span>
                </div>
                <span style={{
                  fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: a.color,
                }}>{a.count}</span>
              </div>
            ))}
            <div style={{ marginTop: 14, textAlign: "left" }}>
              <span style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer" }}>הצג את כל ההתראות ←</span>
            </div>
          </div>

        </div>

        {/* ── Projects section ── */}
        <div style={{ background: SURFACE, border: `1px solid ${BORDER2}`, borderRadius: 16, overflow: "hidden" }}>

          {/* Table header */}
          <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>🎵</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>פרויקטים פעילים</span>
          </div>

          {/* Column headers */}
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 80px",
            padding: "8px 20px", borderBottom: `1px solid ${BORDER}`,
            fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            <span>פרויקט</span>
            <span>סטטוס</span>
            <span>שלב</span>
            <span>אחראי</span>
            <span>דדליין</span>
            <span style={{ textAlign: "center" }}>ימים לסיום</span>
          </div>

          {/* Rows */}
          {PROJECTS.map((p, i) => (
            <div
              key={i}
              style={{
                display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 80px",
                padding: "12px 20px", borderBottom: i < PROJECTS.length - 1 ? `1px solid ${BORDER}` : "none",
                alignItems: "center", cursor: "pointer",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#1C1C1C"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              {/* Name */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#E0E0E0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{p.artist}</div>
              </div>

              {/* Status */}
              <span style={{
                display: "inline-flex", alignItems: "center",
                fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
                background: p.statusC + "22", color: p.statusC, border: `1px solid ${p.statusC}44`,
                maxWidth: 120,
              }}>
                {p.status}
              </span>

              {/* Dept */}
              <span style={{ fontSize: 12, color: MUTED }}>{p.dept}</span>

              {/* Owner */}
              <span style={{ fontSize: 12, color: MUTED }}>{p.owner}</span>

              {/* Deadline */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: p.over ? "#EF4444" : MUTED }}>
                  📅 {p.deadline}
                </span>
              </div>

              {/* Days */}
              <div style={{ textAlign: "center" }}>
                <span style={{
                  fontSize: 14, fontWeight: 700,
                  color: p.over ? "#EF4444" : p.days <= 7 ? "#F97316" : "#D0D0D0",
                }}>
                  {p.over ? `+ ${Math.abs(p.days)}` : p.days}
                </span>
              </div>
            </div>
          ))}

          {/* Footer link */}
          <div style={{ padding: "12px 20px", borderTop: `1px solid ${BORDER}` }}>
            <span style={{ fontSize: 12, color: "#444", cursor: "pointer" }}>הצג את כל הפרויקטים ←</span>
          </div>
        </div>

        {/* ── Preview badge ── */}
        <div style={{
          marginTop: 32, padding: "10px 16px", borderRadius: 10,
          background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)",
          fontSize: 11, color: "#666", textAlign: "center",
        }}>
          🎨 זהו preview עיצובי סטטי בלבד — /dashboard-preview — לא מחובר לדאטה אמיתי
        </div>

      </main>
    </div>
  );
}
