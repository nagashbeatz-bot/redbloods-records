"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SocialCampaign, SocialContentItem, SocialContentFile } from "@/lib/types";
import { SOCIAL_CAMPAIGN_STATUS_LABELS } from "@/lib/types";
import { useSocialContent } from "./useSocialCampaign";
import KPICards from "./KPICards";
import ContentItemsTable from "./ContentItemsTable";
import AddContentModal from "./AddContentModal";
import CampaignSummaryCard from "./CampaignSummaryCard";
import MissingChecklist from "./MissingChecklist";
import { checkMissing } from "@/lib/social-missing-checker";
import { getRecommendations } from "@/lib/social-recommendations";

interface Props {
  campaignId: string;
}

function formatReleaseDate(d: string | null) {
  if (!d) return null;
  const [year, month, day] = d.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  const diffDays = Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const formatted = `${parseInt(day)}/${parseInt(month)}/${year}`;
  if (diffDays < 0) return { label: formatted, note: `לפני ${Math.abs(diffDays)} ימים`, urgent: false };
  if (diffDays === 0) return { label: formatted, note: "היום!", urgent: true };
  if (diffDays <= 7) return { label: formatted, note: `בעוד ${diffDays} ימים`, urgent: true };
  return { label: formatted, note: `בעוד ${diffDays} ימים`, urgent: false };
}

type Tab = "content" | "summary" | "analysis";

export default function CampaignPage({ campaignId }: Props) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<SocialCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddContent, setShowAddContent] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("content");
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const [filesByItem, setFilesByItem] = useState<Record<string, SocialContentFile[]>>({});

  // ניתוח — תיאור ידני
  const [selectedItemId, setSelectedItemId] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [savingDesc, setSavingDesc] = useState(false);

  const { items, loading: itemsLoading, addItem, updateItem, deleteItem } = useSocialContent(campaignId);

  useEffect(() => {
    fetch(`/api/social/campaigns/${campaignId}`)
      .then((r) => r.json())
      .then((d) => setCampaign(d.campaign ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [campaignId]);

  function loadFiles() {
    fetch(`/api/social/files?campaignId=${campaignId}`)
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, SocialContentFile[]> = {};
        const counts: Record<string, number> = {};
        for (const f of (d.files ?? []) as SocialContentFile[]) {
          if (!map[f.content_item_id]) map[f.content_item_id] = [];
          map[f.content_item_id].push(f);
          counts[f.content_item_id] = (counts[f.content_item_id] ?? 0) + 1;
        }
        setFilesByItem(map);
        setFileCounts(counts);
      })
      .catch(() => {});
  }

  useEffect(() => { loadFiles(); }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  // sync manualDescription when selectedItemId changes
  useEffect(() => {
    if (!selectedItemId) { setManualDescription(""); return; }
    const item = items.find((i) => i.id === selectedItemId);
    setManualDescription(item?.notes ?? "");
  }, [selectedItemId, items]);

  async function handleUpdateCampaign(patch: Partial<SocialCampaign>) {
    const res = await fetch(`/api/social/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.campaign) setCampaign(data.campaign);
  }

  async function handleDeleteCampaign() {
    await fetch(`/api/social/campaigns/${campaignId}`, { method: "DELETE" });
    router.push("/social");
  }

  async function handleSaveDescription() {
    if (!selectedItemId) return;
    setSavingDesc(true);
    try {
      await updateItem(selectedItemId, { notes: manualDescription });
    } finally {
      setSavingDesc(false);
    }
  }

  if (loading) return <div style={{ padding: 40, color: "#555", textAlign: "center" }}>טוען...</div>;
  if (!campaign) return <div style={{ padding: 40, color: "#EF4444", textAlign: "center" }}>קמפיין לא נמצא</div>;

  const releaseInfo = formatReleaseDate(campaign.release_date);
  const statusLabel = SOCIAL_CAMPAIGN_STATUS_LABELS[campaign.status];
  const missing = checkMissing(campaign, items);
  const recommendations = getRecommendations(campaign, items);

  const TABS: { id: Tab; label: string }[] = [
    { id: "content", label: "תכנים" },
    { id: "summary", label: "פרטי קמפיין" },
    { id: "analysis", label: "ניתוח" },
  ];

  return (
    <div>
      {/* Back */}
      <Link href="/social" style={{ fontSize: 12, color: "#666", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
        ← חזרה לסושיאל
      </Link>

      {/* Header */}
      <div style={{
        background: "#1A1A1A", borderRadius: 14, border: "1px solid #2A2A2A",
        padding: "18px 20px", marginBottom: 18,
      }}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* Cover placeholder */}
          <div style={{
            width: 64, height: 64, borderRadius: 12, flexShrink: 0,
            background: "linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28,
          }}>
            🎵
          </div>

          {/* Meta */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#F0F0F0", margin: 0 }}>{campaign.title}</h1>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                background: campaign.status === "active" ? "#10B98122" : "#33333322",
                color: campaign.status === "active" ? "#10B981" : "#888",
                border: `1px solid ${campaign.status === "active" ? "#10B98144" : "#333"}`,
              }}>
                {statusLabel}
              </span>
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#666", flexWrap: "wrap" }}>
              {campaign.artist_name && <span>🎤 {campaign.artist_name}</span>}
              {releaseInfo && (
                <span style={{ color: releaseInfo.urgent ? "#F59E0B" : "#666" }}>
                  📅 {releaseInfo.label} ({releaseInfo.note})
                </span>
              )}
              {missing.filter((m) => m.severity === "urgent").length > 0 && (
                <span style={{ color: "#EF4444", fontWeight: 600 }}>
                  ⚠ {missing.filter((m) => m.severity === "urgent").length} דחוף
                </span>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              title="צור תוכנית — Phase 2"
              disabled
              style={{
                padding: "8px 14px", borderRadius: 10,
                background: "transparent", border: "1px solid #333",
                color: "#444", fontSize: 13, fontWeight: 600, cursor: "not-allowed", fontFamily: "inherit",
              }}
            >
              ✦ צור תוכנית
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #222", paddingBottom: 0 }}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              padding: "8px 16px", borderRadius: "10px 10px 0 0", fontSize: 13, fontWeight: 600,
              border: "none", cursor: "pointer", fontFamily: "inherit",
              background: activeTab === id ? "#EC489922" : "transparent",
              color: activeTab === id ? "#EC4899" : "#666",
              borderBottom: activeTab === id ? "2px solid #EC4899" : "2px solid transparent",
            }}
          >
            {label}
            {id === "analysis" && missing.filter((m) => m.severity === "urgent").length > 0 && (
              <span style={{
                marginRight: 6, fontSize: 10, fontWeight: 700,
                background: "#EF4444", color: "#fff", borderRadius: 8, padding: "1px 5px",
              }}>
                {missing.filter((m) => m.severity === "urgent").length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: תכנים */}
      {activeTab === "content" && (
        <div className="grid gap-5 md:grid-cols-[1fr_280px]">
          {/* Left */}
          <div>
            <div style={{ marginBottom: 16 }}>
              <KPICards items={items} />
            </div>
            <div style={{ background: "#141414", borderRadius: 14, border: "1px solid #2A2A2A", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#AAA" }}>
                  תכנים בקמפיין
                  {!itemsLoading && (
                    <span style={{ fontSize: 12, color: "#555", fontWeight: 400, marginRight: 6 }}>({items.length})</span>
                  )}
                </div>
                <button
                  onClick={() => setShowAddContent(true)}
                  style={{
                    padding: "7px 14px", borderRadius: 10,
                    background: "#EC4899", border: "none",
                    color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  + תוכן חדש
                </button>
              </div>
              {itemsLoading ? (
                <div style={{ color: "#555", fontSize: 13, textAlign: "center", padding: "20px 0" }}>טוען תכנים...</div>
              ) : (
                <ContentItemsTable items={items} onUpdate={updateItem} onDelete={deleteItem} fileCounts={fileCounts} filesByItem={filesByItem} campaignProjectId={campaign.project_id ?? null} />
              )}
              {!itemsLoading && items.length === 0 && missing.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <MissingChecklist missing={missing} />
                </div>
              )}
            </div>
          </div>

          {/* Right — summary (desktop only) */}
          <div className="hidden md:block">
            <CampaignSummaryCard campaign={campaign} onUpdate={handleUpdateCampaign} onDelete={handleDeleteCampaign} />
          </div>
        </div>
      )}

      {/* Tab: פרטי קמפיין */}
      {activeTab === "summary" && (
        <CampaignSummaryCard campaign={campaign} onUpdate={handleUpdateCampaign} onDelete={handleDeleteCampaign} />
      )}

      {/* Tab: ניתוח */}
      {activeTab === "analysis" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* חסרים */}
          <MissingChecklist missing={missing} />

          {/* המלצות */}
          <div style={{ background: "#1A1A1A", borderRadius: 12, border: "1px solid #2A2A2A", overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #222" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#AAA" }}>המלצות לשיפור הקמפיין</div>
              <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>ניתוח בסיסי לפי פרטי הקמפיין — לא AI אוטומטי</div>
            </div>
            <div style={{ padding: "8px 0" }}>
              {recommendations.length === 0 ? (
                <div style={{ padding: "10px 14px", fontSize: 13, color: "#666" }}>אין המלצות נוספות כרגע</div>
              ) : (
                recommendations.map((rec, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 14px", fontSize: 13, color: "#AAA" }}>
                    <span style={{ color: "#EC4899", flexShrink: 0 }}>→</span>
                    {rec}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* תיאור ידני לתוכן */}
          {items.length > 0 && (
            <div style={{ background: "#1A1A1A", borderRadius: 12, border: "1px solid #2A2A2A", padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#AAA", marginBottom: 4 }}>תיאור ידני לתוכן</div>
              <div style={{ fontSize: 10, color: "#555", marginBottom: 12 }}>תאר מה יש בסרטון/תמונה לצורך תכנון — נשמר בהערות התוכן</div>
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                style={{
                  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #333",
                  background: "#141414", color: "#F0F0F0", fontSize: 13, fontFamily: "inherit",
                  boxSizing: "border-box", marginBottom: 10,
                }}
              >
                <option value="">— בחר תוכן —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.title}</option>
                ))}
              </select>
              {selectedItemId && (
                <>
                  <textarea
                    value={manualDescription}
                    onChange={(e) => setManualDescription(e.target.value)}
                    rows={4}
                    placeholder="תאר מה יש בסרטון, מה הווייב, מה מתרחש..."
                    style={{
                      width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #333",
                      background: "#141414", color: "#F0F0F0", fontSize: 13, fontFamily: "inherit",
                      resize: "vertical", boxSizing: "border-box", marginBottom: 10,
                    }}
                  />
                  <button
                    onClick={handleSaveDescription}
                    disabled={savingDesc}
                    style={{
                      padding: "8px 18px", borderRadius: 8, border: "none",
                      background: "#EC4899", color: "#fff", fontSize: 13, fontWeight: 700,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {savingDesc ? "שומר..." : "שמור תיאור"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {showAddContent && (
        <AddContentModal
          campaignId={campaignId}
          projectId={campaign.project_id ?? null}
          onAdd={addItem}
          onClose={() => setShowAddContent(false)}
          onFileUploaded={loadFiles}
        />
      )}
    </div>
  );
}
