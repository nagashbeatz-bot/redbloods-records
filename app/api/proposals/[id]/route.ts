import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { listTasks, createTask, patchTask } from "@/lib/tasks-store";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/proposals/[id] — update fields
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    const patch: Record<string, unknown> = {};
    if (body.title            !== undefined) patch.title             = body.title;
    if (body.amount           !== undefined) patch.amount            = Number(body.amount) || 0;
    if (body.currency         !== undefined) patch.currency          = body.currency;
    if (body.status           !== undefined) patch.status            = body.status;
    if (body.sentDate         !== undefined) patch.sent_date         = body.sentDate     || null;
    if (body.followupDate     !== undefined) patch.followup_date     = body.followupDate || null;
    if (body.linkedProjectId  !== undefined) patch.linked_project_id = body.linkedProjectId || null;
    if (body.notes            !== undefined) patch.notes             = body.notes;
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("proposals")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Manage follow-up task when followupDate is set
    if (body.followupDate && data.client_id) {
      try {
        const followupDate: string = body.followupDate;

        const { data: clientData } = await supabase
          .from("clients")
          .select("name")
          .eq("id", data.client_id)
          .single();
        const clientName = clientData?.name ?? "";
        const taskTitle = `מעקב הצעת מחיר - ${clientName}`;
        const proposalMarker = `[proposal_id:${id}]`;

        // Find task by proposal_id embedded in notes — exact match, not just client+prefix
        const clientTasks = await listTasks({
          related_type: "client",
          related_id:   data.client_id,
        });
        const existingTask = clientTasks.find(t => t.notes?.includes(proposalMarker));

        if (existingTask) {
          // Update due_date if changed
          if (existingTask.due_date !== followupDate) {
            await patchTask(existingTask.id, { due_date: followupDate });
          }

          // Add Google Task only if not already linked — prevents duplicate
          if (!existingTask.calendar_event_id) {
            try {
              const { isConnected, createGoogleTask } = await import("@/lib/google-calendar");
              if (await isConnected()) {
                const gt = await createGoogleTask(taskTitle, followupDate);
                await patchTask(existingTask.id, { calendar_event_id: gt.id });
              }
            } catch { /* Google not connected or failed — non-critical */ }
          }
        } else {
          // No task for this specific proposal — create one
          const taskNotes = `${proposalMarker}\nהצעה: ${data.title ?? ""}`;
          const task = await createTask({
            title:        taskTitle,
            related_type: "client",
            related_id:   data.client_id,
            due_date:     followupDate,
            notes:        taskNotes,
          });

          try {
            const { isConnected, createGoogleTask } = await import("@/lib/google-calendar");
            if (await isConnected()) {
              const gt = await createGoogleTask(taskTitle, followupDate);
              await patchTask(task.id, { calendar_event_id: gt.id });
            }
          } catch { /* Google not connected or failed — non-critical */ }
        }
      } catch { /* task management is non-critical — proposal save never fails */ }
    }

    return NextResponse.json({ proposal: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/proposals/[id]
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { error } = await supabase.from("proposals").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/proposals/[id]/convert — handled in /[id]/convert/route.ts
