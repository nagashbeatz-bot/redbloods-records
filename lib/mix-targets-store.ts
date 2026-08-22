/**
 * Mix Targets store — server-only. Pure DB CRUD for mix_targets, the manual
 * roster of a RIDDIM work: the fixed instrumental line plus one free-text line
 * per artist, each with its own Mix numbering and its own comment threads.
 *
 * Deliberately self-contained. A target is a name the owner typed — there is NO
 * link to label_artists / clients / portals, no artist_id, no guest-vs-label
 * distinction and no sync of any kind. Because mix_versions points at
 * mix_targets.id, renaming a line touches this one row and never moves a single
 * version or comment.
 *
 * Two rules this file exists to keep:
 *   1. Nothing here is ever called from a GET. The instrumental is created only
 *      by an explicit owner POST (see ensureInstrumental's callers) — reading a
 *      riddim work must never write to the DB.
 *   2. Removal is ALWAYS soft (removed_at). A removed line keeps its versions
 *      and comments; the roster changes, the work history does not. The FK on
 *      mix_versions.mix_target_id backs this up at the DB level.
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import type { MixTarget, MixTargetKind } from "@/lib/types";

function mapRow(r: Record<string, unknown>): MixTarget {
  return {
    id:          r.id            as string,
    workId:      r.work_id       as string,
    targetKind:  (r.target_kind  as MixTargetKind) ?? "artist",
    displayName: (r.display_name as string) ?? "",
    sortOrder:   r.sort_order != null ? Number(r.sort_order) : 0,
    removedAt:   (r.removed_at   as string | null) ?? null,
    createdAt:   (r.created_at   as string) ?? "",
  };
}

/** Instrumental first, then artists by sort_order, then insertion order. */
function sortTargets(list: MixTarget[]): MixTarget[] {
  return list.sort((a, b) => {
    if (a.targetKind !== b.targetKind) return a.targetKind === "instrumental" ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

/**
 * The work's roster. Removed lines are included by default because the UI still
 * has to show their history; pass `activeOnly` for the upload target picker,
 * which must never offer a removed line.
 */
export async function listMixTargets(
  workId: string,
  opts?: { activeOnly?: boolean }
): Promise<MixTarget[]> {
  let q = supabase.from("mix_targets").select("*").eq("work_id", workId);
  if (opts?.activeOnly) q = q.is("removed_at", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return sortTargets((data ?? []).map((r) => mapRow(r as Record<string, unknown>)));
}

/** Fetch one target (null if not found). Used for ownership + state checks. */
export async function getMixTarget(id: string): Promise<MixTarget | null> {
  const { data, error } = await supabase.from("mix_targets").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as Record<string, unknown>) : null;
}

/**
 * Create the work's single instrumental line if it does not exist yet, and
 * return it either way. Idempotent: the partial unique index
 * mix_targets_one_instrumental makes a concurrent double-create impossible, and
 * a 23505 simply means the other caller won — we re-read and return that row.
 *
 * NEVER call this from a GET handler.
 */
export async function ensureInstrumental(workId: string): Promise<MixTarget> {
  const { data: existing } = await supabase
    .from("mix_targets").select("*")
    .eq("work_id", workId).eq("target_kind", "instrumental").maybeSingle();
  if (existing) return mapRow(existing as Record<string, unknown>);

  const { data, error } = await supabase
    .from("mix_targets")
    .insert({ work_id: workId, target_kind: "instrumental", display_name: "", sort_order: 0 })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("mix_targets").select("*")
        .eq("work_id", workId).eq("target_kind", "instrumental").maybeSingle();
      if (raced) return mapRow(raced as Record<string, unknown>);
    }
    throw new Error(error.message);
  }
  return mapRow(data as Record<string, unknown>);
}

export type AddTargetResult =
  | { status: "ok";        target: MixTarget }
  | { status: "restored";  target: MixTarget }
  | { status: "duplicate"; target: MixTarget };

/**
 * Add an artist line by name. Adding a name that already exists on this work is
 * NOT an error path with a second row: the unique index is name-based and
 * deliberately ignores removed_at, so re-adding a previously removed name
 * RESTORES that exact row — which reconnects all of its historical mixes and
 * comments, because they point at its id. One rule, no duplicate lines ever.
 */
export async function addArtistTarget(workId: string, name: string): Promise<AddTargetResult> {
  const displayName = name.trim();
  if (!displayName) throw new Error("שם אמן חסר");

  const existing = await findArtistByName(workId, displayName);
  if (existing) return existing.removedAt ? { status: "restored", target: await restore(existing.id) }
                                          : { status: "duplicate", target: existing };

  const nextOrder = await nextArtistSortOrder(workId);
  const { data, error } = await supabase
    .from("mix_targets")
    .insert({ work_id: workId, target_kind: "artist", display_name: displayName, sort_order: nextOrder })
    .select()
    .single();

  if (error) {
    // Lost a race on mix_targets_artist_name_once — resolve to the winning row.
    if (error.code === "23505") {
      const raced = await findArtistByName(workId, displayName);
      if (raced) return raced.removedAt ? { status: "restored", target: await restore(raced.id) }
                                        : { status: "duplicate", target: raced };
    }
    throw new Error(error.message);
  }
  return { status: "ok", target: mapRow(data as Record<string, unknown>) };
}

/** Case/space-insensitive lookup, matching the unique index's normalisation. */
async function findArtistByName(workId: string, displayName: string): Promise<MixTarget | null> {
  const { data, error } = await supabase
    .from("mix_targets").select("*").eq("work_id", workId).eq("target_kind", "artist");
  if (error) throw new Error(error.message);
  const key = displayName.trim().toLowerCase();
  const hit = (data ?? [])
    .map((r) => mapRow(r as Record<string, unknown>))
    .find((t) => t.displayName.trim().toLowerCase() === key);
  return hit ?? null;
}

async function nextArtistSortOrder(workId: string): Promise<number> {
  const { data } = await supabase
    .from("mix_targets").select("sort_order").eq("work_id", workId).eq("target_kind", "artist");
  const max = (data ?? []).reduce((m, r) => Math.max(m, Number((r as { sort_order: number }).sort_order ?? 0)), 0);
  return max + 1;
}

async function restore(id: string): Promise<MixTarget> {
  const { data, error } = await supabase
    .from("mix_targets").update({ removed_at: null }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

export type RenameResult =
  | { status: "ok";        target: MixTarget }
  | { status: "duplicate" }
  | { status: "not_found" }
  | { status: "instrumental" };

/**
 * Rename an artist line. This updates display_name and NOTHING else — every
 * mix_versions row keeps pointing at the same id, so no version, file or comment
 * moves. The instrumental has no name to change (its label comes from the page's
 * translations) and is rejected.
 */
export async function renameArtistTarget(id: string, name: string): Promise<RenameResult> {
  const displayName = name.trim();
  if (!displayName) throw new Error("שם אמן חסר");

  const target = await getMixTarget(id);
  if (!target) return { status: "not_found" };
  if (target.targetKind === "instrumental") return { status: "instrumental" };

  const clash = await findArtistByName(target.workId, displayName);
  if (clash && clash.id !== id) return { status: "duplicate" };

  const { data, error } = await supabase
    .from("mix_targets").update({ display_name: displayName }).eq("id", id).select().single();
  if (error) {
    if (error.code === "23505") return { status: "duplicate" };
    throw new Error(error.message);
  }
  return { status: "ok", target: mapRow(data as Record<string, unknown>) };
}

export type RemoveResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "instrumental" };

/**
 * Remove an artist line from the roster — ALWAYS a soft remove. Its mixes,
 * files and comments stay exactly where they are and remain visible under a
 * "removed" line; only the upload picker stops offering it. One code path for
 * every case, whether or not the line has history. The instrumental can never
 * be removed.
 */
export async function softRemoveTarget(id: string): Promise<RemoveResult> {
  const target = await getMixTarget(id);
  if (!target) return { status: "not_found" };
  if (target.targetKind === "instrumental") return { status: "instrumental" };
  if (target.removedAt) return { status: "ok" };  // already removed — idempotent

  const { error } = await supabase
    .from("mix_targets").update({ removed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  return { status: "ok" };
}
