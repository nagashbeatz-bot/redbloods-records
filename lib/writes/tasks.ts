/**
 * Shared task writers — used by BOTH the task routes and Sunny's typed primitives.
 * HARDENED (2026-09-27, Universal Actions): a due-date change on a task mirrored to Google Tasks now moves the Google
 * Task's due date too (previously only the status was synced, so the two drifted).
 */
import { supabase } from "@/lib/supabase";
import { createTask, deleteTask, getTask, patchTask, type CreateTaskInput, type PatchTaskInput } from "@/lib/tasks-store";

/** Apply a validated patch; status → Google done / undone; due date → Google due (hardened). */
export async function patchTaskRecord(id: string, patch: PatchTaskInput): Promise<{ task: Awaited<ReturnType<typeof patchTask>>; syncWarning?: string }> {
  const existing = patch.status !== undefined || patch.due_date !== undefined ? await getTask(id) : null;
  const task = await patchTask(id, patch);
  const gid = existing?.calendar_event_id;
  if (gid) {
    try {
      const g = await import("@/lib/google-calendar");
      if (await g.isConnected()) {
        if (patch.status !== undefined) await g.updateGoogleTaskStatus(gid, patch.status === "בוצע" || patch.status === "בוטל");
        if (patch.due_date && patch.due_date !== existing?.due_date) await g.updateGoogleTaskDue(gid, patch.due_date);
      }
    } catch (gErr) {
      console.warn(`[tasks] Google Tasks sync failed (ignored):`, gErr);
      return { task, syncWarning: "Google Tasks לא עודכן" };
    }
  }
  return { task };
}

/** Delete a task; a linked Google Task is deleted FIRST and a failure aborts the whole delete (existing behaviour). */
export async function deleteTaskRecord(id: string): Promise<"ok" | "not_found"> {
  const task = await getTask(id);
  if (!task) return "not_found";
  if (task.calendar_event_id) {
    const { isConnected, deleteGoogleTask } = await import("@/lib/google-calendar");
    if (await isConnected()) await deleteGoogleTask(task.calendar_event_id);
  }
  await deleteTask(id);
  return "ok";
}

/** Create a task; optionally mirror it to Google Tasks and store the Google id on the task (the canonical link). */
export async function createTaskWithOptionalGoogle(input: CreateTaskInput, mirror: boolean): Promise<{ id: string; mirrored: boolean }> {
  const task = await createTask(input);
  let mirrored = false;
  if (mirror && input.due_date) {
    try {
      const { isConnected, createGoogleTask } = await import("@/lib/google-calendar");
      if (await isConnected()) { const gt = await createGoogleTask(input.title, input.due_date, input.notes ?? undefined); await patchTask(task.id, { calendar_event_id: gt.id }); mirrored = true; }
    } catch { /* the task itself is saved; Google mirroring reported as not done */ }
  }
  return { id: task.id, mirrored };
}

/** Pull completed Google Tasks: every OPEN local task whose Google Task is completed becomes "בוצע". Never deletes. */
export async function syncCompletedGoogleTasks(): Promise<{ synced: number; skipped?: "not_connected" }> {
  const { isConnected, listCompletedGoogleTaskIds } = await import("@/lib/google-calendar");
  if (!(await isConnected())) return { synced: 0, skipped: "not_connected" };
  const completedIds = await listCompletedGoogleTaskIds();
  if (completedIds.size === 0) return { synced: 0 };
  const { data: openTasks, error } = await supabase.from("tasks").select("id, calendar_event_id").eq("status", "פתוח").not("calendar_event_id", "is", null);
  if (error) throw new Error(error.message);
  const ids = ((openTasks ?? []) as Array<{ id: string; calendar_event_id: string | null }>).filter((t) => t.calendar_event_id && completedIds.has(t.calendar_event_id)).map((t) => t.id);
  if (ids.length === 0) return { synced: 0 };
  const { error: updErr } = await supabase.from("tasks").update({ status: "בוצע", updated_at: new Date().toISOString() }).in("id", ids);
  if (updErr) throw new Error(updErr.message);
  return { synced: ids.length };
}

/** Open tasks with exactly this title (duplicate warning on create). */
export async function countOpenTasksTitled(title: string): Promise<number> {
  const { count, error } = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "פתוח").eq("title", title);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
