/**
 * Redbloods Partner — chain-aware Case decision state (Phase F.1F). Pure,
 * deterministic, no I/O, no AI.
 *
 * interpretCase() explains ONE question. This module reads the WHOLE
 * applicable Owner Context chain of one Case (root answer → follow-up
 * answer → …) and produces one coherent current understanding:
 *
 *   - FACTS are copied from the Case unchanged. A structured answer never
 *     rewrites a fact: an Owner-selected deadline is a SELECTED value
 *     (OWNER_DECISION), while the persisted project deadline stays the fact
 *     until the project record itself changes.
 *   - An unknown raised by one answer (e.g. "what is the new deadline?")
 *     is RESOLVED when a later applicable answer supplies it. It stays
 *     attributable to the context that raised it; it just stops being a
 *     current unknown.
 *   - Every derived statement / selected value / resolved unknown carries
 *     its source Case, question(s) and context(s). `note` is never read.
 *
 * Only CURRENT_APPLICABLE contexts count (context-applicability.ts); a
 * historical answer whose trigger no longer supports it never contributes.
 */
import type { CaseEvidence, PartnerCase } from "../cases/types";
import { fingerprintCaseFacts } from "../feedback/snapshot";
import { classifyOwnerContexts, type ContextApplicabilityStatus } from "./context-applicability";
import type { PersistedOwnerContext } from "./context-row";
import { answerOptionsFor, buildFollowUpQuestions, decideInvestigation } from "./questions";
import type { InvestigationQuestionType, OwnerContextAnswerValue } from "./types";

export const DECISION_STATE_SCHEMA_VERSION = "partner-decision-state-v1";

/** Stable codes for the unknowns an answer leaves open — so a later answer can resolve them by code, never by text. */
export type DecisionUnknownCode = "NEW_PROJECT_DEADLINE" | "NEW_INTERNAL_DEADLINE" | "NEW_TASK_DUE_DATE" | "NEW_RELEASE_TARGET" | "PRICE_AGREEMENT_DATE" | "WAITING_ON_WHOM" | "UNCLASSIFIED_REASON";

/** `${questionType}:${answerCode}` → the unknown that answer leaves open (mirrors each option's remainingUnknownHe). */
const RAISES_UNKNOWN: Record<string, DecisionUnknownCode> = {
  "WHY_DEADLINE_STILL_ACTIVE:DEADLINE_NOT_UPDATED": "NEW_PROJECT_DEADLINE",
  "WHY_DEADLINE_STILL_ACTIVE:INTENTIONALLY_DELAYED": "NEW_PROJECT_DEADLINE",
  "WHAT_IS_NEW_PROJECT_DEADLINE:NOT_KNOWN_YET": "NEW_PROJECT_DEADLINE",
  "WHY_INTERNAL_DEADLINE_PASSED:DEADLINE_NOT_UPDATED": "NEW_INTERNAL_DEADLINE",
  "WHY_INTERNAL_DEADLINE_PASSED:INTENTIONALLY_EXTENDED": "NEW_INTERNAL_DEADLINE",
  "IS_TASK_STILL_RELEVANT:STILL_RELEVANT": "NEW_TASK_DUE_DATE",
  "IS_TASK_STILL_RELEVANT:DUE_DATE_NOT_UPDATED": "NEW_TASK_DUE_DATE",
  "IS_TASK_STILL_RELEVANT:WAITING_ON_SOMEONE_ELSE": "WAITING_ON_WHOM",
  "WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM:WAITING_ON_SOMETHING_ELSE": "WAITING_ON_WHOM",
  "IS_MISSING_FINANCE_CONFIG_INTENTIONAL:PRICE_NOT_AGREED_YET": "PRICE_AGREEMENT_DATE",
  "WHY_RELEASE_TARGET_PASSED:POSTPONED_INTENTIONALLY": "NEW_RELEASE_TARGET",
};

/** Questions whose DATE answer resolves an unknown and becomes a SELECTED business value. */
const VALUE_SEMANTICS: Partial<Record<InvestigationQuestionType, { resolves: DecisionUnknownCode; selectedValue: SelectedValueCode; factField: string; labelHe: string }>> = {
  WHAT_IS_NEW_PROJECT_DEADLINE: { resolves: "NEW_PROJECT_DEADLINE", selectedValue: "INTENDED_PROJECT_DEADLINE", factField: "deadline", labelHe: "דדליין חדש שנבחר לפרויקט" },
};

export type SelectedValueCode = "INTENDED_PROJECT_DEADLINE";

export interface DecisionSource { caseId: string; questionIds: string[]; contextIds: string[] }

export interface DecisionOwnerContext {
  contextId: string;
  questionId: string;
  questionType: InvestigationQuestionType;
  answerCode: string;
  answerValue: OwnerContextAnswerValue | null;
  triggerContextId: string | null;
  /** For a follow-up: the CURRENT row of its trigger's chain (equal to triggerContextId unless the trigger was revised with continuity). */
  effectiveTriggerContextId: string | null;
  applicability: ContextApplicabilityStatus;
  answeredAt: string;
  caseFactsFingerprint: string;
}

export interface DecisionStatement { id: string; statementHe: string; source: DecisionSource }
export interface DecisionHypothesis { id: string; statementHe: string; epistemicStatus: "HYPOTHESIS"; source: DecisionSource }

export interface ResolvedUnknown {
  code: DecisionUnknownCode;
  statementHe: string;
  raisedBy: { contextId: string; questionId: string };
  resolvedBy: { contextId: string; questionId: string };
}

export interface RemainingUnknown {
  code: DecisionUnknownCode | "QUESTION_OPEN" | "CASE_UNKNOWN";
  statementHe: string;
  raisedBy: { contextId: string; questionId: string } | { questionId: string } | { caseId: string };
}

/**
 * An Owner decision expressed as a structured value — NOT a fact. The
 * persisted fact it would replace is carried next to it so no reader can
 * confuse the two.
 */
export interface SelectedBusinessValue {
  code: SelectedValueCode;
  epistemicStatus: "OWNER_DECISION";
  labelHe: string;
  value: OwnerContextAnswerValue;
  persistedFact: { field: string; value: CaseEvidence["value"] };
  source: DecisionSource;
}

export type DecisionReadiness =
  | "NO_INVESTIGATION"          // the Case needs no question (fact-complete / not active)
  | "INVESTIGATION_OPEN"        // the Case's question is unanswered
  | "AWAITING_FOLLOW_UP"        // answered, but a triggered follow-up is still unanswered
  | "ANSWERED_UNKNOWNS_REMAIN"  // every question answered, but an unknown is still open (e.g. NOT_KNOWN_YET)
  | "DECISION_COMPLETE";        // the chain is answered and no unknown remains

export interface PartnerCaseDecisionState {
  schemaVersion: string;
  caseId: string;
  caseType: string;
  subjectType: string;
  subjectId: string;
  /** Current Case facts fingerprint — compare with each context's to detect a decision made on different facts. */
  caseFactsFingerprint: string;
  /** Copied from the Case — never rewritten by any answer. */
  facts: CaseEvidence[];
  /** CURRENT_APPLICABLE contexts of this Case only, oldest first. */
  ownerContexts: DecisionOwnerContext[];
  /**
   * Historical contexts that are still the exact CAUSAL source of an applicable context (e.g. an original
   * trigger that was later revised with semantic continuity). Traceability only — never a current answer.
   */
  referencedContexts: DecisionOwnerContext[];
  derived: DecisionStatement[];
  hypotheses: DecisionHypothesis[];
  unknownsResolved: ResolvedUnknown[];
  unknownsRemaining: RemainingUnknown[];
  selectedBusinessValues: SelectedBusinessValue[];
  /** Follow-up questions that exist but have no applicable answer yet. */
  openQuestionIds: string[];
  readiness: DecisionReadiness;
}

/** The chain of context ids from `c` back through its triggers (root first), limited to `byId`. */
function triggerChain(c: PersistedOwnerContext, byId: Map<string, PersistedOwnerContext>): PersistedOwnerContext[] {
  const chain: PersistedOwnerContext[] = [c];
  const seen = new Set([c.id]);
  let t = c.triggerContextId ? byId.get(c.triggerContextId) : undefined;
  while (t && !seen.has(t.id)) { chain.unshift(t); seen.add(t.id); t = t.triggerContextId ? byId.get(t.triggerContextId) : undefined; }
  return chain;
}

/**
 * Builds the current decision state of ONE Case from its Owner Context
 * history (all rows for this Case — applicability is computed here, so a
 * non-applicable historical answer can never leak in).
 */
export function deriveCaseDecisionState(c: PartnerCase, caseContextHistory: readonly PersistedOwnerContext[]): PartnerCaseDecisionState {
  const history = caseContextHistory.filter((x) => x.caseId === c.id);
  const cls = classifyOwnerContexts(history);
  const applicable = history
    .filter((x) => cls.get(x.id)?.status === "CURRENT_APPLICABLE")
    .sort((a, b) => Date.parse(a.answeredAt) - Date.parse(b.answeredAt) || (a.id < b.id ? -1 : 1));
  const byId = new Map(history.map((x) => [x.id, x]));

  const derived: DecisionStatement[] = [];
  const hypotheses: DecisionHypothesis[] = [];
  const raised: Array<{ code: DecisionUnknownCode; statementHe: string; ctx: PersistedOwnerContext }> = [];
  const selectedBusinessValues: SelectedBusinessValue[] = [];
  const resolvers: Array<{ code: DecisionUnknownCode; ctx: PersistedOwnerContext }> = [];

  for (const ctx of applicable) {
    const option = answerOptionsFor(ctx.questionType).find((o) => o.code === ctx.answerCode);
    if (!option) continue; // unreadable answers never reach here (store validates); defensive only
    const chain = triggerChain(ctx, byId);
    const source: DecisionSource = { caseId: c.id, questionIds: chain.map((x) => x.questionId), contextIds: chain.map((x) => x.id) };
    if (option.derivedHe) derived.push({ id: `${ctx.questionType}:${ctx.answerCode}`, statementHe: option.derivedHe, source });
    if (option.hypothesisHe) hypotheses.push({ id: `${ctx.questionType}:${ctx.answerCode}:hypothesis`, statementHe: option.hypothesisHe, epistemicStatus: "HYPOTHESIS", source });
    const raisedCode = RAISES_UNKNOWN[`${ctx.questionType}:${ctx.answerCode}`] ?? (option.remainingUnknownHe ? "UNCLASSIFIED_REASON" : null);
    if (raisedCode && option.remainingUnknownHe) raised.push({ code: raisedCode, statementHe: option.remainingUnknownHe, ctx });
    const sem = VALUE_SEMANTICS[ctx.questionType];
    if (sem && ctx.answerValue?.kind === "DATE") {
      resolvers.push({ code: sem.resolves, ctx });
      const fact = c.facts.find((f) => f.field === sem.factField);
      selectedBusinessValues.push({
        code: sem.selectedValue, epistemicStatus: "OWNER_DECISION", labelHe: sem.labelHe, value: ctx.answerValue,
        persistedFact: { field: sem.factField, value: fact ? fact.value : null }, source,
      });
    }
  }

  // Resolve raised unknowns by code: a resolver answered LATER than (or as a follow-up of) the raiser clears it.
  const unknownsResolved: ResolvedUnknown[] = [];
  const unknownsRemaining: RemainingUnknown[] = [];
  for (const r of raised) {
    const resolver = resolvers.find((x) => x.code === r.code && x.ctx.id !== r.ctx.id && (triggerChain(x.ctx, byId).some((t) => t.id === r.ctx.id) || Date.parse(x.ctx.answeredAt) >= Date.parse(r.ctx.answeredAt)));
    if (resolver) unknownsResolved.push({ code: r.code, statementHe: r.statementHe, raisedBy: { contextId: r.ctx.id, questionId: r.ctx.questionId }, resolvedBy: { contextId: resolver.ctx.id, questionId: resolver.ctx.questionId } });
    else unknownsRemaining.push({ code: r.code, statementHe: r.statementHe, raisedBy: { contextId: r.ctx.id, questionId: r.ctx.questionId } });
  }

  // Open questions: the Case's own question, then any follow-up without an applicable answer.
  const rootQuestion = decideInvestigation(c).question;
  const answeredQuestionIds = new Set(applicable.map((x) => x.questionId));
  const existingTriggers = Object.fromEntries(applicable.filter((x) => x.triggerContextId).map((x) => [x.questionId, x.triggerContextId!]));
  const followUps = buildFollowUpQuestions(c, applicable, existingTriggers);
  const openFollowUps = followUps.filter((q) => !answeredQuestionIds.has(q.id));
  if (rootQuestion && !answeredQuestionIds.has(rootQuestion.id)) unknownsRemaining.push({ code: "QUESTION_OPEN", statementHe: rootQuestion.reasonHe, raisedBy: { questionId: rootQuestion.id } });
  for (const q of openFollowUps) {
    // The follow-up itself asks for the raised unknown — represented once (already in unknownsRemaining via its raiser).
    if (!unknownsRemaining.some((u) => "contextId" in u.raisedBy && q.origin.kind === "OWNER_CONTEXT" && u.raisedBy.contextId === q.origin.triggerContextId)) {
      unknownsRemaining.push({ code: "QUESTION_OPEN", statementHe: q.reasonHe, raisedBy: { questionId: q.id } });
    }
  }
  for (const u of c.unknowns) unknownsRemaining.push({ code: "CASE_UNKNOWN", statementHe: u, raisedBy: { caseId: c.id } });

  let readiness: DecisionReadiness;
  if (!rootQuestion) readiness = "NO_INVESTIGATION";
  else if (!answeredQuestionIds.has(rootQuestion.id)) readiness = "INVESTIGATION_OPEN";
  else if (openFollowUps.length) readiness = "AWAITING_FOLLOW_UP";
  else if (unknownsRemaining.some((u) => u.code !== "CASE_UNKNOWN")) readiness = "ANSWERED_UNKNOWNS_REMAIN";
  else readiness = "DECISION_COMPLETE";

  const summarize = (x: PersistedOwnerContext): DecisionOwnerContext => ({
    contextId: x.id, questionId: x.questionId, questionType: x.questionType, answerCode: x.answerCode, answerValue: x.answerValue,
    triggerContextId: x.triggerContextId, effectiveTriggerContextId: cls.get(x.id)?.effectiveTriggerId ?? null,
    applicability: cls.get(x.id)?.status ?? "SUPERSEDED", answeredAt: x.answeredAt, caseFactsFingerprint: x.caseFactsFingerprint,
  });
  const applicableIds = new Set(applicable.map((x) => x.id));
  const referencedIds = new Set<string>();
  for (const x of applicable) for (const t of triggerChain(x, byId)) if (!applicableIds.has(t.id)) referencedIds.add(t.id);

  return {
    schemaVersion: DECISION_STATE_SCHEMA_VERSION,
    caseId: c.id, caseType: c.caseType, subjectType: c.subjectType, subjectId: c.subjectId,
    caseFactsFingerprint: fingerprintCaseFacts(c),
    facts: c.facts.map((f) => ({ ...f })),
    ownerContexts: applicable.map(summarize),
    referencedContexts: history.filter((x) => referencedIds.has(x.id)).sort((a, b) => a.id.localeCompare(b.id)).map(summarize),
    derived, hypotheses, unknownsResolved, unknownsRemaining, selectedBusinessValues,
    openQuestionIds: [...(rootQuestion && !answeredQuestionIds.has(rootQuestion.id) ? [rootQuestion.id] : []), ...openFollowUps.map((q) => q.id)],
    readiness,
  };
}
