// Pure, client-safe: which projects the dashboard's "הוסף ריליס" flow lists, and
// why some can't be picked.
//
// Rule: a project is a candidate when it belongs to a label artist and has no
// release yet. Project STATUS is never looked at.
//   • type    — isReleasableType (song, song+clip, EP, album, riddim) — lib/types.ts
//   • artist  — projects.artist tokens (app-wide /[,،;]/ split, trim + collapse
//               spaces + lowercase, exact full-name match, no fuzzy) against the
//               label_artists roster. That roster is what a release can link to
//               (project_release_details.label_artist_id), so it decides who OWNS
//               the release.
//   • a release already exists for the project → shown but not selectable.
//
// Collabs: one roster artist among the credits → that artist owns it (the credit
// list is kept as-is). Two or more roster artists → ownership is ambiguous, so it
// is shown disabled rather than guessed. An artist marked "אמן לייבל" in the
// clients screen but missing from the roster can't own a release yet → shown
// disabled with a hint to add them in ניהול הלייבל. Projects with no label
// artist at all are not listed.

import { isReleasableType } from "./types";

export interface CandidateProject {
  id: string;
  name: string;
  artist: string;
  projectType: string;
  businessType: string;
}
export interface RosterArtist { id: string; name: string; }

export type CandidateBlock = "exists" | "multi_label_artist" | "not_in_roster";

export interface ReleaseCandidate {
  project: CandidateProject;
  /** Set only when block === null. */
  labelArtistId: string | null;
  /** null = selectable. */
  block: CandidateBlock | null;
}

/** Short badge shown on a disabled row. */
export const CANDIDATE_BLOCK_TEXT: Record<CandidateBlock, string> = {
  exists: "כבר קיים כריליס",
  multi_label_artist: "כמה אמני לייבל",
  not_in_roster: "אמן לא בניהול הלייבל",
};
/** Longer explanation (tooltip). */
export const CANDIDATE_BLOCK_HELP: Record<CandidateBlock, string> = {
  exists: "לפרויקט הזה כבר יש ריליס.",
  multi_label_artist: "בפרויקט משתתפים כמה אמני לייבל, ולריליס יכול להיות אמן לייבל אחד בלבד. אפשר לסמן אותו דרך ניהול הלייבל.",
  not_in_roster: "האמן מסומן כאמן לייבל בלקוחות אבל לא נוסף בניהול הלייבל. הוסף אותו שם (אמן חדש) והפרויקט יהיה זמין.",
};

/** House normalization of a free-text artist name: trim + collapse spaces, case-insensitive. */
export const normName = (s: string | null | undefined): string =>
  (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
/** projects.artist → individual names (the app-wide /[,،;]/ split). */
export const artistTokens = (artist: string | null | undefined): string[] =>
  (artist ?? "").split(/[,،;]/).map(normName).filter(Boolean);

/** True when `artist` lists several names and one of them is `name` (a credit list to preserve). */
export function creditsIncludeAmongMany(artist: string | null | undefined, name: string): boolean {
  const t = artistTokens(artist);
  return t.length > 1 && t.includes(normName(name));
}

export function buildReleaseCandidates(
  projects: CandidateProject[],
  roster: RosterArtist[],
  existingReleaseProjectIds: Set<string>,
  /** Names marked status "אמן לייבל" in the clients screen (used only to explain a missing roster entry). */
  clientLabelArtistNames: string[] = [],
): ReleaseCandidate[] {
  const byName = new Map<string, string>();
  for (const a of roster) { const k = normName(a.name); if (k && !byName.has(k)) byName.set(k, a.id); }
  const clientLabel = new Set(clientLabelArtistNames.map(normName).filter(Boolean));

  const out: ReleaseCandidate[] = [];
  for (const p of projects) {
    if (!isReleasableType(p.projectType)) continue;
    if (existingReleaseProjectIds.has(p.id)) { out.push({ project: p, labelArtistId: null, block: "exists" }); continue; }

    const tokens = artistTokens(p.artist);
    const owners = [...new Set(tokens.map((t) => byName.get(t)).filter((x): x is string => !!x))];
    if (owners.length === 1) out.push({ project: p, labelArtistId: owners[0], block: null });
    else if (owners.length > 1) out.push({ project: p, labelArtistId: null, block: "multi_label_artist" });
    else if (tokens.some((t) => clientLabel.has(t))) out.push({ project: p, labelArtistId: null, block: "not_in_roster" });
    // else: not a label artist's project → not listed
  }

  // Selectable first, then already-a-release, then the other disabled ones.
  // Array.prototype.sort is stable: the API's own order is kept within each group.
  const rank = (c: ReleaseCandidate) => (c.block === null ? 0 : c.block === "exists" ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Search by project name OR artist (case-insensitive substring). */
export function filterCandidates(list: ReleaseCandidate[], query: string): ReleaseCandidate[] {
  const q = normName(query);
  if (!q) return list;
  return list.filter((c) => normName(c.project.name).includes(q) || normName(c.project.artist).includes(q));
}
