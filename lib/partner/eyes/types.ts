/**
 * Redbloods Partner — Eyes / Company State (Phase B / B.1 / B.2). Shared types.
 *
 * This is a SNAPSHOT, not reasoning: no signals, no cases, no recommendations.
 * Every domain below answers five questions and nothing else:
 *   - what do we see (data)
 *   - what EXACTLY is the scope of what we see (scopeDescription — current
 *     operational state vs. full history vs. a named subset; Phase B.2)
 *   - do we actually have it (status / coverage)
 *   - how much should it be trusted (reliability / relation quality)
 *   - what don't we know (warnings)
 *
 * "No data" is never silently read as zero or as "fine" — see DataStatus.
 * A subset is never silently read as complete — see Coverage + scopeDescription.
 *
 * Owner decision (Phase B.2): agent_alerts is intentionally OUT of Redbloods
 * Partner. Not a domain, not an Eyes source, not Fact/Signal/Case/Priority
 * evidence. The agent_alerts system itself is completely untouched — this is
 * a decision about what Partner looks at, not a change to that system.
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
 *   FULL    — evidence the reader covers the domain as scopeDescription defines it (e.g. "all transactions" and the reader truly has no filter).
 *   PARTIAL — known to exclude part of the domain (a status/date/visibility filter, a forward-only window, per-row detail limited to a subset, etc.) — see scopeDescription for exactly what's missing.
 *   NONE    — no usable rows.
 *   FAILED  — the reader/query failed; not the same as NONE.
 * Distinct from DataStatus: a domain can be AVAILABLE with only PARTIAL coverage.
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
  | "labelArtists" | "clips" | "suppliers";

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
  /**
   * Exactly what this domain's data represents (Phase B.2) — e.g. "all projects (visible,
   * is_hidden=false) — hidden projects excluded", "open tasks only (status=פתוח) — no closed/
   * cancelled history", "full history, no date window". Never left to be inferred from `coverage` alone.
   */
  scopeDescription: string;
  /** Rows actually detailed in `data` right now (the "current"/operational subset, when that's narrower than history). null when not meaningfully distinct from totalHistoricalCount. */
  currentOperationalCount?: number | null;
  /** True count across all history/status, when reliably known even if `data` only details a subset (e.g. Victor/Steven totalWorks). null when not known/not applicable. */
  totalHistoricalCount?: number | null;
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
 * Sessions, Phase B.2: lib/coo only ever reads a forward window (sessionWindowDays).
 * This is the FULL history — every session ever recorded, via lib/sessions-store.ts's
 * listAllSessions() (a separate read from COO's; COO's own window-limited behavior is
 * completely unchanged). Still no reasoning: a "בוטל"/"בוצע" status here is a stored fact,
 * never evidence about an artist's reliability.
 */
export interface SessionSummary { id: string; projectId: string | null; showId: string | null; dateYmd: string; status: string; sessionType: string }
export interface SessionsFact {
  total: number;
  withProject: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  /** What lib/coo's own forward-window read would show — a cross-reference, not a second source of truth. */
  cooVisible: { count: number | null; note: string };
  items: SessionSummary[];
}

/**
 * Shows, Phase B.2: lib/coo's state.shows only carries `upcoming` + `doneUnpaid` (an
 * operational subset for the brief). This is FULL show history via the SAME listShows()
 * function lib/coo already calls (reused function, a second call — not a new query shape).
 */
export interface ShowSummary {
  id: string; name: string; status: string; paymentStatus: string; dateYmd: string | null;
  djClientId: string | null; djConfirmationStatus: string | null;
}
export interface ShowsEyesFact {
  total: number;
  withDjClientId: number;
  byStatus: Record<string, number>;
  /** What lib/coo's own operational subset (upcoming + doneUnpaid) actually shows — cross-reference only. */
  cooVisible: { upcoming: number | null; doneUnpaid: number | null; note: string };
  items: ShowSummary[];
}

// ── Raw input for the NEW Partner-only readers (nothing lib/coo already reads, or lib/coo reads a narrower subset) ──

export interface RawClient { id: string; name: string; type: string; status: string }
export interface RawLabelArtist { id: string; name: string; status: string }
export interface RawClip { id: string; title: string; status: string; projectId: string | null; artistName: string }
export interface RawShowEyes { id: string; name: string; status: string; paymentStatus: string; date: string | null; djClientId: string | null; djConfirmationStatus: string | null }
/** Mirrors lib/sessions-store.ts's SessionRow — kept as its own local type (not imported) so this pure types.ts file never references a store module, even for a type-only import. */
export interface RawSessionEyes { id: string; projectId: string | null; showId: string | null; date: string; startTime: string | null; endTime: string | null; status: string; sessionType: string }

export interface PartnerEyesRaw {
  sources: SourceStatus[];
  clients: RawClient[] | null;
  labelArtists: RawLabelArtist[] | null;
  /** label_artists.id -> row count in artist_balance_entries. null = the read failed or labelArtists is null. */
  artistBalanceCounts: Record<string, number> | null;
  clips: RawClip[] | null;
  /** Full session history (lib/sessions-store.ts:listAllSessions()) — separate from COO's forward window. */
  sessions: RawSessionEyes[] | null;
  /** Full show history (lib/shows-store.ts:listShows(), called a second time) — separate from COO's operational subset. */
  shows: RawShowEyes[] | null;
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
    /** Partner-only, full history (Phase B.2) — see SessionsFact. */
    sessions: PartnerDomainState<SessionsFact>;
    releases: PartnerDomainState<CompanyState["releases"]>;
    /** Partner-only, full history (Phase B.2) — see ShowsEyesFact. */
    shows: PartnerDomainState<ShowsEyesFact>;
    victor: PartnerDomainState<CompanyState["team"]["victor"]>;
    steven: PartnerDomainState<CompanyState["team"]["steven"]>;
    tasks: PartnerDomainState<CompanyState["tasks"]>;
    labelArtists: PartnerDomainState<LabelArtistsFact>;
    clips: PartnerDomainState<ClipsFact>;
    suppliers: PartnerDomainState<null>;
  };
  /** The underlying COO read's own source statuses, kept verbatim for traceability. */
  cooSources: SourceStatus[];
}
