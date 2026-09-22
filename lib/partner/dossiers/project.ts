/**
 * Project Dossier v1 (Phase C.1) — pure, deterministic, built entirely from
 * an already-computed PartnerCompanyState. No I/O, no new queries, no
 * query-per-project. No reasoning: no health/risk/priority/recommendation —
 * see lib/partner/dossiers/types.ts for the full epistemic model.
 */
import type { PartnerCompanyState } from "../eyes/types";
import { matchClientCandidates, matchLabelArtistCandidates, splitArtistNames } from "./relations";
import {
  PROJECT_DOSSIER_SCHEMA_VERSION,
  type BalanceKind, type DossierConflict, type DossierDataQuality, type EntityRelation,
  type FinanceConfigStatus, type LabelArtistLinkStatus, type ProjectClientSection, type ProjectClipsSection,
  type ProjectDossier, type ProjectDossierResult, type ProjectExternalSoundSection, type ProjectFinanceSection,
  type ProjectIdentity, type ProjectLabelArtistSection, type ProjectProposalsSection, type ProjectReleaseSection,
  type ProjectSessionsSection, type ProjectShowsSection, type ProjectStevenSection, type ProjectTasksSection,
  type ProjectVictorSection,
} from "./types";

function buildIdentity(state: PartnerCompanyState, projectId: string): ProjectIdentity | null {
  const projects = state.domains.projects.data;
  if (!projects) return null;
  const indexEntry = projects.index[projectId];
  if (!indexEntry) return null;
  const full = projects.open.find((p) => p.id === projectId);
  if (full) {
    return {
      projectId, name: full.name, artistText: full.artistText, status: full.status, businessType: full.businessType,
      identitySource: "OPEN_SET",
      projectType: full.projectType, deadline: full.deadline, daysSinceUpdate: full.daysSinceUpdate,
      active: full.active, hasFinanceSetting: full.hasFinanceSetting,
    };
  }
  // Closed (הושלם/בוטל) — lib/coo only builds full ProjectFact detail for the "open" set.
  return {
    projectId, name: indexEntry.name, artistText: indexEntry.artistText, status: indexEntry.status, businessType: indexEntry.businessType,
    identitySource: "INDEX_ONLY",
    projectType: null, deadline: null, daysSinceUpdate: null, active: null, hasFinanceSetting: null,
  };
}

function buildClient(state: PartnerCompanyState, identity: ProjectIdentity): ProjectClientSection {
  const clients = state.domains.clients.data?.items ?? [];
  const candidates = matchClientCandidates(identity.artistText, clients);
  const notes: string[] = [];
  let status: ProjectClientSection["status"];
  let relation: EntityRelation | null = null;
  if (!state.domains.clients.data) {
    status = "UNKNOWN"; notes.push("clients domain unavailable in this PartnerCompanyState snapshot.");
  } else if (candidates.length === 0) {
    status = "NO_MATCH"; notes.push("No client row's name matches this project's artist text.");
  } else if (candidates.length === 1) {
    status = "MATCHED";
    relation = { fromType: "project", fromId: identity.projectId, toType: "client", toId: candidates[0].id, quality: "TEXT_MATCH", basis: "projects.artist = clients.name", source: "eyes:clients" };
  } else {
    status = "AMBIGUOUS"; notes.push(`${candidates.length} clients share a name that matches this project's artist text — not narrowed to one.`);
  }
  return { status, candidates, relation, notes };
}

function buildProposals(state: PartnerCompanyState, projectId: string): ProjectProposalsSection {
  const all = state.domains.proposals.data ?? [];
  const items = all.filter((p) => p.linkedProjectId === projectId);
  return {
    items,
    relation: { fromType: "project", fromId: projectId, toType: "proposal", toId: items.length === 1 ? items[0].id : null, quality: "ID", basis: "proposals.linked_project_id", source: "eyes:proposals" },
  };
}

function buildFinance(state: PartnerCompanyState, identity: ProjectIdentity): ProjectFinanceSection {
  const receivables = state.domains.receivables.data;
  const row = receivables?.rows.find((r) => r.projectId === identity.projectId) ?? null;
  const expectedOverdueItems = (state.domains.finance.data?.expectedOverdue ?? []).filter((e) => e.projectId === identity.projectId);

  let configStatus: FinanceConfigStatus;
  let agreedPrice: number | null = null;
  let currency: string | null = null;
  let receivedIncome: number | null = null;
  let balance: number | null = null;
  let balanceKind: BalanceKind = "UNKNOWN";

  if (row) {
    configStatus = "CONFIGURED";
    agreedPrice = row.agreedPrice; currency = row.currency; receivedIncome = row.received; balance = row.balance;
    balanceKind = balance > 0 ? "DEBT" : balance < 0 ? "OVERPAYMENT" : "NO_DEBT";
  } else if (!receivables) {
    configStatus = "UNKNOWN";
  } else if (receivables.exceptionIds.includes(identity.projectId)) {
    configStatus = "EXCEPTION";
  } else if (identity.status === "בוטל") {
    configStatus = "NOT_CONSIDERED";
  } else {
    configStatus = "UNKNOWN";
  }

  return { configStatus, agreedPrice, currency, receivedIncome, balance, balanceKind, expectedOverdueItems, transactionDetail: "NOT_AVAILABLE_IN_EYES" };
}

function buildSessions(state: PartnerCompanyState, projectId: string): ProjectSessionsSection {
  const all = state.domains.sessions.data?.items ?? [];
  const items = all.filter((s) => s.projectId === projectId);
  const dates = items.map((s) => s.dateYmd).filter((d): d is string => !!d).sort();
  const today = state.todayIL;
  const upcoming = dates.filter((d) => d >= today);
  const byStatus = items.reduce<Record<string, number>>((acc, s) => { acc[s.status] = (acc[s.status] ?? 0) + 1; return acc; }, {});
  return {
    count: items.length,
    firstSessionDate: dates[0] ?? null,
    latestSessionDate: dates[dates.length - 1] ?? null,
    nextSessionDate: upcoming[0] ?? null,
    byStatus, items,
    relation: { fromType: "project", fromId: projectId, toType: "session", toId: null, quality: "ID", basis: "sessions.project_id", source: "eyes:sessions" },
  };
}

function buildRelease(state: PartnerCompanyState, projectId: string): ProjectReleaseSection {
  const releasesData = state.domains.releases.data;
  const notes: string[] = ["scope: active release-stage rows only — excludes יצא/released and בהשהייה/on-hold (see eyes:releases)."];
  if (!releasesData) {
    return { status: "UNKNOWN", rows: [], relation: null, notes: ["releases domain unavailable in this PartnerCompanyState snapshot."] };
  }
  const rows = releasesData.rows.filter((r) => r.projectId === projectId);
  if (rows.length === 0) {
    notes.push("No ACTIVE release row for this project — may mean no release record exists, OR it's already released/on-hold and therefore outside Partner Eyes' current scope.");
    return { status: "NO_ACTIVE_RELEASE_ROW", rows: [], relation: null, notes };
  }
  return {
    status: "FOUND", rows, notes,
    relation: { fromType: "project", fromId: projectId, toType: "release", toId: rows.length === 1 ? rows[0].projectId : null, quality: "ID", basis: "project_release_details.project_id", source: "eyes:releases" },
  };
}

function buildLabelArtist(state: PartnerCompanyState, identity: ProjectIdentity, release: ProjectReleaseSection): ProjectLabelArtistSection {
  const labelArtists = state.domains.labelArtists.data?.items ?? [];
  const textCandidates = matchLabelArtistCandidates(identity.artistText, labelArtists);

  const releaseWithArtist = release.rows.find((r) => r.labelArtistId !== null);
  const idCandidate = releaseWithArtist ? labelArtists.find((a) => a.id === releaseWithArtist.labelArtistId) ?? null : null;

  const relations: EntityRelation[] = [];
  let status: LabelArtistLinkStatus;
  let conflict: DossierConflict | null = null;

  if (idCandidate) {
    relations.push({ fromType: "release", fromId: identity.projectId, toType: "labelArtist", toId: idCandidate.id, quality: "ID", basis: "project_release_details.label_artist_id", source: "eyes:releases" });
    if (textCandidates.length > 0 && !textCandidates.some((c) => c.id === idCandidate.id)) {
      status = "CONFLICT";
      conflict = {
        code: "LABEL_ARTIST_ID_NAME_MISMATCH",
        sources: ["eyes:releases.labelArtistId", "eyes:labelArtists (projects.artist name match)"],
        description: `release.label_artist_id resolves to "${idCandidate.name}" (${idCandidate.id}), but projects.artist text-matches ${textCandidates.map((c) => `"${c.name}" (${c.id})`).join(", ")} — different entities.`,
      };
    } else {
      status = "ID";
    }
  } else if (textCandidates.length === 1) {
    status = "TEXT_MATCH";
    relations.push({ fromType: "project", fromId: identity.projectId, toType: "labelArtist", toId: textCandidates[0].id, quality: "TEXT_MATCH", basis: "projects.artist = label_artists.name", source: "eyes:labelArtists" });
  } else if (textCandidates.length > 1) {
    status = "AMBIGUOUS_TEXT_MATCH";
  } else if (!state.domains.releases.data && !state.domains.labelArtists.data) {
    status = "UNKNOWN";
  } else {
    status = "NONE";
  }

  return { status, idCandidate, textCandidates, conflict, relations };
}

function buildVictor(state: PartnerCompanyState, projectId: string): ProjectVictorSection {
  const active = state.domains.victor.data?.active ?? [];
  const linkedWorks = active.filter((w) => w.projectId === projectId);
  return {
    linkedWorks,
    relation: { fromType: "project", fromId: projectId, toType: "victorWork", toId: null, quality: "ID", basis: "vendor_project_work.project_id", source: "eyes:victor" },
    scopeNote: "ACTIVE-status Victor works only (Partner Eyes' per-row detail scope) — completed/cancelled works for this project, if any, are counted in Victor's company-wide totalWorks but not individually visible here.",
  };
}

function buildSteven(state: PartnerCompanyState, projectId: string): ProjectStevenSection {
  const open = state.domains.steven.data?.open ?? [];
  const linkedWorks = open.filter((w) => w.projectId === projectId);
  return {
    linkedWorks,
    relation: { fromType: "project", fromId: projectId, toType: "stevenWork", toId: null, quality: "ID", basis: "sound_engineer_work.project_id", source: "eyes:steven" },
    scopeNote: "OPEN (non-closed) Steven works only — closed works for this project, if any, are counted in Steven's company-wide totalWorks but not individually visible here. Ball location remains UNKNOWN/UNSUPPORTED (no inference built).",
  };
}

function buildTasks(state: PartnerCompanyState, projectId: string): ProjectTasksSection {
  const items = (state.domains.tasks.data?.items ?? []).filter((t) => t.projectId === projectId);
  return {
    scope: "OPEN_TASKS_ONLY", items, count: items.length,
    relation: { fromType: "project", fromId: projectId, toType: "task", toId: null, quality: "ID", basis: "tasks.related_type=\"project\" AND tasks.related_id", source: "eyes:tasks" },
  };
}

function buildClips(state: PartnerCompanyState, identity: ProjectIdentity): ProjectClipsSection {
  const all = state.domains.clips.data?.items ?? [];
  const linked = all.filter((c) => c.projectId === identity.projectId);
  const artistNames = new Set(splitArtistNames(identity.artistText));
  const unlinkedCandidates = all.filter((c) => c.projectId === null && artistNames.has(c.artistName));
  return {
    linked, unlinkedCandidates,
    relation: { fromType: "project", fromId: identity.projectId, toType: "clip", toId: null, quality: "ID", basis: "red_films_productions.project_id", source: "eyes:clips" },
  };
}

function buildShows(): ProjectShowsSection {
  return {
    status: "NO_DIRECT_RELATION_MODELED", relatedShowsContext: [],
    note: "A Show is not necessarily tied to one Project. v1 deliberately does not guess a relation from artist/client name similarity — no direct project↔show link exists in the data model today.",
  };
}

function buildExternalSound(): ProjectExternalSoundSection {
  return {
    status: "NOT_IN_EYES",
    note: "No generic external-sound domain exists in Partner Eyes. Steven is the only externally-paid sound role currently represented (see the steven section) — he is not relabelled as generic \"external sound\".",
  };
}

function classifyDomain(state: PartnerCompanyState, key: keyof PartnerCompanyState["domains"]): "complete" | "partial" | "unknown" {
  const d = state.domains[key];
  if (d.status !== "AVAILABLE") return "unknown";
  if (d.coverage === "FULL") return "complete";
  if (d.coverage === "PARTIAL") return "partial";
  return "unknown";
}

function buildDataQuality(state: PartnerCompanyState, dossier: Omit<ProjectDossier, "dataQuality" | "provenance">): DossierDataQuality {
  const completeDomains: string[] = [];
  const partialDomains: string[] = [];
  const unknownDomains: string[] = [];
  const keys: Array<keyof PartnerCompanyState["domains"]> = [
    "projects", "clients", "proposals", "finance", "receivables", "sessions", "releases", "labelArtists", "victor", "steven", "tasks", "clips",
  ];
  for (const k of keys) {
    const c = classifyDomain(state, k);
    if (c === "complete") completeDomains.push(k);
    else if (c === "partial") partialDomains.push(k);
    else unknownDomains.push(k);
  }

  const weakRelations: string[] = [];
  if (dossier.client.status === "MATCHED") weakRelations.push("client (TEXT_MATCH)");
  if (dossier.client.status === "AMBIGUOUS") weakRelations.push("client (AMBIGUOUS)");
  if (dossier.labelArtist.status === "TEXT_MATCH") weakRelations.push("labelArtist (TEXT_MATCH)");
  if (dossier.labelArtist.status === "AMBIGUOUS_TEXT_MATCH") weakRelations.push("labelArtist (AMBIGUOUS)");
  if (dossier.clips.unlinkedCandidates.length > 0) weakRelations.push("clips (unlinked TEXT_MATCH candidates present)");

  const conflicts: DossierConflict[] = dossier.labelArtist.conflict ? [dossier.labelArtist.conflict] : [];

  return { completeDomains, partialDomains, unknownDomains, weakRelations, conflicts };
}

export function buildProjectDossier(state: PartnerCompanyState, projectId: string): ProjectDossierResult {
  const identity = buildIdentity(state, projectId);
  if (!identity) {
    return {
      ok: false, reason: "NOT_FOUND_IN_EYES_SCOPE", projectId,
      note: "Not found within Partner Eyes' current scope. The projects domain only sees VISIBLE projects (is_hidden=false) — this could mean the project is hidden, or the id doesn't exist. Cannot distinguish the two without a new read.",
    };
  }

  const release = buildRelease(state, projectId);
  const client = buildClient(state, identity);
  const labelArtist = buildLabelArtist(state, identity, release);

  const base = {
    dossierSchemaVersion: PROJECT_DOSSIER_SCHEMA_VERSION,
    projectId,
    identity,
    client,
    proposals: buildProposals(state, projectId),
    finance: buildFinance(state, identity),
    sessions: buildSessions(state, projectId),
    release,
    labelArtist,
    victor: buildVictor(state, projectId),
    steven: buildSteven(state, projectId),
    tasks: buildTasks(state, projectId),
    clips: buildClips(state, identity),
    shows: buildShows(),
    externalSound: buildExternalSound(),
  };

  const dataQuality = buildDataQuality(state, base);
  const provenance = {
    eyesCapturedAt: state.capturedAt,
    eyesSchemaVersion: state.schemaVersion,
    cooSchemaVersion: state.cooSchemaVersion,
    dossierSchemaVersion: PROJECT_DOSSIER_SCHEMA_VERSION,
    sectionSources: {
      identity: identity.identitySource === "OPEN_SET" ? "eyes:projects (open set)" : "eyes:projects (index only — closed project)",
      client: "eyes:clients + projects.artist (TEXT_MATCH)",
      proposals: "eyes:proposals",
      finance: "eyes:receivables + eyes:finance",
      sessions: "eyes:sessions",
      release: "eyes:releases",
      labelArtist: "eyes:releases.labelArtistId + eyes:labelArtists",
      victor: "eyes:victor",
      steven: "eyes:steven",
      tasks: "eyes:tasks",
      clips: "eyes:clips",
      shows: "not modeled in v1",
      externalSound: "not in Partner Eyes",
    },
  };

  return { ok: true, dossier: { ...base, dataQuality, provenance } };
}

export function buildAllProjectDossiers(state: PartnerCompanyState): Map<string, ProjectDossier> {
  const out = new Map<string, ProjectDossier>();
  const index = state.domains.projects.data?.index ?? {};
  for (const projectId of Object.keys(index)) {
    const result = buildProjectDossier(state, projectId);
    if (result.ok) out.set(projectId, result.dossier);
  }
  return out;
}
