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
const BG     = "#08080F";
const CARD   = "rgba(255,255,255,0.035)";
const CARD2  = "rgba(255,255,255,0.06)";
const BDR    = "rgba(255,255,255,0.09)";
const BDR2   = "rgba(255,255,255,0.16)";
const TEXT   = "#F0F0F0";
const TEXT2  = "#9A9AB0";
const MUTED  = "#50506A";
const BRAND  = "#DC2626";
const GREEN  = "#10B981";
const AMBER  = "#F59E0B";
const PURPLE = "#8B5CF6";
const BLUE   = "#3B82F6";
const CYAN   = "#06B6D4";

// ── Platform config ────────────────────────────────────────────────────────────
const PLT_COLOR: Record<string, string> = {
  instagram: "#E1306C",
  tiktok:    "#EE1D52",
  youtube:   "#FF0000",
  spotify:   "#1DB954",
  facebook:  "#1877F2",
  other:     MUTED,
};
const PLT_ICON: Record<string, string> = {
  instagram: "📸",
  tiktok:    "🎵",
  youtube:   "▶",
  spotify:   "🎧",
  other:     "•",
};

// ── Campaign cover gradients ───────────────────────────────────────────────────
const GRADS = [
  { bg: "linear-gradient(145deg,#1a0606 0%,#3a1010 100%)", accent: "#DC2626" },
  { bg: "linear-gradient(145deg,#060b1a 0%,#101c3a 100%)", accent: "#3B82F6" },
  { bg: "linear-gradient(145deg,#060a08 0%,#0d2415 100%)", accent: "#10B981" },
  { bg: "linear-gradient(145deg,#10060e 0%,#261028 100%)", accent: "#8B5CF6" },
  { bg: "linear-gradient(145deg,#080a18 0%,#14163a 100%)", accent: "#06B6D4" },
  { bg: "linear-gradient(145deg,#100a06 0%,#2a1810 100%)", accent: "#F59E0B" },
];

// ── Status config ──────────────────────────────────────────────────────────────
const CAMPAIGN_STATUS: Record<string, { label: string; color: string }> = {
  active:    { label: "פעיל",    color: GREEN  },
  draft:     { label: "טיוטה",   color: MUTED  },
  completed: { label: "הושלם",   color: BLUE   },
  archived:  { label: "ארכיון",  color: MUTED  },
};
const CONTENT_STATUS_COLOR: Record<string, string> = {
  draft: PURPLE, in_progress: BLUE, ready_to_post: AMBER, published: GREEN,
  idea: PURPLE, needs_shoot: PURPLE, shot: PURPLE, in_edit: BLUE,
  needs_review: BLUE, ready: AMBER, scheduled: AMBER, posted: GREEN, cancelled: "#EF4444",
};

const SCHEDULED_S = new Set(["ready_to_post", "ready", "scheduled"]);
const PUBLISHED_S = new Set(["published", "posted"]);

const HEB_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const HEB_DAYS_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `לפני ${hrs} שע׳`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "אתמול";
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

function getWeekSunday(offset = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + offset * 7);
  return d;
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fileIcon(mime: string): string {
  if (mime.startsWith("video")) return "🎬";
  if (mime.startsWith("image")) return "🖼";
  if (mime.startsWith("audio")) return "🎵";
  return "📄";
}
function fileColor(mime: string): string {
  if (mime.startsWith("video")) return BRAND;
  if (mime.startsWith("image")) return PURPLE;
  if (mime.startsWith("audio")) return GREEN;
  return MUTED;
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

  // ── KPI ──────────────────────────────────────────────────────────────────────
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
    const itemISO  = isoDate(d);
    const startISO = isoDate(weekSunday);
    const endISO   = isoDate(weekDays[6]);
    if (itemISO >= startISO && itemISO <= endISO) {
      const key = d.getDay();
      if (!weekItemsMap[key]) weekItemsMap[key] = [];
      weekItemsMap[key].push(item);
    }
  });

  // ── Activity ──────────────────────────────────────────────────────────────────
  const activityItems = [
    ...allItems.filter(i => i.updated_at).map(i => ({
      key: `item-${i.id}`,
      icon: PUBLISHED_S.has(i.status) ? "📤" : "✏️",
      text: PUBLISHED_S.has(i.status) ? `פורסם: ${i.title}` : `עודכן: ${i.title}`,
      campaign: campaigns.find(c => c.id === i.campaign_id)?.title ?? "",
      date: i.updated_at,
      color: PUBLISHED_S.has(i.status) ? GREEN : BLUE,
    })),
    ...allFiles.filter(f => f.created_at).map(f => ({
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

  // ── Campaign cards ────────────────────────────────────────────────────────────
  const displayCampaigns = [...campaigns]
    .sort((a, b) => {
      const order = { active: 0, draft: 1, completed: 2, archived: 3 } as Record<string, number>;
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    })
    .slice(0, 6);

  const weekLabel = (() => {
    const s = weekDays[0];
    const e = weekDays[6];
    if (s.getMonth() === e.getMonth())
      return `${s.getDate()}–${e.getDate()} ${s.toLocaleDateString("he-IL", { month: "short" })} ${s.getFullYear()}`;
    return `${s.getDate()} ${s.toLocaleDateString("he-IL", { month: "short" })} – ${e.getDate()} ${e.toLocaleDateString("he-IL", { month: "short" })} ${e.getFullYear()}`;
  })();

  const weekHasContent = Object.values(weekItemsMap).flat().length > 0;

  return (
    <div style={{
      minHeight: "100vh",
      background: BG,
      color: TEXT,
      fontFamily: "'Heebo', Arial, sans-serif",
      direction: "rtl",
      padding: "32px 32px 72px",
      maxWidth: 1460,
      margin: "0 auto",
      width: "100%",
    }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: "-0.02em", color: TEXT }}>
            מרכז סושיאל
          </h1>
          <div style={{ fontSize: 12, color: TEXT2, marginTop: 5, letterSpacing: "0.01em" }}>
            ניהול קמפיינים, תוכן ומדיה לרשתות החברתיות
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "10px 20px", borderRadius: 10,
            background: BRAND, border: "none", color: "#fff",
            fontSize: 13, fontWeight: 800, cursor: "pointer",
            boxShadow: "0 4px 20px rgba(220,38,38,0.45)",
            transition: "none", letterSpacing: "0.01em",
          }}
        >
          + קמפיין חדש
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { label: "קמפיינים פעילים", value: activeCampaigns, sub: "פעילים כעת",       icon: "🎯", color: GREEN,  glow: "rgba(16,185,129,0.15)" },
          { label: "מוכנים לפרסום", value: scheduledCount,   sub: "ממתינים להעלאה",   icon: "📅", color: PURPLE, glow: "rgba(139,92,246,0.15)" },
          { label: "פורסמו",         value: publishedCount,   sub: "סה״כ פורסמו",       icon: "📤", color: AMBER,  glow: "rgba(245,158,11,0.15)" },
          { label: "קבצי מדיה",      value: assetsCount,      sub: "קבצים שהועלו",       icon: "📁", color: BRAND,  glow: "rgba(220,38,38,0.15)"  },
        ].map(kpi => (
          <div key={kpi.label} style={{
            background: `linear-gradient(145deg, ${CARD} 0%, ${kpi.glow} 100%)`,
            border: `1px solid rgba(255,255,255,0.10)`,
            borderTop: `2px solid ${kpi.color}`,
            borderRadius: 14,
            padding: "18px 20px 16px",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", bottom: -8, left: -6, fontSize: 52, opacity: 0.07, userSelect: "none", lineHeight: 1 }}>{kpi.icon}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: TEXT2, textTransform: "uppercase", letterSpacing: "0.10em" }}>{kpi.label}</div>
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: `${kpi.color}1A`, border: `1px solid ${kpi.color}33`,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
              }}>{kpi.icon}</div>
            </div>
            {loading
              ? <div style={{ height: 36, width: "50%", borderRadius: 6, background: "rgba(255,255,255,0.07)", marginBottom: 6 }} />
              : <div style={{ fontSize: 38, fontWeight: 900, color: kpi.color, lineHeight: 1, marginBottom: 5 }}>{kpi.value}</div>
            }
            <div style={{ fontSize: 11, color: MUTED }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Active campaigns ── */}
      <div style={{
        background: CARD, border: `1px solid ${BDR}`,
        borderRadius: 16, padding: "20px 22px", marginBottom: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>קמפיינים פעילים</div>
            {!loading && (
              <div style={{
                padding: "2px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: `${GREEN}18`, border: `1px solid ${GREEN}40`, color: GREEN,
              }}>{displayCampaigns.length}</div>
            )}
          </div>
          {campaigns.length > 6 && (
            <Link href="/social" style={{ fontSize: 12, color: TEXT2, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
              הצג הכל ({campaigns.length}) ›
            </Link>
          )}
        </div>

        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 240, borderRadius: 14, background: CARD2, border: `1px solid ${BDR}` }} />
            ))}
          </div>
        ) : displayCampaigns.length === 0 ? (
          <div style={{ textAlign: "center", padding: "56px 0", color: MUTED }}>
            <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.25 }}>🎯</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>אין קמפיינים עדיין</div>
            <div style={{ fontSize: 11, marginTop: 6 }}>לחץ על "+ קמפיין חדש" כדי להתחיל</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
            {displayCampaigns.map((camp, idx) => {
              const st       = CAMPAIGN_STATUS[camp.status] ?? { label: camp.status, color: MUTED };
              const grad     = GRADS[idx % GRADS.length];
              const platforms = (camp.platforms ?? []).filter(p => p !== "other");
              const visPlts  = platforms.slice(0, 4);
              const extraP   = platforms.length - 4;
              const itemCount = allItems.filter(i => i.campaign_id === camp.id).length;
              const fileCount = allFiles.filter(f => f.campaign_id === camp.id).length;
              const publishedItems = allItems.filter(i => i.campaign_id === camp.id && PUBLISHED_S.has(i.status)).length;

              return (
                <div key={camp.id} style={{
                  background: grad.bg,
                  border: `1px solid ${BDR2}`,
                  borderRadius: 14,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  transition: "none",
                }}>
                  {/* Cover */}
                  <div style={{
                    height: 130,
                    position: "relative",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    overflow: "hidden",
                    borderBottom: `1px solid rgba(255,255,255,0.06)`,
                  }}>
                    {/* Large letter watermark */}
                    <div style={{
                      fontSize: 80, fontWeight: 900, opacity: 0.06,
                      color: grad.accent, userSelect: "none", lineHeight: 1,
                      position: "absolute",
                    }}>
                      {camp.title.charAt(0)}
                    </div>
                    {/* Glow dot */}
                    <div style={{
                      position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
                      width: 100, height: 40,
                      background: `radial-gradient(ellipse at center, ${grad.accent}30 0%, transparent 70%)`,
                    }} />

                    {/* Status badge */}
                    <div style={{
                      position: "absolute", top: 10, right: 10,
                      padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                      background: `${st.color}20`, border: `1px solid ${st.color}50`, color: st.color,
                    }}>{st.label}</div>

                    {/* Platform icons */}
                    {visPlts.length > 0 && (
                      <div style={{ position: "absolute", bottom: 10, left: 10, display: "flex", gap: 4 }}>
                        {visPlts.map(p => (
                          <div key={p} title={SOCIAL_PLATFORM_LABELS[p as SocialPlatform] ?? p} style={{
                            width: 24, height: 24, borderRadius: "50%", fontSize: 12,
                            background: `${PLT_COLOR[p] ?? MUTED}30`,
                            border: `1px solid ${PLT_COLOR[p] ?? MUTED}60`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>{PLT_ICON[p] ?? "•"}</div>
                        ))}
                        {extraP > 0 && (
                          <div style={{
                            width: 24, height: 24, borderRadius: "50%", fontSize: 9, fontWeight: 800,
                            background: CARD2, border: `1px solid ${BDR}`, color: TEXT2,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>+{extraP}</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ padding: "14px 16px 16px", flex: 1, display: "flex", flexDirection: "column" }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, lineHeight: 1.3, marginBottom: 4 }}>{camp.title}</div>
                    {camp.artist_name && (
                      <div style={{ fontSize: 12, color: TEXT2, marginBottom: 4 }}>{camp.artist_name}</div>
                    )}
                    {camp.release_date && (
                      <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>
                        📅 {new Date(camp.release_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                      </div>
                    )}

                    {/* Stats row */}
                    <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1,
                        padding: "6px 0", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}` }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{itemCount}</div>
                        <div style={{ fontSize: 9, color: MUTED }}>פריטים</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1,
                        padding: "6px 0", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}` }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: GREEN }}>{publishedItems}</div>
                        <div style={{ fontSize: 9, color: MUTED }}>פורסמו</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1,
                        padding: "6px 0", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}` }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: AMBER }}>{fileCount}</div>
                        <div style={{ fontSize: 9, color: MUTED }}>נכסים</div>
                      </div>
                    </div>

                    {/* Buttons */}
                    <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                      <Link
                        href={`/social/campaigns/${camp.id}`}
                        style={{
                          flex: 1, textAlign: "center",
                          padding: "8px 0", borderRadius: 9, fontSize: 12, fontWeight: 700,
                          background: BRAND, color: "#fff", textDecoration: "none",
                          display: "block", boxShadow: "0 2px 10px rgba(220,38,38,0.35)",
                        }}
                      >צפה</Link>
                      <button style={{
                        flex: 1, padding: "8px 0", borderRadius: 9, fontSize: 12, fontWeight: 600,
                        background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR}`,
                        color: MUTED, cursor: "default", transition: "none",
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
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>

        {/* ── Activity ── */}
        <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "22px 24px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14 }}>⚡</span> פעילות אחרונה
          </div>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {[1,2,3,4].map(i => <div key={i} style={{ height: 52, borderRadius: 10, background: CARD2 }} />)}
            </div>
          ) : activityItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "36px 0", color: MUTED }}>
              <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.25 }}>📋</div>
              <div style={{ fontSize: 12 }}>אין פעילות אחרונה</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {activityItems.map(a => (
                <div key={a.key} style={{
                  background: CARD2, border: `1px solid ${BDR}`, borderRadius: 10,
                  padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start",
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: `${a.color}18`, border: `1px solid ${a.color}35`,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                  }}>{a.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.text}</div>
                    {a.campaign && (
                      <div style={{ fontSize: 10, color: MUTED, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.campaign}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: MUTED, flexShrink: 0, marginTop: 1 }}>{relTime(a.date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Weekly board ── */}
        <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "22px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14 }}>📅</span> לוח תכנון שבועי
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => setWeekOffset(w => w - 1)}
                style={{ background: CARD2, border: `1px solid ${BDR}`, borderRadius: 7, color: TEXT2, cursor: "pointer", padding: "4px 10px", fontSize: 15, transition: "none", lineHeight: 1 }}
              >‹</button>
              <span style={{ fontSize: 11, color: TEXT2, whiteSpace: "nowrap", minWidth: 120, textAlign: "center" }}>{weekLabel}</span>
              <button
                onClick={() => setWeekOffset(w => w + 1)}
                style={{ background: CARD2, border: `1px solid ${BDR}`, borderRadius: 7, color: TEXT2, cursor: "pointer", padding: "4px 10px", fontSize: 15, transition: "none", lineHeight: 1 }}
              >›</button>
            </div>
          </div>

          {loading ? (
            <div style={{ height: 180, borderRadius: 10, background: CARD2 }} />
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
                {weekDays.map((d, i) => {
                  const dayISO   = isoDate(d);
                  const isToday  = dayISO === todayISO;
                  const dayItems = weekItemsMap[d.getDay()] ?? [];
                  return (
                    <div key={i}>
                      {/* Day header */}
                      <div style={{
                        textAlign: "center", padding: "7px 3px 6px", borderRadius: 9, marginBottom: 6,
                        background: isToday ? BRAND : CARD2,
                        border: `1px solid ${isToday ? BRAND : BDR}`,
                        boxShadow: isToday ? "0 2px 10px rgba(220,38,38,0.35)" : "none",
                      }}>
                        <div style={{ fontSize: 8, color: isToday ? "rgba(255,255,255,0.85)" : MUTED, fontWeight: 700, letterSpacing: "0.04em" }}>
                          {HEB_DAYS_SHORT[d.getDay()]}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: isToday ? "#fff" : TEXT, lineHeight: 1.2 }}>
                          {d.getDate()}/{d.getMonth() + 1}
                        </div>
                      </div>
                      {/* Day items */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 5, minHeight: 110 }}>
                        {dayItems.slice(0, 3).map(item => {
                          const plts      = item.platform ? item.platform.split(",") : [];
                          const pColor    = PLT_COLOR[plts[0]] ?? CONTENT_STATUS_COLOR[item.status] ?? BRAND;
                          const campName  = campaigns.find(c => c.id === item.campaign_id)?.title ?? "קמפיין ללא שם";
                          const timeStr   = item.publish_time ? item.publish_time.slice(0, 5) : null;
                          return (
                            <div key={item.id} style={{
                              padding: "5px 7px", borderRadius: 6,
                              background: `${pColor}18`, border: `1px solid ${pColor}40`,
                              lineHeight: 1.3,
                            }} title={`${item.title} · ${campName}`}>
                              <div style={{
                                fontSize: 9, fontWeight: 700, color: pColor,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>{item.title}</div>
                              <div style={{
                                fontSize: 8, color: `${pColor}BB`,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                marginTop: 1,
                              }}>
                                {campName}{timeStr ? ` · ${timeStr}` : ""}
                              </div>
                            </div>
                          );
                        })}
                        {dayItems.length > 3 && (
                          <div style={{ fontSize: 9, color: MUTED, textAlign: "center", paddingTop: 2 }}>
                            +{dayItems.length - 3}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!weekHasContent && (
                <div style={{ textAlign: "center", padding: "16px 0 6px", color: MUTED }}>
                  <div style={{ fontSize: 12 }}>אין תוכן מתוכנן לשבוע הזה</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Recent assets ── */}
        <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "22px 24px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14 }}>🗂</span> נכסים אחרונים
          </div>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2,3,4].map(i => <div key={i} style={{ height: 50, borderRadius: 9, background: CARD2 }} />)}
            </div>
          ) : recentAssets.length === 0 ? (
            <div style={{ textAlign: "center", padding: "36px 0", color: MUTED }}>
              <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.25 }}>📭</div>
              <div style={{ fontSize: 12 }}>אין נכסי מדיה עדיין</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {recentAssets.map(f => {
                const campTitle = campaigns.find(c => c.id === f.campaign_id)?.title ?? "";
                const fColor    = fileColor(f.file_type);
                const icon      = fileIcon(f.file_type);
                return (
                  <div key={f.id} style={{
                    background: CARD2,
                    border: `1px solid ${BDR}`,
                    borderRadius: 9,
                    padding: "9px 11px",
                    display: "flex", gap: 10, alignItems: "center",
                  }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: `${fColor}18`, border: `1px solid ${fColor}35`,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
                    }}>{icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.file_name}
                      </div>
                      {campTitle && (
                        <div style={{ fontSize: 10, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                          {campTitle}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: fColor,
                      padding: "2px 6px", borderRadius: 4, background: `${fColor}15`, flexShrink: 0 }}>
                      {f.file_type.split("/")[1]?.toUpperCase().slice(0, 4) ?? "FILE"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BDR}`, textAlign: "center" }}>
            <span style={{ fontSize: 11, color: MUTED }}>עבור למאגר המדיה</span>
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
