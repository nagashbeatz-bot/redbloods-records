/**
 * Shared writers for the project send log (project_actions — "who waits for whom") and album tracks. Used by BOTH the
 * routes and Sunny's typed primitives; route bodies moved verbatim. HARDENED (2026-09-27, Universal Actions):
 *   • deleteSendLogEntryWithCascade runs the drawer's cascade on the SERVER (it used to run in the browser): an
 *     engineer send removes its sound-engineer work (lib/writes/mix — its UNPAID expense goes, a paid one stays); a
 *     Victor send removes its follow-up task (+ Google Task) and its Victor work (lib/writes/victor); then the entry.
 *     A Victor-looking entry without a linked work deletes the entry only — never guessed by project / title / date.
 */
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

export async function createSendLogEntry(body: Body): Promise<Record<string, unknown>> {
  const { projectId, actionType, contentType, versionLabel, recipientRole, recipientName, recipientClientId, recipientPhone, dropboxUrl, status, actionDate, followupDate, notes, linkedWorkId } = body;
  if (!projectId) throw new Error("projectId חסר");
  if (!actionType) throw new Error("actionType חסר");
  const { data, error } = await supabase.from("project_actions").insert({
    project_id: projectId, action_type: actionType, content_type: contentType || null, version_label: versionLabel || null, recipient_role: recipientRole || null,
    recipient_name: recipientName || null, recipient_client_id: recipientClientId || null, recipient_phone: recipientPhone || null, dropbox_url: dropboxUrl || null,
    status: status || "pending_feedback", action_date: actionDate || new Date().toISOString().slice(0, 10), followup_date: followupDate || null, notes: notes || null, linked_work_id: linkedWorkId || null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export async function updateSendLogEntry(id: string, body: Body): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.actionType !== undefined) patch.action_type = body.actionType;
  if (body.contentType !== undefined) patch.content_type = body.contentType || null;
  if (body.versionLabel !== undefined) patch.version_label = body.versionLabel || null;
  if (body.recipientRole !== undefined) patch.recipient_role = body.recipientRole || null;
  if (body.recipientName !== undefined) patch.recipient_name = body.recipientName || null;
  if (body.recipientPhone !== undefined) patch.recipient_phone = body.recipientPhone || null;
  if (body.dropboxUrl !== undefined) patch.dropbox_url = body.dropboxUrl || null;
  if (body.status !== undefined) patch.status = body.status;
  if (body.actionDate !== undefined) patch.action_date = body.actionDate;
  if (body.followupDate !== undefined) patch.followup_date = body.followupDate || null;
  if (body.notes !== undefined) patch.notes = body.notes || null;
  if (body.linkedTaskId !== undefined) patch.linked_task_id = body.linkedTaskId || null;
  if (body.linkedWorkId !== undefined) patch.linked_work_id = body.linkedWorkId || null;
  const { data, error } = await supabase.from("project_actions").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

/** DELETE /api/project-actions/[id] — the entry only (the drawer calls the cascade separately; Sunny uses the cascade). */
export async function deleteSendLogEntry(id: string): Promise<void> {
  const { error } = await supabase.from("project_actions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function readSendLogEntry(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from("project_actions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as Record<string, unknown> | null;
}

/** HARDENED: the drawer's cascade, server-side. */
export async function deleteSendLogEntryWithCascade(id: string): Promise<{ cascade: "engineer_work" | "victor_work" | "none" }> {
  const a = await readSendLogEntry(id);
  if (!a) throw new Error("entry not found");
  const linkedWorkId = (a.linked_work_id as string | null) ?? null;
  let cascade: "engineer_work" | "victor_work" | "none" = "none";
  if (linkedWorkId && a.recipient_role === "sound_engineer") {
    const { deleteEngineerWorkClean } = await import("@/lib/writes/mix");
    await deleteEngineerWorkClean(linkedWorkId);
    cascade = "engineer_work";
  } else if (linkedWorkId) {
    const { getVictorWorkById } = await import("@/lib/vendor-store");
    if (await getVictorWorkById(linkedWorkId)) {
      const { removeVictorWork } = await import("@/lib/writes/victor");
      await removeVictorWork(linkedWorkId);
    }
    cascade = "victor_work";
  }
  await deleteSendLogEntry(id);
  return { cascade };
}

// ── album tracks ──
export async function createAlbumTrack(body: Body): Promise<Record<string, unknown>> {
  if (!body.project_id || !body.title || body.track_number == null) throw new Error("חסרים שדות חובה");
  const { data, error } = await supabase.from("album_tracks").insert({
    project_id: body.project_id, track_number: body.track_number, title: body.title, status: body.status ?? "טרום הקלטה",
    mix_status: body.mix_status ?? "לא התחיל", master_status: body.master_status ?? "לא התחיל", notes: body.notes ?? null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}
const TRACK_ALLOWED = ["title", "track_number", "status", "mix_status", "master_status", "notes"];
export async function updateAlbumTrack(id: string, body: Body): Promise<Record<string, unknown> | null> {
  const patch: Record<string, unknown> = {};
  for (const key of TRACK_ALLOWED) if (key in body) patch[key] = body[key];
  if (Object.keys(patch).length === 0) return null;
  const { data, error } = await supabase.from("album_tracks").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}
export async function deleteAlbumTrack(id: string): Promise<void> {
  const { error } = await supabase.from("album_tracks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
/** POST /api/album-tracks/reorder semantics (two passes to dodge the unique number; not atomic — reported). */
export async function renumberAlbumTracks(tracks: Array<{ id: string; track_number: number }>): Promise<void> {
  for (const t of tracks) { const { error } = await supabase.from("album_tracks").update({ track_number: t.track_number + 10000 }).eq("id", t.id); if (error) throw new Error(error.message); }
  for (const t of tracks) { const { error } = await supabase.from("album_tracks").update({ track_number: t.track_number }).eq("id", t.id); if (error) throw new Error(error.message); }
}
export async function readAlbumTrack(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from("album_tracks").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as Record<string, unknown> | null;
}
export async function albumTrackOrder(projectId: string): Promise<Array<{ id: string; track_number: number }>> {
  const { data, error } = await supabase.from("album_tracks").select("id, track_number").eq("project_id", projectId).order("track_number", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; track_number: number }>;
}
