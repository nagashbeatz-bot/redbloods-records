import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/projects-store";
import { freezeFolderPatch, statusPatch } from "@/lib/writes/projects";
import { upsertArtistsFromProject } from "@/lib/clients-store";
import type { UpdatableField } from "@/lib/types";

// Project delete = the shared writer lib/writes/project-delete (deleteProjectCompletely): the same cleanup as before —
// sessions (+ events), send log, clip rows, Victor works (+ their tasks), finance / delivery / cover settings, unlinked
// transactions, proposals back to "לא נסגר", soft-closed alerts — checked step by step, project row LAST.

function parseNames(raw: string): string[] {
  return (raw || "").split(/[,،;]/).map((s) => s.trim()).filter(Boolean);
}

type Ctx = { params: Promise<{ id: string }> };

// GET /api/projects/[id] — fetch single project (including hidden)
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const project = await getProject(id);
    if (!project) return NextResponse.json({ error: "פרויקט לא נמצא" }, { status: 404 });
    return NextResponse.json(project);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/projects/[id]
// Body: { field: UpdatableField, value: string }  — single-field update (from table inline edit)
// Body: { name, artist, status, deadline, notes, projectType, parentProject } — full update
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    // Team hand-off completion (Victor "projectToo", B5): the SERVER rule, never a blind status write — refused for a
    // protected project status (בוטל / בהשהייה, the Steven-completion set) or an already completed project.
    if (body?.completeIfAllowed === true && body?.field === "status" && body?.value === "הושלם") {
      const { completeProjectIfAllowed } = await import("@/lib/writes/projects");
      const r = await completeProjectIfAllowed(id);
      if (!r.ok) {
        const msg = r.refused === "NOT_FOUND" ? "פרויקט לא נמצא" : r.refused === "ALREADY_COMPLETED" ? "הפרויקט כבר הושלם" : `הפרויקט בסטטוס "${r.status}" — לא מסמנים אותו כהושלם אוטומטית`;
        return NextResponse.json({ ok: false, refused: r.refused, status: r.status, error: msg }, { status: r.refused === "NOT_FOUND" ? 404 : 409 });
      }
      return NextResponse.json({ ok: true, status: r.status, endDate: r.endDate });
    }

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

      // Auto-manage end_date when status changes — stamped only on a real transition into הושלם (a re-save keeps it).
      if (field === "status") {
        const current = await getProject(id);
        const sp = statusPatch(value, current ? { status: current.status, endDate: current.endDate } : null);
        if ("end_date" in sp) patch.end_date = sp.end_date;
      }

      // Freeze-before-rename: a name change must NEVER relocate the Dropbox
      // folder. If this project isn't frozen yet, freeze it to its CURRENT
      // (pre-rename) canonical path first, in the same update. Never overwrite
      // an existing dropbox_folder.
      if (field === "name") {
        const current = await getProject(id);
        Object.assign(patch, freezeFolderPatch(current ? { id, artist: current.artist, name: current.name, dropboxFolder: current.dropboxFolder } : null));
      }

      await updateProject(id, patch);

      // Sync artist changes to clients table (fire-and-forget)
      // NOTE: only adds new artists — never removes clients automatically.
      if (field === "artist") {
        if (value?.trim()) upsertArtistsFromProject(value).catch(() => {});
        // the credits decide who carries this project's Records expenses (task 6) → the artist shares follow
        await (await import("@/lib/writes/artist-expense-share")).syncProjectExpenseShares(id);
      }

      return NextResponse.json({ ok: true });
    }

    // Full update (from modal / drawer)
    const { name, artist, status, startDate, deadline, notes, projectType, parentProject, isHidden, plannedHours, plannedDays } = body;
    if (name !== undefined && !name?.trim()) {
      return NextResponse.json({ error: "שם הפרויקט לא יכול להיות ריק" }, { status: 400 });
    }

    // "לימודים" course targets — normalize "" → null, validate finite & non-negative
    // (DB CHECK enforces >= 0 too). hours: numeric; days: integer.
    let plannedHoursCol: number | null | undefined;
    if (plannedHours !== undefined) {
      if (plannedHours === null || plannedHours === "") {
        plannedHoursCol = null;
      } else {
        const n = Number(plannedHours);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: "שעות מסלול לא תקינות" }, { status: 400 });
        }
        plannedHoursCol = n;
      }
    }
    let plannedDaysCol: number | null | undefined;
    if (plannedDays !== undefined) {
      if (plannedDays === null || plannedDays === "") {
        plannedDaysCol = null;
      } else {
        const n = Number(plannedDays);
        if (!Number.isInteger(n) || n < 0) {
          return NextResponse.json({ error: "ימי מסלול לא תקינים" }, { status: 400 });
        }
        plannedDaysCol = n;
      }
    }

    // Capture old artist before update (only if artist field is changing).
    // Also freeze-before-rename: if the name is changing and the project isn't
    // frozen yet, freeze its CURRENT canonical Dropbox path first so the rename
    // never relocates uploads. Never overwrite an existing dropbox_folder.
    let oldArtistFull = "";
    let freezeFolder: string | null = null;
    // Pre-read the current status so a re-save of "הושלם" keeps its end date (statusPatch: real transition only).
    const currentForStatus = status !== undefined ? await getProject(id) : null;
    if (artist !== undefined || name !== undefined) {
      const current = await getProject(id);
      oldArtistFull = current?.artist ?? "";
      if (name !== undefined && current) {
        freezeFolder = freezeFolderPatch({ id, artist: current.artist, name: current.name, dropboxFolder: current.dropboxFolder }).dropbox_folder ?? null;
      }
    }

    await updateProject(id, {
      ...(name           !== undefined && { name:           name.trim() }),
      ...(artist         !== undefined && { artist:         artist.trim() }),
      ...(status         !== undefined && statusPatch(status, currentForStatus ? { status: currentForStatus.status, endDate: currentForStatus.endDate } : null)),
      ...(startDate      !== undefined && { start_date:     startDate || null }),
      ...(deadline       !== undefined && { deadline:       deadline || null }),
      ...(notes          !== undefined && { notes:          notes.trim() }),
      ...(projectType    !== undefined && { project_type:   projectType }),
      ...(parentProject  !== undefined && { parent_project: parentProject }),
      ...(isHidden       !== undefined && { is_hidden:      Boolean(isHidden) }),
      ...(freezeFolder   !== null      && { dropbox_folder: freezeFolder }),
      ...(plannedHoursCol !== undefined && { planned_hours: plannedHoursCol }),
      ...(plannedDaysCol  !== undefined && { planned_days:  plannedDaysCol }),
    });

    // Sync artist changes to clients table (fire-and-forget)
    // NOTE: only adds new artists — never removes clients automatically.
    if (artist !== undefined && artist !== oldArtistFull) await (await import("@/lib/writes/artist-expense-share")).syncProjectExpenseShares(id);
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

    const { deleteProjectCompletely, ProjectDeleteBlockedError } = await import("@/lib/writes/project-delete");
    try {
      // preflight FIRST (zero mutations when blocked); DB steps checked; project row last; external effects after
      const result = await deleteProjectCompletely(id);
      // NOTE: We intentionally do NOT auto-delete clients when a project is removed.
      // Clients are managed manually only — never auto-deleted.
      return NextResponse.json({ ok: true, external: result.external });
    } catch (e) {
      if (e instanceof ProjectDeleteBlockedError) return NextResponse.json({ error: e.message, code: e.code, blockers: e.blockers }, { status: 409 });
      throw e;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[projects DELETE]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
