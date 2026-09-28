import "server-only";
/**
 * Business unit — the FACTS the pure rule (lib/business-unit.ts) needs, read-only: whether a show's artist is on the
 * Records roster, and a project's stored business type / external-client Red Films production / Owner-decided units.
 * No decision is made here.
 */
import { supabase } from "@/lib/supabase";
import { singleArtistToken } from "@/lib/artist-balance-show-sync-pure";
import { isBusinessUnit, type UnitInput } from "@/lib/business-unit";

/** A show's artist is a Records roster artist (exact single name on label_artists; a collab is never attributed). */
export async function showArtistIsRecords(showId: string): Promise<boolean> {
  const { data: show, error } = await supabase.from("shows").select("artist").eq("id", showId).maybeSingle();
  if (error) throw new Error(error.message);
  const token = singleArtistToken((show?.artist as string | null) ?? "");
  if (!token) return false;
  const { data: artist, error: aErr } = await supabase.from("label_artists").select("id").eq("name", token).maybeSingle();
  if (aErr) throw new Error(aErr.message);
  return !!artist;
}

/** The project facts the rule needs. `excludeTxId` = the row being (re)classified, never its own precedent. */
export async function projectUnitContext(projectId: string, excludeTxId?: string | null): Promise<NonNullable<UnitInput["project"]> | null> {
  const [{ data: p, error }, { data: rf, error: rfErr }, { data: decided, error: dErr }] = await Promise.all([
    supabase.from("projects").select("project_business_type").eq("id", projectId).maybeSingle(),
    supabase.from("red_films_productions").select("id, client_source, status").eq("project_id", projectId),
    supabase.from("transactions").select("id, business_unit, business_unit_source").eq("project_id", projectId),
  ]);
  if (error) throw new Error(error.message);
  if (rfErr) throw new Error(rfErr.message);
  if (dErr) throw new Error(dErr.message);
  if (!p) return null;
  const units = ((decided ?? []) as Array<{ id: string; business_unit: string | null; business_unit_source: string | null }>).filter((r) => r.id !== excludeTxId && r.business_unit_source === "OWNER_DECISION").map((r) => r.business_unit).filter(isBusinessUnit);
  return { businessType: (p.project_business_type as string | null) ?? null, hasExternalClipProduction: ((rf ?? []) as Array<{ client_source?: string | null; status?: string | null }>).some((r) => r.client_source === "לקוח חיצוני" && r.status !== "בוטל"), ownerDecidedUnits: units };
}
