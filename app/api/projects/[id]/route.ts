import { NextRequest, NextResponse } from "next/server";
import { updateProject, deleteProject } from "@/lib/projects-store";
import { upsertArtistsFromProject } from "@/lib/clients-store";
import type { UpdatableField } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/projects/[id]
// Body: { field: UpdatableField, value: string }  — single-field update (from table inline edit)
// Body: { name, artist, status, deadline, notes, projectType, parentProject } — full update
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    // Single-field update (from ProjectsProvider.updateProjectField)
    if ("field" in body && "value" in body) {
      const { field, value } = body as { field: UpdatableField; value: string };

      const fieldMap: Partial<Record<UpdatableField, string>> = {
        name:          "name",
        artist:        "artist",
        status:        "status",
        deadline:      "deadline",
        notes:         "notes",
        projectType:   "project_type",
        parentProject: "parent_project",
      };

      const col = fieldMap[field];
      if (!col) {
        return NextResponse.json({ error: `שדה לא מוכר: ${field}` }, { status: 400 });
      }

      await updateProject(id, { [col]: value || (field === "deadline" ? null : "") } as Parameters<typeof updateProject>[1]);

      // Sync new artists to clients table (fire-and-forget)
      if (field === "artist" && value?.trim()) {
        upsertArtistsFromProject(value).catch(() => {});
      }

      return NextResponse.json({ ok: true });
    }

    // Full update (from modal / drawer)
    const { name, artist, status, deadline, notes, projectType, parentProject } = body;
    if (name !== undefined && !name?.trim()) {
      return NextResponse.json({ error: "שם הפרויקט לא יכול להיות ריק" }, { status: 400 });
    }

    await updateProject(id, {
      ...(name           !== undefined && { name:           name.trim() }),
      ...(artist         !== undefined && { artist:         artist.trim() }),
      ...(status         !== undefined && { status }),
      ...(deadline       !== undefined && { deadline:       deadline || null }),
      ...(notes          !== undefined && { notes:          notes.trim() }),
      ...(projectType    !== undefined && { project_type:   projectType }),
      ...(parentProject  !== undefined && { parent_project: parentProject }),
    });

    // Sync new artists to clients table (fire-and-forget)
    if (artist?.trim()) {
      upsertArtistsFromProject(artist).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[projects PATCH]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/projects/[id]
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[projects DELETE]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
