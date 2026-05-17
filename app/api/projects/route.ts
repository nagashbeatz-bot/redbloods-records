import { NextRequest, NextResponse } from "next/server";
import { listProjects, createProject } from "@/lib/projects-store";
import { upsertArtistsFromProject } from "@/lib/clients-store";

// GET /api/projects           — visible projects only (default)
// GET /api/projects?hidden=1  — hidden projects only
// GET /api/projects?all=1     — all projects (visible + hidden)
export async function GET(req: NextRequest) {
  try {
    const hidden = req.nextUrl.searchParams.get("hidden");
    const all    = req.nextUrl.searchParams.get("all");
    const filter = all === "1" ? null : hidden === "1" ? true : undefined;
    const projects = await listProjects(filter);
    return NextResponse.json(projects);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[projects GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/projects — create a new project
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, artist, status, deadline, notes, projectType, parentProject } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "שם הפרויקט חסר" }, { status: 400 });
    }

    const project = await createProject({
      name:           name.trim(),
      artist:         artist?.trim()        || "",
      status:         status                || "לא התחיל",
      deadline:       deadline              || null,
      notes:          notes?.trim()         || "",
      project_type:   projectType           || "",
      parent_project: parentProject         || "",
    });

    // Auto-create missing artists in clients table (fire-and-forget)
    if (artist?.trim()) {
      upsertArtistsFromProject(artist).catch(() => {});
    }

    return NextResponse.json({ ok: true, id: project.id, project });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[projects POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
