/**
 * Redbloods Partner — Structured Owner Feedback (Phase F.1). Pure types.
 *
 * North star (Owner instruction §1): RECORD → UNDERSTAND SCOPE →
 * DERIVE SAFE LEARNING SIGNALS → PROPOSE. Never RECORD → silently change
 * business logic. One piece of feedback never becomes an Owner Rule, a
 * Hypothesis never becomes a Fact, and a CaseType is never suppressed
 * globally because of one dismissal (§1).
 *
 * This module has NO persistence, NO Supabase, NO I/O — see lib/partner/
 * feedback/README-style module docs in each file. Storage is a separate,
 * later decision (Phase F.1's own DB Gate report).
 */
import type { CaseClassification, CaseCreatedFrom, CaseStatus } from "../cases/types";

// ── Target scope (§3) — every feedback record knows EXACTLY what it targets,
// and scope is never broadened automatically. Default is always CASE_INSTANCE. ──

export type FeedbackTargetScope =
  | "CASE_INSTANCE"      // this one Case, this one subject, this one evidentiary state
  | "CASE_TYPE"          // a CaseType in general (e.g. "TASK_DUE_DATE_PASSED as a family") — still NOT an Owner Rule by itself
  | "SUBJECT"            // a specific subject (e.g. one project), independent of which CaseType raised it
  | "RULE_APPLICATION"   // how an Owner Rule was applied within a specific CaseType
  | "HYPOTHESIS"         // one specific hypothesis text within one Case
  | "THRESHOLD_PROPOSAL"; // feedback ON an already-generated PartnerLearningProposal

export interface FeedbackTarget {
  scope: FeedbackTargetScope;
  /** CASE_INSTANCE, HYPOTHESIS — the exact Case.id this feedback is about. */
  caseId?: string;
  /** CASE_TYPE, RULE_APPLICATION — and always ALSO copied from the snapshot for CASE_INSTANCE/HYPOTHESIS so grouping never needs a snapshot lookup. */
  caseType?: string;
  /** SUBJECT. */
  subjectType?: string;
  /** SUBJECT. */
  subjectId?: string;
  /** RULE_APPLICATION — a Charter id (lib/partner/charter.ts), never validated as owner-approved here (that stays lib/partner's own job). */
  ownerRuleId?: string;
  /** HYPOTHESIS — matches one entry in the target Case's own `hypotheses[].id`. */
  hypothesisId?: string;
  /** THRESHOLD_PROPOSAL — a PartnerLearningProposal.id (see below). */
  proposalId?: string;
}

// ── Feedback dimensions (§20-22) — independent axes, not one mutually-
// exclusive enum. "CORRECT + NOT_IMPORTANT" must both be expressible at once. ──

export type AccuracyFeedback = "CORRECT" | "INCORRECT" | "UNSPECIFIED";
export type ImportanceFeedback = "IMPORTANT" | "NOT_IMPORTANT" | "UNSPECIFIED";
export type TimingReaction = "TOO_EARLY" | "RIGHT_TIME" | "TOO_LATE" | "UNSPECIFIED";
export type RemindDirection = "EARLIER" | "LATER";
export type ContextValue = "HAS_MISSING_CONTEXT" | "NONE" | "UNSPECIFIED";
export type InferenceValue = "DO_NOT_INFER" | "UNSPECIFIED";
export type OverrideValue = "OWNER_OVERRIDE" | "NONE";

/**
 * A forward-looking request ("next time, remind me earlier/later"), distinct
 * from `timing.reaction` (a retrospective judgment about THIS instance).
 * Optional explicit adjustment amount — never inferred, never defaulted to
 * an invented number of days.
 */
export interface RemindAdjustment {
  direction: RemindDirection;
  days?: number;
  date?: string;
}

export interface TimingFeedback {
  reaction: TimingReaction;
  remindAdjustment: RemindAdjustment | null;
}

export interface ContextFeedback {
  value: ContextValue;
  /** Small, closed, structured taxonomy code (e.g. "FRIEND_CLIENT", "INTERNAL_LABEL_WORK") — kept intentionally tiny for v1, never invented per-feedback free text turned into a rule. */
  contextCode: string | null;
}

export interface InferenceFeedback {
  value: InferenceValue;
  /** REQUIRED when value === "DO_NOT_INFER" — which specific hypothesis is rejected. Facts are never touched (§30). */
  hypothesisId: string | null;
}

export interface OverrideFeedback {
  value: OverrideValue;
  /** Small, closed, structured taxonomy code (e.g. "INTENTIONAL_PAUSE", "KNOWN_EXCEPTION"). Never rewrites the underlying fact (§29). */
  reasonCode: string | null;
}

export interface PartnerFeedbackDimensions {
  accuracy: AccuracyFeedback;
  importance: ImportanceFeedback;
  timing: TimingFeedback;
  context: ContextFeedback;
  inference: InferenceFeedback;
  override: OverrideFeedback;
}

export function emptyFeedbackDimensions(): PartnerFeedbackDimensions {
  return {
    accuracy: "UNSPECIFIED",
    importance: "UNSPECIFIED",
    timing: { reaction: "UNSPECIFIED", remindAdjustment: null },
    context: { value: "UNSPECIFIED", contextCode: null },
    inference: { value: "UNSPECIFIED", hypothesisId: null },
    override: { value: "NONE", reasonCode: null },
  };
}

// ── Case snapshot (§18-19) — minimal, immutable, enough to know WHAT the
// Owner reacted to without duplicating the full Case payload. ──

export interface PartnerCaseFeedbackSnapshot {
  caseId: string;
  caseType: string;
  subjectType: string;
  subjectId: string;
  classification: CaseClassification;
  status: CaseStatus;
  createdFrom: CaseCreatedFrom;
  /** Mirrors PartnerCase.schemaVersion (CASE_SCHEMA_VERSION) at snapshot time. */
  caseSchemaVersion: string;
  /** Deterministic fingerprint of facts+derivedFacts+classification — see snapshot.ts. Lets a later reader detect "the Case's evidentiary state has since changed" without storing the full facts array. */
  evidenceFingerprint: string;
  /** When this snapshot was captured — normally the feedback's own createdAt. */
  capturedAt: string;
}

// ── The feedback record itself (§5) ──

/**
 * Stamps the SHAPE of the PartnerFeedback record itself (dimensions/
 * caseSnapshot/provenance shape) — a DIFFERENT thing from
 * PartnerCaseFeedbackSnapshot.caseSchemaVersion, which stamps the Case's own
 * shape at capture time. A feedback record's evolving JSONB structure
 * (dimensions/case_snapshot/provenance) needs its own version so a future
 * reader never conflates "the Case shape changed" with "the feedback record
 * shape changed" (Schema Hardening, 2026-09-22).
 */
export const FEEDBACK_SCHEMA_VERSION = "partner-feedback-schema-v1";

export interface PartnerFeedback {
  id: string;
  /** Always FEEDBACK_SCHEMA_VERSION at construction time — never hand-set to anything else. Distinct from caseSnapshot.caseSchemaVersion. */
  schemaVersion: string;
  createdAt: string;
  target: FeedbackTarget;
  dimensions: PartnerFeedbackDimensions;
  /** Optional human context. Never silently parsed into a rule (§6) — display-only. */
  note: string | null;
  /** REQUIRED for CASE_INSTANCE and HYPOTHESIS scope (there is a concrete Case to snapshot); null otherwise. */
  caseSnapshot: PartnerCaseFeedbackSnapshot | null;
  /** Append-only revision lineage (§23): a NEW record referencing the PRIOR one it supersedes. The prior record is never deleted/mutated. At most one direct successor per row — enforced at the DB layer by a UNIQUE index on supersedes_id, and re-checked in application code by revisions.ts:findRevisionBranches. */
  supersedesId: string | null;
  provenance: { source: "owner_manual" };
}

// ── Per-record effect classification (§13) — computed, never stored as an
// opinion; a PURE function of one record's own scope + dimensions. ──

export type FeedbackEffectLevel =
  | "RECORDED_ONLY"        // stored, traceable, no further computed meaning yet
  | "INSTANCE_CONTEXT"     // carries information specific to one instance/subject (context/override)
  | "LEARNING_SIGNAL"      // this record is part of an aggregate pattern (set by the learning layer, never by the record alone)
  | "PROPOSED_RULE_CHANGE" // referenced by a generated PartnerLearningProposal
  | "OWNER_CONFIRMED_RULE"; // NEVER reachable in Phase F.1 — no confirmation mechanism exists yet

// ── Learning signals + proposals (§9, §25-27, §41-43) — pure, deterministic,
// NEVER auto-applied. A signal is an unconditional structured observation; a
// proposal exists only once the SAME (caseType, dimension, value) recurs
// (>=2 records) — "repeated" literally means "more than once", a definitional
// minimum for calling something a pattern, never a policy/action threshold
// (Owner instruction §26: "Owner decides policy"). ──

export type LearningSignalKind = "ACCURACY_PATTERN" | "IMPORTANCE_PATTERN" | "TIMING_PATTERN" | "CONTEXT_PATTERN" | "OVERRIDE_PATTERN" | "INFERENCE_PATTERN";

export interface PartnerLearningSignal {
  /** Deterministic: `${caseType}:${kind}:${dimensionValue}`. */
  id: string;
  caseType: string;
  kind: LearningSignalKind;
  dimensionValue: string;
  sampleSize: number;
  /** Total feedback recorded for this caseType across all dimensions — context for reading the rate, never a verdict. */
  totalReviewedForCaseType: number;
  sourceFeedbackIds: string[];
}

export interface PartnerLearningProposal {
  /** Deterministic: same as the source signal's id. */
  id: string;
  proposalType: LearningSignalKind;
  sourceFeedbackIds: string[];
  affectedCaseType: string;
  affectedScope: FeedbackTargetScope;
  /** Factual, Hebrew, counts-only — e.g. "7 מתוך 10 מקרים מסוג TASK_DUE_DATE_PASSED סומנו כלא חשובים." Never a conclusion ("בטל את הזיהוי הזה"). */
  evidenceSummary: string;
  /** Always PROPOSED in Phase F.1 — no confirmation/application path exists yet. */
  status: "PROPOSED";
}
