import "server-only";

/**
 * Partner-only readers — for domains lib/coo does NOT already fetch.
 * Same discipline as lib/coo/readers.ts: read-only, one bulk query per
 * source (no N+1), a failed source becomes null (never an empty array
 * pretending to be "no data").
 *
 * Reuses the existing stores (listClients, listLabelArtists) instead of
 * querying their tables directly. Clip productions have no existing
 * "list all" store function (label-clips.ts / clip-production.ts only
 * expose per-artist / per-project lookups), so this is the one genuinely
 * new bulk SELECT in this file — still read-only, still one query.
 */
import { supabase } from "@/lib/supabase";
import { listClients } from "@/lib/clients-store";
import { listLabelArtists } from "@/lib/label-artists-store";
import { getAlerts } from "@/lib/agent/alerts-store";
import type { SourceStatus } from "../../coo/types";
import type { PartnerEyesRaw } from "./types";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function readPartnerEyesRaw(): Promise<PartnerEyesRaw> {
  const results: Record<string, { ok: boolean; count: number | null; error?: string }> = {};
  const track = async <T,>(name: string, fn: () => Promise<T>, count: (v: T) => number | null): Promise<T | null> => {
    try { const v = await fn(); results[name] = { ok: true, count: count(v) }; return v; }
    catch (e) { results[name] = { ok: false, count: null, error: msg(e) }; return null; }
  };

  const [clients, labelArtists, clips, alerts] = await Promise.all([
    track("clients", async () => (await listClients()).map((c) => ({ id: c.id, name: c.name, type: c.type, status: c.status })), (v) => v.length),
    track("label_artists", async () => (await listLabelArtists()).map((a) => ({ id: a.id, name: a.name, status: a.status })), (v) => v.length),
    track("clip_productions", async () => {
      const { data, error } = await supabase
        .from("red_films_productions")
        .select("id, title, status, project_id, artist_name, production_type")
        .eq("production_type", "קליפ");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: r.id as string,
        title: (r.title as string | null) ?? "",
        status: (r.status as string | null) ?? "",
        projectId: (r.project_id as string | null) ?? null,
        artistName: (r.artist_name as string | null) ?? "",
      }));
    }, (v) => v.length),
    // Deliberately NO status filter — lib/coo's own read narrows to status="new" for the brief;
    // Eyes needs the true breadth (every status, every type). Read-only: no update/resolve/delete.
    track("agent_alerts_eyes", async () => (await getAlerts({ limit: 1000 })).map((a) => ({
      id: a.id, type: a.type, severity: a.severity, status: a.status,
      hasEntityKey: a.entityKey !== null, relatedProjectId: a.relatedProjectId, createdAt: a.createdAt,
    })), (v) => v.length),
  ]);

  // Bulk artist_id-only select, counted in JS — one query, no per-artist round trips.
  let artistBalanceCounts: Record<string, number> | null = null;
  if (labelArtists) {
    artistBalanceCounts = await track("artist_balance_entries", async () => {
      const { data, error } = await supabase.from("artist_balance_entries").select("artist_id");
      if (error) throw new Error(error.message);
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const id = row.artist_id as string;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      return counts;
    }, (v) => Object.keys(v).length);
  } else {
    results["artist_balance_entries"] = { ok: false, count: null, error: "label_artists unavailable" };
  }

  const order = ["clients", "label_artists", "clip_productions", "artist_balance_entries", "agent_alerts_eyes"];
  const sources: SourceStatus[] = order.filter((n) => results[n]).map((n) => ({
    source: n, status: results[n].ok ? "ok" : "failed", rowCount: results[n].count, ...(results[n].error ? { error: results[n].error } : {}),
  }));

  return { sources, clients, labelArtists, clips, artistBalanceCounts, alerts };
}
