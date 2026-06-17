"use client";

import { useRef, useState } from "react";
import type { SocialContentFile } from "@/lib/types";
import { formatFileSize, fileTypeIcon } from "@/lib/types";

const MAX_SIZE = 500 * 1024 * 1024;   // 500MB
const WARN_SIZE = 150 * 1024 * 1024;  // 150MB — show warning

interface Props {
  contentItemId: string;
  campaignId: string;
  projectId: string | null;
  files: SocialContentFile[];
  onFilesChange: (files: SocialContentFile[]) => void;
}

export default function SocialFileUpload({
  contentItemId,
  campaignId,
  projectId,
  files,
  onFilesChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function handleDragLeave() { setDragging(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  }

  function uploadFile(file: File) {
    setError(null);
    setSizeWarning(null);

    if (file.size > MAX_SIZE) {
      setError("הקובץ גדול מדי — מקסימום 500MB");
      return;
    }
    if (file.size > WARN_SIZE) {
      setSizeWarning(`קובץ גדול (${formatFileSize(file.size)}) — ההעלאה עשויה לקחת מספר דקות`);
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("contentItemId", contentItemId);
    formData.append("campaignId", campaignId);
    if (projectId) formData.append("projectId", projectId);

    setUploading(true);
    setProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 85));
      }
    };
    xhr.onload = () => {
      setUploading(false);
      setProgress(0);
      if (xhr.status === 200) {
        try {
          const data = JSON.parse(xhr.responseText) as { ok: boolean; file: SocialContentFile };
          if (data.ok && data.file) {
            onFilesChange([...files, data.file]);
            setSizeWarning(null);
          } else {
            setError("שגיאה בהעלאה — נסה שוב");
          }
        } catch {
          setError("שגיאה בהעלאה — נסה שוב");
        }
      } else if (xhr.status === 413) {
        setError("הקובץ גדול מדי — מקסימום 500MB");
      } else {
        try {
          const data = JSON.parse(xhr.responseText) as { error?: string };
          setError(data.error ?? "שגיאה בהעלאה — נסה שוב");
        } catch {
          setError("שגיאה בהעלאה — נסה שוב");
        }
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setProgress(0);
      setError("שגיאת רשת — בדוק חיבור ונסה שוב");
    };
    xhr.timeout = 300_000;
    xhr.ontimeout = () => {
      setUploading(false);
      setError("ההעלאה פגה זמן — נסה שוב עם קובץ קטן יותר");
    };
    xhr.open("POST", "/api/social/upload");
    xhr.send(formData);
  }

  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); } catch {}
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 8, fontWeight: 600 }}>קבצים</div>

      {/* Warning: no project linked */}
      {!projectId && (
        <div style={{
          padding: "8px 12px", borderRadius: 8, marginBottom: 10,
          background: "#F59E0B11", border: "1px solid #F59E0B33",
          fontSize: 12, color: "#F59E0B",
        }}>
          ⚠ קמפיין זה אינו מקושר לפרויקט — הקבצים יעלו לתיקיית Social כללית
        </div>
      )}

      {/* Size warning */}
      {sizeWarning && !uploading && (
        <div style={{
          padding: "8px 12px", borderRadius: 8, marginBottom: 10,
          background: "#F59E0B11", border: "1px solid #F59E0B33",
          fontSize: 12, color: "#F59E0B",
        }}>
          ⏳ {sizeWarning}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: "8px 12px", borderRadius: 8, marginBottom: 10,
          background: "#EF444422", border: "1px solid #EF444444",
          fontSize: 12, color: "#EF4444",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
        </div>
      )}

      {/* Drop zone */}
      {!uploading && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "#EC4899" : "#2A2A2A"}`,
            borderRadius: 10,
            padding: "20px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: dragging ? "#EC489911" : "transparent",
            transition: "all 0.15s",
            marginBottom: files.length > 0 ? 12 : 0,
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 6 }}>📤</div>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>גרור קובץ לכאן</div>
          <div style={{ fontSize: 11, color: "#555" }}>וידאו, תמונה, אודיו, PDF — עד 500MB</div>
          <div style={{
            display: "inline-block",
            marginTop: 10, padding: "6px 14px", borderRadius: 8,
            background: "#EC489922", border: "1px solid #EC489944",
            color: "#EC4899", fontSize: 12, fontWeight: 600,
          }}>
            בחר קובץ
          </div>
        </div>
      )}

      {/* Progress */}
      {uploading && (
        <div style={{ padding: "16px", background: "#141414", borderRadius: 10, border: "1px solid #2A2A2A", marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#AAA", marginBottom: 10, textAlign: "center" }}>
            מעלה קובץ ל-Dropbox...
          </div>
          <div style={{ background: "#222", borderRadius: 8, height: 8, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 8,
              background: "linear-gradient(90deg, #EC4899, #8B5CF6)",
              width: `${progress}%`,
              transition: "width 0.3s ease",
            }} />
          </div>
          <div style={{ fontSize: 11, color: "#555", textAlign: "center", marginTop: 6 }}>
            {progress}%
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*,audio/*,.pdf"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* File list */}
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {files.map((f) => (
            <div
              key={f.id}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 10,
                background: "#141414", border: "1px solid #2A2A2A",
              }}
            >
              <span style={{ fontSize: 20, flexShrink: 0 }}>{fileTypeIcon(f.file_type)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, color: "#E0E0E0", fontWeight: 600,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {f.file_name}
                </div>
                <div style={{ fontSize: 11, color: "#555" }}>
                  {formatFileSize(f.file_size)}
                  {f.file_type && ` · ${f.file_type.split("/")[1]?.toUpperCase() ?? f.file_type}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {f.dropbox_share_link && (
                  <>
                    <a
                      href={f.dropbox_share_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="פתח בDropbox"
                      style={{
                        padding: "5px 10px", borderRadius: 7,
                        background: "#0061FF22", border: "1px solid #0061FF44",
                        color: "#0061FF", fontSize: 12, textDecoration: "none",
                        display: "flex", alignItems: "center", gap: 4,
                      }}
                    >
                      📦 פתח
                    </a>
                    <button
                      onClick={() => copyLink(f.dropbox_share_link)}
                      title="העתק לינק"
                      style={{
                        padding: "5px 8px", borderRadius: 7,
                        background: "transparent", border: "1px solid #333",
                        color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      🔗
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
