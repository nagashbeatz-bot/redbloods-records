import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { AVI_ARTIST_ID } from "@/lib/roles";
import { AVI_NAME } from "@/lib/red-artists/portal-registry";
import { resolveAviProject, findProjectFileByPath } from "@/lib/red-artists/avi-project-link";
import {
  matchSketchByTitle, linkProjectFileAsVersion, createSketchFromProjectFile, SketchError,
} from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

/**
 * Attach a file ALREADY uploaded through Projects to Avi's "המוזיקה שלי", by
 * REFERENCE — the bytes are never re-uploaded and never copied (no files/copy_v2).
 * One physical file at /Projects/…, rendered in both views.
 *
 *   GET  ?projectId=…                       → what the confirm dialog should offer
 *   POST { projectId, dropboxPath, … }      → write the manifest reference
 *
 * Owner-only (resolveOwnerPortalAccess) AND hard-scoped to Avi's artist id — the
 * exact same double gate the sibling notify route uses. Nothing here is generic:
 * another artist's id gets 403 before any work happens.
 *
 * NOTE: this route never sends a push. The client calls the existing
 * .../sketches/{sketchId}/notify route afterwards, and ONLY after this one
 * returned ok — so a failed link can never produce a notification.
 */

const ID_RE = /^[0-9a-fA-F-]{36}$/;

/** Owner + "this is Avi's portal" — resolved from the DB row, never from the client. */
async function gate(id: string) {
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return { ok: false as const, response: access.response };
  if (id !== AVI_ARTIST_ID || access.config.name !== AVI_NAME) {
    return { ok: false as const, response: NextResponse.json({ error: "פעולה זו זמינה רק בפורטל של אבי" }, { status: 403 }) };
  }
  return { ok: true as const, slug: access.config.slug };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const g = await gate(id);
  if (!g.ok) return g.response;

  const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
  try {
    // Not Avi's project → the caller must show nothing at all.
    const project = await resolveAviProject(projectId);
    if (!project) return NextResponse.json({ ok: true, isAviProject: false });

    // Exact title match only (project name ↔ sketch title). 0 or >1 hits → the
    // caller falls back to an explicit choice; we never guess.
    const { match, ambiguous, sketches } = await matchSketchByTitle(g.slug, project.name);
    return NextResponse.json({
      ok: true, isAviProject: true, projectName: project.name, match, ambiguous, sketches,
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

    const project = await resolveAviProject(projectId);
    if (!project) {
      return NextResponse.json({ error: "הפרויקט אינו של אבי מולה" }, { status: 403 });
    }

    // THE security check: the path must be a file this project already owns.
    // Everything stored in the manifest is taken from that record, never from
    // the request body — so no caller can point Avi's library anywhere else.
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
