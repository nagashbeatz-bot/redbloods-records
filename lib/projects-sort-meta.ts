import "server-only";
import { supabase } from "@/lib/supabase";
import type { Project } from "@/lib/types";

/**
 * Sort-only metadata for the Projects list (components/projects/ProjectsDesignPreview).
 *
 * READ-ONLY by design: a few extra selects, no writes, no new column, no
 * migration. Everything here is derived from data the app already stores.
 *
 * ── lastAssetAt ──────────────────────────────────────────────────────────────
 * "When did a FILE or VERSION last land in this project" — deliberately NOT
 * projects.updated_at, which also moves on a status change, a deadline edit or
 * a note. No single column answers it, so it is the max of the four places an
 * upload is actually dated:
 *
 *   1. mix_versions.created_at — Steven's mix versions (project_id is on the row;
 *      already the canonical "a new mix landed" signal, see steven-mix-reminder-pure).
 *   2. final_files.created_at  — the separate Final Files delivery flow.
 *   3. settings."share_token_*".value.createdAt — written by commitFileToProject
 *      for EVERY project-file upload and keyed by the file's Dropbox path. This
 *      is the only per-file stamp ordinary uploads have, because projects.files
 *      entries carry no timestamp of their own.
 *   4. files[].uploadedAt when present — no project file carries it today, so it
 *      contributes nothing now; it is read anyway so the value is used
 *      automatically if project files ever start being stamped at write time.
 *
 * A project with none of those keeps `lastAssetAt = null`; the list sorts those
 * last inside their group rather than pretending they were freshly updated.
 *
 * ── isLabelArtist ────────────────────────────────────────────────────────────
 * True for a project by an artist on the canonical label_artists roster.
 * projects.artist is free text that may hold several names split by /[,،;]/ (the
 * same split used across the app — see ClientDrawer / ArtistPortalPage), so ANY
 * exact token match counts, which catches collaborations too. Full-name match
 * only, never a substring. project_business_type is NOT used: every project in
 * the table is "לקוח" today, so it identifies nobody.
 *
 * Both fields are hints. Any failure here degrades the ORDER of the list, never
 * the list itself — the callers still get their projects.
 */

/** House normalization for a free-text artist name: trim + collapse spaces, case-insensitive. */
const normName = (s: string | null | undefined): string =>
  (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** projects.artist → its individual artist names (the app-wide /[,،;]/ split). */
const artistTokens = (artist: string | null | undefined): string[] =>
  (artist ?? "").split(/[,،;]/).map(normName).filter(Boolean);

/** Attach `lastAssetAt` + `isLabelArtist` to every project. Never throws. */
export async function attachProjectSortMeta(projects: Project[]): Promise<Project[]> {
  if (projects.length === 0) return projects;
  try {
    const [lastAsset, roster] = await Promise.all([
      buildLastAssetMap(projects),
      buildLabelArtistNames(),
    ]);
    return projects.map((p) => ({
      ...p,
      lastAssetAt:   lastAsset.get(p.id) ?? null,
      isLabelArtist: artistTokens(p.artist).some((t) => roster.has(t)),
    }));
  } catch {
    // Ordering hints only — a project list without them is still a correct list.
    return projects;
  }
}

/** project id → ISO time of its most recent file/version upload. */
async function buildLastAssetMap(projects: Project[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = projects.map((p) => p.id);

  const keep = (id: string | null | undefined, ts: string | null | undefined) => {
    if (!id || !ts) return;
    const t = Date.parse(ts);
    if (isNaN(t)) return;
    const cur = map.get(id);
    if (!cur || t > Date.parse(cur)) map.set(id, ts);
  };

  // (4) Already on the row — no query needed.
  projects.forEach((p) => (p.files ?? []).forEach((f) => keep(p.id, f.uploadedAt)));

  const [versions, finals, byPath] = await Promise.all([
    supabase.from("mix_versions").select("project_id, created_at").in("project_id", ids),
    supabase.from("final_files").select("project_id, created_at").in("project_id", ids),
    buildShareTokenTimes(),
  ]);

  // (1) + (2) — a failed select just means those uploads are not counted.
  (versions.data ?? []).forEach((r) => {
    const row = r as { project_id: string | null; created_at: string | null };
    keep(row.project_id, row.created_at);
  });
  (finals.data ?? []).forEach((r) => {
    const row = r as { project_id: string | null; created_at: string | null };
    keep(row.project_id, row.created_at);
  });

  // (3) Share tokens are keyed by Dropbox path. The path is resolved to the
  // project that OWNS that exact path in its own files[] — never by parsing the
  // project id out of the path string.
  projects.forEach((p) =>
    (p.files ?? []).forEach((f) => {
      if (f.dropboxPath) keep(p.id, byPath.get(f.dropboxPath));
    })
  );

  return map;
}

/** Dropbox path → newest share-token createdAt, i.e. when that file was committed. */
async function buildShareTokenTimes(): Promise<Map<string, string>> {
  const byPath = new Map<string, string>();

  // Paged so a growing settings table can never silently truncate to the first
  // page (PostgREST caps a plain select). Ordered by key so pages are stable.
  const PAGE = 1000;
  const MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await supabase
      .from("settings")
      .select("value")
      .like("key", "share_token_%")
      .order("key", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;

    for (const r of data) {
      const v = (r as { value: { dropboxPath?: string; createdAt?: string } | null }).value;
      if (!v?.dropboxPath || !v.createdAt) continue;
      const t = Date.parse(v.createdAt);
      if (isNaN(t)) continue;
      const cur = byPath.get(v.dropboxPath);
      if (!cur || t > Date.parse(cur)) byPath.set(v.dropboxPath, v.createdAt);
    }

    if (data.length < PAGE) break;
  }
  return byPath;
}

/** The label_artists roster as normalized names. Selected directly (not via
 *  listLabelArtists) so a roster read failure can be swallowed here instead of
 *  throwing out of the projects list, and so only `name` crosses the wire. */
async function buildLabelArtistNames(): Promise<Set<string>> {
  const { data } = await supabase.from("label_artists").select("name");
  return new Set(
    (data ?? []).map((r) => normName((r as { name: string | null }).name)).filter(Boolean)
  );
}
