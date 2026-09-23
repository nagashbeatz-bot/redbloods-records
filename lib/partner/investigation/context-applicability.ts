/**
 * Redbloods Partner — Owner Context applicability (Phase F.1E v2). Pure.
 *
 * History is never rewritten. This module only CLASSIFIES each persisted
 * context over the full (already graph-validated) history:
 *
 *   SUPERSEDED                         — a newer revision of the same answer exists (history).
 *   CURRENT_APPLICABLE                 — terminal in its chain, and (no trigger, or its trigger
 *                                        chain still semantically supports it).
 *   NOT_APPLICABLE_TRIGGER_SUPERSEDED  — terminal, but the answer that caused this follow-up no
 *                                        longer supports it. Stays in history; never consumed.
 *
 * Semantic continuity (Owner decision 2026-09-23): a follow-up stays
 * applicable through a newer revision of its trigger when the trigger
 * chain's CURRENT terminal row is equivalent to the ORIGINAL trigger:
 * same question / Case / caseType / subject identity, same answerCode, same
 * caseFactsFingerprint, and that answer still satisfies FOLLOW_UP_RULES.
 * A note-only revision therefore keeps the child applicable; a changed
 * answer, changed facts or a broken rule does not. The child's
 * triggerContextId is never changed — continuity is followed, not rewritten.
 */
import { triggersFollowUp } from "./questions";
import type { PersistedOwnerContext } from "./context-row";

export type ContextApplicabilityStatus = "CURRENT_APPLICABLE" | "SUPERSEDED" | "NOT_APPLICABLE_TRIGGER_SUPERSEDED";

export type NotApplicableReason =
  | "TRIGGER_MISSING"
  | "TRIGGER_NOT_APPLICABLE"
  | "TRIGGER_IDENTITY_CHANGED"
  | "TRIGGER_ANSWER_CHANGED"
  | "TRIGGER_FACTS_CHANGED"
  | "TRIGGER_NO_LONGER_SATISFIES_RULE";

export interface ContextApplicability {
  contextId: string;
  status: ContextApplicabilityStatus;
  /** For a follow-up: the current terminal row of its trigger's chain (may differ from triggerContextId after continuity). */
  effectiveTriggerId: string | null;
  reasons: NotApplicableReason[];
}

type Ctx = PersistedOwnerContext;

/** Equivalence of the ORIGINAL trigger and its chain's current terminal, for this follow-up. */
export function triggerStillSupports(original: Ctx, terminal: Ctx, child: Pick<Ctx, "questionType">): NotApplicableReason[] {
  const reasons: NotApplicableReason[] = [];
  if (original.questionId !== terminal.questionId || original.caseId !== terminal.caseId || original.caseType !== terminal.caseType
      || original.subjectType !== terminal.subjectType || original.subjectId !== terminal.subjectId) reasons.push("TRIGGER_IDENTITY_CHANGED");
  if (original.answerCode !== terminal.answerCode) reasons.push("TRIGGER_ANSWER_CHANGED");
  if (original.caseFactsFingerprint !== terminal.caseFactsFingerprint) reasons.push("TRIGGER_FACTS_CHANGED");
  if (!triggersFollowUp(terminal.questionType, terminal.answerCode, child.questionType)) reasons.push("TRIGGER_NO_LONGER_SATISFIES_RULE");
  return reasons;
}

/** Classifies every context in a VALID history (callers run analyzeOwnerContextGraph first). Deterministic. */
export function classifyOwnerContexts(history: readonly Ctx[]): Map<string, ContextApplicability> {
  const byId = new Map(history.map((c) => [c.id, c]));
  const successor = new Map<string, string>();
  for (const c of [...history].sort((a, b) => a.id.localeCompare(b.id))) if (c.supersedesId && !successor.has(c.supersedesId)) successor.set(c.supersedesId, c.id);

  const terminalOf = (c: Ctx): Ctx => {
    let cur = c;
    const seen = new Set<string>([c.id]);
    for (let next = successor.get(cur.id); next && !seen.has(next); next = successor.get(cur.id)) {
      const n = byId.get(next);
      if (!n) break;
      seen.add(next);
      cur = n;
    }
    return cur;
  };

  const out = new Map<string, ContextApplicability>();
  const visiting = new Set<string>();
  const classify = (c: Ctx): ContextApplicability => {
    const done = out.get(c.id);
    if (done) return done;
    let result: ContextApplicability;
    if (successor.has(c.id)) {
      result = { contextId: c.id, status: "SUPERSEDED", effectiveTriggerId: null, reasons: [] };
    } else if (c.triggerContextId === null) {
      result = { contextId: c.id, status: "CURRENT_APPLICABLE", effectiveTriggerId: null, reasons: [] };
    } else {
      const original = byId.get(c.triggerContextId);
      if (!original || visiting.has(c.id)) {
        result = { contextId: c.id, status: "NOT_APPLICABLE_TRIGGER_SUPERSEDED", effectiveTriggerId: null, reasons: ["TRIGGER_MISSING"] };
      } else {
        visiting.add(c.id);
        const terminal = terminalOf(original);
        const reasons = triggerStillSupports(original, terminal, c);
        if (classify(terminal).status !== "CURRENT_APPLICABLE") reasons.unshift("TRIGGER_NOT_APPLICABLE");
        visiting.delete(c.id);
        result = { contextId: c.id, status: reasons.length ? "NOT_APPLICABLE_TRIGGER_SUPERSEDED" : "CURRENT_APPLICABLE", effectiveTriggerId: terminal.id, reasons };
      }
    }
    out.set(c.id, result);
    return result;
  };
  for (const c of [...history].sort((a, b) => a.id.localeCompare(b.id))) classify(c);
  return out;
}

/** Only the contexts downstream logic may consume (queue, interpretation, learning, future Actions). */
export function applicableContexts(history: readonly Ctx[]): Ctx[] {
  const cls = classifyOwnerContexts(history);
  return history.filter((c) => cls.get(c.id)?.status === "CURRENT_APPLICABLE");
}

/**
 * Would a NEW follow-up of `followUpType` triggered by `triggerId` be
 * CURRENT_APPLICABLE right now? Same rule as classifyOwnerContexts (the store
 * uses it at write time so a follow-up is never attached to a trigger that no
 * longer supports it).
 */
export function triggerSupportsFollowUp(
  history: readonly Ctx[],
  triggerId: string,
  followUpType: Ctx["questionType"],
): { ok: boolean; effectiveTriggerId: string | null; reasons: NotApplicableReason[] } {
  const byId = new Map(history.map((c) => [c.id, c]));
  const original = byId.get(triggerId);
  if (!original) return { ok: false, effectiveTriggerId: null, reasons: ["TRIGGER_MISSING"] };
  const successor = new Map<string, string>();
  for (const c of [...history].sort((a, b) => a.id.localeCompare(b.id))) if (c.supersedesId && !successor.has(c.supersedesId)) successor.set(c.supersedesId, c.id);
  let terminal = original;
  const seen = new Set<string>([original.id]);
  for (let next = successor.get(terminal.id); next && !seen.has(next); next = successor.get(terminal.id)) {
    const n = byId.get(next);
    if (!n) break;
    seen.add(next);
    terminal = n;
  }
  const reasons = triggerStillSupports(original, terminal, { questionType: followUpType });
  if (classifyOwnerContexts(history).get(terminal.id)?.status !== "CURRENT_APPLICABLE") reasons.unshift("TRIGGER_NOT_APPLICABLE");
  return { ok: reasons.length === 0, effectiveTriggerId: terminal.id, reasons };
}
