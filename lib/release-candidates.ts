// Pure, client-safe: which projects the dashboard's "הוסף ריליס" flow lists, and who
// can OWN the release.
//
// Rule: a project is a candidate when it credits at least one label artist and has
// no release yet. Project STATUS is never looked at.
//   • type   — isReleasableType (song, song+clip, EP, album, riddim) — lib/types.ts
//   • artist — projects.artist tokens (app-wide /[,،;]/ split, trim + collapse
//              spaces + lowercase, exact full-name match, no fuzzy).
//   • a "label artist" is one that is marked status "אמן לייבל" in the clients
//     screen (the business definition) OR already exists in label_artists (the
//     operational record: DJ CLEANTONE has no client row and stays valid).
//   • one label artist among the credits → the owner, chosen automatically; 2+ →
//     the UI asks which one owns the release (never guessed). Owner is only the
//     release's label_artist_id — projects.artist keeps every credit.
//   • an owner with no label_artists row yet (owner.rosterId === null) can only be
//     used after the user explicitly creates that row (see AddReleaseModal).
//   • a release already exists for the project → shown but not selectable.

import { isReleasableType } from "./types";

export interface CandidateProject {
  id: string;
  name: string;
  artist: string;
  projectType: string;
  businessType: string;
}
export interface RosterArtist { id: string; name: string; }

/** A label artist credited on a project — a possible owner of its release. */
export interface OwnerOption {
  /** Display / creation name: the roster name if it exists, else the client's name verbatim. */
  name: string;
  /** Normalized name (identity used for matching). */
  key: string;
  /** label_artists.id, or null when the artist has no operational record yet. */
  rosterId: string | null;
}

export type CandidateBlock = "exists";

export interface ReleaseCandidate {
  project: CandidateProject;
  /** Label artists credited on the project (empty only for `exists` rows). */
  owners: OwnerOption[];
  /** null = selectable. */
  block: CandidateBlock | null;
}

/** Short badge shown on a disabled row. */
export const CANDIDATE_BLOCK_TEXT: Record<CandidateBlock, string> = {
  exists: "כבר קיים כריליס",
};
/** Longer explanation (tooltip). */
export const CANDIDATE_BLOCK_HELP: Record<CandidateBlock, string> = {
  exists: "לפרויקט הזה כבר יש ריליס.",
};

/** House normalization of a free-text artist name: trim + collapse spaces, case-insensitive. */
export const normName = (s: string | null | undefined): string =>
  (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
/** projects.artist → individual names (the app-wide /[,،;]/ split). */
export const artistTokens = (artist: string | null | undefined): string[] =>
  (artist ?? "").split(/[,،;]/).map(normName).filter(Boolean);

/** True when `name` is one of the artists credited in the free-text `artist` field. */
export function creditsInclude(artist: string | null | undefined, name: string): boolean {
  return artistTokens(artist).includes(normName(name));
}

/** True when `artist` lists several names and one of them is `name` (a credit list to preserve). */
export function creditsIncludeAmongMany(artist: string | null | undefined, name: string): boolean {
  const t = artistTokens(artist);
  return t.length > 1 && t.includes(normName(name));
}

export function buildReleaseCandidates(
  projects: CandidateProject[],
  roster: RosterArtist[],
  existingReleaseProjectIds: Set<string>,
  /** Names marked status "אמן לייבל" in the clients screen. */
  clientLabelArtistNames: string[] = [],
): ReleaseCandidate[] {
  const rosterByKey = new Map<string, RosterArtist>();
  for (const a of roster) { const k = normName(a.name); if (k && !rosterByKey.has(k)) rosterByKey.set(k, a); }
  const clientByKey = new Map<string, string>();
  for (const n of clientLabelArtistNames) { const k = normName(n); if (k && !clientByKey.has(k)) clientByKey.set(k, n.trim()); }

  const out: ReleaseCandidate[] = [];
  for (const p of projects) {
    if (!isReleasableType(p.projectType)) continue;
    if (existingReleaseProjectIds.has(p.id)) { out.push({ project: p, owners: [], block: "exists" }); continue; }

    const owners: OwnerOption[] = [];
    const seen = new Set<string>();
    for (const t of artistTokens(p.artist)) {
      if (seen.has(t)) continue;
      const r = rosterByKey.get(t);
      const c = clientByKey.get(t);
      if (!r && c === undefined) continue; // not a label artist
      seen.add(t);
      owners.push({ name: r ? r.name : (c as string), key: t, rosterId: r ? r.id : null });
    }
    if (owners.length > 0) out.push({ project: p, owners, block: null });
    // else: not a label artist's project → not listed
  }

  // Selectable first, then already-a-release.
  // Array.prototype.sort is stable: the API's own order is kept within each group.
  return out.sort((a, b) => (a.block === null ? 0 : 1) - (b.block === null ? 0 : 1));
}

/** Search by project name OR artist (case-insensitive substring). */
export function filterCandidates(list: ReleaseCandidate[], query: string): ReleaseCandidate[] {
  const q = normName(query);
  if (!q) return list;
  return list.filter((c) => normName(c.project.name).includes(q) || normName(c.project.artist).includes(q));
}
