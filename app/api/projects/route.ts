import { NextRequest, NextResponse } from "next/server";
import { listProjects } from "@/lib/projects-store";
import { createClientProject } from "@/lib/writes/projects";
import { attachProjectSortMeta } from "@/lib/projects-sort-meta";
import { attachCovers } from "@/lib/project-cover-store";
import { requireOwner } from "@/lib/require-auth";

// GET /api/projects           — visible projects only (default)
// GET /api/projects?hidden=1  — hidden projects only
// GET /api/projects?all=1     — all projects (visible + hidden)
export async function GET(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const hidden = req.nextUrl.searchParams.get("hidden");
    const all    = req.nextUrl.searchParams.get("all");
    const filter = all === "1" ? null : hidden === "1" ? true : undefined;
    // Read-only ordering hints for the Projects list (lastAssetAt / isLabelArtist).
    // Additive: the project rows themselves are untouched.
    const projects = await attachProjectSortMeta(await listProjects(filter));
    // Project Cover config (one bulk settings read; a project with no row = default cover).
    return NextResponse.json(await attachCovers(projects, (p) => p.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[projects GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/projects — create a new project
export async function POST(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const body = await req.json();
    const { name, artist, status, deadline, notes, projectType, parentProject } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "שם הפרויקט חסר" }, { status: 400 });
    }

    // Projects created from the generic Projects UI / proposals are client work (label releases: /api/label/projects).
    // Shared writer (lib/writes/projects) — the same one Sunny's CREATE_PROJECT primitive uses.
    const project = await createClientProject({ name, artist, status, deadline, notes, projectType, parentProject });

    return NextResponse.json({ ok: true, id: project.id, project });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[projects POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
