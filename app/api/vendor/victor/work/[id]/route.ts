import { NextResponse } from "next/server";

/**
 * GET    /api/vendor/victor/work/[id]  — fetch a single work record
 * PATCH  /api/vendor/victor/work/[id]  — update a work record
 * DELETE /api/vendor/victor/work/[id]  — delete a work record
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { getVictorWorkById } = await import("@/lib/vendor-store");
    const work = await getVictorWorkById(id);
    if (!work) return NextResponse.json({ ok: false, work: null }, { status: 404 });
    return NextResponse.json({ ok: true, work });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const { updateVictorWork, getVictorWorkById } = await import("@/lib/vendor-store");

    // Fetch existing record before update (needed for linked_task_id + projectName)
    const existingWork = await getVictorWorkById(id);

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
  try {
    const { id } = await params;
    const { deleteVictorWork } = await import("@/lib/vendor-store");
    await deleteVictorWork(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
