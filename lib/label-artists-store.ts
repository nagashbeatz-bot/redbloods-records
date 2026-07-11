import "server-only";
import { supabase } from "./supabase";
import type { LabelArtist, LabelArtistStatus } from "./types";

interface DbLabelArtist {
  id:         string;
  name:       string;
  status:     string;
  image_url:  string | null;
  notes:      string;
  created_at: string;
  updated_at: string;
}

function mapArtist(db: DbLabelArtist): LabelArtist {
  return {
    id:        db.id,
    name:      db.name,
    status:    db.status as LabelArtistStatus,
    imageUrl:  db.image_url ?? null,
    notes:     db.notes ?? "",
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

export async function listLabelArtists(): Promise<LabelArtist[]> {
  const { data, error } = await supabase
    .from("label_artists")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as DbLabelArtist[]).map(mapArtist);
}

export async function getLabelArtist(id: string): Promise<LabelArtist | null> {
  const { data, error } = await supabase
    .from("label_artists")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapArtist(data as DbLabelArtist) : null;
}

/** Look up a label artist by exact name (used server-side to resolve Shalev). */
export async function getLabelArtistByName(name: string): Promise<LabelArtist | null> {
  const { data, error } = await supabase
    .from("label_artists")
    .select("*")
    .eq("name", name)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapArtist(data as DbLabelArtist) : null;
}

export type CreateArtistResult =
  | { status: "ok"; artist: LabelArtist }
  | { status: "duplicate" };

/** Create a label artist. Duplicate normalized name → { status: "duplicate" }. */
export async function createLabelArtist(fields: {
  name: string; status?: LabelArtistStatus; imageUrl?: string | null; notes?: string;
}): Promise<CreateArtistResult> {
  const { data, error } = await supabase
    .from("label_artists")
    .insert({
      name:      fields.name,
      status:    fields.status ?? "פעיל",
      image_url: fields.imageUrl ?? null,
      notes:     fields.notes ?? "",
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation on the normalized-name index
    if (error.code === "23505") return { status: "duplicate" };
    throw new Error(error.message);
  }
  return { status: "ok", artist: mapArtist(data as DbLabelArtist) };
}

/** Patch editable artist fields (name / status / image_url / notes). */
export async function updateLabelArtist(
  id: string,
  patch: { name?: string; status?: LabelArtistStatus; imageUrl?: string | null; notes?: string },
): Promise<{ status: "ok" } | { status: "not_found" } | { status: "duplicate" }> {
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name     !== undefined) set.name = patch.name;
  if (patch.status   !== undefined) set.status = patch.status;
  if (patch.imageUrl !== undefined) set.image_url = patch.imageUrl || null;
  if (patch.notes    !== undefined) set.notes = patch.notes ?? "";

  const { data, error } = await supabase
    .from("label_artists")
    .update(set)
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === "23505") return { status: "duplicate" };
    throw new Error(error.message);
  }
  return data && data.length > 0 ? { status: "ok" } : { status: "not_found" };
}
