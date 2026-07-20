"use client";

import { useState, useEffect, useRef, useCallback, type DragEvent } from "react";
import { createPortal } from "react-dom";

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
  dropbox_path: string;
  dropbox_url: string;
  notes: string;
  created_at: string;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function isPdf(doc: Doc) {
  return doc.file_name.toLowerCase().endsWith(".pdf") || doc.mime_type === "application/pdf";
}

function previewCandidate(docs: Doc[]): Doc | null {
  return docs.find(d => d.file_type === "תסריט" && isPdf(d))
    ?? docs.find(d => isPdf(d))
    ?? null;
}

function downloadUrl(doc: Doc) {
  return doc.dropbox_url.includes("dl=")
    ? doc.dropbox_url.replace(/dl=\d/, "dl=1")
    : doc.dropbox_url + (doc.dropbox_url.includes("?") ? "&dl=1" : "?dl=1");
}

function viewUrl(doc: Doc) {
  return doc.dropbox_url.includes("dl=")
    ? doc.dropbox_url.replace(/dl=\d/, "dl=0")
    : doc.dropbox_url + (doc.dropbox_url.includes("?") ? "&dl=0" : "?dl=0");
}

// ── Fullscreen PDF Viewer ──────────────────────────────────────────────────────

function PdfFullscreenViewer({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const [iframeError, setIframeError] = useState(false);
  const previewSrc = `/api/red-films/documents/${doc.id}/preview`;

  // Lock body scroll while open; restore on close
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const typeColor = TYPE_COLORS[doc.file_type] ?? "#6B7280";

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0,
        zIndex: 99999,
        background: "#0D0D0D",
        display: "flex", flexDirection: "column",
        // Sit above bottom nav, mini player, FAB
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px",
        paddingTop: "max(12px, env(safe-area-inset-top))",
        background: "#141414",
        borderBottom: "1px solid #2A2A2A",
        flexShrink: 0,
      }}>
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            background: "#1A1A1A", border: "1px solid #2A2A2A",
            borderRadius: 10, padding: "8px 14px",
            color: "#888", fontSize: 13, cursor: "pointer",
            fontFamily: "inherit", flexShrink: 0, lineHeight: 1,
          }}
        >
          ✕
        </button>

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: typeColor,
              background: `${typeColor}18`, border: `1px solid ${typeColor}33`,
              borderRadius: 5, padding: "2px 7px", flexShrink: 0,
            }}>
              {doc.file_type}
            </span>
            <span style={{
              fontSize: 13, color: "#CCC", fontWeight: 600,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {doc.file_name}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <a
            href={viewUrl(doc)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11, color: "#FCA5A5", textDecoration: "none",
              padding: "6px 10px", border: "1px solid rgba(220,38,38,0.3)",
              borderRadius: 7, fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            📁 Dropbox
          </a>
          <a
            href={previewSrc}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11, color: "#888", textDecoration: "none",
              padding: "6px 10px", border: "1px solid #2A2A2A",
              borderRadius: 7, fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            ⤢ טאב
          </a>
        </div>
      </div>

      {/* PDF area */}
      {iframeError ? (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 16, padding: 24, textAlign: "center",
        }}>
          <div style={{ fontSize: 14, color: "#666" }}>
            לא ניתן להציג תצוגה מקדימה במכשיר הזה
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <a
              href={viewUrl(doc)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "10px 20px", borderRadius: 10, background: "rgba(220,38,38,0.12)",
                border: "1px solid rgba(220,38,38,0.35)", color: "#FCA5A5",
                fontSize: 14, fontWeight: 600, textDecoration: "none",
              }}
            >
              פתח ב-Dropbox
            </a>
            <a
              href={downloadUrl(doc)}
              style={{
                padding: "10px 20px", borderRadius: 10, background: "#1A1A1A",
                border: "1px solid #2A2A2A", color: "#888",
                fontSize: 14, fontWeight: 600, textDecoration: "none",
              }}
            >
              ⬇ הורד
            </a>
          </div>
        </div>
      ) : (
        <iframe
          src={previewSrc}
          style={{
            flex: 1,
            width: "100%",
            border: "none",
            display: "block",
            background: "#111",
            // Account for safe-area-inset-bottom so content isn't under home bar
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
          title={doc.file_name}
          onError={() => setIframeError(true)}
        />
      )}
    </div>,
    document.body
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function RedFilmsDocuments({ productionId }: { productionId: string }) {
  const [docs, setDocs]             = useState<Doc[]>([]);
  const [loading, setLoading]       = useState(true);
  const [dragging, setDragging]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [uploadErr, setUploadErr]   = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState("אחר");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Inline preview (desktop)
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  // Fullscreen viewer
  const [fullscreenDoc, setFullscreenDoc] = useState<Doc | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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
    if (previewDocId === docId) setPreviewDocId(null);
    if (fullscreenDoc?.id === docId) setFullscreenDoc(null);
    try {
      const res = await fetch(`/api/red-films/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDocs(prev => prev.filter(d => d.id !== docId));
    } catch { /* silent */ }
    finally { setDeletingId(null); }
  }

  const candidate = previewCandidate(docs);
  const previewDoc = previewDocId ? docs.find(d => d.id === previewDocId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Fullscreen viewer (portal) ──────────────────────────────────────────── */}
      {fullscreenDoc && (
        <PdfFullscreenViewer
          doc={fullscreenDoc}
          onClose={() => setFullscreenDoc(null)}
        />
      )}

      {/* ── PDF Preview card ────────────────────────────────────────────────────── */}
      {!loading && candidate && (
        <div style={{
          background: "linear-gradient(180deg, rgba(24,16,17,0.72), rgba(15,12,13,0.82))",
          border: "1px solid rgba(220,38,38,0.12)",
          borderRadius: 16, overflow: "hidden",
        }}>
          {/* Card header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: (!isMobile && previewDoc) ? "1px solid #222" : "none",
            gap: 8,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: TYPE_COLORS[candidate.file_type] ?? "#6B7280",
                background: `${TYPE_COLORS[candidate.file_type] ?? "#6B7280"}18`,
                border: `1px solid ${TYPE_COLORS[candidate.file_type] ?? "#6B7280"}33`,
                borderRadius: 5, padding: "2px 7px", flexShrink: 0,
              }}>
                {candidate.file_type}
              </span>
              <span style={{ fontSize: 12, color: "#AAA", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {candidate.file_name}
              </span>
            </div>

            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
              {/* Mobile: fullscreen button */}
              {isMobile ? (
                <button
                  onClick={() => setFullscreenDoc(candidate)}
                  style={{
                    fontSize: 12, color: "#A78BFA", fontWeight: 700,
                    background: "rgba(167,139,250,0.1)",
                    border: "1px solid rgba(167,139,250,0.3)",
                    borderRadius: 8, padding: "6px 12px",
                    cursor: "pointer", fontFamily: "inherit",
                    minHeight: 36,
                  }}
                >
                  📄 פתח לקריאה
                </button>
              ) : (
                /* Desktop: toggle inline preview */
                previewDocId === candidate.id ? (
                  <button
                    onClick={() => setPreviewDocId(null)}
                    style={{ fontSize: 11, color: "#888", background: "none", border: "1px solid #333", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    ▲ סגור תצוגה
                  </button>
                ) : (
                  <button
                    onClick={() => setPreviewDocId(candidate.id)}
                    style={{ fontSize: 11, color: "#A78BFA", fontWeight: 700, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    ▼ הצג תסריט
                  </button>
                )
              )}
              <a
                href={viewUrl(candidate)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, color: "#FCA5A5", textDecoration: "none", padding: "3px 8px", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 5 }}
              >
                📁
              </a>
              <a
                href={downloadUrl(candidate)}
                style={{ fontSize: 11, color: "#555", textDecoration: "none", padding: "3px 8px", border: "1px solid #2A2A2A", borderRadius: 5 }}
              >
                ⬇
              </a>
            </div>
          </div>

          {/* Desktop inline iframe — not shown on mobile */}
          {!isMobile && previewDoc && (
            <iframe
              src={`/api/red-films/documents/${previewDoc.id}/preview`}
              style={{ width: "100%", height: 580, border: "none", display: "block", background: "#111" }}
              title={previewDoc.file_name}
            />
          )}
        </div>
      )}

      {/* ── Documents panel ───────────────────────────────────────────────────── */}
      <div style={{
        position: "relative", background: "linear-gradient(180deg, rgba(24,16,17,0.72), rgba(15,12,13,0.82))",
        border: "1px solid rgba(220,38,38,0.12)", borderRadius: 18, padding: "18px 20px",
        boxShadow: "0 14px 44px rgba(0,0,0,0.42), 0 0 14px rgba(220,38,38,0.04)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 10 }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, fontWeight: 700, color: "#EDEDF2", margin: 0 }}>
            <span style={{ width: 3, height: 15, borderRadius: 2, background: "linear-gradient(180deg, #DC2626, #7F1D1D)", boxShadow: "0 0 8px rgba(220,38,38,0.4)", flexShrink: 0 }} />
            מסמכי הפקה
          </h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                cursor: uploading ? "default" : "pointer", fontFamily: "inherit",
                background: uploading ? "rgba(220,38,38,0.08)" : "rgba(220,38,38,0.12)",
                border: "1px solid rgba(220,38,38,0.35)", color: "#FCA5A5",
                opacity: uploading ? 0.6 : 1,
              }}
            >
              {uploading ? "מעלה..." : "+ העלה מסמך"}
            </button>
            <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFileInput} />
          </div>
        </div>

        {uploadErr && (
          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 8, color: "#F87171", fontSize: 12, padding: "8px 12px", marginBottom: 12,
          }}>
            {uploadErr}
          </div>
        )}

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{
            border: `1px dashed ${dragging ? "#FCA5A5" : "#2A2A2A"}`,
            borderRadius: 10, padding: "14px 16px",
            background: dragging ? "rgba(220,38,38,0.05)" : "transparent",
            transition: "all 0.15s", marginBottom: docs.length ? 14 : 0,
            textAlign: "center", color: dragging ? "#FCA5A5" : "#444", fontSize: 12,
          }}
        >
          {uploading ? "מעלה..." : "גרור לכאן קובץ להעלאה"}
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: "#444", padding: "12px 0" }}>טוען...</div>
        ) : docs.length === 0 ? (
          <div style={{ fontSize: 13, color: "#333", fontStyle: "italic", padding: "8px 0" }}>אין מסמכים עדיין</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {docs.map(doc => (
              <div key={doc.id} style={{
                display: "flex", alignItems: "center", gap: 12,
                background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.12)",
                borderRadius: 11, padding: "12px 14px",
              }}>
                <span style={{
                  fontSize: 10.5, fontWeight: 700, color: TYPE_COLORS[doc.file_type] ?? "#6B7280",
                  background: `${TYPE_COLORS[doc.file_type] ?? "#6B7280"}18`,
                  border: `1px solid ${TYPE_COLORS[doc.file_type] ?? "#6B7280"}33`,
                  borderRadius: 6, padding: "3px 9px", flexShrink: 0, whiteSpace: "nowrap",
                }}>
                  {doc.file_type}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#E6E6EA", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {doc.file_name}
                  </div>
                  <div style={{ fontSize: 11, color: "#78787F", marginTop: 2 }}>
                    {fmtDate(doc.created_at)}
                  </div>
                </div>
                {isPdf(doc) && (
                  <button
                    onClick={() => isMobile ? setFullscreenDoc(doc) : setPreviewDocId(id => id === doc.id ? null : doc.id)}
                    style={{
                      fontSize: 11, fontWeight: 600, color: "#FCA5A5", background: "rgba(220,38,38,0.06)",
                      border: "1px solid rgba(220,38,38,0.25)",
                      borderRadius: 7, padding: "5px 10px",
                      cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
                    }}
                  >
                    {isMobile ? "קריאה" : (previewDocId === doc.id ? "סגור" : "תצוגה")}
                  </button>
                )}
                <a
                  href={viewUrl(doc)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11, fontWeight: 600, color: "#FCA5A5", flexShrink: 0, textDecoration: "none", padding: "5px 12px", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 7 }}
                >
                  פתח
                </a>
                <button
                  onClick={() => remove(doc.id)}
                  disabled={deletingId === doc.id}
                  title="הסר מסמך"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#6B4A4C", fontSize: 15, padding: "2px 4px", opacity: deletingId === doc.id ? 0.4 : 1, lineHeight: 1, flexShrink: 0 }}
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
