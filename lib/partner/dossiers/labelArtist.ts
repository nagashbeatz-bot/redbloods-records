/**
 * Label Artist Dossier v1 (Phase C.2) — pure, deterministic, built entirely
 * from an already-computed PartnerCompanyState. No I/O, no new queries. No
 * reasoning: does NOT evaluate Charter's LABEL_ARTIST_INVESTMENT_SIGNALS
 * (persistence/shows/money) — only exposes the raw/derived facts a future
 * reasoning layer would need to do that.
 */
import type { PartnerCompanyState } from "../eyes/types";
import { aggregateFinance, aggregateSessions } from "./aggregate";
import { classifyDomain } from "./dataQuality";
import { buildArtistProjectIndex } from "./indexes";
import {
  LABEL_ARTIST_DOSSIER_SCHEMA_VERSION,
  type DossierDataQuality, type LabelArtistBalanceLedgerSection, type LabelArtistDossier, type LabelArtistDossierResult,
  type LabelArtistIdentity, type LabelArtistReleasesSection,
} from "./types";

function buildIdentity(state: PartnerCompanyState, artistId: string): LabelArtistIdentity | null {
  const artist = state.domains.labelArtists.data?.items.find((a) => a.id === artistId);
  if (!artist) return null;
  return { artistId, name: artist.name, status: artist.status, createdAt: artist.createdAt, updatedAt: artist.updatedAt };
}

function buildReleases(state: PartnerCompanyState, artistId: string): LabelArtistReleasesSection {
  const allRows = state.domains.releasesFull.data?.items ?? [];
  const rows = allRows.filter((r) => r.labelArtistId === artistId);
  const dates = rows.map((r) => r.targetYmd).filter((d): d is string => !!d).sort();
  return {
    rows,
    visibleReleaseCount: rows.length,
    firstVisibleReleaseTargetDate: dates[0] ?? null,
    latestVisibleReleaseTargetDate: dates[dates.length - 1] ?? null,
    scopeNote: "Phase C.3: genuinely a lifetime release count now — sourced from eyes:releasesFull (project_release_details directly), every stage, no visibility/business-type filter. Before Phase C.3 this only counted ACTIVE-stage rows.",
  };
}

function buildBalanceLedger(state: PartnerCompanyState, artistId: string): LabelArtistBalanceLedgerSection {
  const artist = state.domains.labelArtists.data?.items.find((a) => a.id === artistId);
  const entryCount = artist?.balanceEntries ?? 0;
  return {
    hasEntries: entryCount > 0,
    entryCount,
    totals: artist?.balanceTotals ?? null,
    note: "artist_balance_entries is an independent, manually-maintained ledger (all-time, no cycle/date filter) — not synced with transactions/Finance. Totals use the exact same formula as lib/artist-balance-store.ts:computeArtistBalanceTotals(). The table has no currency column — treated as one implicit ledger.",
  };
}

export function buildLabelArtistDossier(state: PartnerCompanyState, artistId: string, projectIndex?: ReturnType<typeof buildArtistProjectIndex>): LabelArtistDossierResult {
  const identity = buildIdentity(state, artistId);
  if (!identity) {
    return {
      ok: false, reason: "NOT_FOUND_IN_EYES_SCOPE", artistId,
      note: "Not found within Partner Eyes' current scope. listLabelArtists() has no filter, so this most likely means the id doesn't exist — but Eyes cannot rule out a read failure either without checking domains.labelArtists.status separately.",
    };
  }

  const idx = projectIndex ?? buildArtistProjectIndex(state);
  const idLinked = idx.idLinkedByArtistId.get(artistId) ?? [];
  const textMatched = idx.textMatchedByArtistId.get(artistId) ?? [];
  const ambiguousTextMatched = idx.ambiguousTextMatchedByArtistId.get(artistId) ?? [];
  const conflicts = idx.conflictsByArtistId.get(artistId) ?? [];

  const idLinkedIds = idLinked.map((p) => p.projectId);
  const textMatchedIds = textMatched.map((p) => p.projectId);

  const sessions = {
    viaIdLinkedProjects: aggregateSessions(state, idLinkedIds),
    viaTextMatchedProjects: aggregateSessions(state, textMatchedIds),
    note: "Sessions have no artist_id — reached only through a project. viaIdLinkedProjects uses the STRONG path (release.label_artist_id → release.project_id); viaTextMatchedProjects uses the WEAK path (projects.artist name match). Never described as \"the artist's sessions\" as if a direct FK existed.",
  };
  const finance = {
    viaIdLinkedProjects: aggregateFinance(state, idLinkedIds, "ID", "Derived from ID-linked projects (release.label_artist_id) — the strong path."),
    viaTextMatchedProjects: aggregateFinance(state, textMatchedIds, "TEXT_MATCH", "Derived from text-matched-only projects — the weak path. Not a canonical artist revenue figure."),
  };

  const base = {
    dossierSchemaVersion: LABEL_ARTIST_DOSSIER_SCHEMA_VERSION,
    artistId,
    identity,
    projects: { idLinked, textMatched, ambiguousTextMatched },
    releases: buildReleases(state, artistId),
    sessions,
    finance,
    balanceLedger: buildBalanceLedger(state, artistId),
    shows: {
      status: "NO_DIRECT_RELATION_MODELED" as const,
      note: "shows has no label_artist_id. A path via artist name → client name → shows.artist_client_id would be a 2-hop text guess — not modeled in v1 (see Phase C.2 §22).",
    },
  };

  const completeDomains: string[] = [];
  const partialDomains: string[] = [];
  const unknownDomains: string[] = [];
  for (const k of ["labelArtists", "projects", "releasesFull", "receivables", "sessions"] as const) {
    const c = classifyDomain(state, k);
    if (c === "complete") completeDomains.push(k);
    else if (c === "partial") partialDomains.push(k);
    else unknownDomains.push(k);
  }
  const weakRelations: string[] = [];
  if (textMatched.length > 0) weakRelations.push("textMatched projects (TEXT_MATCH)");
  if (ambiguousTextMatched.length > 0) weakRelations.push("ambiguousTextMatched projects");
  const dataQuality: DossierDataQuality = { completeDomains, partialDomains, unknownDomains, weakRelations, conflicts };

  const provenance = {
    eyesCapturedAt: state.capturedAt,
    eyesSchemaVersion: state.schemaVersion,
    cooSchemaVersion: state.cooSchemaVersion,
    dossierSchemaVersion: LABEL_ARTIST_DOSSIER_SCHEMA_VERSION,
    sectionSources: {
      identity: "eyes:labelArtists",
      "projects.idLinked": "eyes:releasesFull.labelArtistId -> release.projectId (ID)",
      "projects.textMatched": "eyes:projects.index + label_artists.name (TEXT_MATCH)",
      releases: "eyes:releasesFull (labelArtistId filter, full history — Phase C.3)",
      sessions: "eyes:sessions, via idLinked/textMatched projects",
      finance: "eyes:receivables, via idLinked/textMatched projects",
      balanceLedger: "eyes:labelArtists (artist_balance_entries)",
      shows: "not modeled in v1",
    },
  };

  return { ok: true, dossier: { ...base, dataQuality, provenance } };
}

export function buildAllLabelArtistDossiers(state: PartnerCompanyState): Map<string, LabelArtistDossier> {
  const out = new Map<string, LabelArtistDossier>();
  const idx = buildArtistProjectIndex(state);
  for (const artist of state.domains.labelArtists.data?.items ?? []) {
    const result = buildLabelArtistDossier(state, artist.id, idx);
    if (result.ok) out.set(artist.id, result.dossier);
  }
  return out;
}
