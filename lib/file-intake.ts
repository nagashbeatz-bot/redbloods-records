// ── Steven intake: pure file identification + target-naming rules ──────────────
// No Dropbox / network here — just classification from path + file name, so it
// can be reasoned about and changed safely. Used by /api/dropbox/intake.

export type IntakeCategory =
  | "מאסטר"
  | "גרסת הופעה"
  | "אקפלה"
  | "אינסטרומנטל"
  | "ערוצים"
  | "אחר";

export interface IntakeEntry {
  /** Full Dropbox path of the source file (in our account). */
  path: string;
  /** Original file name (with extension). */
  name: string;
  size?: number;
}

export interface IntakeItem extends IntakeEntry {
  category:    IntakeCategory;
  stemType?:   string;       // sub-type label for ערוצים (e.g. "Lead Vocal")
  targetName:  string;       // clean destination file name
  targetDir:   string;       // sub-folder under 05_Delivery ("" = root, "ערוצים" = stems)
  targetLabel: string;       // friendly label for the preview/files tab
}

const UPPER = (s: string) => s.toUpperCase();

function extOf(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "wav";
}

/** True when the file lives under a Stems/STEMS/Stem folder anywhere in its path. */
function isInStems(relPath: string): boolean {
  return /(^|\/)stems?(\/|$)/i.test(relPath);
}

/** Uppercase + separators (_ - .) → spaces, so \b word boundaries work. */
const norm = (s: string) => UPPER(s).replace(/[._\-]+/g, " ");

/** Detect a stem sub-type from the file name. Returns label + UPPER_SNAKE key. */
function detectStem(name: string): { label: string; key: string } {
  const n = norm(name);
  if (/\bLEAD[\s_-]*VOCAL/.test(n))        return { label: "Lead Vocal",        key: "LEAD_VOCAL" };
  if (/\bLEAD[\s_-]*INSTRUMENTAL/.test(n)) return { label: "Lead Instrumental", key: "LEAD_INSTRUMENTAL" };
  if (/\bHI[\s_-]*PERC/.test(n))           return { label: "Hi Perc",           key: "HI_PERC" };
  if (/\bLO[\s_-]*PERC/.test(n))           return { label: "Lo Perc",           key: "LO_PERC" };
  if (/\bHORN/.test(n))                    return { label: "Horn",              key: "HORN" };
  if (/\bSTRINGS?\b/.test(n))              return { label: "Strings",           key: "STRINGS" };
  if (/\bSOUND[\s_-]*EFX|\bSFX\b/.test(n)) return { label: "Sound EFX",         key: "SFX" };
  return { label: "ערוץ - לא מסווג", key: "UNCLASSIFIED" };
}

/** Classify a single file by its name + relative path (relative to the scanned root). */
export function classify(name: string, relPath: string): { category: IntakeCategory; stemType?: string; stemKey?: string } {
  if (isInStems(relPath)) {
    const stem = detectStem(name);
    return { category: "ערוצים", stemType: stem.label, stemKey: stem.key };
  }
  const n = norm(name);
  if (/ACAPELLA|A CAPELLA/.test(n))                  return { category: "אקפלה" };
  if (/INSTRUMENTAL|\bINST\b/.test(n))               return { category: "אינסטרומנטל" };
  if (/FINAL ?MIX|\bMASTER\b/.test(n))               return { category: "מאסטר" };
  if (/\bLIVE\b|\bSHOW\b|PERFORMANCE|הופעה/.test(n)) return { category: "גרסת הופעה" };
  return { category: "אחר" };
}

/** Split "Bass Stem_BUNNY.wav" → { base: "Bass Stem_BUNNY", ext: ".wav" }. */
function stripExt(name: string): { base: string; ext: string } {
  const m = name.match(/^(.*?)(\.[a-z0-9]+)$/i);
  return m ? { base: m[1], ext: m[2] } : { base: name, ext: "" };
}

// Tokens we never strip as a "repeated tag" — they're meaningful stem descriptors.
const KEEP_TOKENS = new Set(["STEM", "STEMS", "WAV", "AIFF", "MP3", "FLAC"]);

/** Trailing tag = last alnum token preceded by a separator: "Bass Stem_BUNNY" → {sep:"_", token:"BUNNY"}. */
function trailingTag(base: string): { sep: string; token: string } | null {
  const m = base.match(/([ _\-]+)([A-Za-z0-9]+)\s*$/);
  return m ? { sep: m[1], token: m[2] } : null;
}

/**
 * Steven usually appends the project name to every stem (Bass Stem_BUNNY,
 * Drum Stem_BUNNY, …). Detect a token that repeats as the trailing tag across
 * the majority of stem files and return a stripper that removes it. Iterates so
 * double tags ("_BUNNY_MIX5") are both removed. Meaningful words (STEM…) are
 * never stripped, so "Bass Stem_BUNNY" → "Bass Stem" (not "Bass").
 */
function makeStemTagStripper(bases: string[]): (base: string) => string {
  let strip = (s: string) => s.trim();
  for (let pass = 0; pass < 3; pass++) {
    const cur = bases.map((b) => strip(b));
    const freq = new Map<string, number>();
    for (const b of cur) {
      const t = trailingTag(b);
      if (!t) continue;
      const key = t.token.toUpperCase();
      if (KEEP_TOKENS.has(key)) continue;
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    let best = "", bestN = 0;
    for (const [k, n] of freq) if (n > bestN) { best = k; bestN = n; }
    // Require a real majority (≥60% and ≥2 files) before treating it as a tag.
    if (bestN < 2 || bestN < Math.ceil(cur.length * 0.6)) break;
    const prev = strip;
    strip = (s: string) => {
      const p = prev(s);
      const t = trailingTag(p);
      if (t && t.token.toUpperCase() === best) return p.slice(0, p.length - t.sep.length - t.token.length).trim();
      return p;
    };
  }
  return strip;
}

/** Clean a stem's destination name: keep the (de-tagged) original, path-safe. */
function stemTargetName(base: string, ext: string): string {
  const clean = base.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  return (clean || "Stem") + ext;
}

function sanitizeProjectName(projectName: string): string {
  return (projectName || "PROJECT")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60) || "PROJECT";
}

/** Base destination name (without dedup suffix) for a classified file. */
function baseTargetName(projectName: string, name: string, category: IntakeCategory, stemKey: string | undefined): string {
  const p   = sanitizeProjectName(projectName);
  const ext = extOf(name);
  switch (category) {
    case "מאסטר":       return `${p}_MASTER.${ext}`;
    case "גרסת הופעה":  return `${p}_LIVE_VERSION.${ext}`;
    case "אקפלה":       return `${p}_ACAPELLA.${ext}`;
    case "אינסטרומנטל": return `${p}_INSTRUMENTAL.${ext}`;
    case "ערוצים":      return `${p}_STEM_${stemKey || "UNCLASSIFIED"}.${ext}`;
    default: {
      // "אחר" — keep the original name, lightly sanitized.
      const clean = name.replace(/[\\/:*?"<>|]/g, "").trim();
      return clean || `${p}_OTHER.${ext}`;
    }
  }
}

/** Insert a numeric suffix before the extension: name.wav → name_2.wav */
function withSuffix(fileName: string, n: number): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return `${fileName}_${n}`;
  return `${fileName.slice(0, dot)}_${n}${fileName.slice(dot)}`;
}

const CATEGORY_LABEL: Record<IntakeCategory, string> = {
  "מאסטר": "מאסטר", "גרסת הופעה": "גרסת הופעה", "אקפלה": "אקפלה",
  "אינסטרומנטל": "אינסטרומנטל", "ערוצים": "ערוצים", "אחר": "אחר",
};

/**
 * Build the full preview: classify every entry, compute deduped target names,
 * and a friendly label. `rootPath` is the scanned folder path (lowercased) so
 * we can derive each file's path relative to it for the Stems check.
 */
export function buildIntake(entries: IntakeEntry[], projectName: string, rootPath: string): IntakeItem[] {
  const root = (rootPath || "").toLowerCase().replace(/\/+$/, "");

  // First pass: classify everything (needed before we can detect the repeated
  // stem tag across the whole set of stem files).
  const classified = entries.map((e) => {
    const rel = e.path.toLowerCase().startsWith(root) ? e.path.slice(root.length) : e.path;
    return { e, ...classify(e.name, rel) };
  });

  const stemBases = classified.filter((c) => c.category === "ערוצים").map((c) => stripExt(c.e.name).base);
  const stripTag = makeStemTagStripper(stemBases);

  // Dedup is per target directory: a stem "Master.wav" in ערוצים never collides
  // with a root "Master.wav".
  const used = new Set<string>();
  return classified.map(({ e, category, stemType, stemKey }) => {
    const targetDir = category === "ערוצים" ? "ערוצים" : "";

    let target: string;
    if (category === "ערוצים") {
      const { base, ext } = stripExt(e.name);
      target = stemTargetName(stripTag(base), ext);
    } else {
      target = baseTargetName(projectName, e.name, category, stemKey);
    }

    const key = (n: string) => `${targetDir}|${n.toLowerCase()}`;
    if (used.has(key(target))) {
      let i = 2;
      while (used.has(key(withSuffix(target, i)))) i++;
      target = withSuffix(target, i);
    }
    used.add(key(target));

    const targetLabel = category === "ערוצים"
      ? (stemType ? `ערוצים · ${stemType}` : "ערוצים")
      : CATEGORY_LABEL[category];

    return { ...e, category, stemType, targetName: target, targetDir, targetLabel };
  });
}
