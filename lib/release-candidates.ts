// Pure, client-safe: which projects the dashboard's "הוסף ריליס" flow lists, and
// why some can't be picked. Mirrors the rules of "סמן קיים כריליס" in /label
// (LabelPage.MarkExistingModal + convertProjectToLabelRelease):
//   • song projects only — isSongType ("שיר" / "שיר + קליפ")
//   • a project already flagged לייבל isn't offered for marking
//   • one release per project (project_release_details is 1:1)
// /label makes the user PICK the label artist; the dashboard flow has no such step,
// so the artist is resolved from projects.artist against the label_artists roster.
// It is resolved only when unambiguous, because the mutation rewrites
// projects.artist to the roster name — a multi-artist project would lose names.

import { isSongType } from "./types";

export interface CandidateProject {
  id: string;
  name: string;
  artist: string;
  projectType: string;
  businessType: string;
}
export interface RosterArtist { id: string; name: string; }

export type CandidateBlock = "exists" | "multi_artist" | "no_label_artist";

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
  multi_artist: "כמה אמנים",
  no_label_artist: "אמן לא בלייבל",
};
/** Longer explanation (tooltip / hint). */
export const CANDIDATE_BLOCK_HELP: Record<CandidateBlock, string> = {
  exists: "לפרויקט הזה כבר יש ריליס.",
  multi_artist: "בפרויקט כמה אמנים — אפשר לסמן אותו כריליס דרך ניהול הלייבל.",
  no_label_artist: "האמן של הפרויקט לא ברשימת אמני הלייבל.",
};

/** House normalization of a free-text artist name (same as projects-sort-meta). */
const normName = (s: string | null | undefined): string =>
  (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
/** projects.artist → individual names (the app-wide /[,،;]/ split). */
const artistTokens = (artist: string | null | undefined): string[] =>
  (artist ?? "").split(/[,،;]/).map(normName).filter(Boolean);

export function buildReleaseCandidates(
  projects: CandidateProject[],
  roster: RosterArtist[],
  existingReleaseProjectIds: Set<string>,
): ReleaseCandidate[] {
  const byName = new Map<string, string>();
  for (const a of roster) { const k = normName(a.name); if (k && !byName.has(k)) byName.set(k, a.id); }

  const out: ReleaseCandidate[] = [];
  for (const p of projects) {
    if (!isSongType(p.projectType)) continue;

    if (existingReleaseProjectIds.has(p.id)) { out.push({ project: p, labelArtistId: null, block: "exists" }); continue; }
    if (p.businessType === "לייבל") continue; // same exclusion as /label's list

    const tokens = artistTokens(p.artist);
    if (tokens.length > 1) { out.push({ project: p, labelArtistId: null, block: "multi_artist" }); continue; }
    const id = tokens.length === 1 ? byName.get(tokens[0]) : undefined;
    if (!id) { out.push({ project: p, labelArtistId: null, block: "no_label_artist" }); continue; }
    out.push({ project: p, labelArtistId: id, block: null });
  }

  // Selectable first, then the blocked ones (so the reason is visible below).
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
