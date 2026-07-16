/**
 * Victor pages — inline SVG icon set.
 *
 * Replaces the OS emoji (🎵 ↗ 📅 🔄 📤 📥 ▶ ⏸ 🗑 ✎ …) that the Victor UI used
 * to render. Emoji are drawn by the platform font, so they came out multicolour
 * and inconsistent between iOS / Android / desktop; these are single-path vector
 * icons that inherit `currentColor` and share one stroke language.
 *
 * No icon library — the project has none, and adding one is out of scope. Same
 * conventions as the Red Films KPI icons: 24x24 viewBox, stroke=currentColor,
 * round caps/joins, and a default 1.75 stroke width that can be overridden.
 *
 * Sizing: pass `size` (px). Colour comes from the parent's `color`, so an icon
 * always matches the text it sits next to.
 *
 * NOT covered here (deliberately): the canonical status glyph in "הושלם ✓" /
 * "Completed ✓" — that ✓ is part of a lookup key / DB value, not decoration.
 */

import type { CSSProperties, SVGProps } from "react";

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

function svgProps({ size = 16, strokeWidth = 1.75, style, className }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: { flexShrink: 0, display: "inline-block", verticalAlign: "middle", ...style },
    className,
    "aria-hidden": true,
    focusable: false,
  };
}

/* ── Content / media ─────────────────────────────────────────────────────── */

/** 🎵 ♪ — music note */
export const IconMusic = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
);

/** ▶ — play */
export const IconPlay = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M7 4.5 19 12 7 19.5z" /></svg>
);

/** ⏸ — pause */
export const IconPause = (p: IconProps) => (
  <svg {...svgProps(p)}><rect x="7" y="4.5" width="3.6" height="15" rx="1" /><rect x="13.4" y="4.5" width="3.6" height="15" rx="1" /></svg>
);

/** ⏮ — previous track */
export const IconSkipBack = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M19 5.5v13L9.5 12z" /><path d="M5.5 5.5v13" /></svg>
);

/** ⏭ — next track */
export const IconSkipForward = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M5 5.5v13L14.5 12z" /><path d="M18.5 5.5v13" /></svg>
);

/** 🔊 — volume */
export const IconVolume = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M11 5 6.5 9H3v6h3.5L11 19z" /><path d="M15.5 9.2a4 4 0 0 1 0 5.6" /><path d="M18.4 6.4a8 8 0 0 1 0 11.2" /></svg>
);

/* ── Navigation / actions ────────────────────────────────────────────────── */

/** ↗ — open external / open project */
export const IconArrowUpRight = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>
);

/** ← → — back to list (chevron form) */
export const IconChevronLeft = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="m15 18-6-6 6-6" /></svg>
);
export const IconChevronRight = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="m9 18 6-6-6-6" /></svg>
);

/** ✕ — close */
export const IconX = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);

/** ✎ — edit */
export const IconPencil = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M16.8 3.2a2.4 2.4 0 0 1 3.4 3.4L7.6 19.2 3 21l1.8-4.6z" /><path d="m14.6 5.4 4 4" /></svg>
);

/** 🗑 — delete */
export const IconTrash = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M3.5 6h17" /><path d="M8.5 6V4.4a1.4 1.4 0 0 1 1.4-1.4h4.2a1.4 1.4 0 0 1 1.4 1.4V6" /><path d="M18.5 6v13.6a1.4 1.4 0 0 1-1.4 1.4H6.9a1.4 1.4 0 0 1-1.4-1.4V6" /><path d="M10 10.5v6M14 10.5v6" /></svg>
);

/** ✓ — plain check (progress step done) */
export const IconCheck = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="m4.5 12.5 5 5 10-11" /></svg>
);

/** ✅ — check in a circle (progress header) */
export const IconCheckCircle = (p: IconProps) => (
  <svg {...svgProps(p)}><circle cx="12" cy="12" r="9" /><path d="m8 12.3 2.6 2.6L16 9.4" /></svg>
);

/** 🚪 — sign out */
export const IconLogOut = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M9.5 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 16.5 4.5-4.5L16 7.5" /><path d="M20.5 12h-11" /></svg>
);

/* ── Status / meta ───────────────────────────────────────────────────────── */

/** 📅 — deadline / date */
export const IconCalendar = (p: IconProps) => (
  <svg {...svgProps(p)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
);

/** 🔄 — tracking / in progress */
export const IconRefresh = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9L3.5 15.6" /><path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9l2.4 2.3" /><path d="M20.5 4.5v4.4h-4.4" /><path d="M3.5 19.5v-4.4h4.4" /></svg>
);

/** 🎯 — monthly target */
export const IconTarget = (p: IconProps) => (
  <svg {...svgProps(p)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></svg>
);

/** ⚠️ — stuck / overdue */
export const IconAlert = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M10.3 3.9 2.4 17.7A1.9 1.9 0 0 0 4 20.6h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" /><path d="M12 9.5v4M12 17.2h.01" /></svg>
);

/** ★ — latest badge */
export const IconStar = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="m12 3.2 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6L3.2 9.6l6.1-.9z" /></svg>
);

/** 📌 — read me first / pinned */
export const IconPin = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M12 17v4.5" /><path d="M9 10.4V6.5h-.6a1.75 1.75 0 0 1 0-3.5h7.2a1.75 1.75 0 0 1 0 3.5H15v3.9c0 .8.4 1.4 1.1 1.8l1.6.9c.7.4 1.1 1 1.1 1.8v.6a.6.6 0 0 1-.6.5H5.8a.6.6 0 0 1-.6-.5v-.6c0-.8.4-1.4 1.1-1.8l1.6-.9c.7-.4 1.1-1 1.1-1.8z" /></svg>
);

/* ── Files ───────────────────────────────────────────────────────────────── */

/** 📄 — generic file */
export const IconFile = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M14.5 2.8H6.6a1.8 1.8 0 0 0-1.8 1.8v14.8a1.8 1.8 0 0 0 1.8 1.8h10.8a1.8 1.8 0 0 0 1.8-1.8V7.3z" /><path d="M14.2 2.8v4.8h5" /></svg>
);

/** 🗜 — archive / ZIP */
export const IconArchive = (p: IconProps) => (
  <svg {...svgProps(p)}><rect x="2.8" y="3.5" width="18.4" height="5" rx="1.4" /><path d="M4.8 8.5v11a1.5 1.5 0 0 0 1.5 1.5h11.4a1.5 1.5 0 0 0 1.5-1.5v-11" /><path d="M10.2 12.5h3.6" /></svg>
);

/** 📎 — attached brief files */
export const IconPaperclip = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M20.9 11.4 11.7 20.6a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
);

/** 🔗 — references / link */
export const IconLink = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M10.3 13.7a4.5 4.5 0 0 0 6.8.5l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.6" /><path d="M13.7 10.3a4.5 4.5 0 0 0-6.8-.5l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.6" /></svg>
);

/** ↑ / 📤 — upload / sent */
export const IconUpload = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M12 16.5V4" /><path d="m7 9 5-5 5 5" /><path d="M4 16.5v2.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" /></svg>
);

/** ↓ — download */
export const IconDownload = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M12 4v12.5" /><path d="m7 11.5 5 5 5-5" /><path d="M4 16.5v2.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" /></svg>
);

/** 📥 — received / inbox */
export const IconInbox = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M21.5 12.5h-5l-1.6 2.6H9.1L7.5 12.5h-5" /><path d="M5.9 5.1 2.5 12.5v5.4a1.9 1.9 0 0 0 1.9 1.9h15.2a1.9 1.9 0 0 0 1.9-1.9v-5.4l-3.4-7.4a1.9 1.9 0 0 0-1.7-1.1H7.6a1.9 1.9 0 0 0-1.7 1.1z" /></svg>
);

/** 📝 — feedback note */
export const IconNote = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M11 4.2H4.8A1.8 1.8 0 0 0 3 6v13.2A1.8 1.8 0 0 0 4.8 21H18a1.8 1.8 0 0 0 1.8-1.8V13" /><path d="M18.2 2.9a2 2 0 0 1 2.9 2.9L12.4 14.5l-3.8 1 1-3.8z" /></svg>
);

/** 📋 — empty projects list */
export const IconClipboard = (p: IconProps) => (
  <svg {...svgProps(p)}><rect x="8.5" y="2.5" width="7" height="4" rx="1.2" /><path d="M15.5 4.5h2A1.8 1.8 0 0 1 19.3 6.3v13.4a1.8 1.8 0 0 1-1.8 1.8H6.5a1.8 1.8 0 0 1-1.8-1.8V6.3A1.8 1.8 0 0 1 6.5 4.5h2" /></svg>
);

/** 🗂 — "Older files" group badge */
export const IconFolder = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M4.4 20h15.2a1.8 1.8 0 0 0 1.8-1.8V8.6a1.8 1.8 0 0 0-1.8-1.8h-7.1a1.8 1.8 0 0 1-1.5-.8L9.9 4.6a1.8 1.8 0 0 0-1.5-.8H4.4a1.8 1.8 0 0 0-1.8 1.8v12.6A1.8 1.8 0 0 0 4.4 20z" /></svg>
);

/** 📷 — avatar / camera */
export const IconCamera = (p: IconProps) => (
  <svg {...svgProps(p)}><path d="M14.6 4.2H9.4L7.2 7H4.3a1.8 1.8 0 0 0-1.8 1.8v9.4A1.8 1.8 0 0 0 4.3 20h15.4a1.8 1.8 0 0 0 1.8-1.8V8.8A1.8 1.8 0 0 0 19.7 7h-2.9z" /><circle cx="12" cy="13" r="3.4" /></svg>
);
