/**
 * GET  /api/tasks — list tasks with optional filters
 * POST /api/tasks — create a new task
 *
 * GET query params (all optional):
 *   status        — פתוח | בוצע | בוטל  (comma-separated for multiple)
 *   related_type  — general | client | project
 *   related_id    — uuid
 *   due_date      — YYYY-MM-DD  (exact)
 *   due_before    — YYYY-MM-DD  (inclusive)
 *   due_today     — "1"
 *   limit         — number
 */
import { NextRequest, NextResponse } from "next/server";
import {
  listTasks,
  createTask,
  validateRelated,
  TASK_STATUSES,
  TASK_RELATED_TYPES,
  type TaskStatus,
  type TaskRelatedType,
} from "@/lib/tasks-store";

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;

    const statusParam = p.get("status");
    const statuses = statusParam
      ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) as TaskStatus[]
      : undefined;

    // Validate status values
    if (statuses) {
      const invalid = statuses.filter((s) => !TASK_STATUSES.includes(s));
      if (invalid.length > 0) {
        return NextResponse.json({ error: `סטטוס לא תקין: ${invalid.join(", ")}` }, { status: 400 });
      }
    }

    const related_type = p.get("related_type") as TaskRelatedType | null;
    if (related_type && !TASK_RELATED_TYPES.includes(related_type)) {
      return NextResponse.json({ error: `related_type לא תקין: ${related_type}` }, { status: 400 });
    }

    const tasks = await listTasks({
      status:       statuses,
      related_type: related_type ?? undefined,
      related_id:   p.get("related_id")  ?? undefined,
      due_date:     p.get("due_date")    ?? undefined,
      due_before:   p.get("due_before")  ?? undefined,
      due_today:    p.get("due_today")   === "1",
      limit:        p.get("limit") ? parseInt(p.get("limit")!) : undefined,
    });

    return NextResponse.json({ tasks });
  } catch (e) {
    console.error("[GET /api/tasks]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, notes, status, related_type, related_id, due_date, start_time, end_time } = body;

    // Required
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title חובה" }, { status: 400 });
    }

    // Validate status
    const resolvedStatus = status ?? "פתוח";
    if (!TASK_STATUSES.includes(resolvedStatus)) {
      return NextResponse.json({ error: `סטטוס לא תקין: ${resolvedStatus}` }, { status: 400 });
    }

    // Validate related_type
    const resolvedType: TaskRelatedType = related_type ?? "general";
    if (!TASK_RELATED_TYPES.includes(resolvedType)) {
      return NextResponse.json({ error: `related_type לא תקין: ${resolvedType}` }, { status: 400 });
    }

    // Validate related_type + related_id consistency
    const relatedErr = validateRelated(resolvedType, related_id ?? null);
    if (relatedErr) {
      return NextResponse.json({ error: relatedErr }, { status: 400 });
    }

    const task = await createTask({
      title:        title.trim(),
      notes:        notes   ?? null,
      status:       resolvedStatus,
      related_type: resolvedType,
      related_id:   related_id ?? null,
      due_date:     due_date   ?? null,
      start_time:   start_time ?? null,
      end_time:     end_time   ?? null,
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/tasks]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
