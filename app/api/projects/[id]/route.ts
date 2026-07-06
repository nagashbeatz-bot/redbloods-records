import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject, deleteProject } from "@/lib/projects-store";
import { projectBaseFolder } from "@/lib/project-paths";
import { upsertArtistsFromProject } from "@/lib/clients-store";
import { supabase } from "@/lib/supabase";
import { listTasks, deleteTask } from "@/lib/tasks-store";
import type { UpdatableField } from "@/lib/types";

/**
 * Cleans up all dependent data before hard-deleting a project.
 *
 * Hard-deleted (owned by project):
 *   sessions (+ Google Calendar events), project_actions, clip_items,
 *   vendor_project_work, settings keys finance_{id} and delivery_{id}
 *
 * Unlinked (not deleted — data remains but no longer tied to project):
 *   transactions.project_id  → NULL
 *   proposals.linked_project_id → NULL + status reverted to "לא נסגר"
 *
 * Soft-closed (alert stays in history but marked handled):
 *   agent_alerts with entity_key matching this project's patterns
 */
async function cleanupBeforeDelete(projectId: string): Promise<void> {
  // ── 1. Sessions + Google Calendar events ──────────────────────────────────
  const { data: sessionsToDelete } = await supabase
    .from("sessions")
    .select("id, calendar_event_id")
    .eq("project_id", projectId);

  if (sessionsToDelete?.length) {
    // Cancel Google Calendar events best-effort (parallel, non-fatal)
    const calEventIds = sessionsToDelete
      .map((s) => s.calendar_event_id as string | null)
      .filter(Boolean) as string[];

    if (calEventIds.length > 0) {
      try {
        const { deleteCalendarEvent, isConnected } = await import("@/lib/google-calendar");
        if (await isConnected()) {
          await Promise.allSettled(calEventIds.map((id) => deleteCalendarEvent(id)));
        }
      } catch { /* calendar cleanup is non-fatal */ }
    }

    await supabase.from("sessions").delete().eq("project_id", projectId);
  }

  // ── 2. project_actions ────────────────────────────────────────────────────
  await supabase.from("project_actions").delete().eq("project_id", projectId);

  // ── 3. clip_items ─────────────────────────────────────────────────────────
  await supabase.from("clip_items").delete().eq("project_id", projectId);

  // ── 4. vendor_project_work (Victor + future vendors) ─────────────────────
  await supabase.from("vendor_project_work").delete().eq("project_id", projectId);

  // ── 5. settings: finance_{id} and delivery_{id} ───────────────────────────
  await supabase.from("settings").delete().in("key", [
    `finance_${projectId}`,
    `delivery_${projectId}`,
  ]);

  // ── 6. transactions — unlink only, never delete ───────────────────────────
  await supabase
    .from("transactions")
    .update({ project_id: null, updated_at: new Date().toISOString() })
    .eq("project_id", projectId);

  // ── 7. proposals — close their followup tasks, then unlink ───────────────────
  const { data: linkedProposals } = await supabase
    .from("proposals")
    .select("id, client_id")
    .eq("linked_project_id", projectId);

  if (linkedProposals?.length) {
    for (const proposal of linkedProposals) {
      if (!proposal.client_id) continue;
      try {
        const proposalMarker = `[proposal_id:${proposal.id}]`;
        const clientTasks = await listTasks({ related_type: "client", related_id: proposal.client_id });
        const followupTask = clientTasks.find(t => t.notes?.includes(proposalMarker));
        if (followupTask) {
          if (followupTask.calendar_event_id) {
            try {
              const { isConnected, deleteGoogleTask } = await import("@/lib/google-calendar");
              if (await isConnected()) await deleteGoogleTask(followupTask.calendar_event_id);
            } catch { /* non-critical */ }
          }
          await deleteTask(followupTask.id);
        }
      } catch { /* non-critical */ }
    }
  }

  await supabase
    .from("proposals")
    .update({ linked_project_id: null, status: "לא נסגר", updated_at: new Date().toISOString() })
    .eq("linked_project_id", projectId);

  // ── 8. agent_alerts — soft-close project-keyed alerts ────────────────────
  // entity_key patterns that embed project id: "type:{projectId}"
  const projectAlertPrefixes = [
    `overdue_deadline:${projectId}`,
    `deadline_approaching:${projectId}`,
    `project_no_pricing:${projectId}`,
    `completed_no_delivery:${projectId}`,
    `stale_session:${projectId}`,
  ];
  await supabase
    .from("agent_alerts")
    .update({ status: "handled", updated_at: new Date().toISOString() })
    .in("entity_key", projectAlertPrefixes)
    .eq("status", "new");
}

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

      // Freeze-before-rename: a name change must NEVER relocate the Dropbox
      // folder. If this project isn't frozen yet, freeze it to its CURRENT
      // (pre-rename) canonical path first, in the same update. Never overwrite
      // an existing dropbox_folder.
      if (field === "name") {
        const current = await getProject(id);
        if (current && !((current.dropboxFolder ?? "").trim())) {
          patch.dropbox_folder = projectBaseFolder(current.artist ?? "", current.name ?? "", id);
        }
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

    // Capture old artist before update (only if artist field is changing).
    // Also freeze-before-rename: if the name is changing and the project isn't
    // frozen yet, freeze its CURRENT canonical Dropbox path first so the rename
    // never relocates uploads. Never overwrite an existing dropbox_folder.
    let oldArtistFull = "";
    let freezeFolder: string | null = null;
    if (artist !== undefined || name !== undefined) {
      const current = await getProject(id);
      oldArtistFull = current?.artist ?? "";
      if (name !== undefined && current && !((current.dropboxFolder ?? "").trim())) {
        freezeFolder = projectBaseFolder(current.artist ?? "", current.name ?? "", id);
      }
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
      ...(freezeFolder   !== null      && { dropbox_folder: freezeFolder }),
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

    await cleanupBeforeDelete(id);
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
