import { ALL_STATUSES, type Project, type ProjectStatus } from "@/lib/types";

/**
 * The order of the Projects list (/projects). Pure, isomorphic, no I/O — it only
 * ORDERS rows that were already filtered; filters, search and paging are elsewhere
 * and untouched. Statuses are read, never invented or renamed.
 *
 * Two layers of priority:
 *
 *   1. Status — the mix statuses are ALWAYS at the top of the list; every other
 *      status follows in its canonical ALL_STATUSES order.
 *   2. Inside one status — label-artist projects first, then the rest; and inside
 *      each of those two groups, the project whose file/version was updated most
 *      recently comes first.
 *
 * `isLabelArtist` and `lastAssetAt` are read-only hints attached by
 * GET /api/projects (lib/projects-sort-meta.ts). `lastAssetAt` is the last real
 * FILE/VERSION upload — deliberately NOT `updatedAt`, which also moves when a
 * status, deadline or note changes. A project with no dated file/version sorts
 * LAST inside its group rather than jumping to the top.
 */

/** The statuses that are "about the mix". Both come straight from ProjectStatus. */
export const MIX_STATUSES: ProjectStatus[] = ["במיקס", "מחכה למיקס"];

/** Mix statuses first, then the remaining statuses in their canonical order. */
export const STATUS_ORDER: ProjectStatus[] = [
  ...MIX_STATUSES,
  ...ALL_STATUSES.filter((s) => !MIX_STATUSES.includes(s)),
];

/** Position in STATUS_ORDER; an unrecognized value sorts last — never hoisted. */
export function statusRank(status: ProjectStatus): number {
  const i = STATUS_ORDER.indexOf(status);
  return i === -1 ? STATUS_ORDER.length : i;
}

/** lastAssetAt → sortable ms. Missing/invalid = "no file/version ever" → last. */
function lastAssetTs(p: Project): number {
  const t = p.lastAssetAt ? Date.parse(p.lastAssetAt) : NaN;
  return isNaN(t) ? -Infinity : t;
}

function updatedTs(p: Project): number {
  const t = p.updatedAt ? Date.parse(p.updatedAt) : NaN;
  return isNaN(t) ? -Infinity : t;
}

/** The comparator behind the list order. See the file header for the rules. */
export function compareProjectsForList(a: Project, b: Project): number {
  // Tier 1 — status.
  const rA = statusRank(a.status), rB = statusRank(b.status);
  if (rA !== rB) return rA - rB;

  // Tier 2 — inside one status: label artists first.
  const lA = a.isLabelArtist ? 0 : 1, lB = b.isLabelArtist ? 0 : 1;
  if (lA !== lB) return lA - lB;

  // Tier 3 — inside each group: newest file/version first.
  const fA = lastAssetTs(a), fB = lastAssetTs(b);
  if (fA !== fB) return fB - fA;

  // Tiebreak — only reached when two projects are equal on all three tiers
  // (typically two projects that have no file/version at all). Keeps the order
  // stable and predictable instead of leaving it to the input order.
  const uA = updatedTs(a), uB = updatedTs(b);
  if (uA !== uB) return uB - uA;
  return a.name.localeCompare(b.name, "he");
}

/** Non-mutating sort of an already-filtered project list. */
export function sortProjectsForList(projects: Project[]): Project[] {
  return [...projects].sort(compareProjectsForList);
}
