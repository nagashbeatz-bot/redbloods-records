"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { SocialCampaign } from "@/lib/types";
import { SOCIAL_CAMPAIGN_STATUS_LABELS, SOCIAL_CONTENT_STATUS_COLORS } from "@/lib/types";
import { useSocialContent } from "./useSocialCampaign";
import KPICards from "./KPICards";
import ContentItemsTable from "./ContentItemsTable";
import AddContentModal from "./AddContentModal";
import CampaignSummaryCard from "./CampaignSummaryCard";

interface Props {
  campaignId: string;
}

function formatReleaseDate(d: string | null) {
  if (!d) return null;
  const [year, month, day] = d.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const formatted = `${parseInt(day)}/${parseInt(month)}/${year}`;
  if (diffDays < 0) return { label: formatted, note: `לפני ${Math.abs(diffDays)} ימים`, urgent: false };
  if (diffDays === 0) return { label: formatted, note: "היום!", urgent: true };
  if (diffDays <= 7) return { label: formatted, note: `בעוד ${diffDays} ימים`, urgent: true };
  return { label: formatted, note: `בעוד ${diffDays} ימים`, urgent: false };
}

export default function CampaignPage({ campaignId }: Props) {
  const [campaign, setCampaign] = useState<SocialCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddContent, setShowAddContent] = useState(false);
  const [activeTab, setActiveTab] = useState<"content" | "summary">("content");

  const { items, loading: itemsLoading, addItem, updateItem, deleteItem } = useSocialContent(campaignId);

  useEffect(() => {
    fetch(`/api/social/campaigns/${campaignId}`)
      .then((r) => r.json())
      .then((d) => setCampaign(d.campaign ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [campaignId]);

  async function handleUpdateCampaign(patch: Partial<SocialCampaign>) {
    const res = await fetch(`/api/social/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.campaign) setCampaign(data.campaign);
  }

  if (loading) {
    return <div style={{ padding: 40, color: "#555", textAlign: "center" }}>טוען...</div>;
  }
  if (!campaign) {
    return <div style={{ padding: 40, color: "#EF4444", textAlign: "center" }}>קמפיין לא נמצא</div>;
  }

  const releaseInfo = formatReleaseDate(campaign.release_date);
  const statusLabel = SOCIAL_CAMPAIGN_STATUS_LABELS[campaign.status];

  return (
    <div>
      {/* Back + Header */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/social" style={{ fontSize: 12, color: "#666", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ← חזרה לסושיאל
        </Link>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F0", margin: 0 }}>{campaign.title}</h1>
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
            </div>
          </div>
        </div>
      </div>

      {/* Tabs (mobile) */}
      <div className="md:hidden" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["content", "summary"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "7px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600,
              border: "1px solid #333", cursor: "pointer", fontFamily: "inherit",
              background: activeTab === tab ? "#EC4899" : "transparent",
              color: activeTab === tab ? "#fff" : "#888",
            }}
          >
            {tab === "content" ? "תכנים" : "פרטי קמפיין"}
          </button>
        ))}
      </div>

      {/* Main layout */}
      <div className="grid gap-5 md:grid-cols-[1fr_280px]">

        {/* Left — Content */}
        <div className={activeTab === "summary" ? "hidden md:block" : ""}>
          {/* KPI */}
          <div style={{ marginBottom: 16 }}>
            <KPICards items={items} />
          </div>

          {/* Content table */}
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
                  display: "flex", alignItems: "center", gap: 6,
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
              <ContentItemsTable items={items} onUpdate={updateItem} onDelete={deleteItem} />
            )}
          </div>
        </div>

        {/* Right — Summary */}
        <div className={activeTab === "content" ? "hidden md:block" : "block"}>
          <CampaignSummaryCard campaign={campaign} onUpdate={handleUpdateCampaign} />
        </div>
      </div>

      {showAddContent && (
        <AddContentModal
          campaignId={campaignId}
          onAdd={addItem}
          onClose={() => setShowAddContent(false)}
        />
      )}
    </div>
  );
}
