/**
 * Shared validated proposal writers — used by BOTH the proposal routes and Sunny's typed primitives.
 * Behaviour is the routes' existing behaviour, extracted verbatim; the only hardening is in convertProposal (a
 * compare-and-swap claim so a double submit can never create two projects).
 */
import { supabase } from "@/lib/supabase";
import { createProject } from "@/lib/projects-store";
import { upsertArtistsFromProject } from "@/lib/clients-store";
import { listTasks, createTask, patchTask, deleteTask } from "@/lib/tasks-store";

export const proposalMarker = (id: string) => `[proposal_id:${id}]`;

export interface ProposalInput { clientId: string; title: string; amount?: number | string | null; currency?: string | null; status?: string | null; sentDate?: string | null; followupDate?: string | null; notes?: string | null }

/** Create a proposal (+ the follow-up task and its Google Task when a follow-up date is set). */
export async function createProposal(b: ProposalInput): Promise<Record<string, unknown>> {
  const { clientId, title, amount, currency, status, sentDate, followupDate, notes } = b;
  const { data, error } = await supabase
    .from("proposals")
    .insert({
      client_id: clientId, title: title.trim(), amount: Number(amount) || 0, currency: currency || "₪", status: status || "ממתין לתשובה",
      sent_date: sentDate || null, followup_date: followupDate || null, notes: notes?.trim() || "",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  if (data.followup_date) {
    try {
      const { data: clientData } = await supabase.from("clients").select("name").eq("id", clientId).single();
      const clientName = clientData?.name ?? "";
      const amountStr = amount ? ` · ${currency || "₪"}${Number(amount).toLocaleString()}` : "";
      const taskNotes = `${proposalMarker(data.id)}\nהצעה: ${title.trim()}${amountStr}`;
      const task = await createTask({ title: `מעקב הצעת מחיר - ${clientName}`, related_type: "client", related_id: clientId, due_date: data.followup_date, notes: taskNotes });
      try {
        const { isConnected, createGoogleTask } = await import("@/lib/google-calendar");
        if (await isConnected()) {
          const googleNotes = ["משימת מעקב להצעת מחיר מתוך Redbloods OS", `לקוח: ${clientName}`, `הצעה: ${title.trim()}`, amount ? `סכום: ${currency || "₪"}${Number(amount).toLocaleString()}` : ""].filter(Boolean).join("\n");
          const gt = await createGoogleTask(`מעקב הצעת מחיר - ${clientName}`, data.followup_date, googleNotes);
          await patchTask(task.id, { calendar_event_id: gt.id });
        }
      } catch { /* Google not connected or failed — non-critical */ }
    } catch { /* task creation is non-critical */ }
  }
  return data as Record<string, unknown>;
}

export interface ProposalPatch { title?: string; amount?: number | string; currency?: string; status?: string; sentDate?: string | null; followupDate?: string | null; linkedProjectId?: string | null; notes?: string }

/** Update a proposal (fields present in the patch only) + manage the follow-up task when followupDate is present. */
export async function updateProposal(id: string, body: ProposalPatch): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.amount !== undefined) patch.amount = Number(body.amount) || 0;
  if (body.currency !== undefined) patch.currency = body.currency;
  if (body.status !== undefined) patch.status = body.status;
  if (body.sentDate !== undefined) patch.sent_date = body.sentDate || null;
  if (body.followupDate !== undefined) patch.followup_date = body.followupDate || null;
  if (body.linkedProjectId !== undefined) patch.linked_project_id = body.linkedProjectId || null;
  if (body.notes !== undefined) patch.notes = body.notes;
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("proposals").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);

  if (body.followupDate !== undefined && data.client_id) {
    const marker = proposalMarker(id);
    try {
      const clientTasks = await listTasks({ related_type: "client", related_id: data.client_id });
      const existingTask = clientTasks.find((t) => t.notes?.includes(marker));
      if (!body.followupDate) {
        if (existingTask) {
          if (existingTask.calendar_event_id) {
            try { const { isConnected, deleteGoogleTask } = await import("@/lib/google-calendar"); if (await isConnected()) await deleteGoogleTask(existingTask.calendar_event_id); } catch { /* non-critical */ }
          }
          await deleteTask(existingTask.id);
        }
      } else {
        const followupDate: string = body.followupDate;
        const { data: clientData } = await supabase.from("clients").select("name").eq("id", data.client_id).single();
        const taskTitle = `מעקב הצעת מחיר - ${clientData?.name ?? ""}`;
        if (existingTask) {
          if (existingTask.due_date !== followupDate) {
            await patchTask(existingTask.id, { due_date: followupDate });
            if (existingTask.calendar_event_id) {
              try { const { isConnected, updateGoogleTaskDue } = await import("@/lib/google-calendar"); if (await isConnected()) await updateGoogleTaskDue(existingTask.calendar_event_id, followupDate); } catch { /* non-critical */ }
            }
          }
          if (!existingTask.calendar_event_id) {
            try { const { isConnected, createGoogleTask } = await import("@/lib/google-calendar"); if (await isConnected()) { const gt = await createGoogleTask(taskTitle, followupDate); await patchTask(existingTask.id, { calendar_event_id: gt.id }); } } catch { /* non-critical */ }
          }
        } else {
          const task = await createTask({ title: taskTitle, related_type: "client", related_id: data.client_id, due_date: followupDate, notes: `${marker}\nהצעה: ${data.title ?? ""}` });
          try { const { isConnected, createGoogleTask } = await import("@/lib/google-calendar"); if (await isConnected()) { const gt = await createGoogleTask(taskTitle, followupDate); await patchTask(task.id, { calendar_event_id: gt.id }); } } catch { /* non-critical */ }
        }
      }
    } catch { /* task management is non-critical — proposal save never fails */ }
  }
  return data as Record<string, unknown>;
}

/** Delete a proposal (its follow-up task + Google Task first, best-effort). */
export async function deleteProposal(id: string): Promise<void> {
  const marker = proposalMarker(id);
  try {
    const { data: proposal } = await supabase.from("proposals").select("client_id").eq("id", id).single();
    if (proposal?.client_id) {
      const clientTasks = await listTasks({ related_type: "client", related_id: proposal.client_id });
      const followupTask = clientTasks.find((t) => t.notes?.includes(marker));
      if (followupTask) {
        if (followupTask.calendar_event_id) {
          try { const { isConnected, deleteGoogleTask } = await import("@/lib/google-calendar"); if (await isConnected()) await deleteGoogleTask(followupTask.calendar_event_id); } catch { /* non-critical */ }
        }
        await deleteTask(followupTask.id);
      }
    }
  } catch { /* cleanup is non-critical — proceed with deletion */ }
  const { error } = await supabase.from("proposals").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type ConvertResult = { status: "ok"; project: Awaited<ReturnType<typeof createProject>> } | { status: "not_found" } | { status: "already_converted"; projectId: string } | { status: "busy" };

/**
 * Convert a proposal into a project (status נסגר, agreed price saved when amount > 0, follow-up task closed).
 * HARDENED: a compare-and-swap claim on updated_at before creating anything, so two concurrent submits can never
 * create two projects (the second one gets "busy" / "already_converted").
 */
export async function convertProposal(id: string, overrideName?: string): Promise<ConvertResult> {
  const { data: proposal, error: fetchErr } = await supabase.from("proposals").select("*, clients(name)").eq("id", id).single();
  if (fetchErr || !proposal) return { status: "not_found" };
  if (proposal.linked_project_id) return { status: "already_converted", projectId: proposal.linked_project_id as string };
  const claimAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase.from("proposals").update({ updated_at: claimAt }).eq("id", id).is("linked_project_id", null).eq("updated_at", proposal.updated_at).select("id");
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed || claimed.length !== 1) return { status: "busy" };

  const clientName = (proposal.clients as { name: string } | null)?.name ?? "";
  const today = new Date().toISOString().split("T")[0];
  // B2: the Owner classification rule applies to a converted proposal too (the same rule as createClientProject).
  const { newProjectBusinessType } = await import("@/lib/project-classification-server");
  const { businessType } = await newProjectBusinessType(clientName);
  const project = await createProject({ name: overrideName ?? proposal.title, artist: clientName, status: "לא התחיל", start_date: today, deadline: null, notes: proposal.notes || "", project_type: "", parent_project: "", project_business_type: businessType });
  if (clientName) upsertArtistsFromProject(clientName).catch(() => {});
  if (Number(proposal.amount) > 0) {
    // compare-and-swap merge (lib/writes/settings-merge): never overwrites a concurrent finance-settings write
    const { mergeSettingsKey } = await import("@/lib/writes/settings-merge");
    await mergeSettingsKey(`finance_${project.id}`, (existing) => ({ financialNotes: "", ...existing, agreedPrice: Number(proposal.amount), currency: proposal.currency ?? "₪" }));
  }
  await supabase.from("proposals").update({ status: "נסגר", linked_project_id: project.id, updated_at: new Date().toISOString() }).eq("id", id);
  try {
    const clientId = proposal.client_id as string | null;
    if (clientId) {
      const clientTasks = await listTasks({ related_type: "client", related_id: clientId });
      const followupTask = clientTasks.find((t) => t.notes?.includes(proposalMarker(id)));
      if (followupTask && followupTask.status !== "בוצע") {
        await patchTask(followupTask.id, { status: "בוצע" });
        if (followupTask.calendar_event_id) {
          try { const { isConnected, updateGoogleTaskStatus } = await import("@/lib/google-calendar"); if (await isConnected()) await updateGoogleTaskStatus(followupTask.calendar_event_id, true); } catch { /* non-critical */ }
        }
      }
    }
  } catch { /* non-critical */ }
  return { status: "ok", project };
}

/** A proposal's live fields (for previews / fingerprints / verification). */
export async function readProposal(id: string): Promise<{ clientId: string | null; clientName: string; title: string; amount: number; currency: string; status: string; sentDate: string | null; followupDate: string | null; notes: string; linkedProjectId: string | null } | null> {
  const { data, error } = await supabase.from("proposals").select("*, clients(name)").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { clientId: data.client_id ?? null, clientName: (data.clients as { name: string } | null)?.name ?? "", title: data.title ?? "", amount: Number(data.amount) || 0, currency: data.currency ?? "₪", status: data.status ?? "", sentDate: data.sent_date ?? null, followupDate: data.followup_date ?? null, notes: data.notes ?? "", linkedProjectId: data.linked_project_id ?? null };
}

/** The link target must be a real project (LINK_PROPOSAL hardening: the route never checked the id). */
export async function projectExists(id: string): Promise<boolean> {
  const { data, error } = await supabase.from("projects").select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}
