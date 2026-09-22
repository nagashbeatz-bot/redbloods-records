/**
 * Redbloods Partner — Entity Dossiers (Phase C.1). Project Dossier v1.
 *
 * A Dossier is NOT a summary — it is a structured, typed, traceable snapshot
 * of everything Partner Eyes already knows about one entity. No reasoning:
 * no health/risk/bottleneck/priority/recommendation. Built entirely from an
 * already-computed PartnerCompanyState — no new queries, no query-per-entity.
 *
 * The same epistemic vocabulary as lib/partner/eyes carries through
 * (RelationQuality, Coverage) plus one addition specific to entity matching:
 * a weak (TEXT_MATCH) relation can be MATCHED / NO_MATCH / AMBIGUOUS, and two
 * relations pointing at different entities is a CONFLICT — never silently
 * resolved by picking one.
 */
import type { Coverage, RelationQuality } from "../eyes/types";
import type {
  DeadlineFact, ExpectedIncomeFact, ProposalFact, ReleaseFact, StevenWorkFact, TaskFact, VictorWorkFact,
} from "../../coo/types";
import type { ClientSummary, ClipSummary, LabelArtistBalanceTotals, LabelArtistSummary, ShowSummary, SessionSummary } from "../eyes/types";

export const PROJECT_DOSSIER_SCHEMA_VERSION = "project-dossier-v1";
export const CLIENT_DOSSIER_SCHEMA_VERSION = "client-dossier-v1";
export const LABEL_ARTIST_DOSSIER_SCHEMA_VERSION = "label-artist-dossier-v1";

export type DossierEntityType =
  | "project" | "client" | "proposal" | "session" | "release" | "labelArtist"
  | "victorWork" | "stevenWork" | "task" | "clip" | "show" | "externalSound";

/** A typed, reusable description of how two entities connect (or don't). */
export interface EntityRelation {
  fromType: DossierEntityType;
  fromId: string;
  toType: DossierEntityType;
  /** null when quality is NONE/AMBIGUOUS/UNKNOWN and no single id applies. */
  toId: string | null;
  quality: RelationQuality;
  /** The exact field/key that carries the relation, e.g. "sessions.project_id", "projects.artist = clients.name". Never vague prose. */
  basis: string;
  coverage?: Coverage;
  /** Which Partner Eyes domain this came from, e.g. "eyes:sessions". */
  source: string;
}

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * lib/coo only retains FULL ProjectFact detail for non-closed projects
 * (facts.ts skips הושלם/בוטל when building `open`); a closed-but-visible
 * project is still in `state.projects.index` with just name/status/
 * businessType/artist. This field says honestly which case we're in —
 * never pretend a closed project has detail it doesn't.
 */
export type ProjectIdentitySource = "OPEN_SET" | "INDEX_ONLY";

export interface ProjectIdentity {
  projectId: string;
  name: string;
  artistText: string;
  status: string;
  businessType: string;
  identitySource: ProjectIdentitySource;
  /** null when identitySource is INDEX_ONLY — not fabricated. */
  projectType: string | null;
  deadline: DeadlineFact | null;
  daysSinceUpdate: number | null;
  active: boolean | null;
  hasFinanceSetting: boolean | null;
}

// ── Client (TEXT_MATCH only — no client_id on projects) ─────────────────────

export type ClientMatchStatus = "MATCHED" | "NO_MATCH" | "AMBIGUOUS" | "UNKNOWN";

export interface ProjectClientSection {
  status: ClientMatchStatus;
  /** 0 candidates = NO_MATCH, 1 = MATCHED, 2+ = AMBIGUOUS. Never narrowed to one by guessing. */
  candidates: ClientSummary[];
  relation: EntityRelation | null;
  notes: string[];
}

// ── Proposals (ID via linked_project_id) ─────────────────────────────────────

export interface ProjectProposalsSection {
  items: ProposalFact[];
  relation: EntityRelation;
}

// ── Finance (DERIVED from Partner Eyes' receivables + finance domains only) ──

export type FinanceConfigStatus = "CONFIGURED" | "EXCEPTION" | "NOT_CONSIDERED" | "UNKNOWN";
export type BalanceKind = "DEBT" | "NO_DEBT" | "OVERPAYMENT" | "UNKNOWN";

export interface ProjectFinanceSection {
  configStatus: FinanceConfigStatus;
  /** FACT from finance settings. null = UNKNOWN, never 0. */
  agreedPrice: number | null;
  currency: string | null;
  /** DERIVED (lib/coo receivables) — שולם/התקבל only. null = UNKNOWN. */
  receivedIncome: number | null;
  /** DERIVED, signed (negative = overpaid) — reused verbatim from lib/coo, never recomputed. */
  balance: number | null;
  balanceKind: BalanceKind;
  /** DERIVED — expected income rows overdue for this project (subset only; see transactionDetail). */
  expectedOverdueItems: ExpectedIncomeFact[];
  /**
   * Honest gap: PartnerCompanyState carries no per-project transaction list —
   * only aggregated company-wide totals (finance) and derived per-project
   * balance (receivables). A full income/expense breakdown per project would
   * need a new read, not done in this block.
   */
  transactionDetail: "NOT_AVAILABLE_IN_EYES";
}

// ── Sessions (ID via project_id, full history per Phase B.2) ────────────────

export interface ProjectSessionsSection {
  count: number;
  firstSessionDate: string | null;
  latestSessionDate: string | null;
  /** Earliest session date >= PartnerCompanyState.todayIL among this project's sessions. null = none upcoming/today. */
  nextSessionDate: string | null;
  byStatus: Record<string, number>;
  items: SessionSummary[];
  relation: EntityRelation;
}

// ── Release + Label Artist ────────────────────────────────────────────────────

/**
 * lib/coo's releases.rows only carries ACTIVE-stage rows (excludes יצא/released
 * and בהשהייה/on-hold — see Phase B.2). So "no active release row" is NOT the
 * same claim as "this project never had a release" — Partner Eyes literally
 * cannot see released/paused rows right now.
 */
export type ReleaseLookupStatus = "FOUND" | "NO_ACTIVE_RELEASE_ROW" | "UNKNOWN";

export interface ProjectReleaseSection {
  status: ReleaseLookupStatus;
  rows: ReleaseFact[];
  relation: EntityRelation | null;
  notes: string[];
}

export type LabelArtistLinkStatus = "ID" | "TEXT_MATCH" | "AMBIGUOUS_TEXT_MATCH" | "NONE" | "UNKNOWN" | "CONFLICT";

export interface ProjectLabelArtistSection {
  status: LabelArtistLinkStatus;
  /** Resolved via release.labelArtistId — the reliable path, when present. */
  idCandidate: LabelArtistSummary | null;
  /** Resolved via projects.artist name matching — the weak path, always computed for comparison. */
  textCandidates: LabelArtistSummary[];
  conflict: DossierConflict | null;
  relations: EntityRelation[];
}

// ── Victor / Steven (ID via project_id; Hardening-1 ball semantics untouched) ─

export interface ProjectVictorSection {
  /** ID-linked works. Scope: ACTIVE-status only (Partner Eyes limitation — see scopeNote). */
  linkedWorks: VictorWorkFact[];
  relation: EntityRelation;
  scopeNote: string;
}

export interface ProjectStevenSection {
  /** ID-linked works. Scope: OPEN (non-closed) only (Partner Eyes limitation — see scopeNote). */
  linkedWorks: StevenWorkFact[];
  relation: EntityRelation;
  scopeNote: string;
}

// ── Tasks (related_type="project" AND related_id=projectId; OPEN ONLY) ──────

export interface ProjectTasksSection {
  scope: "OPEN_TASKS_ONLY";
  items: TaskFact[];
  count: number;
  relation: EntityRelation;
}

// ── Clips (ID via project_id; unlinked name-only candidates kept separate) ──

export interface ProjectClipsSection {
  linked: ClipSummary[];
  /** clip.projectId === null but artist_name text-matches — a candidate, NEVER auto-confirmed. */
  unlinkedCandidates: ClipSummary[];
  relation: EntityRelation;
}

// ── Shows (v1: no direct relation modeled — see Phase C.1 §24) ──────────────

export interface ProjectShowsSection {
  status: "NO_DIRECT_RELATION_MODELED";
  relatedShowsContext: [];
  note: string;
}

// ── External sound (blind spot, not a domain) ────────────────────────────────

export interface ProjectExternalSoundSection {
  status: "NOT_IN_EYES";
  note: string;
}

// ── Data quality / conflicts ──────────────────────────────────────────────────

export interface DossierConflict {
  code: string;
  sources: string[];
  description: string;
}

export interface DossierDataQuality {
  completeDomains: string[];
  partialDomains: string[];
  unknownDomains: string[];
  weakRelations: string[];
  conflicts: DossierConflict[];
}

export interface DossierProvenance {
  eyesCapturedAt: string;
  eyesSchemaVersion: string;
  cooSchemaVersion: string;
  dossierSchemaVersion: string;
  sectionSources: Record<string, string>;
}

// ── The Dossier ────────────────────────────────────────────────────────────────

export interface ProjectDossier {
  dossierSchemaVersion: string;
  projectId: string;
  identity: ProjectIdentity;
  client: ProjectClientSection;
  proposals: ProjectProposalsSection;
  finance: ProjectFinanceSection;
  sessions: ProjectSessionsSection;
  release: ProjectReleaseSection;
  labelArtist: ProjectLabelArtistSection;
  victor: ProjectVictorSection;
  steven: ProjectStevenSection;
  tasks: ProjectTasksSection;
  clips: ProjectClipsSection;
  shows: ProjectShowsSection;
  externalSound: ProjectExternalSoundSection;
  dataQuality: DossierDataQuality;
  provenance: DossierProvenance;
}

export type ProjectDossierResult =
  | { ok: true; dossier: ProjectDossier }
  | { ok: false; reason: "NOT_FOUND_IN_EYES_SCOPE"; projectId: string; note: string };

// ════════════════════════════════════════════════════════════════════════════
// Shared building blocks (Phase C.2) — reused by both Client and Label Artist Dossiers
// ════════════════════════════════════════════════════════════════════════════

/** A lightweight project reference sourced from state.projects.index — works for BOTH open and closed projects uniformly (unlike full ProjectFact, which only exists for open ones). Use buildProjectDossier() for full project detail. */
export interface ProjectRefSummary { projectId: string; name: string; status: string; businessType: string }

export interface FinanceByCurrencySummary { currency: string; agreedPriceSum: number; receivedSum: number; balanceSum: number; projectCount: number }

/**
 * Finance aggregated across SEVERAL projects that relate to an entity (a Client
 * or Label Artist) — never a single canonical "entity revenue" figure, because
 * the project↔entity relation itself may be weak (TEXT_MATCH). relationQuality
 * says which set of projects this was built from; a TEXT_MATCH-derived total is
 * never presented with the same confidence as an ID-derived one.
 */
export interface AggregatedFinanceContext {
  byCurrency: FinanceByCurrencySummary[];
  /** Projects in this bucket with configStatus other than CONFIGURED (missing agreedPrice, exception, etc.) — counted, never coerced into the sums as 0. */
  projectsWithUnknownFinance: number;
  relationQuality: RelationQuality;
  note: string;
}

export interface SessionsBucket { count: number; firstSessionDate: string | null; latestSessionDate: string | null; items: SessionSummary[] }

// ════════════════════════════════════════════════════════════════════════════
// Client Dossier (Phase C.2)
// ════════════════════════════════════════════════════════════════════════════

export interface ClientIdentity { clientId: string; name: string; type: string; status: string; createdAt: string | null }

export interface ClientProposalsSection {
  items: ProposalFact[];
  relation: EntityRelation;
  /**
   * Phase C.2 finding: proposals.client_id is a REAL FK in the DB (proven by
   * lib/coo/readers.ts's own `clients(name)` embedded-select, which only works
   * against a real foreign key) — but lib/coo's ProposalFact/RawProposal never
   * retains it, only the denormalized clientName text. Not fixed this block
   * (lib/coo change, not pre-approved) — this is a documented known gap.
   */
  scopeDescription: string;
}

export interface ClientDossier {
  dossierSchemaVersion: string;
  clientId: string;
  identity: ClientIdentity;
  /** Projects whose artist text matches ONLY this client (TEXT_MATCH, never ID — no client_id exists on projects). */
  matchedProjects: ProjectRefSummary[];
  /** Projects whose artist text matches this client AND at least one other client with the same name — never narrowed to one. */
  ambiguousProjectCandidates: ProjectRefSummary[];
  proposals: ClientProposalsSection;
  /** Derived from matchedProjects only (never ambiguousProjectCandidates) — relationQuality is always TEXT_MATCH. */
  finance: AggregatedFinanceContext;
  /** Derived from matchedProjects' sessions only. */
  sessions: SessionsBucket;
  /** shows.artist_client_id — the client performed. */
  performerShows: { items: ShowSummary[]; relation: EntityRelation };
  /** shows.booker_client_id. */
  bookerShows: { items: ShowSummary[]; relation: EntityRelation };
  /** shows.dj_client_id. */
  djShows: { items: ShowSummary[]; relation: EntityRelation };
  dataQuality: DossierDataQuality;
  provenance: DossierProvenance;
}

export type ClientDossierResult =
  | { ok: true; dossier: ClientDossier }
  | { ok: false; reason: "NOT_FOUND_IN_EYES_SCOPE"; clientId: string; note: string };

// ════════════════════════════════════════════════════════════════════════════
// Label Artist Dossier (Phase C.2)
// ════════════════════════════════════════════════════════════════════════════

export interface LabelArtistIdentity { artistId: string; name: string; status: string; createdAt: string | null; updatedAt: string | null }

/** idLinked and textMatched are mutually exclusive — a project already ID-linked never also appears in textMatched. */
export interface LabelArtistProjectsSection {
  idLinked: ProjectRefSummary[];
  textMatched: ProjectRefSummary[];
  /** Projects whose text ambiguously matches this artist AND at least one other label artist (and carry no release ID resolving it). */
  ambiguousTextMatched: ProjectRefSummary[];
}

export interface LabelArtistReleasesSection {
  /** Every ACTIVE-stage release row (lib/coo scope) for this artist's ID-linked projects. */
  rows: ReleaseFact[];
  /** NOT a lifetime count — see scopeNote. Only what Partner Eyes' active-stage-only release scope can see right now. */
  visibleReleaseCount: number;
  firstVisibleReleaseTargetDate: string | null;
  latestVisibleReleaseTargetDate: string | null;
  scopeNote: string;
}

export interface LabelArtistSessionsSection {
  /** Sessions of projects reached via the STRONG (ID, release.label_artist_id → release.project_id) path. */
  viaIdLinkedProjects: SessionsBucket;
  /** Sessions of projects reached only via the WEAK (TEXT_MATCH, projects.artist = label_artists.name) path. */
  viaTextMatchedProjects: SessionsBucket;
  note: string;
}

export interface LabelArtistFinanceSection {
  viaIdLinkedProjects: AggregatedFinanceContext;
  viaTextMatchedProjects: AggregatedFinanceContext;
}

export interface LabelArtistBalanceLedgerSection {
  hasEntries: boolean;
  entryCount: number;
  /** null when hasEntries is false — never a fake all-zero totals object. Same formula as lib/artist-balance-store.ts:computeArtistBalanceTotals(). */
  totals: LabelArtistBalanceTotals | null;
  note: string;
}

export interface LabelArtistShowsSection {
  status: "NO_DIRECT_RELATION_MODELED";
  note: string;
}

export interface LabelArtistDossier {
  dossierSchemaVersion: string;
  artistId: string;
  identity: LabelArtistIdentity;
  projects: LabelArtistProjectsSection;
  releases: LabelArtistReleasesSection;
  sessions: LabelArtistSessionsSection;
  finance: LabelArtistFinanceSection;
  balanceLedger: LabelArtistBalanceLedgerSection;
  /** v1: shows have no label_artist_id, and no reliable path from artist → client → show is modeled (would be a 2-hop text guess) — see §22. */
  shows: LabelArtistShowsSection;
  dataQuality: DossierDataQuality;
  provenance: DossierProvenance;
}

export type LabelArtistDossierResult =
  | { ok: true; dossier: LabelArtistDossier }
  | { ok: false; reason: "NOT_FOUND_IN_EYES_SCOPE"; artistId: string; note: string };
