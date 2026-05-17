import { NextRequest, NextResponse } from "next/server";
import { listProjects, createProject } from "@/lib/projects-store";
import { upsertArtistsFromProject } from "@/lib/clients-store";

// GET /api/projects — list all projects
export async function GET() {
  try {
    const projects = await listProjects();
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
