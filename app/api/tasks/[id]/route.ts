/**
 * PATCH /api/tasks/[id] — partial update of a task
 * DELETE /api/tasks/[id] — permanently delete a task
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteTaskRecord, patchTaskRecord } from "@/lib/writes/tasks";
import {
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

    // Shared writer (lib/writes/tasks): status → Google done / undone; due date → Google due (hardened 2026-09-27).
    const r = await patchTaskRecord(id, patch);
    return NextResponse.json(r.syncWarning ? { task: r.task, syncWarning: r.syncWarning } : { task: r.task });
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
    // Shared writer (lib/writes/tasks): a linked Google Task is deleted first — a failure aborts the whole delete.
    if ((await deleteTaskRecord(id)) === "not_found") {
      return NextResponse.json({ ok: false, error: "משימה לא נמצאה" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(`[DELETE /api/tasks/${id}]`, e);
    const msg = e instanceof Error ? e.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
