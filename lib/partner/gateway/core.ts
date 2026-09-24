/**
 * Redbloods Partner — Gateway V1: shared pure building blocks. No I/O, no clock (now injected), no writes.
 *
 * GatewaySources is the request-scoped bundle every Gateway call reads from: the SAME Partner Eyes state,
 * the SAME finance live derivation, the SAME memory, cases, action surface and recent outcomes for the
 * whole request (see read-context.ts). Each source fails closed on its own: UNAVAILABLE is reported,
 * never read as "nothing".
 */
import type { PartnerCase } from "../cases/types";
import type { PartnerCompanyState } from "../eyes/types";
import type { FinanceActionCandidate } from "../finance/actions";
import type { FinanceBriefDto } from "../finance/dto";
import type { PartnerFinanceIntegrityState } from "../finance/integrity";
import type { FinanceRaw, PartnerFinanceState } from "../finance/types";
import type { PartnerMemory, PartnerEntityMemory } from "../memory/types";
import { entityForSubject } from "../memory/core";
import type { ActionSurfaceItemDto } from "../actions/surface-dto";
import type { PartnerOutcomeItemDto } from "../actions/outcome-dto";
import type { CompanyIntegrityRegister } from "../integrity/types";
import type { EntityKnowledgeSection, KnowledgeAudience } from "../knowledge/types";
import {
  GATEWAY_SCHEMA_VERSION, GATEWAY_TEXT_POLICY, RECENT_DAYS,
  type GText, type GatewayFreshness, type GatewaySourceName, type GatewaySourceStatus, type GatewayTool,
  type GatewayPattern, type GatewayConflict, type GatewayObservation, type GatewayOwnerDecision,
} from "./types";

export type Avail<T> = { status: "OK"; value: T } | { status: "UNAVAILABLE"; detail: string };

export interface GatewayFinance {
  state: PartnerFinanceState;
  integrity: PartnerFinanceIntegrityState;
  actions: FinanceActionCandidate[];
  raw: FinanceRaw;
  /** The Owner-facing finance brief (≤2 questions, already memory-preflighted); null when Owner answers were unreadable. */
  brief: FinanceBriefDto | null;
  answersAvailable: boolean;
}

/**
 * Canonical identity links that live in application code (not in a table) — passed in by the server binding
 * from the modules that own them, never duplicated here.
 */
export interface GatewayAppIdentities {
  /** DJ CLEANTONE: his client record id + his label-artist display name (lib/red-artists/cleantone.ts). */
  cleantone: { clientId: string; labelArtistName: string } | null;
}

export interface GatewaySources {
  now: Date;
  state?: Avail<PartnerCompanyState>;
  finance?: Avail<GatewayFinance>;
  memory?: Avail<PartnerMemory>;
  cases?: Avail<PartnerCase[]>;
  actions?: Avail<ActionSurfaceItemDto[]>;
  outcomes?: Avail<PartnerOutcomeItemDto[]>;
  /** The live Company Integrity Register (CompanyReadContext) — questions, findings, learned Owner decisions. */
  integrity?: Avail<CompanyIntegrityRegister>;
  identities: GatewayAppIdentities;
  /** Who is asking (for knowledge enrichment). Absent = the most restrictive audience (EXTERNAL, no Owner authority). */
  audience?: KnowledgeAudience;
  /**
   * partner_entity enrichment from the knowledge registry, injected by the server binding (keeps the pure Gateway
   * cores free of the registry — no import cycle). Absent → no enrichment.
   */
  entityKnowledge?: (entityKey: string) => EntityKnowledgeSection[];
}

export const partner = (text: string): GText => ({ text, trust: "PARTNER" });
export const partnerRecord = (text: string): GText => ({ text, trust: "PARTNER_RECORD" });
export const record = (text: string | null | undefined): GText => ({ text: text ?? "", trust: "RECORD" });

export const ok = <T,>(a: Avail<T> | undefined): T | null => (a && a.status === "OK" ? a.value : null);

export function envelope<T extends GatewayTool>(tool: T, query: Record<string, string>, src: GatewaySources, used: Array<[GatewaySourceName, Avail<unknown> | undefined]>) {
  const sources: GatewaySourceStatus[] = used.map(([source, a]) => ({ source, status: a && a.status === "OK" ? "OK" : "UNAVAILABLE", freshness: a && a.status === "OK" ? "LIVE" : "UNKNOWN" }));
  const freshness: GatewayFreshness = sources.every((s) => s.status === "OK") ? "LIVE" : "UNKNOWN";
  return { schemaVersion: GATEWAY_SCHEMA_VERSION, tool, query, asOf: src.now.toISOString(), freshness, sources, textPolicy: GATEWAY_TEXT_POLICY } as const;
}

/** An event in the past: RECENT when within RECENT_DAYS of now, else HISTORICAL. */
export function eventFreshness(atIso: string, now: Date): GatewayFreshness {
  const t = Date.parse(atIso);
  if (!Number.isFinite(t)) return "UNKNOWN";
  return now.getTime() - t <= RECENT_DAYS * 86_400_000 ? "RECENT" : "HISTORICAL";
}

/** Public Gateway key for a memory / Owner Context / Action subject (same identity rules as Organizational Memory). */
export function gatewayKeyForSubject(subjectType: string, subjectId: string): string {
  const ref = entityForSubject(subjectType, subjectId);
  if (ref.kind === "receivable" && ref.parents[0]) return ref.parents[0]; // a project balance belongs to its project
  return ref.key;
}

/** The gateway key a Partner Case is about (its subject), or null when that subject is not a Gateway entity. */
export function caseSubjectKey(c: PartnerCase): string | null {
  switch (c.subjectType) {
    case "project": return `project:${c.subjectId}`;
    case "show": return `show:${c.subjectId}`;
    case "release": return `release:${c.subjectId}`;
    case "victorWork": return "vendor:VICTOR";
    case "stevenWork": return "vendor:STEVEN";
    default: return null;
  }
}

/** Every id a Case's evidence points at (for "is this case about entity X?"). */
export function caseEntityIds(c: PartnerCase): Set<string> {
  return new Set([c.subjectId, ...c.facts.map((f) => f.entityId)]);
}

// ── memory → contract ──

export function memoryFor(memory: PartnerMemory | null, keys: readonly string[]): PartnerEntityMemory[] {
  if (!memory) return [];
  const want = new Set(keys);
  return memory.entities.filter((m) => want.has(m.entity.key) || m.entity.parents.some((p) => want.has(p)));
}

export function toOwnerDecisions(ms: readonly PartnerEntityMemory[]): GatewayOwnerDecision[] {
  return ms.flatMap((m) => m.ownerDecisions.map((d): GatewayOwnerDecision => ({
    questionType: d.questionType, answerCode: d.answerCode, answerDate: d.answerValueYmd, answeredAt: d.answeredAt, status: d.status,
    epistemic: "OWNER_DECISION", freshness: d.status === "ACTIVE" ? "LIVE" : "STALE", entity: gatewayEntityOfMemoryKey(m.entity.key),
  }))).sort((a, b) => a.answeredAt.localeCompare(b.answeredAt) || a.questionType.localeCompare(b.questionType));
}

/**
 * Observations with LIVE OVERRIDE: when memory still calls a "paid but missing Finance record" observation current
 * but the live finance read shows the paid record exists, live wins (current=false, overriddenByLive=true). History kept.
 */
export function toObservations(ms: readonly PartnerEntityMemory[], liveRecordPresent: (entityKey: string) => boolean | null): GatewayObservation[] {
  return ms.flatMap((m) => m.observations.map((o): GatewayObservation => {
    const live = o.signature.issueType === "PAID_BUT_MISSING_FINANCE_RECORD" ? liveRecordPresent(m.entity.key) : null;
    const overridden = o.current && live === true;
    const current = o.current && !overridden;
    const res = m.resolutions.find((r) => r.resolvedIssue === o.signature.issueType) ?? null;
    return {
      issueType: o.signature.issueType, entity: m.entity.key, current, contested: o.contested, overriddenByLive: overridden,
      resolution: res ? res.code : overridden ? "RESOLVED_BY_LIVE_STATE" : null, epistemic: "OBSERVATION", freshness: current ? "LIVE" : "HISTORICAL",
    };
  })).sort((a, b) => a.entity.localeCompare(b.entity) || a.issueType.localeCompare(b.issueType));
}

export function toConflicts(ms: readonly PartnerEntityMemory[]): GatewayConflict[] {
  return ms.flatMap((m) => m.conflicts.map((c): GatewayConflict => ({
    entity: m.entity.key, code: c.code, values: c.values.map((v) => ({ source: v.source, value: v.value })), winning: { ...c.winning }, epistemic: "UNKNOWN",
  }))).sort((a, b) => a.entity.localeCompare(b.entity) || a.code.localeCompare(b.code));
}

export function toPatterns(memory: PartnerMemory | null, family: ((signatureFamily: string) => boolean) | null): { candidates: GatewayPattern[]; confirmed: GatewayPattern[] } {
  if (!memory) return { candidates: [], confirmed: [] };
  const map = (p: PartnerMemory["patternCandidates"][number], status: GatewayPattern["status"]): GatewayPattern => ({
    signature: `${p.signature.entityFamily}|${p.signature.issueType}`, status, evidenceQuality: p.evidenceQuality,
    instances: [...p.instances], contestedInstances: [...p.contestedInstances], note: partnerRecord(p.noteHe), epistemic: "PATTERN_CANDIDATE",
  });
  const keep = (p: PartnerMemory["patternCandidates"][number]) => !family || family(p.signature.entityFamily);
  return { candidates: memory.patternCandidates.filter(keep).map((p) => map(p, "CANDIDATE")), confirmed: memory.confirmedPatterns.filter(keep).map((p) => map(p, "CONFIRMED")) };
}

/** Memory keys that are not Gateway entities (a receivable) map to the entity that owns them. */
export function gatewayEntityOfMemoryKey(key: string): string {
  const m = /^receivable:(?:PROJECT_BALANCE|CLIP_BALANCE):([0-9a-f-]{36})$/.exec(key);
  return m ? `project:${m[1]}` : key;
}

export function cap<T>(items: readonly T[], n: number, truncated: Record<string, number>, name: string): T[] {
  if (items.length > n) truncated[name] = items.length - n;
  return items.slice(0, n);
}

export const heDate = (ymd: string | null | undefined) => (ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}` : null);
