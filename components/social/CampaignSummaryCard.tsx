"use client";

import { useState } from "react";
import type { SocialCampaign, SocialPlatform } from "@/lib/types";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORM_ICONS,
} from "@/lib/types";

interface Props {
  campaign: SocialCampaign;
  onUpdate: (patch: Partial<SocialCampaign>) => Promise<unknown>;
  onDelete?: () => Promise<void>;
}

export default function CampaignSummaryCard({ campaign, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [angle, setAngle] = useState(campaign.marketing_angle);
  const [audience, setAudience] = useState(campaign.target_audience);
  const [message, setMessage] = useState(campaign.main_message);
  const [platforms, setPlatforms] = useState<SocialPlatform[]>(campaign.platforms);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onUpdate({ marketing_angle: angle, target_audience: audience, main_message: message, platforms });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function togglePlatform(p: SocialPlatform) {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  }

  return (
    <div style={{ background: "#1A1A1A", borderRadius: 14, border: "1px solid #2A2A2A", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#AAA" }}>תקציר קמפיין</div>
        <button
          onClick={() => editing ? handleSave() : setEditing(true)}
          disabled={saving}
          style={{
            fontSize: 11, padding: "4px 10px", borderRadius: 8,
            border: "1px solid #333", background: "transparent",
            color: editing ? "#10B981" : "#888", cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {saving ? "שומר..." : editing ? "שמור" : "ערוך"}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="זווית שיווקית" value={angle} editing={editing} onChange={setAngle} />
        <Field label="קהל יעד" value={audience} editing={editing} onChange={setAudience} />
        <Field label="מסר מרכזי" value={message} editing={editing} onChange={setMessage} />

        <div>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>פלטפורמות</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SOCIAL_PLATFORMS.filter((p) => p !== "other").map((p) => {
              const active = platforms.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => editing && togglePlatform(p)}
                  style={{
                    padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                    border: `1px solid ${active ? "#EC4899" : "#2A2A2A"}`,
                    background: active ? "#EC489922" : "transparent",
                    color: active ? "#EC4899" : "#555",
                    cursor: editing ? "pointer" : "default",
                    fontFamily: "inherit",
                  }}
                >
                  {SOCIAL_PLATFORM_ICONS[p]} {SOCIAL_PLATFORM_LABELS[p]}
                </button>
              );
            })}
          </div>
        </div>

        {campaign.owner_id && (
          <div>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>אחראי קמפיין</div>
            <div style={{ fontSize: 13, color: "#CCC" }}>{campaign.owner_id}</div>
          </div>
        )}
      </div>

      {onDelete && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #222" }}>
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={{
                width: "100%", padding: "8px", borderRadius: 8,
                border: "1px solid #333", background: "transparent",
                color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              🗑 מחק קמפיין
            </button>
          ) : (
            <div style={{ background: "#EF444411", border: "1px solid #EF444433", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 12, color: "#EF4444", marginBottom: 10, lineHeight: 1.5 }}>
                המחיקה תמחק את הקמפיין ואת כל התכנים שלו.<br />
                הפרויקט המקושר לא יימחק.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  style={{
                    flex: 1, padding: "7px", borderRadius: 8,
                    border: "1px solid #333", background: "transparent",
                    color: "#888", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  ביטול
                </button>
                <button
                  onClick={onDelete}
                  style={{
                    flex: 1, padding: "7px", borderRadius: 8,
                    border: "none", background: "#EF4444",
                    color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  מחק קמפיין
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, editing, onChange }: {
  label: string; value: string; editing: boolean; onChange: (v: string) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>{label}</div>
      {editing ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          style={{
            width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #333",
            background: "#141414", color: "#F0F0F0", fontSize: 13, fontFamily: "inherit",
            resize: "vertical", boxSizing: "border-box",
          }}
        />
      ) : (
        <div style={{ fontSize: 13, color: value ? "#CCC" : "#444", fontStyle: value ? "normal" : "italic" }}>
          {value || "לא הוגדר"}
        </div>
      )}
    </div>
  );
}
