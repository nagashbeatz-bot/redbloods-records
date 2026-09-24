/**
 * Redbloods Partner — Organizational Memory V1: the pure builder. No I/O, no clock (now injected), no writes.
 *
 *   buildPartnerMemory(sources) → per-entity memory + pattern candidates
 *
 * Precedence (reasoning order, highest first):
 *   1 current live canonical state  2 active Owner Context  3 current Action / Outcome state
 *   4 historical entity memory      5 pattern candidates    6 general derivation
 * Live state wins over stale history: a problem that live state no longer shows becomes a RESOLUTION
 * (history kept), never a current fact. Nothing here changes money or writes anything.
 */
import { classifyOwnerContexts } from "../investigation/context-applicability";
import type { PersistedOwnerContext } from "../investigation/context-row";
import type { PartnerActionEvent } from "../actions/events";
import type { PartnerActionOutcome } from "../actions/outcome";
import type { FinanceView } from "../finance/view";
import type { FinanceRaw } from "../finance/types";
import { salaryLinkedId } from "../../victor-salary-format";
import { isCancelledStatus, isExpenseFullyPaidStatus } from "../../finance/classify";
import {
  MEMORY_SCHEMA_VERSION,
  type MemoryAction, type MemoryConflict, type MemoryEntityRef, type MemoryFact, type MemoryObservation, type MemoryOutcome,
  type MemoryOwnerDecision, type MemoryPatternCandidate, type MemoryResolution, type MemorySourceRef, type PartnerEntityMemory, type PartnerMemory,
} from "./types";

export type Available<T> = ({ status: "OK" } & T) | { status: "UNAVAILABLE"; detail: string };

export interface MemorySources {
  now: Date;
  finance: Available<{ raw: FinanceRaw; view: FinanceView }>;
  ownerContexts: Available<{ history: PersistedOwnerContext[] }>;
  actionEvents: Available<{ events: PartnerActionEvent[] }>;
  outcomes: Available<{ outcomes: PartnerActionOutcome[] }>;
}

/** V1 pattern threshold: at least this many distinct, uncontested instances of one signature. */
export const PATTERN_MIN_INSTANCES = 2;
export const VICTOR_FAMILY = "recurring:VICTOR_SALARY";
export const VICTOR_VENDOR = "vendor:VICTOR";
export const PAID_BUT_MISSING_FINANCE_RECORD = "PAID_BUT_MISSING_FINANCE_RECORD";

const VICTOR_PERIOD = /^VICTOR_SALARY:(\d{4}-(?:0[1-9]|1[0-2]))$/;
const RECEIVABLE = /^(PROJECT_BALANCE|CLIP_BALANCE):([0-9a-f-]{36})$/;

/** The stable entity for an Owner Context / Action subject. Period instances never collapse into each other. */
export function entityForSubject(subjectType: string, subjectId: string): MemoryEntityRef {
  const v = VICTOR_PERIOD.exec(subjectId);
  if (subjectType === "recurring" && v) {
    return { key: `recurring:VICTOR_SALARY:${v[1]}`, kind: "recurring_period", period: v[1], parents: [VICTOR_FAMILY, VICTOR_VENDOR], labelHe: `משכורת Victor ${v[1]}` };
  }
  if (subjectType === "receivable") {
    const r = RECEIVABLE.exec(subjectId);
    return { key: `receivable:${subjectId}`, kind: "receivable", period: null, parents: r ? [`project:${r[2]}`] : [], labelHe: null };
  }
  if (subjectType === "project") return { key: `project:${subjectId}`, kind: "project", period: null, parents: [], labelHe: null };
  if (subjectType === "finance_setting") return { key: `finance-setting:${subjectId}`, kind: "finance_setting", period: null, parents: [], labelHe: null };
  if (subjectType === "expense_pattern") return { key: `expense-pattern:${subjectId}`, kind: "expense_pattern", period: null, parents: [], labelHe: null };
  return { key: `transaction:${subjectId}`, kind: "transaction", period: null, parents: [], labelHe: null };
}

class EntityIndex {
  private map = new Map<string, PartnerEntityMemory>();
  get(ref: MemoryEntityRef): PartnerEntityMemory {
    let m = this.map.get(ref.key);
    if (!m) {
      m = { entity: ref, facts: [], ownerDecisions: [], observations: [], actions: [], outcomes: [], conflicts: [], resolutions: [] };
      this.map.set(ref.key, m);
      for (const p of ref.parents) this.getByKey(p);
    } else if (!m.entity.labelHe && ref.labelHe) m.entity.labelHe = ref.labelHe;
    return m;
  }
  getByKey(key: string): PartnerEntityMemory {
    const existing = this.map.get(key);
    if (existing) return existing;
    const kind = key.startsWith("vendor:") ? "vendor" : key.startsWith("recurring:") ? "recurring" : key.startsWith("project:") ? "project" : "transaction";
    return this.get({ key, kind, period: null, parents: key === VICTOR_FAMILY ? [VICTOR_VENDOR] : [], labelHe: key === VICTOR_VENDOR ? "Victor" : key === VICTOR_FAMILY ? "משכורת Victor" : null });
  }
  all(): PartnerEntityMemory[] { return [...this.map.values()].sort((a, b) => a.entity.key.localeCompare(b.entity.key)); }
}

export function buildPartnerMemory(src: MemorySources): PartnerMemory {
  const idx = new EntityIndex();
  const today = src.now.toISOString().slice(0, 10);

  // ── 2. Owner decisions (every revision kept; status from the canonical applicability rules) ──
  if (src.ownerContexts.status === "OK") {
    const cls = classifyOwnerContexts(src.ownerContexts.history);
    for (const c of src.ownerContexts.history) {
      const s = cls.get(c.id)?.status;
      const d: MemoryOwnerDecision = {
        entity: "", contextId: c.id, questionId: c.questionId, questionType: c.questionType, answerCode: c.answerCode,
        answerValueYmd: c.answerValue?.kind === "DATE" ? c.answerValue.ymd : null, answeredAt: c.answeredAt,
        status: s === "CURRENT_APPLICABLE" ? "ACTIVE" : s === "SUPERSEDED" ? "SUPERSEDED" : "NOT_APPLICABLE", supersedesId: c.supersedesId,
      };
      const e = idx.get(entityForSubject(c.subjectType, c.subjectId));
      e.ownerDecisions.push({ ...d, entity: e.entity.key });
      if (c.answerCode === "PROJECT_CANCELLED_NO_FURTHER_PAYMENT" && d.status === "ACTIVE") {
        e.resolutions.push({ entity: e.entity.key, code: "CLOSED_BY_OWNER_DECISION", resolvedIssue: "RECEIVABLE_DUE_DATE_MISSING", evidence: [{ kind: "OWNER_CONTEXT", ref: c.id }] });
      }
    }
  }
  const activeDecision = (entityKey: string, questionType: string) =>
    idx.all().find((m) => m.entity.key === entityKey)?.ownerDecisions.find((d) => d.questionType === questionType && d.status === "ACTIVE") ?? null;

  // ── 1. Live canonical facts + Victor salary observations / conflicts / resolutions ──
  if (src.finance.status === "OK") {
    const { raw, view } = src.finance;
    const legacy = new Map((raw.victorLegacyPayments ?? []).map((l) => [l.month, l]));
    for (const s of raw.victorSalary ?? []) {
      if (!(s.dueDate <= today)) continue; // only periods already due — no speculation about the future
      const ref = entityForSubject("recurring", `VICTOR_SALARY:${s.workMonth}`);
      const e = idx.get(ref);
      const linked = salaryLinkedId(s.workMonth);
      const txs = raw.transactions.filter((t) => t.linkedSessionId === linked && !isCancelledStatus(t.status));
      const recordedPaid = txs.some((t) => t.type === "expense" && isExpenseFullyPaidStatus(t.status));
      const txRefs: MemorySourceRef[] = txs.map((t) => ({ kind: "FINANCE_TRANSACTIONS", ref: t.id }));
      e.facts.push(
        { entity: ref.key, code: "SALARY_CONFIGURED", epistemic: "FACT", value: { amount: s.amount, currency: s.currency }, sources: [{ kind: "VICTOR_SALARY_CONFIG", ref: s.workMonth }] },
        { entity: ref.key, code: "SALARY_STATUS", epistemic: "FACT", value: s.status, sources: [{ kind: "VICTOR_SALARY_STATUS", ref: s.workMonth }] },
        { entity: ref.key, code: "FINANCE_RECORD", epistemic: "FACT", value: { present: txs.length > 0, paid: recordedPaid, transactionIds: txs.map((t) => t.id) }, sources: txRefs.length ? txRefs : [{ kind: "FINANCE_TRANSACTIONS", ref: `none:${linked}` }] },
      );
      const ownerPaid = activeDecision(ref.key, "FINANCE_RECURRING_PAYMENT_STATUS");
      const paidPerSalaryPage = s.status === "שולם";
      const paidPerOwner = ownerPaid?.answerCode === "PAID_NEEDS_RECORDING";
      // conflicts: sources that disagree about whether this period was paid (precedence: Owner > salary page > legacy)
      const l = legacy.get(s.workMonth);
      const values: MemoryConflict["values"] = [];
      if (ownerPaid) values.push({ source: "OWNER_CONTEXT", value: ownerPaid.answerCode === "PAID_NEEDS_RECORDING" ? "PAID" : ownerPaid.answerCode === "NOT_PAID" ? "NOT_PAID" : "UNKNOWN", precedence: 1 });
      values.push({ source: "VICTOR_SALARY_STATUS", value: paidPerSalaryPage ? "PAID" : s.status === "לא שולם" || s.status === "צפוי" ? "NOT_PAID" : "OTHER", precedence: 2 });
      if (l) values.push({ source: "VICTOR_LEGACY_PAYMENT_STORE", value: l.status === "שולם" ? "PAID" : l.status ? "NOT_PAID" : null, precedence: 3 });
      const distinct = new Set(values.map((v) => v.value).filter((v) => v === "PAID" || v === "NOT_PAID"));
      const contested = distinct.size > 1;
      if (contested) e.conflicts.push({ entity: ref.key, code: "PAYMENT_STATUS_SOURCES_DISAGREE", epistemic: "UNKNOWN", values, winning: { source: values[0].source, value: values[0].value } });
      // observation: paid (by the highest-precedence source that says so) but no Finance record at that time
      if ((paidPerOwner || paidPerSalaryPage) && !recordedPaid) {
        e.observations.push({
          entity: ref.key, signature: { entityFamily: VICTOR_FAMILY, issueType: PAID_BUT_MISSING_FINANCE_RECORD }, epistemic: "OBSERVATION", current: true, contested,
          sources: [...(ownerPaid ? [{ kind: "OWNER_CONTEXT" as const, ref: ownerPaid.contextId }] : []), { kind: "VICTOR_SALARY_STATUS", ref: s.workMonth }, { kind: "FINANCE_TRANSACTIONS", ref: `none:${linked}` }],
        });
      } else if (recordedPaid && paidPerOwner) {
        // live state resolved an issue the Owner had confirmed → history kept, no longer current
        e.observations.push({ entity: ref.key, signature: { entityFamily: VICTOR_FAMILY, issueType: PAID_BUT_MISSING_FINANCE_RECORD }, epistemic: "OBSERVATION", current: false, contested, sources: [{ kind: "OWNER_CONTEXT", ref: ownerPaid!.contextId }, ...txRefs] });
        e.resolutions.push({ entity: ref.key, code: "RESOLVED_SINCE_OBSERVATION", resolvedIssue: PAID_BUT_MISSING_FINANCE_RECORD, evidence: [{ kind: "OWNER_CONTEXT", ref: ownerPaid!.contextId }, ...txRefs] });
      }
    }
    // receivables (collection state, incl. Owner closure) + finance action readiness — DERIVED
    for (const r of view.state.receivables) {
      const ref = entityForSubject("receivable", r.id);
      idx.get({ ...ref, labelHe: r.projectName }).facts.push({ entity: ref.key, code: "RECEIVABLE_COLLECTION", epistemic: "FACT", value: { amount: r.amount, currency: r.currency, state: r.collection.state, ownerClosure: r.ownerClosure?.reconciliation ?? null }, sources: [{ kind: "FINANCE_VIEW", ref: r.id }] });
    }
    for (const a of view.actions) {
      const ref = entityForSubject(a.subject.type, a.subject.id);
      idx.get(ref).facts.push({ entity: ref.key, code: `ACTION_READINESS:${a.actionType}`, epistemic: "DERIVED", value: { readiness: a.readiness, missing: a.missing, facts: a.facts, executable: a.executable, ownerContextIds: a.ownerContextIds }, sources: [{ kind: "FINANCE_VIEW", ref: a.issueId }] });
    }
  }

  // ── 3. Actions (full chains) + Outcomes ──
  if (src.actionEvents.status === "OK") {
    const byAction = new Map<string, PartnerActionEvent[]>();
    for (const ev of src.actionEvents.events) byAction.set(ev.actionId, [...(byAction.get(ev.actionId) ?? []), ev]);
    for (const [actionId, evs] of [...byAction.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const ordered = [...evs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const head = ordered[ordered.length - 1];
      const ref = entityForSubject(head.subjectType, head.subjectId);
      const e = idx.get(ref);
      const snapIds = (head.snapshot as unknown as { sourceContextIds?: unknown }).sourceContextIds;
      const act: MemoryAction = {
        entity: ref.key, actionId, actionType: head.actionType, headEventType: head.eventType,
        events: ordered.map((x) => ({ eventId: x.id, eventType: x.eventType, at: x.createdAt })),
        ownerContextIds: Array.isArray(snapIds) ? snapIds.filter((x): x is string => typeof x === "string") : [],
      };
      e.actions.push(act);
    }
  }
  if (src.outcomes.status === "OK") {
    for (const o of src.outcomes.outcomes) {
      if (!o.subject) continue;
      const ref = entityForSubject(o.subject.type, o.subject.id);
      const e = idx.get({ ...ref, labelHe: o.subjectLabel });
      const out: MemoryOutcome = { entity: ref.key, actionId: o.actionId, state: o.state, evaluatedAt: o.evaluatedAt, expectedValue: o.expectedValue, currentValue: o.current?.value ?? null, summaryHe: o.summaryHe };
      e.outcomes.push(out);
      if (o.state === "APPLIED_AS_EXPECTED") {
        e.facts.push({ entity: ref.key, code: "PROJECT_DEADLINE", epistemic: "FACT", value: o.current?.value ?? null, sources: [{ kind: "ACTION_OUTCOME", ref: o.actionId }] });
        e.resolutions.push({ entity: ref.key, code: "RESOLVED_BY_ACTION", resolvedIssue: o.actionType, evidence: [{ kind: "ACTION_EVENTS", ref: o.executedEventId ?? o.actionId }, { kind: "ACTION_OUTCOME", ref: o.actionId }] });
      }
    }
  }

  const entities = idx.all();
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    builtAt: src.now.toISOString(),
    sources: { ownerContext: src.ownerContexts.status, actionEvents: src.actionEvents.status, outcomes: src.outcomes.status, finance: src.finance.status },
    entities,
    patternCandidates: derivePatternCandidates(entities),
    confirmedPatterns: [], // V1: only an explicit Owner confirmation could confirm a pattern — none exists
  };
}

/**
 * ONE event = observation; ≥ PATTERN_MIN_INSTANCES distinct CLEAN (uncontested) instances of the same
 * structured signature = PATTERN_CANDIDATE (hypothesis). Contested instances are listed, never counted.
 */
export function derivePatternCandidates(entities: readonly PartnerEntityMemory[]): MemoryPatternCandidate[] {
  const groups = new Map<string, { sig: MemoryObservation["signature"]; clean: Set<string>; contested: Set<string> }>();
  for (const e of entities) for (const o of e.observations) {
    const k = `${o.signature.entityFamily}|${o.signature.issueType}`;
    const g = groups.get(k) ?? { sig: o.signature, clean: new Set<string>(), contested: new Set<string>() };
    (o.contested ? g.contested : g.clean).add(o.entity);
    groups.set(k, g);
  }
  const out: MemoryPatternCandidate[] = [];
  for (const g of groups.values()) {
    if (g.clean.size < PATTERN_MIN_INSTANCES) continue;
    const mixed = g.contested.size > 0;
    const periods = [...g.clean].map((k) => k.split(":").pop()).sort();
    out.push({
      signature: g.sig, epistemic: "PATTERN_CANDIDATE", status: "CANDIDATE",
      instances: [...g.clean].sort(), contestedInstances: [...g.contested].sort(), evidenceQuality: mixed ? "MIXED" : "CONSISTENT",
      noteHe: g.sig.issueType === PAID_BUT_MISSING_FINANCE_RECORD && g.sig.entityFamily === VICTOR_FAMILY
        ? (mixed
          ? `יש סימנים שתשלום של Victor סומן כשולם ולא הופיע בכספים גם בעבר (${periods.join(", ")}), אבל הנתונים ההיסטוריים לא מספיק אחידים כדי לקבוע.`
          : `זה נראה דומה למה שקרה עם Victor (${periods.join(", ")}): התשלום סומן כשולם אבל לא הופיע בכספים.`)
        : `אותה בעיה חזרה ב־${g.clean.size} מקרים.`,
    });
  }
  return out.sort((a, b) => `${a.signature.entityFamily}|${a.signature.issueType}`.localeCompare(`${b.signature.entityFamily}|${b.signature.issueType}`));
}

/** "What do I already know about X?" — the entity and everything that belongs to it (children by parent link). */
export function recallEntity(memory: PartnerMemory, key: string): PartnerEntityMemory[] {
  return memory.entities.filter((m) => m.entity.key === key || m.entity.parents.includes(key));
}
