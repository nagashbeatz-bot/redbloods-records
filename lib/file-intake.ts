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
  const used = new Set<string>();
  return entries.map((e) => {
    const rel = e.path.toLowerCase().startsWith(root) ? e.path.slice(root.length) : e.path;
    const { category, stemType, stemKey } = classify(e.name, rel);

    let target = baseTargetName(projectName, e.name, category, stemKey);
    if (used.has(target.toLowerCase())) {
      let i = 2;
      while (used.has(withSuffix(target, i).toLowerCase())) i++;
      target = withSuffix(target, i);
    }
    used.add(target.toLowerCase());

    const targetLabel = category === "ערוצים"
      ? `ערוצים · ${stemType}`
      : CATEGORY_LABEL[category];

    return { ...e, category, stemType, targetName: target, targetLabel };
  });
}
