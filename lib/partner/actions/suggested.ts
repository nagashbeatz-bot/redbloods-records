/**
 * Redbloods Partner — Suggested Action derivation (Phase F.1F). Pure,
 * deterministic, no I/O, no mutation, no AI.
 *
 *   deriveSuggestedActions(case, decisionState)   — what the Partner would propose NOW.
 *   revalidateSuggestedAction(action, current)    — is an earlier proposal still true?
 *                                                   (a changed project deadline, changed facts or a
 *                                                   no-longer-applicable context make it STALE — it
 *                                                   must never overwrite a newer value).
 *
 * Actions come ONLY from structured state: Case facts, applicable Owner
 * Contexts (answerCode / answerValue), resolved values and rules. Owner
 * Context notes are never read. Nothing here executes anything.
 */
import type { PartnerCase } from "../cases/types";
import { fingerprintCaseFacts } from "../feedback/snapshot";
import { formatYmdHe, isValidYmd, validateAnswerValue } from "../investigation/answer-value";
import type { PersistedOwnerContext } from "../investigation/context-row";
import { deriveCaseDecisionState, type PartnerCaseDecisionState, type DecisionOwnerContext } from "../investigation/decision-state";
import {
  SUGGESTED_ACTION_SCHEMA_VERSION,
  type ActionEvidence, type ActionPrecondition, type ActionPreconditionCode, type PartnerSuggestedAction, type SkippedAction,
} from "./types";

/** Why-phrases, keyed by structured answers — the explanation is assembled from these, never from notes. */
const CAUSE_PHRASE_HE: Record<string, string> = {
  "WHY_DEADLINE_STILL_ACTIVE:DEADLINE_NOT_UPDATED": "ציינת שהדדליין הישן לא עודכן",
  "WHY_DEADLINE_STILL_ACTIVE:INTENTIONALLY_DELAYED": "ציינת שהפרויקט נדחה בכוונה",
};
const VALUE_PHRASE_HE: Record<string, string> = {
  "WHAT_IS_NEW_PROJECT_DEADLINE:IN_ONE_WEEK": "בחרת יעד חדש של עוד שבוע",
  "WHAT_IS_NEW_PROJECT_DEADLINE:IN_TWO_WEEKS": "בחרת יעד חדש של עוד שבועיים",
  "WHAT_IS_NEW_PROJECT_DEADLINE:END_OF_MONTH": "בחרת יעד חדש של סוף החודש",
  "WHAT_IS_NEW_PROJECT_DEADLINE:SPECIFIC_DATE": "בחרת תאריך יעד חדש",
};

export interface DeriveSuggestedActionsInput {
  case: PartnerCase;
  decisionState: PartnerCaseDecisionState;
  /** Display label of the subject (e.g. the project name) — presentation only, never evidence. */
  subjectLabelHe?: string | null;
}

export interface DeriveSuggestedActionsResult { actions: PartnerSuggestedAction[]; skipped: SkippedAction[] }

const key = (x: Pick<DecisionOwnerContext, "questionType" | "answerCode">) => `${x.questionType}:${x.answerCode}`;
const factValue = (c: PartnerCase, field: string) => c.facts.find((f) => f.field === field)?.value ?? null;

function explanationFor(label: string | null | undefined, from: string, to: string, chain: DecisionOwnerContext[]): string {
  const subject = label ? `'${label}'` : "הפרויקט";
  const cause = chain.map((x) => CAUSE_PHRASE_HE[key(x)]).find(Boolean);
  const value = chain.map((x) => VALUE_PHRASE_HE[key(x)]).find(Boolean);
  const reason = [cause, value].filter(Boolean).join(", ולאחר מכן ");
  return `לעדכן את הדדליין של ${subject} מ-${formatYmdHe(from)} ל-${formatYmdHe(to)}.${reason ? `\n\nהסיבה: ${reason}.` : ""}`;
}

function statusFrom(preconditions: ActionPrecondition[]): { status: PartnerSuggestedAction["status"]; blocking: ActionPreconditionCode[]; staleReasons: ActionPreconditionCode[] } {
  const blocking = preconditions.filter((p) => !p.satisfied).map((p) => p.code);
  // "The truth moved since the decision" → STALE; anything else that fails → NOT_ELIGIBLE.
  const STALE_CODES: ActionPreconditionCode[] = ["CASE_EXISTS", "CASE_FACTS_MATCH_DECISION", "PERSISTED_VALUE_MATCHES_EXPECTED", "TRIGGER_CONTEXT_APPLICABLE", "VALUE_CONTEXT_APPLICABLE"];
  const staleReasons = blocking.filter((b) => STALE_CODES.includes(b));
  return { status: blocking.length === 0 ? "PROPOSED" : staleReasons.length ? "STALE" : "NOT_ELIGIBLE", blocking, staleReasons };
}

/** Derives the Partner's current proposals for ONE Case. Deterministic; never mutates its input. */
export function deriveSuggestedActions(input: DeriveSuggestedActionsInput): DeriveSuggestedActionsResult {
  const { case: c, decisionState: ds } = input;
  const actions: PartnerSuggestedAction[] = [];
  const skipped: SkippedAction[] = [];

  for (const sv of ds.selectedBusinessValues) {
    if (sv.code !== "INTENDED_PROJECT_DEADLINE") continue;
    // The exact causal chain (original trigger → value answer); historical triggers are looked up in referencedContexts.
    const known = [...ds.ownerContexts, ...ds.referencedContexts];
    const chain = sv.source.contextIds.map((id) => known.find((x) => x.contextId === id)).filter((x): x is DecisionOwnerContext => !!x);
    const valueCtx = chain[chain.length - 1]?.applicability === "CURRENT_APPLICABLE" ? chain[chain.length - 1] : undefined;
    const triggerCtx = chain.length > 1 ? chain[0] : null;
    // Trigger validity follows semantic continuity: the value answer is applicable AND its effective (current) trigger is applicable.
    const effectiveTrigger = valueCtx?.effectiveTriggerContextId ? ds.ownerContexts.find((x) => x.contextId === valueCtx.effectiveTriggerContextId) : undefined;
    const persisted = factValue(c, "deadline");
    const to = sv.value.ymd;

    if (typeof persisted === "string" && persisted === to) {
      skipped.push({ actionType: "UPDATE_PROJECT_DEADLINE", subjectId: c.subjectId, reason: "NO_OP_VALUE_ALREADY_PERSISTED", detail: `persisted deadline already ${to}` });
      continue;
    }
    const valueErrors = valueCtx ? validateAnswerValue(valueCtx.questionType, valueCtx.answerCode, sv.value) : ["value context missing"];
    const preconditions: ActionPrecondition[] = [
      { code: "CASE_EXISTS", satisfied: true, detail: c.id },
      { code: "SUBJECT_MATCHES", satisfied: c.subjectType === "project" && ds.subjectType === "project" && ds.subjectId === c.subjectId, detail: `${c.subjectType}:${c.subjectId}` },
      { code: "TRIGGER_CONTEXT_APPLICABLE", satisfied: !!triggerCtx && !!effectiveTrigger, detail: triggerCtx ? `original ${triggerCtx.contextId}; current ${effectiveTrigger?.contextId ?? "none"}` : "no triggering context" },
      { code: "VALUE_CONTEXT_APPLICABLE", satisfied: !!valueCtx, detail: valueCtx ? valueCtx.contextId : "no applicable value context" },
      { code: "VALUE_IS_VALID_DATE", satisfied: valueErrors.length === 0 && isValidYmd(to), detail: valueErrors.join("; ") || to },
      { code: "CASE_FACTS_MATCH_DECISION", satisfied: !!valueCtx && valueCtx.caseFactsFingerprint === ds.caseFactsFingerprint && (!effectiveTrigger || effectiveTrigger.caseFactsFingerprint === ds.caseFactsFingerprint), detail: `current ${ds.caseFactsFingerprint}; decision ${[...new Set(chain.map((x) => x.caseFactsFingerprint))].join(",")}` },
      { code: "PERSISTED_VALUE_MATCHES_EXPECTED", satisfied: typeof persisted === "string" && isValidYmd(persisted), detail: `persisted deadline ${String(persisted)}` },
      { code: "PROPOSED_NOT_BEFORE_ANSWER_DATE", satisfied: isValidYmd(to) && to >= sv.value.resolution.anchorYmd, detail: `${to} vs answer date ${sv.value.resolution.anchorYmd}` },
    ];
    const s = statusFrom(preconditions);
    const evidence: ActionEvidence[] = [
      { kind: "CASE_FACT", caseId: c.id, field: "deadline", value: persisted },
      ...chain.map((x): ActionEvidence => ({ kind: "OWNER_CONTEXT", contextId: x.contextId, questionId: x.questionId, questionType: x.questionType, answerCode: x.answerCode })),
      ...(valueCtx ? [{ kind: "RESOLVED_VALUE", contextId: valueCtx.contextId, value: sv.value } as ActionEvidence] : []),
    ];
    actions.push({
      id: `UPDATE_PROJECT_DEADLINE:${c.subjectId}:${valueCtx?.contextId ?? "none"}:${to}`,
      schemaVersion: SUGGESTED_ACTION_SCHEMA_VERSION,
      actionType: "UPDATE_PROJECT_DEADLINE",
      subjectType: "project",
      subjectId: c.subjectId,
      status: s.status,
      requiresOwnerApproval: true,
      riskLevel: "MEDIUM",
      reasonCodes: [...chain.map((x) => `OWNER_CONTEXT:${key(x)}`), `SELECTED_VALUE:${sv.code}`],
      blockingReasons: s.blocking,
      explanationHe: explanationFor(input.subjectLabelHe, String(persisted), to, chain),
      proposedChange: { entity: "project", entityId: c.subjectId, field: "deadline", from: String(persisted), to },
      evidence,
      sourceCaseId: c.id,
      sourceQuestionIds: sv.source.questionIds,
      sourceContextIds: sv.source.contextIds,
      caseFactsFingerprint: valueCtx?.caseFactsFingerprint ?? ds.caseFactsFingerprint,
      preconditions,
      staleness: { stale: s.status === "STALE", reasons: s.staleReasons },
      createdFrom: "CASE_DECISION_STATE",
    });
  }

  // A decision path that is still waiting for its value produces no action — only a reason.
  if (!actions.length && ds.unknownsRemaining.some((u) => u.code === "NEW_PROJECT_DEADLINE")) {
    skipped.push({ actionType: "UPDATE_PROJECT_DEADLINE", subjectId: c.subjectId, reason: "DECISION_INCOMPLETE", detail: "the new project deadline is still unknown" });
  }
  return { actions: actions.sort((a, b) => a.id.localeCompare(b.id)), skipped };
}

/**
 * Re-checks an EARLIER proposal against the current truth. Returns a new
 * object (never mutates the input). Any drift → STALE with explicit reasons;
 * a stale proposal must never be used to overwrite the newer value.
 */
export function revalidateSuggestedAction(
  action: PartnerSuggestedAction,
  current: { case: PartnerCase | null; caseContextHistory: readonly PersistedOwnerContext[] },
): PartnerSuggestedAction {
  const c = current.case;
  const ds = c ? deriveCaseDecisionState(c, current.caseContextHistory) : null;
  const applicableIds = new Set(ds?.ownerContexts.map((x) => x.contextId) ?? []);
  const [triggerId, ...rest] = action.sourceContextIds;
  const valueId = rest.length ? rest[rest.length - 1] : triggerId;
  const valueNow = ds?.ownerContexts.find((x) => x.contextId === valueId);
  // Continuity: the ORIGINAL trigger may be superseded by an equivalent revision — what matters is that the value answer
  // is still applicable and its effective (current) trigger is applicable.
  const triggerOk = !!valueNow && (valueNow.triggerContextId === null || (!!valueNow.effectiveTriggerContextId && applicableIds.has(valueNow.effectiveTriggerContextId)));
  const persisted = c ? factValue(c, "deadline") : null;
  const preconditions: ActionPrecondition[] = action.preconditions.map((p) => {
    switch (p.code) {
      case "CASE_EXISTS": return { ...p, satisfied: !!c, detail: c ? c.id : "the Case no longer exists" };
      case "SUBJECT_MATCHES": return { ...p, satisfied: !!c && c.subjectId === action.subjectId, detail: c ? `${c.subjectType}:${c.subjectId}` : "no Case" };
      case "TRIGGER_CONTEXT_APPLICABLE": return { ...p, satisfied: triggerOk, detail: `original ${triggerId}; current ${valueNow?.effectiveTriggerContextId ?? "none"}` };
      case "VALUE_CONTEXT_APPLICABLE": return { ...p, satisfied: applicableIds.has(valueId), detail: valueId };
      case "CASE_FACTS_MATCH_DECISION": { const fp = c ? fingerprintCaseFacts(c) : null; return { ...p, satisfied: fp === action.caseFactsFingerprint, detail: `current ${fp}; decision ${action.caseFactsFingerprint}` }; }
      case "PERSISTED_VALUE_MATCHES_EXPECTED": return { ...p, satisfied: persisted === action.proposedChange.from, detail: `persisted ${String(persisted)}; expected ${action.proposedChange.from}` };
      default: return { ...p };
    }
  });
  const s = statusFrom(preconditions);
  return { ...action, preconditions, status: s.status, blockingReasons: s.blocking, staleness: { stale: s.status === "STALE", reasons: s.staleReasons } };
}
