/**
 * Shared validated client writers — used by BOTH the client routes and Sunny's typed primitives.
 * saveClient is the route's exact behaviour (full-record update + project-artist rename cascade). Sunny's field-level
 * primitives read the current record and merge ONLY the changed fields before calling it, so nothing is ever blanked.
 */
import { supabase } from "@/lib/supabase";
import { createClient, deleteClient, getClient, updateClient } from "@/lib/clients-store";

export interface ClientRecord { name: string; phone: string; email: string; type: string; status: string; notes: string }

/** Create a client the way the Clients page does (defaults: type לקוח, status חדש). DB rejects a duplicate name. */
export async function createClientRecord(b: Partial<ClientRecord> & { name: string }) {
  return createClient({ name: b.name.trim(), phone: b.phone?.trim() ?? "", email: b.email?.trim() ?? "", type: (b.type ?? "לקוח") as never, status: (b.status ?? "חדש") as never, notes: b.notes ?? "" });
}

const splitArtists = (a: string) => a.split(/[,،;]/).map((x) => x.trim());
/** Projects whose artist text names this client (case-insensitive, per name in a comma list) — the rename cascade set. */
export async function projectsNamingArtist(name: string): Promise<Array<{ id: string; name: string; artist: string }>> {
  if (!name.trim()) return [];
  const { data, error } = await supabase.from("projects").select("id, name, artist");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; name: string; artist: string }>).filter((p) => !!p.artist && splitArtists(p.artist).some((a) => a.toLowerCase() === name.trim().toLowerCase()));
}

/** Full-record save (the route's semantics: omitted fields default) + rename cascade into matching project artists. */
export async function saveClient(id: string, f: Partial<ClientRecord> & { name: string }): Promise<{ syncedProjects?: number; syncWarning?: string }> {
  const newName = f.name.trim();
  const existing = await getClient(id);
  const oldName = existing?.name?.trim() ?? "";
  await updateClient(id, { name: newName, phone: f.phone?.trim() || "", email: f.email?.trim() || "", type: (f.type || "אחר") as never, status: (f.status || "חדש") as never, notes: f.notes?.trim() || "" });
  if (!oldName || oldName === newName) return {};
  try {
    const toUpdate = await projectsNamingArtist(oldName);
    const results = await Promise.allSettled(toUpdate.map(async (p) => {
      const updatedArtist = splitArtists(p.artist).map((a) => (a.toLowerCase() === oldName.toLowerCase() ? newName : a)).join(", ");
      const { error } = await supabase.from("projects").update({ artist: updatedArtist, updated_at: new Date().toISOString() }).eq("id", p.id);
      if (error) throw new Error(error.message);
    }));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) return { syncedProjects: toUpdate.length - failed.length, syncWarning: (failed[0] as PromiseRejectedResult).reason?.message || "unknown" };
    return { syncedProjects: toUpdate.length };
  } catch (syncErr) {
    return { syncWarning: syncErr instanceof Error ? syncErr.message : "sync error" };
  }
}

/** Field-level edit: merges the given fields into the CURRENT record (nothing blanked), then saveClient. */
export async function patchClient(id: string, patch: Partial<ClientRecord>) {
  const cur = await getClient(id);
  if (!cur) throw new Error("client not found");
  const merged: ClientRecord = { name: cur.name ?? "", phone: cur.phone ?? "", email: cur.email ?? "", type: (cur.type as string) ?? "", status: (cur.status as string) ?? "", notes: cur.notes ?? "", ...patch };
  return saveClient(id, merged);
}

/** What is linked to a client (preview of a delete): projects naming them, proposals (DB CASCADE), meetings, tasks. */
export async function countClientLinks(id: string): Promise<{ projects: number; proposals: number; meetings: number; tasks: number }> {
  const cur = await getClient(id);
  const [pr, me, ta] = await Promise.all([
    supabase.from("proposals").select("id", { count: "exact", head: true }).eq("client_id", id),
    supabase.from("meetings").select("id", { count: "exact", head: true }).eq("client_id", id),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("related_type", "client").eq("related_id", id),
  ]);
  for (const r of [pr, me, ta]) if (r.error) throw new Error(r.error.message);
  return { projects: cur ? (await projectsNamingArtist(cur.name ?? "")).length : 0, proposals: pr.count ?? 0, meetings: me.count ?? 0, tasks: ta.count ?? 0 };
}

/**
 * Delete a client. HARDENED (2026-09-27, Universal Actions): the DB cascades the client's proposals, which used to
 * leave their follow-up tasks (and Google Tasks) behind. Each proposal is now deleted through deleteProposal first
 * (follow-up task + Google Task removed), then the client. Meetings / other tasks keep their stored id (no FK).
 */
export async function deleteClientRecord(id: string): Promise<{ proposalsDeleted: number }> {
  const { deleteProposal } = await import("@/lib/writes/proposals");
  const { data, error } = await supabase.from("proposals").select("id").eq("client_id", id);
  if (error) throw new Error(error.message);
  for (const p of (data ?? []) as Array<{ id: string }>) await deleteProposal(p.id);
  await deleteClient(id);
  return { proposalsDeleted: (data ?? []).length };
}

/** Clients whose name equals this one (trim, case-insensitive) — the app refuses a duplicate client name. */
export async function countClientsNamed(name: string): Promise<number> {
  const { data, error } = await supabase.from("clients").select("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ name: string | null }>).filter((c) => (c.name ?? "").trim().toLowerCase() === name.trim().toLowerCase()).length;
}
