import "server-only";
import { supabase } from "./supabase";
import { CLIP_SCOPE } from "./clip-finance";
import { mergeSettingsKey } from "./writes/settings-merge";

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
 *  2. "Was this production created by the project's 'שלח קליפ'?" → the managed marker
 *     Answered from settings["finance_<projectId>"].clipProductionId, which is
 *     written ONLY when "שלח קליפ" creates the production. That marker is the
 *     PROVENANCE record of the flow — nothing more.
 *
 * B3 (Owner canon 2026-09-27): the client clip price (A) is never the planned budget (B). The price → budget sync
 * and the budget lock are RETIRED: every production — managed or legacy — owns its own planning budget and currency.
 * A managed production created before B3 may still carry a budget equal to the clip price (the old sync); readers
 * report that as a DERIVED observation (lib/clip-rf-money-pure budgetEqualsOldClipPriceSync), never as a rule.
 */

export interface LinkedClipProduction {
  id: string;
  title: string;
  status: string;
  general_budget: number | null;
  production_type: string | null;
  project_id: string | null;
  /** The production's own currency (general_budget is in it; migration 2026-09-27). */
  currency: string | null;
}

const PRODUCTION_FIELDS = "id, title, status, general_budget, production_type, project_id, currency";

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
  // Compare-and-swap merge (lib/writes/settings-merge.ts): never overwrites a concurrent finance-settings write.
  await mergeSettingsKey(`finance_${projectId}`, { clipProductionId: productionId });
}

/**
 * The production the project's 'שלח קליפ' created — the marked one, and only if it
 * still exists and is not cancelled. Returns null for legacy links. Provenance only.
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
 * Was THIS production created by its linked project's 'שלח קליפ'? Provenance only (B3: no budget lock).
 * False for every legacy production.
 */
export async function isManagedClipProduction(production: {
  id: string;
  project_id?: string | null;
}): Promise<boolean> {
  if (!production.project_id) return false;
  const managedId = await getManagedClipProductionId(production.project_id);
  return managedId === production.id;
}

// syncClipBudget (price → budget) and its currency helper were removed in B3 — the clip price never writes the budget.
