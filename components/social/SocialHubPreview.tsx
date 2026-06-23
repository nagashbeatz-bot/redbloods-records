"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  SocialCampaign,
  SocialContentItem,
  SocialPlatform,
} from "@/lib/types";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/types";
import { useSocialCampaigns } from "./useSocialCampaign";
import CreateCampaignModal from "./CreateCampaignModal";

// ── Design tokens ──────────────────────────────────────────────────────────────
const BG     = "#090910";
const CARD   = "rgba(255,255,255,0.038)";
const CARD2  = "rgba(255,255,255,0.065)";
const BDR    = "rgba(255,255,255,0.09)";
const BDR2   = "rgba(255,255,255,0.15)";
const TEXT   = "#F2F2F2";
const TEXT2  = "#A0A0B0";
const MUTED  = "#52526A";
const BRAND  = "#DC2626";
const GREEN  = "#10B981";
const AMBER  = "#F59E0B";
const PURPLE = "#8B5CF6";
const BLUE   = "#3B82F6";

// ── Platform config ────────────────────────────────────────────────────────────
const PLT_COLOR: Record<string, string> = {
  instagram: "#E1306C",
  tiktok: "#EE1D52",
  youtube: "#FF0000",
  spotify: "#1DB954",
  facebook: "#1877F2",
  other: MUTED,
};
const PLT_ICON: Record<string, string> = {
  instagram: "📸",
  tiktok: "🎵",
  youtube: "▶",
  spotify: "🎧",
  other: "•",
};

// ── Campaign gradient by index ─────────────────────────────────────────────────
const GRADS = [
  "linear-gradient(145deg,#1d0808 0%,#3d1212 100%)",
  "linear-gradient(145deg,#080d1a 0%,#122040 100%)",
  "linear-gradient(145deg,#08100a 0%,#142a18 100%)",
  "linear-gradient(145deg,#120812 0%,#2a1230 100%)",
  "linear-gradient(145deg,#0a0a16 0%,#181840 100%)",
  "linear-gradient(145deg,#120a08 0%,#301a12 100%)",
];

// ── Status config ──────────────────────────────────────────────────────────────
const CAMPAIGN_STATUS: Record<string, { label: string; color: string }> = {
  active:    { label: "פעיל",    color: GREEN  },
  draft:     { label: "טיוטה",   color: MUTED  },
  completed: { label: "הושלם",   color: BLUE   },
  archived:  { label: "ארכיון",  color: MUTED  },
};
const CONTENT_STATUS_COLOR: Record<string, string> = {
  draft:        PURPLE,
  in_progress:  BLUE,
  ready_to_post: AMBER,
  published:    GREEN,
  idea:         PURPLE,
  needs_shoot:  PURPLE,
  shot:         PURPLE,
  in_edit:      BLUE,
  needs_review: BLUE,
  ready:        AMBER,
  scheduled:    AMBER,
  posted:       GREEN,
  cancelled:    "#EF4444",
};
const CONTENT_STATUS_LABEL: Record<string, string> = {
  draft: "רעיון", in_progress: "בעבודה", ready_to_post: "מוכן",
  published: "פורסם", idea: "רעיון", needs_shoot: "נדרש צילום",
  shot: "צולם", in_edit: "בעריכה", needs_review: "בבדיקה",
  ready: "מוכן", scheduled: "מתוזמן", posted: "פורסם", cancelled: "בוטל",
};

const SCHEDULED_S = new Set(["ready_to_post", "ready", "scheduled"]);
const PUBLISHED_S = new Set(["published", "posted"]);

// ── Hebrew day names ───────────────────────────────────────────────────────────
const HEB_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// ── Relative time ──────────────────────────────────────────────────────────────
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דקות`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `לפני ${hrs} שעות`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "אתמול";
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

// ── Week helpers ───────────────────────────────────────────────────────────────
function getWeekSunday(offset = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + offset * 7);
  return d;
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── File type helper ───────────────────────────────────────────────────────────
function fileIcon(mime: string): string {
  if (mime.startsWith("video")) return "🎬";
  if (mime.startsWith("image")) return "🖼";
  if (mime.startsWith("audio")) return "🎵";
  return "📄";
}

interface ContentFile {
  id: string;
  campaign_id: string;
  content_item_id: string;
  file_name: string;
  file_type: string;
  dropbox_share_link?: string;
  created_at: string;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function SocialHubPreview() {
  const router = useRouter();
  const { campaigns, loading: camLoading, createCampaign } = useSocialCampaigns();
  const [allItems, setAllItems]       = useState<SocialContentItem[]>([]);
  const [allFiles, setAllFiles]       = useState<ContentFile[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showCreate, setShowCreate]   = useState(false);
  const [weekOffset, setWeekOffset]   = useState(0);

  // Fetch content + files for all campaigns (capped at 8)
  useEffect(() => {
    if (camLoading) return;
    if (campaigns.length === 0) { setDataLoading(false); return; }

    const cap = campaigns.slice(0, 8);
    const fetches = cap.flatMap(c => [
      fetch(`/api/social/content?campaignId=${c.id}`)
        .then(r => r.ok ? r.json() : { items: [] })
        .then(d => (d.items ?? []) as SocialContentItem[])
        .catch(() => [] as SocialContentItem[]),
      fetch(`/api/social/files?campaignId=${c.id}`)
        .then(r => r.ok ? r.json() : { files: [] })
        .then(d => {
          const files = (d.files ?? []) as ContentFile[];
          return files.map(f => ({ ...f, campaign_id: c.id }));
        })
        .catch(() => [] as ContentFile[]),
    ]);

    Promise.all(fetches).then(results => {
      const items: SocialContentItem[] = [];
      const files: ContentFile[] = [];
      results.forEach((r, i) => {
        if (i % 2 === 0) items.push(...(r as SocialContentItem[]));
        else files.push(...(r as ContentFile[]));
      });
      setAllItems(items);
      setAllFiles(files);
      setDataLoading(false);
    });
  }, [campaigns, camLoading]);

  const loading = camLoading || dataLoading;

  // ── KPI derived ──────────────────────────────────────────────────────────────
  const activeCampaigns = campaigns.filter(c => c.status === "active").length;
  const scheduledCount  = allItems.filter(i => SCHEDULED_S.has(i.status)).length;
  const publishedCount  = allItems.filter(i => PUBLISHED_S.has(i.status)).length;
  const assetsCount     = allFiles.length;

  // ── Weekly board ─────────────────────────────────────────────────────────────
  const weekSunday = getWeekSunday(weekOffset);
  const weekDays   = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekSunday);
    d.setDate(d.getDate() + i);
    return d;
  });
  const todayISO = isoDate(new Date());
  const weekItemsMap: Record<number, SocialContentItem[]> = {};
  allItems.forEach(item => {
    if (!item.publish_date) return;
    const d = new Date(item.publish_date);
    d.setHours(0, 0, 0, 0);
    const dayOfWeek = d.getDay();
    const itemISO   = isoDate(d);
    const startISO  = isoDate(weekSunday);
    const endISO    = isoDate(weekDays[6]);
    if (itemISO >= startISO && itemISO <= endISO) {
      if (!weekItemsMap[dayOfWeek]) weekItemsMap[dayOfWeek] = [];
      weekItemsMap[dayOfWeek].push(item);
    }
  });

  // ── Activity feed ─────────────────────────────────────────────────────────────
  const activityItems = [
    ...allItems
      .filter(i => i.updated_at)
      .map(i => ({
        key: `item-${i.id}`,
        icon: PUBLISHED_S.has(i.status) ? "📤" : "✏️",
        text: PUBLISHED_S.has(i.status) ? `פורסם: ${i.title}` : `עודכן: ${i.title}`,
        campaign: campaigns.find(c => c.id === i.campaign_id)?.title ?? "",
        date: i.updated_at,
        color: PUBLISHED_S.has(i.status) ? GREEN : BLUE,
      })),
    ...allFiles
      .filter(f => f.created_at)
      .map(f => ({
        key: `file-${f.id}`,
        icon: fileIcon(f.file_type),
        text: `הועלה: ${f.file_name}`,
        campaign: campaigns.find(c => c.id === f.campaign_id)?.title ?? "",
        date: f.created_at,
        color: AMBER,
      })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  // ── Recent assets ─────────────────────────────────────────────────────────────
  const recentAssets = [...allFiles]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  // ── Campaign cards ─────────────────────────────────────────────────────────────
  const displayCampaigns = [...campaigns]
    .sort((a, b) => {
      const order = { active: 0, draft: 1, completed: 2, archived: 3 } as Record<string, number>;
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    })
    .slice(0, 6);

  // ── Week label ────────────────────────────────────────────────────────────────
  const weekLabel = `${weekDays[0].getDate()}–${weekDays[6].getDate()} ב${weekDays[0].toLocaleDateString("he-IL", { month: "long" })} ${weekDays[0].getFullYear()}`;

  return (
    <div style={{
      minHeight: "100vh", background: BG, color: TEXT,
      fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      padding: "32px 32px 60px",
    }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>
            מרכז סושיאל
          </h1>
          <div style={{ fontSize: 13, color: TEXT2, marginTop: 6 }}>
            ניהול קמפיינים, תוכן ומדיה לרשתות החברתיות
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 22px", borderRadius: 12,
            background: BRAND, border: "none", color: "#fff",
            fontSize: 14, fontWeight: 800, cursor: "pointer",
            boxShadow: "0 2px 16px rgba(220,38,38,0.4)",
            transition: "none",
          }}
        >
          + קמפיין חדש
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
        {[
          { label: "קמפיינים פעילים", value: activeCampaigns, sub: "כעת פעילים", icon: "🎯", color: GREEN },
          { label: "תכנים לפרסום",   value: scheduledCount,   sub: "מוכנים / מתוזמנים", icon: "📅", color: PURPLE },
          { label: "פוסטים שפורסמו", value: publishedCount,    sub: "סה״כ",            icon: "📤", color: AMBER },
          { label: "נכסי מדיה",      value: assetsCount,       sub: "קבצים שהועלו",     icon: "📁", color: BRAND },
        ].map(kpi => (
          <div key={kpi.label} style={{
            background: CARD, border: `1px solid ${BDR}`,
            borderRadius: 16, padding: "20px 22px",
            position: "relative", overflow: "hidden",
          }}>
            {/* Ghost icon */}
            <div style={{ position: "absolute", bottom: -6, left: -4, fontSize: 56, opacity: 0.05, userSelect: "none", lineHeight: 1 }}>{kpi.icon}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: TEXT2, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{kpi.label}</div>
            {loading
              ? <div style={{ height: 40, width: "55%", borderRadius: 6, background: "rgba(255,255,255,0.07)", marginBottom: 6 }} />
              : <div style={{ fontSize: 42, fontWeight: 900, color: kpi.color, lineHeight: 1, marginBottom: 4 }}>{kpi.value}</div>
            }
            <div style={{ fontSize: 11, color: MUTED }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Active campaigns ── */}
      <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "22px 24px", marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>קמפיינים פעילים</div>
          {campaigns.length > 6 && (
            <Link href="/social" style={{ fontSize: 12, color: TEXT2, textDecoration: "none" }}>
              הצג הכל ({campaigns.length}) →
            </Link>
          )}
        </div>

        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 220, borderRadius: 14, background: CARD2, border: `1px solid ${BDR}` }} />
            ))}
          </div>
        ) : displayCampaigns.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0", color: MUTED }}>
            <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3 }}>🎯</div>
            <div style={{ fontSize: 13 }}>אין קמפיינים עדיין</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {displayCampaigns.map((camp, idx) => {
              const st = CAMPAIGN_STATUS[camp.status] ?? { label: camp.status, color: MUTED };
              const platforms = (camp.platforms ?? []).filter(p => p !== "other");
              const visiblePlts = platforms.slice(0, 3);
              const extraPlts   = platforms.length - 3;
              const itemCount   = allItems.filter(i => i.campaign_id === camp.id).length;
              const fileCount   = allFiles.filter(f => f.campaign_id === camp.id).length;
              return (
                <div key={camp.id} style={{
                  background: GRADS[idx % GRADS.length],
                  border: `1px solid ${BDR2}`,
                  borderRadius: 16, overflow: "hidden",
                  display: "flex", flexDirection: "column",
                }}>
                  {/* Cover area */}
                  <div style={{
                    height: 110, position: "relative",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    overflow: "hidden",
                  }}>
                    <div style={{ fontSize: 48, opacity: 0.15, userSelect: "none" }}>🎵</div>
                    {/* Status badge */}
                    <div style={{
                      position: "absolute", top: 10, right: 10,
                      padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                      background: `${st.color}22`, border: `1px solid ${st.color}55`, color: st.color,
                    }}>{st.label}</div>
                    {/* Platforms */}
                    {visiblePlts.length > 0 && (
                      <div style={{ position: "absolute", bottom: 10, right: 10, display: "flex", gap: 5 }}>
                        {visiblePlts.map(p => (
                          <div key={p} title={SOCIAL_PLATFORM_LABELS[p as SocialPlatform] ?? p} style={{
                            width: 22, height: 22, borderRadius: "50%", fontSize: 11,
                            background: `${PLT_COLOR[p] ?? MUTED}33`, border: `1px solid ${PLT_COLOR[p] ?? MUTED}66`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>{PLT_ICON[p] ?? "•"}</div>
                        ))}
                        {extraPlts > 0 && (
                          <div style={{
                            width: 22, height: 22, borderRadius: "50%", fontSize: 9, fontWeight: 800,
                            background: CARD2, border: `1px solid ${BDR}`, color: TEXT2,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>+{extraPlts}</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ padding: "14px 16px 16px", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, lineHeight: 1.2 }}>{camp.title}</div>
                    {camp.artist_name && (
                      <div style={{ fontSize: 12, color: TEXT2 }}>{camp.artist_name}</div>
                    )}
                    {camp.release_date && (
                      <div style={{ fontSize: 11, color: MUTED }}>
                        יציאה: {new Date(camp.release_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                      </div>
                    )}
                    {/* Mini stats */}
                    <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: TEXT2 }}>{itemCount} פריטים</span>
                      <span style={{ fontSize: 11, color: TEXT2 }}>{fileCount} נכסים</span>
                    </div>
                    {/* Buttons */}
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <Link
                        href={`/social/campaigns/${camp.id}`}
                        style={{
                          flex: 1, textAlign: "center",
                          padding: "7px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
                          background: BRAND, color: "#fff", textDecoration: "none",
                          display: "block",
                        }}
                      >צפה</Link>
                      <button style={{
                        flex: 1, padding: "7px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
                        background: CARD2, border: `1px solid ${BDR}`, color: TEXT2, cursor: "not-allowed",
                        transition: "none",
                      }}>סטטיסטיקות</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Bottom row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 16 }}>

        {/* Activity */}
        <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "20px 22px" }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>⚡ פעילות אחרונה</div>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 48, borderRadius: 10, background: CARD2 }} />)}
            </div>
          ) : activityItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: MUTED }}>
              <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.3 }}>📋</div>
              <div style={{ fontSize: 12 }}>אין פעילות אחרונה</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activityItems.map(a => (
                <div key={a.key} style={{
                  background: CARD2, border: `1px solid ${BDR}`, borderRadius: 10,
                  padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start",
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{a.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.text}</div>
                    {a.campaign && <div style={{ fontSize: 10, color: MUTED, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.campaign}</div>}
                  </div>
                  <span style={{ fontSize: 10, color: MUTED, flexShrink: 0 }}>{relTime(a.date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Weekly board */}
        <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>📅 לוח תכנון שבועי</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: CARD2, border: `1px solid ${BDR}`, borderRadius: 6, color: TEXT2, cursor: "pointer", padding: "3px 9px", fontSize: 14, transition: "none" }}>‹</button>
              <span style={{ fontSize: 11, color: TEXT2, whiteSpace: "nowrap" }}>{weekLabel}</span>
              <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: CARD2, border: `1px solid ${BDR}`, borderRadius: 6, color: TEXT2, cursor: "pointer", padding: "3px 9px", fontSize: 14, transition: "none" }}>›</button>
            </div>
          </div>

          {loading ? (
            <div style={{ height: 160, borderRadius: 10, background: CARD2 }} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
              {weekDays.map((d, i) => {
                const dayISO    = isoDate(d);
                const isToday   = dayISO === todayISO;
                const dayItems  = weekItemsMap[d.getDay()] ?? [];
                return (
                  <div key={i} style={{ minHeight: 120 }}>
                    <div style={{
                      textAlign: "center", padding: "6px 4px", borderRadius: 8, marginBottom: 6,
                      background: isToday ? BRAND : CARD2,
                      border: `1px solid ${isToday ? BRAND : BDR}`,
                    }}>
                      <div style={{ fontSize: 9, color: isToday ? "#fff" : TEXT2, fontWeight: 700 }}>{HEB_DAYS[d.getDay()]}</div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: isToday ? "#fff" : TEXT }}>{d.getDate()}/{d.getMonth() + 1}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {dayItems.slice(0, 3).map(item => {
                        const plts = item.platform ? item.platform.split(",") : [];
                        const pColor = PLT_COLOR[plts[0]] ?? CONTENT_STATUS_COLOR[item.status] ?? BRAND;
                        return (
                          <div key={item.id} style={{
                            padding: "4px 6px", borderRadius: 5, fontSize: 9, fontWeight: 700,
                            background: `${pColor}20`, border: `1px solid ${pColor}44`, color: pColor,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            lineHeight: 1.3,
                          }} title={item.title}>
                            {item.publish_time ? item.publish_time.slice(0, 5) : ""} {item.title}
                          </div>
                        );
                      })}
                      {dayItems.length > 3 && (
                        <div style={{ fontSize: 9, color: MUTED, textAlign: "center" }}>+{dayItems.length - 3}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && Object.values(weekItemsMap).flat().length === 0 && (
            <div style={{ textAlign: "center", padding: "16px 0", color: MUTED }}>
              <div style={{ fontSize: 12 }}>אין תוכן מתוכנן לשבוע הזה</div>
            </div>
          )}
        </div>

        {/* Recent assets */}
        <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, padding: "20px 22px" }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>🗂 נכסים אחרונים</div>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 44, borderRadius: 8, background: CARD2 }} />)}
            </div>
          ) : recentAssets.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: MUTED }}>
              <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.3 }}>📭</div>
              <div style={{ fontSize: 12 }}>אין נכסי מדיה עדיין</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {recentAssets.map(f => {
                const campTitle = campaigns.find(c => c.id === f.campaign_id)?.title ?? "";
                return (
                  <div key={f.id} style={{
                    background: CARD2, border: `1px solid ${BDR}`, borderRadius: 8,
                    padding: "9px 11px", display: "flex", gap: 8, alignItems: "center",
                  }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(f.file_type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</div>
                      {campTitle && <div style={{ fontSize: 10, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{campTitle}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ marginTop: 14, textAlign: "center" }}>
            <span style={{ fontSize: 11, color: MUTED }}>עבור למאגר מדיה</span>
          </div>
        </div>
      </div>

      {/* ── Create campaign modal ── */}
      {showCreate && (
        <CreateCampaignModal
          onCreate={async input => {
            const result = await createCampaign(input) as SocialCampaign | undefined;
            if (result?.id) router.push(`/social/campaigns/${result.id}`);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
