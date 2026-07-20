"use client";

import { useState, useEffect, useCallback, type CSSProperties } from "react";

// ── Types ─────────────────────────────────────────────────────────────────

interface RefLink {
  id:            string;
  production_id: string;
  url:           string;
  provider:      string;
  video_id:      string;
  title:         string;
  thumbnail_url: string;
  notes:         string;
  created_at:    string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  if (!url.trim()) return null;
  try {
    const u = new URL(url.trim());
    // https://www.youtube.com/watch?v=ID
    if (u.hostname.includes("youtube.com") && u.searchParams.get("v")) {
      return u.searchParams.get("v");
    }
    // https://youtu.be/ID
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1).split("?")[0] || null;
    }
    // https://www.youtube.com/shorts/ID
    // https://www.youtube.com/embed/ID
    const m = u.pathname.match(/\/(shorts|embed|v)\/([^/?&]+)/);
    if (m) return m[2];
  } catch {
    // bare video_id (11 chars)
    const m = url.trim().match(/^[a-zA-Z0-9_-]{11}$/);
    if (m) return url.trim();
  }
  return null;
}

// ── Styles ────────────────────────────────────────────────────────────────

const INPUT_S: CSSProperties = {
  background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6,
  color: "#E8E8E8", fontSize: 13, padding: "6px 10px", outline: "none",
  fontFamily: "inherit", height: 32, boxSizing: "border-box", flex: 1,
};

// ── Component ─────────────────────────────────────────────────────────────

export default function RedFilmsYouTubeRefs({ productionId }: { productionId: string }) {
  const [links,     setLinks]     = useState<RefLink[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [inputUrl,  setInputUrl]  = useState("");
  const [inputTitle,setInputTitle]= useState("");
  const [adding,    setAdding]    = useState(false);
  const [addErr,    setAddErr]    = useState<string | null>(null);
  const [activeId,  setActiveId]  = useState<string | null>(null); // video_id of open player
  const [deleting,  setDeleting]  = useState<Set<string>>(new Set());

  // ── Load ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/red-films/productions/${productionId}/reference-links`);
      const data = await res.json().catch(() => ({}));
      setLinks(data.links ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [productionId]);

  useEffect(() => { load(); }, [load]);

  // ── Add ──
  async function handleAdd() {
    const vid = extractVideoId(inputUrl);
    if (!vid) { setAddErr("לינק לא תקין — ודא שזה YouTube"); return; }
    setAdding(true); setAddErr(null);
    try {
      const res  = await fetch(`/api/red-films/productions/${productionId}/reference-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url:           inputUrl.trim(),
          video_id:      vid,
          title:         inputTitle.trim(),
          thumbnail_url: `https://img.youtube.com/vi/${vid}/hqdefault.jpg`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setLinks(prev => [...prev, data.link]);
      setInputUrl(""); setInputTitle("");
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : "שגיאה");
      setTimeout(() => setAddErr(null), 4000);
    } finally { setAdding(false); }
  }

  // ── Delete ──
  async function handleDelete(id: string) {
    setDeleting(prev => new Set(prev).add(id));
    try {
      await fetch(`/api/red-films/reference-links/${id}`, { method: "DELETE" });
      setLinks(prev => prev.filter(l => l.id !== id));
      if (activeId === links.find(l => l.id === id)?.video_id) setActiveId(null);
    } finally {
      setDeleting(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  // ── Render ──
  return (
    <div style={{ position: "relative", background: "linear-gradient(180deg, rgba(24,16,17,0.72), rgba(15,12,13,0.82))", border: "1px solid rgba(220,38,38,0.12)", borderRadius: 18, padding: "18px 20px", boxShadow: "0 14px 44px rgba(0,0,0,0.42), 0 0 14px rgba(220,38,38,0.04)", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 10 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, fontWeight: 700, color: "#EDEDF2", margin: 0 }}>
          <span style={{ width: 3, height: 15, borderRadius: 2, background: "linear-gradient(180deg, #DC2626, #7F1D1D)", boxShadow: "0 0 8px rgba(220,38,38,0.4)", flexShrink: 0 }} />
          🎬 רפרנסים מיוטיוב
        </h2>
        {links.length > 0 && (
          <span style={{ fontSize: 11, color: "#444" }}>{links.length} סרטונים</span>
        )}
      </div>

      {/* Input row */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={INPUT_S}
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            placeholder="הדבק לינק YouTube..."
            disabled={adding}
          />
          <button
            onClick={handleAdd}
            disabled={adding || !inputUrl.trim()}
            style={{
              flexShrink: 0, padding: "0 16px", height: 32, borderRadius: 6,
              background: adding || !inputUrl.trim() ? "#1E1E1E" : "#DC2626",
              border: "none", color: adding || !inputUrl.trim() ? "#444" : "#FFF",
              fontSize: 13, fontWeight: 700, cursor: adding || !inputUrl.trim() ? "default" : "pointer",
              fontFamily: "inherit", transition: "background 0.15s",
            }}
          >
            {adding ? "..." : "+ הוסף"}
          </button>
        </div>
        <input
          style={{ ...INPUT_S, flex: "unset", width: "100%", boxSizing: "border-box" }}
          value={inputTitle}
          onChange={e => setInputTitle(e.target.value)}
          placeholder="שם / תיאור (אופציונלי)"
          disabled={adding}
        />
        {addErr && (
          <div style={{ fontSize: 12, color: "#F87171" }}>{addErr}</div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ fontSize: 13, color: "#444", padding: "12px 0" }}>טוען...</div>
      ) : links.length === 0 ? (
        <div style={{ fontSize: 13, color: "#333", fontStyle: "italic", padding: "12px 0" }}>
          אין רפרנסים עדיין — הדבק לינק למעלה
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {links.map(link => {
            const isActive = activeId === link.video_id;
            const isDeleting = deleting.has(link.id);

            return (
              <div
                key={link.id}
                style={{
                  background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.12)",
                  borderRadius: 11, overflow: "hidden",
                  opacity: isDeleting ? 0.5 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                {/* Card row */}
                <div style={{ display: "flex", gap: 14, padding: "12px 14px", alignItems: "center" }}>
                  {/* Thumbnail */}
                  <div
                    onClick={() => !isDeleting && setActiveId(isActive ? null : link.video_id)}
                    style={{
                      flexShrink: 0, width: 108, height: 61, borderRadius: 8,
                      background: "#0D0D0D", overflow: "hidden", cursor: "pointer",
                      position: "relative",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={link.thumbnail_url || `https://img.youtube.com/vi/${link.video_id}/hqdefault.jpg`}
                      alt={link.title || link.video_id}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    {/* Play overlay */}
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: isActive ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.3)",
                      transition: "background 0.15s",
                    }}>
                      <span style={{ fontSize: 20, lineHeight: 1 }}>{isActive ? "⏹" : "▶"}</span>
                    </div>
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13.5, fontWeight: 700, color: "#E6E6EA",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {link.title || link.video_id}
                    </div>
                    <div style={{
                      fontSize: 11, color: "#78787F", marginTop: 3,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {link.url}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => !isDeleting && setActiveId(isActive ? null : link.video_id)}
                      title={isActive ? "סגור" : "נגן"}
                      style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 12,
                        background: isActive ? "rgba(220,38,38,0.15)" : "none",
                        border: `1px solid ${isActive ? "rgba(220,38,38,0.4)" : "#333"}`,
                        color: isActive ? "#FCA5A5" : "#888",
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      {isActive ? "⏹ סגור" : "▶ נגן"}
                    </button>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="פתח ביוטיוב"
                      style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 12,
                        background: "none", border: "1px solid #333",
                        color: "#888", textDecoration: "none",
                        display: "inline-flex", alignItems: "center",
                      }}
                    >
                      🔗
                    </a>
                    <button
                      onClick={() => handleDelete(link.id)}
                      disabled={isDeleting}
                      title="הסר"
                      style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 12,
                        background: "none", border: "1px solid #333",
                        color: "#555", cursor: isDeleting ? "default" : "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Embedded player — only rendered when active */}
                {isActive && (
                  <div style={{ padding: "0 12px 12px" }}>
                    <div style={{
                      position: "relative", width: "100%", paddingTop: "56.25%",
                      borderRadius: 8, overflow: "hidden", background: "#000",
                    }}>
                      <iframe
                        src={`https://www.youtube.com/embed/${link.video_id}?autoplay=1&rel=0`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        style={{
                          position: "absolute", inset: 0,
                          width: "100%", height: "100%",
                          border: "none",
                        }}
                        title={link.title || link.video_id}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
