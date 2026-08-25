import "server-only";
import { PORTAL_ARTISTS, isLinkEnabledArtistName } from "@/lib/red-artists/portal-registry";
import { primaryArtist } from "@/lib/project-paths";
import { getProject } from "@/lib/projects-store";
import { unlinkProjectFile, type UnlinkResult } from "@/lib/red-artists/sketches-store";
import type { FileLink, Project } from "@/lib/types";

/**
 * Glue between a Projects upload and a portal artist's "המוזיקה שלי" library.
 *
 * Scoped to EXACTLY TWO artists — Avi Molla and Shalev Tasama (the list lives in
 * portal-registry.ts as LINK_ENABLED_NAMES). Every entry point either sits
 * behind `resolveOwnerPortalAccess` + an `isLinkEnabledArtistName(config.name)`
 * check (the API routes) or calls `resolveLinkableProject()` here (the Projects
 * delete flow). Nothing generic is built for DJ CLEANTONE / future artists —
 * adding one later means widening that list on purpose, never by accident.
 *
 * Identification is EXACT, never fuzzy: `projects.artist` is free text and can
 * hold several comma-separated names, so we take the PRIMARY artist only (the
 * same `primaryArtist()` that already decides the project's Dropbox folder) and
 * compare it byte-for-byte with the registered portal name. A project where the
 * artist is a SECONDARY name is NOT theirs for this purpose.
 *
 * The resolved name → slug mapping is derived HERE, server-side, from the
 * project row — never from anything the client sent. That is what makes it
 * impossible to link Avi's project into Shalev's manifest (or vice versa): the
 * route additionally asserts `resolved.artistName === access.config.name`.
 */

/** EXACT primary-artist match against ANY link-enabled portal name. No fuzzy matching. */
export function isLinkEnabledArtistField(artist: string | null | undefined): boolean {
  return isLinkEnabledArtistName(primaryArtist(artist ?? ""));
}

/** A project whose PRIMARY artist is one of the two link-enabled portal artists,
 *  together with THAT artist's registered name + slug. Null for anyone else. */
export interface LinkableProject {
  project: Project;
  /** The exact label_artists.name / PORTAL_ARTISTS key — derived from the project row. */
  artistName: string;
  /** That artist's isolated manifest slug ("avi-molla" | "shalev-tasama"). */
  slug: string;
}

/** The project + its resolved portal artist, but only when its PRIMARY artist is
 *  link-enabled. Otherwise null. */
export async function resolveLinkableProject(projectId: string): Promise<LinkableProject | null> {
  if (!projectId) return null;
  const project = await getProject(projectId);
  if (!project) return null;
  const artistName = primaryArtist(project.artist ?? "");
  if (!isLinkEnabledArtistName(artistName)) return null;
  const slug = PORTAL_ARTISTS[artistName]?.slug;
  if (!slug) return null;                    // registry/list drift — refuse rather than guess
  return { project, artistName, slug };
}

/**
 * The project's OWN `files` entry at this exact Dropbox path, or null.
 *
 * This is the security hinge of the link route: the client may only ask to link
 * a path the project already owns, so it can never point an artist's manifest at
 * an arbitrary Dropbox file (another artist's tree, another project, a private
 * folder). The stored FileLink is also where the display name / size / duration
 * come from — the client never supplies those either.
 */
export function findProjectFileByPath(project: Project, dropboxPath: string): FileLink | null {
  if (!dropboxPath) return null;
  return (project.files ?? []).find((f) => f.dropboxPath === dropboxPath) ?? null;
}

/**
 * Drop any project-linked version pointing at `dropboxPath` from the manifest of
 * the project's OWN portal artist. Safe to call for ANY project: a project whose
 * primary artist is not link-enabled returns a no-op immediately, and when
 * nothing references the path the manifest is not written at all.
 *
 * The slug is resolved from the PROJECT, so a delete can only ever touch that
 * project's own artist — never the other one's library.
 *
 * Throws on a real Dropbox/manifest failure so the caller can ABORT the delete —
 * we must never destroy bytes a manifest still points at.
 */
export async function unlinkProjectPathFromArtist(
  projectId: string,
  dropboxPath: string,
): Promise<UnlinkResult & { artistName?: string }> {
  const linkable = await resolveLinkableProject(projectId);
  if (!linkable) return { removed: 0, sketchIds: [] };
  const res = await unlinkProjectFile(linkable.slug, dropboxPath);
  return { ...res, artistName: linkable.artistName };
}
