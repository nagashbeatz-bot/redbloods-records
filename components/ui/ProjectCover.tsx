"use client";

// The ONE renderer of a project's cover ("תמונת נושא") — used by the project
// drawer, the dashboard/label release rows and the artist portals. It never
// fetches: the caller passes the project's `cover` config (already delivered with
// the data the screen loads), so a list of covers costs zero extra requests.
//
// One identity at every size: background (theme, or the custom image under a soft
// scrim) + the project NAME, centred. There is no "compact" variant and no initial —
// only the font-size changes with the cover's edge (lib/project-cover.ts
// coverTitleLayout: preferred size by length, stepped down until the wrapped name
// fits ≤ 3 lines with no word cut). Size and phone size are CSS variables so the
// same markup serves both without a second implementation.

import { useState, type CSSProperties } from "react";
import { coverImageUrl, coverTitleLayout, getCoverTheme, type ProjectCoverConfig } from "@/lib/project-cover";

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
/** Hover "edit" hint only where it can be read. */
const HINT_MIN_PX = 120;

export default function ProjectCover({ projectId, name, cover, size, mobileSize, imageBase, imageSrc, onClick, style }: Props) {
  const theme = getCoverTheme(cover);
  const src = imageSrc !== undefined ? imageSrc : coverImageUrl(projectId, cover, imageBase);
  // If the image can't load, fall back to the plain theme — never a broken image.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;
  const label = (name || "").trim();

  const mSize = mobileSize ?? size;
  const desk = coverTitleLayout(label, size);
  const mob = mSize === size ? desk : coverTitleLayout(label, mSize);
  const vars = {
    "--pc-size": `${size}px`, "--pc-size-m": `${mSize}px`,
    "--pc-fs": `${desk.fontPx}px`, "--pc-fs-m": `${mob.fontPx}px`,
  } as CSSProperties;

  // Frame weight scales with the cover (a hairline on thumbnails, a fuller frame on heroes).
  const large = Math.min(size, mSize) >= HINT_MIN_PX;
  // Semibold on large covers; a touch heavier on thumbnails so small type stays crisp.
  const weight = size >= 100 ? 600 : 700;

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
        border: `${large ? 2 : 1}px solid ${theme.accent}${large ? "6B" : "55"}`,
        boxShadow: large
          ? `0 0 60px ${theme.accent}33, 0 0 24px ${theme.accent}1F, 0 4px 32px rgba(0,0,0,0.75), inset 0 0 44px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)`
          : "0 1px 6px rgba(0,0,0,0.45), inset 0 0 14px rgba(0,0,0,0.4)",
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

      {/* Readability scrim — only over a custom image; soft, so the picture stays the hero. */}
      {showImage && (
        <div aria-hidden style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0) 74%), linear-gradient(180deg, rgba(0,0,0,0.14) 0%, rgba(0,0,0,0.34) 55%, rgba(0,0,0,0.58) 100%)",
        }} />
      )}

      {!showImage && (
        <div aria-hidden style={{
          position: "absolute", top: 0, left: 0, width: "48%", height: "48%", pointerEvents: "none",
          background: "radial-gradient(circle at 0 0, rgba(255,255,255,0.08) 0%, transparent 65%)",
        }} />
      )}

      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "12%", boxSizing: "border-box" }}>
        <div
          dir="auto"
          style={{
            width: "100%", textAlign: "center", color: theme.ink, fontWeight: weight,
            fontSize: "var(--pc-fs-cur)", lineHeight: 1.2, letterSpacing: "0.005em",
            overflowWrap: "anywhere", textWrap: "balance",
            display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: Math.max(desk.clamp, mob.clamp), overflow: "hidden",
            textShadow: showImage
              ? "0 1px calc(var(--pc-cur) * 0.06) rgba(0,0,0,0.75), 0 0 2px rgba(0,0,0,0.5)"
              : `0 1px calc(var(--pc-cur) * 0.05) rgba(0,0,0,0.55), 0 0 calc(var(--pc-cur) * 0.12) ${theme.accent}40`,
            userSelect: "none",
          }}
        >{label}</div>
      </div>
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
      {large && (
        <span className="rb-pc-hint" style={{ borderRadius: "inherit" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
          עיצוב תמונת נושא
        </span>
      )}
    </button>
  );
}
