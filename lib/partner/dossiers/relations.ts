/**
 * Pure entity-matching helpers for Project Dossier. No I/O.
 *
 * splitArtistNames() mirrors lib/clients-store.ts:parseArtistNames() EXACTLY
 * (same regex, same trim, same filter) — reusing the app's existing business
 * behavior for "a project's artist field may list several names", not
 * inventing new fuzzy matching. Duplicated rather than imported because
 * clients-store.ts has `import "server-only"` — importing it here would pull
 * a Supabase-touching module into this pure dossier code (same reasoning as
 * Phase B.2's locally-defined RawSessionEyes).
 */
import type { ClientSummary, LabelArtistSummary } from "../eyes/types";

/** Mirrors lib/clients-store.ts:parseArtistNames() — do not diverge without updating both. */
export function splitArtistNames(raw: string): string[] {
  return raw.split(/[,،;]/).map((s) => s.trim()).filter(Boolean);
}

/** Exact-name candidates (after the same split/trim the rest of the app already uses) — no case-folding, no fuzzy matching invented here. */
export function matchClientCandidates(artistText: string, clients: ClientSummary[]): ClientSummary[] {
  const names = new Set(splitArtistNames(artistText));
  if (names.size === 0) return [];
  const seen = new Set<string>();
  const out: ClientSummary[] = [];
  for (const c of clients) {
    if (names.has(c.name) && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
  }
  return out;
}

export function matchLabelArtistCandidates(artistText: string, labelArtists: LabelArtistSummary[]): LabelArtistSummary[] {
  const names = new Set(splitArtistNames(artistText));
  if (names.size === 0) return [];
  const seen = new Set<string>();
  const out: LabelArtistSummary[] = [];
  for (const a of labelArtists) {
    if (names.has(a.name) && !seen.has(a.id)) { seen.add(a.id); out.push(a); }
  }
  return out;
}
