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
import { listTasks } from "@/lib/tasks-store";
import type { SourceStatus } from "../../coo/types";
import type { PartnerEyesRaw } from "./types";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function readPartnerEyesRaw(): Promise<PartnerEyesRaw> {
  const results: Record<string, { ok: boolean; count: number | null; error?: string }> = {};
  const track = async <T,>(name: string, fn: () => Promise<T>, count: (v: T) => number | null): Promise<T | null> => {
    try { const v = await fn(); results[name] = { ok: true, count: count(v) }; return v; }
    catch (e) { results[name] = { ok: false, count: null, error: msg(e) }; return null; }
  };

  const [clients, labelArtists, clips, sessions, shows, proposalsFull, releasesFull, transactions, tasksFull] = await Promise.all([
    track("clients", async () => (await listClients()).map((c) => ({ id: c.id, name: c.name, type: c.type, status: c.status, createdAt: c.created_at ?? null })), (v) => v.length),
    track("label_artists", async () => (await listLabelArtists()).map((a) => ({ id: a.id, name: a.name, status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt })), (v) => v.length),
    track("clip_productions", async () => {
      const { data, error } = await supabase
        .from("red_films_productions")
        // Phase C.3: created_at/updated_at added (additive — same bulk query, wider columns,
        // confirmed present on the live table) so this domain can support change detection.
        .select("id, title, status, project_id, artist_name, production_type, created_at, updated_at")
        .eq("production_type", "קליפ");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: r.id as string,
        title: (r.title as string | null) ?? "",
        status: (r.status as string | null) ?? "",
        projectId: (r.project_id as string | null) ?? null,
        artistName: (r.artist_name as string | null) ?? "",
        createdAt: (r.created_at as string | null) ?? null,
        updatedAt: (r.updated_at as string | null) ?? null,
      }));
    }, (v) => v.length),
    // Full history — no date window (separate from lib/coo's forward-window read; that behavior is unchanged).
    track("sessions_eyes", async () => (await listAllSessions()).map((s) => ({
      id: s.id, projectId: s.projectId, showId: s.showId, date: s.date, startTime: s.startTime, endTime: s.endTime, status: s.status, sessionType: s.sessionType,
    })), (v) => v.length),
    // Full history — calls the SAME listShows() lib/coo uses, a second time (lib/coo's own
    // operational-subset read is unchanged). Read-only. artistClientId/bookerClientId are
    // additive (Phase C.2) — already fetched by listShows()'s select("*"), same as djClientId.
    track("shows_eyes", async () => (await listShows()).map((s) => ({
      id: s.id, name: s.name, status: s.status as string, paymentStatus: s.payment_status as string, date: s.date,
      djClientId: s.dj_client_id ?? null, djConfirmationStatus: (s.dj_confirmation_status as string | null) ?? null,
      artistClientId: s.artist_client_id ?? null, bookerClientId: s.booker_client_id ?? null,
    })), (v) => v.length),
    // Phase C.3 — full proposal history, no status filter (separate from lib/coo's own
    // status-filtered read of the same table). client_id is a real FK (confirmed against the
    // live schema and app/api/proposals/route.ts's own .eq("client_id", ...) usage) — exposed
    // here for the first time. No `notes` (private free text).
    track("proposals_eyes", async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("id, client_id, linked_project_id, title, amount, currency, status, followup_date, sent_date, created_at, updated_at, clients(name)");
      if (error) throw new Error(error.message);
      return (data ?? []).map((p) => {
        const c = p.clients as unknown as { name?: string } | { name?: string }[] | null;
        return {
          id: p.id as string, clientId: (p.client_id as string | null) ?? null,
          clientName: ((Array.isArray(c) ? c[0]?.name : c?.name) ?? "") as string,
          linkedProjectId: (p.linked_project_id as string | null) ?? null, title: (p.title as string) ?? "",
          amount: Number(p.amount) || 0, currency: (p.currency as string) ?? "₪", status: p.status as string,
          followupDate: (p.followup_date as string | null) ?? null, sentDate: (p.sent_date as string | null) ?? null,
          createdAt: (p.created_at as string | null) ?? null, updatedAt: (p.updated_at as string | null) ?? null,
        };
      });
    }, (v) => v.length),
    // Phase C.3 — full release history: every project_release_details row, no project-visibility/
    // business-type/stage filter (unlike lib/coo's listLabelReleases()). One bulk read of the
    // table itself — project_id IS the primary key, no join needed for this domain's purpose.
    track("releases_eyes", async () => {
      const { data, error } = await supabase
        .from("project_release_details")
        .select("project_id, label_artist_id, release_stage, release_target_date, stage_entered_at, released_at, created_at, updated_at");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        projectId: r.project_id as string, labelArtistId: (r.label_artist_id as string | null) ?? null,
        stage: r.release_stage as string, targetDate: (r.release_target_date as string | null) ?? null,
        stageEnteredAt: (r.stage_entered_at as string | null) ?? null, releasedAt: (r.released_at as string | null) ?? null,
        createdAt: (r.created_at as string | null) ?? null, updatedAt: (r.updated_at as string | null) ?? null,
      }));
    }, (v) => v.length),
    // Phase C.3 — full transaction row detail (lib/coo's own "finance" domain is an aggregate
    // built from this same table; this is the first per-row Partner read). No `description`/
    // `artist`/`notes`/`receipt_ref` (free text). No `updated_at` — confirmed against the live
    // schema, the column does not exist on this table.
    track("transactions_eyes", async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id, project_id, type, amount, currency, payment_status, date, expense_scope, category, created_at");
      if (error) throw new Error(error.message);
      return (data ?? []).map((t) => ({
        id: t.id as string, projectId: (t.project_id as string | null) ?? null, type: t.type as string,
        amount: Number(t.amount) || 0, currency: (t.currency as string | null) ?? null, status: t.payment_status as string,
        date: (t.date as string | null) ?? null, expenseScope: (t.expense_scope as string | null) ?? null,
        category: (t.category as string | null) ?? null, createdAt: (t.created_at as string | null) ?? null,
      }));
    }, (v) => v.length),
    // Phase C.3 — full task history (every status), via the SAME lib/tasks-store.ts:listTasks()
    // lib/coo's own open-only read already uses, called here with no status filter. No `notes`
    // (private free text).
    track("tasks_eyes", async () => (await listTasks({})).map((t) => ({
      id: t.id, title: t.title, status: t.status as string, dueDate: t.due_date, relatedType: t.related_type as string,
      relatedId: t.related_id ?? null, createdAt: t.created_at ?? null, updatedAt: t.updated_at ?? null,
    })), (v) => v.length),
  ]);

  // Full entry rows (id/artist_id/entry_type/amount/entry_date only — no description/note
  // free text) — one bulk query, same table as before, wider columns (Phase C.2: previously
  // only counted rows; now enough to compute LabelArtistBalanceTotals, mirroring
  // lib/artist-balance-store.ts:computeArtistBalanceTotals()).
  let artistBalanceEntries: PartnerEyesRaw["artistBalanceEntries"] = null;
  if (labelArtists) {
    artistBalanceEntries = await track("artist_balance_entries", async () => {
      const { data, error } = await supabase.from("artist_balance_entries").select("id, artist_id, entry_type, amount, entry_date");
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        id: row.id as string, artistId: row.artist_id as string, entryType: row.entry_type as string,
        amount: Number(row.amount) || 0, entryDate: row.entry_date as string,
      }));
    }, (v) => v.length);
  } else {
    results["artist_balance_entries"] = { ok: false, count: null, error: "label_artists unavailable" };
  }

  const order = [
    "clients", "label_artists", "clip_productions", "artist_balance_entries", "sessions_eyes", "shows_eyes",
    "proposals_eyes", "releases_eyes", "transactions_eyes", "tasks_eyes",
  ];
  const sources: SourceStatus[] = order.filter((n) => results[n]).map((n) => ({
    source: n, status: results[n].ok ? "ok" : "failed", rowCount: results[n].count, ...(results[n].error ? { error: results[n].error } : {}),
  }));

  return {
    sources, clients, labelArtists, clips, artistBalanceEntries, sessions, shows,
    proposalsFull, releasesFull, transactions, tasksFull,
  };
}
