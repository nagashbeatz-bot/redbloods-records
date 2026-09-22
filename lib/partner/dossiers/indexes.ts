/**
 * Pure, precomputed indexes over PartnerCompanyState (Phase C.2). One pass
 * over all projects instead of one pass PER client/artist — keeps
 * buildAllClientDossiers()/buildAllLabelArtistDossiers() from becoming
 * quadratic, and guarantees consistency with Project Dossier's own per-project
 * matching (same matchClientCandidates/matchLabelArtistCandidates calls).
 */
import type { PartnerCompanyState } from "../eyes/types";
import { matchClientCandidates, matchLabelArtistCandidates } from "./relations";
import type { DossierConflict, ProjectRefSummary } from "./types";

function toRef(projectId: string, entry: { name: string; status: string; businessType: string }): ProjectRefSummary {
  return { projectId, name: entry.name, status: entry.status, businessType: entry.businessType };
}

export interface ClientProjectIndex {
  matchedByClientId: Map<string, ProjectRefSummary[]>;
  ambiguousByClientId: Map<string, ProjectRefSummary[]>;
}

/** For every visible project, resolve its client candidates ONCE and bucket by client — mirrors Project Dossier's buildClient() exactly, so Client Dossier and Project Dossier are consistent by construction. */
export function buildClientProjectIndex(state: PartnerCompanyState): ClientProjectIndex {
  const matchedByClientId = new Map<string, ProjectRefSummary[]>();
  const ambiguousByClientId = new Map<string, ProjectRefSummary[]>();
  const clients = state.domains.clients.data?.items ?? [];
  const index = state.domains.projects.data?.index ?? {};

  for (const [projectId, entry] of Object.entries(index)) {
    const candidates = matchClientCandidates(entry.artistText, clients);
    if (candidates.length === 0) continue;
    const ref = toRef(projectId, entry);
    const bucket = candidates.length === 1 ? matchedByClientId : ambiguousByClientId;
    for (const c of candidates) {
      const list = bucket.get(c.id);
      if (list) list.push(ref); else bucket.set(c.id, [ref]);
    }
  }
  return { matchedByClientId, ambiguousByClientId };
}

export interface ArtistProjectIndex {
  idLinkedByArtistId: Map<string, ProjectRefSummary[]>;
  textMatchedByArtistId: Map<string, ProjectRefSummary[]>;
  ambiguousTextMatchedByArtistId: Map<string, ProjectRefSummary[]>;
  conflictsByArtistId: Map<string, DossierConflict[]>;
}

/**
 * Two independent paths, kept separate:
 *   ID   — release.label_artist_id → release.project_id (the strong path).
 *   TEXT — projects.artist = label_artists.name (the weak path).
 * A project already reached via ID never also appears in textMatched/ambiguousTextMatched.
 * When the ID path and an UNAMBIGUOUS text match on the SAME project disagree, that's a
 * DossierConflict (LABEL_ARTIST_ID_NAME_MISMATCH) attached to both artists involved.
 */
export function buildArtistProjectIndex(state: PartnerCompanyState): ArtistProjectIndex {
  const idLinkedByArtistId = new Map<string, ProjectRefSummary[]>();
  const textMatchedByArtistId = new Map<string, ProjectRefSummary[]>();
  const ambiguousTextMatchedByArtistId = new Map<string, ProjectRefSummary[]>();
  const conflictsByArtistId = new Map<string, DossierConflict[]>();
  const labelArtists = state.domains.labelArtists.data?.items ?? [];
  const releaseRows = state.domains.releases.data?.rows ?? [];
  const index = state.domains.projects.data?.index ?? {};

  const idLinkedProjectIds = new Set<string>();
  const idArtistByProject = new Map<string, string>(); // projectId -> artistId, for id-linked projects

  for (const r of releaseRows) {
    if (!r.labelArtistId) continue;
    const entry = index[r.projectId];
    if (!entry) continue;
    const artist = labelArtists.find((a) => a.id === r.labelArtistId);
    if (!artist) continue; // labelArtistId points at an id not in Eyes' current labelArtists list — unresolved, not fabricated
    const ref = toRef(r.projectId, entry);
    const list = idLinkedByArtistId.get(artist.id);
    if (list) list.push(ref); else idLinkedByArtistId.set(artist.id, [ref]);
    idLinkedProjectIds.add(r.projectId);
    idArtistByProject.set(r.projectId, artist.id);
  }

  const pushConflict = (artistId: string, conflict: DossierConflict) => {
    const list = conflictsByArtistId.get(artistId);
    if (list) list.push(conflict); else conflictsByArtistId.set(artistId, [conflict]);
  };

  for (const [projectId, entry] of Object.entries(index)) {
    const candidates = matchLabelArtistCandidates(entry.artistText, labelArtists);
    if (candidates.length === 0) continue;

    if (idLinkedProjectIds.has(projectId)) {
      const idArtistId = idArtistByProject.get(projectId)!;
      if (!candidates.some((c) => c.id === idArtistId)) {
        const idArtist = labelArtists.find((a) => a.id === idArtistId)!;
        const conflict: DossierConflict = {
          code: "LABEL_ARTIST_ID_NAME_MISMATCH",
          sources: ["eyes:releases.labelArtistId", "eyes:labelArtists (projects.artist name match)"],
          description: `release.label_artist_id (project ${projectId}) resolves to "${idArtist.name}" (${idArtist.id}), but projects.artist text-matches ${candidates.map((c) => `"${c.name}" (${c.id})`).join(", ")} — different entities.`,
        };
        pushConflict(idArtistId, conflict);
        for (const c of candidates) pushConflict(c.id, conflict);
      }
      continue; // ID path already covers this project; never also list it as text-matched/ambiguous
    }

    const ref = toRef(projectId, entry);
    if (candidates.length === 1) {
      const list = textMatchedByArtistId.get(candidates[0].id);
      if (list) list.push(ref); else textMatchedByArtistId.set(candidates[0].id, [ref]);
    } else {
      for (const c of candidates) {
        const list = ambiguousTextMatchedByArtistId.get(c.id);
        if (list) list.push(ref); else ambiguousTextMatchedByArtistId.set(c.id, [ref]);
      }
    }
  }

  return { idLinkedByArtistId, textMatchedByArtistId, ambiguousTextMatchedByArtistId, conflictsByArtistId };
}
