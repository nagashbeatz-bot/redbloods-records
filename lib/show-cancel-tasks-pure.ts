/**
 * Pure decision logic behind lib/show-cancel-tasks.ts — no
 * "server-only"/Supabase imports, testable from a plain tsx script.
 *
 * Scope: when a show moves to "בוטל", its still-open linked tasks are no longer
 * relevant. The link is ALWAYS tasks.show_id — never the task title, never the
 * task's related_type. Nothing is ever deleted; only "פתוח" → "בוטל".
 */

/** The only task shape this decision needs (a structural subset of Task). */
export interface CancellableTask {
  id:      string;
  status:  string;
  show_id: string | null;
}

/**
 * Pure: given the tasks fetched for ONE show, which of them should be cancelled
 * because that show was cancelled.
 *
 * Selects a task only when BOTH hold:
 *   - status === "פתוח"          (בוצע/בוטל are terminal — never churned)
 *   - show_id === showId          (defence in depth: the caller already filters
 *                                  by show_id in the query, so a foreign or
 *                                  null-linked row can never slip through here)
 *
 * Returns the ids to patch, in input order. Empty array = nothing to do.
 */
export function selectShowTasksToCancel(
  tasks: readonly CancellableTask[],
  showId: string,
): string[] {
  if (!showId) return [];
  return tasks
    .filter((t) => t.status === "פתוח" && t.show_id === showId)
    .map((t) => t.id);
}
