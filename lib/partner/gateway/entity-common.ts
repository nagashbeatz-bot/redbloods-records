/**
 * Redbloods Partner — Gateway V1: shared pieces of every entity view. Pure.
 *
 * An entity view is a COMPOSITION of existing Partner knowledge (Eyes dossiers, Finance Brain, Cases,
 * Organizational Memory, the Action surface) — it never re-derives finance, memory or actions itself.
 */
import type { PartnerCase } from "../cases/types";
import { caseEntityIds, caseSubjectKey, cap, eventFreshness, gatewayEntityOfMemoryKey, gatewayKeyForSubject, memoryFor, ok, partner, partnerRecord, toConflicts, toObservations, toOwnerDecisions, toPatterns, type GatewaySources } from "./core";
import { salaryLinkedId } from "../../victor-salary-format";
import { isCancelledStatus, isExpenseFullyPaidStatus } from "../../finance/classify";
import {
  GATEWAY_LIMITS,
  type EntityResponse, type GatewayActionHistory, type GatewayEntityRef, type GatewayFact, type GatewayIssue, type GatewayMissing,
  type GatewayOutcome, type GatewayQuestion, type GatewayResolution, type GatewayRelationship, type GatewaySuggestedAction, type GatewayDrillDown,
} from "./types";

export const ACTION_TYPE_HE: Record<string, string> = {
  UPDATE_PROJECT_DEADLINE: "עדכון דדליין לפרויקט",
  RECORD_PAID_EXPENSE: "רישום הוצאה ששולמה בכספים",
};

/** Case types that describe money the client still owes on a project. An Owner closure of that balance supersedes them. */
const PROJECT_BALANCE_CASES = new Set(["PROJECT_PAYMENT_OUTSTANDING", "PAYMENT_DUE_DATE_PASSED"]);

/** Project ids whose calculated balance the Owner closed (Finance Brain overlay, OWNER_DECISION). */
export function ownerClosedProjects(src: GatewaySources): Set<string> {
  const f = ok(src.finance);
  return new Set((f?.state.receivables ?? []).filter((r) => r.ownerClosure && r.projectId).map((r) => r.projectId!));
}

/** Live Cases about an entity. A balance case on an Owner-closed project is kept but marked superseded (Owner decision wins). */
export function issuesFor(src: GatewaySources, key: string, ids: ReadonlySet<string>): GatewayIssue[] {
  const cases = ok(src.cases) ?? [];
  const closed = ownerClosedProjects(src);
  const hit = (c: PartnerCase) => caseSubjectKey(c) === key || [...caseEntityIds(c)].some((id) => ids.has(id));
  return cases.filter(hit).map((c): GatewayIssue => ({
    code: c.caseType, classification: c.classification, summary: partnerRecord(c.summaryHe), subject: caseSubjectKey(c),
    status: PROJECT_BALANCE_CASES.has(c.caseType) && c.subjectType === "project" && closed.has(c.subjectId) ? "SUPERSEDED_BY_OWNER_DECISION" : "OPEN",
    epistemic: "DERIVED", freshness: "LIVE",
  })).sort((a, b) => a.code.localeCompare(b.code) || (a.subject ?? "").localeCompare(b.subject ?? ""));
}

/** Unanswered Owner questions about these entities — the Finance view's list, already filtered by the memory pre-flight. */
export function questionsFor(src: GatewaySources, keys: ReadonlySet<string>): GatewayQuestion[] {
  const f = ok(src.finance);
  if (!f || !f.answersAvailable) return [];
  return f.integrity.questions
    .filter((q) => keys.has(gatewayKeyForSubject(q.subject.type, q.subject.id)))
    .map((q): GatewayQuestion => ({ questionType: q.questionType, subject: gatewayKeyForSubject(q.subject.type, q.subject.id), text: partnerRecord(q.textHe), why: partnerRecord(q.whyItMattersHe), answerable: !!q.identity }));
}

/** Suggested Actions for these entities (read-only): the live Owner surface first, then finance candidates not surfaced. */
export function suggestedFor(src: GatewaySources, keys: ReadonlySet<string>): GatewaySuggestedAction[] {
  const out: GatewaySuggestedAction[] = [];
  const seen = new Set<string>();
  const f = ok(src.finance);
  const candidateSubject = new Map((f?.actions ?? []).filter((c) => c.id).map((c) => [c.id!, gatewayKeyForSubject(c.subject.type, c.subject.id)]));
  for (const i of ok(src.actions) ?? []) {
    const subject = i.actionType === "UPDATE_PROJECT_DEADLINE" ? `project:${i.projectId}` : candidateSubject.get(i.actionId) ?? null;
    if (!subject || !keys.has(subject)) continue;
    seen.add(i.actionId);
    out.push({ id: i.actionId, actionType: i.actionType, summary: partnerRecord(i.headlineHe), readiness: i.state, requiresOwnerApproval: true, subject });
  }
  for (const c of f?.actions ?? []) {
    const subject = gatewayKeyForSubject(c.subject.type, c.subject.id);
    if (!keys.has(subject) || (c.id && seen.has(c.id))) continue;
    out.push({
      id: c.id ?? `${c.actionType}:${c.issueId}`, actionType: c.actionType, readiness: c.readiness, requiresOwnerApproval: true, subject,
      summary: partner(c.readiness === "READY_TO_PROPOSE" ? "פעולה מוכנה לאישור שלך" : `פעולה לא מוכנה עדיין — חסר: ${c.missing.join(", ") || "אימות"}`),
    });
  }
  return out;
}

/** Business fields of a recorded expense only — never internal record ids / storage keys in the contract. */
function businessOnly(v: unknown): unknown {
  const o = (v ?? {}) as Record<string, unknown>;
  return { period: o.period ?? null, amount: o.amount ?? null, currency: o.currency ?? null, paymentDate: o.paymentDate ?? null, outcomeStatus: o.outcomeStatus ?? null };
}

/** Everything Organizational Memory holds for these entity keys (children included), with the live override. */
export function memorySections(src: GatewaySources, keys: readonly string[], patternFamily: ((f: string) => boolean) | null) {
  const memory = ok(src.memory);
  const ms = memoryFor(memory, keys);
  const f = ok(src.finance);
  const liveRecordPresent = (entityKey: string): boolean | null => {
    const m = /^recurring:VICTOR_SALARY:(\d{4}-\d{2})$/.exec(entityKey);
    if (!m || !f) return null;
    return f.raw.transactions.some((t) => t.linkedSessionId === salaryLinkedId(m[1]) && !isCancelledStatus(t.status) && t.type === "expense" && isExpenseFullyPaidStatus(t.status));
  };
  const actions: GatewayActionHistory[] = ms.flatMap((m) => m.actions.map((a): GatewayActionHistory => ({
    actionId: a.actionId, actionType: a.actionType, entity: m.entity.key, head: a.headEventType,
    events: a.events.map((e) => ({ type: e.eventType, at: e.at })), freshness: eventFreshness(a.events[a.events.length - 1]?.at ?? "", src.now),
  })));
  const outcomes: GatewayOutcome[] = ms.flatMap((m) => m.outcomes.map((o): GatewayOutcome => {
    const act = m.actions.find((a) => a.actionId === o.actionId);
    const executedAt = act?.events.find((e) => e.eventType === "EXECUTED")?.at ?? "";
    return {
      actionType: act?.actionType ?? "UNKNOWN", state: o.state, headline: partner(ACTION_TYPE_HE[act?.actionType ?? ""] ?? "פעולה של Partner"),
      status: partnerRecord(o.summaryHe), executedAt, subject: m.entity.key,
      freshness: o.state === "APPLIED_AS_EXPECTED" ? "LIVE" : o.state === "READ_FAILED" ? "UNKNOWN" : "STALE",
    };
  }));
  const memoryFacts: GatewayFact[] = ms.flatMap((m) => m.facts
    .filter((x) => x.code === "FINANCE_EXPENSE_RECORDED" || x.code === "PROJECT_DEADLINE")
    // outcome-backed facts (re-checked live by the Outcome); the live values themselves come from the entity view
    .map((x): GatewayFact => x.code === "PROJECT_DEADLINE"
      ? { code: "DEADLINE_SET_BY_ACTION", label: partner("דדליין שנקבע בפעולה של Partner (תואם למצב החי)"), value: x.value, epistemic: "FACT", freshness: "LIVE", source: "OUTCOMES" }
      : { code: x.code, label: partner("הוצאה שנרשמה בכספים על ידי Partner"), value: businessOnly(x.value), epistemic: x.epistemic, freshness: "LIVE", source: "OUTCOMES" }));
  const resolutions: GatewayResolution[] = ms.flatMap((m) => m.resolutions.map((r): GatewayResolution => ({ entity: gatewayEntityOfMemoryKey(m.entity.key), code: r.code, resolvedIssue: r.resolvedIssue, freshness: "HISTORICAL" })))
    .sort((a, b) => a.entity.localeCompare(b.entity) || a.resolvedIssue.localeCompare(b.resolvedIssue));
  return {
    ownerDecisions: toOwnerDecisions(ms), observations: toObservations(ms, liveRecordPresent), conflicts: toConflicts(ms),
    patterns: toPatterns(memory, patternFamily), actions, outcomes, memoryFacts, resolutions, memoryKeys: ms.map((m) => m.entity.key),
  };
}

export interface EntityDraft {
  entity: GatewayEntityRef;
  facts: GatewayFact[];
  relationships: GatewayRelationship[];
  missing: GatewayMissing[];
  drillDown: GatewayDrillDown[];
  /** Keys whose memory / questions / actions belong to this view (the entity itself + e.g. its salary periods). */
  scopeKeys: string[];
  /** Raw ids that Cases may reference for this entity. */
  caseIds: Set<string>;
  patternFamily: ((family: string) => boolean) | null;
}

/** Assemble the final response: memory, issues, questions, actions — then apply the response budget. */
export function finishEntity(src: GatewaySources, d: EntityDraft, env: Pick<EntityResponse, "schemaVersion" | "tool" | "query" | "asOf" | "freshness" | "sources" | "textPolicy">): EntityResponse {
  const truncated: Record<string, number> = {};
  const keys = new Set(d.scopeKeys);
  const mem = memorySections(src, d.scopeKeys, d.patternFamily);
  const missing = [...d.missing];
  if (!ok(src.memory)) missing.push({ fact: "organizational memory", whyNeeded: "Owner decisions, past Actions and history could not be read — nothing here means \"no history\"" });
  const f = ok(src.finance);
  if (f && !f.answersAvailable) missing.push({ fact: "Owner answers", whyNeeded: "open questions are hidden until Owner answers can be read (never re-ask blindly)" });
  return {
    ...env, status: "OK", entity: d.entity,
    facts: cap([...d.facts, ...mem.memoryFacts], GATEWAY_LIMITS.facts, truncated, "facts"),
    relationships: cap(d.relationships, GATEWAY_LIMITS.relationships, truncated, "relationships"),
    ownerDecisions: mem.ownerDecisions, // never truncated
    observations: cap(mem.observations, GATEWAY_LIMITS.observations, truncated, "observations"),
    resolutions: mem.resolutions, // never truncated
    conflicts: mem.conflicts, // never truncated
    patterns: mem.patterns,
    openIssues: cap(issuesFor(src, d.entity.key, d.caseIds), GATEWAY_LIMITS.openIssues, truncated, "openIssues"),
    openQuestions: cap(questionsFor(src, keys), GATEWAY_LIMITS.openQuestions, truncated, "openQuestions"),
    suggestedActions: suggestedFor(src, keys), // never truncated
    actionHistory: mem.actions, // never truncated
    recentOutcomes: cap(mem.outcomes, GATEWAY_LIMITS.recentOutcomes, truncated, "recentOutcomes"),
    missing: cap(missing, GATEWAY_LIMITS.missing, truncated, "missing"),
    drillDown: d.drillDown,
    truncated,
  };
}

export const drill = (key: string, labelHe: string): GatewayDrillDown => ({ tool: "partner_entity", args: { key }, label: partnerRecord(labelHe) });
export const fact = (code: string, labelHe: string, value: unknown, epistemic: GatewayFact["epistemic"], source: GatewayFact["source"], freshness: GatewayFact["freshness"] = "LIVE"): GatewayFact =>
  ({ code, label: partner(labelHe), value, epistemic, freshness, source });
