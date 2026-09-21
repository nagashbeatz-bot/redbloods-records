// Project Cover ("תמונת נושא") — pure, client-safe definitions.
//
// The cover belongs to the PROJECT and has ONE source of truth: the settings row
// `project_cover_{projectId}` (see lib/project-cover-store.ts). Every screen that
// shows a project's cover renders components/ui/ProjectCover.tsx from that same
// config — there is no per-screen / per-artist / per-release copy.
//
// This is an internal look-and-feel image, NOT the official distribution artwork.
// Nothing here is (or may be) wired to Mobile One / release delivery.

export type CoverThemeId =
  | "redbloods" | "black" | "darkred" | "nightblue" | "cinematic"
  | "urban" | "dancehall" | "romantic" | "minimal";

/** What is stored in settings.project_cover_{projectId}. No URL is ever stored —
 *  Dropbox temp links expire; the image URL is derived from projectId + updatedAt. */
export interface ProjectCoverConfig {
  theme: CoverThemeId;
  /** true → a custom JPEG exists in Dropbox and is the background (theme = fallback). */
  customImage: boolean;
  updatedAt: string | null;
}

export const DEFAULT_COVER_THEME: CoverThemeId = "redbloods";
export const COVER_SETTINGS_PREFIX = "project_cover_";
export const coverSettingsKey = (projectId: string) => `${COVER_SETTINGS_PREFIX}${projectId}`;

/** Fired on window after a cover is saved/reset, so already-open screens can reload. */
export const COVER_CHANGED_EVENT = "rb:project-cover-changed";

export interface CoverTheme {
  id: CoverThemeId;
  label: string;
  /** Base background (CSS `background`). */
  bg: string;
  /** Optional pattern layer drawn above bg (still CSS only). */
  overlay?: string;
  /** Border / glow / initial colour. */
  accent: string;
  /** Title colour. */
  ink: string;
}

// One system, nine moods: every theme is a dark base + a single restrained accent
// glow, drawn with the same border / gloss / inset-shadow recipe in ProjectCover.
// Only the palette (and, for two of them, a hairline pattern) changes.
export const COVER_THEMES: readonly CoverTheme[] = [
  {
    id: "redbloods", label: "Redbloods", accent: "#DC2626", ink: "#FFFFFF",
    bg: "radial-gradient(ellipse at 25% 25%, rgba(220,38,38,0.30) 0%, transparent 55%), radial-gradient(ellipse at 75% 80%, rgba(139,0,0,0.18) 0%, transparent 50%), linear-gradient(145deg, #2E0A0A 0%, #1A0404 40%, #0C0202 75%, #060101 100%)",
  },
  {
    id: "black", label: "שחור נקי", accent: "#8A8A93", ink: "#F4F4F4",
    bg: "radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.08) 0%, transparent 55%), linear-gradient(150deg, #1B1B1F 0%, #0C0C0E 55%, #050506 100%)",
  },
  {
    id: "darkred", label: "אדום כהה", accent: "#B91C1C", ink: "#FFF1F1",
    bg: "radial-gradient(ellipse at 70% 15%, rgba(248,113,113,0.20) 0%, transparent 55%), linear-gradient(160deg, #5C0F14 0%, #32080B 45%, #150304 100%)",
  },
  {
    id: "nightblue", label: "כחול לילה", accent: "#3B82F6", ink: "#EEF4FF",
    bg: "radial-gradient(ellipse at 25% 20%, rgba(59,130,246,0.28) 0%, transparent 55%), linear-gradient(155deg, #0E2247 0%, #081430 50%, #040A1A 100%)",
  },
  {
    id: "cinematic", label: "קולנועי", accent: "#D98A3D", ink: "#FFF6EA",
    bg: "radial-gradient(ellipse at 50% 105%, rgba(217,138,61,0.30) 0%, transparent 60%), linear-gradient(180deg, #0F2A31 0%, #0D171B 52%, #1E1209 100%)",
    // Letterbox bars — the one cinematic cue.
    overlay: "linear-gradient(180deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.9) 11%, transparent 11%, transparent 89%, rgba(0,0,0,0.9) 89%, rgba(0,0,0,0.9) 100%)",
  },
  {
    id: "urban", label: "אורבני", accent: "#C79A3B", ink: "#F7F2E8",
    bg: "radial-gradient(ellipse at 80% 10%, rgba(199,154,59,0.16) 0%, transparent 50%), linear-gradient(150deg, #29292D 0%, #141416 55%, #09090A 100%)",
    overlay: "repeating-linear-gradient(135deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 11px)",
  },
  {
    id: "dancehall", label: "דאנסהול", accent: "#D4A017", ink: "#FFF9E6",
    // Same structure as "darkred": one highlight top-right, a base gradient that stays green
    // corner to corner (no near-black end), and a soft gold glow centred at the bottom — so
    // the colour is spread evenly across the whole square, not pooled on one side.
    bg: "radial-gradient(ellipse at 50% 108%, rgba(212,160,23,0.20) 0%, transparent 58%), radial-gradient(ellipse at 72% 14%, rgba(74,180,116,0.17) 0%, transparent 58%), linear-gradient(160deg, #164A2D 0%, #0E2F1B 52%, #071A0E 100%)",
  },
  {
    id: "romantic", label: "רומנטי", accent: "#E879A6", ink: "#FFF0F6",
    bg: "radial-gradient(ellipse at 30% 20%, rgba(232,121,166,0.24) 0%, transparent 55%), linear-gradient(155deg, #421632 0%, #240D1C 52%, #100610 100%)",
  },
  {
    id: "minimal", label: "מינימלי", accent: "#6B7280", ink: "#F4F4F4",
    bg: "linear-gradient(160deg, #18181B 0%, #101012 100%)",
    overlay: "linear-gradient(180deg, transparent 0%, transparent 82%, rgba(255,255,255,0.05) 82%, rgba(255,255,255,0.05) 82.6%, transparent 82.6%)",
  },
];

const THEME_BY_ID = new Map<CoverThemeId, CoverTheme>(COVER_THEMES.map((t) => [t.id, t]));

export function isCoverThemeId(v: unknown): v is CoverThemeId {
  return typeof v === "string" && THEME_BY_ID.has(v as CoverThemeId);
}

/** Validates a raw settings value. null = no (usable) config → the default cover. */
export function normalizeCover(raw: unknown): ProjectCoverConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    theme: isCoverThemeId(r.theme) ? r.theme : DEFAULT_COVER_THEME,
    customImage: r.customImage === true,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

export function getCoverTheme(cover: ProjectCoverConfig | null | undefined): CoverTheme {
  return THEME_BY_ID.get(cover?.theme ?? DEFAULT_COVER_THEME) ?? THEME_BY_ID.get(DEFAULT_COVER_THEME)!;
}

/**
 * URL of the custom image, or null when the cover is a plain theme.
 *  • owner screens      → the owner route
 *  • artist portals     → pass `portalBase` (the portal's apiBase) so the request goes
 *                         to the read-only, release-scoped route instead.
 * `v` busts the browser cache when the image is replaced.
 */
export function coverImageUrl(projectId: string, cover: ProjectCoverConfig | null | undefined, portalBase?: string): string | null {
  if (!cover?.customImage) return null;
  const v = encodeURIComponent(cover.updatedAt ?? "");
  const id = encodeURIComponent(projectId);
  return portalBase
    ? `${portalBase}/project-cover?projectId=${id}&v=${v}`
    : `/api/projects/${id}/cover/image?v=${v}`;
}

const graphemes = (s: string): string[] => Array.from(s);

// ── Title typography ─────────────────────────────────────────────────────────
// ONE design at every size: the project name, centred, semibold, with generous
// padding. Only the font-size changes with the cover's edge, and it is decided by
// simulating the line-wrap (never by a fixed table), so a name always fits in at
// most MAX_LINES lines and no word is ever cut when it can be avoided.

/** Inner text width as a fraction of the cover's edge (the rest is breathing room). */
export const COVER_TEXT_WIDTH = 0.76;
export const COVER_TITLE_MAX_LINES = 3;
/** Smallest font (px) we ever draw — below this a name is unreadable anyway. */
export const COVER_MIN_FONT_PX = 6;

/** Average glyph advance in em (semibold), by script/case. Slightly generous on purpose. */
function glyphEm(ch: string): number {
  if (/\s/.test(ch)) return 0.27;
  if (/[A-Z]/.test(ch)) return 0.7;
  if (/[a-z0-9]/.test(ch)) return 0.57;
  if (/[֐-׿]/.test(ch)) return 0.55;
  return 0.62;
}
const wordEm = (w: string): number => graphemes(w).reduce((n, ch) => n + glyphEm(ch), 0);

/** Greedy word-wrap simulation → line count and the widest single word (both in em). */
function wrapMetrics(words: string[], maxEm: number): { lines: number; widest: number } {
  let lines = 1, cur = 0, widest = 0;
  for (const w of words) {
    const wEm = wordEm(w);
    widest = Math.max(widest, wEm);
    if (cur === 0) cur = wEm;
    else if (cur + 0.27 + wEm <= maxEm) cur += 0.27 + wEm;
    else { lines++; cur = wEm; }
  }
  return { lines, widest };
}

/**
 * Font size for `name` on a cover whose edge is `edgePx`.
 *  • the PREFERRED size shrinks with name length (short → a touch larger) and is a
 *    little larger, relatively, on small covers so a 46–60px thumbnail stays legible;
 *  • it is then stepped down until the wrapped name fits ≤ 3 lines with every word
 *    on one line;
 *  • never below COVER_MIN_FONT_PX. A name too long even for that keeps the minimum
 *    and may use more lines — `clamp` is how many the box can actually show, so the
 *    name is wrapped, never cut with an ellipsis, while it fits the cover's height.
 * `fits` = the normal case (≤ 3 lines, no cut word).
 */
export function coverTitleLayout(name: string, edgePx: number): { fontPx: number; lines: number; clamp: number; fits: boolean } {
  const text = (name || "").trim();
  const edge = Math.max(24, edgePx);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { fontPx: Math.max(COVER_MIN_FONT_PX, edge * 0.11), lines: 1, clamp: COVER_TITLE_MAX_LINES, fits: true };

  const total = graphemes(text).length;
  const basePct = total <= 6 ? 13 : total <= 12 ? 11.5 : total <= 20 ? 10 : total <= 32 ? 8.5 : 7.5;
  const smallBoost = Math.pow(192 / edge, 0.25);          // 1.0 at 192px, ≈1.34 at 60px, ≈1.43 at 46px
  const preferred = Math.min(edge * 0.2, (edge * basePct * smallBoost) / 100);

  const maxWidth = edge * COVER_TEXT_WIDTH;
  const tryFont = (fs: number) => {
    const { lines, widest } = wrapMetrics(words, maxWidth / fs);
    return lines <= COVER_TITLE_MAX_LINES && widest * fs <= maxWidth ? lines : null;
  };
  const step = Math.max(0.25, preferred * 0.03);
  for (let fs = preferred; fs > COVER_MIN_FONT_PX; fs -= step) {
    const lines = tryFont(fs);
    if (lines !== null) return { fontPx: Number(fs.toFixed(2)), lines, clamp: COVER_TITLE_MAX_LINES, fits: true };
  }
  const atMin = tryFont(COVER_MIN_FONT_PX);
  if (atMin !== null) return { fontPx: COVER_MIN_FONT_PX, lines: atMin, clamp: COVER_TITLE_MAX_LINES, fits: true };
  const { lines } = wrapMetrics(words, maxWidth / COVER_MIN_FONT_PX);
  const byHeight = Math.max(COVER_TITLE_MAX_LINES, Math.floor((edge * COVER_TEXT_WIDTH) / (COVER_MIN_FONT_PX * 1.2)));
  return { fontPx: COVER_MIN_FONT_PX, lines, clamp: Math.min(lines, byHeight), fits: false };
}

// ── Storage-shape guards (pure, so they are unit-testable; used by the store/routes) ──

const COVERS_DIR = "/Project Covers";
// projectId ends up in a Dropbox path, so only ever accept a plain id token.
const SAFE_ID = /^[A-Za-z0-9_-]{6,64}$/;
export const isSafeProjectId = (id: unknown): id is string => typeof id === "string" && SAFE_ID.test(id);

/** Server-constant Dropbox path for a project's custom cover (always JPEG). */
export function coverDropboxPath(projectId: string): string {
  if (!isSafeProjectId(projectId)) throw new Error("invalid project id");
  return `${COVERS_DIR}/${projectId}.jpg`;
}

/** JPEG magic bytes — the server never stores arbitrary content as a cover. */
export function looksLikeJpeg(buf: Uint8Array): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}
