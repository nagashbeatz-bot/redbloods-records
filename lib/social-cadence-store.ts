import "server-only";
/**
 * Social stage 2 — the store of content series (social_series) and weekly targets (social_cadence_targets, APPEND-ONLY:
 * the DB refuses UPDATE / DELETE; a change is a new row that supersedes). Only lib/writes/social calls the writes here.
 */
import { supabase } from "./supabase";
import type { CadenceTargetRow, SeriesRow } from "./social-cadence";

const SERIES_COLS = "id, name, owner_scope, label_artist_id, platforms, status, notes, created_at, updated_at";
const TARGET_COLS = "id, scope, label_artist_id, series_id, platform, content_type, action, per_week, valid_from, valid_until, supersedes_id, source, recommendation_id, note_he, created_at";

export async function listSeries(): Promise<SeriesRow[]> {
  const { data, error } = await supabase.from("social_series").select(SERIES_COLS).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SeriesRow[];
}
export async function getSeries(id: string): Promise<SeriesRow | null> {
  const { data, error } = await supabase.from("social_series").select(SERIES_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as SeriesRow | null) ?? null;
}
export async function insertSeries(row: Pick<SeriesRow, "name" | "owner_scope" | "label_artist_id" | "platforms" | "notes">): Promise<SeriesRow> {
  const { data, error } = await supabase.from("social_series").insert({ ...row, status: "ACTIVE" }).select(SERIES_COLS).single();
  if (error) throw error;
  return data as SeriesRow;
}
export async function patchSeries(id: string, patch: Partial<Pick<SeriesRow, "name" | "platforms" | "status" | "notes">>): Promise<SeriesRow> {
  const { data, error } = await supabase.from("social_series").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select(SERIES_COLS).single();
  if (error) throw error;
  return data as SeriesRow;
}
export async function listTargets(): Promise<CadenceTargetRow[]> {
  const { data, error } = await supabase.from("social_cadence_targets").select(TARGET_COLS).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CadenceTargetRow[];
}
export async function insertTarget(row: Omit<CadenceTargetRow, "id" | "created_at">): Promise<CadenceTargetRow> {
  const { data, error } = await supabase.from("social_cadence_targets").insert(row).select(TARGET_COLS).single();
  if (error) throw error;
  return data as CadenceTargetRow;
}
