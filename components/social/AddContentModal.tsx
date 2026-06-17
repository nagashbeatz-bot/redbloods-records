"use client";

import { useRef, useState } from "react";
import type { SocialContentItem, SocialContentType, SocialPlatform } from "@/lib/types";
import { SOCIAL_CONTENT_TYPES, SOCIAL_PLATFORMS, SOCIAL_PLATFORM_LABELS } from "@/lib/types";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

interface Props {
  campaignId: string;
  projectId: string | null;
  onAdd: (input: Partial<SocialContentItem>) => Promise<SocialContentItem>;
  onClose: () => void;
  onFileUploaded?: () => void;
}

export default function AddContentModal({ campaignId, projectId, onAdd, onClose, onFileUploaded }: Props) {
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<SocialContentType>("טיזר");
  const [platform, setPlatform] = useState<SocialPlatform>("instagram");
  const [dueDate, setDueDate] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [hook, setHook] = useState("");
  const [caption, setCaption] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setDragging(true); }
  function handleDragLeave() { setDragging(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  }
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) selectFile(file);
    e.target.value = "";
  }
  function selectFile(file: File) {
    setUploadError(null);
    if (file.size > MAX_FILE_SIZE) {
      setUploadError("הקובץ גדול מדי — מקסימום 500MB");
      return;
    }
    setPendingFile(file);
  }

  function uploadFile(contentItemId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!pendingFile || !projectId) { resolve(); return; }
      const formData = new FormData();
      formData.append("file", pendingFile);
      formData.append("contentItemId", contentItemId);
      formData.append("campaignId", campaignId);
      formData.append("projectId", projectId);

      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 90));
      };
      xhr.onload = () => {
        setUploading(false);
        if (xhr.status === 200) {
          onFileUploaded?.();
          resolve();
        } else {
          try {
            const data = JSON.parse(xhr.responseText) as { error?: string };
            reject(new Error(data.error ?? "שגיאה בהעלאה"));
          } catch {
            reject(new Error("שגיאה בהעלאה"));
          }
        }
      };
      xhr.onerror = () => { setUploading(false); reject(new Error("שגיאת רשת")); };
      xhr.timeout = 300_000;
      xhr.ontimeout = () => { setUploading(false); reject(new Error("פג זמן ההעלאה")); };
      xhr.open("POST", "/api/social/upload");
      xhr.send(formData);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setUploadError(null);
    try {
      const newItem = await onAdd({
        title: title.trim(),
        content_type: contentType,
        platform,
        due_date: dueDate || null,
        owner_name: ownerName.trim(),
        hook: hook.trim(),
        caption: caption.trim(),
        notes: notes.trim(),
        status: "idea",
      });
      if (pendingFile && projectId) {
        setSaving(false);
        setUploading(true);
        setUploadProgress(0);
        await uploadFile(newItem.id);
      }
      onClose();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "שגיאה — נסה שוב");
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  const isWorking = saving || uploading;
  const btnLabel = saving ? "שומר..." : uploading ? `מעלה קובץ... ${uploadProgress}%` : "הוסף תוכן";

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
            <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="משפט פתיחה מושך לסרטון" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>כיתוב (Caption)</label>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={2}
              placeholder="הכיתוב המלא לפוסט" style={{ ...inputStyle, resize: "vertical" }} />
          </div>

          <div>
            <label style={labelStyle}>הערות</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              style={{ ...inputStyle, resize: "vertical" }} />
          </div>

          {/* קבצים */}
          <div style={{ borderTop: "1px solid #222", paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 8, fontWeight: 600 }}>
              קובץ (אופציונלי)
            </div>

            {!projectId ? (
              <div style={{
                padding: "10px 14px", borderRadius: 8,
                background: "#F59E0B11", border: "1px solid #F59E0B33",
                fontSize: 12, color: "#F59E0B",
              }}>
                ⚠ קמפיין זה אינו מקושר לפרויקט — לא ניתן להעלות קבצים בשלב יצירה
              </div>
            ) : pendingFile ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 10,
                background: "#141414", border: "1px solid #EC489944",
              }}>
                <span style={{ fontSize: 20 }}>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#E0E0E0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {pendingFile.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#555" }}>
                    {(pendingFile.size / (1024 * 1024)).toFixed(1)} MB
                    {pendingFile.size > 150 * 1024 * 1024 && (
                      <span style={{ color: "#F59E0B", marginRight: 6 }}>— קובץ גדול, ההעלאה תיקח כמה דקות</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingFile(null)}
                  style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18, padding: "0 4px" }}
                >
                  ×
                </button>
              </div>
            ) : (
              <>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => inputRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragging ? "#EC4899" : "#2A2A2A"}`,
                    borderRadius: 10, padding: "16px 12px", textAlign: "center",
                    cursor: "pointer", background: dragging ? "#EC489911" : "transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 4 }}>📤</div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 2 }}>גרור קובץ לכאן</div>
                  <div style={{ fontSize: 10, color: "#555" }}>וידאו, תמונה, אודיו, PDF — עד 500MB</div>
                  <div style={{
                    display: "inline-block", marginTop: 8, padding: "5px 12px", borderRadius: 8,
                    background: "#EC489922", border: "1px solid #EC489944",
                    color: "#EC4899", fontSize: 11, fontWeight: 600,
                  }}>
                    בחר קובץ
                  </div>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept="video/*,image/*,audio/*,.pdf"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
              </>
            )}

            {uploading && (
              <div style={{ marginTop: 10 }}>
                <div style={{ background: "#222", borderRadius: 8, height: 6, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 8,
                    background: "linear-gradient(90deg, #EC4899, #8B5CF6)",
                    width: `${uploadProgress}%`, transition: "width 0.3s ease",
                  }} />
                </div>
                <div style={{ fontSize: 10, color: "#555", textAlign: "center", marginTop: 4 }}>
                  מעלה ל-Dropbox... {uploadProgress}%
                </div>
              </div>
            )}

            {uploadError && (
              <div style={{
                marginTop: 8, padding: "8px 12px", borderRadius: 8,
                background: "#EF444422", border: "1px solid #EF444444",
                fontSize: 12, color: "#EF4444",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span>⚠ {uploadError}</span>
                <button onClick={() => setUploadError(null)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} disabled={isWorking} style={cancelBtnStyle}>ביטול</button>
            <button type="submit" disabled={isWorking || !title.trim()} style={saveBtnStyle}>
              {btnLabel}
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
