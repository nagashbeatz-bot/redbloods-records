/**
 * READ-ONLY audit — does NOT modify anything.
 *
 * Compares, per project:
 *   • primaryArtist  — first non-empty name from project.artist (split , ، ;)
 *   • folderArtist   — the segment right after "/Projects/" in files[].dropboxPath
 *
 * Performs ONLY a single SELECT on `projects`. No writes, no Dropbox API calls,
 * no folder moves/renames/deletes. Credentials are read from .env.local and are
 * never printed.
 *
 * Run:
 *   node --import tsx scripts/audit-project-dropbox-folders.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local (values are used but never logged) ──────────────────────────
const envText = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
const env: Record<string, string> = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const SUPABASE_URL = env.SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Same split rule as upsertArtistsFromProject.
function primaryArtist(raw: string): string {
  return (raw || "").split(/[,،;]/).map(s => s.trim()).filter(Boolean)[0] ?? "";
}

// Same folder sanitization as app/api/dropbox/upload/route.ts (sanitizeFolder).
function sanitizeFolder(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim();
}

// folderArtist = segment right after "/Projects/" in a dropboxPath.
function folderArtistFromPath(p?: string): string | null {
  if (!p) return null;
  const m = p.match(/\/Projects\/([^/]+)\//);
  return m ? m[1] : null;
}

type FileLink = { dropboxPath?: string };
type Row = { id: string; name: string; artist: string; files: FileLink[] | null };

async function main() {
  // READ-ONLY single SELECT.
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, artist, files")
    .order("name", { ascending: true });

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];

  // ── Diagnostic: understand the actual stored path structure (read-only) ──
  let withFiles = 0, withPath = 0;
  const samplePaths: string[] = [];
  for (const r of rows) {
    const files = Array.isArray(r.files) ? r.files : [];
    if (files.length > 0) withFiles++;
    const fwp = files.find(f => f?.dropboxPath);
    if (fwp?.dropboxPath) {
      withPath++;
      if (samplePaths.length < 10) samplePaths.push(`${r.name}: ${fwp.dropboxPath}`);
    }
  }
  // Categorize EVERY file path by scheme.
  let schemeProjects = 0, schemeUuid = 0, schemeOther = 0, totalFiles = 0;
  const projectsScheme: string[] = [];
  for (const r of rows) {
    const files = Array.isArray(r.files) ? r.files : [];
    for (const f of files) {
      if (!f?.dropboxPath) continue;
      totalFiles++;
      if (/^\/Projects\//i.test(f.dropboxPath)) { schemeProjects++; if (!projectsScheme.includes(r.name)) projectsScheme.push(r.name); }
      else if (/^\/[0-9a-f-]{36}\//i.test(f.dropboxPath)) schemeUuid++;
      else schemeOther++;
    }
  }

  console.log("\n==== Diagnostic (read-only) ====");
  console.log(`projects with ≥1 file:               ${withFiles}/${rows.length}`);
  console.log(`projects with ≥1 file w/ dropboxPath: ${withPath}/${rows.length}`);
  console.log(`total files with dropboxPath:        ${totalFiles}`);
  console.log(`  • scheme "/Projects/{artist}/{name}/": ${schemeProjects} files`);
  console.log(`  • scheme "/{projectId}/":              ${schemeUuid} files`);
  console.log(`  • other:                               ${schemeOther} files`);
  console.log(`projects that have ANY /Projects/ file: ${projectsScheme.length}${projectsScheme.length ? " (" + projectsScheme.join(", ") + ")" : ""}`);
  console.log("\nsample dropboxPaths (up to 10):");
  samplePaths.forEach(s => console.log(`  • ${s}`));

  let match = 0, mismatch = 0, none = 0;
  const problems: Array<{
    id: string; name: string; artist: string; primaryArtist: string;
    folderArtist: string; path: string; recommendation: string;
  }> = [];

  for (const r of rows) {
    const pa       = primaryArtist(r.artist || "");
    const paFolder = sanitizeFolder(pa);
    const files    = Array.isArray(r.files) ? r.files : [];
    const firstWithPath = files.find(f => f?.dropboxPath);
    const fa       = folderArtistFromPath(firstWithPath?.dropboxPath);

    if (!fa) {
      none++;
    } else if (fa === paFolder) {
      match++;
    } else {
      mismatch++;
      problems.push({
        id: r.id, name: r.name, artist: r.artist, primaryArtist: pa,
        folderArtist: fa, path: firstWithPath!.dropboxPath!,
        recommendation: `בעתיד rename → /Projects/${paFolder}/...`,
      });
    }
  }

  console.log("\n==== Dropbox folder audit (READ-ONLY, no changes made) ====");
  console.log(`projects scanned:            ${rows.length}`);
  console.log(`✅ התאמה:                    ${match}`);
  console.log(`❌ אין התאמה:                ${mismatch}`);
  console.log(`➖ אין תיקייה / לא ידוע:     ${none}`);

  if (problems.length) {
    console.log("\n---- MISMATCHES ----");
    for (const p of problems) {
      console.log(`\n• ${p.name}   [${p.id}]`);
      console.log(`   project.artist: ${p.artist}`);
      console.log(`   primaryArtist:  ${p.primaryArtist}`);
      console.log(`   folderArtist:   ${p.folderArtist}`);
      console.log(`   currentPath:    ${p.path}`);
      console.log(`   → ${p.recommendation}`);
    }
  } else {
    console.log("\nאין mismatches 🎉");
  }
}

main();
