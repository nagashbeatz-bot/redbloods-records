import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createProject } from "@/lib/projects-store";
import { upsertArtistsFromProject } from "@/lib/clients-store";
import { listTasks, patchTask } from "@/lib/tasks-store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/proposals/[id]/convert
 * Creates a real project from a proposal and marks it as "נסגר".
 * Also saves the agreed price to the finance settings if amount > 0.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({})) as { projectName?: string };
    const overrideName: string | undefined = body.projectName?.trim() || undefined;

    // Fetch proposal + client name
    const { data: proposal, error: fetchErr } = await supabase
      .from("proposals")
      .select("*, clients(name)")
      .eq("id", id)
      .single();

    if (fetchErr || !proposal) {
      return NextResponse.json({ error: "הצעה לא נמצאה" }, { status: 404 });
    }

    // Guard: already converted
    if (proposal.linked_project_id) {
      return NextResponse.json(
        { error: "already_converted", projectId: proposal.linked_project_id },
        { status: 409 }
      );
    }

    const clientName = (proposal.clients as { name: string } | null)?.name ?? "";
    const today = new Date().toISOString().split("T")[0];

    // Create the project — use explicit projectName if provided, else fall back to proposal title
    const project = await createProject({
      name:           overrideName ?? proposal.title,
      artist:         clientName,
      status:         "לא התחיל",
      start_date:     today,
      deadline:       null,
      notes:          proposal.notes || "",
      project_type:   "",
      parent_project: "",
    });

    // Sync artist → clients table (fire-and-forget, client already exists but keeps it consistent)
    if (clientName) upsertArtistsFromProject(clientName).catch(() => {});

    // Save agreed price if amount > 0
    if (Number(proposal.amount) > 0) {
      await supabase.from("settings").upsert(
        {
          key:   `finance_${project.id}`,
          value: {
            agreedPrice:    Number(proposal.amount),
            currency:       proposal.currency ?? "₪",
            financialNotes: "",
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );
    }

    // Mark proposal as converted
    await supabase
      .from("proposals")
      .update({
        status:             "נסגר",
        linked_project_id:  project.id,
        updated_at:         new Date().toISOString(),
      })
      .eq("id", id);

    // Close followup task for this proposal (best-effort, non-fatal)
    try {
      const proposalMarker = `[proposal_id:${id}]`;
      const clientId = proposal.client_id as string | null;
      if (clientId) {
        const clientTasks = await listTasks({ related_type: "client", related_id: clientId });
        const followupTask = clientTasks.find(t => t.notes?.includes(proposalMarker));
        if (followupTask && followupTask.status !== "בוצע") {
          await patchTask(followupTask.id, { status: "בוצע" });
          if (followupTask.calendar_event_id) {
            try {
              const { isConnected, updateGoogleTaskStatus } = await import("@/lib/google-calendar");
              if (await isConnected()) await updateGoogleTaskStatus(followupTask.calendar_event_id, true);
            } catch { /* non-critical */ }
          }
        }
      }
    } catch { /* non-critical */ }

    return NextResponse.json({
      ok: true,
      projectId: project.id,
      project: {
        id:           project.id,
        name:         project.name,
        artist:       project.artist,
        status:       project.status,
        deadline:     project.deadline  ?? null,
        project_type: (project.projectType as string) ?? "",
        isOverdue:    false,
        isDueSoon:    false,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[proposals convert]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
