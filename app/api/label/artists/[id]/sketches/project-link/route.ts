import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { isLinkEnabledArtistName } from "@/lib/red-artists/portal-registry";
import { resolveLinkableProject, findProjectFileByPath } from "@/lib/red-artists/project-link";
import {
  matchSketchByTitle, linkProjectFileAsVersion, createSketchFromProjectFile, SketchError,
} from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

/**
 * Attach a file ALREADY uploaded through Projects to a portal artist's
 * "המוזיקה שלי", by REFERENCE — the bytes are never re-uploaded and never
 * copied (no files/copy_v2). One physical file at /Projects/…, two views.
 *
 *   GET  ?projectId=…                       → what the confirm dialog should offer
 *   POST { projectId, dropboxPath, … }      → write the manifest reference
 *
 * Owner-only (resolveOwnerPortalAccess) AND hard-scoped to the TWO link-enabled
 * portal artists (Avi Molla, Shalev Tasama). Nothing here is generic: any other
 * artist's id gets 403 before any work happens.
 *
 * TWO independent identity checks, both server-side:
 *   1. the artist resolved from the URL id must be link-enabled;
 *   2. the project's PRIMARY artist must be THAT SAME artist.
 * (2) is what makes cross-linking impossible — Avi's project can never land in
 * Shalev's manifest and vice versa. The target slug is taken from
 * `access.config` (the DB row for the id in the URL), never from the client.
 *
 * NOTE: this route never sends a push. The client calls the existing
 * .../sketches/{sketchId}/notify route afterwards, and ONLY after this one
 * returned ok — so a failed link can never produce a notification.
 */

const ID_RE = /^[0-9a-fA-F-]{36}$/;

/** Owner + "this portal is one of the two link-enabled artists" — resolved from
 *  the DB row, never from the client. */
async function gate(id: string) {
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return { ok: false as const, response: access.response };
  if (!isLinkEnabledArtistName(access.config.name)) {
    return { ok: false as const, response: NextResponse.json({ error: "פעולה זו אינה זמינה בפורטל הזה" }, { status: 403 }) };
  }
  return { ok: true as const, slug: access.config.slug, name: access.config.name };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const g = await gate(id);
  if (!g.ok) return g.response;

  const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
  try {
    // Not a link-enabled project, or a project belonging to the OTHER artist →
    // the caller must show nothing at all.
    const linkable = await resolveLinkableProject(projectId);
    if (!linkable || linkable.artistName !== g.name) {
      return NextResponse.json({ ok: true, isLinkable: false, isAviProject: false });
    }

    // Exact title match only (project name ↔ sketch title). 0 or >1 hits → the
    // caller falls back to an explicit choice; we never guess.
    const { match, ambiguous, sketches } = await matchSketchByTitle(g.slug, linkable.project.name);
    return NextResponse.json({
      ok: true,
      isLinkable: true,
      // Kept for backwards compatibility with any client still reading it.
      isAviProject: true,
      artistName: g.name,
      projectName: linkable.project.name,
      match, ambiguous, sketches,
    });
  } catch (err) {
    return errResponse(err);
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const g = await gate(id);
  if (!g.ok) return g.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      projectId?: unknown; dropboxPath?: unknown; sketchId?: unknown; newTitle?: unknown;
    };
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const dropboxPath = typeof body.dropboxPath === "string" ? body.dropboxPath : "";
    const sketchId = typeof body.sketchId === "string" ? body.sketchId : "";
    const newTitle = typeof body.newTitle === "string" ? body.newTitle : "";

    const linkable = await resolveLinkableProject(projectId);
    if (!linkable) {
      return NextResponse.json({ error: "הפרויקט אינו שייך לאמן עם פורטל" }, { status: 403 });
    }
    // THE isolation check: the project's own primary artist must be the artist
    // whose portal this route was called on. Derived from the DB on both sides.
    if (linkable.artistName !== g.name) {
      return NextResponse.json({ error: `הפרויקט אינו של ${g.name}` }, { status: 403 });
    }
    const project = linkable.project;

    // THE path check: the path must be a file this project already owns.
    // Everything stored in the manifest is taken from that record, never from
    // the request body — so no caller can point the library anywhere else.
    const file = findProjectFileByPath(project, dropboxPath);
    if (!file?.dropboxPath) {
      return NextResponse.json({ error: "הקובץ לא נמצא בפרויקט" }, { status: 404 });
    }

    const ref = {
      filePath: file.dropboxPath,
      fileName: file.name,
      projectId: project.id,
      ...(file.size ? { sizeBytes: file.size } : {}),
      ...(file.durationSeconds ? { durationSeconds: file.durationSeconds } : {}),
    };

    let sketch;
    if (sketchId) {
      if (!ID_RE.test(sketchId)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");
      sketch = await linkProjectFileAsVersion(g.slug, sketchId, ref);
    } else {
      // No target chosen → create a new sketch. Defaults to the project's name so
      // the next upload from the same project finds it by exact title.
      sketch = await createSketchFromProjectFile(g.slug, newTitle || project.name, ref);
    }

    return NextResponse.json({ ok: true, sketch });
  } catch (err) {
    return errResponse(err);
  }
}
