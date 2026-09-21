"use client";

// The ONE renderer of a project's cover ("תמונת נושא") — used by the project
// drawer, the dashboard/label release rows and the artist portals. It never
// fetches: the caller passes the project's `cover` config (already delivered with
// the data the screen loads), so a list of covers costs zero extra requests.
//
// Layout is fixed and identical everywhere: background (theme, or the custom
// image with a soft scrim) + the project name centred on top. Below
// COVER_COMPACT_BELOW px (list thumbnails) the name would be illegible, so the
// cover keeps its background and shows only the initial (none over a photo) —
// the full name always sits next to a thumbnail in the row anyway.

import { useState, type CSSProperties } from "react";
import {
  COVER_COMPACT_BELOW, coverImageUrl, coverInitial, coverTitleScale, getCoverTheme,
  type ProjectCoverConfig,
} from "@/lib/project-cover";

interface Props {
  projectId: string;
  name: string;
  /** The project's cover config; null/undefined → default Redbloods theme. */
  cover?: ProjectCoverConfig | null;
  /** Edge length in px (desktop). */
  size: number;
  /** Optional smaller edge on phones (≤640px). */
  mobileSize?: number;
  /** Artist portals: the portal's apiBase, so the image comes from the read-only,
   *  release-scoped route instead of the owner route. */
  imageBase?: string;
  /** Explicit image URL override (modal preview of a not-yet-saved upload). `null`
   *  forces the plain theme. Leave undefined to derive it from `cover`. */
  imageSrc?: string | null;
  /** Makes the whole cover clickable (opens the cover editor). */
  onClick?: () => void;
  style?: CSSProperties;
}

const RADIUS = "max(6px, calc(var(--pc-cur) * 0.11))";

export default function ProjectCover({ projectId, name, cover, size, mobileSize, imageBase, imageSrc, onClick, style }: Props) {
  const theme = getCoverTheme(cover);
  const src = imageSrc !== undefined ? imageSrc : coverImageUrl(projectId, cover, imageBase);
  // If the image can't load, fall back to the plain theme — never a broken image.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;
  const compact = Math.min(size, mobileSize ?? size) < COVER_COMPACT_BELOW;
  const label = (name || "").trim();

  const vars = { "--pc-size": `${size}px`, "--pc-size-m": `${mobileSize ?? size}px` } as CSSProperties;

  const box = (
    <div
      className="rb-pc"
      role="img"
      aria-label={`תמונת נושא: ${label}`}
      style={{
        ...vars,
        position: "relative", overflow: "hidden", flexShrink: 0, boxSizing: "border-box",
        borderRadius: RADIUS,
        background: theme.bg,
        border: `${compact ? 1 : 2}px solid ${theme.accent}${compact ? "55" : "6B"}`,
        boxShadow: compact
          ? "0 1px 6px rgba(0,0,0,0.45), inset 0 0 14px rgba(0,0,0,0.4)"
          : `0 0 60px ${theme.accent}33, 0 0 24px ${theme.accent}1F, 0 4px 32px rgba(0,0,0,0.75), inset 0 0 44px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)`,
        ...(onClick ? null : style),
      }}
    >
      {theme.overlay && !showImage && (
        <div aria-hidden style={{ position: "absolute", inset: 0, background: theme.overlay, pointerEvents: "none" }} />
      )}

      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!} alt="" draggable={false} decoding="async" loading="lazy"
          onError={() => setFailedSrc(src)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}

      {/* Readability scrim — only over a custom image, and only when a title is drawn. */}
      {showImage && !compact && (
        <div aria-hidden style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 72%), linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.42) 55%, rgba(0,0,0,0.68) 100%)",
        }} />
      )}

      {!compact && !showImage && (
        <div aria-hidden style={{
          position: "absolute", top: 0, left: 0, width: "48%", height: "48%", pointerEvents: "none",
          background: "radial-gradient(circle at 0 0, rgba(255,255,255,0.09) 0%, transparent 65%)",
        }} />
      )}

      {compact ? (
        !showImage && (
          <span aria-hidden style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "calc(var(--pc-cur) * 0.44)", fontWeight: 900, lineHeight: 1, color: theme.accent,
            textShadow: `0 0 14px ${theme.accent}77`, userSelect: "none",
          }}>{coverInitial(label)}</span>
        )
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "9%", boxSizing: "border-box" }}>
          <div
            dir="auto"
            style={{
              width: "100%", textAlign: "center", color: theme.ink, fontWeight: 900,
              fontSize: `calc(var(--pc-cur) * ${(coverTitleScale(label) / 100).toFixed(4)})`,
              lineHeight: 1.08, letterSpacing: "-0.01em",
              overflowWrap: "anywhere", textWrap: "balance",
              display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 4, overflow: "hidden",
              textShadow: showImage
                ? "0 2px 14px rgba(0,0,0,0.8), 0 0 3px rgba(0,0,0,0.6)"
                : `0 0 30px ${theme.accent}88, 0 2px 8px rgba(0,0,0,0.5)`,
              userSelect: "none",
            }}
          >{label}</div>
        </div>
      )}
    </div>
  );

  if (!onClick) return box;

  return (
    <button
      type="button" className="rb-pc-btn" onClick={onClick}
      title="עיצוב תמונת נושא" aria-label="עיצוב תמונת נושא"
      style={{ ...vars, borderRadius: RADIUS, ...style }}
    >
      {box}
      {!compact && (
        <span className="rb-pc-hint" style={{ borderRadius: "inherit" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
          עיצוב תמונת נושא
        </span>
      )}
    </button>
  );
}
