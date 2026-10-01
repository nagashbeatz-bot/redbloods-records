/**
 * 'שלח קליפ' — the shared writer behind POST /api/projects/[id]/clip/send and Sunny's SEND_CLIP_TO_RED_FILMS: find or
 * create the project's managed Red Films production (idempotent by lookup twice). Operational only.
 * One clip model (Owner decision 2026-10-01): a clip is its own PROJECT (project_type קליפ) with ONE agreedPrice — the
 * project's finance settings; there is no clip price, no clip deal and no clip payment writer.
 * B3 (Owner canon 2026-09-27): the project's price is never the production's planned BUDGET — a new managed production
 * starts with budget 0 in the project's currency; its client_source comes from the project's classification
 * (lib/clip-rf-money-pure rfClientSourceFor), never a hard-coded "פנימי - לייבל".
 */
import { supabase } from "@/lib/supabase";
import { CLIP_SCOPE } from "@/lib/clip-finance";
import { normalizeCurrency } from "@/lib/finance/currency";
import { rfClientSourceFor } from "@/lib/clip-rf-money-pure";

async function readFinanceSettings(projectId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", `finance_${projectId}`).maybeSingle();
  if (error) throw new Error(`קריאת הגדרות הכספים של הפרויקט נכשלה: ${error.message}`); // never a default currency
  return (data?.value ?? {}) as Record<string, unknown>;
}

/** POST /api/projects/[id]/clip/send semantics. */
export async function sendClipToRedFilms(projectId: string): Promise<{ kind: "not_found" } | { kind: "ok"; production: Record<string, unknown>; created: boolean }> {
  const { findLinkedClipProduction, setManagedClipProductionId } = await import("@/lib/clip-production");
  const existing = await findLinkedClipProduction(projectId);
  if (existing) return { kind: "ok", production: existing as unknown as Record<string, unknown>, created: false };
  const { data: project } = await supabase.from("projects").select("id, name, artist, project_business_type").eq("id", projectId).maybeSingle();
  if (!project) return { kind: "not_found" };
  const settings = await readFinanceSettings(projectId);
  const artist = (project.artist as string) ?? "";
  const title = (project.name as string) ?? "קליפ";
  let clientId: string | null = null;
  let clientName = "";
  if (artist) {
    const { data: client } = await supabase.from("clients").select("id, name").eq("name", artist).maybeSingle();
    if (client) { clientId = client.id as string; clientName = client.name as string; }
  }
  const stillNone = await findLinkedClipProduction(projectId);
  if (stillNone) return { kind: "ok", production: stillNone as unknown as Record<string, unknown>, created: false };
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("red_films_productions").insert({
    title, production_type: CLIP_SCOPE, status: "רעיון", project_id: projectId, artist_name: artist, client_id: clientId, client_name: clientName,
    photographer_name: "", client_source: rfClientSourceFor({ businessType: (project.project_business_type as string | null) ?? null }), collection_status: "לא רלוונטי",
    // B3: planning starts at 0 — the project's price is never the budget. The production carries the project's
    // currency (never a silent ₪ for a $ project).
    general_budget: 0, currency: normalizeCurrency(typeof settings.currency === "string" ? settings.currency : null), created_at: now, updated_at: now,
  }).select().single();
  if (error) throw error;
  await setManagedClipProductionId(projectId, data.id as string);
  return { kind: "ok", production: { ...(data as Record<string, unknown>), budget_managed_by_project: true }, created: true };
}
