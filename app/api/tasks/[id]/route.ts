/**
 * PATCH /api/tasks/[id] — partial update of a task
 * DELETE /api/tasks/[id] — permanently delete a task
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getTask,
  patchTask,
  deleteTask,
  validateRelated,
  TASK_STATUSES,
  TASK_RELATED_TYPES,
  type TaskStatus,
  type TaskRelatedType,
  type PatchTaskInput,
} from "@/lib/tasks-store";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json() as Record<string, unknown>;
    const patch: PatchTaskInput = {};

    // title
    if ("title" in body) {
      if (typeof body.title !== "string" || !body.title.trim()) {
        return NextResponse.json({ error: "title לא יכול להיות ריק" }, { status: 400 });
      }
      patch.title = (body.title as string).trim();
    }

    // notes
    if ("notes" in body) {
      patch.notes = (body.notes as string | null) ?? null;
    }

    // status
    if ("status" in body) {
      const s = body.status as TaskStatus;
      if (!TASK_STATUSES.includes(s)) {
        return NextResponse.json({ error: `סטטוס לא תקין: ${s}` }, { status: 400 });
      }
      patch.status = s;
    }

    // related_type + related_id must be validated together if either is present
    const newType   = "related_type" in body ? (body.related_type as TaskRelatedType) : undefined;
    const newRelId  = "related_id"   in body ? (body.related_id   as string | null)  : undefined;

    if (newType !== undefined) {
      if (!TASK_RELATED_TYPES.includes(newType)) {
        return NextResponse.json({ error: `related_type לא תקין: ${newType}` }, { status: 400 });
      }
      patch.related_type = newType;
    }
    if (newRelId !== undefined) {
      patch.related_id = newRelId;
    }

    // Validate consistency only when both sides are known in this request
    if (newType !== undefined || newRelId !== undefined) {
      // Only validate if we have both sides in this single request
      if (newType !== undefined && "related_id" in body) {
        const err = validateRelated(newType, newRelId ?? null);
        if (err) return NextResponse.json({ error: err }, { status: 400 });
      }
    }

    // date/time fields
    if ("due_date"   in body) patch.due_date   = (body.due_date   as string | null) ?? null;
    if ("start_time" in body) patch.start_time = (body.start_time as string | null) ?? null;
    if ("end_time"   in body) patch.end_time   = (body.end_time   as string | null) ?? null;

    // calendar_event_id (set by calendar integration, not by the UI directly)
    if ("calendar_event_id" in body) {
      patch.calendar_event_id = (body.calendar_event_id as string | null) ?? null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
    }

    const task = await patchTask(id, patch);
    return NextResponse.json({ task });
  } catch (e) {
    console.error(`[PATCH /api/tasks/${id}]`, e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // אם יש Google Task מקושר — מוחקים אותו תחילה
    const task = await getTask(id);
    if (task?.calendar_event_id) {
      try {
        const { isConnected, deleteGoogleTask } = await import("@/lib/google-calendar");
        if (await isConnected()) {
          await deleteGoogleTask(task.calendar_event_id);
        }
      } catch (gErr) {
        console.warn(`[DELETE /api/tasks/${id}] Google Task deletion failed (ignored):`, gErr);
      }
    }

    await deleteTask(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(`[DELETE /api/tasks/${id}]`, e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
