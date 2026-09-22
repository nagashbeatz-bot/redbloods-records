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
  | "labelArtists" | "clips" | "suppliers"
  // Phase C.3 — additive, Partner-only, full-history siblings of the domains
  // above. The originals (proposals/releases/tasks, scoped/filtered via
  // lib/coo; finance, aggregated) are UNCHANGED — same reasoning as Sessions/
  // Shows in Phase B.2, which added a full-history sibling read rather than
  // reinterpreting an existing COO-scoped domain.
  | "proposalsFull" | "releasesFull" | "transactions" | "tasksFull";

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

export interface ClientSummary { id: string; name: string; type: string; status: string; createdAt: string | null }
export interface ClientsFact {
  total: number;
  byType: Record<string, number>;
  items: ClientSummary[];
}

/**
 * Mirrors lib/artist-balance-store.ts:computeArtistBalanceTotals() exactly (same
 * 5 entry types, same formula: currentBalance = income - payments - expenses).
 * Duplicated rather than imported — that file has `import "server-only"` (same
 * reasoning as splitArtistNames in lib/partner/dossiers/relations.ts). The
 * table has NO currency column (see the domain's warnings) — treat as one
 * implicit ledger, never assumed to be ₪ without evidence.
 */
export interface LabelArtistBalanceTotals {
  income: number; expectedIncome: number; payments: number; expenses: number; expectedExpenses: number; currentBalance: number;
}
export interface LabelArtistSummary {
  id: string; name: string; status: string; createdAt: string | null; updatedAt: string | null;
  balanceEntries: number;
  /** null when this artist has zero ledger rows — never a fake all-zero totals object. */
  balanceTotals: LabelArtistBalanceTotals | null;
}
export interface LabelArtistsFact {
  total: number;
  byStatus: Record<string, number>;
  items: LabelArtistSummary[];
  /** artist_balance_entries is an independent, manually-maintained ledger — see the domain's warnings. */
  balanceCoverage: { artistsWithEntries: number; totalEntries: number };
}

export interface ClipSummary { id: string; title: string; status: string; projectId: string | null; artistName: string; createdAt: string | null; updatedAt: string | null }
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
  /** Phase C.2 — already fetched by listShows()'s select("*"), previously dropped like djClientId once was. */
  artistClientId: string | null;
  bookerClientId: string | null;
}
export interface ShowsEyesFact {
  total: number;
  withDjClientId: number;
  byStatus: Record<string, number>;
  /** What lib/coo's own operational subset (upcoming + doneUnpaid) actually shows — cross-reference only. */
  cooVisible: { upcoming: number | null; doneUnpaid: number | null; note: string };
  items: ShowSummary[];
}

// ── Phase C.3 — Change-Awareness data readiness. Partner-only, FULL-HISTORY
// siblings of proposals/releases/tasks (lib/coo's own reads of those stay
// exactly as they are — status-filtered/active-stage/open-only, unchanged,
// still used by the COO brief) + a brand-new Transactions domain (lib/coo's
// "finance" domain is an aggregate; this is the first per-row read Partner
// gets). Same discipline as every other Eyes domain: bulk read, one query,
// a failed source becomes null, no per-row reasoning. ─────────────────────

export interface ProposalSummary {
  id: string;
  /** proposals.client_id — a real FK (Phase C.3 finding, confirmed against the live schema and app/api/proposals/route.ts's own .eq("client_id", ...) usage). null on a legacy row only. */
  clientId: string | null;
  /** Denormalized display name (joined) — fallback TEXT_MATCH path for the rare legacy row with clientId=null. Never the primary relation when clientId is present. */
  clientName: string;
  linkedProjectId: string | null;
  title: string;
  amount: number;
  currency: string;
  status: string;
  followupYmd: string | null;
  sentYmd: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
export interface ProposalsFullFact {
  total: number;
  byStatus: Record<string, number>;
  withClientId: number;
  withLinkedProjectId: number;
  /** What lib/coo's own status-filtered ProposalFact list shows (drops נסגר/לא נסגר) — cross-reference only. */
  cooVisible: { count: number | null; note: string };
  items: ProposalSummary[];
}

export interface ReleaseSummary {
  /** project_release_details.project_id IS the primary key — there is no separate release id. 1:1 with a project. */
  projectId: string;
  labelArtistId: string | null;
  stage: string;
  targetYmd: string | null;
  stageEnteredAt: string | null;
  releasedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
export interface ReleasesFullFact {
  total: number;
  byStage: Record<string, number>;
  withLabelArtistId: number;
  /** What lib/coo's own active-stage-only ReleasesFact.rows shows (excludes יצא/released and בהשהייה/on-hold, visible label projects only) — cross-reference only. */
  cooVisible: { count: number | null; note: string };
  items: ReleaseSummary[];
}

export interface TransactionSummary {
  id: string;
  projectId: string | null;
  type: string;
  amount: number;
  currency: string;
  status: string;
  dateYmd: string | null;
  expenseScope: string | null;
  category: string;
  createdAt: string | null;
}
export interface TransactionsFact {
  total: number;
  withProjectId: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  /** Counts only (per Owner instruction) — never a summed cross-currency figure. */
  byCurrency: Record<string, number>;
  items: TransactionSummary[];
}

export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  dueYmd: string | null;
  relatedType: string;
  relatedId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
export interface TasksFullFact {
  total: number;
  byStatus: Record<string, number>;
  linkedToProject: number;
  /** What lib/coo's own open-only TasksFact.items shows — cross-reference only. */
  cooVisible: { openCount: number | null; note: string };
  items: TaskSummary[];
}

// ── Raw input for the NEW Partner-only readers (nothing lib/coo already reads, or lib/coo reads a narrower subset) ──

export interface RawClient { id: string; name: string; type: string; status: string; createdAt: string | null }
export interface RawLabelArtist { id: string; name: string; status: string; createdAt: string | null; updatedAt: string | null }
export interface RawClip { id: string; title: string; status: string; projectId: string | null; artistName: string; createdAt: string | null; updatedAt: string | null }
export interface RawShowEyes {
  id: string; name: string; status: string; paymentStatus: string; date: string | null;
  djClientId: string | null; djConfirmationStatus: string | null; artistClientId: string | null; bookerClientId: string | null;
}
/** One artist_balance_entries row — just enough to compute LabelArtistBalanceTotals; no description/note (private free text) retained. */
export interface RawBalanceEntry { id: string; artistId: string; entryType: string; amount: number; entryDate: string }
/** Mirrors lib/sessions-store.ts's SessionRow — kept as its own local type (not imported) so this pure types.ts file never references a store module, even for a type-only import. */
export interface RawSessionEyes { id: string; projectId: string | null; showId: string | null; date: string; startTime: string | null; endTime: string | null; status: string; sessionType: string }

/** proposals table, full history, no status filter. No `notes` (private free text). */
export interface RawProposalEyes {
  id: string; clientId: string | null; clientName: string; linkedProjectId: string | null; title: string;
  amount: number; currency: string; status: string; followupDate: string | null; sentDate: string | null;
  createdAt: string | null; updatedAt: string | null;
}
/** project_release_details table, full history — no project-visibility/business-type/stage filter (unlike lib/coo's listLabelReleases()). No `next_action`/`blocker`/`responsible` (free text, not needed for change-readiness). */
export interface RawReleaseEyes {
  projectId: string; labelArtistId: string | null; stage: string; targetDate: string | null;
  stageEnteredAt: string | null; releasedAt: string | null; createdAt: string | null; updatedAt: string | null;
}
/** transactions table, full history, every status/currency/scope. No `description`/`artist`/`notes`/`receipt_ref` (free text). No `updated_at` — confirmed against the live schema, the column does not exist on this table. */
export interface RawTransactionEyes {
  id: string; projectId: string | null; type: string; amount: number; currency: string | null;
  status: string; date: string | null; expenseScope: string | null; category: string | null; createdAt: string | null;
}
/** tasks table, full history (all statuses) — reuses lib/tasks-store.ts:listTasks() with no filter, the same store lib/coo's own open-only read already uses. No `notes` (private free text). */
export interface RawTaskEyes {
  id: string; title: string; status: string; dueDate: string | null; relatedType: string; relatedId: string | null;
  createdAt: string | null; updatedAt: string | null;
}

export interface PartnerEyesRaw {
  sources: SourceStatus[];
  clients: RawClient[] | null;
  labelArtists: RawLabelArtist[] | null;
  clips: RawClip[] | null;
  /** Full session history (lib/sessions-store.ts:listAllSessions()) — separate from COO's forward window. */
  sessions: RawSessionEyes[] | null;
  /** Full show history (lib/shows-store.ts:listShows(), called a second time) — separate from COO's operational subset. */
  shows: RawShowEyes[] | null;
  /** All artist_balance_entries rows (id/artist_id/entry_type/amount/entry_date only). null = labelArtists unavailable or the read failed. */
  artistBalanceEntries: RawBalanceEntry[] | null;
  /** Phase C.3 — full proposal history (client_id, linked_project_id, timestamps). Separate from lib/coo's own status-filtered proposals read. */
  proposalsFull: RawProposalEyes[] | null;
  /** Phase C.3 — full release history (every stage, every project, regardless of visibility/business type). Separate from lib/coo's own active-stage-only releases read. */
  releasesFull: RawReleaseEyes[] | null;
  /** Phase C.3 — full transaction row detail (id/project_id/type/amount/currency/status/date). Separate from lib/coo's own aggregated FinanceFact. */
  transactions: RawTransactionEyes[] | null;
  /** Phase C.3 — full task history (every status). Separate from lib/coo's own open-only TasksFact. */
  tasksFull: RawTaskEyes[] | null;
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
    /** Phase C.3 — Partner-only, full proposal history (client_id, linked_project_id, timestamps). `proposals` above (lib/coo, status-filtered) is unchanged. */
    proposalsFull: PartnerDomainState<ProposalsFullFact>;
    /** Phase C.3 — Partner-only, full release history (every stage, every project). `releases` above (lib/coo, active-stage-only) is unchanged. */
    releasesFull: PartnerDomainState<ReleasesFullFact>;
    /** Phase C.3 — Partner-only, per-row transaction detail. `finance` above (lib/coo, aggregated) is unchanged. */
    transactions: PartnerDomainState<TransactionsFact>;
    /** Phase C.3 — Partner-only, full task history (every status). `tasks` above (lib/coo, open-only) is unchanged. */
    tasksFull: PartnerDomainState<TasksFullFact>;
  };
  /** The underlying COO read's own source statuses, kept verbatim for traceability. */
  cooSources: SourceStatus[];
  /**
   * Phase C.3 — Change-Awareness DATA READINESS metadata only. Answers, per
   * domain: is there a stable id, how much history is visible, can a future
   * snapshot-diff reliably detect create/update/status-transition? This is
   * NOT Change Awareness itself (no snapshot storage, no diffing, no events —
   * see lib/partner/eyes/changeReadiness.ts's module doc). Audited facts about
   * THIS snapshot's own shape, not a new read.
   */
  changeReadiness: ChangeReadinessEntry[];
}

// ── Phase C.3 — Change Readiness Matrix types ────────────────────────────────

/** How much of the real-world domain this snapshot's data actually spans. */
export type HistoryScope =
  | "FULL_HISTORY"      // every row ever, no status/date/visibility filter
  | "CURRENT_SUBSET"     // a known, named filter (open-only, active-stage-only, visible-only, forward-window…)
  | "DERIVED_AGGREGATE"  // not raw rows at all (e.g. receivables) — no per-row id to track
  | "NOT_APPLICABLE";    // domain doesn't exist as a real table (suppliers)

export interface ChangeReadinessEntry {
  domain: PartnerDomainKey;
  /** Which of possibly two domains (e.g. "tasks" vs "tasksFull") this entry describes — for domains with a full-history sibling, TWO entries exist: one for each. */
  scope: HistoryScope;
  scopeDescription: string;
  /** null when this domain has literally no per-row id concept (suppliers). */
  stableIdField: string | null;
  hasCreatedAt: boolean;
  hasUpdatedAt: boolean;
  /** The field that represents "when this business event happened", if any (e.g. sessions.date, transactions.date) — distinct from createdAt (when the ROW was inserted). */
  businessDateField: string | null;
  statusField: string | null;
  /** A future snapshot-diff could reliably say "this is a NEW row since last time" (needs: full/current history known AND a stable id). */
  supportsCreateDetection: boolean;
  /** Could reliably say "this EXISTING row's fields changed" (needs: stable id AND (createdAt+updatedAt, or updatedAt alone)). */
  supportsUpdateDetection: boolean;
  /** Could reliably say "this row's status field specifically changed" (needs: stable id AND a status field AND updatedAt). */
  supportsStatusTransitionDetection: boolean;
  warnings: string[];
}
