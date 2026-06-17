"use client";

import type { SocialContentFile } from "@/lib/types";
import { dropboxRawUrl, formatFileSize, fileTypeIcon } from "@/lib/types";

interface Props {
  file: SocialContentFile;
  onClose: () => void;
}

export default function MediaPreviewModal({ file, onClose }: Props) {
  const rawUrl = file.dropbox_share_link ? dropboxRawUrl(file.dropbox_share_link) : null;
  const isImage = file.file_type.startsWith("image/");
  const isVideo = file.file_type.startsWith("video/");
  const isAudio = file.file_type.startsWith("audio/");

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.88)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1A1A1A", borderRadius: 16, border: "1px solid #333",
          padding: 20, width: "100%", maxWidth: 680,
          maxHeight: "92vh", overflowY: "auto",
          display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>{fileTypeIcon(file.file_type)}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#F0F0F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 400 }}>
                {file.file_name}
              </div>
              <div style={{ fontSize: 11, color: "#555" }}>{formatFileSize(file.file_size)}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#666", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}
          >
            ×
          </button>
        </div>

        {/* Media */}
        <div style={{ borderRadius: 10, overflow: "hidden", background: "#111", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 160 }}>
          {rawUrl && isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={rawUrl}
              alt={file.file_name}
              style={{ maxWidth: "100%", maxHeight: "70vh", display: "block", borderRadius: 8 }}
            />
          )}
          {rawUrl && isVideo && (
            <video
              controls
              src={rawUrl}
              style={{ maxWidth: "100%", maxHeight: "70vh", display: "block" }}
            />
          )}
          {rawUrl && isAudio && (
            <div style={{ padding: "24px 20px", width: "100%" }}>
              <audio controls src={rawUrl} style={{ width: "100%" }} />
            </div>
          )}
          {(!rawUrl || (!isImage && !isVideo && !isAudio)) && (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>{fileTypeIcon(file.file_type)}</div>
              <div style={{ fontSize: 13, color: "#666" }}>תצוגה מקדימה לא זמינה לסוג קובץ זה</div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          {file.dropbox_share_link && (
            <a
              href={file.dropbox_share_link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "8px 16px", borderRadius: 8,
                background: "#0061FF22", border: "1px solid #0061FF44",
                color: "#0061FF", fontSize: 13, fontWeight: 600,
                textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              📦 פתח בDropbox
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
