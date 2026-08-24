import "server-only";
import { isPathWithinArtist } from "@/lib/red-artists/portal-files";
import type { Sketch, SketchVersion } from "@/lib/red-artists/sketches-store";

/**
 * Resolve "which file does this sketch version point at" for the id-based
 * stream / download routes, and decide whether serving it is allowed.
 *
 * Two legitimate homes for a version's bytes:
 *   1. the artist's OWN tree, /app/red-artists/{slug}/…  — every normal upload;
 *      validated with the existing isPathWithinArtist guard, unchanged.
 *   2. a PROJECT-LINKED version (source="project"), whose bytes stay where the
 *      Projects upload put them under /Projects/…  — one physical file shared by
 *      both views.
 *
 * Case 2 is accepted only because the path came out of the manifest, and the
 * ONLY writer that can put such an entry there is the owner-gated
 * .../sketches/project-link route, which first proves the path is a file the
 * project already owns. The client never supplies a path to these routes, so
 * isPathWithinArtist stays exactly as strict as it is for the `?path=` routes —
 * no IDOR surface is opened.
 */

export type ResolvedSketchFile =
  | { ok: true; path: string; fileName: string; version: SketchVersion }
  | { ok: false; status: number; error: string };

/** Project uploads always land under this Dropbox root (lib/project-paths.ts). */
const PROJECTS_ROOT = "/Projects/";

export function resolveSketchVersionPath(slug: string, sketch: Sketch, vRaw: string | null): ResolvedSketchFile {
  const wanted = vRaw != null && vRaw !== "" ? Number(vRaw) : sketch.latestVersion;
  if (!Number.isFinite(wanted)) {
    return { ok: false, status: 400, error: "מספר גרסה לא תקין" };
  }

  const version = sketch.versions.find((v) => v.versionNumber === wanted);
  if (!version?.filePath) {
    return { ok: false, status: 404, error: "הגרסה לא נמצאה" };
  }

  const path = version.filePath;
  if (path.includes("..")) return { ok: false, status: 403, error: "forbidden" };

  const allowed = version.source === "project"
    ? path.startsWith(PROJECTS_ROOT)          // manifest-vouched project file
    : isPathWithinArtist(slug, path);         // the artist's own tree — unchanged guard
  if (!allowed) return { ok: false, status: 403, error: "forbidden" };

  return { ok: true, path, fileName: version.fileName || path.split("/").pop() || "audio", version };
}
