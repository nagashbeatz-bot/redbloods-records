import "server-only";
import { supabase } from "./supabase";
import { CLIP_SCOPE } from "./clip-finance";

/**
 * Server-side helpers linking a Project's clip deal to its Red Films production.
 * The link itself is the pre-existing red_films_productions.project_id column —
 * no new table, no new field.
 */

export interface LinkedClipProduction {
  id: string;
  title: string;
  status: string;
  general_budget: number | null;
  production_type: string | null;
  project_id: string | null;
}

/**
 * The ONE clip production linked to a project. Cancelled productions ("בוטל")
 * are ignored so a cancelled attempt never blocks a new one. Oldest-first so the
 * answer is stable even if duplicates somehow exist — the duplicate guard and
 * this lookup then always agree on the same row.
 */
export async function findLinkedClipProduction(projectId: string): Promise<LinkedClipProduction | null> {
  const { data, error } = await supabase
    .from("red_films_productions")
    .select("id, title, status, general_budget, production_type, project_id")
    .eq("project_id", projectId)
    .eq("production_type", CLIP_SCOPE)
    .neq("status", "בוטל")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as LinkedClipProduction | undefined) ?? null;
}

/**
 * Push the project's agreed clip price onto the linked production's budget.
 * One-way by design: the project is the source of truth for the price, Red Films
 * owns how that budget is spent. Never creates a production.
 */
export async function syncClipBudget(projectId: string, price: number): Promise<{ productionId: string; general_budget: number } | null> {
  const production = await findLinkedClipProduction(projectId);
  if (!production) return null;
  const { data } = await supabase
    .from("red_films_productions")
    .update({ general_budget: price, updated_at: new Date().toISOString() })
    .eq("id", production.id)
    .select("id, general_budget")
    .maybeSingle();
  if (!data) return null;
  return { productionId: data.id as string, general_budget: (data.general_budget as number) ?? price };
}
