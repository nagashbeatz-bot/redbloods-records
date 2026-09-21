import "server-only";
import { NextResponse } from "next/server";
import { supabase } from "./supabase";
import {
  COVER_SETTINGS_PREFIX, DEFAULT_COVER_THEME, coverDropboxPath, coverSettingsKey, isSafeProjectId, looksLikeJpeg, normalizeCover,
  type CoverThemeId, type ProjectCoverConfig,
} from "./project-cover";

/**
 * Project Cover store. ONE source of truth per project:
 *   settings.key   = project_cover_{projectId}
 *   settings.value = { theme, customImage, updatedAt }        (no row = default cover)
 * A custom image (when customImage=true) is a single JPEG in Dropbox at a fixed,
 * projectId-derived path — outside the project folder, so a rename / intake scan /
 * "files" tab never sees it. No DB change, no Supabase Storage.
 */

export const MAX_COVER_BYTES = 3 * 1024 * 1024; // client sends ~1200px JPEG (~200-400KB)

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getProjectCover(projectId: string): Promise<ProjectCoverConfig | null> {
  const { data } = await supabase.from("settings").select("value").eq("key", coverSettingsKey(projectId)).maybeSingle();
  return normalizeCover(data?.value);
}

/**
 * Covers for many projects in ONE query (never per-row → no N+1). Only projects that
 * have a stored config are in the map; a missing entry means "default cover".
 * Read failures degrade to an empty map — a cover problem must never break a list.
 */
export async function getProjectCovers(projectIds?: string[]): Promise<Map<string, ProjectCoverConfig>> {
  const out = new Map<string, ProjectCoverConfig>();
  try {
    let q = supabase.from("settings").select("key,value");
    if (projectIds) {
      if (projectIds.length === 0) return out;
      q = q.in("key", projectIds.map(coverSettingsKey));
    } else {
      q = q.like("key", `${COVER_SETTINGS_PREFIX}%`);
    }
    const { data, error } = await q;
    if (error) { console.error("[project-cover] bulk read:", error.message); return out; }
    for (const row of data ?? []) {
      const key = String(row.key);
      if (!key.startsWith(COVER_SETTINGS_PREFIX)) continue;
      const cfg = normalizeCover(row.value);
      if (cfg) out.set(key.slice(COVER_SETTINGS_PREFIX.length), cfg);
    }
  } catch (e) {
    console.error("[project-cover] bulk read failed:", e);
  }
  return out;
}

/** Adds `cover` (only when one is stored) to rows keyed by `idOf(row)`. Additive. */
export async function attachCovers<T extends { cover?: ProjectCoverConfig | null }>(
  rows: T[], idOf: (row: T) => string, onlyIds?: string[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const covers = await getProjectCovers(onlyIds);
  if (covers.size === 0) return rows;
  return rows.map((r) => {
    const c = covers.get(idOf(r));
    return c ? { ...r, cover: c } : r;
  });
}

// ── Dropbox helpers (mirrors lib/victor-avatar's route usage) ─────────────────────

async function dropboxToken(): Promise<string> {
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  return getDropboxToken();
}

async function deleteCoverFile(projectId: string): Promise<void> {
  try {
    const token = await dropboxToken();
    await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: coverDropboxPath(projectId) }),
    });
  } catch { /* best-effort — a missing/undeletable file never fails the caller */ }
}

// ── Writes (owner routes only) ───────────────────────────────────────────────

async function writeConfig(projectId: string, cfg: ProjectCoverConfig): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ key: coverSettingsKey(projectId), value: cfg as unknown as Record<string, unknown> }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/** Pick a theme. Any previous custom image is dropped (theme replaces it). */
export async function saveThemeCover(projectId: string, theme: CoverThemeId): Promise<ProjectCoverConfig> {
  const prev = await getProjectCover(projectId);
  const cfg: ProjectCoverConfig = { theme, customImage: false, updatedAt: new Date().toISOString() };
  await writeConfig(projectId, cfg);
  if (prev?.customImage) await deleteCoverFile(projectId);
  return cfg;
}

/** Upload a custom image (JPEG bytes). The theme is kept as the fallback background. */
export async function saveImageCover(projectId: string, bytes: Buffer): Promise<ProjectCoverConfig> {
  if (!looksLikeJpeg(bytes)) throw new Error("not a jpeg");
  if (bytes.length > MAX_COVER_BYTES) throw new Error("too large");

  const token = await dropboxToken();
  const up = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path: coverDropboxPath(projectId), mode: "overwrite", mute: true }),
    },
    body: new Uint8Array(bytes),
  });
  if (!up.ok) throw new Error(`dropbox upload failed: ${await up.text().catch(() => up.status)}`);

  const prev = await getProjectCover(projectId);
  const cfg: ProjectCoverConfig = { theme: prev?.theme ?? DEFAULT_COVER_THEME, customImage: true, updatedAt: new Date().toISOString() };
  await writeConfig(projectId, cfg);
  return cfg;
}

/** "חזור לברירת מחדל": no row at all → default cover; custom image removed best-effort. */
export async function resetProjectCover(projectId: string): Promise<void> {
  const prev = await getProjectCover(projectId);
  const { error } = await supabase.from("settings").delete().eq("key", coverSettingsKey(projectId));
  if (error) throw new Error(error.message);
  if (prev?.customImage) await deleteCoverFile(projectId);
}

/** Project deletion hook. NEVER throws — cover cleanup must not block deleting a project. */
export async function cleanupProjectCover(projectId: string): Promise<void> {
  try {
    const prev = await getProjectCover(projectId);
    await supabase.from("settings").delete().eq("key", coverSettingsKey(projectId));
    if (prev?.customImage) await deleteCoverFile(projectId);
  } catch (e) {
    console.error("[project-cover] cleanup failed (non-fatal):", e);
  }
}

// ── Image serving ────────────────────────────────────────────────────────────

/**
 * 302 to a short-lived Dropbox link for the project's custom cover (404 when the
 * cover is a plain theme). The caller MUST have already authorised access to this
 * projectId — this function does no auth of its own.
 */
export async function coverImageResponse(projectId: string): Promise<NextResponse> {
  if (!isSafeProjectId(projectId)) return NextResponse.json({ error: "invalid project" }, { status: 400 });
  const cfg = await getProjectCover(projectId);
  if (!cfg?.customImage) return NextResponse.json({ error: "no custom cover" }, { status: 404 });
  try {
    const token = await dropboxToken();
    const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: coverDropboxPath(projectId) }),
    });
    if (!res.ok) { console.error("[project-cover/image]", await res.text().catch(() => "")); return NextResponse.json({ error: "link failed" }, { status: 502 }); }
    const { link } = (await res.json()) as { link: string };
    const redirect = NextResponse.redirect(link, 302);
    // The URL carries ?v=updatedAt, so a replaced image is a new URL — safe to cache.
    redirect.headers.set("Cache-Control", "private, max-age=1800");
    return redirect;
  } catch (e) {
    console.error("[project-cover/image]", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

// ── Artist-portal scoping ────────────────────────────────────────────────────

/**
 * True iff `projectId` is a release of this label artist. The read-only portal
 * routes call this AFTER resolving who the artist is, so a portal can only ever
 * read the cover of a project that is in that artist's own releases.
 */
export async function artistHasProjectRelease(labelArtistId: string, projectId: string): Promise<boolean> {
  if (!labelArtistId || !isSafeProjectId(projectId)) return false;
  const { data, error } = await supabase
    .from("project_release_details")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("label_artist_id", labelArtistId)
    .maybeSingle();
  if (error) { console.error("[project-cover] scope check:", error.message); return false; }
  return !!data;
}
