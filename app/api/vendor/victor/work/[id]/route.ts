import { NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";

// Victor may only patch file/folder fields — never status/work-state/deadlines.
const VICTOR_PATCH_FIELDS = new Set(["filesSent", "filesReceived", "dropboxFolder", "dropboxShareLink"]);

/**
 * GET    /api/vendor/victor/work/[id]  — fetch a single work record (victor/owner)
 * PATCH  /api/vendor/victor/work/[id]  — update a work record (victor/owner)
 * DELETE /api/vendor/victor/work/[id]  — delete a work record (owner only)
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const { id } = await params;
    const { getVictorWorkById, sanitizeWorkForVictor } = await import("@/lib/vendor-store");
    const work = await getVictorWorkById(id);
    if (!work) return NextResponse.json({ ok: false, work: null }, { status: 404 });
    // Victor never receives Artist/Project/Dropbox-folder fields; owner gets all.
    const safe = (await getAuthRole()) === "victor" ? sanitizeWorkForVictor(work) : work;
    return NextResponse.json({ ok: true, work: safe });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const { id } = await params;
    const body = await req.json();

    // Victor = view + files only: reject any non-file field (status, workState,
    // outcome, deadlines, notes…). Owner may patch anything.
    if ((await getAuthRole()) !== "owner") {
      const hasForbiddenField = Object.keys(body ?? {}).some((k) => !VICTOR_PATCH_FIELDS.has(k));
      if (hasForbiddenField) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const { updateVictorWork, getVictorWorkById } = await import("@/lib/vendor-store");

    // Fetch existing record before update (needed for linked_task_id + projectName)
    const existingWork = await getVictorWorkById(id);

    // Ownership guard: this endpoint only manages Victor's work rows.
    if (existingWork && existingWork.vendorName !== "victor") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // Apply all regular field updates
    await updateVictorWork(id, body);

    // Mode C — no internalDeadline in body → no task sync needed
    const internalDeadline: string | null =
      "internalDeadline" in body ? (body.internalDeadline as string | null) : null;
    if (!("internalDeadline" in body) || !internalDeadline) {
      return NextResponse.json({ ok: true });
    }

    const { createTask, patchTask, getTask } = await import("@/lib/tasks-store");
    const { createGoogleTask, updateGoogleTaskDue, isConnected } = await import(
      "@/lib/google-calendar"
    );

    if (!existingWork?.linkedTaskId) {
      // Mode A — create Task + best-effort Google Task
      const title = `מעקב ויקטור — ${existingWork?.projectName ?? id}`;
      const task = await createTask({
        title,
        related_type: "project",
        related_id: existingWork?.projectId ?? null,
        due_date: internalDeadline,
        status: "פתוח",
      });

      try {
        if (await isConnected()) {
          const { id: googleId } = await createGoogleTask(title, internalDeadline);
          await patchTask(task.id, { calendar_event_id: googleId });
        }
      } catch {
        // non-fatal — task saved, Google sync skipped
      }

      await updateVictorWork(id, { linkedTaskId: task.id });
    } else {
      // Mode B — update existing Task due date + best-effort Google Task
      const existingTask = await getTask(existingWork.linkedTaskId);
      if (existingTask) {
        await patchTask(existingTask.id, { due_date: internalDeadline });

        try {
          if (existingTask.calendar_event_id && (await isConnected())) {
            await updateGoogleTaskDue(existingTask.calendar_event_id, internalDeadline);
          }
        } catch {
          // non-fatal
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Owner + Victor may delete; any other role → 403.
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const { id } = await params;
    const { getVictorWorkById, deleteVictorWork } = await import("@/lib/vendor-store");

    const work = await getVictorWorkById(id);
    if (!work) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    // Ownership guard: this endpoint manages Victor's rows only. Victor (and owner)
    // may delete only vendorName === "victor" rows — never another vendor's work.
    if (work.vendorName !== "victor") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // Clean up the linked tracking task server-side (Victor can't delete tasks
    // himself). Non-fatal — the work is deleted regardless. For the owner this is
    // usually already gone (deleted client-side first) → a harmless no-op.
    if (work.linkedTaskId) {
      try {
        const { deleteTask } = await import("@/lib/tasks-store");
        await deleteTask(work.linkedTaskId);
      } catch { /* non-fatal */ }
    }

    await deleteVictorWork(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
