"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RefImage {
  id:           string;
  production_id: string;
  file_name:    string;
  dropbox_path: string;
  dropbox_url:  string;
  sort_order:   number;
  created_at:   string;
}

// Return a directly renderable image URL.
// Routes already store dl.dropboxusercontent.com or /api/dropbox/stream — use as-is.
// Legacy dl=0 URLs (old records) get the domain swap as fallback.
function toDirectUrl(shareUrl: string): string {
  if (!shareUrl) return "";
  if (shareUrl.startsWith("/api/")) return shareUrl;
  if (shareUrl.includes("dl.dropboxusercontent.com")) return shareUrl;
  // Legacy: www.dropbox.com share link — convert
  return shareUrl
    .replace("www.dropbox.com", "dl.dropboxusercontent.com")
    .replace(/[?&]dl=0/, "");
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ images, index, onClose, onDelete, onNavigate }: {
  images:     RefImage[];
  index:      number;
  onClose:    () => void;
  onDelete:   (id: string) => void;
  onNavigate: (newIndex: number) => void;
}) {
  const image = images[index];
  const total = images.length;
  // ימין = הבא (index גדול יותר), שמאל = קודם (index קטן יותר)
  const canGoRight = index < total - 1;
  const canGoLeft  = index > 0;

  const [deleting,       setDeleting]       = useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState(false);
  const [imgLoaded,      setImgLoaded]      = useState(false);

  // Reset loaded state when image changes
  useEffect(() => { setImgLoaded(false); setConfirmDelete(false); }, [index]);

  // Preload adjacent images
  useEffect(() => {
    const preload = (i: number) => {
      if (i < 0 || i >= images.length) return;
      const img = new window.Image();
      img.src = toStreamUrl(images[i].dropbox_path);
    };
    preload(index - 1);
    preload(index + 1);
  }, [images, index]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "ArrowRight" && canGoRight) onNavigate(index + 1);
        if (e.key === "ArrowLeft"  && canGoLeft)  onNavigate(index - 1);
      }
    };
    document.addEventListener("keydown", onKey, true); // capture phase — runs before any other handler
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, onNavigate, index, canGoRight, canGoLeft]);

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      const res = await fetch(`/api/red-films/references/${image.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onDelete(image.id);
      // After delete: move to adjacent or close
      const remaining = total - 1;
      if (remaining === 0) { onClose(); }
      else { onNavigate(Math.min(index, remaining - 1)); }
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const navBtnStyle = (disabled: boolean) => ({
    position: "fixed" as const,
    top: "50%", transform: "translateY(-50%)",
    background: "rgba(20,20,20,0.85)", border: "1px solid #333",
    borderRadius: "50%", width: 44, height: 44,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 20, color: disabled ? "#333" : "#CCC",
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit", transition: "all 0.15s",
    userSelect: "none" as const,
    pointerEvents: disabled ? "none" as const : "auto" as const,
  });

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9800,
        background: "rgba(0,0,0,0.92)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      {/* Image */}
      <img
        key={image.id}
        src={toStreamUrl(image.dropbox_path)}
        alt={image.file_name}
        loading="eager"
        onClick={e => e.stopPropagation()}
        onLoad={() => setImgLoaded(true)}
        style={{
          maxWidth: "82vw", maxHeight: "84vh",
          borderRadius: 12, objectFit: "contain",
          boxShadow: "0 24px 80px rgba(0,0,0,0.8)",
          opacity: imgLoaded ? 1 : 0.3,
          transition: "opacity 0.2s",
        }}
      />

      {/* Left arrow — קודם (index - 1) */}
      <button
        onClick={e => { e.stopPropagation(); if (canGoLeft) onNavigate(index - 1); }}
        style={{ ...navBtnStyle(!canGoLeft), right: "auto", left: 16 }}
      >
        ‹
      </button>

      {/* Right arrow — הבא (index + 1) */}
      <button
        onClick={e => { e.stopPropagation(); if (canGoRight) onNavigate(index + 1); }}
        style={{ ...navBtnStyle(!canGoRight), left: "auto", right: 16 }}
      >
        ›
      </button>

      {/* Top bar */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          display: "flex", gap: 10, alignItems: "center",
          background: "rgba(20,20,20,0.9)", border: "1px solid #2A2A2A",
          borderRadius: 12, padding: "8px 14px",
          maxWidth: "min(600px, 80vw)",
        }}
      >
        {/* Counter */}
        <span style={{ fontSize: 12, color: "#888", fontWeight: 700, whiteSpace: "nowrap" }}>
          {index + 1} / {total}
        </span>

        {/* File name */}
        <span style={{ fontSize: 11, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {image.file_name}
        </span>

        {/* Open in Dropbox */}
        <a
          href={toStreamUrl(image.dropbox_path)}
          target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", border: "1px solid #333", background: "none", color: "#60A5FA", textDecoration: "none", whiteSpace: "nowrap" }}
        >
          פתח ↗
        </a>

        {/* Delete */}
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{
            padding: "4px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700,
            cursor: deleting ? "wait" : "pointer", fontFamily: "inherit", border: "1px solid",
            background: confirmDelete ? "rgba(239,68,68,0.15)" : "none",
            color:      confirmDelete ? "#F87171"              : "#666",
            borderColor: confirmDelete ? "rgba(239,68,68,0.4)" : "#333",
            transition: "all 0.15s", whiteSpace: "nowrap",
          }}
        >
          {deleting ? "מוחק..." : confirmDelete ? "מחק?" : "🗑"}
        </button>
        {confirmDelete && !deleting && (
          <button onClick={() => setConfirmDelete(false)}
            style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", border: "1px solid #333", background: "none", color: "#555" }}>
            ביטול
          </button>
        )}

        {/* Close */}
        <button onClick={onClose}
          style={{ color: "#555", background: "none", border: "none", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>
          ✕
        </button>
      </div>
    </div>,
    document.body
  );
}

// Thumbnail proxy URL — used as fallback when dropbox_url is unavailable
function toThumbUrl(dropboxPath: string): string {
  return `/api/red-films/references/thumbnail?path=${encodeURIComponent(dropboxPath)}`;
}

// Full-resolution stream URL for lightbox
function toStreamUrl(dropboxPath: string): string {
  return `/api/dropbox/stream?path=${encodeURIComponent(dropboxPath)}`;
}

// ── Grid image with skeleton ──────────────────────────────────────────────────

function RefGridImage({ src, fallbackSrc, alt }: { src: string; fallbackSrc: string; alt: string }) {
  const [loaded,   setLoaded]   = useState(false);
  const [errored,  setErrored]  = useState(false);
  const [useFallback, setUseFallback] = useState(false);

  const activeSrc = useFallback ? fallbackSrc : src;
  if (errored) return null;

  return (
    <div style={{ position: "relative", width: "100%", minHeight: 80, background: "#111", borderRadius: 8 }}>
      {!loaded && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 8,
          background: "linear-gradient(90deg, #1A1A1A 25%, #252525 50%, #1A1A1A 75%)",
          backgroundSize: "200% 100%",
          animation: "rb-shimmer 1.4s ease infinite",
        }} />
      )}
      <img
        src={activeSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (!useFallback && fallbackSrc && fallbackSrc !== src) {
            setUseFallback(true); // retry with proxy
          } else {
            setErrored(true);     // both failed → hide
          }
        }}
        style={{
          display: "block", width: "100%", height: "auto",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.25s",
          borderRadius: 8,
        }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RedFilmsReferencesBoard({ productionId }: { productionId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [refs,       setRefs]       = useState<RefImage[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [dragging,   setDragging]   = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [uploadErr,  setUploadErr]  = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/red-films/productions/${productionId}/references`);
      const data = await res.json().catch(() => ({}));
      setRefs(data.references ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [productionId]);

  useEffect(() => { load(); }, [load]);

  // ── Upload ────────────────────────────────────────────────────────────────

  const uploadFile = useCallback(async (file: File) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic"];
    if (!allowed.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|webp|gif|avif|heic)$/i)) {
      setUploadErr("סוג קובץ לא נתמך — יש להעלות תמונה (JPG, PNG, WEBP, GIF)");
      setTimeout(() => setUploadErr(null), 5000);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setUploadErr("הקובץ גדול מדי — מקסימום 20MB");
      setTimeout(() => setUploadErr(null), 5000);
      return;
    }

    setUploading(true);
    setProgress(0);
    setUploadErr(null);

    const body = new FormData();
    body.append("file", file, file.name);

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.timeout = 60_000;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 90));
      };

      xhr.onload = async () => {
        setProgress(100);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const json = JSON.parse(xhr.responseText);
            if (!json.reference) throw new Error(json.error || "שגיאה");
            setRefs(prev => [...prev, json.reference as RefImage]);
          } catch (err) {
            setUploadErr(err instanceof Error ? err.message : "שגיאה בהעלאה");
            setTimeout(() => setUploadErr(null), 6000);
          }
        } else {
          let msg = "שגיאה בהעלאה";
          try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch {}
          setUploadErr(msg);
          setTimeout(() => setUploadErr(null), 6000);
        }
        setUploading(false);
        setProgress(0);
        if (inputRef.current) inputRef.current.value = "";
        resolve();
      };

      xhr.onerror  = () => { setUploadErr("שגיאת רשת"); setUploading(false); resolve(); };
      xhr.ontimeout = () => { setUploadErr("הפעולה ארכה יותר מדי — נסה שוב"); setUploading(false); resolve(); };

      xhr.open("POST", `/api/red-films/productions/${productionId}/references/upload`);
      xhr.send(body);
    });
  }, [productionId]);

  // ── Drag & drop ──────────────────────────────────────────────────────────

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!uploading) setDragging(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(false); };
  const onDrop      = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragging(false);
    if (uploading) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    for (const file of files) {
      await uploadFile(file);
    }
  };

  function handleDelete(id: string) {
    setRefs(prev => prev.filter(r => r.id !== id));
  }

  function handleLightboxDelete(id: string) {
    setRefs(prev => prev.filter(r => r.id !== id));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 14, padding: "18px 20px" }}>
      <style>{`@keyframes rb-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: "#888", margin: 0 }}>
          רפרנסים / השראות
          {refs.length > 0 && (
            <span style={{ fontSize: 11, color: "#444", fontWeight: 400, marginRight: 8 }}>
              ({refs.length})
            </span>
          )}
        </h2>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          style={{
            fontSize: 11, color: uploading ? "#555" : "#888",
            background: "none", border: "1px solid #333", borderRadius: 6,
            cursor: uploading ? "wait" : "pointer", fontFamily: "inherit",
            padding: "4px 10px",
          }}
        >
          {uploading ? `מעלה... ${progress > 0 ? `${progress}%` : ""}` : "↑ הוסף תמונה"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
      />

      {/* Error banner */}
      {uploadErr && (
        <div style={{
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
          borderRadius: 8, padding: "8px 12px", marginBottom: 12,
          fontSize: 12, color: "#F87171", display: "flex", justifyContent: "space-between",
        }}>
          <span>{uploadErr}</span>
          <button onClick={() => setUploadErr(null)} style={{ background: "none", border: "none", color: "#F87171", cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div style={{ color: "#444", fontSize: 12, padding: "24px 0", textAlign: "center" }}>טוען רפרנסים...</div>
      ) : (
        <>
          {/* Masonry grid */}
          {refs.length > 0 && (
            <div style={{
              columns: "3 160px",
              columnGap: 8,
              marginBottom: 12,
            }}>
              {refs.map(ref => (
                <div
                  key={ref.id}
                  onClick={() => setLightboxIndex(refs.indexOf(ref))}
                  style={{
                    breakInside: "avoid",
                    marginBottom: 8,
                    borderRadius: 8,
                    overflow: "hidden",
                    cursor: "pointer",
                    position: "relative",
                    background: "#111",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "0.82")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                >
                  {/* Primary: CDN URL (direct, fast). Fallback: thumbnail proxy */}
                  <RefGridImage
                    src={toDirectUrl(ref.dropbox_url)}
                    fallbackSrc={toThumbUrl(ref.dropbox_path)}
                    alt={ref.file_name}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => { if (!uploading) inputRef.current?.click(); }}
            style={{
              border: `1px dashed ${dragging ? "#60A5FA" : "#2A2A2A"}`,
              borderRadius: 10,
              padding: refs.length > 0 ? "10px 0" : "32px 0",
              textAlign: "center",
              cursor: uploading ? "wait" : "pointer",
              background: dragging ? "rgba(96,165,250,0.06)" : "transparent",
              transition: "all 0.15s",
            }}
          >
            {uploading ? (
              <div style={{ fontSize: 12, color: "#555" }}>
                מעלה{progress > 0 ? ` ${progress}%` : "..."} ⏳
              </div>
            ) : dragging ? (
              <div style={{ fontSize: 13, color: "#60A5FA", fontWeight: 600 }}>שחרר להעלאה ↓</div>
            ) : (
              <div style={{ fontSize: 12, color: "#3A3A3A" }}>
                {refs.length === 0 ? "גרור תמונות לכאן, או לחץ להעלות" : "גרור תמונה נוספת"}
              </div>
            )}
          </div>
        </>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && refs.length > 0 && (
        <Lightbox
          images={refs}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDelete={handleLightboxDelete}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}
