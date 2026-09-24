/**
 * Redbloods Partner — Organizational Memory V1: types. Pure.
 *
 * Deterministic organizational knowledge, derived from EXISTING canonical sources (no memory table):
 * what happened, to which entity, what the Owner decided, what Partner did, what happened afterwards,
 * and whether the same problem is happening again. Never money: memory never changes realized totals,
 * never writes, never executes.
 *
 * Epistemic discipline: a FACT is live canonical state; an OWNER_DECISION is Owner Context; an
 * OBSERVATION is evidence-backed but not a rule; a PATTERN_CANDIDATE stays HYPOTHESIS-level until the
 * Owner confirms it (V1 never auto-confirms).
 */
export const MEMORY_SCHEMA_VERSION = "partner-memory-v1";

export type MemoryEpistemic = "FACT" | "OWNER_DECISION" | "OBSERVATION" | "DERIVED" | "HYPOTHESIS" | "PATTERN_CANDIDATE" | "UNKNOWN";

/** Where a memory item comes from (structured sources only — never UI text). */
export type MemorySourceKind =
  | "FINANCE_TRANSACTIONS" | "VICTOR_SALARY_STATUS" | "VICTOR_SALARY_CONFIG" | "VICTOR_LEGACY_PAYMENT_STORE"
  | "OWNER_CONTEXT" | "ACTION_EVENTS" | "ACTION_OUTCOME" | "FINANCE_VIEW" | "PROJECTS";

export interface MemorySourceRef { kind: MemorySourceKind; ref: string }

/**
 * Stable entity identity. Period-specific instances are distinct entities
 * (recurring:VICTOR_SALARY:2026-08 ≠ recurring:VICTOR_SALARY:2026-09) that link UP to their family.
 */
export interface MemoryEntityRef {
  key: string;
  kind: "vendor" | "recurring" | "recurring_period" | "project" | "receivable" | "finance_setting" | "expense_pattern" | "transaction";
  period: string | null;
  /** Keys of the entities this one belongs to (e.g. recurring:VICTOR_SALARY, vendor:VICTOR). */
  parents: string[];
  labelHe: string | null;
}

export interface MemoryFact { entity: string; code: string; epistemic: "FACT" | "DERIVED"; value: unknown; sources: MemorySourceRef[] }

export interface MemoryOwnerDecision {
  entity: string;
  contextId: string;
  questionId: string;
  questionType: string;
  answerCode: string;
  answerValueYmd: string | null;
  answeredAt: string;
  /** ACTIVE = terminal + applicable; SUPERSEDED = revised later; NOT_APPLICABLE = trigger no longer supports it. */
  status: "ACTIVE" | "SUPERSEDED" | "NOT_APPLICABLE";
  supersedesId: string | null;
}

/** Evidence-backed occurrence of a problem signature for ONE entity instance. Not a rule. */
export interface MemoryObservation {
  entity: string;
  signature: ProblemSignature;
  epistemic: "OBSERVATION";
  /** Is the observed problem still true in live state, or has live state resolved it since? */
  current: boolean;
  /** true when the sources for this instance disagree (see conflicts) — never counted as clean evidence. */
  contested: boolean;
  sources: MemorySourceRef[];
}

/** Deterministic, structured problem identity — never wording similarity. */
export interface ProblemSignature { entityFamily: string; issueType: string }

export interface MemoryConflict {
  entity: string;
  code: string;
  epistemic: "UNKNOWN";
  /** Each disagreeing source with its value; ordered highest precedence first. */
  values: Array<{ source: MemorySourceKind; value: string | null; precedence: number }>;
  /** The value that wins by precedence (it is reported, not silently adopted). */
  winning: { source: MemorySourceKind; value: string | null };
}

export interface MemoryAction {
  entity: string;
  actionId: string;
  actionType: string;
  /** Ordered chain of events (oldest first). */
  events: Array<{ eventId: string; eventType: string; at: string }>;
  headEventType: string;
  /** Owner Context revisions the approved snapshot relied on. */
  ownerContextIds: string[];
}

export interface MemoryOutcome { entity: string; actionId: string; state: string; evaluatedAt: string; expectedValue: string | null; currentValue: string | null; summaryHe: string }

/** A historical problem that live state (or an executed Action) has since resolved. History is kept. */
export interface MemoryResolution {
  entity: string;
  code: "RESOLVED_SINCE_OBSERVATION" | "RESOLVED_BY_ACTION" | "CLOSED_BY_OWNER_DECISION";
  resolvedIssue: string;
  evidence: MemorySourceRef[];
}

export interface MemoryPatternCandidate {
  signature: ProblemSignature;
  epistemic: "PATTERN_CANDIDATE";
  /** V1: never CONFIRMED from repetition alone. */
  status: "CANDIDATE";
  /** Distinct clean (uncontested) instances — the evidence count that created the candidate. */
  instances: string[];
  /** Instances whose sources disagree — shown, never counted as evidence. */
  contestedInstances: string[];
  evidenceQuality: "CONSISTENT" | "MIXED";
  /** Owner-facing wording (only surfaced when useful). */
  noteHe: string;
}

export interface PartnerEntityMemory {
  entity: MemoryEntityRef;
  facts: MemoryFact[];
  ownerDecisions: MemoryOwnerDecision[];
  observations: MemoryObservation[];
  actions: MemoryAction[];
  outcomes: MemoryOutcome[];
  conflicts: MemoryConflict[];
  resolutions: MemoryResolution[];
}

export type MemorySourceStatus = "OK" | "UNAVAILABLE";

export interface PartnerMemory {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION;
  builtAt: string;
  /** Fail closed: an unavailable source is reported, never treated as "nothing happened". */
  sources: Record<"ownerContext" | "actionEvents" | "outcomes" | "finance", MemorySourceStatus>;
  entities: PartnerEntityMemory[];
  patternCandidates: MemoryPatternCandidate[];
  /** V1: only an explicit Owner confirmation could populate this — there is none, so it stays empty. */
  confirmedPatterns: MemoryPatternCandidate[];
}

/** Question pre-flight verdict (see preflight.ts). */
export type KnownAnswerStatus = "KNOWN_CURRENT" | "KNOWN_OWNER_DECISION" | "KNOWN_HISTORICAL_BUT_STALE" | "CONFLICTING_MEMORY" | "NOT_KNOWN";
