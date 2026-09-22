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
import type { ClientSummary, ClipSummary, LabelArtistSummary, SessionSummary } from "../eyes/types";

export const PROJECT_DOSSIER_SCHEMA_VERSION = "project-dossier-v1";

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
