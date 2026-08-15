import "server-only";
import { supabase } from "./supabase";
import { CLIP_SCOPE } from "./clip-finance";

/**
 * Server-side helpers linking a Project's clip deal to its Red Films production.
 *
 * TWO DIFFERENT QUESTIONS, deliberately kept apart:
 *
 *  1. "Does this project already have a clip production?"  → findLinkedClipProduction
 *     Answered from red_films_productions.project_id. Used only to avoid creating
 *     a SECOND production and to offer "פתח ב-Red Films". It says nothing about
 *     who owns the budget.
 *
 *  2. "Is this production managed by the project's clip deal?" → the managed marker
 *     Answered from settings["finance_<projectId>"].clipProductionId, which is
 *     written ONLY when "שלח קליפ" creates the production. That marker is the
 *     provenance record for the new flow.
 *
 * The distinction exists because a production may carry a project_id and still be
 * a legacy Red Films production created long before the clip deal existed. Those
 * keep their own budget: never synced, never locked, never migrated. Only
 * productions born from "שלח קליפ" follow the project's clipAgreedPrice.
 */

export interface LinkedClipProduction {
  id: string;
  title: string;
  status: string;
  general_budget: number | null;
  production_type: string | null;
  project_id: string | null;
}

const PRODUCTION_FIELDS = "id, title, status, general_budget, production_type, project_id";

/**
 * Any clip production linked to a project — legacy ones included. Cancelled
 * productions are ignored so a cancelled attempt never blocks a new one.
 * Oldest-first so the answer stays stable if duplicates somehow exist.
 */
export async function findLinkedClipProduction(projectId: string): Promise<LinkedClipProduction | null> {
  const { data, error } = await supabase
    .from("red_films_productions")
    .select(PRODUCTION_FIELDS)
    .eq("project_id", projectId)
    .eq("production_type", CLIP_SCOPE)
    .neq("status", "בוטל")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as LinkedClipProduction | undefined) ?? null;
}

/** The production id recorded when "שלח קליפ" created it, or null for legacy/none. */
export async function getManagedClipProductionId(projectId: string): Promise<string | null> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", `finance_${projectId}`)
    .maybeSingle();
  const val = (data?.value ?? {}) as Record<string, unknown>;
  const id = val.clipProductionId;
  return typeof id === "string" && id ? id : null;
}

/**
 * Record the production this project's clip deal owns. Called once, right after
 * "שלח קליפ" creates it. Merges into the finance blob so agreedPrice and the
 * rest are preserved. Never called for a production the flow did not create.
 */
export async function setManagedClipProductionId(projectId: string, productionId: string): Promise<void> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", `finance_${projectId}`)
    .maybeSingle();
  const existing = (data?.value ?? {}) as Record<string, unknown>;
  await supabase
    .from("settings")
    .upsert({ key: `finance_${projectId}`, value: { ...existing, clipProductionId: productionId } }, { onConflict: "key" });
}

/**
 * The production whose budget this project owns — the marked one, and only if it
 * still exists and is not cancelled. Returns null for legacy links.
 */
export async function getManagedClipProduction(projectId: string): Promise<LinkedClipProduction | null> {
  const managedId = await getManagedClipProductionId(projectId);
  if (!managedId) return null;
  const { data } = await supabase
    .from("red_films_productions")
    .select(PRODUCTION_FIELDS)
    .eq("id", managedId)
    .maybeSingle();
  const prod = data as LinkedClipProduction | null;
  if (!prod || prod.status === "בוטל") return null;
  return prod;
}

/**
 * Is THIS production budget-managed by its linked project? Used by the Red Films
 * PATCH guard and by the UI lock. False for every legacy production.
 */
export async function isManagedClipProduction(production: {
  id: string;
  project_id?: string | null;
}): Promise<boolean> {
  if (!production.project_id) return false;
  const managedId = await getManagedClipProductionId(production.project_id);
  return managedId === production.id;
}

/**
 * Push the project's agreed clip price onto the budget of the production it
 * manages. One-way by design, and ONLY for a production created by "שלח קליפ" —
 * a legacy production's budget is never touched from here.
 */
export async function syncClipBudget(projectId: string, price: number): Promise<{ productionId: string; general_budget: number } | null> {
  const production = await getManagedClipProduction(projectId);
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
