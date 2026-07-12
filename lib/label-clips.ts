import "server-only";
import { supabase } from "./supabase";
import { parseArtistNames } from "./clients-store";

/** Round to 2 decimals (money-safe). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Canonical per-clip split — label half rounded, artist recoup = the complement. */
export function clipSplit(budget: number): { labelInvestment: number; artistRecoupTarget: number } {
  const b = round2(budget);
  const labelInvestment = round2(b / 2);
  const artistRecoupTarget = round2(b - labelInvestment);
  return { labelInvestment, artistRecoupTarget };
}

export interface ArtistClip {
  id: string; title: string; status: string; projectId: string | null;
  fullBudget: number; labelInvestment: number; artistRecoupTarget: number;
}

/** Active clip productions for an artist (production_type="קליפ", not cancelled), matched by name. */
export async function listArtistClips(artistName: string): Promise<ArtistClip[]> {
  const { data, error } = await supabase
    .from("red_films_productions")
    .select("id, title, status, project_id, artist_name, production_type, general_budget");
  if (error) throw new Error(error.message);

  const out: ArtistClip[] = [];
  for (const p of data ?? []) {
    const prod = p as { id: string; title: string; status: string; project_id: string | null; artist_name: string | null; production_type: string | null; general_budget: number | null };
    if (prod.production_type !== "קליפ") continue;
    if (prod.status === "בוטל") continue;
    if (!parseArtistNames(prod.artist_name || "").includes(artistName)) continue;
    const fullBudget = round2(Number(prod.general_budget) || 0);
    const s = clipSplit(fullBudget);
    out.push({ id: prod.id, title: prod.title, status: prod.status, projectId: prod.project_id, fullBudget, labelInvestment: s.labelInvestment, artistRecoupTarget: s.artistRecoupTarget });
  }
  return out;
}

/** recoupTarget = Σ artistRecoupTarget of the artist's active clips (single source rule). */
export async function getRecoupTargetForArtist(artistName: string): Promise<number> {
  const clips = await listArtistClips(artistName);
  return round2(clips.reduce((s, c) => s + c.artistRecoupTarget, 0));
}
