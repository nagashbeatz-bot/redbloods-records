import "server-only";
import { AVI_NAME, PORTAL_ARTISTS } from "@/lib/red-artists/portal-registry";
import { primaryArtist } from "@/lib/project-paths";
import { getProject } from "@/lib/projects-store";
import { unlinkProjectFile, type UnlinkResult } from "@/lib/red-artists/sketches-store";
import type { FileLink, Project } from "@/lib/types";

/**
 * Avi-Molla-ONLY glue between a Projects upload and his "המוזיקה שלי" library.
 *
 * The whole feature is deliberately scoped to one artist: every entry point
 * either sits behind an `id === AVI_ARTIST_ID` check (the API routes) or calls
 * `isAviProject()` here (the Projects delete flow). Nothing generic is built for
 * Shalev / DJ CLEANTONE / future artists — adding one later would mean widening
 * this file on purpose, never by accident.
 *
 * Identification is EXACT, never fuzzy: `projects.artist` is free text and can
 * hold several comma-separated names, so we take the PRIMARY artist only (the
 * same `primaryArtist()` that already decides the project's Dropbox folder) and
 * compare it byte-for-byte with the registered portal name. A project where Avi
 * is a secondary artist is NOT his for this purpose.
 */

/** Avi's isolated portal slug ("avi-molla") — drives his Dropbox subtree + manifest. */
export const AVI_SLUG = PORTAL_ARTISTS[AVI_NAME].slug;

/** EXACT primary-artist match against the registered portal name. No fuzzy matching. */
export function isAviArtistField(artist: string | null | undefined): boolean {
  return primaryArtist(artist ?? "") === AVI_NAME;
}

/** The project, but only when its PRIMARY artist is exactly Avi. Otherwise null. */
export async function resolveAviProject(projectId: string): Promise<Project | null> {
  if (!projectId) return null;
  const project = await getProject(projectId);
  if (!project || !isAviArtistField(project.artist)) return null;
  return project;
}

/**
 * The project's OWN `files` entry at this exact Dropbox path, or null.
 *
 * This is the security hinge of the link route: the client may only ask to link
 * a path the project already owns, so it can never point Avi's manifest at an
 * arbitrary Dropbox file (another artist's tree, another project, a private
 * folder). The stored FileLink is also where the display name / size / duration
 * come from — the client never supplies those either.
 */
export function findProjectFileByPath(project: Project, dropboxPath: string): FileLink | null {
  if (!dropboxPath) return null;
  return (project.files ?? []).find((f) => f.dropboxPath === dropboxPath) ?? null;
}

/**
 * Drop any project-linked version pointing at `dropboxPath` from Avi's manifest.
 * Safe to call for ANY project: non-Avi projects return a no-op immediately, and
 * when nothing references the path the manifest is not written at all.
 *
 * Throws on a real Dropbox/manifest failure so the caller can ABORT the delete —
 * we must never destroy bytes that Avi's manifest still points at.
 */
export async function unlinkProjectPathFromAvi(projectId: string, dropboxPath: string): Promise<UnlinkResult> {
  const project = await resolveAviProject(projectId);
  if (!project) return { removed: 0, sketchIds: [] };
  return unlinkProjectFile(AVI_SLUG, dropboxPath);
}
