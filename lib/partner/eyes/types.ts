/**
 * Redbloods Partner — Eyes / Company State (Phase B). Shared types.
 *
 * This is a SNAPSHOT, not reasoning: no signals, no cases, no recommendations.
 * Every domain below answers four questions and nothing else:
 *   - what do we see (data)
 *   - do we actually have it (status / coverage)
 *   - how much should it be trusted (reliability / relation quality)
 *   - what don't we know (warnings)
 *
 * "No data" is never silently read as zero or as "fine" — see DataStatus.
 */
import type { CompanyState, SourceStatus } from "../../coo/types";

/**
 * Did this domain's read produce usable data at all?
 *   AVAILABLE   — the read succeeded and returned data (possibly an empty set, which is itself a fact).
 *   PARTIAL     — some of the read succeeded (e.g. one sub-source of a domain failed, another didn't).
 *   UNAVAILABLE — this domain has no reader in this phase, or the concept doesn't exist as asked (e.g. "suppliers").
 *   UNKNOWN     — the read was attempted and failed; we do not know the true state.
 */
export type DataStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "UNKNOWN";

/**
 * Of the real-world set this domain describes, how much does the data actually cover?
 * Distinct from DataStatus: a domain can be AVAILABLE with only PARTIAL coverage
 * (e.g. finance settings exist for some projects, not all — see lib/coo's own
 * CoverageEntry, which this reuses for COO-backed domains).
 */
export type Coverage = "FULL" | "PARTIAL" | "NONE" | "FAILED";

/** How much an outside caller should trust this domain's numbers as an input. */
export type Reliability = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

/**
 * How an entity in this domain connects to another entity.
 *   ID         — a real foreign key (or an equally deterministic derived key, e.g. a settings key that embeds the id).
 *   COMPOSITE  — matched via more than one field together (reserved; unused as of this phase).
 *   TEXT_MATCH — matched by comparing free text (a name), never trustworthy as identity.
 *   NONE       — no relation exists.
 *   UNKNOWN    — not enough data to classify.
 */
export type RelationQuality = "ID" | "COMPOSITE" | "TEXT_MATCH" | "NONE" | "UNKNOWN";

export type PartnerDomainKey =
  | "projects" | "clients" | "proposals" | "finance" | "receivables"
  | "sessions" | "releases" | "shows" | "victor" | "steven" | "tasks"
  | "agentAlerts" | "labelArtists" | "clips" | "suppliers";

export interface PartnerDomainProvenance {
  /** e.g. "supabase:clients" or "lib/coo:projects" (a COO-adapted domain). */
  source: string;
  /** The function/module that actually produced this data. */
  reader: string;
  /** ISO timestamp of the read this domain's data came from. */
  fetchedAt: string;
}

export interface PartnerRelation {
  toDomain: PartnerDomainKey | "external";
  /** The KIND of link — a real id vs. free-text matching. Never downgraded because only some rows carry it. */
  quality: RelationQuality;
  /**
   * How many of the RELEVANT records actually carry this relation (distinct from `quality`,
   * which never changes because of partial coverage — see lib/partner/eyes/coverage.ts).
   * Omitted when not computable without a new read (e.g. per-row transaction→project linkage,
   * which lib/coo's aggregated FinanceFact does not preserve).
   */
  coverage?: Coverage;
  /** The exact field(s) or key pattern that carries the relation, e.g. "projects.artist = clients.name". */
  via: string;
  notes?: string;
}

export interface PartnerDomainState<T> {
  domain: PartnerDomainKey;
  status: DataStatus;
  coverage: Coverage;
  reliability: Reliability;
  provenance: PartnerDomainProvenance;
  relations: PartnerRelation[];
  warnings: string[];
  data: T | null;
}

// ── New (Partner-only) domain summary shapes ─────────────────────────────────

export interface ClientSummary { id: string; name: string; type: string; status: string }
export interface ClientsFact {
  total: number;
  byType: Record<string, number>;
  items: ClientSummary[];
}

export interface LabelArtistSummary { id: string; name: string; status: string; balanceEntries: number }
export interface LabelArtistsFact {
  total: number;
  byStatus: Record<string, number>;
  items: LabelArtistSummary[];
  /** artist_balance_entries is an independent, manually-maintained ledger — see the domain's warnings. */
  balanceCoverage: { artistsWithEntries: number; totalEntries: number };
}

export interface ClipSummary { id: string; title: string; status: string; projectId: string | null; artistName: string }
export interface ClipsFact {
  total: number;
  withProjectId: number;
  withoutProjectId: number;
  items: ClipSummary[];
}

/**
 * agent_alerts, Phase B.1: lib/coo's own read is intentionally narrow (status="new"
 * only, then allowlisted-type + max-age for the brief) — correct for a morning brief,
 * too narrow for Eyes. This is the BROAD picture: every status, every type, no age cutoff.
 * Still no reasoning: an old/resolved alert here is a historical row, never "current".
 */
export interface AlertSummary {
  id: string; type: string; severity: string; status: string;
  hasEntityKey: boolean; relatedProjectId: string | null; createdAt: string; ageDays: number | null;
}
export interface AgentAlertsFact {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  withEntityKey: number;
  withRelatedProject: number;
  ageStats: { median: number | null; oldest: number | null };
  /** What lib/coo's own brief-oriented read actually shows — a cross-reference, not a second source of truth. */
  cooVisible: { shownByBrief: number | null; note: string };
  items: AlertSummary[];
}

// ── Raw input for the NEW Partner-only readers (nothing lib/coo already reads, or lib/coo reads a narrower subset) ──

export interface RawClient { id: string; name: string; type: string; status: string }
export interface RawLabelArtist { id: string; name: string; status: string }
export interface RawClip { id: string; title: string; status: string; projectId: string | null; artistName: string }
export interface RawAlertEyes {
  id: string; type: string; severity: string; status: string; hasEntityKey: boolean; relatedProjectId: string | null; createdAt: string;
}

export interface PartnerEyesRaw {
  sources: SourceStatus[];
  clients: RawClient[] | null;
  labelArtists: RawLabelArtist[] | null;
  /** label_artists.id -> row count in artist_balance_entries. null = the read failed or labelArtists is null. */
  artistBalanceCounts: Record<string, number> | null;
  clips: RawClip[] | null;
  /** ALL agent_alerts rows regardless of status — see AgentAlertsFact. */
  alerts: RawAlertEyes[] | null;
}

// ── The snapshot ──────────────────────────────────────────────────────────────

export interface PartnerCompanyState {
  capturedAt: string;
  todayIL: string;
  /** Schema version of THIS eyes layer (bump on breaking shape changes). */
  schemaVersion: string;
  /** The lib/coo schema version this snapshot was adapted from, for traceability. */
  cooSchemaVersion: string;
  domains: {
    projects: PartnerDomainState<CompanyState["projects"]>;
    clients: PartnerDomainState<ClientsFact>;
    proposals: PartnerDomainState<CompanyState["proposals"]>;
    finance: PartnerDomainState<CompanyState["finance"]>;
    receivables: PartnerDomainState<CompanyState["receivables"]>;
    sessions: PartnerDomainState<CompanyState["sessions"]>;
    releases: PartnerDomainState<CompanyState["releases"]>;
    shows: PartnerDomainState<CompanyState["shows"]>;
    victor: PartnerDomainState<CompanyState["team"]["victor"]>;
    steven: PartnerDomainState<CompanyState["team"]["steven"]>;
    tasks: PartnerDomainState<CompanyState["tasks"]>;
    /** Partner-only broad read (Phase B.1) — see AgentAlertsFact for why this is NOT adapted from lib/coo's state.alerts. */
    agentAlerts: PartnerDomainState<AgentAlertsFact>;
    labelArtists: PartnerDomainState<LabelArtistsFact>;
    clips: PartnerDomainState<ClipsFact>;
    suppliers: PartnerDomainState<null>;
  };
  /** The underlying COO read's own source statuses, kept verbatim for traceability. */
  cooSources: SourceStatus[];
}
