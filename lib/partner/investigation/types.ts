/**
 * Redbloods Partner — Investigation & Owner Context loop (Phase F.1C).
 * Pure types. No persistence, no Supabase, no I/O, no LLM.
 *
 * Owner Rule INVESTIGATE_BEFORE_CONCLUDING: when a Case's FACTS are true but
 * their business MEANING is unknown, the Partner asks a targeted question
 * before concluding anything:
 *
 *   CASE → TARGETED QUESTION → OWNER CONTEXT → INTERPRETATION → LEARNING SIGNAL / PROPOSAL
 *
 * Three concepts are deliberately separate:
 *   - PartnerFeedback (lib/partner/feedback) — "was this Case correct /
 *     useful / well-timed?" Never answers WHY.
 *   - PartnerOwnerContext (here) — "why is the underlying business situation
 *     like this?" It is EVIDENCE, never a rewrite of the Case's facts.
 *   - PartnerCaseInterpretation (here) — a deterministic reading of
 *     facts + owner context. Its hypotheses stay HYPOTHESIS.
 *
 * Nothing here changes a Case, detector, threshold, Charter item or Owner Rule.
 */
import type { CaseDerivedFact, CaseEvidence } from "../cases/types";

export const INVESTIGATION_SCHEMA_VERSION = "partner-investigation-schema-v1";
export const INVESTIGATION_OWNER_RULE = "INVESTIGATE_BEFORE_CONCLUDING";

/** Small v1 taxonomy — objective ambiguity patterns only. */
export type InvestigationQuestionType =
  | "WHY_DEADLINE_STILL_ACTIVE"
  | "IS_TASK_STILL_RELEVANT"
  | "WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM"
  | "IS_MISSING_FINANCE_CONFIG_INTENTIONAL"
  | "WHY_INTERNAL_DEADLINE_PASSED"
  | "WHY_RELEASE_TARGET_PASSED";

/**
 * One structured answer. `derivedHe` / `hypothesisHe` / `remainingUnknownHe`
 * are what an Owner choosing this answer lets the Partner deterministically
 * say afterwards — DERIVED is a direct restatement of what the Owner said,
 * HYPOTHESIS stays unconfirmed, and nothing is ever promoted to a Fact.
 */
export interface InvestigationAnswerOption {
  code: string;
  labelHe: string;
  derivedHe?: string;
  hypothesisHe?: string;
  remainingUnknownHe?: string;
}

export interface PartnerInvestigationQuestion {
  /** Deterministic: `${caseId}::${questionType}`. The same Case always yields the same question id. */
  id: string;
  schemaVersion: string;
  caseId: string;
  caseType: string;
  subjectType: string;
  subjectId: string;
  questionType: InvestigationQuestionType;
  /** feedback/snapshot.ts:fingerprintCaseFacts — direct facts only (no daily-churning derived values). Lets a later reader tell whether an answer still describes the same situation. */
  caseFactsFingerprint: string;
  /** Short, specific, fact-grounded, non-accusatory Hebrew. */
  questionTextHe: string;
  /** The specific business unknown this question targets — why the Partner asks. */
  reasonHe: string;
  /** Labels/ids of the Case facts and derived facts the question is grounded in. */
  factsReferenced: string[];
  /** Always ends with OTHER — the Owner is never forced into a wrong category. */
  answerOptions: InvestigationAnswerOption[];
  allowsFreeText: true;
  ownerRuleApplied: typeof INVESTIGATION_OWNER_RULE;
  /** A generated question is always OPEN; whether it is answered is derived from Owner Context (see questionStatus()). */
  status: "OPEN";
}

/** Why a Case produced no question — explicit, never silent. */
export type NoQuestionReason =
  | "FACT_COMPLETE"        // the condition + its meaning are already established by facts (e.g. a computed balance)
  | "CONDITION_NOT_ACTIVE" // e.g. the project is closed / the Case is RESOLVED_BY_STATE
  | "NOT_IN_V1_TAXONOMY";  // a Case type no v1 question covers yet (reported, not guessed)

export interface InvestigationDecision {
  caseId: string;
  caseType: string;
  question: PartnerInvestigationQuestion | null;
  noQuestionReason: NoQuestionReason | null;
  /** Human-readable reason for the decision (both branches). */
  explanationHe: string;
}

/**
 * The Owner's answer to one question — evidence about WHY, scoped to this
 * one Case instance. Never rewrites a fact, never becomes a rule by itself.
 */
export interface PartnerOwnerContext {
  /** Deterministic for the in-memory model: `${questionId}@${answeredAt}`. Persistence identity is a later, separate decision. */
  id: string;
  schemaVersion: string;
  questionId: string;
  questionType: InvestigationQuestionType;
  caseId: string;
  caseType: string;
  subjectType: string;
  subjectId: string;
  answerCode: string;
  /** The exact wording the Owner answered (traceability — wording may evolve between versions). */
  questionTextHe: string;
  /** Copied from the question at answer time. If the Case's current facts fingerprint differs, the answer may no longer describe the situation (F.1D attention queue). */
  caseFactsFingerprint: string;
  /** Stored/displayed only. No code parses it. */
  note: string | null;
  answeredAt: string;
  /** v1: context always describes THIS Case instance. It is never broadened automatically. */
  scope: "CASE_INSTANCE";
  provenance: { source: "owner_manual" };
}

export type InvestigationStatus = "OPEN" | "ANSWERED" | "NOT_REQUIRED";

export interface InterpretationStatement {
  id: string;
  statementHe: string;
  basis: string;
}

export interface InterpretationHypothesis {
  id: string;
  statementHe: string;
  /** Always HYPOTHESIS — an interpretation can never promote a hypothesis to a fact. */
  epistemicStatus: "HYPOTHESIS";
  basis: string;
}

export interface PartnerCaseInterpretation {
  caseId: string;
  caseType: string;
  questionId: string | null;
  /** Copied from the Case unchanged — Owner Context never rewrites a fact. */
  facts: CaseEvidence[];
  derivedFacts: CaseDerivedFact[];
  ownerContext: { answerCode: string; labelHe: string; note: string | null } | null;
  /** Deterministic restatements of what the Owner's structured answer establishes (OWNER_CONTEXT-derived, not system facts). */
  derivedFromContext: InterpretationStatement[];
  /** The Case's own hypotheses + any answer-specific hypothesis. All labelled HYPOTHESIS. */
  hypotheses: InterpretationHypothesis[];
  unknownsRemaining: string[];
  investigationStatus: InvestigationStatus;
  /** Always INSTANCE_ONLY — one answer never creates a global rule. */
  learningEffect: "INSTANCE_ONLY";
}

/** A counted pattern across Owner Contexts — counts only, no verdict. */
export interface PartnerContextLearningSignal {
  /** `${caseType}:${questionType}:${answerCode}` */
  id: string;
  caseType: string;
  questionType: InvestigationQuestionType;
  answerCode: string;
  /** Distinct Cases whose current context gave this answer. */
  distinctCases: number;
  totalAnsweredForQuestionType: number;
  sourceContextIds: string[];
}

export interface PartnerContextLearningProposal {
  id: string;
  sourceContextIds: string[];
  affectedCaseType: string;
  questionType: InvestigationQuestionType;
  answerCode: string;
  evidenceSummaryHe: string;
  /** What to review — never an action taken. */
  reviewSuggestionHe: string;
  status: "PROPOSED";
}
