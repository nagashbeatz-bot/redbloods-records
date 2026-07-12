import "server-only";
import { supabase } from "./supabase";

export type ClientType   = "אמן" | "לקוח" | "איש צוות" | "אחר";
export type ClientStatus = "פעיל" | "לא פעיל" | "בעייתי" | "VIP" | "חדש";

export interface Client {
  id:         string;
  name:       string;
  phone:      string;
  email:      string;
  type:       ClientType;
  status:     ClientStatus;
  notes:      string;
  created_at?: string;
}

export async function listClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data as Client[];
}

export async function createClient(fields: Omit<Client, "id" | "created_at">): Promise<Client> {
  const { data, error } = await supabase
    .from("clients")
    .insert(fields)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Client;
}

export async function getClient(id: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return data as Client;
}

export async function updateClient(id: string, fields: Omit<Client, "id" | "created_at">): Promise<void> {
  const { error } = await supabase
    .from("clients")
    .update(fields)
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}

/** Parse a raw comma/semicolon-separated artist string into individual names */
export function parseArtistNames(raw: string): string[] {
  return raw.split(/[,،;]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * After removing artists from a project, delete any "אמן" clients
 * whose name no longer appears in ANY project.
 * Safe: only touches clients with type="אמן" (won't delete manually-added clients).
 */
export async function removeArtistsIfOrphaned(names: string[]): Promise<void> {
  if (names.length === 0) return;

  // Collect every artist name currently in any project
  const { data: projects } = await supabase.from("projects").select("artist");
  const allProjectArtists = new Set(
    (projects ?? []).flatMap((p: { artist: string }) => parseArtistNames(p.artist || ""))
  );

  // Only remove names that are no longer referenced by any project
  const toRemove = names.filter((n) => !allProjectArtists.has(n));
  if (toRemove.length === 0) return;

  await supabase
    .from("clients")
    .delete()
    .in("name", toRemove)
    .eq("type", "אמן"); // Safety: never auto-delete manually-created clients
}

/**
 * Given a raw artist string (comma/semicolon separated),
 * ensure every named artist exists in the clients table.
 * Creates missing ones with type "אמן" and status "חדש".
 * Silently skips names that already exist (matched by trimmed name).
 */
export async function upsertArtistsFromProject(rawArtist: string): Promise<void> {
  const names = rawArtist
    .split(/[,،;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (names.length === 0) return;

  // Fetch all existing client names in one query
  const { data: existing } = await supabase
    .from("clients")
    .select("name")
    .in("name", names);

  const existingNames = new Set((existing ?? []).map((c: { name: string }) => c.name));

  const toCreate = names.filter((n) => !existingNames.has(n));
  if (toCreate.length === 0) return;

  await supabase.from("clients").insert(
    toCreate.map((name) => ({
      name,
      phone:  "",
      email:  "",
      type:   "אמן" as ClientType,
      status: "חדש" as ClientStatus,
      notes:  "",
    }))
  );
  // Ignore insert errors (race conditions, duplicates) — best effort
}
