/**
 * Redbloods Partner — Company Integrity Register: the finding contract. Pure types.
 *
 * The register DETECTS ambiguity and disagreement in non-finance company knowledge. It never changes canonical
 * data, never persists findings (derived live on every read), and never recomputes money (Finance Brain owns it).
 *
 * Every finding tells the reader which of Partner's six stances applies:
 *   KNOWN          — "I know this."                             (FACT from canonical data)
 *   DERIVED        — "I derived this from these facts."
 *   OWNER_DECIDED  — "The Owner previously decided this."       (Owner definition or Owner Context answer)
 *   CONFLICT       — "These sources disagree."
 *   UNKNOWN        — "I don't know this yet."
 *   NEEDS_OWNER    — "I need one answer from the Owner."
 */
export const INTEGRITY_SCHEMA_VERSION = "partner-company-integrity-v1";

export type IntegrityFindingType =
  | "LABEL_MEMBERSHIP_SOURCE_DISAGREEMENT"
  | "LABEL_PROJECT_CLASSIFICATION_MISMATCH"
  | "PROJECT_CLIENT_MATCH_INTEGRITY"
  | "SESSION_STATUS_VOCABULARY_CONFLICT"
  | "FUTURE_SCHEDULE_COVERAGE_GAP"
  | "RELEASE_PLAN_COVERAGE_GAP"
  | "VICTOR_WORK_INTEGRITY"
  | "STEVEN_PAYMENT_SOURCE_CONFLICT"
  | "LABEL_ECONOMICS_SOURCE_DIVERGENCE"
  | "GENERAL_DATA_QUALITY";

export type IntegrityStance = "KNOWN" | "DERIVED" | "OWNER_DECIDED" | "CONFLICT" | "UNKNOWN" | "NEEDS_OWNER";
export type IntegrityEpistemic = "FACT" | "DERIVED" | "OWNER_DECISION" | "HYPOTHESIS" | "UNKNOWN";
export type IntegritySeverity = "HIGH" | "MEDIUM" | "LOW";

export interface IntegritySubject {
  type: "company" | "label-artist" | "project" | "client-name" | "vendor" | "domain";
  key: string;
  label: string | null;
}

/** One piece of evidence: a logical source + what it says. Values are canonical facts, never money totals. */
export interface IntegrityEvidence { source: string; fact: string; value: unknown }

export interface IntegrityFinding {
  id: string;
  type: IntegrityFindingType;
  subject: IntegritySubject;
  severity: IntegritySeverity;
  epistemic: IntegrityEpistemic;
  stance: IntegrityStance;
  evidence: IntegrityEvidence[];
  canonicalSources: string[];
  conflictingSources: string[];
  ownerInputRequired: boolean;
  /** Partner's current interpretation, in Hebrew (fixed Partner wording + record names). */
  interpretationHe: string;
  /** The integrity question this finding is waiting on (if any, and only while it is unanswered). */
  questionId: string | null;
  /** The Owner's decision applied to this finding (OWNER_DECISION — never a FACT; canonical rows are unchanged). */
  ownerDecision: IntegrityOwnerDecision | null;
  observedAt: string;
  freshness: "LIVE" | "UNKNOWN";
}

export interface IntegrityQuestion {
  questionId: string;
  caseId: string;
  questionType: "INTEGRITY_LABEL_PROJECT_CLASSIFICATION" | "INTEGRITY_CLIENT_IDENTITY";
  subject: { type: string; id: string; label: string | null };
  textHe: string;
  whyHe: string;
  /** Owner-readable evidence lines (names + statuses only — no ids, tables, hashes). */
  evidenceHe: string[];
  options: Array<{ code: string; labelHe: string }>;
  /** SHA-256 of the facts the question is asked about — an answer applies only while these facts are unchanged. */
  fingerprint: string;
  /** Higher = more business impact (ordering only; at most 2 questions are ever surfaced). */
  priority: number;
  /** The Owner's earlier answer when the facts have changed since — a new answer supersedes it. */
  previousAnswer: { contextId: string; answerCode: string; answerLabelHe: string; answeredAt: string } | null;
}

/** An Owner answer as Partner applies it. */
export interface IntegrityOwnerDecision {
  epistemic: "OWNER_DECISION";
  contextId: string;
  questionId: string;
  questionType: IntegrityQuestion["questionType"];
  answerCode: string;
  answerLabelHe: string;
  answeredAt: string;
  /**
   * EXACT_FACTS  — answered for exactly the live facts;
   * DEFINITION   — a fact-set-independent definition (MIXED: "this artist can have both") kept across new projects.
   */
  basis: "EXACT_FACTS" | "DEFINITION";
  /** The channel the Owner answered through (the Owner is always the author). */
  via: "DASHBOARD" | "CLAUDE";
}

/**
 * What Partner learned from the Owner (organizational memory, derived live from Owner Context):
 *   APPLIES              — the decision is in use for the live facts;
 *   FACTS_CHANGED        — the live facts changed since the answer: kept as history, the ambiguity is surfaced again;
 *   NO_LONGER_AMBIGUOUS  — live canonical data no longer shows the ambiguity: live facts win, the answer is history.
 */
export interface IntegrityLearnedDecision {
  entityKey: string;
  subjectLabel: string | null;
  decision: IntegrityOwnerDecision;
  /** The exact wording the Owner answered (historical evidence, as stored). */
  askedHe: string;
  status: "APPLIES" | "FACTS_CHANGED" | "NO_LONGER_AMBIGUOUS";
  interpretationHe: string;
}

export interface IntegritySourceStatus { source: string; status: "OK" | "UNAVAILABLE" }

export interface CompanyIntegrityRegister {
  schemaVersion: typeof INTEGRITY_SCHEMA_VERSION;
  observedAt: string;
  /** The Owner definitions the register applied (encoded contract, see definitions.ts). */
  definitionsApplied: string[];
  sources: IntegritySourceStatus[];
  findings: IntegrityFinding[];
  /** At most MAX_INTEGRITY_QUESTIONS, highest priority first. */
  questions: IntegrityQuestion[];
  /** Candidate questions not surfaced now (ceiling reached) — counted, never silently dropped. */
  deferredQuestions: number;
  /** Questions already answered by an ACTIVE Owner Context row for the SAME facts — never re-asked. */
  answeredQuestions: Array<{ questionId: string; answerCode: string; contextId: string }>;
  /** Every ACTIVE integrity answer and how Partner uses it now. */
  learned: IntegrityLearnedDecision[];
  summary: Record<IntegrityStance, number>;
}

export const MAX_INTEGRITY_QUESTIONS = 2;
