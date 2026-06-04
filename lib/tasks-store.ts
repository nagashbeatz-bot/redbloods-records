/**
 * tasks-store.ts — server-only CRUD for the tasks table.
 * No RLS, uses service-role key via lib/supabase.
 */
import "server-only";
import { supabase } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskStatus      = "פתוח" | "בוצע" | "בוטל";
export type TaskRelatedType = "general" | "client" | "project";

export const TASK_STATUSES: TaskStatus[]           = ["פתוח", "בוצע", "בוטל"];
export const TASK_RELATED_TYPES: TaskRelatedType[] = ["general", "client", "project"];

export interface Task {
  id:                string;
  title:             string;
  notes:             string | null;
  status:            TaskStatus;
  related_type:      TaskRelatedType;
  related_id:        string | null;
  due_date:          string | null;   // "YYYY-MM-DD"
  start_time:        string | null;   // "HH:MM:SS"
  end_time:          string | null;   // "HH:MM:SS"
  calendar_event_id: string | null;
  created_at:        string;
  updated_at:        string;
}

export interface CreateTaskInput {
  title:        string;
  notes?:       string | null;
  status?:      TaskStatus;
  related_type: TaskRelatedType;
  related_id?:  string | null;
  due_date?:    string | null;
  start_time?:  string | null;
  end_time?:    string | null;
}

export interface PatchTaskInput {
  title?:             string;
  notes?:             string | null;
  status?:            TaskStatus;
  related_type?:      TaskRelatedType;
  related_id?:        string | null;
  due_date?:          string | null;
  start_time?:        string | null;
  end_time?:          string | null;
  calendar_event_id?: string | null;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateRelated(
  related_type: TaskRelatedType,
  related_id: string | null | undefined
): string | null {
  if (related_type === "general" && related_id) {
    return "related_id חייב להיות null כאשר related_type הוא general";
  }
  if ((related_type === "client" || related_type === "project") && !related_id) {
    return `related_id חובה כאשר related_type הוא ${related_type}`;
  }
  return null;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function listTasks(opts: {
  status?:       TaskStatus | TaskStatus[];
  related_type?: TaskRelatedType;
  related_id?:   string;
  due_date?:     string;          // exact date "YYYY-MM-DD"
  due_before?:   string;          // inclusive "YYYY-MM-DD"
  due_today?:    boolean;
  limit?:        number;
}): Promise<Task[]> {
  let q = supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (opts.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    q = statuses.length === 1 ? q.eq("status", statuses[0]) : q.in("status", statuses);
  }
  if (opts.related_type) q = q.eq("related_type", opts.related_type);
  if (opts.related_id)   q = q.eq("related_id",   opts.related_id);
  if (opts.due_date)     q = q.eq("due_date",      opts.due_date);
  if (opts.due_before)   q = q.lte("due_date",     opts.due_before);
  if (opts.due_today) {
    const today = new Date().toISOString().split("T")[0];
    q = q.eq("due_date", today);
  }
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Task[];
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title:        input.title.trim(),
      notes:        input.notes        ?? null,
      status:       input.status       ?? "פתוח",
      related_type: input.related_type,
      related_id:   input.related_id   ?? null,
      due_date:     input.due_date     ?? null,
      start_time:   input.start_time   ?? null,
      end_time:     input.end_time     ?? null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "יצירת משימה נכשלה");
  return data as Task;
}

export async function patchTask(id: string, patch: PatchTaskInput): Promise<Task> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (patch.title             !== undefined) update.title             = patch.title.trim();
  if (patch.notes             !== undefined) update.notes             = patch.notes;
  if (patch.status            !== undefined) update.status            = patch.status;
  if (patch.related_type      !== undefined) update.related_type      = patch.related_type;
  if (patch.related_id        !== undefined) update.related_id        = patch.related_id;
  if (patch.due_date          !== undefined) update.due_date          = patch.due_date;
  if (patch.start_time        !== undefined) update.start_time        = patch.start_time;
  if (patch.end_time          !== undefined) update.end_time          = patch.end_time;
  if (patch.calendar_event_id !== undefined) update.calendar_event_id = patch.calendar_event_id;

  const { data, error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "עדכון משימה נכשל");
  return data as Task;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw new Error(error.message ?? "מחיקת משימה נכשלה");
}
