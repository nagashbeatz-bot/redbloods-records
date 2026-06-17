"use client";

// ── Static design preview — /dashboard-preview ────────────────────────────
// Hardcoded dummy data only. No DB, no hooks, no fetch.

const BRAND   = "#DC2626";
const BRAND2  = "#991B1B";
const BG      = "#0D0D0D";
const SURFACE = "#141414";
const CARD    = "#181818";
const CARD2   = "#1E1E1E";
const BORDER  = "rgba(255,255,255,0.07)";
const BORDER2 = "rgba(255,255,255,0.04)";
const TEXT    = "#F2F2F2";
const SUB     = "#A0A0A0";
const MUTED   = "#606060";
const DIM     = "#404040";
const SIDEBAR_W = 240;

// ── Nav ───────────────────────────────────────────────────────────────────

const NAV = [
  { label: "דשבורד",   icon: "⊞",  color: "#38BDF8", active: true  },
  { label: "פרויקטים", icon: "♫",  color: "#60A5FA", active: false },
  { label: "סושיאל",   icon: "📱", color: "#EC4899", active: false },
  { label: "לקוחות",   icon: "☆",  color: "#C084FC", active: false },
  { label: "משימות",   icon: "✓",  color: "#F59E0B", active: false },
  { label: "צוות",     icon: "👥", color: "#A855F7", active: false },
  { label: "הופעות",   icon: "🎤", color: "#F472B6", active: false },
  { label: "Red Films",icon: "🎬", color: "#EF4444", active: false },
  { label: "כספים",    icon: "₪",  color: "#34D399", active: false },
  { label: "תובנות",   icon: "◎",  color: "#2DD4BF", active: false },
];

const NAV2 = [
  { label: "יומן",    icon: "📅", badge: undefined as number | undefined },
  { label: "Dropbox", icon: "📦", badge: undefined as number | undefined },
  { label: "דוחות",   icon: "📊", badge: undefined as number | undefined },
  { label: "התראות",  icon: "🔔", badge: 3 as number | undefined         },
  { label: "Mai AI",  icon: "✦",  badge: undefined as number | undefined },
];

// ── KPI ───────────────────────────────────────────────────────────────────

const KPI = [
  { label: "משימות",       count: 24, sub: "7 באיחור",       color: "#EF4444", iconBg: "rgba(239,68,68,0.12)",   icon: "☑"  },
  { label: "תשלומים",      count: 9,  sub: "ממתינים",        color: "#10B981", iconBg: "rgba(16,185,129,0.12)",  icon: "$"  },
  { label: "הצעות",        count: 5,  sub: "3 בהכנה",        color: "#A855F7", iconBg: "rgba(168,85,247,0.12)",  icon: "📋" },
  { label: "סשנים",        count: 12, sub: "3 היום",         color: "#EC4899", iconBg: "rgba(236,72,153,0.12)",  icon: "🎙" },
  { label: "פרויקטים",     count: 18, sub: "6 פעילים",       color: "#3B82F6", iconBg: "rgba(59,130,246,0.12)",  icon: "▶"  },
  { label: "פעילים",       count: 3,  sub: "קרובים לדדליין", color: "#3B82F6", iconBg: "rgba(59,130,246,0.12)",  icon: "⏳" },
  { label: "עברו דדליין",  count: 9,  sub: "פרויקטים",      color: "#EF4444", iconBg: "rgba(239,68,68,0.12)",   icon: "⚠"  },
  { label: "קרוב לדדליין", count: 3,  sub: "",               color: "#F97316", iconBg: "rgba(249,115,22,0.12)",  icon: "🕐" },
  { label: "בהשהייה",      count: 2,  sub: "פרויקטים",      color: "#6B7280", iconBg: "rgba(107,114,128,0.12)", icon: "⏸" },
];

// ── Calendar ──────────────────────────────────────────────────────────────

const CAL = [
  { time: "11:00–14:00", title: "סשן הקלטות — אלבום חדש",       sub: "אולפן A",     av: "YN", dot: "#A855F7", today: true  },
  { time: "16:00–15:00", title: "פגישת הפקה — קליפ חדש",        sub: "Zoom",         av: "RB", dot: "#10B981", today: true  },
  { time: "כל היום",     title: "שחרור סינגל — כל הפלטפורמות", sub: "",             av: "MA", dot: "#EC4899", today: true  },
  { time: "12:00–13:00", title: "פגישת צוות — הפקת EP",         sub: "חדר ישיבות",  av: "OM", dot: "#10B981", today: false },
];

// ── Focus ─────────────────────────────────────────────────────────────────

const FOCUS = [
  { title: "אישור תשלום חסר",  sub: 'פרויקט "אלבום חדש" — מתן', ago: "לפני 20 דק׳", icon: "$",  iconBg: "rgba(16,185,129,0.15)",  iconColor: "#10B981" },
  { title: "סשן הקלטות היום",   sub: "11:00 | אולפן A",           ago: "לפני 45 דק׳", icon: "🎙", iconBg: "rgba(168,85,247,0.15)", iconColor: "#A855F7" },
  { title: "הצעה מחכה לאישור", sub: "הצעה #1042 — יוסי כהן",     ago: "לפני שעתיים", icon: "📋", iconBg: "rgba(59,130,246,0.15)", iconColor: "#3B82F6" },
];

// ── Alerts ────────────────────────────────────────────────────────────────

const ALERTS = [
  { count: 9, label: "דדליינים", icon: "📅", color: "#EF4444", bg: "rgba(239,68,68,0.08)"   },
  { count: 4, label: "תשלומים",  icon: "$",  color: "#10B981", bg: "rgba(16,185,129,0.08)"  },
  { count: 3, label: "סשנים",    icon: "🎙", color: "#EC4899", bg: "rgba(236,72,153,0.08)"  },
  { count: 1, label: "ויקטור",   icon: "👤", color: "#A855F7", bg: "rgba(168,85,247,0.08)"  },
];

// ── Projects ──────────────────────────────────────────────────────────────

const PROJECTS = [
  { name: "אלבום חדש",       artist: "מתן",             status: "בהפקה",   sc: "#3B82F6", dept: "הקלטות",    owner: "RB", dl: "30 במאי 2025",  days: 13, over: false },
  { name: "מיקסיסי קיץ",     artist: "אורי",            status: "עריכה",   sc: "#F59E0B", dept: "מיקס",      owner: "YN", dl: "15 ביוני 2025", days: 29, over: false },
  { name: "סינגל חדש",       artist: "נועה",            status: "מיקס",    sc: "#A855F7", dept: "מיקס",      owner: "MA", dl: "22 במאי 2025",  days: 5,  over: false },
  { name: "קליפ חדש",        artist: "Red Films",       status: "פיתוח",   sc: "#EC4899", dept: "Red Films",  owner: "OM", dl: "10 ביוני 2025", days: 24, over: false },
  { name: "פרויקט בינלאומי", artist: "Various Artists", status: "בהכנה",   sc: "#6B7280", dept: "טרום הפקה", owner: "RB", dl: "1 ביולי 2025",  days: 44, over: false },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function Av({ t, size = 30 }: { t: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg,#252525,#1A1A1A)",
      border: "1px solid rgba(255,255,255,0.1)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, color: SUB,
    }}>{t}</div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span style={{
      width: 7, height: 7, borderRadius: "50%", background: color,
      display: "inline-block", flexShrink: 0,
      boxShadow: `0 0 5px ${color}88`,
    }} />
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────

function KpiCard({ label, count, sub, color, icon, iconBg }: typeof KPI[0]) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16,
      padding: "18px 16px 14px", minHeight: 144,
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      boxShadow: "0 2px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9, background: iconBg,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
        }}>{icon}</div>
        <span style={{
          fontSize: 10, fontWeight: 700, color: MUTED,
          textTransform: "uppercase", letterSpacing: "0.08em",
          lineHeight: 1.4, textAlign: "right", maxWidth: "55%",
        }}>{label}</span>
      </div>
      <div style={{ fontSize: 46, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, color }}>{count}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {sub && <Dot color={color} />}
        <span style={{ fontSize: 10, color: sub ? MUTED : "transparent" }}>{sub || "—"}</span>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────

function Sidebar() {
  return (
    <aside style={{
      width: SIDEBAR_W, flexShrink: 0,
      background: SURFACE,
      borderLeft: `1px solid ${BORDER}`,
      height: "100vh", position: "sticky", top: 0,
      display: "flex", flexDirection: "column",
      overflowY: "auto",
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 18px 18px", borderBottom: `1px solid ${BORDER2}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 13, flexShrink: 0,
            background: `linear-gradient(145deg, ${BRAND}, ${BRAND2})`,
            boxShadow: `0 4px 16px rgba(220,38,38,0.35)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em",
          }}>RB</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, lineHeight: 1.15, letterSpacing: "-0.01em" }}>Redbloods</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: BRAND, letterSpacing: "0.06em", textTransform: "uppercase" }}>Records</div>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <div style={{ padding: "14px 12px 6px" }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: DIM, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0 8px 8px" }}>ראשי</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {NAV.map((n) => (
            <div key={n.label} style={{ position: "relative", borderRadius: 10, overflow: "hidden" }}>
              {n.active && (
                <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 3, background: BRAND, borderRadius: "0 2px 2px 0" }} />
              )}
              <div style={{
                display: "flex", alignItems: "center", gap: 11,
                padding: "10px 12px 10px 14px",
                background: n.active ? "linear-gradient(90deg,rgba(220,38,38,0.14),rgba(220,38,38,0.04))" : "transparent",
                border: `1px solid ${n.active ? "rgba(220,38,38,0.22)" : "transparent"}`,
                borderRadius: 10,
                color: n.active ? BRAND : SUB,
                fontSize: 13.5, fontWeight: n.active ? 700 : 500,
                cursor: "pointer",
              }}>
                <span style={{
                  width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                  background: n.active ? "rgba(220,38,38,0.2)" : `${n.color}18`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, color: n.active ? BRAND : n.color,
                }}>{n.icon}</span>
                <span style={{ flex: 1 }}>{n.label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Secondary nav */}
      <div style={{ padding: "10px 12px 6px", marginTop: 2 }}>
        <div style={{ height: 1, background: BORDER2, marginBottom: 12 }} />
        <div style={{ fontSize: 9, fontWeight: 800, color: DIM, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0 8px 8px" }}>כלים</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {NAV2.map((n) => (
            <div key={n.label} style={{
              display: "flex", alignItems: "center", gap: 11,
              padding: "9px 12px 9px 14px", borderRadius: 10,
              color: MUTED, fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}>
              <span style={{ fontSize: 14, width: 22, textAlign: "center" }}>{n.icon}</span>
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.badge && (
                <span style={{ fontSize: 9, fontWeight: 800, background: BRAND, color: "#fff", borderRadius: 99, padding: "2px 6px" }}>{n.badge}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: "auto", padding: "14px 16px", borderTop: `1px solid ${BORDER2}`, display: "flex", alignItems: "center", gap: 10 }}>
        <Av t="RB" size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Redbloods Admin</div>
          <div style={{ fontSize: 10, color: MUTED }}>מנהל מערכת</div>
        </div>
        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 6,
          background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.3)",
          color: BRAND, fontWeight: 800,
        }}>PRO</span>
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
      <Sidebar />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

        {/* ── Top bar ── */}
        <header style={{
          height: 64, flexShrink: 0,
          background: SURFACE, borderBottom: `1px solid ${BORDER}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 28px", position: "sticky", top: 0, zIndex: 40,
          boxShadow: "0 1px 0 rgba(255,255,255,0.03)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 20px", borderRadius: 10, fontSize: 13, fontWeight: 700,
              background: BRAND, border: "none", color: "#fff", cursor: "pointer",
              boxShadow: "0 2px 12px rgba(220,38,38,0.4)",
            }}>+ פרויקט חדש</button>
            <button style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: "transparent", border: `1px solid ${BORDER}`, color: SUB, cursor: "pointer",
            }}>⊟ סינון תצוגה</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 16px", borderRadius: 20,
              background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.25)",
              color: "#C084FC", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>✦ AI</button>
            <div style={{ position: "relative", cursor: "pointer" }}>
              <span style={{ fontSize: 20 }}>🔔</span>
              <span style={{
                position: "absolute", top: -5, right: -7,
                background: BRAND, color: "#fff", borderRadius: 99,
                fontSize: 9, fontWeight: 900, padding: "1px 5px",
                boxShadow: "0 0 6px rgba(220,38,38,0.6)",
              }}>3</span>
            </div>
            <span style={{ fontSize: 18, cursor: "pointer", color: MUTED }}>🔍</span>
          </div>
        </header>

        {/* ── Page content ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "32px 36px 72px" }}>

          {/* ── Hero header ── */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 36 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <h1 style={{ fontSize: 44, fontWeight: 900, color: TEXT, margin: 0, lineHeight: 1, letterSpacing: "-0.03em" }}>ערב טוב</h1>
                <span style={{ fontSize: 28 }}>✦</span>
              </div>
              <p style={{ fontSize: 15, color: MUTED, margin: "0 0 16px", fontWeight: 500 }}>שבת, 17 במאי 2025 &nbsp;·&nbsp; 20:36</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 99,
                  background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444",
                }}><Dot color="#EF4444" /> 9 פרויקטים עברו דדליין</span>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 99,
                  background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.18)", color: "#3B82F6",
                }}><Dot color="#3B82F6" /> 18 פרויקטים בעבודה פעילה</span>
              </div>
            </div>
            <button style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "13px 26px", borderRadius: 13, flexShrink: 0, marginTop: 4,
              background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)",
              color: BRAND, fontSize: 15, fontWeight: 700, cursor: "pointer",
              boxShadow: "0 0 20px rgba(220,38,38,0.15)", whiteSpace: "nowrap",
            }}>✦ סדר את היום</button>
          </div>

          {/* ── KPI grid ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 12, marginBottom: 28 }}>
            {KPI.map((k) => <KpiCard key={k.label} {...k} />)}
          </div>

          {/* ── Middle 3 cards ── */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.6fr 1fr", gap: 20, marginBottom: 28 }}>

            {/* Calendar */}
            <div style={{
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "18px 22px 14px", borderBottom: `1px solid ${BORDER2}`,
                background: "rgba(255,255,255,0.01)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>📅</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>אירועים קרובים</span>
                </div>
                <span style={{ fontSize: 11, color: MUTED, cursor: "pointer" }}>הצג יומן מלא ←</span>
              </div>
              <div style={{ padding: "0 22px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 0 10px" }}>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 99, background: BRAND, color: "#fff", letterSpacing: "0.04em" }}>היום</span>
                  <span style={{ fontSize: 11, color: DIM }}>17 במאי</span>
                </div>
                {CAL.filter(e => e.today).map((ev, i, arr) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0",
                    borderBottom: i < arr.length - 1 ? `1px solid ${BORDER2}` : "none",
                  }}>
                    <Dot color={ev.dot} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginBottom: 2 }}>{ev.time}</div>
                      <div style={{ fontSize: 13, color: "#E0E0E0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</div>
                      {ev.sub && <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>{ev.sub}</div>}
                    </div>
                    <Av t={ev.av} size={28} />
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 0 10px" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: "rgba(255,255,255,0.06)", color: SUB, letterSpacing: "0.04em" }}>מחר</span>
                  <span style={{ fontSize: 11, color: DIM }}>18 במאי</span>
                </div>
                {CAL.filter(e => !e.today).map((ev, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0" }}>
                    <Dot color={ev.dot} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginBottom: 2 }}>{ev.time}</div>
                      <div style={{ fontSize: 13, color: "#C8C8C8", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</div>
                      {ev.sub && <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>{ev.sub}</div>}
                    </div>
                    <Av t={ev.av} size={28} />
                  </div>
                ))}
              </div>
            </div>

            {/* Daily focus */}
            <div style={{
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "18px 22px 14px", borderBottom: `1px solid ${BORDER2}`,
                background: "rgba(255,255,255,0.01)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>⚙</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>מוקד יומי</span>
                </div>
                <span style={{
                  fontSize: 10, padding: "3px 10px", borderRadius: 99,
                  background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)",
                  color: "#EF4444", fontWeight: 800,
                }}>3 דחופים</span>
              </div>
              <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                {FOCUS.map((f, i) => (
                  <div key={i} style={{
                    background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 13,
                    padding: "14px", boxShadow: "0 1px 6px rgba(0,0,0,0.3)",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 9, background: f.iconBg,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 15, color: f.iconColor, flexShrink: 0,
                      }}>{f.icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#DEDEDE" }}>{f.title}</span>
                          <span style={{ fontSize: 10, color: DIM, whiteSpace: "nowrap", paddingRight: 8 }}>{f.ago}</span>
                        </div>
                        <div style={{ fontSize: 11, color: MUTED }}>{f.sub}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Agent alerts */}
            <div style={{
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}>
              <div style={{ height: 3, background: `linear-gradient(90deg, ${BRAND}, #F97316)` }} />
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "16px 20px 12px", borderBottom: `1px solid ${BORDER2}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🔔</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>התראות</span>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 900, background: BRAND, color: "#fff",
                  borderRadius: 99, padding: "2px 8px",
                  boxShadow: "0 0 8px rgba(220,38,38,0.4)",
                }}>3</span>
              </div>
              <div style={{ padding: "10px 16px 16px" }}>
                {ALERTS.map((a, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "11px 12px", borderRadius: 11, marginBottom: 6,
                    background: a.bg, border: `1px solid ${a.color}22`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ fontSize: 17 }}>{a.icon}</span>
                      <span style={{ fontSize: 13, color: "#C8C8C8", fontWeight: 600 }}>{a.label}</span>
                    </div>
                    <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-0.04em", color: a.color, lineHeight: 1 }}>{a.count}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding: "0 20px 16px", textAlign: "left" }}>
                <span style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer" }}>הצג את כל ההתראות ←</span>
              </div>
            </div>

          </div>

          {/* ── Projects table ── */}
          <div style={{
            background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "18px 24px 14px", borderBottom: `1px solid ${BORDER}`,
              background: "rgba(255,255,255,0.01)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>🎵</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: "-0.01em" }}>פרויקטים פעילים</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 99,
                  background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", color: "#3B82F6",
                }}>18 פרויקטים</span>
              </div>
              <span style={{ fontSize: 11, color: MUTED, cursor: "pointer" }}>צפה בכל הפרויקטים ←</span>
            </div>

            {/* Column headers */}
            <div style={{
              display: "grid", gridTemplateColumns: "2.2fr 1fr 1fr 80px 1.3fr 110px",
              padding: "10px 24px", borderBottom: `1px solid ${BORDER2}`,
              background: "rgba(255,255,255,0.015)",
              fontSize: 10, fontWeight: 800, color: DIM,
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              <span>פרויקט</span>
              <span>סטטוס</span>
              <span>שלב</span>
              <span style={{ textAlign: "center" }}>אחראי</span>
              <span>תאריך יעד</span>
              <span style={{ textAlign: "center" }}>ימים לסיום</span>
            </div>

            {PROJECTS.map((p, i) => (
              <div
                key={i}
                style={{
                  display: "grid", gridTemplateColumns: "2.2fr 1fr 1fr 80px 1.3fr 110px",
                  padding: "16px 24px", alignItems: "center",
                  borderBottom: i < PROJECTS.length - 1 ? `1px solid ${BORDER2}` : "none",
                  cursor: "pointer", transition: "background 120ms",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: MUTED }}>{p.artist}</div>
                </div>
                <div>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 99,
                    background: `${p.sc}18`, color: p.sc, border: `1px solid ${p.sc}35`,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: p.sc, display: "inline-block" }} />
                    {p.status}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: SUB }}>{p.dept}</span>
                <div style={{ textAlign: "center" }}><Av t={p.owner} size={28} /></div>
                <span style={{ fontSize: 12, color: p.over ? "#EF4444" : MUTED, fontWeight: 500 }}>📅 {p.dl}</span>
                <div style={{ textAlign: "center" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 800, padding: "4px 12px", borderRadius: 99,
                    background: p.over ? "rgba(239,68,68,0.12)" : p.days <= 7 ? "rgba(249,115,22,0.12)" : "rgba(255,255,255,0.05)",
                    color: p.over ? "#EF4444" : p.days <= 7 ? "#F97316" : SUB,
                    border: `1px solid ${p.over ? "rgba(239,68,68,0.25)" : p.days <= 7 ? "rgba(249,115,22,0.2)" : BORDER2}`,
                  }}>
                    {p.over ? `+${Math.abs(p.days)}` : p.days} ימים
                  </span>
                </div>
              </div>
            ))}

            <div style={{
              padding: "14px 24px", borderTop: `1px solid ${BORDER2}`,
              background: "rgba(255,255,255,0.01)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 12, color: DIM, cursor: "pointer" }}>הצג את כל הפרויקטים ←</span>
              <span style={{ fontSize: 11, color: DIM }}>מציג 5 מתוך 18</span>
            </div>
          </div>

          {/* Preview badge */}
          <div style={{
            marginTop: 28, padding: "10px 16px", borderRadius: 10,
            background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.12)",
            fontSize: 11, color: DIM, textAlign: "center",
          }}>
            🎨 preview עיצובי סטטי — /dashboard-preview — לא מחובר לדאטה אמיתי
          </div>

        </div>
      </div>
    </div>
  );
}
