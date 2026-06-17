"use client";

import { useState, useEffect } from "react";
import type { SocialContentItem, SocialContentStatus, SocialContentType, SocialPlatform, SocialContentFile } from "@/lib/types";
import {
  SOCIAL_CONTENT_STATUSES,
  SOCIAL_CONTENT_STATUS_LABELS,
  SOCIAL_CONTENT_STATUS_COLORS,
  SOCIAL_CONTENT_TYPES,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
} from "@/lib/types";
import SocialFileUpload from "./SocialFileUpload";

interface Props {
  item: SocialContentItem;
  onUpdate: (id: string, patch: Partial<SocialContentItem>) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
  campaignProjectId?: string | null;
}

export default function ContentItemDetail({ item, onUpdate, onDelete, onClose, campaignProjectId }: Props) {
  const effectiveProjectId = item.project_id ?? campaignProjectId ?? null;
  const [title, setTitle] = useState(item.title);
  const [contentType, setContentType] = useState(item.content_type);
  const [platform, setPlatform] = useState(item.platform ?? "");
  const [status, setStatus] = useState<SocialContentStatus>(item.status);
  const [dueDate, setDueDate] = useState(item.due_date ?? "");
  const [publishDate, setPublishDate] = useState(item.publish_date ?? "");
  const [ownerName, setOwnerName] = useState(item.owner_name);
  const [hook, setHook] = useState(item.hook);
  const [caption, setCaption] = useState(item.caption);
  const [assetLink, setAssetLink] = useState(item.asset_link);
  const [dropboxLink, setDropboxLink] = useState(item.dropbox_link);
  const [postedUrl, setPostedUrl] = useState(item.posted_url);
  const [notes, setNotes] = useState(item.notes);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<SocialContentFile[]>([]);

  useEffect(() => {
    fetch(`/api/social/files?contentItemId=${item.id}`)
      .then((r) => r.json())
      .then((d) => setUploadedFiles(d.files ?? []))
      .catch(() => {});
  }, [item.id]);

  async function handleSave() {
    setSaving(true);
    try {
      await onUpdate(item.id, {
        title: title.trim(),
        content_type: contentType,
        platform: (platform || null) as SocialPlatform | null,
        status,
        due_date: dueDate || null,
        publish_date: publishDate || null,
        owner_name: ownerName.trim(),
        hook: hook.trim(),
        caption: caption.trim(),
        asset_link: assetLink.trim(),
        dropbox_link: dropboxLink.trim(),
        posted_url: postedUrl.trim(),
        notes: notes.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await onDelete(item.id);
    onClose();
  }

  const statusColor = SOCIAL_CONTENT_STATUS_COLORS[status];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1A1A1A", borderRadius: 16, border: "1px solid #333",
          padding: 24, width: "100%", maxWidth: 540,
          maxHeight: "92vh", overflowY: "auto",
          display: "flex", flexDirection: "column", gap: 0,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F0" }}>עריכת תוכן</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* סטטוס ושם */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
            <div>
              <label style={labelStyle}>שם התוכן</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>סטטוס</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SocialContentStatus)}
                style={{ ...inputStyle, color: statusColor, background: statusColor + "22", border: `1px solid ${statusColor}44`, fontWeight: 700 }}
              >
                {SOCIAL_CONTENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{SOCIAL_CONTENT_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* סוג + פלטפורמה */}
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
                <option value="">— ללא —</option>
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>{SOCIAL_PLATFORM_LABELS[p]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* תאריכים + אחראי */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>תאריך יעד</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>תאריך פרסום</label>
              <input type="date" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>אחראי</label>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="שם" style={inputStyle} />
            </div>
          </div>

          {/* Hook + Caption */}
          <div>
            <label style={labelStyle}>שורת פתיחה / Hook</label>
            <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="משפט פתיחה" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>כיתוב (Caption)</label>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3}
              placeholder="הכיתוב המלא לפוסט" style={{ ...inputStyle, resize: "vertical" }} />
          </div>

          {/* קבצים — Dropbox upload */}
          <div style={{ borderTop: "1px solid #222", paddingTop: 12 }}>
            <SocialFileUpload
              contentItemId={item.id}
              campaignId={item.campaign_id}
              projectId={effectiveProjectId}
              files={uploadedFiles}
              onFilesChange={setUploadedFiles}
            />
          </div>

          {/* לינקים ידניים — fallback */}
          <details style={{ marginTop: 4 }}>
            <summary style={{ fontSize: 11, color: "#444", cursor: "pointer", userSelect: "none" }}>
              קישורים ידניים (אם הקובץ לא ב-Dropbox)
            </summary>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={labelStyle}>קישור לקובץ (Drive / URL)</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={assetLink} onChange={(e) => setAssetLink(e.target.value)} placeholder="https://..." style={{ ...inputStyle, flex: 1 }} />
                  {assetLink && (
                    <a href={assetLink} target="_blank" rel="noopener noreferrer"
                      style={{ padding: "8px 12px", borderRadius: 8, background: "#EC489922", border: "1px solid #EC489944", color: "#EC4899", fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
                      📁 פתח
                    </a>
                  )}
                </div>
              </div>
              <div>
                <label style={labelStyle}>קישור Dropbox ידני</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={dropboxLink} onChange={(e) => setDropboxLink(e.target.value)} placeholder="https://www.dropbox.com/..." style={{ ...inputStyle, flex: 1 }} />
                  {dropboxLink && (
                    <a href={dropboxLink} target="_blank" rel="noopener noreferrer"
                      style={{ padding: "8px 12px", borderRadius: 8, background: "#0061FF22", border: "1px solid #0061FF44", color: "#0061FF", fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
                      📦 פתח
                    </a>
                  )}
                </div>
              </div>
              {status === "posted" && (
                <div>
                  <label style={labelStyle}>קישור לפוסט שפורסם</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={postedUrl} onChange={(e) => setPostedUrl(e.target.value)} placeholder="https://..." style={{ ...inputStyle, flex: 1 }} />
                    {postedUrl && (
                      <a href={postedUrl} target="_blank" rel="noopener noreferrer"
                        style={{ padding: "8px 12px", borderRadius: 8, background: "#10B98122", border: "1px solid #10B98144", color: "#10B981", fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
                        🔗 פוסט
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </details>

          {/* הערות */}
          <div>
            <label style={labelStyle}>הערות</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, paddingTop: 16, borderTop: "1px solid #222" }}>
          <button
            onClick={handleDelete}
            style={{
              padding: "8px 14px", borderRadius: 8,
              border: `1px solid ${confirmDelete ? "#EF4444" : "#EC489966"}`,
              background: confirmDelete ? "#EF444422" : "#EC489911",
              color: confirmDelete ? "#EF4444" : "#EC4899",
              fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
            }}
          >
            {confirmDelete ? "⚠ מחק סופית?" : "🗑 מחק תוכן"}
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={cancelBtnStyle}>ביטול</button>
            <button onClick={handleSave} disabled={saving || !title.trim()} style={saveBtnStyle}>
              {saving ? "שומר..." : "שמור"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 11, color: "#888", marginBottom: 5, fontWeight: 600 };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #333",
  background: "#141414", color: "#F0F0F0", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
};
const cancelBtnStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 8, border: "1px solid #333",
  background: "transparent", color: "#888", fontSize: 14, cursor: "pointer", fontFamily: "inherit",
};
const saveBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 8, border: "none",
  background: "#EC4899", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
