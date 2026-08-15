/**
 * show-cancel-tasks.ts — server-only: when a show is cancelled ("בוטל"), move
 * its still-OPEN linked tasks to "בוטל" so they stop showing up as active work.
 *
 * Canonical link: tasks.show_id (NOT the task title, NOT related_type). No DB
 * change — uses the existing tasks table + show_id column. Never deletes.
 * Idempotent: a second run finds no open tasks and is a no-op.
 *
 * Deliberately NOT wired to the confirmed statuses (אושרה/נסגר/בוצע) — a show
 * that closed successfully can still carry legitimate open tasks. Only the
 * cancel branch is in scope.
 */
import "server-only";
import { listTasks, patchTask } from "@/lib/tasks-store";
import { selectShowTasksToCancel } from "@/lib/show-cancel-tasks-pure";

/**
 * Cancel every open task linked to `showId`. Returns how many were moved.
 * Callers treat failures as non-fatal (the show cancel itself already saved).
 */
export async function cancelOpenShowTasks(showId: string): Promise<number> {
  if (!showId) return 0;

  // Query is already scoped to this show + open status; the pure selector
  // re-checks both so no foreign task can ever be touched.
  const tasks = await listTasks({ show_id: showId, status: "פתוח" });
  const ids   = selectShowTasksToCancel(tasks, showId);

  for (const id of ids) {
    await patchTask(id, { status: "בוטל" });
  }
  return ids.length;
}
