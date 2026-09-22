/**
 * Redbloods Partner — Change Engine (Phase D.1). Pure types.
 *
 * SEE → REMEMBER → NOTICE. This is the "NOTICE" layer's data shape — it is
 * NOT Change Awareness's runtime (D.3, which loads/persists a baseline) and
 * it is NOT Cases/Recommendations/Priority (Phase E, not started). Everything
 * here is a pure function of two PartnerChangeSnapshot values: no I/O, no
 * Supabase, no persistence, no clock (besides the capturedAt already baked
 * into each snapshot).
 *
 * Epistemic discipline carried over from lib/partner/eyes and lib/partner/
 * dossiers: FACT vs DERIVED, never HYPOTHESIS. A change is FACT when it is a
 * direct before/after read of a stored field. It is DERIVED only when it is a
 * deterministic reinterpretation of stored facts (e.g. "payment status became
 * RECEIVED") — never a guess, never dependent on anything outside the two
 * snapshots being compared.
 */
import type { Coverage, DataStatus } from "../eyes/types";

export const CHANGE_SNAPSHOT_SCHEMA_VERSION = "partner-change-snapshot-v1";

export type EpistemicType = "FACT" | "DERIVED";

/**
 * A small, closed vocabulary (Owner instruction: "do not create 100 change
 * types"). Each field on each domain is classified into exactly ONE of these
 * kinds up front (see compare.ts's per-domain FieldSpec lists) — so the same
 * field is never reported as both e.g. STATUS_CHANGED and FIELD_CHANGED (the
 * most-specific-type-wins rule is enforced by construction, not by dedup).
 */
export type ChangeKind =
  | "ENTITY_APPEARED"
  | "ENTITY_DISAPPEARED"
  | "FIELD_CHANGED"
  | "STATUS_CHANGED"
  | "DATE_CHANGED"
  | "AMOUNT_CHANGED"
  | "RELATION_CHANGED"
  | "NESTED_ITEM_ADDED"
  | "NESTED_ITEM_REMOVED";

export type ChangeDomain =
  | "projects" | "clients" | "proposals" | "transactions" | "tasks" | "releases"
  | "sessions" | "shows" | "victor" | "steven" | "clips" | "labelArtists"
  | "balanceLedger" | "projectFinanceSettings";

export interface ObservedWindow { from: string | null; to: string }

/** A field/AMOUNT/DATE value as it appears in a change — deliberately narrow (no objects, no free text beyond stored field values). */
export type ChangeValue = string | number | boolean | null;

export interface PartnerChange {
  /** Deterministic, derived from domain+entityType+entityId+kind+field — stable across identical re-runs, never random. */
  id: string;
  domain: ChangeDomain;
  entityType: string;
  entityId: string;
  kind: ChangeKind;
  /** null only for ENTITY_APPEARED/ENTITY_DISAPPEARED (the whole entity, not one field). */
  field: string | null;
  before: ChangeValue;
  after: ChangeValue;
  /** When Partner OBSERVED the difference — the two snapshots' capturedAt values. Never a guess at the real-world moment. */
  observedBetween: ObservedWindow;
  /**
   * The real-world moment the change happened, ONLY when a specific, reliable
   * source timestamp proves it (e.g. a Victor files_sent[].uploadedAt or
   * version_reviews[].sentAt value for that exact nested item). null for
   * everything else — NEVER inferred from observedBetween, NEVER "now".
   */
  sourceOccurredAt: string | null;
  epistemicType: EpistemicType;
  /** Short, machine-generated, factual notes (e.g. "status: צפוי -> שולם"). Never free text pulled from notes/comments fields. */
  evidence: string[];
}

export type ChangeDiagnosticCode =
  | "SOURCE_FAILED_CURRENT"
  | "SOURCE_RECOVERED_NO_BASELINE"
  | "SCOPE_CHANGED"
  | "COVERAGE_CHANGED"
  | "INCOMPATIBLE_SCHEMA"
  | "FIRST_OBSERVATION"
  | "NO_BASELINE"
  | "MISSING_STABLE_ID"
  // Phase D.2/D.3 runtime-only codes (emitted by lib/partner/baseline's lifecycle, never by
  // this pure engine itself — kept in the same enum so ChangeAwarenessRunResult can return one
  // combined diagnostics list without a second parallel type).
  | "BASELINE_LOAD_FAILED"
  | "BASELINE_SAVE_FAILED"
  | "CURRENT_BUILD_INVALID";

export interface ChangeDiagnostic {
  code: ChangeDiagnosticCode;
  /** null for snapshot-level diagnostics (INCOMPATIBLE_SCHEMA, FIRST_OBSERVATION, NO_BASELINE). */
  domain: ChangeDomain | null;
  message: string;
}

export interface ChangeComparisonResult {
  changes: PartnerChange[];
  diagnostics: ChangeDiagnostic[];
  previousCapturedAt: string | null;
  currentCapturedAt: string;
  /** false when nothing was actually diffed (INCOMPATIBLE_SCHEMA or no baseline) — changes is always [] in that case, never a partial/best-effort list. */
  comparable: boolean;
}

// ── Canonical snapshot: one minimal, privacy-stripped entity record per domain, keyed by stable id ──

/** Per-domain envelope: mirrors the source PartnerDomainState's own status/coverage/scope so the comparer can apply source-failure/scope-change/coverage-change safety BEFORE looking at entities at all. */
export interface SnapshotDomainState<T> {
  status: DataStatus;
  coverage: Coverage;
  scopeDescription: string;
  /** Keyed by the domain's stable id. Empty object (not omitted) when status !== "AVAILABLE" or data is null — never fabricated rows. */
  entities: Record<string, T>;
}

export interface ProjectSnapshotEntity {
  id: string; name: string; status: string; businessType: string; artistText: string;
  deadlineYmd: string | null; active: boolean | null;
}
export interface ClientSnapshotEntity { id: string; name: string; type: string; status: string }
export interface ProposalSnapshotEntity {
  id: string; clientId: string | null; linkedProjectId: string | null; status: string;
  amount: number; currency: string; followupYmd: string | null;
}
export interface TransactionSnapshotEntity {
  id: string; projectId: string | null; type: string; amount: number; currency: string;
  status: string; dateYmd: string | null; expenseScope: string | null; category: string;
}
export interface TaskSnapshotEntity {
  id: string; status: string; dueYmd: string | null; relatedType: string; relatedId: string | null;
}
export interface ReleaseSnapshotEntity { projectId: string; labelArtistId: string | null; stage: string; targetYmd: string | null }
export interface SessionSnapshotEntity {
  id: string; projectId: string | null; showId: string | null; dateYmd: string; status: string; sessionType: string;
}
export interface ShowSnapshotEntity {
  id: string; status: string; paymentStatus: string; dateYmd: string | null;
  djClientId: string | null; djConfirmationStatus: string | null; artistClientId: string | null; bookerClientId: string | null;
}
export interface VictorSnapshotEntity {
  id: string; projectId: string | null; workState: string | null; internalDeadline: string | null;
  /** files_sent[].uploadedAt values — nested identity is the timestamp itself (Hardening-1's own evidence, never filename/URL). */
  uploads: string[];
  /** SENT (non-draft) version reviews only — nested identity is the version key. */
  reviewEvents: Array<{ versionKey: string; sentAt: string }>;
}
export interface StevenSnapshotEntity {
  id: string; projectId: string | null; status: string; hasMixVersion: boolean; lastUploadAt: string | null;
}
export interface ClipSnapshotEntity { id: string; status: string; projectId: string | null; artistName: string }
export interface LabelArtistSnapshotEntity { id: string; name: string; status: string }
export interface BalanceLedgerSnapshotEntity { id: string; artistId: string; entryType: string; amount: number; entryDate: string }
export interface ProjectFinanceSettingSnapshotEntity { projectId: string; agreedPrice: number; currency: string }

export interface PartnerChangeSnapshot {
  schemaVersion: string;
  capturedAt: string;
  projects: SnapshotDomainState<ProjectSnapshotEntity>;
  clients: SnapshotDomainState<ClientSnapshotEntity>;
  proposals: SnapshotDomainState<ProposalSnapshotEntity>;
  transactions: SnapshotDomainState<TransactionSnapshotEntity>;
  tasks: SnapshotDomainState<TaskSnapshotEntity>;
  releases: SnapshotDomainState<ReleaseSnapshotEntity>;
  sessions: SnapshotDomainState<SessionSnapshotEntity>;
  shows: SnapshotDomainState<ShowSnapshotEntity>;
  victor: SnapshotDomainState<VictorSnapshotEntity>;
  steven: SnapshotDomainState<StevenSnapshotEntity>;
  clips: SnapshotDomainState<ClipSnapshotEntity>;
  labelArtists: SnapshotDomainState<LabelArtistSnapshotEntity>;
  balanceLedger: SnapshotDomainState<BalanceLedgerSnapshotEntity>;
  /**
   * PARTIAL scope by construction: sourced from eyes:receivables (priced,
   * non-exception projects only) — the only finance-settings view already in
   * PartnerCompanyState with no new Eyes read. Exception/unpriced projects
   * are not tracked for agreed-price changes in this phase (documented gap,
   * not a new domain — see the Phase D.1 report).
   */
  projectFinanceSettings: SnapshotDomainState<ProjectFinanceSettingSnapshotEntity>;
}
