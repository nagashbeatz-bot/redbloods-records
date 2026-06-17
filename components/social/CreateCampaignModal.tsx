"use client";

import { useState, useEffect } from "react";
import type { SocialCampaign, SocialPlatform, Project } from "@/lib/types";
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_LABELS } from "@/lib/types";

interface Props {
  onCreate: (input: Partial<SocialCampaign>) => Promise<unknown>;
  onClose: () => void;
}

export default function CreateCampaignModal({ onCreate, onClose }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [platforms, setPlatforms] = useState<SocialPlatform[]>(["instagram", "tiktok"]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const all: Project[] = d.projects ?? d ?? [];
        // שירים ראשון, שאר אחרי
        const sorted = [...all.filter((p) => p.projectType === "שיר" && !p.isHidden),
                        ...all.filter((p) => p.projectType !== "שיר" && !p.isHidden)];
        setProjects(sorted);
      })
      .catch(() => {});
  }, []);

  function handleProjectChange(id: string) {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p) {
      if (!title) setTitle(p.name);
      if (!artistName) setArtistName(p.artist);
    }
  }

  function togglePlatform(p: SocialPlatform) {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onCreate({
        project_id: projectId || null,
        title: title.trim(),
        artist_name: artistName.trim(),
        release_date: releaseDate || null,
        platforms,
        status: "active",
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1A1A1A", borderRadius: 16, border: "1px solid #333",
          padding: 24, width: "100%", maxWidth: 460,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: "#F0F0F0", marginBottom: 20 }}>
          קמפיין חדש
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>קשר לפרויקט קיים</label>
            <select value={projectId} onChange={(e) => handleProjectChange(e.target.value)} style={inputStyle}>
              <option value="">— ללא קישור לפרויקט —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectType ? `[${p.projectType}] ` : ""}{p.name} — {p.artist}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>שם הקמפיין *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="שם השיר / קמפיין" required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>אמן</label>
              <input value={artistName} onChange={(e) => setArtistName(e.target.value)} placeholder="שם האמן" style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>תאריך יציאה</label>
            <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>פלטפורמות</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              {SOCIAL_PLATFORMS.filter((p) => p !== "other").map((p) => {
                const active = platforms.includes(p);
                return (
                  <button
                    key={p} type="button"
                    onClick={() => togglePlatform(p)}
                    style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                      border: `1px solid ${active ? "#EC4899" : "#333"}`,
                      background: active ? "#EC489922" : "transparent",
                      color: active ? "#EC4899" : "#666",
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {SOCIAL_PLATFORM_LABELS[p]}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>ביטול</button>
            <button type="submit" disabled={saving || !title.trim()} style={saveBtnStyle}>
              {saving ? "יוצר..." : "צור קמפיין"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 11, color: "#888", marginBottom: 5, fontWeight: 600 };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #333",
  background: "#141414", color: "#F0F0F0", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box",
};
const cancelBtnStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 8, border: "1px solid #333",
  background: "transparent", color: "#888", fontSize: 14, cursor: "pointer", fontFamily: "inherit",
};
const saveBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 8, border: "none",
  background: "#EC4899", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
