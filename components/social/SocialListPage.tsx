"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SocialCampaign } from "@/lib/types";
import { SOCIAL_CAMPAIGN_STATUS_LABELS, SOCIAL_PLATFORM_ICONS } from "@/lib/types";
import { useSocialCampaigns } from "./useSocialCampaign";
import CreateCampaignModal from "./CreateCampaignModal";

function daysUntil(d: string | null): string {
  if (!d) return "";
  const now = new Date();
  const target = new Date(d);
  const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `לפני ${Math.abs(diff)} ימים`;
  if (diff === 0) return "היום!";
  return `בעוד ${diff} ימים`;
}

function CampaignCard({ campaign }: { campaign: SocialCampaign }) {
  const statusLabel = SOCIAL_CAMPAIGN_STATUS_LABELS[campaign.status];
  const isActive = campaign.status === "active";
  const urgentRelease = campaign.release_date
    ? Math.ceil((new Date(campaign.release_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) <= 7
    : false;

  return (
    <Link href={`/social/campaigns/${campaign.id}`} style={{ textDecoration: "none" }}>
      <div
        style={{
          background: "#1A1A1A",
          borderRadius: 14,
          border: `1px solid ${urgentRelease && isActive ? "#F59E0B44" : "#2A2A2A"}`,
          padding: "16px 18px",
          cursor: "pointer",
          transition: "border-color 0.15s",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F0", marginBottom: 3 }}>{campaign.title}</div>
            {campaign.artist_name && (
              <div style={{ fontSize: 12, color: "#666" }}>🎤 {campaign.artist_name}</div>
            )}
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
            background: isActive ? "#10B98122" : "#33333322",
            color: isActive ? "#10B981" : "#666",
            border: `1px solid ${isActive ? "#10B98144" : "#2A2A2A"}`,
            whiteSpace: "nowrap",
          }}>
            {statusLabel}
          </span>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {campaign.release_date && (
            <div style={{ fontSize: 12, color: urgentRelease ? "#F59E0B" : "#666" }}>
              📅 {daysUntil(campaign.release_date)}
            </div>
          )}
          {campaign.platforms.length > 0 && (
            <div style={{ display: "flex", gap: 4 }}>
              {campaign.platforms.map((p) => (
                <span key={p} style={{ fontSize: 16 }}>{SOCIAL_PLATFORM_ICONS[p]}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function SocialListPage() {
  const { campaigns, loading, error, createCampaign } = useSocialCampaigns();
  const [showCreate, setShowCreate] = useState(false);
  const router = useRouter();

  const active = campaigns.filter((c) => c.status === "active" || c.status === "draft");
  const past = campaigns.filter((c) => c.status === "completed" || c.status === "paused");

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F0", margin: 0 }}>מרכז סושיאל</h1>
          <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>ניהול קמפיינים ותכנים לכל הסינגלים</div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "9px 18px", borderRadius: 10,
            background: "#EC4899", border: "none",
            color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          + קמפיין חדש
        </button>
      </div>

      {loading ? (
        <div style={{ color: "#555", fontSize: 14, textAlign: "center", padding: "60px 0" }}>טוען...</div>
      ) : error ? (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          background: "#1A1A1A", borderRadius: 16, border: "1px solid #EF444433",
        }}>
          <div style={{ fontSize: 13, color: "#EF4444", marginBottom: 8 }}>⚠ שגיאה בטעינת קמפיינים</div>
          <div style={{ fontSize: 12, color: "#555" }}>ודא שטבלאות ה-DB הוקמו ב-Supabase</div>
        </div>
      ) : campaigns.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "60px 20px",
          background: "#1A1A1A", borderRadius: 16, border: "1px solid #2A2A2A",
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📱</div>
          <div style={{ fontSize: 16, color: "#CCC", fontWeight: 700, marginBottom: 8 }}>אין קמפיינים עדיין</div>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 20 }}>צור קמפיין חדש וקשר אותו לסינגל קיים</div>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              padding: "9px 20px", borderRadius: 10, border: "none",
              background: "#EC4899", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            + קמפיין חדש
          </button>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#555", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
                קמפיינים פעילים ({active.length})
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {active.map((c) => <CampaignCard key={c.id} campaign={c} />)}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
                קמפיינים קודמים ({past.length})
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {past.map((c) => <CampaignCard key={c.id} campaign={c} />)}
              </div>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateCampaignModal
          onCreate={async (input) => {
            const newCamp = await createCampaign(input);
            router.push(`/social/campaigns/${newCamp.id}`);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
