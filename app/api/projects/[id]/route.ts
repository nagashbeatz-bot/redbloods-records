import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject, deleteProject } from "@/lib/projects-store";
import { upsertArtistsFromProject } from "@/lib/clients-store";
import type { UpdatableField } from "@/lib/types";

function parseNames(raw: string): string[] {
  return (raw || "").split(/[,،;]/).map((s) => s.trim()).filter(Boolean);
}

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
        startDate:     "start_date",
        deadline:      "deadline",
        notes:         "notes",
        projectType:   "project_type",
        parentProject: "parent_project",
      };

      const col = fieldMap[field];
      if (!col) {
        return NextResponse.json({ error: `שדה לא מוכר: ${field}` }, { status: 400 });
      }

      // For artist changes: capture old value before update
      let oldArtist = "";
      if (field === "artist") {
        const current = await getProject(id);
        oldArtist = current?.artist ?? "";
      }

      const patch: Parameters<typeof updateProject>[1] = {
        [col]: value || (field === "deadline" || field === "startDate" ? null : ""),
      };

      // Auto-manage end_date when status changes
      if (field === "status") {
        const today = new Date().toISOString().split("T")[0];
        patch.end_date = value === "הושלם" ? today : null;
      }

      await updateProject(id, patch);

      // Sync artist changes to clients table (fire-and-forget)
      // NOTE: only adds new artists — never removes clients automatically.
      if (field === "artist") {
        if (value?.trim()) upsertArtistsFromProject(value).catch(() => {});
      }

      return NextResponse.json({ ok: true });
    }

    // Full update (from modal / drawer)
    const { name, artist, status, startDate, deadline, notes, projectType, parentProject, isHidden } = body;
    if (name !== undefined && !name?.trim()) {
      return NextResponse.json({ error: "שם הפרויקט לא יכול להיות ריק" }, { status: 400 });
    }

    // Capture old artist before update (only if artist field is changing)
    let oldArtistFull = "";
    if (artist !== undefined) {
      const current = await getProject(id);
      oldArtistFull = current?.artist ?? "";
    }

    const today = new Date().toISOString().split("T")[0];
    await updateProject(id, {
      ...(name           !== undefined && { name:           name.trim() }),
      ...(artist         !== undefined && { artist:         artist.trim() }),
      ...(status         !== undefined && {
        status,
        end_date: status === "הושלם" ? today : null,
      }),
      ...(startDate      !== undefined && { start_date:     startDate || null }),
      ...(deadline       !== undefined && { deadline:       deadline || null }),
      ...(notes          !== undefined && { notes:          notes.trim() }),
      ...(projectType    !== undefined && { project_type:   projectType }),
      ...(parentProject  !== undefined && { parent_project: parentProject }),
      ...(isHidden       !== undefined && { is_hidden:      Boolean(isHidden) }),
    });

    // Sync artist changes to clients table (fire-and-forget)
    // NOTE: only adds new artists — never removes clients automatically.
    if (artist !== undefined && artist?.trim()) {
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

    // NOTE: We intentionally do NOT auto-delete clients when a project is removed.
    // Clients are managed manually only — never auto-deleted.

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[projects DELETE]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
