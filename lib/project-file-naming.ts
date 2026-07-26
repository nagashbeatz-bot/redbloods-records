/**
 * Canonical project-file naming — the SAME logic the manual "Upload version"
 * button on the project page uses (components/ui/UploadButton.tsx), extracted
 * here so server-side code (e.g. auto-duplicating a Steven full-mix upload
 * into the project player) can reuse it byte-for-byte instead of inventing a
 * parallel naming scheme. Deliberately has NO "server-only"/Supabase import so
 * it stays importable from BOTH a "use client" component and server code.
 */

export const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aiff", ".aif"];

/**
 * Build the versioned display name for a new project file.
 * type = explicit override (delivery uploads) else derived from project status
 * ("מאסטר" for במיקס/הושלם, else "סקיצה"). version = count of existing files
 * already labeled with this exact type, +1.
 */
export function buildVersionName(
  artist: string,
  projectName: string,
  existingFiles: { name: string }[],
  ext: string,
  status?: string,
  typeOverride?: string,
): string {
  const type = typeOverride ?? ((status === "במיקס" || status === "הושלם") ? "מאסטר" : "סקיצה");
  const version = existingFiles.filter((f) =>
    (typeOverride ? true : AUDIO_EXTS.some((x) => f.name.toLowerCase().endsWith(x))) &&
    f.name.includes(` - ${type} V`)
  ).length + 1;
  const sanitize = (s: string) => s.replace(/[/\\:*?"<>|]/g, "").trim();
  return `${sanitize(artist)} - ${sanitize(projectName)} - ${type} V${version}.${ext}`;
}
