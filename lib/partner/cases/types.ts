/**
 * Redbloods Partner — Case Engine (Phase E.1, SHADOW MODE ONLY). Pure types.
 *
 * A Change answers "what changed?". A Case answers "why does something
 * currently visible deserve attention, and exactly what is that based on?"
 * A Case is NOT an Agent Alert (agent_alerts stays fully excluded from
 * Partner — Phase B.2 Owner decision, unchanged) and NOT a Recommendation
 * ("do X") — E.1 only states what is happening and why it matters, never
 * what to do about it.
 *
 * SHADOW MODE: nothing in this module is wired into any UI, notification,
 * push, or the Agent Alerts system. Cases are computed by a read-only QA
 * script only (scripts/partner-case-report.ts) for manual Owner review.
 *
 * Epistemic discipline (same as lib/partner/eyes and lib/partner/dossiers,
 * extended): every Case separates FACT (a direct field read) from DERIVED
 * (a deterministic calculation over facts, e.g. "deadline passed by N days")
 * from HYPOTHESIS (an unconfirmed reading — NEVER promoted to fact) from
 * OWNER_RULE (a Charter item with owner approval) from WORKING_PRINCIPLE (a
 * Charter item WITHOUT owner approval — must never be presented as if the
 * owner said it) from UNKNOWN (explicitly named missing information).
 *
 * No scoring (no 0-100 risk score, no AI confidence, no health score) and no
 * COO priority tiers (P0-P3) — Owner instruction §12-13. Classification is
 * one of 4 deliberately small buckets (§6).
 */
import type { RelationQuality } from "../eyes/types";

export type CaseClassification = "ATTENTION" | "RISK" | "OPPORTUNITY" | "INFORMATION";

/**
 * E.1 recomputes Cases from state every run — there is no Case persistence,
 * no lifecycle DB (Owner instruction §7, §39-40). A Case simply stops
 * appearing once its condition no longer holds; that is NOT the same claim
 * as "resolved" (no history is kept to prove resolution happened).
 */
export type CaseStatus = "OPEN" | "RESOLVED_BY_STATE" | "NEEDS_CONTEXT" | "UNKNOWN";

/** Whether a Case exists because of the CURRENT state, a detected CHANGE, or both (Owner instruction §26-27). */
export type CaseCreatedFrom = "STATE" | "CHANGE" | "STATE_AND_CHANGE";

/** Only one value exists today — Owner instruction §31: GENTLE_CHALLENGE_BY_DEFAULT is the Charter default, E.1 builds no intervention logic. */
export type InterventionStyle = "GENTLE";

/** References a stable entity/field — never long free text (Owner instruction §28). */
export interface CaseEvidence {
  domain: string;
  entityId: string;
  field?: string | null;
  value: string | number | boolean | null;
  /** Short machine label, e.g. "internalDeadline" — not a sentence. */
  label: string;
}

/** A deterministic calculation over facts (e.g. "4 days late"), never a guess. */
export interface CaseDerivedFact {
  id: string;
  label: string;
  value: string | number | boolean | null;
  /** What it was computed from, in one short factual phrase. */
  basis: string;
}

/** An unconfirmed reading. MUST NEVER be promoted to a fact — see epistemic discipline above. */
export interface CaseHypothesis {
  id: string;
  statement: string;
  /** ids of the facts/derivedFacts that motivate this hypothesis, if any. */
  evidenceIds?: string[];
}

export interface CaseDataQuality {
  /** Set only when the Case's validity leans on a weak (TEXT_MATCH) relation — none of the E.1 catalog does today, kept for future detectors. */
  relationQuality?: RelationQuality;
  notes: string[];
}

/**
 * Phase F.1 (Owner instruction §19) — stamps the SHAPE of the PartnerCase
 * interface itself (facts/derivedFacts/classification semantics), never the
 * business condition. Bump only when this interface's fields materially
 * change, so stored feedback (lib/partner/feedback) can tell whether its
 * saved snapshot still describes the current Case shape. Mirrors the same
 * `schemaVersion` pattern already used by PartnerChangeSnapshot
 * (lib/partner/changes/types.ts:CHANGE_SNAPSHOT_SCHEMA_VERSION).
 */
export const CASE_SCHEMA_VERSION = "partner-case-schema-v1";

export interface PartnerCase {
  /** Deterministic: `${caseType}:${subjectId}` (or a documented variant) — the SAME business condition always produces the SAME id, never a random UUID (Owner instruction §8). */
  id: string;
  /** Always CASE_SCHEMA_VERSION at construction time — never hand-set to anything else. */
  schemaVersion: string;
  caseType: string;
  subjectType: string;
  subjectId: string;
  classification: CaseClassification;
  status: CaseStatus;
  createdFrom: CaseCreatedFrom;
  facts: CaseEvidence[];
  derivedFacts: CaseDerivedFact[];
  hypotheses: CaseHypothesis[];
  /** Charter ids with status OWNER_RULE or OWNER_GOAL only — see lib/partner's own isOwnerApproved(). */
  ownerRulesApplied: string[];
  /** Charter ids with status WORKING_PRINCIPLE — kept structurally separate, NEVER merged into ownerRulesApplied (Owner instruction §11). */
  workingPrinciplesApplied: string[];
  /** Explicitly named missing information (Owner instruction §50) — e.g. "whether the owner reviewed this outside Redbloods is unknown". */
  unknowns: string[];
  dataQuality: CaseDataQuality;
  interventionStyle: InterventionStyle;
  /** Minimal, factual, deterministic Hebrew — not a recommendation, not evocative (Owner instruction §30). */
  summaryHe: string;
  /** Only set for CHANGE / STATE_AND_CHANGE cases — the two snapshots' capturedAt this Case's change evidence came from. Never persisted (Owner instruction §57). */
  changeContext: { previousCapturedAt: string | null; currentCapturedAt: string } | null;
}

export interface CaseExplanation {
  caseId: string;
  caseType: string;
  whatFactsTriggeredThis: CaseEvidence[];
  derivedCalculations: CaseDerivedFact[];
  ownerRulesApplied: string[];
  workingPrinciplesApplied: string[];
  hypotheses: CaseHypothesis[];
  missingData: string[];
  summary: string;
}
