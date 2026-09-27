/**
 * Shared writers for the project send log (project_actions — "who waits for whom") and album tracks. Used by BOTH the
 * routes and Sunny's typed primitives; route bodies moved verbatim. HARDENED (2026-09-27, Universal Actions):
 *   • deleteSendLogEntryWithCascade runs the drawer's cascade on the SERVER (it used to run in the browser): an
 *     engineer send removes its sound-engineer work (lib/writes/mix — its UNPAID expense goes, a paid one stays); a
 *     Victor send removes its follow-up task (+ Google Task) and its Victor work (lib/writes/victor); then the entry.
 *     A Victor-looking entry without a linked work deletes the entry only — never guessed by project / title / date.
 *   • album finance (legacy blob, no screen): the PATCH accepts only its five known keys with checked types — it used to
 *     merge the whole request body into the settings value.
 */
import { supabase } from "@/lib/supabase";
import type { AlbumFinanceData, AlbumPrevInfo } from "@/lib/types";

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

// ── album settings: previous-system info (Owner screen) + the legacy finance blob (no screen) ──
const PREV_EMPTY: AlbumPrevInfo = { rows: [], note: "" };
const prevKey = (projectId: string) => `album_prev_info_${projectId}`;
export async function readAlbumPrevInfo(projectId: string): Promise<AlbumPrevInfo> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", prevKey(projectId)).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value as AlbumPrevInfo) ?? PREV_EMPTY;
}
/** PATCH /api/album-prev-info semantics: rows normalized (numbers coerced, only stored fields kept), note, updatedAt. */
export async function saveAlbumPrevInfo(projectId: string, body: Partial<AlbumPrevInfo>): Promise<AlbumPrevInfo> {
  const rows: AlbumPrevInfo["rows"] = Array.isArray(body.rows)
    ? body.rows.map((r) => ({ id: String(r?.id ?? crypto.randomUUID()), name: typeof r?.name === "string" ? r.name : "", costWithoutMix: Number(r?.costWithoutMix) || 0, mixMaster: Number(r?.mixMaster) || 0, paid: Number(r?.paid) || 0 }))
    : [];
  const value: AlbumPrevInfo = { rows, note: typeof body.note === "string" ? body.note : "", updatedAt: new Date().toISOString() };
  const { error } = await supabase.from("settings").upsert({ key: prevKey(projectId), value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return value;
}
const FIN_EMPTY: AlbumFinanceData = { agreed: 0, currency: "₪", notes: "", payments: [], expenses: [] };
export class AlbumInputError extends Error {}
/** PATCH /api/album-finance — HARDENED: only agreed (≥ 0), currency (₪ / $), notes, payments[], expenses[]. */
export async function patchAlbumFinance(projectId: string, body: Record<string, unknown>): Promise<AlbumFinanceData> {
  const allowed = ["agreed", "currency", "notes", "payments", "expenses"];
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw new AlbumInputError(`שדות לא מותרים: ${extra.join(", ")}`);
  if (body.agreed !== undefined && !(Number.isFinite(Number(body.agreed)) && Number(body.agreed) >= 0)) throw new AlbumInputError("agreed לא תקין");
  if (body.currency !== undefined && body.currency !== "₪" && body.currency !== "$") throw new AlbumInputError("currency: ₪ / $");
  if (body.notes !== undefined && typeof body.notes !== "string") throw new AlbumInputError("notes לא תקין");
  for (const k of ["payments", "expenses"]) if (body[k] !== undefined && !Array.isArray(body[k])) throw new AlbumInputError(`${k} חייב להיות רשימה`);
  const { data: existing } = await supabase.from("settings").select("value").eq("key", `album_finance_${projectId}`).maybeSingle();
  const merged: AlbumFinanceData = { ...FIN_EMPTY, ...((existing?.value as object) ?? {}), ...(body as Partial<AlbumFinanceData>), ...(body.agreed !== undefined ? { agreed: Number(body.agreed) } : {}) };
  const { error } = await supabase.from("settings").upsert({ key: `album_finance_${projectId}`, value: merged }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return merged;
}
