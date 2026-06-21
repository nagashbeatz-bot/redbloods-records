"use client";

import { useState, useEffect } from "react";
import type { SocialCampaign, SocialContentItem, SocialContentStatus, SocialPlatform } from "@/lib/types";
import {
  SOCIAL_CONTENT_STATUS_LABELS,
  SOCIAL_CONTENT_STATUS_COLORS,
  SOCIAL_PLATFORM_ICONS,
} from "@/lib/types";

// ── Design Tokens ──────────────────────────────────────────────────────────────
const BRAND  = "#DC2626";
const GREEN  = "#10B981";
const AMBER  = "#F59E0B";
const PURPLE = "#8B5CF6";
const CYAN   = "#06B6D4";
const BLUE   = "#3B82F6";
const BG     = "#090910";
const CARD   = "rgba(255,255,255,0.04)";
const CARD2  = "rgba(255,255,255,0.07)";
const BDR    = "rgba(255,255,255,0.08)";
const BDR2   = "rgba(255,255,255,0.14)";
const TEXT   = "#F2F2F2";
const TEXT2  = "#A0A0B0";
const MUTED  = "#52526A";
const LABEL  = "#70709A";

const PLT_COLORS: Record<string, string> = {
  tiktok: "#EE1D52", instagram: "#E1306C", youtube: "#FF0000",
  spotify: "#1DB954", other: MUTED,
};

// ── Mock Data ──────────────────────────────────────────────────────────────────
const ARTIST_NAME  = "שליו טסמה";
const ARTIST_GENRE = "R&B • אלקטרוני";

type MockRow = {
  id: string; num: string; title: string; content_type: string;
  platform: SocialPlatform; status: SocialContentStatus;
  publish_date: string; assets: number; notes: string;
};

const MOCK_ROWS: MockRow[] = [
  { id:"1", num:"001", title:"טיזר לקליפ – לילה בעיר",         content_type:"טיזר",     platform:"instagram", status:"needs_review", publish_date:"21.6.26", assets:2, notes:"חסר גרסת אנגלית" },
  { id:"2", num:"002", title:"קליפ ראשון – לילה בעיר",         content_type:"קליפ קצר", platform:"youtube",   status:"ready",        publish_date:"24.6.26", assets:3, notes:"✓ אושר" },
  { id:"3", num:"003", title:"שאלות לקהל – איזה שיר?",          content_type:"סטורי",    platform:"instagram", status:"in_edit",      publish_date:"25.6.26", assets:0, notes:"סטורי + פיד" },
  { id:"4", num:"004", title:"BTS אולפן – פרק 2",               content_type:"BTS",      platform:"tiktok",    status:"shot",         publish_date:"26.6.26", assets:4, notes:"בתהליך" },
  { id:"5", num:"005", title:"רילס – מאחורי הקלעים",            content_type:"ריל",      platform:"instagram", status:"ready",        publish_date:"27.6.26", assets:1, notes:"" },
];

const MOCK_FILES = [
  { id:"f1", name:"cover_laila_city.jpg",  ext:"JPG", ctx:"תמונת קאבר לקליפ",   type:"image", dur:null,    bg:"rgba(180,20,20,0.45)"  },
  { id:"f2", name:"studio_bts_02.jpg",     ext:"JPG", ctx:"תמונת אולפן",         type:"image", dur:null,    bg:"rgba(20,30,120,0.45)"  },
  { id:"f3", name:"reel_bts_02.mp4",       ext:"MP4", ctx:"רילס מאחורי הקלעים",  type:"video", dur:"00:21", bg:"rgba(20,100,40,0.45)"  },
  { id:"f4", name:"teaser_laila_city.png", ext:"PNG", ctx:"טיזר לקליפ",          type:"image", dur:null,    bg:"rgba(180,20,80,0.45)"  },
  { id:"f5", name:"clip_cut_01.mp4",       ext:"MP4", ctx:"קליפ גרסה 1",         type:"video", dur:"01:15", bg:"rgba(20,70,180,0.45)"  },
  { id:"f6", name:"qa_story_01.jpg",       ext:"JPG", ctx:"סטורי – שאלות לקהל",  type:"image", dur:null,    bg:"rgba(120,60,20,0.45)"  },
];

const WEEK_DAYS = [
  { label:"ראשון", date:"15.06", today:false, items:[{ t:"פוסט", c:BRAND }, { t:"שאלות", c:MUTED }] },
  { label:"שני",   date:"16.06", today:false, items:[{ t:"ריל", c:PURPLE }] },
  { label:"שלישי", date:"17.06", today:false, items:[{ t:"BTS פרק", c:BLUE }, { t:"ריל", c:PURPLE }] },
  { label:"רביעי", date:"18.06", today:false, items:[{ t:"פוסט", c:GREEN }] },
  { label:"חמישי", date:"19.06", today:false, items:[] },
  { label:"שישי",  date:"20.06", today:false, items:[{ t:"ריל", c:PURPLE }, { t:"טיזר", c:AMBER }] },
  { label:"שבת",   date:"21.06", today:true,  items:[] },
];

const MOCK_CAMPAIGNS = [
  { id:"c1", title:"קליפ ראשון – לילה בעיר", sub:"בדרך אליי",   progress:72, deadline:"28.06.24", color:BRAND  },
  { id:"c2", title:"שיר חדש – בדרך אליי",    sub:"שיר חדש",     progress:54, deadline:"12.07.24", color:AMBER  },
  { id:"c3", title:"BTS אולפן לאלבום",        sub:"אולפן לאלבום", progress:38, deadline:"30.07.24", color:PURPLE },
];

const MOCK_ACTIVITY = [
  { id:"a1", init:"י", user:"יוני לוי",  text:"אישר תוכן: קליפ ראשון – לילה בעיר",     time:"לפני 12 דקות", color:GREEN },
  { id:"a2", init:"ד", user:"דניאל כהן", text:"הוסיף הערה – קליפ מאחורי הקלעים",        time:"לפני שעה",     color:AMBER },
  { id:"a3", init:"S", user:"מערכת",     text:"הועלו 5 קבצים חדשים: BTS אולפן – פרק 2", time:"לפני 3 שעות",  color:CYAN  },
];

// ── Sub-components ─────────────────────────────────────────────────────────────
function ProgressRing({ pct, color, size = 56 }: { pct: number; color: string; size?: number }) {
  const r = (size - 9) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={BDR2} strokeWidth={4.5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4.5}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function StatusBadge({ status }: { status: SocialContentStatus }) {
  const color = SOCIAL_CONTENT_STATUS_COLORS[status] ?? MUTED;
  const label = SOCIAL_CONTENT_STATUS_LABELS[status] ?? status;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 10px",
      borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      background: color + "22", border: `1px solid ${color}55`, color,
    }}>{label}</span>
  );
}

function PlatformBadge({ platform }: { platform: SocialPlatform }) {
  const icon  = SOCIAL_PLATFORM_ICONS[platform] ?? "🌐";
  const color = PLT_COLORS[platform] ?? MUTED;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 9px", borderRadius: 8, fontSize: 11, fontWeight: 700,
      background: color + "18", border: `1px solid ${color}40`, color,
    }}>{icon}</span>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${BDR}`, borderRadius: 16,
      padding: 20, ...style,
    }}>
      {children}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function SocialDesignPreview() {
  const [campaigns, setCampaigns] = useState<SocialCampaign[]>([]);
  const [rows, setRows] = useState<MockRow[]>(MOCK_ROWS);
  const [searchQ, setSearchQ]           = useState("");
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterStatus,   setFilterStatus]   = useState("all");

  useEffect(() => {
    fetch("/api/social/campaigns")
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d.campaigns) || d.campaigns.length === 0) return;
        setCampaigns(d.campaigns);
        const active: SocialCampaign =
          d.campaigns.find((c: SocialCampaign) => c.status === "active") ?? d.campaigns[0];
        fetch(`/api/social/content?campaignId=${active.id}`)
          .then(r2 => r2.json())
          .then(d2 => {
            if (!Array.isArray(d2.items) || d2.items.length === 0) return;
            setRows(
              d2.items.slice(0, 8).map((item: SocialContentItem, idx: number) => ({
                id: item.id,
                num: String(idx + 1).padStart(3, "0"),
                title: item.title,
                content_type: item.content_type,
                platform: (item.platform ?? "other") as SocialPlatform,
                status: item.status as SocialContentStatus,
                publish_date: item.publish_date
                  ? new Date(item.publish_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })
                  : "—",
                assets: item.asset_link ? 1 : 0,
                notes: item.notes ?? "",
              }))
            );
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  // KPI — real data where possible, sensible fallback
  const activeCampaigns = campaigns.filter(c => c.status === "active").length || MOCK_CAMPAIGNS.length;
  const postsThisMonth  = rows.filter(r => r.status === "posted").length || 18;
  const pendingReview   = rows.filter(r => r.status === "needs_review").length || 4;
  const scheduledWeek   = rows.filter(r => r.status === "scheduled").length || 9;
  const missingAssets   = rows.filter(r => r.assets === 0).length || 2;

  const KPI_CARDS = [
    { label: "קמפיינים פעילים", sub: "קמפיינים", icon: "🎯", value: activeCampaigns, color: BRAND  },
    { label: "פוסטים החודש",    sub: "פוסטים",   icon: "💬", value: postsThisMonth,  color: GREEN  },
    { label: "ממתינים לאישור",  sub: "פוסטים",   icon: "⏰", value: pendingReview,   color: AMBER  },
    { label: "מתוכננים השבוע",  sub: "פוסטים",   icon: "📅", value: scheduledWeek,   color: CYAN   },
    { label: "חסרים נכסים",     sub: "נכסים",    icon: "⚠️", value: missingAssets,   color: "#EF4444" },
  ];

  const filteredRows = rows.filter(r => {
    const matchQ = !searchQ || r.title.includes(searchQ) || r.content_type.includes(searchQ);
    const matchP = filterPlatform === "all" || r.platform === filterPlatform;
    const matchS = filterStatus   === "all" || r.status   === filterStatus;
    return matchQ && matchP && matchS;
  });

  const selStyle: React.CSSProperties = {
    padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600,
    background: CARD2, border: `1px solid ${BDR2}`, color: TEXT2,
    cursor: "pointer", outline: "none", direction: "rtl",
  };

  return (
    <div style={{
      minHeight: "100vh", background: BG, direction: "rtl",
      padding: "28px 32px 80px",
      fontFamily: "'Heebo', Arial, sans-serif", color: TEXT, overflowX: "hidden",
    }}>

      {/* ── Block 1: Page Header ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
          <h1 style={{
            margin: 0, fontSize: 30, fontWeight: 900, letterSpacing: "-0.02em",
            background: `linear-gradient(130deg, ${TEXT} 55%, ${BRAND})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            סושיאל — {ARTIST_NAME}
          </h1>
          <span style={{ fontSize: 20 }}>📱</span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: TEXT2 }}>
          ניהול תוכן, קמפיינים ופרסום עבור {ARTIST_NAME}
        </p>
      </div>

      {/* ── Block 2: Artist Card + KPI Row ───────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "210px 1fr", gap: 16, marginBottom: 22 }}>

        {/* Artist Card */}
        <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center", padding: "22px 16px" }}>
          <div style={{
            width: 80, height: 80, borderRadius: 14,
            background: "linear-gradient(145deg, rgba(220,38,38,0.55), rgba(60,8,8,0.95))",
            border: `2px solid rgba(220,38,38,0.45)`,
            boxShadow: "0 0 28px rgba(220,38,38,0.22)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 34,
          }}>🎤</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 4 }}>{ARTIST_NAME}</div>
            <div style={{ fontSize: 11, color: TEXT2, marginBottom: 2 }}>מוסיקאי</div>
            <div style={{ fontSize: 11, color: MUTED }}>{ARTIST_GENRE}</div>
          </div>
          <button style={{
            padding: "7px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700,
            background: `rgba(220,38,38,0.12)`, border: `1px solid rgba(220,38,38,0.35)`,
            color: BRAND, cursor: "pointer", outline: "none",
          }}>
            הצג פרופיל אמן ↗
          </button>
        </Card>

        {/* KPI Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          {KPI_CARDS.map(kpi => (
            <Card key={kpi.label} style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span style={{ fontSize: 18 }}>{kpi.icon}</span>
                <span style={{
                  fontSize: 9, color: LABEL, fontWeight: 700,
                  letterSpacing: "0.04em", textAlign: "left",
                  maxWidth: 60, lineHeight: 1.3,
                }}>{kpi.label}</span>
              </div>
              <div style={{ fontSize: 34, fontWeight: 900, color: kpi.color, lineHeight: 1 }}>
                {kpi.value}
              </div>
              <div style={{ fontSize: 10, color: MUTED }}>{kpi.sub}</div>
            </Card>
          ))}
        </div>
      </div>

      {/* ── Block 3: Content Table ────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 22, padding: 0, overflow: "hidden" }}>
        {/* Header + controls */}
        <div style={{ padding: "16px 20px 14px", borderBottom: `1px solid ${BDR}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>
                לוח תוכן — {ARTIST_NAME}
              </span>
              <span style={{
                background: CARD2, border: `1px solid ${BDR2}`,
                color: TEXT2, fontSize: 11, fontWeight: 700,
                padding: "2px 8px", borderRadius: 6,
              }}>{filteredRows.length} תוכן</span>
            </div>
            <button style={{
              fontSize: 12, fontWeight: 700, padding: "7px 16px", borderRadius: 8,
              background: BRAND, border: "none", color: "#fff", cursor: "pointer",
            }}>+ הוסף תוכן</button>
          </div>
          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: MUTED, pointerEvents: "none" }}>
                🔍
              </span>
              <input
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="חיפוש בתוכן..."
                style={{
                  ...selStyle, paddingRight: 28, width: 170,
                  background: CARD2, color: TEXT,
                }}
              />
            </div>
            <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)} style={selStyle}>
              <option value="all">כל הפלטפורמות</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="youtube">YouTube</option>
              <option value="spotify">Spotify</option>
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selStyle}>
              <option value="all">כל הסטטוסים</option>
              <option value="idea">רעיון</option>
              <option value="needs_shoot">צריך צילום</option>
              <option value="shot">צולם</option>
              <option value="in_edit">בעריכה</option>
              <option value="needs_review">ממתין לאישור</option>
              <option value="ready">מוכן להעלאה</option>
              <option value="scheduled">תוזמן</option>
              <option value="posted">פורסם</option>
            </select>
            <select style={selStyle}>
              <option>סינון ▾</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BDR}` }}>
                {["#", "שם התוכן", "סוג התוכן", "פלטפורמה", "סטטוס", "תאריך פרסום", "נכסים", "הערות", ""].map(h => (
                  <th key={h} style={{
                    padding: "9px 14px", textAlign: "right", fontSize: 10,
                    fontWeight: 700, color: LABEL,
                    textTransform: "uppercase", letterSpacing: "0.05em",
                    whiteSpace: "nowrap", background: "rgba(255,255,255,0.02)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => (
                <tr
                  key={row.id}
                  style={{ borderBottom: `1px solid ${BDR}`, cursor: "pointer" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = CARD2; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: BRAND, display: "inline-block", flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>{row.num}</span>
                    </span>
                  </td>
                  <td style={{ padding: "11px 14px", maxWidth: 230 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.title}
                    </div>
                  </td>
                  <td style={{ padding: "11px 14px", color: TEXT2, fontSize: 12, whiteSpace: "nowrap" }}>
                    {row.content_type}
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <PlatformBadge platform={row.platform} />
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <StatusBadge status={row.status} />
                  </td>
                  <td style={{ padding: "11px 14px", color: TEXT2, fontSize: 12, whiteSpace: "nowrap" }}>
                    {row.publish_date}
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    {row.assets > 0 ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {Array.from({ length: Math.min(row.assets, 3) }).map((_, i) => (
                          <div key={i} style={{
                            width: 24, height: 24, borderRadius: 5,
                            background: `rgba(220,38,38,${0.1 + i * 0.06})`,
                            border: `1px solid ${BDR2}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, flexShrink: 0,
                          }}>🖼</div>
                        ))}
                        {row.assets > 3 && (
                          <span style={{ fontSize: 11, color: TEXT2, fontWeight: 700 }}>+{row.assets - 3}</span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: MUTED }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "11px 14px", fontSize: 12, color: row.notes.startsWith("✓") ? GREEN : TEXT2, whiteSpace: "nowrap" }}>
                    {row.notes || <span style={{ color: MUTED }}>—</span>}
                  </td>
                  <td style={{ padding: "11px 10px" }}>
                    <button style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 16, padding: "2px 4px", lineHeight: 1 }}>
                      ⋮
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Block 4: File Previews ────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>☁️</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>תצוגה מקדימה לקבצים שהועלו</span>
          </div>
          <button style={{
            fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 8,
            background: CARD2, border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer",
          }}>+ העלאת קובץ</button>
        </div>
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
          {MOCK_FILES.map(f => (
            <div key={f.id} style={{
              flexShrink: 0, width: 158, borderRadius: 12,
              border: `1px solid ${BDR}`, overflow: "hidden",
              background: CARD2, cursor: "pointer",
              transition: "border-color 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = BDR2; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = BDR;  }}
            >
              {/* Thumbnail */}
              <div style={{
                width: "100%", height: 108, background: f.bg,
                position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 30, opacity: 0.65 }}>{f.type === "video" ? "🎬" : "🖼"}</span>
                {f.dur && (
                  <span style={{
                    position: "absolute", bottom: 6, left: 6,
                    background: "rgba(0,0,0,0.75)", color: "#fff",
                    fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4,
                  }}>{f.dur}</span>
                )}
                <span style={{
                  position: "absolute", top: 6, left: 6,
                  background: f.type === "video" ? BRAND : BLUE,
                  color: "#fff", fontSize: 9, fontWeight: 800,
                  padding: "2px 5px", borderRadius: 4,
                }}>{f.ext}</span>
              </div>
              {/* Info */}
              <div style={{ padding: "10px 10px 12px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>
                  {f.name}
                </div>
                <div style={{ fontSize: 10, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.ctx}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Block 5: Bottom 3-col grid ────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>

        {/* Col 1: Active Campaigns */}
        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 15 }}>🎯</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>קמפיינים פעילים</span>
          </div>
          {MOCK_CAMPAIGNS.map(camp => (
            <div key={camp.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 14px", background: CARD2,
              borderRadius: 10, border: `1px solid ${BDR}`,
            }}>
              <div style={{ position: "relative", flexShrink: 0, width: 56, height: 56 }}>
                <ProgressRing pct={camp.progress} color={camp.color} size={56} />
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 900, color: camp.color,
                }}>{camp.progress}%</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>
                  {camp.title}
                </div>
                <div style={{ fontSize: 10, color: MUTED }}>סיום משוער: {camp.deadline}</div>
              </div>
            </div>
          ))}
          <button style={{ marginTop: 4, background: "none", border: "none", color: BRAND, fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "right", padding: 0 }}>
            הצג את כל הקמפיינים →
          </button>
        </Card>

        {/* Col 2: Weekly Board */}
        <Card style={{ padding: "18px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 15 }}>📅</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>לוח שבועי</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
            {WEEK_DAYS.map(day => (
              <div key={day.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ textAlign: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: day.today ? BRAND : MUTED, textTransform: "uppercase", marginBottom: 3 }}>
                    {day.label}
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 800,
                    color: day.today ? "#fff" : TEXT2,
                    background: day.today ? BRAND : "transparent",
                    borderRadius: 4, padding: day.today ? "2px 4px" : "0",
                    display: "inline-block",
                  }}>{day.date}</span>
                </div>
                {day.items.map((item, idx) => (
                  <div key={idx} style={{
                    background: item.c + "22", border: `1px solid ${item.c}40`,
                    borderRadius: 4, padding: "3px 3px",
                    fontSize: 8, fontWeight: 700, color: item.c,
                    textAlign: "center", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                    lineHeight: 1.4,
                  }}>{item.t}</div>
                ))}
              </div>
            ))}
          </div>
          <button style={{ marginTop: 14, background: "none", border: "none", color: BRAND, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, display: "block" }}>
            הצג לוח מלא →
          </button>
        </Card>

        {/* Col 3: Activity Feed */}
        <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 15 }}>⚡</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>הערות ופעילות אחרונה</span>
          </div>
          {MOCK_ACTIVITY.map(act => (
            <div key={act.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                background: act.color + "20", border: `1.5px solid ${act.color}50`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 800, color: act.color,
              }}>{act.init}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: TEXT2, lineHeight: 1.4, marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, color: TEXT }}>{act.user}</span>
                  {" — "}
                  {act.text}
                </div>
                <div style={{ fontSize: 10, color: MUTED }}>{act.time}</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: "auto", paddingTop: 10, borderTop: `1px solid ${BDR}` }}>
            <button style={{ background: "none", border: "none", color: BRAND, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
              הצג את כל הפעילות →
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
