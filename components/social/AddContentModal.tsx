"use client";

import { useState } from "react";
import type { SocialContentItem, SocialContentType, SocialPlatform } from "@/lib/types";
import { SOCIAL_CONTENT_TYPES, SOCIAL_PLATFORMS, SOCIAL_PLATFORM_LABELS } from "@/lib/types";

interface Props {
  campaignId: string;
  onAdd: (input: Partial<SocialContentItem>) => Promise<unknown>;
  onClose: () => void;
}

export default function AddContentModal({ onAdd, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<SocialContentType>("טיזר");
  const [platform, setPlatform] = useState<SocialPlatform>("instagram");
  const [dueDate, setDueDate] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [hook, setHook] = useState("");
  const [caption, setCaption] = useState("");
  const [assetLink, setAssetLink] = useState("");
  const [dropboxLink, setDropboxLink] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onAdd({
        title: title.trim(),
        content_type: contentType,
        platform,
        due_date: dueDate || null,
        owner_name: ownerName.trim(),
        hook: hook.trim(),
        caption: caption.trim(),
        asset_link: assetLink.trim(),
        dropbox_link: dropboxLink.trim(),
        notes: notes.trim(),
        status: "idea",
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
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1A1A1A", borderRadius: 16, border: "1px solid #333",
          padding: 24, width: "100%", maxWidth: 500,
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: "#F0F0F0", marginBottom: 20 }}>
          הוסף תוכן חדש
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>שם התוכן *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="לדוגמה: טיזר ראשון"
              required
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>סוג תוכן</label>
              <select value={contentType} onChange={(e) => setContentType(e.target.value as SocialContentType)} style={inputStyle}>
                {SOCIAL_CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>פלטפורמה</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value as SocialPlatform)} style={inputStyle}>
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>{SOCIAL_PLATFORM_LABELS[p]}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>תאריך יעד</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>אחראי</label>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="שם" style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>שורת פתיחה / Hook</label>
            <input
              value={hook}
              onChange={(e) => setHook(e.target.value)}
              placeholder="משפט פתיחה מושך לסרטון"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>כיתוב (Caption)</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={2}
              placeholder="הכיתוב המלא לפוסט"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <div style={{ borderTop: "1px solid #222", paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 10, fontWeight: 600 }}>קישורי קבצים</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={labelStyle}>קישור לקובץ (Drive / URL)</label>
                <input
                  value={assetLink}
                  onChange={(e) => setAssetLink(e.target.value)}
                  placeholder="https://..."
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>קישור Dropbox</label>
                <input
                  value={dropboxLink}
                  onChange={(e) => setDropboxLink(e.target.value)}
                  placeholder="https://www.dropbox.com/..."
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          <div>
            <label style={labelStyle}>הערות</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>ביטול</button>
            <button type="submit" disabled={saving || !title.trim()} style={saveBtnStyle}>
              {saving ? "שומר..." : "הוסף תוכן"}
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
