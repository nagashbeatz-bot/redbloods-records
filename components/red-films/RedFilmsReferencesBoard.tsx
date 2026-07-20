"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

// ── Constants ─────────────────────────────────────────────────────────────────

const LOCATION_TAGS = [
  "כללי",
  "טיילת בערב",
  "רכב / מונית",
  "בר / מועדון",
  "חוף",
  "דירה",
  "אולפן",
  "אחר",
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface RefImage {
  id:            string;
  production_id: string;
  file_name:     string;
  dropbox_path:  string;
  dropbox_url:   string;
  tag:           string | null;
  sort_order:    number;
  created_at:    string;
}

function effectiveTag(ref: RefImage): string {
  return ref.tag?.trim() || "כללי";
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function toDirectUrl(shareUrl: string): string {
  if (!shareUrl) return "";
  if (shareUrl.startsWith("/api/")) return shareUrl;
  if (shareUrl.includes("dl.dropboxusercontent.com")) return shareUrl;
  return shareUrl
    .replace("www.dropbox.com", "dl.dropboxusercontent.com")
    .replace(/[?&]dl=0/, "");
}

function toThumbUrl(dropboxPath: string): string {
  return `/api/red-films/references/thumbnail?path=${encodeURIComponent(dropboxPath)}`;
}

function toStreamUrl(dropboxPath: string): string {
  return `/api/dropbox/stream?path=${encodeURIComponent(dropboxPath)}`;
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ images, index, onClose, onDelete, onNavigate, onTagChange }: {
  images:      RefImage[];
  index:       number;
  onClose:     () => void;
  onDelete:    (id: string) => void;
  onNavigate:  (newIndex: number) => void;
  onTagChange: (id: string, tag: string) => void;
}) {
  const image    = images[index];
  const total    = images.length;
  const canGoRight = index < total - 1;
  const canGoLeft  = index > 0;

  const [deleting,      setDeleting]      = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imgLoaded,     setImgLoaded]     = useState(false);
  const [savingTag,     setSavingTag]     = useState(false);

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
        e.preventDefault(); e.stopPropagation();
        if (e.key === "ArrowRight" && canGoRight) onNavigate(index + 1);
        if (e.key === "ArrowLeft"  && canGoLeft)  onNavigate(index - 1);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, onNavigate, index, canGoRight, canGoLeft]);

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      const res = await fetch(`/api/red-films/references/${image.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onDelete(image.id);
      const remaining = total - 1;
      if (remaining === 0) onClose();
      else onNavigate(Math.min(index, remaining - 1));
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleTagChange(newTag: string) {
    setSavingTag(true);
    try {
      const res = await fetch(`/api/red-films/references/${image.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: newTag }),
      });
      if (res.ok) onTagChange(image.id, newTag);
    } catch { /* ignore */ }
    finally { setSavingTag(false); }
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
    direction: "ltr" as const,
  });

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
          opacity: imgLoaded ? 1 : 0.3, transition: "opacity 0.2s",
        }}
      />

      {/* Left arrow */}
      <button onClick={e => { e.stopPropagation(); if (canGoLeft) onNavigate(index - 1); }}
        style={{ ...navBtnStyle(!canGoLeft), right: "auto", left: 16 }}>‹</button>

      {/* Right arrow */}
      <button onClick={e => { e.stopPropagation(); if (canGoRight) onNavigate(index + 1); }}
        style={{ ...navBtnStyle(!canGoRight), left: "auto", right: 16 }}>›</button>

      {/* Top bar */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          display: "flex", gap: 10, alignItems: "center",
          background: "rgba(20,20,20,0.9)", border: "1px solid #2A2A2A",
          borderRadius: 12, padding: "8px 14px",
          maxWidth: "min(700px, 90vw)",
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

        {/* Location tag select */}
        <select
          value={effectiveTag(image)}
          onChange={e => handleTagChange(e.target.value)}
          disabled={savingTag}
          title="שנה לוקיישן"
          style={{
            background: "#1A1A1A", border: "1px solid #333", borderRadius: 6,
            color: savingTag ? "#555" : "#AAA", fontSize: 11, padding: "3px 6px",
            cursor: "pointer", fontFamily: "inherit", outline: "none",
            flexShrink: 0,
          }}
        >
          {LOCATION_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        {/* Open in Dropbox */}
        <a href={toStreamUrl(image.dropbox_path)} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", border: "1px solid #333", background: "none", color: "#60A5FA", textDecoration: "none", whiteSpace: "nowrap" }}>
          פתח ↗
        </a>

        {/* Delete */}
        <button onClick={handleDelete} disabled={deleting}
          style={{
            padding: "4px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700,
            cursor: deleting ? "wait" : "pointer", fontFamily: "inherit", border: "1px solid",
            background: confirmDelete ? "rgba(239,68,68,0.15)" : "none",
            color:      confirmDelete ? "#F87171"              : "#666",
            borderColor: confirmDelete ? "rgba(239,68,68,0.4)" : "#333",
            transition: "all 0.15s", whiteSpace: "nowrap",
          }}>
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

// ── Grid image with skeleton ──────────────────────────────────────────────────

function RefGridImage({ src, fallbackSrc, alt, cover }: { src: string; fallbackSrc: string; alt: string; cover?: boolean }) {
  const [loaded,      setLoaded]      = useState(false);
  const [errored,     setErrored]     = useState(false);
  const [useFallback, setUseFallback] = useState(false);

  const activeSrc = useFallback ? fallbackSrc : src;
  if (errored) return null;

  return (
    <div style={{ position: "relative", width: "100%", height: cover ? "100%" : undefined, minHeight: cover ? undefined : 80, background: "#111", borderRadius: 8 }}>
      {!loaded && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 8,
          background: "linear-gradient(90deg, #1A1A1A 25%, #252525 50%, #1A1A1A 75%)",
          backgroundSize: "200% 100%",
          animation: "rb-shimmer 1.4s ease infinite",
        }} />
      )}
      <img
        src={activeSrc} alt={alt} loading="lazy" decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (!useFallback && fallbackSrc && fallbackSrc !== src) { setUseFallback(true); }
          else { setErrored(true); }
        }}
        style={{ display: "block", width: "100%", height: cover ? "100%" : "auto", objectFit: cover ? "cover" : undefined, opacity: loaded ? 1 : 0, transition: "opacity 0.25s", borderRadius: 8 }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RedFilmsReferencesBoard({ productionId }: { productionId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [refs,          setRefs]          = useState<RefImage[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [dragging,      setDragging]      = useState(false);
  const [uploading,     setUploading]     = useState(false);
  const [progress,      setProgress]      = useState(0);
  const [uploadErr,     setUploadErr]     = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [activeFilter,  setActiveFilter]  = useState<string>("הכל");
  const [uploadTag,     setUploadTag]     = useState<string>("כללי");
  const [showAll,       setShowAll]       = useState(false);
  const PREVIEW_COUNT = 12; // uniform grid preview; "הצג הכל" reveals the rest

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

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = activeFilter === "הכל"
    ? refs
    : refs.filter(r => effectiveTag(r) === activeFilter);

  // Count per tag
  const counts: Record<string, number> = { "הכל": refs.length };
  for (const tag of LOCATION_TAGS) {
    counts[tag] = refs.filter(r => effectiveTag(r) === tag).length;
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  const uploadFile = useCallback(async (file: File, tag: string) => {
    const allowed = ["image/jpeg","image/png","image/webp","image/gif","image/avif","image/heic"];
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

    setUploading(true); setProgress(0); setUploadErr(null);

    const body = new FormData();
    body.append("file", file, file.name);
    body.append("tag", tag);

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
        setUploading(false); setProgress(0);
        if (inputRef.current) inputRef.current.value = "";
        resolve();
      };

      xhr.onerror   = () => { setUploadErr("שגיאת רשת"); setUploading(false); resolve(); };
      xhr.ontimeout = () => { setUploadErr("הפעולה ארכה יותר מדי — נסה שוב"); setUploading(false); resolve(); };

      xhr.open("POST", `/api/red-films/productions/${productionId}/references/upload`);
      xhr.send(body);
    });
  }, [productionId]);

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!uploading) setDragging(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(false); };
  const onDrop      = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    if (uploading) return;
    for (const file of Array.from(e.dataTransfer.files ?? [])) {
      await uploadFile(file, uploadTag);
    }
  };

  function handleLightboxDelete(id: string) {
    setRefs(prev => prev.filter(r => r.id !== id));
    // adjust lightbox index if needed
    setLightboxIndex(prev => {
      if (prev === null) return null;
      const newFiltered = filtered.filter(r => r.id !== id);
      if (newFiltered.length === 0) return null;
      return Math.min(prev, newFiltered.length - 1);
    });
  }

  function handleTagChange(id: string, tag: string) {
    setRefs(prev => prev.map(r => r.id === id ? { ...r, tag } : r));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: "relative", background: "linear-gradient(180deg, rgba(24,16,17,0.72), rgba(15,12,13,0.82))", border: "1px solid rgba(220,38,38,0.12)", borderRadius: 18, padding: "18px 20px", boxShadow: "0 14px 44px rgba(0,0,0,0.42), 0 0 14px rgba(220,38,38,0.04)", overflow: "hidden" }}>
      <style>{`@keyframes rb-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, fontWeight: 700, color: "#EDEDF2", margin: 0 }}>
          <span style={{ width: 3, height: 15, borderRadius: 2, background: "linear-gradient(180deg, #DC2626, #7F1D1D)", boxShadow: "0 0 8px rgba(220,38,38,0.4)", flexShrink: 0 }} />
          רפרנסים / השראות
          {refs.length > 0 && (
            <span style={{ fontSize: 11, color: "#78787F", fontWeight: 400 }}>
              ({refs.length})
            </span>
          )}
        </h2>

        {/* Upload controls */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={uploadTag}
            onChange={e => setUploadTag(e.target.value)}
            disabled={uploading}
            style={{
              background: "#0D0D0D", border: "1px solid #333", borderRadius: 6,
              color: "#888", fontSize: 11, padding: "3px 6px",
              cursor: "pointer", fontFamily: "inherit", outline: "none",
            }}
          >
            {LOCATION_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            style={{
              fontSize: 11, color: uploading ? "#555" : "#888",
              background: "none", border: "1px solid #333", borderRadius: 6,
              cursor: uploading ? "wait" : "pointer", fontFamily: "inherit",
              padding: "4px 10px", whiteSpace: "nowrap",
            }}
          >
            {uploading ? `מעלה... ${progress > 0 ? `${progress}%` : ""}` : "↑ הוסף תמונה"}
          </button>
        </div>
      </div>

      <input
        ref={inputRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f, uploadTag); }}
      />

      {/* Filter bar — explicit position+z-index so image grid never overlaps */}
      {refs.length > 0 && (
        <div style={{ position: "relative", zIndex: 5, display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {["הכל", ...LOCATION_TAGS].map(tag => {
            const count = counts[tag] ?? 0;
            const isActive = activeFilter === tag;
            if (tag !== "הכל" && count === 0) return null;
            return (
              <button
                key={tag}
                onClick={() => { setActiveFilter(tag); setLightboxIndex(null); }}
                style={{
                  fontSize: 11, fontWeight: isActive ? 700 : 400,
                  padding: "3px 10px", borderRadius: 20,
                  border: `1px solid ${isActive ? "rgba(220,38,38,0.6)" : "#2A2A2A"}`,
                  background: isActive ? "rgba(220,38,38,0.14)" : "transparent",
                  color: isActive ? "#FCA5A5" : "#78787F",
                  cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                  transition: "all 0.12s",
                }}
              >
                {tag}{tag !== "הכל" && count > 0 && <span style={{ marginRight: 4, opacity: 0.6 }}>({count})</span>}
                {tag === "הכל" && <span style={{ marginRight: 4, opacity: 0.6 }}>({count})</span>}
              </button>
            );
          })}
        </div>
      )}

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

      {loading ? (
        <div style={{ color: "#444", fontSize: 12, padding: "24px 0", textAlign: "center" }}>טוען רפרנסים...</div>
      ) : (
        <>
          {/* Uniform thumbnail grid — capped preview with "הצג הכל" (no giant collage) */}
          {filtered.length > 0 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 8, marginBottom: 12 }}>
                {(showAll ? filtered : filtered.slice(0, PREVIEW_COUNT)).map((ref, i) => (
                  <div
                    key={ref.id}
                    onClick={() => setLightboxIndex(i)}
                    style={{
                      aspectRatio: "1 / 1", borderRadius: 10, overflow: "hidden",
                      cursor: "pointer", position: "relative", background: "#111",
                      border: "1px solid rgba(220,38,38,0.14)",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = "0.82")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                  >
                    <RefGridImage
                      src={toDirectUrl(ref.dropbox_url)}
                      fallbackSrc={toThumbUrl(ref.dropbox_path)}
                      alt={ref.file_name}
                      cover
                    />
                  </div>
                ))}
              </div>
              {filtered.length > PREVIEW_COUNT && (
                <button
                  onClick={() => setShowAll(v => !v)}
                  style={{ width: "100%", padding: "8px 0", marginBottom: 12, borderRadius: 10, border: "1px solid rgba(220,38,38,0.28)", background: "rgba(220,38,38,0.06)", color: "#FCA5A5", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >
                  {showAll ? "הצג פחות ↑" : `הצג הכל (${filtered.length}) ↓`}
                </button>
              )}
            </>
          )}

          {filtered.length === 0 && refs.length > 0 && (
            <div style={{ fontSize: 12, color: "#444", fontStyle: "italic", padding: "16px 0", textAlign: "center" }}>
              אין תמונות בלוקיישן זה
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
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
              <div style={{ fontSize: 12, color: "#555" }}>מעלה{progress > 0 ? ` ${progress}%` : "..."} ⏳</div>
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

      {/* Lightbox — uses filtered array so arrows navigate within filter */}
      {lightboxIndex !== null && filtered.length > 0 && (
        <Lightbox
          images={filtered}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDelete={handleLightboxDelete}
          onNavigate={setLightboxIndex}
          onTagChange={handleTagChange}
        />
      )}
    </div>
  );
}
