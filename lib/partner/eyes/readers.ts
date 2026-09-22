import "server-only";

/**
 * Partner-only readers — for domains lib/coo does NOT already fetch, or fetches
 * only a narrower subset of. Same discipline as lib/coo/readers.ts: read-only,
 * one bulk query per source (no N+1), a failed source becomes null (never an
 * empty array pretending to be "no data").
 *
 * Agent Alerts is NOT read here (Owner decision, Phase B.2) — agent_alerts is
 * intentionally excluded from Redbloods Partner. See lib/partner/eyes/types.ts.
 *
 * Reuses existing stores/functions instead of querying tables directly
 * wherever one exists (listClients, listLabelArtists, listShows,
 * listAllSessions). Clip productions have no existing "list all" store
 * function (label-clips.ts / clip-production.ts only expose per-artist /
 * per-project lookups), so that one is a genuinely new bulk SELECT here —
 * still read-only, still one query.
 */
import { supabase } from "@/lib/supabase";
import { listClients } from "@/lib/clients-store";
import { listLabelArtists } from "@/lib/label-artists-store";
import { listShows } from "@/lib/shows-store";
import { listAllSessions } from "@/lib/sessions-store";
import type { SourceStatus } from "../../coo/types";
import type { PartnerEyesRaw } from "./types";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function readPartnerEyesRaw(): Promise<PartnerEyesRaw> {
  const results: Record<string, { ok: boolean; count: number | null; error?: string }> = {};
  const track = async <T,>(name: string, fn: () => Promise<T>, count: (v: T) => number | null): Promise<T | null> => {
    try { const v = await fn(); results[name] = { ok: true, count: count(v) }; return v; }
    catch (e) { results[name] = { ok: false, count: null, error: msg(e) }; return null; }
  };

  const [clients, labelArtists, clips, sessions, shows] = await Promise.all([
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
    // Full history — no date window (separate from lib/coo's forward-window read; that behavior is unchanged).
    track("sessions_eyes", async () => (await listAllSessions()).map((s) => ({
      id: s.id, projectId: s.projectId, showId: s.showId, date: s.date, startTime: s.startTime, endTime: s.endTime, status: s.status, sessionType: s.sessionType,
    })), (v) => v.length),
    // Full history — calls the SAME listShows() lib/coo uses, a second time (lib/coo's own
    // operational-subset read is unchanged). Read-only.
    track("shows_eyes", async () => (await listShows()).map((s) => ({
      id: s.id, name: s.name, status: s.status as string, paymentStatus: s.payment_status as string, date: s.date,
      djClientId: s.dj_client_id ?? null, djConfirmationStatus: (s.dj_confirmation_status as string | null) ?? null,
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

  const order = ["clients", "label_artists", "clip_productions", "artist_balance_entries", "sessions_eyes", "shows_eyes"];
  const sources: SourceStatus[] = order.filter((n) => results[n]).map((n) => ({
    source: n, status: results[n].ok ? "ok" : "failed", rowCount: results[n].count, ...(results[n].error ? { error: results[n].error } : {}),
  }));

  return { sources, clients, labelArtists, clips, artistBalanceCounts, sessions, shows };
}
