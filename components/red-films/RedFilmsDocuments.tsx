"use client";

import { useState, useEffect, useRef, useCallback, type DragEvent } from "react";

const FILE_TYPES = ["תסריט", "בריף", "שוט ליסט", "לו״ז צילום", "אישור / חוזה", "ציוד", "אחר"];

const TYPE_COLORS: Record<string, string> = {
  "תסריט":         "#A78BFA",
  "בריף":          "#60A5FA",
  "שוט ליסט":      "#34D399",
  "לו״ז צילום":    "#FBBF24",
  "אישור / חוזה":  "#F87171",
  "ציוד":          "#FB923C",
  "אחר":           "#6B7280",
};

interface Doc {
  id: string;
  file_name: string;
  file_type: string;
  mime_type: string;
  dropbox_url: string;
  notes: string;
  created_at: string;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function displayName(fileName: string) {
  // Strip leading timestamp prefix (e.g. "1717123456789_brief.pdf" → "brief.pdf")
  return fileName.replace(/^\d+_/, "");
}

export default function RedFilmsDocuments({ productionId }: { productionId: string }) {
  const [docs, setDocs]         = useState<Doc[]>([]);
  const [loading, setLoading]   = useState(true);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState("אחר");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/red-films/productions/${productionId}/documents`);
      const data = await res.json().catch(() => ({}));
      setDocs(data.documents ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [productionId]);

  useEffect(() => { load(); }, [load]);

  async function upload(file: File) {
    setUploading(true);
    setUploadErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("fileType", selectedType);
      const res  = await fetch(`/api/red-films/productions/${productionId}/documents/upload`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "שגיאת שרת");
      setDocs(prev => [data.document, ...prev]);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "שגיאה");
      setTimeout(() => setUploadErr(null), 5000);
    } finally { setUploading(false); }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload(file);
    e.target.value = "";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  }

  async function remove(docId: string) {
    setDeletingId(docId);
    try {
      const res = await fetch(`/api/red-films/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDocs(prev => prev.filter(d => d.id !== docId));
    } catch { /* silent */ }
    finally { setDeletingId(null); }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        background: "#1A1A1A", border: "1px solid #252525",
        borderRadius: 14, padding: "18px 20px",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#888", margin: 0 }}>מסמכי הפקה</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Type selector */}
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
              style={{
                background: "#111", border: "1px solid #333", borderRadius: 6,
                color: "#CCC", fontSize: 12, padding: "5px 8px", cursor: "pointer",
                fontFamily: "inherit", height: 30,
              }}
            >
              {FILE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>

            {/* Upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                cursor: uploading ? "default" : "pointer", fontFamily: "inherit",
                background: uploading ? "rgba(59,130,246,0.08)" : "rgba(59,130,246,0.12)",
                border: "1px solid rgba(59,130,246,0.35)", color: "#60A5FA",
                opacity: uploading ? 0.6 : 1,
              }}
            >
              {uploading ? "מעלה..." : "+ העלה מסמך"}
            </button>
            <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFileInput} />
          </div>
        </div>

        {/* Error */}
        {uploadErr && (
          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 8, color: "#F87171", fontSize: 12, padding: "8px 12px", marginBottom: 12,
          }}>
            {uploadErr}
          </div>
        )}

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{
            border: `1px dashed ${dragging ? "#60A5FA" : "#2A2A2A"}`,
            borderRadius: 10, padding: "14px 16px",
            background: dragging ? "rgba(59,130,246,0.05)" : "transparent",
            transition: "all 0.15s", marginBottom: docs.length ? 14 : 0,
            textAlign: "center", color: dragging ? "#60A5FA" : "#444",
            fontSize: 12,
          }}
        >
          {uploading ? "מעלה..." : "גרור לכאן קובץ להעלאה"}
        </div>

        {/* Documents list */}
        {loading ? (
          <div style={{ fontSize: 13, color: "#444", padding: "12px 0" }}>טוען...</div>
        ) : docs.length === 0 ? (
          <div style={{ fontSize: 13, color: "#333", fontStyle: "italic", padding: "8px 0" }}>אין מסמכים עדיין</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {docs.map(doc => (
              <div
                key={doc.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "#141414", border: "1px solid #222",
                  borderRadius: 8, padding: "8px 12px",
                }}
              >
                {/* Type badge */}
                <span style={{
                  fontSize: 10, fontWeight: 700, color: TYPE_COLORS[doc.file_type] ?? "#6B7280",
                  background: `${TYPE_COLORS[doc.file_type] ?? "#6B7280"}18`,
                  border: `1px solid ${TYPE_COLORS[doc.file_type] ?? "#6B7280"}33`,
                  borderRadius: 5, padding: "2px 7px", flexShrink: 0, whiteSpace: "nowrap",
                }}>
                  {doc.file_type}
                </span>

                {/* Name */}
                <span style={{
                  flex: 1, fontSize: 12, color: "#CCC",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {displayName(doc.file_name)}
                </span>

                {/* Date */}
                <span style={{ fontSize: 11, color: "#444", flexShrink: 0 }}>
                  {fmtDate(doc.created_at)}
                </span>

                {/* Open */}
                <a
                  href={doc.dropbox_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11, color: "#60A5FA", flexShrink: 0,
                    textDecoration: "none", padding: "3px 8px",
                    border: "1px solid rgba(59,130,246,0.3)", borderRadius: 5,
                  }}
                >
                  פתח
                </a>

                {/* Delete */}
                <button
                  onClick={() => remove(doc.id)}
                  disabled={deletingId === doc.id}
                  title="הסר מסמך"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "#3A3A3A", fontSize: 14, padding: "2px 4px",
                    opacity: deletingId === doc.id ? 0.4 : 1,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
