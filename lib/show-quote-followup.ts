/**
 * show-quote-followup.ts — server-only lifecycle for the "פולואפ להצעת מחיר" task
 * that shadows a price-quote (pipeline) show. One open follow-up per show,
 * identified canonically by show_id + the hidden [quote_followup] marker in notes
 * (NOT by title). No DB change — uses the existing tasks table + show_id column.
 */
import "server-only";
import { listTasks, createTask, patchTask, type Task } from "@/lib/tasks-store";

// Canonical marker written as a hidden "tech line" in the task's notes (same
// convention as [proposal_id:…]) — TasksPage strips [ -lines from the display.
export const QUOTE_FOLLOWUP_MARKER = "[quote_followup]";

export interface QuoteFollowupInfo {
  showId:  string;
  artist?: string | null;
  contact?: string | null;   // contact_person or booker name
  amount?: number | null;    // show_price
  date?:   string | null;    // "YYYY-MM-DD"
  status?: string | null;    // current pipeline status
}

/** "2,800₪" — thousands-grouped, system-consistent. */
export function fmtQuoteAmount(amount: number | null | undefined): string {
  const n = Math.round(Number(amount) || 0);
  return `${n.toLocaleString("en-US")}₪`;
}

/** "2026-07-31" → "31.07.2026" (system display format). */
export function fmtQuoteDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return "";
  return `${d}.${m}.${y}`;
}

/** True iff a task is the quote follow-up for its show (marker present). */
export function isQuoteFollowupTask(t: Pick<Task, "notes">): boolean {
  return (t.notes ?? "").includes(QUOTE_FOLLOWUP_MARKER);
}

function buildTitle(info: QuoteFollowupInfo): string {
  const who = (info.artist?.trim() || info.contact?.trim() || "").trim();
  return who ? `פולואפ להצעת מחיר — ${who}` : "פולואפ להצעת מחיר";
}

function buildNotes(info: QuoteFollowupInfo): string {
  const lines = [
    info.artist?.trim()          ? `אמן: ${info.artist.trim()}`        : null,
    info.contact?.trim()         ? `איש קשר: ${info.contact.trim()}`   : null,
    (Number(info.amount) || 0) > 0 ? `סכום: ${fmtQuoteAmount(info.amount)}` : null,
    info.date                    ? `תאריך: ${fmtQuoteDate(info.date)}` : null,
    info.status?.trim()          ? `סטטוס: ${info.status.trim()}`      : null,
    QUOTE_FOLLOWUP_MARKER, // hidden marker — always last
  ].filter(Boolean);
  return lines.join("\n");
}

/** The one quote follow-up task for a show, if any (any status). */
async function findFollowup(showId: string): Promise<Task | null> {
  const tasks = await listTasks({ show_id: showId });
  return tasks.find(isQuoteFollowupTask) ?? null;
}

/**
 * Create the follow-up task on first quote send, or refresh its content on a
 * later "עדכן הצעה". Never creates a duplicate (dedup by show_id + marker).
 * Returns `created: true` only when a NEW task was inserted — the caller uses
 * this to send the push exactly once (first send only).
 * The task carries NO due_date (it simply follows the quote until it closes).
 */
export async function ensureQuoteFollowupTask(
  info: QuoteFollowupInfo,
): Promise<{ task: Task; created: boolean }> {
  const existing = await findFollowup(info.showId);
  const title = buildTitle(info);
  const notes = buildNotes(info);

  if (existing) {
    // Refresh content only while still open; never resurrect a closed task.
    if (existing.status === "פתוח") {
      const task = await patchTask(existing.id, { title, notes });
      return { task, created: false };
    }
    return { task: existing, created: false };
  }

  const task = await createTask({
    title,
    notes,
    status:       "פתוח",
    related_type: "general",
    show_id:      info.showId,
    // no due_date — decision: the task follows the quote, no invented deadline
  });
  return { task, created: true };
}

/**
 * Close the follow-up after the show is SERVER-saved to a terminal status:
 *   "בוצע"  — show approved/closed/done (אושרה / נסגר / בוצע)
 *   "בוטל"  — show cancelled
 * Only moves an OPEN follow-up (never reopens or churns a closed one), never
 * deletes. No-op when there is no follow-up for the show.
 */
export async function closeQuoteFollowupTask(
  showId: string,
  status: "בוצע" | "בוטל",
): Promise<void> {
  const existing = await findFollowup(showId);
  if (!existing || existing.status !== "פתוח") return;
  await patchTask(existing.id, { status });
}
