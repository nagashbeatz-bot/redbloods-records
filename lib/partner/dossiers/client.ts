/**
 * Client Dossier v1 (Phase C.2) — pure, deterministic, built entirely from an
 * already-computed PartnerCompanyState. No I/O, no new queries. No reasoning:
 * no profitability/loyalty/churn/seriousness conclusions.
 */
import type { PartnerCompanyState } from "../eyes/types";
import { aggregateFinance, aggregateSessions } from "./aggregate";
import { classifyDomain } from "./dataQuality";
import { buildClientProjectIndex } from "./indexes";
import {
  CLIENT_DOSSIER_SCHEMA_VERSION,
  type ClientDossier, type ClientDossierResult, type ClientIdentity, type ClientProposalsSection, type DossierDataQuality, type EntityRelation,
} from "./types";

function buildIdentity(state: PartnerCompanyState, clientId: string): ClientIdentity | null {
  const client = state.domains.clients.data?.items.find((c) => c.id === clientId);
  if (!client) return null;
  return { clientId, name: client.name, type: client.type, status: client.status, createdAt: client.createdAt };
}

function buildProposals(state: PartnerCompanyState, identity: ClientIdentity): ClientProposalsSection {
  const all = state.domains.proposalsFull.data?.items ?? [];
  const items = all.filter((p) => p.clientId === identity.clientId);
  const legacyTextMatched = all.filter((p) => p.clientId === null && p.clientName === identity.name);
  return {
    items,
    relation: { fromType: "client", fromId: identity.clientId, toType: "proposal", toId: items.length === 1 ? items[0].id : null, quality: "ID", basis: "proposals.client_id", source: "eyes:proposalsFull" },
    legacyTextMatched,
    scopeDescription: "Phase C.3: ID via proposals.client_id (a real FK), full history (no status filter — a closed proposal never disappears). legacyTextMatched separately holds any client_id=null row whose denormalized clientName text matches — never merged into the ID-confirmed items.",
  };
}

export function buildClientDossier(state: PartnerCompanyState, clientId: string, projectIndex?: ReturnType<typeof buildClientProjectIndex>): ClientDossierResult {
  const identity = buildIdentity(state, clientId);
  if (!identity) {
    return {
      ok: false, reason: "NOT_FOUND_IN_EYES_SCOPE", clientId,
      note: "Not found within Partner Eyes' current scope. listClients() has no filter, so this most likely means the id doesn't exist — but Eyes cannot rule out a read failure either without checking domains.clients.status separately.",
    };
  }

  const idx = projectIndex ?? buildClientProjectIndex(state);
  const matchedProjects = idx.matchedByClientId.get(clientId) ?? [];
  const ambiguousProjectCandidates = idx.ambiguousByClientId.get(clientId) ?? [];
  const matchedProjectIds = matchedProjects.map((p) => p.projectId);

  const shows = state.domains.shows.data?.items ?? [];
  const performerShowItems = shows.filter((s) => s.artistClientId === clientId);
  const bookerShowItems = shows.filter((s) => s.bookerClientId === clientId);
  const djShowItems = shows.filter((s) => s.djClientId === clientId);

  const finance = aggregateFinance(
    state, matchedProjectIds, "TEXT_MATCH",
    "Derived from matchedProjects only (never ambiguousProjectCandidates). The project↔client relation itself is TEXT_MATCH (no client_id on projects) — this is not a canonical, ID-confirmed client revenue figure.",
  );
  const sessions = aggregateSessions(state, matchedProjectIds);

  const base = {
    dossierSchemaVersion: CLIENT_DOSSIER_SCHEMA_VERSION,
    clientId,
    identity,
    matchedProjects,
    ambiguousProjectCandidates,
    proposals: buildProposals(state, identity),
    finance,
    sessions,
    performerShows: { items: performerShowItems, relation: { fromType: "client", fromId: clientId, toType: "show", toId: null, quality: "ID", basis: "shows.artist_client_id", source: "eyes:shows" } as EntityRelation },
    bookerShows: { items: bookerShowItems, relation: { fromType: "client", fromId: clientId, toType: "show", toId: null, quality: "ID", basis: "shows.booker_client_id", source: "eyes:shows" } as EntityRelation },
    djShows: { items: djShowItems, relation: { fromType: "client", fromId: clientId, toType: "show", toId: null, quality: "ID", basis: "shows.dj_client_id", source: "eyes:shows" } as EntityRelation },
  };

  const completeDomains: string[] = [];
  const partialDomains: string[] = [];
  const unknownDomains: string[] = [];
  for (const k of ["clients", "projects", "proposalsFull", "receivables", "sessions", "shows"] as const) {
    const c = classifyDomain(state, k);
    if (c === "complete") completeDomains.push(k);
    else if (c === "partial") partialDomains.push(k);
    else unknownDomains.push(k);
  }
  const weakRelations: string[] = [];
  if (matchedProjects.length > 0) weakRelations.push("matchedProjects (TEXT_MATCH)");
  if (ambiguousProjectCandidates.length > 0) weakRelations.push("ambiguousProjectCandidates");
  if (base.proposals.legacyTextMatched.length > 0) weakRelations.push("proposals.legacyTextMatched (TEXT_MATCH — client_id=null legacy rows only)");
  const dataQuality: DossierDataQuality = { completeDomains, partialDomains, unknownDomains, weakRelations, conflicts: [] };

  const provenance = {
    eyesCapturedAt: state.capturedAt,
    eyesSchemaVersion: state.schemaVersion,
    cooSchemaVersion: state.cooSchemaVersion,
    dossierSchemaVersion: CLIENT_DOSSIER_SCHEMA_VERSION,
    sectionSources: {
      identity: "eyes:clients",
      matchedProjects: "eyes:projects.index + projects.artist (TEXT_MATCH, matched)",
      ambiguousProjectCandidates: "eyes:projects.index + projects.artist (TEXT_MATCH, ambiguous)",
      proposals: "eyes:proposalsFull (client_id, ID, full history — Phase C.3)",
      finance: "eyes:receivables, via matchedProjects",
      sessions: "eyes:sessions, via matchedProjects",
      performerShows: "eyes:shows.artist_client_id",
      bookerShows: "eyes:shows.booker_client_id",
      djShows: "eyes:shows.dj_client_id",
    },
  };

  return { ok: true, dossier: { ...base, dataQuality, provenance } };
}

export function buildAllClientDossiers(state: PartnerCompanyState): Map<string, ClientDossier> {
  const out = new Map<string, ClientDossier>();
  const idx = buildClientProjectIndex(state);
  for (const client of state.domains.clients.data?.items ?? []) {
    const result = buildClientDossier(state, client.id, idx);
    if (result.ok) out.set(client.id, result.dossier);
  }
  return out;
}
